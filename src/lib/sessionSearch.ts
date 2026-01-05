import type { ChatSession, ChatSessionMeta } from './types';

/**
 * Filter session metas based on search query.
 * Supports:
 * - Multi-term queries (space-separated)
 * - Exclusion terms (prefix with -)
 * - Wildcard matching (*)
 * - Full-text search across title, messages, and discovery items
 */
export function filterSessionMetas(
  sessionMetas: ChatSessionMeta[],
  sessionCache: Map<string, ChatSession>,
  searchQuery: string
): ChatSessionMeta[] {
  if (!searchQuery.trim()) {
    return sessionMetas;
  }

  // Split query into individual terms, lowercase
  const searchTerms = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);

  if (searchTerms.length === 0) {
    return sessionMetas;
  }

  // Parse terms into include/exclude with optional wildcards
  const includeTerms: { pattern: string; isWildcard: boolean }[] = [];
  const excludeTerms: { pattern: string; isWildcard: boolean }[] = [];

  for (const term of searchTerms) {
    if (term.startsWith('-') && term.length > 1) {
      // Exclusion term
      const pattern = term.slice(1);
      excludeTerms.push({
        pattern: pattern.replace(/\*/g, ''),
        isWildcard: pattern.includes('*'),
      });
    } else {
      // Inclusion term
      includeTerms.push({
        pattern: term.replace(/\*/g, ''),
        isWildcard: term.includes('*'),
      });
    }
  }

  // Helper to check if text matches a term
  const matchesTerm = (text: string, term: { pattern: string; isWildcard: boolean }): boolean => {
    if (term.isWildcard) {
      // Wildcard: substring match
      return text.includes(term.pattern);
    } else {
      // Non-wildcard: whole word match (word boundaries)
      const regex = new RegExp(`\\b${term.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      return regex.test(text);
    }
  };

  return sessionMetas.filter((meta) => {
    const session = sessionCache.get(meta.id);
    let fullText: string;

    if (!session) {
      // If not in cache, only search the title
      fullText = meta.title.toLowerCase();
    } else {
      // Build searchable text from all content
      const textParts: string[] = [session.title];

      // Add all message content
      for (const msg of session.messages) {
        textParts.push(msg.content);
      }

      // Add all discovery item content
      for (const item of session.discoveryItems) {
        textParts.push(item.title);
        textParts.push(item.oneLiner);
        textParts.push(item.fullSummary);
        textParts.push(item.relevanceExplanation);
        if (item.sourceUrl) textParts.push(item.sourceUrl);
        if (item.sourceDomain) textParts.push(item.sourceDomain);
      }

      fullText = textParts.join(' ').toLowerCase();
    }

    // All include terms must match
    const includesMatch = includeTerms.every((term) => matchesTerm(fullText, term));

    // No exclude terms should match
    const excludesMatch = excludeTerms.some((term) => matchesTerm(fullText, term));

    return includesMatch && !excludesMatch;
  });
}
