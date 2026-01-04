import type { OpenAIReasoningLevel, GeminiThinkingLevel } from './types';

export interface ThinkingOption<T> {
  value: T;
  label: string;
  letter: string;
}

// Reasoning level options for OpenAI dropdown
export const REASONING_OPTIONS: ThinkingOption<OpenAIReasoningLevel>[] = [
  { value: 'off', label: 'Off', letter: '' },
  { value: 'minimal', label: 'Minimal', letter: 'm' },
  { value: 'low', label: 'Low', letter: 'L' },
  { value: 'medium', label: 'Medium', letter: 'M' },
  { value: 'high', label: 'High', letter: 'H' },
  { value: 'xhigh', label: 'Extra High', letter: 'X' },
];

// Thinking level options for Gemini 3 Pro (only LOW and HIGH - thinking cannot be disabled)
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
