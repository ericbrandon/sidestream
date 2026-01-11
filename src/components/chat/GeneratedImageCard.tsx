import { memo, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import type { GeneratedFile } from '../../lib/types';
import { useChatStore } from '../../stores/chatStore';
import { useSettingsStore } from '../../stores/settingsStore';

interface GeneratedImageCardProps {
  file: GeneratedFile;
  messageId: string;
  onExpand: (file: GeneratedFile, imageData: string) => void;
}

/**
 * Component for displaying generated image files inline with preview.
 * Shows the image with expand and download icons at the bottom.
 */
function GeneratedImageCardComponent({ file, messageId, onExpand }: GeneratedImageCardProps) {
  const [imageData, setImageData] = useState<string | null>(file.image_preview || null);
  const [isLoading, setIsLoading] = useState(!file.image_preview);
  const [error, setError] = useState<string | null>(file.download_error || null);
  const [isDownloading, setIsDownloading] = useState(false);
  const updateGeneratedFilePreview = useChatStore((state) => state.updateGeneratedFilePreview);

  // Fetch image data if not already loaded
  useEffect(() => {
    if (imageData || error) return;

    const fetchImage = async () => {
      try {
        setIsLoading(true);

        // Determine which API to use based on current model
        const currentModel = useSettingsStore.getState().frontierLLM.model;
        const isOpenAI = currentModel.startsWith('gpt') || currentModel.startsWith('o3') || currentModel.startsWith('o4');

        let result: { data: number[]; filename: string; mime_type?: string };

        if (isOpenAI) {
          const containerId = useChatStore.getState().openaiContainerId;
          if (!containerId) {
            throw new Error('No OpenAI container ID available for file download');
          }
          result = await invoke<{ data: number[]; filename: string; mime_type?: string }>(
            'download_openai_file',
            { containerId, fileId: file.file_id, filename: file.filename }
          );
        } else {
          result = await invoke<{ data: number[]; filename: string; mime_type?: string }>(
            'download_anthropic_file',
            { fileId: file.file_id, filename: file.filename }
          );
        }

        // Convert to base64 data URL
        const bytes = new Uint8Array(result.data);
        const base64 = btoa(String.fromCharCode(...bytes));
        const mimeType = result.mime_type || 'image/png';
        const dataUrl = `data:${mimeType};base64,${base64}`;

        setImageData(dataUrl);
        // Persist to store so it's available for print/export
        updateGeneratedFilePreview(messageId, file.file_id, dataUrl);
      } catch (err) {
        console.error('Failed to load image:', err);
        setError(err instanceof Error ? err.message : 'Failed to load image');
      } finally {
        setIsLoading(false);
      }
    };

    fetchImage();
  }, [file, messageId, imageData, error, updateGeneratedFilePreview]);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDownloading || !imageData) return;

    setIsDownloading(true);
    try {
      // Determine which API to use based on current model
      const currentModel = useSettingsStore.getState().frontierLLM.model;
      const isOpenAI = currentModel.startsWith('gpt') || currentModel.startsWith('o3') || currentModel.startsWith('o4');

      let result: { data: number[]; filename: string; mime_type?: string };

      if (isOpenAI) {
        const containerId = useChatStore.getState().openaiContainerId;
        if (!containerId) {
          throw new Error('No OpenAI container ID available for file download');
        }
        result = await invoke<{ data: number[]; filename: string; mime_type?: string }>(
          'download_openai_file',
          { containerId, fileId: file.file_id, filename: file.filename }
        );
      } else {
        result = await invoke<{ data: number[]; filename: string; mime_type?: string }>(
          'download_anthropic_file',
          { fileId: file.file_id, filename: file.filename }
        );
      }

      const savePath = await save({
        defaultPath: result.filename,
        title: 'Save Image',
      });

      if (savePath) {
        await writeFile(savePath, new Uint8Array(result.data));
      }
    } catch (err) {
      console.error('Failed to download image:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleExpand = () => {
    if (imageData) {
      onExpand(file, imageData);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="relative w-full rounded-lg overflow-hidden bg-stone-200 dark:bg-stone-700 min-h-[200px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-stone-500 dark:text-stone-400">
          <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-xs">Loading image...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="relative w-full rounded-lg overflow-hidden bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 p-4">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full rounded-lg overflow-hidden group">
      {/* Image - scales with container width, maintains aspect ratio */}
      <img
        src={imageData!}
        alt={file.filename}
        className="w-full max-h-[70vh] object-contain rounded-lg cursor-pointer transition-transform hover:scale-[1.01]"
        onClick={handleExpand}
      />

      {/* Action bar at bottom - visible on hover */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2 flex justify-center gap-3">
        {/* Expand button */}
        <button
          onClick={handleExpand}
          className="p-2 rounded-full bg-white/20 hover:bg-white/40 transition-colors text-white"
          title="Expand image"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>

        {/* Download button */}
        <button
          onClick={handleDownload}
          disabled={isDownloading}
          className="p-2 rounded-full bg-white/20 hover:bg-white/40 transition-colors text-white disabled:opacity-50"
          title="Download image"
        >
          {isDownloading ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
        </button>
      </div>

    </div>
  );
}

export const GeneratedImageCard = memo(GeneratedImageCardComponent);
