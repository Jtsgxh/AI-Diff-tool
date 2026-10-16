import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import { decodePreviewBuffer, gitService } from '../server/gitService';
import * as follow from '../server/followService';
import { ensureFollowWorkspace } from '../vscode/followWorkspace';

/** 为真实 Git 检查提供可控完成边界，不使用时间猜测请求先后。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

test('native extension commands open real practice files, save only practice drafts and persist completion', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-diff-native-test-'));
  t.after(async () => {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('ai-diff-native-test-')) throw new Error('Unsafe cleanup');
    await fs.rm(root, { recursive: true, force: true });
  });
  const repo = path.join(root, 'source');
  await fs.mkdir(repo);
  /** 在测试源仓库中准备真实提交。 */
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Native Test');
  git('config', 'user.email', 'native@example.test');
  await fs.writeFile(path.join(repo, 'sample.ts'), 'export const value = 1;\n');
  await fs.writeFile(path.join(repo, 'removed.ts'), 'retained old code\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  await fs.writeFile(path.join(repo, 'sample.ts'), 'export const value = 2;\n');
  await fs.unlink(path.join(repo, 'removed.ts'));
  git('commit', '--quiet', '-am', 'target');
  const target = git('rev-parse', 'HEAD');
  const practice = path.join(root, 'practice');
  await follow.createFollow(repo, practice, base, target, 'commits');
  const commands = new Map<string, (...args: any[]) => Promise<unknown>>();
  const calls: any[][] = [];
  const errors: string[] = [];
  let provider: any;
  let nativeProvider: any;
  let practiceSaved = 0;
  let unrelatedSaved = 0;
  let savedEvent: (() => void) | undefined;
  const followApi = { ...follow };
  let resourceConfirmation: string | undefined;
  const resourcePrompts: string[] = [];
  const resourceWrites: string[] = [];
  /** 最小 URI 对象保留真实文件路径，避免用网页文件替代原生文件。 */
  const uri = (file: string) => ({ scheme: 'file', fsPath: file });
  const draft = { isDirty: true, uri: uri(path.join(practice, 'sample.ts')), fileName: 'sample.ts',
    /** 模拟 VS Code 保存实际练习文档。 */
    async save() { practiceSaved++; await fs.writeFile(this.uri.fsPath, 'export const value = 2;\n'); this.isDirty = false; return true; } };
  const disposable = { dispose() {} };
  const treeView = { ...disposable, description: undefined as string | undefined, message: undefined as string | undefined };
  const native = {
    version: '1.138.0',
    EventEmitter: class { event = () => disposable; fire() {} dispose() {} },
    TreeItem: class { constructor(public label: string) {} }, ThemeIcon: class { constructor(public id: string) {} },
    Uri: { file: uri, from: (value: any) => value }, ViewColumn: { One: 1, Beside: 2 },
    ProgressLocation: { Notification: 1 },
    WorkspaceEdit: class { createFile() {} },
    window: {
      createTreeView: (_id: string, options: any) => { provider = options.treeDataProvider; return treeView; },
      showErrorMessage: (message: string) => { errors.push(message); }, showInformationMessage() {},
      /** 记录资源覆盖提示，并由具体用例选择确认或取消。 */
      showWarningMessage: async (message: string) => { resourcePrompts.push(message); return resourceConfirmation; },
      showTextDocument: async (...args: any[]) => { calls.push(['showTextDocument', ...args]); return { document: { uri: args[0] } }; },
      showInputBox: async (_options?: any) => 'value', showQuickPick: async (items: any[], _options?: any): Promise<any> => items[0],
      /** 模拟选择练习目录并执行真实创建流程。 */
      showSaveDialog: async () => uri(path.join(root, 'created-practice')),
      /** 直接运行通知进度中的操作，不替换 Git 练习创建逻辑。 */
      withProgress: async (_options: any, callback: () => Promise<unknown>) => callback(),
    },
    commands: {
      registerCommand: (name: string, callback: (...args: any[]) => Promise<unknown>) => { commands.set(name, callback); return disposable; },
      executeCommand: async (name: string, ...args: any[]) => {
        calls.push([name, ...args]);
        if (name === 'vscode.executeWorkspaceSymbolProvider') return [{ name: 'value', containerName: '', location: { uri: uri(path.join(practice, 'sample.ts')), range: {} } }];
      },
    },
    workspace: {
      isTrusted: true, workspaceFolders: [{ uri: uri(practice) }],
      textDocuments: [draft, { isDirty: true, uri: uri(path.join(root, 'unrelated.ts')), async save() { unrelatedSaved++; return true; } }],
      registerTextDocumentContentProvider: (_scheme: string, value: any) => { nativeProvider = value; return disposable; },
      applyEdit: async () => true, openTextDocument: async (value: unknown) => value,
      fs: {
        /** 使用真实字节写入练习文件，确认取消和文本拒绝路径完全不写磁盘。 */
        writeFile: async (value: { fsPath: string }, content: Uint8Array) => {
          resourceWrites.push(value.fsPath);
          await fs.writeFile(value.fsPath, content);
        },
      },
      asRelativePath: (value: { fsPath: string }) => path.relative(practice, value.fsPath),
      /** 保存事件仍经过扩展自己的去抖调度，测试只捕获原生订阅入口。 */
      onDidSaveTextDocument: (callback: () => void) => { savedEvent = callback; return disposable; },
      onDidCreateFiles: () => disposable, onDidDeleteFiles: () => disposable,
      onDidRenameFiles: () => disposable, onDidChangeTextDocument: () => disposable,
    },
  };
  const require = createRequire(path.resolve('package.json'));
  const module = { exports: {} as any };
  const code = transformSync(fsSync.readFileSync('vscode/extension.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, URLSearchParams, setTimeout, clearTimeout,
    require: (id: string) => id === 'vscode' ? native : id === '../server/gitService' ? { gitService, decodePreviewBuffer }
      : id === '../server/followService' ? followApi : id === './workbench' ? { VSCodeWorkbench: class { dispose() {} updateReference() {} } }
      : id === './followWorkspace' ? { ensureFollowWorkspace } : id === './followGhost' ? { FollowGhost: class {
        /** 记录真实命令对虚影控制器的调用，具体提示另由专用测试检查。 */
        open(editor: any, target: string) { calls.push(['ghost.open', editor, target]); }
        /** 记录发布给虚影的会话与文件组合，检查并发刷新是否串步。 */
        setStep(session: follow.FollowSession, files: follow.FollowFile[]) { calls.push(['ghost.setStep', session, files]); }
        /** 保留定位命令接口供扩展注册。 */
        locate() {}
        /** 匹配扩展释放订阅的接口。 */
        dispose() {}
      } } : require(id) });
  const context = { subscriptions: [] as any[] };
  await module.exports.activate(context);
  assert.equal(provider.getChildren().length, 2);
  const sample = provider.getChildren().find((file: any) => file.path === 'sample.ts');
  // VS Code 会规范化 Windows 盘符大小写，未保存标识仍需对应同一个练习文件。
  if (process.platform === 'win32') draft.uri.fsPath = draft.uri.fsPath[0].toLowerCase() + draft.uri.fsPath.slice(1);
  assert.equal(provider.getTreeItem(sample).description, '未保存');
  assert.equal(provider.getTreeItem({ ...sample, complete: true }).iconPath.id, 'circle-outline');
  const removed = provider.getChildren().find((file: any) => file.path === 'removed.ts');
  const removedItem = provider.getTreeItem(removed);
  assert.equal(removedItem.iconPath.id, 'pass');
  assert.match(removedItem.description, /默认完成/);
  assert.equal(removedItem.contextValue, 'followDeletedComplete');
  await commands.get('aiDiff.follow.stable')!();
  assert.ok(calls.some((call) => call[0] === 'vscode.openFolder' && call[1].fsPath === path.join(practice, '.git', 'ai-diff-follow.code-workspace') && call[2].forceReuseWindow === true));
  // 已在专用工作区时只定位，不重复切换窗口。
  Object.assign(native.workspace, { workspaceFile: uri(path.join(practice, '.git', 'ai-diff-follow.code-workspace')) });
  const switches = calls.filter((call) => call[0] === 'vscode.openFolder').length;
  await commands.get('aiDiff.follow.stable')!();
  assert.equal(calls.filter((call) => call[0] === 'vscode.openFolder').length, switches);
  Reflect.deleteProperty(native.workspace, 'workspaceFile');
  await commands.get('aiDiff.follow.combine')!();
  assert.equal(practiceSaved, 0, 'combining preserves unsaved practice drafts');
  assert.equal(unrelatedSaved, 0);
  assert.equal((await follow.loadFollow(practice))?.mode, 'combined');
  assert.ok(calls.some((call) => call[0] === 'setContext' && call[1] === 'aiDiff.followMode' && call[2] === 'combined'));
  await commands.get('aiDiff.follow.open')!(sample);
  const opened = calls.find((call) => call[0] === 'showTextDocument');
  assert.equal(opened[1].fsPath, path.join(practice, 'sample.ts'));
  assert.equal(calls.some((call) => call[0] === 'vscode.diff'), false, 'default follow opens a single real editor');
  assert.equal(calls.find((call) => call[0] === 'ghost.open')[2], 'export const value = 2;\n');
  const ghostCalls = calls.filter(call => call[0] === 'ghost.open').length;
  await commands.get('aiDiff.follow.open')!(removed);
  assert.equal(calls.filter(call => call[0] === 'ghost.open').length, ghostCalls);
  assert.equal(await fs.readFile(path.join(practice, 'removed.ts'), 'utf8').then(text => text.replace(/\r\n/g, '\n')), 'retained old code\n');
  await commands.get('aiDiff.follow.compare')!(sample);
  const diff = calls.find((call) => call[0] === 'vscode.diff');
  assert.equal(diff[1].scheme, 'ai-diff-reference');
  assert.equal(diff[2].fsPath, path.join(practice, 'sample.ts'));
  assert.equal(new URLSearchParams(diff[1].query).get('revision'), target);
  assert.equal(await nativeProvider.provideTextDocumentContent(diff[1]), 'export const value = 2;\n');
  await commands.get('aiDiff.follow.check')!();
  assert.equal(practiceSaved, 1);
  assert.equal(unrelatedSaved, 0);
  await commands.get('aiDiff.follow.finish')!();
  assert.equal((await follow.loadFollow(practice))?.finished, true);
  /** 完成后的磁盘改动必须如实显示，但检查不能重写历史完成记录。 */
  await t.test('finished sessions report later disk changes without rewriting completion metadata', async () => {
    assert.equal(treeView.description, '全部完成');
    await fs.writeFile(path.join(practice, 'sample.ts'), 'export const value = 999;\n');
    await commands.get('aiDiff.follow.check')!();
    assert.equal(treeView.description, '已完成 · 内容有改动');
    assert.equal(provider.getChildren().find((file: follow.FollowFile) => file.path === 'sample.ts').complete, false);
    assert.equal((await follow.loadFollow(practice))?.finished, true, 'checking must not rewrite session history');
    await fs.writeFile(path.join(practice, 'sample.ts'), 'export const value = 2;\n');
    await commands.get('aiDiff.follow.check')!();
    assert.equal(treeView.description, '全部完成');
  });
  await commands.get('aiDiff.symbols')!();
  assert.ok(calls.some((call) => call[0] === 'vscode.executeWorkspaceSymbolProvider'));
  /** 验证两次提交选择都允许切出窗口，且手动输入与列表选择能完成真实练习创建。 */
  await t.test('commit selectors preserve focus-out interaction through manual and list selection', async () => {
    native.workspace.workspaceFolders = [{ uri: uri(repo) }];
    let pickCount = 0;
    /** 基准改用手动输入，结束提交直接从列表选择，分别检查保持打开选项。 */
    native.window.showQuickPick = async (items, options) => {
      assert.equal(options?.ignoreFocusOut, true);
      assert.equal(options?.matchOnDetail, true);
      assert.equal(items[0].hash, target, 'commit selection comes before manual input');
      pickCount++;
      return pickCount === 1 ? items.find((item) => item.action === 'manual') : items.find((item) => item.hash === target);
    };
    /** 模拟切到外部复制 SHA 后返回输入，输入框同样需要保持打开。 */
    native.window.showInputBox = async (options) => {
      assert.equal(options?.ignoreFocusOut, true);
      return base;
    };
    await commands.get('aiDiff.follow.create')!();
    assert.equal(pickCount, 2);
    assert.deepEqual(errors, []);
    const createdPath = path.join(root, 'created-practice');
    const created = await follow.loadFollow(createdPath);
    assert.equal(created?.mode, 'combined');
    assert.equal(created?.steps.length, 1);
    assert.equal(created?.baseHash, base);
    assert.equal(created?.steps[0].hash, target);
    // Git 检出遵循本机换行设置；验证基准内容，同时接受 Windows 的 CRLF。
    assert.match(await fs.readFile(path.join(createdPath, 'sample.ts'), 'utf8'), /^export const value = 1;\r?\n$/);
    assert.ok(calls.some((call) => call[0] === 'vscode.openFolder' && call[1].fsPath === path.join(createdPath, '.git', 'ai-diff-follow.code-workspace') && call[2] === true));
  });
  /** 模拟历史超过首批上限，列表点选较老基准及结束点，全程不需要输入 SHA。 */
  await t.test('commit list loads older history and selects both endpoints without manual input', async (t) => {
    const original = gitService.getCommits;
    t.after(() => { gitService.getCommits = original; });
    const records = await original.call(gitService, repo);
    const limits: number[] = [];
    /** 用分页记录模拟大型历史，练习创建仍使用真实可解析的两端提交。 */
    gitService.getCommits = async (_repo, limit = 100) => {
      limits.push(limit);
      return limit === 100 ? Array.from({ length: 100 }, () => records.find((record) => record.hash === target)!) : records;
    };
    let picks = 0;
    /** 先加载更早历史，再依次点击基准和结束提交，并检查列表的信息展示。 */
    native.window.showQuickPick = async (items, options) => {
      assert.equal(options?.ignoreFocusOut, true);
      assert.equal(options?.matchOnDescription, true);
      assert.equal(options?.matchOnDetail, true);
      picks++;
      if (picks === 1) return items.find((item) => item.action === 'more');
      const selected = items.find((item) => item.hash === (picks === 2 ? base : target));
      assert.match(selected.label, /base|target/);
      assert.match(selected.description, /Native Test/);
      assert.ok(selected.description.endsWith(records.find((record) => record.hash === selected.hash)!.date), 'preserve the complete Git date format');
      if (picks === 3) assert.match(selected.detail, /HEAD/);
      return selected;
    };
    /** 列表点选不得跳转至手动输入。 */
    native.window.showInputBox = async () => { assert.fail('Manual hash input must not be required'); };
    const createdPath = path.join(root, 'list-practice');
    /** 为第二个真实练习提供独立目录，避免覆盖前一个测试结果。 */
    native.window.showSaveDialog = async () => uri(createdPath);
    await commands.get('aiDiff.follow.create')!();
    assert.deepEqual(limits, [100, 200, 100]);
    assert.equal(picks, 3);
    assert.deepEqual(errors, []);
    const created = await follow.loadFollow(createdPath);
    assert.equal(created?.baseHash, base);
    assert.equal(created?.steps[0].hash, target);
  });
  /** 控制两个后台检查的交错顺序，验证新目标不会与旧文件表一起发布。 */
  await t.test('an older background check cannot publish the next session with previous-step files', async () => {
    await fs.writeFile(path.join(repo, 'next.ts'), 'export const next = true;\n');
    git('add', 'next.ts'); git('commit', '--quiet', '-m', 'second step');
    const nextTarget = git('rev-parse', 'HEAD');
    const racedPractice = path.join(root, 'raced-practice');
    provider.session = await follow.createFollow(repo, racedPractice, base, nextTarget, 'commits');
    native.workspace.textDocuments = [];
    await fs.writeFile(path.join(racedPractice, 'sample.ts'), 'export const value = 2;\n');
    await commands.get('aiDiff.follow.check')!();
    const prior = calls.filter(call => call[0] === 'ghost.setStep').at(-1)!;
    assert.equal(prior[1].stepIndex, 0);
    assert.ok(prior[2].some((file: follow.FollowFile) => file.path === 'sample.ts'));
    const checks = [
      { started: deferred<void>(), release: deferred<void>() },
      { started: deferred<void>(), release: deferred<void>() },
    ];
    let checkIndex = 0;
    /** 原样执行真实快照校验，只延后向扩展交付结果；推进内部校验保持原服务实现。 */
    followApi.checkFollow = async (session: follow.FollowSession) => {
      const gate = checks[checkIndex++];
      const result = await follow.checkFollow(session);
      gate?.started.resolve();
      if (gate) await gate.release.promise;
      return result;
    };
    let advancing: Promise<unknown> | undefined;
    try {
      savedEvent!();
      await checks[0].started.promise;
      advancing = commands.get('aiDiff.follow.next')!();
      await checks[1].started.promise;
      assert.equal(provider.session.stepIndex, 1, 'the real service has advanced metadata before the second refresh');
      const published = calls.filter(call => call[0] === 'ghost.setStep').length;
      checks[0].release.resolve();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(calls.filter(call => call[0] === 'ghost.setStep').length, published,
        'discarded background results must not publish a new target with old files');
      checks[1].release.resolve();
      await advancing;
      const latest = calls.filter(call => call[0] === 'ghost.setStep').at(-1)!;
      assert.equal(latest[1].stepIndex, 1);
      assert.deepEqual(latest[2].map((file: follow.FollowFile) => file.path), ['next.ts']);
      assert.equal((await follow.loadFollow(racedPractice))?.stepIndex, 1);
    } finally {
      for (const gate of checks) gate.release.resolve();
      await advancing;
      followApi.checkFollow = follow.checkFollow;
    }
  });
  /** 同步按实际字节判定资源类型，超过预览限制仍可同步，取消和文本保护不受影响。 */
  await t.test('binary synchronization handles oversized blobs while text and cancellation remain protected', async () => {
    const largeBinary = Buffer.alloc(5 * 1024 * 1024 + 1, 0x81);
    largeBinary[0] = 0;
    const largeText = Buffer.alloc(largeBinary.length, 0x41);
    const smallBinary = Buffer.from([0, 1, 2, 255]);
    await fs.writeFile(path.join(repo, 'large.bin'), largeBinary);
    await fs.writeFile(path.join(repo, 'cancel.bin'), largeBinary);
    await fs.writeFile(path.join(repo, 'large.txt'), largeText);
    await fs.writeFile(path.join(repo, 'small.bin'), smallBinary);
    git('add', 'large.bin', 'cancel.bin', 'large.txt', 'small.bin');
    git('commit', '--quiet', '-m', 'binary resources');
    const resourceTarget = git('rev-parse', 'HEAD');
    const resourcePractice = path.join(root, 'resource-practice');
    provider.session = await follow.createFollow(repo, resourcePractice, base, resourceTarget);
    const originalBinary = Buffer.from([0, 9, 8]);
    await fs.writeFile(path.join(resourcePractice, 'cancel.bin'), originalBinary);
    await fs.writeFile(path.join(resourcePractice, 'large.txt'), 'keep my text draft');
    const sync = commands.get('aiDiff.follow.sync')!;
    resourceConfirmation = '同步资源';
    await sync({ path: 'large.bin' });
    assert.equal(resourceWrites.length, 1, 'large binary must reach the existing explicit synchronization path');
    assert.deepEqual(await fs.readFile(path.join(resourcePractice, 'large.bin')), largeBinary);
    assert.deepEqual(errors, []);
    resourceConfirmation = undefined;
    const beforeCancelPrompts = resourcePrompts.length;
    await sync({ path: 'cancel.bin' });
    assert.equal(resourcePrompts.length, beforeCancelPrompts + 1, 'cancellation must follow the binary confirmation prompt');
    assert.equal(resourceWrites.length, 1);
    assert.deepEqual(await fs.readFile(path.join(resourcePractice, 'cancel.bin')), originalBinary);
    resourceConfirmation = '同步资源';
    const beforeTextPrompts = resourcePrompts.length;
    await sync({ path: 'large.txt' });
    assert.match(errors.pop()!, /文本代码需要手动跟写/);
    assert.equal(resourcePrompts.length, beforeTextPrompts, 'large text cannot offer answer synchronization');
    assert.equal(resourceWrites.length, 1);
    assert.equal(await fs.readFile(path.join(resourcePractice, 'large.txt'), 'utf8'), 'keep my text draft');
    await sync({ path: 'small.bin' });
    assert.equal(resourceWrites.length, 2);
    assert.deepEqual(await fs.readFile(path.join(resourcePractice, 'small.bin')), smallBinary);
    assert.deepEqual(errors, []);
  });
  assert.deepEqual(errors, []);
  for (const item of context.subscriptions) item.dispose?.();
});
