# Refactoring sessionStore.ts

## Current State
- **File:** `src/stores/sessionStore.ts`
- **Size:** 681 lines
- **Problem:** 4 distinct responsibilities mixed together

## Proposed Extraction

### 1. Extract `sessionSearch.ts` (Easy, ~85 lines)

**Extract lines 592-676** - the `getFilteredMetas` function

Create `src/lib/sessionSearch.ts`:
```typescript
import type { ChatSession, ChatSessionMeta } from './types';

/**
 * Filter session metas based on search query.
 * Supports:
 * - Multi-term queries (space-separated)
 * - Exclusion terms (prefix with -)
 * - Wildcard matching (*)
 * - Full-text search across title, messages, and discovery items
 */
export function filterSessionMetas(
  sessionMetas: ChatSessionMeta[],
  sessionCache: Map<string, ChatSession>,
  searchQuery: string
): ChatSessionMeta[] {
  // ... move the implementation here
}
```

Then in sessionStore.ts:
```typescript
import { filterSessionMetas } from '../lib/sessionSearch';

// In the store:
getFilteredMetas: () => {
  const { sessionMetas, sessionCache, searchQuery } = get();
  return filterSessionMetas(sessionMetas, sessionCache, searchQuery);
},
```

### 2. Extract `sessionFork.ts` (Medium complexity, ~190 lines)

**Extract lines 386-574** - `forkFromMessage` and `forkCurrentSession`

Create `src/lib/sessionFork.ts`:
```typescript
import { invoke } from '@tauri-apps/api/core';
import type { ChatSession, ChatSessionMeta, Message, DiscoveryItem } from './types';
import { buildSessionSettings } from './sessionHelpers';
import { remapMessageIds, remapDiscoveryItems } from './messageHelpers';

interface ForkStores {
  chatStore: {
    messages: Message[];
    isStreaming: boolean;
    inputValue: string;
    clearStreamingContent: () => void;
    loadSession: (messages: Message[]) => void;
    setInput: (value: string) => void;
    clearAttachments: () => void;
    addAttachment: (att: any) => void;
  };
  discoveryStore: {
    items: DiscoveryItem[];
    loadItems: (items: DiscoveryItem[], sessionId: string) => void;
    setActiveSessionId: (id: string) => void;
  };
  settingsStore: {
    discoveryMode: string;
    // ... other settings needed for buildSessionSettings
  };
  sessionStore: {
    activeSessionId: string | null;
    sessionMetas: ChatSessionMeta[];
    isDirty: boolean;
    saveCurrentSession: () => Promise<void>;
  };
}

interface ForkResult {
  newSessionId: string;
  newMeta: ChatSessionMeta;
  session: ChatSession;
}

/**
 * Fork from a specific user message.
 * Creates a new session with messages up to (but not including) the target message.
 * The target message content is placed in the input field for editing.
 */
export async function forkFromMessage(
  messageId: string,
  stores: ForkStores
): Promise<ForkResult | null> {
  // ... implementation
}

/**
 * Fork the entire current session.
 * Creates a copy of the session with new IDs.
 */
export async function forkCurrentSession(
  stores: ForkStores
): Promise<ForkResult | null> {
  // ... implementation
}

// Shared helper used by both functions
async function createForkSession(
  messages: Message[],
  discoveryItems: DiscoveryItem[],
  originalTitle: string,
  settingsStore: ForkStores['settingsStore']
): Promise<{ session: ChatSession; meta: ChatSessionMeta }> {
  // ... shared logic for building and saving fork session
}
```

### 3. Helper functions to move

Move these to appropriate locations:
- `generateChatTitle` (lines 43-47) → `src/lib/sessionHelpers.ts`
- `serializeMessage` (lines 49-54) → `src/lib/sessionHelpers.ts`
- `serializeDiscoveryItem` (lines 56-61) → `src/lib/sessionHelpers.ts`

## After Refactoring

**sessionStore.ts** will be ~400 lines focused on:
- State definitions
- `loadSessionList`
- `createNewSession`
- `switchToSession`
- `saveCurrentSession`
- `deleteSession`
- `renameSession`
- Simple setters (`toggleSidebar`, `setActiveSessionId`, `setSearchQuery`, `markDirty`)

## Implementation Order

1. **First:** Extract `sessionSearch.ts` - it's a pure function with no side effects, easy to test
2. **Second:** Move helper functions to `sessionHelpers.ts`
3. **Third:** Extract `sessionFork.ts` - more complex due to store interactions

## Testing Notes

After each extraction:
1. Run `npx tsc --noEmit` to verify TypeScript compiles
2. Test the affected features:
   - Search: Type in sidebar search box, verify filtering works
   - Fork: Right-click a user message → "Fork from here", verify new session created
   - Fork current: Use keyboard shortcut or menu to fork entire session
