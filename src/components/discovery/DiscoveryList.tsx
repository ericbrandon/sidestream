import { useMemo, useEffect, useRef, useState } from 'react';
import { useDiscoveryStore, type EmptyTurnMessage } from '../../stores/discoveryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { getDiscoveryMode, type DiscoveryModeId } from '../../lib/discoveryModes';
import { DiscoveryCard } from './DiscoveryCard';
import { LoadingSpinner } from '../shared/LoadingSpinner';

const EMPTY_MESSAGE_MIN_DURATION = 5000; // Minimum 5 seconds before dismissal

// Component for a single fading empty message
// Persists for at least 5 seconds, then dismisses on user interaction
function EmptyTurnNotice({ message, onDismiss }: { message: EmptyTurnMessage; onDismiss: () => void }) {
  const [isVisible, setIsVisible] = useState(true);
  const [isFading, setIsFading] = useState(false);
  const [canDismiss, setCanDismiss] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // After minimum duration, allow dismissal on user interaction
  useEffect(() => {
    const timer = setTimeout(() => {
      setCanDismiss(true);
    }, EMPTY_MESSAGE_MIN_DURATION);

    return () => clearTimeout(timer);
  }, []);

  // Listen for user interactions to dismiss (only after minimum duration)
  useEffect(() => {
    if (!canDismiss) return;

    const handleInteraction = () => {
      setIsFading(true);
      // Wait for fade animation before removing
      setTimeout(() => {
        setIsVisible(false);
        onDismissRef.current();
      }, 500);
    };

    // Listen for clicks anywhere in the document
    document.addEventListener('click', handleInteraction, { once: true });
    // Listen for keydown (for when user types in prompt)
    document.addEventListener('keydown', handleInteraction, { once: true });

    return () => {
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
    };
  }, [canDismiss]);

  if (!isVisible) return null;

  return (
    <div
      className={`text-sm text-stone-500 dark:text-stone-400 italic p-2 transition-opacity duration-500 ${
        isFading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {message.message}
    </div>
  );
}

export function DiscoveryList() {
  const { items, pendingTurnIds, sessionLoadedAt, activeSessionId, emptyTurnMessages, dismissEmptyMessage } = useDiscoveryStore();
  const discoveryMode = useSettingsStore((state) => state.discoveryMode);
  const modeConfig = getDiscoveryMode(discoveryMode);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter items by current session (extra safety)
  const sessionItems = useMemo(() => {
    if (!activeSessionId) return items;
    return items.filter(item => item.sessionId === activeSessionId);
  }, [items, activeSessionId]);

  // Scroll to bottom when a session is loaded
  useEffect(() => {
    if (sessionLoadedAt && containerRef.current) {
      setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [sessionLoadedAt]);

  // Scroll to bottom when an empty turn message appears
  useEffect(() => {
    if (emptyTurnMessages.length > 0 && containerRef.current) {
      setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [emptyTurnMessages.length]);

  // Get unique turnIds in order of appearance
  const turnIds = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of sessionItems) {
      if (!seen.has(item.turnId)) {
        seen.add(item.turnId);
        result.push(item.turnId);
      }
    }
    return result;
  }, [sessionItems]);

  // Check if there are multiple different modes across all items
  const hasMultipleModes = useMemo(() => {
    const modes = new Set<DiscoveryModeId>();
    for (const item of sessionItems) {
      if (item.modeId) {
        modes.add(item.modeId);
        if (modes.size > 1) return true;
      }
    }
    return false;
  }, [sessionItems]);

  // Pending turns that have no items yet
  const pendingWithNoItems = useMemo(
    () => pendingTurnIds.filter((id) => !turnIds.includes(id)),
    [pendingTurnIds, turnIds]
  );

  // Show empty state only if no items, no pending turns, and no empty messages
  if (sessionItems.length === 0 && pendingTurnIds.length === 0 && emptyTurnMessages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-stone-500 p-4">
        <div className="text-center">
          <p className="text-sm">Discoveries will appear here as you chat</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto p-3">
      {/* Render items grouped by turnId */}
      {turnIds.map((turnId, turnIndex) => {
        const turnItems = sessionItems.filter((i) => i.turnId === turnId);
        const isPending = pendingTurnIds.includes(turnId);

        return (
          <div key={turnId}>
            {turnIndex > 0 && (
              <div className="border-t-2 border-stone-400 my-4" />
            )}
            {turnItems.map((item, itemIndex) => {
              // Render a separator line when the mode changes between chips
              const prevItem = itemIndex > 0 ? turnItems[itemIndex - 1] : null;
              const modeChanged = prevItem && prevItem.modeId !== item.modeId;
              // Show mode label at start of each mode block when multiple modes exist
              const isFirstOfMode = itemIndex === 0 || modeChanged;
              const modeName = item.modeId ? getDiscoveryMode(item.modeId).name : null;
              return (
                <div key={item.id}>
                  {modeChanged && (
                    <div className="border-t-2 border-stone-400 my-4" />
                  )}
                  {hasMultipleModes && isFirstOfMode && modeName && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 ml-1">
                      {modeName}
                    </div>
                  )}
                  <DiscoveryCard item={item} />
                </div>
              );
            })}
            {isPending && (
              <div className="flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400 p-2">
                <LoadingSpinner size="sm" />
                <span>{modeConfig.loadingText}</span>
              </div>
            )}
          </div>
        );
      })}

      {/* Handle pending turns with no items yet */}
      {pendingWithNoItems.map((turnId, i) => (
        <div key={turnId}>
          {(turnIds.length > 0 || i > 0) && (
            <div className="border-t-2 border-stone-400 my-4" />
          )}
          <div className="flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400 p-2">
            <LoadingSpinner size="sm" />
            <span>{modeConfig.loadingText}</span>
          </div>
        </div>
      ))}

      {/* Transient empty turn messages */}
      {emptyTurnMessages.map((msg) => (
        <EmptyTurnNotice
          key={msg.turnId}
          message={msg}
          onDismiss={() => dismissEmptyMessage(msg.turnId)}
        />
      ))}
    </div>
  );
}
