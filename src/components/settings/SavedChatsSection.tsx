import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { useSessionStore } from '../../stores/sessionStore';
import { useChatStore } from '../../stores/chatStore';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import type { ChatSession, ChatExportData, DiscoveryItem, Message } from '../../lib/types';

export function SavedChatsSection() {
  const { sessionMetas, loadSessionList } = useSessionStore();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const handleDeleteAll = async () => {
    setIsDeleting(true);
    try {
      // Clear backend store
      await invoke('clear_chat_sessions_store');

      // Clear current session in UI
      useChatStore.getState().clearChat();
      useDiscoveryStore.getState().clearItems();

      // Create a new session
      const newId = crypto.randomUUID();
      useDiscoveryStore.getState().setActiveSessionId(newId);
      useSessionStore.setState({
        activeSessionId: newId,
        sessionMetas: [],
        sessionCache: new Map(),
        isDirty: false,
      });

      setShowDeleteConfirm(false);
    } catch (error) {
      console.error('Failed to delete all chats:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setImportError(null);
    setImportSuccess(null);

    try {
      // Load all sessions from backend
      const sessions = await invoke<ChatSession[]>('list_chat_sessions');

      const exportData: ChatExportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sessions,
      };

      const jsonContent = JSON.stringify(exportData, null, 2);

      // Open save dialog
      const filePath = await save({
        defaultPath: `sidestream-all-chats-${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (filePath) {
        await writeTextFile(filePath, jsonContent);
        setImportSuccess(`Exported ${sessions.length} chat${sessions.length !== 1 ? 's' : ''} successfully`);
      }
    } catch (error) {
      console.error('Failed to export chats:', error);
      setImportError('Failed to export chats: ' + String(error));
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);

    try {
      // Open file dialog
      const filePath = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false,
      });

      if (!filePath) {
        setIsImporting(false);
        return;
      }

      // Read file content
      const content = await readTextFile(filePath as string);
      const importData = JSON.parse(content) as ChatExportData;

      // Validate structure
      if (!importData.version || !Array.isArray(importData.sessions)) {
        throw new Error('Invalid export file format');
      }

      // Get existing session IDs
      const existingSessions = await invoke<ChatSession[]>('list_chat_sessions');
      const existingIds = new Set(existingSessions.map((s) => s.id));

      let importedCount = 0;

      for (const session of importData.sessions) {
        // Check for ID conflict
        let sessionToSave = session;

        if (existingIds.has(session.id)) {
          // Generate new IDs for the session and all related items
          const newSessionId = crypto.randomUUID();
          const turnIdMap = new Map<string, string>();

          // Collect all unique turnIds and create mappings
          for (const msg of session.messages) {
            if (msg.turnId && !turnIdMap.has(msg.turnId)) {
              turnIdMap.set(msg.turnId, crypto.randomUUID());
            }
          }
          for (const item of session.discoveryItems) {
            if (item.turnId && !turnIdMap.has(item.turnId)) {
              turnIdMap.set(item.turnId, crypto.randomUUID());
            }
          }

          // Transform messages with new IDs
          const newMessages: Message[] = session.messages.map((msg) => ({
            ...msg,
            id: crypto.randomUUID(),
            turnId: msg.turnId ? turnIdMap.get(msg.turnId) : undefined,
          }));

          // Transform discovery items with new IDs
          const newDiscoveryItems: DiscoveryItem[] = session.discoveryItems.map((item) => ({
            ...item,
            id: crypto.randomUUID(),
            turnId: turnIdMap.get(item.turnId) || item.turnId,
            sessionId: newSessionId,
          }));

          sessionToSave = {
            ...session,
            id: newSessionId,
            messages: newMessages,
            discoveryItems: newDiscoveryItems,
          };
        } else {
          // Update sessionId in discovery items to match (in case of old export format)
          sessionToSave = {
            ...session,
            discoveryItems: session.discoveryItems.map((item) => ({
              ...item,
              sessionId: session.id,
            })),
          };
        }

        // Save the session
        await invoke('save_chat_session', { session: sessionToSave });
        importedCount++;
      }

      // Reload session list
      await loadSessionList();

      setImportSuccess(`Imported ${importedCount} chat${importedCount !== 1 ? 's' : ''} successfully`);
    } catch (error) {
      console.error('Failed to import chats:', error);
      setImportError('Failed to import chats: ' + String(error));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="space-y-4 pt-4 flex flex-col items-center">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        You have {sessionMetas.length} saved chat{sessionMetas.length !== 1 ? 's' : ''}.
      </p>

      <div className="flex flex-col gap-2 items-center">
        <button
          onClick={handleExport}
          disabled={isExporting || sessionMetas.length === 0}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md border border-gray-300 dark:border-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isExporting ? 'Exporting...' : 'Export Chats'}
        </button>

        <button
          onClick={handleImport}
          disabled={isImporting}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md border border-gray-300 dark:border-gray-600 transition-colors disabled:opacity-50"
        >
          {isImporting ? 'Importing...' : 'Import Chats'}
        </button>

        <button
          onClick={() => setShowDeleteConfirm(true)}
          disabled={sessionMetas.length === 0}
          className="px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/30 dark:hover:bg-red-900/50 rounded-md border border-red-300 dark:border-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Delete All Chats
        </button>
      </div>

      {importError && (
        <p className="text-sm text-red-600 dark:text-red-400">{importError}</p>
      )}

      {importSuccess && (
        <p className="text-sm text-green-600 dark:text-green-400">{importSuccess}</p>
      )}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteAll}
        title="Delete All Saved Chats"
        message={
          <div className="space-y-2">
            <p>Are you sure you want to delete all {sessionMetas.length} saved chat{sessionMetas.length !== 1 ? 's' : ''}?</p>
            <p className="font-medium">This action cannot be undone.</p>
          </div>
        }
        confirmLabel="Delete All"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={isDeleting}
      />
    </section>
  );
}
