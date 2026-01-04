use chrono::Local;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

static CHAT_LOG_FILE_PATH: OnceLock<PathBuf> = OnceLock::new();
static DISCOVERY_LOG_FILE_PATH: OnceLock<PathBuf> = OnceLock::new();

fn get_log_dir() -> PathBuf {
    // Use a logs folder in the project root (go up one level from src-tauri during dev)
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    // If we're in src-tauri, go up one level to project root
    if cwd.ends_with("src-tauri") {
        cwd.parent()
            .map(|p| p.to_path_buf())
            .unwrap_or(cwd)
            .join("logs")
    } else {
        cwd.join("logs")
    }
}

fn get_log_file_path(module: &str) -> &'static PathBuf {
    let log_lock = if module == "discovery" {
        &DISCOVERY_LOG_FILE_PATH
    } else {
        &CHAT_LOG_FILE_PATH
    };

    log_lock.get_or_init(|| {
        let log_dir = get_log_dir();

        // Create the logs directory if it doesn't exist
        fs::create_dir_all(&log_dir).ok();

        // Generate timestamp for the filename
        let timestamp = Local::now().format("%Y%m%d-%H%M%S");
        let prefix = if module == "discovery" { "discovery" } else { "chat" };
        log_dir.join(format!("{}-log-{}.md", prefix, timestamp))
    })
}

fn format_json_pretty(value: &serde_json::Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

pub fn log_request(module: &str, model: &str, body: &serde_json::Value) {
    let log_path = get_log_file_path(module);

    let timestamp = Local::now();

    let system_prompt = body.get("system").map(|s| {
        if let Some(arr) = s.as_array() {
            arr.iter()
                .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("\n")
        } else if let Some(text) = s.as_str() {
            text.to_string()
        } else {
            format_json_pretty(s)
        }
    });

    let messages = body.get("messages").cloned().unwrap_or(serde_json::json!([]));
    let tools = body.get("tools").cloned();
    let thinking = body.get("thinking").cloned();

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path);

    if let Ok(mut f) = file {
        let separator = "═".repeat(80);
        let sub_separator = "─".repeat(60);

        writeln!(f, "\n{}", separator).ok();
        writeln!(f, "# LLM INTERACTION").ok();
        writeln!(f, "{}", separator).ok();
        writeln!(f, "").ok();
        writeln!(f, "**Timestamp:** {}", timestamp.format("%Y-%m-%d %H:%M:%S%.3f")).ok();
        writeln!(f, "**Module:** {}", module).ok();
        writeln!(f, "**Model:** {}", model).ok();
        writeln!(f, "").ok();

        // System Prompt
        if let Some(ref sys) = system_prompt {
            writeln!(f, "## System Prompt").ok();
            writeln!(f, "{}", sub_separator).ok();
            writeln!(f, "```").ok();
            writeln!(f, "{}", sys).ok();
            writeln!(f, "```").ok();
            writeln!(f, "").ok();
        }

        // Messages
        writeln!(f, "## Messages").ok();
        writeln!(f, "{}", sub_separator).ok();
        if let Some(msgs) = messages.as_array() {
            for (i, msg) in msgs.iter().enumerate() {
                writeln!(f, "").ok();

                // Get the role and format the header
                let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("unknown");
                let role_display = role.to_uppercase();
                writeln!(f, "### Message {} ({})", i + 1, role_display).ok();

                let content = msg.get("content");
                if let Some(c) = content {
                    if let Some(text) = c.as_str() {
                        // Plain text content - write directly without code block
                        writeln!(f, "{}", text).ok();
                    } else if let Some(arr) = c.as_array() {
                        for block in arr {
                            if let Some(block_type) = block.get("type").and_then(|t| t.as_str()) {
                                match block_type {
                                    "text" => {
                                        if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                                            writeln!(f, "{}", text).ok();
                                        }
                                    }
                                    "image" => {
                                        writeln!(f, "*[Image attachment]*").ok();
                                    }
                                    _ => {
                                        writeln!(f, "```json").ok();
                                        writeln!(f, "{}", format_json_pretty(block)).ok();
                                        writeln!(f, "```").ok();
                                    }
                                }
                            }
                        }
                    } else {
                        writeln!(f, "```json").ok();
                        writeln!(f, "{}", format_json_pretty(c)).ok();
                        writeln!(f, "```").ok();
                    }
                }
            }
        }
        writeln!(f, "").ok();

        // Thinking (if enabled)
        if let Some(ref th) = thinking {
            writeln!(f, "## Extended Thinking").ok();
            writeln!(f, "{}", sub_separator).ok();
            writeln!(f, "```json").ok();
            writeln!(f, "{}", format_json_pretty(th)).ok();
            writeln!(f, "```").ok();
            writeln!(f, "").ok();
        }

        // Tools (if any)
        if let Some(ref t) = tools {
            writeln!(f, "## Tools").ok();
            writeln!(f, "{}", sub_separator).ok();
            writeln!(f, "```json").ok();
            writeln!(f, "{}", format_json_pretty(t)).ok();
            writeln!(f, "```").ok();
            writeln!(f, "").ok();
        }

        // Raw Request JSON
        writeln!(f, "## Raw Request").ok();
        writeln!(f, "{}", sub_separator).ok();
        writeln!(f, "<details>").ok();
        writeln!(f, "<summary>Click to expand full request JSON</summary>").ok();
        writeln!(f, "").ok();
        writeln!(f, "```json").ok();
        writeln!(f, "{}", format_json_pretty(body)).ok();
        writeln!(f, "```").ok();
        writeln!(f, "</details>").ok();
        writeln!(f, "").ok();

        writeln!(f, "## Response").ok();
        writeln!(f, "{}", sub_separator).ok();
        writeln!(f, "*Awaiting response...*").ok();
        writeln!(f, "").ok();
    }
}

