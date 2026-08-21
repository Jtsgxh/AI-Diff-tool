import { Response } from 'express';
import { AgentTools, AGENT_TOOLS_DEFINITIONS } from './agentTools';
import { AIProviderConfig, TargetLineInfo } from './aiService';

export interface AgentExplainOptions {
  repoPath: string;
  scopeType?: 'line' | 'chunk' | 'file' | 'commit';
  targetLine?: TargetLineInfo;
  diff: string;
  filePath?: string;
  commitMessage?: string;
  userPrompt?: string;
  config?: AIProviderConfig;
}

function extractAndStripDSML(content: string): {
  cleanText: string;
  toolCalls: { name: string; args: any }[];
} {
  if (!content) return { cleanText: '', toolCalls: [] };

  const toolCalls: { name: string; args: any }[] = [];

  // Extract DSML invokes
  const invokePattern = /invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\s*\/[^>]*invoke>/gi;
  let match: RegExpExecArray | null;
  while ((match = invokePattern.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];
    const args: Record<string, any> = {};
    const paramPattern = /parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\s*\/[^>]*parameter>/gi;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = paramPattern.exec(body)) !== null) {
      args[pMatch[1]] = pMatch[2].trim();
    }
    toolCalls.push({ name, args });
  }

  // Strip DSML / XML tags from user-facing text
  let cleanText = content
    .replace(/<[\s\S]*?DSML[\s\S]*?>/gi, '')
    .replace(/<tool_calls>[\s\S]*?<\/tool_calls>/gi, '')
    .replace(/<invoke[\s\S]*?<\/invoke>/gi, '')
    .replace(/<\/?parameter[^>]*>/gi, '')
    .replace(/<\|[\s\S]*?\|>/g, '')
    .trim();

  return { cleanText, toolCalls };
}

export class CodexAgentEngine {
  async streamAgentExplain(options: AgentExplainOptions, res: Response): Promise<void> {
    const { repoPath, scopeType, targetLine, diff, filePath, commitMessage, userPrompt, config } =
      options;

    const provider = config?.provider || 'deepseek';
    const apiKey = config?.apiKey || process.env.AI_API_KEY || '';
    let baseUrl = config?.baseUrl || process.env.AI_BASE_URL || '';
    let model = config?.model || process.env.AI_MODEL || '';

    // Set standard SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    if (!apiKey && provider !== 'ollama') {
      res.write(
        `data: ${JSON.stringify({
          type: 'chunk',
          text: `### ⚠️ 未检测到 API Key\n请在右上角 **「⚙️ AI 引擎配置」** 中填入您的 API Key（如 DeepSeek, OpenAI, Gemini 等）以启用 Codex 智能体全库审查。`,
        })}\n\n`
      );
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return;
    }

    if (!baseUrl) {
      if (provider === 'deepseek') {
        baseUrl = 'https://api.deepseek.com/v1';
        model = model || 'deepseek-chat';
      } else if (provider === 'openai') {
        baseUrl = 'https://api.openai.com/v1';
        model = model || 'gpt-4o-mini';
      } else if (provider === 'gemini') {
        baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/';
        model = model || 'gemini-1.5-flash';
      } else if (provider === 'ollama') {
        baseUrl = 'http://localhost:11434/v1';
        model = model || 'qwen2.5-coder';
      }
    }

    const tools = new AgentTools(repoPath);

    const systemPrompt = `你是由 OpenAI Codex 与智能体架构驱动的资深软件架构师。你拥有对当前完整代码库的文件系统访问与符号检索工具。

【严格工具使用限制】：
1. 你最多只能调用 1 到 2 次最关键的工具（例如：仅针对修改的关键类搜索 1 次引用，或仅阅读 1 个核心定义文件）。
2. 严禁进行地毯式大范围搜索，严禁连续调用超过 2 个工具。
3. 一旦获得关键上下文线索，必须立刻停止调用工具，直接输出最终的 Markdown 中文审查报告。
4. 严禁在输出正文中输出任何 < | | DSML | | ... > 或 XML 标签。

