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
  thinkingContent?: string; // Persisted thinking/reasoning content for collapsed display
  thinkingDurationMs?: number; // How long the model spent thinking
  // Code execution fields (for Claude code_execution, OpenAI code_interpreter)
  executionCode?: string; // The code that was executed
  executionOutput?: string; // Combined stdout/stderr from execution
  executionDurationMs?: number; // How long the execution took
  executionStatus?: 'success' | 'error'; // Final execution status
  executionError?: string; // Error message if execution failed
  executionTextPosition?: number; // Character position in content where execution occurred
  generatedFiles?: GeneratedFile[]; // Files created by code execution
  containerHint?: string; // Container context hint that was appended when this message was sent (for cache stability)
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

// Opus 4.6 thinking levels (combines adaptive thinking + effort)
// - off: no thinking
// - low/medium/high/max: adaptive thinking with explicit effort level
// - adaptive: adaptive thinking where Claude decides effort level
export type Opus46ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max' | 'adaptive';

// Extended thinking configuration (for Anthropic Claude models)
export interface ExtendedThinkingConfig {
  enabled: boolean;
  budgetTokens: number; // 1024-32000 (for Opus 4.5)
  opus46Level: Opus46ThinkingLevel; // For Opus 4.6
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

export interface ContentBlock {
  type: 'text' | 'image' | 'document' | 'file';
  text?: string;
  source?: ImageSource | DocumentSource | FileSource;
  filename?: string; // For document/file blocks
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

export interface FileSource {
  type: 'base64';
  media_type: string; // Any MIME type
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
  turn_id: string;
  text: string;
  citations?: Citation[];
  inline_citations?: InlineCitation[];
  thinking?: string;
  execution?: ExecutionDelta;
}

// Delta for code execution events (Claude code_execution, OpenAI code_interpreter)
export interface ExecutionDelta {
  tool_name: string; // "bash_code_execution", "text_editor_code_execution", "code_interpreter"
  stdout?: string;
  stderr?: string;
  status: ExecutionStatus;
  code?: string; // The code being executed (sent at start)
  files?: GeneratedFile[]; // Files generated by execution (sent on completion)
}

// Status of code execution
export type ExecutionStatus =
  | 'started'
  | 'running'
  | 'completed'
  | { failed: { error: string } };

// A file generated by code execution
export interface GeneratedFile {
  file_id: string; // Provider-specific file ID for downloading
  filename: string;
  mime_type?: string;
  // Populated client-side after download:
  blob_url?: string;
  download_error?: string;
  // For image files - base64 data URL for inline preview
  image_preview?: string;
  // Raw base64 data for file content (Gemini returns inline, persists across sessions)
  inline_data?: string;
}

// Supported image MIME types that can be displayed inline
export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
] as const;

// Image extensions (for filename-based detection)
export const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;

// Helper to check if a file is a displayable image
export function isImageFile(file: GeneratedFile): boolean {
  // Check by MIME type first
  if (file.mime_type) {
    const mt = file.mime_type.split(';')[0].trim().toLowerCase();
    if (SUPPORTED_IMAGE_MIME_TYPES.includes(mt as typeof SUPPORTED_IMAGE_MIME_TYPES[number])) {
      return true;
    }
  }
  // Fall back to extension check
  const ext = file.filename.split('.').pop()?.toLowerCase();
  return ext ? SUPPORTED_IMAGE_EXTENSIONS.includes(ext as typeof SUPPORTED_IMAGE_EXTENSIONS[number]) : false;
}

// Event payload for stream completion/cancellation events
export interface StreamEvent {
  turn_id: string;
}

// Event payload for container ID updates (Claude code execution)
export interface ContainerIdEvent {
  turn_id: string;
  container_id: string;
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
  // Frontier/chat model thinking settings (optional for backward compatibility)
  frontierReasoningLevel?: OpenAIReasoningLevel;
  frontierGeminiThinkingLevel?: GeminiThinkingLevel;
  frontierOpus46ThinkingLevel?: Opus46ThinkingLevel; // For Opus 4.6
  // Evaluator/discovery pane thinking settings (optional for backward compatibility)
  evaluatorExtendedThinkingEnabled?: boolean;
  evaluatorReasoningLevel?: OpenAIReasoningLevel;
  evaluatorGeminiThinkingLevel?: GeminiThinkingLevel;
  evaluatorOpus46ThinkingLevel?: Opus46ThinkingLevel; // For Opus 4.6
  // Claude code execution container ID (persists sandbox state across requests)
  anthropicContainerId?: string;
  // OpenAI code interpreter container ID (persists file access across requests)
  openaiContainerId?: string;
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
