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
  isLearnTask,
  type ExplorationEntry,
  type PromptContext,
} from './prompts';
import { buildLearnGraph, formatLearnGraphDigest } from './learnGraphBuild';
import {
  inferContextWindowTokens,
  MAX_OUTPUT_TOKENS,
  REQUEST_TIMEOUT_SECONDS,
  totalContextChars,
} from '../shared/types';
import type { AgentExplainRequest, PartialAIProviderConfig } from '../shared/types';

export type AgentExecutionConfig = PartialAIProviderConfig;
export type AgentExplainOptions = AgentExplainRequest;

/** How much of each tool result is mirrored to the UI trail. */
const TOOL_OUTPUT_UI_LIMIT = 450;

/** Wall-clock cap for one streamed model call (thinking + tokens + tools). */
const MODEL_CALL_TIMEOUT_MS = 15 * 60 * 1000;

const RETRY_BOUNDS = { min: 0, max: 5, default: 2 };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clipChars(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n…(已截断，原文 ${text.length} 字符)`;
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

    const contextTokens = inferContextWindowTokens(config ?? {});
    const contextChars = totalContextChars(contextTokens);
    const reserveChars = Math.round(contextChars * 0.18);
    let usedChars = 0;

    stream.send({
      type: 'status',
      phase: 'initializing',
      message: `OpenAI Agents 官方智能体引擎已启动，上下文 ${contextTokens.toLocaleString()} tokens（约 ${contextChars.toLocaleString()} 字符），已挂载 Git 索引沙箱...`,
    });

    // Runtime knobs exposed by the settings modal now actually reach the tools.
    const toolsInstance = new AgentTools(repoPath, {
      maxReadFileLines: config?.maxReadFileLines,
      maxSearchResults: config?.maxSearchResults,
    });
    const explorationLog: ExplorationEntry[] = [];

    /** Wraps a repo tool so every call is mirrored into the synthesis log
     *  and clipped to whatever of the context window is still free. */
    const withLogging =
      <A extends Record<string, unknown>>(name: string) =>
      async (args: A): Promise<string> => {
        const result = await toolsInstance.executeTool(name, args);
        const room = Math.max(2_000, contextChars - reserveChars - usedChars);
        const clipped = clipChars(result, room);
        usedChars += clipped.length;
        explorationLog.push({ name, args, output: clipped });
        return clipped;
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

    const repoOverviewTool = tool({
      name: 'repo_overview',
      description:
        '获取仓库骨架：文件总数、顶层目录统计、主语言、README/工程清单摘录、疑似入口文件。学习一座陌生仓库时必须先调用。',
      parameters: z.object({
        note: z.string().optional().describe('可选备注，通常留空'),
      }),
      execute: withLogging('repo_overview'),
    });

    const repoGraphTool = tool({
      name: 'repo_graph',
      description:
        '获取本地解析的代码结构图谱摘要：节点（文件/类型）、边（contains/imports/references/inherits）、社区、枢纽 God nodes、跨社区桥。学习仓库或追问调用关系时使用。',
      parameters: z.object({
        note: z.string().optional().describe('可选备注，通常留空'),
      }),
      execute: withLogging('repo_graph'),
    });

    const isFollowUp = Boolean(options.userPrompt && options.userPrompt.trim());
    let promptCtx: PromptContext = options;
    if (isLearnTask(options)) {
      try {
        stream.send({
          type: 'status',
          phase: 'initializing',
          message: '正在解析代码结构图谱（节点 / 边 / 社区）...',
        });
        const structural = await buildLearnGraph(repoPath);
        promptCtx = { ...options, graphDigest: formatLearnGraphDigest(structural) };
      } catch {
        promptCtx = options;
      }
    }
    const systemPrompt = buildAgentSystemPrompt(promptCtx);
    const initialUserMsg = buildAgentUserMessage(promptCtx);
    usedChars = systemPrompt.length + initialUserMsg.length;

    const headerTimeoutMs = clamp(
      (config?.timeoutSeconds ?? REQUEST_TIMEOUT_SECONDS.default) * 1000,
      REQUEST_TIMEOUT_SECONDS.min * 1000,
      REQUEST_TIMEOUT_SECONDS.max * 1000
    );

    let openaiClient: OpenAI | undefined;
    let accumulatedContent = '';
    let lastTurnContent = '';
    let accumulatedReasoningContent = '';
    let actionCount = 0;
    let hitMaxTurns = false;
    let outputTruncated = false;
    let synthesisStarted = false;

    // DeepSeek Reasoner requires the reasoning produced by each assistant
    // message when that message is replayed for a continuation request.
    const isNativeDeepSeekReasoner =
      (provider.provider === 'deepseek' || provider.baseUrl.includes('deepseek.com')) &&
      (provider.model || '').toLowerCase().includes('reasoner');

    try {
      // DeepSeek's reasoner rejects assistant turns that lack `reasoning_content`
      // on subsequent tool-loop requests, so replay what we have seen so far.
      // Strictly scoped to that model: other providers reject the extra field.
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

      openaiClient = new OpenAI({
        apiKey: provider.apiKey || 'dummy-key-for-ollama',
        baseURL: provider.baseUrl,
        timeout: headerTimeoutMs,
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
        tools: isLearnTask(options)
          ? [repoOverviewTool, repoGraphTool, readFileTool, searchCodeTool, findFilesTool]
          : [repoOverviewTool, readFileTool, searchCodeTool, findFilesTool],
        modelSettings: {
          maxTokens: MAX_OUTPUT_TOKENS,
          timeoutMs: MODEL_CALL_TIMEOUT_MS,
        },
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
              // A tool call starts a new turn: preamble before tools is not the report.
              lastTurnContent = '';
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
                lastTurnContent += msgContent;
                stream.send({ type: 'chunk', text: msgContent });
              }
            }
          } else if (
            event.type === 'raw_model_stream_event' &&
            isOpenAIChatCompletionsRawModelStreamEvent(event)
          ) {
            const choice = event.data.event.choices?.[0];
            const delta = choice?.delta as any;
            if (choice?.finish_reason === 'length') outputTruncated = true;
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
              lastTurnContent += delta.content;
              stream.send({ type: 'chunk', text: delta.content });
            }
          }
        }

        // The Agents SDK exposes terminal errors through `completed` as well
        // as the event iterator. Await it explicitly so a max-turn or provider
        // failure can never be mistaken for a clean end of the event stream.
        await streamedResult.completed;
      } catch (runErr: any) {
        // Hitting the turn ceiling is a normal stop condition: fall through to
        // synthesis so the user still gets a report.
        const isMaxTurns =
          runErr instanceof MaxTurnsExceededError ||
          runErr.name === 'MaxTurnsExceededError' ||
          runErr.message?.includes('Max turns');

        if (!isMaxTurns) throw runErr;
        hitMaxTurns = true;
      }

      if (
        shouldRunSynthesis(
          lastTurnContent,
          accumulatedContent,
          hitMaxTurns,
          outputTruncated,
          isFollowUp
        ) &&
        !stream.isClosed
      ) {
        synthesisStarted = true;
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
          contextChars,
          truncatedDraft: outputTruncated ? lastTurnContent || accumulatedContent : undefined,
          preserveReasoningOnAssistant: isNativeDeepSeekReasoner,
          onReasoning: (chunk) => {
            accumulatedReasoningContent += chunk;
          },
        });
      }

      stream.send({ type: 'status', phase: 'completed', message: 'Codex 智能体审查已完成' });
      stream.send({ type: 'done' });
      stream.close();
    } catch (err: any) {
      if (isClientGone(err, stream)) {
        stream.close();
        return;
      }

      // Recover a usable report from whatever the loop already gathered.
      if (
        openaiClient &&
        explorationLog.length > 0 &&
        (synthesisStarted || !looksLikeCompleteReport(lastTurnContent || accumulatedContent))
      ) {
        try {
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
            contextChars,
            truncatedDraft: lastTurnContent || accumulatedContent || undefined,
            preserveReasoningOnAssistant: isNativeDeepSeekReasoner,
            onReasoning: (chunk) => {
              accumulatedReasoningContent += chunk;
            },
          });
          stream.send({ type: 'status', phase: 'completed', message: 'Codex 智能体审查已完成（中断后已补全）' });
          stream.send({ type: 'done' });
          stream.close();
          return;
        } catch (synthErr: any) {
          if (isClientGone(synthErr, stream)) {
            stream.close();
            return;
          }
        }
      }

      if (!stream.isClosed) {
        stream.send({
          type: 'status',
          phase: 'completed',
          message: `执行中断: ${err.message}`,
        });
        stream.send({
          type: 'chunk',
          text: `\n\n❌ **智能体引擎异常**: ${err.message}\n> 💡 建议：可点击右上角重新生成，或在顶部切换为「⚡ 直接 Diff 解释」快速模式。`,
        });
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
    contextChars: number;
    truncatedDraft?: string;
    preserveReasoningOnAssistant: boolean;
    onReasoning: (chunk: string) => void;
  }): Promise<void> {
    const { stream, openaiClient, model, explorationLog, contextChars } = params;

    stream.send({
      type: 'status',
      phase: 'reporting',
      message: params.truncatedDraft
        ? `终审报告不完整，正在补全（已探查 ${explorationLog.length} 处上下文）...`
        : `Codex 探查收敛完成 (共获取 ${explorationLog.length} 处关键上下文)，正在实时流式输出${
            params.isFollowUp ? '追问解答' : '深度审查报告'
          }...`,
    });

    if (params.hasPartialContent) {
      stream.send({ type: 'chunk', text: '\n\n---\n\n' });
    }

    const messages: any[] = [
      { role: 'system', content: params.systemPrompt },
      {
        role: 'user',
        content: clipChars(params.initialUserMsg, Math.round(contextChars * 0.35)),
      },
      {
        role: 'user',
        content: clipChars(
          buildSynthesisPrompt(explorationLog, params.userPrompt, {
            truncatedDraft: params.truncatedDraft
              ? clipChars(params.truncatedDraft, 6_000)
              : undefined,
          }),
          Math.round(contextChars * 0.4)
        ),
      },
    ];

    while (!stream.isClosed) {
      let passText = '';
      let passReasoning = '';
      let finishReason: string | null = null;

      const synthesisStream = await openaiClient.chat.completions.create(
        {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages,
          stream: true,
        },
        { signal: stream.signal }
      );

      for await (const chunk of synthesisStream) {
        if (stream.isClosed) return;

        const choice = chunk.choices?.[0];
        const delta = choice?.delta as any;
        if (choice?.finish_reason) finishReason = choice.finish_reason;

        const reasoningChunk = extractReasoningDelta(delta);
        if (reasoningChunk) {
          passReasoning += reasoningChunk;
          params.onReasoning(reasoningChunk);
          stream.send({ type: 'thought', text: reasoningChunk });
        }
        if (delta?.content) {
          passText += delta.content;
          stream.send({ type: 'chunk', text: delta.content });
        }
      }

      if (finishReason === 'length') {
        if (!passText && !passReasoning) {
          throw new Error('综合输出达到单次长度上限，但没有返回可继续的内容');
        }

        const assistantMessage: any = { role: 'assistant', content: passText };
        if (params.preserveReasoningOnAssistant) {
          assistantMessage.reasoning_content = passReasoning;
        }
        messages.push(assistantMessage, {
          role: 'user',
          content: passText
            ? '上一条回复因单次输出长度限制被截断。只从中断处继续输出剩余正文，不要重复已经输出的内容。'
            : '上一条只完成了推理但尚未输出正文。现在直接输出最终报告正文，不要重新展开推理过程。',
        });

        stream.send({
          type: 'status',
          phase: 'reporting',
          message: '单次输出达到模型长度上限，正在从中断处自动续写...',
        });
        continue;
      }

      if (!finishReason) {
        throw new Error('综合生成流未返回结束原因，无法确认报告是否完整');
      }
      if (finishReason !== 'stop') {
        throw new Error(`综合生成以非正常原因结束: ${finishReason}`);
      }
      if (!passText.trim()) {
        throw new Error('综合生成已结束，但没有输出报告正文');
      }
      return;
    }
  }
}

/**
 * A complete review has structure (headings) and length. A 50-character
 * "我先搜索一下调用方…" preamble used to skip synthesis, which is why
 * reviews appeared to stop halfway after the tool loop.
 */
function looksLikeCompleteReport(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 400) return false;
  const headings = trimmed.match(/^#{1,3}\s/gm)?.length ?? 0;
  if (headings >= 2) return true;
  if (trimmed.includes('###') && trimmed.length >= 500) return true;
  return trimmed.length >= 1200;
}

function shouldRunSynthesis(
  lastTurn: string,
  accumulated: string,
  hitMaxTurns: boolean,
  outputTruncated: boolean,
  isFollowUp: boolean
): boolean {
  if (hitMaxTurns || outputTruncated) return true;
  const text = (lastTurn || accumulated).trim();
  // Follow-ups are often a short, complete answer after tools — don't
  // rewrite them. Initial reviews must look like a structured report.
  if (isFollowUp) return text.length < 80;
  return !looksLikeCompleteReport(text);
}

function isClientGone(_err: unknown, stream: SseStream): boolean {
  return stream.isClosed || stream.signal.aborted;
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
