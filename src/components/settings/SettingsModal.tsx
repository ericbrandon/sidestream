import { useState, useEffect } from 'react';
import { Modal } from '../shared/Modal';
import { AlertModal } from '../shared/AlertModal';
import { ApiKeyForm } from './ApiKeyForm';
import { SavedChatsSection } from './SavedChatsSection';
import { useSettingsStore, type SettingsTab } from '../../stores/settingsStore';
import { APP_VERSION, checkForUpdate } from '../../lib/updateChecker';
import type { ThemeMode, VoiceMode } from '../../lib/types';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { highlightApiKeys, lastSettingsTab, setLastSettingsTab, autoSelectDiscoveryModel, setAutoSelectDiscoveryModel, showCitations, setShowCitations, theme, setTheme, voiceMode, setVoiceMode, customSystemPrompt, setCustomSystemPrompt, allowChatGPTExtraHighThinking, setAllowChatGPTExtraHighThinking, allowChatGPT5Pro, setAllowChatGPT5Pro, setUpdateInfo } = useSettingsStore();
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [showLatestVersionAlert, setShowLatestVersionAlert] = useState(false);

  // highlightApiKeys takes precedence, otherwise use the last remembered tab
  const activeTab = highlightApiKeys ? 'api-keys' : lastSettingsTab;

  const handleTabChange = (tab: SettingsTab) => {
    setLastSettingsTab(tab);
  };
  const [showAutoSelectInfo, setShowAutoSelectInfo] = useState(false);
  const [showCitationsInfo, setShowCitationsInfo] = useState(false);
  const [localPrompt, setLocalPrompt] = useState(customSystemPrompt);
  const [showSaved, setShowSaved] = useState(false);

  // Sync localPrompt when customSystemPrompt changes (e.g., on modal open after app restart)
  useEffect(() => {
    setLocalPrompt(customSystemPrompt);
  }, [customSystemPrompt]);

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'api-keys', label: 'API Keys' },
    { id: 'preferences', label: 'Preferences' },
    { id: 'personalize', label: 'Personalize' },
    { id: 'saved-chats', label: 'Saved Chats' },
    { id: 'about', label: 'About' },
  ];

  return (
    <Modal isOpen={true} onClose={onClose} title="Settings">
      <div className="flex flex-col">
        {/* Tab Navigation */}
        <div className="flex border-b border-stone-200 dark:border-gray-700 mb-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`px-4 py-2 text-sm transition-colors relative ${
                activeTab === tab.id
                  ? 'font-semibold text-gray-800 dark:text-gray-100'
                  : 'font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-800 dark:bg-gray-200" />
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="min-h-[300px]">
          {/* API Keys Tab */}
          {activeTab === 'api-keys' && (
            <div className="space-y-6">
              <ApiKeyForm highlight={highlightApiKeys} />
            </div>
          )}

          {/* Preferences Tab */}
          {activeTab === 'preferences' && (
            <div className="space-y-6 pt-4">
              {/* Theme Selection */}
              <section>
                <div className="flex items-center gap-3">
                  <label htmlFor="themeSelect" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Theme
                  </label>
                  <select
                    id="themeSelect"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as ThemeMode)}
                    className="px-3 py-1.5 bg-stone-100 dark:bg-gray-700 rounded-lg border border-stone-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 focus:border-stone-400 dark:focus:border-gray-500 focus:outline-none cursor-pointer"
                  >
                    <option value="light" className="bg-white dark:bg-gray-700 dark:text-gray-200">Light Mode</option>
                    <option value="dark" className="bg-white dark:bg-gray-700 dark:text-gray-200">Dark Mode</option>
                    <option value="system" className="bg-white dark:bg-gray-700 dark:text-gray-200">Follow System Settings</option>
                  </select>
                </div>
              </section>

              <hr className="border-stone-200 dark:border-gray-700" />

              {/* Voice Input Mode */}
              <section>
                <div className="flex items-center gap-3">
                  <label htmlFor="voiceInputSelect" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Voice Input
                  </label>
                  <select
                    id="voiceInputSelect"
                    value={voiceMode}
                    onChange={(e) => setVoiceMode(e.target.value as VoiceMode)}
                    className="px-3 py-1.5 bg-stone-100 dark:bg-gray-700 rounded-lg border border-stone-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 focus:border-stone-400 dark:focus:border-gray-500 focus:outline-none cursor-pointer"
                  >
                    <option value="none" className="bg-white dark:bg-gray-700 dark:text-gray-200">None</option>
                    <option value="textbox" className="bg-white dark:bg-gray-700 dark:text-gray-200">Voice to input text box</option>
                    <option value="chat_request" className="bg-white dark:bg-gray-700 dark:text-gray-200">Voice direct to chat</option>
                  </select>
                </div>
              </section>

              <hr className="border-stone-200 dark:border-gray-700" />

              {/* Auto Model Selection */}
              <section>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="autoSelectModel"
                    checked={autoSelectDiscoveryModel}
                    onChange={(e) => setAutoSelectDiscoveryModel(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-500 text-blue-600 focus:ring-0 focus:ring-offset-0 dark:border-gray-500 dark:bg-gray-500 dark:checked:bg-blue-600 cursor-pointer"
                  />
                  <label htmlFor="autoSelectModel" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                    Automatic model selection for the right pane modes
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowAutoSelectInfo(!showAutoSelectInfo)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    aria-label="More information"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
                {showAutoSelectInfo && (
                  <div className="mt-2 ml-7 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 p-3 rounded-md">
                    <p className="mb-2">
                      When you select a mode (like "Useful & Informative") for the right pane, the app will automatically switch to the best model available for that mode.
                    </p>
                    <p className="mb-2">
                      Users with multiple API keys from different AI providers will see best results, because different AI models are better for various modes. So someone with Anthropic, OpenAI, and Google Gemini keys will always get best results.
                    </p>
                    <p>
                      You can still manually override the automatic selections.
                    </p>
                  </div>
                )}
              </section>

              <hr className="border-stone-200 dark:border-gray-700" />

              {/* Show Citations */}
              <section>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="showCitations"
                    checked={showCitations}
                    onChange={(e) => setShowCitations(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-500 text-blue-600 focus:ring-0 focus:ring-offset-0 dark:border-gray-500 dark:bg-gray-500 dark:checked:bg-blue-600 cursor-pointer"
                  />
                  <label htmlFor="showCitations" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                    Show citations
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowCitationsInfo(!showCitationsInfo)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    aria-label="More information"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
                {showCitationsInfo && (
                  <div className="mt-2 ml-7 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 p-3 rounded-md">
                    <p>
                      AI models will often provide links to the web pages they found. When this box is checked the links are shown.
                    </p>
                  </div>
                )}
              </section>

              <hr className="border-stone-200 dark:border-gray-700" />

              {/* Allow ChatGPT Extra-High Thinking */}
              <section>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="allowExtraHighThinking"
                    checked={allowChatGPTExtraHighThinking}
                    onChange={(e) => setAllowChatGPTExtraHighThinking(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-500 text-blue-600 focus:ring-0 focus:ring-offset-0 dark:border-gray-500 dark:bg-gray-500 dark:checked:bg-blue-600 cursor-pointer"
                  />
                  <label htmlFor="allowExtraHighThinking" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                    Allow ChatGPT extra-high thinking
                  </label>
                </div>
                <p className="mt-1 ml-7 text-xs text-gray-500 dark:text-gray-400">
                  This generally hidden thinking mode is very slow and expensive. We recommend leaving this option off.
                </p>
              </section>

              <hr className="border-stone-200 dark:border-gray-700" />

              {/* Allow ChatGPT 5 Pro */}
              <section>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="allowChatGPT5Pro"
                    checked={allowChatGPT5Pro}
                    onChange={(e) => setAllowChatGPT5Pro(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-500 text-blue-600 focus:ring-0 focus:ring-offset-0 dark:border-gray-500 dark:bg-gray-500 dark:checked:bg-blue-600 cursor-pointer"
                  />
                  <label htmlFor="allowChatGPT5Pro" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                    Allow ChatGPT 5 Pro
                  </label>
                </div>
                <p className="mt-1 ml-7 text-xs text-gray-500 dark:text-gray-400">
                  This model is very slow, and extremely expensive - 12 times the cost of regular ChatGPT 5. We recommend leaving this option off.
                </p>
              </section>

            </div>
          )}

          {/* Personalize Tab */}
          {activeTab === 'personalize' && (
            <div className="space-y-4 pt-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                You can enter custom instructions that will apply to all your chats. You can tell the model how you would like it to respond. You can share information about yourself so the responses are better tailored to you.
              </p>
              <textarea
                value={localPrompt}
                onChange={(e) => {
                  setLocalPrompt(e.target.value);
                  setShowSaved(false);
                }}
                placeholder="Enter your custom instructions here..."
                className="w-full h-48 px-3 py-2 bg-stone-100 dark:bg-gray-700 rounded-lg border border-stone-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:border-stone-400 dark:focus:border-gray-500 focus:outline-none resize-none"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setCustomSystemPrompt(localPrompt);
                    setShowSaved(true);
                    setTimeout(() => setShowSaved(false), 2000);
                  }}
                  disabled={localPrompt === customSystemPrompt}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setLocalPrompt('');
                    setCustomSystemPrompt('');
                    setShowSaved(false);
                  }}
                  disabled={!localPrompt && !customSystemPrompt}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Delete
                </button>
                {showSaved && (
                  <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>
                )}
              </div>
            </div>
          )}

          {/* Saved Chats Tab */}
          {activeTab === 'saved-chats' && (
            <div>
              <SavedChatsSection />
            </div>
          )}

          {/* About Tab */}
          {activeTab === 'about' && (
            <div className="text-center text-sm text-gray-500 dark:text-gray-400 pt-8">
              <p className="font-medium text-gray-700 dark:text-gray-300">Sidestream v{APP_VERSION}</p>
              <p className="mt-2">Chat with a side serving of insight</p>
              <p className="mt-4">© 2026 Eric Brandon</p>
              <button
                onClick={async () => {
                  setIsCheckingUpdate(true);
                  const updateInfo = await checkForUpdate();
                  setIsCheckingUpdate(false);
                  if (updateInfo) {
                    onClose();
                    setUpdateInfo(updateInfo);
                  } else {
                    setShowLatestVersionAlert(true);
                  }
                }}
                disabled={isCheckingUpdate}
                className="mt-6 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
              >
                {isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
              </button>
            </div>
          )}
        </div>
      </div>

      <AlertModal
        isOpen={showLatestVersionAlert}
        onClose={() => setShowLatestVersionAlert(false)}
        title="Sidestream"
        message="You are running the latest version."
      />
    </Modal>
  );
}
