import type { InlineCitation as InlineCitationType } from '../../lib/types';

// Citation marker format: {{CITE:index}}
export const CITATION_MARKER_REGEX = /\{\{CITE:(\d+)\}\}/g;

// Regex to match parenthesized markdown links: ([title](url))
// These are ChatGPT-style inline citations
const PARENTHESIZED_LINK_REGEX = /\(\[([^\]]+)\]\(([^)]+)\)\)/g;

/**
 * Extract ChatGPT-style inline citations from content.
 * ChatGPT wraps citation links in parentheses: ([title](url))
 * This distinguishes them from regular markdown links.
 *
 * Returns the modified content (with citations replaced by markers) and the extracted citations.
 */
export function extractChatGPTCitations(
  content: string,
  showCitations: boolean,
  existingCitationCount: number = 0
): { content: string; citations: InlineCitationType[] } {
  const citations: InlineCitationType[] = [];

  let result = content.replace(PARENTHESIZED_LINK_REGEX, (_match, title, url) => {
    if (!showCitations) {
      // Remove citations entirely when hidden
      return '';
    }

    // Create citation and return marker
    const index = existingCitationCount + citations.length;
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

  // Sort by char_offset descending so we can insert from end to start
  const sortedCitations = [...readyCitations].sort((a, b) => b.char_offset - a.char_offset);

  const citationMap = new Map<number, InlineCitationType>();
  let result = content;

  sortedCitations.forEach((citation) => {
    const originalIndex = citations.indexOf(citation);
    citationMap.set(originalIndex, citation);

    const marker = `{{CITE:${originalIndex}}}`;
    const rawOffset = Math.min(citation.char_offset, result.length);
    const offset = snapToNextNewline(result, rawOffset);

    result = result.slice(0, offset) + marker + result.slice(offset);
  });

  return { content: result, citationMap };
}
