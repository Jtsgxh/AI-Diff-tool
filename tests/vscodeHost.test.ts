import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { transformSync } from 'esbuild';

/** 在隔离页面环境中装载真实桥接代码，只替换 VS Code 的消息端点。 */
function page(hosted = true) {
  const messages: any[] = [];
  let receive: ((event: { data: unknown }) => void) | undefined;
  const module = { exports: {} as any };
  const source = transformSync(fs.readFileSync('src/services/vscodeHost.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(source, { module, exports: module.exports, Response, ReadableStream, TextEncoder, DOMException,
    acquireVsCodeApi: hosted ? () => ({ postMessage: (message: unknown) => messages.push(message) }) : undefined,
    window: { addEventListener: (_name: string, handler: typeof receive) => { receive = handler; } },
    document: { getElementById: () => ({ dataset: { vscode: JSON.stringify({ repoPath: 'test-repo', storage: { git_test: 'saved' } }) } }) },
    fetch: async (url: string) => new Response(`browser:${url}`),
  });
  return { api: module.exports, messages,
    /** 模拟宿主向页面发送一个真实协议帧。 */
    emit(message: unknown) { receive?.({ data: message }); } };
}

test('VS Code bridge preserves JSON and SSE chunks without using browser network', async () => {
  const p = page();
  assert.equal(p.api.initialVSCodeRepository, 'test-repo');
  const pending = p.api.hostFetch('/api/ai/explain/stream', { method: 'POST', body: '{"test":true}' });
  assert.equal(p.messages[0].path, '/api/ai/explain/stream');
  assert.equal(p.messages[0].method, 'POST');
  const id = p.messages[0].id;
  p.emit({ type: 'start', id, status: 200, headers: { 'content-type': 'text/event-stream' } });
  const response = await pending;
  p.emit({ type: 'data', id, data: 'data: {"content":"中文"}\n\n' });
  p.emit({ type: 'data', id, data: 'data: [DONE]\n\n' });
  p.emit({ type: 'end', id });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(await response.text(), 'data: {"content":"中文"}\n\ndata: [DONE]\n\n');
});

test('bridge cancellation aborts host request both before and after headers', async () => {
  const p = page();
  const before = new AbortController();
  const first = p.api.hostFetch('/api/repo/info', { signal: before.signal });
  before.abort();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(p.messages.at(-1).type, 'cancel');
  const after = new AbortController();
  const second = p.api.hostFetch('/api/ai/explain/stream', { signal: after.signal });
  const id = p.messages.at(-1).id;
  p.emit({ type: 'start', id, status: 200, headers: {} });
  const response = await second;
  after.abort();
  await assert.rejects(response.text(), { name: 'AbortError' });
  // 已取消请求的迟到帧必须被忽略。
  p.emit({ type: 'data', id, data: 'late' });
  p.emit({ type: 'end', id });
});

test('bridge reports transport errors and reader cancellation, while browser keeps its original fetch path', async () => {
  const p = page();
  const failed = p.api.hostFetch('/api/repo/info');
  p.emit({ type: 'error', id: p.messages[0].id, error: 'connection failed' });
  await assert.rejects(failed, /connection failed/);
  const stream = p.api.hostFetch('/api/ai/explain/stream');
  const id = p.messages.at(-1).id;
  p.emit({ type: 'start', id, status: 200, headers: {} });
  await (await stream).body.cancel();
  assert.equal(p.messages.at(-1).type, 'cancel');
  const browser = page(false);
  assert.equal(await (await browser.api.hostFetch('/api/repo/info')).text(), 'browser:/api/repo/info');
  assert.equal(browser.messages.length, 0);
});

test('hosted storage and file navigation use typed messages and a synchronous settings mirror', () => {
  const p = page();
  assert.equal(p.api.readHostStorage('git_test'), 'saved');
  assert.equal(p.api.writeHostStorage('git_test', 'updated'), true);
  assert.equal(p.api.readHostStorage('git_test'), 'updated');
  p.api.writeHostStorage('git_test', null);
  assert.equal(p.api.readHostStorage('git_test'), null);
  p.api.openVSCodeFile('repo', 'sample.ts', 'abc');
  assert.deepEqual(JSON.parse(JSON.stringify(p.messages.at(-1))), { type: 'openFile', repoPath: 'repo', filePath: 'sample.ts', revision: 'abc' });
  assert.equal(page(false).api.readHostStorage('git_test'), undefined);
});
