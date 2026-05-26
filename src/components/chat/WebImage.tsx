import { memo, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Components } from 'react-markdown';

interface WebImageLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
}

/**
 * Fullscreen overlay for an external web image. Matches the visual language of
 * `ImageLightbox` (used for code-execution generated images) but without the
 * download/copy controls that depend on having the raw bytes / a file id —
 * we only have a URL here. Close via the button, backdrop click, clicking the
 * image, or Esc.
 */
function WebImageLightboxComponent({ src, alt, onClose }: WebImageLightboxProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    // Prevent body scroll while open (mirrors ImageLightbox).
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only close if the click landed on the backdrop itself, not a bubbled child.
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={handleBackdropClick}
    >
      {/* Close button — top-left, matches ImageLightbox styling */}
      <div className="absolute top-4 left-4 flex gap-3 z-10">
        <button
          onClick={onClose}
          className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white/80 hover:text-white backdrop-blur-sm"
          title="Close (Esc)"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="max-w-[95vw] max-h-[95vh] p-8">
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl cursor-pointer"
          onClick={onClose}
        />
      </div>
    </div>
  );
}

const WebImageLightbox = memo(WebImageLightboxComponent);

interface WebImageProps {
  src: string;
  alt?: string;
}

/**
 * Inline render of an external web image embedded by the model as markdown
 * (`![alt](https://…)`).
 *
 * `referrerPolicy="no-referrer"` is the critical attribute: hotlink-protected
 * image CDNs (Britannica, Getty, many news sites) reject requests carrying a
 * cross-origin Referer header. The first-party claude.ai app sets this for the
 * same reason — without it, the request is sent and the CDN serves nothing,
 * giving a broken-image icon.
 *
 * Clicking opens a fullscreen lightbox. The overlay is portaled to `document.body`
 * because react-markdown wraps images in <p>, and a block element nested inside
 * <p> is invalid HTML and gets reparented by the browser.
 */
export function WebImage({ src, alt }: WebImageProps) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  // Graceful fallback when the image can't be fetched (404, hotlink-blocked despite
  // no-referrer, DNS error, etc). The model occasionally embeds plausible-looking
  // but broken URLs — we'd rather show the user a clickable link to the source
  // than a sad broken-pixel icon.
  if (failed) {
    return (
      <a
        href={src}
        onClick={(e) => { e.preventDefault(); openUrl(src); }}
        title={src}
        className="my-2 inline-flex items-center gap-2 px-3 py-2 rounded-md border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/50 text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:border-stone-400 dark:hover:border-stone-600 transition-colors text-sm cursor-pointer no-underline"
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span>{alt || 'Image'} — couldn't load, open original</span>
      </a>
    );
  }

  return (
    <>
      <img
        src={src}
        alt={alt || ''}
        loading="lazy"
        referrerPolicy="no-referrer"
        onClick={() => setOpen(true)}
        onError={() => setFailed(true)}
        className="my-2 max-w-full h-auto max-h-[32rem] rounded-md cursor-zoom-in transition-transform hover:scale-[1.01]"
      />
      {open && createPortal(
        <WebImageLightbox src={src} alt={alt || ''} onClose={() => setOpen(false)} />,
        document.body
      )}
    </>
  );
}

/**
 * Shared react-markdown `img` renderer used by BOTH the finalized `Message` and
 * the in-progress `StreamingMessage`. Keeping a single function here avoids the
 * size-flash that happens if the two markdown component sets disagree on image
 * styling — and prevents this class of drift in the future.
 *
 * Anything without an http(s) scheme returns null: internal sandbox /
 * generated-file refs are already stripped before render and shown via
 * `GeneratedImageCard`, so a non-http url reaching here is a leftover and we'd
 * rather draw nothing than a broken icon.
 */
export const webImageRenderer: NonNullable<Components['img']> = ({ src, alt }) => {
  const url = typeof src === 'string' ? src : '';
  if (!/^https?:\/\//i.test(url)) return null;
  return <WebImage src={url} alt={alt} />;
};
