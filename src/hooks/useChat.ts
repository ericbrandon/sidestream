import { useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useChatStore } from '../stores/chatStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useBackgroundStreamStore } from '../stores/backgroundStreamStore';
import { useDiscovery } from './useDiscovery';
import { getProviderFromModelId } from '../lib/models';
import type { Message, ContentBlock, StreamDelta } from '../lib/types';

const SYSTEM_PROMPT = `You are a helpful, knowledgeable assistant. Provide thorough, well-organized responses with clear explanations. Use markdown formatting including bullet points, **bold**, and *italics* where appropriate to improve readability and emphasize key points. When discussing multiple options or topics, use clear paragraph breaks and structure to make your responses easy to scan and understand.`;

export function useChat() {
  const {
    messages,
    attachments,
    addMessage,
    updateStreamingContent,
    addStreamingCitations,
    addStreamingInlineCitations,
    clearInput,
    clearAttachments,
    setStreaming,
    streamingContent,
    isStreaming,
    setPendingTurnId,
    clearStreamingContent,
  } = useChatStore();

  const { frontierLLM } = useSettingsStore();
  const { triggerDiscovery } = useDiscovery();

  // Track turnId for passing to discovery after stream completes
  const pendingTurnIdRef = useRef<string | null>(null);

  // Set up streaming listeners
  useEffect(() => {
    const setupListeners = async () => {
      const unlistenDelta = await listen<StreamDelta>('chat-stream-delta', (event) => {
        const delta = event.payload;
        const turnId = pendingTurnIdRef.current;
        const backgroundStore = useBackgroundStreamStore.getState();
        const stream = turnId ? backgroundStore.getStreamByTurnId(turnId) : null;

        if (!stream) {
          // No background stream found - this can happen briefly at startup
          // Fall back to updating current UI directly
          if (delta.text) {
            const currentContent = useChatStore.getState().streamingContent;
            updateStreamingContent(currentContent + delta.text);
          }
          if (delta.citations && delta.citations.length > 0) {
            addStreamingCitations(delta.citations);
          }
          if (delta.inline_citations && delta.inline_citations.length > 0) {
            addStreamingInlineCitations(delta.inline_citations);
          }
          return;
        }

        // Always update background store (source of truth)
        if (delta.text) {
          backgroundStore.appendChatDelta(turnId!, delta.text);
        }
        if (delta.citations && delta.citations.length > 0) {
          backgroundStore.addChatCitations(turnId!, delta.citations);
        }
        if (delta.inline_citations && delta.inline_citations.length > 0) {
          backgroundStore.addChatInlineCitations(turnId!, delta.inline_citations);
        }

        // Only update live UI if user is still viewing this session
        const activeSessionId = useSessionStore.getState().activeSessionId;
        if (stream.sessionId === activeSessionId) {
          if (delta.text) {
            const currentContent = useChatStore.getState().streamingContent;
            updateStreamingContent(currentContent + delta.text);
          }
          if (delta.citations && delta.citations.length > 0) {
            addStreamingCitations(delta.citations);
          }
          if (delta.inline_citations && delta.inline_citations.length > 0) {
            addStreamingInlineCitations(delta.inline_citations);
          }
        }
      });

      const unlistenDone = await listen('chat-stream-done', () => {
        const turnId = pendingTurnIdRef.current;
        const backgroundStore = useBackgroundStreamStore.getState();

        if (turnId) {
          const stream = backgroundStore.getStreamByTurnId(turnId);

          // Complete the background stream (handles saving to correct session)
          backgroundStore.completeChatStream(turnId);

          // Trigger discovery with the turnId and original sessionId (skip if mode is 'none')
          const discoveryMode = useSettingsStore.getState().discoveryMode;
          if (discoveryMode !== 'none') {
            if (stream) {
              triggerDiscovery(turnId, stream.sessionId);
            } else {
              // Fallback to current session if no stream found
              triggerDiscovery(turnId);
            }
          }
        }

        pendingTurnIdRef.current = null;
      });

      const unlistenCancelled = await listen('chat-stream-cancelled', () => {
        const turnId = pendingTurnIdRef.current;
        const backgroundStore = useBackgroundStreamStore.getState();

        if (turnId) {
          const stream = backgroundStore.getStreamByTurnId(turnId);

          // Remove from background store
          backgroundStore.cancelChatStream(turnId);

          // Only update UI if still on this session
          if (stream) {
            const activeSessionId = useSessionStore.getState().activeSessionId;
            if (stream.sessionId === activeSessionId) {
              clearStreamingContent();
            }
          }
        }

        pendingTurnIdRef.current = null;
      });

      return () => {
        unlistenDelta();
        unlistenDone();
        unlistenCancelled();
      };
    };

    const cleanup = setupListeners();
    return () => {
      cleanup.then((fn) => fn());
    };
  }, [updateStreamingContent, addStreamingCitations, addStreamingInlineCitations, triggerDiscovery, clearStreamingContent]);

  const sendMessage = useCallback(
    async (content: string) => {
      // Generate turnId for this exchange
      const turnId = crypto.randomUUID();

      // Get current session ID for background tracking
      const sessionId = useSessionStore.getState().activeSessionId;
      if (!sessionId) {
        console.error('No active session for sending message');
        return;
      }

      // Register with background stream store BEFORE anything else
      useBackgroundStreamStore.getState().startChatStream(sessionId, turnId);

      // Store turnId for passing to discovery and for the assistant message
      pendingTurnIdRef.current = turnId;
      setPendingTurnId(turnId);

      // Build user message with turnId
      const userMessage: Omit<Message, 'id' | 'timestamp'> = {
        role: 'user',
        content,
        attachments: attachments.length > 0 ? [...attachments] : undefined,
        turnId,
      };

      addMessage(userMessage);
      clearInput();
      clearAttachments();
      setStreaming(true);

      // Save session immediately so it appears in sidebar (important for first message)
      // This ensures user can switch back to this session while streaming
      useSessionStore.getState().saveCurrentSession();

      try {
        // Convert messages to API format
        const allMessages = [...messages, { ...userMessage, id: '', timestamp: new Date() }];
        const apiMessages = allMessages.map((m) => ({
          role: m.role,
          content: formatMessageContent(m),
        }));

        // Determine provider-specific parameters
        const provider = getProviderFromModelId(frontierLLM.model);

        await invoke('send_chat_message', {
          model: frontierLLM.model,
          messages: apiMessages,
          systemPrompt: SYSTEM_PROMPT,
          // Anthropic parameters
          extendedThinkingEnabled: provider === 'anthropic' ? frontierLLM.extendedThinking.enabled : false,
          thinkingBudget: provider === 'anthropic' && frontierLLM.extendedThinking.enabled
            ? frontierLLM.extendedThinking.budgetTokens
            : null,
          webSearchEnabled: frontierLLM.webSearchEnabled,
          // OpenAI parameters
          reasoningLevel: provider === 'openai' ? frontierLLM.reasoningLevel : null,
          // Google Gemini parameters
          geminiThinkingLevel: provider === 'google' ? frontierLLM.geminiThinkingLevel : null,
          sessionId: useSessionStore.getState().activeSessionId,
        });
      } catch (error) {
        console.error('Chat error:', error);
        // Cancel the background stream on error
        useBackgroundStreamStore.getState().cancelChatStream(turnId);
        addMessage({
          role: 'assistant',
          content: `Error: ${error}. Please check your API key in settings.`,
          turnId, // Include turnId so error message aligns with user message in exports
        });
        setStreaming(false);
        // Clear pendingTurnId since we're not calling finalizeStreaming
        setPendingTurnId(null);
        pendingTurnIdRef.current = null;
      }
    },
    [
      messages,
      attachments,
      frontierLLM,
      addMessage,
      clearInput,
      clearAttachments,
      setStreaming,
      setPendingTurnId,
    ]
  );

  const cancelStream = useCallback(async () => {
    await invoke('cancel_chat_stream');
  }, []);

  // Send a transcribed voice message (for chat_request mode)
  // This is just like sendMessage but called with transcription text
  const sendTranscribedMessage = useCallback(
    async (transcription: string) => {
      // Just delegate to sendMessage with the transcription
      await sendMessage(transcription);
    },
    [sendMessage]
  );

  return {
    sendMessage,
    sendTranscribedMessage,
    cancelStream,
    isStreaming,
    streamingContent,
  };
}

