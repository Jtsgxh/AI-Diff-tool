import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'node:path';
import simpleGit from 'simple-git';
import { gitService } from '../server/gitService';
import { advanceFollow, checkFollow, combineFollow, createFollow, isWithin, loadFollow, safePracticePath,
  type FollowSession, type FollowCheck, type FollowFile } from '../server/followService';
import { VSCodeWorkbench } from './workbench';
import { FollowGhost } from './followGhost';

const SCHEME = 'ai-diff-reference';

/** 将文件与准确版本编码为只读 URI，不在工作区创建参考副本。 */
function referenceUri(repo: string, file: string, revision?: string): vscode.Uri {
  return vscode.Uri.from({ scheme: SCHEME, path: `/${path.basename(file)}`,
    query: new URLSearchParams({ repo, file, ...(revision ? { revision } : { empty: '1' }) }).toString() });
}

/** 提供历史文件或空目标，只读内容不承担练习侧的语言索引。 */
class ReferenceDocuments implements vscode.TextDocumentContentProvider {
  /** 从 Git 对象读取准确文本，二进制和过大文件明确提示。 */
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const query = new URLSearchParams(uri.query);
    if (query.get('empty') === '1') return '';
    const preview = await gitService.getFilePreview(query.get('repo') || '', query.get('file') || '', query.get('revision') || '');
    if (preview.content === null) throw new Error('二进制或过大文件不能以文本对照，请使用资源同步或外部工具。');
    return preview.content;
  }
}

/** 将当前练习进度和目标差异呈现在原生 Explorer 侧栏中。 */
class FollowTree implements vscode.TreeDataProvider<FollowFile> {
  readonly change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.change.event;
  session?: FollowSession;
  result?: FollowCheck;
  private revision = 0;

  /** 使用会话和磁盘内容刷新；过期检查不会覆盖最新结果。 */
  async refresh(): Promise<void> {
    const revision = ++this.revision;
    const result = this.session ? await checkFollow(this.session) : undefined;
    if (revision !== this.revision) return;
    this.result = result;
    this.change.fire();
  }

  /** 返回本步文件及所有误改，未打开练习时显示欢迎入口。 */
  getChildren(): FollowFile[] { return this.result?.files || []; }

  /** 用完成图标和未保存提示展示状态，点击进入单文件虚影跟写。 */
  getTreeItem(file: FollowFile): vscode.TreeItem {
    const item = new vscode.TreeItem(file.path);
    const dirty = vscode.workspace.textDocuments.some((document) => document.isDirty && document.uri.scheme === 'file' &&
      this.session && document.uri.fsPath === path.join(this.session.practiceRepo, file.path));
    item.description = dirty ? '未保存' : file.complete ? '已一致' : file.unexpected ? '额外改动' : file.deleted ? '需要删除' : '待跟写';
    item.iconPath = new vscode.ThemeIcon(file.complete && !dirty ? 'pass' : 'circle-outline');
    item.contextValue = file.deleted ? 'followDeleted' : 'followFile';
    item.command = { command: 'aiDiff.follow.open', title: '打开虚影跟写', arguments: [file] };
    item.tooltip = `${file.path}\n${item.description}`;
    return item;
  }
}

/** 选择本地 Git 仓库，优先使用当前工作区的第一个目录。 */
async function chooseRepository(): Promise<string | undefined> {
  const active = vscode.workspace.workspaceFolders?.[0];
  if (active?.uri.scheme === 'file') {
    try { return (await simpleGit(active.uri.fsPath).revparse(['--show-toplevel'])).trim(); } catch { /* 非仓库时继续选择。 */ }
  }
  const selected = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
    openLabel: '选择参考 Git 仓库' });
  if (!selected?.[0]) return;
  return (await simpleGit(selected[0].fsPath).revparse(['--show-toplevel'])).trim();
}

