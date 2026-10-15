import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { advanceFollow, checkFollow, createFollow, loadFollow, planFollow, safePracticePath } from '../server/followService';

/** 在隔离测试仓库执行 Git，避免修改开发仓库的索引或配置。 */
function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
}

/** 创建两步线性历史，覆盖新增、删除、改名、二进制及不应改动的文件。 */
async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-diff-follow-test-'));
  t.after(async () => {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('ai-diff-follow-test-')) throw new Error('Unsafe test cleanup');
    await fs.rm(root, { recursive: true, force: true });
  });
  const repo = path.join(root, 'source');
  await fs.mkdir(repo);
  git(repo, 'init', '--quiet');
  git(repo, 'config', 'user.name', 'Follow Test');
  git(repo, 'config', 'user.email', 'follow@example.test');
  git(repo, 'config', 'core.autocrlf', 'false');
  await fs.writeFile(path.join(repo, '.gitattributes'), '* text=auto eol=lf\n*.bin -text\n');
  await fs.writeFile(path.join(repo, '.gitignore'), 'generated/\n');
  await fs.writeFile(path.join(repo, 'main.txt'), 'before\n');
  await fs.writeFile(path.join(repo, 'untouched.txt'), 'keep\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  await fs.writeFile(path.join(repo, 'main.txt'), 'after\n');
  await fs.writeFile(path.join(repo, '中文 space.txt'), 'new\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'step one');
  const first = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'mv', 'main.txt', 'renamed.txt');
  git(repo, 'rm', '--quiet', '中文 space.txt');
  await fs.writeFile(path.join(repo, 'resource.bin'), Buffer.from([0, 255, 12, 8]));
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'step two');
  const last = git(repo, 'rev-parse', 'HEAD');
  return { root, repo, base, first, last, practice: path.join(root, 'practice') };
}

test('follow route uses real first-parent history and rejects equal, reversed and side-branch ranges', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await planFollow(f.repo, f.base, f.last)).steps.map((step) => step.hash), [f.first, f.last]);
  await assert.rejects(planFollow(f.repo, f.base, f.base), /晚于/);
  await assert.rejects(planFollow(f.repo, f.last, f.base), /第一父节点/);
  git(f.repo, 'checkout', '--quiet', '-b', 'side', f.base);
  await fs.writeFile(path.join(f.repo, 'side.txt'), 'side\n');
  git(f.repo, 'add', '.');
  git(f.repo, 'commit', '--quiet', '-m', 'side');
  const side = git(f.repo, 'rev-parse', 'HEAD');
  await assert.rejects(planFollow(f.repo, side, f.last), /第一父节点/);
  git(f.repo, 'merge', '--quiet', '--no-ff', f.last, '-m', 'merge');
  await assert.rejects(planFollow(f.repo, f.base, 'HEAD'), /合并提交/);
});

test('isolated exercise detects missing, mistaken and extra files, resumes and advances only after exact Git content matches', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.repo, 'untouched.txt'), 'uncommitted user work\n');
  await fs.writeFile(path.join(f.repo, 'personal.txt'), 'untracked user work\n');
  const sourceStatus = git(f.repo, 'status', '--porcelain');
  let session = await createFollow(f.repo, f.practice, f.base, f.last);
  assert.equal(git(f.practice, 'rev-parse', 'HEAD'), f.base);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.last);
  assert.equal((await checkFollow(session)).complete, false);
  await assert.rejects(advanceFollow(session), /未进入下一步/);
  assert.equal((await loadFollow(f.practice))?.stepIndex, 0);
  await fs.writeFile(path.join(f.practice, 'main.txt'), 'after\r\n');
  await fs.writeFile(path.join(f.practice, '中文 space.txt'), 'new\n');
  assert.equal((await checkFollow(session)).complete, true, 'project text attributes normalize CRLF');
  await fs.writeFile(path.join(f.practice, 'untouched.txt'), 'mistake\n');
  assert.equal((await checkFollow(session)).files.find((file) => file.path === 'untouched.txt')?.unexpected, true);
  await fs.writeFile(path.join(f.practice, 'untouched.txt'), 'keep\n');
  await fs.writeFile(path.join(f.practice, 'extra.txt'), 'extra\n');
  assert.equal((await checkFollow(session)).complete, false);
  await fs.unlink(path.join(f.practice, 'extra.txt'));
  await fs.mkdir(path.join(f.practice, 'generated'));
  await fs.writeFile(path.join(f.practice, 'generated', 'output.txt'), 'ignored\n');
  session = await advanceFollow(session);
  assert.equal(session.stepIndex, 1);
  assert.equal((await loadFollow(f.practice))?.stepIndex, 1);
  await fs.rename(path.join(f.practice, 'main.txt'), path.join(f.practice, 'renamed.txt'));
  await fs.unlink(path.join(f.practice, '中文 space.txt'));
  await fs.writeFile(path.join(f.practice, 'resource.bin'), Buffer.from([0, 255, 12, 7]));
  assert.equal((await checkFollow(session)).complete, false);
  await fs.writeFile(path.join(f.practice, 'resource.bin'), Buffer.from([0, 255, 12, 8]));
  assert.equal((await checkFollow(session)).complete, true);
  session = await advanceFollow(session);
  assert.equal(session.finished, true);
  assert.equal((await loadFollow(f.practice))?.finished, true);
  assert.equal(git(f.practice, 'rev-parse', 'HEAD'), f.base, 'progress does not create exercise commits');
  assert.equal(git(f.repo, 'status', '--porcelain'), sourceStatus);
  assert.equal(await fs.readFile(path.join(f.repo, 'personal.txt'), 'utf8'), 'untracked user work\n');
});

