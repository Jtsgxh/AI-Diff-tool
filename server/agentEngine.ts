import type { Response } from 'express';
import OpenAI from 'openai';
import { Agent, Runner, tool, RunItemStreamEvent, MaxTurnsExceededError } from '@openai/agents';
import {
  OpenAIChatCompletionsModel,
  isOpenAIChatCompletionsRawModelStreamEvent,
} from '@openai/agents-openai';
import { z } from 'zod';
import { AgentTools } from './agentTools';
import {
  extractReasoningDelta,
  FALLBACK_MODEL,
  MISSING_API_KEY_MESSAGE,
  openRouterHeaders,
  resolveProvider,
} from './config/providers';
import { SseStream } from './http/sse';
import {
  buildAgentSystemPrompt,
  buildAgentUserMessage,
  buildSynthesisPrompt,
  type ExplorationEntry,
} from './prompts';
import type { AgentExplainRequest, PartialAIProviderConfig } from '../shared/types';

export type AgentExecutionConfig = PartialAIProviderConfig;
export type AgentExplainOptions = AgentExplainRequest;

/** How much of each tool result is retained for the synthesis fallback. */
const TOOL_OUTPUT_LOG_LIMIT = 8000;
/** How much of each tool result is mirrored to the UI trail. */
const TOOL_OUTPUT_UI_LIMIT = 450;
/** Below this length the run is treated as having produced no real report. */
const SUBSTANTIAL_REPORT_MIN_CHARS = 50;

const TIMEOUT_BOUNDS_MS = { min: 10_000, max: 120_000, default: 45_000 };
const RETRY_BOUNDS = { min: 0, max: 5, default: 2 };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * "Agent mode": an autonomous ReAct loop over a read-only, git-indexed view of
 * the repository, streamed to the browser as status / tool / token events.
 */
