import path from 'path';
import fs from 'fs';
import { gitService } from './gitService';

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
      description: '在整个代码库中全局搜索指定关键词、类名、函数名或符号引用，用于找出下游调用方或关联定义。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索词 (例如: "DerivedAttributeSet" 或 "using GAS.Runtime")',
          },
          file_extension: {
            type: 'string',
            description: '限制文件扩展名 (可选，例如: ".cs" 或 ".ts")',
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
      description: '根据文件名模式模糊搜索文件路径，用于定位同名测试文件、配置文件或接口定义。',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: '匹配模式 (例如: "AttributeSet" 或 "Test")',
          },
        },
        required: ['pattern'],
      },
    },
  },
];

export class AgentTools {
  private repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = path.resolve(repoRoot);
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

    const results: { file: string; line: number; text: string }[] = [];
    const maxResults = 30;
    const lowerQuery = query.toLowerCase();

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
          if (fileExtension && !entry.name.endsWith(fileExtension)) {
            continue;
          }

          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > 1024 * 1024) continue;

            const content = fs.readFileSync(fullPath, 'utf-8');
            if (content.includes('\0')) continue; // skip binary

            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(lowerQuery)) {
                results.push({
                  file: relPath.replace(/\\/g, '/'),
                  line: i + 1,
                  text: lines[i].trim().slice(0, 180),
                });
                if (results.length >= maxResults) break;
              }
            }
          } catch {
            // ignore unreadable files
          }
        }
      }
    };

    walkDir(this.repoRoot);

    if (results.length === 0) {
      return `在代码库中未检索到关键词: "${query}"`;
    }

    const formatted = results
      .map((r) => `📄 ${r.file}:${r.line} -> ${r.text}`)
      .join('\n');

    return `【全局检索结果 ("${query}") - 共匹配 ${results.length} 处】:\n${formatted}`;
  }

  private async findFiles(pattern: string): Promise<string> {
    if (!pattern || pattern.trim().length < 2) {
      return '文件名搜索词过短';
    }

    const matchedFiles: string[] = [];
    const maxResults = 30;
    const lowerPattern = pattern.toLowerCase();

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
      return `未匹配到包含 "${pattern}" 的文件`;
    }

    return `【匹配到的文件路径】:\n` + matchedFiles.map((f) => `- ${f}`).join('\n');
  }
}
