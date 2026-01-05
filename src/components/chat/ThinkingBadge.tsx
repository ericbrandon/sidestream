import { memo, useState } from 'react';

interface ThinkingBadgeProps {
  content: string;
  durationMs?: number;
}

/**
 * Collapsible badge showing thinking/reasoning content for completed messages.
 * Displays "Thought for Xs" with expandable content.
 */
function ThinkingBadgeComponent({ content, durationMs }: ThinkingBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Format duration
  const formatDuration = (ms: number) => {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  };

  const durationText = durationMs ? formatDuration(durationMs) : null;

  return (
    <div className="mb-2">
      {/* Collapsed badge */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 px-2.5 py-1 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 rounded-lg text-xs text-stone-500 dark:text-stone-400 transition-colors"
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
        <span>
          {durationText ? `Thought for ${durationText}` : 'Thought'}
        </span>
        <svg
          className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-2 max-h-64 overflow-y-auto text-xs text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-800/50 rounded-lg p-3 font-mono whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

export const ThinkingBadge = memo(ThinkingBadgeComponent);
