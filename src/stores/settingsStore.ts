import { create } from 'zustand';
import type {
  LLMConfig,
  ChatSessionSettings,
  DiscoveryModeId,
  ApiKeysConfig,
  OpenAIReasoningLevel,
  GeminiThinkingLevel,
  ThemeMode,
  VoiceModel,
  VoiceMode,
} from '../lib/types';

export type SettingsTab = 'api-keys' | 'preferences' | 'personalize' | 'saved-chats' | 'about';
import { DEFAULT_DISCOVERY_MODE, DISCOVERY_MODES, getBestModelForMode } from '../lib/discoveryModes';
import { getProviderFromModelId, getDefaultModelForProvider, getDefaultEvaluatorModelForProvider } from '../lib/models';
import { useSessionStore } from './sessionStore';
import { useChatStore } from './chatStore';
import type { LLMProvider } from '../lib/types';

// Load saved discovery mode from localStorage
function getSavedDiscoveryMode(): DiscoveryModeId {
  const saved = localStorage.getItem('discoveryMode');
  if (saved && saved in DISCOVERY_MODES) {
    return saved as DiscoveryModeId;
  }
  return DEFAULT_DISCOVERY_MODE;
}

// Load saved extended thinking setting from localStorage (default true for first launch)
function getSavedExtendedThinking(): boolean {
  const saved = localStorage.getItem('extendedThinkingEnabled');
  if (saved !== null) {
    return saved === 'true';
  }
  // First launch - default to true and persist it
  localStorage.setItem('extendedThinkingEnabled', 'true');
  return true;
}

// Load saved web search setting from localStorage (default true for first launch)
function getSavedWebSearch(): boolean {
  const saved = localStorage.getItem('webSearchEnabled');
  if (saved !== null) {
    return saved === 'true';
  }
  // First launch - default to true and persist it
  localStorage.setItem('webSearchEnabled', 'true');
  return true;
}

// Load saved reasoning level for OpenAI models (default 'low')
function getSavedReasoningLevel(): OpenAIReasoningLevel {
  const saved = localStorage.getItem('reasoningLevel');
  if (saved && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(saved)) {
    return saved as OpenAIReasoningLevel;
  }
  return 'low';
}

// Load saved thinking level for Gemini models (default 'low' - gemini-3-pro-preview can't turn thinking off)
function getSavedGeminiThinkingLevel(): GeminiThinkingLevel {
  const saved = localStorage.getItem('geminiThinkingLevel');
  if (saved && ['off', 'minimal', 'low', 'medium', 'high', 'on'].includes(saved)) {
    return saved as GeminiThinkingLevel;
  }
  return 'low';
}

// Load saved frontier model from localStorage
function getSavedFrontierModel(): string {
  const saved = localStorage.getItem('frontierModel');
  return saved || 'claude-opus-4-5-20251101';
}

// Load saved evaluator model from localStorage
function getSavedEvaluatorModel(): string {
  const saved = localStorage.getItem('evaluatorModel');
  return saved || 'claude-haiku-4-5-20251001';
}

// Load saved evaluator web search setting from localStorage (default true for first launch)
function getSavedEvaluatorWebSearch(): boolean {
  const saved = localStorage.getItem('evaluatorWebSearchEnabled');
  if (saved !== null) {
    return saved === 'true';
  }
  // First launch - default to true and persist it
  localStorage.setItem('evaluatorWebSearchEnabled', 'true');
  return true;
}

// Load saved evaluator reasoning level for OpenAI models (default 'low')
function getSavedEvaluatorReasoningLevel(): OpenAIReasoningLevel {
  const saved = localStorage.getItem('evaluatorReasoningLevel');
  if (saved && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(saved)) {
    return saved as OpenAIReasoningLevel;
  }
  return 'low';
}

// Load saved evaluator thinking level for Gemini models (default 'low')
function getSavedEvaluatorGeminiThinkingLevel(): GeminiThinkingLevel {
  const saved = localStorage.getItem('evaluatorGeminiThinkingLevel');
  if (saved && ['off', 'minimal', 'low', 'medium', 'high', 'on'].includes(saved)) {
    return saved as GeminiThinkingLevel;
  }
  return 'low';
}

// Load saved evaluator extended thinking setting (default false - discovery uses lighter thinking)
function getSavedEvaluatorExtendedThinking(): boolean {
  const saved = localStorage.getItem('evaluatorExtendedThinkingEnabled');
  if (saved !== null) {
    return saved === 'true';
  }
  return false;
}

