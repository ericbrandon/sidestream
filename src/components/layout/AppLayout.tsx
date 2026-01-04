import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { LeftPane } from './LeftPane';
import { RightPane } from './RightPane';
import { PrintMenu } from './PrintMenu';
import { SettingsModal } from '../settings/SettingsModal';
import { ApiKeyRequiredModal } from '../settings/ApiKeyRequiredModal';
import { ChatSidebar } from '../sidebar/ChatSidebar';
import { PrintableChat } from '../print/PrintableChat';
import { useSettingsStore } from '../../stores/settingsStore';
import { useChatStore } from '../../stores/chatStore';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { useSessionStore } from '../../stores/sessionStore';
import { Tooltip } from '../shared/Tooltip';
import { extractUsedCSS, getBaseExportStyles } from '../../lib/cssUtils';
import type { ChatSession, ChatExportData, ApiKeysConfig } from '../../lib/types';

const MIN_RIGHT_PANE_WIDTH = 200;
const MIN_LEFT_PANE_WIDTH = 300;
const DEFAULT_RIGHT_PANE_RATIO = 0.3; // 30% of container width
const DIVIDER_WIDTH = 4;

// Left sidebar (saved chats) constants
const MIN_SIDEBAR_WIDTH = 150;
const DEFAULT_SIDEBAR_RATIO = 0.15; // 15% of container width

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

  // Left sidebar (saved chats) resizable state - stored as a ratio (0-1) of container width
  const [sidebarRatio, setSidebarRatio] = useState(() => {
    const saved = localStorage.getItem('sidebarRatio');
    return saved ? parseFloat(saved) : DEFAULT_SIDEBAR_RATIO;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(MIN_SIDEBAR_WIDTH);

  // Resizable pane state - stored as a ratio (0-1) of container width
  const [rightPaneRatio, setRightPaneRatio] = useState(() => {
    const saved = localStorage.getItem('rightPaneRatio');
    return saved ? parseFloat(saved) : DEFAULT_RIGHT_PANE_RATIO;
  });
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
        console.error('Failed to check API keys:', error);
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

  // Calculate actual pixel widths from ratios, respecting min constraints and each other
  const getWidths = useCallback(() => {
    if (!containerRef.current) return { sidebar: MIN_SIDEBAR_WIDTH, rightPane: MIN_RIGHT_PANE_WIDTH };

    const containerWidth = containerRef.current.getBoundingClientRect().width;

    // Calculate target widths from stored ratios
    const targetSidebar = containerWidth * sidebarRatio;
    const targetRightPane = containerWidth * rightPaneRatio;

    if (!isSidebarOpen) {
      // Sidebar hidden: right pane and middle pane share the freed space proportionally
      // Calculate what the middle pane width would be if sidebar were open
      const middleIfOpen = containerWidth - targetSidebar - targetRightPane - (2 * DIVIDER_WIDTH);
      const nonSidebarTotal = middleIfOpen + targetRightPane;

      // Now distribute all available space (container - 1 divider) between middle and right
      // proportionally to their sizes when sidebar is open
      const availableSpace = containerWidth - DIVIDER_WIDTH;
      const rightProportion = nonSidebarTotal > 0 ? targetRightPane / nonSidebarTotal : 0.5;
      const expandedRightPane = availableSpace * rightProportion;

      // Clamp to constraints
      const maxRightPane = containerWidth - MIN_LEFT_PANE_WIDTH - DIVIDER_WIDTH;
      const finalRightPane = Math.max(MIN_RIGHT_PANE_WIDTH, Math.min(maxRightPane, expandedRightPane));

      return {
        sidebar: MIN_SIDEBAR_WIDTH,
        rightPane: finalRightPane
      };
    }

    // Sidebar is open: all three panes visible
    // Available space for sidebar + right pane (middle pane gets the rest)
    const totalSideSpace = containerWidth - MIN_LEFT_PANE_WIDTH - (2 * DIVIDER_WIDTH);

    let finalSidebar = Math.max(MIN_SIDEBAR_WIDTH, targetSidebar);
    let finalRightPane = Math.max(MIN_RIGHT_PANE_WIDTH, targetRightPane);

    // Check if we exceed available space and need to scale down
    const actualTotal = finalSidebar + finalRightPane;
    if (actualTotal > totalSideSpace) {
      // Scale down proportionally from what's above minimum
      const excess = actualTotal - totalSideSpace;
      const sidebarAboveMin = finalSidebar - MIN_SIDEBAR_WIDTH;
      const rightAboveMin = finalRightPane - MIN_RIGHT_PANE_WIDTH;
      const totalAboveMin = sidebarAboveMin + rightAboveMin;

      if (totalAboveMin > 0) {
        finalSidebar -= excess * (sidebarAboveMin / totalAboveMin);
        finalRightPane -= excess * (rightAboveMin / totalAboveMin);
      } else {
        // Both at minimum, just clamp
        finalSidebar = MIN_SIDEBAR_WIDTH;
        finalRightPane = Math.max(MIN_RIGHT_PANE_WIDTH, totalSideSpace - MIN_SIDEBAR_WIDTH);
      }
    }

    return { sidebar: finalSidebar, rightPane: finalRightPane };
  }, [sidebarRatio, rightPaneRatio, isSidebarOpen]);

  const [rightPaneWidth, setRightPaneWidth] = useState(MIN_RIGHT_PANE_WIDTH);

  // Update pixel widths on mount and when ratio or container changes
  useEffect(() => {
    const updateWidths = () => {
      const widths = getWidths();
      setSidebarWidth(widths.sidebar);
      setRightPaneWidth(widths.rightPane);
    };
    updateWidths();
    window.addEventListener('resize', updateWidths);
    return () => window.removeEventListener('resize', updateWidths);
  }, [getWidths]);

  // Handle resize - convert pixel drag to ratio
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const newWidth = containerRect.right - e.clientX;

    // Account for sidebar width when calculating max right pane width
    const currentSidebarSpace = isSidebarOpen ? sidebarWidth + DIVIDER_WIDTH : 0;
    const maxRightPaneWidth = containerRect.width - currentSidebarSpace - MIN_LEFT_PANE_WIDTH - DIVIDER_WIDTH;
    const clampedWidth = Math.max(MIN_RIGHT_PANE_WIDTH, Math.min(maxRightPaneWidth, newWidth));

    // Convert to ratio and update both ratio and pixel width
    const newRatio = clampedWidth / containerRect.width;
    setRightPaneRatio(newRatio);
    setRightPaneWidth(clampedWidth);
  }, [isResizing, isSidebarOpen, sidebarWidth]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    localStorage.setItem('rightPaneRatio', rightPaneRatio.toString());
  }, [rightPaneRatio]);

  // Sidebar resize handlers
  const handleSidebarMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingSidebar || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const newWidth = e.clientX - containerRect.left;

    // Account for right pane width when calculating max sidebar width
    const maxSidebarWidth = containerRect.width - rightPaneWidth - MIN_LEFT_PANE_WIDTH - (2 * DIVIDER_WIDTH);
    const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxSidebarWidth, newWidth));

    // Convert to ratio and update both ratio and pixel width
    const newRatio = clampedWidth / containerRect.width;
    setSidebarRatio(newRatio);
    setSidebarWidth(clampedWidth);
  }, [isResizingSidebar, rightPaneWidth]);

  const handleSidebarMouseUp = useCallback(() => {
    setIsResizingSidebar(false);
    localStorage.setItem('sidebarRatio', sidebarRatio.toString());
  }, [sidebarRatio]);

  useEffect(() => {
    if (isResizingSidebar) {
      document.addEventListener('mousemove', handleSidebarMouseMove);
      document.addEventListener('mouseup', handleSidebarMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleSidebarMouseMove);
      document.removeEventListener('mouseup', handleSidebarMouseUp);
      if (!isResizing) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
  }, [isResizingSidebar, handleSidebarMouseMove, handleSidebarMouseUp, isResizing]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  // Generate HTML content for export/print
  // When expandAll is true, all collapsible chips will be expanded in the output
  const generateExportHtml = (expandAll: boolean = false) => {
    const selector = expandAll ? '.printable-chat-wrapper' : '.printable-chat-collapsed';
    const printableContent = document.querySelector(selector);
    if (!printableContent) return null;

    const usedStyles = extractUsedCSS(printableContent);
    const baseStyles = getBaseExportStyles();

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Chat Export</title>
          <style>${usedStyles}</style>
          <style>${baseStyles}</style>
        </head>
        <body>
          ${printableContent.innerHTML}
        </body>
      </html>
    `;
  };

  const handlePrint = async () => {
    if (messages.length === 0) return;

    // Set document title to suggested PDF filename (print dialog uses this)
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    document.title = `SidestreamChat_${timestamp}`;

    try {
      await invoke('print_webview');
    } catch (error) {
      console.error('Print failed:', error);
      alert(`Print failed: ${error}`);
    }
  };

  const handleHtmlExport = async () => {
    if (messages.length === 0) return;

    const htmlContent = generateExportHtml();
    if (!htmlContent) {
      alert('No printable content found.');
      return;
    }

    try {
      // Show save dialog
      const filePath = await save({
        defaultPath: `sidestream-chat-${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });

      if (filePath) {
        // Write the file
        await writeTextFile(filePath, htmlContent);
      }
    } catch (error) {
      alert(`Export failed: ${error}`);
    }
  };

  const handleJsonExport = async () => {
    if (messages.length === 0 || !activeSessionId) return;

    try {
      // Find the session metadata
      const sessionMeta = sessionMetas.find((m) => m.id === activeSessionId);

      // Build the session object
      const firstUserMessage = messages.find((m) => m.role === 'user');
      const title = sessionMeta?.title || (firstUserMessage ? firstUserMessage.content.replace(/\n/g, ' ').trim() : 'Chat Export');

      const session: ChatSession = {
        id: activeSessionId,
        title,
        createdAt: sessionMeta?.updatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: messages.map((msg) => ({
          ...msg,
          timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
        })),
        discoveryItems: discoveryItems.map((item) => ({
          ...item,
          timestamp: item.timestamp instanceof Date ? item.timestamp : new Date(item.timestamp),
        })),
        settings: {
          frontierModel: settingsStore.frontierLLM.model,
          evaluatorModel: settingsStore.evaluatorLLM.model,
          extendedThinkingEnabled: settingsStore.frontierLLM.extendedThinking.enabled,
          extendedThinkingBudget: settingsStore.frontierLLM.extendedThinking.budgetTokens,
          webSearchEnabled: settingsStore.frontierLLM.webSearchEnabled,
          discoveryMode: settingsStore.discoveryMode,
        },
      };

      const exportData: ChatExportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sessions: [session],
      };

      const jsonContent = JSON.stringify(exportData, null, 2);

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
      const filePath = await save({
        defaultPath: `sidestream-chat-${timestamp}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (filePath) {
        await writeTextFile(filePath, jsonContent);
      }
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
              onMouseDown={() => setIsResizingSidebar(true)}
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
            onMouseDown={() => setIsResizing(true)}
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
      </div>
    </>
  );
}
