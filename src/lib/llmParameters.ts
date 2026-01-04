import type { LLMConfig } from './types';
import { getProviderFromModelId } from './models';

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

  return {
    // Anthropic: Extended thinking (must be boolean, not null - Rust expects bool)
    extendedThinkingEnabled: provider === 'anthropic' ? llm.extendedThinking.enabled : false,
    thinkingBudget:
      provider === 'anthropic' && llm.extendedThinking.enabled
        ? llm.extendedThinking.budgetTokens
        : null,
    // OpenAI: Reasoning level
    reasoningLevel: provider === 'openai' ? llm.reasoningLevel : null,
    // Google Gemini: Thinking level
    geminiThinkingLevel: provider === 'google' ? llm.geminiThinkingLevel : null,
  };
}
