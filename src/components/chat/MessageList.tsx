import { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { Message } from './Message';
import { StreamingMessage } from './StreamingMessage';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ExecutionIndicator } from './ExecutionIndicator';

export function MessageList() {
  // Use individual selectors to avoid re-rendering when unrelated state (like inputValue) changes
  const messages = useChatStore((state) => state.messages);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const streamingContent = useChatStore((state) => state.streamingContent);
  const streamingThinking = useChatStore((state) => state.streamingThinking);
  const streamingInlineCitations = useChatStore((state) => state.streamingInlineCitations);
  const sessionLoadedAt = useChatStore((state) => state.sessionLoadedAt);
  const streamingExecutionCode = useChatStore((state) => state.streamingExecutionCode);
  const streamingExecutionOutput = useChatStore((state) => state.streamingExecutionOutput);

  const forkFromMessage = useSessionStore((state) => state.forkFromMessage);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastUserMessageRef = useRef<HTMLDivElement>(null);
  const streamingAreaRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);

  // Track whether we should scroll on next user message
  const prevMessageCountRef = useRef<number>(0);
  // Track session to distinguish load vs new message
  const lastSessionLoadRef = useRef<number | null>(null);

  // Scroll to bottom of content when a session is loaded from history
  useEffect(() => {
    if (sessionLoadedAt && sessionLoadedAt !== lastSessionLoadRef.current) {
      lastSessionLoadRef.current = sessionLoadedAt;
      // Reset message count so we don't trigger user message scroll
      prevMessageCountRef.current = messages.length;

      // Scroll to show last message at bottom (not into the spacer)
      requestAnimationFrame(() => {
        const container = containerRef.current;
        const spacer = spacerRef.current;
        if (container && spacer) {
          // Content height is total scroll height minus the spacer
          const contentHeight = container.scrollHeight - spacer.offsetHeight;
          // Scroll so content bottom aligns with viewport bottom
          const targetScroll = Math.max(0, contentHeight - container.clientHeight);
          container.scrollTop = targetScroll;
        }
      });
    }
  }, [sessionLoadedAt, messages.length]);

  // Scroll user message to top when a NEW message is added (not on session load)
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    const currentCount = messages.length;
    prevMessageCountRef.current = currentCount;

    // Only scroll if exactly one message was added and it's a user message
    const lastMessage = messages[messages.length - 1];
    if (currentCount === prevCount + 1 && lastMessage?.role === 'user') {
      requestAnimationFrame(() => {
        if (lastUserMessageRef.current) {
          // Use scrollIntoView to position the message at the start of the viewport
          lastUserMessageRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      });
    }
  }, [messages]);

  // Keep streaming area visible as content grows
  useEffect(() => {
    if (isStreaming && streamingAreaRef.current && containerRef.current) {
      const container = containerRef.current;
      const streamingArea = streamingAreaRef.current;
      const streamingBottom = streamingArea.offsetTop + streamingArea.offsetHeight;
      const containerBottom = container.scrollTop + container.clientHeight;

      // If streaming content extends below visible area, scroll to keep it visible
      if (streamingBottom > containerBottom) {
        container.scrollTop = streamingBottom - container.clientHeight + 20;
      }
    }
  }, [isStreaming, streamingContent, streamingThinking, streamingExecutionCode, streamingExecutionOutput]);

  // Find the last user message index for ref assignment
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
  const hasExecutionData = isStreaming && !!streamingExecutionCode;
  const hasContent = isStreaming && !!streamingContent;
  const isWaitingForResponse = isStreaming && !streamingContent && !streamingThinking && !streamingExecutionCode;

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4">
      {messages.map((message, index) => (
        <div
          key={message.id}
          ref={index === lastUserMessageIndex ? lastUserMessageRef : null}
        >
          <Message
            message={message}
            onFork={message.role === 'user' ? forkFromMessage : undefined}
          />
        </div>
      ))}

      {/* Streaming response area - render all active indicators together */}
      {isStreaming && (
        <div ref={streamingAreaRef} className="streaming-response">
          {/* Thinking indicator - expanded when alone, collapsed when other content present */}
          {hasThinking && !hasContent && !hasExecutionData && (
            <ThinkingIndicator content={streamingThinking} />
          )}
          {hasThinking && (hasContent || hasExecutionData) && (
            <ThinkingIndicator content={streamingThinking} isThinkingComplete />
          )}

          {/* Execution indicator - always show expanded during streaming if we have execution data */}
          {hasExecutionData && (
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

      {/*
        Spacer to allow scrolling user message to top of viewport.
        Height equals viewport height so the last user message can scroll to the top.
      */}
      <div ref={spacerRef} className="h-[calc(100vh-12rem)]" aria-hidden="true" />
    </div>
  );
}
