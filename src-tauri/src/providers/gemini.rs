use serde::{Deserialize, Serialize};

const GEMINI_API_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

/// Google Gemini API client (Google AI Studio)
pub struct GeminiClient {
    client: reqwest::Client,
    api_key: String,
}

/// Configuration for a chat request
pub struct ChatRequestConfig {
    pub messages: Vec<serde_json::Value>,
    pub system_prompt: Option<String>,
    pub thinking_config: Option<ThinkingConfig>,
    pub web_search_enabled: bool,
}

/// Configuration for thinking/reasoning
/// Gemini 2.5 uses thinkingBudget (0-32768 tokens)
/// Gemini 3 uses thinkingLevel ("LOW" or "HIGH" for Pro; "minimal"/"low"/"medium"/"high" for Flash)
#[derive(Clone)]
pub enum ThinkingConfig {
    Budget(u32),          // For Gemini 2.5 models
    Level(ThinkingLevel), // For Gemini 3 models
}

#[derive(Clone, Copy, Debug)]
pub enum ThinkingLevel {
    Minimal, // Gemini 3 Flash only
    Low,
    Medium, // Gemini 3 Flash only
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
    pub thinking_config: Option<ThinkingConfig>,
}

/// Configuration for a voice chat request (native multimodal audio)
pub struct VoiceChatRequestConfig {
    pub messages: Vec<serde_json::Value>,
    pub audio_base64: String,
    pub system_prompt: Option<String>,
    pub thinking_config: Option<ThinkingConfig>,
    pub web_search_enabled: bool,
}

/// Parsed SSE events from Gemini's streaming API
/// Gemini uses simpler JSON chunks with candidates array
#[derive(Debug, Clone)]
pub enum GeminiStreamEvent {
    /// Text delta - incremental text content
    TextDelta { text: String },
    /// Thinking content (discarded)
    ThinkingDelta,
    /// Response complete
    ResponseComplete,
    /// Grounding metadata (search results)
    GroundingMetadata { metadata: GroundingInfo },
    /// Error occurred
    Error { message: String },
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

        // Add system instruction if provided
        if let Some(system) = &config.system_prompt {
            body["systemInstruction"] = serde_json::json!({
                "parts": [{"text": system}]
            });
        }

