/**
 * One shared flush tick for everything driven by a token stream.
 *
 * Streamed tokens arrive faster than the screen can usefully repaint, so each
 * consumer batches them. But batching on its *own* timer makes the consumers
 * drift apart: the AI console and the review workbench are fed identical chunks
 * from the same handler, yet with independent 80ms/100ms timers only ~2% of
 * their updates landed in the same frame, leaving the two panes visibly out of
 * step by up to ~120ms mid-stream.
 *
 * Registering here instead means every pending flush runs in one task, so React
 * batches them into a single render and the panes always agree.
 */

const FLUSH_INTERVAL_MS = 80;

const pending = new Set<() => void>();
let handle: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function runPending(): void {
  handle = null;
  if (flushing) return;

  flushing = true;
  // Snapshot first: a callback may legitimately schedule itself for the next
  // tick, and that must not be swallowed by the clear below.
  const due = Array.from(pending);
  pending.clear();

  try {
    for (const flush of due) {
      try {
        flush();
      } catch (err) {
        // One broken consumer must not strand the others.
        console.error('Stream flush failed:', err);
      }
    }
  } finally {
    flushing = false;
  }
}

/** Queues `flush` for the next shared tick. Repeat calls coalesce. */
export function scheduleStreamFlush(flush: () => void): void {
  pending.add(flush);
  if (handle === null) {
    handle = setTimeout(runPending, FLUSH_INTERVAL_MS);
  }
}

/** Drops a queued flush — for a stream that finished or was aborted. */
export function cancelStreamFlush(flush: () => void): void {
  pending.delete(flush);
}

/**
 * Runs every queued flush immediately. Used for stream lifecycle transitions
 * (start, completion, error), where the delay would be perceptible and where
 * both panes must settle on the same final state together.
 */
export function flushStreamsNow(): void {
  if (handle !== null) {
    clearTimeout(handle);
    handle = null;
  }
  runPending();
}
