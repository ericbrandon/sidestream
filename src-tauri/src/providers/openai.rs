use serde::{Deserialize, Serialize};

use crate::llm::GeneratedFile;

const OPENAI_API_URL: &str = "https://api.openai.com/v1/responses";

/// OpenAI API client (using Responses API)
pub struct OpenAIClient {
    client: reqwest::Client,
    api_key: String,
}

/// Configuration for a chat request
pub struct ChatRequestConfig {
    pub model: String,
    pub messages: Vec<serde_json::Value>,
    pub system_prompt: Option<String>,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub web_search_enabled: bool,
    pub prompt_cache_key: Option<String>,
    pub code_interpreter_enabled: bool,
    pub container_id: Option<String>,
}

/// Reasoning effort levels for OpenAI reasoning models
/// - GPT-5 series supports: none, minimal, low, medium, high, xhigh
/// - o-series (o3, o4-mini) supports: low, medium, high only
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ReasoningEffort {
    None,    // GPT-5 only - no reasoning tokens
    Minimal, // GPT-5 only - minimal reasoning
    Low,
    Medium,
    High,
    XHigh,   // GPT-5 only - extra high reasoning
}

impl ReasoningEffort {
    pub fn as_str(&self) -> &'static str {
        match self {
            ReasoningEffort::None => "none",
            ReasoningEffort::Minimal => "minimal",
            ReasoningEffort::Low => "low",
            ReasoningEffort::Medium => "medium",
            ReasoningEffort::High => "high",
            ReasoningEffort::XHigh => "xhigh",
        }
    }
}

/// Configuration for a discovery request
pub struct DiscoveryRequestConfig {
    pub model: String,
    pub system_prompt: String,
    pub conversation: String,
    pub prompt_cache_key: Option<String>,
    pub reasoning_level: Option<String>,
}

/// Parsed SSE events from OpenAI's streaming Responses API
#[derive(Debug, Clone)]
pub enum OpenAIStreamEvent {
    /// Text delta - incremental text content
    TextDelta { text: String },
    /// Text output complete with annotations (citations and file references)
    TextDone {
        #[allow(dead_code)]
        text: String,
        annotations: Vec<UrlCitation>,
        file_citations: Vec<ContainerFileCitation>,
    },
    /// Reasoning summary text (for ephemeral thinking UI)
    ReasoningSummary { text: String },
    /// Web search started
    WebSearchStarted,
    /// Code interpreter call started
    CodeInterpreterStarted {
        #[allow(dead_code)]
        call_id: String,
    },
    /// Code interpreter code delta (incremental code)
    CodeInterpreterCodeDelta {
        #[allow(dead_code)]
        call_id: String,
        code: String,
    },
    /// Code interpreter code complete
    CodeInterpreterCodeDone {
        #[allow(dead_code)]
        call_id: String,
        code: String,
    },
    /// Code interpreter execution result
    CodeInterpreterResult {
        #[allow(dead_code)]
        call_id: String,
        container_id: Option<String>,
        stdout: Option<String>,
        stderr: Option<String>,
        files: Vec<ContainerFileCitation>,
    },
    /// Response completed
    ResponseCompleted,
    /// Stream finished
    Done,
    /// Error occurred
    Error { message: String },
    /// Unknown/unhandled event
    Unknown,
}

/// File citation from OpenAI code interpreter output
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerFileCitation {
    pub file_id: String,
    pub container_id: String,
    pub filename: String,
}

/// URL citation from web search results
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UrlCitation {
    pub url: String,
    pub title: String,
    pub start_index: Option<u32>,
    pub end_index: Option<u32>,
}


