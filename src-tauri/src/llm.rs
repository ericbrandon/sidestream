use std::sync::Arc;

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::commands::get_api_key;
use crate::llm_logger;
use crate::providers::anthropic::{
    add_cache_control_to_last_message, calculate_max_tokens as anthropic_calculate_max_tokens,
    parse_sse_event as anthropic_parse_sse_event, AnthropicClient, AnthropicStreamEvent,
    ChatRequestConfig as AnthropicChatRequestConfig, Citation, InlineCitation, ThinkingConfig,
};
use crate::providers::openai::{
    parse_sse_event as openai_parse_sse_event, string_to_reasoning_effort, supports_reasoning,
    ChatRequestConfig as OpenAIChatRequestConfig, OpenAIClient, OpenAIStreamEvent,
    ReasoningEffort,
};
use crate::providers::gemini::{
    extract_inline_citations_from_grounding, parse_sse_event as gemini_parse_sse_event,
    string_to_thinking_config, supports_thinking as gemini_supports_thinking,
    ChatRequestConfig as GeminiChatRequestConfig, GeminiClient, GeminiStreamEvent,
    VoiceChatRequestConfig as GeminiVoiceChatRequestConfig,
};

/// Shared state for managing stream cancellation
pub struct StreamState {
    pub cancel_token: Arc<Mutex<Option<CancellationToken>>>,
}


#[tauri::command]
pub async fn cancel_chat_stream(state: tauri::State<'_, StreamState>) -> Result<(), String> {
    let mut token_guard = state.cancel_token.lock().await;
    if let Some(token) = token_guard.take() {
        token.cancel();
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StreamDelta {
    pub text: String,
    pub citations: Option<Vec<Citation>>,
    pub inline_citations: Option<Vec<InlineCitation>>,
}

/// Determine which provider to use based on model name
fn get_provider_for_model(model: &str) -> &'static str {
    if model.starts_with("gpt") || model.starts_with("o3") || model.starts_with("o4") {
        "openai"
    } else if model.starts_with("gemini") {
        "google"
    } else {
        "anthropic" // Default for claude-* and unknown models
    }
}

#[tauri::command]
pub async fn send_chat_message(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, StreamState>,
    model: String,
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
    extended_thinking_enabled: bool,
    thinking_budget: Option<u32>,
    web_search_enabled: bool,
    reasoning_level: Option<String>,        // For OpenAI: "off", "low", "medium", "high"
    gemini_thinking_level: Option<String>,  // For Gemini: "off", "on", "low", "medium", "high"
    session_id: Option<String>,             // For OpenAI prompt caching
) -> Result<(), String> {
    // Create a cancellation token for this stream
    let cancel_token = CancellationToken::new();
    {
        let mut token_guard = state.cancel_token.lock().await;
        *token_guard = Some(cancel_token.clone());
    }

    // Route to the appropriate provider based on model
    let provider = get_provider_for_model(&model);

    match provider {
        "openai" => {
            send_chat_message_openai(
                &app,
                &window,
                cancel_token,
                model,
                messages,
                system_prompt,
                web_search_enabled,
                reasoning_level,
                session_id,
            )
            .await
        }
        "google" => {
            send_chat_message_gemini(
                &app,
                &window,
                cancel_token,
                model,
                messages,
                system_prompt,
                web_search_enabled,
                gemini_thinking_level,
            )
            .await
        }
        "anthropic" | _ => {
            send_chat_message_anthropic(
                &app,
                &window,
                cancel_token,
                model,
                messages,
                system_prompt,
                extended_thinking_enabled,
                thinking_budget,
                web_search_enabled,
            )
            .await
        }
    }
}

/// Send chat message using Anthropic API
async fn send_chat_message_anthropic(
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
    let mut api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
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
                window.emit("chat-stream-cancelled", ()).ok();
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
                                            window.emit("chat-stream-done", ()).ok();
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
                                                            window.emit("chat-stream-delta", delta).ok();
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
                                                window.emit("chat-stream-delta", delta).ok();
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
                                                window.emit("chat-stream-delta", delta).ok();
                                            }
                                            // Thinking deltas are logged but not displayed
                                        }
                                        AnthropicStreamEvent::ContentBlockStop => {
                                            previous_block_type = current_block_type.take();
                                        }
                                        AnthropicStreamEvent::MessageStop => {
                                            llm_logger::log_response_complete("chat", &full_response);
                                            window.emit("chat-stream-done", ()).ok();
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
    window.emit("chat-stream-done", ()).ok();
    Ok(())
}

/// Send chat message using OpenAI Responses API
async fn send_chat_message_openai(
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
                window.emit("chat-stream-cancelled", ()).ok();
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
                                            window.emit("chat-stream-done", ()).ok();
                                            return Ok(());
                                        }
                                        OpenAIStreamEvent::TextDelta { text: t } => {
                                            full_response.push_str(&t);
                                            let delta = StreamDelta {
                                                text: t,
                                                citations: None,
                                                inline_citations: None,
                                            };
                                            window.emit("chat-stream-delta", delta).ok();
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
                                                };
                                                window.emit("chat-stream-delta", delta).ok();
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
    window.emit("chat-stream-done", ()).ok();
    Ok(())
}

