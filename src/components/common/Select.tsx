import { SelectHTMLAttributes } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  variant?: 'sm' | 'md';
  fullWidth?: boolean;
}

export function Select({ className = '', variant = 'md', fullWidth = false, ...props }: SelectProps) {
  const sizeClasses =
    variant === 'sm'
      ? 'px-2 py-1 pr-6 text-xs rounded'
      : 'px-3 py-2 pr-8 text-sm rounded-lg';

  const chevronClass = variant === 'sm' ? 'right-1.5 w-3 h-3' : 'right-2.5 w-3.5 h-3.5';

  return (
    <div className={`relative ${fullWidth ? 'w-full flex' : 'inline-flex'}`}>
      <select
        className={`appearance-none w-full ${sizeClasses} border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 dark:focus:ring-blue-400 dark:focus:border-blue-400 cursor-pointer transition-colors hover:border-gray-400 dark:hover:border-gray-500 ${className}`}
        {...props}
      />
      <span
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 ${chevronClass}`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 10 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-full h-full"
        >
          <path d="M1 1l4 4 4-4" />
        </svg>
      </span>
    </div>
  );
}
