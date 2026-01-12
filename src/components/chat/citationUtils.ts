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

/**
 * Strip Gemini local file references from markdown content.
 * Gemini's code execution outputs markdown image/link syntax referencing local filenames
 * like ![Graph](graph.png) or [Download](data.csv) - these reference files in Gemini's
 * sandbox that aren't accessible via URL. Since we display generated files via
 * GeneratedFileCard/GeneratedImageCard using inline_data, we strip these references.
 *
 * Handles patterns like:
 * - ![alt text](filename.png) - markdown images with local filename
 * - [link text](filename.csv) - markdown links with local filename
 *
 * Only strips references that look like local filenames (no protocol, no path separators).
 */
export function stripGeminiLocalFileRefs(content: string): string {
  // Strip markdown images with local filenames: ![alt](filename.ext)
  // Matches: ![anything](word.ext) where word.ext has no / or : (not a URL or path)
  let result = content.replace(/!\[([^\]]*)\]\(([^/:\s)]+\.[a-zA-Z0-9]+)\)/g, '');

  // Strip markdown links with local filenames: [text](filename.ext)
  // Only if it looks like a generated file (common extensions from code execution)
  const generatedExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'csv', 'json', 'txt', 'pdf', 'xlsx', 'html'];
  const extPattern = generatedExtensions.join('|');
  const linkRegex = new RegExp(`\\[([^\\]]*)\\]\\(([^/:\\s)]+\\.(${extPattern}))\\)`, 'gi');
  result = result.replace(linkRegex, '');

  // Clean up any resulting empty lines (multiple consecutive newlines -> double newline)
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
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
