import * as vscode from 'vscode';
import path from 'node:path';
import { gitService } from '../server/gitService';
import type { FollowFile, FollowSession } from '../server/followService';
import { nextGhostEdit, type GhostEdit } from '../shared/followGhost';

/** 用原生文字装饰和独立预览行提示下一处代码，不占用补全通道或修改文件。 */
export class FollowGhost implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly deleted = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'), textDecoration: 'line-through',
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private readonly ghost = vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    before: { color: new vscode.ThemeColor('editorGhostText.foreground'), fontStyle: 'italic' },
  });
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
  private readonly lensChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.lensChange.event;
  private preview?: { document: vscode.TextDocument; version: number; lens: vscode.CodeLens };
  private readonly subscriptions: vscode.Disposable[];
  private readonly targets = new Map<string, Promise<string | undefined>>();
  private readonly plans = new WeakMap<vscode.TextDocument, { version: number; target: string; edit?: GhostEdit }>();
  private files = new Map<string, FollowFile>();
  private session?: FollowSession;
  private key = '';
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  /** 输入与切换文件后更新淡色提示，普通语言补全保持独立。 */
  constructor() {
    this.status.command = 'aiDiff.follow.locate';
    this.subscriptions = [vscode.languages.registerCodeLensProvider({ scheme: 'file' }, this),
      vscode.window.onDidChangeActiveTextEditor(() => { this.setPreview(); this.schedule(); }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) this.schedule();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('editor.codeLens', vscode.window.activeTextEditor?.document)) this.schedule();
      })];
  }

  /** 步骤推进时丢弃历史目标，保持原有练习目录和用户文本不变。 */
  setStep(session: FollowSession | undefined, files: FollowFile[]): void {
    const key = session && !session.finished ? `${session.practiceRepo}\0${session.steps[session.stepIndex].hash}` : '';
    if (key !== this.key) {
      this.targets.clear(); this.key = key;
      this.setPreview();
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
    editor.setDecorations(this.ghost, []);
  }

  /** 使用独立的原生预览行承载换行目标，避免装饰把待写代码拼到现有代码前。 */
  private setPreview(preview?: { document: vscode.TextDocument; version: number; lens: vscode.CodeLens }): void {
    if (this.preview?.document === preview?.document && this.preview?.version === preview?.version &&
      this.preview?.lens.command?.title === preview?.lens.command?.title &&
      this.preview?.lens.range.start.line === preview?.lens.range.start.line) return;
    this.preview = preview;
    this.lensChange.fire();
  }

  /** 仅返回当前文档版本的预览，切换文件或输入后不展示过时的目标。 */
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    return this.preview?.document === document && this.preview.version === document.version ? [this.preview.lens] : [];
  }

  /** 限制两种预览的长度并保留 Unicode 字符边界，用可见符号区分 Tab 和纯空格缩进。 */
  private hintLine(line: string): string {
    let text = line.replace(/\t/g, '⇥').slice(0, 2000);
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    return line.trim() ? text : text.replace(/ /g, '·');
  }

  /** 标记待移除的旧内容，点击状态栏可重新定位下一处差异。 */
  private async render(locate = false): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    this.status.hide();
    for (const visible of vscode.window.visibleTextEditors) if (visible !== editor) this.clear(visible);
    if (!editor) { this.setPreview(); return; }
    const key = this.key;
    const version = editor.document.version;
    const target = await this.target(editor.document);
    if (this.disposed || key !== this.key || editor !== vscode.window.activeTextEditor ||
      version !== editor.document.version) return;
    if (target === undefined) { this.clear(editor); this.setPreview(); return; }
    const edit = this.plan(editor.document, target);
    const deleting = this.file(editor.document)?.deleted && !this.file(editor.document)?.complete;
    if (!edit) {
      this.clear(editor);
      this.setPreview();
      this.status.text = deleting ? '$(trash) 跟写 · 需要删除整个文件' : '$(pass) 跟写内容已一致';
      this.status.tooltip = deleting ? '在跟写侧栏右键此文件，选择删除文件并移到回收站；清空内容不等于删除文件。' : '当前文本已与目标一致，保存后可检查整个练习。';
      this.status.show(); return;
    }
    const start = editor.document.positionAt(edit.start);
    const range = new vscode.Range(start, editor.document.positionAt(edit.end));
    editor.setDecorations(this.deleted, edit.end > edit.start ? [{ range, hoverMessage: '待删除或替换的旧内容；目标内容以淡字或独立预览行显示。' }] : []);
    if (edit.text) {
      const line = edit.text.split(/\r\n|\r|\n/, 1)[0];
      if (/[\r\n]/.test(edit.text)) {
        const lineStart = editor.document.offsetAt(new vscode.Position(start.line, 0));
        const prefix = editor.document.getText().slice(lineStart, edit.start);
        const text = this.hintLine(prefix + line);
        const title = line ? `待写目标：${text}  ↵ 换行` : prefix ? `在此处换行：${text} ↵` : '待插入空行：按 Enter';
        editor.setDecorations(this.ghost, []);
        this.setPreview({ document: editor.document, version, lens: new vscode.CodeLens(new vscode.Range(start, start),
          { title, command: 'aiDiff.follow.locate', tooltip: `点击定位待写位置；输入目标代码后按 Enter。\n${edit.text.slice(0, 6000)}` }) });
      } else {
        this.setPreview();
        editor.setDecorations(this.ghost, [{ range: new vscode.Range(start, start),
          renderOptions: { before: { contentText: this.hintLine(line) } },
          hoverMessage: `本段待跟写内容（淡字不写入文件，⇥ 表示 Tab，纯缩进中的 · 表示空格）：\n${edit.text.slice(0, 6000)}` }]);
      }
    } else { editor.setDecorations(this.ghost, []); this.setPreview(); }
    this.status.text = deleting ? '$(trash) 跟写 · 需要删除整个文件' :
      `$(edit) 跟写 · 第 ${start.line + 1} 行 · ${edit.end > edit.start ? '删除红字' : this.preview ? '照目标输入' : '输入淡字'}`;
    this.status.tooltip = deleting ? '在跟写侧栏右键此文件，选择删除文件并移到回收站。' :
      '单行目标以淡字显示；换行目标显示在独立预览行，需开启 editor.codeLens。⇥ 表示 Tab；点击定位下一处。';
    if (this.preview && !vscode.workspace.getConfiguration('editor', editor.document).get<boolean>('codeLens', true)) {
      this.status.text = '$(warning) 跟写 · 开启代码透镜以显示换行目标';
      this.status.tooltip = `在设置中启用 editor.codeLens。当前目标：\n${this.preview.lens.command?.title}\n${edit.text.slice(0, 6000)}`;
    }
    this.status.show();
    if (locate) {
      editor.selection = new vscode.Selection(start, start);
      editor.revealRange(new vscode.Range(start, start), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
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
        this.setPreview();
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
    this.deleted.dispose(); this.ghost.dispose(); this.status.dispose(); this.targets.clear(); this.lensChange.dispose();
  }
}
