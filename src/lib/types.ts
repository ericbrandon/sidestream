// LLM Provider types
export type LLMProvider = 'anthropic' | 'openai' | 'google';

export interface ModelDefinition {
  id: string;
  name: string;
  provider: LLMProvider;
}

export interface ApiKeysConfig {
  anthropic: boolean;
  openai: boolean;
  google: boolean;
}

// Attachment types for files/images
export interface Attachment {
  id: string;
  type: 'image' | 'document';
  name: string;
  mimeType: string;
  data: string; // Base64 encoded
  preview?: string; // For images
}

// Chat message types
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  attachments?: Attachment[];
  citations?: Citation[];
  inlineCitations?: InlineCitation[]; // Citations with positions for inline rendering
  includedDiscovery?: {
    id: string;
    title: string;
    sourceUrl: string;
  };
  turnId?: string; // Associates user+assistant messages within a turn
}

// Discovery item types
export interface DiscoveryItem {
  id: string;
  title: string;
  oneLiner: string;
  fullSummary: string;
  relevanceExplanation: string;
  sourceUrl: string;
  sourceDomain: string;
  category: 'tool' | 'article' | 'video' | 'paper' | 'discussion' | 'other';
  relevanceScore: number;
  timestamp: Date;
  isExpanded: boolean;
  turnId: string;
  sessionId: string; // Scopes discovery to a chat session
  modeId?: import('./discoveryModes').DiscoveryModeId; // Which mode generated this chip (optional for backward compat)
}

// Extended thinking configuration (for Anthropic Claude models)
export interface ExtendedThinkingConfig {
  enabled: boolean;
  budgetTokens: number; // 1024-32000
}

// Reasoning level options for OpenAI models
// GPT-5 series supports: off (none), minimal, low, medium, high, xhigh (5.2 only)
export type OpenAIReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

// Thinking level options for Google Gemini models
// Gemini 3 Pro: off, low, high
// Gemini 3 Flash: off, minimal, low, medium, high
// Gemini 2.5: off, on (maps to thinkingBudget of 10000)
export type GeminiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'on';

// Theme mode for dark/light mode support
export type ThemeMode = 'light' | 'dark' | 'system';

// Voice input model - which transcription service to use (auto-determined from API keys)
export type VoiceModel = 'none' | 'openai' | 'gemini';

// Voice input mode - how voice input behaves (user-configurable)
export type VoiceMode = 'none' | 'textbox' | 'chat_request';

// LLM configuration
export interface LLMConfig {
  model: string;
  apiKeyConfigured: boolean;
  extendedThinking: ExtendedThinkingConfig; // For Anthropic
  reasoningLevel: OpenAIReasoningLevel; // For OpenAI
  geminiThinkingLevel: GeminiThinkingLevel; // For Google Gemini
  webSearchEnabled: boolean;
}

// API message format for Anthropic
export interface ApiMessage {
  role: string;
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: 'text' | 'image' | 'document';
  text?: string;
  source?: ImageSource | DocumentSource;
  filename?: string; // For document blocks (OpenAI requires this for PDFs)
}

export interface ImageSource {
  type: 'base64';
  media_type: string;
  data: string;
}

export interface DocumentSource {
  type: 'base64';
  media_type: 'application/pdf';
  data: string;
}

// Citation from web search (legacy - for backward compatibility)
export interface Citation {
  url: string;
  title: string;
  cited_text: string;
}

// Inline citation with position information for rendering in text
export interface InlineCitation {
  url: string;
  title: string;
  cited_text: string;
  char_offset: number; // Position in the response where citation marker should appear
}

// Stream delta from backend
export interface StreamDelta {
  text: string;
  citations?: Citation[];
  inline_citations?: InlineCitation[];
}

// Discovery mode type - re-exported from discoveryModes for convenience
export type { DiscoveryModeId } from './discoveryModes';

// Chat session types for persistence
export interface ChatSessionSettings {
  frontierModel: string;
  evaluatorModel: string;
  extendedThinkingEnabled: boolean;
  extendedThinkingBudget: number;
  webSearchEnabled: boolean;
  discoveryMode?: import('./discoveryModes').DiscoveryModeId;
  // Evaluator/discovery pane thinking settings (optional for backward compatibility)
  evaluatorExtendedThinkingEnabled?: boolean;
  evaluatorReasoningLevel?: OpenAIReasoningLevel;
  evaluatorGeminiThinkingLevel?: GeminiThinkingLevel;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string; // ISO string for JSON serialization
  updatedAt: string;
  messages: Message[];
  discoveryItems: DiscoveryItem[];
  settings: ChatSessionSettings;
}

export interface ChatSessionMeta {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  discoveryMode?: import('./discoveryModes').DiscoveryModeId;
}

// Export format for saved chats
export interface ChatExportData {
  version: 1;
  exportedAt: string;
  sessions: ChatSession[];
}