export class CodexAgentEngine {
  async streamAgentExplain(options: AgentExplainOptions, res: Response): Promise<void> {
    const { repoPath, config } = options;
    const stream = new SseStream(res);
    const provider = resolveProvider(config);

    if (!provider.apiKey && provider.requiresApiKey) {
      stream.send({ type: 'chunk', text: MISSING_API_KEY_MESSAGE });
      stream.send({ type: 'done' });
      stream.close();
      return;
    }

    stream.send({
      type: 'status',
      phase: 'initializing',
      message:
        'OpenAI Agents 官方智能体引擎已启动，已挂载 Git 索引沙箱 (Codex 完全自主规划模式)...',
    });

    // Runtime knobs exposed by the settings modal now actually reach the tools.
    const toolsInstance = new AgentTools(repoPath, {
      maxReadFileLines: config?.maxReadFileLines,
      maxSearchResults: config?.maxSearchResults,
    });
    const explorationLog: ExplorationEntry[] = [];

    /** Wraps a repo tool so every call is mirrored into the synthesis log. */
    const withLogging =
      <A extends Record<string, unknown>>(name: string) =>
      async (args: A): Promise<string> => {
        const result = await toolsInstance.executeTool(name, args);
        explorationLog.push({ name, args, output: result.slice(0, TOOL_OUTPUT_LOG_LIMIT) });
        return result;
      };

    const readFileTool = tool({
      name: 'read_file',
      description:
        '读取当前代码库中指定文件的源代码内容。在分析 Diff 中涉及的外部类、接口或调用逻辑时使用。',
      parameters: z.object({
        file_path: z.string().describe('相对于仓库根目录的文件路径 (例如: "src/Actors/Actor.cs")'),
        start_line: z.number().optional().describe('起始行号 (可选，从 1 开始)'),
        end_line: z.number().optional().describe('结束行号 (可选)'),
      }),
      execute: withLogging('read_file'),
    });

    const searchCodeTool = tool({
      name: 'search_code',
      description:
        '在整个代码库中利用 Git 索引全局检索符号引用、下游调用方或类/函数定义（支持正则表达式）。',
      parameters: z.object({
        query: z.string().describe('搜索词或正则 (例如: "DerivedAttributeSet" 或 "class\\s+Player")'),
        file_extension: z
          .string()
          .optional()
          .describe('限制文件扩展名过滤 (可选，例如: "*.cs" 或 "*.ts")'),
      }),
      execute: withLogging('search_code'),
    });

    const findFilesTool = tool({
      name: 'find_files',
      description:
        '根据文件名模式通过 Git 索引快速定位文件路径，用于定位同名测试、接口契约或配置文件。',
      parameters: z.object({
        pattern: z.string().describe('匹配模式 (例如: "*AttributeSet*" 或 "*Test*.cs")'),
      }),
      execute: withLogging('find_files'),
    });

    const isFollowUp = Boolean(options.userPrompt && options.userPrompt.trim());
    const systemPrompt = buildAgentSystemPrompt(options);
    const initialUserMsg = buildAgentUserMessage(options);

    try {
      // DeepSeek's reasoner rejects assistant turns that lack `reasoning_content`
      // on subsequent tool-loop requests, so replay what we have seen so far.
      // Strictly scoped to that model: other providers reject the extra field.
      let accumulatedReasoningContent = '';
      const isNativeDeepSeekReasoner =
        (provider.provider === 'deepseek' || provider.baseUrl.includes('deepseek.com')) &&
        (provider.model || '').toLowerCase().includes('reasoner');

      const customFetch: typeof fetch = async (input, init) => {
        if (isNativeDeepSeekReasoner && typeof init?.body === 'string') {
          try {
            const parsedBody = JSON.parse(init.body);
            if (Array.isArray(parsedBody.messages)) {
              for (const msg of parsedBody.messages) {
                if (msg.role === 'assistant' && msg.reasoning_content === undefined) {
                  msg.reasoning_content = accumulatedReasoningContent || '';
                }
              }
              init = { ...init, body: JSON.stringify(parsedBody) };
            }
          } catch {
            // Leave the body untouched if it is not the JSON we expected.
          }
        }
        // Propagate client disconnects down to the provider connection.
        return fetch(input, { ...init, signal: init?.signal ?? stream.signal });
      };

      const openaiClient = new OpenAI({
        apiKey: provider.apiKey || 'dummy-key-for-ollama',
        baseURL: provider.baseUrl,
        timeout: clamp(
          (config?.timeoutSeconds ?? TIMEOUT_BOUNDS_MS.default / 1000) * 1000,
          TIMEOUT_BOUNDS_MS.min,
          TIMEOUT_BOUNDS_MS.max
        ),
        maxRetries:
          config?.maxRetries !== undefined
            ? clamp(config.maxRetries, RETRY_BOUNDS.min, RETRY_BOUNDS.max)
            : RETRY_BOUNDS.default,
        defaultHeaders: provider.isOpenRouter ? openRouterHeaders() : undefined,
        fetch: customFetch,
      });

      const model = new OpenAIChatCompletionsModel(openaiClient, provider.model || FALLBACK_MODEL);

      const agent = new Agent({
        name: 'AutonomousCodexReviewer',
        instructions: systemPrompt,
        model,
        tools: [readFileTool, searchCodeTool, findFilesTool],
      });

      // 0 or unset means full autonomy: no turn ceiling at all.
      const configuredTurns = config?.maxExplorationTurns;
      const maxTurns = configuredTurns === 0 || configuredTurns === undefined ? undefined : configuredTurns;

      const runner = new Runner({ tracingDisabled: true });

      stream.send({
        type: 'status',
        phase: 'thinking',
        message: 'Codex 智能体已接管：正在自主规划代码探查与分析路径...',
        step: 1,
      });

      let accumulatedContent = '';
      let actionCount = 0;

      try {
        const streamedResult = await runner.run(agent, initialUserMsg, {
          stream: true,
          maxTurns,
        });

        for await (const event of streamedResult) {
          if (stream.isClosed) break;

          if (event.type === 'run_item_stream_event') {
            const itemEvent = event as RunItemStreamEvent;
            const item: any = itemEvent.item;

            if (itemEvent.name === 'tool_called') {
              actionCount++;
              const toolCallId = item.callId || `call_${Date.now()}_${actionCount}`;
              const toolName =
                item.toolName || item.name || item.rawItem?.function?.name || 'read_file';

              stream.send({
                type: 'status',
                phase: 'executing_tools',
                message: `Codex 自主探查 [${actionCount}]: 调用 ${toolName} 查阅代码库...`,
                step: actionCount,
              });
              stream.send({
                type: 'tool_call',
                id: toolCallId,
                name: toolName,
                args: parseToolArgs(item),
              });
            } else if (itemEvent.name === 'tool_output') {
              const toolCallId = item.callId || `call_${Date.now()}`;
              const toolName = item.toolName || item.name || 'tool';
              const outputStr =
                typeof item.output === 'string' ? item.output : JSON.stringify(item.output);

              stream.send({
                type: 'tool_result',
                id: toolCallId,
                name: toolName,
                summary: `${toolName}(...)`,
                output:
                  outputStr.slice(0, TOOL_OUTPUT_UI_LIMIT) +
                  (outputStr.length > TOOL_OUTPUT_UI_LIMIT ? '...' : ''),
              });
            } else if (isAssistantMessageEvent(itemEvent, item)) {
              const msgContent = extractMessageContent(item);
              if (msgContent && !accumulatedContent.includes(msgContent)) {
                accumulatedContent += msgContent;
                stream.send({ type: 'chunk', text: msgContent });
              }
            }
          } else if (
            event.type === 'raw_model_stream_event' &&
            isOpenAIChatCompletionsRawModelStreamEvent(event)
          ) {
            const delta = event.data.event.choices?.[0]?.delta as any;
            const reasoningChunk = extractReasoningDelta(delta);

            if (reasoningChunk) {
              accumulatedReasoningContent += reasoningChunk;
              stream.send({ type: 'thought', text: reasoningChunk });
              stream.send({
                type: 'status',
                phase: 'thinking',
                message: `🧠 深度思考中: ${accumulatedReasoningContent
                  .slice(-80)
                  .replace(/\n/g, ' ')}...`,
              });
            }
            if (delta?.content) {
              accumulatedContent += delta.content;
              stream.send({ type: 'chunk', text: delta.content });
            }
          }
        }
      } catch (runErr: any) {
        // Hitting the turn ceiling is a normal stop condition: fall through to
        // synthesis so the user still gets a report.
        const isMaxTurns =
          runErr instanceof MaxTurnsExceededError ||
          runErr.name === 'MaxTurnsExceededError' ||
          runErr.message?.includes('Max turns');

        if (!isMaxTurns) throw runErr;
      }

      const hasSubstantialReport =
        accumulatedContent.trim().length > SUBSTANTIAL_REPORT_MIN_CHARS;

      if (!hasSubstantialReport && !stream.isClosed) {
        await this.streamSynthesis({
          stream,
          openaiClient,
          model: provider.model || FALLBACK_MODEL,
          systemPrompt,
          initialUserMsg,
          explorationLog,
          userPrompt: options.userPrompt,
          isFollowUp,
          hasPartialContent: accumulatedContent.length > 0,
          onReasoning: (chunk) => {
            accumulatedReasoningContent += chunk;
          },
        });
      }

      stream.send({ type: 'status', phase: 'completed', message: 'Codex 智能体审查已完成' });
      stream.send({ type: 'done' });
      stream.close();
    } catch (err: any) {
      if (err?.name !== 'AbortError' && !stream.isClosed) {
        stream.send({
          type: 'status',
          phase: 'completed',
          message: `执行中断: ${err.message}`,
        });
        stream.send({
          type: 'chunk',
          text: `\n\n❌ **智能体引擎异常**: ${err.message}\n> 💡 建议：可点击右上角重新生成，或在顶部切换为「⚡ 直接 Diff 解释」快速模式。`,
        });
        stream.send({ type: 'done' });
      }
      stream.close();
    }
  }

