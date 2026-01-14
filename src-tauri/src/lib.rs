mod audio;
mod commands;
mod discovery;
mod llm;
mod llm_anthropic;
mod llm_gemini;
mod llm_logger;
mod llm_openai;
mod llm_voice;
mod mime_utils;
mod providers;
mod secure_storage;

use std::sync::Arc;

use audio::{
    cancel_audio_recording, get_audio_devices, get_recording_state, start_audio_recording,
    stop_audio_recording, stop_audio_recording_raw, AudioState,
};
use commands::{
    clear_chat_sessions_store, delete_api_key, delete_chat_session, download_anthropic_file,
    download_openai_file, download_openai_file_by_name, export_chat_to_html, get_configured_providers, has_api_key,
    list_chat_sessions, load_chat_session, log_debug, log_frontend_debug, log_frontend_error,
    print_webview, save_api_key, save_chat_session,
};
use discovery::discover_resources;
use llm::{cancel_chat_stream, send_chat_message, send_voice_message, transcribe_audio_gemini, StreamState};
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(StreamState {
            cancel_token: Arc::new(Mutex::new(None)),
        })
        .manage(AudioState::new())
        .setup(|app| {
            // Set up the application menu with About metadata
            // Only set short_version to avoid duplicate "(version)" display on macOS
            let about_metadata = AboutMetadata {
                short_version: Some("1.2.1".to_string()),
                version: Some(String::new()), // Empty to suppress the (x.x.x) suffix
                copyright: Some("© 2026 Eric Brandon".to_string()),
                ..Default::default()
            };

            // Create custom quit item with cross-platform accelerator
            let quit_item = MenuItemBuilder::new("Quit Sidestream")
                .id("quit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;

            // Create close window item with cross-platform accelerator
            let close_item = MenuItemBuilder::new("Close Window")
                .id("close")
                .accelerator("CmdOrCtrl+W")
                .build(app)?;

            let app_submenu = SubmenuBuilder::new(app, "Sidestream")
                .item(&PredefinedMenuItem::about(app, Some("About Sidestream"), Some(about_metadata))?)
                .separator()
                .item(&PredefinedMenuItem::hide(app, Some("Hide Sidestream"))?)
                .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
                .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
                .separator()
                .item(&close_item)
                .item(&quit_item)
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .item(&PredefinedMenuItem::undo(app, Some("Undo"))?)
                .item(&PredefinedMenuItem::redo(app, Some("Redo"))?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, Some("Cut"))?)
                .item(&PredefinedMenuItem::copy(app, Some("Copy"))?)
                .item(&PredefinedMenuItem::paste(app, Some("Paste"))?)
                .item(&PredefinedMenuItem::select_all(app, Some("Select All"))?)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .build()?;

            app.set_menu(menu)?;

            // Handle custom menu events
            app.on_menu_event(move |app_handle, event| {
                match event.id().as_ref() {
                    "quit" | "close" => {
                        app_handle.exit(0);
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_api_key,
            has_api_key,
            delete_api_key,
            get_configured_providers,
            send_chat_message,
            send_voice_message,
            cancel_chat_stream,
            discover_resources,
            save_chat_session,
            load_chat_session,
            list_chat_sessions,
            delete_chat_session,
            clear_chat_sessions_store,
            export_chat_to_html,
            print_webview,
            log_frontend_error,
            log_frontend_debug,
            log_debug,
            // Native audio capture commands
            start_audio_recording,
            stop_audio_recording,
            stop_audio_recording_raw,
            cancel_audio_recording,
            get_audio_devices,
            get_recording_state,
            transcribe_audio_gemini,
            // File download commands
            download_anthropic_file,
            download_openai_file,
            download_openai_file_by_name,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
