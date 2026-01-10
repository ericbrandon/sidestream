import { memo, useRef, useEffect } from 'react';

interface ExecutionIndicatorProps {
  code?: string;
  output?: string; // Combined stdout/stderr
  isComplete?: boolean; // True when execution has finished
}

/**
 * Ephemeral execution indicator shown while code is running.
 * Displays a spinning terminal icon with the code being executed and output.
 * Collapses when execution completes.
 */
function ExecutionIndicatorComponent({ code, output, isComplete }: ExecutionIndicatorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as output streams
  useEffect(() => {
    // Small delay to ensure the div is rendered and content is updated
    const timer = setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 10);
    return () => clearTimeout(timer);
  }, [output]);

  // Show collapsed state when execution is complete
  if (isComplete && (code || output)) {
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
              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span>Executing code...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[85%] p-4">
        {/* Header with spinning indicator */}
        <div className="flex items-center gap-2 mb-2">
          <div className="relative">
            <svg
              className="w-5 h-5 text-emerald-500 dark:text-emerald-400 animate-pulse"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            {/* Pulsing glow effect */}
            <div className="absolute inset-0 bg-emerald-400 dark:bg-emerald-500 rounded-full opacity-30 animate-ping" />
          </div>
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            Executing code...
          </span>
        </div>

        {/* Code being executed */}
        {code && (
          <div className="mb-2">
            <div className="text-xs text-stone-400 dark:text-stone-500 mb-1">Code:</div>
            <div className="max-h-24 overflow-y-auto text-xs text-emerald-100 bg-stone-900 dark:bg-stone-950 rounded-lg p-3 font-mono whitespace-pre-wrap">
              {code}
            </div>
          </div>
        )}

        {/* Scrollable output */}
        {output && (
          <div>
            <div className="text-xs text-stone-400 dark:text-stone-500 mb-1">Output:</div>
            <div
              ref={scrollRef}
              className="max-h-32 overflow-y-auto text-xs text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-800/50 rounded-lg p-3 font-mono whitespace-pre-wrap"
            >
              {output}
            </div>
          </div>
        )}

        {/* Pulsing dots when no output yet */}
        {!output && !code && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <div
              className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"
              style={{ animationDelay: '0.2s' }}
            />
            <div
              className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"
              style={{ animationDelay: '0.4s' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export const ExecutionIndicator = memo(ExecutionIndicatorComponent);
