import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { repositoryWireTools } from './repositoryToolSchema';
import type { SseStream } from './http/sse';
import type { RepositoryConversationLane } from '../shared/types';

type Message = Record<string, any>;
const SYSTEM_PROMPT = `你是仓库代码分析助手。本对话持续服务同一仓库。
每次用户消息中的【本轮任务要求】只约束该轮任务；以最新任务的范围、格式和当前提供的源码为准。
历史回答是分析记录，不是源码事实。代码可能已经变化；跨轮引用旧源码前应根据当前输入或工具重新核实。
本轮工具权限由最新任务要求和当前请求实际提供的工具决定。无工具阶段必须直接输出正文，不要请求或模拟工具调用。
不要把旧任务的输出格式或工具权限带入新任务。`;

interface Entry {
  messages: Message[];
  tail: Promise<void>;
  controllers: Set<AbortController>;
  generation: number;
}

/** 将真实路径别名归并到同一个仓库会话，Windows 路径不区分大小写。 */
function repoKey(repoPath: string, lane: RepositoryConversationLane): string {
  const resolved = realpathSync.native(path.resolve(repoPath));
  return `${process.platform === 'win32' ? resolved.toLowerCase() : resolved}::${lane}`;
}

/** 每个仓库分别保存审查和学习对话，各条对话内部串行安排请求。 */
export class RepositoryConversationStore {
  private readonly entries = new Map<string, Entry>();

  /** 历史写入应用数据目录，测试可提供独立临时目录。 */
  constructor(private readonly directory = process.env.AI_DIFF_CONVERSATION_DIR || path.join(homedir(), '.ai-diff-tool', 'conversations')) {}

  /** 使用路径摘要作为文件名，不向被分析仓库写入运行数据。 */
  private filename(key: string): string {
    return path.join(this.directory, `${createHash('sha256').update(key).digest('hex')}.json`);
  }

  /** 首次访问从磁盘恢复，损坏历史明确报错而非默默清空。 */
  private entry(key: string): Entry {
    let entry = this.entries.get(key);
    if (!entry) {
      let messages: Message[] = [];
      try {
        const saved = JSON.parse(readFileSync(this.filename(key), 'utf8'));
        if (saved.version !== 1 || !Array.isArray(saved.messages)) throw new Error('历史格式不兼容');
        messages = saved.messages;
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw new Error(`仓库对话历史读取失败，请清除历史后重试：${error.message}`);
      }
      entry = { messages, tail: Promise.resolve(), controllers: new Set(), generation: 0 };
      this.entries.set(key, entry);
    }
    return entry;
  }

  /** 排队期间也响应取消；前一请求完全结束后才允许读取和更新历史。 */
  async acquire(repoPath: string, signal: AbortSignal, maxChars: number, lane: RepositoryConversationLane = 'review'): Promise<RepositoryConversation> {
    const key = repoKey(repoPath, lane);
    const entry = this.entry(key);
    const controller = new AbortController();
    entry.controllers.add(controller);
    const combined = AbortSignal.any([signal, controller.signal]);
    const previous = entry.tail;
    let unlock!: () => void;
    const gate = new Promise<void>((resolve) => { unlock = resolve; });
    entry.tail = previous.then(() => gate);
    const generation = entry.generation;
    let onAbort!: () => void;
    try {
      await Promise.race([previous, new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(combined.reason);
        combined.addEventListener('abort', onAbort, { once: true });
        if (combined.aborted) onAbort();
      })]);
      combined.throwIfAborted();
    } catch (error) {
      unlock();
      entry.controllers.delete(controller);
      throw error;
    } finally {
      combined.removeEventListener('abort', onAbort);
    }
    return new RepositoryConversation(structuredClone(entry.messages), combined, maxChars, (messages) => {
      combined.throwIfAborted();
      if (entry.generation !== generation) throw new Error('仓库对话已清除，请重新发起分析');
      mkdirSync(this.directory, { recursive: true });
      const filename = this.filename(key);
      const temporary = `${filename}.tmp`;
      // 同步原子替换避免清除与提交在异步写入间交错，磁盘成功后才更新内存。
      writeFileSync(temporary, JSON.stringify({ version: 1, messages }), { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, filename);
      entry.messages = structuredClone(messages);
    }, () => {
      entry.controllers.delete(controller);
      unlock();
    }, lane);
  }

  /** 只清除指定仓库的指定对话线，同时取消该线旧请求，防止旧结果重新写回。 */
  clear(repoPath: string, lane: RepositoryConversationLane = 'review'): void {
    const key = repoKey(repoPath, lane);
    // 即使历史文件损坏，也允许直接清除，不必先反序列化。
    rmSync(this.filename(key), { force: true });
    const entry = this.entries.get(key);
    if (entry) {
      entry.generation++;
      entry.messages = [];
      for (const controller of entry.controllers) controller.abort(new Error('仓库对话已清除，本次分析已取消'));
    }
  }
}

