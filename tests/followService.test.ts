import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { advanceFollow, checkFollow, combineFollow, createFollow, loadFollow, planFollow, safePracticePath } from '../server/followService';

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

test('follow route follows ancestry, rejects invalid ranges and prefers the first eligible parent at merges', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await planFollow(f.repo, f.base, f.last, 'commits')).steps.map((step) => step.hash), [f.first, f.last]);
  await assert.rejects(planFollow(f.repo, f.base, f.base), /不能相同/);
  await assert.rejects(planFollow(f.repo, f.last, f.base, 'commits'), /祖先/);
  git(f.repo, 'checkout', '--quiet', '-b', 'side', f.base);
  await fs.writeFile(path.join(f.repo, 'side.txt'), 'side\n');
  git(f.repo, 'add', '.');
  git(f.repo, 'commit', '--quiet', '-m', 'side');
  const side = git(f.repo, 'rev-parse', 'HEAD');
  await assert.rejects(planFollow(f.repo, side, f.last, 'commits'), /祖先/);
  git(f.repo, 'merge', '--quiet', '--no-ff', f.last, '-m', 'merge');
  const merge = git(f.repo, 'rev-parse', 'HEAD');
  assert.deepEqual((await planFollow(f.repo, f.base, merge, 'commits')).steps.map((step) => step.hash), [side, merge]);
  assert.deepEqual((await planFollow(f.repo, f.first, merge, 'commits')).steps.map((step) => step.hash), [f.last, merge]);
});

/** 验证已合并分支上的基准可经过合并点继续主线，逐步校验完整目标快照并恢复进度。 */
test('merged branch exercises follow branch commits, merge snapshot and subsequent main commits', async (t) => {
  const f = await fixture(t);
  const main = git(f.repo, 'symbolic-ref', '--short', 'HEAD');
  git(f.repo, 'checkout', '--quiet', '-b', 'feature', f.base);
  await fs.writeFile(path.join(f.repo, 'feature.txt'), 'feature one\n');
  git(f.repo, 'add', '.');
  git(f.repo, 'commit', '--quiet', '-m', 'feature base');
  const base = git(f.repo, 'rev-parse', 'HEAD');
  await fs.writeFile(path.join(f.repo, 'feature.txt'), 'feature two\n');
  git(f.repo, 'commit', '--quiet', '-am', 'feature tip');
  const feature = git(f.repo, 'rev-parse', 'HEAD');
  git(f.repo, 'checkout', '--quiet', main);
  await fs.writeFile(path.join(f.repo, 'main-only.txt'), 'main one\n');
  git(f.repo, 'add', '.');
  git(f.repo, 'commit', '--quiet', '-m', 'independent main work');
  git(f.repo, 'merge', '--quiet', '--no-ff', 'feature', '-m', 'merge feature');
  const merge = git(f.repo, 'rev-parse', 'HEAD');
  await fs.writeFile(path.join(f.repo, 'main-only.txt'), 'main two\n');
  git(f.repo, 'commit', '--quiet', '-am', 'continue main');
  const target = git(f.repo, 'rev-parse', 'HEAD');
  let session = await createFollow(f.repo, f.practice, base, target, 'commits');
  assert.deepEqual(session.steps.map((step) => step.hash), [feature, merge, target]);
  assert.equal((await checkFollow(session)).complete, false);
  await fs.writeFile(path.join(f.practice, 'feature.txt'), 'feature two\n');
  session = await advanceFollow(session);
  assert.equal((await loadFollow(f.practice))?.stepIndex, 1);
  const mergeCheck = await checkFollow(session);
  assert.equal(mergeCheck.complete, false);
  assert.equal(mergeCheck.files.find((file) => file.path === 'main.txt')?.deleted, true);
  assert.ok(mergeCheck.files.some((file) => file.path === 'main-only.txt' && !file.complete));
  await assert.rejects(advanceFollow(session), /未进入下一步/);
  await fs.rename(path.join(f.practice, 'main.txt'), path.join(f.practice, 'renamed.txt'));
  await fs.writeFile(path.join(f.practice, 'renamed.txt'), 'after\n');
  await fs.writeFile(path.join(f.practice, 'resource.bin'), Buffer.from([0, 255, 12, 8]));
  await fs.writeFile(path.join(f.practice, 'main-only.txt'), 'main one\n');
  assert.equal((await checkFollow(session)).complete, true);
  session = await advanceFollow(session);
  assert.equal((await loadFollow(f.practice))?.stepIndex, 2);
  assert.equal((await checkFollow(session)).complete, false);
  await fs.writeFile(path.join(f.practice, 'main-only.txt'), 'main two\n');
  session = await advanceFollow(session);
  assert.equal(session.finished, true);
  assert.equal((await loadFollow(f.practice))?.finished, true);
  assert.equal(git(f.practice, 'rev-parse', 'HEAD'), base);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), target);
  assert.equal(git(f.repo, 'status', '--porcelain'), '');
});

