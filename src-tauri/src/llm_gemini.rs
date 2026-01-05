use futures::StreamExt;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

use crate::commands::get_api_key;
use crate::llm::{ChatMessage, StreamDelta};
use crate::llm_logger;
use crate::providers::anthropic::InlineCitation;
use crate::providers::gemini::{
    extract_inline_citations_from_grounding, parse_sse_event as gemini_parse_sse_event,
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
) -> Result<(), String> {
    let api_key = get_api_key(app, "google")?;
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

    loop {
        tokio::select! {
            // Check for cancellation
            _ = cancel_token.cancelled() => {
                window.emit("chat-stream-cancelled", ()).ok();
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
                                match gemini_parse_sse_event(data) {
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
                                                text: new_text,
                                                citations: None,
                                                inline_citations: None,
                                            };
                                            window.emit("chat-stream-delta", delta).ok();
                                        }
                                    }
                                    GeminiStreamEvent::ThinkingDelta => {
                                        // Thinking content discarded
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
                                                text: String::new(),
                                                citations: None,
                                                inline_citations: Some(inline_citations),
                                            };
                                            window.emit("chat-stream-delta", delta).ok();
                                        }
                                    }
                                    GeminiStreamEvent::ResponseComplete => {
                                        llm_logger::log_response_complete("chat", &full_response);
                                        window.emit("chat-stream-done", ()).ok();
                                        return Ok(());
                                    }
                                    GeminiStreamEvent::Error { message } => {
                                        llm_logger::log_error("chat", &message);
                                        return Err(message);
                                    }
                                    GeminiStreamEvent::Unknown => {}
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
    window.emit("chat-stream-done", ()).ok();
    Ok(())
}
