import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Citation, InlineCitation, DiscoveryItem, Message, ChatSession, GeneratedFile } from '../lib/types';
import { buildSessionSettings } from '../lib/sessionHelpers';
import { deduplicateCitations } from '../lib/citationHelpers';
import { logError } from '../lib/logger';
import { useChatStore } from './chatStore';
import { useSessionStore } from './sessionStore';
import { useSettingsStore } from './settingsStore';

interface BackgroundChatStream {
  sessionId: string;
  turnId: string;
  streamingContent: string;
  streamingCitations: Citation[];
  streamingInlineCitations: InlineCitation[];
  streamingThinking: string;
  thinkingStartTime: number | null;
  startedAt: Date;
  // Execution tracking
  streamingExecutionCode: string;
  streamingExecutionOutput: string;
  executionStatus: 'idle' | 'running' | 'completed' | 'failed';
  executionError: string | null;
  executionStartTime: number | null;
  executionTextPosition: number | null;
  streamingGeneratedFiles: GeneratedFile[];
}

interface BackgroundDiscoveryStream {
  sessionId: string;
  turnId: string;
  items: DiscoveryItem[];
  startedAt: Date;
}

interface BackgroundStreamState {
  // Active chat streams indexed by turnId (since events arrive with turnId)
  chatStreams: Map<string, BackgroundChatStream>;

  // Active discovery streams indexed by turnId
  discoveryStreams: Map<string, BackgroundDiscoveryStream>;

  // Actions for chat streams
  startChatStream: (sessionId: string, turnId: string) => void;
  appendChatDelta: (turnId: string, text: string) => void;
  addChatCitations: (turnId: string, citations: Citation[]) => void;
  addChatInlineCitations: (turnId: string, citations: InlineCitation[]) => void;
  appendChatThinking: (turnId: string, text: string) => void;
  setExecutionStarted: (turnId: string, code: string) => void;
  appendExecutionOutput: (turnId: string, output: string) => void;
  setExecutionCompleted: (turnId: string, files?: GeneratedFile[]) => void;
  setExecutionFailed: (turnId: string, error: string) => void;
  completeChatStream: (turnId: string) => Promise<void>;
  cancelChatStream: (turnId: string) => void;

  // Actions for discovery streams
  startDiscoveryStream: (sessionId: string, turnId: string) => void;
  addDiscoveryItem: (turnId: string, item: DiscoveryItem) => void;
  completeDiscoveryStream: (turnId: string) => Promise<void>;

  // Queries
  getStreamByTurnId: (turnId: string) => BackgroundChatStream | undefined;
  getStreamForSession: (sessionId: string) => BackgroundChatStream | undefined;
  getDiscoveryStreamsForSession: (sessionId: string) => BackgroundDiscoveryStream[];
  hasActiveStream: (sessionId: string) => boolean;
  getActiveSessionIds: () => string[];
}

