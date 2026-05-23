import { defaultUrlTransform } from 'react-markdown';
import type { InlineCitation as InlineCitationType } from '../../lib/types';

// Citation marker format: {{CITE:index}}
export const CITATION_MARKER_REGEX = /\{\{CITE:(\d+)\}\}/g;

// Regex to match parenthesized markdown links: ([title](url))
// These are ChatGPT-style inline citations
const PARENTHESIZED_LINK_REGEX = /\(\[([^\]]+)\]\(([^)]+)\)\)/g;

/**
 * Check if a URL is an OpenAI sandbox URL.
 * Format: sandbox:/mnt/data/filename.ext
 */
export function isSandboxUrl(url: string): boolean {
  return url.startsWith('sandbox:');
}

/**
 * Extract filename from a sandbox URL.
 * Input: sandbox:/mnt/data/filename.ext
 * Output: filename.ext
 */
export function extractSandboxFilename(url: string): string | null {
  const match = url.match(/^sandbox:\/mnt\/data\/(.+)$/);
  return match ? match[1] : null;
}

/**
 * Strip OpenAI sandbox: URLs from markdown content.
 * These are file references from OpenAI's code interpreter that link to sandbox:/mnt/data/...
 * Since files are displayed via GeneratedFileCard/GeneratedImageCard, we strip these links
 * to avoid showing non-functional download links in the markdown.
 *
 * Handles patterns like:
 * - [Download filename](sandbox:/mnt/data/filename.ext)
 * - [filename](sandbox:/mnt/data/filename.ext)
 * - Standalone sandbox:/mnt/data/filename.ext URLs
 */
export function stripSandboxUrls(content: string): string {
  // Strip markdown links with sandbox URLs: [text](sandbox:/mnt/data/...)
  // This removes the entire link including the link text
  let result = content.replace(/\[([^\]]*)\]\(sandbox:\/mnt\/data\/[^)]+\)/g, '');

  // Strip standalone sandbox URLs (not in markdown link format)
  result = result.replace(/sandbox:\/mnt\/data\/\S+/g, '');

  // Clean up any resulting empty lines (multiple consecutive newlines -> double newline)
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

/**
 * Strip Anthropic /files/output/ URLs from markdown content.
 * Claude's code execution outputs markdown image/link syntax referencing /files/output/...
 * paths that are internal to Claude's sandbox. Since files are displayed via
 * GeneratedFileCard/GeneratedImageCard using inline_data, we strip these references.
 *
 * Handles patterns like:
 * - ![alt text](/files/output/hash/filename.ext) - markdown images
 * - [link text](/files/output/hash/filename.ext) - markdown links
 */
export function stripAnthropicFileUrls(content: string): string {
  // Strip markdown images with /files/output/ paths: ![alt](/files/output/...)
  let result = content.replace(/!\[([^\]]*)\]\(\/files\/output\/[^)]+\)/g, '');

  // Strip markdown links with /files/output/ paths: [text](/files/output/...)
  result = result.replace(/\[([^\]]*)\]\(\/files\/output\/[^)]+\)/g, '');

  // Clean up any resulting empty lines (multiple consecutive newlines -> double newline)
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

// Extensions Gemini code execution can emit as downloadable files.
const GENERATED_FILE_EXTS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
  'csv', 'json', 'txt', 'pdf', 'xlsx', 'xls', 'docx', 'pptx', 'html', 'md',
];
const GENERATED_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

/** Matches a filename with a known generated-file extension anywhere in a string. */
export const GENERATED_FILE_REF_REGEX = new RegExp(
  `[\\w./\\\\-]+\\.(?:${GENERATED_FILE_EXTS.join('|')})`,
  'gi'
);

/**
 * Strip Gemini local-file markdown IMAGES from content (e.g. ![Graph](graph.png),
 * ![g](./out/graph.png)). The image is shown via GeneratedImageCard, so an inline
 * <img> pointing at a sandbox filename would render broken/duplicate.
 *
 * Markdown LINKS ([text](file.ext)) are intentionally left intact — the message's
 * link renderer turns the ones that match a generated file into working downloads
 * (see findLocalGeneratedFile / isLocalGeneratedFileRef) and drops the rest.
 *
 * Skips anything with a URI scheme (http:, https:, data:, sandbox:, …) so real
 * web images are untouched. Path prefixes (./, /tmp/, out/) are allowed.
 */
export function stripGeminiLocalFileRefs(content: string): string {
  const extPattern = GENERATED_IMAGE_EXTS.join('|');
  const imgRegex = new RegExp(
    `!\\[([^\\]]*)\\]\\((?![a-z][\\w+.-]*:)([^)\\s]*\\.(${extPattern}))\\)`,
    'gi'
  );
  let result = content.replace(imgRegex, '');
  // Clean up any resulting empty lines (multiple consecutive newlines -> double newline)
  result = result.replace(/\n{3,}/g, '\n\n');
  return result;
}

/**
 * Does this markdown link href look like a local generated file? True when it has
 * no URI scheme and ends in a known generated-file extension — e.g. "chart.png",
 * "./report.pdf", "/tmp/data.csv" — but not "https://example.com/x.png".
 */