impl OpenAIClient {
    pub fn new(api_key: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
        }
    }

    /// Build the request body for a chat message using OpenAI Responses API
    pub fn build_chat_request(&self, config: &ChatRequestConfig) -> serde_json::Value {
        // Convert messages to OpenAI Responses API format
        // OpenAI uses "input" array with role-based items
        let mut input_items: Vec<serde_json::Value> = Vec::new();

        // Add system prompt as an item if provided
        if let Some(system) = &config.system_prompt {
            input_items.push(serde_json::json!({
                "type": "message",
                "role": "system",
                "content": system
            }));
        }

        // Convert each message to OpenAI format
        for msg in &config.messages {
            let role = msg["role"].as_str().unwrap_or("user");
            let content = &msg["content"];

            // Handle content - can be string or array of content blocks
            let formatted_content = if let Some(text) = content.as_str() {
                // Simple string content
                serde_json::json!(text)
            } else if let Some(arr) = content.as_array() {
                // Array of content blocks - convert to OpenAI format
                let converted: Vec<serde_json::Value> = arr
                    .iter()
                    .filter_map(|block| {
                        let block_type = block["type"].as_str()?;
                        match block_type {
                            "text" => {
                                let text = block["text"].as_str()?;
                                Some(serde_json::json!({
                                    "type": "input_text",
                                    "text": text
                                }))
                            }
                            "image" => {
                                // Convert Anthropic image format to OpenAI
                                let source = &block["source"];
                                let media_type = source["media_type"].as_str()?;
                                let data = source["data"].as_str()?;
                                Some(serde_json::json!({
                                    "type": "input_image",
                                    "image_url": format!("data:{};base64,{}", media_type, data)
                                }))
                            }
                            "document" => {
                                // OpenAI handles PDFs as base64 with filename
                                let source = &block["source"];
                                let data = source["data"].as_str()?;
                                // Get filename if available, default to "document.pdf"
                                let filename = block["filename"].as_str()
                                    .or_else(|| source["filename"].as_str())
                                    .unwrap_or("document.pdf");
                                Some(serde_json::json!({
                                    "type": "input_file",
                                    "filename": filename,
                                    "file_data": format!("data:application/pdf;base64,{}", data)
                                }))
                            }
                            "file" => {
                                // Generic file: send as input_file with original MIME type
                                let source = &block["source"];
                                let media_type = source["media_type"].as_str()?;
                                let data = source["data"].as_str()?;
                                let filename = block["filename"].as_str().unwrap_or("file");
                                Some(serde_json::json!({
                                    "type": "input_file",
                                    "filename": filename,
                                    "file_data": format!("data:{};base64,{}", media_type, data)
                                }))
                            }
                            _ => None,
                        }
                    })
                    .collect();
                serde_json::json!(converted)
            } else {
                // Fallback to empty string
                serde_json::json!("")
            };

            input_items.push(serde_json::json!({
                "type": "message",
                "role": role,
                "content": formatted_content
            }));
        }

        let mut body = serde_json::json!({
            "model": config.model,
            "input": input_items,
            "stream": true
        });

        // Add reasoning effort if enabled (for reasoning models like o3, o4-mini, gpt-5)
        // Include summary: "auto" to get reasoning summaries for ephemeral thinking UI
        if let Some(effort) = &config.reasoning_effort {
            body["reasoning"] = serde_json::json!({
                "effort": effort.as_str(),
                "summary": "auto"
            });
        }

        // Build tools array
        let mut tools: Vec<serde_json::Value> = Vec::new();

        // Add web search tool if enabled
        if config.web_search_enabled {
            tools.push(serde_json::json!({"type": "web_search"}));
        }

        // Add code interpreter tool if enabled
        if config.code_interpreter_enabled {
            let code_interpreter = if let Some(container_id) = &config.container_id {
                // Reuse existing container for file persistence across turns
                serde_json::json!({
                    "type": "code_interpreter",
                    "container": container_id
                })
            } else {
                // Auto-create new container
                serde_json::json!({
                    "type": "code_interpreter",
                    "container": {"type": "auto"}
                })
            };
            tools.push(code_interpreter);
        }

        // Add tools to request if any are enabled
        if !tools.is_empty() {
            body["tools"] = serde_json::json!(tools);
        }

        // Add prompt cache key if provided
        if let Some(cache_key) = &config.prompt_cache_key {
            body["prompt_cache_key"] = serde_json::json!(cache_key);
        }

        body
    }

    /// Build the request body for a discovery request
    pub fn build_discovery_request(&self, config: &DiscoveryRequestConfig) -> serde_json::Value {
        let input_items = vec![
            serde_json::json!({
                "type": "message",
                "role": "system",
                "content": config.system_prompt
            }),
            serde_json::json!({
                "type": "message",
                "role": "user",
                "content": config.conversation
            }),
        ];

        // Map reasoning level string to effort value (default to "low")
        let effort = match config.reasoning_level.as_deref() {
            Some("off") => "none",
            Some("minimal") => "minimal",
            Some("low") => "low",
            Some("medium") => "medium",
            Some("high") => "high",
            Some("xhigh") => "xhigh",
            _ => "low", // Default
        };

        let mut body = serde_json::json!({
            "model": config.model,
            "input": input_items,
            "stream": true,
            "reasoning": {
                "effort": effort
            },
            "tools": [{
                "type": "web_search"
            }]
        });

        // Add prompt cache key if provided
        if let Some(cache_key) = &config.prompt_cache_key {
            body["prompt_cache_key"] = serde_json::json!(cache_key);
        }

        body
    }

    /// Send a streaming request and return the response
    pub async fn send_streaming_request(
        &self,
        body: &serde_json::Value,
    ) -> Result<reqwest::Response, String> {
        let response = self
            .client
            .post(OPENAI_API_URL)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("API error ({}): {}", status, error_text));
        }

        Ok(response)
    }
}