/** 验证合并冲突的最终解决内容作为目标，而不是把任一父提交当作合并结果。 */
test('merge steps require conflict resolutions from the actual merge snapshot', async (t) => {
  const f = await fixture(t);
  git(f.repo, 'checkout', '--quiet', '-b', 'conflict-main', f.base);
  await fs.writeFile(path.join(f.repo, 'main.txt'), 'main change\n');
  git(f.repo, 'commit', '--quiet', '-am', 'main edit');
  git(f.repo, 'checkout', '--quiet', '-b', 'feature', f.base);
  await fs.writeFile(path.join(f.repo, 'main.txt'), 'feature one\n');
  git(f.repo, 'commit', '--quiet', '-am', 'feature base');
  const base = git(f.repo, 'rev-parse', 'HEAD');
  await fs.writeFile(path.join(f.repo, 'main.txt'), 'feature two\n');
  git(f.repo, 'commit', '--quiet', '-am', 'feature tip');
  const feature = git(f.repo, 'rev-parse', 'HEAD');
  git(f.repo, 'checkout', '--quiet', 'conflict-main');
  // Git 的冲突提示位于 stdout；同时验证失败状态和实际的三个未合并索引条目。
  assert.throws(() => git(f.repo, 'merge', '--no-ff', 'feature', '-m', 'merge feature'), { status: 1 });
  assert.equal(git(f.repo, 'ls-files', '--unmerged', '--', 'main.txt').split('\n').length, 3);
  await fs.writeFile(path.join(f.repo, 'main.txt'), 'resolved merge\n');
  git(f.repo, 'add', '.');
  git(f.repo, 'commit', '--quiet', '-m', 'resolve merge');
  const target = git(f.repo, 'rev-parse', 'HEAD');
  let session = await createFollow(f.repo, f.practice, base, target, 'commits');
  assert.deepEqual(session.steps.map((step) => step.hash), [feature, target]);
  await fs.writeFile(path.join(f.practice, 'main.txt'), 'feature two\n');
  session = await advanceFollow(session);
  assert.equal((await checkFollow(session)).complete, false);
  await assert.rejects(advanceFollow(session), /未进入下一步/);
  await fs.writeFile(path.join(f.practice, 'main.txt'), 'resolved merge\n');
  session = await advanceFollow(session);
  assert.equal(session.finished, true);
});

/** 逐提交路线仍要求祖先关系；合并范围直接比较两端，支持 squash 前的原始分支提交。 */
test('squash originals are rejected by legacy routes but accepted as combined range endpoints', async (t) => {
  const f = await fixture(t);
  const main = git(f.repo, 'symbolic-ref', '--short', 'HEAD');
  git(f.repo, 'checkout', '--quiet', '-b', 'feature', f.base);
  await fs.writeFile(path.join(f.repo, 'feature.txt'), 'feature\n');
  git(f.repo, 'add', '.');
  git(f.repo, 'commit', '--quiet', '-m', 'original feature');
  const feature = git(f.repo, 'rev-parse', 'HEAD');
  git(f.repo, 'checkout', '--quiet', main);
  git(f.repo, 'merge', '--quiet', '--squash', 'feature');
  git(f.repo, 'commit', '--quiet', '-m', 'squashed feature');
  assert.equal(await fs.readFile(path.join(f.repo, 'feature.txt'), 'utf8'), 'feature\n');
  await assert.rejects(planFollow(f.repo, feature, 'HEAD', 'commits'), /祖先/);
  assert.deepEqual((await planFollow(f.repo, feature, 'HEAD')).steps.map((step) => step.hash), [git(f.repo, 'rev-parse', 'HEAD')]);
});