// Load saved auto-select discovery model setting (default true for first launch)
function getSavedAutoSelectDiscoveryModel(): boolean {
  const saved = localStorage.getItem('autoSelectDiscoveryModel');
  if (saved !== null) {
    return saved === 'true';
  }
  // First launch - default to true and persist it
  localStorage.setItem('autoSelectDiscoveryModel', 'true');
  return true;
}

// Load saved show citations setting (default false for first launch)
function getSavedShowCitations(): boolean {
  const saved = localStorage.getItem('showCitations');
  if (saved !== null) {
    return saved === 'true';
  }
  return false;
}

// Load saved theme from localStorage (default 'system' for first launch)
function getSavedTheme(): ThemeMode {
  const saved = localStorage.getItem('theme');
  if (saved && ['light', 'dark', 'system'].includes(saved)) {
    return saved as ThemeMode;
  }
  return 'system';
}

// Load saved voice mode from localStorage (default 'chat_request' for first launch)
function getSavedVoiceMode(): VoiceMode {
  const saved = localStorage.getItem('voiceMode');
  if (saved && ['none', 'textbox', 'chat_request'].includes(saved)) {
    return saved as VoiceMode;
  }
  // First launch - default to chat_request
  return 'chat_request';
}

// Load saved voice model from localStorage (will be recomputed when providers are set)
function getSavedVoiceModel(): VoiceModel {
  const saved = localStorage.getItem('voiceModel');
  if (saved && ['none', 'openai', 'gemini'].includes(saved)) {
    return saved as VoiceModel;
  }
  return 'none';
}

// Load saved custom system prompt from localStorage
function getSavedCustomSystemPrompt(): string {
  return localStorage.getItem('customSystemPrompt') || '';
}

// Compute voice model from configured providers
// Priority: openai (Whisper) > gemini > none
function computeVoiceModel(providers: ApiKeysConfig): VoiceModel {
  if (providers.openai) return 'openai';
  if (providers.google) return 'gemini';
  return 'none';
}

// Font scale constants
const MIN_FONT_SCALE = 0.5;
const MAX_FONT_SCALE = 2.0;
const FONT_SCALE_STEP = 0.1;
const DEFAULT_FONT_SCALE = 1.0;

// Load saved font scale from localStorage
function getSavedFontScale(): number {
  const saved = localStorage.getItem('fontScale');
  if (saved !== null) {
    const scale = parseFloat(saved);
    if (!isNaN(scale) && scale >= MIN_FONT_SCALE && scale <= MAX_FONT_SCALE) {
      return scale;
    }
  }
  return DEFAULT_FONT_SCALE;
}

interface SettingsState {
  isSettingsOpen: boolean;
  highlightApiKeys: boolean;
  lastSettingsTab: SettingsTab;
  frontierLLM: LLMConfig;
  evaluatorLLM: LLMConfig;
  discoveryMode: DiscoveryModeId;
  configuredProviders: ApiKeysConfig;
  fontScale: number;
  autoSelectDiscoveryModel: boolean;
  showCitations: boolean;
  theme: ThemeMode;
  voiceModel: VoiceModel; // Auto-determined from API keys
  voiceMode: VoiceMode; // User-configurable
  customSystemPrompt: string; // User's personalized system prompt