test('file-to-directory transitions compare file existence without rejecting the replacement directory', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.repo, 'parent'), 'old file\n');
  git(f.repo, 'add', '.');
  git(f.repo, 'commit', '--quiet', '-m', 'parent file');
  const base = git(f.repo, 'rev-parse', 'HEAD');
  await fs.unlink(path.join(f.repo, 'parent'));
  await fs.mkdir(path.join(f.repo, 'parent'));
  await fs.writeFile(path.join(f.repo, 'parent', 'child.txt'), 'replacement\n');
  git(f.repo, 'add', '-A');
  git(f.repo, 'commit', '--quiet', '-m', 'parent directory');
  const session = await createFollow(f.repo, f.practice, base, 'HEAD');
  await fs.unlink(path.join(f.practice, 'parent'));
  await fs.mkdir(path.join(f.practice, 'parent'));
  await fs.writeFile(path.join(f.practice, 'parent', 'child.txt'), 'replacement\n');
  assert.equal((await checkFollow(session)).complete, true);
});

test('creation preserves existing and nested directories and path checks reject escapes and junctions', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.practice);
  await fs.writeFile(path.join(f.practice, 'keep.txt'), 'user data');
  await assert.rejects(createFollow(f.repo, f.practice, f.base, f.last), /EEXIST/);
  assert.equal(await fs.readFile(path.join(f.practice, 'keep.txt'), 'utf8'), 'user data');
  await assert.rejects(createFollow(f.repo, path.join(f.repo, 'nested'), f.base, f.last), /分开/);
  for (const invalid of ['../source/main.txt', '.git/config', '.GIT/config', '/absolute', 'C:\\outside', 'a/../../escape']) {
    await assert.rejects(safePracticePath(f.practice, invalid));
  }
  const link = path.join(f.practice, 'linked');
  try { await fs.symlink(f.repo, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.diagnostic('OS denied symlink creation; remaining path cases passed'); return; }
    throw error;
  }
  await assert.rejects(safePracticePath(f.practice, 'linked/main.txt'), /符号链接/);
});

test('missing or malformed progress is explicit and does not alter exercise contents', async (t) => {
  const f = await fixture(t);
  assert.equal(await loadFollow(f.repo), undefined);
  await createFollow(f.repo, f.practice, f.base, f.last);
  const marker = path.join(f.practice, '.git', 'ai-diff-follow.json');
  const original = JSON.parse(await fs.readFile(marker, 'utf8'));
  await fs.writeFile(marker, JSON.stringify({ ...original, stepIndex: 50 }));
  await assert.rejects(loadFollow(f.practice), /进度文件无效/);
  await fs.writeFile(marker, JSON.stringify({ ...original, practiceRepo: f.repo }));
  await assert.rejects(loadFollow(f.practice), /进度文件无效/);
  assert.equal(await fs.readFile(path.join(f.practice, 'main.txt'), 'utf8'), 'before\n');
});