  /**
   * Fallback pass: the agent loop ended without a report (it exhausted its
   * turns, or the provider only emitted tool calls). Replay the exploration
   * results into a plain completion so the user always gets an answer.
   */
  private async streamSynthesis(params: {
    stream: SseStream;
    openaiClient: OpenAI;
    model: string;
    systemPrompt: string;
    initialUserMsg: string;
    explorationLog: ExplorationEntry[];
    userPrompt?: string;
    isFollowUp: boolean;
    hasPartialContent: boolean;
    onReasoning: (chunk: string) => void;
  }): Promise<void> {
    const { stream, openaiClient, model, explorationLog } = params;

    stream.send({
      type: 'status',
      phase: 'reporting',
      message: `Codex 探查收敛完成 (共获取 ${explorationLog.length} 处关键上下文)，正在实时流式输出${
        params.isFollowUp ? '追问解答' : '深度审查报告'
      }...`,
    });

    if (params.hasPartialContent) {
      stream.send({ type: 'chunk', text: '\n\n---\n\n' });
    }

    try {
      const synthesisStream = await openaiClient.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: params.initialUserMsg },
            { role: 'user', content: buildSynthesisPrompt(explorationLog, params.userPrompt) },
          ],
          stream: true,
        },
        { signal: stream.signal }
      );

      for await (const chunk of synthesisStream) {
        if (stream.isClosed) break;

        const delta = chunk.choices?.[0]?.delta as any;
        const reasoningChunk = extractReasoningDelta(delta);
        if (reasoningChunk) {
          params.onReasoning(reasoningChunk);
          stream.send({ type: 'thought', text: reasoningChunk });
        }
        if (delta?.content) {
          stream.send({ type: 'chunk', text: delta.content });
        }
      }
    } catch (synthesisErr: any) {
      if (synthesisErr?.name === 'AbortError') return;
      console.error('Synthesis Stream Error:', synthesisErr);
      stream.send({ type: 'chunk', text: `\n\n❌ 综合生成异常: ${synthesisErr.message}` });
    }
  }
}

/** Tool arguments arrive either pre-parsed or as a raw JSON string. */
function parseToolArgs(item: any): unknown {
  try {
    if (typeof item.arguments === 'string') return JSON.parse(item.arguments);
    if (item.rawItem?.function?.arguments) return JSON.parse(item.rawItem.function.arguments);
    return item.arguments || {};
  } catch {
    return item.arguments || {};
  }
}

function isAssistantMessageEvent(itemEvent: RunItemStreamEvent, item: any): boolean {
  const name = itemEvent.name as string;
  return (
    name === 'message_output_created' ||
    name === 'message_output' ||
    item?.type === 'message' ||
    item?.role === 'assistant'
  );
}

function extractMessageContent(item: any): string {
  if (typeof item.content === 'string') return item.content;
  if (typeof item.formatted?.content === 'string') return item.formatted.content;
  if (Array.isArray(item.content)) return item.content.map((c: any) => c.text || '').join('');
  return '';
}

export const agentEngine = new CodexAgentEngine();
