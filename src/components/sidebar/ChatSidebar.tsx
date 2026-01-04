import { useState, useMemo, useRef } from 'react';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useSessionStore } from '../../stores/sessionStore';
import { ChatSessionItem } from './ChatSessionItem';
import { Modal } from '../shared/Modal';
import { ContextMenu, type ContextMenuItem } from '../shared/ContextMenu';

interface ChatSidebarProps {
  width: number;
}

export function ChatSidebar({ width }: ChatSidebarProps) {
  const {
    activeSessionId,
    isSidebarOpen,
    isLoadingSessions,
    sessionMetas,
    searchQuery,
    setSearchQuery,
    getFilteredMetas,
    switchToSession,
    deleteSession,
    renameSession,
  } = useSessionStore();

  // Include sessionMetas in deps so we re-filter when sessions load
  const filteredMetas = useMemo(
    () => getFilteredMetas(),
    [getFilteredMetas, searchQuery, sessionMetas]
  );

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleDeleteClick = (sessionId: string) => {
    setDeleteConfirm(sessionId);
  };

  const handleSearchContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const input = searchInputRef.current;
    if (!input) return;

    // Pre-fetch clipboard using Tauri API for system clipboard access
    let clipboardText = '';
    try {
      clipboardText = await readText() || '';
    } catch {
      // Clipboard read failed - paste will be disabled
    }

    const menuItems: ContextMenuItem[] = [];
    const selectedText = input.value.substring(input.selectionStart || 0, input.selectionEnd || 0);

    if (selectedText) {
      menuItems.push(
        { label: 'Cut', onClick: async () => {
          await writeText(selectedText);
          const before = input.value.substring(0, input.selectionStart || 0);
          const after = input.value.substring(input.selectionEnd || 0);
          setSearchQuery(before + after);
        }},
        { label: 'Copy', onClick: () => writeText(selectedText) }
      );
    }

    if (clipboardText) {
      menuItems.push({
        label: 'Paste',
        onClick: () => {
          const before = input.value.substring(0, input.selectionStart || 0);
          const after = input.value.substring(input.selectionEnd || 0);
          setSearchQuery(before + clipboardText + after);
        }
      });
    }

    if (searchQuery) {
      menuItems.push({ label: 'Select All', onClick: () => input.select() });
    }

    // Only show context menu if there are items to display
    if (menuItems.length > 0) {
      setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
    }
  };

  const handleConfirmDelete = () => {
    if (deleteConfirm) {
      deleteSession(deleteConfirm);
      setDeleteConfirm(null);
    }
  };

  return (
    <>
      <div
        className={`
          flex flex-col h-full bg-stone-50 dark:bg-gray-900 border-r border-stone-200 dark:border-gray-700
          overflow-hidden
          ${isSidebarOpen ? '' : 'w-0'}
        `}
        style={isSidebarOpen ? { width } : undefined}
      >
        {/* Search input */}
        <div className="p-2 border-b border-stone-200 dark:border-gray-700">
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onContextMenu={handleSearchContextMenu}
              className="w-full px-3 py-1.5 pl-8 text-sm bg-white dark:bg-gray-700 border border-stone-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 dark:text-gray-100 dark:placeholder-gray-400"
            />
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 dark:text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:text-gray-500 dark:hover:text-gray-300"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          {isLoadingSessions ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredMetas.length === 0 ? (
            <div className="px-3 py-8 text-center text-stone-400 dark:text-gray-500 text-sm">
              {searchQuery ? 'No matching chats' : 'No chats yet'}
            </div>
          ) : (
            filteredMetas.map((meta) => (
              <ChatSessionItem
                key={meta.id}
                meta={meta}
                isActive={meta.id === activeSessionId}
                onClick={() => switchToSession(meta.id)}
                onDelete={() => handleDeleteClick(meta.id)}
                onRename={(newTitle) => renameSession(meta.id, newTitle)}
              />
            ))
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Chat?"
      >
        <p className="text-stone-600 dark:text-gray-400 mb-6">
          This action cannot be undone. The chat and all its messages will be
          permanently deleted.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setDeleteConfirm(null)}
            className="px-4 py-2 text-stone-600 dark:text-gray-300 hover:bg-stone-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmDelete}
            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
          >
            Delete
          </button>
        </div>
      </Modal>

      {/* Context menu for search input */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
