import * as vscode from 'vscode';
import path from 'node:path';
import { gitService } from '../server/gitService';
import type { FollowFile, FollowSession } from '../server/followService';
import { nextGhostEdit, type GhostEdit } from '../shared/followGhost';

/** 用原生多行虚影展示待写代码，真实文档只保留用户已经输入的内容。 */
export class FollowGhost implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private readonly deleted = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'), textDecoration: 'line-through',
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
  private readonly subscriptions: vscode.Disposable[];
  private readonly targets = new Map<string, Promise<string | undefined>>();
  private readonly plans = new WeakMap<vscode.TextDocument, { version: number; target: string; edit?: GhostEdit }>();
  private files = new Map<string, FollowFile>();
  private session?: FollowSession;
  private key = '';
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  /** 输入与切换文件后重新提供多行目标，保留普通语言补全。 */
  constructor() {
    this.status.command = 'aiDiff.follow.locate';
    this.subscriptions = [vscode.languages.registerInlineCompletionItemProvider({ scheme: 'file' }, this),
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule()),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) this.schedule();
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) this.schedule();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('editor.inlineSuggest', vscode.window.activeTextEditor?.document)) this.schedule();
      })];
  }

  /** 步骤推进时丢弃历史目标，保持原有练习目录和用户文本不变。 */
  setStep(session: FollowSession | undefined, files: FollowFile[]): void {
    const key = session && !session.finished ? `${session.practiceRepo}\0${session.steps[session.stepIndex].hash}` : '';
    if (key !== this.key) {
      this.targets.clear(); this.key = key;
      for (const editor of vscode.window.visibleTextEditors) this.clear(editor);
    }
    this.session = session;
    this.files = new Map(files.map((file) => [file.path, file]));
    this.schedule();
  }

  /** 限定提示只能出现在当前步骤内的真实练习文件中。 */
  private file(document: vscode.TextDocument): FollowFile | undefined {
    if (!this.key || !this.session || document.uri.scheme !== 'file') return;
    const relative = path.relative(this.session.practiceRepo, document.uri.fsPath).split(path.sep).join('/');
    return this.files.get(relative);
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
  private plan(document: vscode.TextDocument, target: string): GhostEdit | undefined {
    const cached = this.plans.get(document);
    if (cached?.version === document.version && cached.target === target) return cached.edit;
    const edit = nextGhostEdit(document.getText(), target);
    this.plans.set(document, { version: document.version, target, edit });
    return edit;
  }

  /** 只清除本扩展自己的装饰，不干预其他扩展的提示或补全。 */
  private clear(editor: vscode.TextEditor): void {
    editor.setDecorations(this.deleted, []);
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

  /** 提供真实多行内容；换行范围必须到行末，并把现有右侧代码原样带回，避免吞掉或连错行。 */
  async provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position,
    context: vscode.InlineCompletionContext, token: vscode.CancellationToken): Promise<vscode.InlineCompletionItem[]> {
    const key = this.key;
    const version = document.version;
    const target = await this.target(document);
    if (this.disposed || token.isCancellationRequested || key !== this.key || version !== document.version ||
      vscode.window.activeTextEditor?.document !== document || target === undefined) return [];
    const edit = this.plan(document, target);
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
    const text = this.chunk(edit.text, 4000 - prefix.length - suffix.length);
    if (!text) return this.unavailable('当前行过长，无法显示虚影；悬停查看目标', edit.text);
    const insertText = prefix + text + suffix;
    if (selected && !insertText.startsWith(selected.text)) return this.unavailable('按 Esc 关闭补全菜单，继续显示目标', edit.text);
    if (multiline && suffix && vscode.workspace.getConfiguration('editor', document).get<string>('inlineSuggest.mode', 'subwordSmart') === 'prefix') {
      return this.unavailable('请将内联建议切换为子词模式', edit.text, 'editor.inlineSuggest.mode');
    }
    const item = new vscode.InlineCompletionItem(insertText, new vscode.Range(from, to));
    item.filterText = current.slice(fromOffset, toOffset);
    this.status.text = `$(edit) 跟写 · 第 ${start.line + 1} 行 · 照虚影输入`;
    this.status.tooltip = `照正文虚影输入；普通补全打开时按 Esc 返回虚影。\n${edit.text.slice(0, 6000)}`;
    this.status.command = 'aiDiff.follow.locate';
    this.status.show();
    return [item];
  }

  /** 标记待移除的旧内容，点击状态栏可重新定位下一处差异。 */
  private async render(locate = false): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    this.status.hide();
    this.status.command = 'aiDiff.follow.locate';
    for (const visible of vscode.window.visibleTextEditors) if (visible !== editor) this.clear(visible);
    if (!editor) return;
    const key = this.key;
    const version = editor.document.version;
    const target = await this.target(editor.document);
    if (this.disposed || key !== this.key || editor !== vscode.window.activeTextEditor ||
      version !== editor.document.version) return;
    if (target === undefined) { this.clear(editor); return; }
    const edit = this.plan(editor.document, target);
    const deleting = this.file(editor.document)?.deleted && !this.file(editor.document)?.complete;
    if (!edit) {
      this.clear(editor);
      this.status.text = deleting ? '$(trash) 跟写 · 需要删除整个文件' : '$(pass) 跟写内容已一致';
      this.status.tooltip = deleting ? '在跟写侧栏右键此文件，选择删除文件并移到回收站；清空内容不等于删除文件。' : '当前文本已与目标一致，保存后可检查整个练习。';
      this.status.show(); return;
    }
    const start = editor.document.positionAt(edit.start);
    const range = new vscode.Range(start, editor.document.positionAt(edit.end));
    editor.setDecorations(this.deleted, edit.end > edit.start ? [{ range, hoverMessage: '先删除或替换这些旧内容，再继续跟写虚影。' }] : []);
    this.status.text = deleting ? '$(trash) 跟写 · 需要删除整个文件' :
      `$(edit) 跟写 · 第 ${start.line + 1} 行 · ${edit.end > edit.start ? '先删除红字' : '照虚影输入'}`;
    this.status.tooltip = deleting ? '在跟写侧栏右键此文件，选择删除文件并移到回收站。' :
      `目标在正文以原生多行虚影显示；点击定位。普通补全打开时按 Esc 可回到虚影。\n${edit.text.slice(0, 6000)}`;
    const config = vscode.workspace.getConfiguration('editor', editor.document);
    if (edit.text && edit.start === edit.end && !config.get<boolean>('inlineSuggest.enabled', true)) {
      this.unavailable('请启用内联建议显示虚影', edit.text, 'editor.inlineSuggest.enabled');
    }
    this.status.show();
    if (locate) {
      editor.selection = new vscode.Selection(start, start);
      editor.revealRange(new vscode.Range(start, start), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    if (edit.start === edit.end && edit.text && config.get<boolean>('inlineSuggest.enabled', true)) {
      if (editor.selection.isEmpty && editor.selection.active.line === start.line && editor.document.offsetAt(editor.selection.active) <= edit.start) {
        await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
      } else {
        this.status.text = `$(location) 跟写 · 第 ${start.line + 1} 行 · 点击定位虚影`;
      }
    }
  }

  /** 合并按键事件，延迟刷新不会为每个字符启动 Git 进程。 */
  private schedule(): void {
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
    await this.render(true);
  }

  /** 由状态栏或命令面板返回下一处未完成的跟写位置。 */
  async locate(): Promise<void> { await this.render(true); }

  /** 释放事件、装饰和定时器，关闭扩展后清除所有提示。 */
  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.subscriptions.forEach((subscription) => subscription.dispose());
    for (const editor of vscode.window.visibleTextEditors) this.clear(editor);
    this.deleted.dispose(); this.status.dispose(); this.targets.clear();
  }
}
