import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type {
  ChatSession,
  ChatSessionMeta,
  Message,
  DiscoveryItem,
} from '../lib/types';
import { buildSessionSettings } from '../lib/sessionHelpers';
import { remapMessageIds, remapDiscoveryItems } from '../lib/messageHelpers';
import { useChatStore } from './chatStore';
import { useDiscoveryStore } from './discoveryStore';
import { useSettingsStore } from './settingsStore';
import { useBackgroundStreamStore } from './backgroundStreamStore';

interface SessionState {
  activeSessionId: string | null;
  sessionMetas: ChatSessionMeta[];
  sessionCache: Map<string, ChatSession>; // Cache full sessions for search
  draftInputs: Map<string, string>; // Store draft input text per session
  searchQuery: string;
  isSidebarOpen: boolean;
  isLoadingSessions: boolean;
  isSaving: boolean;
  isDirty: boolean; // Track if current session has unsaved changes

  // Actions
  loadSessionList: () => Promise<void>;
  createNewSession: () => string;
  switchToSession: (sessionId: string) => Promise<void>;
  saveCurrentSession: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, newTitle: string) => Promise<void>;
  forkFromMessage: (messageId: string) => Promise<void>;
  forkCurrentSession: () => Promise<void>;
  toggleSidebar: () => void;
  setActiveSessionId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  getFilteredMetas: () => ChatSessionMeta[];
  markDirty: () => void;
}

function generateChatTitle(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\n/g, ' ').trim();
  if (!cleaned) return 'New Chat';
  return cleaned;
}

function serializeMessage(msg: Message): Message {
  return {
    ...msg,
    timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
  };
}

function serializeDiscoveryItem(item: DiscoveryItem): DiscoveryItem {
  return {
    ...item,
    timestamp: item.timestamp instanceof Date ? item.timestamp : new Date(item.timestamp),
  };
}