/** 一个排队任务的事务：保留实际模型消息，仅成功完成时提交到仓库历史。 */
export class RepositoryConversation {
  private previousSource: Message[] = [];
  private released = false;
  private recordedToolIds = new Set<string>();

  /** 结束阶段前补齐未执行工具的明确失败结果，避免留下悬空的 tool_calls。 */
  private closePendingTools(): void {
    let assistantIndex = this.messages.length - 1;
    while (assistantIndex >= 0 && this.messages[assistantIndex].role !== 'assistant') assistantIndex--;
    if (assistantIndex < 0) return;
    const answered = new Set(this.messages.slice(assistantIndex + 1).filter((m) => m.role === 'tool').map((m) => m.tool_call_id));
    for (const call of this.messages[assistantIndex].tool_calls || []) {
      if (!answered.has(call.id)) this.messages.push({ role: 'tool', tool_call_id: call.id,
        content: '该工具调用没有取得可用结果，不能作为源码证据。' });
    }
  }

  /** 保存历史快照和事务回调，不保存 API 密钥或请求头。 */
  constructor(private messages: Message[], readonly signal: AbortSignal, private readonly maxChars: number,
    private readonly save: (messages: Message[]) => void, private readonly unlock: () => void,
    private readonly lane: RepositoryConversationLane = 'review') {}

  /** 在工具执行后立即保存结果，达到探查轮数上限时也能进入合法的综合阶段。 */
  recordToolOutput(name: string, args: unknown, output: string): void {
    for (const message of [...this.messages].reverse()) {
      if (message.role !== 'assistant') continue;
      for (const call of message.tool_calls || []) {
        if (this.recordedToolIds.has(call.id) || call.function.name !== name) continue;
        let parsed: unknown;
        try { parsed = JSON.parse(call.function.arguments); } catch { continue; }
        if (!isDeepStrictEqual(parsed, args)) continue;
        this.messages.push({ role: 'tool', tool_call_id: call.id, content: output });
        this.recordedToolIds.add(call.id);
        return;
      }
      return;
    }
  }

