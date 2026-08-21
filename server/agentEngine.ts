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

  // Extract DSML invokes if present
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

// Robust fetch with configurable timeout (30s) and automatic retry (2 attempts)
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number = 30000,
  maxRetries: number = 2,
  onRetry?: (attempt: number, errorMsg: string) => void
): Promise<globalThis.Response> {
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // If server returns 5xx or rate limit 429, retry
      if ((res.status >= 500 || res.status === 429) && attempt <= maxRetries) {
        const errorText = await res.text().catch(() => '');
        onRetry?.(attempt, `HTTP ${res.status}: ${errorText.slice(0, 100)}`);
        await new Promise((r) => setTimeout(r, attempt * 1500));
        continue;
      }

      return res;
    } catch (err: any) {
      clearTimeout(timeoutId);
      lastError = err;

      const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
      const errorMsg = isTimeout ? `请求超时 (${timeoutMs / 1000}s)` : err.message;

      if (attempt <= maxRetries) {
        onRetry?.(attempt, errorMsg);
        await new Promise((r) => setTimeout(r, attempt * 1500));
      } else {
        throw new Error(`模型请求失败 (${errorMsg})，已重试 ${maxRetries} 次`);
      }
    }
  }

  throw lastError;
}

export class CodexAgentEngine {
  async streamAgentExplain(options: AgentExplainOptions, res: Response): Promise<void> {
    const { repoPath, scopeType, targetLine, diff, filePath, commitMessage, userPrompt, config } =
      options;

    const provider = config?.provider || 'deepseek';
    const apiKey = config?.apiKey || process.env.AI_API_KEY || '';
    let baseUrl = config?.baseUrl || process.env.AI_BASE_URL || '';
    let model = config?.model || process.env.AI_MODEL || '';

    // Set standard SSE headers with keepalive
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Send keep-alive ping every 10s
    const keepAliveTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, 10000);

    const cleanup = () => {
      clearInterval(keepAliveTimer);
    };

    if (!apiKey && provider !== 'ollama') {
      res.write(
        `data: ${JSON.stringify({
          type: 'chunk',
          text: `### ⚠️ 未检测到 API Key\n请在右上角 **「⚙️ AI 引擎配置」** 中填入您的 API Key（如 DeepSeek, OpenAI, Gemini 等）以启用 Codex 智能体全库审查。`,
        })}\n\n`
      );
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      cleanup();
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

    // 1. Emit Initial Immediate Status to UI
    res.write(
      `data: ${JSON.stringify({
        type: 'status',
        phase: 'initializing',
        message: 'Codex 智能体已连接，正在初始化代码库只读沙箱...',
      })}\n\n`
    );

    const tools = new AgentTools(repoPath);

    const systemPrompt = `你是由 OpenAI Codex 与智能体架构驱动的资深软件架构师。你拥有对当前完整代码库的文件系统访问与符号检索工具。

【自主探索与决策原则】：
1. 仔细分析给定的 Git 差异。若发现不确定的类继承、接口声明、函数调用、跨文件依赖或命名空间变更，自主调用工具检索最核心的文件或符号。
2. 优先针对核心修改符号检索，避免搜索如 "Enabled"、"Get" 这类过于宽泛的泛词。
3. 当你已查阅 2-4 个关键关联上下文后，应自主结束工具调用，直接输出一份结构完整、论据扎实、跨模块的全景 Markdown 审查报告。

