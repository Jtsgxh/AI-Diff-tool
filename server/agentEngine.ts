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

// Robust fetch with configurable timeout and automatic retry
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number = 40000,
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
        await new Promise((r) => setTimeout(r, attempt * 1200));
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
        await new Promise((r) => setTimeout(r, attempt * 1200));
      } else {
        throw new Error(`模型请求异常 (${errorMsg})，已重试 ${maxRetries} 次`);
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

    // Send keep-alive ping every 8s
    const keepAliveTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, 8000);

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

    res.write(
      `data: ${JSON.stringify({
        type: 'status',
        phase: 'initializing',
        message: 'Codex 智能体已连接，正在初始化代码库只读沙箱...',
      })}\n\n`
    );

    const tools = new AgentTools(repoPath);

    const systemPrompt = `你是由 OpenAI Codex 驱动的高级代码审查智能体与架构师。你拥有对当前代码库的只读探查工具。

【探查阶段与目标】：
1. 你的核心使命是全面、透彻地审查给定的 Git Diff。
2. 你可以使用工具主动查阅相关源文件或搜索下游引用（建议聚焦于核心类继承、关键接口与直接调用方，避免探查无关构建脚本）。
3. 探查通常在 3~6 次关键工具调用后即可获得充足证据。当你获得足够信息后，请停止调用工具。

【可用工具】：
- \`read_file\`: 阅读仓库中指定文件的关键代码。
- \`search_code\`: 全局搜索某个核心符号/类名的下游引用。
- \`find_files\`: 模糊搜索文件名。

【最终审查报告结构】：
### 🌐 全局架构与改动意图 (Cross-Module Context & Intent)
结合探查到的外部代码库结构，说明本次改动的宏观目的。

### 🔍 跨文件影响与关键依赖分析 (Impact & Callers Analysis)
分析本次修改对外部类、下游调用方及命名空间的影响，指出是否存在破坏性变更。

### ⚠️ 深度风险雷达与边界隐患 (Risk Radar)
检查并发安全性（竞态/死锁）、内存/资源管理、空异常、异常逃逸等。

### 💡 架构重构与测试建议 (Actionable Suggestions)
提出针对代码健壮性、可读性或单元测试的建议。`;

    let initialUserMsg = '';
    if (scopeType === 'line' && targetLine) {
      initialUserMsg = `【文件】: ${filePath || '当前文件'}\n【聚焦代码行 (Line ${
        targetLine.lineNumber || ''
      })】:\n\`\`\`\n${targetLine.type === 'delete' ? '-' : targetLine.type === 'add' ? '+' : ' '} ${
        targetLine.content
      }\n\`\`\`\n\n【周围上下文 Diff】:\n\`\`\`diff\n${diff.slice(
        0,
        5000
      )}\n\`\`\`\n\n请结合代码库全局上下文进行深度审查。`;
    } else {
      initialUserMsg = `【待审查文件】: ${filePath || '多文件'}\n【提交信息】: ${
        commitMessage || '无'
      }\n\`\`\`diff\n${diff.slice(
        0,
        8000
      )}\n\`\`\`\n\n${userPrompt ? `【用户疑问】: ${userPrompt}\n\n` : ''}请结合代码库进行跨文件关联审查。`;
    }

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: initialUserMsg },
    ];

    const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    // Dynamic Runtime Controls from User Configuration
    const maxExplorationTurns = Math.max(1, Math.min(15, config?.maxExplorationTurns || 5));
    const timeoutMs = Math.max(10000, Math.min(120000, (config?.timeoutSeconds || 35) * 1000));
    const maxRetries = config?.maxRetries !== undefined ? Math.max(0, Math.min(5, config.maxRetries)) : 2;

    let explorationTurn = 0;
    let finalReportText = '';

    try {
      while (explorationTurn < maxExplorationTurns) {
        explorationTurn++;

        // Emit thinking status
        res.write(
          `data: ${JSON.stringify({
            type: 'status',
            phase: 'thinking',
            message:
              explorationTurn === 1
                ? '第 1 轮探查：正在分析 Diff 语义特征与外部引用...'
                : `第 ${explorationTurn}/${maxExplorationTurns} 轮探查：已获取关联代码，Codex 正在推理...`,
            step: explorationTurn,
          })}\n\n`
        );

        // Call LLM with user-configured timeout and retry
        const response = await fetchWithRetry(
          url,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: model || 'deepseek-chat',
              messages,
              tools: AGENT_TOOLS_DEFINITIONS,
              tool_choice: 'auto',
              stream: false,
            }),
          },
          timeoutMs,
          maxRetries,
          (attempt, errorMsg) => {
            res.write(
              `data: ${JSON.stringify({
                type: 'status',
                phase: 'thinking',
                message: `⚠️ 网络/模型响应较慢 (${errorMsg})，正在进行第 ${attempt}/${maxRetries} 次自动重试...`,
                step: explorationTurn,
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

        if (activeToolCalls.length > 0) {
          const toolNames = activeToolCalls.map((t) => t.function.name).join(', ');

          res.write(
            `data: ${JSON.stringify({
              type: 'status',
              phase: 'executing_tools',
              message: `智能体调用工具: ${toolNames} 探查代码库...`,
              step: explorationTurn,
            })}\n\n`
          );

          messages.push({
            role: 'assistant',
            content: cleanText || null,
            tool_calls: activeToolCalls,
          });

          // Execute all tools requested by the Agent
          for (const toolCall of activeToolCalls) {
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

            // Execute tool safely on local repo
            const toolResult = await tools.executeTool(funcName, args);

            res.write(
              `data: ${JSON.stringify({
                type: 'tool_result',
                id: toolCallId,
                name: funcName,
                summary: `${funcName}(${Object.values(args).join(', ')})`,
                output: toolResult.slice(0, 450) + (toolResult.length > 450 ? '...' : ''),
              })}\n\n`
            );

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: toolResult.slice(0, 3500),
            });
          }
        } else {
          // Model did not call tools: check if it already produced a structured report
          const text = cleanText || rawContent;
          if (text.includes('###') || text.length > 300) {
            finalReportText = text;
          }
          break; // Stop exploration phase
        }
      }

      // Phase 2: Guaranteed Synthesis Phase (生成最终结构化报告)
      res.write(
        `data: ${JSON.stringify({
          type: 'status',
          phase: 'reporting',
          message: '代码库探查就绪，正在生成跨模块深度审查报告...',
        })}\n\n`
      );

      if (!finalReportText) {
        // If report wasn't generated yet (e.g. exploration budget ended or model outputted intermediate thoughts),
        // explicitly prompt for the complete structured report!
        messages.push({
          role: 'user',
          content:
            '【探查阶段结束】请根据上述探查到的全部代码上下文与修改差异，立即输出一份完整、严谨、深度的 Markdown 代码审查报告。必须包含【全局架构与改动意图】、【跨文件影响与关键依赖分析】、【深度风险雷达】与【架构重构与测试建议】。',
        });

        const synthesisRes = await fetchWithRetry(
          url,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: model || 'deepseek-chat',
              messages,
              stream: false,
            }),
          },
          40000,
          2
        );

        if (synthesisRes.ok) {
          const synthData: any = await synthesisRes.json();
          const synthMsg = synthData.choices?.[0]?.message?.content || '';
          const { cleanText } = extractAndStripDSML(synthMsg);
          finalReportText = cleanText || synthMsg;
        }
      }

      // Stream the guaranteed final report to the user
      if (finalReportText) {
        const chunkSize = 35;
        for (let i = 0; i < finalReportText.length; i += chunkSize) {
          const chunk = finalReportText.slice(i, i + chunkSize);
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
          await new Promise((r) => setTimeout(r, 12));
        }
      } else {
        res.write(
          `data: ${JSON.stringify({
            type: 'chunk',
            text: `### ⚠️ 未能生成完整报告\n未能从大模型获取到最终总结，请点击右上角重试。`,
          })}\n\n`
        );
      }

      res.write(
        `data: ${JSON.stringify({
          type: 'status',
          phase: 'completed',
          message: 'Codex 审查已完成',
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
