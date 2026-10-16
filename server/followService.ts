import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import simpleGit from 'simple-git';
import { decodePreviewBuffer } from './gitService';

export interface FollowStep { hash: string; message: string }
export type FollowMode = 'combined' | 'commits';
export interface FollowSession {
  version: 1;
  mode?: FollowMode;
  referenceRepo: string;
  practiceRepo: string;
  baseHash: string;
  steps: FollowStep[];
  stepIndex: number;
  finished: boolean;
}
export interface FollowFile {
  path: string;
  deleted: boolean;
  complete: boolean;
  unexpected: boolean;
}
export interface FollowCheck { complete: boolean; files: FollowFile[] }
interface TreeEntry { mode: string; hash: string }
const SESSION_FILE = 'ai-diff-follow.json';
const SHA = /^[0-9a-f]{40,64}$/;

/** 判断路径是否位于指定目录内，包含目录自身。 */
export function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** 只允许仓库内普通文件路径，逐层拒绝符号链接和 Git 内部目录。 */
export async function safePracticePath(root: string, relative: string): Promise<string> {
  const parts = relative.replace(/\\/g, '/').split('/');
  if (!relative || parts.some((part) => !part || part === '.' || part === '..' || part.includes(':') || /^\.git[ .]*$/i.test(part)) || path.isAbsolute(relative)) {
    throw new Error('文件路径必须位于练习目录内，且不能访问 .git。');
  }
  let current = await fs.realpath(root);
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error(`暂不支持符号链接：${relative}`);
  }
  return current;
}