  // Actions
  openSettings: (highlightApiKeys?: boolean) => void;
  closeSettings: () => void;
  setLastSettingsTab: (tab: SettingsTab) => void;
  setFrontierLLM: (config: Partial<LLMConfig>) => void;
  setEvaluatorLLM: (config: Partial<LLMConfig>) => void;
  setApiKeyConfigured: (configured: boolean) => void;
  setConfiguredProviders: (providers: ApiKeysConfig) => void;
  setDiscoveryMode: (mode: DiscoveryModeId) => void;
  loadSettings: (settings: ChatSessionSettings) => void;
  increaseFontScale: () => void;
  decreaseFontScale: () => void;
  resetFontScale: () => void;
  setAutoSelectDiscoveryModel: (enabled: boolean) => void;
  setShowCitations: (enabled: boolean) => void;
  setTheme: (mode: ThemeMode) => void;
  setVoiceMode: (mode: VoiceMode) => void;
  setCustomSystemPrompt: (prompt: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isSettingsOpen: false,
  highlightApiKeys: false,
  lastSettingsTab: 'preferences',
  frontierLLM: {
    model: getSavedFrontierModel(),
    apiKeyConfigured: false,
    extendedThinking: {
      enabled: getSavedExtendedThinking(),
      budgetTokens: 10000,
    },
    reasoningLevel: getSavedReasoningLevel(),
    geminiThinkingLevel: getSavedGeminiThinkingLevel(),
    webSearchEnabled: getSavedWebSearch(),
  },
  evaluatorLLM: {
    model: getSavedEvaluatorModel(),
    apiKeyConfigured: false,
    extendedThinking: {
      enabled: getSavedEvaluatorExtendedThinking(),
      budgetTokens: 10000,
    },
    reasoningLevel: getSavedEvaluatorReasoningLevel(),
    geminiThinkingLevel: getSavedEvaluatorGeminiThinkingLevel(),
    webSearchEnabled: getSavedEvaluatorWebSearch(),
  },
  discoveryMode: getSavedDiscoveryMode(),
  configuredProviders: {
    anthropic: false,
    openai: false,
    google: false,
  },
  fontScale: getSavedFontScale(),
  autoSelectDiscoveryModel: getSavedAutoSelectDiscoveryModel(),
  showCitations: getSavedShowCitations(),
  theme: getSavedTheme(),
  voiceModel: getSavedVoiceModel(),
  voiceMode: getSavedVoiceMode(),
  customSystemPrompt: getSavedCustomSystemPrompt(),
  openSettings: (highlightApiKeys = false) =>
    set({ isSettingsOpen: true, highlightApiKeys }),
  closeSettings: () => set({ isSettingsOpen: false, highlightApiKeys: false }),
  setLastSettingsTab: (tab) => set({ lastSettingsTab: tab }),

  setFrontierLLM: (config) => {
    set((state) => ({
      frontierLLM: { ...state.frontierLLM, ...config },
    }));
    // Persist settings to localStorage
    if (config.model !== undefined) {
      localStorage.setItem('frontierModel', config.model);
    }
    if (config.extendedThinking !== undefined) {
      localStorage.setItem('extendedThinkingEnabled', String(config.extendedThinking.enabled));
    }
    if (config.reasoningLevel !== undefined) {
      localStorage.setItem('reasoningLevel', config.reasoningLevel);
    }
    if (config.geminiThinkingLevel !== undefined) {
      localStorage.setItem('geminiThinkingLevel', config.geminiThinkingLevel);
    }
    if (config.webSearchEnabled !== undefined) {
      localStorage.setItem('webSearchEnabled', String(config.webSearchEnabled));
    }
  },

  setEvaluatorLLM: (config) => {
    set((state) => ({
      evaluatorLLM: { ...state.evaluatorLLM, ...config },
    }));
    // Persist settings to localStorage
    if (config.model !== undefined) {
      localStorage.setItem('evaluatorModel', config.model);
    }
    if (config.extendedThinking !== undefined) {
      localStorage.setItem('evaluatorExtendedThinkingEnabled', String(config.extendedThinking.enabled));
    }
    if (config.reasoningLevel !== undefined) {
      localStorage.setItem('evaluatorReasoningLevel', config.reasoningLevel);
    }
    if (config.geminiThinkingLevel !== undefined) {
      localStorage.setItem('evaluatorGeminiThinkingLevel', config.geminiThinkingLevel);
    }
  },

  setApiKeyConfigured: (configured) =>
    set((state) => ({
      frontierLLM: { ...state.frontierLLM, apiKeyConfigured: configured },
      evaluatorLLM: { ...state.evaluatorLLM, apiKeyConfigured: configured },
    })),

  setConfiguredProviders: (providers) => {
    set((state) => {
      const updates: Partial<SettingsState> = { configuredProviders: providers };

      // Check if current frontier model's provider is available
      const frontierProvider = getProviderFromModelId(state.frontierLLM.model);
      if (!providers[frontierProvider]) {
        // Find first available provider and switch to its default model
        const availableProvider = (Object.keys(providers) as LLMProvider[]).find(
          (p) => providers[p]
        );
        if (availableProvider) {
          const newModel = getDefaultModelForProvider(availableProvider);
          updates.frontierLLM = { ...state.frontierLLM, model: newModel };
          localStorage.setItem('frontierModel', newModel);
        }
      }

      // Check if current evaluator model's provider is available
      const evaluatorProvider = getProviderFromModelId(state.evaluatorLLM.model);
      if (!providers[evaluatorProvider]) {
        // Find first available provider and switch to its default evaluator model
        const availableProvider = (Object.keys(providers) as LLMProvider[]).find(
          (p) => providers[p]
        );
        if (availableProvider) {
          const newModel = getDefaultEvaluatorModelForProvider(availableProvider);
          updates.evaluatorLLM = { ...state.evaluatorLLM, model: newModel };
          localStorage.setItem('evaluatorModel', newModel);
        }
      }

      // Compute voice model from available providers
      const newVoiceModel = computeVoiceModel(providers);
      updates.voiceModel = newVoiceModel;
      localStorage.setItem('voiceModel', newVoiceModel);

      return updates;
    });
  },

  setDiscoveryMode: (mode) => {
    set({ discoveryMode: mode });
    // Persist to localStorage
    localStorage.setItem('discoveryMode', mode);
    // Mark session dirty if there's content to save
    const hasMessages = useChatStore.getState().messages.length > 0;
    if (hasMessages) {
      useSessionStore.getState().markDirty();
    }
  },

  loadSettings: (settings) =>
    set((state) => ({
      frontierLLM: {
        ...state.frontierLLM,
        model: settings.frontierModel,
        extendedThinking: {
          enabled: settings.extendedThinkingEnabled,
          budgetTokens: settings.extendedThinkingBudget,
        },
        webSearchEnabled: settings.webSearchEnabled,
        reasoningLevel: settings.frontierReasoningLevel ?? 'low',
        geminiThinkingLevel: settings.frontierGeminiThinkingLevel ?? 'low',
      },
      evaluatorLLM: {
        ...state.evaluatorLLM,
        model: settings.evaluatorModel,
        extendedThinking: {
          ...state.evaluatorLLM.extendedThinking,
          enabled: settings.evaluatorExtendedThinkingEnabled ?? false,
        },
        reasoningLevel: settings.evaluatorReasoningLevel ?? 'low',
        geminiThinkingLevel: settings.evaluatorGeminiThinkingLevel ?? 'low',
      },
      discoveryMode: settings.discoveryMode ?? DEFAULT_DISCOVERY_MODE,
    })),

  increaseFontScale: () =>
    set((state) => {
      const newScale = Math.min(state.fontScale + FONT_SCALE_STEP, MAX_FONT_SCALE);
      localStorage.setItem('fontScale', newScale.toFixed(1));
      return { fontScale: newScale };
    }),

  decreaseFontScale: () =>
    set((state) => {
      const newScale = Math.max(state.fontScale - FONT_SCALE_STEP, MIN_FONT_SCALE);
      localStorage.setItem('fontScale', newScale.toFixed(1));
      return { fontScale: newScale };
    }),

  resetFontScale: () => {
    localStorage.setItem('fontScale', DEFAULT_FONT_SCALE.toFixed(1));
    set({ fontScale: DEFAULT_FONT_SCALE });
  },

  setAutoSelectDiscoveryModel: (enabled) => {
    localStorage.setItem('autoSelectDiscoveryModel', String(enabled));

    // When turning OFF auto-select, apply the best model for the current mode
    // so the user starts with a good default they can then manually adjust
    if (!enabled) {
      const state = useSettingsStore.getState();
      const bestModel = getBestModelForMode(state.discoveryMode, state.configuredProviders);
      if (bestModel) {
        // Update evaluator LLM with the best model and thinking settings
        const newEvaluatorLLM = {
          ...state.evaluatorLLM,
          model: bestModel.model,
          extendedThinking: {
            ...state.evaluatorLLM.extendedThinking,
            enabled: bestModel.extendedThinkingEnabled,
          },
          reasoningLevel: bestModel.reasoningLevel,
          geminiThinkingLevel: bestModel.geminiThinkingLevel,
        };

        // Persist to localStorage
        localStorage.setItem('evaluatorModel', bestModel.model);
        localStorage.setItem('evaluatorExtendedThinkingEnabled', String(bestModel.extendedThinkingEnabled));
        localStorage.setItem('evaluatorReasoningLevel', bestModel.reasoningLevel);
        localStorage.setItem('evaluatorGeminiThinkingLevel', bestModel.geminiThinkingLevel);

        set({ autoSelectDiscoveryModel: enabled, evaluatorLLM: newEvaluatorLLM });
        return;
      }
    }

    set({ autoSelectDiscoveryModel: enabled });
  },

  setShowCitations: (enabled) => {
    localStorage.setItem('showCitations', String(enabled));
    set({ showCitations: enabled });
  },

  setTheme: (mode) => {
    localStorage.setItem('theme', mode);
    set({ theme: mode });
  },

  setVoiceMode: (mode) => {
    localStorage.setItem('voiceMode', mode);
    set({ voiceMode: mode });
  },

  setCustomSystemPrompt: (prompt) => {
    localStorage.setItem('customSystemPrompt', prompt);
    set({ customSystemPrompt: prompt });
  },
}));