/// Parse a single SSE data payload into an OpenAIStreamEvent
pub fn parse_sse_event(data: &str) -> OpenAIStreamEvent {
    if data == "[DONE]" {
        return OpenAIStreamEvent::Done;
    }

    let parsed: serde_json::Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(_) => return OpenAIStreamEvent::Unknown,
    };

    let event_type = parsed["type"].as_str().unwrap_or("");

    match event_type {
        // Text content delta
        "response.output_text.delta" => {
            let text = parsed["delta"].as_str().unwrap_or("").to_string();
            OpenAIStreamEvent::TextDelta { text }
        }

        // Text output complete (may contain citations and file references)
        // Note: annotations may be empty here if sent via response.output_text.annotation.added
        // In that case, response.content_part.done will have the complete annotations
        "response.output_text.done" => {
            let text = parsed["text"].as_str().unwrap_or("").to_string();
            let annotations = parse_url_citations(&parsed["annotations"]);
            // First try to get file citations from annotations
            let mut file_citations = parse_container_file_citations(&parsed["annotations"], &None);
            // If no annotations, extract from sandbox: URLs in the text
            if file_citations.is_empty() {
                file_citations = extract_sandbox_files(&text);
            }
            OpenAIStreamEvent::TextDone { text, annotations, file_citations }
        }

        // Content part done - contains accumulated annotations including file citations
        // This fires after response.output_text.done and includes annotations that were
        // sent incrementally via response.output_text.annotation.added
        "response.content_part.done" => {
            let part = &parsed["part"];
            if part["type"].as_str() == Some("output_text") {
                let text = part["text"].as_str().unwrap_or("").to_string();
                let annotations = parse_url_citations(&part["annotations"]);
                let file_citations = parse_container_file_citations(&part["annotations"], &None);
                // Only emit if we have file citations (otherwise output_text.done already handled it)
                if !file_citations.is_empty() {
                    return OpenAIStreamEvent::TextDone { text, annotations, file_citations };
                }
            }
            OpenAIStreamEvent::Unknown
        }

        // Output item added (web search, code interpreter, or reasoning)
        "response.output_item.added" => {
            let item_type = parsed["item"]["type"].as_str().unwrap_or("");
            match item_type {
                "web_search_call" => OpenAIStreamEvent::WebSearchStarted,
                "code_interpreter_call" => {
                    let call_id = parsed["item"]["id"].as_str().unwrap_or("").to_string();
                    OpenAIStreamEvent::CodeInterpreterStarted { call_id }
                }
                "reasoning" => {
                    // Extract reasoning summary text from the summary array
                    // Format: {"type": "reasoning", "summary": [{"type": "summary_text", "text": "..."}]}
                    if let Some(summary_arr) = parsed["item"]["summary"].as_array() {
                        let summary_text: String = summary_arr
                            .iter()
                            .filter_map(|s| {
                                if s["type"].as_str() == Some("summary_text") {
                                    s["text"].as_str().map(|t| t.to_string())
                                } else {
                                    None
                                }
                            })
                            .collect::<Vec<_>>()
                            .join("\n");
                        if !summary_text.is_empty() {
                            return OpenAIStreamEvent::ReasoningSummary { text: summary_text };
                        }
                    }
                    OpenAIStreamEvent::Unknown
                }
                _ => OpenAIStreamEvent::Unknown,
            }
        }

        // Code interpreter code delta (streaming code as it's written)
        // Note: OpenAI uses underscore format: response.code_interpreter_call_code.delta
        "response.code_interpreter_call.code.delta" | "response.code_interpreter_call_code.delta" => {
            let call_id = parsed["item_id"].as_str().unwrap_or("").to_string();
            let code = parsed["delta"].as_str().unwrap_or("").to_string();
            OpenAIStreamEvent::CodeInterpreterCodeDelta { call_id, code }
        }

        // Code interpreter code complete
        // Note: OpenAI uses underscore format: response.code_interpreter_call_code.done
        "response.code_interpreter_call.code.done" | "response.code_interpreter_call_code.done" => {
            let call_id = parsed["item_id"].as_str().unwrap_or("").to_string();
            let code = parsed["code"].as_str().unwrap_or("").to_string();
            OpenAIStreamEvent::CodeInterpreterCodeDone { call_id, code }
        }

        // Code interpreter output item done - contains execution results and files
        "response.output_item.done" => {
            let item_type = parsed["item"]["type"].as_str().unwrap_or("");
            if item_type == "code_interpreter_call" {
                let call_id = parsed["item"]["id"].as_str().unwrap_or("").to_string();
                let container_id = parsed["item"]["container_id"].as_str().map(|s| s.to_string());

                // Parse output results
                let output = &parsed["item"]["output"];
                let stdout = output["logs"].as_str().map(|s| s.to_string());
                let stderr = output["error"].as_str().map(|s| s.to_string());

                // Parse file citations from annotations in output
                let files = parse_container_file_citations(&output["annotations"], &container_id);

                OpenAIStreamEvent::CodeInterpreterResult {
                    call_id,
                    container_id,
                    stdout,
                    stderr,
                    files,
                }
            } else {
                OpenAIStreamEvent::Unknown
            }
        }

        // Reasoning summary delta (streaming reasoning summaries)
        "response.reasoning_summary_text.delta" => {
            let text = parsed["delta"].as_str().unwrap_or("").to_string();
            if !text.is_empty() {
                OpenAIStreamEvent::ReasoningSummary { text }
            } else {
                OpenAIStreamEvent::Unknown
            }
        }

        // Response completed
        "response.completed" => OpenAIStreamEvent::ResponseCompleted,

        // Error event
        "error" => {
            let message = parsed["error"]["message"]
                .as_str()
                .unwrap_or("Unknown error")
                .to_string();
            OpenAIStreamEvent::Error { message }
        }

        _ => OpenAIStreamEvent::Unknown,
    }
}

