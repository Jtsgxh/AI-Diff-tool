import * as vscode from 'vscode';
import path from 'node:path';
import { gitService } from '../server/gitService';
import type { FollowFile, FollowSession } from '../server/followService';
import { ghostEdits, type GhostEdit } from '../shared/followGhost';

type DisplayEdit = GhostEdit & { prepareLine?: boolean };
// 行内补写和整行新增共用加号，只为整行新增绘制横向边界。
const INSERTION_ICON = vscode.Uri.parse('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="3" fill="#147d46" stroke="#80efb0"/><path d="M8 4v8M4 8h8" stroke="white" stroke-width="2"/></svg>'));

/** 用原生多行虚影展示待写代码，真实文档只保留用户已经输入的内容。 */
export class FollowGhost implements vscode.InlineCompletionItemProvider, vscode.CodeLensProvider, vscode.Disposable {
  private readonly deleted = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'), textDecoration: 'line-through',
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private readonly instruction = vscode.window.createTextEditorDecorationType({
    before: { color: new vscode.ThemeColor('editorError.foreground'), fontWeight: 'bold', margin: '0 1em 0 0' },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  // 用插入边界和行号旁加号强化独立提示行，不给已有代码着色，也不修改全局 CodeLens 样式。
  private readonly insertion = vscode.window.createTextEditorDecorationType({
    isWholeLine: true, borderStyle: 'solid', borderWidth: '2px 0 0 0',
    dark: { borderColor: '#35c98b' }, light: { borderColor: '#147d46' },
    gutterIconPath: INSERTION_ICON,
    gutterIconSize: 'contain', rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private readonly inlineInsertion = vscode.window.createTextEditorDecorationType({
    gutterIconPath: INSERTION_ICON, gutterIconSize: 'contain', rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
  private readonly lensChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.lensChange.event;
  private readonly subscriptions: vscode.Disposable[];
  private readonly targets = new Map<string, Promise<string | undefined>>();
  private readonly plans = new WeakMap<vscode.TextDocument, { version: number; key: string; target: string; edit?: DisplayEdit; edits: GhostEdit[]; removals: GhostEdit[]; insertions: GhostEdit[] }>();
  private files = new Map<string, FollowFile>();
  private session?: FollowSession;
  private key = '';
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private locateDocument?: vscode.TextDocument;
  private keyboardContext?: boolean;

  /** 输入与切换文件后重新提供多行目标，保留普通语言补全。 */
  constructor() {
    this.status.command = 'aiDiff.follow.locate';
    this.subscriptions = [vscode.languages.registerInlineCompletionItemProvider({ scheme: 'file' }, this),
      vscode.commands.registerCommand('aiDiff.follow.newline', () => this.newline()),
      vscode.languages.registerCodeLensProvider({ scheme: 'file' }, this),
      vscode.window.onDidChangeActiveTextEditor(() => { this.updateKeyboardContext(); this.schedule(true); }),
      vscode.window.onDidChangeVisibleTextEditors(() => this.schedule()),
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) this.schedule();
      }),
      vscode.window.onDidChangeWindowState((state) => { if (state.focused) this.schedule(); }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) this.schedule();
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (event.document !== editor?.document) return;
        const previous = this.plans.get(event.document);
        const changes = event.contentChanges;
        const eol = event.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
        if (previous?.key === this.key && previous.edit?.prepareLine && previous.version + 1 === event.document.version &&
          changes?.length === 1 && changes[0].rangeOffset === previous.edit.start && changes[0].rangeLength === 0 && changes[0].text === eol) {
          // 文件首行没有可借用的上一行；用户按 Enter 后把光标移回新空行，不代写任何答案。
          const position = event.document.positionAt(previous.edit.start);
          editor.selection = new vscode.Selection(position, position);
        }
        this.schedule();
        this.lensChange.fire();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('editor.inlineSuggest', vscode.window.activeTextEditor?.document)) this.schedule();
      })];
    this.updateKeyboardContext();
  }

