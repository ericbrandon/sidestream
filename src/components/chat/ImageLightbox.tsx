import { memo, useEffect, useCallback } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import type { GeneratedFile } from '../../lib/types';

interface ImageLightboxProps {
  file: GeneratedFile;
  imageData: string;
  onClose: () => void;
}

/**
 * Fullscreen image lightbox overlay.
 * Displays the image with a transparent background and close/download buttons in the top-left.
 */
function ImageLightboxComponent({ file, imageData, onClose }: ImageLightboxProps) {
  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    // Prevent body scroll when lightbox is open
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const result = await invoke<{ data: number[]; filename: string; mime_type?: string }>(
        'download_anthropic_file',
        { fileId: file.file_id, filename: file.filename }
      );

      const savePath = await save({
        defaultPath: result.filename,
        title: 'Save Image',
      });

      if (savePath) {
        await writeFile(savePath, new Uint8Array(result.data));
      }
    } catch (err) {
      console.error('Failed to download image:', err);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only close if clicking directly on the backdrop, not the image
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={handleBackdropClick}
    >
      {/* Control buttons - top left, semi-transparent */}
      <div className="absolute top-4 left-4 flex gap-3 z-10">
        {/* Close button */}
        <button
          onClick={onClose}
          className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white/80 hover:text-white backdrop-blur-sm"
          title="Close (Esc)"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Download button */}
        <button
          onClick={handleDownload}
          className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white/80 hover:text-white backdrop-blur-sm"
          title="Download"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      </div>

      {/* Filename - top right */}
      <div className="absolute top-4 right-4 text-white/60 text-sm bg-black/30 px-3 py-1.5 rounded backdrop-blur-sm">
        {file.filename}
      </div>

      {/* Image container */}
      <div className="max-w-[95vw] max-h-[95vh] p-8">
        <img
          src={imageData}
          alt={file.filename}
          className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Instructions hint - bottom center */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/40 text-xs">
        Press Esc or click outside to close
      </div>
    </div>
  );
}

export const ImageLightbox = memo(ImageLightboxComponent);
