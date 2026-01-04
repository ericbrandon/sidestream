import { useRef, useEffect, useState } from 'react';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useChatStore } from '../../stores/chatStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useChat } from '../../hooks/useChat';
import { AttachmentButton } from './AttachmentButton';
import { AttachmentPreview } from './AttachmentPreview';
import { VoiceInputButton } from './VoiceInputButton';
import { Tooltip } from '../shared/Tooltip';
import { ContextMenu, type ContextMenuItem } from '../shared/ContextMenu';
import { InlineModelPicker } from '../shared/InlineModelPicker';
import { getProviderFromModelId } from '../../lib/models';
import type { OpenAIReasoningLevel, GeminiThinkingLevel } from '../../lib/types';

// Reasoning level options for OpenAI dropdown
const REASONING_OPTIONS: { value: OpenAIReasoningLevel; label: string; letter: string }[] = [
  { value: 'off', label: 'Off', letter: '' },
  { value: 'minimal', label: 'Minimal', letter: 'm' },
  { value: 'low', label: 'Low', letter: 'L' },
  { value: 'medium', label: 'Medium', letter: 'M' },
  { value: 'high', label: 'High', letter: 'H' },
  { value: 'xhigh', label: 'Extra High', letter: 'X' },
];

// Thinking level options for Gemini 3 Pro (only LOW and HIGH - thinking cannot be disabled)
const GEMINI_3_PRO_OPTIONS: { value: GeminiThinkingLevel; label: string; letter: string }[] = [
  { value: 'low', label: 'Low', letter: 'L' },
  { value: 'high', label: 'High', letter: 'H' },
];

// Thinking level options for Gemini 3 Flash (minimal is closest to "off" but doesn't guarantee no thinking)
const GEMINI_3_FLASH_OPTIONS: { value: GeminiThinkingLevel; label: string; letter: string }[] = [
  { value: 'minimal', label: 'Minimal', letter: 'm' },
  { value: 'low', label: 'Low', letter: 'L' },
  { value: 'medium', label: 'Medium', letter: 'M' },
  { value: 'high', label: 'High', letter: 'H' },
];

// Thinking level options for Gemini 2.5 (just off/on)
const GEMINI_25_OPTIONS: { value: GeminiThinkingLevel; label: string; letter: string }[] = [
  { value: 'off', label: 'Off', letter: '' },
  { value: 'on', label: 'On', letter: '●' },
];