  /** 步骤推进时丢弃历史目标，保持原有练习目录和用户文本不变。 */
  setStep(session: FollowSession | undefined, files: FollowFile[]): void {
    const key = session && !session.finished ? `${session.practiceRepo}\0${session.steps[session.stepIndex].hash}` : '';
    const changed = key !== this.key;
    if (changed) {
      this.targets.clear(); this.key = key;
      for (const editor of vscode.window.visibleTextEditors) this.clear(editor);
    }
    this.session = session;
    this.files = new Map(files.map((file) => [file.path, file]));
    this.updateKeyboardContext();
    this.lensChange.fire();
    this.schedule(changed);
  }

  /** 限定提示只能出现在当前步骤内的真实练习文件中。 */
  private file(document: vscode.TextDocument): FollowFile | undefined {
    if (!this.key || !this.session || document.uri.scheme !== 'file') return;
    const relative = path.relative(this.session.practiceRepo, document.uri.fsPath).split(path.sep).join('/');
    const file = this.files.get(relative);
    // 目标已删除的文件默认完成，不再把保留的旧内容标红或引导用户清空。
    return file?.deleted && file.complete ? undefined : file;
  }

  /** 按键保护只跟随当前练习文档，离开文件、完成会话或释放扩展时立即撤销。 */
  private updateKeyboardContext(): void {
    const document = vscode.window.activeTextEditor?.document;
    const active = !this.disposed && !!document && !!this.file(document);
    if (active === this.keyboardContext) return;
    this.keyboardContext = active;
    void vscode.commands.executeCommand('setContext', 'aiDiff.followEditing', active);
  }

  /** 先取消候选再换行，避免补全项把换行当作接受字符而写入整段答案。 */
  private async newline(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (this.disposed || !editor || !this.file(editor.document)) return;
    await vscode.commands.executeCommand('hideSuggestWidget');
    if (this.disposed || editor !== vscode.window.activeTextEditor || !this.file(editor.document)) return;
    await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
    if (this.disposed || editor !== vscode.window.activeTextEditor || !this.file(editor.document)) return;
    // 保留原生缩进、选区替换和撤销；不用编辑 API 拼接文本，也不经过其他扩展的 type 重载。
    await vscode.commands.executeCommand('default:type', { text: '\n' });
  }

