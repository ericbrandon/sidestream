use serde::{Deserialize, Serialize};

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
}

/// Reasoning effort levels for OpenAI reasoning models
/// - GPT-5 series supports: none, minimal, low, medium, high, xhigh (5.2 only for xhigh)
/// - o-series (o3, o4-mini) supports: low, medium, high only
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ReasoningEffort {
    None,    // GPT-5 only - no reasoning tokens
    Minimal, // GPT-5 only - minimal reasoning
    Low,
    Medium,
    High,
    XHigh,   // GPT-5.2 only - extra high reasoning
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
    /// Text output complete with annotations (citations)
    TextDone {
        #[allow(dead_code)]
        text: String,
        annotations: Vec<UrlCitation>,
    },
    /// Web search started
    WebSearchStarted,
    /// Response completed
    ResponseCompleted,
    /// Stream finished
    Done,
    /// Error occurred
    Error { message: String },
    /// Unknown/unhandled event
    Unknown,
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

        // Add reasoning effort if enabled (for reasoning models like o3, o4-mini)
        if let Some(effort) = &config.reasoning_effort {
            body["reasoning"] = serde_json::json!({
                "effort": effort.as_str()
            });
        }

        // Add web search tool if enabled
        if config.web_search_enabled {
            body["tools"] = serde_json::json!([{
                "type": "web_search"
            }]);
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

        // Text output complete (may contain citations)
        "response.output_text.done" => {
            let text = parsed["text"].as_str().unwrap_or("").to_string();
            let annotations = parse_annotations(&parsed["annotations"]);
            OpenAIStreamEvent::TextDone { text, annotations }
        }

        // Web search item added
        "response.output_item.added" => {
            let item_type = parsed["item"]["type"].as_str().unwrap_or("");
            if item_type == "web_search_call" {
                OpenAIStreamEvent::WebSearchStarted
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

/// Parse annotations array from OpenAI response
fn parse_annotations(annotations: &serde_json::Value) -> Vec<UrlCitation> {
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

/// Convert a reasoning level string from the frontend to ReasoningEffort
/// Frontend sends: "off", "minimal", "low", "medium", "high", "xhigh" for GPT-5
///                 "low", "medium", "high" for o-series
pub fn string_to_reasoning_effort(level: &str) -> ReasoningEffort {
    match level.to_lowercase().as_str() {
        "off" | "none" => ReasoningEffort::None,
        "minimal" => ReasoningEffort::Minimal,
        "low" => ReasoningEffort::Low,
        "high" => ReasoningEffort::High,
        "xhigh" => ReasoningEffort::XHigh,
        _ => ReasoningEffort::Medium, // Default
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

