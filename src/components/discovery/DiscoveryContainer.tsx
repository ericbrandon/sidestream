import { useState, useRef, useEffect, useCallback } from 'react';
import { DiscoveryList } from './DiscoveryList';
import { ModeChangeToast } from './ModeChangeToast';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { InlineModelPicker } from '../shared/InlineModelPicker';
import { Tooltip } from '../shared/Tooltip';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useChatStore } from '../../stores/chatStore';
import { useDiscovery } from '../../hooks/useDiscovery';
import { getAllDiscoveryModes, getDiscoveryMode, getBestModelForMode } from '../../lib/discoveryModes';
import { getProviderFromModelId } from '../../lib/models';
import {
  getGeminiThinkingOptions,
  getValidGeminiThinkingLevel,
  getGeminiThinkingLetter,
  getOpenAIReasoningOptions,
  getValidOpenAIReasoningLevel,
} from '../../lib/thinkingOptions';
import type { DiscoveryModeId } from '../../lib/types';

export function DiscoveryContainer() {
  const isSearching = useDiscoveryStore((state) => state.isSearching);
  const discoveryMode = useSettingsStore((state) => state.discoveryMode);
  const setDiscoveryMode = useSettingsStore((state) => state.setDiscoveryMode);
  const evaluatorLLM = useSettingsStore((state) => state.evaluatorLLM);
  const setEvaluatorLLM = useSettingsStore((state) => state.setEvaluatorLLM);
  const autoSelectDiscoveryModel = useSettingsStore((state) => state.autoSelectDiscoveryModel);
  const configuredProviders = useSettingsStore((state) => state.configuredProviders);
  const messages = useChatStore((state) => state.messages);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const { triggerDiscovery } = useDiscovery();
  const [isOpen, setIsOpen] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [pendingMode, setPendingMode] = useState<DiscoveryModeId | null>(null);
  const [showThinkingMenu, setShowThinkingMenu] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const modes = getAllDiscoveryModes();
  const currentMode = getDiscoveryMode(discoveryMode);
  const pendingModeConfig = pendingMode ? getDiscoveryMode(pendingMode) : null;

  // Determine provider for current evaluator model
  const provider = getProviderFromModelId(evaluatorLLM.model);
  const geminiThinkingOptions = provider === 'google' ? getGeminiThinkingOptions(evaluatorLLM.model) : [];
  // Normalize the thinking level to a valid value for the current model
  const effectiveGeminiThinkingLevel = provider === 'google'
    ? getValidGeminiThinkingLevel(evaluatorLLM.geminiThinkingLevel, evaluatorLLM.model)
    : evaluatorLLM.geminiThinkingLevel;

  // Discovery pane never shows xhigh thinking or GPT-5 Pro (regardless of user settings)
  // Also respect web search constraints (off/minimal not available when web search is on)
  const discoveryReasoningOptions = provider === 'openai'
    ? getOpenAIReasoningOptions(evaluatorLLM.model, {
        allowExtraHigh: false, // Never allow xhigh in discovery pane
        webSearchEnabled: evaluatorLLM.webSearchEnabled,
      })
    : [];
  // Normalize reasoning level for discovery pane
  const effectiveDiscoveryReasoningLevel = provider === 'openai'
    ? getValidOpenAIReasoningLevel(evaluatorLLM.reasoningLevel, evaluatorLLM.model, evaluatorLLM.webSearchEnabled)
    : evaluatorLLM.reasoningLevel;
  const discoveryExcludedModels = ['gpt-5-pro'];

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (modeId: DiscoveryModeId) => {
    // Apply auto-selection if enabled and mode is not 'none'
    if (autoSelectDiscoveryModel && modeId !== 'none') {
      const bestModel = getBestModelForMode(modeId, configuredProviders);
      if (bestModel) {
        setEvaluatorLLM({
          model: bestModel.model,
          extendedThinking: {
            ...evaluatorLLM.extendedThinking,
            enabled: bestModel.extendedThinkingEnabled,
          },
          reasoningLevel: bestModel.reasoningLevel,
          geminiThinkingLevel: bestModel.geminiThinkingLevel,
        });
      }
    }

    setDiscoveryMode(modeId);
    setIsOpen(false);

    // If chat has messages and mode is not 'none', show toast to offer generating new chips
    if (messages.length > 0 && modeId !== 'none') {
      setPendingMode(modeId);
      setShowToast(true);
    }
  };

  const handleToastConfirm = useCallback(() => {
    setShowToast(false);
    setPendingMode(null);
    // Find the most recent assistant message's turnId
    const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant');
    if (lastAssistantMessage?.turnId) {
      triggerDiscovery(lastAssistantMessage.turnId);
    }
  }, [triggerDiscovery, messages]);

  const handleToastDismiss = useCallback(() => {
    setShowToast(false);
    setPendingMode(null);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="relative p-3 border-b border-stone-200 dark:border-gray-700 flex items-center justify-between">
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => !isSearching && !isStreaming && setIsOpen(!isOpen)}
            disabled={isSearching || isStreaming}
            className={`font-medium text-sm flex items-center gap-1 dark:text-gray-100 ${
              isSearching || isStreaming ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            {currentMode.name}
            <svg
              className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {isOpen && (
            <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-stone-200 dark:border-gray-700 rounded shadow-lg z-10 min-w-max">
              {modes.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => handleSelect(mode.id)}
                  className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-stone-100 dark:hover:bg-gray-700 dark:text-gray-200 ${
                    mode.id === discoveryMode ? 'font-medium bg-stone-50 dark:bg-gray-700' : ''
                  }`}
                >
                  {mode.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {showToast && pendingModeConfig && (
          <ModeChangeToast
            modeName={pendingModeConfig.name}
            onConfirm={handleToastConfirm}
            onDismiss={handleToastDismiss}
          />
        )}
        {isSearching && (
          <LoadingSpinner size="sm" className="text-purple-600 dark:text-purple-400" />
        )}
      </div>

      {/* Discovery list - per-batch loading indicators are shown inline */}
      <DiscoveryList />

      {/* Footer with model picker and thinking level */}
      <div className="p-3 border-t border-stone-200 dark:border-gray-700 flex items-center gap-2">
        <InlineModelPicker
          value={evaluatorLLM.model}
          onChange={(model) => setEvaluatorLLM({ model })}
          excludeModels={discoveryExcludedModels}
        />

        {/* Thinking/Reasoning Control - Provider-specific */}
        {provider === 'openai' ? (
          /* OpenAI: Reasoning Level Dropdown */
          <div className="relative">
            <Tooltip content={`Reasoning: ${effectiveDiscoveryReasoningLevel}`}>
              <button
                onClick={() => setShowThinkingMenu(!showThinkingMenu)}
                className={`
                  p-1.5 rounded transition-colors flex items-center gap-0.5
                  ${
                    effectiveDiscoveryReasoningLevel !== 'off'
                      ? 'text-purple-600 bg-purple-50 hover:bg-purple-100 dark:text-purple-400 dark:bg-purple-900/50 dark:hover:bg-purple-900/70'
                      : 'text-stone-500 hover:text-purple-600 hover:bg-purple-50 dark:text-gray-400 dark:hover:text-purple-400 dark:hover:bg-purple-900/30'
                  }
                `}
                aria-label="Set reasoning level"
              >
                <svg
                  className="w-4 h-4"
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
                  {discoveryReasoningOptions.find(o => o.value === effectiveDiscoveryReasoningLevel)?.letter || ''}
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
                  {discoveryReasoningOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setEvaluatorLLM({ reasoningLevel: option.value });
                        setShowThinkingMenu(false);
                      }}
                      className={`
                        w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-gray-700 transition-colors
                        ${effectiveDiscoveryReasoningLevel === option.value ? 'text-purple-600 dark:text-purple-400 font-medium' : 'text-stone-700 dark:text-gray-200'}
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
                  p-1.5 rounded transition-colors flex items-center gap-0.5
                  ${
                    effectiveGeminiThinkingLevel !== 'off'
                      ? 'text-purple-600 bg-purple-50 hover:bg-purple-100 dark:text-purple-400 dark:bg-purple-900/50 dark:hover:bg-purple-900/70'
                      : 'text-stone-500 hover:text-purple-600 hover:bg-purple-50 dark:text-gray-400 dark:hover:text-purple-400 dark:hover:bg-purple-900/30'
                  }
                `}
                aria-label="Set thinking level"
              >
                <svg
                  className="w-4 h-4"
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
                  {getGeminiThinkingLetter(effectiveGeminiThinkingLevel, evaluatorLLM.model)}
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
                        setEvaluatorLLM({ geminiThinkingLevel: option.value });
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
              evaluatorLLM.extendedThinking.enabled
                ? 'Extended thinking enabled'
                : 'Enable extended thinking'
            }
          >
            <button
              onClick={() =>
                setEvaluatorLLM({
                  extendedThinking: {
                    ...evaluatorLLM.extendedThinking,
                    enabled: !evaluatorLLM.extendedThinking.enabled,
                  },
                })
              }
              className={`
                p-1.5 rounded transition-colors
                ${
                  evaluatorLLM.extendedThinking.enabled
                    ? 'text-purple-600 bg-purple-50 hover:bg-purple-100 dark:text-purple-400 dark:bg-purple-900/50 dark:hover:bg-purple-900/70'
                    : 'text-stone-500 hover:text-purple-600 hover:bg-purple-50 dark:text-gray-400 dark:hover:text-purple-400 dark:hover:bg-purple-900/30'
                }
              `}
              aria-label="Toggle extended thinking"
            >
              <svg
                className="w-4 h-4"
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
      </div>
    </div>
  );
}
