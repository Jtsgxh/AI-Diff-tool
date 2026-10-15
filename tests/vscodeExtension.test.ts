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
import { gitService } from '../server/gitService';
import * as follow from '../server/followService';

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
  git('add', '.'); git('commit', '--quiet', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  await fs.writeFile(path.join(repo, 'sample.ts'), 'export const value = 2;\n');
  git('commit', '--quiet', '-am', 'target');
  const target = git('rev-parse', 'HEAD');
  const practice = path.join(root, 'practice');
  await follow.createFollow(repo, practice, base, target);
  const commands = new Map<string, (...args: any[]) => Promise<unknown>>();
  const calls: any[][] = [];
  const errors: string[] = [];
  let provider: any;
  let nativeProvider: any;
  let practiceSaved = 0;
  let unrelatedSaved = 0;
  /** 最小 URI 对象保留真实文件路径，避免用网页文件替代原生文件。 */
  const uri = (file: string) => ({ scheme: 'file', fsPath: file });
  const draft = { isDirty: true, uri: uri(path.join(practice, 'sample.ts')), fileName: 'sample.ts',
    /** 模拟 VS Code 保存实际练习文档。 */
    async save() { practiceSaved++; await fs.writeFile(this.uri.fsPath, 'export const value = 2;\n'); this.isDirty = false; return true; } };
  const disposable = { dispose() {} };
  const native = {
    EventEmitter: class { event = () => disposable; fire() {} dispose() {} },
    TreeItem: class { constructor(public label: string) {} }, ThemeIcon: class { constructor(public id: string) {} },
    Uri: { file: uri, from: (value: any) => value }, ViewColumn: { One: 1, Beside: 2 },
    WorkspaceEdit: class { createFile() {} },
    window: {
      createTreeView: (_id: string, options: any) => { provider = options.treeDataProvider; return { ...disposable }; },
      showErrorMessage: (message: string) => { errors.push(message); }, showInformationMessage() {},
      showTextDocument: async (...args: any[]) => { calls.push(['showTextDocument', ...args]); },
      showInputBox: async () => 'value', showQuickPick: async (items: any[]) => items[0],
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
      asRelativePath: (value: { fsPath: string }) => path.relative(practice, value.fsPath),
      onDidSaveTextDocument: () => disposable, onDidCreateFiles: () => disposable, onDidDeleteFiles: () => disposable,
      onDidRenameFiles: () => disposable, onDidChangeTextDocument: () => disposable,
    },
  };
  const require = createRequire(path.resolve('package.json'));
  const module = { exports: {} as any };
  const code = transformSync(fsSync.readFileSync('vscode/extension.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, URLSearchParams, setTimeout, clearTimeout,
    require: (id: string) => id === 'vscode' ? native : id === '../server/gitService' ? { gitService }
      : id === '../server/followService' ? follow : id === './workbench' ? { VSCodeWorkbench: class { dispose() {} updateReference() {} } } : require(id) });
  const context = { subscriptions: [] as any[] };
  await module.exports.activate(context);
  assert.equal(provider.getChildren().length, 1);
  await commands.get('aiDiff.follow.open')!(provider.getChildren()[0]);
  const diff = calls.find((call) => call[0] === 'vscode.diff');
  assert.equal(diff[1].scheme, 'ai-diff-reference');
  assert.equal(diff[2].fsPath, path.join(practice, 'sample.ts'));
  assert.equal(new URLSearchParams(diff[1].query).get('revision'), target);
  assert.equal(await nativeProvider.provideTextDocumentContent(diff[1]), 'export const value = 2;\n');
  await commands.get('aiDiff.follow.check')!();
  assert.equal(practiceSaved, 1);
  assert.equal(unrelatedSaved, 0);
  await commands.get('aiDiff.follow.next')!();
  assert.equal((await follow.loadFollow(practice))?.finished, true);
  await commands.get('aiDiff.symbols')!();
  assert.ok(calls.some((call) => call[0] === 'vscode.executeWorkspaceSymbolProvider'));
  assert.deepEqual(errors, []);
  for (const item of context.subscriptions) item.dispose?.();
});
