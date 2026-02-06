import type { ChatSessionSettings, DiscoveryModeId, DiscoveryItem, LLMConfig, Message } from './types';

interface SettingsStoreState {
  frontierLLM: LLMConfig;
  evaluatorLLM: LLMConfig;
  discoveryMode: DiscoveryModeId;
}

interface ChatStoreState {
  anthropicContainerId: string | null;
  openaiContainerId: string | null;
}

/**
 * Build session settings object from the current settings store state.
 * Centralizes the settings object construction used for session persistence.
 */
export function buildSessionSettings(settingsStore: SettingsStoreState, chatStore?: ChatStoreState): ChatSessionSettings {
  return {
    frontierModel: settingsStore.frontierLLM.model,
    evaluatorModel: settingsStore.evaluatorLLM.model,
    extendedThinkingEnabled: settingsStore.frontierLLM.extendedThinking.enabled,
    extendedThinkingBudget: settingsStore.frontierLLM.extendedThinking.budgetTokens,
    webSearchEnabled: settingsStore.frontierLLM.webSearchEnabled,
    discoveryMode: settingsStore.discoveryMode,
    frontierReasoningLevel: settingsStore.frontierLLM.reasoningLevel,
    frontierGeminiThinkingLevel: settingsStore.frontierLLM.geminiThinkingLevel,
    frontierOpus46ThinkingLevel: settingsStore.frontierLLM.extendedThinking.opus46Level,
    evaluatorExtendedThinkingEnabled: settingsStore.evaluatorLLM.extendedThinking.enabled,
    evaluatorReasoningLevel: settingsStore.evaluatorLLM.reasoningLevel,
    evaluatorGeminiThinkingLevel: settingsStore.evaluatorLLM.geminiThinkingLevel,
    evaluatorOpus46ThinkingLevel: settingsStore.evaluatorLLM.extendedThinking.opus46Level,
    anthropicContainerId: chatStore?.anthropicContainerId ?? undefined,
    openaiContainerId: chatStore?.openaiContainerId ?? undefined,
  };
}

/**
 * Generate a chat title from the first message content.
 */
export function generateChatTitle(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\n/g, ' ').trim();
  if (!cleaned) return 'New Chat';
  return cleaned;
}

/**
 * Serialize a message ensuring timestamp is a Date object.
 */
export function serializeMessage(msg: Message): Message {
  return {
    ...msg,
    timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
  };
}

/**
 * Serialize a discovery item ensuring timestamp is a Date object.
 */
export function serializeDiscoveryItem(item: DiscoveryItem): DiscoveryItem {
  return {
    ...item,
    timestamp: item.timestamp instanceof Date ? item.timestamp : new Date(item.timestamp),
  };
}
