import { useState, useRef, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useChatStore } from '../../stores/chatStore';
import { ALL_MODELS, PROVIDER_LABELS, getProviderFromModelId } from '../../lib/models';
import type { LLMProvider, ModelDefinition } from '../../lib/types';

interface InlineModelPickerProps {
  value: string;
  onChange: (model: string) => void;
  excludeModels?: string[];
  /** When true, skip the container/execution lock that restricts provider switching */
  skipContainerLock?: boolean;
}

export function InlineModelPicker({ value, onChange, excludeModels = [], skipContainerLock = false }: InlineModelPickerProps) {
  const { configuredProviders } = useSettingsStore();
  const markDirty = useSessionStore((state) => state.markDirty);
  const anthropicContainerId = useChatStore((state) => state.anthropicContainerId);
  const openaiContainerId = useChatStore((state) => state.openaiContainerId);
  const messages = useChatStore((state) => state.messages);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Determine if we're locked to a specific provider due to an active container or execution history
  // - Anthropic/OpenAI: locked when container ID exists (persistent sandbox state)
  // - Gemini: locked when any assistant message has code execution (no container, but context is stapled)
  // Switching providers mid-chat would break execution context continuity
  // skipContainerLock bypasses this for contexts like the discovery pane that don't share chat execution state
  const currentProvider = getProviderFromModelId(value);
  const hasGeminiExecution = currentProvider === 'google' &&
    messages.some(m => m.role === 'assistant' && m.executionCode);
  const lockedProvider: LLMProvider | null = skipContainerLock ? null :
    (currentProvider === 'anthropic' && anthropicContainerId) ? 'anthropic' :
    (currentProvider === 'openai' && openaiContainerId) ? 'openai' :
    hasGeminiExecution ? 'google' :
    null;

  // Filter models to only show those with configured API keys, exclude specified models,
  // and respect container lock (only show same-provider models when locked)
  const availableModels = ALL_MODELS.filter((m) => {
    if (!configuredProviders[m.provider]) return false;
    if (excludeModels.includes(m.id)) return false;
    // When locked to a provider, only show that provider's models
    if (lockedProvider && m.provider !== lockedProvider) return false;
    return true;
  });

  // Group by provider
  const groupedModels = availableModels.reduce(
    (acc, model) => {
      if (!acc[model.provider]) acc[model.provider] = [];
      acc[model.provider].push(model);
      return acc;
    },
    {} as Record<LLMProvider, ModelDefinition[]>
  );

  // Find the current model name
  const currentModel = ALL_MODELS.find((m) => m.id === value);
  const displayName = currentModel?.name || 'Select model';

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // If no models available, show disabled state
  if (availableModels.length === 0) {
    return (
      <div className="text-xs text-stone-400 dark:text-gray-500">
        Configure API key in settings
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-xs text-stone-500 dark:text-gray-400 hover:text-stone-700 dark:hover:text-gray-200 flex items-center gap-1 transition-colors"
      >
        {displayName}
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute bottom-full left-0 mb-1 bg-white dark:bg-gray-800 border border-stone-200 dark:border-gray-700 rounded shadow-lg z-20 min-w-max max-h-64 overflow-y-auto">
            {Object.entries(groupedModels).map(([provider, models]) => (
              <div key={provider}>
                <div className="px-3 py-1 text-xs text-stone-400 dark:text-gray-500 font-medium bg-stone-50 dark:bg-gray-900 sticky top-0">
                  {PROVIDER_LABELS[provider as LLMProvider]}
                </div>
                {models.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => {
                      onChange(model.id);
                      markDirty();
                      setIsOpen(false);
                    }}
                    className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-stone-100 dark:hover:bg-gray-700 transition-colors ${
                      model.id === value ? 'text-blue-600 dark:text-blue-400 font-medium bg-blue-50 dark:bg-blue-900/30' : 'text-stone-700 dark:text-gray-200'
                    }`}
                  >
                    {model.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
