/**
 * Streaming content buffer with throttled flush to React state.
 *
 * This accumulates streaming deltas and only flushes to the store
 * at most every THROTTLE_MS milliseconds. This dramatically reduces
 * React re-renders during streaming, improving performance.
 */

// Throttle interval for flushing buffered content to React state
const THROTTLE_MS = 50;

interface StreamingBuffer {
  content: string;
  lastFlush: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  flushFn: ((content: string) => void) | null;
}

// Single global buffer instance
const buffer: StreamingBuffer = {
  content: '',
  lastFlush: 0,
  flushTimer: null,
  flushFn: null,
};

/**
 * Initialize the buffer with a flush function (called once on component mount)
 */
export function initStreamingBuffer(flushFn: (content: string) => void): void {
  buffer.flushFn = flushFn;
}

/**
 * Append content to the buffer. Will be flushed to React state
 * either immediately (if enough time has passed) or after THROTTLE_MS.
 */
export function appendToStreamingBuffer(delta: string): void {
  buffer.content += delta;
  scheduleFlush();
}

/**
 * Clear the buffer (called when streaming ends)
 */
export function clearStreamingBuffer(): void {
  buffer.content = '';
  buffer.lastFlush = 0;
  if (buffer.flushTimer) {
    clearTimeout(buffer.flushTimer);
    buffer.flushTimer = null;
  }
}

/**
 * Force an immediate flush (used before finalization)
 */
export function flushStreamingBuffer(): void {
  flushNow();
}

function scheduleFlush(): void {
  const now = Date.now();
  const timeSinceLastFlush = now - buffer.lastFlush;

  // Clear any pending flush
  if (buffer.flushTimer) {
    clearTimeout(buffer.flushTimer);
    buffer.flushTimer = null;
  }

  if (timeSinceLastFlush >= THROTTLE_MS) {
    // Enough time has passed, flush immediately
    flushNow();
  } else {
    // Schedule a flush for later
    buffer.flushTimer = setTimeout(() => {
      flushNow();
    }, THROTTLE_MS - timeSinceLastFlush);
  }
}

function flushNow(): void {
  if (buffer.flushTimer) {
    clearTimeout(buffer.flushTimer);
    buffer.flushTimer = null;
  }

  if (buffer.flushFn && buffer.content) {
    buffer.flushFn(buffer.content);
    buffer.lastFlush = Date.now();
  }
}
