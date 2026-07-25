import type { OpenAIReasoningLevel, GeminiThinkingLevel, Opus46ThinkingLevel } from './types';
import { supportsExtendedThinking, alwaysOnThinking, isGpt56Family } from './models';

export interface ThinkingOption<T> {
  value: T;
  label: string;
  letter: string;
}

// Reasoning level options for pre-5.6 OpenAI models (GPT-5.4)
export const REASONING_OPTIONS: ThinkingOption<OpenAIReasoningLevel>[] = [
  { value: 'off', label: 'Off', letter: '' },
  { value: 'minimal', label: 'Minimal', letter: 'm' },
  { value: 'low', label: 'Low', letter: 'L' },
  { value: 'medium', label: 'Medium', letter: 'M' },
  { value: 'high', label: 'High', letter: 'H' },
  { value: 'xhigh', label: 'Extra High', letter: 'X' },
];

// Reasoning level options for the GPT-5.6 family (Sol / Terra / Luna). 5.6
// dropped 'minimal' and added 'max' above 'xhigh'; 'off' maps to effort "none"
// in the Rust provider. The API rejects 'minimal' on these models.
export const GPT_56_REASONING_OPTIONS: ThinkingOption<OpenAIReasoningLevel>[] = [
  { value: 'off', label: 'Off', letter: '' },
  { value: 'low', label: 'Low', letter: 'L' },
  { value: 'medium', label: 'Medium', letter: 'M' },
  { value: 'high', label: 'High', letter: 'H' },
  { value: 'xhigh', label: 'Extra High', letter: 'X' },
  { value: 'max', label: 'Max', letter: 'M+' },
];

// Thinking level options for Gemini 3.1 Pro (only LOW and HIGH - thinking cannot be disabled)
export const GEMINI_3_PRO_OPTIONS: ThinkingOption<GeminiThinkingLevel>[] = [
  { value: 'low', label: 'Low', letter: 'L' },
  { value: 'high', label: 'High', letter: 'H' },
];

// Thinking level options for Gemini 3.x Flash (minimal is closest to "off" but doesn't guarantee no thinking)
export const GEMINI_3_FLASH_OPTIONS: ThinkingOption<GeminiThinkingLevel>[] = [
  { value: 'minimal', label: 'Minimal', letter: 'm' },
  { value: 'low', label: 'Low', letter: 'L' },
  { value: 'medium', label: 'Medium', letter: 'M' },
  { value: 'high', label: 'High', letter: 'H' },
];

// Helper to get the right Gemini options based on model.
// All supported Gemini models are 3.x: Flash exposes more levels than Pro.
export function getGeminiThinkingOptions(model: string): ThinkingOption<GeminiThinkingLevel>[] {
  return model.includes('flash') ? GEMINI_3_FLASH_OPTIONS : GEMINI_3_PRO_OPTIONS;
}

// Get a valid thinking level for the current model (normalizes invalid values)
export function getValidGeminiThinkingLevel(
  level: GeminiThinkingLevel,
  model: string
): GeminiThinkingLevel {
  const options = getGeminiThinkingOptions(model);
  const isValid = options.some((o) => o.value === level);
  // If current level is valid for this model, use it; otherwise use the first option
  return isValid ? level : options[0].value;
}

// Helper to get display letter for current Gemini thinking level
export function getGeminiThinkingLetter(level: GeminiThinkingLevel, model: string): string {
  const options = getGeminiThinkingOptions(model);
  const option = options.find((o) => o.value === level);
  return option?.letter || '';
}

// Helper to get the right OpenAI reasoning options based on model and settings
export function getOpenAIReasoningOptions(
  model: string,
  options: { allowExtraHigh?: boolean; webSearchEnabled?: boolean } = {}
): ThinkingOption<OpenAIReasoningLevel>[] {
  const { allowExtraHigh = false, webSearchEnabled = false } = options;

  let result = isGpt56Family(model) ? GPT_56_REASONING_OPTIONS : REASONING_OPTIONS;

  // xhigh and max are both slow/expensive tiers hidden behind the same
  // "allow extra-high thinking" setting
  if (!allowExtraHigh) {
    result = result.filter(o => o.value !== 'xhigh' && o.value !== 'max');
  }

  // The API rejects 'minimal' combined with web_search (verified empirically on
  // gpt-5.4; 5.6 has no minimal at all). 'off' (effort none) works fine with web
  // search — a real search executes — so it stays available: the web-search and
  // thinking settings are otherwise orthogonal.
  if (webSearchEnabled) {
    result = result.filter(o => o.value !== 'minimal');
  }

  return result;
}

