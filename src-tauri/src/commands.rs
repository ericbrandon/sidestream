use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

const STORE_PATH: &str = "settings.json";

/// Log frontend errors to stderr (visible in terminal where app runs)
#[tauri::command]
pub fn log_frontend_error(context: String, error: String) {
    eprintln!("[Frontend Error] {}: {}", context, error);
}

const SESSIONS_STORE_PATH: &str = "chat-sessions.json";

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiKeysConfig {
    pub anthropic: bool,
    pub openai: bool,
    pub google: bool,
}

fn get_key_name(provider: &str) -> Result<&'static str, String> {
    match provider {
        "anthropic" => Ok("anthropic_api_key"),
        "openai" => Ok("openai_api_key"),
        "google" => Ok("google_api_key"),
        _ => Err(format!("Invalid provider: {}", provider)),
    }
}

#[tauri::command]
pub async fn save_api_key(
    app: tauri::AppHandle,
    provider: String,
    key: String,
) -> Result<(), String> {
    let key_name = get_key_name(&provider)?;
    let store = app.store(STORE_PATH).map_err(|e| e.to_string())?;

    store.set(key_name, serde_json::json!(key));
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn has_api_key(app: tauri::AppHandle) -> Result<bool, String> {
    let config = get_configured_providers(app).await?;
    Ok(config.anthropic || config.openai || config.google)
}

#[tauri::command]
pub async fn delete_api_key(app: tauri::AppHandle, provider: String) -> Result<(), String> {
    let key_name = get_key_name(&provider)?;
    let store = app.store(STORE_PATH).map_err(|e| e.to_string())?;

    let _ = store.delete(key_name);
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_configured_providers(app: tauri::AppHandle) -> Result<ApiKeysConfig, String> {
    let store = app.store(STORE_PATH).map_err(|e| e.to_string())?;

    Ok(ApiKeysConfig {
        anthropic: store.get("anthropic_api_key").is_some(),
        openai: store.get("openai_api_key").is_some(),
        google: store.get("google_api_key").is_some(),
    })
}

pub fn get_api_key(app: &tauri::AppHandle, provider: &str) -> Result<String, String> {
    let key_name = get_key_name(provider)?;
    let store = app.store(STORE_PATH).map_err(|e| e.to_string())?;

    store
        .get(key_name)
        .and_then(|v| v.as_str().map(String::from))
        .ok_or_else(|| format!("{} API key not found", provider))
}

// Chat session persistence commands

#[tauri::command]
pub async fn save_chat_session(
    app: tauri::AppHandle,
    session: serde_json::Value,
) -> Result<(), String> {
    let store = app
        .store(SESSIONS_STORE_PATH)
        .map_err(|e| e.to_string())?;

    let session_id = session
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Session must have an id")?
        .to_string();

    store.set(&session_id, session);
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn load_chat_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let store = app
        .store(SESSIONS_STORE_PATH)
        .map_err(|e| e.to_string())?;

    Ok(store.get(&session_id))
}

#[tauri::command]
pub async fn list_chat_sessions(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let store = app
        .store(SESSIONS_STORE_PATH)
        .map_err(|e| e.to_string())?;

    let entries: Vec<serde_json::Value> = store
        .entries()
        .into_iter()
        .map(|(_, v)| v)
        .collect();

    Ok(entries)
}

#[tauri::command]
pub async fn delete_chat_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    let store = app
        .store(SESSIONS_STORE_PATH)
        .map_err(|e| e.to_string())?;

    let _ = store.delete(&session_id);
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn clear_chat_sessions_store(app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store(SESSIONS_STORE_PATH)
        .map_err(|e| e.to_string())?;

    store.clear();
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn export_chat_to_html(
    app: tauri::AppHandle,
    html_content: String,
) -> Result<String, String> {
    // Get the app's data directory for temp files
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    // Create exports directory if it doesn't exist
    let exports_dir = app_data_dir.join("exports");
    fs::create_dir_all(&exports_dir).map_err(|e| e.to_string())?;

    // Generate filename with timestamp
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let filename = format!("chat-export-{}.html", timestamp);
    let file_path: PathBuf = exports_dir.join(&filename);

    // Write the HTML file
    fs::write(&file_path, &html_content).map_err(|e| e.to_string())?;

    let result = file_path.to_string_lossy().to_string();

    // Open the file in the default browser
    let _ = std::process::Command::new("open")
        .arg(&file_path)
        .spawn();

    Ok(result)
}

#[tauri::command]
pub async fn print_webview(webview: tauri::Webview) -> Result<(), String> {
    webview.print().map_err(|e: tauri::Error| e.to_string())?;
    Ok(())
}

/// Internal function to transcribe audio bytes - used by both base64 and native audio capture
pub async fn transcribe_audio_bytes(
    app: &tauri::AppHandle,
    audio_bytes: Vec<u8>,
    filename: &str,
    mime_type: &str,
) -> Result<String, String> {
    let api_key = get_api_key(app, "openai")?;

    // Create multipart form with audio file
    let audio_part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name(filename.to_string())
        .mime_str(mime_type)
        .map_err(|e| format!("Failed to create audio part: {}", e))?;

    let form = reqwest::multipart::Form::new()
        .text("model", "gpt-4o-mini-transcribe")
        .text("response_format", "text")
        .part("file", audio_part);

    // Send request to OpenAI Whisper API
    let client = reqwest::Client::new();
    let response = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Transcription request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Transcription API error: {}", error_text));
    }

    // Response is plain text when response_format is "text"
    let transcript = response.text().await
        .map_err(|e| format!("Failed to read transcript: {}", e))?;

    Ok(transcript.trim().to_string())
}

