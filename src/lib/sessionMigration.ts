import type { ChatSessionSettings } from './types';

const LEGACY_OPUS_45_ID = 'claude-opus-4-5-20251101';
const LEGACY_OPUS_47_ID = 'claude-opus-4-7';
const REPLACEMENT_OPUS_ID = 'claude-opus-4-8';

// Map of retired OpenAI GPT-5.x IDs to their replacement.
// 5.2 and 5.1 both collapse to 5.4 (5.5 is 2x the price for marginal gains).
const LEGACY_GPT_IDS: Record<string, string> = {
  'gpt-5.2': 'gpt-5.4',
  'gpt-5.1': 'gpt-5.4',
  'gpt-5-mini': 'gpt-5.4-mini',
  'gpt-5-pro': 'gpt-5.5-pro',
};

// Map of retired Gemini IDs to their replacement.
// - Gemini 3 Flash Preview is superseded by the GA Gemini 3.5 Flash.
// - Gemini 2.5 models were removed; Pro -> 3.1 Pro, Flash -> 3.5 Flash.
const LEGACY_GEMINI_IDS: Record<string, string> = {
  'gemini-3-flash-preview': 'gemini-3.5-flash',
  'gemini-2.5-pro': 'gemini-3.1-pro-preview',
  'gemini-2.5-flash': 'gemini-3.5-flash',
};

// Rewrite a legacy model ID to its current replacement. Idempotent.
// Opus 4.5 and 4.7 both forward to the current Opus (4.8); 4.5→4.8 is a two-hop
// upgrade that skips the 4.6 way-station, which is fine because 4.6 is still
// supported and the user could pick it manually.
export function migrateLegacyModelId(modelId: string | undefined | null): string {
  if (modelId === LEGACY_OPUS_45_ID) return REPLACEMENT_OPUS_ID;
  if (modelId === LEGACY_OPUS_47_ID) return REPLACEMENT_OPUS_ID;
  if (modelId && modelId in LEGACY_GPT_IDS) return LEGACY_GPT_IDS[modelId];
  if (modelId && modelId in LEGACY_GEMINI_IDS) return LEGACY_GEMINI_IDS[modelId];
  return modelId ?? REPLACEMENT_OPUS_ID;
}

// Translate a saved ChatSessionSettings object so it works on a build that no
// longer supports Opus 4.5. Idempotent.
export function migrateChatSessionSettings(s: ChatSessionSettings): ChatSessionSettings {
  const wasOpus45Frontier = s.frontierModel === LEGACY_OPUS_45_ID;
  const wasOpus45Evaluator = s.evaluatorModel === LEGACY_OPUS_45_ID;

  return {
    ...s,
    frontierModel: migrateLegacyModelId(s.frontierModel),
    evaluatorModel: migrateLegacyModelId(s.evaluatorModel),
    frontierOpus46ThinkingLevel:
      s.frontierOpus46ThinkingLevel ??
      (wasOpus45Frontier && s.extendedThinkingEnabled ? 'high' : undefined),
    evaluatorOpus46ThinkingLevel:
      s.evaluatorOpus46ThinkingLevel ??
      (wasOpus45Evaluator && s.evaluatorExtendedThinkingEnabled ? 'high' : undefined),
  };
}
