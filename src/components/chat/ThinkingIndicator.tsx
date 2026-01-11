import { memo, useRef, useEffect } from 'react';

interface ThinkingIndicatorProps {
  content: string;
  isThinkingComplete?: boolean; // True when response text has started streaming
}

/**
 * Ephemeral thinking indicator shown while model is thinking.
 * Displays a pulsing brain icon with streaming thinking text.
 * Collapses when response text starts streaming.
 */
function ThinkingIndicatorComponent({ content, isThinkingComplete }: ThinkingIndicatorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as content streams
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content]);

  // Show collapsed state when thinking is complete
  if (isThinkingComplete && content) {
    return (
      <div className="flex justify-start mb-2">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-100 dark:bg-stone-800 rounded-lg text-xs text-stone-500 dark:text-stone-400">
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
          <span>Thinking...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start mb-4 font-scalable">
      <div className="max-w-[85%] p-4">
        {/* Header with pulsing indicator */}
        <div className="flex items-center gap-2 mb-2">
          <div className="relative">
            <svg
              className="w-5 h-5 text-purple-500 dark:text-purple-400"
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
            {/* Pulsing glow effect */}
            <div className="absolute inset-0 bg-purple-400 dark:bg-purple-500 rounded-full opacity-30 animate-ping" />
          </div>
          <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
            Thinking...
          </span>
        </div>

        {/* Scrollable thinking content */}
        {content && (
          <div
            ref={scrollRef}
            className="max-h-32 overflow-y-auto text-xs text-stone-500 dark:text-stone-300 bg-stone-50 dark:bg-stone-800/50 rounded-lg p-3 font-mono whitespace-pre-wrap"
          >
            {content}
          </div>
        )}

        {/* Pulsing dots when no content yet */}
        {!content && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
            <div
              className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"
              style={{ animationDelay: '0.2s' }}
            />
            <div
              className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"
              style={{ animationDelay: '0.4s' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export const ThinkingIndicator = memo(ThinkingIndicatorComponent);