  /** 将引擎各阶段转换成同一对话上的追加消息，原样保留已发送的历史前缀。 */
  async fetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
    this.signal.throwIfAborted();
    const body = JSON.parse(String(init?.body));
    const source: Message[] = body.messages;
    const toolsEnabled = Boolean(body.tools?.length) && body.tool_choice !== 'none';
    const toolInstruction = toolsEnabled
      ? '当前是关联探查阶段，允许调用本次请求提供的只读工具。'
      : '当前是无工具输出阶段，没有可调用工具。请根据本轮输入和已有证据直接输出正文；证据不足时明确指出，禁止请求或模拟工具调用。';
    let common = 0;
    while (common < source.length && common < this.previousSource.length &&
      isDeepStrictEqual(source[common], this.previousSource[common])) common++;
    // 工具续轮或截断续写保留共同输入；已捕获的 assistant 消息不能被 SDK 重排或裁剪覆盖。
    const continuing = common > 1;
    if (!continuing) this.closePendingTools();
    const additions = continuing ? source.slice(common) : source;
    for (const message of additions) {
      if (continuing && message.role === 'assistant') continue;
      if (message.role === 'tool' && this.recordedToolIds.has(message.tool_call_id)) continue;
      this.messages.push(message.role === 'system' || message.role === 'developer'
        ? { role: 'user', content: `【本轮任务要求】\n${message.content}\n\n【本轮工具权限】\n${toolInstruction}` }
        : structuredClone(message));
    }
    this.previousSource = structuredClone(source);
    body.messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...this.messages];
    // 无工具阶段不能为了前缀一致性强塞工具列表，避免模型被历史探查模式带偏。
    if (toolsEnabled) {
      body.tools = repositoryWireTools;
      body.tool_choice ||= 'auto';
    } else {
      delete body.tools;
      delete body.tool_choice;
      delete body.parallel_tool_calls;
    }
    if (JSON.stringify(body.messages).length + (body.tools ? JSON.stringify(body.tools).length : 0) > this.maxChars) {
      throw new Error(`当前对话已达到上下文预算，请点击“${this.lane === 'learn' ? '清除学习对话' : '清除仓库对话'}”后重试，或增大上下文设置`);
    }
    const response = await fetch(input, { ...init, body: JSON.stringify(body),
      signal: init?.signal ? AbortSignal.any([init.signal, this.signal]) : this.signal });
    if (!response.ok || !response.body) return response;
    return this.capture(response);
  }

  /** 旁路解析流式输出，保留完整正文、推理和工具参数，不改变交给原引擎的字节。 */
  private capture(response: Response): Response {
    const decoder = new TextDecoder();
    let buffer = '';
    const assistant: Message = { role: 'assistant', content: '' };
    const calls = new Map<number, any>();
    let finished = false;
    /** 仅在模型给出结束原因后记入事务，断流不会留下半条消息。 */
    const consume = (line: string) => {
      if (!line.startsWith('data:')) return;
      let event: any;
      try { event = JSON.parse(line.slice(5).trim()); } catch { return; }
      const choice = event.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content) assistant.content += delta.content;
      const reasoning = delta?.reasoning_content ?? delta?.reasoning;
      if (reasoning) assistant.reasoning_content = (assistant.reasoning_content || '') + reasoning;
      for (const part of delta?.tool_calls || []) {
        const call = calls.get(part.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (part.id) call.id += part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
        calls.set(part.index, call);
      }
      if (choice?.finish_reason && !finished) {
        finished = true;
        this.recordedToolIds.clear();
        if (calls.size) assistant.tool_calls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
        this.messages.push(assistant);
      }
    };
    const transformed = response.body!.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach(consume);
        controller.enqueue(chunk);
      },
      flush() { consume(buffer + decoder.decode()); },
    }));
    return new Response(transformed, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  /** 仅在整个分析成功后保存，失败和取消不会污染下一次请求。 */
  commit(): void { this.closePendingTools(); this.save(this.messages); }

  /** 无论成功、异常或取消都释放队列，且重复释放无副作用。 */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.unlock();
  }
}

export const repositoryConversations = new RepositoryConversationStore();

/** 排队时持续发送状态帧，避免前端把等待同仓库前序请求误判为模型空闲超时。 */
export async function waitForRepositoryConversation(repoPath: string, stream: SseStream, maxChars: number,
  lane: RepositoryConversationLane = 'review'): Promise<RepositoryConversation> {
  const timer = setInterval(() => stream.send({ type: 'status', phase: 'initializing',
    message: `正在等待当前仓库的前序${lane === 'learn' ? '学习' : '审查'}任务完成...` }), 8000);
  try { return await repositoryConversations.acquire(repoPath, stream.signal, maxChars, lane); }
  finally { clearInterval(timer); }
}
