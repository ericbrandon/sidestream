import type { OpenAIReasoningLevel, GeminiThinkingLevel, Opus46ThinkingLevel } from './types';
import { usesAdaptiveThinking, supportsExtendedThinking } from './models';

export interface ThinkingOption<T> {
  value: T;
  label: string;
  letter: string;
}

// Reasoning level options for standard OpenAI models
export const REASONING_OPTIONS: ThinkingOption<OpenAIReasoningLevel>[] = [
  { value: 'off', label: 'Off', letter: '' },
  { value: 'minimal', label: 'Minimal', letter: 'm' },
  { value: 'low', label: 'Low', letter: 'L' },
  { value: 'medium', label: 'Medium', letter: 'M' },
  { value: 'high', label: 'High', letter: 'H' },
  { value: 'xhigh', label: 'Extra High', letter: 'X' },
];

// Reasoning level options for GPT-5 Pro (only supports 'high')
export const GPT5_PRO_REASONING_OPTIONS: ThinkingOption<OpenAIReasoningLevel>[] = [
  { value: 'high', label: 'High', letter: 'H' },
];

// Thinking level options for Gemini 3.1 Pro (only LOW and HIGH - thinking cannot be disabled)
export const GEMINI_3_PRO_OPTIONS: ThinkingOption<GeminiThinkingLevel>[] = [
  { value: 'low', label: 'Low', letter: 'L' },
  { value: 'high', label: 'High', letter: 'H' },
];

// Thinking level options for Gemini 3 Flash (minimal is closest to "off" but doesn't guarantee no thinking)
export const GEMINI_3_FLASH_OPTIONS: ThinkingOption<GeminiThinkingLevel>[] = [
  { value: 'minimal', label: 'Minimal', letter: 'm' },
  { value: 'low', label: 'Low', letter: 'L' },
  { value: 'medium', label: 'Medium', letter: 'M' },
  { value: 'high', label: 'High', letter: 'H' },
];

// Thinking level options for Gemini 2.5 (just off/on)
export const GEMINI_25_OPTIONS: ThinkingOption<GeminiThinkingLevel>[] = [
  { value: 'off', label: 'Off', letter: '' },
  { value: 'on', label: 'On', letter: '●' },
];

// Helper to get the right Gemini options based on model
export function getGeminiThinkingOptions(model: string): ThinkingOption<GeminiThinkingLevel>[] {
  if (model.includes('gemini-3') || model.includes('gemini3')) {
    if (model.includes('flash')) {
      return GEMINI_3_FLASH_OPTIONS;
    }
    return GEMINI_3_PRO_OPTIONS;
  }
  // Gemini 2.5
  return GEMINI_25_OPTIONS;
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

  if (model === 'gpt-5-pro') {
    return GPT5_PRO_REASONING_OPTIONS;
  }

  let result = REASONING_OPTIONS;

  // Filter xhigh based on allowExtraHigh setting
  if (!allowExtraHigh) {
    result = result.filter(o => o.value !== 'xhigh');
  }

  // Web search requires at least 'low' reasoning - filter out 'off' and 'minimal'
  if (webSearchEnabled) {
    result = result.filter(o => o.value !== 'off' && o.value !== 'minimal');
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
  // If current level is valid for this model, use it; otherwise use the first option
  return isValid ? level : opts[0].value;
}

// Helper to get display letter for current OpenAI reasoning level
export function getOpenAIReasoningLetter(level: OpenAIReasoningLevel, model: string): string {
  const opts = getOpenAIReasoningOptions(model, { allowExtraHigh: true });
  const option = opts.find((o) => o.value === level);
  return option?.letter || '';
}

// =============================================================================
// Anthropic Claude Thinking Options (Opus 4.6 / Sonnet 4.6 vs Opus 4.5)
// =============================================================================

// Thinking options for Opus 4.6 and Sonnet 4.6 (adaptive thinking + effort levels)
export const OPUS_46_THINKING_OPTIONS: ThinkingOption<Opus46ThinkingLevel>[] = [
  { value: 'off', label: 'Off', letter: '' },
  { value: 'low', label: 'Low', letter: 'L' },
  { value: 'medium', label: 'Medium', letter: 'M' },
  { value: 'high', label: 'High', letter: 'H' },
  { value: 'max', label: 'Max', letter: 'X' },
  { value: 'adaptive', label: 'Adaptive', letter: 'A' },
];

// Thinking options for Opus 4.5 (budget-based extended thinking)
// Using Opus46ThinkingLevel type but only 'off' and 'high' (maps to enabled)
export const OPUS_45_THINKING_OPTIONS: ThinkingOption<'off' | 'high'>[] = [
  { value: 'off', label: 'Off', letter: '' },
  { value: 'high', label: 'On', letter: '●' },
];

// Get thinking options based on Anthropic model
export function getAnthropicThinkingOptions(model: string): ThinkingOption<Opus46ThinkingLevel | 'off' | 'high'>[] {
  if (!supportsExtendedThinking(model)) {
    return []; // Models without thinking support
  }
  if (usesAdaptiveThinking(model)) {
    return OPUS_46_THINKING_OPTIONS;
  }
  // Opus 4.5 and other models with budget-based thinking
  return OPUS_45_THINKING_OPTIONS;
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
