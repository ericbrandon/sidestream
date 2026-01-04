/**
 * Deduplicate citations by URL.
 * Keeps only the first occurrence of each unique URL.
 */
export function deduplicateCitations<T extends { url: string }>(citations: T[]): T[] {
  return citations.reduce((acc, citation) => {
    if (!acc.some((c) => c.url === citation.url)) {
      acc.push(citation);
    }
    return acc;
  }, [] as T[]);
}
