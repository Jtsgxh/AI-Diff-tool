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
import { MAX_OUTPUT_TOKENS } from '../shared/types';
import type { ExplainRequest, PartialAIProviderConfig } from '../shared/types';

export type { TargetLineInfo } from '../shared/types';
export type AIProviderConfig = PartialAIProviderConfig;
export type ExplainOptions = ExplainRequest;

/**
 * "Fast mode": a single pass straight through to the provider's
 * chat-completions endpoint, relaying tokens to the browser as they arrive.
 */
export class AIService {
  async streamExplainDiff(options: ExplainOptions, res: Response): Promise<void> {
    const stream = new SseStream(res);
    const provider = resolveProvider(options.config);

    if (!provider.apiKey && provider.requiresApiKey) {
      stream.send({ text: MISSING_API_KEY_MESSAGE });
      stream.sendRaw('[DONE]');
      stream.close();
      return;
    }

    try {
      const { system, user } = buildFastPrompts(options);

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
      if (provider.isOpenRouter) Object.assign(headers, openRouterHeaders());

      const response = await fetch(chatCompletionsUrl(provider.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          stream: true,
          max_tokens: MAX_OUTPUT_TOKENS,
        }),
        // Stop pulling tokens once the browser is gone. Closing the drawer
        // does NOT do this — the drawer stays mounted and its reviews keep
        // streaming in the background. This fires when the client itself
        // aborts: a review tab closed, a re-run superseding this request, or
        // the page navigating away.
        signal: stream.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        stream.send({
          text: `### ❌ 大模型接口请求失败 (${response.status})\n\`\`\`\n${errorText}\n\`\`\`\n> 请在右上角 **「⚙️ AI 引擎配置」** 中检查您的 API Key、Base URL 与模型名称是否正确。`,
        });
        stream.sendRaw('[DONE]');
        stream.close();
        return;
      }

      if (!response.body) {
        stream.send({ text: '❌ 未收到模型服务端的流式响应，请重试。' });
        stream.sendRaw('[DONE]');
        stream.close();
        return;
      }

      for await (const parsed of readSseJson(response.body, stream.signal)) {
        if (stream.isClosed) break;

        const delta = parsed.choices?.[0]?.delta;
        const reasoning = extractReasoningDelta(delta);
        if (reasoning) stream.send({ reasoning });

        const text = delta?.content;
        if (text) stream.send({ text });
      }

      stream.sendRaw('[DONE]');
      stream.close();
    } catch (err: any) {
      // A client-initiated abort is expected teardown, not a failure to report.
      if (err?.name !== 'AbortError' && !stream.isClosed) {
        stream.send({
          text: `\n\n❌ **请求连接失败**: ${err.message}\n请检查您的网络连接或 Base URL 是否有效。`,
        });
        stream.sendRaw('[DONE]');
      }
      stream.close();
    }
  }
}

export const aiService = new AIService();
