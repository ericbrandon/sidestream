use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

use crate::secure_storage;

/// Log frontend errors to stderr (visible in terminal where app runs)
#[tauri::command]
pub fn log_frontend_error(context: String, error: String) {
    eprintln!("[Frontend Error] {}: {}", context, error);
}

/// Log frontend debug messages to stderr (visible in terminal where app runs)
#[tauri::command]
pub fn log_frontend_debug(context: String, message: String) {
    eprintln!("[Frontend Debug] {}: {}", context, message);
}

/// Log debug info to a file for debugging packaged apps
#[tauri::command]
pub fn log_debug(app: tauri::AppHandle, context: String, message: String) {
    use std::io::Write;
    use std::fs::OpenOptions;

    // Get app data directory and create logs folder
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let logs_dir = app_data_dir.join("logs");
        let _ = fs::create_dir_all(&logs_dir);

        let log_file = logs_dir.join("debug.log");
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file)
        {
            let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
            let _ = writeln!(file, "[{}] [{}] {}", timestamp, context, message);
        }
    }
}

const SESSIONS_STORE_PATH: &str = "chat-sessions.json";

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiKeysConfig {
    pub anthropic: bool,
    pub openai: bool,
    pub google: bool,
}

fn validate_provider(provider: &str) -> Result<(), String> {
    match provider {
        "anthropic" | "openai" | "google" => Ok(()),
        _ => Err(format!("Invalid provider: {}", provider)),
    }
}

#[tauri::command]
pub async fn save_api_key(
    app: tauri::AppHandle,
    provider: String,
    key: String,
) -> Result<(), String> {
    validate_provider(&provider)?;
    secure_storage::save_api_key_secure(&app, &provider, &key).await
}

#[tauri::command]
pub async fn has_api_key(app: tauri::AppHandle) -> Result<bool, String> {
    let config = get_configured_providers(app).await?;
    Ok(config.anthropic || config.openai || config.google)
}

#[tauri::command]
pub async fn delete_api_key(app: tauri::AppHandle, provider: String) -> Result<(), String> {
    validate_provider(&provider)?;
    secure_storage::delete_api_key_secure(&app, &provider).await
}

#[tauri::command]
pub async fn get_configured_providers(app: tauri::AppHandle) -> Result<ApiKeysConfig, String> {
    Ok(ApiKeysConfig {
        anthropic: secure_storage::has_api_key_secure(&app, "anthropic").await,
        openai: secure_storage::has_api_key_secure(&app, "openai").await,
        google: secure_storage::has_api_key_secure(&app, "google").await,
    })
}

/// Get an API key from secure storage (used internally by LLM modules)
pub async fn get_api_key_async(app: &tauri::AppHandle, provider: &str) -> Result<String, String> {
    secure_storage::get_api_key_secure(app, provider).await
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
    let api_key = secure_storage::get_api_key_secure(app, "openai").await?;

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

/// Response from downloading a file from Anthropic's Files API
#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadedFile {
    pub data: Vec<u8>,
    pub filename: String,
    pub mime_type: Option<String>,
}

