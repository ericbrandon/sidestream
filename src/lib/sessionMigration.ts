import type { ChatSessionSettings } from './types';

const LEGACY_OPUS_45_ID = 'claude-opus-4-5-20251101';
const REPLACEMENT_OPUS_ID = 'claude-opus-4-6';

// Map of retired OpenAI GPT-5.x IDs to their replacement.
// 5.2 and 5.1 both collapse to 5.4 (5.5 is 2x the price for marginal gains).
const LEGACY_GPT_IDS: Record<string, string> = {
  'gpt-5.2': 'gpt-5.4',
  'gpt-5.1': 'gpt-5.4',
  'gpt-5-mini': 'gpt-5.4-mini',
  'gpt-5-pro': 'gpt-5.5-pro',
};

// Rewrite a legacy model ID to its current replacement. Idempotent.
export function migrateLegacyModelId(modelId: string | undefined | null): string {
  if (modelId === LEGACY_OPUS_45_ID) return REPLACEMENT_OPUS_ID;
  if (modelId && modelId in LEGACY_GPT_IDS) return LEGACY_GPT_IDS[modelId];
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
