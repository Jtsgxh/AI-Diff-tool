import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import { nextGhostEdit } from '../shared/followGhost';

/** 覆盖新文件、局部替换、自动闭合、多个改动、删除、换行和 UTF-16 原生偏移。 */
test('ghost planning preserves existing code and identifies only the next change', () => {
  const cases = [
    { current: '', target: 'const value = 2;\n', edit: { start: 0, end: 0, text: 'const value = 2;\n' } },
    { current: 'const value = 1;\n', target: 'const value = 2;\n', edit: { start: 14, end: 15, text: '2' } },
    { current: 'const value = 21;\n', target: 'const value = 2;\n', edit: { start: 15, end: 16, text: '' } },
    { current: 'fn()', target: 'fn(value)', edit: { start: 3, end: 3, text: 'value' } },
    { current: 'a\nb\nc\n', target: 'a\nnew\nb\nlater\nc\n', edit: { start: 2, end: 2, text: 'new\n' } },
    { current: '😀 a', target: '😀 b', edit: { start: 3, end: 4, text: 'b' } },
    { current: 'a\r\nb\r\n', target: 'a\r\nnew\r\nb\r\n', edit: { start: 3, end: 3, text: 'new\r\n' } },
    { current: 'remove\n', target: '', edit: { start: 0, end: 7, text: '' } },
  ];
  for (const item of cases) assert.deepEqual(nextGhostEdit(item.current, item.target), item.edit);
  assert.equal(nextGhostEdit('already complete\n', 'already complete\n'), undefined);
});

/** 模拟逐处跟写，确保未保存的增删、重复行与 Unicode 内容最终能精确收敛到目标。 */
test('successive ghost edits converge exactly without overlooking whitespace or repeated lines', () => {
  const pairs = [
    ['one\ntwo\nthree\n', 'one\nnew\ntwo changed\nthree\nlast\n'],
    ['()\n{}\n()\n', '(中文)\n{}\n(😀)\n'],
    ['  old\nkeep\nold\n', '    new\nkeep\nnew\n'],
    ['wrong\nextra\n', ''], ['', 'multi\nline\nfile\n'], ['😀你好', '😃您好'],
  ];
  for (const [before, target] of pairs) {
    let current = before;
    for (let step = 0; current !== target && step < 100; step++) {
      const edit = nextGhostEdit(current, target);
      assert.ok(edit);
      current = current.slice(0, edit.start) + edit.text + current.slice(edit.end);
    }
    assert.equal(current, target);
  }
});

/** 提供最小原生位置对象，偏移沿用 VS Code 的 UTF-16 字符单位。 */
class Position { constructor(public line: number, public character: number) {} }
/** 保留装饰和虚影的真实范围，供测试检查没有替换用户文件。 */
class Range { constructor(public start: Position, public end: Position) {} }
/** 模拟原生光标，定位不会产生文本修改。 */
class Selection extends Range { active = this.end; isEmpty = true; }

