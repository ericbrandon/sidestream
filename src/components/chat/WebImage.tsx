import { useState } from 'react';
import { createPortal } from 'react-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Components } from 'react-markdown';
import { ImageLightbox } from './ImageLightbox';
import { copyWebImage, downloadWebImage } from './webImageActions';

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
 * A hover-revealed action bar exposes the same expand/copy/download affordances
 * we already offer for code-execution generated images (see GeneratedImageCard).
 * The lightbox is the shared `ImageLightbox` with `kind: 'url'` — same chrome
 * for both generated and web images, with copy/download routed through the
 * Rust-side `fetch_image_url_bytes` command for URL sources.
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
      <span className="relative inline-block group my-2 max-w-full align-middle">
        <img
          src={src}
          alt={alt || ''}
          loading="lazy"
          referrerPolicy="no-referrer"
          onClick={() => setOpen(true)}
          onError={() => setFailed(true)}
          className="max-w-full h-auto max-h-[32rem] rounded-md cursor-zoom-in transition-transform hover:scale-[1.01]"
        />

        {/* Hover-revealed action bar, mirroring GeneratedImageCard's chrome
            (expand / copy / download). Buttons stopPropagation so clicking
            them doesn't also open the lightbox via the <img>'s onClick. */}
        <span className="absolute bottom-0 left-0 right-0 rounded-b-md bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2 flex justify-center gap-3 pointer-events-none">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(true); }}
            className="p-2 rounded-full bg-white/20 hover:bg-white/40 transition-colors text-white pointer-events-auto"
            title="Expand image"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); copyWebImage(src); }}
            className="p-2 rounded-full bg-white/20 hover:bg-white/40 transition-colors text-white pointer-events-auto"
            title="Copy image"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); downloadWebImage(src); }}
            className="p-2 rounded-full bg-white/20 hover:bg-white/40 transition-colors text-white pointer-events-auto"
            title="Download image"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
        </span>
      </span>

      {open && createPortal(
        <ImageLightbox
          source={{ kind: 'url', url: src, alt: alt || '' }}
          onClose={() => setOpen(false)}
        />,
        document.body,
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
