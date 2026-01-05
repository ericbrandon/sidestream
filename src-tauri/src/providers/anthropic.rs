use serde::{Deserialize, Serialize};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Anthropic API client
pub struct AnthropicClient {
    client: reqwest::Client,
    api_key: String,
}

/// Configuration for a chat request
pub struct ChatRequestConfig {
    pub model: String,
    pub messages: Vec<serde_json::Value>,
    pub system_prompt: Option<String>,
    pub max_tokens: u32,
    pub extended_thinking: Option<ThinkingConfig>,
    pub web_search_enabled: bool,
}

/// Configuration for extended thinking
pub struct ThinkingConfig {
    pub budget_tokens: u32,
}

/// Configuration for a discovery request
pub struct DiscoveryRequestConfig {
    pub model: String,
    pub system_prompt: String,
    pub conversation: String,
    pub extended_thinking_enabled: Option<bool>,
    pub thinking_budget: Option<u32>,
}

/// Parsed SSE events from Anthropic's streaming API
#[derive(Debug, Clone)]
pub enum AnthropicStreamEvent {
    ContentBlockStart {
        block_type: String,
        #[allow(dead_code)]
        content_block: serde_json::Value,
    },
    ContentBlockDelta {
        text: Option<String>,
        thinking: Option<String>,
        citation: Option<Citation>, // citations_delta events
    },
    ContentBlockStop,
    MessageStop,
    Done,
    Unknown,
}

/// Citation from web search results (used for source list)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Citation {
    pub url: String,
    pub title: String,
    pub cited_text: String,
}

/// Inline citation with character position for rendering in text
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InlineCitation {
    pub url: String,
    pub title: String,
    pub cited_text: String,
    pub char_offset: usize, // Position in the response where citation marker should appear
}

impl AnthropicClient {
    pub fn new(api_key: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
        }
    }

    /// Build the request body for a chat message
    pub fn build_chat_request(&self, config: &ChatRequestConfig) -> serde_json::Value {
        let mut body = serde_json::json!({
            "model": config.model,
            "max_tokens": config.max_tokens,
            "stream": true,
            "messages": config.messages,
        });

        // Add extended thinking if enabled
        if let Some(thinking) = &config.extended_thinking {
            body["thinking"] = serde_json::json!({
                "type": "enabled",
                "budget_tokens": thinking.budget_tokens
            });
        }

        // Add web search tool if enabled
        if config.web_search_enabled {
            body["tools"] = serde_json::json!([{
                "type": "web_search_20250305",
                "name": "web_search"
            }]);
        }

        // Use prompt caching for the system prompt
        if let Some(system) = &config.system_prompt {
            body["system"] = serde_json::json!([
                {
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"}
                }
            ]);
        }

        body
    }

    /// Build the request body for a discovery request
    pub fn build_discovery_request(&self, config: &DiscoveryRequestConfig) -> serde_json::Value {
        let mut body = serde_json::json!({
            "model": config.model,
            "max_tokens": 4096,
            "stream": true,
            "system": [
                {
                    "type": "text",
                    "text": config.system_prompt,
                    "cache_control": {"type": "ephemeral"}
                }
            ],
            "tools": [{
                "type": "web_search_20250305",
                "name": "web_search"
            }],
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": config.conversation,
                            "cache_control": {"type": "ephemeral"}
                        }
                    ]
                }
            ]
        });

        // Add extended thinking if enabled
        if config.extended_thinking_enabled.unwrap_or(false) {
            let budget = config.thinking_budget.unwrap_or(10000);
            body["thinking"] = serde_json::json!({
                "type": "enabled",
                "budget_tokens": budget
            });
            // Extended thinking requires higher max_tokens
            body["max_tokens"] = serde_json::json!(16000);
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
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("API error: {}", error_text));
        }

        Ok(response)
    }
}

/// Parse a single SSE data payload into an AnthropicStreamEvent
pub fn parse_sse_event(data: &str) -> AnthropicStreamEvent {
    if data == "[DONE]" {
        return AnthropicStreamEvent::Done;
    }

    let parsed: serde_json::Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(_) => return AnthropicStreamEvent::Unknown,
    };

    let event_type = parsed["type"].as_str().unwrap_or("");

    match event_type {
        "content_block_start" => {
            let block_type = parsed["content_block"]["type"]
                .as_str()
                .unwrap_or("")
                .to_string();
            let content_block = parsed["content_block"].clone();
            AnthropicStreamEvent::ContentBlockStart {
                block_type,
                content_block,
            }
        }
        "content_block_delta" => {
            let delta_type = parsed["delta"]["type"].as_str().unwrap_or("");

            match delta_type {
                "citations_delta" => {
                    // Extract citation from citations_delta event
                    let citation_obj = &parsed["delta"]["citation"];
                    let citation = if let (Some(url), Some(title)) = (
                        citation_obj["url"].as_str(),
                        citation_obj["title"].as_str(),
                    ) {
                        Some(Citation {
                            url: url.to_string(),
                            title: title.to_string(),
                            cited_text: citation_obj["cited_text"]
                                .as_str()
                                .unwrap_or("")
                                .to_string(),
                        })
                    } else {
                        None
                    };
                    AnthropicStreamEvent::ContentBlockDelta {
                        text: None,
                        thinking: None,
                        citation,
                    }
                }
                _ => {
                    // text_delta or thinking_delta
                    let text = parsed["delta"]["text"].as_str().map(|s| s.to_string());
                    let thinking = parsed["delta"]["thinking"].as_str().map(|s| s.to_string());
                    AnthropicStreamEvent::ContentBlockDelta {
                        text,
                        thinking,
                        citation: None,
                    }
                }
            }
        }
        "content_block_stop" => AnthropicStreamEvent::ContentBlockStop,
        "message_stop" => AnthropicStreamEvent::MessageStop,
        _ => AnthropicStreamEvent::Unknown,
    }
}

/// Add Anthropic-style cache_control to the last message in a conversation
pub fn add_cache_control_to_last_message(messages: &mut Vec<serde_json::Value>) {
    if let Some(last_msg) = messages.last_mut() {
        // Convert content to array format with cache_control if it's a string
        if let Some(content_str) = last_msg["content"].as_str() {
            last_msg["content"] = serde_json::json!([
                {
                    "type": "text",
                    "text": content_str,
                    "cache_control": {"type": "ephemeral"}
                }
            ]);
        } else if let Some(content_arr) = last_msg["content"].as_array() {
            // Content is already an array, add cache_control to the last block
            let mut new_content = content_arr.clone();
            if let Some(last_block) = new_content.last_mut() {
                last_block["cache_control"] = serde_json::json!({"type": "ephemeral"});
            }
            last_msg["content"] = serde_json::json!(new_content);
        }
    }
}

/// Calculate max_tokens based on extended thinking settings
/// Base output is 8192 tokens, plus thinking budget if extended thinking is enabled
pub fn calculate_max_tokens(extended_thinking_enabled: bool, thinking_budget: Option<u32>) -> u32 {
    if extended_thinking_enabled {
        8192 + thinking_budget.unwrap_or(10000)
    } else {
        8192
    }
}