export const useBackgroundStreamStore = create<BackgroundStreamState>((set, get) => ({
  chatStreams: new Map(),
  discoveryStreams: new Map(),

  startChatStream: (sessionId, turnId) => {
    set((state) => {
      const newStreams = new Map(state.chatStreams);
      newStreams.set(turnId, {
        sessionId,
        turnId,
        streamingContent: '',
        streamingCitations: [],
        streamingInlineCitations: [],
        streamingThinking: '',
        thinkingStartTime: null,
        startedAt: new Date(),
        // Execution fields
        streamingExecutionCode: '',
        streamingExecutionOutput: '',
        executionStatus: 'idle',
        executionError: null,
        executionStartTime: null,
        executionTextPosition: null,
        streamingGeneratedFiles: [],
      });
      return { chatStreams: newStreams };
    });
  },

  appendChatDelta: (turnId, text) => {
    set((state) => {
      const stream = state.chatStreams.get(turnId);
      if (!stream) return state;

      const newStreams = new Map(state.chatStreams);
      newStreams.set(turnId, {
        ...stream,
        streamingContent: stream.streamingContent + text,
      });
      return { chatStreams: newStreams };
    });
  },

  addChatCitations: (turnId, citations) => {
    set((state) => {
      const stream = state.chatStreams.get(turnId);
      if (!stream) return state;

      const newStreams = new Map(state.chatStreams);
      newStreams.set(turnId, {
        ...stream,
        streamingCitations: [...stream.streamingCitations, ...citations],
      });
      return { chatStreams: newStreams };
    });
  },

  addChatInlineCitations: (turnId, citations) => {
    set((state) => {
      const stream = state.chatStreams.get(turnId);
      if (!stream) return state;

      const newStreams = new Map(state.chatStreams);
      newStreams.set(turnId, {
        ...stream,
        streamingInlineCitations: [...stream.streamingInlineCitations, ...citations],
      });
      return { chatStreams: newStreams };
    });
  },

  appendChatThinking: (turnId, text) => {
    set((state) => {
      const stream = state.chatStreams.get(turnId);
      if (!stream) return state;

      const newStreams = new Map(state.chatStreams);
      newStreams.set(turnId, {
        ...stream,
        streamingThinking: stream.streamingThinking + text,
        // Record start time on first thinking delta
        thinkingStartTime: stream.thinkingStartTime ?? Date.now(),
      });
      return { chatStreams: newStreams };
    });
  },

  setExecutionStarted: (turnId, code) => {
    set((state) => {
      const stream = state.chatStreams.get(turnId);
      if (!stream) return state;

      const newStreams = new Map(state.chatStreams);
      newStreams.set(turnId, {
        ...stream,
        // Append new code to existing (multiple executions in one turn)
        streamingExecutionCode: stream.streamingExecutionCode
          ? `${stream.streamingExecutionCode}\n\n${code}`
          : code,
        executionStatus: 'running',
        executionError: null,
        // Record start time on first execution only
        executionStartTime: stream.executionStartTime ?? Date.now(),
        // Capture text position on first execution only
        executionTextPosition: stream.executionTextPosition ?? stream.streamingContent.length,
      });
      return { chatStreams: newStreams };
    });
  },

  appendExecutionOutput: (turnId, output) => {
    set((state) => {
      const stream = state.chatStreams.get(turnId);
      if (!stream) return state;

      const newStreams = new Map(state.chatStreams);
      newStreams.set(turnId, {
        ...stream,
        streamingExecutionOutput: stream.streamingExecutionOutput + output,
      });
      return { chatStreams: newStreams };
    });
  },

  setExecutionCompleted: (turnId, files) => {
    set((state) => {
      const stream = state.chatStreams.get(turnId);
      if (!stream) return state;

      const newStreams = new Map(state.chatStreams);
      newStreams.set(turnId, {
        ...stream,
        executionStatus: 'completed',
        streamingGeneratedFiles: files
          ? [...stream.streamingGeneratedFiles, ...files]
          : stream.streamingGeneratedFiles,
      });
      return { chatStreams: newStreams };
    });
  },

  setExecutionFailed: (turnId, error) => {
    set((state) => {
      const stream = state.chatStreams.get(turnId);
      if (!stream) return state;

      const newStreams = new Map(state.chatStreams);
      newStreams.set(turnId, {
        ...stream,
        executionStatus: 'failed',
        executionError: error,
      });
      return { chatStreams: newStreams };
    });
  },

  completeChatStream: async (turnId) => {
    const stream = get().chatStreams.get(turnId);
    if (!stream) return;

    // Skip if no content was streamed
    if (!stream.streamingContent) {
      set((state) => {
        const newStreams = new Map(state.chatStreams);
        newStreams.delete(turnId);
        return { chatStreams: newStreams };
      });
      return;
    }

    // Deduplicate legacy citations by URL
    const uniqueCitations = deduplicateCitations(stream.streamingCitations);

    // Inline citations are kept as-is (position matters)
    const inlineCitations = stream.streamingInlineCitations;

    // Calculate thinking duration if we had thinking content
    const thinkingDurationMs = stream.streamingThinking && stream.thinkingStartTime
      ? Date.now() - stream.thinkingStartTime
      : undefined;

    // Calculate execution duration if we had execution
    const executionDurationMs = stream.streamingExecutionCode && stream.executionStartTime
      ? Date.now() - stream.executionStartTime
      : undefined;

    // Create the final assistant message
    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: stream.streamingContent,
      timestamp: new Date(),
      citations: uniqueCitations.length > 0 ? uniqueCitations : undefined,
      inlineCitations: inlineCitations.length > 0 ? inlineCitations : undefined,
      turnId: stream.turnId,
      thinkingContent: stream.streamingThinking || undefined,
      thinkingDurationMs,
      // Execution fields
      executionCode: stream.streamingExecutionCode || undefined,
      executionOutput: stream.streamingExecutionOutput || undefined,
      executionStatus: stream.executionStatus !== 'idle'
        ? (stream.executionStatus === 'failed' ? 'error' : 'success')
        : undefined,
      executionError: stream.executionError || undefined,
      executionDurationMs,
      executionTextPosition: stream.executionTextPosition ?? undefined,
      generatedFiles: stream.streamingGeneratedFiles.length > 0
        ? stream.streamingGeneratedFiles
        : undefined,
    };

    const activeSessionId = useSessionStore.getState().activeSessionId;
    const isActiveSession = activeSessionId === stream.sessionId;

    if (isActiveSession) {
      // User is still viewing this session - update the live UI
      const chatStore = useChatStore.getState();
      // Add the message directly (streaming state is already being shown)
      set((state) => {
        const newStreams = new Map(state.chatStreams);
        newStreams.delete(turnId);
        return { chatStreams: newStreams };
      });

      // Use finalizeStreaming which handles the UI transition
      chatStore.finalizeStreaming();

      // Save session immediately so it's persisted before discovery completes
      // This ensures if user switches away and back during discovery, they see the response
      useSessionStore.getState().saveCurrentSession();
    } else {
      // User switched away - save directly to the session
      try {
        const session = await invoke<ChatSession | null>('load_chat_session', {
          sessionId: stream.sessionId,
        });

        if (session) {
          const settingsStore = useSettingsStore.getState();
          const updatedSession: ChatSession = {
            ...session,
            messages: [...session.messages, assistantMessage],
            updatedAt: new Date().toISOString(),
            settings: buildSessionSettings(settingsStore),
          };

          await invoke('save_chat_session', { session: updatedSession });

          // Refresh the session list to show updated message count
          useSessionStore.getState().loadSessionList();
        }
      } catch (error) {
        logError('backgroundStreamStore.completeChatStream', error);
      }

      // Remove the stream
      set((state) => {
        const newStreams = new Map(state.chatStreams);
        newStreams.delete(turnId);
        return { chatStreams: newStreams };
      });
    }
  },

  cancelChatStream: (turnId) => {
    set((state) => {
      const newStreams = new Map(state.chatStreams);
      newStreams.delete(turnId);
      return { chatStreams: newStreams };
    });
  },

  startDiscoveryStream: (sessionId, turnId) => {
    set((state) => {
      const newStreams = new Map(state.discoveryStreams);
      newStreams.set(turnId, {
        sessionId,
        turnId,
        items: [],
        startedAt: new Date(),
      });
      return { discoveryStreams: newStreams };
    });
  },

  addDiscoveryItem: (turnId, item) => {
    set((state) => {
      const stream = state.discoveryStreams.get(turnId);
      if (!stream) return state;

      const newStreams = new Map(state.discoveryStreams);
      newStreams.set(turnId, {
        ...stream,
        items: [...stream.items, item],
      });
      return { discoveryStreams: newStreams };
    });
  },

  completeDiscoveryStream: async (turnId) => {
    const stream = get().discoveryStreams.get(turnId);
    if (!stream) return;

    const activeSessionId = useSessionStore.getState().activeSessionId;
    const isActiveSession = activeSessionId === stream.sessionId;

    if (!isActiveSession && stream.items.length > 0) {
      // User switched away - save discovery items directly to the session
      try {
        const session = await invoke<ChatSession | null>('load_chat_session', {
          sessionId: stream.sessionId,
        });

        if (session) {
          const settingsStore = useSettingsStore.getState();
          // Keep last 20 items total
          const existingItems = session.discoveryItems || [];
          const allItems = [...existingItems, ...stream.items].slice(-20);

          const updatedSession: ChatSession = {
            ...session,
            discoveryItems: allItems,
            updatedAt: new Date().toISOString(),
            settings: buildSessionSettings(settingsStore),
          };

          await invoke('save_chat_session', { session: updatedSession });
          useSessionStore.getState().loadSessionList();
        }
      } catch (error) {
        logError('backgroundStreamStore.completeDiscoveryStream', error);
      }
    }

    // Remove the stream
    set((state) => {
      const newStreams = new Map(state.discoveryStreams);
      newStreams.delete(turnId);
      return { discoveryStreams: newStreams };
    });
  },

  getStreamByTurnId: (turnId) => {
    return get().chatStreams.get(turnId);
  },

  getStreamForSession: (sessionId) => {
    const streams = get().chatStreams;
    for (const stream of streams.values()) {
      if (stream.sessionId === sessionId) {
        return stream;
      }
    }
    return undefined;
  },

  getDiscoveryStreamsForSession: (sessionId) => {
    const streams = get().discoveryStreams;
    const result: BackgroundDiscoveryStream[] = [];
    for (const stream of streams.values()) {
      if (stream.sessionId === sessionId) {
        result.push(stream);
      }
    }
    return result;
  },

  hasActiveStream: (sessionId) => {
    const { chatStreams, discoveryStreams } = get();

    for (const stream of chatStreams.values()) {
      if (stream.sessionId === sessionId) return true;
    }
    for (const stream of discoveryStreams.values()) {
      if (stream.sessionId === sessionId) return true;
    }

    return false;
  },

  getActiveSessionIds: () => {
    const sessionIds = new Set<string>();
    const { chatStreams, discoveryStreams } = get();

    for (const stream of chatStreams.values()) {
      sessionIds.add(stream.sessionId);
    }
    for (const stream of discoveryStreams.values()) {
      sessionIds.add(stream.sessionId);
    }

    return Array.from(sessionIds);
  },
}));
