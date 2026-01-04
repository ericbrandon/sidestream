import { useCallback, memo } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { InlineCitation as InlineCitationType } from '../../lib/types';

interface InlineCitationProps {
  citation: InlineCitationType;
}

// Map common domains to friendly display names
const DOMAIN_LABELS: Record<string, string> = {
  'wikipedia.org': 'Wikipedia',
  'github.com': 'GitHub',
  'stackoverflow.com': 'Stack Overflow',
  'ycombinator.com': 'Y Combinator',
  'news.ycombinator.com': 'Hacker News',
  'medium.com': 'Medium',
  'reddit.com': 'Reddit',
  'twitter.com': 'Twitter',
  'x.com': 'X',
  'youtube.com': 'YouTube',
  'docs.google.com': 'Google Docs',
  'arxiv.org': 'arXiv',
  'nature.com': 'Nature',
  'sciencedirect.com': 'ScienceDirect',
  'nytimes.com': 'NY Times',
  'washingtonpost.com': 'Washington Post',
  'bbc.com': 'BBC',
  'theguardian.com': 'The Guardian',
  'reuters.com': 'Reuters',
  'bloomberg.com': 'Bloomberg',
  'techcrunch.com': 'TechCrunch',
  'wired.com': 'Wired',
  'arstechnica.com': 'Ars Technica',
  'theverge.com': 'The Verge',
  'dev.to': 'DEV',
  'npmjs.com': 'npm',
  'pypi.org': 'PyPI',
  'crates.io': 'crates.io',
  'rust-lang.org': 'Rust',
  'python.org': 'Python',
  'nodejs.org': 'Node.js',
  'developer.mozilla.org': 'MDN',
  'w3.org': 'W3C',
};

/**
 * Check if a URL is a Google/Vertex redirect URL
 */
function isGoogleRedirectUrl(hostname: string): boolean {
  return (
    hostname.includes('vertexaisearch') ||
    hostname.includes('google.com/url') ||
    hostname === 'www.google.com' ||
    hostname === 'google.com'
  );
}

/**
 * Extract a short label from the title (first meaningful words)
 */
function getLabelFromTitle(title: string): string {
  if (!title || title.length === 0) {
    return 'Source';
  }

  // Common patterns to clean from titles
  // e.g., "Tauri iOS - The Guardian" -> extract "The Guardian"
  // e.g., "Article Title | Site Name" -> extract "Site Name"
  const separators = [' - ', ' | ', ' — ', ' · '];
  for (const sep of separators) {
    if (title.includes(sep)) {
      const parts = title.split(sep);
      const lastPart = parts[parts.length - 1].trim();
      // If last part looks like a site name (short), use it
      if (lastPart.length <= 25 && lastPart.length > 0) {
        return lastPart;
      }
    }
  }

  // Just use first few words of the title
  const words = title.split(/\s+/).slice(0, 3).join(' ');
  return words.length > 20 ? words.slice(0, 20) + '...' : words;
}

/**
 * Get a friendly label for a citation based on its URL
 */
function getCitationLabel(url: string, title: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');

    // If this is a Google redirect URL, use the title instead
    if (isGoogleRedirectUrl(hostname)) {
      return getLabelFromTitle(title);
    }

    // Check for exact domain matches first
    if (DOMAIN_LABELS[hostname]) {
      return DOMAIN_LABELS[hostname];
    }

    // Check for subdomain matches (e.g., "en.wikipedia.org" -> "Wikipedia")
    for (const [domain, label] of Object.entries(DOMAIN_LABELS)) {
      if (hostname.endsWith(domain) || hostname.endsWith('.' + domain)) {
        return label;
      }
    }

    // Fall back to a cleaned domain name
    // e.g., "blog.example.com" -> "example", "example.co.uk" -> "example"
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      // Try to find the main domain part (not TLD)
      const mainPart =
        parts.length > 2 && parts[parts.length - 2].length <= 3
          ? parts[parts.length - 3] // e.g., "example" from "example.co.uk"
          : parts[parts.length - 2]; // e.g., "example" from "example.com"

      if (mainPart && mainPart.length > 2) {
        // Capitalize first letter
        return mainPart.charAt(0).toUpperCase() + mainPart.slice(1);
      }
    }

    // Last resort: use the hostname
    return hostname;
  } catch {
    // If URL parsing fails, try to extract something from the title
    return getLabelFromTitle(title);
  }
}

function InlineCitationComponent({ citation }: InlineCitationProps) {
  const label = getCitationLabel(citation.url, citation.title);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openUrl(citation.url);
    },
    [citation.url]
  );

  return (
    <button
      onClick={handleClick}
      className="
        inline-flex items-center px-1.5 py-0.5 mx-0.5
        text-[11px] font-normal rounded-full
        bg-gray-200 text-gray-500
        hover:bg-gray-300 hover:text-gray-600
        dark:bg-gray-700 dark:text-[#a8b0bd]
        dark:hover:bg-gray-600 dark:hover:text-gray-200
        transition-colors cursor-pointer
      "
    >
      {label}
    </button>
  );
}

// Memoize the component to prevent re-renders during streaming
export const InlineCitation = memo(InlineCitationComponent, (prevProps, nextProps) => {
  return prevProps.citation.url === nextProps.citation.url;
});
