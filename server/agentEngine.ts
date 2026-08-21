import { Response } from 'express';
import OpenAI from 'openai';
import { Agent, Runner, tool, RunItemStreamEvent, MaxTurnsExceededError } from '@openai/agents';
import {
  OpenAIChatCompletionsModel,
  isOpenAIChatCompletionsRawModelStreamEvent,
} from '@openai/agents-openai';
import { z } from 'zod';
import { AgentTools } from './agentTools';
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

export class CodexAgentEngine {
  async streamAgentExplain(options: AgentExplainOptions, res: Response): Promise<void> {
    const { repoPath, scopeType, targetLine, diff, filePath, commitMessage, userPrompt, config } =
      options;

    const provider = config?.provider || 'deepseek';
    const apiKey = config?.apiKey || process.env.AI_API_KEY || '';
    let baseUrl = config?.baseUrl || process.env.AI_BASE_URL || '';
    let modelName = config?.model || process.env.AI_MODEL || '';

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
          text: `### ⚠️ 未检测到 API Key\n请在右上角 **「⚙️ AI 引擎配置」** 中填入您的 API Key（如 DeepSeek, OpenAI, Gemini 等）以启用官方 Codex 智能体全库审查。`,
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
        modelName = modelName || 'deepseek-chat';
      } else if (provider === 'openai') {
        baseUrl = 'https://api.openai.com/v1';
        modelName = modelName || 'gpt-4o-mini';
      } else if (provider === 'gemini') {
        baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/';
        modelName = modelName || 'gemini-1.5-flash';
      } else if (provider === 'ollama') {
        baseUrl = 'http://localhost:11434/v1';
        modelName = modelName || 'qwen2.5-coder';
      }
    }

    res.write(
      `data: ${JSON.stringify({
        type: 'status',
        phase: 'initializing',
        message: 'OpenAI Agents 官方智能体引擎已启动，已挂载 Git 索引沙箱...',
      })}\n\n`
    );

    const toolsInstance = new AgentTools(repoPath);
    const explorationLog: { name: string; args: any; output: string }[] = [];

    // 1. Define Official @openai/agents Tools with exact names and parameters
    const readFileTool = tool({
      name: 'read_file',
      description: '读取当前代码库中指定文件的源代码内容。在分析 Diff 中涉及的外部类、接口或调用逻辑时使用。',
      parameters: z.object({
        file_path: z.string().describe('相对于仓库根目录的文件路径 (例如: "src/Actors/Actor.cs")'),
        start_line: z.number().optional().describe('起始行号 (可选，从 1 开始)'),
        end_line: z.number().optional().describe('结束行号 (可选)'),
      }),
      execute: async ({ file_path, start_line, end_line }) => {
        const result = await toolsInstance.executeTool('read_file', {
          file_path,
          start_line,
          end_line,
        });
        explorationLog.push({
          name: 'read_file',
          args: { file_path, start_line, end_line },
          output: result.slice(0, 3000),
        });
        return result;
      },
    });

    const searchCodeTool = tool({
      name: 'search_code',
      description: '在整个代码库中利用 Git 索引全局检索符号引用、下游调用方或类/函数定义（支持正则表达式）。',
      parameters: z.object({
        query: z.string().describe('搜索词或正则 (例如: "DerivedAttributeSet" 或 "class\\s+Player")'),
        file_extension: z.string().optional().describe('限制文件扩展名过滤 (可选，例如: "*.cs" 或 "*.ts")'),
      }),
      execute: async ({ query, file_extension }) => {
        const result = await toolsInstance.executeTool('search_code', {
          query,
          file_extension,
        });
        explorationLog.push({
          name: 'search_code',
          args: { query, file_extension },
          output: result.slice(0, 3000),
        });
        return result;
      },
    });

    const findFilesTool = tool({
      name: 'find_files',
      description: '根据文件名模式通过 Git 索引快速定位文件路径，用于定位同名测试、接口契约或配置文件。',
      parameters: z.object({
        pattern: z.string().describe('匹配模式 (例如: "*AttributeSet*" 或 "*Test*.cs")'),
      }),
      execute: async ({ pattern }) => {
        const result = await toolsInstance.executeTool('find_files', {
          pattern,
        });
        explorationLog.push({
          name: 'find_files',
          args: { pattern },
          output: result.slice(0, 3000),
        });
        return result;
      },
    });

    // 2. Primary system instructions driven by user configuration
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

    try {
      // 3. DeepSeek Reasoner & Thinking Mode Compatibility Layer
      let accumulatedReasoningContent = '';

      const customFetch: typeof fetch = async (input, init) => {
        if (init && init.body && typeof init.body === 'string') {
          try {
            const parsedBody = JSON.parse(init.body);
            if (Array.isArray(parsedBody.messages)) {
              parsedBody.messages.forEach((msg: any) => {
                if (msg.role === 'assistant' && msg.reasoning_content === undefined) {
                  msg.reasoning_content = accumulatedReasoningContent || '';
                }
              });
              init.body = JSON.stringify(parsedBody);
            }
          } catch {}
        }
        return await fetch(input, init);
      };

      const openaiClient = new OpenAI({
        apiKey: apiKey || 'dummy-key-for-ollama',
        baseURL: baseUrl,
        timeout: Math.max(10000, Math.min(120000, (config?.timeoutSeconds || 35) * 1000)),
        maxRetries: config?.maxRetries !== undefined ? Math.max(0, Math.min(5, config.maxRetries)) : 2,
        fetch: customFetch,
      });

      const model = new OpenAIChatCompletionsModel(openaiClient, modelName || 'deepseek-chat');

      // 4. Instantiate Official Agent
      const agent = new Agent({
        name: 'CodexDiffReviewer',
        instructions: basePrompt,
        model,
        tools: [readFileTool, searchCodeTool, findFilesTool],
      });

      const maxTurns = Math.max(1, Math.min(15, config?.maxExplorationTurns || 5));
      const runner = new Runner({
        tracingDisabled: true,
      });

      res.write(
        `data: ${JSON.stringify({
          type: 'status',
          phase: 'thinking',
          message: '智能体正在分析 Diff 语义并自主决定探查路径...',
          step: 1,
        })}\n\n`
      );

      let producedReport = false;
      let actionCount = 0;

      // 5. Execute Official Streamed Runner Loop
      try {
        const streamedResult = await runner.run(agent, initialUserMsg, {
          stream: true,
          maxTurns,
        });

        for await (const event of streamedResult) {
          if (event.type === 'run_item_stream_event') {
            const itemEvent = event as RunItemStreamEvent;
            const item: any = itemEvent.item;

            if (itemEvent.name === 'tool_called') {
              actionCount++;
              const toolCallId = item.callId || `call_${Date.now()}_${actionCount}`;
              const toolName = item.toolName || item.name || item.rawItem?.function?.name || 'read_file';
              let args: any = {};
              try {
                args =
                  typeof item.arguments === 'string'
                    ? JSON.parse(item.arguments)
                    : item.rawItem?.function?.arguments
                    ? JSON.parse(item.rawItem.function.arguments)
                    : item.arguments || {};
              } catch {
                args = item.arguments || {};
              }

              res.write(
                `data: ${JSON.stringify({
                  type: 'status',
                  phase: 'executing_tools',
                  message: `智能体调用工具: ${toolName} 探查代码库...`,
                  step: actionCount,
                })}\n\n`
              );

              res.write(
                `data: ${JSON.stringify({
                  type: 'tool_call',
                  id: toolCallId,
                  name: toolName,
                  args,
                })}\n\n`
              );
            } else if (itemEvent.name === 'tool_output') {
              const toolCallId = item.callId || `call_${Date.now()}`;
              const toolName = item.toolName || item.name || 'tool';
              const outputStr = typeof item.output === 'string' ? item.output : JSON.stringify(item.output);

              res.write(
                `data: ${JSON.stringify({
                  type: 'tool_result',
                  id: toolCallId,
                  name: toolName,
                  summary: `${toolName}(...)`,
                  output: outputStr.slice(0, 450) + (outputStr.length > 450 ? '...' : ''),
                })}\n\n`
              );
            }
          } else if (event.type === 'raw_model_stream_event') {
            if (isOpenAIChatCompletionsRawModelStreamEvent(event)) {
              const delta = event.data.event.choices?.[0]?.delta as any;
              if (delta?.reasoning_content) {
                accumulatedReasoningContent += delta.reasoning_content;
                res.write(
                  `data: ${JSON.stringify({
                    type: 'status',
                    phase: 'thinking',
                    message: `🧠 思考中: ${accumulatedReasoningContent.slice(-80).replace(/\n/g, ' ')}...`,
                  })}\n\n`
                );
              }
              if (delta?.content) {
                producedReport = true;
                res.write(`data: ${JSON.stringify({ type: 'chunk', text: delta.content })}\n\n`);
              }
            }
          }
        }
      } catch (runErr: any) {
        // If max turns exceeded, do NOT fail! Seamlessly transition to Synthesis Phase!
        const isMaxTurns =
          runErr instanceof MaxTurnsExceededError ||
          runErr.name === 'MaxTurnsExceededError' ||
          runErr.message?.includes('Max turns');

        if (!isMaxTurns) {
          throw runErr;
        }
      }

      // 6. Guaranteed Synthesis Phase if report was not produced during the loop
      if (!producedReport) {
        res.write(
          `data: ${JSON.stringify({
            type: 'status',
            phase: 'reporting',
            message: `代码探查就绪 (共获取 ${explorationLog.length} 处关键上下文)，正在实时生成最终审查报告...`,
          })}\n\n`
        );

        const synthesisMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          { role: 'system', content: basePrompt },
          { role: 'user', content: initialUserMsg },
        ];

        if (explorationLog.length > 0) {
          const contextSummary = explorationLog
            .map(
              (log, idx) =>
                `【探查结果 #${idx + 1} (${log.name} 参数: ${JSON.stringify(log.args)})】:\n${log.output}`
            )
            .join('\n\n');

          synthesisMessages.push({
            role: 'user',
            content: `【探查阶段结束】已在代码库中检索到以下关联上下文：\n\n${contextSummary}\n\n请根据上述探查到的全部代码上下文与修改差异，按照设定的审查规则，直接输出最终完整的 Markdown 代码审查报告。`,
          });
        } else {
          synthesisMessages.push({
            role: 'user',
            content:
              '【探查阶段结束】请根据上述代码修改差异，按照设定的审查规则，直接输出最终完整的 Markdown 代码审查报告。',
          });
        }

        const synthesisStream = await openaiClient.chat.completions.create({
          model: modelName || 'deepseek-chat',
          messages: synthesisMessages,
          stream: true,
        });

        for await (const chunk of synthesisStream) {
          const deltaContent = chunk.choices?.[0]?.delta?.content || '';
          if (deltaContent) {
            res.write(`data: ${JSON.stringify({ type: 'chunk', text: deltaContent })}\n\n`);
          }
        }
      }

      res.write(
        `data: ${JSON.stringify({
          type: 'status',
          phase: 'completed',
          message: 'Codex 智能体审查已完成',
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
          text: `\n\n❌ **智能体引擎异常**: ${err.message}\n> 💡 建议：可点击右上角重新生成，或在顶部切换为「⚡ 直接 Diff 解释」快速模式。`,
        })}\n\n`
      );
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      cleanup();
      res.end();
    }
  }
}

export const agentEngine = new CodexAgentEngine();
