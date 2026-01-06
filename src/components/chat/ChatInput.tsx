import { useRef, useEffect, useState, useCallback } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useChat, useTextInputContextMenu } from '../../hooks';
import { AttachmentButton } from './AttachmentButton';
import { AttachmentPreview } from './AttachmentPreview';
import { VoiceInputButton } from './VoiceInputButton';
import { Tooltip } from '../shared/Tooltip';
import { ContextMenu } from '../shared/ContextMenu';
import { InlineModelPicker } from '../shared/InlineModelPicker';
import { getProviderFromModelId } from '../../lib/models';
import {
  getGeminiThinkingOptions,
  getValidGeminiThinkingLevel,
  getGeminiThinkingLetter,
  getOpenAIReasoningOptions,
  getValidOpenAIReasoningLevel,
} from '../../lib/thinkingOptions';

export function ChatInput() {
  const { inputValue, setInput, isStreaming, attachments, registerChatInputFocus } = useChatStore();
  const { frontierLLM, setFrontierLLM, voiceMode, allowChatGPTExtraHighThinking, allowChatGPT5Pro } = useSettingsStore();
  const { sendMessage, sendTranscribedMessage, cancelStream } = useChat();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showThinkingMenu, setShowThinkingMenu] = useState(false);

  const getInputValue = useCallback(() => inputValue, [inputValue]);
  const { contextMenu, handleContextMenu, closeContextMenu } = useTextInputContextMenu(
    textareaRef,
    getInputValue,
    setInput
  );

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

  // Get OpenAI reasoning options based on model, settings, and web search state
  const openAIReasoningOptions = provider === 'openai'
    ? getOpenAIReasoningOptions(frontierLLM.model, {
        allowExtraHigh: allowChatGPTExtraHighThinking,
        webSearchEnabled: frontierLLM.webSearchEnabled,
      })
    : [];
  // Normalize reasoning level to a valid value for the current model and web search state
  const effectiveReasoningLevel = provider === 'openai'
    ? getValidOpenAIReasoningLevel(frontierLLM.reasoningLevel, frontierLLM.model, frontierLLM.webSearchEnabled)
    : frontierLLM.reasoningLevel;

  // Build list of models to exclude based on settings
  const excludedModels = allowChatGPT5Pro ? [] : ['gpt-5-pro'];

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
            <Tooltip content={`Reasoning: ${effectiveReasoningLevel}`}>
              <button
                onClick={() => setShowThinkingMenu(!showThinkingMenu)}
                className={`
                  p-2 rounded transition-colors flex items-center gap-1
                  ${
                    effectiveReasoningLevel !== 'off'
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
                  {openAIReasoningOptions.find(o => o.value === effectiveReasoningLevel)?.letter || ''}
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
                  {openAIReasoningOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setFrontierLLM({ reasoningLevel: option.value });
                        setShowThinkingMenu(false);
                      }}
                      className={`
                        w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-gray-700 transition-colors
                        ${effectiveReasoningLevel === option.value ? 'text-purple-600 dark:text-purple-400 font-medium' : 'text-stone-700 dark:text-gray-200'}
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
          excludeModels={excludedModels}
        />
      </div>

      {/* Context menu for paste/copy/cut */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
