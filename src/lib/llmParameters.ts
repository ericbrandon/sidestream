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

  // For Anthropic models with adaptive thinking (Opus 4.6, Sonnet 4.6), get the effective thinking level
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
    // Only adaptive-thinking models (Opus 4.7/4.6, Sonnet 4.6) accept the
    // `thinking: {type: "adaptive"}` request the backend sends when this is true.
    // Non-adaptive models like Haiku 4.5 reject it with a 400, so gate the flag the
    // same way opus46ThinkingLevel is gated below. (The chat path ignores this flag
    // and reads opus46ThinkingLevel instead, which is why only discovery broke.)
    extendedThinkingEnabled:
      provider === 'anthropic' && usesAdaptiveThinking(llm.model)
        ? llm.extendedThinking.enabled
        : false,
    // Anthropic: Adaptive thinking level for Opus 4.6 / Sonnet 4.6 (off, low, medium, high, max, adaptive)
    opus46ThinkingLevel: effectiveOpus46Level,
    // OpenAI: Reasoning level (normalized for model)
    reasoningLevel: effectiveReasoningLevel,
    // Google Gemini: Thinking level (normalized for model)
    geminiThinkingLevel: effectiveGeminiThinkingLevel,
  };
}
