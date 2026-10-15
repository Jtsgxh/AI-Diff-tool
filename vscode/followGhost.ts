import * as vscode from 'vscode';
import path from 'node:path';
import { gitService } from '../server/gitService';
import type { FollowFile, FollowSession } from '../server/followService';
import { nextGhostEdit, type GhostEdit } from '../shared/followGhost';

/** 在真实练习文件内显示下一处虚影和旧内容标记，不修改文档或编辑器配置。 */
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

  /** 注册原生虚影提供器，并在输入与切换文件后刷新同一编辑器中的提示。 */
  constructor() {
    this.status.command = 'aiDiff.follow.locate';
    this.subscriptions = [vscode.languages.registerInlineCompletionItemProvider({ scheme: 'file' }, this),
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) this.schedule();
      })];
  }

  /** 步骤推进时丢弃历史目标，保持原有练习目录和用户文本不变。 */
  setStep(session: FollowSession | undefined, files: FollowFile[]): void {
    const key = session && !session.finished ? `${session.practiceRepo}\0${session.steps[session.stepIndex].hash}` : '';
    if (key !== this.key) {
      this.targets.clear(); this.key = key;
      for (const editor of vscode.window.visibleTextEditors) editor.setDecorations(this.deleted, []);
      void vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
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
          .then((preview) => preview.content ?? undefined).catch(() => undefined));
    }
    const target = await this.targets.get(file.path)!;
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

  /** 在当前差异起点提供有限长度的原生虚影，已有文本保持为真实可编辑内容。 */
  async provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position,
    context: vscode.InlineCompletionContext, token: vscode.CancellationToken): Promise<vscode.InlineCompletionItem[]> {
    const key = this.key;
    const version = document.version;
    const target = await this.target(document);
    if (target === undefined || this.disposed || token.isCancellationRequested || key !== this.key || version !== document.version ||
      context.selectedCompletionInfo) return [];
    const edit = this.plan(document, target);
    if (!edit?.text || document.offsetAt(position) !== edit.start) return [];
    // 控制可见虚影体积；继续输入后自动展示后面的内容，不限制文件最终校验。
    let text = edit.text.split('\n').slice(0, 8).join('\n').slice(0, 2000);
    if (text.endsWith('\r')) text = text.slice(0, -1);
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    return text ? [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))] : [];
  }

  /** 标记待移除的旧内容，点击状态栏可重新定位下一处差异。 */
  private async render(locate = false): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    this.status.hide();
    if (!editor) return;
    editor.setDecorations(this.deleted, []);
    const key = this.key;
    const version = editor.document.version;
    const target = await this.target(editor.document);
    if (target === undefined || this.disposed || key !== this.key || editor !== vscode.window.activeTextEditor ||
      version !== editor.document.version) return;
    const edit = this.plan(editor.document, target);
    if (!edit) { this.status.text = '$(pass) 跟写内容已一致'; this.status.show(); return; }
    const start = editor.document.positionAt(edit.start);
    const range = new vscode.Range(start, editor.document.positionAt(edit.end));
    if (edit.end > edit.start) editor.setDecorations(this.deleted, [{ range, hoverMessage: '待删除或替换的旧内容；目标内容以淡色虚影显示。' }]);
    this.status.text = edit.end > edit.start ? '$(edit) 跟写 · 移除红色旧内容后填入虚影' :
      edit.text.trim() ? '$(edit) 跟写 · 按虚影输入' : '$(edit) 跟写 · 补齐缩进或换行';
    this.status.tooltip = '点击定位下一处跟写。虚影只是提示，保存和校验只读取你实际写入的内容。';
    this.status.show();
    if (locate) {
      editor.selection = new vscode.Selection(start, start);
      editor.revealRange(new vscode.Range(start, start), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    if (editor.selection.isEmpty && editor.document.offsetAt(editor.selection.active) === edit.start) {
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    }
  }

  /** 合并按键事件，延迟刷新不会为每个字符启动 Git 进程。 */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.render().catch(() => this.status.hide()); }, 100);
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

  /** 释放提供器、事件、装饰和定时器，关闭扩展后清除所有提示。 */
  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.subscriptions.forEach((subscription) => subscription.dispose());
    for (const editor of vscode.window.visibleTextEditors) editor.setDecorations(this.deleted, []);
    this.deleted.dispose(); this.status.dispose(); this.targets.clear();
  }
}