/** 获取不可变提交 SHA，避免把用户输入作为 Git 命令选项。 */
async function resolveCommit(repo: string, revision: string): Promise<string> {
  if (!revision || revision.startsWith('-') || revision.includes('\0')) throw new Error('无效的提交或分支。');
  const sha = (await simpleGit(repo).raw(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`])).trim();
  if (!SHA.test(sha)) throw new Error('无法解析提交。');
  return sha;
}

/** 读取目标快照的文件表；第一版明确拒绝子模块、符号链接和特殊文件。 */
async function readTree(repo: string, revision: string): Promise<Map<string, TreeEntry>> {
  const raw = await simpleGit(repo).raw(['ls-tree', '-r', '-z', revision]);
  const tree = new Map<string, TreeEntry>();
  for (const record of raw.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [mode, , hash] = record.slice(0, tab).split(' ');
    const filePath = record.slice(tab + 1);
    if (mode !== '100644' && mode !== '100755') throw new Error(`第一版暂不支持符号链接或子模块：${filePath}`);
    tree.set(filePath, { mode, hash });
  }
  return tree;
}

/** 默认将两端快照合为一个目标；旧逐提交模式仍按真实祖先关系规划路线。 */
export async function planFollow(repo: string, base: string, target: string,
  mode: FollowMode = 'combined'): Promise<{ baseHash: string; steps: FollowStep[] }> {
  const baseHash = await resolveCommit(repo, base);
  const targetHash = await resolveCommit(repo, target);
  const git = simpleGit(repo);
  if (baseHash === targetHash) throw new Error('基准与结束提交不能相同。');
  if (mode === 'combined') {
    await readTree(repo, baseHash);
    await readTree(repo, targetHash);
    const message = (await git.raw(['show', '-s', '--format=%s', targetHash])).trim();
    return { baseHash, steps: [{ hash: targetHash, message }] };
  }
  const raw = await git.raw(['log', '--ancestry-path', '--topo-order', '--format=%H%x00%P%x00%s', `${baseHash}..${targetHash}`]);
  const commits = new Map(raw.trimEnd().split('\n').filter(Boolean).map((record) => {
    const [hash, parents, message] = record.split('\0');
    return [hash, { parents: parents.split(' '), message }] as const;
  }));
  if (!commits.has(targetHash)) {
    throw new Error('基准提交必须是结束提交的祖先。请检查提交顺序；若曾 squash 或 rebase 合并，原提交可能不在结束提交的历史中。');
  }
  const steps: FollowStep[] = [];
  let current = targetHash;
  while (current !== baseHash) {
    const commit = commits.get(current);
    if (!commit) throw new Error('无法确定连续的跟写路线。');
    steps.push({ hash: current, message: commit.message });
    // 候选表仅含基准的后代；选择能回到基准的父节点，保留正常主线并允许从合入分支进入合并点。
    const parent = commit.parents.find((hash) => hash === baseHash || commits.has(hash));
    if (!parent) throw new Error('无法确定连续的跟写路线。');
    current = parent;
  }
  steps.reverse();
  for (const revision of [baseHash, ...steps.map((step) => step.hash)]) await readTree(repo, revision);
  return { baseHash, steps };
}

/** 将进度原子写入练习仓库内部，不污染练习文件或创建 Git 提交。 */
export async function saveFollow(session: FollowSession): Promise<void> {
  const destination = path.join(session.practiceRepo, '.git', SESSION_FILE);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, { flag: 'wx' });
  await fs.rename(temporary, destination);
}

/** 从打开的练习目录恢复固定路线，校验磁盘记录而不执行其中任意命令。 */
export async function loadFollow(repo: string): Promise<FollowSession | undefined> {
  const gitDirectory = await fs.lstat(path.join(repo, '.git')).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!gitDirectory?.isDirectory() || gitDirectory.isSymbolicLink()) return undefined;
  const file = path.join(repo, '.git', SESSION_FILE);
  const raw = await fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
    throw error;
  });
  if (raw === undefined) return undefined;
  const value = JSON.parse(raw) as FollowSession;
  if (!value || typeof value !== 'object' || value.version !== 1 || typeof value.referenceRepo !== 'string' || typeof value.practiceRepo !== 'string' ||
      (value.mode !== undefined && value.mode !== 'combined' && value.mode !== 'commits') ||
      !isWithin(repo, value.practiceRepo) || !isWithin(value.practiceRepo, repo) || !SHA.test(value.baseHash) ||
      !Array.isArray(value.steps) || !value.steps.length || value.steps.some((step) => !step || !SHA.test(step.hash) || typeof step.message !== 'string') ||
      !Number.isInteger(value.stepIndex) || value.stepIndex < 0 || value.stepIndex >= value.steps.length || typeof value.finished !== 'boolean' ||
      (value.mode === 'combined' && (value.steps.length !== 1 || value.stepIndex !== 0)) ||
      (value.finished && value.stepIndex !== value.steps.length - 1)) {
    throw new Error('练习进度文件无效，未修改练习内容。');
  }
  return value;
}

/** 创建完全独立的本地克隆；只接受尚不存在的目录，绝不清空已有内容。 */
export async function createFollow(referenceRepo: string, practiceRepo: string, base: string, target: string,
  mode: FollowMode = 'combined'): Promise<FollowSession> {
  const source = await fs.realpath(referenceRepo);
  const parent = await fs.realpath(path.dirname(practiceRepo));
  const destination = path.join(parent, path.basename(practiceRepo));
  if (isWithin(source, destination) || isWithin(destination, source)) throw new Error('练习目录必须与参考仓库分开。');
  const plan = await planFollow(source, base, target, mode);
  await fs.mkdir(destination); // 不使用 recursive；即使目录为空，也不能覆盖用户已有目录。
  try {
    await simpleGit().clone(source, destination, ['--no-hardlinks', '--no-checkout', '--no-recurse-submodules']);
    const git = simpleGit(destination);
    await git.raw(['update-ref', 'refs/ai-diff-follow/target', plan.steps.at(-1)!.hash]);
    await git.raw(['checkout', '--detach', plan.baseHash]);
    const session: FollowSession = { version: 1, mode, referenceRepo: source, practiceRepo: destination,
      ...plan, stepIndex: 0, finished: false };
    await saveFollow(session);
    return session;
  } catch (error) {
    throw new Error(`创建练习失败，已保留目录供检查：${destination}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 将已有练习收拢为最终目标，只保存练习元数据，保留已写文件和原始基准。 */
export async function combineFollow(session: FollowSession): Promise<FollowSession> {
  if (session.mode === 'combined') return session;
  const combined: FollowSession = { ...session, mode: 'combined', steps: [session.steps.at(-1)!], stepIndex: 0 };
  await saveFollow(combined);
  return combined;
}

/** 批量计算 Git 规范化后的文件哈希，遵循项目的换行和属性规则。 */
async function hashFiles(repo: string, files: string[]): Promise<string[]> {
  if (!files.length) return [];
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['hash-object', '--stdin-paths'], { cwd: repo, windowsHide: true });
    let output = '';
    let error = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { error += chunk; });
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.on('close', (code) => {
      const hashes = output.trim().split('\n');
      if (code !== 0 || hashes.length !== files.length || hashes.some((hash) => !SHA.test(hash))) reject(new Error(error || '无法校验练习文件。'));
      else resolve(hashes);
    });
    child.stdin.end(`${files.map((file) => JSON.stringify(file)).join('\n')}\n`);
  });
}

