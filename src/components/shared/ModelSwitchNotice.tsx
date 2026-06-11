import type { ModelSwitch } from '../../lib/types';

// The approved, fixed wording for a Fable 5 → Opus 4.8 safety fallback. The fallback
// target is always Opus 4.8 today, so the sentence is fixed rather than derived from
// the model ids (those are still carried on `modelSwitch` for future use / debugging).
const NOTICE_TEXT = 'Fable handed this off to Opus 4.8 for safety reasons.';

interface ModelSwitchNoticeProps {
  modelSwitch?: ModelSwitch;
}

// Purple tint, shared by the chat and discovery panes (deliberately NOT the amber of
// the user-input bubble, which it would otherwise blend into).
const NOTICE_CLASSES =
  'bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-950/40 dark:text-purple-200 dark:border-purple-800/60';

/**
 * Inline notice shown when Claude Fable 5 refused a request for safety and the API
 * answered with the Opus 4.8 fallback. Rendered above the chat message and at the top
 * of a discovery turn's chips.
 */
export function ModelSwitchNotice({ modelSwitch }: ModelSwitchNoticeProps) {
  if (!modelSwitch) return null;

  return (
    <div
      className={`flex items-center gap-1.5 text-xs rounded-md border px-2.5 py-1.5 mb-2 ${NOTICE_CLASSES}`}
      title={`${modelSwitch.fromModel} → ${modelSwitch.toModel}`}
    >
      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{NOTICE_TEXT}</span>
    </div>
  );
}
