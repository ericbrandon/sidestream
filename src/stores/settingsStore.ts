import { create } from 'zustand';
import type {
  LLMConfig,
  ChatSessionSettings,
  DiscoveryModeId,
  ApiKeysConfig,
  OpenAIReasoningLevel,
  GeminiThinkingLevel,
  Opus46ThinkingLevel,
  ThemeMode,
  VoiceModel,
  VoiceMode,
} from '../lib/types';
import type { UpdateInfo } from '../lib/updateChecker';

export type SettingsTab = 'api-keys' | 'preferences' | 'personalize' | 'saved-chats' | 'about';
import { DEFAULT_DISCOVERY_MODE, DISCOVERY_MODES, getBestModelForMode, getDefaultEvaluatorModel } from '../lib/discoveryModes';
import type { AutoSelectedModel } from '../lib/discoveryModes';
import { getProviderFromModelId, getDefaultModelForProvider, getDefaultEvaluatorModelForProvider, usesAdaptiveThinking } from '../lib/models';
import { migrateLegacyModelId, migrateFrontierModelId } from '../lib/sessionMigration';
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
// The chat pane's OpenAI reasoning level when the user hasn't chosen one.
// Medium for every OpenAI model — it's also the API's own default for GPT-5.6.
// (The discovery pane has its own defaults, derived from MODE_MODEL_PRIORITIES.)
const DEFAULT_CHAT_REASONING_LEVEL: OpenAIReasoningLevel = 'medium';

function getSavedReasoningLevel(): OpenAIReasoningLevel {
  const saved = localStorage.getItem('reasoningLevel');
  if (saved && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(saved)) {
    return saved as OpenAIReasoningLevel;
  }
  return DEFAULT_CHAT_REASONING_LEVEL;
}

// Load saved thinking level for Gemini models (default 'medium' - Google's recommended
// sweet spot for 3.x Flash; normalized per-model at use, so 3.1 Pro falls back to 'low')
function getSavedGeminiThinkingLevel(): GeminiThinkingLevel {
  const saved = localStorage.getItem('geminiThinkingLevel');
  if (saved && ['minimal', 'low', 'medium', 'high'].includes(saved)) {
    return saved as GeminiThinkingLevel;
  }
  return 'medium';
}

// Load saved thinking level for Opus 4.6 (default 'high' - Claude almost always thinks)
function getSavedOpus46ThinkingLevel(): Opus46ThinkingLevel {
  const saved = localStorage.getItem('opus46ThinkingLevel');
  if (saved && ['off', 'low', 'medium', 'high', 'max', 'adaptive'].includes(saved)) {
    return saved as Opus46ThinkingLevel;
  }
  return 'high';
}

// Load saved thinking level for Sonnet 4.6 (default 'high' - same adaptive thinking as Opus 4.6)
function getSavedSonnet46ThinkingLevel(): Opus46ThinkingLevel {
  const saved = localStorage.getItem('sonnet46ThinkingLevel');
  if (saved && ['off', 'low', 'medium', 'high', 'max', 'adaptive'].includes(saved)) {
    return saved as Opus46ThinkingLevel;
  }
  return 'high';
}

// Load saved thinking level for Sonnet 5 (default 'high'). Sonnet 5 benefits notably
// from high-or-higher effort, so it defaults higher than the discovery-lighter models
// and gets its own key. No 'off' (see alwaysOnThinking in models.ts) — Low is the floor.
function getSavedSonnet5ThinkingLevel(): Opus46ThinkingLevel {
  const saved = localStorage.getItem('sonnet5ThinkingLevel');
  if (saved && ['low', 'medium', 'high', 'xhigh', 'max', 'adaptive'].includes(saved)) {
    return saved as Opus46ThinkingLevel;
  }
  return 'high';
}

// Load saved thinking level for Fable 5 (default 'high'). Fable has no 'off' level
// (thinking is always on), so it gets its own key — toggling between Opus and Fable
// must not clobber each other's remembered level.
function getSavedFable5ThinkingLevel(): Opus46ThinkingLevel {
  const saved = localStorage.getItem('fable5ThinkingLevel');
  if (saved && ['low', 'medium', 'high', 'xhigh', 'max', 'adaptive'].includes(saved)) {
    return saved as Opus46ThinkingLevel;
  }
  return 'high';
}

