import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import { ghostEdits, ghostInsertionEdits, ghostRemovalEdits, nextGhostEdit } from '../shared/followGhost';

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

/** 所有展示入口必须复用同一组差异，且从后往前应用整组编辑应精确恢复目标。 */
test('all operation markers and the next ghost share a complete ordered edit plan', () => {
  const cases = [
    ['// 双倍惊喜、命运祈福的妖灵\n', '// 双倍惊喜、命运祈福、超级发发发的妖灵\n'],
    ['if (!old()) { run(); }\n', 'if (!old() && !added()) { run(); }\n'],
    ['old();\nkeep();\nconst x = 1;\n', 'new();\nkeep();\nconst x = 2;\nlast();\n'],
    ['😀 foo()\n\tkeep();\n', '😀 foo(中文)\n\tkeep();\n'],
    ['remove();\n', ''], ['', 'first();\nsecond();\n'], ['a b\n', 'a\tb\n'],
  ];
  for (const newline of ['\n', '\r\n']) for (const pair of cases) {
    const [current, target] = pair.map(text => text.replace(/\n/g, newline));
    const edits = ghostEdits(current, target);
    assert.deepEqual(nextGhostEdit(current, target), edits[0]);
    assert.deepEqual(ghostInsertionEdits(current, target), edits.filter(edit => edit.start === edit.end && edit.text));
    assert.deepEqual(ghostRemovalEdits(current, target), edits.filter(edit => edit.end > edit.start));
    let rebuilt = current;
    for (let i = edits.length - 1; i >= 0; i--) {
      const edit = edits[i];
      assert.ok(edit.start >= 0 && edit.end >= edit.start && edit.end <= current.length);
      if (i) assert.ok(edits[i - 1].end <= edit.start);
      rebuilt = rebuilt.slice(0, edit.start) + edit.text + rebuilt.slice(edit.end);
    }
    assert.equal(rebuilt, target);
  }
});

/** 顶部新增未跟写时，后面的整段删除及字符替换都应定位准确，保留行不能被标红。 */
test('all pending removals include later methods and replacements before the first insertion is written', () => {
  for (const eol of ['\n', '\r\n']) {
    const method = ['/** 旧加载入口 */', 'public static void reload() {', '    load();', '}', ''].join(eol);
    const before = ['package demo;', '', 'keep();', method + 'keepAfter();', 'value = 1;', 'untouched();', ''].join(eol);
    const target = ['package demo;', 'import added;', '', 'keep();', 'keepAfter();', 'value = 2;', 'untouched();', ''].join(eol);
    const edits = ghostRemovalEdits(before, target);
    assert.ok(nextGhostEdit(before, target)!.text.includes('import added;'));
    assert.ok(edits.some(edit => before.slice(edit.start, edit.end) === method && edit.text === ''));
    assert.ok(edits.some(edit => before.slice(edit.start, edit.end) === '1' && edit.text === '2'));
    assert.ok(edits.every(edit => !before.slice(edit.start, edit.end).includes('keep();') && !before.slice(edit.start, edit.end).includes('untouched();')));
    assert.deepEqual(ghostRemovalEdits(target, target), []);
    const adjacent = ghostRemovalEdits(method + 'value = 1;' + eol, 'value = 2;' + eol);
    assert.equal(adjacent[0].start, 0);
    assert.equal(adjacent[0].end, method.length, 'the entire deleted method must be marked while retaining the correct value prefix');
    assert.ok(adjacent.some(edit => (method + 'value = 1;' + eol).slice(edit.start, edit.end) === '1' && edit.text === '2'));
  }
});

/** 未写完的多行调用只标实际错字或空白，不能要求删除正确参数及自动闭合括号。 */
test('partial multiline arguments preserve correct code despite indentation differences', () => {
  const first = '(com.gameplus.dao.star.IFishActivityInfoDao) context.getBean("fishActivityInfoDao"),';
  const second = '(org.hibernate.SessionFactory) context.getBean("sessionFactoryStar")';
  for (const eol of ['\n', '\r\n']) {
    const target = `initialize(${eol}\t\t${first}${eol}\t\t${second});${eol}`;
    for (const indent of ['\t\t', '\t\t\t', '        ']) {
      let current = `initialize(${eol}${indent}${first}${eol}\t)`;
      const removals = ghostRemovalEdits(current, target);
      assert.ok(removals.every(edit => !current.slice(edit.start, edit.end).trim()), 'only indentation may be marked; the correct first argument and closing parenthesis must remain');
      // 跟随真实下一处编辑直至完成，每一步都不能删除正确的非空白代码。
      for (let step = 0; current !== target && step < 30; step++) {
        const edit = nextGhostEdit(current, target)!;
        assert.ok(edit);
        assert.equal(current.slice(edit.start, edit.end).trim(), '');
        current = current.slice(0, edit.start) + edit.text + current.slice(edit.end);
        assert.ok(current.includes(first));
      }
      assert.equal(current, target);
    }
    const wrong = `initialize(${eol}\t\t${first.replace('fishActivityInfoDao', 'fishActivityWrongDao')}${eol})`;
    const removals = ghostRemovalEdits(wrong, target);
    const wrongStart = wrong.indexOf('Wrong');
    assert.ok(removals.some(edit => edit.start < wrongStart + 5 && edit.end > wrongStart));
    assert.ok(removals.every(edit => !wrong.slice(edit.start, edit.end).trim() || edit.start >= wrongStart && edit.end <= wrongStart + 5));
    assert.ok(removals.every(edit => !wrong.slice(edit.start, edit.end).includes('IFishActivityInfoDao')));
  }
});

/** 提供最小原生位置对象，偏移沿用 VS Code 的 UTF-16 字符单位。 */
class Position { constructor(public line: number, public character: number) {} }
/** 保留装饰和虚影的真实范围，供测试检查没有替换用户文件。 */
class Range { constructor(public start: Position, public end: Position) {} }
/** 模拟原生光标，定位不会产生文本修改。 */
class Selection extends Range { active = this.end; isEmpty = true; }

