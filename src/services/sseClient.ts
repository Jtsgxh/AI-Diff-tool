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
  /** Maximum time to establish the HTTP/SSE response. */
  connectTimeoutMs?: number;
  /** Maximum time without a real `data:` event. Keep-alive comments do not reset it. */
  idleTimeoutMs?: number;
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
  connectTimeoutMs,
  idleTimeoutMs,
}: SseRequest): Promise<void> {
  const requestController = new AbortController();
  const abortFromCaller = () => requestController.abort();
  if (signal.aborted) requestController.abort();
  else signal.addEventListener('abort', abortFromCaller, { once: true });

  let firstByteTimedOut = false;
  let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
  if (connectTimeoutMs !== undefined) {
    firstByteTimer = setTimeout(() => {
      firstByteTimedOut = true;
      requestController.abort();
    }, connectTimeoutMs);
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let lastEventAt = Date.now();

  const emitLine = (line: string): boolean => {
    const trimmed = line.trim();
    // `:` prefixed frames are keep-alive comments.
    if (!trimmed || !trimmed.startsWith('data:')) return false;

    const dataStr = trimmed.slice(5).trim();
    if (!dataStr) return false;
    lastEventAt = Date.now();

    if (dataStr === '[DONE]') {
      return onEvent(SSE_DONE, dataStr) === true;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(dataStr);
    } catch {
      // Non-JSON payload: hand the raw text to the caller.
      return onEvent(undefined, dataStr) === true;
    }

    return onEvent(parsed, dataStr) === true;
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: requestController.signal,
    });
    if (firstByteTimer !== undefined) {
      clearTimeout(firstByteTimer);
      firstByteTimer = undefined;
    }
    lastEventAt = Date.now();

    if (!res.ok) {
      throw new SseHttpError(res.status, await res.text());
    }

    reader = res.body?.getReader();
    if (!reader) throw new Error('Readable stream not supported');

    while (true) {
      const remaining = idleTimeoutMs === undefined
        ? undefined
        : Math.max(0, idleTimeoutMs - (Date.now() - lastEventAt));
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const read = reader.read();
      const { done, value } = remaining === undefined
        ? await read
        : await Promise.race([
            read,
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                reject(new Error(`超过 ${Math.ceil(idleTimeoutMs! / 1000)} 秒未收到 AI 进度，已中止本次请求。`));
              }, remaining);
            }),
          ]).finally(() => {
            if (timeout !== undefined) clearTimeout(timeout);
          });
      if (value) buffer += decoder.decode(value, { stream: true });
      if (done) buffer += decoder.decode();

      const lines = buffer.split('\n');
      // Incomplete last line is held for the next chunk; flushed when done
      // so a hung-up server doesn't drop the final frame.
      buffer = done ? '' : lines.pop() || '';

      for (const line of lines) {
        if (emitLine(line)) return;
      }

      if (done) break;
    }
  } catch (err) {
    if (firstByteTimedOut && !signal.aborted) {
      throw new Error(`超过 ${Math.ceil(connectTimeoutMs! / 1000)} 秒未建立 AI 流式连接，已中止本次请求。`);
    }
    throw err;
  } finally {
    if (firstByteTimer !== undefined) clearTimeout(firstByteTimer);
    signal.removeEventListener('abort', abortFromCaller);
    requestController.abort();
    await reader?.cancel().catch(() => {});
    reader?.releaseLock?.();
  }
}
