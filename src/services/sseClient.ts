/**
 * Shared plumbing for the two SSE endpoints.
 *
 * Both `streamExplainDiff` and `streamAgentExplainDiff` previously carried
 * their own near-identical 60-line fetch + reader + buffer + JSON.parse loop.
 * The transport lives here; callers supply only an event handler.
 */

export interface SseRequest {
  url: string;
  body: unknown;
  signal: AbortSignal;
  /**
   * Handles one decoded frame. Return `true` to stop reading — used for the
   * terminal `[DONE]` / `{type:'done'}` sentinels.
   */
  onEvent: (event: any, raw: string) => boolean | void;
}

/** Sentinel yielded to `onEvent` for a literal `data: [DONE]` frame. */
export const SSE_DONE = Symbol('sse-done');

export class SseHttpError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`AI Request Failed (${status}): ${body}`);
    this.name = 'SseHttpError';
  }
}

/**
 * Opens the stream and pumps frames into `onEvent` until the server closes,
 * the handler asks to stop, or the caller aborts. Resolves when reading ends.
 */
export async function readEventStream({
  url,
  body,
  signal,
  onEvent,
}: SseRequest): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    throw new SseHttpError(res.status, await res.text());
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Readable stream not supported');

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // The trailing element may be a partial line; hold it for the next chunk.
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        // `:` prefixed frames are keep-alive comments.
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const dataStr = trimmed.slice(5).trim();
        if (!dataStr) continue;

        if (dataStr === '[DONE]') {
          if (onEvent(SSE_DONE, dataStr) === true) return;
          continue;
        }

        let parsed: any;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          // Non-JSON payload: hand the raw text to the caller.
          if (onEvent(undefined, dataStr) === true) return;
          continue;
        }

        if (onEvent(parsed, dataStr) === true) return;
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}