/** 在模拟宿主加载实际控制器，并像编辑器一样在触发命令后读取真实提供器。 */
function controller(preview: (...args: any[]) => Promise<any>) {
  const disposable = { dispose() {} };
  const calls: string[] = [];
  const decorations = new Map<string, any[]>();
  let inlineEnabled = true;
  let inlineMode = 'subwordSmart';
  let provider: any;
  let lensProvider: any;
  let items: any[] = [];
  let missRequest = false;
  let changed: (event: any) => void = () => {};
  let selectionChanged: (event: any) => void = () => {};
  let rangesChanged: (event: any) => void = () => {};
  let visibleChanged: () => void = () => {};
  let windowChanged: (event: any) => void = () => {};
  let focused = 0;
  let activated: () => void = () => {};
  const status = { visible: false, text: '', command: '', tooltip: '',
    /** 记录状态栏显示和隐藏。 */
    show() { this.visible = true; }, hide() { this.visible = false; }, dispose() {} };
  const native = {
    followEditing: false,
    Position, Range, Selection, version: '1.138.0', EndOfLine: { LF: 1, CRLF: 2 },
    /** 保留内嵌图标 URI，供装饰类型识别新增位置标记。 */
    Uri: { parse: (value: string) => value },
    /** 原生独立提示行只保存操作命令，不承载目标代码。 */
    CodeLens: class { constructor(public range: Range, public command: any) {} },
    EventEmitter: class { event = () => disposable; fire() {} dispose() {} },
    /** 保留原生提供器返回的真实换行文本与替换范围。 */
    InlineCompletionItem: class { constructor(public insertText: string, public range: Range) {} },
    ThemeColor: class { constructor(public id: string) {} },
    DecorationRangeBehavior: { ClosedClosed: 1 }, StatusBarAlignment: { Right: 2 },
    TextEditorRevealType: { InCenterIfOutsideViewport: 0 },
    window: { activeTextEditor: undefined as any, visibleTextEditors: [] as any[],
      /** 文字装饰仅标操作说明，实际目标代码仍必须来自原生多行虚影。 */
      createTextEditorDecorationType: (options: any) => {
        if (options.before) assert.equal(options.before.color.id, 'editorError.foreground');
        return { ...disposable, key: options.gutterIconPath ? options.borderWidth ? 'insertion' : 'inlineInsertion' : options.before ? 'instruction' : 'deleted' };
      },
      createStatusBarItem: () => status,
      /** 模拟普通打开或恢复编辑器，不通过专用跟写打开命令。 */
      onDidChangeActiveTextEditor: (callback: typeof activated) => { activated = callback; return disposable; },
      /** 模拟布局完成与窗口重新获得焦点，不需要伪造一次文本输入。 */
      onDidChangeVisibleTextEditors: (callback: typeof visibleChanged) => { visibleChanged = callback; return disposable; },
      onDidChangeTextEditorVisibleRanges: (callback: typeof rangesChanged) => { rangesChanged = callback; return disposable; },
      onDidChangeWindowState: (callback: typeof windowChanged) => { windowChanged = callback; return disposable; },
      /** 定位应将输入焦点还给原编辑器，不改写文档。 */
      showTextDocument: async (doc: any, options: any) => {
        assert.equal(doc, native.window.activeTextEditor.document);
        assert.equal(options.preserveFocus, false); focused++;
        return native.window.activeTextEditor;
      },
      onDidChangeTextEditorSelection: (callback: typeof selectionChanged) => { selectionChanged = callback; return disposable; } },
    workspace: { onDidChangeTextDocument: (callback: typeof changed) => { changed = callback; return disposable; },
      onDidChangeConfiguration: () => disposable,
      /** 使用文档作用域，兼容语言自己的内联建议设置。 */
      getConfiguration: (_section: string, scope: any) => { assert.equal(typeof scope?.getText, 'function'); return { get: (key: string) => key === 'inlineSuggest.mode' ? inlineMode : inlineEnabled }; } },
    languages: {
      /** 记录实际注册入口，测试不会直接调用一个未接入宿主的内部函数。 */
      registerInlineCompletionItemProvider: (selector: any, value: any) => { assert.equal(selector.scheme, 'file'); provider = value; return disposable; },
      /** 单独注册新增操作提示，虚影候选仍由上面的内联提供器产生。 */
      registerCodeLensProvider: (_selector: any, value: any) => { lensProvider = value; return disposable; } },
    commands: {
      /** 模拟原生编辑器重新请求虚影；渲染刷新不能隐藏其他扩展的提示。 */
      executeCommand: async (command: string, options?: any, value?: any) => {
        calls.push(command);
        if (command === 'setContext') { assert.equal(options, 'aiDiff.followEditing'); native.followEditing = value; return; }
        assert.equal(command, 'editor.action.inlineSuggest.trigger');
        if (native.version === '1.138.0') assert.equal(options.providerId, 'jtsgxh.ai-diff-follow:*');
        else assert.equal(options, undefined);
        if (missRequest) { missRequest = false; items = []; return; }
        const editor = native.window.activeTextEditor;
        items = await provider.provideInlineCompletionItems(editor.document, editor.selection.active, {}, { isCancellationRequested: false });
      } },
  };
  const require = createRequire(path.resolve('package.json'));
  const module = { exports: {} as any };
  const code = transformSync(fs.readFileSync('vscode/followGhost.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, setTimeout, clearTimeout,
    require: (id: string) => id === 'vscode' ? native : id === '../server/gitService' ? { gitService: { getFilePreview: preview } }
      : id === '../shared/followGhost' ? { ghostEdits } : require(id) });
  const ghost = new module.exports.FollowGhost();
  /** 以实际字符串和 UTF-16 偏移模拟文档，行末范围不包含 CRLF。 */
  function document(file: string, text: string, eol = 1) {
    return { text, version: 1, eol, uri: { scheme: 'file', fsPath: file },
      getText() { return this.text; },
      /** 按原生换行计算行列。 */
      positionAt(offset: number) { const lines = this.text.slice(0, offset).split('\n'); return new Position(lines.length - 1, lines.at(-1)!.length); },
      /** 将行列转换为含 CRLF 的真实偏移。 */
      offsetAt(position: Position) { return this.text.split('\n').slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character; },
      /** 提供真实的行末，验证多行建议满足宿主范围要求。 */
      lineAt(index: number) { const text = (this.text.split('\n')[index] || '').replace(/\r$/, ''); return { text, range: new Range(new Position(index, 0), new Position(index, text.length)) }; } };
  }
  /** 切换模拟编辑器，只记录删除装饰，不向文档注入目标。 */
  function editor(doc: ReturnType<typeof document>) {
    const value = { document: doc, selection: new Selection(new Position(0, 0), new Position(0, 0)),
      setDecorations: (type: any, ranges: any[]) => decorations.set(type.key, ranges), revealRange() {} };
    native.window.activeTextEditor = value; native.window.visibleTextEditors = [value]; items = [];
    return value;
  }
  return { ghost, native, calls, decorations, status, document, editor,
    /** 模拟首次打开时宿主尚未受理请求，随后由真实生命周期事件恢复。 */
    missNextRequest() { missRequest = true; },
    get focused() { return focused; },
    /** 激活后立即触发布局刷新，验证后一个事件不会取消定位意图。 */
    async activated() { activated(); rangesChanged({ textEditor: native.window.activeTextEditor }); await new Promise(resolve => setTimeout(resolve, 180)); },
    /** 模拟当前编辑器完成布局，不改变文档版本和光标。 */
    async laidOut() { rangesChanged({ textEditor: native.window.activeTextEditor }); await new Promise(resolve => setTimeout(resolve, 140)); },
    /** 模拟编辑器重新可见或窗口切回。 */
    async resumed(kind: 'visible' | 'window') {
      if (kind === 'visible') visibleChanged(); else windowChanged({ focused: true });
      await new Promise(resolve => setTimeout(resolve, 140));
    },
    /** 返回模拟宿主收到的候选，而不是检查控制器的内部缓存。 */
    get items() { return items; },
    /** 经注册的提示行提供器读取结果，验证没有混入真实代码或行内装饰。 */
    async lenses(doc: any) { return lensProvider.provideCodeLenses(doc, { isCancellationRequested: false }); },
    /** 模拟用户关闭内联建议，控制器应明确显示原因。 */
    disableInline() { inlineEnabled = false; },
    /** 模拟前缀模式的限制，避免已有代码之前的多行目标静默消失。 */
    prefixMode() { inlineMode = 'prefix'; },
    /** 模拟真实光标事件，回到待写行后应主动恢复目标。 */
    async moved(position: Position) {
      const editor = native.window.activeTextEditor;
      editor.selection = new Selection(position, position); items = [];
      selectionChanged({ textEditor: editor });
      await new Promise(resolve => setTimeout(resolve, 140));
    },
    /** 按原生输入行为使旧候选失效，并等待控制器提供更新。 */
    async changed(doc: any, contentChanges?: any[]) { items = []; changed({ document: doc, contentChanges }); await new Promise((resolve) => setTimeout(resolve, 140)); },
    /** 提供补全菜单与取消场景，检验原生提供器的实际接入逻辑。 */
    async provide(doc: any, position: Position, context: any = {}, cancelled = false) {
      return provider.provideInlineCompletionItems(doc, position, context, { isCancellationRequested: cancelled });
    } };
}