/// Send chat message using Google Gemini API
async fn send_chat_message_gemini(
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

/// Event emitted when transcription is extracted from a voice message response
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VoiceTranscriptionEvent {
    pub transcription: String,
}

/// Send a voice message with native audio to Gemini
/// The audio is sent as inlineData, and Gemini's response includes the transcription
/// wrapped in [TRANSCRIPTION][/TRANSCRIPTION] tags, followed by the actual response.
#[tauri::command]
pub async fn send_voice_message(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, StreamState>,
    model: String,
    messages: Vec<ChatMessage>,
    audio_base64: String,
    system_prompt: Option<String>,
    web_search_enabled: bool,
    gemini_thinking_level: Option<String>,
) -> Result<(), String> {
    // Create a cancellation token for this stream
    let cancel_token = CancellationToken::new();
    {
        let mut token_guard = state.cancel_token.lock().await;
        *token_guard = Some(cancel_token.clone());
    }

    let api_key = get_api_key(&app, "google")?;
    let client = GeminiClient::new(api_key);

    // Build messages for Gemini (previous conversation)
    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();

    // Determine thinking config
    let thinking_config = if gemini_supports_thinking(&model) {
        gemini_thinking_level
            .as_ref()
            .and_then(|level| string_to_thinking_config(level, &model))
    } else {
        None
    };

    // Build voice chat request with audio
    let config = GeminiVoiceChatRequestConfig {
        messages: api_messages,
        audio_base64,
        system_prompt,
        thinking_config,
        web_search_enabled,
    };
    let body = client.build_voice_chat_request(&config);

    llm_logger::log_request("voice-chat", &model, &body);

    let response = client
        .send_streaming_request(&model, &body)
        .await
        .map_err(|e| {
            llm_logger::log_error("voice-chat", &e);
            e
        })?;

    // Stream the response and extract transcription
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full_response = String::new();
    let mut accumulated_text = String::new();
    let mut transcription_emitted = false;

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                window.emit("chat-stream-cancelled", ()).ok();
                return Ok(());
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        let text = String::from_utf8_lossy(&bytes);
                        buffer.push_str(&text);

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
                                            accumulated_text.clear();
                                            t.clone()
                                        };
                                        accumulated_text = t;

                                        if !new_text.is_empty() {
                                            full_response.push_str(&new_text);

                                            // Check if we have a complete transcription to extract
                                            if !transcription_emitted {
                                                if let Some(transcription) = extract_transcription(&full_response) {
                                                    transcription_emitted = true;
                                                    window.emit("voice-transcription", VoiceTranscriptionEvent {
                                                        transcription: transcription.clone(),
                                                    }).ok();

                                                    // Remove transcription from the response we're streaming
                                                    // Find where the transcription block ends and get the rest
                                                    if let Some(end_idx) = full_response.find("[/TRANSCRIPTION]") {
                                                        let after_transcription = &full_response[end_idx + "[/TRANSCRIPTION]".len()..];
                                                        let clean_start = after_transcription.trim_start();
                                                        if !clean_start.is_empty() {
                                                            let delta = StreamDelta {
                                                                text: clean_start.to_string(),
                                                                citations: None,
                                                                inline_citations: None,
                                                            };
                                                            window.emit("chat-stream-delta", delta).ok();
                                                        }
                                                    }
                                                    continue;
                                                }
                                            }

                                            // Only emit deltas for content after transcription
                                            if transcription_emitted {
                                                let delta = StreamDelta {
                                                    text: new_text,
                                                    citations: None,
                                                    inline_citations: None,
                                                };
                                                window.emit("chat-stream-delta", delta).ok();
                                            }
                                        }
                                    }
                                    GeminiStreamEvent::ThinkingDelta => {}
                                    GeminiStreamEvent::GroundingMetadata { metadata } => {
                                        llm_logger::log_feature_used("voice-chat", "Gemini Google Search");
                                        let gemini_citations = extract_inline_citations_from_grounding(&metadata, &full_response);
                                        if !gemini_citations.is_empty() {
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
                                        llm_logger::log_response_complete("voice-chat", &full_response);
                                        window.emit("chat-stream-done", ()).ok();
                                        return Ok(());
                                    }
                                    GeminiStreamEvent::Error { message } => {
                                        llm_logger::log_error("voice-chat", &message);
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

    llm_logger::log_response_complete("voice-chat", &full_response);
    window.emit("chat-stream-done", ()).ok();
    Ok(())
}

/// Extract transcription from response text if complete
fn extract_transcription(text: &str) -> Option<String> {
    let start_tag = "[TRANSCRIPTION]";
    let end_tag = "[/TRANSCRIPTION]";

    let start_idx = text.find(start_tag)?;
    let end_idx = text.find(end_tag)?;

    if end_idx > start_idx {
        let transcription = &text[start_idx + start_tag.len()..end_idx];
        Some(transcription.trim().to_string())
    } else {
        None
    }
}

/// Transcribe audio using Gemini (transcription only, no chat response)
#[tauri::command]
pub async fn transcribe_audio_gemini(
    app: tauri::AppHandle,
    audio_base64: String,
) -> Result<String, String> {
    let api_key = get_api_key(&app, "google")?;
    let client = GeminiClient::new(api_key);

    // Use a fast model for transcription
    let model = "gemini-2.0-flash";

    // Build transcription-only request
    let body = client.build_transcription_request(&audio_base64);

    // Send non-streaming request and get transcription
    let transcription = client.send_request(model, &body).await?;

    Ok(transcription.trim().to_string())
}

