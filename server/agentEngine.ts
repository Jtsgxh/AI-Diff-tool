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
  requiresDeepSeekReasoningRoundTrip,
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
  resolveRequestTimeoutSeconds,
  totalContextChars,
} from '../shared/types';
import type { AgentExplainRequest, PartialAIProviderConfig } from '../shared/types';
import { parseLearnAnalysisEnvelope } from '../shared/learnGraphSchema';

export type AgentExecutionConfig = PartialAIProviderConfig;
export type AgentExplainOptions = AgentExplainRequest;

const RETRY_DEFAULT = 2;
const TOOL_CONTEXT_FRACTION = 0.9;
const SYNTHESIS_INPUT_FRACTION = 0.8;
const MAX_SYNTHESIS_PASSES = 4;

function nonNegativeInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : fallback;
}

function clipChars(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = `\n\n…(已按模型上下文裁剪，原文 ${text.length} 字符)`;
  if (limit <= marker.length) return text.slice(0, Math.max(0, limit));
  return `${text.slice(0, limit - marker.length)}${marker}`;
}

function clipCharsBalanced(text: string, limit: number): string {
  if (limit <= 0) return '';
  if (text.length <= limit) return text;
  const marker = `\n\n…(中间内容已按模型上下文裁剪，原文 ${text.length} 字符)…\n\n`;
  if (limit <= marker.length) return text.slice(-Math.max(0, limit));
  const remaining = limit - marker.length;
  const head = Math.ceil(remaining / 2);
  return `${text.slice(0, head)}${marker}${text.slice(-(remaining - head))}`;
}

function clipCharsTail(text: string, limit: number): string {
  if (limit <= 0) return '';
  if (text.length <= limit) return text;
  const marker = `…(仅保留中断位置前的 ${limit.toLocaleString()} 字符)…\n`;
  if (limit <= marker.length) return text.slice(-Math.max(0, limit));
  return `${marker}${text.slice(-(limit - marker.length))}`;
}