/** 默认只跟写基准到结束的净变化，忽略中间新增后删除的文件，最终一次完成。 */
test('new exercises combine the entire range and only finish at the final snapshot', async (t) => {
  const f = await fixture(t);
  let session = await createFollow(f.repo, f.practice, f.base, f.last);
  assert.equal(session.mode, 'combined');
  assert.deepEqual(session.steps.map((step) => step.hash), [f.last]);
  assert.equal((await loadFollow(f.practice))?.mode, 'combined');
  assert.deepEqual((await checkFollow(session)).files.map((file) => file.path), ['main.txt', 'renamed.txt', 'resource.bin']);
  await fs.writeFile(path.join(f.practice, 'main.txt'), 'after\n');
  await fs.writeFile(path.join(f.practice, '中文 space.txt'), 'new\n');
  assert.equal((await checkFollow(session)).files.find((file) => file.path === '中文 space.txt')?.unexpected, true);
  await assert.rejects(advanceFollow(session), /未完成练习/);
  await fs.rename(path.join(f.practice, 'main.txt'), path.join(f.practice, 'renamed.txt'));
  await fs.unlink(path.join(f.practice, '中文 space.txt'));
  await fs.writeFile(path.join(f.practice, 'resource.bin'), Buffer.from([0, 255, 12, 8]));
  session = await advanceFollow(session);
  assert.equal(session.finished, true);
  assert.equal(session.stepIndex, 0);
  assert.equal((await loadFollow(f.practice))?.finished, true);
  assert.equal(git(f.practice, 'rev-parse', 'HEAD'), f.base);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.last);
});

/** 目标删除默认完成并保留旧文件；重命名的新路径仍须填写，额外文件不能借此跳过。 */
test('combined exercises mark target deletions complete without deleting practice files', async (t) => {
  const f = await fixture(t);
  const session = await createFollow(f.repo, f.practice, f.base, f.last);
  let result = await checkFollow(session);
  assert.equal(result.files.find(file => file.path === 'main.txt')?.complete, true);
  assert.equal(result.files.find(file => file.path === 'renamed.txt')?.complete, false);
  await fs.writeFile(path.join(f.practice, 'renamed.txt'), 'after\n');
  await fs.writeFile(path.join(f.practice, 'resource.bin'), Buffer.from([0, 255, 12, 8]));
  await fs.writeFile(path.join(f.practice, 'main.txt'), 'retained user draft\n');
  result = await checkFollow(session);
  assert.equal(result.complete, true);
  assert.equal(await fs.readFile(path.join(f.practice, 'main.txt'), 'utf8'), 'retained user draft\n');
  await fs.writeFile(path.join(f.practice, 'extra.txt'), 'extra\n');
  assert.equal((await checkFollow(session)).files.find(file => file.path === 'extra.txt')?.complete, false);
  await assert.rejects(advanceFollow(session), /未完成练习/);
  await fs.unlink(path.join(f.practice, 'extra.txt'));
  assert.equal((await advanceFollow(session)).finished, true);
});

