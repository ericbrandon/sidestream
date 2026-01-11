use futures::StreamExt;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

use crate::commands::get_api_key_async;
use crate::llm::{ChatMessage, ContainerIdEvent, ExecutionDelta, ExecutionStatus, GeneratedFile, StreamDelta, StreamEvent};
use crate::llm_logger;
use crate::providers::anthropic::{
    add_cache_control_to_last_message, calculate_max_tokens as anthropic_calculate_max_tokens,
    fetch_file_metadata, is_code_execution_block, is_code_execution_result, parse_code_execution_result,
    parse_sse_event as anthropic_parse_sse_event, AnthropicClient, AnthropicStreamEvent,
    ChatRequestConfig as AnthropicChatRequestConfig, InlineCitation, ThinkingConfig,
};

/// Send chat message using Anthropic API
pub async fn send_chat_message_anthropic(
    app: &tauri::AppHandle,
    window: &tauri::Window,
    cancel_token: CancellationToken,
    model: String,
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
    extended_thinking_enabled: bool,
    thinking_budget: Option<u32>,
    web_search_enabled: bool,
    code_execution_enabled: bool,
    turn_id: String,
    container_id: Option<String>,
) -> Result<(), String> {
    let api_key = get_api_key_async(app, "anthropic").await?;
    let client = AnthropicClient::new(api_key.clone());

    // Build messages with cache breakpoint on the last message
    // Transform 'file' blocks to 'document' blocks for Anthropic API compatibility
    let mut api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            let content = transform_file_blocks_for_anthropic(&m.content);
            serde_json::json!({"role": m.role, "content": content})
        })
        .collect();

    add_cache_control_to_last_message(&mut api_messages);

    // Build request using provider
    let max_tokens = anthropic_calculate_max_tokens(extended_thinking_enabled, thinking_budget);
    let config = AnthropicChatRequestConfig {
        model: model.clone(),
        messages: api_messages,
        system_prompt,
        max_tokens,
        extended_thinking: if extended_thinking_enabled {
            thinking_budget.map(|b| ThinkingConfig { budget_tokens: b })
        } else {
            None
        },
        web_search_enabled,
        code_execution_enabled,
        container_id: container_id.clone(),
    };
    let body = client.build_chat_request(&config);

    llm_logger::log_request("chat", &model, &body);

    // Use beta header if code execution is enabled OR if we have a container ID
    // (container reuse requires the code-execution beta header)
    let beta_header = if code_execution_enabled || container_id.is_some() {
        Some("code-execution-2025-08-25")
    } else {
        None
    };
    let response = client
        .send_streaming_request_with_beta(&body, beta_header)
        .await
        .map_err(|e| {
            llm_logger::log_error("chat", &e);
            e
        })?;

    // Stream the response
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full_response = String::new();
    let mut current_block_type: Option<String> = None;
    let mut previous_block_type: Option<String> = None;
    // Track current code execution tool for matching results
    let mut _current_execution_tool_id: Option<String> = None;
    let mut current_execution_tool_name: Option<String> = None;
    // Accumulate input JSON for tool use blocks (code comes via input_json_delta)
    let mut pending_tool_input_json: String = String::new();

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
                                    match anthropic_parse_sse_event(data) {
                                        AnthropicStreamEvent::Done => {
                                            llm_logger::log_response_complete("chat", &full_response);
                                            if let Err(err) = window.emit("chat-stream-done", StreamEvent { turn_id: turn_id.clone() }) {
                                                eprintln!("Failed to emit chat-stream-done event: {}", err);
                                            }
                                            return Ok(());
                                        }
                                        AnthropicStreamEvent::MessageStart { container_id } => {
                                            // Emit container ID to frontend for sandbox persistence
                                            if let Some(id) = container_id {
                                                llm_logger::log_feature_used("chat", &format!("Container ID received: {}", id));
                                                if let Err(err) = window.emit("chat-container-id", ContainerIdEvent {
                                                    turn_id: turn_id.clone(),
                                                    container_id: id,
                                                }) {
                                                    eprintln!("Failed to emit chat-container-id event: {}", err);
                                                }
                                            }
                                        }
                                        AnthropicStreamEvent::ContentBlockStart { block_type, content_block } => {
                                            current_block_type = Some(block_type.clone());

                                            // Check for code execution tool use
                                            if is_code_execution_block(&block_type, &content_block) {
                                                // Just note the tool name - actual input comes via input_json_delta
                                                let id = content_block["id"].as_str().unwrap_or("").to_string();
                                                let name = content_block["name"].as_str().unwrap_or("").to_string();
                                                llm_logger::log_feature_used("chat", &format!("Code execution started: {}", name));
                                                _current_execution_tool_id = Some(id);
                                                current_execution_tool_name = Some(name);
                                                // Reset input JSON accumulator for this tool use
                                                pending_tool_input_json.clear();
                                            }
                                            // Check for code execution result
                                            else if is_code_execution_result(&block_type) {
                                                if let Some(result) = parse_code_execution_result(&block_type, &content_block) {
                                                    llm_logger::log_feature_used("chat", &format!("Code execution completed: {} files generated", result.files.len()));

                                                    // Determine status
                                                    let status = if let Some(ref error) = result.error {
                                                        ExecutionStatus::Failed { error: error.clone() }
                                                    } else if result.return_code.map(|c| c != 0).unwrap_or(false) {
                                                        ExecutionStatus::Failed {
                                                            error: format!("Exit code: {}", result.return_code.unwrap_or(-1))
                                                        }
                                                    } else {
                                                        ExecutionStatus::Completed
                                                    };

                                                    // Convert files to GeneratedFile, fetching metadata to get mime_type
                                                    let mut files: Vec<GeneratedFile> = Vec::new();
                                                    for f in result.files {
                                                        // Try to fetch metadata to get the correct mime_type and filename
                                                        let (final_filename, final_mime_type) = match fetch_file_metadata(&api_key, &f.file_id).await {
                                                            Ok(metadata) => {
                                                                // Use filename from metadata if it has an extension, otherwise construct it
                                                                let filename = if metadata.filename.contains('.') {
                                                                    metadata.filename
                                                                } else {
                                                                    // Add extension based on mime_type
                                                                    let ext = match metadata.mime_type.as_str() {
                                                                        "text/csv" => "csv",
                                                                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
                                                                        "application/vnd.ms-excel" => "xls",
                                                                        "application/pdf" => "pdf",
                                                                        "image/png" => "png",
                                                                        "image/jpeg" => "jpg",
                                                                        "application/json" => "json",
                                                                        "text/plain" => "txt",
                                                                        "text/html" => "html",
                                                                        "application/zip" => "zip",
                                                                        _ => metadata.mime_type.split('/').last().unwrap_or("bin"),
                                                                    };
                                                                    format!("{}.{}", metadata.filename, ext)
                                                                };
                                                                (filename, Some(metadata.mime_type))
                                                            }
                                                            Err(e) => {
                                                                eprintln!("Failed to fetch file metadata for {}: {}", f.file_id, e);
                                                                // Fall back to original values
                                                                (f.filename, f.mime_type)
                                                            }
                                                        };
                                                        files.push(GeneratedFile {
                                                            file_id: f.file_id,
                                                            filename: final_filename,
                                                            mime_type: final_mime_type,
                                                        });
                                                    }

                                                    // Emit execution completed delta
                                                    let delta = StreamDelta {
                                                        turn_id: turn_id.clone(),
                                                        text: String::new(),
                                                        citations: None,
                                                        inline_citations: None,
                                                        thinking: None,
                                                        execution: Some(ExecutionDelta {
                                                            tool_name: current_execution_tool_name.clone().unwrap_or_else(|| result.tool_name),
                                                            stdout: result.stdout,
                                                            stderr: result.stderr,
                                                            status,
                                                            code: None,
                                                            files: if files.is_empty() { None } else { Some(files) },
                                                        }),
                                                    };
                                                    if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                        eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                                    }

                                                    // Clear current execution tracking
                                                    _current_execution_tool_id = None;
                                                    current_execution_tool_name = None;
                                                }
                                            }
                                            else {
                                                match block_type.as_str() {
                                                    "thinking" => {
                                                        llm_logger::log_feature_used("chat", "Extended Thinking block started");
                                                    }
                                                    "server_tool_use" => {
                                                        llm_logger::log_feature_used("chat", "Web Search initiated (server_tool_use)");
                                                    }
                                                    "web_search_tool_result" => {
                                                        llm_logger::log_feature_used("chat", "Web Search results received");
                                                        // We no longer emit these as source citations - we only use inline citations
                                                    }
                                                    "text" => {
                                                        // Insert paragraph break if previous block was non-text
                                                        if let Some(prev) = &previous_block_type {
                                                            if matches!(prev.as_str(), "thinking" | "server_tool_use" | "web_search_tool_result"
                                                                | "bash_code_execution_tool_result" | "text_editor_code_execution_tool_result") {
                                                                full_response.push_str("\n\n");
                                                                let delta = StreamDelta {
                                                                    turn_id: turn_id.clone(),
                                                                    text: "\n\n".to_string(),
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
                                                        // Citations will arrive via citations_delta events during streaming
                                                        // and will be collected in pending_block_citations
                                                    }
                                                    _ => {}
                                                }
                                            }
                                        }
                                        AnthropicStreamEvent::ContentBlockDelta { text, thinking, citation, input_json } => {
                                            if let Some(t) = text {
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
                                            // Emit thinking deltas for ephemeral UI display
                                            if let Some(thinking_text) = thinking {
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
                                            // Emit citations immediately when they arrive
                                            // The frontend will snap to word boundaries
                                            if let Some(c) = citation {
                                                let inline_citation = InlineCitation {
                                                    url: c.url,
                                                    title: c.title,
                                                    cited_text: c.cited_text,
                                                    char_offset: full_response.len(),
                                                };
                                                let delta = StreamDelta {
                                                    turn_id: turn_id.clone(),
                                                    text: String::new(),
                                                    citations: None,
                                                    inline_citations: Some(vec![inline_citation]),
                                                    thinking: None,
                                                    execution: None,
                                                };
                                                if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                    eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                                }
                                            }
                                            // Accumulate input_json for tool use blocks
                                            if let Some(json_chunk) = input_json {
                                                pending_tool_input_json.push_str(&json_chunk);
                                            }
                                        }
                                        AnthropicStreamEvent::ContentBlockStop => {
                                            // If we just finished a code execution tool use block, emit the execution started event
                                            if let Some(ref block_type) = current_block_type {
                                                if block_type == "server_tool_use" && current_execution_tool_name.is_some() && !pending_tool_input_json.is_empty() {
                                                    // Parse the accumulated input JSON
                                                    if let Ok(input_obj) = serde_json::from_str::<serde_json::Value>(&pending_tool_input_json) {
                                                        let tool_name = current_execution_tool_name.as_ref().unwrap();
                                                        let code = match tool_name.as_str() {
                                                            "bash_code_execution" => {
                                                                input_obj["command"].as_str().map(|s| s.to_string())
                                                            }
                                                            "text_editor_code_execution" => {
                                                                let command = input_obj["command"].as_str().unwrap_or("");
                                                                let path = input_obj["path"].as_str().unwrap_or("");
                                                                let file_text = input_obj["file_text"].as_str();
                                                                if let Some(content) = file_text {
                                                                    Some(format!("# {} {}\n{}", command, path, content))
                                                                } else {
                                                                    Some(format!("# {} {}", command, path))
                                                                }
                                                            }
                                                            _ => None,
                                                        };

                                                        // Emit execution started delta with actual code
                                                        let delta = StreamDelta {
                                                            turn_id: turn_id.clone(),
                                                            text: String::new(),
                                                            citations: None,
                                                            inline_citations: None,
                                                            thinking: None,
                                                            execution: Some(ExecutionDelta {
                                                                tool_name: tool_name.clone(),
                                                                stdout: None,
                                                                stderr: None,
                                                                status: ExecutionStatus::Started,
                                                                code,
                                                                files: None,
                                                            }),
                                                        };
                                                        if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                            eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                                        }
                                                    }
                                                    // Clear the accumulated JSON
                                                    pending_tool_input_json.clear();
                                                }
                                            }
                                            previous_block_type = current_block_type.take();
                                        }
                                        AnthropicStreamEvent::MessageDelta { container_id } => {
                                            // Container ID arrives in message_delta for streaming responses
                                            if let Some(id) = container_id {
                                                llm_logger::log_feature_used("chat", &format!("Container ID received: {}", id));
                                                if let Err(err) = window.emit("chat-container-id", ContainerIdEvent {
                                                    turn_id: turn_id.clone(),
                                                    container_id: id,
                                                }) {
                                                    eprintln!("Failed to emit chat-container-id event: {}", err);
                                                }
                                            }
                                        }
                                        AnthropicStreamEvent::MessageStop => {
                                            llm_logger::log_response_complete("chat", &full_response);
                                            if let Err(err) = window.emit("chat-stream-done", StreamEvent { turn_id: turn_id.clone() }) {
                                                eprintln!("Failed to emit chat-stream-done event: {}", err);
                                            }
                                            return Ok(());
                                        }
                                        AnthropicStreamEvent::Unknown => {}
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

/// Transform 'file' blocks to 'document' blocks for Anthropic API.
/// We send all files as document blocks and let the API return an error
/// if the file type isn't supported.
fn transform_file_blocks_for_anthropic(content: &serde_json::Value) -> serde_json::Value {
    // If content is a string, return as-is
    if content.is_string() {
        return content.clone();
    }

    // If content is an array, transform any 'file' blocks to 'document' blocks
    if let Some(arr) = content.as_array() {
        let transformed: Vec<serde_json::Value> = arr
            .iter()
            .map(|block| {
                if let Some(block_type) = block.get("type").and_then(|t| t.as_str()) {
                    if block_type == "file" {
                        // Convert 'file' to 'document' block
                        let source = &block["source"];
                        return serde_json::json!({
                            "type": "document",
                            "source": source.clone()
                        });
                    }
                }
                block.clone()
            })
            .collect();
        return serde_json::json!(transformed);
    }

    // Fallback: return as-is
    content.clone()
}