function fitPairToBudget(first: string, second: string, budget: number): [string, string] {
  if (budget <= 0) return ['', ''];
  if (first.length + second.length <= budget) return [first, second];

  const total = Math.max(1, first.length + second.length);
  let firstBudget = Math.floor((budget * first.length) / total);
  let secondBudget = budget - firstBudget;

  if (first.length < firstBudget) {
    secondBudget += firstBudget - first.length;
    firstBudget = first.length;
  }
  if (second.length < secondBudget) {
    firstBudget += secondBudget - second.length;
    secondBudget = second.length;
  }

  return [clipCharsBalanced(first, firstBudget), clipCharsBalanced(second, secondBudget)];
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
    const modelCallTimeoutSeconds = resolveRequestTimeoutSeconds(config?.timeoutSeconds);
    const modelCallTimeoutMs = modelCallTimeoutSeconds * 1000;

    if (!provider.apiKey && provider.requiresApiKey) {
      stream.send({ type: 'error', message: MISSING_API_KEY_MESSAGE });
      stream.close();
      return;
    }

    const contextTokens = inferContextWindowTokens(config ?? {});
    const contextChars = totalContextChars(contextTokens);
    const reserveChars = Math.round(contextChars * (1 - TOOL_CONTEXT_FRACTION));
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
        const room = Math.max(0, contextChars - reserveChars - usedChars);
        const clipped = room > 0
          ? clipChars(result, room)
          : '模型上下文预算已用完。请停止扩大探查范围，基于已取得的证据输出报告。';
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
      timeoutMs: modelCallTimeoutMs,
      timeoutBehavior: 'raise_exception',
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
        offset: z.number().optional().describe('结果翻页偏移量；工具提示有下一页时使用'),
        max_results: z.number().optional().describe('本次需要的结果数；不填则使用设置页默认值'),
      }),
      timeoutMs: modelCallTimeoutMs,
      timeoutBehavior: 'raise_exception',
      execute: withLogging('search_code'),
    });

    const findFilesTool = tool({
      name: 'find_files',
      description:
        '根据文件名模式通过 Git 索引快速定位文件路径，用于定位同名测试、接口契约或配置文件。',
      parameters: z.object({
        pattern: z.string().describe('匹配模式 (例如: "*AttributeSet*" 或 "*Test*.cs")'),
        offset: z.number().optional().describe('结果翻页偏移量；工具提示有下一页时使用'),
        max_results: z.number().optional().describe('本次需要的结果数；不填则使用设置页默认值'),
      }),
      timeoutMs: modelCallTimeoutMs,
      timeoutBehavior: 'raise_exception',
      execute: withLogging('find_files'),
    });

    const repoOverviewTool = tool({
      name: 'repo_overview',
      description:
        '获取仓库骨架：文件总数、顶层目录统计、主语言、README/工程清单摘录、疑似入口文件。学习一座陌生仓库时必须先调用。',
      parameters: z.object({
        note: z.string().optional().describe('可选备注，通常留空'),
      }),
      timeoutMs: modelCallTimeoutMs,
      timeoutBehavior: 'raise_exception',
      execute: withLogging('repo_overview'),
    });

    const repoGraphTool = tool({
      name: 'repo_graph',
      description:
        '获取本地解析的类级代码图谱摘要：节点（类/React 组件/职责模块，普通函数归入所属节点）、边（calls/imports/references/inherits）、社区、活动枢纽和跨社区桥。学习仓库或追问调用关系时使用。',
      parameters: z.object({
        note: z.string().optional().describe('可选备注，通常留空'),
      }),
      timeoutMs: modelCallTimeoutMs,
      timeoutBehavior: 'raise_exception',
      execute: withLogging('repo_graph'),
    });

    const isFollowUp = Boolean(options.userPrompt && options.userPrompt.trim());
    const learnTask = isLearnTask(options);
    const isLearnExpansion = learnTask && options.learnRequestMode === 'expand_graph';
    const needsLearnGraph = learnTask && (!isFollowUp || isLearnExpansion);
    let promptCtx: PromptContext = options;
    if (learnTask) {
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

    let openaiClient: OpenAI | undefined;
    let accumulatedContent = '';
    let lastTurnContent = '';
    let accumulatedReasoningContent = '';
    const completedReasoningTurns: string[] = [];
    let currentReasoningTurn = '';
    let actionCount = 0;
    let hitMaxTurns = false;
    let outputTruncated = false;
    let learnOutputStarted = false;

    const requiresReasoningRoundTrip = requiresDeepSeekReasoningRoundTrip(provider);
    const emitAssistantContent = (content: string) => {
      accumulatedContent += content;
      lastTurnContent += content;

      if (!needsLearnGraph || learnOutputStarted) {
        stream.send({ type: 'chunk', text: content });
        return;
      }
      if (hasValidLearnGraphOutput(lastTurnContent)) {
        learnOutputStarted = true;
        stream.send({ type: 'chunk', text: lastTurnContent });
      }
    };

    try {
      // The Agents SDK drops DeepSeek's `reasoning_content` from replay history.
      // Reattach the raw value captured for each completed model turn whenever
      // the next Chat Completions request still carries tools.
      const customFetch: typeof fetch = async (input, init) => {
        if (requiresReasoningRoundTrip && typeof init?.body === 'string') {
          let parsedBody: any = null;
          try {
            parsedBody = JSON.parse(init.body);
          } catch {
            // Non-JSON requests are unrelated to Chat Completions.
          }
          if (
            parsedBody &&
            Array.isArray(parsedBody.messages) &&
            Array.isArray(parsedBody.tools) &&
            parsedBody.tools.length > 0
          ) {
            let reasoningIndex = 0;
            let reasoningForTurn: string | undefined;
            let insideAssistantTurn = false;
            for (const msg of parsedBody.messages) {
              if (msg.role === 'tool') {
                insideAssistantTurn = false;
                continue;
              }
              if (msg.role !== 'assistant') continue;
              if (!insideAssistantTurn) {
                // The SDK may split one response into consecutive assistant
                // content and tool-call messages; both belong to this turn.
                reasoningForTurn = completedReasoningTurns[reasoningIndex++];
                insideAssistantTurn = true;
              }
              const reasoning = msg.reasoning_content ?? msg.reasoning ?? reasoningForTurn;
              if (typeof reasoning !== 'string') {
                throw new Error(
                  'DeepSeek thinking 工具续轮缺少上一轮 reasoning_content，已停止发送无效请求'
                );
              }
              msg.reasoning_content = reasoning;
              delete msg.reasoning;
            }
            init = { ...init, body: JSON.stringify(parsedBody) };
          }
        }
        // Propagate client disconnects down to the provider connection.
        const signal = init?.signal
          ? AbortSignal.any([init.signal, stream.signal])
          : stream.signal;
        return fetch(input, { ...init, signal });
      };

      openaiClient = new OpenAI({
        apiKey: provider.apiKey || 'dummy-key-for-ollama',
        baseURL: provider.baseUrl,
        timeout: modelCallTimeoutMs,
        maxRetries: nonNegativeInt(config?.maxRetries, RETRY_DEFAULT),
        defaultHeaders: provider.isOpenRouter ? openRouterHeaders() : undefined,
        fetch: customFetch,
      });

      const model = new OpenAIChatCompletionsModel(openaiClient, provider.model || FALLBACK_MODEL);

      const agent = new Agent({
        name: 'AutonomousCodexReviewer',
        instructions: systemPrompt,
        model,
        modelSettings: { timeoutMs: modelCallTimeoutMs },
        tools: learnTask
          ? [repoOverviewTool, repoGraphTool, readFileTool, searchCodeTool, findFilesTool]
          : [repoOverviewTool, readFileTool, searchCodeTool, findFilesTool],
      });

      // 0 or unset delegates to the SDK's finite default (currently 10 turns).
      const configuredTurns = config?.maxExplorationTurns;
      const maxTurns = typeof configuredTurns === 'number' && Number.isFinite(configuredTurns) && configuredTurns > 0
        ? Math.trunc(configuredTurns)
        : undefined;

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
              learnOutputStarted = false;
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
                output: outputStr,
              });
            } else if (isAssistantMessageEvent(itemEvent, item)) {
              const msgContent = extractMessageContent(item);
              if (msgContent && !accumulatedContent.includes(msgContent)) {
                emitAssistantContent(msgContent);
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
              currentReasoningTurn += reasoningChunk;
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
            if (requiresReasoningRoundTrip && choice?.finish_reason) {
              completedReasoningTurns.push(currentReasoningTurn);
              currentReasoningTurn = '';
            }
            if (delta?.content) {
              emitAssistantContent(delta.content);
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
          needsLearnGraph
        ) &&
        !stream.isClosed
      ) {
        const requiresLearnGraph = needsLearnGraph && !hasValidLearnGraphOutput(lastTurnContent);
        await this.streamSynthesis({
          stream,
          openaiClient,
          model: provider.model || FALLBACK_MODEL,
          systemPrompt,
          initialUserMsg,
          explorationLog,
          userPrompt: options.userPrompt,
          isFollowUp,
          isLearn: learnTask,
          isLearnExpansion,
          requiresLearnGraph,
          hasPartialContent: accumulatedContent.length > 0 && !requiresLearnGraph,
          contextChars,
          truncatedDraft: outputTruncated ? lastTurnContent || accumulatedContent : undefined,
          preserveReasoningOnAssistant: requiresReasoningRoundTrip,
          modelCallTimeoutMs,
          onReasoning: (chunk) => {
            accumulatedReasoningContent += chunk;
          },
        });
      }

      stream.send({
        type: 'status',
        phase: 'completed',
        message: isLearnExpansion
          ? '手动业务总线补图已完成'
          : learnTask ? '仓库主要业务路线分析已完成' : 'Codex 智能体审查已完成',
      });
      stream.send({ type: 'done' });
      stream.close();
    } catch (err: any) {
      if (isClientGone(err, stream)) {
        stream.close();
        return;
      }

      if (!stream.isClosed) stream.send({ type: 'error', message: `智能体引擎异常: ${err.message}` });
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
    isLearn: boolean;
    isLearnExpansion: boolean;
    requiresLearnGraph: boolean;
    hasPartialContent: boolean;
    contextChars: number;
    truncatedDraft?: string;
    preserveReasoningOnAssistant: boolean;
    modelCallTimeoutMs: number;
    onReasoning: (chunk: string) => void;
  }): Promise<void> {
    const { stream, openaiClient, model, explorationLog, contextChars } = params;

    stream.send({
      type: 'status',
      phase: 'reporting',
      message: params.truncatedDraft
        ? `${params.isLearn ? '业务路线报告' : '终审报告'}不完整，正在补全（已探查 ${explorationLog.length} 处上下文）...`
        : `Codex 探查阶段结束（已获取 ${explorationLog.length} 处上下文），正在实时流式输出${
            params.isLearnExpansion ? '业务总线补图' : params.isFollowUp ? '追问解答' : params.isLearn ? '业务路线报告' : '深度审查报告'
          }...`,
    });

    if (params.hasPartialContent) {
      stream.send({ type: 'chunk', text: '\n\n---\n\n' });
    }

    const fullSynthesisPrompt = buildSynthesisPrompt(explorationLog, params.userPrompt, {
      truncatedDraft: params.truncatedDraft,
      learnTask: params.isLearn,
      learnExpansion: params.isLearnExpansion,
    });
    const synthesisSystemPrompt = `${params.systemPrompt}

【当前为无工具的最终综合阶段】代码探查已经结束，本阶段没有任何可调用工具。只能基于用户消息和下方已经取得的探查证据生成最终回答；禁止请求继续探查，禁止用 XML、普通 JSON、<@read_file> 或其他标签模拟工具调用。证据不足时明确写入“待核实”，需要图谱输出的学习请求仍须输出合法的 learn-graph，不能用工具调用文本代替最终报告。`;
    const inputBudget = Math.round(contextChars * SYNTHESIS_INPUT_FRACTION);
    const userBudget = inputBudget - synthesisSystemPrompt.length;
    if (userBudget <= 0) {
      throw new Error('系统提示词已超过配置的模型上下文窗口');
    }
    const [initialUserContent, synthesisContent] = fitPairToBudget(
      params.initialUserMsg,
      fullSynthesisPrompt,
      userBudget
    );

    const messages: any[] = [
      { role: 'system', content: synthesisSystemPrompt },
      {
        role: 'user',
        content: initialUserContent,
      },
      {
        role: 'user',
        content: synthesisContent,
      },
    ];
    const continuationBaseLength = messages.length;
    let synthesisOutput = '';
    let learnOutputStarted = false;
    let bufferedLearnOutput = '';

    for (let pass = 1; pass <= MAX_SYNTHESIS_PASSES && !stream.isClosed; pass++) {
      let passText = '';
      let passReasoning = '';
      let finishReason: string | null = null;
      const timeoutSignal = AbortSignal.timeout(params.modelCallTimeoutMs);

      try {
        const synthesisStream = await openaiClient.chat.completions.create(
          {
            model,
            messages,
            stream: true,
          },
          { signal: AbortSignal.any([stream.signal, timeoutSignal]) }
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
            synthesisOutput += delta.content;
            if (!params.requiresLearnGraph || learnOutputStarted) {
              stream.send({ type: 'chunk', text: delta.content });
            } else {
              bufferedLearnOutput += delta.content;
              if (hasValidLearnGraphOutput(bufferedLearnOutput)) {
                learnOutputStarted = true;
                stream.send({ type: 'chunk', text: bufferedLearnOutput });
                bufferedLearnOutput = '';
              }
            }
          }
        }
      } catch (err) {
        if (timeoutSignal.aborted && !stream.signal.aborted) {
          throw new Error(
            `最终综合单次模型调用超过 ${Math.ceil(params.modelCallTimeoutMs / 1000)} 秒`
          );
        }
        throw err;
      }
      if (timeoutSignal.aborted && !stream.signal.aborted) {
        throw new Error(
          `最终综合单次模型调用超过 ${Math.ceil(params.modelCallTimeoutMs / 1000)} 秒`
        );
      }

      if (finishReason === 'length') {
        if (!passText && !passReasoning) {
          throw new Error('综合输出达到单次长度上限，但没有返回可继续的内容');
        }
        if (pass === MAX_SYNTHESIS_PASSES) {
          throw new Error(`综合输出连续 ${MAX_SYNTHESIS_PASSES} 次达到长度上限，已停止自动续写`);
        }

        const assistantMessage: any = {
          role: 'assistant',
          content: clipCharsTail(passText, Math.max(1, Math.round(contextChars * 0.06))),
        };
        if (params.preserveReasoningOnAssistant) {
          assistantMessage.reasoning_content = clipCharsTail(
            passReasoning,
            Math.max(1, Math.round(contextChars * 0.02))
          );
        }
        messages.splice(continuationBaseLength, messages.length - continuationBaseLength, assistantMessage, {
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
      if (params.requiresLearnGraph && !hasValidLearnGraphOutput(synthesisOutput)) {
        throw new Error(
          '业务路线综合生成已结束，但模型没有返回合法的 learn-graph 机器数据；已拒绝把工具调用文本当作分析结果'
        );
      }
      return;
    }
  }
}

function shouldRunSynthesis(
  lastTurn: string,
  accumulated: string,
  hitMaxTurns: boolean,
  outputTruncated: boolean,
  needsLearnGraph: boolean
): boolean {
  if (hitMaxTurns || outputTruncated) return true;
  const output = (lastTurn || accumulated).trim();
  if (!output) return true;
  return needsLearnGraph && !hasValidLearnGraphOutput(output);
}

export function hasValidLearnGraphOutput(text: string): boolean {
  const matches = text.matchAll(/```learn-graph\s*([\s\S]*?)```/gi);
  for (const match of matches) {
    try {
      if (parseLearnAnalysisEnvelope(JSON.parse(match[1].trim()))) return true;
    } catch {
      // Keep scanning in case a later fence contains the corrected payload.
    }
  }
  return false;
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
