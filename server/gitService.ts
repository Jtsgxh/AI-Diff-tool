import simpleGit, { SimpleGit, DefaultLogFields } from 'simple-git';
import path from 'path';
import fs from 'fs';

export interface CommitNode {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  date: string;
  message: string;
  refs: string[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  diff: string;
}

export interface DiffResult {
  title: string;
  summary: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  files: DiffFile[];
}

export class GitService {
  private getGit(repoPath: string): SimpleGit {
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository path does not exist: ${repoPath}`);
    }
    return simpleGit(repoPath);
  }

  async getRepoInfo(repoPath: string) {
    const git = this.getGit(repoPath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new Error(`Path is not a valid git repository: ${repoPath}`);
    }

    const status = await git.status();
    const branchSummary = await git.branchLocal();
    const remoteSummary = await git.getRemotes(true);

    return {
      path: repoPath,
      name: path.basename(repoPath),
      currentBranch: status.current,
      tracking: status.tracking,
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

    // Get branches and tags for ref decorations
    const branchSummary = await git.branch(['-a']);
    const tagSummary = await git.tags();

    // Raw log format with parent hashes
    const logResult = await git.raw([
      'log',
      `-${limit}`,
      '--all',
      '--date-order',
      '--pretty=format:%H%x00%h%x00%P%x00%an%x00%ae%x00%ad%x00%s%x00%D%x01',
    ]);

    if (!logResult.trim()) {
      return [];
    }

    const commits: CommitNode[] = [];
    const entries = logResult.split('\x01').filter(e => e.trim().length > 0);

    for (const entry of entries) {
      const parts = entry.split('\x00');
      if (parts.length >= 7) {
        const hash = parts[0].trim();
        const shortHash = parts[1].trim();
        const parents = parts[2].trim() ? parts[2].trim().split(' ') : [];
        const author = parts[3].trim();
        const authorEmail = parts[4].trim();
        const date = parts[5].trim();
        const message = parts[6].trim();
        const refStr = parts[7] ? parts[7].trim() : '';

        const refs: string[] = refStr
          ? refStr.split(',').map(r => r.trim()).filter(Boolean)
          : [];

        commits.push({
          hash,
          shortHash,
          parents,
          author,
          authorEmail,
          date,
          message,
          refs,
        });
      }
    }

    return commits;
  }

  async getCommitDiff(repoPath: string, hash: string): Promise<DiffResult> {
    const git = this.getGit(repoPath);

    const showRaw = await git.raw(['show', '--pretty=format:%H%n%s%n%b', '--stat', '-p', hash]);
    const numstat = await git.raw(['show', '--numstat', '--format=', hash]);

    return this.parseDiffOutput(`Commit ${hash.slice(0, 7)}`, showRaw, numstat);
  }

  async getCompareDiff(repoPath: string, base: string, target: string): Promise<DiffResult> {
    const git = this.getGit(repoPath);

    const diffRaw = await git.raw(['diff', `${base}...${target}`]);
    const numstat = await git.raw(['diff', '--numstat', `${base}...${target}`]);

    return this.parseDiffOutput(`Compare ${base.slice(0, 7)}...${target.slice(0, 7)}`, diffRaw, numstat);
  }

  async getWorkingTreeDiff(repoPath: string): Promise<DiffResult> {
    const git = this.getGit(repoPath);

    // Staged & unstaged changes
    const diffRaw = await git.raw(['diff', 'HEAD']);
    const numstat = await git.raw(['diff', '--numstat', 'HEAD']);

    return this.parseDiffOutput('Uncommitted Changes (Working Tree)', diffRaw, numstat);
  }

  private parseDiffOutput(title: string, rawDiff: string, numstatRaw: string): DiffResult {
    const files: DiffFile[] = [];
    const statsMap = new Map<string, { additions: number; deletions: number }>();

    let totalInsertions = 0;
    let totalDeletions = 0;

    // Parse numstat
    const numstatLines = numstatRaw.split('\n');
    for (const line of numstatLines) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const adds = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
        const dels = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
        const filePath = parts[2].trim();
        statsMap.set(filePath, { additions: adds, deletions: dels });
        totalInsertions += adds;
        totalDeletions += dels;
      }
    }

    // Split diff chunks by 'diff --git'
    const chunks = rawDiff.split(/^diff --git /m);
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;

      const firstLine = chunk.split('\n')[0];
      const match = firstLine.match(/a\/(.*?)\s+b\/(.*)/);
      if (!match) continue;

      const oldPath = match[1];
      const newPath = match[2];

      let status: DiffFile['status'] = 'modified';
      if (chunk.includes('new file mode')) {
        status = 'added';
      } else if (chunk.includes('deleted file mode')) {
        status = 'deleted';
      } else if (chunk.includes('similarity index') || oldPath !== newPath) {
        status = 'renamed';
      }

      const stat = statsMap.get(newPath) || statsMap.get(oldPath) || { additions: 0, deletions: 0 };

      // Calculate additions/deletions from diff if not found in numstat
      let adds = stat.additions;
      let dels = stat.deletions;
      if (adds === 0 && dels === 0) {
        const lines = chunk.split('\n');
        for (const l of lines) {
          if (l.startsWith('+') && !l.startsWith('+++')) adds++;
          if (l.startsWith('-') && !l.startsWith('---')) dels++;
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

export const gitService = new GitService();
