import type { LLMConfig } from './types';
import { getProviderFromModelId, usesAdaptiveThinking } from './models';
import {
  getValidOpenAIReasoningLevel,
  getValidAnthropicThinkingLevel,
  getValidGeminiThinkingLevel,
} from './thinkingOptions';

interface ProviderThinkingParams {
  extendedThinkingEnabled: boolean;
  opus46ThinkingLevel: string | null;
  reasoningLevel: string | null;
  geminiThinkingLevel: string | null;
}

/**
 * Build provider-specific thinking/reasoning parameters for LLM invocation.
 * Returns the appropriate params based on the model's provider.
 */
export function buildProviderThinkingParams(llm: LLMConfig): ProviderThinkingParams {
  const provider = getProviderFromModelId(llm.model);

  // For OpenAI, normalize reasoning level based on model capabilities and web search
  // (e.g., GPT-5.5 Pro only supports 'high', web search requires at least 'low')
  const effectiveReasoningLevel = provider === 'openai'
    ? getValidOpenAIReasoningLevel(llm.reasoningLevel, llm.model, llm.webSearchEnabled)
    : null;

  // For Anthropic models with adaptive thinking, get the effective thinking level
  const effectiveOpus46Level = provider === 'anthropic' && usesAdaptiveThinking(llm.model)
    ? getValidAnthropicThinkingLevel(llm.extendedThinking.opus46Level, llm.model)
    : null;

  // For Gemini, normalize the thinking level to one the model actually supports
  // (e.g. 'medium' is valid for 3.x Flash but not 3.1 Pro, which falls back to 'low').
  // Without this a level the model doesn't accept could reach the API unchanged.
  const effectiveGeminiThinkingLevel = provider === 'google'
    ? getValidGeminiThinkingLevel(llm.geminiThinkingLevel, llm.model)
    : null;

  return {
    // Derive "thinking on?" from the effective (normalized) level, NOT the stored
    // `.enabled` boolean. The boolean is read from a GLOBAL localStorage key at store
    // init (evaluatorExtendedThinkingEnabled, default false) while the level is stored
    // PER-MODEL, so after an app restart they can disagree: the level-based toggle
    // shows "on" while `.enabled` is false, and the discovery request would then
    // silently send no thinking (and no effort/max_tokens). Every other path already
    // treats enabled as (level !== 'off') — the model-switch branch and auto-select —
    // so deriving it here makes the send path agree with what the UI displays.
    // effectiveOpus46Level is null for non-adaptive / non-Anthropic models (Haiku 4.5,
    // which 400s on adaptive thinking), giving false. For always-on models (Fable 5,
    // Sonnet 5) the level is never 'off', so this is always true.
    extendedThinkingEnabled: effectiveOpus46Level !== null && effectiveOpus46Level !== 'off',
    // Anthropic: Adaptive thinking level for adaptive-thinking Claude models (off, low, medium, high, xhigh, max, adaptive)
    opus46ThinkingLevel: effectiveOpus46Level,
    // OpenAI: Reasoning level (normalized for model)
    reasoningLevel: effectiveReasoningLevel,
    // Google Gemini: Thinking level (normalized for model)
    geminiThinkingLevel: effectiveGeminiThinkingLevel,
  };
}
