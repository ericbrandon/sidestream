import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { getDiscoveryMode } from '../../lib/discoveryModes';
import { stripCiteTags } from '../../lib/chatUtils';
import { ContextMenu, type ContextMenuItem } from '../shared/ContextMenu';
import type { DiscoveryItem } from '../../lib/types';

interface DiscoveryCardProps {
  item: DiscoveryItem;
}

function formatContent(item: DiscoveryItem, chatPrefix: string): string {
  const sourceSection = item.sourceUrl ? `\n\nSource: ${item.sourceUrl}` : '';
  return `${chatPrefix}

"${stripCiteTags(item.title)}"

${stripCiteTags(item.fullSummary)}${sourceSection}`;
}

function formatContentForCopy(item: DiscoveryItem): string {
  const sourceSection = item.sourceUrl ? `\n\nSource: ${item.sourceUrl}` : '';
  return `"${stripCiteTags(item.title)}"

${stripCiteTags(item.fullSummary)}${sourceSection}`;
}

export function DiscoveryCard({ item }: DiscoveryCardProps) {
  const { toggleExpanded, removeItem } = useDiscoveryStore();
  const { appendToInput, setInput } = useChatStore();
  const { forkCurrentSession } = useSessionStore();
  // Use the mode that generated this chip, not the current mode
  // Fall back to 'useful-informative' for items created before modeId was added
  const modeConfig = getDiscoveryMode(item.modeId || 'useful-informative');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (selectedText) {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: 'Copy', onClick: () => writeText(selectedText) },
          { label: 'Search Google', onClick: () => openUrl(`https://www.google.com/search?q=${encodeURIComponent(selectedText)}`) }
        ]
      });
    }
  };

  const handleAddToChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    appendToInput(formatContent(item, modeConfig.chatPrefix));
  };

  const handleForkToNewChat = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Fork the entire current session, then set the input to the discovery content
    await forkCurrentSession();
    setInput(formatContent(item, modeConfig.chatPrefix));
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    writeText(formatContentForCopy(item));
  };

  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-lg border border-stone-200 dark:border-gray-700 shadow-sm hover:border-purple-500 dark:hover:border-purple-400 transition-all mb-3 font-scalable"
      onContextMenu={handleContextMenu}
    >
      {/* Header - always visible, clickable to expand */}
      <div
        className="p-3 cursor-pointer flex items-center gap-2 relative group"
        onClick={() => toggleExpanded(item.id)}
      >
        <span className="flex-1 font-medium text-sm pr-5 dark:text-gray-300">
          {item.isExpanded ? stripCiteTags(item.title) : stripCiteTags(item.oneLiner)}
        </span>
        <span className="text-stone-400 dark:text-gray-500 text-xs">
          {item.isExpanded ? '▼' : '▶'}
        </span>
        {/* Delete button */}
        <button
          className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            removeItem(item.id);
          }}
          title="Delete"
        >
          ×
        </button>
      </div>

      {/* Expanded content */}
      {item.isExpanded && (
        <div className="px-3 pb-3 border-t border-stone-200 dark:border-gray-700 pt-3">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{stripCiteTags(item.fullSummary)}</p>

          <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            <strong className="text-purple-600 dark:text-purple-400">Why relevant:</strong>{' '}
            {stripCiteTags(item.relevanceExplanation)}
          </div>

          <div className="flex flex-col gap-2">
            <button
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 self-start"
              onClick={(e) => {
                e.stopPropagation();
                if (item.sourceUrl) {
                  openUrl(item.sourceUrl);
                }
              }}
            >
              {item.sourceDomain}
            </button>

            {/* Action buttons */}
            <div className="flex items-center gap-1">
              {/* Add to current chat */}
              <button
                className="px-2 py-1 bg-blue-100 dark:bg-blue-900/50 rounded text-xs text-blue-700 dark:text-blue-300 cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/50 flex items-center gap-1"
                onClick={handleAddToChat}
                title="Add to current chat"
              >
                +chat
              </button>
              {/* Fork and add to new chat */}
              <button
                className="px-2 py-1 bg-blue-100 dark:bg-blue-900/50 rounded text-xs text-blue-700 dark:text-blue-300 cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/50 flex items-center gap-1"
                onClick={handleForkToNewChat}
                title="Fork chat and add this discovery"
              >
                +fork
              </button>
              {/* Copy to clipboard */}
              <button
                className="px-2 py-1 bg-blue-100 dark:bg-blue-900/50 rounded text-xs text-blue-700 dark:text-blue-300 cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/50 flex items-center gap-1"
                onClick={handleCopy}
                title="Copy to clipboard"
              >
                copy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context menu for copy/search */}
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
