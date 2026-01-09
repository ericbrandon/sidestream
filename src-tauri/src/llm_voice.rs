use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

use crate::commands::get_api_key_async;
use crate::llm::{ChatMessage, StreamDelta, StreamEvent};
use crate::llm_logger;
use crate::providers::anthropic::InlineCitation;
use crate::providers::gemini::{
    extract_inline_citations_from_grounding, parse_sse_event as gemini_parse_sse_event,
    string_to_thinking_config, supports_thinking as gemini_supports_thinking,
    GeminiClient, GeminiStreamEvent, VoiceChatRequestConfig as GeminiVoiceChatRequestConfig,
};

/// Event emitted when transcription is extracted from a voice message response
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VoiceTranscriptionEvent {
    pub transcription: String,
}

/// Send a voice message with native audio to Gemini
/// The audio is sent as inlineData, and Gemini's response includes the transcription
/// wrapped in [TRANSCRIPTION][/TRANSCRIPTION] tags, followed by the actual response.
pub async fn send_voice_message_impl(
    app: &tauri::AppHandle,
    window: &tauri::Window,
    cancel_token: CancellationToken,
    model: String,
    messages: Vec<ChatMessage>,
    audio_base64: String,
    system_prompt: Option<String>,
    web_search_enabled: bool,
    gemini_thinking_level: Option<String>,
    turn_id: String,
) -> Result<(), String> {
    let api_key = get_api_key_async(app, "google").await?;
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
                window.emit("chat-stream-cancelled", StreamEvent { turn_id: turn_id.clone() }).ok();
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
                                                                turn_id: turn_id.clone(),
                                                                text: clean_start.to_string(),
                                                                citations: None,
                                                                inline_citations: None,
                                                                thinking: None,
                                                                execution: None,
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
                                                    turn_id: turn_id.clone(),
                                                    text: new_text,
                                                    citations: None,
                                                    inline_citations: None,
                                                    thinking: None,
                                                    execution: None,
                                                };
                                                window.emit("chat-stream-delta", delta).ok();
                                            }
                                        }
                                    }
                                    GeminiStreamEvent::ThinkingDelta { text: _ } => {
                                        // Voice messages don't display thinking UI
                                    }
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
                                                turn_id: turn_id.clone(),
                                                text: String::new(),
                                                citations: None,
                                                inline_citations: Some(inline_citations),
                                                thinking: None,
                                                execution: None,
                                            };
                                            window.emit("chat-stream-delta", delta).ok();
                                        }
                                    }
                                    GeminiStreamEvent::ResponseComplete => {
                                        llm_logger::log_response_complete("voice-chat", &full_response);
                                        window.emit("chat-stream-done", StreamEvent { turn_id: turn_id.clone() }).ok();
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
    window.emit("chat-stream-done", StreamEvent { turn_id }).ok();
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
pub async fn transcribe_audio_gemini_impl(
    app: &tauri::AppHandle,
    audio_base64: String,
) -> Result<String, String> {
    let api_key = get_api_key_async(app, "google").await?;
    let client = GeminiClient::new(api_key);

    // Use a fast model for transcription
    let model = "gemini-2.0-flash";

    // Build transcription-only request
    let body = client.build_transcription_request(&audio_base64);

    // Send non-streaming request and get transcription
    let transcription = client.send_request(model, &body).await?;

    Ok(transcription.trim().to_string())
}