/** 将候选应用到副本检查完整结果，真实文档必须保持原样。 */
function proposedText(doc: any, item: any): string {
  return doc.text.slice(0, doc.offsetAt(item.range.start)) + item.insertText + doc.text.slice(doc.offsetAt(item.range.end));
}

/** 灰色注释中的补写必须有准确文字说明，且后面的表达式补写也要提前标出。 */
test('inline comment and expression additions have explicit hints and share the ghost position', async (t) => {
  const before = '// 双倍惊喜、命运祈福的妖灵\nif (!old()) { run(); }\n';
  const target = '// 双倍惊喜、命运祈福、超级发发发的妖灵\nif (!old() && !added()) { run(); }\n';
  const c = controller(async () => ({ content: target }));
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
    [{ path: 'comment.java', deleted: false, complete: false }]);
  const doc = c.document(path.join(repo, 'comment.java'), before);
  const editor = c.editor(doc);
  await c.ghost.open(editor, target);
  let lenses = await c.lenses(doc);
  assert.match(lenses[0].command.title, /待补写.*「、超级发发发」/);
  assert.equal(lenses[0].range.start.character, before.indexOf('的妖灵'));
  assert.equal(c.items[0].insertText, '、超级发发发');
  assert.ok(lenses.some((item: any) => item.range.start.line === 1 && item.command.title.includes('added')));
  assert.equal(c.decorations.get('insertion')!.length, 0, 'an inline addition must not mark the entire line as an insertion boundary');
  assert.equal(c.decorations.get('inlineInsertion')![0].start.character, before.indexOf('的妖灵'));
  doc.text = proposedText(doc, c.items[0]); doc.version++;
  await c.changed(doc);
  await c.ghost.locate();
  lenses = await c.lenses(doc);
  assert.equal(lenses[0].range.start.line, 1);
  assert.match(lenses[0].command.title, /added/);
  assert.equal(proposedText(doc, c.items[0]), target);
  doc.text = target; doc.version++;
  await c.changed(doc);
  assert.equal((await c.lenses(doc)).length, 0);
});