/** 在模拟原生窗口中加载实际虚影控制器，差异计算使用真实实现。 */
function controller(preview: (...args: any[]) => Promise<any>) {
  const disposable = { dispose() {} };
  const calls: string[] = [];
  const decorations = new Map<string, any[]>();
  let lensEnabled = true;
  let lensChanges = 0;
  let lensProvider: any;
  let changed: (event: any) => void = () => {};
  const status = { visible: false, text: '', command: '', tooltip: '',
    /** 记录状态栏显示，不模拟文件写入。 */
    show() { this.visible = true; },
    /** 记录状态栏隐藏与释放。 */
    hide() { this.visible = false; }, dispose() {} };
  const native = {
    Position, Range, Selection, EndOfLine: { LF: 1, CRLF: 2 },
    /** 记录预览刷新，验证控制器通知原生宿主重新读取代码透镜。 */
    EventEmitter: class { event = () => disposable; fire() { lensChanges++; } dispose() {} },
    /** 模拟原生独立预览行及其点击命令。 */
    CodeLens: class { constructor(public range: Range, public command: any) {} },
    ThemeColor: class { constructor(public id: string) {} },
    DecorationRangeBehavior: { ClosedClosed: 1 }, StatusBarAlignment: { Right: 2 },
    TextEditorRevealType: { InCenterIfOutsideViewport: 0 },
    window: { activeTextEditor: undefined as any, visibleTextEditors: [] as any[],
      createTextEditorDecorationType: (options: any) => ({ ...disposable, key: options.before ? 'ghost' : 'deleted' }), createStatusBarItem: () => status,
      onDidChangeActiveTextEditor: () => disposable },
    workspace: { onDidChangeTextDocument: (callback: typeof changed) => { changed = callback; return disposable; },
      onDidChangeConfiguration: () => disposable,
      /** 使用文档作用域读取设置，确保实际语言的覆盖项也能生效。 */
      getConfiguration: (_section: string, scope: any) => { assert.equal(typeof scope?.getText, 'function'); return { get: () => lensEnabled }; } },
    languages: { registerInlineCompletionItemProvider: () => assert.fail('Follow hints must not depend on the completion channel'),
      /** 通过实际注册的提供器检查预览，防止只有内部数据而没有显示入口。 */
      registerCodeLensProvider: (selector: any, provider: any) => { assert.equal(selector.scheme, 'file'); lensProvider = provider; return disposable; } },
    commands: { executeCommand: async (command: string) => { calls.push(command); } },
  };
  const require = createRequire(path.resolve('package.json'));
  const module = { exports: {} as any };
  const code = transformSync(fs.readFileSync('vscode/followGhost.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, setTimeout, clearTimeout,
    require: (id: string) => id === 'vscode' ? native : id === '../server/gitService' ? { gitService: { getFilePreview: preview } }
      : id === '../shared/followGhost' ? { nextGhostEdit } : require(id) });
  const ghost = new module.exports.FollowGhost();
  /** 用真实字符串模拟原生文档及版本，每次输入只改文档自身。 */
  function document(file: string, text: string, eol = 1) {
    return { text, version: 1, eol, uri: { scheme: 'file', fsPath: file },
      getText() { return this.text; },
      /** 按原生换行计算行列，保留 CRLF 对偏移的影响。 */
      positionAt(offset: number) {
        const lines = this.text.slice(0, offset).split('\n');
        return new Position(lines.length - 1, lines.at(-1)!.length);
      },
      /** 还原 UTF-16 偏移，便于验证虚影锚点。 */
      offsetAt(position: Position) {
        return this.text.split('\n').slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
      } };
  }
  /** 让模拟编辑器持有当前文档，并记录控制器添加的装饰。 */
  function editor(doc: ReturnType<typeof document>) {
    const value = { document: doc, options: { tabSize: 2 }, selection: new Selection(new Position(0, 0), new Position(0, 0)),
      setDecorations: (type: any, ranges: any[]) => decorations.set(type.key, ranges), revealRange() {} };
    native.window.activeTextEditor = value; native.window.visibleTextEditors = [value];
    return value;
  }
  return { ghost, native, calls, decorations, status, document, editor,
    /** 暴露真实注册结果和刷新次数，检查宿主的显示接入点。 */
    get lensProvider() { return lensProvider; }, get lensChanges() { return lensChanges; },
    /** 模拟用户关闭代码透镜，验证提示能够明确说明缺失的显示条件。 */
    disableLens() { lensEnabled = false; },
    /** 触发真实控制器的输入监听并等待其短暂防抖。 */
    async changed(doc: any) { changed({ document: doc }); await new Promise((resolve) => setTimeout(resolve, 140)); } };
}

