import path from 'path';
import fs from 'fs';
import simpleGit, { SimpleGit } from 'simple-git';

export interface AgentToolsOptions {
  /** Lines returned per `read_file` call when no explicit range is given. */
  maxReadFileLines?: number;
  /** Upper bound on `search_code` / `find_files` hits. */
  maxSearchResults?: number;
}

const DEFAULTS = {
  maxReadFileLines: 300,
  maxSearchResults: 35,
  /** Files above this size are never read into memory. */
  maxFileBytes: 5 * 1024 * 1024,
  /** Files above this size are skipped by the non-git fallback scanner. */
  maxScanBytes: 1024 * 1024,
  /** Recursion ceiling for the non-git fallback scanner. */
  maxWalkDepth: 12,
  /** Characters of a matched line echoed back to the model. */
  matchPreviewChars: 200,
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
    this.maxReadFileLines = options.maxReadFileLines || DEFAULTS.maxReadFileLines;
    this.maxSearchResults = options.maxSearchResults || DEFAULTS.maxSearchResults;
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
          return await this.searchCode(args.query, args.file_extension);
        case 'find_files':
          return await this.findFiles(args.pattern);
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
    if (stat.size > DEFAULTS.maxFileBytes) {
      return `文件过大 (${Math.round(stat.size / 1024)}KB)，只允许读取源文件`;
    }

    const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
    const start = Math.max(1, startLine || 1);
    const end = Math.min(
      lines.length,
      endLine || (startLine ? start + this.maxReadFileLines - 50 : this.maxReadFileLines)
    );

    const numberedContent = lines
      .slice(start - 1, end)
      .map((line, idx) => `${start + idx} | ${line}`)
      .join('\n');

    return `【文件: ${filePath} (第 ${start}-${end} 行 / 共 ${lines.length} 行)】\n\`\`\`\n${numberedContent}\n\`\`\``;
  }

  private async searchCode(query: string, fileExtension?: string): Promise<string> {
    if (!query || query.trim().length < 2) {
      return '搜索关键词过短';
    }

    const cleanQuery = query.trim();

    // 1. `git grep` is the fast path: native speed, multi-threaded, .gitignore-aware.
    const regexHit = await this.gitGrep(cleanQuery, fileExtension, '-E');
    if (regexHit) {
      return this.formatGrepOutput(cleanQuery, regexHit, 'Git 索引高速检索');
    }

    // 2. The query may not be valid regex — retry it as a literal.
    const literalHit = await this.gitGrep(cleanQuery, fileExtension, '-F');
    if (literalHit) {
      return this.formatGrepOutput(cleanQuery, literalHit, 'Git 索引文本检索');
    }

    // 3. Outside a git repo (or nothing indexed): walk the filesystem.
    const results = this.walkForMatches(cleanQuery, fileExtension);
    if (results.length === 0) {
      return `在代码库中未检索到符号/关键词: "${cleanQuery}"`;
    }

    const formatted = results.map((r) => `📄 ${r.file}:${r.line} -> ${r.text}`).join('\n');
    return `【代码库遍历检索 ("${cleanQuery}") - 共匹配 ${results.length} 处】:\n${formatted}`;
  }

  /** Returns matching lines, or null when git found nothing / is unavailable. */
  private async gitGrep(
    query: string,
    fileExtension: string | undefined,
    mode: '-E' | '-F'
  ): Promise<string[] | null> {
    const args = ['grep', '-n', '-I', '-i', mode, '-e', query];
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

  private formatGrepOutput(query: string, lines: string[], label: string): string {
    const limited = lines.slice(0, this.maxSearchResults);
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

    return `【${label} ("${query}") - 匹配到 ${lines.length} 处 (展示前 ${limited.length} 处)】:\n${formatted}`;
  }

  private async findFiles(pattern: string): Promise<string> {
    if (!pattern || pattern.trim().length < 2) {
      return '文件名搜索词过短';
    }

    const cleanPattern = pattern.trim();

    // 1. `git ls-files` is an index lookup — effectively instant.
    try {
      const globPattern = cleanPattern.includes('*') ? cleanPattern : `*${cleanPattern}*`;
      const rawOutput = await this.git.raw(['ls-files', globPattern]);
      if (rawOutput?.trim()) {
        const files = rawOutput.trim().split('\n').filter(Boolean).slice(0, this.maxSearchResults);
        return `【Git 快速定位文件 (共 ${files.length} 个)】:\n` + files.map((f) => `- ${f}`).join('\n');
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
      return matchedFiles.length < this.maxSearchResults;
    });

    if (matchedFiles.length === 0) {
      return `未定位到匹配 "${cleanPattern}" 的文件`;
    }
    return `【匹配到的文件路径 (共 ${matchedFiles.length} 个)】:\n` + matchedFiles.map((f) => `- ${f}`).join('\n');
  }

  private walkForMatches(
    query: string,
    fileExtension?: string
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
            if (results.length >= this.maxSearchResults) return false;
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
}
