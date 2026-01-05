# Refactoring AppLayout.tsx

## Current State
- **File:** `src/components/layout/AppLayout.tsx`
- **Size:** 573 lines
- **Problem:** 3 distinct responsibilities mixed together

## Proposed Extraction

### 1. Extract `useResizablePanes.ts` hook (Priority 1, ~165 lines)

**Extract lines 21-28 (constants) and 47-244 (state/handlers)**

Create `src/hooks/useResizablePanes.ts`:
```typescript
import { useState, useCallback, useEffect, useRef } from 'react';

// Constants
const MIN_RIGHT_PANE_WIDTH = 200;
const MIN_LEFT_PANE_WIDTH = 300;
const DEFAULT_RIGHT_PANE_RATIO = 0.3;
const DIVIDER_WIDTH = 4;
const MIN_SIDEBAR_WIDTH = 150;
const DEFAULT_SIDEBAR_RATIO = 0.15;

interface UseResizablePanesConfig {
  isSidebarOpen: boolean;
}

interface UseResizablePanesResult {
  containerRef: React.RefObject<HTMLDivElement>;
  sidebarWidth: number;
  rightPaneWidth: number;
  isResizing: boolean;
  isResizingSidebar: boolean;
  startResizing: () => void;
  startResizingSidebar: () => void;
}

export function useResizablePanes({ isSidebarOpen }: UseResizablePanesConfig): UseResizablePanesResult {
  // Left sidebar state - stored as ratio (0-1) of container width
  const [sidebarRatio, setSidebarRatio] = useState(() => {
    const saved = localStorage.getItem('sidebarRatio');
    return saved ? parseFloat(saved) : DEFAULT_SIDEBAR_RATIO;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(MIN_SIDEBAR_WIDTH);

  // Right pane state - stored as ratio (0-1) of container width
  const [rightPaneRatio, setRightPaneRatio] = useState(() => {
    const saved = localStorage.getItem('rightPaneRatio');
    return saved ? parseFloat(saved) : DEFAULT_RIGHT_PANE_RATIO;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [rightPaneWidth, setRightPaneWidth] = useState(MIN_RIGHT_PANE_WIDTH);

  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate actual pixel widths from ratios, respecting min constraints
  const getWidths = useCallback(() => {
    if (!containerRef.current) return { sidebar: MIN_SIDEBAR_WIDTH, rightPane: MIN_RIGHT_PANE_WIDTH };

    const containerWidth = containerRef.current.getBoundingClientRect().width;
    const targetSidebar = containerWidth * sidebarRatio;
    const targetRightPane = containerWidth * rightPaneRatio;

    if (!isSidebarOpen) {
      // Sidebar hidden: distribute space proportionally
      const middleIfOpen = containerWidth - targetSidebar - targetRightPane - (2 * DIVIDER_WIDTH);
      const nonSidebarTotal = middleIfOpen + targetRightPane;
      const availableSpace = containerWidth - DIVIDER_WIDTH;
      const rightProportion = nonSidebarTotal > 0 ? targetRightPane / nonSidebarTotal : 0.5;
      const expandedRightPane = availableSpace * rightProportion;
      const maxRightPane = containerWidth - MIN_LEFT_PANE_WIDTH - DIVIDER_WIDTH;
      const finalRightPane = Math.max(MIN_RIGHT_PANE_WIDTH, Math.min(maxRightPane, expandedRightPane));

      return { sidebar: MIN_SIDEBAR_WIDTH, rightPane: finalRightPane };
    }

    // Sidebar open: all three panes visible
    const totalSideSpace = containerWidth - MIN_LEFT_PANE_WIDTH - (2 * DIVIDER_WIDTH);
    let finalSidebar = Math.max(MIN_SIDEBAR_WIDTH, targetSidebar);
    let finalRightPane = Math.max(MIN_RIGHT_PANE_WIDTH, targetRightPane);

    // Scale down if exceeding available space
    const actualTotal = finalSidebar + finalRightPane;
    if (actualTotal > totalSideSpace) {
      const excess = actualTotal - totalSideSpace;
      const sidebarAboveMin = finalSidebar - MIN_SIDEBAR_WIDTH;
      const rightAboveMin = finalRightPane - MIN_RIGHT_PANE_WIDTH;
      const totalAboveMin = sidebarAboveMin + rightAboveMin;

      if (totalAboveMin > 0) {
        finalSidebar -= excess * (sidebarAboveMin / totalAboveMin);
        finalRightPane -= excess * (rightAboveMin / totalAboveMin);
      } else {
        finalSidebar = MIN_SIDEBAR_WIDTH;
        finalRightPane = Math.max(MIN_RIGHT_PANE_WIDTH, totalSideSpace - MIN_SIDEBAR_WIDTH);
      }
    }

    return { sidebar: finalSidebar, rightPane: finalRightPane };
  }, [sidebarRatio, rightPaneRatio, isSidebarOpen]);

  // Update pixel widths on mount and resize
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

  // Right pane resize handlers
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const newWidth = containerRect.right - e.clientX;
    const currentSidebarSpace = isSidebarOpen ? sidebarWidth + DIVIDER_WIDTH : 0;
    const maxRightPaneWidth = containerRect.width - currentSidebarSpace - MIN_LEFT_PANE_WIDTH - DIVIDER_WIDTH;
    const clampedWidth = Math.max(MIN_RIGHT_PANE_WIDTH, Math.min(maxRightPaneWidth, newWidth));

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
    const maxSidebarWidth = containerRect.width - rightPaneWidth - MIN_LEFT_PANE_WIDTH - (2 * DIVIDER_WIDTH);
    const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxSidebarWidth, newWidth));

    const newRatio = clampedWidth / containerRect.width;
    setSidebarRatio(newRatio);
    setSidebarWidth(clampedWidth);
  }, [isResizingSidebar, rightPaneWidth]);

  const handleSidebarMouseUp = useCallback(() => {
    setIsResizingSidebar(false);
    localStorage.setItem('sidebarRatio', sidebarRatio.toString());
  }, [sidebarRatio]);

  // Attach/detach event listeners for sidebar resize
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

  // Attach/detach event listeners for right pane resize
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

  return {
    containerRef,
    sidebarWidth,
    rightPaneWidth,
    isResizing,
    isResizingSidebar,
    startResizing: () => setIsResizing(true),
    startResizingSidebar: () => setIsResizingSidebar(true),
  };
}
```

