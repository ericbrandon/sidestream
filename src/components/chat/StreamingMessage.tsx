import { useMemo, useRef, memo } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { InlineCitation as InlineCitationType } from '../../lib/types';
import { InlineCitation } from './InlineCitation';
import { CITATION_MARKER_REGEX, insertCitationMarkers, extractChatGPTCitations, stripSandboxUrls, stripGeminiLocalFileRefs } from './citationUtils';
import { useSettingsStore } from '../../stores/settingsStore';


/**
 * Render text with inline citations.
 */
function renderTextWithCitations(
  text: string,
  citationMap: Map<number, InlineCitationType>,
  stableKeyMap: Map<string, number>
): React.ReactNode {
  if (citationMap.size === 0 || !CITATION_MARKER_REGEX.test(text)) {
    return text;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  CITATION_MARKER_REGEX.lastIndex = 0;

  while ((match = CITATION_MARKER_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const citationIndex = parseInt(match[1], 10);
    const citation = citationMap.get(citationIndex);
    if (citation) {
      // Use stable key based on URL to prevent re-mounting during streaming
      const stableKey = stableKeyMap.get(citation.url) ?? citationIndex;
      parts.push(<InlineCitation key={`cite-url-${stableKey}`} citation={citation} />);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/**
 * Create markdown components that handle inline citations
 */
function createMarkdownComponents(
  citationMap: Map<number, InlineCitationType>,
  stableKeyMap: Map<string, number>
): Components {
  const processChildren = (children: React.ReactNode): React.ReactNode => {
    if (typeof children === 'string') {
      return renderTextWithCitations(children, citationMap, stableKeyMap);
    }
    if (Array.isArray(children)) {
      return children.map((child, i) =>
        typeof child === 'string' ? (
          <span key={i}>{renderTextWithCitations(child, citationMap, stableKeyMap)}</span>
        ) : (
          child
        )
      );
    }
    return children;
  };

  return {
    h1: ({ children }) => <h2>{processChildren(children)}</h2>,
    h2: ({ children }) => <h3>{processChildren(children)}</h3>,
    h3: ({ children }) => <h4>{processChildren(children)}</h4>,
    h4: ({ children }) => <h5>{processChildren(children)}</h5>,
    h5: ({ children }) => <h6>{processChildren(children)}</h6>,
    h6: ({ children }) => <h6>{processChildren(children)}</h6>,
    p: ({ children }) => <p>{processChildren(children)}</p>,
    li: ({ children }) => <li>{processChildren(children)}</li>,
    strong: ({ children }) => <strong>{processChildren(children)}</strong>,
    em: ({ children }) => <em>{processChildren(children)}</em>,
    // Table cells need citation processing too
    td: ({ children }) => <td>{processChildren(children)}</td>,
    th: ({ children }) => <th>{processChildren(children)}</th>,
    hr: () => <hr className="my-4 border-gray-300 dark:border-gray-600" />,
    a: ({ href, children }) => (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href) {
            openUrl(href);
          }
        }}
        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline cursor-pointer"
      >
        {processChildren(children)}
      </a>
    ),
  };
}

interface StreamingMessageProps {
  content: string;
  inlineCitations?: InlineCitationType[];
}

/**
 * Cached markdown renderer for completed content.
 * This only re-renders when the completed content changes (grows),
 * which happens much less frequently than every delta.
 */
const CachedMarkdown = memo(function CachedMarkdown({
  content,
  inlineCitations,
  showCitations,
  citationKeyMapRef,
}: {
  content: string;
  inlineCitations: InlineCitationType[];
  showCitations: boolean;
  citationKeyMapRef: React.MutableRefObject<Map<string, number>>;
}) {
  const { processedContent, markdownComponents } = useMemo(() => {
    if (!content) return { processedContent: '', markdownComponents: {} as Components };

    // First, strip OpenAI sandbox: URLs (files are shown via GeneratedFileCard)
    let strippedContent = stripSandboxUrls(content);
    // Also strip Gemini local file references (files are shown via GeneratedImageCard/GeneratedFileCard)
    strippedContent = stripGeminiLocalFileRefs(strippedContent);

    // Then extract ChatGPT-style parenthesized citations from content
    const { content: contentWithoutChatGPTCitations, citations: chatGPTCitations } =
      extractChatGPTCitations(strippedContent, showCitations);

    // Get existing inline citations (from Claude/Gemini)
    const existingCitations = showCitations ? inlineCitations : [];

    // Build stable keys for citations based on URL
    const keyMap = citationKeyMapRef.current;
    [...existingCitations, ...chatGPTCitations].forEach((citation) => {
      if (!keyMap.has(citation.url)) {
        keyMap.set(citation.url, keyMap.size);
      }
    });

    // Insert citation markers for position-based citations
    const { content: processed, citationMap } = insertCitationMarkers(
      contentWithoutChatGPTCitations,
      existingCitations,
      { waitForNewline: true }
    );

    // Add ChatGPT citations to the map
    chatGPTCitations.forEach((citation, idx) => {
      citationMap.set(existingCitations.length + idx, citation);
    });

    const components = createMarkdownComponents(citationMap, keyMap);
    return { processedContent: processed, markdownComponents: components };
  }, [content, inlineCitations, showCitations, citationKeyMapRef]);

  if (!content) return null;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
    >
      {processedContent}
    </ReactMarkdown>
  );
});


export function StreamingMessage({ content, inlineCitations = [] }: StreamingMessageProps) {
  // Use ref to maintain stable citation map across renders
  const citationKeyMapRef = useRef<Map<string, number>>(new Map());
  const showCitations = useSettingsStore((state) => state.showCitations);

  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[85%] p-4">
        <div className="prose prose-sm max-w-none prose-gray dark:prose-invert font-scalable">
          {/* Render all content as markdown - memoization handles caching */}
          <CachedMarkdown
            content={content}
            inlineCitations={inlineCitations}
            showCitations={showCitations}
            citationKeyMapRef={citationKeyMapRef}
          />
        </div>
        {/* Streaming indicator */}
        <div className="flex items-center gap-1 mt-2">
          <div className="w-2 h-2 bg-stone-400 rounded-full animate-pulse" />
          <div
            className="w-2 h-2 bg-stone-400 rounded-full animate-pulse"
            style={{ animationDelay: '0.2s' }}
          />
          <div
            className="w-2 h-2 bg-stone-400 rounded-full animate-pulse"
            style={{ animationDelay: '0.4s' }}
          />
        </div>
      </div>
    </div>
  );
}
