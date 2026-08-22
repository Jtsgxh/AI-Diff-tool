import simpleGit, { SimpleGit } from 'simple-git';
import path from 'path';
import fs from 'fs';
import { LruCache } from './cache/lru';
import type {
  BatchInfo,
  CommitNode,
  DiffFile,
  DiffResult,
  RepoInfo,
} from '../shared/types';

export type { CommitNode, DiffFile, DiffResult, RepoInfo } from '../shared/types';

/** The empty-tree object, used as the base when diffing a root commit. */
const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Separators git writes into the stream, and the characters they produce. */
const FIELD_SEP = '\x00';
const RECORD_SEP = '\x01';
// `%x00` / `%x01` are git's own escapes: the format string itself must stay
// free of control characters, since Node rejects argv entries containing them.
const COMMIT_FORMAT = '%H%x00%h%x00%P%x00%an%x00%ae%x00%ad%x00%s%x00%D%x01';

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

function normalizeGitPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Diffs of a given commit (or of an immutable SHA range) never change, so they
 * are worth holding on to: re-selecting a commit in the graph then becomes a
 * map lookup instead of two `git` subprocesses plus a full re-parse.
 */
const diffCache = new LruCache<DiffResult>(64);
/** Per-repository `SimpleGit` instances; constructing one is not free. */
const gitInstances = new Map<string, SimpleGit>();

