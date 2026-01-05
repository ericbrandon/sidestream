use futures::StreamExt;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

use crate::commands::get_api_key;
use crate::llm::{ChatMessage, StreamDelta};
use crate::llm_logger;
use crate::providers::anthropic::{
    add_cache_control_to_last_message, calculate_max_tokens as anthropic_calculate_max_tokens,
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
) -> Result<(), String> {
    let api_key = get_api_key(app, "anthropic")?;
    let client = AnthropicClient::new(api_key);

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
    let mut current_block_type: Option<String> = None;
    let mut previous_block_type: Option<String> = None;

    loop {
        tokio::select! {
            // Check for cancellation
            _ = cancel_token.cancelled() => {
                if let Err(err) = window.emit("chat-stream-cancelled", ()) {
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
                                            if let Err(err) = window.emit("chat-stream-done", ()) {
                                                eprintln!("Failed to emit chat-stream-done event: {}", err);
                                            }
                                            return Ok(());
                                        }
                                        AnthropicStreamEvent::ContentBlockStart { block_type, content_block: _ } => {
                                            current_block_type = Some(block_type.clone());

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
                                                        if matches!(prev.as_str(), "thinking" | "server_tool_use" | "web_search_tool_result") {
                                                            full_response.push_str("\n\n");
                                                            let delta = StreamDelta {
                                                                text: "\n\n".to_string(),
                                                                citations: None,
                                                                inline_citations: None,
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
                                        AnthropicStreamEvent::ContentBlockDelta { text, thinking: _, citation } => {
                                            if let Some(t) = text {
                                                full_response.push_str(&t);
                                                let delta = StreamDelta {
                                                    text: t,
                                                    citations: None,
                                                    inline_citations: None,
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
                                                    text: String::new(),
                                                    citations: None,
                                                    inline_citations: Some(vec![inline_citation]),
                                                };
                                                if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                    eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                                }
                                            }
                                            // Thinking deltas are logged but not displayed
                                        }
                                        AnthropicStreamEvent::ContentBlockStop => {
                                            previous_block_type = current_block_type.take();
                                        }
                                        AnthropicStreamEvent::MessageStop => {
                                            llm_logger::log_response_complete("chat", &full_response);
                                            if let Err(err) = window.emit("chat-stream-done", ()) {
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
    if let Err(err) = window.emit("chat-stream-done", ()) {
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
