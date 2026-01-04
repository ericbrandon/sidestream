use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::commands::get_api_key;
use crate::llm_logger;
use crate::providers::anthropic::{
    parse_sse_event as anthropic_parse_sse_event, AnthropicClient, AnthropicStreamEvent,
    DiscoveryRequestConfig as AnthropicDiscoveryRequestConfig,
};
use crate::providers::openai::{
    parse_sse_event as openai_parse_sse_event, OpenAIClient, OpenAIStreamEvent,
    DiscoveryRequestConfig as OpenAIDiscoveryRequestConfig,
};
use crate::providers::gemini::{
    parse_sse_event as gemini_parse_sse_event, string_to_thinking_config,
    DiscoveryRequestConfig as GeminiDiscoveryRequestConfig, GeminiClient, GeminiStreamEvent,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryItem {
    pub title: String,
    pub one_liner: String,
    pub full_summary: String,
    pub relevance_explanation: String,
    pub source_url: String,
    pub source_domain: String,
    pub category: String,
    pub relevance_score: u32,
}

/// Payload for discovery-item event
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryItemEvent {
    pub turn_id: String,
    pub item: DiscoveryItem,
}

/// Payload for discovery-done event
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryDoneEvent {
    pub turn_id: String,
}

/// Payload for discovery-error event
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryErrorEvent {
    pub turn_id: String,
    pub error: String,
}

/// State for incremental JSON parsing
struct JsonParseState {
    found_items_key: bool,
    in_items_array: bool,
    brace_depth: i32,
    bracket_depth: i32,
    current_item: String,
    in_string: bool,
    escape_next: bool,
    recent_chars: String,
}

impl JsonParseState {
    fn new() -> Self {
        Self {
            found_items_key: false,
            in_items_array: false,
            brace_depth: 0,
            bracket_depth: 0,
            current_item: String::new(),
            in_string: false,
            escape_next: false,
            recent_chars: String::new(),
        }
    }
}

/// Extract complete JSON objects from a buffer as they become available
fn extract_items_from_buffer(buffer: &str, state: &mut JsonParseState) -> Vec<DiscoveryItem> {
    let mut items = Vec::new();

    for c in buffer.chars() {
        // Track recent characters to detect "items" key
        if !state.found_items_key {
            state.recent_chars.push(c);
            if state.recent_chars.len() > 20 {
                state.recent_chars.remove(0);
            }
            if state.recent_chars.contains("\"items\"")
                && (state.recent_chars.ends_with('[')
                    || state.recent_chars.ends_with(": [")
                    || state.recent_chars.ends_with(":["))
            {
                state.found_items_key = true;
                state.in_items_array = true;
                continue;
            }
        }

        if !state.in_items_array {
            continue;
        }

        // Handle string escaping
        if state.escape_next {
            state.escape_next = false;
            if state.brace_depth > 0 {
                state.current_item.push(c);
            }
            continue;
        }

        if c == '\\' && state.in_string {
            state.escape_next = true;
            if state.brace_depth > 0 {
                state.current_item.push(c);
            }
            continue;
        }

        // Toggle string mode on unescaped quotes
        if c == '"' {
            state.in_string = !state.in_string;
            if state.brace_depth > 0 {
                state.current_item.push(c);
            }
            continue;
        }

        // Skip processing special chars inside strings
        if state.in_string {
            if state.brace_depth > 0 {
                state.current_item.push(c);
            }
            continue;
        }

        // Outside of strings, look for structural characters
        match c {
            '{' => {
                state.brace_depth += 1;
                state.current_item.push(c);
            }
            '}' => {
                state.current_item.push(c);
                state.brace_depth -= 1;

                if state.brace_depth == 0 && !state.current_item.is_empty() {
                    let trimmed = state.current_item.trim();
                    if let Ok(item) = serde_json::from_str::<DiscoveryItem>(trimmed) {
                        items.push(item);
                    }
                    state.current_item.clear();
                }
            }
            '[' => {
                if state.brace_depth > 0 {
                    state.current_item.push(c);
                    state.bracket_depth += 1;
                }
            }
            ']' => {
                if state.brace_depth > 0 {
                    state.current_item.push(c);
                    state.bracket_depth -= 1;
                } else {
                    state.in_items_array = false;
                }
            }
            _ => {
                if state.brace_depth > 0 {
                    state.current_item.push(c);
                }
            }
        }
    }

    items
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
pub async fn discover_resources(
    app: tauri::AppHandle,
    window: tauri::Window,
    turn_id: String,
    model: String,
    conversation: String,
    system_prompt: String,
    _max_results: u32,
    // Provider-specific thinking parameters
    extended_thinking_enabled: Option<bool>,
    thinking_budget: Option<u32>,
    reasoning_level: Option<String>,
    gemini_thinking_level: Option<String>,
) -> Result<(), String> {
    // Route to the appropriate provider based on model
    let provider = get_provider_for_model(&model);

    match provider {
        "openai" => {
            discover_resources_openai(&app, &window, turn_id, model, conversation, system_prompt, reasoning_level)
                .await
        }
        "google" => {
            discover_resources_gemini(&app, &window, turn_id, model, conversation, system_prompt, gemini_thinking_level)
                .await
        }
        "anthropic" | _ => {
            discover_resources_anthropic(&app, &window, turn_id, model, conversation, system_prompt, extended_thinking_enabled, thinking_budget)
                .await
        }
    }
}

/// Discovery using Anthropic API
async fn discover_resources_anthropic(
    app: &tauri::AppHandle,
    window: &tauri::Window,
    turn_id: String,
    model: String,
    conversation: String,
    system_prompt: String,
    extended_thinking_enabled: Option<bool>,
    thinking_budget: Option<u32>,
) -> Result<(), String> {
    let api_key = get_api_key(app, "anthropic")?;
    let client = AnthropicClient::new(api_key);

    // Build request using provider
    let config = AnthropicDiscoveryRequestConfig {
        model: model.clone(),
        system_prompt,
        conversation,
        extended_thinking_enabled,
        thinking_budget,
    };
    let body = client.build_discovery_request(&config);

    llm_logger::log_request("discovery", &model, &body);

    let response = client.send_streaming_request(&body).await.map_err(|e| {
        llm_logger::log_error("discovery", &e);
        window
            .emit(
                "discovery-error",
                DiscoveryErrorEvent {
                    turn_id: turn_id.clone(),
                    error: e.clone(),
                },
            )
            .ok();
        e
    })?;

    // Stream the response
    let mut stream = response.bytes_stream();
    let mut sse_buffer = String::new();
    let mut full_response = String::new();
    let mut parse_state = JsonParseState::new();

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                let error_msg = e.to_string();
                llm_logger::log_error("discovery", &error_msg);
                window
                    .emit(
                        "discovery-error",
                        DiscoveryErrorEvent {
                            turn_id: turn_id.clone(),
                            error: error_msg,
                        },
                    )
                    .ok();
                break;
            }
        };

        let text = String::from_utf8_lossy(&chunk);
        sse_buffer.push_str(&text);

        // Parse SSE events
        while let Some(event_end) = sse_buffer.find("\n\n") {
            let event = sse_buffer[..event_end].to_string();
            sse_buffer = sse_buffer[event_end + 2..].to_string();

            for line in event.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    match anthropic_parse_sse_event(data) {
                        AnthropicStreamEvent::Done | AnthropicStreamEvent::MessageStop => {
                            llm_logger::log_response_complete("discovery", &full_response);
                            window
                                .emit(
                                    "discovery-done",
                                    DiscoveryDoneEvent {
                                        turn_id: turn_id.clone(),
                                    },
                                )
                                .ok();
                            return Ok(());
                        }
                        AnthropicStreamEvent::ContentBlockDelta { text, thinking: _, citation: _ } => {
                            if let Some(delta_text) = text {
                                full_response.push_str(&delta_text);

                                // Extract complete items from the delta
                                let items =
                                    extract_items_from_buffer(&delta_text, &mut parse_state);

                                for item in items {
                                    window
                                        .emit(
                                            "discovery-item",
                                            DiscoveryItemEvent {
                                                turn_id: turn_id.clone(),
                                                item,
                                            },
                                        )
                                        .ok();
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    llm_logger::log_response_complete("discovery", &full_response);
    window
        .emit(
            "discovery-done",
            DiscoveryDoneEvent {
                turn_id: turn_id.clone(),
            },
        )
        .ok();
    Ok(())
}

/// Discovery using OpenAI Responses API
async fn discover_resources_openai(
    app: &tauri::AppHandle,
    window: &tauri::Window,
    turn_id: String,
    model: String,
    conversation: String,
    system_prompt: String,
    reasoning_level: Option<String>,
) -> Result<(), String> {
    let api_key = get_api_key(app, "openai")?;
    let client = OpenAIClient::new(api_key);

    // Build request using provider
    let config = OpenAIDiscoveryRequestConfig {
        model: model.clone(),
        system_prompt,
        conversation,
        prompt_cache_key: Some("discovery".to_string()),
        reasoning_level,
    };
    let body = client.build_discovery_request(&config);

    llm_logger::log_request("discovery", &model, &body);

    let response = client.send_streaming_request(&body).await.map_err(|e| {
        llm_logger::log_error("discovery", &e);
        window
            .emit(
                "discovery-error",
                DiscoveryErrorEvent {
                    turn_id: turn_id.clone(),
                    error: e.clone(),
                },
            )
            .ok();
        e
    })?;

    // Stream the response
    let mut stream = response.bytes_stream();
    let mut sse_buffer = String::new();
    let mut full_response = String::new();
    let mut parse_state = JsonParseState::new();

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                let error_msg = e.to_string();
                llm_logger::log_error("discovery", &error_msg);
                window
                    .emit(
                        "discovery-error",
                        DiscoveryErrorEvent {
                            turn_id: turn_id.clone(),
                            error: error_msg,
                        },
                    )
                    .ok();
                break;
            }
        };

        let text = String::from_utf8_lossy(&chunk);
        sse_buffer.push_str(&text);

        // Parse SSE events
        while let Some(event_end) = sse_buffer.find("\n\n") {
            let event = sse_buffer[..event_end].to_string();
            sse_buffer = sse_buffer[event_end + 2..].to_string();

            for line in event.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    match openai_parse_sse_event(data) {
                        OpenAIStreamEvent::Done | OpenAIStreamEvent::ResponseCompleted => {
                            llm_logger::log_response_complete("discovery", &full_response);
                            window
                                .emit(
                                    "discovery-done",
                                    DiscoveryDoneEvent {
                                        turn_id: turn_id.clone(),
                                    },
                                )
                                .ok();
                            return Ok(());
                        }
                        OpenAIStreamEvent::TextDelta { text: delta_text } => {
                            full_response.push_str(&delta_text);

                            // Extract complete items from the delta
                            let items = extract_items_from_buffer(&delta_text, &mut parse_state);

                            for item in items {
                                window
                                    .emit(
                                        "discovery-item",
                                        DiscoveryItemEvent {
                                            turn_id: turn_id.clone(),
                                            item,
                                        },
                                    )
                                    .ok();
                            }
                        }
                        OpenAIStreamEvent::Error { message } => {
                            llm_logger::log_error("discovery", &message);
                            window
                                .emit(
                                    "discovery-error",
                                    DiscoveryErrorEvent {
                                        turn_id: turn_id.clone(),
                                        error: message.clone(),
                                    },
                                )
                                .ok();
                            return Err(message);
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    llm_logger::log_response_complete("discovery", &full_response);
    window
        .emit(
            "discovery-done",
            DiscoveryDoneEvent {
                turn_id: turn_id.clone(),
            },
        )
        .ok();
    Ok(())
}

/// Discovery using Google Gemini API
async fn discover_resources_gemini(
    app: &tauri::AppHandle,
    window: &tauri::Window,
    turn_id: String,
    model: String,
    conversation: String,
    system_prompt: String,
    gemini_thinking_level: Option<String>,
) -> Result<(), String> {
    let api_key = get_api_key(app, "google")?;
    let client = GeminiClient::new(api_key);

    // Build request using provider - use provided thinking level or default to "low"
    let thinking_level = gemini_thinking_level.as_deref().unwrap_or("low");
    let thinking_config = string_to_thinking_config(thinking_level, &model);
    let config = GeminiDiscoveryRequestConfig {
        system_prompt,
        conversation,
        thinking_config,
    };
    let body = client.build_discovery_request(&config);

    llm_logger::log_request("discovery", &model, &body);

    let response = client
        .send_streaming_request(&model, &body)
        .await
        .map_err(|e| {
            llm_logger::log_error("discovery", &e);
            window
                .emit(
                    "discovery-error",
                    DiscoveryErrorEvent {
                        turn_id: turn_id.clone(),
                        error: e.clone(),
                    },
                )
                .ok();
            e
        })?;

    // Stream the response
    let mut stream = response.bytes_stream();
    let mut sse_buffer = String::new();
    let mut full_response = String::new();
    let mut parse_state = JsonParseState::new();
    let mut accumulated_text = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                let error_msg = e.to_string();
                llm_logger::log_error("discovery", &error_msg);
                window
                    .emit(
                        "discovery-error",
                        DiscoveryErrorEvent {
                            turn_id: turn_id.clone(),
                            error: error_msg,
                        },
                    )
                    .ok();
                break;
            }
        };

        let text = String::from_utf8_lossy(&chunk);
        sse_buffer.push_str(&text);

        // Parse SSE events - Gemini uses single newline delimiters, not double
        while let Some(line_end) = sse_buffer.find('\n') {
            let line = sse_buffer[..line_end].trim_end_matches('\r').to_string();
            sse_buffer = sse_buffer[line_end + 1..].to_string();

            if let Some(data) = line.strip_prefix("data: ") {
                match gemini_parse_sse_event(data) {
                    GeminiStreamEvent::ResponseComplete => {
                        llm_logger::log_response_complete("discovery", &full_response);
                        window
                            .emit(
                                "discovery-done",
                                DiscoveryDoneEvent {
                                    turn_id: turn_id.clone(),
                                },
                            )
                            .ok();
                        return Ok(());
                    }
                    GeminiStreamEvent::TextDelta { text: delta_text } => {
                        // Gemini sends complete text in each chunk, need to diff
                        let new_text = if delta_text.starts_with(&accumulated_text) {
                            delta_text[accumulated_text.len()..].to_string()
                        } else {
                            // Reset - new response
                            accumulated_text.clear();
                            delta_text.clone()
                        };
                        accumulated_text = delta_text;

                        if !new_text.is_empty() {
                            full_response.push_str(&new_text);

                            // Extract complete items from the delta
                            let items = extract_items_from_buffer(&new_text, &mut parse_state);

                            for item in items {
                                window
                                    .emit(
                                        "discovery-item",
                                        DiscoveryItemEvent {
                                            turn_id: turn_id.clone(),
                                            item,
                                        },
                                    )
                                    .ok();
                            }
                        }
                    }
                    GeminiStreamEvent::Error { message } => {
                        llm_logger::log_error("discovery", &message);
                        window
                            .emit(
                                "discovery-error",
                                DiscoveryErrorEvent {
                                    turn_id: turn_id.clone(),
                                    error: message.clone(),
                                },
                            )
                            .ok();
                        return Err(message);
                    }
                    _ => {}
                }
            }
        }
    }

    llm_logger::log_response_complete("discovery", &full_response);
    window
        .emit(
            "discovery-done",
            DiscoveryDoneEvent {
                turn_id: turn_id.clone(),
            },
        )
        .ok();
    Ok(())
}
