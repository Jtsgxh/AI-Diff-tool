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
  const decorations: any[][] = [];
  let provider: any;
  let changed: (event: any) => void = () => {};
  const status = { visible: false, text: '', command: '', tooltip: '',
    /** 记录状态栏显示，不模拟文件写入。 */
    show() { this.visible = true; },
    /** 记录状态栏隐藏与释放。 */
    hide() { this.visible = false; }, dispose() {} };
  const native = {
    Position, Range, Selection, EndOfLine: { LF: 1, CRLF: 2 },
    ThemeColor: class { constructor(public id: string) {} },
    DecorationRangeBehavior: { ClosedClosed: 1 }, StatusBarAlignment: { Right: 2 },
    TextEditorRevealType: { InCenterIfOutsideViewport: 0 },
    InlineCompletionItem: class { constructor(public insertText: string, public range: Range) {} },
    window: { activeTextEditor: undefined as any, visibleTextEditors: [] as any[],
      createTextEditorDecorationType: () => disposable, createStatusBarItem: () => status,
      onDidChangeActiveTextEditor: () => disposable },
    workspace: { onDidChangeTextDocument: (callback: typeof changed) => { changed = callback; return disposable; } },
    languages: { registerInlineCompletionItemProvider: (_selector: any, value: any) => { provider = value; return disposable; } },
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
    const value = { document: doc, selection: new Selection(new Position(0, 0), new Position(0, 0)),
      setDecorations: (_type: any, ranges: any[]) => decorations.push(ranges), revealRange() {} };
    native.window.activeTextEditor = value; native.window.visibleTextEditors = [value];
    return value;
  }
  return { ghost, native, provider, calls, decorations, status, document, editor,
    /** 触发真实控制器的输入监听并等待其短暂防抖。 */
    async changed(doc: any) { changed({ document: doc }); await new Promise((resolve) => setTimeout(resolve, 140)); } };
}

/** 验证默认虚影、按字收缩、红色旧内容、缓存、步骤切换和语言补全共存。 */
test('native ghost uses unsaved text, preserves edits and changes targets when advancing', async (t) => {
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
  const position = doc.positionAt(14);
  const context = { selectedCompletionInfo: undefined };
  const token = { isCancellationRequested: false };
  const items = await c.provider.provideInlineCompletionItems(doc, position, context, token);
  assert.equal(items[0].insertText, '2');
  assert.equal(items[0].range.start, position);
  assert.equal(items[0].range.end, position, 'ghost itself inserts nothing into the existing file');
  assert.equal(doc.text, 'const value = 1;\n');
  assert.equal(c.decorations.at(-1)![0].range.start.character, 14);
  assert.ok(c.calls.includes('editor.action.inlineSuggest.trigger'));
  doc.text = 'const value = 21;\n'; doc.version++;
  await c.changed(doc);
  assert.equal((await c.provider.provideInlineCompletionItems(doc, doc.positionAt(15), context, token)).length, 0);
  assert.equal(c.decorations.at(-1)![0].range.start.character, 15, 'typed target text remains and only the obsolete character is marked');
  doc.text = 'const value = ;\n'; doc.version++;
  await c.changed(doc);
  assert.equal((await c.provider.provideInlineCompletionItems(doc, position, context, token))[0].insertText, '2');
  assert.equal(reads, 0, 'typing reuses the already loaded target without Git calls');
  doc.text = 'const value = 2;\n'; doc.version++;
  await c.changed(doc);
  assert.equal((await c.provider.provideInlineCompletionItems(doc, position, context, token)).length, 0);
  assert.match(c.status.text, /已一致/);
  c.ghost.setStep({ ...session, stepIndex: 1 }, files);
  assert.equal((await c.provider.provideInlineCompletionItems(doc, position, context, token))[0].insertText, '3');
  assert.equal(reads, 1);
  assert.equal((await c.provider.provideInlineCompletionItems(doc, position, context, { isCancellationRequested: true })).length, 0);
  assert.equal((await c.provider.provideInlineCompletionItems(doc, position, { selectedCompletionInfo: {} }, token)).length, 0);
  const unrelated = c.document(path.resolve('.validation/unrelated/sample.ts'), '');
  assert.equal((await c.provider.provideInlineCompletionItems(unrelated, new Position(0, 0), context, token)).length, 0);
});

/** 验证新文件多行虚影、Windows 换行、旧请求失效以及完成后不再覆盖提示。 */
test('ghost supports bounded multiline previews and discards stale asynchronous targets', async (t) => {
  let resolve!: (value: any) => void;
  const c = controller(() => new Promise((done) => { resolve = done; }));
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  const session = { practiceRepo: repo, steps: [{ hash: 'old' }, { hash: 'new' }], stepIndex: 0, finished: false };
  const files = [{ path: 'new.ts', deleted: false, complete: false }];
  c.ghost.setStep(session, files);
  const doc = c.document(path.join(repo, 'new.ts'), '', 2);
  const editor = c.editor(doc);
  const args = [doc, new Position(0, 0), {}, { isCancellationRequested: false }];
  const stale = c.provider.provideInlineCompletionItems(...args);
  c.ghost.setStep({ ...session, stepIndex: 1 }, files);
  resolve({ content: 'stale code' });
  assert.equal((await stale).length, 0);
  const target = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n') + '\n';
  await c.ghost.open(editor, target);
  const items = await c.provider.provideInlineCompletionItems(...args);
  assert.match(items[0].insertText, /^line 0\r\nline 1/);
  assert.equal(items[0].insertText.split('\n').length, 8);
  assert.equal(doc.text, '');
  c.ghost.setStep({ ...session, finished: true }, files);
  assert.equal((await c.provider.provideInlineCompletionItems(...args)).length, 0);
});
