import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm text-gray-600 dark:text-gray-400">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            px-4 py-2 bg-stone-100 dark:bg-gray-700 rounded-lg
            border border-stone-300 dark:border-gray-600
            focus:border-stone-400 dark:focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-stone-400 dark:focus:ring-gray-500
            placeholder-stone-400 dark:placeholder-gray-500 text-gray-800 dark:text-gray-100
            disabled:opacity-50
            ${error ? 'border-red-500' : ''}
            ${className}
          `}
          {...props}
        />
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    );
  }
);

Input.displayName = 'Input';
