use regex::Regex;
use serde::{Deserialize, Serialize};

const GEMINI_API_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

/// Appended to the system instruction whenever code execution is enabled.
///
/// Without this, Gemini 3.x answers visual/file requests as ASCII art or by
/// printing raw contents as text — it doesn't know the host app can render images
/// and serve downloads. The Gemini sandbox returns ANY file the executed code
/// writes to the working directory as a `part.inlineData` part (verified live for
/// PNG via PIL and matplotlib, CSV, and PDF on both 3.5 Flash and 3.1 Pro), so the
/// guidance describes the app's capabilities and the hand-off mechanism — save a
/// file — rather than prescribing a single library. This is Gemini-specific: it's
/// appended only in this builder, never to the shared cross-provider prompt.
const GEMINI_CODE_EXEC_FILE_GUIDANCE: &str =
    " This application can display images inline and lets the user download files \
you create. When a visual or a file would serve the user better than plain text — \
for example a plot, diagram, map, image, spreadsheet, document, or PDF — \
use the code execution tool to generate it and save it to a file in the working \
directory. Any file you save there is delivered to the user automatically: images \
are shown inline and other files become downloads, so you never need to print file \
contents or base64-encode them as text. Prefer producing a real saved file over \
drawing ASCII art or pasting raw data as text. Only generate a file when it \
genuinely helps; answer ordinary questions with plain text.";

/// Google Gemini API client (Google AI Studio)
pub struct GeminiClient {
    client: reqwest::Client,
    api_key: String,
}

/// Configuration for a chat request
pub struct ChatRequestConfig {
    pub messages: Vec<serde_json::Value>,
    pub system_prompt: Option<String>,
    pub thinking_config: Option<ThinkingLevel>,
    pub web_search_enabled: bool,
    pub code_execution_enabled: bool,
}

/// Thinking level for Gemini 3.x models (serialized as `thinkingLevel`).
/// 3.1 Pro supports Low/High; 3.5 Flash also supports Minimal/Medium.
#[derive(Clone, Copy, Debug)]
pub enum ThinkingLevel {
    Minimal, // Gemini 3.x Flash only
    Low,
    Medium, // Gemini 3.x Flash only
    High,
}

impl ThinkingLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            ThinkingLevel::Minimal => "minimal",
            ThinkingLevel::Low => "LOW",
            ThinkingLevel::Medium => "medium",
            ThinkingLevel::High => "HIGH",
        }
    }
}

/// Configuration for a discovery request
pub struct DiscoveryRequestConfig {
    pub system_prompt: String,
    pub conversation: String,
    pub thinking_config: Option<ThinkingLevel>,
}

/// Configuration for a voice chat request (native multimodal audio)
pub struct VoiceChatRequestConfig {
    pub messages: Vec<serde_json::Value>,
    pub audio_base64: String,
    pub system_prompt: Option<String>,
    pub thinking_config: Option<ThinkingLevel>,
    pub web_search_enabled: bool,
}

/// Parsed SSE events from Gemini's streaming API
/// Gemini uses simpler JSON chunks with candidates array
#[derive(Debug, Clone)]
pub enum GeminiStreamEvent {
    /// Text delta - incremental text content
    TextDelta { text: String },
    /// Thinking content delta - for ephemeral UI display
    ThinkingDelta { text: String },
    /// Response complete. `finish_reason` is Gemini's reason (e.g. "STOP",
    /// "MAX_TOKENS", "SAFETY", "RECITATION") so the handler can distinguish a
    /// clean finish from a truncated/blocked one.
    ResponseComplete { finish_reason: String },
    /// Grounding metadata (search results)
    GroundingMetadata { metadata: GroundingInfo },
    /// Error occurred
    Error { message: String },
    /// Code execution: Python code to be executed
    ExecutableCode { code: String },
    /// Code execution: Output from executed code
    CodeExecutionResult { output: String },
    /// Inline data: Generated file (image, CSV, etc.) as base64
    InlineData { mime_type: String, data: String },
    /// Unknown/unhandled event
    Unknown,
}