/// Parse URL citation annotations from OpenAI response
fn parse_url_citations(annotations: &serde_json::Value) -> Vec<UrlCitation> {
    let mut citations = Vec::new();

    if let Some(arr) = annotations.as_array() {
        for annotation in arr {
            if annotation["type"].as_str() == Some("url_citation") {
                if let (Some(url), Some(title)) =
                    (annotation["url"].as_str(), annotation["title"].as_str())
                {
                    citations.push(UrlCitation {
                        url: url.to_string(),
                        title: title.to_string(),
                        start_index: annotation["start_index"].as_u64().map(|n| n as u32),
                        end_index: annotation["end_index"].as_u64().map(|n| n as u32),
                    });
                }
            }
        }
    }

    citations
}

/// Parse container_file_citation annotations from code interpreter output
fn parse_container_file_citations(
    annotations: &serde_json::Value,
    fallback_container_id: &Option<String>,
) -> Vec<ContainerFileCitation> {
    let mut files = Vec::new();

    if let Some(arr) = annotations.as_array() {
        for annotation in arr {
            if annotation["type"].as_str() == Some("container_file_citation") {
                let file_id = annotation["file_id"].as_str().unwrap_or("").to_string();
                let filename = annotation["filename"].as_str().unwrap_or("file").to_string();
                // Use container_id from annotation, or fall back to the one from the call
                let container_id = annotation["container_id"]
                    .as_str()
                    .map(|s| s.to_string())
                    .or_else(|| fallback_container_id.clone())
                    .unwrap_or_default();

                if !file_id.is_empty() {
                    files.push(ContainerFileCitation {
                        file_id,
                        container_id,
                        filename,
                    });
                }
            }
        }
    }

    files
}

