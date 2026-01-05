import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Message, DiscoveryItem } from '../../lib/types';
import type { DiscoveryModeId } from '../../lib/discoveryModes';
import { groupMessagesIntoTurns, stripCiteTags } from '../../lib/chatUtils';
import { getDiscoveryMode } from '../../lib/discoveryModes';

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

export function PrintableChat({ messages, discoveryItems, expandAll = false }: PrintableChatProps) {
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
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
              >
                {turn.userMessage.content}
              </ReactMarkdown>
            </div>
          </div>

          {/* Assistant message */}
          {turn.assistantMessage && (
            <div className="assistant-message bg-gray-50 rounded-lg p-4 mb-4">
              <div className="prose prose-base max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {turn.assistantMessage.content}
                </ReactMarkdown>
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
