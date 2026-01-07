import type { InlineCitation as InlineCitationType } from '../../lib/types';

interface PrintableInlineCitationProps {
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

  const separators = [' - ', ' | ', ' — ', ' · '];
  for (const sep of separators) {
    if (title.includes(sep)) {
      const parts = title.split(sep);
      const lastPart = parts[parts.length - 1].trim();
      if (lastPart.length <= 25 && lastPart.length > 0) {
        return lastPart;
      }
    }
  }

  const words = title.split(/\s+/).slice(0, 3).join(' ');
  return words.length > 20 ? words.slice(0, 20) + '...' : words;
}

/**
 * Get a friendly label for a citation based on its URL
 */
function getCitationLabel(url: string, title: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');

    if (isGoogleRedirectUrl(hostname)) {
      return getLabelFromTitle(title);
    }

    if (DOMAIN_LABELS[hostname]) {
      return DOMAIN_LABELS[hostname];
    }

    for (const [domain, label] of Object.entries(DOMAIN_LABELS)) {
      if (hostname.endsWith(domain) || hostname.endsWith('.' + domain)) {
        return label;
      }
    }

    const parts = hostname.split('.');
    if (parts.length >= 2) {
      const mainPart =
        parts.length > 2 && parts[parts.length - 2].length <= 3
          ? parts[parts.length - 3]
          : parts[parts.length - 2];

      if (mainPart && mainPart.length > 2) {
        return mainPart.charAt(0).toUpperCase() + mainPart.slice(1);
      }
    }

    return hostname;
  } catch {
    return getLabelFromTitle(title);
  }
}

/**
 * A static version of InlineCitation for HTML export.
 * Uses a regular anchor tag instead of Tauri's openUrl.
 */
export function PrintableInlineCitation({ citation }: PrintableInlineCitationProps) {
  const label = getCitationLabel(citation.url, citation.title);

  return (
    <a
      href={citation.url}
      target="_blank"
      rel="noopener noreferrer"
      className="
        inline-citation-lozenge
        inline-flex items-center px-1.5 py-0.5 mx-0.5
        text-[11px] font-normal rounded-full
        bg-gray-200 text-gray-500
        hover:bg-gray-300 hover:text-gray-600
        transition-colors cursor-pointer no-underline
      "
    >
      {label}
    </a>
  );
}
