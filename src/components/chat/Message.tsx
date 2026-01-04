import { useState, useMemo } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openUrl } from '@tauri-apps/plugin-opener';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { Message as MessageType, InlineCitation as InlineCitationType } from '../../lib/types';
import { ContextMenu, type ContextMenuItem } from '../shared/ContextMenu';
import { InlineCitation } from './InlineCitation';
import { CITATION_MARKER_REGEX, insertCitationMarkers, extractChatGPTCitations } from './citationUtils';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * Render text with inline citations.
 * Parses citation markers and replaces them with InlineCitation components.
 */
function renderTextWithCitations(
  text: string,
  citationMap: Map<number, InlineCitationType>
): React.ReactNode {
  if (citationMap.size === 0 || !CITATION_MARKER_REGEX.test(text)) {
    return text;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  // Reset regex lastIndex
  CITATION_MARKER_REGEX.lastIndex = 0;

  while ((match = CITATION_MARKER_REGEX.exec(text)) !== null) {
    // Add text before the marker
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    // Add the citation component
    const citationIndex = parseInt(match[1], 10);
    const citation = citationMap.get(citationIndex);
    if (citation) {
      parts.push(<InlineCitation key={`cite-${citationIndex}`} citation={citation} />);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/**
 * Create markdown components that handle inline citations
 */
function createMarkdownComponents(
  citationMap: Map<number, InlineCitationType>
): Components {
  // Helper to process children and render citations
  const processChildren = (children: React.ReactNode): React.ReactNode => {
    if (typeof children === 'string') {
      return renderTextWithCitations(children, citationMap);
    }
    if (Array.isArray(children)) {
      return children.map((child, i) =>
        typeof child === 'string' ? (
          <span key={i}>{renderTextWithCitations(child, citationMap)}</span>
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

interface MessageProps {
  message: MessageType;
  onFork?: () => void;
}

export function Message({ message, onFork }: MessageProps) {
  const isUser = message.role === 'user';
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const showCitations = useSettingsStore((state) => state.showCitations);

  // Process content with inline citations
  const { processedContent, markdownComponents } = useMemo(() => {
    // First, extract ChatGPT-style parenthesized citations from content
    const { content: contentWithoutChatGPTCitations, citations: chatGPTCitations } =
      extractChatGPTCitations(message.content, showCitations);

    // Get existing inline citations (from Claude/Gemini)
    const existingCitations = showCitations ? (message.inlineCitations || []) : [];

    // Insert citation markers for position-based citations
    const { content: processedContent, citationMap } = insertCitationMarkers(
      contentWithoutChatGPTCitations,
      existingCitations
    );

    // Add ChatGPT citations to the map (they already have markers from extractChatGPTCitations)
    chatGPTCitations.forEach((citation, idx) => {
      citationMap.set(existingCitations.length + idx, citation);
    });

    const markdownComponents = createMarkdownComponents(citationMap);
    return { processedContent, markdownComponents };
  }, [message.content, message.inlineCitations, showCitations]);

  const handleContextMenu = (e: React.MouseEvent) => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    const menuItems: ContextMenuItem[] = [];

    if (selectedText) {
      menuItems.push(
        {
          label: 'Copy',
          onClick: () => writeText(selectedText)
        },
        {
          label: 'Search Google',
          onClick: () => openUrl(`https://www.google.com/search?q=${encodeURIComponent(selectedText)}`)
        }
      );
    }

    if (isUser && onFork) {
      menuItems.push({ label: 'Fork from here', onClick: onFork });
    }

    if (menuItems.length > 0) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
    }
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`
          max-w-[85%] p-4
          ${isUser ? 'bg-amber-100 dark:bg-[#4a2518] rounded-2xl' : ''}
        `}
        onContextMenu={handleContextMenu}
      >
        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {message.attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="bg-black/20 rounded p-1"
              >
                {attachment.type === 'image' && attachment.preview ? (
                  <img
                    src={attachment.preview}
                    alt={attachment.name}
                    className="max-w-32 max-h-32 rounded"
                  />
                ) : (
                  <div className="flex items-center gap-1 px-2 py-1 text-sm">
                    <span>📎</span>
                    <span className="truncate max-w-24">{attachment.name}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Included discovery info */}
        {message.includedDiscovery && (
          <div className="bg-purple-600/30 rounded p-2 mb-2 text-sm border border-purple-500/50">
            <div className="flex items-center gap-1">
              <span className="font-medium">
                {message.includedDiscovery.title}
              </span>
            </div>
          </div>
        )}

        {/* Message content */}
        <div className="prose prose-sm prose-tight max-w-none prose-gray dark:prose-invert font-scalable">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {processedContent}
          </ReactMarkdown>
        </div>
      </div>

      {/* Context menu for copy/search/fork actions */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
