import { create } from 'zustand';
import type { DiscoveryItem, ModelSwitch } from '../lib/types';
import type { DiscoveryModeId } from '../lib/discoveryModes';
import { useSessionStore } from './sessionStore';

// Messages shown when discovery finds nothing to add
const EMPTY_TURN_MESSAGES = [
  "I've got nothing to add. Carry on.",
  "Nothing from me this time. Carry on!",
  "I've got nothing. You're doing great.",
  "All quiet on my end.",
  "Nothing to add — you've got this.",
  "I'll sit this one out.",
  "Sometimes silence is the contribution.",
  "Not every moment needs more words.",
  "I looked. I pondered. I've got nothin'.",
  "*crickets*",
  "Plot twist: no discoveries.",
  "Tumbleweeds roll by...",
  "Nothing to add — the conversation's solid.",
  "No notes from me!",
  "Looks good from over here.",
  "I'm just here vibing. Continue.",
];

function getRandomEmptyMessage(): string {
  return EMPTY_TURN_MESSAGES[Math.floor(Math.random() * EMPTY_TURN_MESSAGES.length)];
}

export interface EmptyTurnMessage {
  turnId: string;
  message: string;
  timestamp: number;
}

interface DiscoveryState {
  items: DiscoveryItem[];
  pendingTurnIds: string[]; // Turns still streaming (array for ordering)
  lastSearchedAt: Date | null;
  sessionLoadedAt: number | null; // Timestamp to trigger scroll to bottom on session load
  activeSessionId: string | null; // Track which session discoveries belong to
  emptyTurnMessages: EmptyTurnMessage[]; // Transient messages for turns with no discoveries
  // Per-turn safety fallbacks (keyed by turnId): the evaluator (Fable 5 / Opus 5)
  // refused and a fallback model produced the items — possibly via a chained handoff.
  // On a pre-output refusal the fallback block(s) arrive before any items, so addItem
  // stamps each item from this map for persistence; setModelSwitch also re-stamps
  // already-added items for the mid-stream-refusal edge case.
  turnModelSwitches: Record<string, ModelSwitch>;

  // Derived - true if any turns are pending
  isSearching: boolean;

  // Actions
  startTurn: (turnId: string, sessionId: string) => void;
  addItem: (
    turnId: string,
    sessionId: string,
    modeId: DiscoveryModeId,
    item: Omit<DiscoveryItem, 'id' | 'timestamp' | 'isExpanded' | 'turnId' | 'sessionId' | 'modeId'>
  ) => void;
  completeTurn: (turnId: string) => void;
  addItems: (
    items: Omit<DiscoveryItem, 'id' | 'timestamp' | 'isExpanded'>[]
  ) => void;
  removeItem: (id: string) => void;
  toggleExpanded: (id: string) => void;
  clearItems: () => void;
  loadItems: (items: DiscoveryItem[], sessionId?: string) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  markTurnEmpty: (turnId: string) => void;
  dismissEmptyMessage: (turnId: string) => void;
  setModelSwitch: (turnId: string, sessionId: string, modelSwitch: ModelSwitch) => void;
}

export const useDiscoveryStore = create<DiscoveryState>((set) => ({
  items: [],
  pendingTurnIds: [],
  lastSearchedAt: null,
  sessionLoadedAt: null,
  activeSessionId: null,
  emptyTurnMessages: [],
  turnModelSwitches: {},
  isSearching: false,

  startTurn: (turnId, sessionId) =>
    set((state) => ({
      pendingTurnIds: [...state.pendingTurnIds, turnId],
      isSearching: true,
      activeSessionId: sessionId,
    })),

  addItem: (turnId, sessionId, modeId, item) => {
    // Check session match before updating state
    const currentState = useDiscoveryStore.getState();
    if (currentState.activeSessionId !== sessionId) {
      console.log(`Ignoring discovery for session ${sessionId}, active is ${currentState.activeSessionId}`);
      return;
    }

    const newItem: DiscoveryItem = {
      ...item,
      id: crypto.randomUUID(),
      timestamp: new Date(),
      isExpanded: false,
      turnId,
      sessionId,
      modeId,
      // Stamp the turn's model switch (if any) so the chip notice persists with the item
      modelSwitch: currentState.turnModelSwitches[turnId],
    };

    set((state) => ({
      items: [...state.items, newItem],
      lastSearchedAt: new Date(),
    }));

    useSessionStore.getState().markDirty();
  },

  completeTurn: (turnId) =>
    set((state) => {
      const newPendingTurnIds = state.pendingTurnIds.filter(
        (id) => id !== turnId
      );
      return {
        pendingTurnIds: newPendingTurnIds,
        isSearching: newPendingTurnIds.length > 0,
      };
    }),

  // Legacy batch add - kept for backwards compatibility
  addItems: (items) => {
    set((state) => {
      const turnId = crypto.randomUUID();
      const sessionId = state.activeSessionId || useSessionStore.getState().activeSessionId || '';
      const newItems = items.map((item) => ({
        ...item,
        id: crypto.randomUUID(),
        timestamp: new Date(),
        isExpanded: false,
        turnId,
        sessionId,
      }));
      return {
        items: [...state.items, ...newItems],
        lastSearchedAt: new Date(),
      };
    });
    useSessionStore.getState().markDirty();
  },

  removeItem: (id) => {
    set((state) => ({
      items: state.items.filter((i) => i.id !== id),
    }));
    useSessionStore.getState().markDirty();
  },

  toggleExpanded: (id) =>
    set((state) => ({
      items: state.items.map((i) =>
        i.id === id ? { ...i, isExpanded: !i.isExpanded } : i
      ),
    })),

  clearItems: () => set({ items: [], pendingTurnIds: [], isSearching: false, activeSessionId: null, emptyTurnMessages: [], turnModelSwitches: {} }),

  loadItems: (items, sessionId) =>
    set({
      items,
      pendingTurnIds: [],
      isSearching: false,
      lastSearchedAt: items.length > 0 ? new Date() : null,
      sessionLoadedAt: Date.now(),
      activeSessionId: sessionId ?? null,
      emptyTurnMessages: [],
      // Rebuild per-turn switches from the loaded items so the chip notice survives reload
      turnModelSwitches: items.reduce<Record<string, ModelSwitch>>((acc, item) => {
        if (item.modelSwitch) acc[item.turnId] = item.modelSwitch;
        return acc;
      }, {}),
    }),

  setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),

  markTurnEmpty: (turnId) =>
    set((state) => ({
      emptyTurnMessages: [
        ...state.emptyTurnMessages,
        {
          turnId,
          message: getRandomEmptyMessage(),
          timestamp: Date.now(),
        },
      ],
    })),

  dismissEmptyMessage: (turnId) =>
    set((state) => ({
      emptyTurnMessages: state.emptyTurnMessages.filter((m) => m.turnId !== turnId),
    })),

  setModelSwitch: (turnId, sessionId, modelSwitch) => {
    // Ignore switches for a session the user has navigated away from (mirrors addItem).
    const currentState = useDiscoveryStore.getState();
    if (currentState.activeSessionId !== sessionId) return;

    set((state) => ({
      turnModelSwitches: { ...state.turnModelSwitches, [turnId]: modelSwitch },
      // Re-stamp items already added for this turn: on a chained fallback the second
      // hop can arrive after early items were stamped with a one-hop switch (items are
      // normally stamped from the map at add time, before any items exist — this is
      // the mid-stream-refusal edge case).
      items: state.items.map((item) =>
        item.turnId === turnId ? { ...item, modelSwitch } : item
      ),
    }));
  },
}));
