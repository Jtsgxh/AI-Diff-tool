import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 9238);
const captured = new Set();

/** 等待隔离原生测试窗口的检查点，不触碰用户正在编辑的工作区。 */
const pause = () => new Promise(resolve => setTimeout(resolve, 100));

for (let attempt = 0; attempt < 1200; attempt++) {
  try {
    const result = JSON.parse(await fs.readFile(path.join(root, 'result.json'), 'utf8'));
    assert.equal(result.passed, true, result.error);
    console.log('Native follow checks passed');
    process.exit(0);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let request;
  try { request = JSON.parse(await fs.readFile(path.join(root, 'capture-request.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await pause(); continue; }
  assert.match(request.name, /^[a-z-]+$/);
  if (captured.has(request.name)) { await pause(); continue; }
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find(item => item.url.startsWith('vscode-file:'));
  assert.ok(page, 'Isolated VS Code test renderer must be available');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    const call = pending.get(value.id);
    if (call) { pending.delete(value.id); value.error ? call.reject(value.error) : call.resolve(value.result); }
  });
  /** 仅通过指定测试端口读取 DOM 和截图，不改写原生模型或注入候选。 */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    const dom = await send('Runtime.evaluate', { expression: `JSON.stringify({
      ghost: [...document.querySelectorAll('.editor-instance [class*="ghost-text"]')]
        .filter(e => !e.querySelector('[class*="ghost-text"]') && e.getBoundingClientRect().height > 0)
        .map(e => ({text: e.innerText.replace(/\u00a0/g, ' '), y: e.getBoundingClientRect().y})),
      lines: [...document.querySelectorAll('.editor-instance .view-line')]
        .map(e => ({text: e.innerText.replace(/\u00a0/g, ' '), y: e.getBoundingClientRect().y}))
    })`, returnByValue: true });
    const state = JSON.parse(dom.result.value);
    await fs.writeFile(path.join(root, `${request.name}.json`), JSON.stringify(state, null, 2));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(root, `${request.name}.png`), Buffer.from(shot.data, 'base64'));
    if (request.expectedGhost !== undefined) {
      assert.equal(state.ghost.map(item => item.text).join(''), request.expectedGhost,
        'The ghost must contain only the added import or its untyped remainder');
      assert.ok(state.lines.some(item => item.text === request.existingLine), 'Existing import must remain a separate line');
      const existingY = state.lines.find(item => item.text === request.existingLine).y;
      assert.ok(state.ghost.every(item => item.y < existingY), 'Existing import must not be recolored as ghost code');
    }
    await fs.writeFile(path.join(root, `captured-${request.name}`), 'captured');
    captured.add(request.name);
    console.log(`Captured ${request.name}`);
  } finally { socket.close(); }
}
throw new Error('Native follow capture timed out');
