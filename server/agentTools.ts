import path from 'path';
import fs from 'fs';
import readline from 'readline';
import simpleGit, { SimpleGit } from 'simple-git';
import { formatRepoOverview, gitService } from './gitService';
import { buildLearnGraph, formatLearnGraphDigest } from './learnGraphBuild';
import {
  DEFAULT_AGENT_MAX_READ_FILE_LINES,
  DEFAULT_AGENT_MAX_SEARCH_RESULTS,
} from '../shared/types';

export interface AgentToolsOptions {
  /** Page size returned by `read_file`; subsequent pages remain available. */
  maxReadFileLines?: number;
  /** Default page size for `search_code` / `find_files`. */
  maxSearchResults?: number;
}

const DEFAULTS = {
  maxReadFileLines: DEFAULT_AGENT_MAX_READ_FILE_LINES,
  maxSearchResults: DEFAULT_AGENT_MAX_SEARCH_RESULTS,
  /** Files above this size are skipped by the non-git fallback scanner. */
  maxScanBytes: 32 * 1024 * 1024,
  /** Recursion ceiling for the non-git fallback scanner. */
  maxWalkDepth: 64,
  /** Characters of a matched line echoed back to the model. */
  matchPreviewChars: 500,
};

/** Never worth walking in the non-git fallback: build output and vendor trees. */
const IGNORED_DIRS = new Set([
  'node_modules',
  'bin',
  'obj',
  'dist',
  'build',
  '.git',
  'target',
  'vendor',
]);

/**
 * Read-only repository access exposed to the agent. Everything is rooted at
 * `repoRoot`; git's own index does the heavy lifting so `.gitignore` is
 * respected for free, with a filesystem walker as fallback outside a repo.
 */
export class AgentTools {
  private readonly repoRoot: string;
  private readonly git: SimpleGit;
  private readonly maxReadFileLines: number;
  private readonly maxSearchResults: number;

  constructor(repoRoot: string, options: AgentToolsOptions = {}) {
    this.repoRoot = path.resolve(repoRoot);
    this.git = simpleGit(this.repoRoot);
    this.maxReadFileLines = this.positiveInt(options.maxReadFileLines, DEFAULTS.maxReadFileLines);
    this.maxSearchResults = this.positiveInt(options.maxSearchResults, DEFAULTS.maxSearchResults);
  }

  /**
   * Confines a path to the repository. Comparing with a trailing separator
   * matters: a bare `startsWith` would also accept a sibling directory whose
   * name merely begins with the repo name.
   */
  private resolveSafePath(filePath: string): string {
    const fullPath = path.resolve(this.repoRoot, filePath);
    const rootWithSep = this.repoRoot.endsWith(path.sep)
      ? this.repoRoot
      : this.repoRoot + path.sep;

    if (fullPath !== this.repoRoot && !fullPath.startsWith(rootWithSep)) {
      throw new Error(`安全限制：禁止访问仓库外部路径: ${filePath}`);
    }
    return fullPath;
  }

  async executeTool(name: string, args: Record<string, any>): Promise<string> {
    try {
      switch (name) {
        case 'read_file':
          return await this.readFile(args.file_path, args.start_line, args.end_line);
        case 'search_code':
          return await this.searchCode(
            args.query,
            args.file_extension,
            args.offset,
            args.max_results
          );
        case 'find_files':
          return await this.findFiles(args.pattern, args.offset, args.max_results);
        case 'repo_overview':
          return await this.repoOverview();
        case 'repo_graph':
          return await this.repoGraph();
        default:
          return `未知工具: ${name}`;
      }
    } catch (err: any) {
      return `工具执行失败 (${name}): ${err.message}`;
    }
  }

  private async readFile(filePath: string, startLine?: number, endLine?: number): Promise<string> {
    const fullPath = this.resolveSafePath(filePath);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      return `文件不存在: ${filePath}`;
    }

    if (!stat.isFile()) {
      return `路径不是文件: ${filePath}`;
    }
    const sampleLength = Math.min(stat.size, 8192);
    if (sampleLength > 0) {
      const fd = fs.openSync(fullPath, 'r');
      try {
        const sample = Buffer.allocUnsafe(sampleLength);
        fs.readSync(fd, sample, 0, sampleLength, 0);
        if (sample.includes(0)) return `文件是二进制内容，不能按源码行读取: ${filePath}`;
      } finally {
        fs.closeSync(fd);
      }
    }

