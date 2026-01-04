import type { Message, DiscoveryItem } from './types';

export interface ChatTurn {
  userMessage: Message;
  assistantMessage: Message | null;
  discoveryItems: DiscoveryItem[];
}

/**
 * Group messages into turns and associate discovery items with each turn.
 * Each turn = 1 user message + 1 assistant response.
 * Discovery items are matched by turnId on messages (not positional index).
 */
export function groupMessagesIntoTurns(
  messages: Message[],
  discoveryItems: DiscoveryItem[]
): ChatTurn[] {
  const turns: ChatTurn[] = [];

  // Group discovery items by turnId for O(1) lookup
  const discoveryByTurnId = new Map<string, DiscoveryItem[]>();
  for (const item of discoveryItems) {
    const existing = discoveryByTurnId.get(item.turnId) || [];
    existing.push(item);
    discoveryByTurnId.set(item.turnId, existing);
  }

  // Pair up user/assistant messages into turns
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === 'user') {
      const nextMessage = messages[i + 1];
      const assistantMessage = nextMessage?.role === 'assistant' ? nextMessage : null;

      // Get turnId from user message (preferred) or assistant message
      const turnId = message.turnId || assistantMessage?.turnId;

      // Match discovery items by turnId (not position!)
      const items = turnId ? discoveryByTurnId.get(turnId) || [] : [];

      turns.push({
        userMessage: message,
        assistantMessage,
        discoveryItems: items,
      });

      if (assistantMessage) {
        i++; // Skip the assistant message since we've paired it
      }
    }
  }

  return turns;
}

/**
 * Strip cite tags like <cite index="25-2,25-3">...</cite> from text
 */
export function stripCiteTags(text: string): string {
  return text.replace(/<cite[^>]*>|<\/cite>/g, '');
}
