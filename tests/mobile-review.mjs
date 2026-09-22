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
let naturalLanguageCalls = 0;
const batchRequests = [];
const clearRequests = [];
const clearLanes = [];
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
  context.setDefaultTimeout(10000);
  await context.addInitScript(() => {
    localStorage.setItem('git_history_width', '380');
    localStorage.setItem('git_files_width', '240');
    localStorage.setItem('git_sidebar_collapsed', 'false');
    localStorage.setItem('git_files_panel_collapsed', 'false');
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json;
    if (path === '/api/repo/info') json = { path: new URL(route.request().url()).searchParams.get('path') === '/other-fixture' ? '/other-fixture' : '/fixture', name: 'Mobile Review Fixture', currentBranch: 'main', ahead: 0, behind: 0, isClean: false, modifiedFilesCount: 2, branches: ['main'], headHash: commits[0].hash };
    else if (path === '/api/repo/commits') json = { commits };
    else if (path.startsWith('/api/repo/diff/')) {
      if (path === '/api/repo/diff/batch') batchRequests.push(route.request().postDataJSON().commitHashes);
      json = diff;
    }
    else if (path === '/api/repo/file-preview') json = { path: fileNames[0], source: 'working-tree', content: content.join('\n'), lineCount: 240, byteSize: 6000, encoding: 'utf-8', isBinary: false, isTooLarge: false };
    else if (path === '/api/system/quick-paths') json = { shortcuts: [{ name: '工程', path: '/fixture' }], drives: [] };
    else if (path === '/api/system/browse') json = { current: '/fixture', parent: '/', isCurrentGitRepo: true, directories: [] };
    else if (path === '/api/repo/overview') json = { fileCount: 0, languages: [], topDirs: [], manifests: [], entryCandidates: [] };
    else if (path === '/api/repo/learn-graph') return route.fulfill({ status: 503, json: { error: '本用例只验证学习对话清除入口' } });
    else if (path === '/api/ai/conversation/clear') {
      clearRequests.push(route.request().postDataJSON().repoPath);
      clearLanes.push(route.request().postDataJSON().lane);
      json = { cleared: true };
    }
    else if (path.startsWith('/api/ai/')) {
      const payload = route.request().postDataJSON();
      assert.equal(payload.repoPath, '/fixture', '块分析必须发送所属仓库');
      aiCalls++;
      await reviewGate;
      if (payload.task === 'natural_language' && ++naturalLanguageCalls === 1) {
        return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ error: '等待模型开始响应超过 35 秒' })}\n\n` });
      }
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
  const commitButton = (number) => pane('history').getByRole('button', { name: new RegExp(`手机布局测试提交 ${number} Test Author`) });
  await pane('history').getByRole('button', { name: '选范围', exact: true }).click();
  await commitButton(3).tap();
  await page.getByRole('textbox', { name: '搜索提交', exact: true }).fill('测试提交 1');
  await commitButton(1).tap();
  await pane('history').getByText('已选 3 个连续提交，包含起点和终点。', { exact: true }).waitFor();
  assert.equal(batchRequests.length, 0, 'picking endpoints must not fetch before confirmation');
  await page.getByRole('textbox', { name: '搜索提交', exact: true }).fill('');
  await page.screenshot({ path: join(output, 'commit-range.png') });
  await pane('history').getByRole('button', { name: '查看选中 3 个提交', exact: true }).tap();
  await assertPane('files');
  await pane('files').getByText(fileNames[0], { exact: true }).waitFor();
  assert.deepEqual(batchRequests, [commits.slice(0, 3).map((c) => c.hash)], 'reverse endpoints include hidden intermediate commits in original order');
  await nav.getByRole('button', { name: '提交', exact: true }).click();
  await pane('history').getByRole('button', { name: '选范围', exact: true }).click();
  await commitButton(2).tap();
  await commitButton(4).tap();
  await pane('history').getByRole('button', { name: '取消范围选择', exact: true }).click();
  assert.equal(batchRequests.length, 1, 'cancelled range must not fetch');
  await commitButton(1).click();
  await assertPane('files');
  await pane('files').getByTitle('平铺文件列表视图').click();
  await pane('files').getByText(fileNames[0], { exact: true }).click();
  await assertPane('code');
  const toggleWrap = async () => {
    await pane('code').getByLabel('文件的更多操作', { exact: true }).click();
    await page.getByRole('button', { name: '代码自动换行', exact: true }).click();
  };
  const codeBox = await pane('code').locator('.diff-code-scroll').boundingBox();
  assert.ok(codeBox.y <= 136, 'phone chrome above code stays compact');
  assert.ok(codeBox.height >= 660, 'phone leaves most of its height for code');
  assert.ok((await nav.boundingBox()).height <= 45, 'bottom navigation uses a single row');
  const assertWrappedCode = async (label) => {
    assert.equal(await pane('code').locator('[aria-label="代码自动换行"]').getAttribute('aria-pressed'), 'true');
    const geometry = await pane('code').locator('.diff-code-scroll').evaluate((el) => ({ width: el.clientWidth, content: el.scrollWidth }));
    assert.ok(geometry.content <= geometry.width + 1, `${label}: wrapped code must fit phone width`);
    const longLine = pane('code').locator('.diff-line-content').filter({ hasText: 'const longLine' });
    assert.equal(await longLine.textContent(), content[5], 'wrapping must preserve complete code text');
    assert.ok((await longLine.boundingBox()).height > 20, 'long line actually wraps');
    await page.screenshot({ path: join(output, `${label}-wrapped.png`) });
  };
  await assertWrappedCode('diff-390');
  await page.setViewportSize({ width: 320, height: 844 });
  await assertWrappedCode('diff-320');
  await page.setViewportSize({ width: 390, height: 844 });
  await toggleWrap();
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
  await toggleWrap();
  await assertWrappedCode('full-file');
  await toggleWrap();
  await checkHorizontalBackgrounds(pane('code').locator('.overflow-auto.pb-16'), 'full-file');
  await page.getByRole('button', { name: '下一处差异', exact: true }).click();
  await page.waitForTimeout(800);
  await pane('code').getByRole('button', { name: '看差异', exact: true }).click();
  await pane('code').locator('.mobile-diff-toolbar').getByText('更多', { exact: true }).click();
  await page.getByLabel('解释模式').selectOption('fast');
  assert.equal(await pane('code').locator('.mobile-diff-toolbar details[open]').count(), 0, 'choosing a mode closes the menu');
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
  await nav.getByRole('button', { name: '代码', exact: true }).click();
  await scroll.evaluate((el) => { el.scrollTop = 0; });
  const firstHunk = pane('code').locator('[data-diff-hunk-index="1"]');
  const hunkMenu = firstHunk.locator('details');
  const openHunkMenu = () => firstHunk.getByLabel('改动块 1 的更多操作').tap();
  const assertMenuClosed = async (reason) => assert.equal(await hunkMenu.getAttribute('open'), null, reason);
  await openHunkMenu();
  await hunkMenu.getByRole('button', { name: '选择此块', exact: true }).tap();
  await assertMenuClosed('selection action closes the hunk menu');
  await openHunkMenu();
  await hunkMenu.getByRole('button', { name: '取消选择此块', exact: true }).tap();
  await assertMenuClosed('deselection closes the hunk menu');
  await openHunkMenu();
  await pane('code').locator('.diff-line-content').first().tap();
  await assertMenuClosed('outside touch closes the hunk menu');
  await openHunkMenu();
  await page.keyboard.press('Escape');
  await assertMenuClosed('Escape closes the hunk menu');
  // A block explanation occupies its own right-hand page, never a row above code.
  await toggleWrap();
  const hunkHeightBeforeExplanation = (await firstHunk.boundingBox()).height;
  await openHunkMenu();
  await hunkMenu.getByRole('button', { name: '展开块释义', exact: true }).tap();
  await assertMenuClosed('inline explanation closes the hunk menu');
  await firstHunk.getByText('块释义生成失败：等待模型开始响应超过 35 秒', { exact: true }).waitFor();
  await openHunkMenu();
  await hunkMenu.getByRole('button', { name: '重试块释义', exact: true }).tap();
  await assertMenuClosed('retrying a failed inline explanation closes the hunk menu');
  await firstHunk.getByText('手机测试报告：保留代码阅读位置。', { exact: true }).waitFor();
  assert.equal(naturalLanguageCalls, 2, 'failed inline explanation can issue a fresh request');
  const hunkPager = firstHunk.locator('.hunk-explanation-pages');
  const sideGeometry = await firstHunk.evaluate((el) => {
    const code = el.querySelector('.hunk-code-page').getBoundingClientRect();
    const explanation = el.querySelector('.hunk-explanation-page').getBoundingClientRect();
    return { codeTop: code.top, explanationTop: explanation.top, codeRight: code.right, explanationLeft: explanation.left, height: el.getBoundingClientRect().height };
  });
  assert.ok(Math.abs(sideGeometry.codeTop - sideGeometry.explanationTop) < 1, 'explanation aligns alongside code');
  assert.ok(sideGeometry.explanationLeft >= sideGeometry.codeRight - 1, 'explanation is to the right of code');
  assert.ok(Math.abs(sideGeometry.height - hunkHeightBeforeExplanation) < 2, 'explanation does not push the next hunk down');
  const pagerBox = await hunkPager.boundingBox();
  const cdp = await context.newCDPSession(page);
  const swipeY = pagerBox.y + 100;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pagerBox.x + pagerBox.width - 35, y: swipeY }] });
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pagerBox.x + pagerBox.width - 35 - step * (pagerBox.width - 70) / 8, y: swipeY }] });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => {
    const pager = document.querySelector('.hunk-explanation-pages');
    return Math.abs(pager.scrollLeft - pager.clientWidth) < 2;
  });
  await page.screenshot({ path: join(output, 'hunk-explanation-right.png') });
  await firstHunk.getByRole('button', { name: '返回此块代码', exact: true }).tap();
  await page.waitForFunction(() => document.querySelector('.hunk-explanation-pages').scrollLeft < 2);
  await firstHunk.getByRole('button', { name: '查看右侧块释义', exact: true }).tap();
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 430, height: 844 });
  await page.waitForFunction(() => {
    const pager = document.querySelector('.hunk-explanation-pages');
    return Math.abs(pager.scrollLeft - pager.clientWidth) < 2;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await cdp.detach();
  await openHunkMenu();
  await hunkMenu.getByRole('button', { name: '收起块释义', exact: true }).tap();
  assert.equal(await firstHunk.locator('.hunk-explanation-page').count(), 0);
  await pane('code').getByRole('button', { name: '看全文', exact: true }).click();
  await pane('code').getByText('240 行', { exact: true }).waitFor();
  const waitForHunkAtTop = (index) => page.waitForFunction((hunkIndex) => {
    const scroller = document.querySelector('[data-review-pane="code"] .diff-code-scroll');
    const hunk = scroller.querySelector(`[data-diff-hunk-index="${hunkIndex}"]`);
    return Math.abs(hunk.getBoundingClientRect().top - scroller.getBoundingClientRect().top) < 2;
  }, index);
  const jumpControls = page.getByRole('navigation', { name: '全文差异跳转', exact: true });
  await jumpControls.getByLabel('跳转到指定差异').selectOption('3');
  await waitForHunkAtTop(3);
  assert.equal(await jumpControls.getByRole('button', { name: '下一处差异', exact: true }).isDisabled(), true);
  await jumpControls.getByRole('button', { name: '上一处差异', exact: true }).tap();
  await waitForHunkAtTop(2);
  await jumpControls.getByLabel('跳转到指定差异').selectOption('1');
  await waitForHunkAtTop(1);
  assert.equal(await jumpControls.getByRole('button', { name: '上一处差异', exact: true }).isDisabled(), true);
  await page.screenshot({ path: join(output, 'full-file-jump-controls.png') });
  await openHunkMenu();
  await hunkMenu.getByRole('button', { name: '展开块释义', exact: true }).tap();
  await firstHunk.getByRole('button', { name: '查看右侧块释义', exact: true }).tap();
  await page.waitForFunction(() => {
    const pager = document.querySelector('.hunk-explanation-pages');
    return Math.abs(pager.scrollLeft - pager.clientWidth) < 2;
  });
  await page.screenshot({ path: join(output, 'full-file-hunk-explanation-right.png') });
  await firstHunk.getByRole('region', { name: '改动块 1 的释义', exact: true }).getByRole('button', { name: '收起', exact: true }).tap();
  assert.equal(await firstHunk.locator('.hunk-explanation-page').count(), 0, 'side-page close restores code in full-file mode');
  await pane('code').getByRole('button', { name: '看差异', exact: true }).click();
  await scroll.evaluate((el) => { el.scrollTop = 0; });
  await toggleWrap();
  await openHunkMenu();
  await firstHunk.getByRole('button', { name: '直接解释', exact: true }).tap();
  await assertPane('ai');
  await assertMenuClosed('external explanation closes the menu before switching to AI');
  await nav.getByRole('button', { name: '代码', exact: true }).click();
  await assertMenuClosed('returning from AI does not reopen the menu');
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
  await nav.getByRole('button', { name: '代码', exact: true }).click();
  await page.getByRole('button', { name: '展开操作栏', exact: true }).waitFor();
  assert.equal(await nav.isVisible(), false, 'landscape diff hides bottom navigation');
  assert.equal(await page.locator('.mobile-header').isVisible(), false, 'landscape diff hides repository header');
  assert.equal(await page.locator('.mobile-file-navigation').isVisible(), false);
  assert.equal(await page.locator('.mobile-diff-toolbar').isVisible(), false);
  assert.equal(await page.locator('.mobile-hunk-actions').first().isVisible(), false);
  const focusedBox = await pane('code').locator('.diff-code-scroll').boundingBox();
  assert.equal(focusedBox.y, 0, 'diff starts at viewport top');
  assert.equal(focusedBox.height, 390, 'diff occupies full landscape viewport');
  await page.screenshot({ path: join(output, 'landscape-focused-diff.png') });
  await page.getByRole('button', { name: '展开操作栏', exact: true }).tap();
  await nav.waitFor({ state: 'visible' });
  await pane('code').getByRole('button', { name: '看全文', exact: true }).click();
  await pane('code').getByText('240 行', { exact: true }).waitFor();
  await page.getByRole('button', { name: '收起操作栏', exact: true }).tap();
  assert.equal(await page.locator('.diff-file-metadata').isVisible(), false, 'full-file metadata also hides in focus');
  assert.equal((await pane('code').locator('.diff-code-scroll').boundingBox()).height, 390);
  assert.equal(await jumpControls.isVisible(), true, 'jump controls remain available in landscape focus');
  await jumpControls.getByLabel('跳转到指定差异').selectOption('3');
  await waitForHunkAtTop(3);
  await jumpControls.getByRole('button', { name: '上一处差异', exact: true }).tap();
  await waitForHunkAtTop(2);
  const jumpBox = await jumpControls.boundingBox();
  const menuBox = await page.getByRole('button', { name: '展开操作栏', exact: true }).boundingBox();
  assert.ok(jumpBox.x + jumpBox.width <= menuBox.x, 'jump controls do not cover the landscape menu');
  await page.screenshot({ path: join(output, 'landscape-focused-full-file.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await nav.waitFor({ state: 'visible' });
  assert.equal(await page.locator('.mobile-header').isVisible(), true, 'portrait restores controls automatically');
  assert.equal(await page.locator('.diff-file-metadata').isVisible(), true);
  await pane('code').getByRole('button', { name: '看差异', exact: true }).click();
  await nav.getByRole('button', { name: 'AI 审查', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 500 });
  const inputBox = await input.boundingBox();
  assert.ok(inputBox.y + inputBox.height <= 500, 'composer remains visible in short viewport');
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '未提交变更 (2)', exact: true }).click();
  await assertPane('files');
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  // 手机菜单清除的是当前仓库的后台对话，按钮完成后给出明确反馈。
  await page.getByRole('button', { name: '清除仓库对话', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '仓库对话已清除' }).waitFor();
  assert.deepEqual(clearRequests, ['/fixture']);
  await page.screenshot({ path: join(output, 'clear-conversation-mobile.png') });
  await page.getByRole('status').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: 'AI 引擎配置', exact: true }).click();
  await page.screenshot({ path: join(output, 'settings.png') });
  await page.locator('.settings-modal > div > div').first().getByRole('button').click();
  await page.getByRole('button', { name: '切换仓库', exact: true }).click();
  await page.screenshot({ path: join(output, 'repository.png') });
  await page.locator('.repo-modal > div > div').first().getByRole('button').click();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await nav.waitFor({ state: 'hidden' });
  // 桌面顶栏也提供同一个清除入口。
  await page.getByRole('button', { name: '清除仓库对话', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '仓库对话已清除' }).waitFor();
  assert.deepEqual(clearRequests, ['/fixture', '/fixture']);
  await page.getByRole('status').getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(await pane('history').evaluate((el) => el.getBoundingClientRect().width), 380);
  assert.equal(await pane('files').evaluate((el) => el.getBoundingClientRect().width), 240);
  assert.equal(await pane('code').getByRole('separator').count(), 1, 'desktop restores split view');
  assert.equal(await page.evaluate(() => localStorage.getItem('git_sidebar_collapsed')), 'false');
  assert.equal(await page.evaluate(() => localStorage.getItem('git_ai_explanation_open')), 'false');
  const desktopHistory = pane('history');
  const desktopCommit = (number) => desktopHistory.getByTitle(commits[number - 1].message, { exact: true });
  const waitForBatch = () => page.waitForResponse((response) => new URL(response.url()).pathname === '/api/repo/diff/batch');
  const beforeDesktopRange = batchRequests.length;
  await desktopHistory.getByRole('button', { name: '选范围', exact: true }).click();
  await desktopCommit(5).click();
  await desktopHistory.getByPlaceholder('搜索提交信息、作者、SHA、分支...').fill('测试提交 2');
  await desktopCommit(2).click();
  await desktopHistory.getByText('已选 4 个连续提交，包含起点和终点。', { exact: true }).waitFor();
  assert.equal(batchRequests.length, beforeDesktopRange, 'desktop endpoint picks wait for confirmation');
  await desktopHistory.getByPlaceholder('搜索提交信息、作者、SHA、分支...').fill('');
  await page.screenshot({ path: join(output, 'desktop-range.png') });
  let batchResponse = waitForBatch();
  await desktopHistory.getByRole('button', { name: '查看选中 4 个提交', exact: true }).click();
  await batchResponse;
  assert.deepEqual(batchRequests.at(-1), commits.slice(1, 5).map((c) => c.hash));
  await desktopHistory.getByRole('button', { name: '选范围', exact: true }).click();
  await desktopCommit(7).click();
  await desktopHistory.getByRole('button', { name: '取消范围选择', exact: true }).click();
  assert.equal(batchRequests.length, beforeDesktopRange + 1, 'desktop cancellation leaves current selection unchanged');
  await desktopCommit(2).click();
  batchResponse = waitForBatch();
  await desktopCommit(5).click({ modifiers: ['Shift'] });
  await batchResponse;
  assert.deepEqual(batchRequests.at(-1), commits.slice(1, 5).map((c) => c.hash), 'Shift range selection still works');
  await desktopCommit(1).click();
  batchResponse = waitForBatch();
  await desktopCommit(3).click({ modifiers: ['Control'] });
  await batchResponse;
  assert.deepEqual(batchRequests.at(-1), commits.slice(0, 3).map((c) => c.hash), 'Ctrl selection still fills a contiguous range');
  batchResponse = waitForBatch();
  await desktopHistory.getByTitle('勾选批量多选；中间提交会自动补齐', { exact: true }).first().click();
  await batchResponse;
  assert.deepEqual(batchRequests.at(-1), commits.slice(1, 3).map((c) => c.hash), 'checkbox still removes an endpoint');
  await page.screenshot({ path: join(output, 'desktop.png') });
  // Simulate a mobile tab being backgrounded, reloaded and destroyed entirely.
  await page.setViewportSize({ width: 390, height: 844 });
  await nav.getByRole('button', { name: '提交', exact: true }).click();
  await pane('history').getByRole('button', { name: '选范围', exact: true }).click();
  await commitButton(3).tap();
  await commitButton(5).tap();
  batchResponse = waitForBatch();
  await pane('history').getByRole('button', { name: '查看选中 3 个提交', exact: true }).click();
  await batchResponse;
  await pane('files').getByText(fileNames[1], { exact: true }).click();
  if (await pane('code').locator('[aria-label="代码自动换行"]').getAttribute('aria-pressed') !== 'true') await toggleWrap();
  await pane('code').getByRole('button', { name: '看全文', exact: true }).click();
  await pane('code').getByText('240 行', { exact: true }).waitFor();
  const savedTop = await pane('code').locator('.diff-code-scroll').evaluate((el) => {
    el.scrollTop = 620;
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    return el.scrollTop;
  });
  assert.ok(savedTop > 0);
  const callsBeforeReload = aiCalls;
  batchResponse = waitForBatch();
  await page.reload();
  await batchResponse;
  await assertPane('code');
  await pane('code').getByText('240 行', { exact: true }).waitFor();
  assert.equal(await pane('code').getByTitle(fileNames[1]).count(), 1, 'reload restores the selected second file');
  assert.deepEqual(batchRequests.at(-1), commits.slice(2, 5).map((c) => c.hash), 'reload restores exact commit range');
  assert.equal(await pane('code').locator('[aria-label="代码自动换行"]').getAttribute('aria-pressed'), 'true');
  await page.waitForFunction((top) => Math.abs(document.querySelector('[data-review-pane="code"] .diff-code-scroll').scrollTop - top) <= 2, savedTop);
  await page.screenshot({ path: join(output, 'restored-reading.png') });
  await page.close();
  const reopened = await context.newPage();
  reopened.on('pageerror', (error) => errors.push(error.message));
  await reopened.goto(baseURL);
  await reopened.locator('[data-review-pane="code"]').getByText('240 行', { exact: true }).waitFor();
  assert.equal(await reopened.locator('[data-review-pane="code"]').getByTitle(fileNames[1]).count(), 1, 'new tab restores file');
  await reopened.waitForFunction((top) => Math.abs(document.querySelector('[data-review-pane="code"] .diff-code-scroll').scrollTop - top) <= 2, savedTop);
  await reopened.getByRole('navigation', { name: '手机审查导航' }).getByRole('button', { name: 'AI 审查', exact: true }).click();
  await reopened.reload();
  await reopened.locator('[data-review-pane="ai"]').waitFor({ state: 'visible' });
  assert.equal(aiCalls, callsBeforeReload, 'restoring the workspace must not restart model requests');
  await reopened.evaluate(() => localStorage.setItem('git_last_repo_path', '/other-fixture'));
  await reopened.reload();
  await reopened.locator('[data-review-pane="history"]').getByRole('button', { name: /手机布局测试提交 1 Test Author/ }).waitFor();
  assert.equal(await reopened.locator('[data-review-pane="ai"]').isVisible(), false, 'new repository does not inherit another repository page');
  await reopened.evaluate(() => localStorage.setItem('git_last_repo_path', '/fixture'));
  await reopened.reload();
  await reopened.locator('[data-review-pane="ai"]').waitFor({ state: 'visible' });
  // A deleted selection/file must fall back safely instead of stranding the restored workspace.
  await reopened.evaluate(() => {
    const entries = JSON.parse(localStorage.getItem('git_workspace_state_v1'));
    const state = entries.find(([key]) => key === '/fixture')[1];
    state.mobilePane = 'code';
    state.selectedFilePath = 'no-longer-present.ts';
    state.selection = { type: 'commit', commitHash: 'f'.repeat(40) };
    localStorage.setItem('git_workspace_state_v1', JSON.stringify(entries));
  });
  await reopened.reload();
  await reopened.locator('[data-review-pane="code"]').getByTitle(fileNames[0]).waitFor();
  // 学习页的清除入口只操作 learn 对话线，审查页始终发送 review。
  assert.deepEqual(clearLanes, ['review', 'review']);
  await reopened.getByRole('button', { name: '学习', exact: true }).click();
  await reopened.getByRole('button', { name: '更多操作', exact: true }).click();
  await reopened.getByRole('button', { name: '清除学习对话', exact: true }).click();
  await reopened.getByRole('status').filter({ hasText: '学习对话已清除' }).waitFor();
  assert.deepEqual(clearLanes, ['review', 'review', 'learn']);
  await reopened.screenshot({ path: join(output, 'clear-learning-conversation.png') });
  assert.deepEqual(errors, []);
  console.log(`PASS: mobile review navigation, unified diff/full file, review in background, draft/scroll preservation, 320–767px layouts, short viewport and desktop restoration. Screenshots: ${output}`);
} finally {
  releaseReview();
  await browser.close();
}


