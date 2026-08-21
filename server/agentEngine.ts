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
          text: `### ⚠️ 未检测到 API Key\n请在右上角 **「⚙️ AI 引擎配置」** 中填入您的 API Key（如 DeepSeek, OpenAI, Gemini 等）以启用智能体全库审查。`,
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
        message: '智能体引擎已就绪，已挂载 Git 高速索引只读沙箱...',
      })}\n\n`
    );

    const tools = new AgentTools(repoPath);

    // Primary system instructions driven by user configuration (with clean default fallback)
    const basePrompt =
      config?.customSystemPrompt && config.customSystemPrompt.trim()
        ? config.customSystemPrompt.trim()
        : `你是一位顶级资深架构师与代码审查专家。请对给定的 Git Diff 进行深度、精确的代码级技术剖析。

【审查原则与要求】：
1. 直击核心代码细节：严禁空洞套话，严禁简单复述语法。必须精确指出涉及的类名、方法名、参数类型、数据结构与关键算法。
2. 改动前后行为对比 (Before vs After)：清晰对比改动前的旧逻辑与改动后的新逻辑，说明代码执行路径、状态流转或计算方式的具体差异。
3. 深入解释实现机制与原因：透彻解析“为什么这样改”（底层机制、内存/并发模型、解耦或调用约定）。
4. 跨模块调用与依赖影响：若涉及接口变更、公共方法签名或命名空间，明确指出对下游调用方的影响。

【推荐输出排版】：
### 🔄 核心改动前后对比 (Before vs After)
- **改动前旧逻辑**：说明先前代码的行为与局限
- **改动后新逻辑**：说明本次改动后的实现与改变

### 🔬 关键代码实现深度拆解 (Implementation Mechanics)
深入剖析核心修改语句、状态迁移、数据流转与参数语义。

### 🌐 跨模块影响与下游调用 (Callers & Impact)
明确说明修改对外部依赖、调用方或工程配置的实际影响。`;

    const systemPrompt = `${basePrompt}

【可用工具说明】：
- \`read_file\`: 阅读仓库中指定文件的源代码（支持 start_line 与 end_line 切片）。
- \`search_code\`: 基于 Git 索引毫秒级全局搜索符号引用、类定义或下游调用（支持正则表达式）。
- \`find_files\`: 基于 Git 索引快速定位相关同名测试、接口契约或配置文件。`;

    let initialUserMsg = '';
    if (scopeType === 'line' && targetLine) {
      initialUserMsg = `【文件】: ${filePath || '当前文件'}\n【聚焦代码行 (Line ${
        targetLine.lineNumber || ''
      })】:\n\`\`\`\n${targetLine.type === 'delete' ? '-' : targetLine.type === 'add' ? '+' : ' '} ${
        targetLine.content
      }\n\`\`\`\n\n【周围上下文 Diff】:\n\`\`\`diff\n${diff.slice(
        0,
        5000
      )}\n\`\`\`\n\n${userPrompt ? `【附加要求】: ${userPrompt}\n\n` : ''}请对该行改动与关联上下文进行深度代码审查。`;
    } else {
      initialUserMsg = `【待审查文件】: ${filePath || '多文件'}\n【提交信息】: ${
        commitMessage || '无'
      }\n\`\`\`diff\n${diff.slice(
        0,
        8000
      )}\n\`\`\`\n\n${userPrompt ? `【用户疑问】: ${userPrompt}\n\n` : ''}请结合代码库进行关联审查并输出报告。`;
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
      // =========================================================================
      // Phase 1: Exploration Phase (Multi-Turn Tool Invocations)
      // =========================================================================
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
                : `第 ${explorationTurn}/${maxExplorationTurns} 轮探查：已获取关联代码，智能体正在推理...`,
            step: explorationTurn,
          })}\n\n`
        );

        // Call LLM
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
              text: `⚠️ **智能体接口调用失败 (${response.status})**: ${errText}`,
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
              content: toolResult.slice(0, 4000),
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

      // =========================================================================
      // Phase 2: Guaranteed Synthesis Phase (True HTTP SSE Token Streaming)
      // =========================================================================
      res.write(
        `data: ${JSON.stringify({
          type: 'status',
          phase: 'reporting',
          message: '代码库探查就绪，正在实时流式输出深度审查报告...',
        })}\n\n`
      );

      if (finalReportText) {
        // If already produced during exploration, stream immediately
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: finalReportText })}\n\n`);
      } else {
        // Explicitly prompt for the complete structured report with real-time SSE token streaming
        messages.push({
          role: 'user',
          content:
            '【探查阶段结束】请根据上述探查到的全部代码上下文与修改差异，按照设定的审查规则，直接输出最终完整的 Markdown 代码审查报告。',
        });

        const streamResponse = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: model || 'deepseek-chat',
            messages,
            stream: true,
          }),
        });

        if (!streamResponse.ok) {
          const errText = await streamResponse.text();
          res.write(
            `data: ${JSON.stringify({
              type: 'chunk',
              text: `### ⚠️ 生成报告失败 (${streamResponse.status}):\n${errText}`,
            })}\n\n`
          );
        } else if (streamResponse.body) {
          const reader = streamResponse.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              const dataStr = trimmed.replace(/^data:\s*/, '');
              if (dataStr === '[DONE]') continue;

              try {
                const parsed = JSON.parse(dataStr);
                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                  // Real-time zero latency token streaming directly to frontend drawer!
                  res.write(`data: ${JSON.stringify({ type: 'chunk', text: delta })}\n\n`);
                }
              } catch {
                // Ignore chunk parse errors
              }
            }
          }
        }
      }

      res.write(
        `data: ${JSON.stringify({
          type: 'status',
          phase: 'completed',
          message: '代码审查已完成',
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
          text: `\n\n❌ **智能体请求异常**: ${err.message}\n> 💡 建议：可点击右上角重新生成，或在顶部切换为「⚡ 直接 Diff 解释」快速模式。`,
        })}\n\n`
      );
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      cleanup();
      res.end();
    }
  }
}

export const agentEngine = new CodexAgentEngine();
