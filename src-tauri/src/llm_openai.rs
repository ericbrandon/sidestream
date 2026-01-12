use futures::StreamExt;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

use crate::commands::get_api_key_async;
use crate::llm::{
    tool_names, ChatMessage, ContainerIdEvent, ExecutionDelta, ExecutionStatus, GeneratedFile,
    StreamDelta, StreamEvent,
};
use crate::llm_logger;
use crate::providers::anthropic::InlineCitation;
use crate::providers::openai::{
    parse_sse_event as openai_parse_sse_event, string_to_reasoning_effort, supports_reasoning,
    fetch_file_content_base64, ChatRequestConfig as OpenAIChatRequestConfig, OpenAIClient, OpenAIStreamEvent,
    ReasoningEffort,
};

/// Send chat message using OpenAI Responses API
pub async fn send_chat_message_openai(
    app: &tauri::AppHandle,
    window: &tauri::Window,
    cancel_token: CancellationToken,
    model: String,
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
    web_search_enabled: bool,
    code_execution_enabled: bool,
    reasoning_level: Option<String>,
    session_id: Option<String>,
    turn_id: String,
    openai_container_id: Option<String>,
) -> Result<(), String> {
    let api_key = get_api_key_async(app, "openai").await?;
    let client = OpenAIClient::new(api_key.clone());

    // Build messages for OpenAI
    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();

    // Determine reasoning effort from the level string
    // For GPT-5: "off" maps to None reasoning, "low"/"medium"/"high" set effort
    // For o-series: "low"/"medium"/"high" only (no "off" option)
    // NOTE: OpenAI doesn't allow "minimal" with web_search (per official docs), so bump to "low"
    let reasoning_effort: Option<ReasoningEffort> = if supports_reasoning(&model) {
        reasoning_level.as_ref().map(|level| {
            let effort = string_to_reasoning_effort(level);
            // OpenAI API rejects "minimal" when web_search is enabled (per official docs)
            if web_search_enabled && matches!(effort, ReasoningEffort::Minimal) {
                ReasoningEffort::Low
            } else {
                effort
            }
        })
    } else {
        None
    };

    // Track current container ID (will be updated if we receive a new one)
    // Used to associate files extracted from sandbox URLs with the correct container
    let mut current_container_id: Option<String> = openai_container_id.clone();

    // Build request using OpenAI provider
    // Let OpenAI use its model defaults for max output tokens
    let config = OpenAIChatRequestConfig {
        model: model.clone(),
        messages: api_messages,
        system_prompt,
        reasoning_effort,
        web_search_enabled,
        prompt_cache_key: session_id.map(|id| format!("chat-{}", id)),
        code_interpreter_enabled: code_execution_enabled,
        container_id: openai_container_id,
    };
    let body = client.build_chat_request(&config);

    llm_logger::log_request("chat", &model, &body);

    let response = client.send_streaming_request(&body).await.map_err(|e| {
        llm_logger::log_error("chat", &e);
        e
    })?;

    // Stream the response
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full_response = String::new();

    // State tracking for code interpreter
    let mut pending_code = String::new();

    loop {
        tokio::select! {
            // Check for cancellation
            _ = cancel_token.cancelled() => {
                if let Err(err) = window.emit("chat-stream-cancelled", StreamEvent { turn_id: turn_id.clone() }) {
                    eprintln!("Failed to emit chat-stream-cancelled event: {}", err);
                }
                return Ok(());
            }
            // Process next chunk from stream
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        let text = String::from_utf8_lossy(&bytes);
                        buffer.push_str(&text);

                        // Parse SSE events
                        while let Some(event_end) = buffer.find("\n\n") {
                            let event = buffer[..event_end].to_string();
                            buffer = buffer[event_end + 2..].to_string();

                            for line in event.lines() {
                                if let Some(data) = line.strip_prefix("data: ") {
                                    let parsed_event = openai_parse_sse_event(data);
                                    match parsed_event {
                                        OpenAIStreamEvent::Done | OpenAIStreamEvent::ResponseCompleted => {
                                            llm_logger::log_response_complete("chat", &full_response);
                                            if let Err(err) = window.emit("chat-stream-done", StreamEvent { turn_id: turn_id.clone() }) {
                                                eprintln!("Failed to emit chat-stream-done event: {}", err);
                                            }
                                            return Ok(());
                                        }
                                        OpenAIStreamEvent::TextDelta { text: t } => {
                                            full_response.push_str(&t);
                                            let delta = StreamDelta {
                                                turn_id: turn_id.clone(),
                                                text: t,
                                                citations: None,
                                                inline_citations: None,
                                                thinking: None,
                                                execution: None,
                                            };
                                            if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                            }
                                        }
                                        OpenAIStreamEvent::ReasoningSummary { text: thinking_text } => {
                                            // Emit reasoning summary as thinking delta for ephemeral UI
                                            let delta = StreamDelta {
                                                turn_id: turn_id.clone(),
                                                text: String::new(),
                                                citations: None,
                                                inline_citations: None,
                                                thinking: Some(thinking_text),
                                                execution: None,
                                            };
                                            if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                            }
                                        }
                                        OpenAIStreamEvent::TextDone { text: _, annotations, file_citations } => {
                                            // Convert OpenAI URL citations to common format
                                            // OpenAI doesn't provide position info, so we use end-of-message citations
                                            if !annotations.is_empty() {
                                                let offset = full_response.len();
                                                let inline_citations: Vec<InlineCitation> = annotations
                                                    .into_iter()
                                                    .map(|a| InlineCitation {
                                                        url: a.url,
                                                        title: a.title,
                                                        cited_text: String::new(),
                                                        char_offset: offset,
                                                    })
                                                    .collect();
                                                let delta = StreamDelta {
                                                    turn_id: turn_id.clone(),
                                                    text: String::new(),
                                                    citations: None,
                                                    inline_citations: Some(inline_citations),
                                                    thinking: None,
                                                    execution: None,
                                                };
                                                if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                    eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                                }
                                            }

                                            // Emit container file citations as generated files
                                            // These come from text annotations when model references files in markdown
                                            if !file_citations.is_empty() {
                                                // Emit container ID - from file citation or from tracked container_id
                                                let effective_container_id = file_citations.first()
                                                    .filter(|f| !f.container_id.is_empty())
                                                    .map(|f| f.container_id.clone())
                                                    .or_else(|| current_container_id.clone());

                                                if let Some(ref cid) = effective_container_id {
                                                    if let Err(err) = window.emit(
                                                        "chat-container-id",
                                                        ContainerIdEvent {
                                                            turn_id: turn_id.clone(),
                                                            container_id: cid.clone(),
                                                        },
                                                    ) {
                                                        eprintln!("Failed to emit container ID: {}", err);
                                                    }
                                                }

                                                // Fetch file content for persistence
                                                let mut generated_files: Vec<GeneratedFile> = Vec::new();
                                                for f in file_citations {
                                                    // Use container_id from file citation or effective_container_id
                                                    let cid = if !f.container_id.is_empty() {
                                                        Some(f.container_id.clone())
                                                    } else {
                                                        effective_container_id.clone()
                                                    };

                                                    let (inline_data, image_preview, mime_type) = if let Some(ref container_id) = cid {
                                                        match fetch_file_content_base64(&api_key, container_id, &f.file_id).await {
                                                            Ok(data) => {
                                                                // Guess mime type from filename extension
                                                                let mime = crate::mime_utils::extension_to_mime(&f.filename);
                                                                let preview = mime.as_ref()
                                                                    .filter(|m| m.starts_with("image/"))
                                                                    .map(|m| format!("data:{};base64,{}", m, data));
                                                                (Some(data), preview, mime.map(|s| s.to_string()))
                                                            }
                                                            Err(e) => {
                                                                eprintln!("Failed to fetch file content for {}: {}", f.file_id, e);
                                                                (None, None, None)
                                                            }
                                                        }
                                                    } else {
                                                        (None, None, None)
                                                    };

                                                    generated_files.push(GeneratedFile {
                                                        file_id: f.file_id,
                                                        filename: f.filename,
                                                        mime_type,
                                                        image_preview,
                                                        inline_data,
                                                    });
                                                }

                                                let delta = StreamDelta {
                                                    turn_id: turn_id.clone(),
                                                    text: String::new(),
                                                    citations: None,
                                                    inline_citations: None,
                                                    thinking: None,
                                                    execution: Some(ExecutionDelta {
                                                        tool_name: tool_names::CODE_INTERPRETER.to_string(),
                                                        stdout: None,
                                                        stderr: None,
                                                        status: ExecutionStatus::Completed,
                                                        code: None,
                                                        files: Some(generated_files),
                                                    }),
                                                };
                                                if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                    eprintln!("Failed to emit file citations delta: {}", err);
                                                }
                                            }
                                        }
                                        OpenAIStreamEvent::WebSearchStarted => {
                                            llm_logger::log_feature_used("chat", "OpenAI Web Search initiated");
                                        }
                                        // Code interpreter events - reuse same ExecutionDelta pattern as Anthropic
                                        OpenAIStreamEvent::CodeInterpreterStarted { call_id: _ } => {
                                            llm_logger::log_feature_used("chat", "OpenAI Code Interpreter started");
                                            pending_code.clear();
                                        }
                                        OpenAIStreamEvent::CodeInterpreterCodeDelta { call_id: _, code } => {
                                            pending_code.push_str(&code);
                                        }
                                        OpenAIStreamEvent::CodeInterpreterCodeDone { call_id: _, code } => {
                                            // Emit execution started with full code
                                            let final_code = if code.is_empty() { pending_code.clone() } else { code };
                                            let delta = StreamDelta {
                                                turn_id: turn_id.clone(),
                                                text: String::new(),
                                                citations: None,
                                                inline_citations: None,
                                                thinking: None,
                                                execution: Some(ExecutionDelta {
                                                    tool_name: tool_names::CODE_INTERPRETER.to_string(),
                                                    stdout: None,
                                                    stderr: None,
                                                    status: ExecutionStatus::Started,
                                                    code: Some(final_code),
                                                    files: None,
                                                }),
                                            };
                                            if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                eprintln!("Failed to emit execution started delta: {}", err);
                                            }
                                        }
                                        OpenAIStreamEvent::CodeInterpreterResult {
                                            call_id: _,
                                            container_id,
                                            stdout,
                                            stderr,
                                            files,
                                        } => {
                                            // Track container ID for later use in TextDone
                                            if container_id.is_some() {
                                                current_container_id = container_id.clone();
                                            }

                                            // Emit container ID for persistence (reuse same event as Anthropic)
                                            if let Some(ref cid) = container_id {
                                                if let Err(err) = window.emit(
                                                    "chat-container-id",
                                                    ContainerIdEvent {
                                                        turn_id: turn_id.clone(),
                                                        container_id: cid.clone(),
                                                    },
                                                ) {
                                                    eprintln!("Failed to emit container ID: {}", err);
                                                }
                                            }

                                            // Convert files to GeneratedFile format, fetching content for persistence
                                            let mut generated_files: Vec<GeneratedFile> = Vec::new();
                                            for f in files {
                                                let (inline_data, image_preview, mime_type) = if let Some(ref cid) = container_id {
                                                    match fetch_file_content_base64(&api_key, cid, &f.file_id).await {
                                                        Ok(data) => {
                                                            // Guess mime type from filename extension
                                                            let mime = crate::mime_utils::extension_to_mime(&f.filename);
                                                            let preview = mime.as_ref()
                                                                .filter(|m| m.starts_with("image/"))
                                                                .map(|m| format!("data:{};base64,{}", m, data));
                                                            (Some(data), preview, mime.map(|s| s.to_string()))
                                                        }
                                                        Err(e) => {
                                                            eprintln!("Failed to fetch file content for {}: {}", f.file_id, e);
                                                            (None, None, None)
                                                        }
                                                    }
                                                } else {
                                                    (None, None, None)
                                                };

                                                generated_files.push(GeneratedFile {
                                                    file_id: f.file_id,
                                                    filename: f.filename,
                                                    mime_type,
                                                    image_preview,
                                                    inline_data,
                                                });
                                            }

                                            // Determine status based on stderr
                                            let status = if stderr.is_some() {
                                                ExecutionStatus::Failed {
                                                    error: stderr.clone().unwrap_or_default(),
                                                }
                                            } else {
                                                ExecutionStatus::Completed
                                            };

                                            let delta = StreamDelta {
                                                turn_id: turn_id.clone(),
                                                text: String::new(),
                                                citations: None,
                                                inline_citations: None,
                                                thinking: None,
                                                execution: Some(ExecutionDelta {
                                                    tool_name: tool_names::CODE_INTERPRETER.to_string(),
                                                    stdout,
                                                    stderr,
                                                    status,
                                                    code: None,
                                                    files: if generated_files.is_empty() {
                                                        None
                                                    } else {
                                                        Some(generated_files)
                                                    },
                                                }),
                                            };
                                            if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                eprintln!("Failed to emit execution result delta: {}", err);
                                            }
                                        }
                                        OpenAIStreamEvent::Error { message } => {
                                            llm_logger::log_error("chat", &message);
                                            return Err(message);
                                        }
                                        OpenAIStreamEvent::Unknown => {}
                                    }
                                }
                            }
                        }
                    }
                    Some(Err(e)) => return Err(e.to_string()),
                    None => break,
                }
            }
        }
    }

    llm_logger::log_response_complete("chat", &full_response);
    if let Err(err) = window.emit("chat-stream-done", StreamEvent { turn_id }) {
        eprintln!("Failed to emit chat-stream-done event: {}", err);
    }
    Ok(())
}
