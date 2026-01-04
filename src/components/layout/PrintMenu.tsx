import { useEffect, useRef } from 'react';

interface PrintMenuProps {
  onSaveHtml: () => void;
  onPrint: () => void;
  onDismiss: () => void;
}

export function PrintMenu({ onSaveHtml, onPrint, onDismiss }: PrintMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };

    // Delay adding the listener to avoid immediate dismissal from the triggering click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onDismiss]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onDismiss]);

  return (
    <div
      ref={menuRef}
      className="absolute top-full right-0 mt-1 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 rounded shadow-lg z-20 p-2 min-w-max"
    >
      <button
        onClick={() => {
          onSaveHtml();
          onDismiss();
        }}
        className="w-full px-3 py-2 text-sm text-stone-700 dark:text-gray-200 rounded hover:bg-purple-100 dark:hover:bg-purple-800/50 transition-colors text-left flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
          />
        </svg>
        Save as HTML
      </button>
      <button
        onClick={() => {
          onPrint();
          onDismiss();
        }}
        className="w-full px-3 py-2 text-sm text-stone-700 dark:text-gray-200 rounded hover:bg-purple-100 dark:hover:bg-purple-800/50 transition-colors text-left flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
          />
        </svg>
        Print
      </button>
    </div>
  );
}
