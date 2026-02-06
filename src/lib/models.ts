import type { ModelDefinition, LLMProvider } from './types';

export const ALL_MODELS: ModelDefinition[] = [
  // Anthropic Models
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic' },
  { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', provider: 'anthropic' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic' },

  // OpenAI Models
  { id: 'gpt-5.2', name: 'GPT-5.2', provider: 'openai' },
  { id: 'gpt-5.1', name: 'GPT-5.1', provider: 'openai' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', provider: 'openai' },
  { id: 'gpt-5-pro', name: 'GPT-5 Pro', provider: 'openai' },

  // Google Gemini Models
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', provider: 'google' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'google' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
];

export const PROVIDER_LABELS: Record<LLMProvider, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  google: 'Google Gemini',
};

// Get provider from model ID
export function getProviderFromModelId(modelId: string): LLMProvider {
  const model = ALL_MODELS.find((m) => m.id === modelId);
  if (model) return model.provider;

  // Fallback detection by prefix
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt')) return 'openai';
  if (modelId.startsWith('gemini')) return 'google';

  return 'anthropic'; // Default
}

// Get default model for a provider (frontier pane uses top-tier models)
export function getDefaultModelForProvider(provider: LLMProvider): string {
  const models = ALL_MODELS.filter((m) => m.provider === provider);
  return models[0]?.id ?? 'claude-opus-4-6';
}

// Check if a model is Opus 4.6 (supports adaptive thinking + effort)
export function isOpus46(modelId: string): boolean {
  return modelId === 'claude-opus-4-6';
}

// Check if a model is Opus 4.5 (uses budget_tokens thinking)
export function isOpus45(modelId: string): boolean {
  return modelId === 'claude-opus-4-5-20251101';
}

// Check if a model supports extended thinking (Opus models)
export function supportsExtendedThinking(modelId: string): boolean {
  return modelId.includes('opus');
}

// Get default evaluator model for a provider (discovery pane uses lighter/faster models)
export function getDefaultEvaluatorModelForProvider(provider: LLMProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-haiku-4-5-20251001';
    case 'openai':
      return 'gpt-5-mini';
    case 'google':
      return 'gemini-3-flash-preview';
    default:
      return 'claude-haiku-4-5-20251001';
  }
}