pub fn log_response_complete(module: &str, content: &str) {
    let log_path = get_log_file_path(module);

    if let Ok(contents) = fs::read_to_string(log_path) {
        // Replace the "Awaiting response..." with the actual response
        let updated = if contents.contains("*Awaiting response...*") {
            let mut replacement = String::new();
            replacement.push_str("```\n");
            replacement.push_str(content);
            replacement.push_str("\n```\n");

            // Only replace the last occurrence
            if let Some(pos) = contents.rfind("*Awaiting response...*") {
                let mut result = contents[..pos].to_string();
                result.push_str(&replacement);
                result.push_str(&contents[pos + "*Awaiting response...*".len()..]);
                result
            } else {
                contents
            }
        } else {
            // If no placeholder found, just append
            let mut result = contents;
            result.push_str("\n### Response Content\n");
            result.push_str("```\n");
            result.push_str(content);
            result.push_str("\n```\n");
            result
        };

        if let Ok(mut file) = File::create(log_path) {
            file.write_all(updated.as_bytes()).ok();
        }
    }
}

pub fn log_error(module: &str, error: &str) {
    let log_path = get_log_file_path(module);

    if let Ok(contents) = fs::read_to_string(log_path) {
        let updated = if contents.contains("*Awaiting response...*") {
            let replacement = format!("**ERROR:** `{}`\n", error);

            if let Some(pos) = contents.rfind("*Awaiting response...*") {
                let mut result = contents[..pos].to_string();
                result.push_str(&replacement);
                result.push_str(&contents[pos + "*Awaiting response...*".len()..]);
                result
            } else {
                contents
            }
        } else {
            let mut result = contents;
            result.push_str(&format!("\n**ERROR:** `{}`\n", error));
            result
        };

        if let Ok(mut file) = File::create(log_path) {
            file.write_all(updated.as_bytes()).ok();
        }
    }
}

/// Log when a special feature is detected in the stream (extended thinking, web search)
pub fn log_feature_used(module: &str, feature: &str) {
    let log_path = get_log_file_path(module);

    if let Ok(mut file) = OpenOptions::new().append(true).open(log_path) {
        let timestamp = Local::now().format("%H:%M:%S%.3f");
        writeln!(file, "\n**[{}] Feature detected:** {}", timestamp, feature).ok();
    }
}
