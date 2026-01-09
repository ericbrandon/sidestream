import { memo, useState } from 'react';
import type { GeneratedFile } from '../../lib/types';

interface GeneratedFileCardProps {
  file: GeneratedFile;
  onDownload: (file: GeneratedFile) => void;
}

/**
 * A distinct file card component for generated files.
 * Displays as a file-like UI element with download button.
 */
function GeneratedFileCardComponent({ file, onDownload }: GeneratedFileCardProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  // Get file extension and determine icon/color
  const ext = file.filename.split('.').pop()?.toLowerCase() || '';

  const getFileStyle = () => {
    // Spreadsheet files - green theme
    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      return {
        bgColor: 'bg-emerald-100 dark:bg-emerald-900/40',
        borderColor: 'border-emerald-300 dark:border-emerald-700',
        iconBg: 'bg-emerald-200 dark:bg-emerald-800',
        iconColor: 'text-emerald-700 dark:text-emerald-300',
      };
    }
    // PDF files - red theme
    if (ext === 'pdf') {
      return {
        bgColor: 'bg-red-100 dark:bg-red-900/40',
        borderColor: 'border-red-300 dark:border-red-700',
        iconBg: 'bg-red-200 dark:bg-red-800',
        iconColor: 'text-red-700 dark:text-red-300',
      };
    }
    // Image files - purple theme
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
      return {
        bgColor: 'bg-purple-100 dark:bg-purple-900/40',
        borderColor: 'border-purple-300 dark:border-purple-700',
        iconBg: 'bg-purple-200 dark:bg-purple-800',
        iconColor: 'text-purple-700 dark:text-purple-300',
      };
    }
    // Code/text files - blue theme
    if (['py', 'js', 'ts', 'json', 'txt', 'md', 'html', 'css'].includes(ext)) {
      return {
        bgColor: 'bg-blue-100 dark:bg-blue-900/40',
        borderColor: 'border-blue-300 dark:border-blue-700',
        iconBg: 'bg-blue-200 dark:bg-blue-800',
        iconColor: 'text-blue-700 dark:text-blue-300',
      };
    }
    // Default - amber/orange theme for visibility
    return {
      bgColor: 'bg-amber-100 dark:bg-amber-900/40',
      borderColor: 'border-amber-300 dark:border-amber-700',
      iconBg: 'bg-amber-200 dark:bg-amber-800',
      iconColor: 'text-amber-700 dark:text-amber-300',
    };
  };

  const style = getFileStyle();

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await onDownload(file);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border-2 ${style.bgColor} ${style.borderColor} max-w-xs shadow-sm`}
    >
      {/* File icon */}
      <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${style.iconBg}`}>
        <svg
          className={`w-5 h-5 ${style.iconColor}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-stone-800 dark:text-stone-100 truncate">
          {file.filename}
        </div>
        <div className="text-xs text-stone-600 dark:text-stone-400">
          Generated file
        </div>
      </div>

      {/* Download button */}
      <button
        onClick={handleDownload}
        disabled={isDownloading || !!file.download_error}
        className={`flex-shrink-0 p-2.5 rounded-lg transition-colors ${
          file.download_error
            ? 'bg-red-200 dark:bg-red-800 text-red-600 dark:text-red-300 cursor-not-allowed'
            : isDownloading
            ? 'bg-stone-300 dark:bg-stone-600 text-stone-500 dark:text-stone-400 cursor-wait'
            : 'bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 text-stone-700 dark:text-stone-200'
        }`}
        title={file.download_error || 'Save file'}
      >
        {isDownloading ? (
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : file.download_error ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        )}
      </button>
    </div>
  );
}

export const GeneratedFileCard = memo(GeneratedFileCardComponent);
