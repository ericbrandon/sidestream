import { listen } from '@tauri-apps/api/event';
import { useChatStore } from '../stores/chatStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useBackgroundStreamStore } from '../stores/backgroundStreamStore';
import { triggerDiscovery } from './discovery';
import type { StreamDelta, StreamEvent, ContainerIdEvent } from './types';

/**
 * Sets up Tauri event listeners for chat streaming.
 * Should be called once at app startup (in App.tsx).
 * Returns a cleanup function to remove listeners.
 */
export function setupChatStreamListeners(): () => void {
  let cleanupFns: (() => void)[] = [];

  const setup = async () => {
    const unlistenDelta = await listen<StreamDelta>('chat-stream-delta', (event) => {
      const delta = event.payload;
      const turnId = delta.turn_id;
      const backgroundStore = useBackgroundStreamStore.getState();
      const chatStore = useChatStore.getState();
      const stream = backgroundStore.getStreamByTurnId(turnId);

      if (!stream) {
        // No background stream found - fall back to updating current UI directly
        const pendingTurnId = chatStore.pendingTurnId;
        if (turnId === pendingTurnId) {
          if (delta.text) {
            const currentContent = chatStore.streamingContent;
            chatStore.updateStreamingContent(currentContent + delta.text);
          }
          if (delta.citations && delta.citations.length > 0) {
            chatStore.addStreamingCitations(delta.citations);
          }
          if (delta.inline_citations && delta.inline_citations.length > 0) {
            chatStore.addStreamingInlineCitations(delta.inline_citations);
          }
          if (delta.thinking) {
            chatStore.appendStreamingThinking(delta.thinking);
          }
          // Handle execution deltas
          if (delta.execution) {
            const exec = delta.execution;
            if (exec.status === 'started' && exec.code) {
              chatStore.setExecutionStarted(exec.code);
            }
            if (exec.stdout) {
              chatStore.appendExecutionOutput(exec.stdout);
            }
            if (exec.stderr) {
              chatStore.appendExecutionOutput(exec.stderr);
            }
            if (exec.status === 'completed') {
              chatStore.setExecutionCompleted(exec.files ?? undefined);
            }
            if (typeof exec.status === 'object' && 'failed' in exec.status) {
              chatStore.setExecutionFailed(exec.status.failed.error);
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
          const currentContent = chatStore.streamingContent;
          chatStore.updateStreamingContent(currentContent + delta.text);
        }
        if (delta.citations && delta.citations.length > 0) {
          chatStore.addStreamingCitations(delta.citations);
        }
        if (delta.inline_citations && delta.inline_citations.length > 0) {
          chatStore.addStreamingInlineCitations(delta.inline_citations);
        }
        if (delta.thinking) {
          chatStore.appendStreamingThinking(delta.thinking);
        }
        // Handle execution deltas
        if (delta.execution) {
          const exec = delta.execution;
          if (exec.status === 'started' && exec.code) {
            chatStore.setExecutionStarted(exec.code);
          }
          if (exec.stdout) {
            chatStore.appendExecutionOutput(exec.stdout);
          }
          if (exec.stderr) {
            chatStore.appendExecutionOutput(exec.stderr);
          }
          if (exec.status === 'completed') {
            chatStore.setExecutionCompleted(exec.files ?? undefined);
          }
          if (typeof exec.status === 'object' && 'failed' in exec.status) {
            chatStore.setExecutionFailed(exec.status.failed.error);
          }
        }
      }
    });

    const unlistenDone = await listen<StreamEvent>('chat-stream-done', (event) => {
      const turnId = event.payload.turn_id;
      const backgroundStore = useBackgroundStreamStore.getState();
      const chatStore = useChatStore.getState();
      const stream = backgroundStore.getStreamByTurnId(turnId);

      if (stream) {
        // Complete the background stream (handles saving to correct session)
        backgroundStore.completeChatStream(turnId);
      } else {
        // No background stream - this means we used the fallback path in delta handler
        // Finalize streaming directly on the chat store
        chatStore.finalizeStreaming();
      }

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
        chatStore.setPendingTurnId(null);
      }
    });

    const unlistenCancelled = await listen<StreamEvent>('chat-stream-cancelled', (event) => {
      const turnId = event.payload.turn_id;
      const backgroundStore = useBackgroundStreamStore.getState();
      const chatStore = useChatStore.getState();
      const stream = backgroundStore.getStreamByTurnId(turnId);

      // Remove from background store
      backgroundStore.cancelChatStream(turnId);

      // Clear streaming UI state
      if (stream) {
        const activeSessionId = useSessionStore.getState().activeSessionId;
        if (stream.sessionId === activeSessionId) {
          chatStore.clearStreamingContent();
          chatStore.setStreaming(false);
        }
      } else {
        // No background stream - clear directly
        chatStore.clearStreamingContent();
        chatStore.setStreaming(false);
      }

      // Clear pendingTurnId if this was the active session's stream
      if (chatStore.pendingTurnId === turnId) {
        chatStore.setPendingTurnId(null);
      }
    });

    // Listen for container ID updates (Claude code execution)
    const unlistenContainerId = await listen<ContainerIdEvent>('chat-container-id', (event) => {
      const { container_id } = event.payload;
      // Store the container ID for subsequent API calls in this session
      useChatStore.getState().setAnthropicContainerId(container_id);
    });

    cleanupFns = [unlistenDelta, unlistenDone, unlistenCancelled, unlistenContainerId];
  };

  setup();

  return () => {
    cleanupFns.forEach((fn) => fn());
  };
}