/** 按键上下文只在练习编辑器生效，退出、完成和释放后不能影响正常文件。 */
test('follow keyboard context is limited to active practice files and clears on completion', async (t) => {
  const c = controller(async () => ({ content: 'target' }));
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  const session = { practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false };
  c.ghost.setStep(session, [{ path: 'a.java', deleted: false, complete: false }]);
  c.editor(c.document(path.join(repo, 'a.java'), ''));
  await c.activated();
  assert.equal(c.native.followEditing, true);
  c.editor(c.document(path.resolve('.validation/outside.java'), ''));
  await c.activated();
  assert.equal(c.native.followEditing, false);
  c.editor(c.document(path.join(repo, 'a.java'), ''));
  await c.activated();
  assert.equal(c.native.followEditing, true);
  c.ghost.setStep({ ...session, finished: true }, []);
  assert.equal(c.native.followEditing, false);
  c.ghost.setStep(session, [{ path: 'a.java', deleted: false, complete: false }]);
  assert.equal(c.native.followEditing, true);
  c.ghost.dispose();
  assert.equal(c.native.followEditing, false);
});

/** 末尾空行的多行正文不能被宿主移回上一行；最终换行仍需按原始目标完成。 */
test('multiline EOF suggestions stay at the blank cursor line and retain final newline as the next edit', async (t) => {
  for (const eol of ['\n', '\r\n']) {
    const base = `2109\t境界排行榜\t0\t1${eol}`;
    const added = `2110\t回归仙途合集\t0\t1${eol}2111\t回归特惠祈愿\t0\t1${eol}`;
    const c = controller(async () => ({ content: base + added }));
    t.after(() => c.ghost.dispose());
    const repo = path.resolve('.validation/ghost-practice');
    c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
      [{ path: 'activity.txt', deleted: false, complete: false }]);
    const doc = c.document(path.join(repo, 'activity.txt'), base, eol === '\r\n' ? 2 : 1);
    const editor = c.editor(doc);
    await c.ghost.open(editor, base + added);
    assert.equal(doc.text, base);
    assert.equal(editor.selection.active.line, 1);
    assert.equal(c.items[0].insertText, added.slice(0, -eol.length));
    doc.text = proposedText(doc, c.items[0]); doc.version++;
    editor.selection = new Selection(doc.positionAt(doc.text.length), doc.positionAt(doc.text.length));
    await c.changed(doc);
    assert.equal(c.items[0].insertText, eol);
    assert.equal(proposedText(doc, c.items[0]), base + added);
  }
});

/** 模拟停留在后面的待删方法，顶部仍未跟写时也必须能直接读懂操作，并随输入清除旧标记。 */
test('later removal blocks stay visibly marked with instructions while the first ghost is elsewhere', async (t) => {
  const c = controller(async () => ({ content: '' }));
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  const method = '/** 旧加载入口 */\npublic static void reload() {\n    load();\n}\n';
  const current = 'package demo;\n\nkeep();\n' + method + 'keepAfter();\nvalue = 1;\n';
  const target = 'package demo;\nimport added;\n\nkeep();\nkeepAfter();\nvalue = 2;\n';
  c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
    [{ path: 'sample.java', deleted: false, complete: false }]);
  const doc = c.document(path.join(repo, 'sample.java'), current);
  await c.ghost.open(c.editor(doc), target);
  await c.moved(new Position(4, 0));
  const removal = c.decorations.get('deleted')!.find(item => doc.getText().slice(doc.offsetAt(item.range.start), doc.offsetAt(item.range.end)) === method);
  assert.ok(removal);
  assert.ok(c.decorations.get('deleted')!.every(item => item.hoverMessage === undefined));
  assert.ok(c.decorations.get('instruction')!.every(item => item.hoverMessage === undefined));
  assert.ok(c.decorations.get('instruction')!.some(item => item.renderOptions.before.contentText === '【待删除 · 4 行】'));
  assert.ok(c.decorations.get('instruction')!.some(item => item.renderOptions.before.contentText.includes('待替换')));
  assert.equal(doc.text, current, 'decoration must never write instructions or answers to the real file');
  doc.text = current.replace(method, ''); doc.version++;
  await c.changed(doc);
  assert.equal(c.decorations.get('instruction')!.some(item => item.renderOptions.before.contentText.includes('待删除')), false);
  doc.text = target; doc.version++;
  await c.changed(doc);
  assert.equal(c.decorations.get('deleted')!.length, 0);
  assert.equal(c.decorations.get('instruction')!.length, 0);
});

/** 大文件恢复旧光标时自动定位新增 import；普通滚动不会抢光标，新增位置仍有可见标记。 */
test('opening or restoring a large follow file locates the pending insertion and preserves markers off-cursor', async (t) => {
  const header = Array.from({ length: 41 }, (_, i) => `// header ${i}\n`).join('');
  const tail = Array.from({ length: 20000 }, (_, i) => `// body ${i}\n`).join('');
  const current = header + 'import existing;\n' + tail;
  const target = header + 'import added;\nimport existing;\n' + tail;
  const c = controller(async () => ({ content: target }));
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  const session = { practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false };
  const files = [{ path: 'large.java', deleted: false, complete: false }];
  c.ghost.setStep(session, files);
  const doc = c.document(path.join(repo, 'large.java'), current);
  const editor = c.editor(doc);
  editor.selection = new Selection(new Position(21, 0), new Position(21, 0));
  await c.activated();
  assert.equal(editor.selection.active.line, 40);
  assert.equal(c.items.length, 1);
  assert.equal(proposedText(doc, c.items[0]), target);
  await c.moved(new Position(21, 0));
  await c.laidOut();
  assert.equal(editor.selection.active.line, 21, 'scrolling or selecting after the initial jump must not steal the cursor');
  const lenses = await c.lenses(doc);
  assert.ok(lenses.some((item: any) => item.range.start.line === 41 && item.command.title === '⬇【此处待新增 · 1 行】 点击显示虚影' && item.command.command === 'aiDiff.follow.locate'));
  assert.equal(c.decorations.get('instruction')!.some(item => item.renderOptions.before.contentText.includes('待新增')), false, 'insertion labels must never be inline with existing code');
  assert.ok(c.decorations.get('instruction')!.every(item => item.hoverMessage === undefined));
  c.ghost.setStep(undefined, []);
  c.ghost.setStep(session, files);
  await c.laidOut();
  assert.equal(editor.selection.active.line, 40, 'restoring the session with an already open editor must also locate');
  assert.equal(doc.text, current);
});