/** 验证持续淡字不依赖光标和补全，按未保存输入收缩，保留旧内容标记与目标缓存。 */
test('persistent ghost stays visible away from the caret without occupying completion', async (t) => {
  let reads = 0;
  const c = controller(async () => { reads++; return { content: 'const value = 3;\n' }; });
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  const session = { practiceRepo: repo, steps: [{ hash: 'first' }, { hash: 'second' }], stepIndex: 0, finished: false };
  const files = [{ path: 'sample.ts', deleted: false, complete: false }];
  c.ghost.setStep(session, files);
  const doc = c.document(path.join(repo, 'sample.ts'), 'const value = 1;\n');
  const editor = c.editor(doc);
  await c.ghost.open(editor, 'const value = 2;\n');
  const hint = c.decorations.get('ghost')![0];
  assert.equal(hint.renderOptions.before.contentText, '2');
  assert.deepEqual(hint.range.start, doc.positionAt(14));
  assert.deepEqual(hint.range.start, hint.range.end);
  assert.equal(doc.text, 'const value = 1;\n');
  assert.equal(c.decorations.get('deleted')![0].range.start.character, 14);
  editor.selection = new Selection(new Position(0, 0), new Position(0, 0));
  await c.changed(doc);
  assert.equal(c.decorations.get('ghost')![0].renderOptions.before.contentText, '2', 'moving away does not hide the target');
  assert.equal(editor.selection.active.character, 0, 'passive rendering does not move the cursor');
  assert.deepEqual(c.calls, [], 'no inlineSuggest trigger/hide commands affect other providers');
  doc.text = 'const value = 21;\n'; doc.version++;
  await c.changed(doc);
  assert.equal(c.decorations.get('ghost')!.length, 0);
  assert.equal(c.decorations.get('deleted')![0].range.start.character, 15, 'typed target text remains and only the obsolete character is marked');
  doc.text = 'const value = ;\n'; doc.version++;
  await c.changed(doc);
  assert.equal(c.decorations.get('ghost')![0].renderOptions.before.contentText, '2');
  assert.equal(reads, 0, 'typing reuses the already loaded target without Git calls');
  doc.text = 'const value = 2;\n'; doc.version++;
  await c.changed(doc);
  assert.equal(c.decorations.get('ghost')!.length, 0);
  assert.match(c.status.text, /已一致/);
  c.ghost.setStep({ ...session, stepIndex: 1 }, files);
  await c.changed(doc);
  assert.equal(c.decorations.get('ghost')![0].renderOptions.before.contentText, '3');
  assert.equal(reads, 1);
  const unrelated = c.document(path.resolve('.validation/unrelated/sample.ts'), '');
  c.editor(unrelated);
  await c.changed(unrelated);
  assert.equal(c.decorations.get('ghost')!.length, 0);
  c.ghost.setStep(session, [{ path: 'removed.ts', deleted: true, complete: false }]);
  const removed = c.document(path.join(repo, 'removed.ts'), '');
  await c.ghost.open(c.editor(removed), '');
  assert.match(c.status.text, /需要删除整个文件/, 'an empty file must not be reported complete when the target deletes it');
  assert.doesNotMatch(c.status.text, /已一致/);
});

/** 验证空文件多行目标独立预览，输入前缀后保持完整行，旧请求失效且不拆分 Unicode。 */
test('empty files preview multiline targets on independent rows', async (t) => {
  let resolve!: (value: any) => void;
  const c = controller(() => new Promise((done) => { resolve = done; }));
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  const session = { practiceRepo: repo, steps: [{ hash: 'old' }, { hash: 'new' }], stepIndex: 0, finished: false };
  const files = [{ path: 'new.ts', deleted: false, complete: false }];
  c.ghost.setStep(session, files);
  const doc = c.document(path.join(repo, 'new.ts'), '', 2);
  const editor = c.editor(doc);
  const stale = c.ghost.locate();
  c.ghost.setStep({ ...session, stepIndex: 1 }, files);
  resolve({ content: 'stale code' });
  await stale;
  assert.equal(c.decorations.get('ghost')!.length, 0);
  assert.equal(c.ghost.provideCodeLenses(doc).length, 0);
  const target = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n') + '\n';
  await c.ghost.open(editor, target);
  assert.equal(c.decorations.get('ghost')!.length, 0);
  assert.match(c.ghost.provideCodeLenses(doc)[0].command.title, /待写目标：line 0.*换行/);
  assert.match(c.ghost.provideCodeLenses(doc)[0].command.tooltip, /line 1/);
  assert.equal(doc.text, '');
  doc.text = 'li'; doc.version++;
  await c.changed(doc);
  assert.match(c.ghost.provideCodeLenses(doc)[0].command.title, /待写目标：line 0/, 'preview retains the full expected line including the typed prefix');
  assert.equal(c.ghost.provideCodeLenses(doc)[0].range.start.character, 2);
  doc.text = 'line 0\r\n'; doc.version++;
  await c.changed(doc);
  assert.match(c.ghost.provideCodeLenses(doc)[0].command.title, /待写目标：line 1/);
  assert.equal(c.ghost.provideCodeLenses(doc)[0].range.start.line, 1);
  await c.ghost.open(editor, 'x'.repeat(1999) + '😀');
  assert.equal(c.decorations.get('ghost')![0].renderOptions.before.contentText, 'x'.repeat(1999));
  doc.text = ''; doc.version++;
  await c.ghost.open(editor, `${'x'.repeat(1999)}😀\r\n`);
  assert.equal(c.ghost.provideCodeLenses(doc)[0].command.title, `待写目标：${'x'.repeat(1999)}  ↵ 换行`, 'independent previews share the Unicode-safe display limit');
  await c.ghost.open(editor, '\t  \n');
  assert.match(c.ghost.provideCodeLenses(doc)[0].command.title, /⇥··/, 'tabs must not be presented as spaces');
  doc.text = '\t  \r\n'; doc.version++;
  await c.changed(doc);
  assert.equal(c.decorations.get('ghost')!.length, 0);
  assert.equal(c.ghost.provideCodeLenses(doc).length, 0);
  assert.match(c.status.text, /已一致/);
  c.ghost.setStep({ ...session, finished: true }, files);
  await c.changed(doc);
  assert.equal(c.decorations.get('ghost')!.length, 0);
  assert.equal(c.status.visible, false);
});

