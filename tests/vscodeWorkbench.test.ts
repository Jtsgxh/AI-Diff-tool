import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { buildSync, transformSync } from 'esbuild';

/** 使用真实本地后端和资源文件，仅模拟 VS Code 面板 API。 */
function hostFixture() {
  const media = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-diff-webview-test-'));
  fs.mkdirSync(path.join(media, 'media'));
  fs.mkdirSync(path.join(media, 'out'));
  buildSync({ entryPoints: ['vscode/backend.ts'], outfile: path.join(media, 'out', 'backend.cjs'), bundle: true, platform: 'node', format: 'cjs' });
  fs.writeFileSync(path.join(media, 'media', 'index.html'), '<!doctype html><html><head><script type="module" src="./assets/index-fixture.js"></script><link href="./assets/index-fixture.css" rel="stylesheet"></head><body><div id="root"></div></body></html>');
  const receiveCallbacks: ((message: unknown) => void)[] = [];
  const frames: any[] = [];
  const state = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  const opened: unknown[][] = [];
  const createdPanels: unknown[] = [];
  let disposePanel: (() => void) | undefined;
  const panel = { webview: { html: '', cspSource: 'https://webview.test',
    asWebviewUri: (uri: { fsPath: string }) => ({ toString: () => `https://webview.test/${path.basename(uri.fsPath)}` }),
    onDidReceiveMessage: (callback: (message: unknown) => void) => { receiveCallbacks.push(callback); },
    postMessage: async (frame: unknown) => { frames.push(frame); return true; } },
    reveal() {}, onDidDispose: (callback: () => void) => { disposePanel = callback; },
    dispose() { disposePanel?.(); } };
  const native = { ViewColumn: { One: 1 }, Uri: { joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: path.join(base.fsPath, ...parts) }) },
    window: {
      /** 记录实际面板创建次数，检查异步加载和释放之间的边界。 */
      createWebviewPanel: () => { createdPanels.push(panel); return panel; },
      showErrorMessage() {}, showWarningMessage() {} } };
  const context = { extensionUri: { fsPath: media },
    globalState: { get: (key: string, fallback: unknown) => state.get(key) ?? fallback,
      update: async (key: string, value: unknown) => { state.set(key, value); } },
    secrets: { get: async (key: string) => secrets.get(key), store: async (key: string, value: string) => { secrets.set(key, value); },
      delete: async (key: string) => { secrets.delete(key); } } };
  const module = { exports: {} as any };
  const require = createRequire(path.resolve('package.json'));
  const code = transformSync(fs.readFileSync('vscode/workbench.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, Buffer, URL, TextDecoder, AbortController, fetch, process, setTimeout, clearTimeout,
    require: (id: string) => id === 'vscode' ? native : require(id) });
  const workbench = new module.exports.VSCodeWorkbench(context, async (...args: unknown[]) => { opened.push(args); });
  return { api: module.exports, panel, frames, state, secrets, opened, workbench, context, createdPanels,
    /** 清理隔离资源目录和真实本地监听，不依赖生产前端已经构建。 */
    dispose() {
      workbench.dispose();
      if (path.dirname(media) !== os.tmpdir() || !path.basename(media).startsWith('ai-diff-webview-test-')) throw new Error('Unsafe cleanup');
      fs.rmSync(media, { recursive: true, force: true });
    },
    /** 模拟页面消息进入宿主。 */
    emit(message: unknown) { receiveCallbacks.forEach((callback) => callback(message)); } };
}

/** 暂停 SecretStorage 读取，让测试确定性地停在真实后端就绪与面板创建之间。 */
function pauseSecrets(f: ReturnType<typeof hostFixture>) {
  let release!: () => void;
  let entered = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  /** 保留实际设置内容，只暂停读取完成时机。 */
  f.context.secrets.get = async (key: string) => {
    entered = true;
    await gate;
    return f.secrets.get(key);
  };
  return { release, entered: () => entered };
}

/** 读取真正写入 HTML 的初始化状态，不把早于页面加载的消息当作已送达。 */
function bootstrapFromHtml(html: string) {
  const attribute = html.match(/data-vscode="([^"]+)"/)?.[1];
  assert.ok(attribute, 'webview bootstrap must be present');
  return JSON.parse(attribute.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}

