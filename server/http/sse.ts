import type { Response } from 'express';

const KEEPALIVE_INTERVAL_MS = 8000;

/**
 * Thin wrapper around an Express response held open as an SSE stream.
 *
 * Beyond formatting, it owns two things that used to be missing or hand-rolled
 * per endpoint:
 *  - a keep-alive comment so proxies do not drop an idle stream;
 *  - an `AbortSignal` that fires when the browser goes away, which callers pass
 *    to their upstream `fetch` so a closed drawer stops paying for tokens.
 */
export class SseStream {
  private readonly res: Response;
  private readonly controller = new AbortController();
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(res: Response, options: { keepAlive?: boolean } = {}) {
    this.res = res;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Disable proxy buffering (nginx and friends) so tokens are not batched.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    res.on('close', () => {
      if (!this.closed) {
        this.closed = true;
        this.stopKeepAlive();
        this.controller.abort();
      }
    });

    if (options.keepAlive !== false) {
      this.keepAliveTimer = setInterval(() => {
        if (!this.res.writableEnded) {
          this.res.write(': keepalive\n\n');
        }
      }, KEEPALIVE_INTERVAL_MS);
    }
  }

  /** Aborted as soon as the client disconnects. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** True once the client hung up or the stream was closed locally. */
  get isClosed(): boolean {
    return this.closed || this.res.writableEnded;
  }

  /** Emits one `data:` frame carrying a JSON payload. */
  send(payload: unknown): void {
    if (this.isClosed) return;
    this.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  /** Emits a raw `data:` frame (used for the literal `[DONE]` sentinel). */
  sendRaw(data: string): void {
    if (this.isClosed) return;
    this.res.write(`data: ${data}\n\n`);
  }

  close(): void {
    this.stopKeepAlive();
    if (this.closed || this.res.writableEnded) {
      this.closed = true;
      return;
    }
    this.closed = true;
    this.res.end();
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
}

/**
 * Reads an OpenAI-compatible `text/event-stream` body and yields each decoded
 * JSON payload. Replaces the two hand-rolled reader loops that previously
 * lived in aiService and the client.
 */
export async function* readSseJson(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<any, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const dataStr = trimmed.slice(5).trim();
        if (!dataStr || dataStr === '[DONE]') continue;

        try {
          yield JSON.parse(dataStr);
        } catch {
          // Partial or non-JSON frame — skip it rather than killing the stream.
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock?.();
  }
}