/** 提示行仅当前待写处可定位，后续插入保持只读说明，完成或取消任务后不残留。 */
test('insertion code lenses are separate navigation hints and clear when the target is complete', async (t) => {
  const target = 'first\nkeep\nsecond\nend\n';
  const c = controller(async () => ({ content: target }));
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
    [{ path: 'sample.java', deleted: false, complete: false }]);
  const doc = c.document(path.join(repo, 'sample.java'), 'keep\nend\n');
  const editor = c.editor(doc);
  await c.ghost.open(editor, target);
  let lenses = await c.lenses(doc);
  assert.equal(lenses.length, 2);
  assert.deepEqual(Array.from(c.decorations.get('insertion')!, item => item.start.line), [0, 1]);
  assert.equal(lenses[0].command.command, 'aiDiff.follow.locate');
  assert.equal(lenses[1].command.command, '');
  assert.equal(lenses.some((lens: any) => /first|second/.test(lens.command.title)), false);
  await c.ghost.locate();
  assert.equal(editor.selection.active.line, 0);
  doc.text = 'first\nkeep\nend\n'; doc.version++;
  await c.changed(doc);
  lenses = await c.lenses(doc);
  assert.equal(lenses.length, 1);
  assert.deepEqual(Array.from(c.decorations.get('insertion')!, item => item.start.line), [2]);
  assert.equal(lenses[0].command.command, 'aiDiff.follow.locate');
  doc.text = target; doc.version++;
  await c.changed(doc);
  assert.equal((await c.lenses(doc)).length, 0);
  assert.equal(c.decorations.get('insertion')!.length, 0);
  c.ghost.setStep(undefined, []);
  assert.equal((await c.lenses(doc)).length, 0);
});

/** 首次定位等待目标期间发生输入时，取消过期结果后仍应完成定位。 */
test('an obsolete render cannot lose a pending open location request', async (t) => {
  const c = controller(async () => ({ content: '' }));
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
    [{ path: 'sample.java', deleted: false, complete: false }]);
  const doc = c.document(path.join(repo, 'sample.java'), 'package demo;\n\nimport existing;\n');
  const editor = c.editor(doc);
  const opened = c.ghost.open(editor, 'package demo;\n\nimport added;\nimport existing;\n');
  doc.version++;
  await opened;
  await c.changed(doc);
  assert.equal(editor.selection.active.line, 1);
  assert.equal(c.items.length, 1);
});

/** 验证替换必须先删除旧字，之后才展示真实目标，输入使用缓存且不会移动光标。 */
test('native ghosts wait for removal, preserve suffixes and update unsaved input', async (t) => {
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
  assert.equal(c.items.length, 0, 'replacement must not be shown as a misleading 21');
  assert.equal(c.decorations.get('deleted')![0].range.start.character, 14);
  assert.match(c.status.text, /先删除红字/);
  doc.text = 'const value = ;\n'; doc.version++;
  await c.changed(doc);
  assert.equal(c.items.length, 1);
  assert.equal(c.items[0].insertText, '2');
  assert.equal(c.items[0].range.end.character, 14);
  assert.equal(proposedText(doc, c.items[0]), 'const value = 2;\n');
  assert.equal(doc.text, 'const value = ;\n');
  assert.equal(reads, 0);
  await c.moved(new Position(0, 0));
  assert.equal(editor.selection.active.character, 0);
  assert.equal(proposedText(doc, c.items[0]), 'const value = 2;\n', 'cursor may remain before the insertion on the same line');
  doc.text = 'const value = 21;\n'; doc.version++;
  await c.changed(doc);
  assert.equal(c.items.length, 0);
  assert.equal(c.decorations.get('deleted')![0].range.start.character, 15);
  doc.text = 'const value = 2;\n'; doc.version++;
  await c.changed(doc);
  assert.match(c.status.text, /已一致/);
  c.ghost.setStep({ ...session, stepIndex: 1 }, files);
  await c.changed(doc);
  assert.equal(reads, 1);
  assert.match(c.status.text, /先删除红字/);
  const unrelated = c.document(path.resolve('.validation/unrelated/sample.ts'), '');
  c.editor(unrelated); await c.changed(unrelated);
  assert.equal(c.items.length, 0); assert.equal(c.status.visible, false);
  c.ghost.setStep(session, [{ path: 'removed.ts', deleted: true, complete: false }]);
  const removed = c.document(path.join(repo, 'removed.ts'), '');
  await c.ghost.open(c.editor(removed), '');
  assert.match(c.status.text, /需要删除整个文件/);
  assert.doesNotMatch(c.status.text, /已一致/);
  // 默认完成的删除项不再产生清空旧文件的装饰或虚影，保留用户已有文本。
  c.ghost.setStep(session, [{ path: 'removed.ts', deleted: true, complete: true }]);
  removed.text = 'retained old code\n'; removed.version++;
  await c.changed(removed);
  assert.equal(c.status.visible, false);
  assert.equal(c.items.length, 0);
  assert.equal(c.decorations.get('deleted')?.length, 0);
  assert.equal(removed.text, 'retained old code\n');
});