/** 复现截图中的 import 插入，换行目标必须独立成行，不把两个 import 拼成同一行。 */
test('inserted import lines never concatenate the preview with the existing import', async (t) => {
  for (const eol of ['\n', '\r\n']) {
    const c = controller(async () => ({ content: '' }));
    t.after(() => c.ghost.dispose());
    const repo = path.resolve('.validation/ghost-practice');
    c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
      [{ path: 'Imports.java', deleted: false, complete: false }]);
    const before = `import com.gameplus.service.dmx.DmxCatLogic;${eol}`;
    const added = 'import com.gameplus.service.activitypro.returncampaign.ReturnCampaignActivity;';
    const doc = c.document(path.join(repo, 'Imports.java'), before, eol === '\n' ? 1 : 2);
    const editor = c.editor(doc);
    await c.ghost.open(editor, `${added}${eol}${before}`);
    assert.equal(c.lensProvider, c.ghost);
    assert.ok(c.lensChanges > 0, 'opening the target requests a CodeLens refresh');
    assert.equal(c.decorations.get('ghost')!.length, 0, 'multiline code must not be injected before existing text');
    const lens = c.lensProvider.provideCodeLenses(doc)[0];
    assert.match(lens.command.title, /ReturnCampaignActivity/);
    assert.doesNotMatch(lens.command.title, /DmxCatLogic/);
    assert.equal(lens.range.start.line, 0);
    assert.equal(doc.text, before);
    doc.text = added + before; doc.version++;
    assert.equal(c.ghost.provideCodeLenses(doc).length, 0, 'old document versions cannot leak a stale preview');
    await c.changed(doc);
    assert.match(c.ghost.provideCodeLenses(doc)[0].command.title, /在此处换行/);
    assert.equal(c.decorations.get('ghost')!.length, 0);
    doc.text = `${added}${eol}${before}`; doc.version++;
    await c.changed(doc);
    assert.equal(c.ghost.provideCodeLenses(doc).length, 0);
    assert.match(c.status.text, /已一致/);
    doc.text = before; doc.version++;
    c.disableLens();
    await c.changed(doc);
    assert.match(c.status.text, /开启代码透镜/);
    assert.match(c.status.tooltip, /ReturnCampaignActivity/);
    assert.equal(doc.text, before, 'preview settings never insert line breaks or answers');
  }
});

/** 目标读取失败必须给出可见错误，并允许下次输入或定位重试，不能静默变成空白。 */
test('target read failures remain visible and can be retried', async (t) => {
  let reads = 0;
  const c = controller(async () => {
    if (++reads === 1) throw new Error('Git unavailable');
    return { content: 'target' };
  });
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
    [{ path: 'new.ts', deleted: false, complete: false }]);
  const doc = c.document(path.join(repo, 'new.ts'), '');
  c.editor(doc);
  await c.changed(doc);
  assert.equal(c.status.visible, true);
  assert.match(c.status.text, /读取失败/);
  assert.match(c.status.tooltip, /Git unavailable/);
  await c.changed(doc);
  assert.equal(reads, 2);
  assert.equal(c.decorations.get('ghost')![0].renderOptions.before.contentText, 'target');
  assert.equal(doc.text, '');
});
