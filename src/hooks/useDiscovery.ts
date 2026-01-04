import { useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useChatStore } from '../stores/chatStore';
import { useDiscoveryStore } from '../stores/discoveryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useBackgroundStreamStore } from '../stores/backgroundStreamStore';
import { getDiscoveryMode } from '../lib/discoveryModes';
import { getProviderFromModelId } from '../lib/models';
import type { DiscoveryItem, Message } from '../lib/types';

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

export function useDiscovery() {
  const { startTurn, addItem, completeTurn, markTurnEmpty } = useDiscoveryStore();
  const { evaluatorLLM } = useSettingsStore();

  // Track active listeners for cleanup
  const activeListenersRef = useRef<Map<string, UnlistenFn[]>>(new Map());

  // Track whether items were received for each turn
  const turnItemsReceivedRef = useRef<Map<string, boolean>>(new Map());

  const cleanupListeners = useCallback((turnId: string) => {
    const listeners = activeListenersRef.current.get(turnId);
    if (listeners) {
      listeners.forEach((unlisten) => unlisten());
      activeListenersRef.current.delete(turnId);
    }
  }, []);

  const triggerDiscovery = useCallback(async (turnId: string, targetSessionId?: string) => {
    // Use provided sessionId or fall back to current active session
    const sessionId = targetSessionId || useSessionStore.getState().activeSessionId;
    if (!sessionId) {
      console.warn('No active session for discovery');
      return;
    }

    const backgroundStore = useBackgroundStreamStore.getState();
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
        console.error('Failed to load session for discovery:', error);
        return;
      }
    }

    if (messages.length === 0) return;

    // Start tracking in background store
    backgroundStore.startDiscoveryStream(sessionId, turnId);

    // Initialize item tracking for this turn
    turnItemsReceivedRef.current.set(turnId, false);

    // Only update live UI store if on the active session
    if (isActiveSession) {
      startTurn(turnId, sessionId);
    }

    try {
      // Format conversation for analysis with clear message numbering
      const conversationText = messages
        .map((m, i) => `MESSAGE #${i + 1} (${m.role.toUpperCase()}):\n${m.content}`)
        .join('\n\n');

      // Get the current discovery mode (captured at search time)
      const discoveryMode = useSettingsStore.getState().discoveryMode;
      const modeConfig = getDiscoveryMode(discoveryMode);

      // Set up event listeners BEFORE invoking
      const unlistenItem = await listen<DiscoveryItemEvent>(
        'discovery-item',
        (event) => {
          if (event.payload.turnId !== turnId) return;

          // Mark that we received at least one item for this turn
          turnItemsReceivedRef.current.set(turnId, true);

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
            addItem(turnId, sessionId, discoveryMode, event.payload.item);
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
              const receivedItems = turnItemsReceivedRef.current.get(turnId) ?? false;
              if (!receivedItems) {
                markTurnEmpty(turnId);
              }

              completeTurn(turnId);
              useSessionStore.getState().saveCurrentSession();
            }

            // Cleanup tracking
            turnItemsReceivedRef.current.delete(turnId);
            cleanupListeners(turnId);
          }
        }
      );

      const unlistenError = await listen<DiscoveryErrorEvent>(
        'discovery-error',
        (event) => {
          if (event.payload.turnId === turnId) {
            console.error('Discovery error:', event.payload.error);

            // Complete background stream even on error
            backgroundStore.completeDiscoveryStream(turnId);

            // Update live UI if still on same session
            const currentSessionId = useSessionStore.getState().activeSessionId;
            if (currentSessionId === sessionId) {
              completeTurn(turnId);
            }

            // Cleanup tracking
            turnItemsReceivedRef.current.delete(turnId);
            cleanupListeners(turnId);
          }
        }
      );

      // Store listeners for cleanup
      activeListenersRef.current.set(turnId, [
        unlistenItem,
        unlistenDone,
        unlistenError,
      ]);

      // Determine provider to pass appropriate thinking parameters
      const provider = getProviderFromModelId(evaluatorLLM.model);

      // Call the discovery endpoint - returns when streaming starts, not when done
      await invoke('discover_resources', {
        turnId,
        model: evaluatorLLM.model,
        conversation: conversationText,
        systemPrompt: modeConfig.systemPrompt,
        maxResults: MAX_DISCOVERIES_PER_SEARCH,
        // Provider-specific thinking parameters
        extendedThinkingEnabled: provider === 'anthropic' ? evaluatorLLM.extendedThinking.enabled : null,
        thinkingBudget: provider === 'anthropic' && evaluatorLLM.extendedThinking.enabled
          ? evaluatorLLM.extendedThinking.budgetTokens
          : null,
        reasoningLevel: provider === 'openai' ? evaluatorLLM.reasoningLevel : null,
        geminiThinkingLevel: provider === 'google' ? evaluatorLLM.geminiThinkingLevel : null,
      });
    } catch (error) {
      console.error('Discovery invoke error:', error);
      backgroundStore.completeDiscoveryStream(turnId);

      const currentSessionId = useSessionStore.getState().activeSessionId;
      if (currentSessionId === sessionId) {
        completeTurn(turnId);
      }

      // Cleanup tracking
      turnItemsReceivedRef.current.delete(turnId);
      cleanupListeners(turnId);
    }
  }, [
    evaluatorLLM.model,
    startTurn,
    addItem,
    completeTurn,
    markTurnEmpty,
    cleanupListeners,
  ]);

  return { triggerDiscovery };
}
