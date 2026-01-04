import { useEffect } from 'react';

interface ModeChangeToastProps {
  modeName: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function ModeChangeToast({ modeName, onConfirm, onDismiss }: ModeChangeToastProps) {
  // Auto-dismiss after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="absolute top-full left-3 mt-1 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 rounded shadow-lg z-20 p-3 w-[calc(100%-1.5rem)] max-w-[240px]">
      <p className="text-sm text-stone-700 dark:text-gray-200 mb-2 whitespace-normal">
        Generate <span className="font-medium">{modeName}</span> info now?
      </p>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="px-3 py-1 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
        >
          Yes
        </button>
        <button
          onClick={onDismiss}
          className="px-3 py-1 text-sm bg-stone-200 dark:bg-gray-700 text-stone-700 dark:text-gray-200 rounded hover:bg-stone-300 dark:hover:bg-gray-600 transition-colors"
        >
          No
        </button>
      </div>
    </div>
  );
}
