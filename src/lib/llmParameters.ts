import type { LLMConfig } from './types';
import { getProviderFromModelId, usesAdaptiveThinking } from './models';
import { getValidOpenAIReasoningLevel, getValidAnthropicThinkingLevel } from './thinkingOptions';

interface ProviderThinkingParams {
  extendedThinkingEnabled: boolean;
  thinkingBudget: number | null;
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
  // (e.g., GPT-5 Pro only supports 'high', web search requires at least 'low')
  const effectiveReasoningLevel = provider === 'openai'
    ? getValidOpenAIReasoningLevel(llm.reasoningLevel, llm.model, llm.webSearchEnabled)
    : null;

  // For Anthropic models with adaptive thinking (Opus 4.6, Sonnet 4.6), get the effective thinking level
  const effectiveOpus46Level = provider === 'anthropic' && usesAdaptiveThinking(llm.model)
    ? getValidAnthropicThinkingLevel(llm.extendedThinking.opus46Level, llm.model)
    : null;

  return {
    // Anthropic: Extended thinking (for Opus 4.5 budget-based - must be boolean, not null - Rust expects bool)
    extendedThinkingEnabled: provider === 'anthropic' ? llm.extendedThinking.enabled : false,
    thinkingBudget:
      provider === 'anthropic' && llm.extendedThinking.enabled && !usesAdaptiveThinking(llm.model)
        ? llm.extendedThinking.budgetTokens
        : null,
    // Anthropic: Adaptive thinking level for Opus 4.6 / Sonnet 4.6 (off, low, medium, high, max, adaptive)
    opus46ThinkingLevel: effectiveOpus46Level,
    // OpenAI: Reasoning level (normalized for model)
    reasoningLevel: effectiveReasoningLevel,
    // Google Gemini: Thinking level
    geminiThinkingLevel: provider === 'google' ? llm.geminiThinkingLevel : null,
  };
}
