import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { Image as TauriImage } from '@tauri-apps/api/image';

interface FetchedImageBytes {
  data: number[];
  filename: string;
  mime_type?: string;
}

/**
 * Fetch the bytes of an externally-hosted image via the Rust backend. The
 * backend uses reqwest (no CORS) and sends no Referer header, so hosts that
 * serve our inline `<img referrerPolicy="no-referrer">` will also serve this.
 */
function fetchUrlBytes(url: string): Promise<FetchedImageBytes> {
  return invoke<FetchedImageBytes>('fetch_image_url_bytes', { url });
}

/**
 * Show a save dialog and write a web-hosted image to disk. The default filename
 * comes from the URL's last path segment (set by the Rust command).
 */
export async function downloadWebImage(url: string): Promise<void> {
  try {
    const result = await fetchUrlBytes(url);
    const savePath = await save({
      defaultPath: result.filename,
      title: 'Save Image',
    });
    if (savePath) {
      await writeFile(savePath, new Uint8Array(result.data));
    }
  } catch (err) {
    console.error('Failed to download web image:', err);
  }
}

/**
 * Copy a web-hosted image to the system clipboard. Decodes the fetched bytes
 * through an off-screen <img>+canvas pipeline to get RGBA pixels — same shape
 * as the existing ImageLightbox copy path for generated images, just sourced
 * from URL bytes instead of base64.
 */
export async function copyWebImage(url: string): Promise<void> {
  let objectUrl: string | null = null;
  try {
    const result = await fetchUrlBytes(url);
    const mimeType = result.mime_type || 'image/png';
    const blob = new Blob([new Uint8Array(result.data)], { type: mimeType });
    objectUrl = URL.createObjectURL(blob);

    const img = document.createElement('img');
    img.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to decode image bytes'));
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D canvas context');
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const rgba = new Uint8Array(imageData.data);
    const tauriImage = await TauriImage.new(rgba, canvas.width, canvas.height);
    await writeImage(tauriImage);
  } catch (err) {
    console.error('Failed to copy web image:', err);
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Derive a display filename from a URL — the last path segment without query
 * string, falling back to "Image" if the URL is unparseable.
 */
export function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last || 'Image';
  } catch {
    return 'Image';
  }
}