【可用工具】：
- \`read_file\`: 阅读仓库中指定文件的关键代码段或完整实现。
- \`search_code\`: 全局搜索某个核心符号、类名、接口或关键调用（用于评估下游影响）。
- \`find_files\`: 模糊搜索文件名，定位同名测试、接口契约或配置文件。

【最终审查报告结构 (Markdown)】：
### 🌐 全局架构与改动意图 (Cross-Module Context & Intent)
结合探查到的外部源文件与工程结构，说明本次改动的宏观目的。

### 🔍 跨文件影响与关键依赖分析 (Impact & Callers Analysis)
结合检索到的关联文件与下游调用方，说明修改是否破坏外部调用、是否存在命名空间缺失或类型不兼容。

### ⚠️ 深度风险雷达与边界隐患 (Risk Radar)
检查并发安全性（竞态/死锁）、内存管理、空异常、异常逃逸、兼容性 Breaking Changes 等。

### 💡 架构重构与测试建议 (Actionable Suggestions)
提出针对代码健壮性、可读性或测试用例编写的建议。`;

    let initialUserMsg = '';
    if (scopeType === 'line' && targetLine) {
      initialUserMsg = `【文件】: ${filePath || '当前文件'}\n【聚焦代码行 (Line ${
        targetLine.lineNumber || ''
      })】:\n\`\`\`\n${targetLine.type === 'delete' ? '-' : targetLine.type === 'add' ? '+' : ' '} ${
        targetLine.content
      }\n\`\`\`\n\n【周围上下文 Diff】:\n\`\`\`diff\n${diff.slice(
        0,
        5000
      )}\n\`\`\`\n\n请结合代码库全局上下文进行深度审查。如需跨文件信息请自主决定调用工具，收集完毕后输出报告。`;
    } else {
      initialUserMsg = `【待审查文件】: ${filePath || '多文件'}\n【提交信息】: ${
        commitMessage || '无'
      }\n\`\`\`diff\n${diff.slice(
        0,
        7000
      )}\n\`\`\`\n\n${userPrompt ? `【用户疑问】: ${userPrompt}\n\n` : ''}请自主分析并决定是否探查关联代码文件或搜索引用，收集充分后输出深度审查报告。`;
    }

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: initialUserMsg },
    ];

    const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    let totalToolsExecuted = 0;
    const maxIterations = 5; // 5 rounds maximum
    let iteration = 0;

    try {
      while (iteration < maxIterations) {
        iteration++;

        // If executed >= 6 tools or reached max iterations, force final report synthesis
        const isForceSynthesis = iteration >= maxIterations || totalToolsExecuted >= 6;

        // Emit thinking status
        res.write(
          `data: ${JSON.stringify({
            type: 'status',
            phase: 'thinking',
            message:
              iteration === 1
                ? '第 1 轮决策：正在分析 Diff 语义特征与外部引用...'
                : isForceSynthesis
                ? '已收集充分上下文，正在合成全景审查报告...'
                : `第 ${iteration} 轮决策：已获取关联代码，正在综合推理...`,
            step: iteration,
          })}\n\n`
        );

        // Call LLM with 30s timeout & automatic 2-attempt retry
        const response = await fetchWithRetry(
          url,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: model || 'deepseek-chat',
              messages,
              tools: isForceSynthesis ? undefined : AGENT_TOOLS_DEFINITIONS,
              tool_choice: isForceSynthesis ? 'none' : 'auto',
              stream: false,
            }),
          },
          30000, // 30s timeout
          2, // 2 retries
          (attempt, errorMsg) => {
            res.write(
              `data: ${JSON.stringify({
                type: 'status',
                phase: 'thinking',
                message: `⚠️ 模型请求较慢 (${errorMsg})，正在进行第 ${attempt}/2 次自动重试...`,
                step: iteration,
              })}\n\n`
            );
          }
        );

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

        if (activeToolCalls.length > 0 && !isForceSynthesis) {
          // Limit to max 3 tools per batch to prevent explosion
          const batchCalls = activeToolCalls.slice(0, 3);
          const toolNames = batchCalls.map((t) => t.function.name).join(', ');

          res.write(
            `data: ${JSON.stringify({
              type: 'status',
              phase: 'executing_tools',
              message: `智能体决定调用工具: ${toolNames} 探查代码库...`,
              step: iteration,
            })}\n\n`
          );

          messages.push({
            role: 'assistant',
            content: cleanText || null,
            tool_calls: batchCalls,
          });

          // Execute all tools requested by the Agent
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

            // Execute tool safely on the local repository
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

            // Trim tool result in context to max 1500 chars to avoid memory/token bloat
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: toolResult.slice(0, 1500),
            });
          }

          // If reached 5+ tools, instruct model to wrap up
          if (totalToolsExecuted >= 5 || iteration >= maxIterations - 1) {
            messages.push({
              role: 'user',
              content: '【已收集到充分的关键代码上下文，请立即输出最终完整的 Markdown 审查报告，无需再调用工具】',
            });
          }
        } else {
          // Agent autonomously finished calling tools -> outputs final comprehensive report
          res.write(
            `data: ${JSON.stringify({
              type: 'status',
              phase: 'reporting',
              message: '证据收集充分，正在流式输出全景审查报告...',
            })}\n\n`
          );

          const finalReport = cleanText || rawContent;
          if (finalReport) {
            const chunkSize = 35;
            for (let i = 0; i < finalReport.length; i += chunkSize) {
              const chunk = finalReport.slice(i, i + chunkSize);
              res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
              await new Promise((r) => setTimeout(r, 12));
            }
          }
          break;
        }
      }

      res.write(
        `data: ${JSON.stringify({
          type: 'status',
          phase: 'completed',
          message: 'Codex 审查完成',
        })}\n\n`
      );
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      cleanup();
      res.end();
    } catch (err: any) {
      res.write(
        `data: ${JSON.stringify({
          type: 'status',
          phase: 'completed',
          message: `执行中断: ${err.message}`,
        })}\n\n`
      );
      res.write(
        `data: ${JSON.stringify({
          type: 'chunk',
          text: `\n\n❌ **Codex Agent 请求异常**: ${err.message}\n> 💡 建议：可点击右上角重新生成，或在顶部切换为「⚡ 直接 Diff 解释」快速模式。`,
        })}\n\n`
      );
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      cleanup();
      res.end();
    }
  }
}

export const agentEngine = new CodexAgentEngine();