/// Extract file references from sandbox: URLs in text
/// OpenAI embeds files as markdown links: [text](sandbox:/mnt/data/filename.ext)
/// Since we don't have file_id from this format, we generate a placeholder
/// that can be resolved later using container file listing
fn extract_sandbox_files(text: &str) -> Vec<ContainerFileCitation> {
    use regex::Regex;

    let mut files = Vec::new();

    // Match markdown links with sandbox: URLs
    // Format: [link text](sandbox:/mnt/data/filename.ext)
    let re = Regex::new(r"\[([^\]]*)\]\(sandbox:/mnt/data/([^)]+)\)").unwrap();

    for cap in re.captures_iter(text) {
        let filename = cap.get(2).map(|m| m.as_str()).unwrap_or("file").to_string();

        // We don't have file_id from sandbox URLs, so use the path as a placeholder
        // The actual file_id will need to be resolved by listing container files
        files.push(ContainerFileCitation {
            file_id: format!("sandbox:/mnt/data/{}", filename), // Placeholder - needs resolution
            container_id: String::new(), // Will be filled from code_interpreter_call result
            filename,
        });
    }

    files
}

/// Merge a freshly parsed generated file into the per-turn buffer, keeping one
/// entry per filename.
///
/// OpenAI surfaces the same code-interpreter file more than once: a `sandbox:`
/// placeholder extracted from `response.output_text.done` (whose annotations are
/// often still empty), and the real `container_file_citation` from
/// `response.content_part.done`. Emitting per-event produced duplicate download
/// chips, half of them dead (the placeholder has no real file id, so its content
/// fetch fails and it has no `inline_data`). We collapse by filename and keep the
/// better copy: one whose bytes were actually fetched (`inline_data`), tie-broken
/// toward a real (non-`sandbox:`) file id.
pub fn merge_generated_file(buffer: &mut Vec<GeneratedFile>, candidate: GeneratedFile) {
    if let Some(existing) = buffer.iter_mut().find(|f| f.filename == candidate.filename) {
        if generated_file_is_better(existing, &candidate) {
            *existing = candidate;
        }
    } else {
        buffer.push(candidate);
    }
}

/// True if `candidate` is a better copy to keep than the `existing` one for the
/// same filename. Prefers a file with fetched bytes; on a tie, prefers a real
/// file id over a `sandbox:` placeholder. See [`merge_generated_file`].
fn generated_file_is_better(existing: &GeneratedFile, candidate: &GeneratedFile) -> bool {
    let existing_has_bytes = existing.inline_data.is_some();
    let candidate_has_bytes = candidate.inline_data.is_some();
    if candidate_has_bytes != existing_has_bytes {
        return candidate_has_bytes;
    }
    let existing_placeholder = existing.file_id.starts_with("sandbox:");
    let candidate_placeholder = candidate.file_id.starts_with("sandbox:");
    existing_placeholder && !candidate_placeholder
}

