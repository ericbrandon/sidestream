use futures::StreamExt;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

use std::time::{SystemTime, UNIX_EPOCH};

use crate::commands::get_api_key_async;
use crate::llm::{tool_names, ChatMessage, ExecutionDelta, ExecutionStatus, GeneratedFile, StreamDelta, StreamEvent};
use crate::llm_logger;
use crate::providers::anthropic::InlineCitation;
use crate::providers::gemini::{
    extract_inline_citations_from_grounding, extract_referenced_filenames, extract_saved_filenames,
    mime_to_extension, parse_sse_event as gemini_parse_sse_event, pick_filename_index_for_mime,
    string_to_thinking_config, supports_thinking as gemini_supports_thinking,
    ChatRequestConfig as GeminiChatRequestConfig, GeminiClient, GeminiStreamEvent,
};

/// Select and emit only the file(s) the model actually presents to the user.
///
/// Gemini streams every intermediate plot/file it produces while iterating. We buffer
/// them all (each paired with the filename recovered from its code block) and, once the
/// full response text is known, keep only those whose filename the model names in its
/// prose — collapsing repeated saves of the same name to the last version. If it named
/// none (e.g. `plt.show()` with no `savefig`), we fall back to the last file of each
/// MIME type so a real deliverable is never dropped.
/// Pure selection: from all buffered (filename, file) pairs and the final response
/// text, return only the user-ready file(s). Keeps files whose name the model named
/// in its prose (later saves of the same name win); if it named none, falls back to
/// the last file of each MIME type so a real deliverable is never dropped.
fn select_user_ready_files(
    buffered: &[(String, GeneratedFile)],
    final_text: &str,
) -> Vec<GeneratedFile> {
    let referenced = extract_referenced_filenames(final_text);

    let mut chosen: Vec<(String, GeneratedFile)> = Vec::new();
    for (name, file) in buffered {
        if !referenced.contains(&name.to_lowercase()) {
            continue;
        }
        if let Some(slot) = chosen.iter_mut().find(|(n, _)| n.eq_ignore_ascii_case(name)) {
            slot.1 = file.clone(); // later save of the same name wins
        } else {
            chosen.push((name.clone(), file.clone()));
        }
    }

    if !chosen.is_empty() {
        return chosen.into_iter().map(|(_, f)| f).collect();
    }

    let mut last_by_mime: Vec<(String, GeneratedFile)> = Vec::new();
    for (_, file) in buffered {
        let mime = file.mime_type.clone().unwrap_or_default();
        if let Some(slot) = last_by_mime.iter_mut().find(|(m, _)| *m == mime) {
            slot.1 = file.clone();
        } else {
            last_by_mime.push((mime, file.clone()));
        }
    }
    last_by_mime.into_iter().map(|(_, f)| f).collect()
}

fn emit_user_ready_files(
    window: &tauri::Window,
    turn_id: &str,
    buffered: Vec<(String, GeneratedFile)>,
    final_text: &str,
) {
    if buffered.is_empty() {
        return;
    }

    let files = select_user_ready_files(&buffered, final_text);
    if files.is_empty() {
        return;
    }

    let delta = StreamDelta {
        turn_id: turn_id.to_string(),
        text: String::new(),
        citations: None,
        inline_citations: None,
        thinking: None,
        execution: Some(ExecutionDelta {
            tool_name: tool_names::GEMINI_CODE_EXECUTION.to_string(),
            stdout: None,
            stderr: None,
            status: ExecutionStatus::Completed,
            code: None,
            files: Some(files),
        }),
    };
    if let Err(err) = window.emit("chat-stream-delta", delta) {
        eprintln!("Failed to emit user-ready files delta: {}", err);
    }
}

const INTERRUPTED_ERROR: &str = "The response was interrupted before Gemini produced an answer. Long code-execution tasks can occasionally drop the connection before finishing — please try again.";
const INTERRUPTED_NOTE: &str = "\n\n_The response was interrupted before it finished._";

/// A short note to append when a response ended abnormally but DID produce some
/// text (so the partial answer is kept, with an explanation).
fn finish_reason_note(reason: &str) -> String {
    let detail = match reason {
        "MAX_TOKENS" => "it reached the maximum length".to_string(),
        "SAFETY" => "it was stopped by Gemini's safety filters".to_string(),
        "RECITATION" => "it was stopped to avoid reproducing copyrighted material".to_string(),
        other => format!("it ended unexpectedly (reason: {})", other),
    };
    format!("\n\n_The response was cut short because {}._", detail)
}

