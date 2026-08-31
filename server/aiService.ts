import type { Response } from 'express';
import {
  chatCompletionsUrl,
  extractReasoningDelta,
  MISSING_API_KEY_MESSAGE,
  openRouterHeaders,
  resolveProvider,
} from './config/providers';
import { readSseJson, SseStream } from './http/sse';
import { buildFastPrompts } from './prompts';
import {
  inferContextWindowTokens,
  resolveRequestTimeoutSeconds,
  totalContextChars,
} from '../shared/types';
import type { ExplainRequest, PartialAIProviderConfig } from '../shared/types';

export type { TargetLineInfo } from '../shared/types';
export type AIProviderConfig = PartialAIProviderConfig;
export type ExplainOptions = ExplainRequest;

const MAX_CONTINUATION_PASSES = 4;

function clipTail(text: string, limit: number): string {
  if (limit <= 0) return '';
  if (text.length <= limit) return text;
  const marker = '…(仅保留上一段末尾以便续写)…\n';
  if (limit <= marker.length) return text.slice(-Math.max(0, limit));
  return `${marker}${text.slice(-(limit - marker.length))}`;
}

/**
 * "Fast mode": a bounded series of chat-completions calls, relaying tokens
 * to the browser and continuing only when the provider reports truncation.
 */
export class AIService {
  async streamExplainDiff(options: ExplainOptions, res: Response): Promise<void> {
    const stream = new SseStream(res);
    const provider = resolveProvider(options.config);
    const modelCallTimeoutMs = resolveRequestTimeoutSeconds(options.config?.timeoutSeconds) * 1000;

    if (!provider.apiKey && provider.requiresApiKey) {
      stream.send({ error: MISSING_API_KEY_MESSAGE });
      stream.close();
      return;
    }

    try {
      const { system, user } = buildFastPrompts(options);
      const messages: any[] = [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ];
      const continuationBaseLength = messages.length;
      const contextChars = totalContextChars(inferContextWindowTokens(options.config ?? {}));
      const preserveReasoning =
        (provider.provider === 'deepseek' || provider.baseUrl.includes('deepseek.com')) &&
        provider.model.toLowerCase().includes('reasoner');

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
      if (provider.isOpenRouter) Object.assign(headers, openRouterHeaders());

      for (let pass = 1; pass <= MAX_CONTINUATION_PASSES && !stream.isClosed; pass++) {
        let passText = '';
        let passReasoning = '';
        let finishReason: string | null = null;
        const timeoutSignal = AbortSignal.timeout(modelCallTimeoutMs);
        const callSignal = AbortSignal.any([stream.signal, timeoutSignal]);

        try {
          const response = await fetch(chatCompletionsUrl(provider.baseUrl), {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: provider.model,
              messages,
              stream: true,
            }),
            // Stop pulling tokens once the browser is gone or this individual
            // model call exceeds the configured wall-clock limit.
            signal: callSignal,
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `大模型接口请求失败 (${response.status}): ${errorText}\n请检查 API Key、Base URL 与模型名称。`
            );
          }
          if (!response.body) throw new Error('未收到模型服务端的流式响应');

          for await (const parsed of readSseJson(response.body, callSignal)) {
            if (stream.isClosed) return;

            const choice = parsed.choices?.[0];
            const delta = choice?.delta;
            if (choice?.finish_reason) finishReason = choice.finish_reason;

            const reasoning = extractReasoningDelta(delta);
            if (reasoning) {
              passReasoning += reasoning;
              stream.send({ reasoning });
            }

            const text = delta?.content;
            if (text) {
              passText += text;
              stream.send({ text });
            }
          }
        } catch (err) {
          if (timeoutSignal.aborted && !stream.signal.aborted) {
            throw new Error(`单次模型调用超过 ${Math.ceil(modelCallTimeoutMs / 1000)} 秒`);
          }
          throw err;
        }
        if (timeoutSignal.aborted && !stream.signal.aborted) {
          throw new Error(`单次模型调用超过 ${Math.ceil(modelCallTimeoutMs / 1000)} 秒`);
        }

        if (finishReason === 'length') {
          if (!passText && !passReasoning) {
            throw new Error('模型达到单次输出长度限制，但没有返回可续写内容');
          }
          if (pass === MAX_CONTINUATION_PASSES) {
            throw new Error(`模型连续 ${MAX_CONTINUATION_PASSES} 次达到长度上限，已停止自动续写`);
          }
          const assistant: any = {
            role: 'assistant',
            content: clipTail(passText, Math.max(1000, Math.round(contextChars * 0.06))),
          };
          if (preserveReasoning) {
            assistant.reasoning_content = clipTail(
              passReasoning,
              Math.max(500, Math.round(contextChars * 0.02))
            );
          }
          messages.splice(continuationBaseLength, messages.length - continuationBaseLength, assistant, {
            role: 'user',
            content: passText
              ? '上一条回复因单次输出长度限制被截断。只从中断处继续，不要重复已输出内容。'
              : '上一条只完成了推理。现在直接输出最终正文。',
          });
          continue;
        }
        if (!finishReason) throw new Error('模型流未返回结束原因，无法确认内容是否完整');
        if (finishReason !== 'stop') {
          throw new Error(`模型以非正常原因结束: ${finishReason}`);
        }
        if (!passText.trim()) throw new Error('模型已结束，但没有输出正文');

        stream.sendRaw('[DONE]');
        stream.close();
        return;
      }
    } catch (err: any) {
      // A client-initiated abort is expected teardown, not a failure to report.
      if (err?.name !== 'AbortError' && !stream.isClosed) {
        stream.send({ error: `请求失败: ${err.message}` });
      }
      stream.close();
    }
  }
}

export const aiService = new AIService();
