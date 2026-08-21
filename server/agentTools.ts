import path from 'path';
import fs from 'fs';
import simpleGit, { SimpleGit } from 'simple-git';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export const AGENT_TOOLS_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取当前代码库中指定文件的源代码内容。在分析 Diff 中涉及的外部类、接口或调用逻辑时使用。',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: '相对于仓库根目录的文件路径 (例如: "src/Actors/Actor.cs")',
          },
          start_line: {
            type: 'number',
            description: '起始行号 (可选，从 1 开始)',
          },
          end_line: {
            type: 'number',
            description: '结束行号 (可选)',
          },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: '在整个代码库中利用 Git 索引全局检索符号引用、下游调用方或类/函数定义（支持正则表达式）。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索词或正则 (例如: "DerivedAttributeSet" 或 "class\\s+Player")',
          },
          file_extension: {
            type: 'string',
            description: '限制文件扩展名过滤 (可选，例如: "*.cs" 或 "*.ts")',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_files',
      description: '根据文件名模式通过 Git 索引快速定位文件路径，用于定位同名测试、接口契约或配置文件。',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: '匹配模式 (例如: "*AttributeSet*" 或 "*Test*.cs")',
          },
        },
        required: ['pattern'],
      },
    },
  },
];

export class AgentTools {
  private repoRoot: string;
  private git: SimpleGit;

  constructor(repoRoot: string) {
    this.repoRoot = path.resolve(repoRoot);
    this.git = simpleGit(this.repoRoot);
  }