// Helper to get the right Gemini options based on model
function getGeminiThinkingOptions(model: string) {
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
function getValidGeminiThinkingLevel(level: GeminiThinkingLevel, model: string): GeminiThinkingLevel {
  const options = getGeminiThinkingOptions(model);
  const isValid = options.some(o => o.value === level);
  // If current level is valid for this model, use it; otherwise use the first option
  return isValid ? level : options[0].value;
}

// Helper to get display letter for current Gemini thinking level
function getGeminiThinkingLetter(level: GeminiThinkingLevel, model: string): string {
  const options = getGeminiThinkingOptions(model);
  const option = options.find(o => o.value === level);
  return option?.letter || '';
}

export function ChatInput() {
  const { inputValue, setInput, isStreaming, attachments, registerChatInputFocus } = useChatStore();
  const { frontierLLM, setFrontierLLM, voiceMode } = useSettingsStore();
  const { sendMessage, sendTranscribedMessage, cancelStream } = useChat();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [showThinkingMenu, setShowThinkingMenu] = useState(false);

  // Register focus function for global keyboard handling
  useEffect(() => {
    registerChatInputFocus(() => {
      textareaRef.current?.focus();
    });
  }, [registerChatInputFocus]);

  // Determine provider for current model
  const provider = getProviderFromModelId(frontierLLM.model);
  const geminiThinkingOptions = provider === 'google' ? getGeminiThinkingOptions(frontierLLM.model) : [];
  // Normalize the thinking level to a valid value for the current model
  const effectiveGeminiThinkingLevel = provider === 'google'
    ? getValidGeminiThinkingLevel(frontierLLM.geminiThinkingLevel, frontierLLM.model)
    : frontierLLM.geminiThinkingLevel;

  const handleSubmit = () => {
    if (inputValue.trim() && !isStreaming) {
      sendMessage(inputValue.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Pre-fetch clipboard using Tauri API for system clipboard access
    let clipboardText = '';
    try {
      clipboardText = await readText() || '';
    } catch {
      // Clipboard read failed - paste will be disabled
    }

    const menuItems: ContextMenuItem[] = [];
    const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);

    if (selectedText) {
      menuItems.push(
        { label: 'Cut', onClick: async () => {
          await writeText(selectedText);
          const before = textarea.value.substring(0, textarea.selectionStart);
          const after = textarea.value.substring(textarea.selectionEnd);
          setInput(before + after);
        }},
        { label: 'Copy', onClick: () => writeText(selectedText) }
      );
    }

    if (clipboardText) {
      menuItems.push({
        label: 'Paste',
        onClick: () => {
          const before = textarea.value.substring(0, textarea.selectionStart);
          const after = textarea.value.substring(textarea.selectionEnd);
          setInput(before + clipboardText + after);
        }
      });
    }

    if (inputValue) {
      menuItems.push({ label: 'Select All', onClick: () => textarea.select() });
    }

    // Only show context menu if there are items to display
    if (menuItems.length > 0) {
      setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [inputValue]);

  return (
    <div className="p-4 border-t border-stone-200 dark:border-gray-700">
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {attachments.map((attachment) => (
            <AttachmentPreview key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}

      <div className="flex gap-2 items-end">
        <AttachmentButton />

        {/* Thinking/Reasoning Control - Provider-specific */}
        {provider === 'openai' ? (
          /* OpenAI: Reasoning Level Dropdown */
          <div className="relative">
            <Tooltip content={`Reasoning: ${frontierLLM.reasoningLevel}`}>
              <button
                onClick={() => setShowThinkingMenu(!showThinkingMenu)}
                className={`
                  p-2 rounded transition-colors flex items-center gap-1
                  ${
                    frontierLLM.reasoningLevel !== 'off'
                      ? 'text-purple-600 bg-purple-50 hover:bg-purple-100 dark:text-purple-400 dark:bg-purple-900/50 dark:hover:bg-purple-900/70'
                      : 'text-stone-500 hover:text-purple-600 hover:bg-purple-50 dark:text-gray-400 dark:hover:text-purple-400 dark:hover:bg-purple-900/30'
                  }
                `}
                aria-label="Set reasoning level"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-xs font-medium uppercase">
                  {REASONING_OPTIONS.find(o => o.value === frontierLLM.reasoningLevel)?.letter || ''}
                </span>
              </button>
            </Tooltip>
            {showThinkingMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowThinkingMenu(false)}
                />
                <div className="absolute bottom-full left-0 mb-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-stone-200 dark:border-gray-700 py-1 z-20 min-w-[100px]">
                  {REASONING_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setFrontierLLM({ reasoningLevel: option.value });
                        setShowThinkingMenu(false);
                      }}
                      className={`
                        w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-gray-700 transition-colors
                        ${frontierLLM.reasoningLevel === option.value ? 'text-purple-600 dark:text-purple-400 font-medium' : 'text-stone-700 dark:text-gray-200'}
                      `}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : provider === 'google' ? (
          /* Google Gemini: Thinking Level Dropdown */
          <div className="relative">
            <Tooltip content={`Thinking: ${effectiveGeminiThinkingLevel}`}>
              <button
                onClick={() => setShowThinkingMenu(!showThinkingMenu)}
                className={`
                  p-2 rounded transition-colors flex items-center gap-1
                  ${
                    effectiveGeminiThinkingLevel !== 'off'
                      ? 'text-purple-600 bg-purple-50 hover:bg-purple-100 dark:text-purple-400 dark:bg-purple-900/50 dark:hover:bg-purple-900/70'
                      : 'text-stone-500 hover:text-purple-600 hover:bg-purple-50 dark:text-gray-400 dark:hover:text-purple-400 dark:hover:bg-purple-900/30'
                  }
                `}
                aria-label="Set thinking level"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-xs font-medium">
                  {getGeminiThinkingLetter(effectiveGeminiThinkingLevel, frontierLLM.model)}
                </span>
              </button>
            </Tooltip>
            {showThinkingMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowThinkingMenu(false)}
                />
                <div className="absolute bottom-full left-0 mb-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-stone-200 dark:border-gray-700 py-1 z-20 min-w-[100px]">
                  {geminiThinkingOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setFrontierLLM({ geminiThinkingLevel: option.value });
                        setShowThinkingMenu(false);
                      }}
                      className={`
                        w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-gray-700 transition-colors
                        ${effectiveGeminiThinkingLevel === option.value ? 'text-purple-600 dark:text-purple-400 font-medium' : 'text-stone-700 dark:text-gray-200'}
                      `}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          /* Anthropic: Extended Thinking Toggle */
          <Tooltip
            content={
              frontierLLM.extendedThinking.enabled
                ? 'Extended thinking enabled'
                : 'Enable extended thinking'
            }
          >
            <button
              onClick={() =>
                setFrontierLLM({
                  extendedThinking: {
                    ...frontierLLM.extendedThinking,
                    enabled: !frontierLLM.extendedThinking.enabled,
                  },
                })
              }
              className={`
                p-2 rounded transition-colors
                ${
                  frontierLLM.extendedThinking.enabled
                    ? 'text-purple-600 bg-purple-50 hover:bg-purple-100 dark:text-purple-400 dark:bg-purple-900/50 dark:hover:bg-purple-900/70'
                    : 'text-stone-500 hover:text-purple-600 hover:bg-purple-50 dark:text-gray-400 dark:hover:text-purple-400 dark:hover:bg-purple-900/30'
                }
              `}
              aria-label="Toggle extended thinking"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>
          </Tooltip>
        )}

        {/* Web Search Toggle */}
        <Tooltip
          content={
            frontierLLM.webSearchEnabled
              ? 'Web search enabled'
              : 'Enable web search'
          }
        >
          <button
            onClick={() =>
              setFrontierLLM({
                webSearchEnabled: !frontierLLM.webSearchEnabled,
              })
            }
            className={`
              p-2 rounded transition-colors
              ${
                frontierLLM.webSearchEnabled
                  ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-900/50 dark:hover:bg-blue-900/70'
                  : 'text-stone-500 hover:text-blue-600 hover:bg-blue-50 dark:text-gray-400 dark:hover:text-blue-400 dark:hover:bg-blue-900/30'
              }
            `}
            aria-label="Toggle web search"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
              />
            </svg>
          </button>
        </Tooltip>

        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onContextMenu={handleContextMenu}
          placeholder={
            isStreaming ? 'Waiting for response...' : 'Type your message...'
          }
          disabled={isStreaming}
          rows={1}
          className={`
            flex-1 px-4 py-2 bg-stone-100 dark:bg-gray-700 rounded-lg resize-none text-sm
            border border-stone-300 dark:border-gray-600 focus:border-blue-400 focus:outline-none focus:ring-0
            disabled:opacity-50 caret-gray-800 dark:caret-gray-100 dark:text-gray-100 dark:placeholder-gray-400
            max-h-40 overflow-y-auto scrollbar-none
          `}
        />

        {/* Voice Input Button */}
        <VoiceInputButton
          onTranscription={(text) => {
            if (voiceMode === 'textbox') {
              // Append transcription to input for user to edit
              setInput(inputValue ? `${inputValue} ${text}` : text);
            } else if (voiceMode === 'chat_request') {
              // Send transcription directly as a message
              sendTranscribedMessage(text);
            }
          }}
        />

        <button
          onClick={isStreaming ? cancelStream : handleSubmit}
          className={`
            relative z-10 flex-shrink-0 px-4 py-2 rounded transition-colors self-end
            ${
              isStreaming
                ? 'text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/50 dark:hover:bg-red-900/70'
                : 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-900/50 dark:hover:bg-blue-900/70'
            }
          `}
          aria-label={isStreaming ? 'Stop response' : 'Send message'}
        >
          {isStreaming ? (
            <svg
              className="w-5 h-5"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Model picker below the input */}
      <div className="mt-2 flex items-center">
        <InlineModelPicker
          value={frontierLLM.model}
          onChange={(model) => setFrontierLLM({ model })}
        />
      </div>

      {/* Context menu for paste/copy/cut */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
