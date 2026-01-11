/**
 * Streaming content buffer that immediately flushes to React state.
 *
 * Previously this throttled updates, but since we now render markdown
 * on every update (and cache previous content), there's no benefit to
 * throttling - it just adds latency.
 */

interface StreamingBuffer {
  content: string;
  flushFn: ((content: string) => void) | null;
}

// Single global buffer instance
const buffer: StreamingBuffer = {
  content: '',
  flushFn: null,
};

/**
 * Initialize the buffer with a flush function (called once on component mount)
 */
export function initStreamingBuffer(flushFn: (content: string) => void): void {
  buffer.flushFn = flushFn;
}

/**
 * Append content to the buffer and immediately flush to React state.
 */
export function appendToStreamingBuffer(delta: string): void {
  buffer.content += delta;
  if (buffer.flushFn) {
    buffer.flushFn(buffer.content);
  }
}

/**
 * Clear the buffer (called when streaming ends)
 */
export function clearStreamingBuffer(): void {
  buffer.content = '';
}

/**
 * Flush the buffer (no-op now, but kept for API compatibility)
 */
export function flushStreamingBuffer(): void {
  // Immediate flushing means nothing to do here
}
