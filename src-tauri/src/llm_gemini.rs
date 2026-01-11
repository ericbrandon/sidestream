use futures::StreamExt;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

use std::time::{SystemTime, UNIX_EPOCH};

use crate::commands::get_api_key_async;
use crate::llm::{tool_names, ChatMessage, ExecutionDelta, ExecutionStatus, GeneratedFile, StreamDelta, StreamEvent};
use crate::llm_logger;
use crate::providers::anthropic::InlineCitation;
use crate::providers::gemini::{
    extract_inline_citations_from_grounding, mime_to_extension, parse_sse_event as gemini_parse_sse_event,
    string_to_thinking_config, supports_thinking as gemini_supports_thinking,
    ChatRequestConfig as GeminiChatRequestConfig, GeminiClient, GeminiStreamEvent,
};

/// Send chat message using Google Gemini API
pub async fn send_chat_message_gemini(
    app: &tauri::AppHandle,
    window: &tauri::Window,
    cancel_token: CancellationToken,
    model: String,
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
    web_search_enabled: bool,
    thinking_level: Option<String>,
    turn_id: String,
) -> Result<(), String> {
    let api_key = get_api_key_async(app, "google").await?;
    let client = GeminiClient::new(api_key);

    // Build messages for Gemini
    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();

    // Determine thinking config from the level string
    let thinking_config = if gemini_supports_thinking(&model) {
        thinking_level
            .as_ref()
            .and_then(|level| string_to_thinking_config(level, &model))
    } else {
        None
    };

    // Build request using Gemini provider
    let config = GeminiChatRequestConfig {
        messages: api_messages,
        system_prompt,
        thinking_config,
        web_search_enabled,
        code_execution_enabled: true, // Always enable code execution for Gemini
    };
    let body = client.build_chat_request(&config);

    llm_logger::log_request("chat", &model, &body);

    let response = client
        .send_streaming_request(&model, &body)
        .await
        .map_err(|e| {
            llm_logger::log_error("chat", &e);
            e
        })?;

    // Stream the response
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full_response = String::new();
    let mut accumulated_text = String::new();
    let mut accumulated_thinking = String::new();
    let mut generated_file_count: u32 = 0;

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

                        // Gemini streams each SSE event on its own line (data: {...}\r\n)
                        // without double-newline separators. Parse line by line.

                        // Process complete lines from buffer
                        while let Some(line_end) = buffer.find('\n') {
                            let line = buffer[..line_end].trim_end_matches('\r').to_string();
                            buffer = buffer[line_end + 1..].to_string();

                            if let Some(data) = line.strip_prefix("data: ") {
                                // parse_sse_event returns Vec since one SSE can have multiple parts
                                let events = gemini_parse_sse_event(data);

                                for event in events {
                                match event {
                                    GeminiStreamEvent::TextDelta { text: t } => {
                                        // Gemini sends complete text in each chunk, need to diff
                                        let new_text = if t.starts_with(&accumulated_text) {
                                            t[accumulated_text.len()..].to_string()
                                        } else {
                                            // Reset - new response
                                            accumulated_text.clear();
                                            t.clone()
                                        };
                                        accumulated_text = t;

                                        if !new_text.is_empty() {
                                            full_response.push_str(&new_text);
                                            let delta = StreamDelta {
                                                turn_id: turn_id.clone(),
                                                text: new_text,
                                                citations: None,
                                                inline_citations: None,
                                                thinking: None,
                                                execution: None,
                                            };
                                            if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                            }
                                        }
                                    }
                                    GeminiStreamEvent::ThinkingDelta { text: thinking_text } => {
                                        // Gemini sends cumulative thinking text, need to diff
                                        let new_thinking = if thinking_text.starts_with(&accumulated_thinking) {
                                            thinking_text[accumulated_thinking.len()..].to_string()
                                        } else {
                                            // Reset - new thinking block
                                            accumulated_thinking.clear();
                                            thinking_text.clone()
                                        };
                                        accumulated_thinking = thinking_text;

                                        // Emit thinking delta for ephemeral UI display
                                        if !new_thinking.is_empty() {
                                            let delta = StreamDelta {
                                                turn_id: turn_id.clone(),
                                                text: String::new(),
                                                citations: None,
                                                inline_citations: None,
                                                thinking: Some(new_thinking),
                                                execution: None,
                                            };
                                            if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                            }
                                        }
                                    }
                                    GeminiStreamEvent::GroundingMetadata { metadata } => {
                                        llm_logger::log_feature_used("chat", "Gemini Google Search");
                                        // Extract inline citations with proper character offsets
                                        let gemini_citations = extract_inline_citations_from_grounding(&metadata, &full_response);
                                        if !gemini_citations.is_empty() {
                                            // Convert Gemini InlineCitation to Anthropic InlineCitation type
                                            let inline_citations: Vec<InlineCitation> = gemini_citations
                                                .into_iter()
                                                .map(|c| InlineCitation {
                                                    url: c.url,
                                                    title: c.title,
                                                    cited_text: c.cited_text,
                                                    char_offset: c.char_offset,
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
                                    }
                                    GeminiStreamEvent::ResponseComplete => {
                                        llm_logger::log_response_complete("chat", &full_response);
                                        if let Err(err) = window.emit("chat-stream-done", StreamEvent { turn_id: turn_id.clone() }) {
                                            eprintln!("Failed to emit chat-stream-done event: {}", err);
                                        }
                                        return Ok(());
                                    }
                                    GeminiStreamEvent::Error { message } => {
                                        llm_logger::log_error("chat", &message);
                                        return Err(message);
                                    }
                                    GeminiStreamEvent::ExecutableCode { code } => {
                                        llm_logger::log_feature_used("chat", "Gemini Code Execution Started");
                                        // Emit execution started with code
                                        let delta = StreamDelta {
                                            turn_id: turn_id.clone(),
                                            text: String::new(),
                                            citations: None,
                                            inline_citations: None,
                                            thinking: None,
                                            execution: Some(ExecutionDelta {
                                                tool_name: tool_names::GEMINI_CODE_EXECUTION.to_string(),
                                                stdout: None,
                                                stderr: None,
                                                status: ExecutionStatus::Started,
                                                code: Some(code),
                                                files: None,
                                            }),
                                        };
                                        if let Err(err) = window.emit("chat-stream-delta", delta) {
                                            eprintln!("Failed to emit execution started delta: {}", err);
                                        }
                                    }
                                    GeminiStreamEvent::CodeExecutionResult { output } => {
                                        // Emit execution output
                                        let delta = StreamDelta {
                                            turn_id: turn_id.clone(),
                                            text: String::new(),
                                            citations: None,
                                            inline_citations: None,
                                            thinking: None,
                                            execution: Some(ExecutionDelta {
                                                tool_name: tool_names::GEMINI_CODE_EXECUTION.to_string(),
                                                stdout: Some(output),
                                                stderr: None,
                                                status: ExecutionStatus::Completed,
                                                code: None,
                                                files: None,
                                            }),
                                        };
                                        if let Err(err) = window.emit("chat-stream-delta", delta) {
                                            eprintln!("Failed to emit execution result delta: {}", err);
                                        }
                                    }
                                    GeminiStreamEvent::InlineData { mime_type, data } => {
                                        let timestamp = SystemTime::now()
                                            .duration_since(UNIX_EPOCH)
                                            .unwrap_or_default()
                                            .as_millis();

                                        let extension = mime_to_extension(&mime_type);
                                        let file_id = format!("gemini-{}-{}", timestamp, generated_file_count);
                                        let filename = format!("generated-{}.{}", timestamp, extension);
                                        generated_file_count += 1;

                                        // Create data URL for image preview (if it's an image)
                                        let image_preview = if mime_type.starts_with("image/") {
                                            Some(format!("data:{};base64,{}", mime_type, data))
                                        } else {
                                            None
                                        };

                                        let file = GeneratedFile {
                                            file_id: file_id.clone(),
                                            filename,
                                            mime_type: Some(mime_type.clone()),
                                            image_preview,
                                            inline_data: Some(data),
                                        };

                                        llm_logger::log_feature_used("chat", &format!("Gemini File Generated: {}", mime_type));

                                        // Emit file as it arrives
                                        let delta = StreamDelta {
                                            turn_id: turn_id.clone(),
                                            text: String::new(),
                                            citations: None,
                                            inline_citations: None,
                                            thinking: None,
                                            execution: Some(ExecutionDelta {
                                                tool_name: tool_names::GEMINI_CODE_EXECUTION.to_string(),
                                                stdout: None,
                                                stderr: None,
                                                status: ExecutionStatus::Completed,
                                                code: None,
                                                files: Some(vec![file]),
                                            }),
                                        };
                                        if let Err(err) = window.emit("chat-stream-delta", delta) {
                                            eprintln!("Failed to emit generated file delta: {}", err);
                                        }
                                    }
                                    GeminiStreamEvent::Unknown => {}
                                }
                                } // end for event in events
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
