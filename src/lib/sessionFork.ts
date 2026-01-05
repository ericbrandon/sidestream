import { invoke } from '@tauri-apps/api/core';
import type { ChatSession, ChatSessionMeta, Message, DiscoveryItem, Attachment, DiscoveryModeId, LLMConfig } from './types';
import { buildSessionSettings, serializeMessage, serializeDiscoveryItem } from './sessionHelpers';
import { remapMessageIds, remapDiscoveryItems } from './messageHelpers';
import { logError } from './logger';

interface ChatStoreState {
  messages: Message[];
  isStreaming: boolean;
  inputValue: string;
  clearStreamingContent: () => void;
  loadSession: (messages: Message[]) => void;
  setInput: (value: string) => void;
  clearAttachments: () => void;
  addAttachment: (att: Attachment) => void;
}

interface DiscoveryStoreState {
  items: DiscoveryItem[];
  loadItems: (items: DiscoveryItem[], sessionId: string) => void;
  setActiveSessionId: (id: string) => void;
}

interface SettingsStoreState {
  discoveryMode: DiscoveryModeId;
  frontierLLM: LLMConfig;
  evaluatorLLM: LLMConfig;
}

interface SessionStoreState {
  activeSessionId: string | null;
  sessionMetas: ChatSessionMeta[];
  isDirty: boolean;
  saveCurrentSession: () => Promise<void>;
}

export interface ForkStores {
  chatStore: ChatStoreState;
  discoveryStore: DiscoveryStoreState;
  settingsStore: SettingsStoreState;
  sessionStore: SessionStoreState;
}

export interface ForkResult {
  newSessionId: string;
  newMeta: ChatSessionMeta;
  session: ChatSession;
}

/**
 * Fork from a specific user message.
 * Creates a new session with messages up to (but not including) the target message.
 * The target message content is placed in the input field for editing.
 */
export async function forkFromMessage(
  messageId: string,
  stores: ForkStores
): Promise<ForkResult | null> {
  const { chatStore, discoveryStore, settingsStore, sessionStore } = stores;

  // If streaming is active, cancel it first
  if (chatStore.isStreaming) {
    await invoke('cancel_chat_stream');
    chatStore.clearStreamingContent();
  }

  // Save current session first if dirty
  if (sessionStore.activeSessionId && chatStore.messages.length > 0 && sessionStore.isDirty) {
    await sessionStore.saveCurrentSession();
  }

  // Find target user message by ID
  const targetIndex = chatStore.messages.findIndex((m) => m.id === messageId);
  if (targetIndex === -1) {
    logError('sessionFork.forkFromMessage', 'Fork target message not found');
    return null;
  }

  const targetMessage = chatStore.messages[targetIndex];
  if (targetMessage.role !== 'user') {
    logError('sessionFork.forkFromMessage', 'Can only fork from user messages');
    return null;
  }

  // Get messages to keep (everything before the target message)
  const messagesToKeep = chatStore.messages.slice(0, targetIndex);

  // Remap message and discovery item IDs
  const newSessionId = crypto.randomUUID();
  const { messages: newMessages, turnIdMap } = remapMessageIds(messagesToKeep);
  const { items: newDiscoveryItems } = remapDiscoveryItems(
    discoveryStore.items,
    turnIdMap,
    newSessionId
  );

  // Generate fork title
  const originalTitle = sessionStore.sessionMetas.find(
    (m) => m.id === sessionStore.activeSessionId
  )?.title || 'Chat';
  const forkTitle = `Fork: ${originalTitle}`;

  // Update chat store with new messages and set input to forked message content
  chatStore.loadSession(newMessages);
  chatStore.setInput(targetMessage.content);

  // Restore attachments from the forked message if any
  chatStore.clearAttachments();
  if (targetMessage.attachments?.length) {
    for (const att of targetMessage.attachments) {
      chatStore.addAttachment(att);
    }
  }

  // Update discovery store
  discoveryStore.loadItems(newDiscoveryItems, newSessionId);
  discoveryStore.setActiveSessionId(newSessionId);

  // Build and save the forked session
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: newSessionId,
    title: forkTitle,
    createdAt: now,
    updatedAt: now,
    messages: newMessages.map(serializeMessage),
    discoveryItems: newDiscoveryItems.map(serializeDiscoveryItem),
    settings: buildSessionSettings(settingsStore),
  };

  await invoke('save_chat_session', { session });

  // Create new meta
  const newMeta: ChatSessionMeta = {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    discoveryMode: settingsStore.discoveryMode,
  };

  return { newSessionId, newMeta, session };
}

/**
 * Fork the entire current session.
 * Creates a copy of the session with new IDs.
 */
export async function forkCurrentSession(
  stores: ForkStores
): Promise<ForkResult | null> {
  const { chatStore, discoveryStore, settingsStore, sessionStore } = stores;

  // If streaming is active, cancel it first
  if (chatStore.isStreaming) {
    await invoke('cancel_chat_stream');
    chatStore.clearStreamingContent();
  }

  // Save current session first if dirty
  if (sessionStore.activeSessionId && chatStore.messages.length > 0 && sessionStore.isDirty) {
    await sessionStore.saveCurrentSession();
  }

  // Remap message and discovery item IDs
  const newSessionId = crypto.randomUUID();
  const { messages: newMessages, turnIdMap } = remapMessageIds(chatStore.messages);
  const { items: newDiscoveryItems } = remapDiscoveryItems(
    discoveryStore.items,
    turnIdMap,
    newSessionId
  );

  // Generate fork title
  const originalTitle = sessionStore.sessionMetas.find(
    (m) => m.id === sessionStore.activeSessionId
  )?.title || 'Chat';
  const forkTitle = `Fork: ${originalTitle}`;

  // Update chat store with new messages
  chatStore.loadSession(newMessages);
  chatStore.clearAttachments();

  // Update discovery store
  discoveryStore.loadItems(newDiscoveryItems, newSessionId);
  discoveryStore.setActiveSessionId(newSessionId);

  // Build and save the forked session
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: newSessionId,
    title: forkTitle,
    createdAt: now,
    updatedAt: now,
    messages: newMessages.map(serializeMessage),
    discoveryItems: newDiscoveryItems.map(serializeDiscoveryItem),
    settings: buildSessionSettings(settingsStore),
  };

  await invoke('save_chat_session', { session });

  // Create new meta
  const newMeta: ChatSessionMeta = {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    discoveryMode: settingsStore.discoveryMode,
  };

  return { newSessionId, newMeta, session };
}
