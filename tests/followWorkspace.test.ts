import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ensureFollowWorkspace } from '../vscode/followWorkspace';

test('stable follow workspace preserves the Git snapshot and native completion settings outside practice', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-diff-workspace-test-'));
  t.after(async () => {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('ai-diff-workspace-test-')) throw new Error('Unsafe cleanup');
    await fs.rm(root, { recursive: true, force: true });
  });
  /** Git 只检查测试创建的仓库，确认稳定显示配置没有污染文件校验。 */
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '--quiet'); git('config', 'user.name', 'Follow Test'); git('config', 'user.email', 'follow@example.test');
  await fs.mkdir(path.join(root, '.vscode'));
  const original = '{ "editor.fontSize": 17 }\n';
  await fs.writeFile(path.join(root, '.vscode', 'settings.json'), original);
  git('add', '.'); git('commit', '--quiet', '-m', 'base');
  const file = await ensureFollowWorkspace(root, '1.138.0');
  assert.equal(path.dirname(file), path.join(root, '.git'));
  const workspace = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(path.resolve(path.dirname(file), workspace.folders[0].path), root);
  assert.deepEqual(workspace.settings, {
    'editor.inlineSuggest.enabled': true,
    'editor.inlineSuggest.mode': 'subwordSmart',
    'editor.inlineSuggest.keepOnBlur': true,
    'editor.inlineSuggest.suppressSuggestions': true,
    'editor.inlineSuggest.suppressInSnippetMode': false,
    'editor.inlineSuggest.experimental.showOnSuggestConflict': 'always',
  });
  assert.equal(git('status', '--short'), '');
  assert.equal(await fs.readFile(path.join(root, '.vscode', 'settings.json'), 'utf8'), original);
  const custom = '// 用户调整过的工作区保留原样\n' + await fs.readFile(file, 'utf8');
  await fs.writeFile(file, custom);
  assert.equal(await ensureFollowWorkspace(root, '1.138.0'), file);
  assert.equal(await fs.readFile(file, 'utf8'), custom);
});

test('older hosts omit new conflict settings and invalid metadata is rejected', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-diff-workspace-test-'));
  t.after(async () => {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('ai-diff-workspace-test-')) throw new Error('Unsafe cleanup');
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(root, '.git'), 'gitdir: elsewhere\n');
  await assert.rejects(ensureFollowWorkspace(root, '1.100.0'), /元数据目录无效/);
  await fs.unlink(path.join(root, '.git'));
  await fs.mkdir(path.join(root, '.git'));
  const file = await ensureFollowWorkspace(root, '1.100.0');
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).settings['editor.inlineSuggest.experimental.showOnSuggestConflict'], undefined);
  await fs.unlink(file);
  await fs.mkdir(file);
  await assert.rejects(ensureFollowWorkspace(root, '1.100.0'), /工作区文件无效/);
});
