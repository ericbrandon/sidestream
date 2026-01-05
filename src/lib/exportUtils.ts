import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { extractUsedCSS, getBaseExportStyles } from './cssUtils';
import { buildSessionSettings, serializeMessage, serializeDiscoveryItem } from './sessionHelpers';
import type { Message, DiscoveryItem, ChatSession, ChatSessionMeta, ChatExportData, LLMConfig, DiscoveryModeId } from './types';

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

interface SettingsStoreState {
  frontierLLM: LLMConfig;
  evaluatorLLM: LLMConfig;
  discoveryMode: DiscoveryModeId;
}

interface ExportToJsonParams {
  messages: Message[];
  discoveryItems: DiscoveryItem[];
  activeSessionId: string;
  sessionMetas: ChatSessionMeta[];
  settingsStore: SettingsStoreState;
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
    messages: messages.map(serializeMessage),
    discoveryItems: discoveryItems.map(serializeDiscoveryItem),
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
