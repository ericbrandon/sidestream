import type { ModelDefinition, LLMProvider } from './types';

export const ALL_MODELS: ModelDefinition[] = [
  // Anthropic Models
  // Fable 5 is listed first so it sits at the top of the model dropdowns. This is
  // display order ONLY — getDefaultModelForProvider returns Opus 5 explicitly (not
  // models[0]), so the pricier Fable 5 is never an auto-selected default. Keep that
  // function in sync if you reorder this list. Opus 4.8 stays listed: it is still a
  // live model and remains a fallback target for safety refusals.
  { id: 'claude-fable-5', name: 'Claude Fable 5', provider: 'anthropic' },
  { id: 'claude-opus-5', name: 'Claude Opus 5', provider: 'anthropic' },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', provider: 'anthropic' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'anthropic' },
  // Sonnet 4.6 was removed at the Opus 5 launch — saved sessions forward to Sonnet 5
  // via LEGACY_SONNET_46_ID in sessionMigration.ts.
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic' },

  // OpenAI Models
  // GPT-5.4 is retained ONLY for the discovery pane (it remains the auto-pick in
  // MODE_MODEL_PRIORITIES, see discoveryModes.ts) — the main chat picker hides it
  // via CHAT_EXCLUDED_MODELS below. gpt-5.5 / gpt-5.4-mini / gpt-5.5-pro were
  // retired with the 5.6 launch; see LEGACY_GPT_IDS in sessionMigration.ts.
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', provider: 'openai' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', provider: 'openai' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', provider: 'openai' },
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai' },

  // Google Gemini Models
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'google' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', provider: 'google' },
];

// Models that stay in ALL_MODELS (so the discovery pane can list them) but are
// hidden from the MAIN CHAT model picker. gpt-5.4 is kept alive solely for the
// discovery pane, where it remains the auto-pick (MODE_MODEL_PRIORITIES in
// discoveryModes.ts); for chat it is superseded by the identically-priced
// gpt-5.6-terra.
export const CHAT_EXCLUDED_MODELS: string[] = ['gpt-5.4'];

// Check if a model is in the GPT-5.6 family (Sol / Terra / Luna). These have a
// different reasoning enum than earlier GPT-5.x ('minimal' removed, 'max' added)
// and support explicit prompt-cache breakpoints (handled in providers/openai.rs).
export function isGpt56Family(modelId: string): boolean {
  return modelId.startsWith('gpt-5.6');
}

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
  // OpenAI defaults to Terra rather than the top-listed Sol: Sol is 2x the cost
  // of Terra ($5/$30 vs $2.50/$15 per MTok) for marginal capability gains — the
  // same reasoning that previously made 5.4 the default over 5.5. Terra is also
  // priced identically to the old 5.4, so this default is cost-neutral.
  if (provider === 'openai') return 'gpt-5.6-terra';
  // Anthropic defaults to Opus 5 explicitly, NOT the first list entry: Fable 5 is
  // listed first (dropdown order) but is pricier, so it shouldn't be an auto-selected
  // default. Opus 5 is a drop-in for Opus 4.8 at the same price; like Fable it can
  // refuse for safety, which is why both carry the fallbacks:"default" wiring.
  if (provider === 'anthropic') return 'claude-opus-5';
  // Gemini defaults to 3.6 Flash rather than the top-listed 3.1 Pro.
  if (provider === 'google') return 'gemini-3.6-flash';
  const models = ALL_MODELS.filter((m) => m.provider === provider);
  return models[0]?.id ?? 'claude-opus-5';
}

// Check if a model is Claude Opus 5. Shares Opus 4.8's request surface (adaptive
// thinking + effort incl. xhigh/max, no sampling params, no budget thinking) with two
// differences relevant to this app:
//  - thinking is ON when the thinking param is omitted (unlike 4.8, where omitting it
//    meant no thinking) — so the app's "off" level would silently run adaptive; we
//    treat thinking as always-on (see alwaysOnThinking).
//  - safety classifiers can refuse a request; we send fallbacks:"default" so the API
//    retries on Anthropic's recommended fallback (see providers/anthropic.rs).
export function isOpus5(modelId: string): boolean {
  return modelId === 'claude-opus-5';
}

// Check if a model is Opus 4.8 (supports adaptive thinking + effort, no sampling params, no budget thinking)
export function isOpus48(modelId: string): boolean {
  return modelId === 'claude-opus-4-8';
}

// Check if a model is Opus 4.6 (supports adaptive thinking + effort)
export function isOpus46(modelId: string): boolean {
  return modelId === 'claude-opus-4-6';
}

// Check if a model is Claude Sonnet 5. Shares the Opus 4.8 request surface (adaptive
// thinking + effort, including xhigh; no sampling params, no budget thinking), and
// unlike Fable it can be turned off (thinking:{type:"disabled"} is accepted). Sonnet 5
// benefits notably from higher effort, so the app defaults its thinking level to
// 'high' in BOTH the chat and discovery panes (see settingsStore.ts) — this is why it
// gets its own localStorage keys with a 'high' default.
export function isSonnet5(modelId: string): boolean {
  return modelId === 'claude-sonnet-5';
}

// Check if a model is Claude Fable 5. Fable shares Opus 4.8's effort/adaptive-thinking
// surface but with two differences relevant to this app:
//  - thinking is ALWAYS on, so there is no "off" level (see thinkingOptions.ts).
//  - safety classifiers can refuse a request; we fall back to Opus 4.8 server-side
//    (see the Rust providers/anthropic.rs fallback wiring).
export function isFable5(modelId: string): boolean {
  return modelId === 'claude-fable-5';
}

// Whether the app treats thinking as always-on for this model — i.e. it should NOT
// offer an "off" option. Three models converge on the same UI for related reasons:
//  - Fable 5: thinking cannot be disabled at all (thinking:{type:"disabled"} is a 400),
//    and omitting the param still runs adaptive thinking.
//  - Sonnet 5: off is technically legal (disabled is accepted), but it's a poor choice
//    for this model AND the app implements "off" by omitting the thinking param — which
//    on Sonnet 5 silently runs adaptive anyway (a documented Sonnet-5 default change).
//    Rather than expose a misleading "off", we lock thinking on and floor at Low.
//  - Opus 5: same omission trap as Sonnet 5 (thinking is on by default), and a true
//    "disabled" is doubly unattractive: it's rejected at xhigh/max effort, and per the
//    migration guide it can emit tool calls as plain text (the call silently never
//    runs) or leak thinking tags — bad news for an app with web_search/code_execution.
export function alwaysOnThinking(modelId: string): boolean {
  return isFable5(modelId) || isSonnet5(modelId) || isOpus5(modelId);
}

// Check if a model uses adaptive thinking (Fable 5, Opus 5, Opus 4.8, Opus 4.6, and Sonnet 5)
export function usesAdaptiveThinking(modelId: string): boolean {
  return isFable5(modelId) || isOpus5(modelId) || isOpus48(modelId) || isOpus46(modelId) || isSonnet5(modelId);
}

// Check if a model supports extended thinking (Fable 5, Opus models, and Sonnet 5)
export function supportsExtendedThinking(modelId: string): boolean {
  return isFable5(modelId) || modelId.includes('opus') || isSonnet5(modelId);
}

// The discovery pane's default evaluator model now lives in discoveryModes.ts,
// where it is DERIVED from MODE_MODEL_PRIORITIES (the same table the auto-picker
// reads) rather than hand-maintained here. Re-exported for convenience.
export { getDefaultEvaluatorModel, getDefaultEvaluatorModelForProvider } from './discoveryModes';