/** 旧逐提交模式中保留早先删除的文件，后续步骤不再将它误判成额外文件。 */
test('sequential exercises keep earlier deletions complete across later steps and reloads', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.repo, 'untouched.txt'), 'next\n');
  git(f.repo, 'commit', '--quiet', '-am', 'third step');
  let session = await createFollow(f.repo, f.practice, f.base, 'HEAD', 'commits');
  await fs.writeFile(path.join(f.practice, 'main.txt'), 'after\n');
  await fs.writeFile(path.join(f.practice, '中文 space.txt'), 'new\n');
  session = await advanceFollow(session);
  assert.equal((await checkFollow(session)).files.find(file => file.path === '中文 space.txt')?.complete, true);
  await fs.writeFile(path.join(f.practice, 'renamed.txt'), 'after\n');
  await fs.writeFile(path.join(f.practice, 'resource.bin'), Buffer.from([0, 255, 12, 8]));
  await advanceFollow(session);
  session = (await loadFollow(f.practice))!;
  assert.equal(session.stepIndex, 2);
  await fs.writeFile(path.join(f.practice, 'untouched.txt'), 'next\n');
  assert.equal((await checkFollow(session)).complete, true);
  assert.equal((await advanceFollow(session)).finished, true);
  assert.equal(await fs.readFile(path.join(f.practice, '中文 space.txt'), 'utf8'), 'new\n');
});

/** 旧版缺省模式继续按原进度恢复，主动合并只改元数据并保留已写文件。 */
test('legacy progress can combine its remaining work without changing files or the original base', async (t) => {
  const f = await fixture(t);
  let session = await createFollow(f.repo, f.practice, f.base, f.last, 'commits');
  await fs.writeFile(path.join(f.practice, 'main.txt'), 'after\n');
  await fs.writeFile(path.join(f.practice, '中文 space.txt'), 'new\n');
  session = await advanceFollow(session);
  const marker = path.join(f.practice, '.git', 'ai-diff-follow.json');
  const legacy = JSON.parse(await fs.readFile(marker, 'utf8'));
  delete legacy.mode;
  await fs.writeFile(marker, JSON.stringify(legacy));
  session = (await loadFollow(f.practice))!;
  assert.equal(session.stepIndex, 1);
  assert.equal(session.mode, undefined);
  await fs.writeFile(path.join(f.practice, 'untouched.txt'), 'partial user edits\n');
  const before = git(f.practice, 'status', '--porcelain');
  session = await combineFollow(session);
  assert.equal(session.mode, 'combined');
  assert.equal(session.baseHash, f.base);
  assert.equal(session.stepIndex, 0);
  assert.equal(session.finished, false);
  assert.deepEqual(session.steps.map((step) => step.hash), [f.last]);
  assert.equal(git(f.practice, 'status', '--porcelain'), before);
  assert.equal(await fs.readFile(path.join(f.practice, 'untouched.txt'), 'utf8'), 'partial user edits\n');
  assert.equal(await fs.readFile(path.join(f.practice, '中文 space.txt'), 'utf8'), 'new\n');
  assert.equal((await loadFollow(f.practice))?.mode, 'combined');
  assert.equal(await combineFollow(session), session, 'combining again is idempotent');
  assert.equal((await checkFollow(session)).complete, false);
});

test('isolated exercise detects missing, mistaken and extra files, resumes and advances after content matches', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.repo, 'untouched.txt'), 'uncommitted user work\n');
  await fs.writeFile(path.join(f.repo, 'personal.txt'), 'untracked user work\n');
  const sourceStatus = git(f.repo, 'status', '--porcelain');
  let session = await createFollow(f.repo, f.practice, f.base, f.last, 'commits');
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

