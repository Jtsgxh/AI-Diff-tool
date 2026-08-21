import { Response } from 'express';

export interface AIProviderConfig {
  provider?: 'deepseek' | 'openai' | 'gemini' | 'ollama' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
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

    // Set standard SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Check API Key requirement (Ollama can run without API key)
    if (!apiKey && provider !== 'ollama') {
      const warningMsg = `### ⚠️ 未检测到 API Key
请点击右上角 **「⚙️ AI 引擎配置」**：
1. 选择您使用的 AI 提供商（如 **DeepSeek**, **Google Gemini**, **OpenAI** 或 **自定义中转站**）并填入您的 API Key；
2. 或者选择 **Ollama 本地模型**（需本地运行 Ollama，无需 Key）。

配置保存后即可立即使用真实大模型对您的代码进行深度语义解析与审查。`;

      res.write(`data: ${JSON.stringify({ text: warningMsg })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Configure endpoints if not explicitly provided
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

    try {
      let systemPrompt = '';

      if (scopeType === 'line' && targetLine) {
        systemPrompt = `你是一位资深代码审查专家。用户在 Git Diff 中选中了具体某一行代码进行深度审查。
请使用结构清晰的 Markdown 格式输出：
### 💡 改动释义
说明该行代码的具体修改内容。

### 🎯 动机与上下文分析
结合该文件上下文，分析修改该行的核心意图。

### ⚠️ 潜在影响与风险
分析改动该行是否存在破坏调用方、引发并发问题或破坏兼容性的隐患。`;
      } else if (scopeType === 'chunk') {
        systemPrompt = `你是一位资深代码审查专家。用户在当前文件中勾选了特定的代码改动块（Diff Hunks）进行联合审查。
请使用结构清晰的 Markdown 格式输出：
### 📌 选定改动块的协同目的 (Combined Intent)
一到两句话概括所选改动块共同实现的目标。

### 🔍 改动块逻辑拆解 (Hunk Breakdown)
按改动块分别解析其承载的具体逻辑（修改了哪些参数、重构了哪些函数、调整了哪些状态流转）。

### ⚠️ 潜在影响与风险雷达 (Risk Radar)
分析所选改动块组合在一起对模块状态、并发安全或外部调用的潜在副作用。

### 💡 优化与测试建议 (Suggestions)
给出代码健壮性优化点或单元测试编写建议。`;
      } else {
        systemPrompt = `你是一位资深架构师和代码审查专家。你的任务是对给定的 Git Diff 进行深度语义分析。
请使用结构清晰的 Markdown 格式输出，包含以下维度：
### 📌 变更核心概述 (Executive Summary)
一到两句话精炼概括本次改动的核心目的。

### 🎯 架构与业务意图 (Intent & Architecture Impact)
分析本次改动背后的业务意图、设计模式变更或模块间协作变动。

### 🔍 核心逻辑改动拆解 (Logic Breakdown)
分点列出关键算法、状态流转、并发控制或接口调用的具体变更。

### ⚠️ 潜在隐患与风险雷达 (Risk Radar)
检查是否存在并发安全、内存泄漏、边界异常、兼容性 Breaking Changes 等风险。

### 💡 优化与重构建议 (Optimization Suggestions)
提出针对代码健壮性、可读性或测试用例的建议。`;
      }

      let userContent = '';
      if (scopeType === 'line' && targetLine) {
        userContent = userPrompt
          ? `【文件】: ${filePath || '当前文件'}\n【聚焦代码行 (Line ${targetLine.lineNumber || ''})】:\n\`\`\`\n${targetLine.type === 'delete' ? '-' : targetLine.type === 'add' ? '+' : ' '} ${targetLine.content}\n\`\`\`\n\n【周围上下文 Diff】:\n\`\`\`diff\n${diff.slice(0, 5000)}\n\`\`\`\n\n【用户问题】: ${userPrompt}`
          : `【文件】: ${filePath || '当前文件'}\n【聚焦代码行 (Line ${targetLine.lineNumber || ''})】:\n\`\`\`\n${targetLine.type === 'delete' ? '-' : targetLine.type === 'add' ? '+' : ' '} ${targetLine.content}\n\`\`\`\n\n【周围上下文 Diff】:\n\`\`\`diff\n${diff.slice(0, 5000)}\n\`\`\`\n\n请针对该聚焦行进行专业解释。`;
      } else {
        userContent = userPrompt
          ? `【上下文 Git 差异】\n文件: ${filePath || '多文件'}\n提交信息: ${commitMessage || '无'}\n\`\`\`diff\n${diff.slice(0, 9000)}\n\`\`\`\n\n【用户问题】: ${userPrompt}`
          : `【请分析以下 Git 差异】\n文件: ${filePath || '多文件'}\n提交信息: ${commitMessage || '无'}\n\`\`\`diff\n${diff.slice(0, 9000)}\n\`\`\``;
      }

      const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model || 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          stream: true,
        }),
      });

      if (!response.ok || !response.body) {
        const errText = await response.text();
        res.write(`data: ${JSON.stringify({ text: `⚠️ **AI 模型 API 请求失败 (${response.status})**:\n\`\`\`\n${errText}\n\`\`\`\n请检查 API Key 与 Base URL 是否正确。` })}\n\n`);
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
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') {
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content;
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
      res.write(`data: ${JSON.stringify({ text: `\n\n❌ **请求连接失败**: ${err.message}\n请检查您的网络连接或 Base URL 是否有效。` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}

export const aiService = new AIService();
