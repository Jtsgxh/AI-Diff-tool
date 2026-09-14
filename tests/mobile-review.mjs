// Run against Vite: NODE_PATH=<directory containing playwright> node tests/mobile-review.mjs
// API responses are intercepted in an isolated browser context; no model calls or repository writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.MOBILE_TEST_URL || 'http://localhost:5173';
const output = process.env.MOBILE_TEST_OUTPUT || join(tmpdir(), 'ai-diff-mobile-review');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.MOBILE_TEST_BROWSER || 'msedge', headless: true });
const errors = [];
let aiCalls = 0;
let releaseReview;
const reviewGate = new Promise((resolve) => { releaseReview = resolve; });
const fileNames = ['LongRepositoryServiceWithAVeryLongFileName.ts', 'second.ts'];
const content = Array.from({ length: 240 }, (_, i) => i === 5 ? `const longLine = '${'long code '.repeat(30)}';` : `const value${i + 1} = ${i + 1};`);
const files = fileNames.map((name) => ({
  oldPath: name, newPath: name, status: 'modified', additions: 3, deletions: 3,
  previewSource: { type: 'working-tree', path: name },
  diff: `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n` + [1, 101, 201].map((start) =>
    `@@ -${start},40 +${start},40 @@\n` + content.slice(start - 1, start + 39).map((line, i) => i === 0 ? `-const oldValue = 0;\n+${line}` : ` ${line}`).join('\n')
  ).join('\n'),
}));
const diff = { title: '手机布局回归提交', files, summary: { filesChanged: 2, insertions: 6, deletions: 6 } };
const commits = Array.from({ length: 20 }, (_, i) => ({ hash: String(i + 1).padStart(40, 'a'), shortHash: `abc000${i}`, message: `手机布局测试提交 ${i + 1}`, author: 'Test Author', authorEmail: 'test@example.invalid', date: '2026-09-14T00:00:00Z', parents: [], refs: i === 0 ? ['main'] : [] }));
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    localStorage.setItem('git_history_width', '380');
    localStorage.setItem('git_files_width', '240');
    localStorage.setItem('git_sidebar_collapsed', 'false');
    localStorage.setItem('git_files_panel_collapsed', 'false');
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json;
    if (path === '/api/repo/info') json = { path: '/fixture', name: 'Mobile Review Fixture', currentBranch: 'main', ahead: 0, behind: 0, isClean: false, modifiedFilesCount: 2, branches: ['main'], headHash: commits[0].hash };
    else if (path === '/api/repo/commits') json = { commits };
    else if (path.startsWith('/api/repo/diff/')) json = diff;
    else if (path === '/api/repo/file-preview') json = { path: fileNames[0], source: 'working-tree', content: content.join('\n'), lineCount: 240, byteSize: 6000, encoding: 'utf-8', isBinary: false, isTooLarge: false };
    else if (path === '/api/system/quick-paths') json = { shortcuts: [{ name: '工程', path: '/fixture' }], drives: [] };
    else if (path === '/api/system/browse') json = { current: '/fixture', parent: '/', isCurrentGitRepo: true, directories: [] };
    else if (path.startsWith('/api/ai/')) {
      aiCalls++;
      await reviewGate;
      return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ text: '手机测试报告：保留代码阅读位置。' })}\n\ndata: [DONE]\n\n` });
    } else throw new Error(`Unexpected API request: ${path}`);
    await route.fulfill({ json });
  });
  await page.goto(baseURL);
  const pane = (id) => page.locator(`[data-review-pane="${id}"]`);
  const nav = page.getByRole('navigation', { name: '手机审查导航' });
  const assertPane = async (id) => {
    await pane(id).waitFor({ state: 'visible' });
    for (const other of ['history', 'files', 'code', 'ai'].filter((p) => p !== id)) assert.equal(await pane(other).isVisible(), false, `${other} must be hidden`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page must not overflow horizontally');
  };
  await page.getByRole('button', { name: /手机布局测试提交 1 Test Author/ }).click();
  await assertPane('files');
  await pane('files').getByTitle('平铺文件列表视图').click();
  await pane('files').getByText(fileNames[0], { exact: true }).click();
  await assertPane('code');
  assert.equal(await pane('code').getByRole('separator').count(), 0, 'phone diff must be unified');
  await page.getByRole('button', { name: '下一个文件', exact: true }).click();
  assert.equal(await pane('code').getByTitle(fileNames[1]).count(), 1);
  await page.getByRole('button', { name: '上一个文件', exact: true }).click();
  await page.getByRole('button', { name: '下一处差异', exact: true }).click();
  await page.waitForTimeout(800);
  const scroll = pane('code').locator('.absolute.inset-0.overflow-auto');
  const checkHorizontalBackgrounds = async (scroller, label) => {
    await scroller.evaluate((el) => { el.scrollLeft = 600; });
    await page.screenshot({ path: join(output, `${label}-horizontal.png`) });
    const coverage = await scroller.evaluate((el) => {
      const viewport = el.getBoundingClientRect();
      // Short added, removed and context rows must cover the same scrollable canvas as long lines.
      const rows = [...el.querySelectorAll('.min-w-max.w-full')];
      return { offset: el.scrollLeft, rows: rows.length, uncovered: rows.filter((row) => row.getBoundingClientRect().right < viewport.right - 1).length };
    });
    assert.ok(coverage.offset > 0 && coverage.rows > 0, 'exercise horizontal scrolling with actual code rows');
    assert.equal(coverage.uncovered, 0, `${label}: row backgrounds must cover the viewport after horizontal scrolling`);
    await scroller.evaluate((el) => { el.scrollLeft = 0; });
  };
  await checkHorizontalBackgrounds(scroll, 'diff');
  assert.ok(await scroll.evaluate((el) => el.scrollTop > 0), 'diff hunk navigation scrolls');
  const oldScroll = await scroll.evaluate((el) => el.scrollTop);
  await nav.getByRole('button', { name: 'AI 审查', exact: true }).click();
  await assertPane('ai');
  await pane('ai').getByTitle('关闭抽屉').click();
  await assertPane('code');
  assert.equal(await scroll.evaluate((el) => el.scrollTop), oldScroll, 'code scroll survives AI roundtrip');
  await pane('code').getByRole('button', { name: '看全文', exact: true }).click();
  await pane('code').getByText('240 行', { exact: true }).waitFor();
  await checkHorizontalBackgrounds(pane('code').locator('.overflow-auto.pb-16'), 'full-file');
  await page.getByRole('button', { name: '下一处差异', exact: true }).click();
  await page.waitForTimeout(800);
  await pane('code').getByRole('button', { name: '看差异', exact: true }).click();
  await pane('code').locator('.mobile-diff-toolbar').getByText('更多', { exact: true }).click();
  await page.getByLabel('解释模式').selectOption('fast');
  await pane('code').locator('.mobile-diff-toolbar').getByText('更多', { exact: true }).click();
  await pane('code').getByRole('button', { name: 'AI 解释', exact: true }).click();
  await assertPane('ai');
  await nav.getByRole('button', { name: '代码', exact: true }).click();
  releaseReview();
  await page.waitForTimeout(600);
  await nav.getByRole('button', { name: 'AI 审查', exact: true }).click();
  await pane('ai').getByText('手机测试报告：保留代码阅读位置。', { exact: true }).waitFor();
  assert.equal(aiCalls, 1, 'navigation must not restart review');
  const input = pane('ai').locator('input');
  await input.fill('未发送的追问草稿');
  await nav.getByRole('button', { name: '代码', exact: true }).click();
  await nav.getByRole('button', { name: 'AI 审查', exact: true }).click();
  assert.equal(await input.inputValue(), '未发送的追问草稿');
  for (const width of [320, 390, 430, 767]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [id, name] of [['history', '提交'], ['files', '文件'], ['code', '代码'], ['ai', 'AI 审查']]) {
      await nav.getByRole('button', { name, exact: true }).click();
      await assertPane(id);
      if (id === 'code') {
        assert.equal(await pane('code').locator('.mobile-diff-toolbar').getByText('1/3', { exact: true }).count(), 1, 'hidden-pane resize must not corrupt hunk count');
        assert.ok(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth), 'long code scrolls inside the code pane');
      }
      await page.screenshot({ path: join(output, `${width}-${id}.png`) });
    }
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await assertPane('ai');
  await nav.waitFor({ state: 'visible' });
  await page.screenshot({ path: join(output, 'landscape.png') });
  await page.setViewportSize({ width: 390, height: 500 });
  const inputBox = await input.boundingBox();
  assert.ok(inputBox.y + inputBox.height <= 500, 'composer remains visible in short viewport');
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '未提交变更 (2)', exact: true }).click();
  await assertPane('files');
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: 'AI 引擎配置', exact: true }).click();
  await page.screenshot({ path: join(output, 'settings.png') });
  await page.locator('.settings-modal > div > div').first().getByRole('button').click();
  await page.getByRole('button', { name: '切换仓库', exact: true }).click();
  await page.screenshot({ path: join(output, 'repository.png') });
  await page.locator('.repo-modal > div > div').first().getByRole('button').click();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await nav.waitFor({ state: 'hidden' });
  assert.equal(await pane('history').evaluate((el) => el.getBoundingClientRect().width), 380);
  assert.equal(await pane('files').evaluate((el) => el.getBoundingClientRect().width), 240);
  assert.equal(await pane('code').getByRole('separator').count(), 1, 'desktop restores split view');
  assert.equal(await page.evaluate(() => localStorage.getItem('git_sidebar_collapsed')), 'false');
  assert.equal(await page.evaluate(() => localStorage.getItem('git_ai_explanation_open')), 'false');
  await page.screenshot({ path: join(output, 'desktop.png') });
  assert.deepEqual(errors, []);
  console.log(`PASS: mobile review navigation, unified diff/full file, review in background, draft/scroll preservation, 320–767px layouts, short viewport and desktop restoration. Screenshots: ${output}`);
} finally {
  releaseReview();
  await browser.close();
}


