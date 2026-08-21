import { Response } from 'express';

export interface AIProviderConfig {
  provider?: 'deepseek' | 'openai' | 'gemini' | 'ollama' | 'custom' | 'demo';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface ExplainOptions {
  diff: string;
  filePath?: string;
  commitMessage?: string;
  userPrompt?: string;
  config?: AIProviderConfig;
}

export class AIService {
  async streamExplainDiff(options: ExplainOptions, res: Response): Promise<void> {
    const { diff, filePath, commitMessage, userPrompt, config } = options;

    const provider = config?.provider || (config?.apiKey ? 'custom' : 'demo');
    const apiKey = config?.apiKey || process.env.AI_API_KEY || '';
    let baseUrl = config?.baseUrl || process.env.AI_BASE_URL || '';
    let model = config?.model || process.env.AI_MODEL || '';

    // Set standard SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    if (provider === 'demo' || !apiKey) {
      await this.streamMockExplanation(res, diff, filePath, commitMessage, userPrompt);
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
      const systemPrompt = `你是一位资深架构师和代码审查专家。你的任务是对给定的 Git Diff 进行深度语义分析。
请使用结构清晰的 Markdown 格式输出，包含以下维度：
### 📌 变更核心概述 (Executive Summary)
一到两句话精炼概括本次改动的核心目的。

### 🎯 架构与业务意图 (Intent & Architecture Impact)
分析本次改动背后的业务意图、设计模式变更或模块间协作变动。

### 🔍 核心逻辑改动拆解 (Logic Breakdown)
分点列出关键算法、状态流转、并发控制或接口调用的具体变更。

### ⚠️ 潜在隐患与风险雷达 (Risk Radar)
检查是否存在：
- 空指针/未捕获异常
- 并发竞态/死锁/锁竞争
- 内存泄漏/连接未关闭
- 跨版本兼容性/Breaking Change
- 性能瓶颈
若无明显风险，请明确说明评估结论。

### 💡 优化与重构建议 (Optimization Suggestions)
提出针对代码健壮性、可读性或测试用例的建议。`;

      const userContent = userPrompt
        ? `【上下文 Git 差异】\n文件: ${filePath || '多文件'}\n提交信息: ${commitMessage || '无'}\n\`\`\`diff\n${diff.slice(0, 8000)}\n\`\`\`\n\n【用户问题】: ${userPrompt}`
        : `【请分析以下 Git 差异】\n文件: ${filePath || '多文件'}\n提交信息: ${commitMessage || '无'}\n\`\`\`diff\n${diff.slice(0, 8000)}\n\`\`\``;

      const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          stream: true,
        }),
      });

      if (!response.ok || !response.body) {
        const errText = await response.text();
        res.write(`data: ⚠️ **API 请求失败 (${response.status})**: ${errText}\n\n`);
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
            // Ignore parse errors on heartbeats
          }
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ text: `\n\n❌ 请求出错: ${err.message}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }

  private async streamMockExplanation(
    res: Response,
    diff: string,
    filePath?: string,
    commitMessage?: string,
    userPrompt?: string
  ) {
    let markdown = '';

    if (userPrompt) {
      markdown = `### 💬 针对问题的 AI 语义解答\n\n**关于您的问题：“${userPrompt}”**\n\n针对当前代码变更（${filePath || '选中的代码段'}）：\n1. **设计意图**：此次重构主要将原有的简单逻辑升级为具备生命周期管理与异步安全的高阶实现。\n2. **逻辑支撑**：在代码行中可以看到引入了细粒度状态校验与异常兜底，避免了异步竞争（Race Condition）导致的数据不一致。\n3. **调用方影响**：对外暴露的接口入参保持了向后兼容，但内部逻辑执行时具备更优的吞吐量与故障自愈能力。`;
    } else if (diff.includes('AsyncMutex') || diff.includes('lockRead') || diff.includes('lruCache')) {
      markdown = `### 📌 变更核心概述 (Executive Summary)
本次提交针对 **LRU 缓存系统** 进行了并发安全性重构，引入 **读写互斥锁 (Read-Write Mutex)** 取代原有的简单布尔标记，彻底消除了高并发读写竞争导致的数据踩踏与死锁隐患。

### 🎯 架构与业务意图 (Intent & Architecture Impact)
- **并发模型升级**：由原先非原子性的并发访问升级为支持**多读单写**的细粒度锁机制，显著降低了锁争用（Lock Contention）。
- **TTL 过期清理原子化**：在发现 Key 过期时由读锁平滑升级为排他写锁，保证缓存淘汰与节点脱钩的原子完整性。

### 🔍 核心逻辑改动拆解 (Logic Breakdown)
1. **读写分离锁 (\`rwMutex\`)**：\`get()\` 操作默认获取读锁，极大提升热点数据并发读取吞吐率。
2. **过期节点清理 (\`delete/evictTailAtomic\`)**：淘汰尾部节点时严格保证双向链表指针（\`head\`/\`tail\`/\`prev\`/\`next\`）的完整性。
3. **\`finally\` 块可靠释放**：所有临界区操作均使用 \`try...finally\` 确保即使发生运行时异常，锁也能被百分之百释放。

### ⚠️ 潜在隐患与风险雷达 (Risk Radar)
| 检查项 | 状态 | 评估说明 |
| :--- | :--- | :--- |
| **并发安全** | 🟢 极佳 | 读写锁设计合理，消除死锁路径 |
| **内存泄漏** | 🟢 安全 | 节点脱离链表后 Map 引用同步移除，GC 可正常回收 |
| **异常逃逸** | 🟢 安全 | 所有异步加锁后均由 finally 块保证 unlock |
| **兼容性** | 🟢 无破坏 | \`AsyncLRUCache\` 对外 API 签名（\`get/set\`）保持完全一致 |

### 💡 优化与重构建议 (Optimization Suggestions)
> [!TIP]
> 1. **锁降级支持**：可在淘汰机制中增加超时控制（如 \`lockWrite({ timeoutMs: 500 })\`），防止极端情况下的写阻塞。
> 2. **单元测试补充**：建议使用 \`Promise.all()\` 编写 1000 次并发读写压力测试用例以验证极端边界。`;
    } else if (diff.includes('JwksClient') || diff.includes('RS256') || diff.includes('auth')) {
      markdown = `### 📌 变更核心概述 (Executive Summary)
将 JWT 认证体系由原先的**静态对称密钥 (HS256)** 升级为基于 **JWKS (JSON Web Key Set) 的非对称密钥 (RS256)**，支持私钥自动轮换与密钥标识符 (\`kid\`) 动态解析。

### 🎯 架构与业务意图 (Intent & Architecture Impact)
- **安全架构合规**：消除硬编码或环境变量中的共享静态 Secret，符合零信任（Zero-Trust）安全标准。
- **微服务解耦**：授权中心持有私钥签发 Token，本服务作为资源服务器只需通过公开的 JWKS 端点拉取公钥验签即可。

### 🔍 核心逻辑改动拆解 (Logic Breakdown)
1. **JWKS 客户端配置**：集成 \`JwksClient\`，开启 24 小时公钥本地缓存与每分钟 10 次的限流保护，避免 JWKS 端点遭受 DDoS。
2. **动态 KeyId (\`kid\`) 提取**：在验签前预先解码 JWT Header 提取 \`kid\`，精准获取匹配的公钥。
3. **算法白名单限制**：在 \`jwt.verify()\` 中严格锁定 \`algorithms: ['RS256']\`，彻底防止“None 算法漏洞”与算法混淆攻击。

### ⚠️ 潜在隐患与风险雷达 (Risk Radar)
- **网络延迟与降级**：首次获取未知 \`kid\` 时会发起 HTTP 请求获取公钥，需确认 JWKS 服务的可用性与超时熔断配置。
- **Header 校验**：已在代码中增加 \`decodedHeader.header.kid\` 判空，有效防范畸形 Token。

### 💡 优化与重构建议 (Optimization Suggestions)
建议在网关层配合公钥预热（Key Pre-fetching），进一步降低冷启动时的首包握手延迟。`;
    } else {
      markdown = `### 📌 变更核心概述 (Executive Summary)
针对 **${filePath || '当前模块'}** 进行了功能增强与代码优化，提升了模块的响应健壮性与可维护性。

### 🎯 架构与业务意图 (Intent & Architecture Impact)
- 优化了数据流处理链路，增强了上下文状态的管理精度。
- 减少了冗余的计算开销，提升了组件与服务的协同效率。

### 🔍 核心逻辑改动拆解 (Logic Breakdown)
1. 重构了关键函数逻辑，使职责更加单一明确。
2. 完善了边界判断条件与异常处理机制，避免未捕获异常扩散。
3. 规范了类型定义与参数传递，减少隐式转换风险。

### ⚠️ 潜在隐患与风险雷达 (Risk Radar)
- 🟢 **代码质量良好**：改动范围收敛明确，未发现破坏性 Breaking Change。
- 🟡 **建议关注点**：注意验证上游依赖项在边界输入时的行为一致性。

### 💡 优化与重构建议 (Optimization Suggestions)
建议在本次提交上线后持续观察链路性能监控与错误率指标。`;
    }

    // Stream the markdown in realistic chunks
    const chunkSize = 25;
    for (let i = 0; i < markdown.length; i += chunkSize) {
      const chunk = markdown.slice(i, i + chunkSize);
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      await new Promise((r) => setTimeout(r, 20));
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }
}

export const aiService = new AIService();