// Text-based MIME types that should be sent as text content
const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-python',
  'text/javascript',
  'application/javascript',
  'text/typescript',
  'application/typescript',
  'text/x-java',
  'text/x-c',
  'text/x-c++',
  'text/x-rust',
  'text/x-go',
  'text/html',
  'text/css',
  'application/json',
  'application/xml',
  'text/xml',
  'text/x-yaml',
  'application/x-yaml',
]);

function isTextMimeType(mimeType: string): boolean {
  return TEXT_MIME_TYPES.has(mimeType) ||
         mimeType.startsWith('text/') ||
         mimeType.endsWith('+json') ||
         mimeType.endsWith('+xml');
}

function formatMessageContent(message: Message): string | ContentBlock[] {
  if (!message.attachments?.length) {
    return message.content;
  }

  // Multipart message with attachments
  const parts: ContentBlock[] = [];

  // Add attachments first
  for (const attachment of message.attachments) {
    if (attachment.type === 'image') {
      // Images: send as base64 image blocks
      parts.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment.mimeType,
          data: attachment.data,
        },
      });
    } else if (attachment.mimeType === 'application/pdf') {
      // PDFs: send as document blocks (Claude API native PDF support)
      parts.push({
        type: 'document',
        filename: attachment.name, // OpenAI requires filename for PDFs
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: attachment.data,
        },
      });
    } else if (isTextMimeType(attachment.mimeType)) {
      // Text files: decode base64 and send as text content
      try {
        const textContent = atob(attachment.data);
        parts.push({
          type: 'text',
          text: `--- File: ${attachment.name} ---\n${textContent}\n--- End of ${attachment.name} ---`,
        });
      } catch {
        // If decoding fails, skip this attachment
        console.error(`Failed to decode text file: ${attachment.name}`);
      }
    }
  }

  // Add user's text content
  parts.push({
    type: 'text',
    text: message.content,
  });

  return parts;
}