/** 完成判定忽略所有位置的空白，但仍拒绝非空白错误、缺失和额外文件，且不重写练习文本。 */
test('completion ignores spaces, tabs, newlines and Unicode whitespace without rewriting files', async (t) => {
  const f = await fixture(t);
  const target = 'class Demo {\n\tString label = "a b"; // 中文注释\n}\n';
  await fs.writeFile(path.join(f.repo, 'example.java'), target);
  git(f.repo, 'add', '.');
  git(f.repo, 'commit', '--quiet', '-m', 'text target');
  const session = await createFollow(f.repo, f.practice, f.first, 'HEAD');
  await fs.rename(path.join(f.practice, 'main.txt'), path.join(f.practice, 'renamed.txt'));
  await fs.unlink(path.join(f.practice, '中文 space.txt'));
  await fs.writeFile(path.join(f.practice, 'resource.bin'), Buffer.from([0, 255, 12, 8]));
  await fs.writeFile(path.join(f.practice, 'renamed.txt'), '\ta f\r\nte r\u00a0\u3000\n\n');
  await fs.writeFile(path.join(f.practice, 'untouched.txt'), ' k\te\ne p ');
  const compact = 'classDemo{Stringlabel="ab";//中文注释}';
  await fs.writeFile(path.join(f.practice, 'example.java'), compact);
  assert.equal((await checkFollow(session)).complete, true);
  assert.equal((await checkFollow(session)).files.find(file => file.path === 'untouched.txt'), undefined);
  await fs.writeFile(path.join(f.practice, 'example.java'), compact.replace('label', 'wrong'));
  assert.equal((await checkFollow(session)).files.find(file => file.path === 'example.java')?.complete, false);
  await assert.rejects(advanceFollow(session), /未完成练习/);
  await fs.writeFile(path.join(f.practice, 'example.java'), compact);
  await fs.writeFile(path.join(f.practice, 'extra.txt'), '\t\n');
  assert.equal((await checkFollow(session)).files.find(file => file.path === 'extra.txt')?.complete, false);
  await fs.unlink(path.join(f.practice, 'extra.txt'));
  await fs.unlink(path.join(f.practice, 'renamed.txt'));
  assert.equal((await checkFollow(session)).files.find(file => file.path === 'renamed.txt')?.complete, false);
  await fs.writeFile(path.join(f.practice, 'renamed.txt'), 'after');
  assert.equal((await advanceFollow(session)).finished, true);
  assert.equal(await fs.readFile(path.join(f.practice, 'example.java'), 'utf8'), compact);
  assert.equal(await fs.readFile(path.join(f.repo, 'example.java'), 'utf8'), target);
});

/** 复用预览的 GB18030 解码处理旧项目；二进制中的空白字节不能被忽略。 */
test('legacy encoded text ignores whitespace while binary resources still require exact bytes', async (t) => {
  const f = await fixture(t);
  const chinese = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]); // GBK 编码的“中文”。
  await fs.writeFile(path.join(f.repo, 'legacy.txt'), Buffer.concat([chinese, Buffer.from(' value\n')]));
  git(f.repo, 'add', '.');
  git(f.repo, 'commit', '--quiet', '-m', 'legacy text target');
  const session = await createFollow(f.repo, f.practice, f.last, 'HEAD');
  await fs.writeFile(path.join(f.practice, 'legacy.txt'), Buffer.concat([Buffer.from('\t'), chinese, Buffer.from('\r\nv a l u e\n\n')]));
  assert.equal((await checkFollow(session)).complete, true);
  await fs.writeFile(path.join(f.practice, 'resource.bin'), Buffer.from([0, 255, 32, 12, 8]));
  assert.equal((await checkFollow(session)).files.find(file => file.path === 'resource.bin')?.complete, false);
  await fs.writeFile(path.join(f.practice, 'resource.bin'), Buffer.from([0, 255, 12, 8]));
  await fs.writeFile(path.join(f.practice, 'legacy.txt'), Buffer.concat([chinese, Buffer.from(' wrong\n')]));
  assert.equal((await checkFollow(session)).files.find(file => file.path === 'legacy.txt')?.complete, false);
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
  await fs.writeFile(marker, JSON.stringify({ ...original, mode: 'unknown' }));
  await assert.rejects(loadFollow(f.practice), /进度文件无效/);
  await fs.writeFile(marker, JSON.stringify({ ...original, steps: [...original.steps, ...original.steps] }));
  await assert.rejects(loadFollow(f.practice), /进度文件无效/);
  await fs.writeFile(marker, JSON.stringify({ ...original, stepIndex: 50 }));
  await assert.rejects(loadFollow(f.practice), /进度文件无效/);
  await fs.writeFile(marker, JSON.stringify({ ...original, practiceRepo: f.repo }));
  await assert.rejects(loadFollow(f.practice), /进度文件无效/);
  assert.equal(await fs.readFile(path.join(f.practice, 'main.txt'), 'utf8'), 'before\n');
});