/// Grounding information from Google Search
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundingInfo {
    pub web_search_queries: Vec<String>,
    pub grounding_chunks: Vec<GroundingChunk>,
    #[serde(default)]
    pub grounding_supports: Vec<GroundingSupport>,
}

/// Links a text segment to its supporting sources
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundingSupport {
    pub segment: GroundingSegment,
    #[serde(default)]
    pub grounding_chunk_indices: Vec<usize>,
}

/// A segment of text with byte offsets
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundingSegment {
    #[serde(default)]
    pub start_index: usize,
    #[serde(default)]
    pub end_index: usize,
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundingChunk {
    pub web: Option<WebChunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebChunk {
    pub uri: String,
    pub title: String,
}

impl GeminiClient {
    pub fn new(api_key: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
        }
    }

    /// Build the streaming endpoint URL for a model
    fn build_stream_url(&self, model: &str) -> String {
        format!(
            "{}/{}:streamGenerateContent?alt=sse&key={}",
            GEMINI_API_URL, model, self.api_key
        )
    }

    /// Build the request body for a chat message
    pub fn build_chat_request(&self, config: &ChatRequestConfig) -> serde_json::Value {
        // Convert messages to Gemini format
        // Gemini uses "contents" array with role-based parts
        let mut contents: Vec<serde_json::Value> = Vec::new();

        for msg in &config.messages {
            let role = msg["role"].as_str().unwrap_or("user");
            let content = &msg["content"];

            // Map roles: Gemini uses "user" and "model" (not "assistant")
            let gemini_role = if role == "assistant" { "model" } else { role };

            // Build parts array
            let parts = if let Some(text) = content.as_str() {
                // Simple string content
                serde_json::json!([{"text": text}])
            } else if let Some(arr) = content.as_array() {
                // Array of content blocks - convert to Gemini format
                let converted: Vec<serde_json::Value> = arr
                    .iter()
                    .filter_map(|block| {
                        let block_type = block["type"].as_str()?;
                        match block_type {
                            "text" => {
                                let text = block["text"].as_str()?;
                                Some(serde_json::json!({"text": text}))
                            }
                            "image" => {
                                // Convert to Gemini inline_data format
                                let source = &block["source"];
                                let media_type = source["media_type"].as_str()?;
                                let data = source["data"].as_str()?;
                                Some(serde_json::json!({
                                    "inline_data": {
                                        "mime_type": media_type,
                                        "data": data
                                    }
                                }))
                            }
                            "document" => {
                                // PDF as inline_data
                                let source = &block["source"];
                                let data = source["data"].as_str()?;
                                Some(serde_json::json!({
                                    "inline_data": {
                                        "mime_type": "application/pdf",
                                        "data": data
                                    }
                                }))
                            }
                            "file" => {
                                // Generic file: send as inline_data with original MIME type
                                let source = &block["source"];
                                let media_type = source["media_type"].as_str()?;
                                let data = source["data"].as_str()?;
                                Some(serde_json::json!({
                                    "inline_data": {
                                        "mime_type": media_type,
                                        "data": data
                                    }
                                }))
                            }
                            _ => None,
                        }
                    })
                    .collect();
                serde_json::json!(converted)
            } else {
                serde_json::json!([{"text": ""}])
            };

            contents.push(serde_json::json!({
                "role": gemini_role,
                "parts": parts
            }));
        }

        let mut body = serde_json::json!({
            "contents": contents
        });

        // Add system instruction. When code execution is enabled, append guidance
        // telling Gemini the app can render images / serve file downloads and that
        // saving a file to the working directory hands it off; otherwise Gemini 3.x
        // answers visual/file requests as ASCII or text and returns no inlineData.
        let mut system_text = config.system_prompt.clone().unwrap_or_default();
        if config.code_execution_enabled {
            system_text.push_str(GEMINI_CODE_EXEC_FILE_GUIDANCE);
        }
        if !system_text.is_empty() {
            body["systemInstruction"] = serde_json::json!({
                "parts": [{"text": system_text}]
            });
        }

        // Add thinking configuration if enabled.
        // Gemini 3.x uses thinkingLevel; includeThoughts returns thinking summaries.
        if let Some(level) = &config.thinking_config {
            body["generationConfig"] = serde_json::json!({
                "thinkingConfig": {
                    "thinkingLevel": level.as_str(),
                    "includeThoughts": true
                }
            });
        }

        // Build tools array
        let mut tools: Vec<serde_json::Value> = Vec::new();

        // Add Google Search tool if enabled
        if config.web_search_enabled {
            tools.push(serde_json::json!({"google_search": {}}));
        }

        // Add Code Execution tool if enabled
        if config.code_execution_enabled {
            tools.push(serde_json::json!({"codeExecution": {}}));
        }

        // Add tools to request body if any are enabled
        if !tools.is_empty() {
            body["tools"] = serde_json::json!(tools);
        }

        body
    }

    /// Build the request body for a discovery request
    pub fn build_discovery_request(&self, config: &DiscoveryRequestConfig) -> serde_json::Value {
        let mut body = serde_json::json!({
            "systemInstruction": {
                "parts": [{"text": config.system_prompt}]
            },
            "contents": [{
                "role": "user",
                "parts": [{"text": config.conversation}]
            }],
            "tools": [{
                "google_search": {}
            }]
        });

        // Add thinking configuration if enabled.
        // Gemini 3.x uses thinkingLevel; no thinking summaries for internal discovery.
        if let Some(level) = &config.thinking_config {
            body["generationConfig"] = serde_json::json!({
                "thinkingConfig": {"thinkingLevel": level.as_str()}
            });
        }

        body
    }

    /// Build the request body for a voice chat message (native multimodal audio)
    /// The audio is sent as inlineData and the system prompt instructs Gemini
    /// to first output a transcription, then respond.
    pub fn build_voice_chat_request(&self, config: &VoiceChatRequestConfig) -> serde_json::Value {
        // Convert previous messages to Gemini format (same as build_chat_request)
        let mut contents: Vec<serde_json::Value> = Vec::new();

        for msg in &config.messages {
            let role = msg["role"].as_str().unwrap_or("user");
            let content = &msg["content"];
            let gemini_role = if role == "assistant" { "model" } else { role };

            let parts = if let Some(text) = content.as_str() {
                serde_json::json!([{"text": text}])
            } else if let Some(arr) = content.as_array() {
                let converted: Vec<serde_json::Value> = arr
                    .iter()
                    .filter_map(|block| {
                        let block_type = block["type"].as_str()?;
                        match block_type {
                            "text" => {
                                let text = block["text"].as_str()?;
                                Some(serde_json::json!({"text": text}))
                            }
                            "image" => {
                                let source = &block["source"];
                                let media_type = source["media_type"].as_str()?;
                                let data = source["data"].as_str()?;
                                Some(serde_json::json!({
                                    "inline_data": {
                                        "mime_type": media_type,
                                        "data": data
                                    }
                                }))
                            }
                            "document" => {
                                let source = &block["source"];
                                let data = source["data"].as_str()?;
                                Some(serde_json::json!({
                                    "inline_data": {
                                        "mime_type": "application/pdf",
                                        "data": data
                                    }
                                }))
                            }
                            _ => None,
                        }
                    })
                    .collect();
                serde_json::json!(converted)
            } else {
                serde_json::json!([{"text": ""}])
            };

            contents.push(serde_json::json!({
                "role": gemini_role,
                "parts": parts
            }));
        }

        // Add the new user message with audio as inlineData
        contents.push(serde_json::json!({
            "role": "user",
            "parts": [{
                "inlineData": {
                    "mimeType": "audio/wav",
                    "data": config.audio_base64
                }
            }]
        }));

        // Build system instruction with transcription prefix
        let transcription_instruction = "IMPORTANT: The user has sent an audio message. First, output the exact transcription of what they said wrapped in [TRANSCRIPTION] and [/TRANSCRIPTION] tags on its own line. Then provide your response on a new line.\n\nExample format:\n[TRANSCRIPTION]What the user said[/TRANSCRIPTION]\n\nYour response here.\n\n";

        let system_prompt = if let Some(base_prompt) = &config.system_prompt {
            format!("{}{}", transcription_instruction, base_prompt)
        } else {
            transcription_instruction.to_string()
        };

        let mut body = serde_json::json!({
            "contents": contents,
            "systemInstruction": {
                "parts": [{"text": system_prompt}]
            }
        });

        // Add thinking configuration if enabled.
        // Include thinking summaries for voice chat (user-facing).
        if let Some(level) = &config.thinking_config {
            body["generationConfig"] = serde_json::json!({
                "thinkingConfig": {
                    "thinkingLevel": level.as_str(),
                    "includeThoughts": true
                }
            });
        }

        // Add Google Search tool if enabled
        if config.web_search_enabled {
            body["tools"] = serde_json::json!([{
                "google_search": {}
            }]);
        }

        body
    }

    /// Send a streaming request and return the response
    pub async fn send_streaming_request(
        &self,
        model: &str,
        body: &serde_json::Value,
    ) -> Result<reqwest::Response, String> {
        let url = self.build_stream_url(model);

        let response = self
            .client
            .post(&url)
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

    /// Build the non-streaming endpoint URL for a model
    fn build_url(&self, model: &str) -> String {
        format!(
            "{}/{}:generateContent?key={}",
            GEMINI_API_URL, model, self.api_key
        )
    }

    /// Build the request body for transcription-only (no chat response)
    pub fn build_transcription_request(&self, audio_base64: &str) -> serde_json::Value {
        serde_json::json!({
            "contents": [{
                "role": "user",
                "parts": [{
                    "inlineData": {
                        "mimeType": "audio/wav",
                        "data": audio_base64
                    }
                }]
            }],
            "systemInstruction": {
                "parts": [{"text": "Output ONLY the exact transcription of the audio. Do not add any other text, commentary, or formatting."}]
            }
        })
    }

    /// Send a non-streaming request and return the response text
    pub async fn send_request(
        &self,
        model: &str,
        body: &serde_json::Value,
    ) -> Result<String, String> {
        let url = self.build_url(model);

        let response = self
            .client
            .post(&url)
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

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        // Extract text from the response
        // Response format: { "candidates": [{ "content": { "parts": [{ "text": "..." }] } }] }
        let text = json["candidates"]
            .as_array()
            .and_then(|c| c.first())
            .and_then(|c| c["content"]["parts"].as_array())
            .and_then(|p| p.first())
            .and_then(|p| p["text"].as_str())
            .unwrap_or("")
            .to_string();

        Ok(text)
    }
}

/// Parse a single SSE data payload into a list of GeminiStreamEvents
/// Gemini SSE format: data: {"candidates": [...], "usageMetadata": {...}}
/// A single SSE event can contain multiple parts (text, code, inlineData, etc.)
pub fn parse_sse_event(data: &str) -> Vec<GeminiStreamEvent> {
    let parsed: serde_json::Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(_) => return vec![GeminiStreamEvent::Unknown],
    };

    let mut events = Vec::new();

    // Check for error
    if let Some(error) = parsed.get("error") {
        let message = error["message"]
            .as_str()
            .unwrap_or("Unknown error")
            .to_string();
        return vec![GeminiStreamEvent::Error { message }];
    }

    // Check for grounding metadata (search results)
    // groundingMetadata can be at root level OR nested inside candidates[0]
    let grounding_opt = parsed.get("groundingMetadata").or_else(|| {
        parsed["candidates"]
            .as_array()
            .and_then(|c| c.first())
            .and_then(|first| first.get("groundingMetadata"))
    });

    if let Some(grounding) = grounding_opt {
        let queries: Vec<String> = grounding["webSearchQueries"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let chunks: Vec<GroundingChunk> = grounding["groundingChunks"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|chunk| {
                        let web = chunk.get("web")?;
                        Some(GroundingChunk {
                            web: Some(WebChunk {
                                uri: web["uri"].as_str()?.to_string(),
                                title: web["title"].as_str().unwrap_or("").to_string(),
                            }),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Parse grounding supports (links text segments to sources)
        let supports: Vec<GroundingSupport> = grounding["groundingSupports"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|support| {
                        let segment = support.get("segment")?;
                        Some(GroundingSupport {
                            segment: GroundingSegment {
                                start_index: segment["startIndex"].as_u64().unwrap_or(0) as usize,
                                end_index: segment["endIndex"].as_u64().unwrap_or(0) as usize,
                                text: segment["text"].as_str().unwrap_or("").to_string(),
                            },
                            grounding_chunk_indices: support["groundingChunkIndices"]
                                .as_array()
                                .map(|indices| {
                                    indices
                                        .iter()
                                        .filter_map(|i| i.as_u64().map(|n| n as usize))
                                        .collect()
                                })
                                .unwrap_or_default(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        if !queries.is_empty() || !chunks.is_empty() || !supports.is_empty() {
            events.push(GeminiStreamEvent::GroundingMetadata {
                metadata: GroundingInfo {
                    web_search_queries: queries,
                    grounding_chunks: chunks,
                    grounding_supports: supports,
                },
            });
        }
    }

    // Extract content from candidates - collect ALL parts, not just first
    if let Some(candidates) = parsed["candidates"].as_array() {
        if let Some(first_candidate) = candidates.first() {
            if let Some(content) = first_candidate.get("content") {
                if let Some(parts) = content["parts"].as_array() {
                    for part in parts {
                        // Check if this is a thinking part
                        if part.get("thought").and_then(|v| v.as_bool()) == Some(true) {
                            // Extract thinking text for ephemeral UI display
                            if let Some(thinking_text) = part["text"].as_str() {
                                events.push(GeminiStreamEvent::ThinkingDelta {
                                    text: thinking_text.to_string(),
                                });
                            }
                            continue;
                        }

                        // Check for executableCode (code execution tool)
                        if let Some(exec_code) = part.get("executableCode") {
                            if let Some(code) = exec_code["code"].as_str() {
                                events.push(GeminiStreamEvent::ExecutableCode {
                                    code: code.to_string(),
                                });
                            }
                        }

                        // Check for codeExecutionResult (output from code execution)
                        if let Some(result) = part.get("codeExecutionResult") {
                            if let Some(output) = result["output"].as_str() {
                                events.push(GeminiStreamEvent::CodeExecutionResult {
                                    output: output.to_string(),
                                });
                            }
                        }

                        // Check for inlineData (generated files/images)
                        if let Some(inline_data) = part.get("inlineData") {
                            if let (Some(mime_type), Some(data)) = (
                                inline_data["mimeType"].as_str(),
                                inline_data["data"].as_str(),
                            ) {
                                events.push(GeminiStreamEvent::InlineData {
                                    mime_type: mime_type.to_string(),
                                    data: data.to_string(),
                                });
                            }
                        }

                        // Regular text part
                        if let Some(text) = part["text"].as_str() {
                            events.push(GeminiStreamEvent::TextDelta {
                                text: text.to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    // Check for finishReason in candidates (indicates completion)
    // Note: usageMetadata is sent with EVERY chunk, so we can't use that as completion signal
    if let Some(candidates) = parsed["candidates"].as_array() {
        if let Some(first_candidate) = candidates.first() {
            if let Some(finish_reason) = first_candidate
                .get("finishReason")
                .and_then(|v| v.as_str())
            {
                events.push(GeminiStreamEvent::ResponseComplete {
                    finish_reason: finish_reason.to_string(),
                });
            }
        }
    }

    if events.is_empty() {
        vec![GeminiStreamEvent::Unknown]
    } else {
        events
    }
}

/// Map MIME type to file extension
pub fn mime_to_extension(mime_type: &str) -> &'static str {
    match mime_type {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "text/csv" => "csv",
        "application/json" => "json",
        "text/plain" => "txt",
        "application/pdf" => "pdf",
        "text/html" => "html",
        "application/xml" | "text/xml" => "xml",
        // Programming languages - Gemini returns these from code execution
        "text/x-python" | "application/x-python" => "py",
        "text/javascript" | "application/javascript" => "js",
        "text/x-java" | "text/java" => "java",
        "text/x-c" => "c",
        "text/x-c++" | "text/x-cpp" => "cpp",
        "text/x-typescript" => "ts",
        "text/markdown" => "md",
        _ => "bin",
    }
}

/// Extensions we treat as "generated files" when correlating code-execution
/// output to the model's prose. Used by both filename extractors below.
const GENERATED_FILE_EXTS: &str =
    "png|jpe?g|gif|webp|svg|csv|json|txt|pdf|xlsx|xls|docx|pptx|html|md";

/// The final path component of a (possibly path-prefixed) filename.
fn file_basename(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

/// Extract the filenames a code block writes, as basenames, in first-seen order
/// with duplicates removed. Matches quoted string literals that end in a known
/// generated-file extension (e.g. `plt.savefig('chart.png')`, `doc.save("r.pdf")`).
/// `inlineData` parts are anonymous, so this is how we recover a file's name and
/// pair it (FIFO) with the file the sandbox returns.
pub fn extract_saved_filenames(code: &str) -> Vec<String> {
    let re = Regex::new(&format!(
        r#"(?i)['"]([\w./\\-]+\.(?:{}))['"]"#,
        GENERATED_FILE_EXTS
    ))
    .expect("valid saved-filename regex");
    let mut out: Vec<String> = Vec::new();
    for cap in re.captures_iter(code) {
        let name = file_basename(&cap[1]);
        if !out.iter().any(|n| n.eq_ignore_ascii_case(&name)) {
            out.push(name);
        }
    }
    out
}

/// Lowercased file extension (without the dot), or "" if none.
fn file_ext(filename: &str) -> String {
    match filename.rsplit_once('.') {
        Some((_, ext)) if !ext.is_empty() => ext.to_lowercase(),
        _ => String::new(),
    }
}

/// Normalize equivalent extensions so comparisons match (e.g. jpeg == jpg).
fn normalize_ext(ext: &str) -> &str {
    match ext {
        "jpeg" => "jpg",
        other => other,
    }
}

/// Is this an image file extension?
fn is_image_ext(ext: &str) -> bool {
    matches!(
        ext,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "tiff" | "ico"
    )
}

/// Choose which pending saved-filename belongs to a returned `inlineData` part of
/// the given MIME type. The code's save order and the sandbox's return order don't
/// always match, so pairing by position swaps names (e.g. a PNG getting a `.json`
/// name). Instead we match by content type: first an exact extension match, then
/// the same image/non-image category, so a `image/png` part takes an image name and
/// a `application/json` part takes a non-image name. Returns the index to remove, or
/// None if nothing suitable is pending (caller falls back to a synthetic name).
pub fn pick_filename_index_for_mime(pending: &[String], mime: &str) -> Option<usize> {
    if pending.is_empty() {
        return None;
    }
    let target = normalize_ext(mime_to_extension(mime));
    // 1) Exact extension match.
    if let Some(i) = pending
        .iter()
        .position(|f| normalize_ext(&file_ext(f)) == target)
    {
        return Some(i);
    }
    // 2) Same category (image vs non-image) — handles MIME types we don't map to a
    //    specific extension, and minor mismatches like jpg vs png.
    let mime_is_image = mime.starts_with("image/");
    pending
        .iter()
        .position(|f| is_image_ext(&normalize_ext(&file_ext(f))) == mime_is_image)
}

/// Extract the filenames the model references in its prose, as lowercased
/// basenames. These are the files it "presents" to the user; anything generated
/// but not named here is treated as an intermediate/working file.
pub fn extract_referenced_filenames(text: &str) -> std::collections::HashSet<String> {
    let re = Regex::new(&format!(
        r"(?i)[\w./\\-]+\.(?:{})",
        GENERATED_FILE_EXTS
    ))
    .expect("valid referenced-filename regex");
    re.find_iter(text)
        .map(|m| file_basename(m.as_str()).to_lowercase())
        .collect()
}

/// Inline citation with position information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InlineCitation {
    pub url: String,
    pub title: String,
    pub cited_text: String,
    pub char_offset: usize,
}

/// Extract inline citations from grounding metadata with proper character offsets.
/// Uses groundingSupports to map text segments to their sources.
/// The response_text is needed to convert byte offsets to character offsets.
pub fn extract_inline_citations_from_grounding(
    metadata: &GroundingInfo,
    response_text: &str,
) -> Vec<InlineCitation> {
    let mut citations = Vec::new();

    // If no grounding supports, fall back to placing all citations at the end
    if metadata.grounding_supports.is_empty() {
        let char_offset = response_text.chars().count();
        for chunk in &metadata.grounding_chunks {
            if let Some(web) = &chunk.web {
                citations.push(InlineCitation {
                    url: web.uri.clone(),
                    title: web.title.clone(),
                    cited_text: String::new(),
                    char_offset,
                });
            }
        }
        return citations;
    }

    // Process each grounding support to create inline citations
    for support in &metadata.grounding_supports {
        // Get the first source for this segment (typically there's one primary source)
        // We could also show multiple sources, but for simplicity take the first
        if let Some(&chunk_idx) = support.grounding_chunk_indices.first() {
            if let Some(chunk) = metadata.grounding_chunks.get(chunk_idx) {
                if let Some(web) = &chunk.web {
                    // Convert byte offset to character offset
                    // Gemini API uses byte offsets, we need character offsets
                    let char_offset = byte_offset_to_char_offset(response_text, support.segment.end_index);

                    citations.push(InlineCitation {
                        url: web.uri.clone(),
                        title: web.title.clone(),
                        cited_text: support.segment.text.clone(),
                        char_offset,
                    });
                }
            }
        }
    }

    citations
}

/// Convert a byte offset to a character offset in a UTF-8 string.
/// This handles multi-byte UTF-8 characters correctly.
fn byte_offset_to_char_offset(text: &str, byte_offset: usize) -> usize {
    // Clamp byte_offset to valid range
    let byte_offset = byte_offset.min(text.len());

    // Count characters up to the byte offset
    text[..byte_offset].chars().count()
}

/// Convert a thinking level string from the frontend to a [`ThinkingLevel`].
/// Frontend sends "minimal", "low", "medium", or "high" (Gemini 3.x). Anything
/// else ("off"/"none"/unknown) disables thinking.
pub fn string_to_thinking_config(level: &str, model: &str) -> Option<ThinkingLevel> {
    match level.to_lowercase().as_str() {
        "minimal" => Some(ThinkingLevel::Minimal),
        "low" => Some(ThinkingLevel::Low),
        // Only 3.x Flash supports medium; 3.1 Pro falls back to low.
        "medium" => {
            if is_gemini_3_flash_model(model) {
                Some(ThinkingLevel::Medium)
            } else {
                Some(ThinkingLevel::Low)
            }
        }
        "high" => Some(ThinkingLevel::High),
        _ => None,
    }
}

/// Check if model is Gemini 3.x Flash (supports all thinking levels)
pub fn is_gemini_3_flash_model(model: &str) -> bool {
    (model.contains("gemini-3") || model.contains("gemini3")) && model.contains("flash")
}

/// Check if model supports thinking/reasoning
pub fn supports_thinking(model: &str) -> bool {
    // Gemini 3.x models support thinking
    model.contains("gemini-3") || model.contains("gemini3")
}

#[cfg(test)]
mod filename_tests {
    use super::{
        extract_referenced_filenames, extract_saved_filenames, pick_filename_index_for_mime,
    };

    #[test]
    fn pairing_unswaps_when_return_order_differs_from_save_order() {
        // Code saved JSON first, then PNG; sandbox returns PNG first, then JSON.
        let mut pending = vec![
            "canada_population_1980_present.json".to_string(),
            "canada_population_trend.png".to_string(),
        ];
        // PNG part arrives first -> must take the .png name, not the first (.json).
        let i = pick_filename_index_for_mime(&pending, "image/png").unwrap();
        assert_eq!(pending.remove(i), "canada_population_trend.png");
        // JSON part arrives second -> takes the remaining .json name.
        let i = pick_filename_index_for_mime(&pending, "application/json").unwrap();
        assert_eq!(pending.remove(i), "canada_population_1980_present.json");
    }

    #[test]
    fn pairing_exact_extension_in_save_order() {
        let pending = vec!["chart.png".to_string(), "data.csv".to_string()];
        assert_eq!(pick_filename_index_for_mime(&pending, "image/png"), Some(0));
        assert_eq!(pick_filename_index_for_mime(&pending, "text/csv"), Some(1));
    }

    #[test]
    fn pairing_image_category_when_no_exact_extension() {
        // Saved as .jpeg but the part is image/png — still an image, so it matches.
        let pending = vec!["photo.jpeg".to_string()];
        assert_eq!(pick_filename_index_for_mime(&pending, "image/png"), Some(0));
    }

    #[test]
    fn pairing_non_image_mime_skips_image_names() {
        // A document part shouldn't grab an image filename.
        let pending = vec!["chart.png".to_string(), "report.docx".to_string()];
        let i = pick_filename_index_for_mime(
            &pending,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        .unwrap();
        assert_eq!(pending[i], "report.docx");
    }

    #[test]
    fn pairing_no_suitable_name_returns_none() {
        // Only an image name is pending, but the part is a CSV -> synthetic name (None).
        let pending = vec!["chart.png".to_string()];
        assert_eq!(pick_filename_index_for_mime(&pending, "text/csv"), None);
        assert_eq!(pick_filename_index_for_mime(&[], "image/png"), None);
    }

    #[test]
    fn parser_captures_non_stop_finish_reason() {
        let data = r#"{"candidates":[{"content":{"parts":[{"text":"partial"}]},"finishReason":"MAX_TOKENS"}]}"#;
        let events = super::parse_sse_event(data);
        let captured = events.iter().any(|e| matches!(
            e,
            super::GeminiStreamEvent::ResponseComplete { finish_reason } if finish_reason == "MAX_TOKENS"
        ));
        assert!(captured, "expected ResponseComplete {{ MAX_TOKENS }}, got {:?}", events);
    }

    #[test]
    fn saved_filenames_basic_savefig() {
        assert_eq!(
            extract_saved_filenames("plt.savefig('canada_population_trend.png')"),
            vec!["canada_population_trend.png"]
        );
    }

    #[test]
    fn saved_filenames_strip_path() {
        assert_eq!(
            extract_saved_filenames("img.save(\"/tmp/out/red.png\")"),
            vec!["red.png"]
        );
    }

    #[test]
    fn saved_filenames_dedupe_within_block() {
        // Mentioned twice (save + a print) but it's one file.
        let code = "plt.savefig('x.png')\nprint('wrote x.png')";
        assert_eq!(extract_saved_filenames(code), vec!["x.png"]);
    }

    #[test]
    fn saved_filenames_multiple_distinct_in_order() {
        let code = "plt.savefig('a.png')\ndf.to_csv('b.csv')";
        assert_eq!(extract_saved_filenames(code), vec!["a.png", "b.csv"]);
    }

    #[test]
    fn saved_filenames_none_for_show_only() {
        assert!(extract_saved_filenames("plt.plot(x, y)\nplt.show()").is_empty());
    }

    #[test]
    fn referenced_filenames_from_bold_code_span() {
        let text = "The graph has been saved as **`canada_population_trend.png`** and is available.";
        let refs = extract_referenced_filenames(text);
        assert!(refs.contains("canada_population_trend.png"));
    }

    #[test]
    fn referenced_filenames_case_insensitive_basename() {
        let text = "See [the file](./out/Chart.PNG) for details.";
        let refs = extract_referenced_filenames(text);
        assert!(refs.contains("chart.png"));
    }
}
