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
  containerRef: React.RefObject<HTMLDivElement | null>;
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
