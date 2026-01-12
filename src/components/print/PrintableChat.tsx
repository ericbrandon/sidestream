import { useMemo } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Message, DiscoveryItem, InlineCitation as InlineCitationType } from '../../lib/types';
import { isImageFile } from '../../lib/types';
import type { DiscoveryModeId } from '../../lib/discoveryModes';
import { groupMessagesIntoTurns, stripCiteTags } from '../../lib/chatUtils';
import { getDiscoveryMode } from '../../lib/discoveryModes';
import { useSettingsStore } from '../../stores/settingsStore';
import { CITATION_MARKER_REGEX, insertCitationMarkers, extractChatGPTCitations, stripSandboxUrls, stripAnthropicFileUrls, stripGeminiLocalFileRefs } from '../chat/citationUtils';
import { PrintableInlineCitation } from './PrintableInlineCitation';

interface PrintableChatProps {
  messages: Message[];
  discoveryItems: DiscoveryItem[];
  expandAll?: boolean;
}

// Group discovery items by their modeId, preserving order of first appearance
// Falls back to 'useful-informative' for items created before modeId was added
function groupItemsByMode(items: DiscoveryItem[]): Map<DiscoveryModeId, DiscoveryItem[]> {
  const groups = new Map<DiscoveryModeId, DiscoveryItem[]>();
  for (const item of items) {
    const modeId = item.modeId || 'useful-informative';
    const existing = groups.get(modeId);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(modeId, [item]);
    }
  }
  return groups;
}

/**
 * Render text with inline citations for printable output.
 * Parses citation markers and replaces them with PrintableInlineCitation components.
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
      parts.push(<PrintableInlineCitation key={`cite-${citationIndex}`} citation={citation} />);
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
 * Create markdown components that handle inline citations for printable output
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
    // Table cells need citation processing too
    td: ({ children }) => <td>{processChildren(children)}</td>,
    th: ({ children }) => <th>{processChildren(children)}</th>,
    hr: () => <hr className="my-4 border-gray-300" />,
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:text-blue-800 underline"
      >
        {processChildren(children)}
      </a>
    ),
  };
}

/**
 * Process message content with citations.
 * Returns the processed content and markdown components for rendering.
 */
function processMessageWithCitations(
  message: Message,
  showCitations: boolean
): { processedContent: string; markdownComponents: Components } {
  // First, strip OpenAI sandbox: URLs (files are shown via generated file sections)
  let strippedContent = stripSandboxUrls(message.content);
  // Strip Anthropic /files/output/ URLs (files are shown via generated file sections)
  strippedContent = stripAnthropicFileUrls(strippedContent);
  // Also strip Gemini local file references (files are shown via generated file sections)
  strippedContent = stripGeminiLocalFileRefs(strippedContent);

  // Then extract ChatGPT-style parenthesized citations from content
  const { content: contentWithoutChatGPTCitations, citations: chatGPTCitations } =
    extractChatGPTCitations(strippedContent, showCitations);

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
}

/**
 * Component to render a single message with citation support and generated files
 */
