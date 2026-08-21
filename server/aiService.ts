import { Response } from 'express';

export interface AIProviderConfig {
  provider?: 'deepseek' | 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  reviewPrompt?: string;
  fastDiffPrompt?: string;
  pseudocodePrompt?: string;
  naturalLanguagePrompt?: string;
  customSystemPrompt?: string;
  maxExplorationTurns?: number;
  timeoutSeconds?: number;
  maxRetries?: number;
  maxReadFileLines?: number;
  maxSearchResults?: number;
}

export interface TargetLineInfo {
  lineNumber?: number;
  content: string;
  type?: 'add' | 'delete' | 'normal';
}

export interface ExplainOptions {
  scopeType?: 'line' | 'chunk' | 'file' | 'commit';
  targetLine?: TargetLineInfo;
  diff: string;
  filePath?: string;
  commitMessage?: string;
  userPrompt?: string;
  config?: AIProviderConfig;
}

export class AIService {
  async streamExplainDiff(options: ExplainOptions, res: Response): Promise<void> {
    const { scopeType, targetLine, diff, filePath, commitMessage, userPrompt, config } = options;

    const provider = config?.provider || 'deepseek';
    const apiKey = config?.apiKey || process.env.AI_API_KEY || '';
    let baseUrl = config?.baseUrl || process.env.AI_BASE_URL || '';
    let model = config?.model || process.env.AI_MODEL || '';

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (!apiKey && provider !== 'ollama') {
      res.write(
        `data: ${JSON.stringify({
          text: `### ⚠️ 未检测到 API Key\n请在右上角 **「⚙️ AI 引擎配置」** 中填入您的 API Key（如 DeepSeek, OpenRouter, OpenAI, Gemini 等）以启用大模型真实解释。`,
        })}\n\n`
      );
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (!baseUrl) {
      if (provider === 'deepseek') {
        baseUrl = 'https://api.deepseek.com/v1';
        model = model || 'deepseek-chat';
      } else if (provider === 'openrouter') {
        baseUrl = 'https://openrouter.ai/api/v1';
        model = model || 'anthropic/claude-3.5-sonnet';
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

    try {
      const baseCustomPrompt =
        config?.fastDiffPrompt?.trim() ||
        config?.reviewPrompt?.trim() ||
        config?.customSystemPrompt?.trim();
      let systemPrompt = '';

      if (baseCustomPrompt) {
        systemPrompt = baseCustomPrompt;
      } else if (scopeType === 'line' && targetLine) {
        systemPrompt = `你是一位资深代码审查专家。请对用户选中的具体代码行进行清晰、透彻的代码改动直解与上下文意图分析。请使用排版清晰的 Markdown 输出，直击要点，无需输出无关套话。`;
      } else if (scopeType === 'chunk') {
        systemPrompt = `你是一位资深代码审查专家。请对用户选定的代码改动块（Diff Hunks）进行深入的代码逻辑剖析与改动目的说明。请使用排版清晰的 Markdown 输出，直击要点，无需输出无关套话。`;
      } else {
        systemPrompt = `你是一位资深架构师和代码审查专家。你的任务是对给定的 Git Diff 进行深度语义分析，深入剖析代码改动的核心逻辑、语句含义与修改目的。请使用排版清晰的 Markdown 输出，直击要点，无需输出无关套话。`;
      }

      let userContent = '';
      if (scopeType === 'line' && targetLine) {
        userContent = userPrompt
          ? `【文件】: ${filePath || '当前文件'}\n【聚焦代码行 (Line ${targetLine.lineNumber || ''})】:\n\`\`\`\n${
              targetLine.type === 'delete' ? '-' : targetLine.type === 'add' ? '+' : ' '
            } ${targetLine.content}\n\`\`\`\n\n【周围上下文 Diff】:\n\`\`\`diff\n${diff.slice(
              0,
              5000
            )}\n\`\`\`\n\n【附加要求】: ${userPrompt}`
          : `【文件】: ${filePath || '当前文件'}\n【聚焦代码行 (Line ${targetLine.lineNumber || ''})】:\n\`\`\`\n${
              targetLine.type === 'delete' ? '-' : targetLine.type === 'add' ? '+' : ' '
            } ${targetLine.content}\n\`\`\`\n\n【周围上下文 Diff】:\n\`\`\`diff\n${diff.slice(
              0,
              5000
            )}\n\`\`\`\n\n请针对该聚焦行进行专业解释。`;
      } else {
        userContent = userPrompt
          ? `【上下文 Git 差异】\n文件: ${filePath || '多文件'}\n提交信息: ${
              commitMessage || '无'
            }\n\`\`\`diff\n${diff.slice(0, 9000)}\n\`\`\`\n\n【附加要求】: ${userPrompt}`
          : `【请分析以下 Git 差异】\n文件: ${filePath || '多文件'}\n提交信息: ${
              commitMessage || '无'
            }\n\`\`\`diff\n${diff.slice(0, 9000)}\n\`\`\``;
      }

      const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      if (provider === 'openrouter' || baseUrl.includes('openrouter')) {
        headers['HTTP-Referer'] = 'https://github.com/Jtsgxh/AI-Diff-tool';
        headers['X-Title'] = 'AI-Diff-tool';
      }

      const body = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        stream: true,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        res.write(
          `data: ${JSON.stringify({
            text: `### ❌ 大模型接口请求失败 (${response.status})\n\`\`\`\n${errorText}\n\`\`\`\n> 请在右上角 **「⚙️ AI 引擎配置」** 中检查您的 API Key、Base URL 与模型名称是否正确。`,
          })}\n\n`
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (!response.body) {
        res.write(
          `data: ${JSON.stringify({
            text: '❌ 未收到模型服务端的流式响应，请重试。',
          })}\n\n`
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const reader = response.body.getReader();
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
              res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: any) {
      res.write(
        `data: ${JSON.stringify({
          text: `\n\n❌ **请求连接失败**: ${err.message}\n请检查您的网络连接或 Base URL 是否有效。`,
        })}\n\n`
      );
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}

export const aiService = new AIService();