/// A user-facing error for when a response ended abnormally with NO text at all.
fn finish_reason_error(reason: &str) -> String {
    match reason {
        "MAX_TOKENS" => "Gemini reached the maximum response length before producing an answer. Try simplifying the request or breaking it into steps.".to_string(),
        "SAFETY" => "Gemini blocked this response with its safety filters.".to_string(),
        "RECITATION" => "Gemini stopped this response to avoid reproducing copyrighted material.".to_string(),
        other => format!("Gemini ended the response unexpectedly (reason: {}).", other),
    }
}

/// Emit a plain-text delta (used to append an explanatory note to the answer).
fn emit_text_note(window: &tauri::Window, turn_id: &str, text: &str) {
    let delta = StreamDelta {
        turn_id: turn_id.to_string(),
        text: text.to_string(),
        citations: None,
        inline_citations: None,
        thinking: None,
        execution: None,
    };
    if let Err(err) = window.emit("chat-stream-delta", delta) {
        eprintln!("Failed to emit note delta: {}", err);
    }
}

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
    turn_id: String,
) -> Result<(), String> {
    let api_key = get_api_key_async(app, "google").await?;
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
        code_execution_enabled: true, // Always enable code execution for Gemini
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
    let mut accumulated_thinking = String::new();
    let mut generated_file_count: u32 = 0;
    // Filenames recovered from code blocks, paired FIFO with the anonymous
    // inlineData parts that follow; buffered files held until stream end so we
    // can emit only the user-ready one(s). See emit_user_ready_files.
    let mut pending_filenames: Vec<String> = Vec::new();
    let mut buffered_files: Vec<(String, GeneratedFile)> = Vec::new();

    loop {
        tokio::select! {
            // Check for cancellation
            _ = cancel_token.cancelled() => {
                if let Err(err) = window.emit("chat-stream-cancelled", StreamEvent { turn_id: turn_id.clone() }) {
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

                        // Gemini streams each SSE event on its own line (data: {...}\r\n)
                        // without double-newline separators. Parse line by line.

                        // Process complete lines from buffer
                        while let Some(line_end) = buffer.find('\n') {
                            let line = buffer[..line_end].trim_end_matches('\r').to_string();
                            buffer = buffer[line_end + 1..].to_string();

                            if let Some(data) = line.strip_prefix("data: ") {
                                // parse_sse_event returns Vec since one SSE can have multiple parts
                                let events = gemini_parse_sse_event(data);

                                for event in events {
                                match event {
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
                                                turn_id: turn_id.clone(),
                                                text: new_text,
                                                citations: None,
                                                inline_citations: None,
                                                thinking: None,
                                                execution: None,
                                            };
                                            if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                            }
                                        }
                                    }
                                    GeminiStreamEvent::ThinkingDelta { text: thinking_text } => {
                                        // Gemini sends cumulative thinking text, need to diff
                                        let new_thinking = if thinking_text.starts_with(&accumulated_thinking) {
                                            thinking_text[accumulated_thinking.len()..].to_string()
                                        } else {
                                            // Reset - new thinking block
                                            accumulated_thinking.clear();
                                            thinking_text.clone()
                                        };
                                        accumulated_thinking = thinking_text;

                                        // Emit thinking delta for ephemeral UI display
                                        if !new_thinking.is_empty() {
                                            let delta = StreamDelta {
                                                turn_id: turn_id.clone(),
                                                text: String::new(),
                                                citations: None,
                                                inline_citations: None,
                                                thinking: Some(new_thinking),
                                                execution: None,
                                            };
                                            if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                            }
                                        }
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
                                                turn_id: turn_id.clone(),
                                                text: String::new(),
                                                citations: None,
                                                inline_citations: Some(inline_citations),
                                                thinking: None,
                                                execution: None,
                                            };
                                            if let Err(err) = window.emit("chat-stream-delta", delta) {
                                                eprintln!("Failed to emit chat-stream-delta event: {}", err);
                                            }
                                        }
                                    }
                                    GeminiStreamEvent::ResponseComplete { finish_reason } => {
                                        let has_content = !full_response.trim().is_empty();
                                        // A non-STOP reason (MAX_TOKENS, SAFETY, …) with no answer at all
                                        // is surfaced as an error so the user sees why and discovery is
                                        // skipped. Otherwise we keep what we have (appending a note if it
                                        // ended abnormally) and complete normally.
                                        if finish_reason != "STOP" && !has_content {
                                            let msg = finish_reason_error(&finish_reason);
                                            llm_logger::log_error("chat", &msg);
                                            return Err(msg);
                                        }
                                        emit_user_ready_files(
                                            window,
                                            &turn_id,
                                            std::mem::take(&mut buffered_files),
                                            &full_response,
                                        );
                                        if finish_reason != "STOP" {
                                            emit_text_note(window, &turn_id, &finish_reason_note(&finish_reason));
                                        }
                                        llm_logger::log_response_complete("chat", &full_response);
                                        if let Err(err) = window.emit("chat-stream-done", StreamEvent { turn_id: turn_id.clone() }) {
                                            eprintln!("Failed to emit chat-stream-done event: {}", err);
                                        }
                                        return Ok(());
                                    }
                                    GeminiStreamEvent::Error { message } => {
                                        llm_logger::log_error("chat", &message);
                                        return Err(message);
                                    }
                                    GeminiStreamEvent::ExecutableCode { code } => {
                                        llm_logger::log_feature_used("chat", "Gemini Code Execution Started");
                                        // Recover the filenames this block writes so we can name the
                                        // (anonymous) inlineData parts that follow it.
                                        for name in extract_saved_filenames(&code) {
                                            pending_filenames.push(name);
                                        }
                                        // Emit execution started with code
                                        let delta = StreamDelta {
                                            turn_id: turn_id.clone(),
                                            text: String::new(),
                                            citations: None,
                                            inline_citations: None,
                                            thinking: None,
                                            execution: Some(ExecutionDelta {
                                                tool_name: tool_names::GEMINI_CODE_EXECUTION.to_string(),
                                                stdout: None,
                                                stderr: None,
                                                status: ExecutionStatus::Started,
                                                code: Some(code),
                                                files: None,
                                            }),
                                        };
                                        if let Err(err) = window.emit("chat-stream-delta", delta) {
                                            eprintln!("Failed to emit execution started delta: {}", err);
                                        }
                                    }
                                    GeminiStreamEvent::CodeExecutionResult { output } => {
                                        // Emit execution output
                                        let delta = StreamDelta {
                                            turn_id: turn_id.clone(),
                                            text: String::new(),
                                            citations: None,
                                            inline_citations: None,
                                            thinking: None,
                                            execution: Some(ExecutionDelta {
                                                tool_name: tool_names::GEMINI_CODE_EXECUTION.to_string(),
                                                stdout: Some(output),
                                                stderr: None,
                                                status: ExecutionStatus::Completed,
                                                code: None,
                                                files: None,
                                            }),
                                        };
                                        if let Err(err) = window.emit("chat-stream-delta", delta) {
                                            eprintln!("Failed to emit execution result delta: {}", err);
                                        }
                                    }
                                    GeminiStreamEvent::InlineData { mime_type, data } => {
                                        let timestamp = SystemTime::now()
                                            .duration_since(UNIX_EPOCH)
                                            .unwrap_or_default()
                                            .as_millis();

                                        let extension = mime_to_extension(&mime_type);
                                        let file_id = format!("gemini-{}-{}", timestamp, generated_file_count);
                                        // Pair this file with a filename recovered from code BY CONTENT TYPE,
                                        // not by order: the sandbox can return files in a different order than
                                        // the code saved them, so a positional match swaps names (e.g. a PNG
                                        // getting a .json name). The model references this name in its prose,
                                        // so it must match the real content. Fall back to a synthetic name
                                        // (with the correct extension) when nothing suitable was saved.
                                        let filename = match pick_filename_index_for_mime(&pending_filenames, &mime_type) {
                                            Some(i) => pending_filenames.remove(i),
                                            None => format!("generated-{}.{}", timestamp, extension),
                                        };
                                        generated_file_count += 1;

                                        // Create data URL for image preview (if it's an image)
                                        let image_preview = if mime_type.starts_with("image/") {
                                            Some(format!("data:{};base64,{}", mime_type, data))
                                        } else {
                                            None
                                        };

                                        let file = GeneratedFile {
                                            file_id,
                                            filename: filename.clone(),
                                            mime_type: Some(mime_type.clone()),
                                            image_preview,
                                            inline_data: Some(data),
                                        };

                                        llm_logger::log_feature_used("chat", &format!("Gemini File Generated: {}", mime_type));

                                        // Buffer rather than emit: Gemini streams every intermediate plot
                                        // as it iterates. emit_user_ready_files (at stream end) keeps only
                                        // the file(s) the model actually presents in its final response.
                                        buffered_files.push((filename, file));
                                    }
                                    GeminiStreamEvent::Unknown => {}
                                }
                                } // end for event in events
                            }
                        }
                    }
                    Some(Err(e)) => return Err(e.to_string()),
                    None => break,
                }
            }
        }
    }

    // Reaching here means the stream ended WITHOUT a finishReason — i.e. abnormally
    // (e.g. the connection dropped during a long code-execution gap). If we got a
    // partial answer, keep it with an "interrupted" note; if we got nothing, surface
    // an error so the user knows to retry and discovery doesn't run on an empty turn.
    if full_response.trim().is_empty() {
        llm_logger::log_error("chat", INTERRUPTED_ERROR);
        return Err(INTERRUPTED_ERROR.to_string());
    }
    emit_user_ready_files(window, &turn_id, std::mem::take(&mut buffered_files), &full_response);
    emit_text_note(window, &turn_id, INTERRUPTED_NOTE);
    llm_logger::log_response_complete("chat", &full_response);
    if let Err(err) = window.emit("chat-stream-done", StreamEvent { turn_id }) {
        eprintln!("Failed to emit chat-stream-done event: {}", err);
    }
    Ok(())
}