/** 在最近提交和任意提交输入之间选择，不把历史读取上限当课程范围。 */
async function chooseCommit(repo: string, title: string): Promise<string | undefined> {
  const commits = await gitService.getCommits(repo);
  const choice = await vscode.window.showQuickPick([
    { label: '$(edit) 输入提交 SHA、分支或标签', hash: '' },
    ...commits.map((commit) => ({ label: `${commit.shortHash} ${commit.message}`, description: commit.author, hash: commit.hash })),
  ], { title, matchOnDescription: true, ignoreFocusOut: true });
  if (!choice) return;
  return choice.hash || vscode.window.showInputBox({ title, prompt: '输入提交 SHA、分支或标签', ignoreFocusOut: true });
}

/** 激活扩展：复用业务服务，代码编辑和符号检索交给 VS Code 及语言扩展。 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.isTrusted) return;
  const tree = new FollowTree();
  const view = vscode.window.createTreeView('aiDiff.follow', { treeDataProvider: tree });
  const ghost = new FollowGhost();
  context.subscriptions.push(ghost);
  context.subscriptions.push(view, tree.change, vscode.workspace.registerTextDocumentContentProvider(SCHEME, new ReferenceDocuments()));
  let busy = false;

  /** 统一显示错误并串行执行写入和推进，防止快速点击造成重复操作。 */
  const action = (callback: (...args: any[]) => Promise<unknown>) => async (...args: any[]) => {
    if (busy) { void vscode.window.showInformationMessage('AI Diff 正在处理上一项操作。'); return; }
    busy = true;
    try { return await callback(...args); }
    catch (error) { void vscode.window.showErrorMessage(`AI Diff：${error instanceof Error ? error.message : String(error)}`); }
    finally { busy = false; }
  };

  /** 刷新文件状态和步骤标题，完成后保留最后一步以供查看。 */
  const refresh = async () => {
    await tree.refresh();
    const session = tree.session;
    ghost.setStep(session, tree.result?.files || []);
    view.description = session ? session.finished ? '全部完成' : session.mode === 'combined' ? '合并跟写' : `${session.stepIndex + 1} / ${session.steps.length}` : undefined;
    view.message = session ? session.mode === 'combined' ?
      `${session.baseHash.slice(0, 7)} → ${session.steps[0].hash.slice(0, 7)} · ${session.steps[0].message}` :
      `${session.steps[session.stepIndex].hash.slice(0, 7)} · ${session.steps[session.stepIndex].message}` : undefined;
    await vscode.commands.executeCommand('setContext', 'aiDiff.followMode', session ? session.mode || 'commits' : undefined);
  };

  /** 只保存练习目录内的文档，不影响其他工作区中的未保存内容。 */
  const savePractice = async () => {
    if (!tree.session) throw new Error('请先创建或打开跟写练习。');
    for (const document of vscode.workspace.textDocuments) {
      if (document.isDirty && document.uri.scheme === 'file' && isWithin(tree.session.practiceRepo, document.uri.fsPath)) {
        if (!(await document.save())) throw new Error(`文件保存失败：${document.fileName}`);
      }
    }
  };

  /** 在原生编辑器打开工作区文件，历史版本使用只读提供器。 */
  const openNative = async (repo: string, file: string, revision?: string) => {
    const root = (await simpleGit(repo).revparse(['--show-toplevel'])).trim();
    const uri = revision ? referenceUri(root, file, revision) : vscode.Uri.file(await safePracticePath(root, file));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { viewColumn: vscode.ViewColumn.Beside });
  };
  const workbench = new VSCodeWorkbench(context, openNative);
  context.subscriptions.push(workbench);

  /** 注册带错误处理的公开命令。 */
  const register = (name: string, callback: (...args: any[]) => Promise<unknown>) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, action(callback)));

  register('aiDiff.open', async () => {
    const repo = tree.session?.practiceRepo || await chooseRepository();
    if (repo) await workbench.open(repo, tree.session?.steps[tree.session.stepIndex].hash);
  });

  register('aiDiff.follow.create', async () => {
    const repo = await chooseRepository();
    if (!repo) return;
    const base = await chooseCommit(repo, '选择基准提交（练习初始内容）');
    if (!base) return;
    const target = await chooseCommit(repo, '选择结束提交（合并范围的最终目标）');
    if (!target) return;
    const destination = await vscode.window.showSaveDialog({ title: '选择尚不存在的练习目录', saveLabel: '创建练习目录',
      defaultUri: vscode.Uri.file(path.join(path.dirname(repo), `${path.basename(repo)}-practice`)) });
    if (!destination) return;
    const session = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
      title: '正在准备合并范围并创建独立练习目录…' }, () => createFollow(repo, destination.fsPath, base, target));
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(session.practiceRepo), true);
  });

  register('aiDiff.follow.check', async () => {
    await savePractice();
    await refresh();
    const missing = tree.result!.files.filter((file) => !file.complete);
    if (!missing.length) void vscode.window.showInformationMessage(tree.session?.mode === 'combined' ?
      '全部文件已与结束提交一致，可以完成练习。' : '本步文件已与目标提交一致，可以进入下一步。');
    else void vscode.window.showInformationMessage(`还有 ${missing.length} 个文件未一致，已在跟写侧栏标出。`);
  });

  /** 复用完整校验，合并练习直接完成，旧练习继续原有逐提交推进。 */
  const advance = async () => {
    await savePractice();
    tree.session = await advanceFollow(tree.session!);
    await refresh();
    workbench.updateReference(tree.session.practiceRepo, tree.session.steps[tree.session.stepIndex].hash);
    if (tree.session.finished) void vscode.window.showInformationMessage('练习已完成，文件与目标提交一致。');
  };
  register('aiDiff.follow.next', advance);
  register('aiDiff.follow.finish', advance);

  /** 显式转换旧练习，保留磁盘内容和未保存草稿，只更新最终跟写目标。 */
  register('aiDiff.follow.combine', async () => {
    if (!tree.session) throw new Error('请先打开跟写练习。');
    tree.session = await combineFollow(tree.session);
    await refresh();
    workbench.updateReference(tree.session.practiceRepo, tree.session.steps[0].hash);
    void vscode.window.showInformationMessage('已合并为基准到结束提交的一个目标，保留已有编辑内容。');
  });

  /** 共用路径和资源检查，默认单文件虚影跟写，右键命令保留目标对照。 */
  const openFollow = async (file: FollowFile, compare = false) => {
    if (!tree.session || !file || typeof file.path !== 'string') return;
    const target = tree.session.steps[tree.session.stepIndex].hash;
    const current = (await checkFollow(tree.session)).files.find((candidate) => candidate.path === file.path);
    if (!current) throw new Error('该文件已不在当前步骤中，请重新检查。');
    const full = await safePracticePath(tree.session.practiceRepo, current.path);
    if (current.deleted) {
      if (current.complete) {
        const previous = tree.session.stepIndex ? tree.session.steps[tree.session.stepIndex - 1].hash : tree.session.baseHash;
        await openNative(tree.session.practiceRepo, current.path, previous);
      } else if (compare) await vscode.commands.executeCommand('vscode.diff', referenceUri(tree.session.practiceRepo, current.path),
        vscode.Uri.file(full), `目标已删除 ↔ 跟写 · ${current.path}`, { preview: false });
      else {
        const editor = await vscode.window.showTextDocument(vscode.Uri.file(full), { preview: false });
        await ghost.open(editor, '');
      }
      return;
    }
    const preview = await gitService.getFilePreview(tree.session.practiceRepo, current.path, target);
    if (preview.content === null) throw new Error('二进制资源请右键选择“同步本步二进制资源”；过大文本请使用外部工具。');
    await fs.mkdir(path.dirname(full), { recursive: true });
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(vscode.Uri.file(full), { ignoreIfExists: true });
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error('无法创建练习文件。');
    if (compare) await vscode.commands.executeCommand('vscode.diff', referenceUri(tree.session.practiceRepo, current.path, target),
      vscode.Uri.file(full), `参考目标 ↔ 跟写 · ${current.path}`, { viewColumn: vscode.ViewColumn.One, preview: false });
    else {
      const editor = await vscode.window.showTextDocument(vscode.Uri.file(full), { viewColumn: vscode.ViewColumn.One, preview: false });
      await ghost.open(editor, preview.content);
    }
  };
  register('aiDiff.follow.open', (file: FollowFile) => openFollow(file));
  register('aiDiff.follow.compare', (file: FollowFile) => openFollow(file, true));
  register('aiDiff.follow.locate', () => ghost.locate());

  register('aiDiff.follow.delete', async (file: FollowFile) => {
    if (!tree.session || !file) return;
    const current = (await checkFollow(tree.session)).files.find((candidate) => candidate.path === file.path);
    if (!current?.deleted || current.complete) throw new Error('该文件不需要删除。');
    const full = await safePracticePath(tree.session.practiceRepo, current.path);
    const confirm = await vscode.window.showWarningMessage(`删除练习文件 ${current.path}？`, { modal: true }, '移到回收站');
    if (confirm !== '移到回收站') return;
    await vscode.workspace.fs.delete(vscode.Uri.file(full), { useTrash: true });
    await refresh();
  });

  register('aiDiff.follow.sync', async (file: FollowFile) => {
    if (!tree.session || !file) return;
    const current = (await checkFollow(tree.session)).files.find((candidate) => candidate.path === file.path);
    if (!current || current.deleted || current.complete) throw new Error('该文件不需要资源同步。');
    const target = tree.session.steps[tree.session.stepIndex].hash;
    const preview = await gitService.getFilePreview(tree.session.practiceRepo, current.path, target);
    if (!preview.isBinary) throw new Error('文本代码需要手动跟写，不能通过资源同步填入。');
    const confirm = await vscode.window.showWarningMessage(`使用目标提交覆盖练习资源 ${current.path}？`, { modal: true }, '同步资源');
    if (confirm !== '同步资源') return;
    const full = await safePracticePath(tree.session.practiceRepo, current.path);
    const content = await simpleGit(tree.session.practiceRepo).binaryCatFile(['-p', `${target}:${current.path}`]);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await vscode.workspace.fs.writeFile(vscode.Uri.file(full), content);
    await refresh();
  });

  register('aiDiff.symbols', async () => {
    const query = await vscode.window.showInputBox({ title: '搜索工作区符号', prompt: '使用当前语言扩展提供的代码索引' });
    if (query === undefined) return;
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', query) || [];
    if (!symbols.length) { void vscode.window.showInformationMessage('没有找到符号，请确认对应语言扩展和项目环境已就绪。'); return; }
    const picked = await vscode.window.showQuickPick(symbols.map((symbol) => ({ label: symbol.name,
      description: `${symbol.containerName || ''} · ${vscode.workspace.asRelativePath(symbol.location.uri)}`, symbol })), { title: '选择代码符号' });
    if (picked) await vscode.window.showTextDocument(picked.symbol.location.uri, { selection: picked.symbol.location.range });
  });

  // 仅在保存或文件结构改变后重查磁盘；输入中只更新未保存标识，避免每次按键扫描仓库。
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** 合并连续文件事件，并将后台失败显示为侧栏消息。 */
  const scheduleRefresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void refresh().catch((error: unknown) => { view.message = `检查失败：${error instanceof Error ? error.message : String(error)}`; }); }, 350);
  };
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(scheduleRefresh),
    vscode.workspace.onDidCreateFiles(scheduleRefresh), vscode.workspace.onDidDeleteFiles(scheduleRefresh),
    vscode.workspace.onDidRenameFiles(scheduleRefresh), vscode.workspace.onDidChangeTextDocument(() => tree.change.fire()),
    { dispose() { if (timer) clearTimeout(timer); } });
  for (const folder of vscode.workspace.workspaceFolders || []) {
    if (folder.uri.scheme !== 'file') continue;
    try {
      const session = await loadFollow(folder.uri.fsPath);
      if (session) { tree.session = session; await refresh(); break; }
    } catch (error) { void vscode.window.showErrorMessage(`恢复跟写失败：${error instanceof Error ? error.message : String(error)}`); }
  }
}