/** 等待宿主流完成；超时会使测试失败，不伪造后端响应。 */
async function waitUntil(predicate: () => boolean): Promise<void> {
  const end = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Host response timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('workbench validates API destinations and safely rewrites real webview resources', async (t) => {
  const f = hostFixture();
  t.after(() => f.dispose());
  assert.throws(() => f.api.apiRequestUrl('http://127.0.0.1:4000', 'https://outside.test/api/repo/info'));
  assert.throws(() => f.api.apiRequestUrl('http://127.0.0.1:4000', '/api/../private'));
  assert.throws(() => f.api.apiRequestUrl('http://127.0.0.1:4000', '//outside.test/api/repo/info'));
  assert.equal(f.api.escapeAttribute('<"&>'), '&lt;&quot;&amp;&gt;');
  await f.workbench.open('repo"<>&');
  assert.match(f.panel.webview.html, /Content-Security-Policy/);
  assert.match(f.panel.webview.html, /script nonce="[a-f0-9]+"/);
  assert.match(f.panel.webview.html, /https:\/\/webview\.test\/index-[^"<>]+\.js/);
  assert.doesNotMatch(f.panel.webview.html, /src="\.\/assets/);
  assert.match(f.panel.webview.html, /repo\\&quot;&lt;&gt;&amp;/);
  assert.doesNotMatch(f.panel.webview.html, /x-ai-diff-token/);
  f.emit({ type: 'request', id: 1, method: 'GET', path: '/api/system/quick-paths' });
  await waitUntil(() => f.frames.some((frame) => frame.id === 1 && frame.type === 'end'));
  assert.equal(f.frames.find((frame) => frame.type === 'start').status, 200);
  const body = f.frames.filter((frame) => frame.type === 'data').map((frame) => frame.data).join('');
  assert.ok(Array.isArray(JSON.parse(body).shortcuts));
  f.emit({ type: 'request', id: 2, method: 'GET', path: 'https://outside.test/api/repo/info' });
  await waitUntil(() => f.frames.some((frame) => frame.id === 2 && frame.type === 'error'));
});

test('workbench stores AI settings in SecretStorage and forwards explicit file navigation', async (t) => {
  const f = hostFixture();
  t.after(() => f.dispose());
  await f.workbench.open('repo');
  f.emit({ type: 'storage', key: 'git_ai_config', value: '{"apiKey":"private"}' });
  f.emit({ type: 'storage', key: 'git_test', value: 'normal setting' });
  f.emit({ type: 'openFile', repoPath: 'repo', filePath: 'file.ts', revision: 'sha' });
  await waitUntil(() => f.state.has('webviewStorage') && f.opened.length === 1);
  assert.equal(f.secrets.get('webviewAIConfig'), '{"apiKey":"private"}');
  assert.equal((f.state.get('webviewStorage') as any).git_ai_config, undefined);
  assert.equal((f.state.get('webviewStorage') as any).git_test, 'normal setting');
  assert.deepEqual(f.opened[0], ['repo', 'file.ts', 'sha']);
});

/** 异步资源尚未返回时释放工作台，不能再创建孤立面板或接受后续打开。 */
test('disposing during asynchronous creation prevents a late panel and rejects later opens', async (t) => {
  const f = hostFixture();
  const paused = pauseSecrets(f);
  t.after(() => { paused.release(); f.dispose(); });
  const opening = f.workbench.open('repo', 'first');
  await waitUntil(paused.entered);
  f.workbench.dispose();
  paused.release();
  await assert.rejects(opening, /关闭/);
  assert.equal(f.createdPanels.length, 0, 'a disposed workbench cannot create an orphaned panel');
  await assert.rejects(f.workbench.open('repo', 'later'), /关闭/);
  assert.equal(f.createdPanels.length, 0);
});

/** 连续打开共用同一面板，但其初始仓库和提交必须采用最后一次请求。 */
test('rapid opens use the latest repository and revision in the initial page bootstrap', async (t) => {
  const f = hostFixture();
  const paused = pauseSecrets(f);
  t.after(() => { paused.release(); f.dispose(); });
  const first = f.workbench.open('first-repo', 'first-revision');
  await waitUntil(paused.entered);
  const latest = f.workbench.open('latest-repo', 'latest-revision');
  paused.release();
  await Promise.all([first, latest]);
  assert.equal(f.createdPanels.length, 1, 'concurrent opens share a single panel');
  const bootstrap = bootstrapFromHtml(f.panel.webview.html);
  assert.equal(bootstrap.repoPath, 'latest-repo');
  assert.equal(bootstrap.revision, 'latest-revision');
  await f.workbench.open('visible-repo', 'visible-revision');
  assert.equal(f.createdPanels.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.frames.at(-1))), { type: 'selectRevision', repoPath: 'visible-repo', revision: 'visible-revision' });
});

/** 创建期间的步骤更新应进入初始页面数据，不能依赖未加载页面接收消息。 */
test('step changes arriving during creation are included without relying on an unloaded page', async (t) => {
  const f = hostFixture();
  const paused = pauseSecrets(f);
  t.after(() => { paused.release(); f.dispose(); });
  const opening = f.workbench.open('practice', 'before');
  await waitUntil(paused.entered);
  f.workbench.updateReference('practice', 'after');
  paused.release();
  await opening;
  assert.equal(f.createdPanels.length, 1);
  assert.equal(bootstrapFromHtml(f.panel.webview.html).revision, 'after');
});
