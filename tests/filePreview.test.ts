import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { GitService } from '../server/gitService';

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function commit(repo: string, message: string, date: string, ...args: string[]): void {
  execFileSync('git', ['commit', '--quiet', '-m', message, ...args], {
    cwd: repo,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

function makeRepository(t: TestContext): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'git-semantic-file-preview-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, 'init', '--quiet');
  git(repo, 'config', 'user.name', 'Preview Test');
  git(repo, 'config', 'user.email', 'preview@example.test');
  return repo;
}

test('full-file preview follows commit, deletion, and working-tree snapshots', async (t) => {
  const repo = makeRepository(t);
  const service = new GitService();
  const file = path.join(repo, 'sample.txt');

  fs.writeFileSync(file, 'before\n');
  git(repo, 'add', 'sample.txt');
  commit(repo, 'add sample', '2026-01-01T00:00:00Z');

  fs.writeFileSync(file, 'after\n');
  commit(repo, 'update sample', '2026-01-01T00:00:01Z', '-a');
  const updateHash = git(repo, 'rev-parse', 'HEAD');
  const updateDiff = await service.getCommitDiff(repo, updateHash);
  assert.deepEqual(updateDiff.files[0].previewSource, {
    type: 'revision',
    path: 'sample.txt',
    revision: updateHash,
  });
  const updatePreview = await service.getFilePreview(repo, 'sample.txt', updateHash);
  assert.equal(updatePreview.content, 'after\n');
  assert.equal(updatePreview.lineCount, 1);

  fs.writeFileSync(file, 'after batch\n');
  commit(repo, 'update sample again', '2026-01-01T00:00:02Z', '-a');
  const secondUpdateHash = git(repo, 'rev-parse', 'HEAD');
  const batchDiff = await service.getBatchCommitsDiff(repo, [updateHash, secondUpdateHash]);
  assert.deepEqual(batchDiff.files[0].previewSource, {
    type: 'revision',
    path: 'sample.txt',
    revision: secondUpdateHash,
  });

  git(repo, 'rm', '--quiet', 'sample.txt');
  commit(repo, 'delete sample', '2026-01-01T00:00:03Z');
  const deleteHash = git(repo, 'rev-parse', 'HEAD');
  const deleteDiff = await service.getCommitDiff(repo, deleteHash);
  assert.deepEqual(deleteDiff.files[0].previewSource, {
    type: 'revision',
    path: 'sample.txt',
    revision: `${deleteHash}^`,
  });
  assert.equal(
    (await service.getFilePreview(repo, 'sample.txt', `${deleteHash}^`)).content,
    'after batch\n'
  );

  const compareDiff = await service.getCompareDiff(repo, secondUpdateHash, deleteHash);
  assert.deepEqual(compareDiff.files[0].previewSource, {
    type: 'revision',
    path: 'sample.txt',
    revision: secondUpdateHash,
  });
  assert.equal(
    (await service.getFilePreview(repo, compareDiff.files[0].previewSource!.path, secondUpdateHash))
      .content,
    'after batch\n'
  );

  fs.writeFileSync(file, 'worktree\n');
  const workingDiff = await service.getWorkingTreeDiff(repo);
  assert.deepEqual(workingDiff.files[0].previewSource, {
    type: 'working-tree',
    path: 'sample.txt',
  });
  assert.equal((await service.getFilePreview(repo, 'sample.txt')).content, 'worktree\n');
});

test('full-file preview rejects repository traversal', async (t) => {
  const repo = makeRepository(t);
  const service = new GitService();
  await assert.rejects(service.getFilePreview(repo, '../outside.txt'), /repository-relative/);
});

test('working-tree preview resolves from the git root and decodes legacy Chinese text', async (t) => {
  const repo = makeRepository(t);
  const service = new GitService();
  const nested = path.join(repo, 'nested');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(repo, 'legacy.txt'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0x0a]));

  const preview = await service.getFilePreview(nested, 'legacy.txt');
  assert.equal(preview.content, '你好\n');
  assert.equal(preview.encoding, 'gb18030');
});
