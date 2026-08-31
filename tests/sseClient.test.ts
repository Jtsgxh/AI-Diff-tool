import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRequestTimeoutSeconds } from '../shared/types';
import { readEventStream } from '../src/services/sseClient';

const encoder = new TextEncoder();

test('AI timeout configuration is finite and clamped', () => {
  assert.equal(resolveRequestTimeoutSeconds(undefined), 180);
  assert.equal(resolveRequestTimeoutSeconds(Number.NaN), 180);
  assert.equal(resolveRequestTimeoutSeconds(1), 20);
  assert.equal(resolveRequestTimeoutSeconds(999_999), 1800);
});

test('AI event stream completes when the terminal data event arrives', async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"status","message":"working"}\n\n'));
      controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
      controller.close();
    },
  }), { status: 200 });

  try {
    await readEventStream({
      url: '/fixture',
      body: {},
      signal: new AbortController().signal,
      idleTimeoutMs: 100,
      onEvent(event) {
        events.push(event.type);
        return event.type === 'done';
      },
    });
    assert.deepEqual(events, ['status', 'done']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keep-alive comments do not hide an AI event-stream stall', async () => {
  const originalFetch = globalThis.fetch;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, 5);
    },
    cancel() {
      if (keepAlive) clearInterval(keepAlive);
    },
  }), { status: 200 });

  try {
    await assert.rejects(
      readEventStream({
        url: '/fixture',
        body: {},
        signal: new AbortController().signal,
        idleTimeoutMs: 35,
        onEvent() {},
      }),
      /未收到 AI 进度/
    );
  } finally {
    if (keepAlive) clearInterval(keepAlive);
    globalThis.fetch = originalFetch;
  }
});

test('a proxy that never returns SSE headers is also timed out', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });

  try {
    await assert.rejects(
      readEventStream({
        url: '/fixture',
        body: {},
        signal: new AbortController().signal,
        idleTimeoutMs: 25,
        onEvent() {},
      }),
      /未建立 AI 流式连接/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
