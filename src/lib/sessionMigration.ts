import type { ChatSessionSettings } from './types';

const LEGACY_OPUS_45_ID = 'claude-opus-4-5-20251101';
const LEGACY_OPUS_47_ID = 'claude-opus-4-7';
const REPLACEMENT_OPUS_ID = 'claude-opus-4-8';

// Map of retired OpenAI GPT-5.x IDs to their replacement in the 5.6 family
// (Sol = flagship $5/$30, Terra = balanced $2.50/$15, Luna = light $1/$6):
// - mid-tier line (5.1/5.2, and 5.4's price point) -> Terra (identical pricing to 5.4)
// - flagship line (5.5) and pro (5-pro/5.5-pro) -> Sol (same price as 5.5; 5.6 has
//   no separate pro model — "pro" is now a reasoning.mode request param)
// - mini line -> Luna
// NOTE: gpt-5.4 itself is deliberately NOT in this map. It is still a live model,
// kept for the discovery pane (auto-pick, see discoveryModes.ts) — only the main
// chat frontier slot migrates off it, via migrateFrontierModelId below.
const LEGACY_GPT_IDS: Record<string, string> = {
  'gpt-5.2': 'gpt-5.6-terra',
  'gpt-5.1': 'gpt-5.6-terra',
  'gpt-5-mini': 'gpt-5.6-luna',
  'gpt-5.4-mini': 'gpt-5.6-luna',
  'gpt-5-pro': 'gpt-5.6-sol',
  'gpt-5.5-pro': 'gpt-5.6-sol',
  'gpt-5.5': 'gpt-5.6-sol',
};

// Map of retired Gemini IDs to their replacement.
// - Gemini 3.5 Flash was replaced by the GA Gemini 3.6 Flash (July 2026); the
//   older Flash IDs forward straight to 3.6 rather than hopping through 3.5.
//   3.5 Flash is NOT retired by Google (retirement listed as May 2027 or
//   later) — the app simply moved its Flash slot to 3.6.
// - Gemini 2.5 models were removed; Pro -> 3.1 Pro, Flash -> 3.6 Flash.
const LEGACY_GEMINI_IDS: Record<string, string> = {
  'gemini-3-flash-preview': 'gemini-3.6-flash',
  'gemini-3.5-flash': 'gemini-3.6-flash',
  'gemini-2.5-pro': 'gemini-3.1-pro-preview',
  'gemini-2.5-flash': 'gemini-3.6-flash',
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

// Frontier-slot-only migration. gpt-5.4 is still a valid model for the discovery
// pane (evaluator slot), but it is hidden from the main chat picker, so a saved
// FRONTIER selection of gpt-5.4 moves to the identically-priced gpt-5.6-terra.
// Never apply this to evaluator/discovery model IDs. Idempotent.
export function migrateFrontierModelId(modelId: string | undefined | null): string {
  const migrated = migrateLegacyModelId(modelId);
  return migrated === 'gpt-5.4' ? 'gpt-5.6-terra' : migrated;
}

// Translate a saved ChatSessionSettings object so it works on a build that no
// longer supports Opus 4.5. Idempotent.
export function migrateChatSessionSettings(s: ChatSessionSettings): ChatSessionSettings {
  const wasOpus45Frontier = s.frontierModel === LEGACY_OPUS_45_ID;
  const wasOpus45Evaluator = s.evaluatorModel === LEGACY_OPUS_45_ID;

  return {
    ...s,
    frontierModel: migrateFrontierModelId(s.frontierModel),
    evaluatorModel: migrateLegacyModelId(s.evaluatorModel),
    frontierOpus46ThinkingLevel:
      s.frontierOpus46ThinkingLevel ??
      (wasOpus45Frontier && s.extendedThinkingEnabled ? 'high' : undefined),
    evaluatorOpus46ThinkingLevel:
      s.evaluatorOpus46ThinkingLevel ??
      (wasOpus45Evaluator && s.evaluatorExtendedThinkingEnabled ? 'high' : undefined),
  };
}