/** 空文件应一次获得多行正文，保留真实换行和 Tab，输入后继续剩余目标且不泄漏旧步骤。 */
test('empty files receive real multiline ghost code and continue after typed prefixes', async (t) => {
  let resolve!: (value: any) => void;
  let started!: () => void;
  const reading = new Promise<void>((done) => { started = done; });
  const c = controller(() => new Promise((done) => { resolve = done; started(); }));
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  const session = { practiceRepo: repo, steps: [{ hash: 'old' }, { hash: 'target' }], stepIndex: 0, finished: false };
  const files = [{ path: 'Empty.java', deleted: false, complete: false }];
  c.ghost.setStep(session, files);
  const doc = c.document(path.join(repo, 'Empty.java'), '', 2);
  const editor = c.editor(doc);
  const stale = c.ghost.locate();
  // 定位现在先恢复编辑焦点，等待旧目标读取实际开始后再切换步骤，继续验证过期结果保护。
  await reading;
  c.ghost.setStep({ ...session, stepIndex: 1 }, files);
  resolve({ content: 'stale code' }); await stale;
  assert.equal(c.items.length, 0);
  const target = 'package demo;\n\npublic class Empty {\n\tint value;\n}\n';
  await c.ghost.open(editor, target);
  assert.equal(c.items[0].insertText, target.replace(/\n/g, '\r\n'));
  assert.equal(doc.text, '');
  doc.text = 'pac'; doc.version++;
  editor.selection = new Selection(new Position(0, 3), new Position(0, 3));
  await c.changed(doc);
  assert.match(c.items[0].insertText, /^kage demo;\r\n/);
  assert.equal(proposedText(doc, c.items[0]), target.replace(/\n/g, '\r\n'));
  doc.text = 'package demo;\r\n'; doc.version++;
  editor.selection = new Selection(new Position(1, 0), new Position(1, 0));
  await c.changed(doc);
  assert.match(c.items[0].insertText, /^\r\npublic class Empty/);
  assert.equal(c.items[0].range.start.line, 1);
  doc.text = target.replace(/\n/g, '\r\n'); doc.version++;
  await c.changed(doc);
  assert.equal(c.items.length, 0); assert.match(c.status.text, /已一致/);
  c.ghost.setStep({ ...session, finished: true }, files);
  await c.changed(doc);
  assert.equal(c.status.visible, false);
});

/** 首次请求未显示时，布局、重新可见和切回窗口都应恢复，不能要求用户先输入 pac。 */
test('initial ghost requests recover after editor readiness without typing', async (t) => {
  const c = controller(async () => ({ content: 'package demo;\nclass Empty {}\n' }));
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
    [{ path: 'Empty.java', deleted: false, complete: false }]);
  const doc = c.document(path.join(repo, 'Empty.java'), '');
  const editor = c.editor(doc);
  const target = 'package demo;\nclass Empty {}\n';
  for (const event of ['layout', 'visible', 'window'] as const) {
    c.missNextRequest();
    await c.ghost.open(editor, target);
    assert.equal(c.items.length, 0);
    assert.match(c.status.text, /点击显示虚影/);
    if (event === 'layout') await c.laidOut(); else await c.resumed(event);
    assert.equal(c.items[0].insertText, target);
    assert.equal(doc.getText(), ''); assert.equal(doc.version, 1);
  }
  await c.ghost.locate();
  assert.equal(c.focused, 1, 'status-bar recovery restores the editing focus');
  c.native.version = '1.100.0';
  await c.ghost.locate();
  assert.equal(c.items[0].insertText, target, 'older hosts retain the supported generic command');
  const outside = c.document(path.resolve('.validation/unrelated.ts'), '');
  c.editor(outside);
  const requests = c.calls.length;
  await c.resumed('window');
  assert.equal(c.calls.length, requests, 'window activation must not trigger suggestions outside the practice');
});

/** 复现截图中的相同 import 前缀，新增行独立呈现，已有行不作为候选的一部分重新补写。 */
test('whole-line import ghosts preserve the existing line without borrowing its common prefix', async (t) => {
  for (const eol of ['\n', '\r\n']) {
    for (const header of ['', `package demo;${eol}${eol}`]) {
      const c = controller(async () => ({ content: '' }));
      t.after(() => c.ghost.dispose());
      const repo = path.resolve('.validation/ghost-practice');
      c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
        [{ path: 'Imports.java', deleted: false, complete: false }]);
      const before = `${header}import com.gameplus.core.model.star.FishActivityInfo;${eol}`;
      const added = 'import com.gameplus.core.gameconfig.dmx.DmxReturnCampaignConf;';
      const target = `${header}${added}${eol}import com.gameplus.core.model.star.FishActivityInfo;${eol}`;
      const doc = c.document(path.join(repo, 'Imports.java'), before, eol === '\n' ? 1 : 2);
      const editor = c.editor(doc);
      await c.ghost.open(editor, target);
      if (header) {
        assert.equal(c.items.length, 1);
        assert.equal(c.items[0].range.start.line, 1);
        assert.equal(c.items[0].range.start.character, 0);
        assert.equal(c.items[0].range.end.character, 0);
        assert.equal(c.items[0].insertText, eol + added);
        assert.equal(proposedText(doc, c.items[0]), target);
        assert.match(c.status.text, /先按 Enter 换行/);
      } else {
        assert.equal(c.items.length, 1);
        assert.equal(c.items[0].range.start.line, 0);
        assert.equal(c.items[0].range.start.character, 0);
        assert.equal(c.items[0].range.end.character, 0);
        assert.equal(c.items[0].insertText, added + eol);
        assert.equal(proposedText(doc, c.items[0]), target);
      }
      assert.equal(doc.text, before);
      if (header) {
        const offset = doc.offsetAt(editor.selection.active);
        doc.text = before.slice(0, offset) + eol + before.slice(offset); doc.version++;
        editor.selection = new Selection(doc.positionAt(offset + eol.length), doc.positionAt(offset + eol.length));
        await c.changed(doc, [{ rangeOffset: offset, rangeLength: 0, text: eol }]);
        assert.equal(c.items[0].insertText, added);
      }
      const writing = header ? header.length : 0;
      assert.equal(doc.offsetAt(editor.selection.active), writing);
      assert.equal(proposedText(doc, c.items[0]), target);
      const prepared = doc.text;
      for (const typed of ['imp', 'import com.gameplus.core.', added]) {
        doc.text = prepared.slice(0, writing) + typed + prepared.slice(writing); doc.version++;
        const cursor = doc.positionAt(writing + typed.length);
        editor.selection = new Selection(cursor, cursor);
        await c.changed(doc);
        assert.equal(doc.offsetAt(editor.selection.active), writing + typed.length, 'typing must never asynchronously move the caret');
        if (header && typed === added) {
          assert.equal(c.items.length, 0);
        } else {
          assert.equal(c.items[0].insertText, added.slice(typed.length) + (header ? '' : eol));
          assert.doesNotMatch(c.items[0].insertText, /FishActivityInfo/);
          assert.equal(proposedText(doc, c.items[0]), target);
        }
      }
      if (!header) {
        const offset = added.length;
        doc.text = doc.text.slice(0, offset) + eol + doc.text.slice(offset); doc.version++;
        editor.selection = new Selection(new Position(1, 0), new Position(1, 0));
        await c.changed(doc, [{ rangeOffset: offset, rangeLength: 0, text: eol }]);
        assert.equal(editor.selection.active.line, 1, 'the final Enter must retain its native caret position');
        assert.equal(editor.selection.active.character, 0);
      }
      assert.equal(doc.text, target);
      assert.equal(c.items.length, 0); assert.match(c.status.text, /已一致/);
    }
  }
});