    const start = Math.max(1, Math.trunc(startLine || 1));
    const requestedEnd = endLine ? Math.max(start, Math.trunc(endLine)) : Number.MAX_SAFE_INTEGER;
    const pageEnd = Math.min(requestedEnd, start + this.maxReadFileLines - 1);
    const selected: string[] = [];
    let lineNumber = 0;
    let hasMore = false;

    const input = fs.createReadStream(fullPath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        lineNumber++;
        if (lineNumber < start) continue;
        if (lineNumber > pageEnd) {
          hasMore = true;
          break;
        }
        selected.push(`${lineNumber} | ${line}`);
      }
    } finally {
      lines.close();
      input.destroy();
    }

    if (selected.length === 0) {
      return `文件 ${filePath} 不存在第 ${start} 行（文件共 ${lineNumber} 行）`;
    }

    const actualEnd = start + selected.length - 1;
    const continuation = hasMore
      ? `；尚有后续，请继续调用 read_file(start_line=${actualEnd + 1})`
      : '；已到文件末尾';
    return `【文件: ${filePath} (第 ${start}-${actualEnd} 行${continuation})】\n\`\`\`\n${selected.join(
      '\n'
    )}\n\`\`\``;
  }

  private async repoOverview(): Promise<string> {
    const overview = await gitService.getRepoOverview(this.repoRoot);
    return formatRepoOverview(overview);
  }

  private async repoGraph(): Promise<string> {
    const graph = await buildLearnGraph(this.repoRoot);
    return formatLearnGraphDigest(graph);
  }

  private async searchCode(
    query: string,
    fileExtension?: string,
    offsetArg?: number,
    maxResultsArg?: number
  ): Promise<string> {
    if (!query || query.trim().length < 2) {
      return '搜索关键词过短';
    }

    const cleanQuery = query.trim();
    const offset = this.nonNegativeInt(offsetArg);
    const pageSize = this.positiveInt(maxResultsArg, this.maxSearchResults);

    // 1. `git grep` is the fast path: native speed, multi-threaded, .gitignore-aware.
    const regexHit = await this.gitGrep(cleanQuery, fileExtension, '-E');
    if (regexHit) {
      return this.formatGrepOutput(cleanQuery, regexHit, 'Git 工作区高速检索', offset, pageSize);
    }

    // 2. The query may not be valid regex — retry it as a literal.
    const literalHit = await this.gitGrep(cleanQuery, fileExtension, '-F');
    if (literalHit) {
      return this.formatGrepOutput(cleanQuery, literalHit, 'Git 工作区文本检索', offset, pageSize);
    }

    // 3. Outside a git repo (or nothing indexed): walk the filesystem.
    const results = this.walkForMatches(cleanQuery, fileExtension, offset + pageSize + 1);
    if (results.length === 0) {
      return `在代码库中未检索到符号/关键词: "${cleanQuery}"`;
    }

    const page = results.slice(offset, offset + pageSize);
    const hasMore = results.length > offset + page.length;
    const formatted = page.map((r) => `📄 ${r.file}:${r.line} -> ${r.text}`).join('\n');
    const continuation = hasMore ? `；下一页 offset=${offset + page.length}` : '';
    return `【代码库遍历检索 ("${cleanQuery}") - 本页 ${page.length} 处${continuation}】:\n${formatted}`;
  }

  /** Returns matching lines, or null when git found nothing / is unavailable. */
  private async gitGrep(
    query: string,
    fileExtension: string | undefined,
    mode: '-E' | '-F'
  ): Promise<string[] | null> {
    const args = [
      'grep',
      '--untracked',
      '--exclude-standard',
      '-n',
      '-I',
      '-i',
      mode,
      '-e',
      query,
    ];
    if (fileExtension) {
      args.push('--', fileExtension.startsWith('*') ? fileExtension : `*${fileExtension}`);
    }

    try {
      const rawOutput = await this.git.raw(args);
      const lines = rawOutput?.trim() ? rawOutput.trim().split('\n').filter(Boolean) : [];
      return lines.length > 0 ? lines : null;
    } catch {
      // Exit code 1 simply means "no matches"; anything else means git could
      // not run the query. Either way there is nothing to report from here.
      return null;
    }
  }

  private formatGrepOutput(
    query: string,
    lines: string[],
    label: string,
    offset: number,
    pageSize: number
  ): string {
    const limited = lines.slice(offset, offset + pageSize);
    const formatted = limited
      .map((line) => {
        // `path:line:text` — the text itself may contain colons.
        const firstColon = line.indexOf(':');
        const secondColon = line.indexOf(':', firstColon + 1);
        if (firstColon === -1 || secondColon === -1) {
          return `📄 ${line.slice(0, DEFAULTS.matchPreviewChars)}`;
        }
        const file = line.slice(0, firstColon);
        const lineNum = line.slice(firstColon + 1, secondColon);
        const text = line.slice(secondColon + 1).trim().slice(0, DEFAULTS.matchPreviewChars);
        return `📄 ${file}:${lineNum} -> ${text}`;
      })
      .join('\n');

    const continuation = offset + limited.length < lines.length
      ? `；下一页 offset=${offset + limited.length}`
      : '';
    return `【${label} ("${query}") - 共 ${lines.length} 处，本页 ${limited.length} 处${continuation}】:\n${formatted}`;
  }

  private async findFiles(pattern: string, offsetArg?: number, maxResultsArg?: number): Promise<string> {
    if (!pattern || pattern.trim().length < 2) {
      return '文件名搜索词过短';
    }

    const cleanPattern = pattern.trim();
    const offset = this.nonNegativeInt(offsetArg);
    const pageSize = this.positiveInt(maxResultsArg, this.maxSearchResults);

    // 1. `git ls-files` is an index lookup — effectively instant.
    try {
      const globPattern = cleanPattern.includes('*') ? cleanPattern : `*${cleanPattern}*`;
      const rawOutput = await this.git.raw([
        '-c',
        'core.quotepath=false',
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        globPattern,
      ]);
      if (rawOutput?.trim()) {
        const allFiles = rawOutput.trim().split('\n').filter(Boolean);
        const files = allFiles.slice(offset, offset + pageSize);
        const continuation = offset + files.length < allFiles.length
          ? `；下一页 offset=${offset + files.length}`
          : '';
        return `【Git 快速定位文件 (共 ${allFiles.length} 个，本页 ${files.length} 个${continuation})】:\n` + files.map((f) => `- ${f}`).join('\n');
      }
    } catch {
      // Fall through to the filesystem walker.
    }

    // 2. Fallback walker.
    const lowerPattern = cleanPattern.toLowerCase();
    const matchedFiles: string[] = [];

    this.walk(this.repoRoot, 0, (relPath, name) => {
      if (name.toLowerCase().includes(lowerPattern) || relPath.toLowerCase().includes(lowerPattern)) {
        matchedFiles.push(relPath);
      }
      return matchedFiles.length < offset + pageSize + 1;
    });

    if (matchedFiles.length === 0) {
      return `未定位到匹配 "${cleanPattern}" 的文件`;
    }
    const files = matchedFiles.slice(offset, offset + pageSize);
    const continuation = matchedFiles.length > offset + files.length
      ? `；下一页 offset=${offset + files.length}`
      : '';
    return `【匹配到的文件路径 (本页 ${files.length} 个${continuation})】:\n` + files.map((f) => `- ${f}`).join('\n');
  }

  private walkForMatches(
    query: string,
    fileExtension?: string,
    stopAfter = this.maxSearchResults + 1
  ): { file: string; line: number; text: string }[] {
    const results: { file: string; line: number; text: string }[] = [];
    const lowerQuery = query.toLowerCase();
    const extension = fileExtension?.replace('*', '');

    this.walk(this.repoRoot, 0, (relPath, name, fullPath) => {
      if (extension && !name.endsWith(extension)) return true;

      try {
        if (fs.statSync(fullPath).size > DEFAULTS.maxScanBytes) return true;

        const content = fs.readFileSync(fullPath, 'utf-8');
        if (content.includes('\0')) return true;

        const fileLines = content.split('\n');
        for (let i = 0; i < fileLines.length; i++) {
          if (fileLines[i].toLowerCase().includes(lowerQuery)) {
            results.push({
              file: relPath,
              line: i + 1,
              text: fileLines[i].trim().slice(0, 180),
            });
            if (results.length >= stopAfter) return false;
          }
        }
      } catch {
        // Unreadable file (permissions, race with a delete) — skip it.
      }
      return true;
    });

    return results;
  }

  /**
   * Depth-bounded directory walk. `visit` returns false to stop the traversal.
   */
  private walk(
    dir: string,
    depth: number,
    visit: (relPath: string, name: string, fullPath: string) => boolean
  ): boolean {
    if (depth > DEFAULTS.maxWalkDepth) return true;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
        if (!this.walk(fullPath, depth + 1, visit)) return false;
      } else if (entry.isFile()) {
        const relPath = path.relative(this.repoRoot, fullPath).replace(/\\/g, '/');
        if (!visit(relPath, entry.name, fullPath)) return false;
      }
    }

    return true;
  }

  private positiveInt(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.max(1, Math.trunc(value))
      : fallback;
  }

  private nonNegativeInt(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.trunc(value))
      : 0;
  }
}
