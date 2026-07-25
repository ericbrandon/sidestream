import type { ModelSwitch } from '../../lib/types';
import { describeModelSwitch, modelSwitchIdChain } from '../../lib/modelSwitch';

interface ModelSwitchNoticeProps {
  modelSwitch?: ModelSwitch;
}

// Purple tint, shared by the chat and discovery panes (deliberately NOT the amber of
// the user-input bubble, which it would otherwise blend into).
const NOTICE_CLASSES =
  'bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-950/40 dark:text-purple-200 dark:border-purple-800/60';

/**
 * Inline notice shown when the requested model (Fable 5 or Opus 5) refused a request
 * for safety and the API answered with a fallback model. Rendered above the chat
 * message and at the top of a discovery turn's chips. The wording is derived from the
 * hop chain — a single turn can chain (Fable → Opus 5 → Opus 4.8) since the Opus 5
 * launch, and sticky-routed turns surface here too.
 */
export function ModelSwitchNotice({ modelSwitch }: ModelSwitchNoticeProps) {
  if (!modelSwitch) return null;

  return (
    <div
      className={`flex items-center gap-1.5 text-xs rounded-md border px-2.5 py-1.5 mb-2 ${NOTICE_CLASSES}`}
      title={modelSwitchIdChain(modelSwitch)}
    >
      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{describeModelSwitch(modelSwitch)}</span>
    </div>
  );
}
