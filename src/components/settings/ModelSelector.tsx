import { useSettingsStore } from '../../stores/settingsStore';
import { ALL_MODELS, PROVIDER_LABELS } from '../../lib/models';
import type { LLMProvider, ModelDefinition } from '../../lib/types';

interface ModelSelectorProps {
  label: string;
  value: string;
  onChange: (model: string) => void;
}

export function ModelSelector({ label, value, onChange }: ModelSelectorProps) {
  const { configuredProviders } = useSettingsStore();

  // Filter models to only show those with configured API keys
  const availableModels = ALL_MODELS.filter((m) => configuredProviders[m.provider]);

  // Group by provider
  const groupedModels = availableModels.reduce(
    (acc, model) => {
      if (!acc[model.provider]) acc[model.provider] = [];
      acc[model.provider].push(model);
      return acc;
    },
    {} as Record<LLMProvider, ModelDefinition[]>
  );

  // If no models available, show a placeholder
  if (availableModels.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-sm text-gray-600 dark:text-gray-400">{label}</label>
        <div className="px-4 py-2 bg-stone-100 dark:bg-gray-700 rounded-lg border border-stone-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 text-sm">
          Configure an API key to enable model selection
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-gray-600 dark:text-gray-400">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-4 py-2 bg-stone-100 dark:bg-gray-700 rounded-lg border border-stone-300 dark:border-gray-600 focus:border-stone-400 dark:focus:border-gray-500 focus:outline-none dark:text-gray-100"
      >
        {Object.entries(groupedModels).map(([provider, models]) => (
          <optgroup key={provider} label={PROVIDER_LABELS[provider as LLMProvider]} className="bg-white dark:bg-gray-700 dark:text-gray-200">
            {models.map((model) => (
              <option key={model.id} value={model.id} className="bg-white dark:bg-gray-700 dark:text-gray-200">
                {model.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
