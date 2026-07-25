import type { ModelSwitch, ModelSwitchHop } from './types';
import { ALL_MODELS } from './models';

// Accumulate a server-side fallback hop into a turn's ModelSwitch. A single turn can
// emit multiple `fallback` blocks since the Opus 5 launch (e.g. Fable 5 → Opus 5 →
// Opus 4.8), delivered as one chat-model-switch / discovery-model-switch event per
// hop. `fromModel`/`toModel` stay the chain summary (first from → latest to) so
// everything that renders or persists a ModelSwitch keeps working unchanged.
//
// Defensive dedupe: if the same hop arrives twice (e.g. a synthesized sticky-routing
// event racing a real block, which the Rust side already guards against), ignore it.
export function appendModelSwitchHop(
  prev: ModelSwitch | null | undefined,
  hop: ModelSwitchHop
): ModelSwitch {
  if (!prev) {
    return { fromModel: hop.fromModel, toModel: hop.toModel, hops: [hop] };
  }
  // Older persisted values may predate `hops`; reconstruct the single hop they imply.
  const hops = prev.hops ?? [{ fromModel: prev.fromModel, toModel: prev.toModel }];
  const isDuplicate = hops.some(
    (h) => h.fromModel === hop.fromModel && h.toModel === hop.toModel
  );
  if (isDuplicate) {
    return { ...prev, hops };
  }
  return {
    fromModel: prev.fromModel,
    toModel: hop.toModel,
    hops: [...hops, hop],
  };
}

// Short display names for the notice sentence. The refusal-capable models and their
// fallback targets get hand-tuned short forms ("Fable", matching the original approved
// wording); anything else falls back to the registry name minus the "Claude " prefix,
// and an unknown/empty id (the API can omit model fields on a fallback block) renders
// as a generic phrase rather than a raw id.
function shortModelName(modelId: string): string {
  if (!modelId) return 'another model';
  if (modelId === 'claude-fable-5') return 'Fable';
  const registered = ALL_MODELS.find((m) => m.id === modelId);
  if (registered) return registered.name.replace(/^Claude /, '');
  return modelId;
}

// The user-facing sentence for a fallback notice, derived from the hop chain.
// Shapes it produces:
//   "Fable handed this off to Opus 4.8 for safety reasons."
//   "Fable handed this off to Opus 5 for safety reasons."
//   "Fable handed this off to Opus 5, which handed it off to Opus 4.8, for safety reasons."
//   "Opus 5 handed this off to Opus 4.8 for safety reasons."
export function describeModelSwitch(modelSwitch: ModelSwitch): string {
  const hops =
    modelSwitch.hops && modelSwitch.hops.length > 0
      ? modelSwitch.hops
      : [{ fromModel: modelSwitch.fromModel, toModel: modelSwitch.toModel }];

  const first = hops[0];
  let sentence = `${shortModelName(first.fromModel)} handed this off to ${shortModelName(first.toModel)}`;
  for (const hop of hops.slice(1)) {
    sentence += `, which handed it off to ${shortModelName(hop.toModel)}`;
  }
  sentence += hops.length > 1 ? ', for safety reasons.' : ' for safety reasons.';
  return sentence;
}

// Tooltip text: the raw id chain, e.g. "claude-fable-5 → claude-opus-5 → claude-opus-4-8".
export function modelSwitchIdChain(modelSwitch: ModelSwitch): string {
  const hops =
    modelSwitch.hops && modelSwitch.hops.length > 0
      ? modelSwitch.hops
      : [{ fromModel: modelSwitch.fromModel, toModel: modelSwitch.toModel }];
  return [hops[0].fromModel, ...hops.map((h) => h.toModel)].join(' → ');
}
