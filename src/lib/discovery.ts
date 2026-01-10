import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useChatStore } from '../stores/chatStore';
import { useDiscoveryStore } from '../stores/discoveryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useBackgroundStreamStore } from '../stores/backgroundStreamStore';
import { getDiscoveryMode } from './discoveryModes';
import { buildProviderThinkingParams } from './llmParameters';
import { logError } from './logger';
import type { DiscoveryItem, Message } from './types';

// Event payload types matching Rust structs
interface DiscoveryItemEvent {
  turnId: string;
  item: Omit<DiscoveryItem, 'id' | 'timestamp' | 'isExpanded' | 'turnId'>;
}

interface DiscoveryDoneEvent {
  turnId: string;
}

interface DiscoveryErrorEvent {
  turnId: string;
  error: string;
}

const MAX_DISCOVERIES_PER_SEARCH = 5;

// Track active listeners for cleanup
const activeListeners = new Map<string, UnlistenFn[]>();

// Track whether items were received for each turn
const turnItemsReceived = new Map<string, boolean>();

function cleanupListeners(turnId: string) {
  const listeners = activeListeners.get(turnId);
  if (listeners) {
    listeners.forEach((unlisten) => unlisten());
    activeListeners.delete(turnId);
  }
}

/**
 * Triggers discovery analysis for a chat turn.
 * This is a standalone function (not a hook) that can be called from anywhere.
 */
export async function triggerDiscovery(turnId: string, targetSessionId?: string): Promise<void> {
  // Use provided sessionId or fall back to current active session
  const sessionId = targetSessionId || useSessionStore.getState().activeSessionId;
  if (!sessionId) {
    console.warn('No active session for discovery');
    return;
  }

  const backgroundStore = useBackgroundStreamStore.getState();
  const discoveryStore = useDiscoveryStore.getState();
  const settingsStore = useSettingsStore.getState();
  const activeSessionId = useSessionStore.getState().activeSessionId;
  const isActiveSession = sessionId === activeSessionId;

  // Get messages - if we're on a different session, load from backend
  let messages: Message[];
  if (isActiveSession) {
    // Use current store messages (includes the just-finalized assistant message)
    messages = useChatStore.getState().messages;
  } else {
    // User switched away - load messages from the target session
    try {
      const session = await invoke<{ messages: Message[] } | null>('load_chat_session', {
        sessionId,
      });
      if (!session || session.messages.length === 0) {
        console.warn('No messages found for background discovery session');
        return;
      }
      messages = session.messages;
    } catch (error) {
      logError('discovery.triggerDiscovery', error);
      return;
    }
  }

  if (messages.length === 0) return;

  // Start tracking in background store
  backgroundStore.startDiscoveryStream(sessionId, turnId);

  // Initialize item tracking for this turn
  turnItemsReceived.set(turnId, false);

  // Only update live UI store if on the active session
  if (isActiveSession) {
    discoveryStore.startTurn(turnId, sessionId);
  }

  try {
    // Format conversation for analysis with clear message numbering
    const conversationText = messages
      .map((m, i) => `MESSAGE #${i + 1} (${m.role.toUpperCase()}):\n${m.content}`)
      .join('\n\n');

    // Get the current discovery mode (captured at search time)
    const discoveryMode = settingsStore.discoveryMode;
    const modeConfig = getDiscoveryMode(discoveryMode);

    // Set up event listeners BEFORE invoking
    const unlistenItem = await listen<DiscoveryItemEvent>(
      'discovery-item',
      (event) => {
        if (event.payload.turnId !== turnId) return;

        // Mark that we received at least one item for this turn
        turnItemsReceived.set(turnId, true);

        // Create the full discovery item with the mode that generated it
        const item: DiscoveryItem = {
          ...event.payload.item,
          id: crypto.randomUUID(),
          timestamp: new Date(),
          isExpanded: false,
          turnId,
          sessionId,
          modeId: discoveryMode,
        };

        // Always add to background store
        backgroundStore.addDiscoveryItem(turnId, item);

        // Only update live UI if still on the same session
        const currentSessionId = useSessionStore.getState().activeSessionId;
        if (currentSessionId === sessionId) {
          discoveryStore.addItem(turnId, sessionId, discoveryMode, event.payload.item);
        }
      }
    );

    const unlistenDone = await listen<DiscoveryDoneEvent>(
      'discovery-done',
      (event) => {
        if (event.payload.turnId === turnId) {
          // Complete background stream (handles saving if user switched away)
          backgroundStore.completeDiscoveryStream(turnId);

          // Update live UI if still on same session
          const currentSessionId = useSessionStore.getState().activeSessionId;
          if (currentSessionId === sessionId) {
            // Check if no items were received for this turn
            const receivedItems = turnItemsReceived.get(turnId) ?? false;
            if (!receivedItems) {
              discoveryStore.markTurnEmpty(turnId);
            }

            discoveryStore.completeTurn(turnId);
            useSessionStore.getState().saveCurrentSession();
          }

          // Cleanup tracking
          turnItemsReceived.delete(turnId);
          cleanupListeners(turnId);
        }
      }
    );

    const unlistenError = await listen<DiscoveryErrorEvent>(
      'discovery-error',
      (event) => {
        if (event.payload.turnId === turnId) {
          logError('discovery.discoveryError', event.payload.error);

          // Complete background stream even on error
          backgroundStore.completeDiscoveryStream(turnId);

          // Update live UI if still on same session
          const currentSessionId = useSessionStore.getState().activeSessionId;
          if (currentSessionId === sessionId) {
            discoveryStore.completeTurn(turnId);
          }

          // Cleanup tracking
          turnItemsReceived.delete(turnId);
          cleanupListeners(turnId);
        }
      }
    );

    // Store listeners for cleanup
    activeListeners.set(turnId, [
      unlistenItem,
      unlistenDone,
      unlistenError,
    ]);

    // Call the discovery endpoint - returns when streaming starts, not when done
    await invoke('discover_resources', {
      turnId,
      model: settingsStore.evaluatorLLM.model,
      conversation: conversationText,
      systemPrompt: modeConfig.systemPrompt,
      maxResults: MAX_DISCOVERIES_PER_SEARCH,
      ...buildProviderThinkingParams(settingsStore.evaluatorLLM),
    });
  } catch (error) {
    logError('discovery.invoke', error);
    backgroundStore.completeDiscoveryStream(turnId);

    const currentSessionId = useSessionStore.getState().activeSessionId;
    if (currentSessionId === sessionId) {
      discoveryStore.completeTurn(turnId);
    }

    // Cleanup tracking
    turnItemsReceived.delete(turnId);
    cleanupListeners(turnId);
  }
}