/// Download a file from Anthropic's Files API
#[tauri::command]
pub async fn download_anthropic_file(
    app: tauri::AppHandle,
    file_id: String,
    filename: String,
) -> Result<DownloadedFile, String> {
    let api_key = get_api_key_async(&app, "anthropic").await?;

    let client = reqwest::Client::new();
    let url = format!("https://api.anthropic.com/v1/files/{}/content", file_id);

    let response = client
        .get(&url)
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", "files-api-2025-04-14")
        .send()
        .await
        .map_err(|e| format!("File download request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("File download API error: {}", error_text));
    }

    // Get content-type header for mime type
    let mime_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Fix filename extension based on mime type if missing
    let final_filename = fix_filename_extension(&filename, mime_type.as_deref());

    let data = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read file content: {}", e))?
        .to_vec();

    Ok(DownloadedFile {
        data,
        filename: final_filename,
        mime_type,
    })
}

/// Download a file from OpenAI's Containers API (for code interpreter files)
#[tauri::command]
pub async fn download_openai_file(
    app: tauri::AppHandle,
    container_id: String,
    file_id: String,
    filename: String,
) -> Result<DownloadedFile, String> {
    let api_key = get_api_key_async(&app, "openai").await?;

    let client = reqwest::Client::new();
    let url = format!(
        "https://api.openai.com/v1/containers/{}/files/{}/content",
        container_id, file_id
    );

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("File download request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("File download API error: {}", error_text));
    }

    // Get content-type header for mime type
    let mime_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Fix filename extension based on mime type if missing
    let final_filename = fix_filename_extension(&filename, mime_type.as_deref());

    let data = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read file content: {}", e))?
        .to_vec();

    Ok(DownloadedFile {
        data,
        filename: final_filename,
        mime_type,
    })
}

/// Download a file from OpenAI container by filename (resolves file_id via container file listing)
/// This is needed for sandbox: URLs where we only have the filename, not the file_id
#[tauri::command]
pub async fn download_openai_file_by_name(
    app: tauri::AppHandle,
    container_id: String,
    filename: String,
) -> Result<DownloadedFile, String> {
    let api_key = get_api_key_async(&app, "openai").await?;
    let client = reqwest::Client::new();

    // First, list files in the container to find the file_id
    let list_url = format!(
        "https://api.openai.com/v1/containers/{}/files",
        container_id
    );

    let list_response = client
        .get(&list_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Container file listing request failed: {}", e))?;

    if !list_response.status().is_success() {
        let error_text = list_response.text().await.unwrap_or_default();
        return Err(format!("Container file listing API error: {}", error_text));
    }

    let list_body: serde_json::Value = list_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse file listing: {}", e))?;

    // Debug: log the container file listing response
    eprintln!("[OpenAI Container Files] Looking for '{}' in container '{}'", filename, container_id);
    eprintln!("[OpenAI Container Files] Response: {}", serde_json::to_string_pretty(&list_body).unwrap_or_default());

    // Find the file by path
    // Response format: { "data": [{ "id": "...", "path": "/mnt/data/filename.ext", ... }] }
    let file_id = list_body["data"]
        .as_array()
        .and_then(|files| {
            files.iter().find_map(|f| {
                let path = f["path"].as_str().unwrap_or("");
                eprintln!("[OpenAI Container Files] Checking file path: '{}' vs '{}'", path, filename);
                // Match by path ending with the filename
                if path.ends_with(&format!("/{}", filename)) || path == format!("/mnt/data/{}", filename) {
                    f["id"].as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
        })
        .ok_or_else(|| format!("File '{}' not found in container", filename))?;

    // Now download using the resolved file_id
    download_openai_file(app, container_id, file_id, filename).await
}

/// Add or fix file extension based on mime type
fn fix_filename_extension(filename: &str, mime_type: Option<&str>) -> String {
    // If filename already has a recognized extension, keep it
    if let Some(ext) = filename.rsplit('.').next() {
        let known_extensions = ["csv", "xlsx", "xls", "pdf", "png", "jpg", "jpeg", "json", "txt", "html", "zip", "xml"];
        if known_extensions.contains(&ext.to_lowercase().as_str()) {
            return filename.to_string();
        }
    }

    // Map mime type to extension
    let extension = mime_type.and_then(|mt| {
        // Handle mime types with parameters (e.g., "text/csv; charset=utf-8")
        let mt = mt.split(';').next().unwrap_or(mt).trim();
        match mt {
            "text/csv" => Some("csv"),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Some("xlsx"),
            "application/vnd.ms-excel" => Some("xls"),
            "application/pdf" => Some("pdf"),
            "image/png" => Some("png"),
            "image/jpeg" => Some("jpg"),
            "application/json" => Some("json"),
            "text/plain" => Some("txt"),
            "text/html" => Some("html"),
            "application/zip" => Some("zip"),
            "application/xml" | "text/xml" => Some("xml"),
            _ => None
        }
    });

    if let Some(ext) = extension {
        // Remove any existing extension-like suffix and add the correct one
        let base = if filename.contains('.') {
            filename.rsplit_once('.').map(|(base, _)| base).unwrap_or(filename)
        } else {
            filename
        };
        format!("{}.{}", base, ext)
    } else {
        filename.to_string()
    }
}

