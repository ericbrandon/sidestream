import { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { Message } from './Message';
import { StreamingMessage } from './StreamingMessage';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ExecutionIndicator } from './ExecutionIndicator';

export function MessageList() {
  const {
    messages,
    isStreaming,
    streamingContent,
    streamingThinking,
    streamingInlineCitations,
    sessionLoadedAt,
    streamingExecutionCode,
    streamingExecutionOutput,
    executionStatus,
  } = useChatStore();
  const forkFromMessage = useSessionStore((state) => state.forkFromMessage);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastUserMessageRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const streamingAreaRef = useRef<HTMLDivElement>(null);

  // Update spacer height based on content below the last user message
  useEffect(() => {
    const container = containerRef.current;
    const lastUserMessage = lastUserMessageRef.current;
    const spacer = spacerRef.current;

    if (container && lastUserMessage && spacer) {
      const containerHeight = container.clientHeight;
      const messageBottom = lastUserMessage.offsetTop + lastUserMessage.offsetHeight;
      const contentBelowMessage = container.scrollHeight - spacer.offsetHeight - messageBottom;

      // Spacer should fill remaining space after user message and any content below it
      const neededHeight = Math.max(0, containerHeight - lastUserMessage.offsetHeight - contentBelowMessage);
      spacer.style.height = `${neededHeight}px`;
    }
  }, [messages, streamingContent, streamingThinking, streamingExecutionCode, streamingExecutionOutput]);

  // Scroll to bottom when a session is loaded
  useEffect(() => {
    if (sessionLoadedAt && containerRef.current) {
      // Use setTimeout to ensure DOM has updated
      setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [sessionLoadedAt]);

  // Scroll to user message when a new one is added
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'user') {
      setTimeout(() => {
        if (lastUserMessageRef.current) {
          lastUserMessageRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
    }
  }, [messages]);

  // Keep streaming area scrolled into view as execution output grows
  useEffect(() => {
    if (streamingExecutionOutput && streamingAreaRef.current && containerRef.current) {
      // Scroll to keep the bottom of the streaming area visible
      const container = containerRef.current;
      const streamingArea = streamingAreaRef.current;
      const streamingBottom = streamingArea.offsetTop + streamingArea.offsetHeight;
      const containerBottom = container.scrollTop + container.clientHeight;

      // If the streaming area extends below the visible area, scroll down
      if (streamingBottom > containerBottom) {
        container.scrollTop = streamingBottom - container.clientHeight + 20; // 20px padding
      }
    }
  }, [streamingExecutionOutput]);

  // Find the last user message index
  let lastUserMessageIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserMessageIndex = i;
      break;
    }
  }

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="text-4xl mb-4 dark:opacity-70">💭</div>
          <p className="text-lg">Start a conversation</p>
          <p className="text-sm mt-2">
            Ask anything and discover resources along the way
          </p>
        </div>
      </div>
    );
  }

  // Determine what streaming state we're in
  const hasThinking = isStreaming && !!streamingThinking;
  const hasExecution = isStreaming && (executionStatus === 'running' || executionStatus === 'completed' || executionStatus === 'failed');
  const hasContent = isStreaming && !!streamingContent;
  const isWaitingForResponse = isStreaming && !streamingContent && !streamingThinking && executionStatus === 'idle';

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto p-4">
      {messages.map((message, index) => (
        <div
          key={message.id}
          ref={index === lastUserMessageIndex ? lastUserMessageRef : null}
        >
          <Message
            message={message}
            onFork={message.role === 'user' ? () => forkFromMessage(message.id) : undefined}
          />
        </div>
      ))}

      {/* Streaming response area - render all active indicators together */}
      {isStreaming && (
        <div ref={streamingAreaRef} className="streaming-response">
          {/* Thinking indicator - expanded when no content yet, collapsed otherwise */}
          {hasThinking && !hasContent && !hasExecution && (
            <ThinkingIndicator content={streamingThinking} />
          )}
          {hasThinking && (hasContent || hasExecution) && (
            <ThinkingIndicator content={streamingThinking} isThinkingComplete />
          )}

          {/* Execution indicator - show when execution is running or just completed (before content) */}
          {hasExecution && !hasContent && (
            <ExecutionIndicator
              code={streamingExecutionCode}
              output={streamingExecutionOutput}
            />
          )}

          {/* Streaming message content */}
          {hasContent && (
            <StreamingMessage content={streamingContent} inlineCitations={streamingInlineCitations} />
          )}

          {/* Pulsing dots when waiting for first response */}
          {isWaitingForResponse && (
            <div className="flex justify-start mb-4">
              <div className="max-w-[85%] p-4">
                <div className="flex items-center gap-1">
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
          )}
        </div>
      )}

      {/* Spacer to allow scrolling user message to top - height is set dynamically */}
      <div ref={spacerRef} />
    </div>
  );
}