export class GitService {
  private getGit(repoPath: string): SimpleGit {
    const cached = gitInstances.get(repoPath);
    if (cached) return cached;

    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository path does not exist: ${repoPath}`);
    }
    const git = simpleGit(repoPath);
    gitInstances.set(repoPath, git);
    return git;
  }

  async getRepoInfo(repoPath: string): Promise<RepoInfo & { remotes: unknown }> {
    const git = this.getGit(repoPath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new Error(`Path is not a valid git repository: ${repoPath}`);
    }

    // Independent reads — issue them concurrently instead of serially.
    const [status, branchSummary, remoteSummary] = await Promise.all([
      git.status(),
      git.branchLocal(),
      git.getRemotes(true),
    ]);

    return {
      path: repoPath,
      name: path.basename(repoPath),
      currentBranch: status.current || '',
      tracking: status.tracking || undefined,
      ahead: status.ahead,
      behind: status.behind,
      isClean: status.isClean(),
      modifiedFilesCount: status.files.length,
      branches: branchSummary.all,
      remotes: remoteSummary,
    };
  }

  async getCommits(repoPath: string, limit: number = 100): Promise<CommitNode[]> {
    const git = this.getGit(repoPath);

    // Ref decorations already come back through `%D`, so no extra
    // `git branch -a` / `git tag` round-trips are needed here.
    const logResult = await git.raw([
      'log',
      `-${limit}`,
      '--all',
      '--date-order',
      `--pretty=format:${COMMIT_FORMAT}`,
    ]);

    return parseCommitRecords(logResult);
  }

  async getCommitDiff(repoPath: string, hash: string): Promise<DiffResult> {
    const cacheKey = `commit::${repoPath}::${hash}`;
    if (FULL_SHA_RE.test(hash)) {
      const hit = diffCache.get(cacheKey);
      if (hit) return hit;
    }

    const git = this.getGit(repoPath);

    // `--format=` suppresses the commit header and the previous `--stat` block:
    // both were parsed away, so producing them was pure I/O waste on big commits.
    const [showRaw, numstat] = await Promise.all([
      git.raw(['show', '--format=', '-p', hash]),
      git.raw(['show', '--numstat', '--format=', hash]),
    ]);

    const result = this.parseDiffOutput(`Commit ${hash.slice(0, 7)}`, showRaw, numstat);
    if (FULL_SHA_RE.test(hash)) {
      diffCache.set(cacheKey, result);
    }
    return result;
  }

  async getCompareDiff(repoPath: string, base: string, target: string): Promise<DiffResult> {
    // Only cacheable when both endpoints are immutable SHAs — branch names move.
    const isImmutable = FULL_SHA_RE.test(base) && FULL_SHA_RE.test(target);
    const cacheKey = `compare::${repoPath}::${base}...${target}`;
    if (isImmutable) {
      const hit = diffCache.get(cacheKey);
      if (hit) return hit;
    }

    const git = this.getGit(repoPath);
    const [diffRaw, numstat] = await Promise.all([
      git.raw(['diff', `${base}...${target}`]),
      git.raw(['diff', '--numstat', `${base}...${target}`]),
    ]);

    const result = this.parseDiffOutput(
      `Compare ${base.slice(0, 7)}...${target.slice(0, 7)}`,
      diffRaw,
      numstat
    );
    if (isImmutable) {
      diffCache.set(cacheKey, result);
    }
    return result;
  }

  async getBatchCommitsDiff(
    repoPath: string,
    hashes: string[]
  ): Promise<DiffResult & { batchInfo: BatchInfo }> {
    if (!hashes || hashes.length === 0) {
      return {
        title: '未选择提交',
        summary: { filesChanged: 0, insertions: 0, deletions: 0 },
        files: [],
        batchInfo: { count: 0, messages: [] },
      };
    }

    const cacheKey = `batch::${repoPath}::${[...hashes].sort().join(',')}`;
    const allImmutable = hashes.every((h) => FULL_SHA_RE.test(h));
    if (allImmutable) {
      const hit = diffCache.get(cacheKey) as (DiffResult & { batchInfo: BatchInfo }) | undefined;
      if (hit?.batchInfo) return hit;
    }

    const git = this.getGit(repoPath);

    // Order only the selected commits. The previous implementation walked the
    // whole history (`getCommits(repoPath, 1000)`) and filtered it down, which
    // cost a 1000-commit log + parse just to sort a handful of hashes.
    const selectedCommits = await this.describeCommits(git, hashes);

    if (selectedCommits.length === 0) {
      return {
        title: '未找到选中的提交',
        summary: { filesChanged: 0, insertions: 0, deletions: 0 },
        files: [],
        batchInfo: { count: 0, messages: [] },
      };
    }

    if (selectedCommits.length === 1) {
      const single = await this.getCommitDiff(repoPath, selectedCommits[0].hash);
      const result = {
        ...single,
        batchInfo: {
          count: 1,
          messages: [formatBatchMessage(selectedCommits[0], false)],
        },
      };
      if (allImmutable) diffCache.set(cacheKey, result);
      return result;
    }

    // DAG order: index 0 is newest, last index is oldest.
    const newestCommit = selectedCommits[0];
    const oldestCommit = selectedCommits[selectedCommits.length - 1];
    const oldestParent = oldestCommit.parents[0] || EMPTY_TREE_HASH;

    const range = `${oldestParent}..${newestCommit.hash}`;
    const [diffRaw, numstat] = await Promise.all([
      git.raw(['diff', range]),
      git.raw(['diff', '--numstat', range]),
    ]);

    const title = `批量合并改动 [${selectedCommits.length} 个提交: ${oldestCommit.shortHash} ➔ ${newestCommit.shortHash}]`;
    const parsed = this.parseDiffOutput(title, diffRaw, numstat);

    const result = {
      ...parsed,
      batchInfo: {
        count: selectedCommits.length,
        messages: selectedCommits.map((c) => formatBatchMessage(c, true)),
      },
    };
    if (allImmutable) diffCache.set(cacheKey, result);
    return result;
  }

  async getWorkingTreeDiff(repoPath: string): Promise<DiffResult> {
    const git = this.getGit(repoPath);

    // Empty repos have no HEAD; fall back to the empty tree so untracked files
    // still produce a diff.
    const hasHead = await git
      .raw(['rev-parse', '--verify', 'HEAD'])
      .then(() => true)
      .catch(() => false);
    const against = hasHead ? 'HEAD' : EMPTY_TREE_HASH;

    // Staged + unstaged tracked changes. Never cached: the working tree is live.
    // `core.quotepath=false` keeps CJK / space paths unescaped for the parser.
    let diffRaw = '';
    let numstat = '';
    try {
      [diffRaw, numstat] = await Promise.all([
        git.raw(['-c', 'core.quotepath=false', 'diff', against]),
        git.raw(['-c', 'core.quotepath=false', 'diff', '--numstat', against]),
      ]);
    } catch {
      // A missing HEAD or odd worktree still lets us append untracked files.
    }

    const parsed = this.parseDiffOutput('未提交变更 (Working Tree)', diffRaw || '', numstat || '');
    const seen = new Set(parsed.files.map((f) => normalizeGitPath(f.newPath)));

    let untrackedList = '';
    try {
      untrackedList = await git.raw([
        '-c',
        'core.quotepath=false',
        'ls-files',
        '--others',
        '--exclude-standard',
      ]);
    } catch {
      untrackedList = '';
    }

    for (const line of untrackedList.split('\n')) {
      const rel = normalizeGitPath(line.trim());
      if (!rel || seen.has(rel)) continue;
      const extra = this.diffUntrackedFile(repoPath, rel);
      if (!extra) continue;
      parsed.files.push(extra);
      parsed.summary.filesChanged += 1;
      parsed.summary.insertions += extra.additions;
      parsed.summary.deletions += extra.deletions;
      seen.add(rel);
    }

    return parsed;
  }

  /** Build a synthetic `diff --git` patch for a file git does not yet track. */
  private diffUntrackedFile(repoPath: string, relPath: string): DiffFile | null {
    const fullPath = path.join(repoPath, relPath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;

    const posix = normalizeGitPath(relPath);
    const header =
      `diff --git a/${posix} b/${posix}\n` +
      `new file mode 100644\n` +
      `--- /dev/null\n` +
      `+++ b/${posix}\n`;

    const tooLarge = stat.size > 5 * 1024 * 1024;
    let buf: Buffer | null = null;
    if (!tooLarge) {
      try {
        buf = fs.readFileSync(fullPath);
      } catch {
        return null;
      }
    }
    const binary = tooLarge || (buf !== null && buf.includes(0));
    if (binary) {
      return {
        oldPath: '/dev/null',
        newPath: posix,
        status: 'added',
        additions: 0,
        deletions: 0,
        diff: header + (tooLarge ? 'File too large to display\n' : 'Binary file (not shown)\n'),
      };
    }

    const text = buf!.toString('utf8');
    const lines = text.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const additions = lines.length;
    const hunk =
      additions === 0
        ? ''
        : `@@ -0,0 +1,${additions} @@\n` + lines.map((l) => `+${l}`).join('\n') + '\n';

    return {
      oldPath: '/dev/null',
      newPath: posix,
      status: 'added',
      additions,
      deletions: 0,
      diff: header + hunk,
    };
  }

  /**
   * Resolves metadata for exactly the given hashes, newest first, in a single
   * `git rev-list` call. `--no-walk=sorted` skips ancestor traversal entirely.
   */
  private async describeCommits(git: SimpleGit, hashes: string[]): Promise<CommitNode[]> {
    try {
      const raw = await git.raw([
        'rev-list',
        '--no-walk=sorted',
        `--format=${COMMIT_FORMAT}`,
        ...hashes,
      ]);
      return parseCommitRecords(raw);
    } catch {
      return [];
    }
  }

  private parseDiffOutput(title: string, rawDiff: string, numstatRaw: string): DiffResult {
    const files: DiffFile[] = [];
    const statsMap = new Map<string, { additions: number; deletions: number }>();

    let totalInsertions = 0;
    let totalDeletions = 0;

    for (const line of numstatRaw.split('\n')) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;

      const adds = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const dels = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      statsMap.set(parts[2].trim(), { additions: adds, deletions: dels });
      totalInsertions += adds;
      totalDeletions += dels;
    }

    const chunks = rawDiff.split(/^diff --git /m);
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;

      const firstLineEnd = chunk.indexOf('\n');
      const firstLine = firstLineEnd === -1 ? chunk : chunk.slice(0, firstLineEnd);
      const match = firstLine.match(/a\/(.*?)\s+b\/(.*)/);
      if (!match) continue;

      const oldPath = match[1];
      const newPath = match[2];

      // Only the metadata block (before the first hunk) can carry these
      // markers, so scan that slice rather than the whole file body.
      const firstHunkAt = chunk.indexOf('\n@@');
      const meta = firstHunkAt === -1 ? chunk : chunk.slice(0, firstHunkAt);

      let status: DiffFile['status'] = 'modified';
      if (meta.includes('new file mode')) {
        status = 'added';
      } else if (meta.includes('deleted file mode')) {
        status = 'deleted';
      } else if (meta.includes('similarity index') || oldPath !== newPath) {
        status = 'renamed';
      }

      const stat = statsMap.get(newPath) || statsMap.get(oldPath);
      let adds = stat?.additions ?? 0;
      let dels = stat?.deletions ?? 0;

      // Binary files and renames without content changes are absent from
      // numstat; fall back to counting the patch body itself.
      if (adds === 0 && dels === 0) {
        for (const l of chunk.split('\n')) {
          if (l.charCodeAt(0) === 43 /* + */ && !l.startsWith('+++')) adds++;
          else if (l.charCodeAt(0) === 45 /* - */ && !l.startsWith('---')) dels++;
        }
      }

      files.push({
        oldPath,
        newPath,
        status,
        additions: adds,
        deletions: dels,
        diff: 'diff --git ' + chunk,
      });
    }

    return {
      title,
      summary: {
        filesChanged: files.length,
        insertions: totalInsertions,
        deletions: totalDeletions,
      },
      files,
    };
  }
}

/**
 * Parses the `COMMIT_FORMAT` record stream produced by `git log` or
 * `git rev-list --format=`. The latter prefixes each record with a
 * `commit <sha>` line, which is stripped here.
 */
function parseCommitRecords(raw: string): CommitNode[] {
  if (!raw || !raw.trim()) return [];

  const commits: CommitNode[] = [];

  for (const rawEntry of raw.split(RECORD_SEP)) {
    const entry = rawEntry.replace(/^\s*commit [0-9a-f]{4,40}\n/, '').trim();
    if (!entry) continue;

    const parts = entry.split(FIELD_SEP);
    if (parts.length < 7) continue;

    const refStr = parts[7] ? parts[7].trim() : '';

    commits.push({
      hash: parts[0].trim(),
      shortHash: parts[1].trim(),
      parents: parts[2].trim() ? parts[2].trim().split(' ') : [],
      author: parts[3].trim(),
      authorEmail: parts[4].trim(),
      date: parts[5].trim(),
      message: parts[6].trim(),
      refs: refStr ? refStr.split(',').map((r) => r.trim()).filter(Boolean) : [],
    });
  }

  return commits;
}

function formatBatchMessage(commit: CommitNode, withDate: boolean): string {
  const suffix = withDate ? `${commit.author} · ${commit.date}` : commit.author;
  return `• [${commit.shortHash}] ${commit.message} (${suffix})`;
}

export const gitService = new GitService();
