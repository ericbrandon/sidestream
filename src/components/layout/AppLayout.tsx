import { useState, useCallback, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LeftPane } from './LeftPane';
import { RightPane } from './RightPane';
import { PrintMenu } from './PrintMenu';
import { SettingsModal, UpdateModal } from '../settings';
import { ApiKeyRequiredModal } from '../settings/ApiKeyRequiredModal';
import { ChatSidebar } from '../sidebar/ChatSidebar';
import { PrintableChat } from '../print/PrintableChat';
import { useSettingsStore } from '../../stores/settingsStore';
import { useChatStore } from '../../stores/chatStore';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { useSessionStore } from '../../stores/sessionStore';
import { Tooltip } from '../shared/Tooltip';
import { useResizablePanes } from '../../hooks/useResizablePanes';
import { printChat, exportToHtml, exportToJson } from '../../lib/exportUtils';
import { logError } from '../../lib/logger';
import type { ApiKeysConfig } from '../../lib/types';

export function AppLayout() {
  const { isSettingsOpen, closeSettings, openSettings, setConfiguredProviders } =
    useSettingsStore();
  const settingsStore = useSettingsStore();
  const { messages } = useChatStore();
  const { items: allDiscoveryItems, activeSessionId } = useDiscoveryStore();
  const { isSidebarOpen, toggleSidebar, createNewSession, sessionMetas } = useSessionStore();
  const [showPrintMenu, setShowPrintMenu] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [hasCheckedApiKeys, setHasCheckedApiKeys] = useState(false);

  // Filter discovery items by current session for export
  const discoveryItems = useMemo(() => {
    if (!activeSessionId) return allDiscoveryItems;
    return allDiscoveryItems.filter(item => item.sessionId === activeSessionId);
  }, [allDiscoveryItems, activeSessionId]);

  // Use the extracted resize hook
  const {
    containerRef,
    sidebarWidth,
    rightPaneWidth,
    isResizing,
    isResizingSidebar,
    startResizing,
    startResizingSidebar,
  } = useResizablePanes({ isSidebarOpen });

  // Check for API keys on startup
  useEffect(() => {
    if (hasCheckedApiKeys) return;

    const checkApiKeys = async () => {
      try {
        const config = await invoke<ApiKeysConfig>('get_configured_providers');
        setConfiguredProviders(config);
        const hasAny = config.anthropic || config.openai || config.google;
        if (!hasAny) {
          setShowApiKeyModal(true);
        }
      } catch (error) {
        logError('AppLayout.checkApiKeys', error);
        // Show modal on error as well
        setShowApiKeyModal(true);
      }
      setHasCheckedApiKeys(true);
    };

    checkApiKeys();
  }, [hasCheckedApiKeys, setConfiguredProviders]);

  // Handle opening settings from API key modal
  const handleOpenSettingsFromModal = useCallback(() => {
    setShowApiKeyModal(false);
    openSettings(true); // true = highlightApiKeys
  }, [openSettings]);

  // Export handlers using extracted utilities
  const handlePrint = async () => {
    if (messages.length === 0) return;
    try {
      await printChat();
    } catch (error) {
      alert(`Print failed: ${error}`);
    }
  };

  const handleHtmlExport = async () => {
    if (messages.length === 0) return;
    try {
      await exportToHtml();
    } catch (error) {
      alert(`Export failed: ${error}`);
    }
  };

  const handleJsonExport = async () => {
    if (messages.length === 0 || !activeSessionId) return;
    try {
      await exportToJson({
        messages,
        discoveryItems,
        activeSessionId,
        sessionMetas,
        settingsStore,
      });
    } catch (error) {
      alert(`Export failed: ${error}`);
    }
  };

  return (
    <>
      {/* Printable version - hidden in normal view, shown when printing (expanded for print) */}
      <div className="printable-chat-wrapper hidden print:block">
        <PrintableChat messages={messages} discoveryItems={discoveryItems} expandAll={true} />
      </div>
      {/* Hidden collapsed version used for generating save-to-HTML export */}
      <div className="printable-chat-collapsed hidden">
        <PrintableChat messages={messages} discoveryItems={discoveryItems} expandAll={false} />
      </div>

      <div className="flex h-screen bg-stone-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100 print:hidden">
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 h-12 bg-white dark:bg-gray-800 border-b-2 border-blue-500 flex items-center justify-between px-4 z-10">
          {/* Left side - Sidebar toggle and New Chat */}
          <div className="flex items-center gap-1">
            {/* Sidebar Toggle Button */}
            <Tooltip content={isSidebarOpen ? 'Hide' : 'Show'} position="bottom">
              <button
                onClick={toggleSidebar}
                className="p-2 hover:bg-stone-100 dark:hover:bg-gray-700 rounded transition-colors"
                aria-label="Toggle sidebar"
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
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>
            </Tooltip>
            {/* New Chat Button */}
            <Tooltip content="New Chat" position="bottom">
              <button
                onClick={() => createNewSession()}
                className="p-2 hover:bg-stone-100 dark:hover:bg-gray-700 rounded transition-colors"
                aria-label="New Chat"
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
                    d="M12 4v16m8-8H4"
                  />
                </svg>
              </button>
            </Tooltip>
          </div>
          {/* Right side - Print/Save HTML, Export JSON, and Settings */}
          <div className="flex items-center gap-1">
            {/* Print/Save Menu Button */}
            <div className="relative">
              <Tooltip content="Print / Save HTML" position="bottom">
                <button
                  onClick={() => setShowPrintMenu(!showPrintMenu)}
                  className={`p-2 rounded transition-colors ${
                    messages.length === 0
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:bg-stone-100 dark:hover:bg-gray-700'
                  }`}
                  aria-label="Print or Save HTML"
                  disabled={messages.length === 0}
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
                      d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                    />
                  </svg>
                </button>
              </Tooltip>
              {showPrintMenu && messages.length > 0 && (
                <PrintMenu
                  onSaveHtml={handleHtmlExport}
                  onPrint={handlePrint}
                  onDismiss={() => setShowPrintMenu(false)}
                />
              )}
            </div>
            {/* Export to JSON Button */}
            <Tooltip content="Export this chat" position="bottom">
              <button
                onClick={handleJsonExport}
                className={`p-2 rounded transition-colors ${
                  messages.length === 0
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-stone-100 dark:hover:bg-gray-700'
                }`}
                aria-label="Export this chat"
                disabled={messages.length === 0}
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
                    d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                  />
                </svg>
              </button>
            </Tooltip>
            {/* Settings Button */}
            <Tooltip content="Settings" position="bottom">
              <button
                onClick={() => openSettings()}
                className="p-2 hover:bg-stone-100 dark:hover:bg-gray-700 rounded transition-colors"
                aria-label="Settings"
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
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Main content */}
        <div ref={containerRef} className="flex flex-1 pt-12 overflow-hidden">
          {/* Sidebar */}
          <ChatSidebar width={sidebarWidth} />

          {/* Sidebar Resizable Divider */}
          {isSidebarOpen && (
            <div
              className={`w-1 cursor-col-resize hover:bg-blue-400 transition-colors flex-shrink-0 ${
                isResizingSidebar ? 'bg-blue-500' : 'bg-stone-200 dark:bg-gray-700'
              }`}
              onMouseDown={startResizingSidebar}
            />
          )}

          {/* Left Pane - Chat */}
          <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-gray-950">
            <LeftPane />
          </div>

          {/* Resizable Divider */}
          <div
            className={`w-1 cursor-col-resize hover:bg-blue-400 transition-colors flex-shrink-0 ${
              isResizing ? 'bg-blue-500' : 'bg-stone-200 dark:bg-gray-700'
            }`}
            onMouseDown={startResizing}
          />

          {/* Right Pane - Discovery */}
          <div
            className="flex flex-col min-w-0 bg-stone-50 dark:bg-gray-900"
            style={{ width: rightPaneWidth }}
          >
            <RightPane />
          </div>
        </div>

        {/* Resize overlay to prevent text selection */}
        {(isResizing || isResizingSidebar) && (
          <div className="fixed inset-0 z-50 cursor-col-resize" />
        )}

        {/* API Key Required Modal (startup) */}
        <ApiKeyRequiredModal
          isOpen={showApiKeyModal}
          onOpenSettings={handleOpenSettingsFromModal}
        />

        {/* Settings Modal */}
        {isSettingsOpen && <SettingsModal onClose={closeSettings} />}

        {/* Update Modal */}
        <UpdateModal />
      </div>
    </>
  );
}