/** 仅完成判定忽略文本中的全部空白，保留二进制精确校验及原有虚影格式。 */
async function matchesFollowText(repo: string, file: string, targetHash: string): Promise<boolean> {
  const actual = decodePreviewBuffer(await fs.readFile(await safePracticePath(repo, file))).content;
  if (actual === null) return false;
  const expected = decodePreviewBuffer(await simpleGit(repo).binaryCatFile(['-p', targetHash])).content;
  return expected !== null && actual.replace(/\s+/gu, '') === expected.replace(/\s+/gu, '');
}

/** 对照整个目标快照检查，文本忽略空白，仍发现本步遗漏、非空白误改和额外文件。 */
export async function checkFollow(session: FollowSession): Promise<FollowCheck> {
  const target = session.steps[session.stepIndex].hash;
  const previous = session.stepIndex ? session.steps[session.stepIndex - 1].hash : session.baseHash;
  const repo = session.practiceRepo;
  const git = simpleGit(repo);
  const expected = await readTree(repo, target);
  const changed = new Set((await git.raw(['diff', '--name-only', '-z', '--no-renames', previous, target])).split('\0').filter(Boolean));
  const tracked = (await git.raw(['ls-files', '-z'])).split('\0').filter(Boolean);
  const untracked = (await git.raw(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  const files = new Set([...expected.keys(), ...tracked, ...untracked, ...changed]);
  const present: string[] = [];
  const failures = new Set<string>();
  for (const file of files) {
    const fullPath = await safePracticePath(repo, file);
    const stat = await fs.lstat(fullPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
      throw error;
    });
    if (expected.has(file)) {
      if (stat?.isFile()) present.push(file);
      else failures.add(file);
    } else if (stat && !stat.isDirectory()) failures.add(file);
  }
  const hashes = await hashFiles(repo, present);
  // 哈希一致时直接通过；只为不一致的文件读取文本，不为整仓库重复加载历史正文。
  for (const [index, file] of present.entries()) {
    const targetHash = expected.get(file)!.hash;
    if (hashes[index] !== targetHash && !(await matchesFollowText(repo, file, targetHash))) failures.add(file);
  }
  const visible = new Set([...changed, ...failures]);
  return { complete: failures.size === 0, files: [...visible].sort().map((file) => ({ path: file,
    deleted: !expected.has(file), complete: !failures.has(file), unexpected: !changed.has(file) })) };
}

/** 全量校验通过后推进并保存进度；最后一步保留完成状态。 */
export async function advanceFollow(session: FollowSession): Promise<FollowSession> {
  if (session.finished) return session;
  const result = await checkFollow(session);
  if (!result.complete) throw new Error(`还有 ${result.files.filter((file) => !file.complete).length} 个文件未一致，${session.mode === 'combined' ? '未完成练习' : '未进入下一步'}。`);
  const next = { ...session, stepIndex: Math.min(session.stepIndex + 1, session.steps.length - 1),
    finished: session.stepIndex === session.steps.length - 1 };
  await saveFollow(next);
  return next;
}
