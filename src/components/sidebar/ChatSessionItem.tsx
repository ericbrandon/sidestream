import { useState, useRef, useEffect } from 'react';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { ChatSessionMeta } from '../../lib/types';
import { ContextMenu, type ContextMenuItem } from '../shared/ContextMenu';
import { useBackgroundStreamStore } from '../../stores/backgroundStreamStore';
import { getDiscoveryMode } from '../../lib/discoveryModes';

interface ChatSessionItemProps {
  meta: ChatSessionMeta;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ChatSessionItem({
  meta,
  isActive,
  onClick,
  onDelete,
  onRename,
}: ChatSessionItemProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(meta.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const isContextMenuOpenRef = useRef(false);

  // Check if this session has an active background stream
  const hasActiveStream = useBackgroundStreamStore(
    (state) => state.hasActiveStream(meta.id)
  );

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const menuItems: ContextMenuItem[] = [
      { label: 'Rename', onClick: startEditing },
      { label: 'Delete', onClick: onDelete, danger: true },
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
  };

  const handleEditContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const input = inputRef.current;
    if (!input) return;

    // Mark context menu as open to prevent blur from saving
    isContextMenuOpenRef.current = true;

    // Pre-fetch clipboard using Tauri API for system clipboard access
    let clipboardText = '';
    try {
      clipboardText = await readText() || '';
    } catch {
      // Clipboard read failed - paste will be disabled
    }

    const menuItems: ContextMenuItem[] = [];
    const selectedText = input.value.substring(input.selectionStart || 0, input.selectionEnd || 0);

    // Helper to refocus input after menu action
    const refocusInput = () => {
      setTimeout(() => inputRef.current?.focus(), 0);
    };

    if (selectedText) {
      menuItems.push(
        { label: 'Cut', onClick: async () => {
          await writeText(selectedText);
          const before = input.value.substring(0, input.selectionStart || 0);
          const after = input.value.substring(input.selectionEnd || 0);
          setEditValue(before + after);
          refocusInput();
        }},
        { label: 'Copy', onClick: () => {
          writeText(selectedText);
          refocusInput();
        }}
      );
    }

    if (clipboardText) {
      menuItems.push({
        label: 'Paste',
        onClick: () => {
          const before = input.value.substring(0, input.selectionStart || 0);
          const after = input.value.substring(input.selectionEnd || 0);
          setEditValue(before + clipboardText + after);
          refocusInput();
        }
      });
    }

    if (editValue) {
      menuItems.push({ label: 'Select All', onClick: () => {
        input.select();
        refocusInput();
      }});
    }

    // Only show context menu if there are items to display
    if (menuItems.length > 0) {
      setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
    }
  };

  const handleContextMenuClose = () => {
    setContextMenu(null);
    // Reset the flag after a short delay to allow blur to be ignored
    setTimeout(() => {
      isContextMenuOpenRef.current = false;
    }, 100);
  };

  const startEditing = () => {
    setEditValue(meta.title);
    setIsEditing(true);
  };

  const handleSave = () => {
    // Don't save if context menu is open (user clicked a menu item)
    if (isContextMenuOpenRef.current) return;

    const trimmed = editValue.trim();
    if (trimmed && trimmed !== meta.title) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(meta.title);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  return (
    <>
      <div
        className={`
          px-3 py-2 cursor-pointer border-b border-stone-100 dark:border-gray-800 transition-colors
          ${isActive ? 'bg-blue-50 dark:bg-blue-900/30 border-l-2 border-l-blue-500' : 'hover:bg-stone-100 dark:hover:bg-gray-800 border-l-2 border-l-transparent'}
        `}
        onClick={isEditing ? undefined : onClick}
        onContextMenu={handleContextMenu}
      >
        <div className="font-medium text-sm text-stone-800 dark:text-gray-200 flex items-center gap-1.5">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              onContextMenu={handleEditContextMenu}
              className="flex-1 min-w-0 px-1 py-0 -mx-1 bg-white dark:bg-gray-700 border border-blue-500 rounded text-sm focus:outline-none dark:text-gray-100"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="truncate">{meta.title}</span>
          )}
          {hasActiveStream && (
            <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          )}
        </div>
        <div className="flex justify-between items-center mt-1">
          <span className="text-xs text-stone-400 dark:text-gray-500">
            {meta.discoveryMode ? getDiscoveryMode(meta.discoveryMode).name : 'Useful & Informative'}
          </span>
          <span className="text-xs text-stone-400 dark:text-gray-500">
            {formatRelativeDate(meta.updatedAt)}
          </span>
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={handleContextMenuClose}
        />
      )}
    </>
  );
}