function PrintableMessage({ message, showCitations }: { message: Message; showCitations: boolean }) {
  const { processedContent, markdownComponents } = useMemo(
    () => processMessageWithCitations(message, showCitations),
    [message, showCitations]
  );

  // Separate image files from other files
  const imageFiles = message.generatedFiles?.filter(isImageFile) || [];
  const otherFiles = message.generatedFiles?.filter(f => !isImageFile(f)) || [];

  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >
        {processedContent}
      </ReactMarkdown>

      {/* Generated images - render inline if we have the preview data */}
      {imageFiles.length > 0 && (
        <div className="mt-4 space-y-4">
          {imageFiles.map((file) => (
            <div key={file.file_id} className="generated-image">
              {file.image_preview ? (
                <img
                  src={file.image_preview}
                  alt={file.filename}
                  className="max-w-full rounded-lg"
                  style={{ pageBreakInside: 'avoid' }}
                />
              ) : (
                <div className="bg-gray-200 rounded-lg p-4 text-gray-500 text-sm">
                  Image: {file.filename} (not loaded)
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Other generated files - show as simple list */}
      {otherFiles.length > 0 && (
        <div className="mt-4 space-y-2">
          {otherFiles.map((file) => (
            <div
              key={file.file_id}
              className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-gray-700 inline-block mr-2"
            >
              {file.filename}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function PrintableChat({ messages, discoveryItems, expandAll = false }: PrintableChatProps) {
  const showCitations = useSettingsStore((state) => state.showCitations);
  const turns = groupMessagesIntoTurns(messages, discoveryItems);

  if (turns.length === 0) {
    return null;
  }

  return (
    <div className="printable-chat hidden print:block">
      {/* Header */}
      <div className="print-header mb-8">
        <h1 className="text-3xl font-bold mb-2">Chat Export</h1>
        <p className="text-gray-500 text-base">{new Date().toLocaleString()}</p>
      </div>

      {/* Conversation turns */}
      {turns.map((turn, turnIndex) => (
        <div key={turn.userMessage.id} className="turn mb-8">
          {/* User message */}
          <div className="user-message bg-amber-50 rounded-lg p-4 mb-4">
            <div className="prose prose-base max-w-none">
              <PrintableMessage message={turn.userMessage} showCitations={showCitations} />
            </div>
          </div>

          {/* Assistant message */}
          {turn.assistantMessage && (
            <div className="assistant-message bg-gray-50 rounded-lg p-4 mb-4">
              <div className="prose prose-base max-w-none">
                <PrintableMessage message={turn.assistantMessage} showCitations={showCitations} />
              </div>
            </div>
          )}

          {/* Discovery items for this turn, grouped by mode */}
          {turn.discoveryItems.length > 0 && (
            <>
              {Array.from(groupItemsByMode(turn.discoveryItems)).map(([modeId, items]) => {
                const modeConfig = getDiscoveryMode(modeId);
                return (
                  <div key={modeId} className="discovery-section mt-6">
                    {/* Section banner with correct mode title */}
                    <div className="bg-purple-100 rounded-t px-3 py-1.5 mb-0">
                      <span className="text-base font-bold text-purple-700">
                        {modeConfig.sectionTitle}
                      </span>
                    </div>
                    {items.map((item) => (
                      <details
                        key={item.id}
                        className="discovery-item border-2 border-purple-200 rounded-lg mb-3 bg-purple-50"
                        open={expandAll || undefined}
                      >
                        {/* One-liner as the summary (visible when collapsed) */}
                        <summary className="font-semibold text-base text-gray-700 p-4 cursor-pointer hover:bg-purple-100 rounded-lg">
                          {stripCiteTags(item.oneLiner || item.title)}
                        </summary>
                        {/* Expanded content */}
                        <div className="px-4 pb-4">
                          {/* Full summary */}
                          <p className="text-base text-gray-600 mb-3">
                            {stripCiteTags(item.fullSummary)}
                          </p>
                          {/* Why relevant section */}
                          {item.relevanceExplanation && (
                            <div className="mb-2">
                              <span className="text-base font-bold text-orange-600">Why relevant:</span>
                              <span className="text-base text-gray-500 ml-1">
                                {stripCiteTags(item.relevanceExplanation)}
                              </span>
                            </div>
                          )}
                          {/* Source link */}
                          <a
                            href={item.sourceUrl}
                            className="text-base text-blue-600 hover:underline"
                          >
                            {item.sourceDomain}
                          </a>
                        </div>
                      </details>
                    ))}
                  </div>
                );
              })}
            </>
          )}

          {/* Turn separator (except for last turn) */}
          {turnIndex < turns.length - 1 && (
            <hr className="border-gray-300 my-6" />
          )}
        </div>
      ))}
    </div>
  );
}