  /** 按提交缓存目标文本，并按当前原生文档的换行方式生成显示内容。 */
  private async target(document: vscode.TextDocument): Promise<string | undefined> {
    const file = this.file(document);
    if (!file || !this.session) return;
    if (!this.targets.has(file.path)) {
      const session = this.session;
      this.targets.set(file.path, file.deleted ? Promise.resolve('') :
        gitService.getFilePreview(session.practiceRepo, file.path, session.steps[session.stepIndex].hash)
          .then((preview) => {
            if (preview.content === null) throw new Error('目标文件无法按文本显示，请检查文件大小和编码。');
            return preview.content;
          }));
    }
    const pending = this.targets.get(file.path)!;
    let target: string | undefined;
    try { target = await pending; }
    catch (error) {
      if (this.targets.get(file.path) === pending) this.targets.delete(file.path);
      throw error;
    }
    return target?.replace(/\r\n|\r|\n/g, document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
  }

  /** 同一文档版本复用差异结果，输入后才重新计算下一处内容。 */
  private plan(document: vscode.TextDocument, target: string): DisplayEdit | undefined {
    const cached = this.plans.get(document);
    if (cached?.version === document.version && cached.key === this.key && cached.target === target) return cached.edit;
    const current = document.getText();
    const edits = ghostEdits(current, target);
    let edit: DisplayEdit | undefined = edits[0];
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    if (edit && edit.start === edit.end && edit.start >= eol.length && edit.start < current.length &&
      current[edit.start] !== '\r' && current[edit.start] !== '\n' && edit.text.endsWith(eol) &&
      current.slice(edit.start - eol.length, edit.start) === eol) {
      // 整行插入锚定上一行末尾；输入换行后会自然形成空行，不把旧行当成待补全前缀。
      edit = { start: edit.start - eol.length, end: edit.start - eol.length, text: eol + edit.text.slice(0, -eol.length) };
    } else if (edit?.start === 0 && edit.end === 0 && edit.text.endsWith(eol) && current && !/^[\r\n]/.test(current)) {
      // 原生虚影会把首行右侧的旧代码一起染灰，先引导用户空出一行，再显示独立待写行。
      edit = { start: 0, end: 0, text: eol, prepareLine: true };
    }
    this.plans.set(document, { version: document.version, key: this.key, target, edit, edits,
      removals: edits.filter(item => item.end > item.start), insertions: edits.filter(item => item.start === item.end && item.text) });
    return edit;
  }

  /** 独立提示行说明每种操作及要写的具体片段；同一行合并提示，避免漏掉行内补写。 */
  async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    const key = this.key;
    const version = document.version;
    const target = await this.target(document);
    if (this.disposed || token.isCancellationRequested || key !== this.key || version !== document.version || target === undefined) return [];
    this.plan(document, target);
    const plan = this.plans.get(document)!;
    const currentText = document.getText();
    const groups = new Map<number, GhostEdit[]>();
    for (const edit of plan.edits) {
      const line = document.positionAt(edit.start).line;
      const group = groups.get(line) || [];
      group.push(edit); groups.set(line, group);
    }
    return [...groups.values()].map(group => {
      const edit = group[0];
      const position = document.positionAt(edit.start);
      const lines = edit.text.split(/\r\n|\r|\n/).length - (/[\r\n]$/.test(edit.text) ? 1 : 0);
      const before = currentText.slice(edit.start, edit.end);
      const current = edit === plan.edits[0];
      let title: string;
      if (!before.trim() && !edit.text.trim()) title = `【格式差异】${this.preview(before)} → ${this.preview(edit.text)} · 不影响完成判定`;
      else if (edit.end > edit.start) title = edit.text ? `【待替换】${this.preview(before)} → ${this.preview(edit.text)} · 先删红字` :
        `【待删除】${this.preview(before)} · 删除红字`;
      else if (position.character === 0 && /[\r\n]/.test(edit.text)) title = `⬇【此处待新增 · ${lines} 行】`;
      else title = `＋【待补写 · 第 ${position.character + 1} 列】${this.preview(edit.text)}`;
      if (group.length > 1) title += ` · 本行共 ${group.length} 处`;
      return new vscode.CodeLens(new vscode.Range(position, position), {
        title: `${title}${current ? edit.end > edit.start ? ' 点击定位' : ' 点击显示虚影' : ' 前面完成后跟写'}`,
        command: current ? 'aiDiff.follow.locate' : '',
      });
    });
  }

  /** 用短片段明确待写内容，保留可见换行及 Tab 标识，不在提示行堆放整段代码。 */
  private preview(text: string): string {
    if (!text) return '「空」';
    const visible = (text.trim() ? text : text.replace(/ /g, '·')).replace(/\r\n|\r|\n/g, ' ↵ ').replace(/\t/g, '⇥');
    const chars = Array.from(visible);
    return `「${chars.slice(0, 70).join('')}${chars.length > 70 ? '…' : ''}」`;
  }

  /** 只清除本扩展自己的装饰，不干预其他扩展的提示或补全。 */
  private clear(editor: vscode.TextEditor): void {
    editor.setDecorations(this.deleted, []);
    editor.setDecorations(this.instruction, []);
    editor.setDecorations(this.insertion, []);
    editor.setDecorations(this.inlineInsertion, []);
  }