// Get the saved adaptive thinking level for the given model
function getSavedAdaptiveThinkingLevel(model: string): Opus46ThinkingLevel {
  if (model === 'claude-fable-5') return getSavedFable5ThinkingLevel();
  if (model === 'claude-sonnet-5') return getSavedSonnet5ThinkingLevel();
  return model === 'claude-sonnet-4-6'
    ? getSavedSonnet46ThinkingLevel()
    : getSavedOpus46ThinkingLevel();
}

// Load saved frontier model from localStorage. Uses the frontier-specific
// migration: gpt-5.4 is still valid for discovery but hidden from the chat
// picker, so a saved frontier of gpt-5.4 moves to gpt-5.6-terra.
function getSavedFrontierModel(): string {
  const saved = localStorage.getItem('frontierModel');
  const migrated = migrateFrontierModelId(saved);
  if (saved && migrated !== saved) {
    localStorage.setItem('frontierModel', migrated);
  }
  return migrated;
}

// All providers assumed available: API keys aren't known at store-construction
// time. setConfiguredProviders re-derives against the real key set once they load.
const ALL_PROVIDERS_AVAILABLE = { anthropic: true, openai: true, google: true };

// The auto-picker's choice (model AND thinking levels) for the default discovery
// mode, used to seed a fresh install. Single source of truth: MODE_MODEL_PRIORITIES.
function getSeedEvaluatorChoice(): AutoSelectedModel | null {
  return getBestModelForMode(DEFAULT_DISCOVERY_MODE, ALL_PROVIDERS_AVAILABLE);
}

// localStorage key holding the Anthropic thinking level for a given evaluator
// model — these are persisted per-model, so the key depends on the model.
function evaluatorAnthropicThinkingKey(model: string): string {
  if (model === 'claude-fable-5') return 'evaluatorFable5ThinkingLevel';
  if (model === 'claude-sonnet-5') return 'evaluatorSonnet5ThinkingLevel';
  if (model === 'claude-sonnet-4-6') return 'evaluatorSonnet46ThinkingLevel';
  return 'evaluatorOpus46ThinkingLevel';
}

// Persist an auto-selected evaluator choice (model + all three level families).
// Writes the Anthropic level under the key belonging to `choice.model`, not
// unconditionally under the Opus key.
function persistEvaluatorChoice(choice: AutoSelectedModel): void {
  localStorage.setItem('evaluatorModel', choice.model);
  localStorage.setItem('evaluatorReasoningLevel', choice.reasoningLevel);
  localStorage.setItem('evaluatorGeminiThinkingLevel', choice.geminiThinkingLevel);
  localStorage.setItem(
    evaluatorAnthropicThinkingKey(choice.model),
    choice.opus46ThinkingLevel ?? 'low'
  );
}

// Build the evaluatorLLM state from an auto-selected choice.
function evaluatorLLMFromChoice(prev: LLMConfig, choice: AutoSelectedModel): LLMConfig {
  return {
    ...prev,
    model: choice.model,
    extendedThinking: {
      ...prev.extendedThinking,
      enabled: choice.extendedThinkingEnabled,
      opus46Level: choice.opus46ThinkingLevel ?? 'low',
    },
    reasoningLevel: choice.reasoningLevel,
    geminiThinkingLevel: choice.geminiThinkingLevel,
  };
}

