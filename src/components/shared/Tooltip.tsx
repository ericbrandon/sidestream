import { useState, useRef, useEffect } from 'react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  delay?: number; // milliseconds before showing, default 200ms
  position?: 'top' | 'bottom';
}

export function Tooltip({
  content,
  children,
  delay = 200,
  position = 'top',
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const showTooltip = () => {
    timeoutRef.current = window.setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
    >
      {children}
      {isVisible && (
        <div
          className={`
            absolute z-50 px-2 py-1 text-xs text-white bg-gray-800 dark:bg-gray-700 rounded shadow-lg
            whitespace-nowrap pointer-events-none
            ${position === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'}
            left-1/2 -translate-x-1/2
          `}
        >
          {content}
          <div
            className={`
              absolute left-1/2 -translate-x-1/2 w-0 h-0
              border-l-4 border-r-4 border-transparent
              ${
                position === 'top'
                  ? 'top-full border-t-4 border-t-gray-800 dark:border-t-gray-700'
                  : 'bottom-full border-b-4 border-b-gray-800 dark:border-b-gray-700'
              }
            `}
          />
        </div>
      )}
    </div>
  );
}