const IMAGE_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "tif", "ico", "avif", "heic", "heif",
];

/// Whether a generated file is an image (by MIME, falling back to extension).
fn is_image_generated_file(f: &GeneratedFile) -> bool {
    if let Some(mime) = &f.mime_type {
        if mime.starts_with("image/") {
            return true;
        }
    }
    let lower = f.filename.to_lowercase();
    IMAGE_EXTS.iter().any(|ext| lower.ends_with(&format!(".{}", ext)))
}

/// Collapse redundant image renders from an OpenAI code-interpreter turn.
///
/// A model that both saves a chart (`plt.savefig('foo.png')`) and displays it
/// (`plt.show()`) produces two image artifacts of the same figure with different
/// identities, so [`merge_generated_file`]'s filename dedup can't merge them and
/// the user sees the chart twice. We keep image files whose filename the model
/// actually references in its final answer text (the saved, user-facing file) and
/// drop unreferenced ones (the anonymous `plt.show()` display render). If no image
/// is referenced anywhere (e.g. a `plt.show()`-only turn), we keep them all so the
/// chart still shows. Non-image files are always kept (already deduped by name).
pub fn select_displayable_files(files: Vec<GeneratedFile>, final_text: &str) -> Vec<GeneratedFile> {
    let final_lower = final_text.to_lowercase();
    let referenced =
        |f: &GeneratedFile| text_references_filename(&final_lower, &f.filename.to_lowercase());
    let any_image_referenced = files
        .iter()
        .any(|f| is_image_generated_file(f) && referenced(f));

    files
        .into_iter()
        .filter(|f| {
            if !is_image_generated_file(f) {
                return true; // keep all non-image files
            }
            if any_image_referenced {
                referenced(f) // keep only the referenced (saved, user-facing) image(s)
            } else {
                true // nothing referenced → keep all images (e.g. plt.show()-only)
            }
        })
        .collect()
}

/// Whether `filename` occurs in `text` as a whole token rather than as a substring
/// of a larger name. Both args must already be lowercased.
///
/// We require the byte on each side of a match to not be a "name char" (ASCII
/// alphanumeric, `_`, or `-`), so `…/mnt/data/chart.png)` references `chart.png` but
/// neither `annualreport.png` matches `report.png` nor `banana.png` matches `a.png`.
/// `.` is deliberately *not* a name char, so a trailing sentence period
/// ("saved chart.png.") still counts. Uses literal search, so filenames with regex
/// metacharacters are handled safely.
fn text_references_filename(text: &str, filename: &str) -> bool {
    if filename.is_empty() {
        return false;
    }
    let is_name_char = |b: u8| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-');
    let bytes = text.as_bytes();
    let needle_len = filename.len();
    text.match_indices(filename).any(|(idx, _)| {
        let before_ok = idx == 0 || !is_name_char(bytes[idx - 1]);
        let after = idx + needle_len;
        let after_ok = after >= bytes.len() || !is_name_char(bytes[after]);
        before_ok && after_ok
    })
}

/// Convert a reasoning level string from the frontend to ReasoningEffort
/// Frontend sends: "off", "minimal", "low", "medium", "high", "xhigh" for GPT-5
///                 "low", "medium", "high" for o-series
pub fn string_to_reasoning_effort(level: &str) -> ReasoningEffort {
    match level.to_lowercase().as_str() {
        "off" | "none" => ReasoningEffort::None,
        "minimal" => ReasoningEffort::Minimal,
        "low" => ReasoningEffort::Low,
        "medium" => ReasoningEffort::Medium,
        "high" => ReasoningEffort::High,
        "xhigh" => ReasoningEffort::XHigh,
        _ => ReasoningEffort::Medium, // Default for unknown values
    }
}

/// Check if a model supports reasoning effort
/// Both o-series (o3, o4-mini) and GPT-5 series support reasoning effort
pub fn supports_reasoning(model: &str) -> bool {
    model.starts_with("o3")
        || model.starts_with("o4")
        || model.starts_with("gpt-5")
        || model.contains("-o-")
}

