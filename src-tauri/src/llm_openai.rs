use futures::StreamExt;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

use crate::commands::get_api_key;
use crate::llm::{ChatMessage, StreamDelta};
use crate::llm_logger;
use crate::providers::anthropic::InlineCitation;
use crate::providers::openai::{
    parse_sse_event as openai_parse_sse_event, string_to_reasoning_effort, supports_reasoning,
    ChatRequestConfig as OpenAIChatRequestConfig, OpenAIClient, OpenAIStreamEvent,
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
    reasoning_level: Option<String>,
    session_id: Option<String>,
) -> Result<(), String> {
    let api_key = get_api_key(app, "openai")?;
    let client = OpenAIClient::new(api_key);

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

    // Build request using OpenAI provider
    // Let OpenAI use its model defaults for max output tokens
    let config = OpenAIChatRequestConfig {
        model: model.clone(),
        messages: api_messages,
        system_prompt,
        reasoning_effort,
        web_search_enabled,
        prompt_cache_key: session_id.map(|id| format!("chat-{}", id)),
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
                                    match openai_parse_sse_event(data) {
                                        OpenAIStreamEvent::Done | OpenAIStreamEvent::ResponseCompleted => {
                                            llm_logger::log_response_complete("chat", &full_response);
                                            if let Err(err) = window.emit("chat-stream-done", ()) {
                                                eprintln!("Failed to emit chat-stream-done event: {}", err);
                                            }
                                            return Ok(());
                                        }
                                        OpenAIStreamEvent::TextDelta { text: t } => {
                                            full_response.push_str(&t);
                                            let delta = StreamDelta {
                                                text: t,
                                                citations: None,
                                                inline_citations: None,
                                                thinking: None,
                                            };
                                            if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                            }
                                        }
                                        OpenAIStreamEvent::ReasoningSummary { text: thinking_text } => {
                                            // Emit reasoning summary as thinking delta for ephemeral UI
                                            let delta = StreamDelta {
                                                text: String::new(),
                                                citations: None,
                                                inline_citations: None,
                                                thinking: Some(thinking_text),
                                            };
                                            if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                            }
                                        }
                                        OpenAIStreamEvent::TextDone { text: _, annotations } => {
                                            // Convert OpenAI citations to common format
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
                                                    text: String::new(),
                                                    citations: None,
                                                    inline_citations: Some(inline_citations),
                                                    thinking: None,
                                                };
                                                if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                    eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                                }
                                            }
                                        }
                                        OpenAIStreamEvent::WebSearchStarted => {
                                            llm_logger::log_feature_used("chat", "OpenAI Web Search initiated");
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
    if let Err(err) = window.emit("chat-stream-done", ()) {
        eprintln!("Failed to emit chat-stream-done event: {}", err);
    }
    Ok(())
}