### 2. Extract `exportUtils.ts` (Priority 2, ~115 lines)

**Extract lines 246-361** - HTML/JSON generation and file saving

Create `src/lib/exportUtils.ts`:
```typescript
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { extractUsedCSS, getBaseExportStyles } from './cssUtils';
import { buildSessionSettings } from './sessionHelpers';
import type { Message, DiscoveryItem, ChatSession, ChatSessionMeta, ChatExportData } from './types';

/**
 * Generate HTML content for export/print.
 * @param expandAll - If true, all collapsible chips will be expanded
 */
export function generateExportHtml(expandAll: boolean = false): string | null {
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
}

/**
 * Print the chat via system print dialog.
 * Sets document title to suggested PDF filename.
 */
export async function printChat(): Promise<void> {
  const now = new Date();
  const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  document.title = `SidestreamChat_${timestamp}`;

  try {
    await invoke('print_webview');
  } catch (error) {
    console.error('Print failed:', error);
    throw error;
  }
}

/**
 * Export chat to HTML file via save dialog.
 */
export async function exportToHtml(): Promise<void> {
  const htmlContent = generateExportHtml();
  if (!htmlContent) {
    throw new Error('No printable content found.');
  }

  const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const filePath = await save({
    defaultPath: `sidestream-chat-${timestamp}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });

  if (filePath) {
    await writeTextFile(filePath, htmlContent);
  }
}

interface ExportToJsonParams {
  messages: Message[];
  discoveryItems: DiscoveryItem[];
  activeSessionId: string;
  sessionMetas: ChatSessionMeta[];
  settingsStore: any; // Type this properly based on your settings store
}