/// Fetch file content from OpenAI Containers API and return as base64
pub async fn fetch_file_content_base64(api_key: &str, container_id: &str, file_id: &str) -> Result<String, String> {
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
        .map_err(|e| format!("Failed to fetch file content: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("File content API error: {}", error_text));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read file content: {}", e))?;

    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real code-interpreter file: a `cfile_*` id and fetched bytes.
    fn real_file(filename: &str) -> GeneratedFile {
        GeneratedFile {
            file_id: format!("cfile_{}", filename),
            filename: filename.to_string(),
            mime_type: Some("text/html".to_string()),
            image_preview: None,
            inline_data: Some("ZmFrZQ==".to_string()),
        }
    }

    /// A `sandbox:` placeholder: bogus id, no bytes (its content fetch failed).
    fn placeholder_file(filename: &str) -> GeneratedFile {
        GeneratedFile {
            file_id: format!("sandbox:/mnt/data/{}", filename),
            filename: filename.to_string(),
            mime_type: None,
            image_preview: None,
            inline_data: None,
        }
    }

    #[test]
    fn extract_sandbox_files_yields_basename_placeholders() {
        let text = "Here you go: [map](sandbox:/mnt/data/canada_density_map.html) and \
                    [values](sandbox:/mnt/data/canada_density_values.csv).";
        let files = extract_sandbox_files(text);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].filename, "canada_density_map.html");
        assert_eq!(files[0].file_id, "sandbox:/mnt/data/canada_density_map.html");
        assert!(files[0].container_id.is_empty());
        assert_eq!(files[1].filename, "canada_density_values.csv");
    }

    #[test]
    fn merge_keeps_distinct_filenames() {
        let mut buf = Vec::new();
        merge_generated_file(&mut buf, real_file("a.html"));
        merge_generated_file(&mut buf, real_file("b.csv"));
        assert_eq!(buf.len(), 2);
    }

    #[test]
    fn merge_collapses_duplicate_filename() {
        let mut buf = Vec::new();
        merge_generated_file(&mut buf, real_file("a.html"));
        merge_generated_file(&mut buf, real_file("a.html"));
        assert_eq!(buf.len(), 1);
    }

    #[test]
    fn merge_prefers_real_over_placeholder_when_placeholder_first() {
        // This is the live ordering: output_text.done (placeholder) precedes
        // content_part.done (real).
        let mut buf = Vec::new();
        merge_generated_file(&mut buf, placeholder_file("a.html"));
        merge_generated_file(&mut buf, real_file("a.html"));
        assert_eq!(buf.len(), 1);
        assert!(buf[0].inline_data.is_some());
        assert!(buf[0].file_id.starts_with("cfile_"));
    }

    #[test]
    fn merge_does_not_downgrade_real_to_placeholder() {
        let mut buf = Vec::new();
        merge_generated_file(&mut buf, real_file("a.html"));
        merge_generated_file(&mut buf, placeholder_file("a.html"));
        assert_eq!(buf.len(), 1);
        assert!(buf[0].inline_data.is_some());
        assert!(buf[0].file_id.starts_with("cfile_"));
    }

    #[test]
    fn merge_full_canada_scenario_yields_two_working_files() {
        // Two files, each surfaced once as a placeholder then once for real:
        // exactly the "4 chips, top 2 dead" bug. After merge: 2 working files.
        let mut buf = Vec::new();
        merge_generated_file(&mut buf, placeholder_file("canada_density_map.html"));
        merge_generated_file(&mut buf, placeholder_file("canada_density_values.csv"));
        merge_generated_file(&mut buf, real_file("canada_density_map.html"));
        merge_generated_file(&mut buf, real_file("canada_density_values.csv"));
        assert_eq!(buf.len(), 2);
        assert!(buf.iter().all(|f| f.inline_data.is_some()));
        assert!(buf.iter().all(|f| !f.file_id.starts_with("sandbox:")));
    }

    fn image_file(filename: &str, file_id: &str) -> GeneratedFile {
        GeneratedFile {
            file_id: file_id.to_string(),
            filename: filename.to_string(),
            mime_type: Some("image/png".to_string()),
            image_preview: Some("data:image/png;base64,ZmFrZQ==".to_string()),
            inline_data: Some("ZmFrZQ==".to_string()),
        }
    }

    #[test]
    fn select_drops_unreferenced_display_render() {
        // savefig (named, referenced in text) + plt.show (anonymous, not referenced).
        let files = vec![
            image_file("canada_population_1980_2024.png", "cfile_saved"),
            image_file("", "cfile_display"),
        ];
        let text = "Graph: [chart](sandbox:/mnt/data/canada_population_1980_2024.png)";
        let kept = select_displayable_files(files, text);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].file_id, "cfile_saved");
    }

    #[test]
    fn select_drops_unreferenced_named_display_render() {
        // The display render can carry a generic name that isn't in the text.
        let files = vec![
            image_file("canada_population_1980_2024.png", "cfile_saved"),
            image_file("image.png", "cfile_display"),
        ];
        let text = "Here is the chart: sandbox:/mnt/data/canada_population_1980_2024.png";
        let kept = select_displayable_files(files, text);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].file_id, "cfile_saved");
    }

    #[test]
    fn select_keeps_all_images_when_none_referenced() {
        // plt.show()-only: no saved file referenced in text → keep the chart.
        let files = vec![image_file("image.png", "cfile_display")];
        let kept = select_displayable_files(files, "Here's your chart.");
        assert_eq!(kept.len(), 1);
    }

    #[test]
    fn select_always_keeps_non_image_files() {
        let files = vec![
            GeneratedFile {
                file_id: "cfile_csv".to_string(),
                filename: "data.csv".to_string(),
                mime_type: Some("text/csv".to_string()),
                image_preview: None,
                inline_data: Some("ZmFrZQ==".to_string()),
            },
            image_file("chart.png", "cfile_img"),
        ];
        let text = "Chart: sandbox:/mnt/data/chart.png"; // csv not mentioned
        let kept = select_displayable_files(files, text);
        assert_eq!(kept.len(), 2); // csv kept despite not being referenced
    }

    #[test]
    fn select_keeps_multiple_referenced_images() {
        let files = vec![
            image_file("a.png", "cfile_a"),
            image_file("b.png", "cfile_b"),
        ];
        let text = "See sandbox:/mnt/data/a.png and sandbox:/mnt/data/b.png";
        let kept = select_displayable_files(files, text);
        assert_eq!(kept.len(), 2);
    }

    #[test]
    fn text_references_filename_matches_whole_token() {
        assert!(text_references_filename(
            "see [x](sandbox:/mnt/data/chart.png) here",
            "chart.png"
        ));
        assert!(text_references_filename("chart.png", "chart.png"));
        // trailing sentence period still counts (. is not a name char)
        assert!(text_references_filename("i saved chart.png.", "chart.png"));
    }

    #[test]
    fn text_references_filename_rejects_substring_of_larger_name() {
        assert!(!text_references_filename("banana.png", "a.png"));
        assert!(!text_references_filename("see annualreport.png", "report.png"));
        assert!(!text_references_filename("my_chart.png", "chart.png"));
        assert!(!text_references_filename("", "a.png"));
        assert!(!text_references_filename("anything", ""));
    }

    #[test]
    fn select_does_not_treat_substring_name_as_referenced() {
        // The old loose `contains` would have kept report.png because it's a substring
        // of the referenced annualreport.png. The boundary match drops it.
        let files = vec![
            image_file("report.png", "cfile_display"),
            image_file("annualreport.png", "cfile_saved"),
        ];
        let text = "Here is your chart: sandbox:/mnt/data/annualreport.png";
        let kept = select_displayable_files(files, text);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].file_id, "cfile_saved");
    }
}

