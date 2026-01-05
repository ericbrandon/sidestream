//! LLM orchestration module
//!
//! This module handles routing chat requests to the appropriate provider
//! (Anthropic, OpenAI, or Gemini) and manages stream state.
//!
//! Provider-specific implementations are in separate modules:
//! - `llm_anthropic` - Anthropic Claude API
//! - `llm_openai` - OpenAI Responses API
//! - `llm_gemini` - Google Gemini API
//! - `llm_voice` - Voice message handling (Gemini-based)

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::llm_anthropic::send_chat_message_anthropic;
use crate::llm_gemini::send_chat_message_gemini;
use crate::llm_openai::send_chat_message_openai;
use crate::llm_voice::{send_voice_message_impl, transcribe_audio_gemini_impl};
use crate::providers::anthropic::{Citation, InlineCitation};

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
    pub thinking: Option<String>,
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

    send_voice_message_impl(
        &app,
        &window,
        cancel_token,
        model,
        messages,
        audio_base64,
        system_prompt,
        web_search_enabled,
        gemini_thinking_level,
    )
    .await
}

/// Transcribe audio using Gemini (transcription only, no chat response)
#[tauri::command]
pub async fn transcribe_audio_gemini(
    app: tauri::AppHandle,
    audio_base64: String,
) -> Result<String, String> {
    transcribe_audio_gemini_impl(&app, audio_base64).await
}
