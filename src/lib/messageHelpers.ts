import type { Message, DiscoveryItem } from './types';

interface RemappedMessages {
  messages: Message[];
  turnIdMap: Map<string, string>;
}

interface RemappedDiscoveryItems {
  items: DiscoveryItem[];
}

/**
 * Remap message IDs and turnIds for a forked session.
 * Creates new unique IDs for all messages while maintaining turn relationships.
 */
export function remapMessageIds(messages: Message[]): RemappedMessages {
  // Collect all unique turnIds
  const oldTurnIds = new Set<string>();
  for (const msg of messages) {
    if (msg.turnId) {
      oldTurnIds.add(msg.turnId);
    }
  }

  // Create turnId mapping (old -> new)
  const turnIdMap = new Map<string, string>();
  for (const oldId of oldTurnIds) {
    turnIdMap.set(oldId, crypto.randomUUID());
  }

  // Transform messages with new IDs
  const remappedMessages: Message[] = messages.map((msg) => ({
    ...msg,
    id: crypto.randomUUID(),
    turnId: msg.turnId ? turnIdMap.get(msg.turnId) : undefined,
  }));

  return { messages: remappedMessages, turnIdMap };
}

/**
 * Remap discovery item IDs for a forked session.
 * Filters items by turnIds and assigns new IDs.
 */
export function remapDiscoveryItems(
  items: DiscoveryItem[],
  turnIdMap: Map<string, string>,
  newSessionId: string
): RemappedDiscoveryItems {
  const oldTurnIds = new Set(turnIdMap.keys());

  const remappedItems: DiscoveryItem[] = items
    .filter((item) => oldTurnIds.has(item.turnId))
    .map((item) => ({
      ...item,
      id: crypto.randomUUID(),
      turnId: turnIdMap.get(item.turnId)!,
      sessionId: newSessionId,
    }));

  return { items: remappedItems };
}
