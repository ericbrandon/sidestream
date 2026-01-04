import type { ChatSessionSettings, DiscoveryModeId, LLMConfig } from './types';

interface SettingsStoreState {
  frontierLLM: LLMConfig;
  evaluatorLLM: LLMConfig;
  discoveryMode: DiscoveryModeId;
}

/**
 * Build session settings object from the current settings store state.
 * Centralizes the settings object construction used for session persistence.
 */
export function buildSessionSettings(settingsStore: SettingsStoreState): ChatSessionSettings {
  return {
    frontierModel: settingsStore.frontierLLM.model,
    evaluatorModel: settingsStore.evaluatorLLM.model,
    extendedThinkingEnabled: settingsStore.frontierLLM.extendedThinking.enabled,
    extendedThinkingBudget: settingsStore.frontierLLM.extendedThinking.budgetTokens,
    webSearchEnabled: settingsStore.frontierLLM.webSearchEnabled,
    discoveryMode: settingsStore.discoveryMode,
    frontierReasoningLevel: settingsStore.frontierLLM.reasoningLevel,
    frontierGeminiThinkingLevel: settingsStore.frontierLLM.geminiThinkingLevel,
    evaluatorExtendedThinkingEnabled: settingsStore.evaluatorLLM.extendedThinking.enabled,
    evaluatorReasoningLevel: settingsStore.evaluatorLLM.reasoningLevel,
    evaluatorGeminiThinkingLevel: settingsStore.evaluatorLLM.geminiThinkingLevel,
  };
}
