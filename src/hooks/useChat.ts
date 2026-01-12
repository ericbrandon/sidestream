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
import {
  initStreamingBuffer,
  appendToStreamingBuffer,
  clearStreamingBuffer,
  flushStreamingBuffer,
} from '../lib/streamingBuffer';
import type { Message, ContentBlock, StreamDelta, StreamEvent, ContainerIdEvent, ExecutionDelta, Citation, InlineCitation, GeneratedFile } from '../lib/types';

/**
 * Process execution delta and update UI state.
 * Extracted to avoid duplication between background stream and fallback paths.
 */
function processExecutionDelta(
  exec: ExecutionDelta,
  setExecutionStarted: (code: string) => void,
  appendExecutionOutput: (output: string) => void,
  setExecutionCompleted: (files?: GeneratedFile[]) => void,
  setExecutionFailed: (error: string) => void
) {
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

/**
 * Process a stream delta and update UI state.
 * Extracted to avoid duplication between background stream and fallback paths.
 */
function processStreamDelta(
  delta: StreamDelta,
  addStreamingCitations: (citations: Citation[]) => void,
  addStreamingInlineCitations: (citations: InlineCitation[]) => void,
  appendStreamingThinking: (thinking: string) => void,
  setExecutionStarted: (code: string) => void,
  appendExecutionOutput: (output: string) => void,
  setExecutionCompleted: (files?: GeneratedFile[]) => void,
  setExecutionFailed: (error: string) => void
) {
  if (delta.text) {
    appendToStreamingBuffer(delta.text);
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
  if (delta.execution) {
    processExecutionDelta(
      delta.execution,
      setExecutionStarted,
      appendExecutionOutput,
      setExecutionCompleted,
      setExecutionFailed
    );
  }
}

const SYSTEM_PROMPT = `You are a helpful, knowledgeable assistant. Provide thorough, well-organized responses with clear explanations. Use markdown formatting including bullet points, **bold**, and *italics* where appropriate to improve readability and emphasize key points. When discussing multiple options or topics, use clear paragraph breaks and structure to make your responses easy to scan and understand. Use LaTeX notation whenever appropriate: inline with $...$ and display blocks with $$...$$. This includes math equations, chemical formulas ($\\ce{H2O}$, $\\ce{2H2 + O2 -> 2H2O}$), physics notation, Greek letters, and other scientific or technical expressions.`;

/**
 * Build container context hint for LLM when there's an active container.
 * This helps the model know about previously created files without sending full execution history.
 * Uses provider-specific paths: /tmp/ for Anthropic, /mnt/data/ for OpenAI.
 */
function buildContainerContext(
  messages: Message[],
  anthropicContainerId: string | null,
  openaiContainerId: string | null
): string {
  const hasAnthropicContainer = !!anthropicContainerId;
  const hasOpenaiContainer = !!openaiContainerId;

  if (!hasAnthropicContainer && !hasOpenaiContainer) return '';

  // Collect all generated files from previous messages
  const generatedFiles: string[] = [];
  for (const msg of messages) {
    if (msg.generatedFiles) {
      for (const file of msg.generatedFiles) {
        generatedFiles.push(file.filename);
      }
    }
  }

  // Use provider-specific sandbox path
  const sandboxPath = hasOpenaiContainer ? '/mnt/data/' : '/tmp/';

  let context = `\n\n---\n[System note: You have a persistent sandbox container with files from earlier in this conversation. IMPORTANT: Before writing new code or creating files, first run \`ls -la ${sandboxPath}\` to check what files already exist.]`;

  if (generatedFiles.length > 0) {
    context += `\n[The user has downloaded these files you provided: ${generatedFiles.join(', ')}]`;
  }

  return context;
}

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
    setOpenaiContainerId,
  } = useChatStore();

  const { frontierLLM, customSystemPrompt } = useSettingsStore();
  const { triggerDiscovery } = useDiscovery();

  // Initialize streaming buffer with flush function
  useEffect(() => {
    initStreamingBuffer((content) => {
      updateStreamingContent(content);
    });
  }, [updateStreamingContent]);

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
            processStreamDelta(
              delta,
              addStreamingCitations,
              addStreamingInlineCitations,
              appendStreamingThinking,
              setExecutionStarted,
              appendExecutionOutput,
              setExecutionCompleted,
              setExecutionFailed
            );
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
        // Also store execution deltas to background store
        if (delta.execution) {
          const exec = delta.execution;
          if (exec.status === 'started' && exec.code) {
            backgroundStore.setExecutionStarted(turnId, exec.code);
          }
          if (exec.stdout) {
            backgroundStore.appendExecutionOutput(turnId, exec.stdout);
          }
          if (exec.stderr) {
            backgroundStore.appendExecutionOutput(turnId, exec.stderr);
          }
          if (exec.status === 'completed') {
            backgroundStore.setExecutionCompleted(turnId, exec.files ?? undefined);
          }
          if (typeof exec.status === 'object' && 'failed' in exec.status) {
            backgroundStore.setExecutionFailed(turnId, exec.status.failed.error);
          }
        }

        // Only update live UI if user is still viewing this session
        const activeSessionId = useSessionStore.getState().activeSessionId;
        if (stream.sessionId === activeSessionId) {
          processStreamDelta(
            delta,
            addStreamingCitations,
            addStreamingInlineCitations,
            appendStreamingThinking,
            setExecutionStarted,
            appendExecutionOutput,
            setExecutionCompleted,
            setExecutionFailed
          );
        }
      });

      const unlistenDone = await listen<StreamEvent>('chat-stream-done', (event) => {
        const turnId = event.payload.turn_id;
        const backgroundStore = useBackgroundStreamStore.getState();
        const chatStore = useChatStore.getState();
        const stream = backgroundStore.getStreamByTurnId(turnId);

        // Flush any remaining buffered content before finalizing
        flushStreamingBuffer();

        if (stream) {
          // Complete the background stream (handles saving to correct session)
          backgroundStore.completeChatStream(turnId);
        } else {
          // No background stream - this means we used the fallback path in delta handler
          // Finalize streaming directly on the chat store
          chatStore.finalizeStreaming();
        }

        // Clear the buffer for next stream
        clearStreamingBuffer();

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
        if (chatStore.pendingTurnId === turnId) {
          setPendingTurnId(null);
        }
      });

      const unlistenCancelled = await listen<StreamEvent>('chat-stream-cancelled', (event) => {
        const turnId = event.payload.turn_id;
        const backgroundStore = useBackgroundStreamStore.getState();
        const chatStore = useChatStore.getState();
        const stream = backgroundStore.getStreamByTurnId(turnId);

        // Clear the buffer
        clearStreamingBuffer();

        // Remove from background store
        backgroundStore.cancelChatStream(turnId);

        // Clear streaming UI state
        if (stream) {
          const activeSessionId = useSessionStore.getState().activeSessionId;
          if (stream.sessionId === activeSessionId) {
            clearStreamingContent();
            setStreaming(false);
          }
        } else {
          // No background stream - clear directly
          clearStreamingContent();
          setStreaming(false);
        }

        // Clear pendingTurnId if this was the active session's stream
        if (chatStore.pendingTurnId === turnId) {
          setPendingTurnId(null);
        }
      });

      // Listen for container ID updates (Claude code execution / OpenAI code interpreter)
      const unlistenContainerId = await listen<ContainerIdEvent>('chat-container-id', (event) => {
        const { container_id } = event.payload;
        // Route to correct provider based on current model
        const currentModel = useSettingsStore.getState().frontierLLM.model;
        const isOpenAI = currentModel.startsWith('gpt') || currentModel.startsWith('o3') || currentModel.startsWith('o4');
        if (isOpenAI) {
          setOpenaiContainerId(container_id);
        } else {
          setAnthropicContainerId(container_id);
        }
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
  }, [addStreamingCitations, addStreamingInlineCitations, appendStreamingThinking, setExecutionStarted, appendExecutionOutput, setExecutionCompleted, setExecutionFailed, triggerDiscovery, clearStreamingContent, setPendingTurnId, setAnthropicContainerId, setOpenaiContainerId]);

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
      // Pass the model now so it's captured for this stream (prevents cross-session model contamination)
      useBackgroundStreamStore.getState().startChatStream(sessionId, turnId, frontierLLM.model);

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

      // Calculate container context BEFORE adding message so we can store it for cache stability
      const anthropicContainerId = useChatStore.getState().anthropicContainerId;
      const openaiContainerId = useChatStore.getState().openaiContainerId;
      const containerContext = buildContainerContext(messages, anthropicContainerId, openaiContainerId);

      // Build user message with only supported attachments
      const userMessage: Omit<Message, 'id' | 'timestamp'> = {
        role: 'user',
        content,
        attachments: supportedAttachments.length > 0 ? [...supportedAttachments] : undefined,
        turnId,
        // Store container hint with the message for cache stability on future turns
        containerHint: containerContext || undefined,
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
        // For previous messages, use their stored containerHint for cache stability
        // For the current message, use the freshly computed containerContext
        const allMessages = [...messages, { ...userMessage, id: '', timestamp: new Date() }];

        // Check if using Gemini (needs execution context appended since no container persistence)
        const isGemini = frontierLLM.model.startsWith('gemini');

        const apiMessages = allMessages.map((m, index) => {
          const formattedContent = formatMessageContent(m).content;
          const isLastMessage = index === allMessages.length - 1;

          // Determine which container hint to use:
          // - For previous user messages: use the stored containerHint (for cache stability)
          // - For current message: use freshly computed containerContext
          const hintToUse = isLastMessage ? containerContext : m.containerHint;

          if (m.role === 'user' && hintToUse) {
            // Append container hint to user message content
            if (typeof formattedContent === 'string') {
              return { role: m.role, content: formattedContent + hintToUse };
            }
            // If content is an array of blocks, append to the last text block
            if (Array.isArray(formattedContent)) {
              const blocks = [...formattedContent] as ContentBlock[];
              // Find the last text block
              let lastTextIndex = -1;
              for (let i = blocks.length - 1; i >= 0; i--) {
                if (blocks[i].type === 'text') {
                  lastTextIndex = i;
                  break;
                }
              }
              if (lastTextIndex >= 0) {
                const textBlock = blocks[lastTextIndex] as { type: 'text'; text: string };
                blocks[lastTextIndex] = {
                  ...textBlock,
                  text: textBlock.text + hintToUse,
                };
              }
              return { role: m.role, content: blocks };
            }
          }

          // For Gemini: append execution context to assistant messages
          // This provides code execution history since Gemini has no container persistence
          if (isGemini && m.role === 'assistant' && m.executionCode) {
            let executionContext = '\n\n---\n[Code execution context for this turn:]\n';
            executionContext += '```python\n' + m.executionCode + '\n```\n';
            if (m.executionOutput) {
              executionContext += '\nOutput:\n```\n' + m.executionOutput + '\n```';
            }
            if (typeof formattedContent === 'string') {
              return { role: m.role, content: formattedContent + executionContext };
            }
          }

          return { role: m.role, content: formattedContent };
        });

        // Build system prompt, appending user's custom instructions if present
        const systemPrompt = customSystemPrompt
          ? `${SYSTEM_PROMPT}\n\n${customSystemPrompt}`
          : SYSTEM_PROMPT;

        await invoke('send_chat_message', {
          model: frontierLLM.model,
          messages: apiMessages,
          systemPrompt,
          webSearchEnabled: frontierLLM.webSearchEnabled,
          codeExecutionEnabled: true, // Enable code execution for file generation
          sessionId: useSessionStore.getState().activeSessionId,
          turnId, // Pass turnId to backend so events can be routed correctly
          anthropicContainerId: useChatStore.getState().anthropicContainerId, // Persist container across turns (Claude)
          openaiContainerId: useChatStore.getState().openaiContainerId, // Persist container across turns (OpenAI)
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