【可用工具】：
- \`read_file\`: 阅读仓库中指定文件的关键代码段。
- \`search_code\`: 全局搜索某个核心符号/类名的引用位置。
- \`find_files\`: 模糊搜索文件名。

【最终审查报告格式 (Markdown)】：
### 🌐 全局架构与改动意图 (Cross-Module Intent)
一到两句话概括本次改动的宏观目的。

### 🔍 跨文件影响与关键依赖分析 (Impact & Callers Analysis)
结合刚才检索到的关联文件与调用方，说明修改是否破坏外部调用、是否存在命名空间缺失。

### ⚠️ 深度风险雷达与边界隐患 (Risk Radar)
分析并发安全、内存、异常处理、兼容性 Breaking Changes 等。

### 💡 架构重构与测试建议 (Actionable Suggestions)`;

    let initialUserMsg = '';
    if (scopeType === 'line' && targetLine) {
      initialUserMsg = `【文件】: ${filePath || '当前文件'}\n【聚焦代码行 (Line ${
        targetLine.lineNumber || ''
      })】:\n\`\`\`\n${targetLine.type === 'delete' ? '-' : targetLine.type === 'add' ? '+' : ' '} ${
        targetLine.content
      }\n\`\`\`\n\n【周围上下文 Diff】:\n\`\`\`diff\n${diff.slice(
        0,
        5000
      )}\n\`\`\`\n\n请结合代码库全局上下文进行深度审查（若有必要最多调用 1-2 次工具，随后直接输出报告）。`;
    } else {
      initialUserMsg = `【待审查文件】: ${filePath || '多文件'}\n【提交信息】: ${
        commitMessage || '无'
      }\n\`\`\`diff\n${diff.slice(
        0,
        8000
      )}\n\`\`\`\n\n${userPrompt ? `【用户疑问】: ${userPrompt}\n\n` : ''}请最多调用 1-2 次关键工具检索上下文，随后直接输出深度审查报告。`;
    }

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: initialUserMsg },
    ];

    const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    let totalToolsExecuted = 0;
    const maxTotalTools = 3; // Strict hard cap on tool executions
    const maxIterations = 2; // Strict max turns
    let iteration = 0;

    try {
      while (iteration < maxIterations) {
        iteration++;

        const isLastIteration = iteration >= maxIterations || totalToolsExecuted >= maxTotalTools;

        // Call LLM
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: model || 'deepseek-chat',
            messages,
            tools: isLastIteration ? undefined : AGENT_TOOLS_DEFINITIONS,
            tool_choice: isLastIteration ? 'none' : 'auto',
            stream: false,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          res.write(
            `data: ${JSON.stringify({
              type: 'chunk',
              text: `⚠️ **Codex Agent 接口调用失败 (${response.status})**: ${errText}`,
            })}\n\n`
          );
          break;
        }

        const data: any = await response.json();
        const choice = data.choices?.[0];
        const msg = choice?.message;

        if (!msg) break;

        // Parse official tool_calls OR DeepSeek embedded DSML in content
        const rawContent = msg.content || '';
        const { cleanText, toolCalls: dsmlToolCalls } = extractAndStripDSML(rawContent);

        const activeToolCalls: any[] = [];
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          activeToolCalls.push(...msg.tool_calls);
        } else if (dsmlToolCalls.length > 0) {
          activeToolCalls.push(
            ...dsmlToolCalls.map((t, idx) => ({
              id: `dsml_${Date.now()}_${idx}`,
              function: { name: t.name, arguments: JSON.stringify(t.args) },
            }))
          );
        }

        if (activeToolCalls.length > 0 && !isLastIteration && totalToolsExecuted < maxTotalTools) {
          // Limit to max 2 tools in this batch to prevent overload
          const batchCalls = activeToolCalls.slice(0, 2);
          messages.push({
            role: 'assistant',
            content: cleanText || null,
            tool_calls: batchCalls,
          });

          for (const toolCall of batchCalls) {
            totalToolsExecuted++;
            const funcName = toolCall.function.name;
            let args: any = {};
            try {
              args = JSON.parse(toolCall.function.arguments);
            } catch {
              args = {};
            }

            const toolCallId = toolCall.id || `call_${Date.now()}`;
            res.write(
              `data: ${JSON.stringify({
                type: 'tool_call',
                id: toolCallId,
                name: funcName,
                args,
              })}\n\n`
            );

            // Execute tool safely
            const toolResult = await tools.executeTool(funcName, args);

            res.write(
              `data: ${JSON.stringify({
                type: 'tool_result',
                id: toolCallId,
                name: funcName,
                summary: `${funcName}(${Object.values(args).join(', ')})`,
                output: toolResult.slice(0, 400) + (toolResult.length > 400 ? '...' : ''),
              })}\n\n`
            );

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: toolResult.slice(0, 4000),
            });
          }

          // If reached max, add a nudge to produce final report
          if (totalToolsExecuted >= maxTotalTools || iteration === maxIterations - 1) {
            messages.push({
              role: 'user',
              content: '【已收集到足够的关联代码上下文，请直接输出最终完整的 Markdown 审查报告，禁止再调用工具或输出任何标签】',
            });
          }
        } else {
          // Final Report Text output
          const finalReport = cleanText || rawContent;
          if (finalReport) {
            const chunkSize = 40;
            for (let i = 0; i < finalReport.length; i += chunkSize) {
              const chunk = finalReport.slice(i, i + chunkSize);
              res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
              await new Promise((r) => setTimeout(r, 12));
            }
          }
          break;
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (err: any) {
      res.write(
        `data: ${JSON.stringify({
          type: 'chunk',
          text: `\n\n❌ **Codex Agent 执行出错**: ${err.message}`,
        })}\n\n`
      );
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    }
  }
}

export const agentEngine = new CodexAgentEngine();