#[cfg(test)]
mod select_tests {
    use super::{finish_reason_error, finish_reason_note, select_user_ready_files};
    use crate::llm::GeneratedFile;

    #[test]
    fn abnormal_finish_messages_explain_the_reason() {
        assert!(finish_reason_note("MAX_TOKENS").contains("maximum length"));
        assert!(finish_reason_note("WEIRD").contains("WEIRD"));
        assert!(finish_reason_error("SAFETY").to_lowercase().contains("safety"));
        assert!(finish_reason_error("WEIRD").contains("WEIRD"));
    }

    fn gf(file_id: &str, filename: &str, mime: &str) -> GeneratedFile {
        GeneratedFile {
            file_id: file_id.to_string(),
            filename: filename.to_string(),
            mime_type: Some(mime.to_string()),
            image_preview: None,
            inline_data: Some("data".to_string()),
        }
    }

    fn ids(files: &[GeneratedFile]) -> Vec<&str> {
        files.iter().map(|f| f.file_id.as_str()).collect()
    }

    #[test]
    fn keeps_single_named_file() {
        let buffered = vec![(
            "canada_population_trend.png".to_string(),
            gf("g-0", "canada_population_trend.png", "image/png"),
        )];
        let text = "Saved as **`canada_population_trend.png`** and available for download.";
        assert_eq!(ids(&select_user_ready_files(&buffered, text)), vec!["g-0"]);
    }

