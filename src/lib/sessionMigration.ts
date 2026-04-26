import type { ChatSessionSettings } from './types';

const LEGACY_OPUS_45_ID = 'claude-opus-4-5-20251101';
const REPLACEMENT_OPUS_ID = 'claude-opus-4-6';

// Rewrite a legacy Opus 4.5 model ID to its Opus 4.6 replacement. Idempotent.
export function migrateLegacyModelId(modelId: string | undefined | null): string {
  if (modelId === LEGACY_OPUS_45_ID) return REPLACEMENT_OPUS_ID;
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
