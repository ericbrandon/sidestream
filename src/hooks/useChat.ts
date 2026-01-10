import { useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useChatStore } from '../stores/chatStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useBackgroundStreamStore } from '../stores/backgroundStreamStore';
import { useDiscovery } from './useDiscovery';
import { buildProviderThinkingParams } from '../lib/llmParameters';
import { logError, getUserFriendlyErrorMessage } from '../lib/logger';
import type { Message, ContentBlock, StreamDelta, StreamEvent, ContainerIdEvent } from '../lib/types';

const SYSTEM_PROMPT = `You are a helpful, knowledgeable assistant. Provide thorough, well-organized responses with clear explanations. Use markdown formatting including bullet points, **bold**, and *italics* where appropriate to improve readability and emphasize key points. When discussing multiple options or topics, use clear paragraph breaks and structure to make your responses easy to scan and understand. Use LaTeX notation whenever appropriate: inline with $...$ and display blocks with $$...$$. This includes math equations, chemical formulas ($\\ce{H2O}$, $\\ce{2H2 + O2 -> 2H2O}$), physics notation, Greek letters, and other scientific or technical expressions.`;

export function useChat() {
  const {
    messages,
    attachments,
    addMessage,
    updateStreamingContent,
    addStreamingCitations,
    addStreamingInlineCitations,
    appendStreamingThinking,
    setExecutionStarted,
    appendExecutionOutput,
    setExecutionCompleted,
    setExecutionFailed,
    clearInput,
    clearAttachments,
    setStreaming,
    streamingContent,
    streamingThinking,
    isStreaming,
    setPendingTurnId,
    clearStreamingContent,
    setAnthropicContainerId,
  } = useChatStore();

  const { frontierLLM, customSystemPrompt } = useSettingsStore();
  const { triggerDiscovery } = useDiscovery();

  // Set up streaming listeners
  // Events now include turn_id in payload, so we use that for routing instead of a shared ref
  useEffect(() => {
    const setupListeners = async () => {
      const unlistenDelta = await listen<StreamDelta>('chat-stream-delta', (event) => {
        const delta = event.payload;
        const turnId = delta.turn_id;
        const backgroundStore = useBackgroundStreamStore.getState();
        const stream = backgroundStore.getStreamByTurnId(turnId);

        if (!stream) {
          // No background stream found - this can happen briefly at startup
          // or if events arrive for a stream that was already completed/cancelled
          // Fall back to updating current UI directly if this matches the active session's pending turn
          const pendingTurnId = useChatStore.getState().pendingTurnId;
          if (turnId === pendingTurnId) {
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
            if (delta.thinking) {
              appendStreamingThinking(delta.thinking);
            }
            // Handle execution deltas
            if (delta.execution) {
              const exec = delta.execution;
              if (exec.status === 'started' && exec.code) {
                setExecutionStarted(exec.code);
              }
              if (exec.stdout) {
                appendExecutionOutput(exec.stdout);
              }
              if (exec.stderr) {
                appendExecutionOutput(exec.stderr);
              }
              if (exec.status === 'completed') {
                setExecutionCompleted(exec.files ?? undefined);
              }
              if (typeof exec.status === 'object' && 'failed' in exec.status) {
                setExecutionFailed(exec.status.failed.error);
              }
            }
          }
          return;
        }

        // Always update background store (source of truth)
        if (delta.text) {
          backgroundStore.appendChatDelta(turnId, delta.text);
        }
        if (delta.citations && delta.citations.length > 0) {
          backgroundStore.addChatCitations(turnId, delta.citations);
        }
        if (delta.inline_citations && delta.inline_citations.length > 0) {
          backgroundStore.addChatInlineCitations(turnId, delta.inline_citations);
        }
        if (delta.thinking) {
          backgroundStore.appendChatThinking(turnId, delta.thinking);
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
          if (delta.thinking) {
            appendStreamingThinking(delta.thinking);
          }
          // Handle execution deltas
          if (delta.execution) {
            const exec = delta.execution;
            if (exec.status === 'started' && exec.code) {
              setExecutionStarted(exec.code);
            }
            if (exec.stdout) {
              appendExecutionOutput(exec.stdout);
            }
            if (exec.stderr) {
              appendExecutionOutput(exec.stderr);
            }
            if (exec.status === 'completed') {
              setExecutionCompleted(exec.files ?? undefined);
            }
            if (typeof exec.status === 'object' && 'failed' in exec.status) {
              setExecutionFailed(exec.status.failed.error);
            }
          }
        }
      });

      const unlistenDone = await listen<StreamEvent>('chat-stream-done', (event) => {
        const turnId = event.payload.turn_id;
        const backgroundStore = useBackgroundStreamStore.getState();
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

        // Clear pendingTurnId if this was the active session's stream
        const chatStore = useChatStore.getState();
        if (chatStore.pendingTurnId === turnId) {
          setPendingTurnId(null);
        }
      });

      const unlistenCancelled = await listen<StreamEvent>('chat-stream-cancelled', (event) => {
        const turnId = event.payload.turn_id;
        const backgroundStore = useBackgroundStreamStore.getState();
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

        // Clear pendingTurnId if this was the active session's stream
        const chatStore = useChatStore.getState();
        if (chatStore.pendingTurnId === turnId) {
          setPendingTurnId(null);
        }
      });

      // Listen for container ID updates (Claude code execution)
      const unlistenContainerId = await listen<ContainerIdEvent>('chat-container-id', (event) => {
        const { container_id } = event.payload;
        // Store the container ID for subsequent API calls in this session
        setAnthropicContainerId(container_id);
      });

      return () => {
        unlistenDelta();
        unlistenDone();
        unlistenCancelled();
        unlistenContainerId();
      };
    };

    const cleanup = setupListeners();
    return () => {
      cleanup.then((fn) => fn());
    };
  }, [updateStreamingContent, addStreamingCitations, addStreamingInlineCitations, appendStreamingThinking, setExecutionStarted, appendExecutionOutput, setExecutionCompleted, setExecutionFailed, triggerDiscovery, clearStreamingContent, setPendingTurnId, setAnthropicContainerId]);

  const sendMessage = useCallback(
    async (content: string) => {
      // Generate turnId for this exchange
      const turnId = crypto.randomUUID();

      // Get current session ID for background tracking
      const sessionId = useSessionStore.getState().activeSessionId;
      if (!sessionId) {
        logError('useChat.sendMessage', 'No active session for sending message');
        return;
      }

      // Register with background stream store BEFORE anything else
      useBackgroundStreamStore.getState().startChatStream(sessionId, turnId);

      // Store turnId for the assistant message (used by UI to show streaming state)
      setPendingTurnId(turnId);

      // Check attachments for unsupported files before building the message
      const unsupportedFiles: string[] = [];
      const supportedAttachments = attachments.filter((attachment) => {
        if (attachment.type === 'image') return true;
        if (attachment.mimeType === 'application/pdf') return true;
        // Try to decode as text
        try {
          const textContent = atob(attachment.data);
          if (!textContent.includes('\0')) return true;
        } catch {
          // Decoding failed
        }
        // Binary file - not supported
        unsupportedFiles.push(attachment.name);
        return false;
      });

      // Build user message with only supported attachments
      const userMessage: Omit<Message, 'id' | 'timestamp'> = {
        role: 'user',
        content,
        attachments: supportedAttachments.length > 0 ? [...supportedAttachments] : undefined,
        turnId,
      };

      addMessage(userMessage);
      clearInput();
      clearAttachments();
      setStreaming(true);

      // Save session immediately so it appears in sidebar (important for first message)
      // This ensures user can switch back to this session while streaming
      useSessionStore.getState().saveCurrentSession();

      // If there were unsupported files, show error and don't call API
      if (unsupportedFiles.length > 0) {
        useBackgroundStreamStore.getState().cancelChatStream(turnId);
        const fileList = unsupportedFiles.join(', ');
        addMessage({
          role: 'assistant',
          content: `I can't process the following file${unsupportedFiles.length > 1 ? 's' : ''}: **${fileList}**\n\nOnly images, PDFs, and text-based files (code, config files, etc.) are supported. Binary files like executables, archives, or proprietary formats cannot be read.`,
          turnId,
        });
        setStreaming(false);
        setPendingTurnId(null);
        return;
      }

      try {
        // Convert all messages to API format
        const allMessages = [...messages, { ...userMessage, id: '', timestamp: new Date() }];
        const apiMessages = allMessages.map((m) => ({
          role: m.role,
          content: formatMessageContent(m).content,
        }));

        // Build system prompt, appending user's custom instructions if present
        const systemPrompt = customSystemPrompt
          ? `${SYSTEM_PROMPT}\n\n${customSystemPrompt}`
          : SYSTEM_PROMPT;

        // Get current container ID for Claude code execution sandbox persistence
        const currentContainerId = useChatStore.getState().anthropicContainerId;

        await invoke('send_chat_message', {
          model: frontierLLM.model,
          messages: apiMessages,
          systemPrompt,
          webSearchEnabled: frontierLLM.webSearchEnabled,
          codeExecutionEnabled: true, // Enable code execution for file generation
          sessionId: useSessionStore.getState().activeSessionId,
          turnId, // Pass turnId to backend so events can be routed correctly
          anthropicContainerId: currentContainerId, // Pass container ID for sandbox persistence
          ...buildProviderThinkingParams(frontierLLM),
        });
      } catch (error) {
        logError('useChat.sendMessage', error);
        // Cancel the background stream on error
        useBackgroundStreamStore.getState().cancelChatStream(turnId);
        addMessage({
          role: 'assistant',
          content: getUserFriendlyErrorMessage(error),
          turnId, // Include turnId so error message aligns with user message in exports
        });
        setStreaming(false);
        // Clear pendingTurnId since we're not calling finalizeStreaming
        setPendingTurnId(null);
      }
    },
    [
      messages,
      attachments,
      frontierLLM,
      customSystemPrompt,
      addMessage,
      clearInput,
      clearAttachments,
      setStreaming,
      setPendingTurnId,
    ]
  );

  const cancelStream = useCallback(async () => {
    try {
      await invoke('cancel_chat_stream');
    } catch (error) {
      logError('useChat.cancelStream', error);
    }
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
    streamingThinking,
  };
}

interface FormatResult {
  content: string | ContentBlock[];
  unsupportedFiles: string[]; // Names of files that couldn't be processed
}

function formatMessageContent(message: Message): FormatResult {
  // For assistant messages with execution data, append it to the content
  // so the LLM can see what code was run in previous turns
  if (message.role === 'assistant' && message.executionCode) {
    let formattedContent = message.content;

    // Append executed code
    formattedContent += `\n\n<executed_code>\n${message.executionCode}\n</executed_code>`;

    // Append output if present
    if (message.executionOutput) {
      formattedContent += `\n\n<execution_output>\n${message.executionOutput}\n</execution_output>`;
    }

    // Append error if present
    if (message.executionError) {
      formattedContent += `\n\n<execution_error>\n${message.executionError}\n</execution_error>`;
    }

    // Note: generatedFiles intentionally NOT included - those are download references
    return { content: formattedContent, unsupportedFiles: [] };
  }

  if (!message.attachments?.length) {
    return { content: message.content, unsupportedFiles: [] };
  }

  // Multipart message with attachments
  const parts: ContentBlock[] = [];
  const unsupportedFiles: string[] = [];

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
    } else {
      // All other files: try to decode as text
      try {
        const textContent = atob(attachment.data);
        // Check if it's valid UTF-8 text (no null bytes = text file)
        if (!textContent.includes('\0')) {
          parts.push({
            type: 'text',
            text: `--- File: ${attachment.name} ---\n${textContent}\n--- End of ${attachment.name} ---`,
          });
        } else {
          // Binary file - not supported
          unsupportedFiles.push(attachment.name);
        }
      } catch {
        // Decoding failed - binary file, not supported
        unsupportedFiles.push(attachment.name);
      }
    }
  }

  // Add user's text content
  parts.push({
    type: 'text',
    text: message.content,
  });

  return { content: parts, unsupportedFiles };
}