        // Add thinking configuration if enabled
        // Both Gemini 2.5 and 3 use nested thinkingConfig structure
        if let Some(thinking) = &config.thinking_config {
            let thinking_config = match thinking {
                // Gemini 2.5: uses thinkingBudget (token count)
                ThinkingConfig::Budget(budget) => {
                    serde_json::json!({"thinkingBudget": budget})
                }
                // Gemini 3: uses thinkingLevel ("LOW", "HIGH", etc.)
                ThinkingConfig::Level(level) => {
                    serde_json::json!({"thinkingLevel": level.as_str()})
                }
            };
            body["generationConfig"] = serde_json::json!({
                "thinkingConfig": thinking_config
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

        // Add thinking configuration if enabled
        // Both Gemini 2.5 and 3 use nested thinkingConfig structure
        if let Some(thinking) = &config.thinking_config {
            let thinking_config = match thinking {
                // Gemini 2.5: uses thinkingBudget (token count)
                ThinkingConfig::Budget(budget) => {
                    serde_json::json!({"thinkingBudget": budget})
                }
                // Gemini 3: uses thinkingLevel ("LOW", "HIGH", etc.)
                ThinkingConfig::Level(level) => {
                    serde_json::json!({"thinkingLevel": level.as_str()})
                }
            };
            body["generationConfig"] = serde_json::json!({
                "thinkingConfig": thinking_config
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

        // Add thinking configuration if enabled
        if let Some(thinking) = &config.thinking_config {
            let thinking_config = match thinking {
                ThinkingConfig::Budget(budget) => {
                    serde_json::json!({"thinkingBudget": budget})
                }
                ThinkingConfig::Level(level) => {
                    serde_json::json!({"thinkingLevel": level.as_str()})
                }
            };
            body["generationConfig"] = serde_json::json!({
                "thinkingConfig": thinking_config
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

/// Parse a single SSE data payload into a GeminiStreamEvent
/// Gemini SSE format: data: {"candidates": [...], "usageMetadata": {...}}
pub fn parse_sse_event(data: &str) -> GeminiStreamEvent {
    let parsed: serde_json::Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(_) => return GeminiStreamEvent::Unknown,
    };

    // Check for error
    if let Some(error) = parsed.get("error") {
        let message = error["message"]
            .as_str()
            .unwrap_or("Unknown error")
            .to_string();
        return GeminiStreamEvent::Error { message };
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
            return GeminiStreamEvent::GroundingMetadata {
                metadata: GroundingInfo {
                    web_search_queries: queries,
                    grounding_chunks: chunks,
                    grounding_supports: supports,
                },
            };
        }
    }

    // Extract text from candidates
    if let Some(candidates) = parsed["candidates"].as_array() {
        if let Some(first_candidate) = candidates.first() {
            if let Some(content) = first_candidate.get("content") {
                if let Some(parts) = content["parts"].as_array() {
                    // First pass: look for non-thinking text parts
                    for part in parts {
                        // Check if this is a thinking part (skip it)
                        if part.get("thought").and_then(|v| v.as_bool()) == Some(true) {
                            continue;
                        }
                        // Regular text part
                        if let Some(text) = part["text"].as_str() {
                            return GeminiStreamEvent::TextDelta {
                                text: text.to_string(),
                            };
                        }
                    }

                    // If we only found thinking parts, return ThinkingDelta
                    let has_thinking = parts.iter().any(|p| {
                        p.get("thought").and_then(|v| v.as_bool()) == Some(true)
                    });
                    if has_thinking {
                        return GeminiStreamEvent::ThinkingDelta;
                    }
                }
            }
        }
    }

    // Check for usage metadata (indicates completion)
    if parsed.get("usageMetadata").is_some() {
        return GeminiStreamEvent::ResponseComplete;
    }

    GeminiStreamEvent::Unknown
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

/// Convert a thinking level string from the frontend to ThinkingConfig
/// Frontend sends: "off", "on" (Gemini 2.5), "minimal", "low", "medium", "high" (Gemini 3)
pub fn string_to_thinking_config(level: &str, model: &str) -> Option<ThinkingConfig> {
    match level.to_lowercase().as_str() {
        "off" | "none" => None,
        "on" => {
            // Gemini 2.5: "on" maps to a thinking budget of 10000
            Some(ThinkingConfig::Budget(10000))
        }
        "minimal" => Some(ThinkingConfig::Level(ThinkingLevel::Minimal)),
        "low" => {
            if is_gemini_3_model(model) {
                Some(ThinkingConfig::Level(ThinkingLevel::Low))
            } else {
                // Gemini 2.5 fallback
                Some(ThinkingConfig::Budget(5000))
            }
        }
        "medium" => {
            if is_gemini_3_flash_model(model) {
                Some(ThinkingConfig::Level(ThinkingLevel::Medium))
            } else {
                // Gemini 2.5 fallback
                Some(ThinkingConfig::Budget(15000))
            }
        }
        "high" => {
            if is_gemini_3_model(model) {
                Some(ThinkingConfig::Level(ThinkingLevel::High))
            } else {
                // Gemini 2.5 fallback
                Some(ThinkingConfig::Budget(25000))
            }
        }
        _ => None, // Unknown level, don't enable thinking
    }
}

/// Check if model is a Gemini 3 model (uses thinkingLevel)
pub fn is_gemini_3_model(model: &str) -> bool {
    model.contains("gemini-3") || model.contains("gemini3")
}

/// Check if model is Gemini 3 Flash (supports all thinking levels)
pub fn is_gemini_3_flash_model(model: &str) -> bool {
    (model.contains("gemini-3") || model.contains("gemini3")) && model.contains("flash")
}

/// Check if model supports thinking/reasoning
pub fn supports_thinking(model: &str) -> bool {
    // Gemini 2.5+ and Gemini 3 support thinking
    model.contains("2.5") || model.contains("gemini-3") || model.contains("gemini3")
}