// Load saved evaluator model from localStorage. With nothing saved, the default
// is DERIVED from the same priority table the auto-picker uses, so a fresh
// install's discovery pane always agrees with what auto-select would choose for
// the default mode. See also getSavedEvaluator*Level below, which seed from the
// same choice so the LEVEL can't diverge from the table either.
function getSavedEvaluatorModel(): string {
  const saved = localStorage.getItem('evaluatorModel');
  if (!saved) return getDefaultEvaluatorModel(ALL_PROVIDERS_AVAILABLE);
  const migrated = migrateLegacyModelId(saved);
  if (migrated !== saved) {
    localStorage.setItem('evaluatorModel', migrated);
  }
  return migrated;
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

// Load saved evaluator reasoning level for OpenAI models. With nothing saved,
// seed from the priority table (only meaningful if the seeded model is OpenAI —
// otherwise the table's reasoningLevel is a harmless default that the model's
// pane never reads).
function getSavedEvaluatorReasoningLevel(): OpenAIReasoningLevel {
  const saved = localStorage.getItem('evaluatorReasoningLevel');
  if (saved && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(saved)) {
    return saved as OpenAIReasoningLevel;
  }
  return getSeedEvaluatorChoice()?.reasoningLevel ?? 'low';
}

// Load saved evaluator thinking level for Gemini models. With nothing saved,
// seed from the priority table (see getSavedEvaluatorReasoningLevel).
function getSavedEvaluatorGeminiThinkingLevel(): GeminiThinkingLevel {
  const saved = localStorage.getItem('evaluatorGeminiThinkingLevel');
  if (saved && ['minimal', 'low', 'medium', 'high'].includes(saved)) {
    return saved as GeminiThinkingLevel;
  }
  return getSeedEvaluatorChoice()?.geminiThinkingLevel ?? 'medium';
}

// Load saved evaluator thinking level for Opus 4.6/4.8 (lighter thinking for
// discovery). With nothing saved, seed from the priority table so the level a
// fresh install shows matches what auto-select would apply for the default mode.
function getSavedEvaluatorOpus46ThinkingLevel(): Opus46ThinkingLevel {
  const saved = localStorage.getItem('evaluatorOpus46ThinkingLevel');
  if (saved && ['off', 'low', 'medium', 'high', 'max', 'adaptive'].includes(saved)) {
    return saved as Opus46ThinkingLevel;
  }
  const seed = getSeedEvaluatorChoice();
  // Only adopt the table's level if the table's model actually uses this key.
  if (seed && evaluatorAnthropicThinkingKey(seed.model) === 'evaluatorOpus46ThinkingLevel') {
    return seed.opus46ThinkingLevel ?? 'low';
  }
  return 'low';
}

// Load saved evaluator thinking level for Sonnet 4.6 (default 'low' - lighter thinking for discovery)
function getSavedEvaluatorSonnet46ThinkingLevel(): Opus46ThinkingLevel {
  const saved = localStorage.getItem('evaluatorSonnet46ThinkingLevel');
  if (saved && ['off', 'low', 'medium', 'high', 'max', 'adaptive'].includes(saved)) {
    return saved as Opus46ThinkingLevel;
  }
  return 'low';
}

// Load saved evaluator thinking level for Sonnet 5 (default 'high'). Unlike the other
// Anthropic evaluators — which default to 'low' to keep background discovery cheap —
// Sonnet 5 defaults to 'high' here too, because it benefits notably from higher effort
// and we want discovery to reflect that (the backend discovery effort is bumped to
// match in providers/anthropic.rs build_discovery_request). Own key, full option set.
function getSavedEvaluatorSonnet5ThinkingLevel(): Opus46ThinkingLevel {
  const saved = localStorage.getItem('evaluatorSonnet5ThinkingLevel');
  if (saved && ['low', 'medium', 'high', 'xhigh', 'max', 'adaptive'].includes(saved)) {
    return saved as Opus46ThinkingLevel;
  }
  return 'high';
}

// Load saved evaluator thinking level for Fable 5 (default 'low' - lighter thinking
// for discovery). Own key, no 'off' (see getSavedFable5ThinkingLevel).
function getSavedEvaluatorFable5ThinkingLevel(): Opus46ThinkingLevel {
  const saved = localStorage.getItem('evaluatorFable5ThinkingLevel');
  if (saved && ['low', 'medium', 'high', 'xhigh', 'max', 'adaptive'].includes(saved)) {
    return saved as Opus46ThinkingLevel;
  }
  return 'low';
}

// Get the saved evaluator adaptive thinking level for the given model
function getSavedEvaluatorAdaptiveThinkingLevel(model: string): Opus46ThinkingLevel {
  if (model === 'claude-fable-5') return getSavedEvaluatorFable5ThinkingLevel();
  if (model === 'claude-sonnet-5') return getSavedEvaluatorSonnet5ThinkingLevel();
  return model === 'claude-sonnet-4-6'
    ? getSavedEvaluatorSonnet46ThinkingLevel()
    : getSavedEvaluatorOpus46ThinkingLevel();
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

// Load saved allowChatGPTExtraHighThinking setting (default false)
function getSavedAllowChatGPTExtraHighThinking(): boolean {
  const saved = localStorage.getItem('allowChatGPTExtraHighThinking');
  if (saved !== null) {
    return saved === 'true';
  }
  return false;
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
  allowChatGPTExtraHighThinking: boolean; // Allow xhigh/max thinking for OpenAI models
  updateInfo: UpdateInfo | null; // Available update info
  showUpdateModal: boolean; // Whether to show the update modal

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
  setAllowChatGPTExtraHighThinking: (enabled: boolean) => void;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  dismissUpdate: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isSettingsOpen: false,
  highlightApiKeys: false,
  lastSettingsTab: 'preferences',
  frontierLLM: {
    model: getSavedFrontierModel(),
    apiKeyConfigured: false,
    extendedThinking: {
      // `enabled` is derived from the level, never stored independently — for adaptive
      // Anthropic models thinking is on iff the level isn't 'off'. (Kept in sync with
      // the send path in buildProviderThinkingParams; the old separate global key could
      // desync from the per-model level after a restart.)
      enabled: getSavedAdaptiveThinkingLevel(getSavedFrontierModel()) !== 'off',
      opus46Level: getSavedAdaptiveThinkingLevel(getSavedFrontierModel()),
    },
    reasoningLevel: getSavedReasoningLevel(),
    geminiThinkingLevel: getSavedGeminiThinkingLevel(),
    webSearchEnabled: getSavedWebSearch(),
  },
  evaluatorLLM: {
    model: getSavedEvaluatorModel(),
    apiKeyConfigured: false,
    extendedThinking: {
      // Derived from the level (see the frontier note above) — not a separate key.
      enabled: getSavedEvaluatorAdaptiveThinkingLevel(getSavedEvaluatorModel()) !== 'off',
      opus46Level: getSavedEvaluatorAdaptiveThinkingLevel(getSavedEvaluatorModel()),
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
  allowChatGPTExtraHighThinking: getSavedAllowChatGPTExtraHighThinking(),
  updateInfo: null,
  showUpdateModal: false,
  openSettings: (highlightApiKeys = false) =>
    set({ isSettingsOpen: true, highlightApiKeys }),
  closeSettings: () => set({ isSettingsOpen: false, highlightApiKeys: false }),
  setLastSettingsTab: (tab) => set({ lastSettingsTab: tab }),

  setFrontierLLM: (config) => {
    set((state) => {
      const newState = { ...state.frontierLLM, ...config };

      // When model changes to an adaptive-thinking model, load its saved thinking level
      if (config.model !== undefined && config.model !== state.frontierLLM.model && usesAdaptiveThinking(config.model)) {
        const savedLevel = getSavedAdaptiveThinkingLevel(config.model);
        newState.extendedThinking = {
          ...newState.extendedThinking,
          opus46Level: savedLevel,
          enabled: savedLevel !== 'off',
        };
      }

      return { frontierLLM: newState };
    });
    // Persist settings to localStorage
    if (config.model !== undefined) {
      localStorage.setItem('frontierModel', config.model);
    }
    if (config.extendedThinking !== undefined) {
      // `enabled` is not persisted separately — it's derived from the per-model level
      // on read (see the store init / loadSettings), so only the level is stored.
      if (config.extendedThinking.opus46Level !== undefined) {
        // Save to correct key based on current model (per-model persistence)
        const currentModel = useSettingsStore.getState().frontierLLM.model;
        const key = currentModel === 'claude-fable-5'
          ? 'fable5ThinkingLevel'
          : currentModel === 'claude-sonnet-5'
            ? 'sonnet5ThinkingLevel'
            : currentModel === 'claude-sonnet-4-6'
              ? 'sonnet46ThinkingLevel'
              : 'opus46ThinkingLevel';
        localStorage.setItem(key, config.extendedThinking.opus46Level);
      }
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
    set((state) => {
      const newState = { ...state.evaluatorLLM, ...config };

      // When model changes to an adaptive-thinking model, load its saved thinking level
      if (config.model !== undefined && config.model !== state.evaluatorLLM.model && usesAdaptiveThinking(config.model)) {
        const savedLevel = getSavedEvaluatorAdaptiveThinkingLevel(config.model);
        newState.extendedThinking = {
          ...newState.extendedThinking,
          opus46Level: savedLevel,
          enabled: savedLevel !== 'off',
        };
      }

      return { evaluatorLLM: newState };
    });
    // Persist settings to localStorage
    if (config.model !== undefined) {
      localStorage.setItem('evaluatorModel', config.model);
    }
    if (config.extendedThinking !== undefined) {
      // `enabled` is derived from the level on read, not stored separately.
      if (config.extendedThinking.opus46Level !== undefined) {
        // Save to correct key based on current model (per-model persistence)
        const currentModel = useSettingsStore.getState().evaluatorLLM.model;
        localStorage.setItem(
          evaluatorAnthropicThinkingKey(currentModel),
          config.extendedThinking.opus46Level
        );
      }
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
        // Force-switch to the auto-picker's choice for the CURRENT discovery mode
        // given the now-available providers. We take the whole choice — model AND
        // thinking levels — because the existing levels belonged to a model of a
        // different provider and are meaningless for the new one.
        const choice = getBestModelForMode(state.discoveryMode, providers);
        if (choice) {
          updates.evaluatorLLM = evaluatorLLMFromChoice(state.evaluatorLLM, choice);
          persistEvaluatorChoice(choice);
        } else {
          // discoveryMode is 'none' (no priority list) — fall back to the default
          // mode's choice for whichever provider is available.
          const availableProvider = (Object.keys(providers) as LLMProvider[]).find(
            (p) => providers[p]
          );
          if (availableProvider) {
            const newModel = getDefaultEvaluatorModelForProvider(availableProvider);
            updates.evaluatorLLM = { ...state.evaluatorLLM, model: newModel };
            localStorage.setItem('evaluatorModel', newModel);
          }
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
          // Derived from the level, not settings.extendedThinkingEnabled — keeps the
          // stored flag from disagreeing with the level the UI shows and the send path.
          enabled: (settings.frontierOpus46ThinkingLevel ?? 'high') !== 'off',
          opus46Level: settings.frontierOpus46ThinkingLevel ?? 'high',
        },
        webSearchEnabled: settings.webSearchEnabled,
        reasoningLevel: settings.frontierReasoningLevel ?? 'low',
        geminiThinkingLevel: settings.frontierGeminiThinkingLevel ?? 'medium',
      },
      evaluatorLLM: {
        ...state.evaluatorLLM,
        model: settings.evaluatorModel,
        extendedThinking: {
          ...state.evaluatorLLM.extendedThinking,
          // Derived from the level, not settings.evaluatorExtendedThinkingEnabled.
          enabled: (settings.evaluatorOpus46ThinkingLevel ?? 'low') !== 'off',
          opus46Level: settings.evaluatorOpus46ThinkingLevel ?? 'low',
        },
        reasoningLevel: settings.evaluatorReasoningLevel ?? 'low',
        geminiThinkingLevel: settings.evaluatorGeminiThinkingLevel ?? 'medium',
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
        // Update evaluator LLM with the best model and thinking settings.
        // (enabled is derived from the level on read, not stored)
        const newEvaluatorLLM = evaluatorLLMFromChoice(state.evaluatorLLM, bestModel);
        persistEvaluatorChoice(bestModel);

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

  setAllowChatGPTExtraHighThinking: (enabled) => {
    localStorage.setItem('allowChatGPTExtraHighThinking', String(enabled));
    set({ allowChatGPTExtraHighThinking: enabled });
  },

  setUpdateInfo: (info) => {
    set({ updateInfo: info, showUpdateModal: info !== null });
  },

  dismissUpdate: () => {
    set({ showUpdateModal: false });
  },
}));
