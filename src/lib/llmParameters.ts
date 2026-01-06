import type { LLMConfig } from './types';
import { getProviderFromModelId } from './models';
import { getValidOpenAIReasoningLevel } from './thinkingOptions';

interface ProviderThinkingParams {
  extendedThinkingEnabled: boolean;
  thinkingBudget: number | null;
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

  return {
    // Anthropic: Extended thinking (must be boolean, not null - Rust expects bool)
    extendedThinkingEnabled: provider === 'anthropic' ? llm.extendedThinking.enabled : false,
    thinkingBudget:
      provider === 'anthropic' && llm.extendedThinking.enabled
        ? llm.extendedThinking.budgetTokens
        : null,
    // OpenAI: Reasoning level (normalized for model)
    reasoningLevel: effectiveReasoningLevel,
    // Google Gemini: Thinking level
    geminiThinkingLevel: provider === 'google' ? llm.geminiThinkingLevel : null,
  };
}
