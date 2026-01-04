import { ButtonHTMLAttributes, forwardRef } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', children, ...props }, ref) => {
    const baseStyles =
      'rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed';

    const variants = {
      primary: 'bg-blue-600 hover:bg-blue-500 text-white focus:ring-blue-500 dark:bg-blue-700 dark:hover:bg-blue-600',
      secondary:
        'bg-stone-200 hover:bg-stone-300 text-stone-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200 focus:ring-stone-400 dark:focus:ring-gray-500',
      ghost: 'hover:bg-stone-100 text-stone-600 dark:hover:bg-gray-700 dark:text-gray-300 focus:ring-stone-400 dark:focus:ring-gray-500',
    };

    const sizes = {
      sm: 'px-2 py-1 text-sm',
      md: 'px-4 py-2',
      lg: 'px-6 py-3 text-lg',
    };

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
