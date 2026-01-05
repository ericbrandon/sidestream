import { create } from 'zustand';
import type { Message, Attachment, Citation, InlineCitation } from '../lib/types';
import { deduplicateCitations } from '../lib/citationHelpers';
import { useSessionStore } from './sessionStore';

interface ChatState {
  messages: Message[];
  inputValue: string;
  attachments: Attachment[];
  isStreaming: boolean;
  streamingContent: string;
  streamingCitations: Citation[]; // Legacy - kept for backward compatibility
  streamingInlineCitations: InlineCitation[]; // New inline citations with positions
  streamingThinking: string; // Accumulated thinking/reasoning content
  thinkingStartTime: number | null; // When thinking started (for duration calculation)
  sessionLoadedAt: number | null; // Timestamp to trigger scroll to bottom on session load
  pendingTurnId: string | null; // Track the turnId for the current turn

  // Focus management
  _focusChatInput: (() => void) | null;

  // Actions
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void;
  updateStreamingContent: (content: string) => void;
  addStreamingCitations: (citations: Citation[]) => void;
  addStreamingInlineCitations: (citations: InlineCitation[]) => void;
  appendStreamingThinking: (content: string) => void;
  finalizeStreaming: () => void;
  setInput: (value: string) => void;
  appendToInput: (text: string) => void;
  clearInput: () => void;
  addAttachment: (attachment: Omit<Attachment, 'id'>) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setStreaming: (streaming: boolean) => void;
  clearChat: () => void;
  loadSession: (messages: Message[]) => void;
  loadSessionWithStreaming: (
    messages: Message[],
    streamingContent: string,
    streamingCitations: Citation[],
    streamingInlineCitations: InlineCitation[],
    pendingTurnId: string,
    streamingThinking?: string
  ) => void;
  setPendingTurnId: (turnId: string | null) => void;
  clearStreamingContent: () => void;
  registerChatInputFocus: (focusFn: () => void) => void;
  focusChatInput: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  inputValue: '',
  attachments: [],
  isStreaming: false,
  streamingContent: '',
  streamingCitations: [],
  streamingInlineCitations: [],
  streamingThinking: '',
  thinkingStartTime: null,
  sessionLoadedAt: null,
  pendingTurnId: null,
  _focusChatInput: null,

  addMessage: (message) => {
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...message,
          id: crypto.randomUUID(),
          timestamp: new Date(),
        },
      ],
    }));
    useSessionStore.getState().markDirty();
  },

  updateStreamingContent: (content) => set({ streamingContent: content }),

  addStreamingCitations: (citations) =>
    set((state) => ({
      streamingCitations: [...state.streamingCitations, ...citations],
    })),

  addStreamingInlineCitations: (citations) =>
    set((state) => ({
      streamingInlineCitations: [...state.streamingInlineCitations, ...citations],
    })),

  appendStreamingThinking: (content) =>
    set((state) => ({
      streamingThinking: state.streamingThinking + content,
      // Record start time on first thinking delta
      thinkingStartTime: state.thinkingStartTime ?? Date.now(),
    })),

  finalizeStreaming: () => {
    const state = useChatStore.getState();
    if (!state.streamingContent) return;

    // Dedupe legacy citations by URL
    const uniqueCitations = deduplicateCitations(state.streamingCitations);

    // Inline citations are kept as-is (position matters, so no deduplication)
    const inlineCitations = state.streamingInlineCitations;

    // Calculate thinking duration if we had thinking content
    const thinkingDurationMs = state.streamingThinking && state.thinkingStartTime
      ? Date.now() - state.thinkingStartTime
      : undefined;

    set({
      messages: [
        ...state.messages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: state.streamingContent,
          timestamp: new Date(),
          citations: uniqueCitations.length > 0 ? uniqueCitations : undefined,
          inlineCitations: inlineCitations.length > 0 ? inlineCitations : undefined,
          turnId: state.pendingTurnId ?? undefined,
          thinkingContent: state.streamingThinking || undefined,
          thinkingDurationMs,
        },
      ],
      streamingContent: '',
      streamingCitations: [],
      streamingInlineCitations: [],
      streamingThinking: '',
      thinkingStartTime: null,
      isStreaming: false,
    });
    useSessionStore.getState().markDirty();
  },

  setInput: (value) => set({ inputValue: value }),

  appendToInput: (text) =>
    set((state) => ({
      inputValue: state.inputValue ? `${state.inputValue}\n\n${text}` : text,
    })),

  clearInput: () => set({ inputValue: '' }),

  addAttachment: (attachment) =>
    set((state) => ({
      attachments: [
        ...state.attachments,
        {
          ...attachment,
          id: crypto.randomUUID(),
        },
      ],
    })),

  removeAttachment: (id) =>
    set((state) => ({
      attachments: state.attachments.filter((a) => a.id !== id),
    })),

  clearAttachments: () => set({ attachments: [] }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  clearChat: () =>
    set({
      messages: [],
      inputValue: '',
      attachments: [],
      streamingContent: '',
      streamingCitations: [],
      streamingInlineCitations: [],
      streamingThinking: '',
      thinkingStartTime: null,
      isStreaming: false,
      pendingTurnId: null,
    }),

  loadSession: (messages) =>
    set({
      messages,
      inputValue: '',
      attachments: [],
      streamingContent: '',
      streamingCitations: [],
      streamingInlineCitations: [],
      streamingThinking: '',
      thinkingStartTime: null,
      isStreaming: false,
      sessionLoadedAt: Date.now(),
      pendingTurnId: null,
    }),

  loadSessionWithStreaming: (messages, streamingContent, streamingCitations, streamingInlineCitations, pendingTurnId, streamingThinking = '') =>
    set({
      messages,
      inputValue: '',
      attachments: [],
      streamingContent,
      streamingCitations,
      streamingInlineCitations,
      streamingThinking,
      thinkingStartTime: streamingThinking ? Date.now() : null,
      isStreaming: true,
      sessionLoadedAt: Date.now(),
      pendingTurnId,
    }),

  setPendingTurnId: (turnId) => set({ pendingTurnId: turnId }),

  clearStreamingContent: () => {
    const state = useChatStore.getState();
    // Find and remove the last user message, restore its content to input
    const lastUserMessageIndex = [...state.messages]
      .reverse()
      .findIndex((m) => m.role === 'user');

    if (lastUserMessageIndex !== -1) {
      const actualIndex = state.messages.length - 1 - lastUserMessageIndex;
      const lastUserMessage = state.messages[actualIndex];
      set({
        messages: state.messages.slice(0, actualIndex),
        inputValue: lastUserMessage.content,
        attachments: lastUserMessage.attachments ?? [],
        streamingContent: '',
        streamingCitations: [],
        streamingInlineCitations: [],
        streamingThinking: '',
        thinkingStartTime: null,
        isStreaming: false,
        pendingTurnId: null,
      });
    } else {
      set({
        streamingContent: '',
        streamingCitations: [],
        streamingInlineCitations: [],
        streamingThinking: '',
        thinkingStartTime: null,
        isStreaming: false,
        pendingTurnId: null,
      });
    }
  },

  registerChatInputFocus: (focusFn) => set({ _focusChatInput: focusFn }),

  focusChatInput: () => {
    const focusFn = get()._focusChatInput;
    if (focusFn) focusFn();
  },
}));