  /** 控制原生差异渲染的单次负载，保留实际换行和 Tab，截断不拆开 CRLF 或代理对。 */
  private chunk(text: string, budget: number): string {
    let end = Math.min(text.length, Math.max(0, budget));
    const lines = /\r\n|\r|\n/g;
    for (let count = 0, match; count < 60 && (match = lines.exec(text)); count++) {
      if (count === 59) end = Math.min(end, match.index + match[0].length);
    }
    if (end < text.length && (/[\uD800-\uDBFF]/.test(text[end - 1] || '') || text[end - 1] === '\r' && text[end] === '\n')) end--;
    return text.slice(0, end);
  }

  /** 原生宿主无法显示时明确说明原因，设置问题提供直接打开对应设置的入口。 */
  private unavailable(message: string, target: string, setting?: string): vscode.InlineCompletionItem[] {
    this.status.text = `$(info) 跟写 · ${message}`;
    this.status.tooltip = `${message}\n${target.slice(0, 6000)}`;
    this.status.command = setting ? { command: 'workbench.action.openSettings', title: '设置跟写虚影', arguments: [`@id:${setting}`] } : 'aiDiff.follow.locate';
    this.status.show();
    return [];
  }

  /** 提供多行候选并保留右侧代码；整行新增由显示规划隔离在空行或上一行末尾。 */
  async provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position,
    context: vscode.InlineCompletionContext, token: vscode.CancellationToken): Promise<vscode.InlineCompletionItem[]> {
    const key = this.key;
    const version = document.version;
    const target = await this.target(document);
    if (this.disposed || token.isCancellationRequested || key !== this.key || version !== document.version ||
      vscode.window.activeTextEditor?.document !== document || target === undefined) return [];
    const edit = this.plan(document, target);
    if (edit?.prepareLine) return this.unavailable('先按 Enter 空出待写行', target);
    // 原生虚影不能表达删除：先标红并让用户删掉旧内容，再提供插入，避免把 1 → 2 显示成 21。
    if (!edit?.text || edit.end !== edit.start) return [];
    const start = document.positionAt(edit.start);
    if (position.line !== start.line || document.offsetAt(position) > edit.start) return [];
    const selected = context.selectedCompletionInfo;
    const from = selected?.range.start || position;
    const multiline = /[\r\n]/.test(edit.text);
    const to = multiline ? document.lineAt(start.line).range.end : selected?.range.end || start;
    if (from.line !== start.line || document.offsetAt(from) > edit.start || selected &&
      (selected.range.end.line !== to.line || selected.range.end.character !== to.character || document.offsetAt(to) < edit.end)) {
      return this.unavailable('按 Esc 关闭补全菜单，继续显示目标', edit.text);
    }
    const current = document.getText();
    const fromOffset = document.offsetAt(from);
    const toOffset = document.offsetAt(to);
    const prefix = current.slice(fromOffset, edit.start);
    const suffix = current.slice(edit.end, toOffset);
    let text = this.chunk(edit.text, 4000 - prefix.length - suffix.length);
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    // 宿主会将空行列首、以换行结尾的多行插入移到上一行，继而按光标位置丢弃。
    // 先展示正文，末尾换行留给下一次跟写；真实目标与用户文件都不改动。
    if (from.line > 0 && from.character === 0 && to.character === 0 && text.endsWith(eol) && !text.startsWith(eol)) {
      text = text.slice(0, -eol.length);
    }
    if (!text) return this.unavailable('当前行过长，无法显示虚影；悬停查看目标', edit.text);
    const insertText = prefix + text + suffix;
    if (selected && !insertText.startsWith(selected.text)) return this.unavailable('按 Esc 关闭补全菜单，继续显示目标', edit.text);
    if (multiline && suffix && vscode.workspace.getConfiguration('editor', document).get<string>('inlineSuggest.mode', 'subwordSmart') === 'prefix') {
      return this.unavailable('请将内联建议切换为子词模式', edit.text, 'editor.inlineSuggest.mode');
    }
    const item = new vscode.InlineCompletionItem(insertText, new vscode.Range(from, to));
    item.filterText = current.slice(fromOffset, toOffset);
    this.status.text = `$(edit) 跟写 · 第 ${start.line + 1} 行 · ${/^[\r\n]/.test(edit.text) ? '先按 Enter 换行' : '目标就绪'}`;
    this.status.tooltip = `照正文虚影输入；普通补全打开时按 Esc 返回虚影。\n${edit.text.slice(0, 6000)}`;
    this.status.command = 'aiDiff.follow.locate';
    this.status.show();
    return [item];
  }

  /** 全文件提前标记待删旧代码和操作说明，虚影仍按下一处待写内容提供。 */
  private async render(locate = false): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (locate && editor) this.locateDocument = editor.document;
    this.status.hide();
    this.status.command = 'aiDiff.follow.locate';
    for (const visible of vscode.window.visibleTextEditors) if (visible !== editor) this.clear(visible);
    if (!editor) return;
    const key = this.key;
    const version = editor.document.version;
    const target = await this.target(editor.document);
    if (this.disposed || key !== this.key || editor !== vscode.window.activeTextEditor ||
      version !== editor.document.version) return;
    if (target === undefined) {
      if (this.locateDocument === editor.document) this.locateDocument = undefined;
      this.clear(editor); return;
    }
    const edit = this.plan(editor.document, target);
    const deleting = this.file(editor.document)?.deleted && !this.file(editor.document)?.complete;
    if (!edit) {
      if (this.locateDocument === editor.document) this.locateDocument = undefined;
      this.clear(editor);
      this.status.text = deleting ? '$(trash) 跟写 · 需要删除整个文件' : '$(pass) 跟写内容已一致';
      this.status.tooltip = deleting ? '在跟写侧栏右键此文件，选择删除文件并移到回收站；清空内容不等于删除文件。' : '当前文本已与目标一致，保存后可检查整个练习。';
      this.status.show(); return;
    }
    const start = editor.document.positionAt(edit.start);
    const fullInsertions: vscode.Range[] = [];
    const inlineInsertions: vscode.Range[] = [];
    for (const insertion of this.plans.get(editor.document)!.insertions) {
      const position = editor.document.positionAt(insertion.start);
      // 只有整行新增画上边界；行内新增仅保留加号，不能暗示整条已有代码需要重写。
      const ranges = position.character === 0 && /[\r\n]/.test(insertion.text) ? fullInsertions : inlineInsertions;
      ranges.push(new vscode.Range(position, position));
    }
    editor.setDecorations(this.insertion, fullInsertions);
    editor.setDecorations(this.inlineInsertion, inlineInsertions);
    const removals = this.plans.get(editor.document)!.removals;
    const current = editor.document.getText();
    const labels = new Set<number>();
    const instructions: vscode.DecorationOptions[] = [];
    editor.setDecorations(this.deleted, removals.map(removal => {
      const from = editor.document.positionAt(removal.start);
      const to = editor.document.positionAt(removal.end);
      const last = editor.document.positionAt(removal.end - 1);
      if (!labels.has(from.line)) {
        labels.add(from.line);
        const anchor = new vscode.Position(from.line, 0);
        const whitespace = !current.slice(removal.start, removal.end).trim() && !removal.text.trim();
        const wholeLines = from.character === 0 && (to.character === 0 || removal.end === current.length);
        const label = whitespace ? '【空白差异】' : removal.text ? '【待替换 · 先删红字】' :
          wholeLines ? `【待删除 · ${last.line - from.line + 1} 行】` : '【待删除 · 仅红色字符】';
        instructions.push({ range: new vscode.Range(anchor, anchor),
          renderOptions: { before: { contentText: label } } });
      }
      return { range: new vscode.Range(from, to) };
    }));
    editor.setDecorations(this.instruction, instructions);
    this.status.text = deleting ? '$(trash) 跟写 · 需要删除整个文件' :
      `$(edit) 跟写 · 第 ${start.line + 1} 行 · ${edit.prepareLine ? '先按 Enter 空出待写行' : edit.end > edit.start ? '先删除红字' : /^[\r\n]/.test(edit.text) ? '先按 Enter 换行' : '点击显示虚影'}`;
    this.status.tooltip = deleting ? '在跟写侧栏右键此文件，选择删除文件并移到回收站。' :
      `目标在正文以原生多行虚影显示；点击定位。普通补全打开时按 Esc 可回到虚影。\n${edit.text.slice(0, 6000)}`;
    const config = vscode.workspace.getConfiguration('editor', editor.document);
    if (edit.text && edit.start === edit.end && !config.get<boolean>('inlineSuggest.enabled', true)) {
      this.unavailable('请启用内联建议显示虚影', edit.text, 'editor.inlineSuggest.enabled');
    }
    this.status.show();
    if (this.locateDocument === editor.document) {
      this.locateDocument = undefined;
      editor.selection = new vscode.Selection(start, start);
      editor.revealRange(new vscode.Range(start, start), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    if (!edit.prepareLine && edit.start === edit.end && edit.text && config.get<boolean>('inlineSuggest.enabled', true)) {
      if (editor.selection.isEmpty && editor.selection.active.line === start.line && editor.document.offsetAt(editor.selection.active) <= edit.start) {
        // 新宿主支持按扩展选择提供器；只为练习请求目标，避免混入其他 AI 候选。
        // 老宿主保留通用触发，不能把新版本的命令参数当作最低支持版本的保证。
        const [major, minor] = vscode.version.split('.').map(Number);
        if (major > 1 || major === 1 && minor >= 138) {
          await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger', { providerId: 'jtsgxh.ai-diff-follow:*' });
        } else await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
      } else {
        this.status.text = `$(location) 跟写 · 第 ${start.line + 1} 行 · 点击定位虚影`;
      }
    }
  }

  /** 合并按键事件，延迟刷新不会为每个字符启动 Git 进程。 */
  private schedule(locate = false): void {
    // 仅进入文件或恢复任务时请求定位；布局、滚动及光标事件不能丢掉尚未完成的定位，也不能反复抢光标。
    if (locate) this.locateDocument = vscode.window.activeTextEditor?.document;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const key = this.key;
      const document = vscode.window.activeTextEditor?.document;
      void this.render().catch((error: unknown) => {
        if (this.disposed || key !== this.key || document !== vscode.window.activeTextEditor?.document) return;
        if (vscode.window.activeTextEditor) this.clear(vscode.window.activeTextEditor);
        this.status.text = '$(error) 跟写目标读取失败';
        this.status.tooltip = error instanceof Error ? error.message : String(error);
        this.status.show();
      });
    }, 100);
  }

  /** 打开文件后立即定位第一处待跟写内容，复用调用方已读取的目标快照。 */
  async open(editor: vscode.TextEditor, target: string): Promise<void> {
    const file = this.file(editor.document);
    if (!file) return;
    this.targets.set(file.path, Promise.resolve(target));
    this.lensChange.fire();
    this.locateDocument = editor.document;
    await this.render();
  }

  /** 状态栏与侧栏可能持有焦点，先返回真实编辑器，再请求下一处虚影。 */
  async locate(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor && this.file(editor.document)) {
      await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preview: false, preserveFocus: false });
    }
    await this.render(true);
  }

  /** 释放事件、装饰和定时器，关闭扩展后清除所有提示。 */
  dispose(): void {
    this.disposed = true;
    this.updateKeyboardContext();
    if (this.timer) clearTimeout(this.timer);
    this.subscriptions.forEach((subscription) => subscription.dispose());
    for (const editor of vscode.window.visibleTextEditors) this.clear(editor);
    this.deleted.dispose(); this.instruction.dispose(); this.insertion.dispose(); this.inlineInsertion.dispose(); this.lensChange.dispose(); this.status.dispose(); this.targets.clear();
  }
}