/** 匹配的普通补全可继续展示目标；不匹配、取消、跨行光标和过期版本不会生成错误候选。 */
test('inline candidates extend compatible IntelliSense without replacing unrelated suggestions', async (t) => {
  const c = controller(async () => ({ content: '' }));
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
    [{ path: 'Demo.java', deleted: false, complete: false }]);
  const doc = c.document(path.join(repo, 'Demo.java'), 'pa');
  const editor = c.editor(doc);
  await c.ghost.open(editor, 'package demo;\nclass Demo {}\n');
  const position = new Position(0, 2);
  const selected = { range: new Range(new Position(0, 0), position), text: 'package' };
  const compatible = await c.provide(doc, position, { selectedCompletionInfo: selected });
  assert.equal(compatible.length, 1);
  assert.equal(proposedText(doc, compatible[0]), 'package demo;\nclass Demo {}\n');
  assert.equal((await c.provide(doc, position, { selectedCompletionInfo: { ...selected, text: 'parseFloat' } })).length, 0);
  assert.match(c.status.text, /按 Esc/);
  await c.provide(doc, position);
  assert.match(c.status.text, /目标就绪/);
  assert.equal((await c.provide(doc, position, {}, true)).length, 0);
  assert.equal((await c.provide(doc, new Position(1, 0))).length, 0);
  doc.text = 'fn()'; doc.version++;
  await c.ghost.open(editor, 'fn(value)');
  assert.equal(proposedText(doc, c.items[0]), 'fn(value)', 'auto-closing suffix is preserved exactly once');
  c.disableInline(); await c.changed(doc);
  assert.match(c.status.text, /请启用内联建议/);
  assert.equal(c.items.length, 0);
});

/** 限制每次候选的行数和字符数，避免原生渲染上限导致空白，同时保持 Unicode 和 CRLF 完整。 */
test('native ghost chunks retain multiple lines and never split Unicode or CRLF', async (t) => {
  const c = controller(async () => ({ content: '' }));
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
    [{ path: 'Long.java', deleted: false, complete: false }]);
  const doc = c.document(path.join(repo, 'Long.java'), '', 2);
  const editor = c.editor(doc);
  await c.ghost.open(editor, Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n') + '\n');
  assert.equal(c.items[0].insertText.split('\r\n').length, 61);
  assert.match(c.items[0].insertText, /line 20/);
  assert.doesNotMatch(c.items[0].insertText, /line 60/);
  await c.ghost.open(editor, 'x'.repeat(3999) + '😀\n');
  assert.equal(c.items[0].insertText, 'x'.repeat(3999));
  await c.ghost.open(editor, 'x'.repeat(3999) + '\n');
  assert.equal(c.items[0].insertText, 'x'.repeat(3999));
  assert.equal(doc.text, '');
  doc.text = 'x'.repeat(4100); doc.version++;
  await c.ghost.open(editor, doc.text + 'new\n');
  // 定位会跳到插入点；手动退回超长共同前缀之前，仍不得提交超过原生渲染预算的候选。
  await c.moved(new Position(0, 0));
  assert.equal(c.items.length, 0); assert.match(c.status.text, /当前行过长/);
  doc.text = 'prefixexisting'; doc.version++;
  c.prefixMode();
  await c.ghost.open(editor, 'prefixZZZ\nexisting');
  // 首行现在使用纯插入范围，不再把已有后缀纳入候选，因此前缀模式也能直接显示。
  assert.equal(c.items[0].insertText, 'ZZZ\r\n');
  assert.equal(proposedText(doc, c.items[0]), 'prefixZZZ\r\nexisting');
  // 非首行的行内多行插入仍需保留后缀，继续验证前缀模式的可见错误入口。
  doc.text = 'header\r\nprefixexisting'; doc.version++;
  await c.ghost.open(editor, 'header\nprefixZZZ\nexisting');
  assert.equal(c.items.length, 0); assert.match(c.status.text, /子词模式/);
  assert.equal((c.status.command as any).arguments[0], '@id:editor.inlineSuggest.mode');
});

/** 目标读取失败仍需显示可见错误，并允许下一次定位或输入重试。 */
test('target read failures remain visible and can be retried', async (t) => {
  let reads = 0;
  const c = controller(async () => { if (++reads === 1) throw new Error('Git target unavailable'); return { content: 'target' }; });
  t.after(() => c.ghost.dispose());
  const repo = path.resolve('.validation/ghost-practice');
  c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
    [{ path: 'retry.ts', deleted: false, complete: false }]);
  const doc = c.document(path.join(repo, 'retry.ts'), '');
  c.editor(doc); await c.changed(doc);
  assert.equal(c.status.visible, true); assert.match(c.status.text, /读取失败/);
  assert.match(c.status.tooltip, /Git target unavailable/);
  await c.changed(doc);
  assert.equal(reads, 2); assert.equal(c.items[0].insertText, 'target'); assert.equal(doc.text, '');
});

