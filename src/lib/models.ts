import type { ModelDefinition, LLMProvider } from './types';

export const ALL_MODELS: ModelDefinition[] = [
  // Anthropic Models
  // Fable 5 is listed first so it sits at the top of the model dropdowns. This is
  // display order ONLY — getDefaultModelForProvider returns Opus 4.8 explicitly (not
  // models[0]), so the pricier, refusal-capable Fable 5 is never an auto-selected
  // default. Keep that function in sync if you reorder this list.
  { id: 'claude-fable-5', name: 'Claude Fable 5', provider: 'anthropic' },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', provider: 'anthropic' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic' },

  // OpenAI Models
  { id: 'gpt-5.5', name: 'GPT-5.5', provider: 'openai' },
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'openai' },
  { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro', provider: 'openai' },

  // Google Gemini Models
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'google' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'google' },
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
  // OpenAI defaults to 5.4 rather than the top-listed 5.5: 5.5 is 2x the cost
  // of 5.4 for marginal capability gains, so 5.4 is the better starting point.
  if (provider === 'openai') return 'gpt-5.4';
  // Anthropic defaults to Opus 4.8 explicitly, NOT the first list entry: Fable 5 is
  // listed first (dropdown order) but is pricier and can refuse, so it shouldn't be
  // an auto-selected default.
  if (provider === 'anthropic') return 'claude-opus-4-8';
  // Gemini defaults to 3.5 Flash rather than the top-listed 3.1 Pro.
  if (provider === 'google') return 'gemini-3.5-flash';
  const models = ALL_MODELS.filter((m) => m.provider === provider);
  return models[0]?.id ?? 'claude-opus-4-8';
}

// Check if a model is Opus 4.8 (supports adaptive thinking + effort, no sampling params, no budget thinking)
export function isOpus48(modelId: string): boolean {
  return modelId === 'claude-opus-4-8';
}

// Check if a model is Opus 4.6 (supports adaptive thinking + effort)
export function isOpus46(modelId: string): boolean {
  return modelId === 'claude-opus-4-6';
}

// Check if a model is Sonnet 4.6 (supports adaptive thinking + effort, same as Opus 4.6)
export function isSonnet46(modelId: string): boolean {
  return modelId === 'claude-sonnet-4-6';
}

// Check if a model is Claude Fable 5. Fable shares Opus 4.8's effort/adaptive-thinking
// surface but with two differences relevant to this app:
//  - thinking is ALWAYS on, so there is no "off" level (see thinkingOptions.ts).
//  - safety classifiers can refuse a request; we fall back to Opus 4.8 server-side
//    (see the Rust providers/anthropic.rs fallback wiring).
export function isFable5(modelId: string): boolean {
  return modelId === 'claude-fable-5';
}

// Check if a model uses adaptive thinking (Fable 5, Opus 4.8, Opus 4.6, and Sonnet 4.6)
export function usesAdaptiveThinking(modelId: string): boolean {
  return isFable5(modelId) || isOpus48(modelId) || isOpus46(modelId) || isSonnet46(modelId);
}

// Check if a model supports extended thinking (Fable 5, Opus models, and Sonnet 4.6)
export function supportsExtendedThinking(modelId: string): boolean {
  return isFable5(modelId) || modelId.includes('opus') || modelId === 'claude-sonnet-4-6';
}

// Get default evaluator model for a provider (discovery pane uses lighter/faster models)
export function getDefaultEvaluatorModelForProvider(provider: LLMProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-haiku-4-5-20251001';
    case 'openai':
      return 'gpt-5.4-mini';
    case 'google':
      return 'gemini-3.5-flash';
    default:
      return 'claude-haiku-4-5-20251001';
  }
}
