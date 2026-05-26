import { memo, useEffect, useCallback } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { Image as TauriImage } from '@tauri-apps/api/image';
import type { GeneratedFile } from '../../lib/types';
import { useChatStore } from '../../stores/chatStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { copyWebImage, downloadWebImage, filenameFromUrl } from './webImageActions';

/**
 * Source descriptor for what the lightbox is displaying.
 * - `generated`: an image produced by code execution. We already hold the raw
 *   base64 bytes in memory, so copy uses canvas-from-base64 and download hits
 *   the provider's files API (file_id + container_id).
 * - `url`: an externally-hosted image embedded inline by the model (via
 *   WebImage). We only have a URL, so both copy and download route through
 *   the `fetch_image_url_bytes` Rust command — see webImageActions.ts.
 */
export type LightboxSource =
  | { kind: 'generated'; file: GeneratedFile; imageData: string }
  | { kind: 'url'; url: string; alt: string };

interface ImageLightboxProps {
  source: LightboxSource;
  onClose: () => void;
}

/**
 * Fullscreen image lightbox overlay. Same chrome for both generated and
 * URL-sourced images; the source-specific bits (where bytes come from for
 * copy/download, what filename to display) branch on `source.kind`.
 */
function ImageLightboxComponent({ source, onClose }: ImageLightboxProps) {
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
    if (source.kind === 'url') {
      await downloadWebImage(source.url);
      return;
    }
    // Generated image: existing provider-files-API flow.
    try {
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
          { containerId, fileId: source.file.file_id, filename: source.file.filename }
        );
      } else {
        result = await invoke<{ data: number[]; filename: string; mime_type?: string }>(
          'download_anthropic_file',
          { fileId: source.file.file_id, filename: source.file.filename }
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
    }
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (source.kind === 'url') {
      await copyWebImage(source.url);
      return;
    }
    // Generated image: decode the base64 we already have via canvas, then
    // write RGBA to the clipboard through Tauri's Image API.
    try {
      const img = document.createElement('img');
      img.src = source.imageData;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageDataObj = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const rgbaData = new Uint8Array(imageDataObj.data);

      const image = await TauriImage.new(rgbaData, canvas.width, canvas.height);
      await writeImage(image);
    } catch (err) {
      console.error('Failed to copy image:', err);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only close if clicking directly on the backdrop, not the image
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Source-specific display bits.
  const displaySrc = source.kind === 'generated' ? source.imageData : source.url;
  const displayAlt = source.kind === 'generated' ? source.file.filename : source.alt;
  const displayFilename = source.kind === 'generated'
    ? source.file.filename
    : filenameFromUrl(source.url);
  // Web images need no-referrer to match how they were originally fetched
  // (hotlink-protected CDNs reject cross-origin Referer headers).
  const imgReferrerPolicy = source.kind === 'url' ? 'no-referrer' : undefined;

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

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white/80 hover:text-white backdrop-blur-sm"
          title="Copy"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
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
      <div className="absolute top-4 right-4 text-white/60 text-sm bg-black/30 px-3 py-1.5 rounded backdrop-blur-sm max-w-[40vw] truncate">
        {displayFilename}
      </div>

      {/* Image container */}
      <div className="max-w-[95vw] max-h-[95vh] p-8">
        <img
          src={displaySrc}
          alt={displayAlt}
          referrerPolicy={imgReferrerPolicy}
          className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl cursor-pointer"
          onClick={onClose}
        />
      </div>
    </div>
  );
}

export const ImageLightbox = memo(ImageLightboxComponent);