/**
 * Export chat to JSON file via save dialog.
 */
export async function exportToJson({
  messages,
  discoveryItems,
  activeSessionId,
  sessionMetas,
  settingsStore,
}: ExportToJsonParams): Promise<void> {
  const sessionMeta = sessionMetas.find((m) => m.id === activeSessionId);
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
    settings: buildSessionSettings(settingsStore),
  };

  const exportData: ChatExportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions: [session],
  };

  const jsonContent = JSON.stringify(exportData, null, 2);
  const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');

  const filePath = await save({
    defaultPath: `sidestream-chat-${timestamp}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });

  if (filePath) {
    await writeTextFile(filePath, jsonContent);
  }
}
```

### 3. Update AppLayout.tsx

After extraction, the component becomes much simpler:

```typescript
import { useState, useCallback, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
import { useResizablePanes } from '../../hooks/useResizablePanes';
import { printChat, exportToHtml, exportToJson } from '../../lib/exportUtils';
import type { ApiKeysConfig } from '../../lib/types';

export function AppLayout() {
  const { isSettingsOpen, closeSettings, openSettings, setConfiguredProviders } = useSettingsStore();
  const settingsStore = useSettingsStore();
  const { messages } = useChatStore();
  const { items: allDiscoveryItems, activeSessionId } = useDiscoveryStore();
  const { isSidebarOpen, toggleSidebar, createNewSession, sessionMetas } = useSessionStore();

  const [showPrintMenu, setShowPrintMenu] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [hasCheckedApiKeys, setHasCheckedApiKeys] = useState(false);

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

  // Filter discovery items by current session
  const discoveryItems = useMemo(() => {
    if (!activeSessionId) return allDiscoveryItems;
    return allDiscoveryItems.filter(item => item.sessionId === activeSessionId);
  }, [allDiscoveryItems, activeSessionId]);

  // Check for API keys on startup
  useEffect(() => {
    if (hasCheckedApiKeys) return;
    const checkApiKeys = async () => {
      try {
        const config = await invoke<ApiKeysConfig>('get_configured_providers');
        setConfiguredProviders(config);
        if (!config.anthropic && !config.openai && !config.google) {
          setShowApiKeyModal(true);
        }
      } catch {
        setShowApiKeyModal(true);
      }
      setHasCheckedApiKeys(true);
    };
    checkApiKeys();
  }, [hasCheckedApiKeys, setConfiguredProviders]);

  const handleOpenSettingsFromModal = useCallback(() => {
    setShowApiKeyModal(false);
    openSettings(true);
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
    // ... JSX remains mostly the same but uses:
    // - containerRef from hook
    // - sidebarWidth, rightPaneWidth from hook
    // - startResizing(), startResizingSidebar() instead of setIsResizing(true)
    // - isResizing, isResizingSidebar from hook for styling
  );
}
```

## Implementation Order

1. **First:** Create `src/hooks/useResizablePanes.ts` with the full hook implementation
2. **Second:** Create `src/lib/exportUtils.ts` with the export functions
3. **Third:** Update `AppLayout.tsx` to import and use the new hook and utilities
4. **Fourth:** Remove the extracted code from `AppLayout.tsx`

## Testing Notes

After each step:
1. Run `npx tsc --noEmit` to verify TypeScript compiles
2. Test the affected features:
   - **Resize:** Drag the dividers between panes, verify they resize correctly
   - **Resize persistence:** Resize, refresh the app, verify sizes are remembered
   - **Sidebar toggle:** Toggle sidebar, verify right pane adjusts correctly
   - **Print:** Click print button, verify system dialog opens
   - **HTML export:** Click save HTML, verify file saves correctly
   - **JSON export:** Click export JSON, verify file saves correctly

## File Size Summary

| File | Before | After |
|------|--------|-------|
| AppLayout.tsx | 573 lines | ~250 lines |
| useResizablePanes.ts | (new) | ~165 lines |
| exportUtils.ts | (new) | ~115 lines |