export const useSessionStore = create<SessionState>((set, get) => ({
  activeSessionId: null,
  sessionMetas: [],
  sessionCache: new Map<string, ChatSession>(),
  draftInputs: new Map<string, string>(),
  searchQuery: '',
  isSidebarOpen: (() => {
    const saved = localStorage.getItem('sidebarOpen');
    return saved ? saved === 'true' : true;
  })(),
  isLoadingSessions: false,
  isSaving: false,
  isDirty: false,

  loadSessionList: async () => {
    set({ isLoadingSessions: true });
    try {
      const sessions = await invoke<ChatSession[]>('list_chat_sessions');

      const metas: ChatSessionMeta[] = sessions.map((session) => ({
        id: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        discoveryMode: session.settings?.discoveryMode,
      }));

      // Sort by updatedAt descending (most recent first)
      metas.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      // Populate session cache for search
      const cache = new Map<string, ChatSession>();
      for (const session of sessions) {
        cache.set(session.id, session);
      }

      set({ sessionMetas: metas, sessionCache: cache, isLoadingSessions: false });
    } catch (error) {
      console.error('Failed to load session list:', error);
      set({ isLoadingSessions: false });
    }
  },

  createNewSession: () => {
    const currentState = get();
    const chatStore = useChatStore.getState();
    const discoveryStore = useDiscoveryStore.getState();

    // Save current session if it has unsaved changes
    if (currentState.activeSessionId && chatStore.messages.length > 0 && currentState.isDirty) {
      get().saveCurrentSession();
    }

    // Clear stores - this will also clear pending discoveries
    chatStore.clearChat();
    discoveryStore.clearItems();

    // Generate new session ID
    const newId = crypto.randomUUID();

    // Set active session in discovery store to scope future discoveries
    discoveryStore.setActiveSessionId(newId);

    set({ activeSessionId: newId, isDirty: false });

    return newId;
  },

  switchToSession: async (sessionId: string) => {
    const currentState = get();
    const chatStore = useChatStore.getState();
    const discoveryStore = useDiscoveryStore.getState();
    const backgroundStore = useBackgroundStreamStore.getState();

    // Don't do anything if already on this session
    if (currentState.activeSessionId === sessionId) {
      return;
    }

    // Save draft input from current session before switching
    if (currentState.activeSessionId && chatStore.inputValue) {
      set((state) => {
        const newDrafts = new Map(state.draftInputs);
        newDrafts.set(currentState.activeSessionId!, chatStore.inputValue);
        return { draftInputs: newDrafts };
      });
    } else if (currentState.activeSessionId) {
      // Clear draft if input is empty
      set((state) => {
        const newDrafts = new Map(state.draftInputs);
        newDrafts.delete(currentState.activeSessionId!);
        return { draftInputs: newDrafts };
      });
    }

    // Save current session first if it has unsaved changes
    // But don't save if there's an active stream - it will save when complete
    const hasActiveStream = currentState.activeSessionId
      ? backgroundStore.hasActiveStream(currentState.activeSessionId)
      : false;

    if (
      currentState.activeSessionId &&
      chatStore.messages.length > 0 &&
      currentState.isDirty &&
      !hasActiveStream
    ) {
      await get().saveCurrentSession();
    }

    // Set new session ID in discovery store BEFORE loading
    // This ensures any pending discoveries from old session are ignored
    discoveryStore.setActiveSessionId(sessionId);

    try {
      const session = await invoke<ChatSession | null>('load_chat_session', {
        sessionId,
      });

      if (session) {
        // Check if the new session has an active background stream
        const activeStream = backgroundStore.getStreamForSession(sessionId);

        if (activeStream) {
          // Restore session with active streaming state
          useChatStore.getState().loadSessionWithStreaming(
            session.messages.map(serializeMessage),
            activeStream.streamingContent,
            activeStream.streamingCitations,
            activeStream.streamingInlineCitations,
            activeStream.turnId
          );
        } else {
          // Normal load (no active stream)
          useChatStore.getState().loadSession(
            session.messages.map(serializeMessage)
          );
        }

        // Restore discovery items with sessionId
        // Also merge any items from active background discovery streams
        const backgroundDiscoveryStreams = backgroundStore.getDiscoveryStreamsForSession(sessionId);
        const backgroundItems = backgroundDiscoveryStreams.flatMap(stream => stream.items);

        // Combine saved items with background items, avoiding duplicates by id
        const savedItems = session.discoveryItems.map(serializeDiscoveryItem);
        const savedItemIds = new Set(savedItems.map(item => item.id));
        const newBackgroundItems = backgroundItems.filter(item => !savedItemIds.has(item.id));
        const allDiscoveryItems = [...savedItems, ...newBackgroundItems];

        // Load combined discovery items
        useDiscoveryStore.getState().loadItems(allDiscoveryItems, sessionId);

        // Mark active discovery turns as pending so UI shows loading state
        for (const stream of backgroundDiscoveryStreams) {
          useDiscoveryStore.getState().startTurn(stream.turnId, sessionId);
        }

        // Restore settings
        useSettingsStore.getState().loadSettings(session.settings);

        // Restore draft input if any was saved for this session
        const draftInput = get().draftInputs.get(sessionId);
        if (draftInput) {
          useChatStore.getState().setInput(draftInput);
        }

        set({ activeSessionId: sessionId, isDirty: false });
      }
    } catch (error) {
      console.error('Failed to switch to session:', error);
    }
  },

  saveCurrentSession: async () => {
    const currentState = get();
    if (!currentState.activeSessionId) return;
    if (currentState.isSaving) return;

    const chatStore = useChatStore.getState();
    const discoveryStore = useDiscoveryStore.getState();
    const settingsStore = useSettingsStore.getState();

    // Don't save empty sessions
    if (chatStore.messages.length === 0) return;

    set({ isSaving: true });

    try {
      // Check if this is a new session or existing
      const existingMeta = currentState.sessionMetas.find(
        (m) => m.id === currentState.activeSessionId
      );

      // Preserve existing title if session was already saved (user may have renamed it)
      // Only generate a new title for new sessions
      let title: string;
      if (existingMeta) {
        title = existingMeta.title;
      } else {
        const firstUserMessage = chatStore.messages.find((m) => m.role === 'user');
        title = firstUserMessage
          ? generateChatTitle(firstUserMessage.content)
          : 'New Chat';
      }

      const now = new Date().toISOString();

      const session: ChatSession = {
        id: currentState.activeSessionId,
        title,
        createdAt: existingMeta ? existingMeta.updatedAt : now, // Keep original creation time
        updatedAt: now,
        messages: chatStore.messages.map((msg) => ({
          ...msg,
          timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
        })),
        // Filter discovery items by sessionId for safety (should already match, but be explicit)
        discoveryItems: discoveryStore.items
          .filter((item) => item.sessionId === currentState.activeSessionId)
          .map((item) => ({
            ...item,
            timestamp: item.timestamp instanceof Date ? item.timestamp : new Date(item.timestamp),
          })),
        settings: buildSessionSettings(settingsStore),
      };

      await invoke('save_chat_session', { session });

      // Update meta list
      const newMeta: ChatSessionMeta = {
        id: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        discoveryMode: settingsStore.discoveryMode,
      };

      set((state) => {
        const filteredMetas = state.sessionMetas.filter((m) => m.id !== session.id);
        const newMetas = [newMeta, ...filteredMetas];
        // Keep sorted by updatedAt descending
        newMetas.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

        // Update session cache for search
        const newCache = new Map(state.sessionCache);
        newCache.set(session.id, session);

        return { sessionMetas: newMetas, sessionCache: newCache, isSaving: false, isDirty: false };
      });
    } catch (error) {
      console.error('Failed to save session:', error);
      set({ isSaving: false });
    }
  },

  deleteSession: async (sessionId: string) => {
    try {
      await invoke('delete_chat_session', { sessionId });

      const currentState = get();

      // Remove from meta list and cache
      set((state) => {
        const newCache = new Map(state.sessionCache);
        newCache.delete(sessionId);
        return {
          sessionMetas: state.sessionMetas.filter((m) => m.id !== sessionId),
          sessionCache: newCache,
        };
      });

      // If deleting active session, create new one
      if (currentState.activeSessionId === sessionId) {
        const chatStore = useChatStore.getState();
        const discoveryStore = useDiscoveryStore.getState();
        chatStore.clearChat();
        discoveryStore.clearItems();

        const newId = crypto.randomUUID();
        discoveryStore.setActiveSessionId(newId);
        set({ activeSessionId: newId });
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  },

  renameSession: async (sessionId: string, newTitle: string) => {
    try {
      // Load the full session
      const session = await invoke<ChatSession | null>('load_chat_session', { sessionId });
      if (!session) {
        console.error('Session not found for rename');
        return;
      }

      // Update the title and save
      const updatedSession: ChatSession = {
        ...session,
        title: newTitle,
        updatedAt: new Date().toISOString(),
      };

      await invoke('save_chat_session', { session: updatedSession });

      // Update meta list and cache
      set((state) => {
        const newMetas = state.sessionMetas.map((m) =>
          m.id === sessionId ? { ...m, title: newTitle, updatedAt: updatedSession.updatedAt } : m
        );
        newMetas.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

        const newCache = new Map(state.sessionCache);
        newCache.set(sessionId, updatedSession);

        return { sessionMetas: newMetas, sessionCache: newCache };
      });
    } catch (error) {
      console.error('Failed to rename session:', error);
    }
  },

  forkFromMessage: async (messageId: string) => {
    const currentState = get();
    const chatStore = useChatStore.getState();
    const discoveryStore = useDiscoveryStore.getState();
    const settingsStore = useSettingsStore.getState();

    // If streaming is active, cancel it first
    if (chatStore.isStreaming) {
      await invoke('cancel_chat_stream');
      chatStore.clearStreamingContent();
    }

    // Save current session first if dirty
    if (currentState.activeSessionId && chatStore.messages.length > 0 && currentState.isDirty) {
      await get().saveCurrentSession();
    }

    // Find target user message by ID
    const targetIndex = chatStore.messages.findIndex((m) => m.id === messageId);
    if (targetIndex === -1) {
      console.error('Fork target message not found');
      return;
    }

    const targetMessage = chatStore.messages[targetIndex];
    if (targetMessage.role !== 'user') {
      console.error('Can only fork from user messages');
      return;
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
    const originalTitle = currentState.sessionMetas.find(
      (m) => m.id === currentState.activeSessionId
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

    // Update session state
    set({ activeSessionId: newSessionId, isDirty: true });

    // Build and save the forked session
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: newSessionId,
      title: forkTitle,
      createdAt: now,
      updatedAt: now,
      messages: newMessages.map((msg) => ({
        ...msg,
        timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
      })),
      discoveryItems: newDiscoveryItems.map((item) => ({
        ...item,
        timestamp: item.timestamp instanceof Date ? item.timestamp : new Date(item.timestamp),
      })),
      settings: buildSessionSettings(settingsStore),
    };

    await invoke('save_chat_session', { session });

    // Update meta list with new forked session
    const newMeta: ChatSessionMeta = {
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      discoveryMode: settingsStore.discoveryMode,
    };

    set((state) => {
      const newMetas = [newMeta, ...state.sessionMetas];
      newMetas.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      const newCache = new Map(state.sessionCache);
      newCache.set(session.id, session);

      return { sessionMetas: newMetas, sessionCache: newCache, isDirty: false };
    });
  },

  forkCurrentSession: async () => {
    const currentState = get();
    const chatStore = useChatStore.getState();
    const discoveryStore = useDiscoveryStore.getState();
    const settingsStore = useSettingsStore.getState();

    // If streaming is active, cancel it first
    if (chatStore.isStreaming) {
      await invoke('cancel_chat_stream');
      chatStore.clearStreamingContent();
    }

    // Save current session first if dirty
    if (currentState.activeSessionId && chatStore.messages.length > 0 && currentState.isDirty) {
      await get().saveCurrentSession();
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
    const originalTitle = currentState.sessionMetas.find(
      (m) => m.id === currentState.activeSessionId
    )?.title || 'Chat';
    const forkTitle = `Fork: ${originalTitle}`;

    // Update chat store with new messages (input will be set by caller)
    chatStore.loadSession(newMessages);
    chatStore.clearAttachments();

    // Update discovery store
    discoveryStore.loadItems(newDiscoveryItems, newSessionId);
    discoveryStore.setActiveSessionId(newSessionId);

    // Update session state
    set({ activeSessionId: newSessionId, isDirty: true });

    // Build and save the forked session
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: newSessionId,
      title: forkTitle,
      createdAt: now,
      updatedAt: now,
      messages: newMessages.map((msg) => ({
        ...msg,
        timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
      })),
      discoveryItems: newDiscoveryItems.map((item) => ({
        ...item,
        timestamp: item.timestamp instanceof Date ? item.timestamp : new Date(item.timestamp),
      })),
      settings: buildSessionSettings(settingsStore),
    };

    await invoke('save_chat_session', { session });

    // Update meta list with new forked session
    const newMeta: ChatSessionMeta = {
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      discoveryMode: settingsStore.discoveryMode,
    };

    set((state) => {
      const newMetas = [newMeta, ...state.sessionMetas];
      newMetas.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      const newCache = new Map(state.sessionCache);
      newCache.set(session.id, session);

      return { sessionMetas: newMetas, sessionCache: newCache, isDirty: false };
    });
  },

  toggleSidebar: () => {
    set((state) => {
      const newState = !state.isSidebarOpen;
      localStorage.setItem('sidebarOpen', String(newState));
      return { isSidebarOpen: newState };
    });
  },

  setActiveSessionId: (id: string | null) => {
    set({ activeSessionId: id });
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  getFilteredMetas: () => {
    const { sessionMetas, sessionCache, searchQuery } = get();

    if (!searchQuery.trim()) {
      return sessionMetas;
    }

    // Split query into individual terms, lowercase
    const searchTerms = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);

    if (searchTerms.length === 0) {
      return sessionMetas;
    }

    // Parse terms into include/exclude with optional wildcards
    const includeTerms: { pattern: string; isWildcard: boolean }[] = [];
    const excludeTerms: { pattern: string; isWildcard: boolean }[] = [];

    for (const term of searchTerms) {
      if (term.startsWith('-') && term.length > 1) {
        // Exclusion term
        const pattern = term.slice(1);
        excludeTerms.push({
          pattern: pattern.replace(/\*/g, ''),
          isWildcard: pattern.includes('*'),
        });
      } else {
        // Inclusion term
        includeTerms.push({
          pattern: term.replace(/\*/g, ''),
          isWildcard: term.includes('*'),
        });
      }
    }

    // Helper to check if text matches a term
    const matchesTerm = (text: string, term: { pattern: string; isWildcard: boolean }): boolean => {
      if (term.isWildcard) {
        // Wildcard: substring match
        return text.includes(term.pattern);
      } else {
        // Non-wildcard: whole word match (word boundaries)
        const regex = new RegExp(`\\b${term.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        return regex.test(text);
      }
    };

    return sessionMetas.filter((meta) => {
      const session = sessionCache.get(meta.id);
      let fullText: string;

      if (!session) {
        // If not in cache, only search the title
        fullText = meta.title.toLowerCase();
      } else {
        // Build searchable text from all content
        const textParts: string[] = [session.title];

        // Add all message content
        for (const msg of session.messages) {
          textParts.push(msg.content);
        }

        // Add all discovery item content
        for (const item of session.discoveryItems) {
          textParts.push(item.title);
          textParts.push(item.oneLiner);
          textParts.push(item.fullSummary);
          textParts.push(item.relevanceExplanation);
          if (item.sourceUrl) textParts.push(item.sourceUrl);
          if (item.sourceDomain) textParts.push(item.sourceDomain);
        }

        fullText = textParts.join(' ').toLowerCase();
      }

      // All include terms must match
      const includesMatch = includeTerms.every((term) => matchesTerm(fullText, term));

      // No exclude terms should match
      const excludesMatch = excludeTerms.some((term) => matchesTerm(fullText, term));

      return includesMatch && !excludesMatch;
    });
  },

  markDirty: () => {
    set({ isDirty: true });
  },
}));
