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

export class CodexAgentEngine {
  async streamAgentExplain(options: AgentExplainOptions, res: Response): Promise<void> {
    const { repoPath, scopeType, targetLine, diff, filePath, commitMessage, userPrompt, config } =
      options;

    const provider = config?.provider || 'deepseek';
    const apiKey = config?.apiKey || process.env.AI_API_KEY || '';
    let baseUrl = config?.baseUrl || process.env.AI_BASE_URL || '';
    let model = config?.model || process.env.AI_MODEL || '';

    // Set standard SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    if (!apiKey && provider !== 'ollama') {
      res.write(
        `data: ${JSON.stringify({
          type: 'chunk',
          text: `### ⚠️ 未检测到 API Key\n请在右上角 **「⚙️ AI 引擎配置」** 中填入您的 API Key（如 DeepSeek, OpenAI, Gemini 等）以启用 Codex 智能体自主全库审查。`,
        })}\n\n`
      );
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
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

    const tools = new AgentTools(repoPath);

    const systemPrompt = `你是由 OpenAI Codex 与智能体架构驱动的资深软件架构师。你拥有对当前完整代码库的文件系统访问与符号检索工具。
在审查 Git Diff 时，切勿只看表面增删文本。请自主调用工具深入探查关联文件与调用方，完成架构级、跨模块的深度审查。

【你可以调用的工具】：
1. \`read_file\`: 阅读仓库中任意源文件的完整实现或指定行范围（例如查看被修改类所继承的基类、接口签名或被调用的外部函数）。
2. \`search_code\`: 全局搜索某个类名、命名空间、函数签名或变量的所有调用位置（用于评估下游引用是否破坏）。
3. \`find_files\`: 模糊搜索文件名，定位单元测试、契约接口或配置文件。

【智能体审查流程】：
1. 首先评估 Diff：是否涉及外部类定义、接口签名变更、命名空间迁移或配置调整？
2. 如果存在不确定或跨文件影响，**果断调用工具探查相关文件和调用方**。
3. 收集充足证据后，生成一份结构清晰、论据扎实的**跨模块深度审查报告**。

【最终审查报告结构 (Markdown)】：
### 🌐 全局架构与改动意图 (Cross-Module Intent)
结合你探查到的外部源文件与工程目录，说明本次改动的宏观架构目的。

### 🔍 跨文件影响与关键依赖分析 (Impact & Callers Analysis)
列出此次修改涉及的下游模块与文件，说明是否存在调用方破坏、命名空间缺失或类型不兼容。

### ⚠️ 深度风险雷达与边界隐患 (Risk Radar)
检查并发安全性（竞态/死锁）、内存泄漏、空异常、异常逃逸、Breaking Changes 等。

### 💡 架构重构与测试建议 (Actionable Suggestions)
提出针对代码健壮性、可读性或测试用例的建议。`;

    let initialUserMsg = '';
    if (scopeType === 'line' && targetLine) {
      initialUserMsg = `【文件】: ${filePath || '当前文件'}\n【聚焦代码行 (Line ${
        targetLine.lineNumber || ''
      })】:\n\`\`\`\n${targetLine.type === 'delete' ? '-' : targetLine.type === 'add' ? '+' : ' '} ${
        targetLine.content
      }\n\`\`\`\n\n【周围上下文 Diff】:\n\`\`\`diff\n${diff.slice(
        0,
        6000
      )}\n\`\`\`\n\n请结合代码库全局上下文，对其进行深度审查。如需跨文件信息请自主调用工具。`;
    } else {
      initialUserMsg = `【待审查文件】: ${filePath || '多文件'}\n【提交信息】: ${
        commitMessage || '无'
      }\n\`\`\`diff\n${diff.slice(
        0,
        9000
      )}\n\`\`\`\n\n${userPrompt ? `【用户疑问】: ${userPrompt}\n\n` : ''}请自主决定是否需要探查其他文件或全局搜索引用，随后输出深度审查报告。`;
    }

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: initialUserMsg },
    ];

    const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const maxIterations = 4;
    let iteration = 0;

    try {
      while (iteration < maxIterations) {
        iteration++;

        // Call LLM
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: model || 'deepseek-chat',
            messages,
            tools: AGENT_TOOLS_DEFINITIONS,
            tool_choice: iteration === maxIterations ? 'none' : 'auto',
            stream: false,
          }),
        });

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

        // Check if LLM requested tool calls
        if (msg.tool_calls && msg.tool_calls.length > 0 && iteration < maxIterations) {
          messages.push(msg);

          for (const toolCall of msg.tool_calls) {
            const funcName = toolCall.function.name;
            let args: any = {};
            try {
              args = JSON.parse(toolCall.function.arguments);
            } catch {
              args = {};
            }

            // Emit tool call event to frontend
            const toolCallId = toolCall.id || `call_${Date.now()}`;
            res.write(
              `data: ${JSON.stringify({
                type: 'tool_call',
                id: toolCallId,
                name: funcName,
                args,
              })}\n\n`
            );

            // Execute tool in repository
            const toolResult = await tools.executeTool(funcName, args);

            // Emit tool result event to frontend
            res.write(
              `data: ${JSON.stringify({
                type: 'tool_result',
                id: toolCallId,
                name: funcName,
                summary: `${funcName}(${Object.values(args).join(', ')})`,
                output: toolResult.slice(0, 500) + (toolResult.length > 500 ? '...' : ''),
              })}\n\n`
            );

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: toolResult,
            });
          }
        } else {
          // Final text response
          const reportContent = msg.content || '';
          // Stream the markdown content to user
          const chunkSize = 35;
          for (let i = 0; i < reportContent.length; i += chunkSize) {
            const chunk = reportContent.slice(i, i + chunkSize);
            res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
            await new Promise((r) => setTimeout(r, 15));
          }
          break;
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (err: any) {
      res.write(
        `data: ${JSON.stringify({
          type: 'chunk',
          text: `\n\n❌ **Codex Agent 执行出错**: ${err.message}`,
        })}\n\n`
      );
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    }
  }
}

export const agentEngine = new CodexAgentEngine();
