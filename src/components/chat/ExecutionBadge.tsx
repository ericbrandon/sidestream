import { memo, useState } from 'react';

interface ExecutionBadgeProps {
  code?: string;
  output?: string;
  durationMs?: number;
  status?: 'success' | 'error';
  error?: string;
}

/**
 * Collapsible badge showing code execution results for completed messages.
 * Displays "Executed in Xs" with expandable code and output.
 * Generated files are shown separately via GeneratedFileCard components.
 */
function ExecutionBadgeComponent({
  code,
  output,
  durationMs,
  status,
  error,
}: ExecutionBadgeProps) {
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
  const isError = status === 'error';

  return (
    <div className="mb-2 font-scalable">
      {/* Collapsed badge */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
          isError
            ? 'bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400'
            : 'bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-500 dark:text-stone-400'
        }`}
      >
        {/* Terminal icon */}
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
        <span>
          {isError
            ? 'Execution failed'
            : durationText
            ? `Executed in ${durationText}`
            : 'Executed'}
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
        <div className="mt-2 space-y-3">
          {/* Error message */}
          {error && (
            <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
              {error}
            </div>
          )}

          {/* Code that was executed */}
          {code && (
            <div>
              <div className="text-xs text-stone-400 dark:text-stone-500 mb-1">Code:</div>
              <div className="max-h-48 overflow-y-auto text-xs text-stone-300 bg-stone-900 dark:bg-[#0d2818] rounded-lg p-3 font-mono whitespace-pre-wrap">
                {code}
              </div>
            </div>
          )}

          {/* Output */}
          {output && (
            <div>
              <div className="text-xs text-stone-400 dark:text-stone-500 mb-1">Output:</div>
              <div className="max-h-64 overflow-y-auto text-xs text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-800/50 rounded-lg p-3 font-mono whitespace-pre-wrap">
                {output}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const ExecutionBadge = memo(ExecutionBadgeComponent);