    #[test]
    fn collapses_overwritten_name_to_last() {
        let buffered = vec![
            ("chart.png".to_string(), gf("g-0", "chart.png", "image/png")),
            ("chart.png".to_string(), gf("g-1", "chart.png", "image/png")),
            ("chart.png".to_string(), gf("g-2", "chart.png", "image/png")),
        ];
        let out = select_user_ready_files(&buffered, "Here is your chart.png.");
        assert_eq!(ids(&out), vec!["g-2"]); // intermediates dropped, last wins
    }

    #[test]
    fn drops_unreferenced_intermediates() {
        let buffered = vec![
            ("draft1.png".to_string(), gf("g-0", "draft1.png", "image/png")),
            ("draft2.png".to_string(), gf("g-1", "draft2.png", "image/png")),
            ("final_chart.png".to_string(), gf("g-2", "final_chart.png", "image/png")),
        ];
        let out = select_user_ready_files(&buffered, "Result: [chart](final_chart.png).");
        assert_eq!(ids(&out), vec!["g-2"]);
    }

    #[test]
    fn keeps_multiple_distinct_referenced_files() {
        let buffered = vec![
            ("chart.png".to_string(), gf("g-0", "chart.png", "image/png")),
            ("data.csv".to_string(), gf("g-1", "data.csv", "text/csv")),
        ];
        let out = select_user_ready_files(&buffered, "[chart](chart.png) and [data](data.csv)");
        assert_eq!(ids(&out), vec!["g-0", "g-1"]);
    }

    #[test]
    fn fallback_to_last_per_mime_when_none_named() {
        let buffered = vec![
            ("a.png".to_string(), gf("g-0", "a.png", "image/png")),
            ("b.png".to_string(), gf("g-1", "b.png", "image/png")),
        ];
        // No filename mentioned in prose -> keep the last image rather than nothing.
        let out = select_user_ready_files(&buffered, "Here is the result.");
        assert_eq!(ids(&out), vec!["g-1"]);
    }
}