export function isLocalGeneratedFileRef(href: string): boolean {
  if (/^[a-z][\w+.-]*:/i.test(href)) return false; // has a scheme (http:, sandbox:, mailto:, data:)
  if (href.startsWith('#')) return false;
  const base = fileRefBasename(href);
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  return GENERATED_FILE_EXTS.includes(ext);
}

/** Lowercased final path component of an href, for matching against a filename. */
export function fileRefBasename(href: string): string {
  return (href.split(/[?#]/)[0].split('/').pop() || '').toLowerCase();
}

/**
 * `urlTransform` for ReactMarkdown that preserves "sandbox:" download links
 * (Gemini/OpenAI code-execution files). react-markdown's default sanitizer rewrites
 * any href with an unrecognized scheme to "" — which silently destroys the href
 * before our link renderer can resolve it to a generated file. We keep the default
 * sanitization for every other scheme (so javascript:/data: stay blocked).
 */
export function preserveFileRefUrlTransform(url: string): string {
  return url.startsWith('sandbox:') ? url : defaultUrlTransform(url);
}

/**
 * Extract ChatGPT-style inline citations from content.
 * ChatGPT wraps citation links in parentheses: ([title](url))
 * This distinguishes them from regular markdown links.
 *
 * Deduplicates by URL - only the first occurrence of each unique URL gets a citation marker.
 * Subsequent occurrences are removed entirely to avoid duplicate badges.
 *
 * Returns the modified content (with citations replaced by markers) and the extracted citations.
 */
export function extractChatGPTCitations(
  content: string,
  showCitations: boolean,
  existingCitationCount: number = 0
): { content: string; citations: InlineCitationType[] } {
  const citations: InlineCitationType[] = [];
  const urlToIndex = new Map<string, number>();

  let result = content.replace(PARENTHESIZED_LINK_REGEX, (_match, title, url) => {
    if (!showCitations) {
      // Remove citations entirely when hidden
      return '';
    }

    // Check if we've already seen this URL
    if (urlToIndex.has(url)) {
      // Duplicate URL - remove this occurrence entirely (no marker)
      return '';
    }

    // First occurrence of this URL - create citation and marker
    const index = existingCitationCount + citations.length;
    urlToIndex.set(url, index);
    citations.push({
      url,
      title,
      cited_text: '',
      char_offset: 0, // Not used for ChatGPT citations
    });

    return `{{CITE:${index}}}`;
  });

  return { content: result, citations };
}

/**
 * Snap a character offset to just before the next newline.
 * This ensures citations appear at the end of lines/paragraphs.
 */
function snapToNextNewline(content: string, offset: number): number {
  if (offset >= content.length) return content.length;
  const nextNewline = content.indexOf('\n', offset);
  return nextNewline !== -1 ? nextNewline : content.length;
}

/**
 * Insert citation markers into content at the specified character positions.
 * Deduplicates globally by URL - only the first occurrence of each unique URL
 * gets a citation marker. This prevents the same source from showing multiple badges.
 *
 * Returns the modified content and a map of marker indices to citations.
 */
export function insertCitationMarkers(
  content: string,
  citations: InlineCitationType[],
  options: { waitForNewline?: boolean } = {}
): { content: string; citationMap: Map<number, InlineCitationType> } {
  if (!citations || citations.length === 0) {
    return { content, citationMap: new Map() };
  }

  // During streaming, filter to only citations that have a newline after their position
  // This prevents the "pushing" effect
  let readyCitations = citations;
  if (options.waitForNewline) {
    readyCitations = citations.filter((citation) => {
      const nextNewline = content.indexOf('\n', citation.char_offset);
      return nextNewline !== -1;
    });
    if (readyCitations.length === 0) {
      return { content, citationMap: new Map() };
    }
  }

  // Sort by char_offset ascending so we process in document order
  // This ensures "first occurrence" is determined by position in the text
  const sortedByPosition = [...readyCitations].sort((a, b) => a.char_offset - b.char_offset);

  // Deduplicate globally by URL - only keep the first occurrence of each URL
  const seenUrls = new Set<string>();
  const deduplicatedCitations: InlineCitationType[] = [];

  for (const citation of sortedByPosition) {
    if (!seenUrls.has(citation.url)) {
      seenUrls.add(citation.url);
      deduplicatedCitations.push(citation);
    }
  }

  // Calculate snapped positions and sort descending for insertion
  const citationsWithSnappedPos = deduplicatedCitations.map((citation) => {
    const rawOffset = Math.min(citation.char_offset, content.length);
    const snappedOffset = snapToNextNewline(content, rawOffset);
    return { citation, snappedOffset };
  });

  // Sort by snapped offset descending so we can insert from end to start
  citationsWithSnappedPos.sort((a, b) => b.snappedOffset - a.snappedOffset);

  const citationMap = new Map<number, InlineCitationType>();
  let result = content;

  citationsWithSnappedPos.forEach((item, idx) => {
    const markerIndex = idx;
    citationMap.set(markerIndex, item.citation);

    const marker = `{{CITE:${markerIndex}}}`;
    result = result.slice(0, item.snappedOffset) + marker + result.slice(item.snappedOffset);
  });

  return { content: result, citationMap };
}