  private resolveSafePath(filePath: string): string {
    const fullPath = path.resolve(this.repoRoot, filePath);
    if (!fullPath.startsWith(this.repoRoot)) {
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
    if (!fs.existsSync(fullPath)) {
      return `文件不存在: ${filePath}`;
    }

    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      return `路径不是文件: ${filePath}`;
    }

    if (stat.size > 5 * 1024 * 1024) {
      return `文件过大 (${Math.round(stat.size / 1024)}KB)，只允许读取源文件`;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    const start = Math.max(1, startLine || 1);
    const end = Math.min(lines.length, endLine || (startLine ? start + 250 : Math.min(lines.length, 300)));

    const selectedLines = lines.slice(start - 1, end);
    const numberedContent = selectedLines
      .map((line, idx) => `${start + idx} | ${line}`)
      .join('\n');

    return `【文件: ${filePath} (第 ${start}-${end} 行 / 共 ${lines.length} 行)】\n\`\`\`\n${numberedContent}\n\`\`\``;
  }

  private async searchCode(query: string, fileExtension?: string): Promise<string> {
    if (!query || query.trim().length < 2) {
      return '搜索关键词过短';
    }

    const maxResults = 35;
    const cleanQuery = query.trim();

    // 1. First Priority: Use high-speed native git grep (respects .gitignore, C-speed, multi-threaded)
    try {
      const gitArgs = ['grep', '-n', '-I', '-i', '-E', '-e', cleanQuery];
      if (fileExtension) {
        const globPattern = fileExtension.startsWith('*') ? fileExtension : `*${fileExtension}`;
        gitArgs.push('--', globPattern);
      }

      const rawOutput = await this.git.raw(gitArgs);
      if (rawOutput && rawOutput.trim()) {
        const lines = rawOutput.trim().split('\n').filter(Boolean);
        const limitedLines = lines.slice(0, maxResults);
        const formatted = limitedLines
          .map((line) => {
            const parts = line.split(':');
            if (parts.length >= 3) {
              const file = parts[0];
              const lineNum = parts[1];
              const text = parts.slice(2).join(':').trim().slice(0, 200);
              return `📄 ${file}:${lineNum} -> ${text}`;
            }
            return `📄 ${line.slice(0, 200)}`;
          })
          .join('\n');

        return `【Git 索引高速检索 ("${cleanQuery}") - 匹配到 ${lines.length} 处 (展示前 ${limitedLines.length} 处)】:\n${formatted}`;
      }
    } catch (gitErr: any) {
      // If git grep exited with 1, it means 0 matches found; if regex error, fallback to literal
      if (gitErr.message && !gitErr.message.includes('exit code 1')) {
        // Fallback to literal search if regex failed
        try {
          const literalArgs = ['grep', '-n', '-I', '-i', '-F', '-e', cleanQuery];
          if (fileExtension) literalArgs.push('--', fileExtension.startsWith('*') ? fileExtension : `*${fileExtension}`);
          const rawLiteral = await this.git.raw(literalArgs);
          if (rawLiteral && rawLiteral.trim()) {
            const lines = rawLiteral.trim().split('\n').filter(Boolean).slice(0, maxResults);
            return `【Git 索引文本检索 ("${cleanQuery}")】:\n` + lines.map((l) => `📄 ${l.slice(0, 200)}`).join('\n');
          }
        } catch {}
      }
    }

    // 2. Fallback: Fast directory walker (if outside Git)
    const results: { file: string; line: number; text: string }[] = [];
    const lowerQuery = cleanQuery.toLowerCase();

    const walkDir = (dir: string) => {
      if (results.length >= maxResults) return;

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(this.repoRoot, fullPath);

        if (entry.isDirectory()) {
          if (
            entry.name.startsWith('.') ||
            ['node_modules', 'bin', 'obj', 'dist', 'build', '.git', 'target', 'vendor'].includes(
              entry.name
            )
          ) {
            continue;
          }
          walkDir(fullPath);
        } else if (entry.isFile()) {
          if (fileExtension && !entry.name.endsWith(fileExtension.replace('*', ''))) {
            continue;
          }

          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > 1024 * 1024) continue;

            const content = fs.readFileSync(fullPath, 'utf-8');
            if (content.includes('\0')) continue;

            const fileLines = content.split('\n');
            for (let i = 0; i < fileLines.length; i++) {
              if (fileLines[i].toLowerCase().includes(lowerQuery)) {
                results.push({
                  file: relPath.replace(/\\/g, '/'),
                  line: i + 1,
                  text: fileLines[i].trim().slice(0, 180),
                });
                if (results.length >= maxResults) break;
              }
            }
          } catch {}
        }
      }
    };

    walkDir(this.repoRoot);

    if (results.length === 0) {
      return `在代码库中未检索到符号/关键词: "${cleanQuery}"`;
    }

    const formatted = results
      .map((r) => `📄 ${r.file}:${r.line} -> ${r.text}`)
      .join('\n');

    return `【代码库遍历检索 ("${cleanQuery}") - 共匹配 ${results.length} 处】:\n${formatted}`;
  }

  private async findFiles(pattern: string): Promise<string> {
    if (!pattern || pattern.trim().length < 2) {
      return '文件名搜索词过短';
    }

    const cleanPattern = pattern.trim();
    const maxResults = 35;

    // 1. First Priority: Git ls-files (instant C-speed index lookup)
    try {
      const globPattern = cleanPattern.includes('*') ? cleanPattern : `*${cleanPattern}*`;
      const rawOutput = await this.git.raw(['ls-files', globPattern]);
      if (rawOutput && rawOutput.trim()) {
        const files = rawOutput.trim().split('\n').filter(Boolean).slice(0, maxResults);
        return `【Git 快速定位文件 (共 ${files.length} 个)】:\n` + files.map((f) => `- ${f}`).join('\n');
      }
    } catch {}

    // 2. Fallback: Fast directory walker
    const matchedFiles: string[] = [];
    const lowerPattern = cleanPattern.toLowerCase();

    const walkDir = (dir: string) => {
      if (matchedFiles.length >= maxResults) return;

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (matchedFiles.length >= maxResults) break;

        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(this.repoRoot, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (
            entry.name.startsWith('.') ||
            ['node_modules', 'bin', 'obj', 'dist', 'build', '.git', 'target'].includes(entry.name)
          ) {
            continue;
          }
          walkDir(fullPath);
        } else if (entry.isFile()) {
          if (entry.name.toLowerCase().includes(lowerPattern) || relPath.toLowerCase().includes(lowerPattern)) {
            matchedFiles.push(relPath);
          }
        }
      }
    };

    walkDir(this.repoRoot);

    if (matchedFiles.length === 0) {
      return `未定位到匹配 "${cleanPattern}" 的文件`;
    }

    return `【匹配到的文件路径 (共 ${matchedFiles.length} 个)】:\n` + matchedFiles.map((f) => `- ${f}`).join('\n');
  }
}