// Get a valid reasoning level for the current OpenAI model (normalizes invalid values)
export function getValidOpenAIReasoningLevel(
  level: OpenAIReasoningLevel,
  model: string,
  webSearchEnabled: boolean = false
): OpenAIReasoningLevel {
  // Get options considering web search constraint (but allow all xhigh for validation)
  const opts = getOpenAIReasoningOptions(model, { allowExtraHigh: true, webSearchEnabled });
  const isValid = opts.some((o) => o.value === level);
  if (isValid) return level;
  // Map levels the other model generation doesn't have to their nearest
  // neighbor instead of falling to the first option (which would silently
  // turn reasoning off): 'minimal' (pre-5.6 only) -> 'low', 'max' (5.6 only)
  // -> 'xhigh'.
  if (level === 'minimal' && opts.some((o) => o.value === 'low')) return 'low';
  if (level === 'max' && opts.some((o) => o.value === 'xhigh')) return 'xhigh';
  return opts[0].value;
}

// Helper to get display letter for current OpenAI reasoning level
export function getOpenAIReasoningLetter(level: OpenAIReasoningLevel, model: string): string {
  const opts = getOpenAIReasoningOptions(model, { allowExtraHigh: true });
  const option = opts.find((o) => o.value === level);
  return option?.letter || '';
}

// =============================================================================
// Anthropic Claude Thinking Options (adaptive-thinking models; type name kept as Opus46 for wire compat)
// =============================================================================

// Adaptive thinking + effort levels for Anthropic models.
// xhigh is recommended for coding/agentic tasks on Opus 4.8.
export const OPUS_46_THINKING_OPTIONS: ThinkingOption<Opus46ThinkingLevel>[] = [
  { value: 'off', label: 'Off', letter: '' },
  { value: 'low', label: 'Low', letter: 'L' },
  { value: 'medium', label: 'Medium', letter: 'M' },
  { value: 'high', label: 'High', letter: 'H' },
  { value: 'xhigh', label: 'Extra High', letter: 'X' },
  { value: 'max', label: 'Max', letter: 'M+' },
  { value: 'adaptive', label: 'Adaptive', letter: 'A' },
];

// Thinking levels for always-on models (Fable 5, Opus 5, Sonnet 5): same as Opus 4.8
// but WITHOUT 'off'. See alwaysOnThinking() in models.ts for why these drop 'off'
// (Fable can't be disabled; Opus 5's and Sonnet 5's "off" would silently run adaptive,
// since the app implements "off" by omitting the thinking param). Low is the floor.
export const NO_OFF_THINKING_OPTIONS: ThinkingOption<Opus46ThinkingLevel>[] =
  OPUS_46_THINKING_OPTIONS.filter((o) => o.value !== 'off');

// Get thinking options based on Anthropic model
export function getAnthropicThinkingOptions(model: string): ThinkingOption<Opus46ThinkingLevel>[] {
  if (alwaysOnThinking(model)) return NO_OFF_THINKING_OPTIONS;
  return supportsExtendedThinking(model) ? OPUS_46_THINKING_OPTIONS : [];
}

// Get a valid thinking level for the current Anthropic model (normalizes invalid values)
export function getValidAnthropicThinkingLevel(
  level: Opus46ThinkingLevel,
  model: string
): Opus46ThinkingLevel {
  const options = getAnthropicThinkingOptions(model);
  if (options.length === 0) return 'off';
  const isValid = options.some((o) => o.value === level);
  return isValid ? level : (options[0].value as Opus46ThinkingLevel);
}

// Helper to get display letter for current Anthropic thinking level
export function getAnthropicThinkingLetter(level: Opus46ThinkingLevel, model: string): string {
  const options = getAnthropicThinkingOptions(model);
  const option = options.find((o) => o.value === level);
  return option?.letter || '';
}