/** 已写缩进或空行与目标不同不能挡住缺失正文，定位、候选与提示必须指向同一处。 */
test('earlier formatting differences do not block later code or steal its navigation hint', async (t) => {
  for (const eol of ['\n', '\r\n']) for (const extraLine of ['', eol]) {
    const current = `class C {${eol}${extraLine}    int a;${eol}`;
    const target = `class C {${eol}\tint a;${eol}\tint b;${eol}}${eol}`;
    const c = controller(async () => ({ content: target }));
    t.after(() => c.ghost.dispose());
    const repo = path.resolve('.validation/ghost-practice');
    c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
      [{ path: 'format.java', deleted: false, complete: false }]);
    const doc = c.document(path.join(repo, 'format.java'), current, eol === '\r\n' ? 2 : 1);
    const editor = c.editor(doc);
    await c.ghost.open(editor, target);
    assert.equal(doc.offsetAt(editor.selection.active), current.length);
    assert.equal(c.items.length, 1);
    assert.equal(c.items[0].insertText, `\tint b;${eol}}`, 'unwritten code retains the target indentation and line breaks');
    assert.equal(doc.text, current, 'the differing written whitespace must never be rewritten automatically');
    assert.equal(c.decorations.get('deleted')!.length, 0);
    const lenses = await c.lenses(doc);
    assert.ok(lenses.some((lens: any) => /格式差异.*可忽略/.test(lens.command.title)));
    const actionable = lenses.filter((lens: any) => lens.command.command === 'aiDiff.follow.locate');
    assert.equal(actionable.length, 1);
    assert.equal(doc.offsetAt(actionable[0].range.start), current.length);
    assert.match(actionable[0].command.title, /待新增/);
  }
});

/** Enter 自动缩进与目标不同后仍能逐字补写，新增正文内部的空行和 Tab 不得被裁掉。 */
test('typing after auto closing and different indentation keeps offering the remaining body', async (t) => {
  for (const eol of ['\n', '\r\n']) {
    const target = `class C {${eol}\tvoid run() {${eol}\t\twork();${eol}\t}${eol}}${eol}`;
    const c = controller(async () => ({ content: target }));
    t.after(() => c.ghost.dispose());
    const repo = path.resolve('.validation/ghost-practice');
    c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
      [{ path: 'body.java', deleted: false, complete: false }]);
    const doc = c.document(path.join(repo, 'body.java'), `class C {${eol}\tvoid run() {}${eol}}${eol}`, eol === '\r\n' ? 2 : 1);
    const editor = c.editor(doc);
    await c.ghost.open(editor, target);
    assert.ok(c.items[0].insertText.includes(`\t\twork();${eol}`));
    for (const typed of ['', 'w', 'work();']) {
      doc.text = `class C {${eol}\tvoid run() {${eol}        ${typed}${eol}\t}${eol}}${eol}`;
      doc.version++;
      editor.selection = new Selection(new Position(2, 8 + typed.length), new Position(2, 8 + typed.length));
      await c.changed(doc);
      assert.equal(c.decorations.get('deleted')!.length, 0, 'already typed indentation must not be marked as required deletion');
      assert.equal(editor.selection.active.character, 8 + typed.length, 'refresh must preserve the typing position');
      if (typed === 'work();') {
        assert.equal(c.items.length, 0);
        assert.match(c.status.text, /正文已完成.*格式差异可忽略/);
      } else {
        assert.equal(c.items[0].insertText, 'work();'.slice(typed.length));
        assert.equal(c.items[0].range.start.character, 8 + typed.length);
      }
    }
    doc.text = `class C {${eol}\tvoid run() {${eol}        ${eol}\t}${eol}}${eol}`;
    doc.version++;
    const multilineTarget = target.replace(`work();${eol}`, `work();${eol}${eol}\t\tsecond();${eol}`);
    await c.ghost.open(editor, multilineTarget);
    assert.equal(editor.selection.active.line, 2);
    assert.equal(editor.selection.active.character, 8);
    assert.equal(c.items[0].insertText, 'work();');
    doc.text = proposedText(doc, c.items[0]); doc.version++;
    await c.changed(doc);
    await c.ghost.locate();
    assert.equal(c.items[0].insertText, `${eol}${eol}\t\tsecond();`, 'the next operation retains its blank line and original Tab indentation');
    assert.equal(doc.text.split(eol)[2], '        work();');
  }
});

/** 格式可以忽略，但真实错字仍要准确定位并先删除；修正后不得继续要求删缩进。 */
test('formatting tolerance preserves actual character errors and clears required removals when corrected', async (t) => {
  for (const eol of ['\n', '\r\n']) {
    const target = `class C {${eol}\tvoid run() {${eol}\t\twork();${eol}\t}${eol}}${eol}`;
    const current = `class C {${eol}    void run() {${eol}        w0rk();${eol}    }${eol}}${eol}`;
    const c = controller(async () => ({ content: target }));
    t.after(() => c.ghost.dispose());
    const repo = path.resolve('.validation/ghost-practice');
    c.ghost.setStep({ practiceRepo: repo, steps: [{ hash: 'target' }], stepIndex: 0, finished: false },
      [{ path: 'wrong.java', deleted: false, complete: false }]);
    const doc = c.document(path.join(repo, 'wrong.java'), current, eol === '\r\n' ? 2 : 1);
    const editor = c.editor(doc);
    await c.ghost.open(editor, target);
    assert.equal(doc.offsetAt(editor.selection.active), current.indexOf('0'));
    assert.equal(c.items.length, 0);
    assert.match(c.status.text, /先删除红字/);
    const removals = c.decorations.get('deleted')!;
    assert.equal(removals.length, 1);
    assert.equal(doc.text.slice(doc.offsetAt(removals[0].range.start), doc.offsetAt(removals[0].range.end)), '0');
    doc.text = current.replace('w0rk', 'wrk'); doc.version++;
    await c.changed(doc);
    assert.equal(c.items[0].insertText, 'o');
    doc.text = current.replace('w0rk', 'work'); doc.version++;
    await c.changed(doc);
    assert.equal(c.decorations.get('deleted')!.length, 0);
    assert.match(c.status.text, /正文已完成.*格式差异可忽略/);
  }
});
