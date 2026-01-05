import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type {
  ChatSession,
  ChatSessionMeta,
} from '../lib/types';
import { buildSessionSettings, generateChatTitle, serializeMessage, serializeDiscoveryItem } from '../lib/sessionHelpers';
import { filterSessionMetas } from '../lib/sessionSearch';
import { forkFromMessage as forkFromMessageImpl, forkCurrentSession as forkCurrentSessionImpl, type ForkStores } from '../lib/sessionFork';
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
    const stores: ForkStores = {
      chatStore: useChatStore.getState(),
      discoveryStore: useDiscoveryStore.getState(),
      settingsStore: useSettingsStore.getState(),
      sessionStore: {
        activeSessionId: currentState.activeSessionId,
        sessionMetas: currentState.sessionMetas,
        isDirty: currentState.isDirty,
        saveCurrentSession: get().saveCurrentSession,
      },
    };

    const result = await forkFromMessageImpl(messageId, stores);
    if (!result) return;

    const { newSessionId, newMeta, session } = result;

    // Update session state
    set({ activeSessionId: newSessionId, isDirty: true });

    // Update meta list with new forked session
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
    const stores: ForkStores = {
      chatStore: useChatStore.getState(),
      discoveryStore: useDiscoveryStore.getState(),
      settingsStore: useSettingsStore.getState(),
      sessionStore: {
        activeSessionId: currentState.activeSessionId,
        sessionMetas: currentState.sessionMetas,
        isDirty: currentState.isDirty,
        saveCurrentSession: get().saveCurrentSession,
      },
    };

    const result = await forkCurrentSessionImpl(stores);
    if (!result) return;

    const { newSessionId, newMeta, session } = result;

    // Update session state
    set({ activeSessionId: newSessionId, isDirty: true });

    // Update meta list with new forked session
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
    return filterSessionMetas(sessionMetas, sessionCache, searchQuery);
  },

  markDirty: () => {
    set({ isDirty: true });
  },
}));
