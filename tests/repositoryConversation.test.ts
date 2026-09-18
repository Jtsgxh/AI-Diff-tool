import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Response as ExpressResponse } from 'express';
import { RepositoryConversationStore, repositoryConversations } from '../server/repositoryConversation';
import { AIService } from '../server/aiService';
import { CodexAgentEngine } from '../server/agentEngine';

/** 生成包含真实协议字段的流式响应，避免调用外部模型。 */
function completion(content: string, calls?: any[], reasoning = '完整推理'): Response {
  const delta = { content, reasoning_content: reasoning, tool_calls: calls };
  return new Response([
    { choices: [{ index: 0, delta, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: calls ? 'tool_calls' : 'stop' }] },
  ].map((frame) => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', ...frame })}\n\n`).join('') + 'data: [DONE]\n\n',
  { headers: { 'Content-Type': 'text/event-stream' } });
}

/** 为每个用例创建独立仓库路径和历史目录。 */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'repo-conversation-'));
  const repo = path.join(root, 'repo');
  const other = path.join(root, 'other');
  mkdirSync(repo); mkdirSync(other);
  const directory = path.join(root, 'history');
  return { root, repo, other, directory, store: new RepositoryConversationStore(directory) };
}

/** 构造不同模式的源请求，公共前缀由生产会话适配器负责组装。 */
function request(question: string, tools = false) {
  return { model: 'fixture', stream: true,
    messages: [{ role: 'system', content: tools ? '关联分析要求' : '直接解释要求' }, { role: 'user', content: question }],
    ...(tools ? { tools: [{ type: 'function' }] } : {}) };
}

test('跨模式和重启保留消息前缀，无工具模式不附带工具声明', async () => {
  const f = fixture();
  const original = globalThis.fetch;
  const sent: any[] = [];
  globalThis.fetch = (async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return completion('回答' + sent.length);
  }) as typeof fetch;
  try {
    const first = await f.store.acquire(f.repo, new AbortController().signal, 100000);
    await (await first.fetch('http://fixture.invalid', { body: JSON.stringify(request('解释块 A')) })).text();
    first.commit(); first.release();
    const restored = new RepositoryConversationStore(f.directory);
    const second = await restored.acquire(f.repo, new AbortController().signal, 100000);
    await (await second.fetch('http://fixture.invalid', { body: JSON.stringify(request('关联分析块 B', true)) })).text();
    second.commit(); second.release();
    assert.deepEqual(sent[1].messages.slice(0, sent[0].messages.length), sent[0].messages);
    assert.equal(sent[1].messages[sent[0].messages.length].content, '回答1');
    assert.equal(sent[1].messages[sent[0].messages.length].reasoning_content, '完整推理');
    assert.equal(Object.hasOwn(sent[0], 'tools'), false);
    assert.equal(Object.hasOwn(sent[0], 'tool_choice'), false);
    assert.ok(sent[1].tools.length > 0);
    assert.equal(sent[1].tool_choice, 'auto');
    const history = readFileSync(path.join(f.directory, readdirSync(f.directory)[0]), 'utf8');
    assert.doesNotMatch(history, /Authorization|apiKey/);
    const isolated = await restored.acquire(f.other, new AbortController().signal, 100000);
    await (await isolated.fetch('http://fixture.invalid', { body: JSON.stringify(request('另一个仓库')) })).text();
    isolated.release();
    assert.doesNotMatch(JSON.stringify(sent[2]), /解释块 A|回答1/);
  } finally { globalThis.fetch = original; rmSync(f.root, { recursive: true, force: true }); }
});

test('工具续轮保存实际 assistant 且工具结果只出现一次，综合阶段继续原始前缀', async () => {
  const f = fixture();
  const original = globalThis.fetch;
  const sent: any[] = [];
  globalThis.fetch = (async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    if (sent.length === 1) return completion('', [{ index: 0, id: 'call_a', type: 'function',
      function: { name: 'read_file', arguments: '{"file_path":"A.ts"}' } }]);
    return completion('完成');
  }) as typeof fetch;
  const tx = await f.store.acquire(f.repo, new AbortController().signal, 100000);
  try {
    const source: any = request('关联分析', true);
    await (await tx.fetch('http://fixture.invalid', { body: JSON.stringify(source) })).text();
    tx.recordToolOutput('read_file', { file_path: 'A.ts' }, '真实源码');
    source.messages.push({ role: 'assistant', content: [{ text: 'SDK 重组正文' }], tool_calls: [{ id: 'call_a' }] },
      { role: 'tool', tool_call_id: 'call_a', content: '真实源码' });
    await (await tx.fetch('http://fixture.invalid', { body: JSON.stringify(source) })).text();
    assert.equal(sent[1].messages.filter((m: any) => m.role === 'tool').length, 1);
    assert.equal(sent[1].messages.find((m: any) => m.role === 'assistant').reasoning_content, '完整推理');
    assert.doesNotMatch(JSON.stringify(sent[1]), /SDK 重组正文/);
    await (await tx.fetch('http://fixture.invalid', { body: JSON.stringify({
      ...request('综合输出', true), tool_choice: 'none', parallel_tool_calls: true,
    }) })).text();
    assert.deepEqual(sent[2].messages.slice(0, sent[1].messages.length), sent[1].messages);
    assert.equal(Object.hasOwn(sent[2], 'tools'), false);
    assert.equal(Object.hasOwn(sent[2], 'tool_choice'), false);
    assert.equal(Object.hasOwn(sent[2], 'parallel_tool_calls'), false);
    tx.commit();
  } finally { tx.release(); globalThis.fetch = original; rmSync(f.root, { recursive: true, force: true }); }
});

test('同仓库串行、不同仓库独立，取消排队请求不会让后续请求插队', async () => {
  const f = fixture();
  const first = await f.store.acquire(f.repo, new AbortController().signal, 100000);
  const cancelled = new AbortController();
  let acquired = false;
  const second = f.store.acquire(f.repo, cancelled.signal, 100000);
  const rejected = assert.rejects(second, /取消/);
  const third = f.store.acquire(f.repo, new AbortController().signal, 100000).then((tx) => { acquired = true; return tx; });
  try {
    const independent = await f.store.acquire(f.other, new AbortController().signal, 100000);
    independent.release();
    cancelled.abort(new Error('取消'));
    await rejected;
    assert.equal(acquired, false);
    first.release();
    const next = await third;
    next.release();
  } finally { first.release(); rmSync(f.root, { recursive: true, force: true }); }
});

test('同仓库的审查与学习可以并行，清除审查不取消或删除学习历史', { timeout: 3000 }, async () => {
  const f = fixture();
  const original = globalThis.fetch;
  const sent: any[] = [];
  globalThis.fetch = (async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return completion('独立回答');
  }) as typeof fetch;
  const review = await f.store.acquire(f.repo, new AbortController().signal, 100000, 'review');
  const learn = await f.store.acquire(f.repo, new AbortController().signal, 100000, 'learn');
  try {
    await (await review.fetch('http://fixture.invalid', { body: JSON.stringify(request('审查记录')) })).text();
    review.commit();
    await (await learn.fetch('http://fixture.invalid', { body: JSON.stringify(request('学习记录')) })).text();
    assert.doesNotMatch(JSON.stringify(sent[1]), /审查记录/);
    f.store.clear(f.repo, 'review');
    assert.equal(review.signal.aborted, true);
    assert.equal(learn.signal.aborted, false);
    learn.commit(); learn.release();
    const restored = new RepositoryConversationStore(f.directory);
    const next = await restored.acquire(f.repo, new AbortController().signal, 100000, 'learn');
    await (await next.fetch('http://fixture.invalid', { body: JSON.stringify(request('继续学习')) })).text();
    assert.match(JSON.stringify(sent[2]), /学习记录/);
    assert.doesNotMatch(JSON.stringify(sent[2]), /审查记录/);
    next.release();
  } finally { review.release(); learn.release(); globalThis.fetch = original; rmSync(f.root, { recursive: true, force: true }); }
});

test('清除会取消在途和排队请求，拒绝旧事务写回，其他仓库保持有效', async () => {
  const f = fixture();
  const first = await f.store.acquire(f.repo, new AbortController().signal, 100000);
  const other = await f.store.acquire(f.other, new AbortController().signal, 100000);
  const waiting = assert.rejects(f.store.acquire(f.repo, new AbortController().signal, 100000), /已清除/);
  try {
    first.commit();
    f.store.clear(f.repo);
    assert.equal(first.signal.aborted, true);
    assert.equal(other.signal.aborted, false);
    assert.throws(() => first.commit(), /已清除/);
    await waiting;
    assert.equal(readdirSync(f.directory).filter((name) => name.endsWith('.json')).length, 0);
    first.release();
    const fresh = await f.store.acquire(f.repo, new AbortController().signal, 100000);
    fresh.commit(); fresh.release();
    const saved = JSON.parse(readFileSync(path.join(f.directory, readdirSync(f.directory)[0]), 'utf8'));
    assert.deepEqual(saved.messages, []);
  } finally { first.release(); other.release(); rmSync(f.root, { recursive: true, force: true }); }
});

test('预算耗尽明确报错，不发出请求也不自动截断历史', async () => {
  const f = fixture();
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('不应访问模型'); }) as typeof fetch;
  const tx = await f.store.acquire(f.repo, new AbortController().signal, 1);
  try {
    await assert.rejects(tx.fetch('http://fixture.invalid', { body: JSON.stringify(request('解释')) }), /清除仓库对话/);
  } finally { tx.release(); globalThis.fetch = original; rmSync(f.root, { recursive: true, force: true }); }
});

test('失败请求不会写入持久历史，释放后仍能继续使用仓库队列', async () => {
  const f = fixture();
  const original = globalThis.fetch;
  const sent: any[] = [];
  globalThis.fetch = (async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return sent.length === 1 ? new Response('provider failed', { status: 500 }) : completion('成功');
  }) as typeof fetch;
  try {
    const failed = await f.store.acquire(f.repo, new AbortController().signal, 100000);
    const response = await failed.fetch('http://fixture.invalid', { body: JSON.stringify(request('失败输入')) });
    assert.equal(response.ok, false);
    failed.release();
    const next = await f.store.acquire(f.repo, new AbortController().signal, 100000);
    await (await next.fetch('http://fixture.invalid', { body: JSON.stringify(request('成功输入')) })).text();
    next.commit(); next.release();
    assert.doesNotMatch(JSON.stringify(sent[1]), /失败输入/);
  } finally { globalThis.fetch = original; rmSync(f.root, { recursive: true, force: true }); }
});

test('清除操作会中止实际在途的模型 fetch', async () => {
  const f = fixture();
  const original = globalThis.fetch;
  let upstream: AbortSignal | undefined;
  globalThis.fetch = (async (_input, init) => new Promise<Response>((_resolve, reject) => {
    upstream = init!.signal as AbortSignal;
    upstream.addEventListener('abort', () => reject(upstream!.reason), { once: true });
  })) as typeof fetch;
  const tx = await f.store.acquire(f.repo, new AbortController().signal, 100000);
  try {
    const pending = assert.rejects(tx.fetch('http://fixture.invalid', { body: JSON.stringify(request('进行中的分析')) }), /已清除/);
    assert.ok(upstream);
    f.store.clear(f.repo);
    await pending;
    assert.equal(upstream.aborted, true);
  } finally { tx.release(); globalThis.fetch = original; rmSync(f.root, { recursive: true, force: true }); }
});

/** 捕获生产引擎的 SSE 输出。 */
class CapturedResponse extends EventEmitter {
  chunks: string[] = [];
  writableEnded = false;
  /** 测试无需真实响应头。 */
  setHeader(): void {}
  /** 测试无需刷新套接字。 */
  flushHeaders(): void {}
  /** 保存 SSE 帧用于验证终态。 */
  write(value: string): boolean { this.chunks.push(value); return true; }
  /** 标记响应结束。 */
  end(): void { this.writableEnded = true; }
}

for (const task of ['review', 'natural_language', 'pseudocode'] as const) {
  test(`${task} 的 stop 响应只有思考时补正文，完整保留原任务及推理`, async () => {
    const f = fixture();
    const original = globalThis.fetch;
    const sent: any[] = [];
    globalThis.fetch = (async (_input, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return sent.length === 1
        ? completion('', undefined, '应当直接解释，但我可能需要先读取文件。')
        : completion('这是最终正文', undefined, '已确认本轮无工具');
    }) as typeof fetch;
    try {
      const response = new CapturedResponse();
      await new AIService().streamExplainDiff({ repoPath: f.repo, diff: '+const value = 1;', task,
        userPrompt: task === 'review' ? undefined : '严格遵守本任务的原始输出格式',
        config: { provider: 'custom', apiKey: 'fixture', baseUrl: 'http://fixture.invalid/v1', model: 'deepseek-flash' },
      }, response as unknown as ExpressResponse);
      assert.equal(sent.length, 2);
      assert.deepEqual(sent[1].messages.slice(0, sent[0].messages.length), sent[0].messages);
      assert.equal(sent[1].messages.find((m: any) => m.role === 'assistant').reasoning_content,
        '应当直接解释，但我可能需要先读取文件。');
      for (const body of sent) {
        assert.equal(Object.hasOwn(body, 'tools'), false);
        assert.equal(Object.hasOwn(body, 'tool_choice'), false);
        assert.match(JSON.stringify(body.messages), /无工具/);
      }
      assert.match(sent[1].messages.at(-1).content, /原始输出格式/);
      assert.match(response.chunks.join(''), /这是最终正文/);
      assert.match(response.chunks.join(''), /\[DONE\]/);
      assert.doesNotMatch(response.chunks.join(''), /"error"/);
    } finally { repositoryConversations.clear(f.repo); globalThis.fetch = original; rmSync(f.root, { recursive: true, force: true }); }
  });
}

test('连续只有思考时只补一次，失败任务不提交历史', async () => {
  const f = fixture();
  const original = globalThis.fetch;
  const sent: any[] = [];
  globalThis.fetch = (async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return completion('', undefined, '只有思考');
  }) as typeof fetch;
  const config = { provider: 'custom' as const, apiKey: 'fixture', baseUrl: 'http://fixture.invalid/v1', model: 'fixture' };
  try {
    const response = new CapturedResponse();
    await new AIService().streamExplainDiff({ repoPath: f.repo, diff: '+失败的输入', config }, response as unknown as ExpressResponse);
    assert.equal(sent.length, 2);
    assert.match(response.chunks.join(''), /没有输出正文/);
    assert.doesNotMatch(response.chunks.join(''), /\[DONE\]/);
    globalThis.fetch = (async (_input, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return completion('正常正文');
    }) as typeof fetch;
    const fresh = new CapturedResponse();
    await new AIService().streamExplainDiff({ repoPath: f.repo, diff: '+新任务', config }, fresh as unknown as ExpressResponse);
    assert.doesNotMatch(JSON.stringify(sent[2]), /失败的输入|只有思考/);
  } finally { repositoryConversations.clear(f.repo); globalThis.fetch = original; rmSync(f.root, { recursive: true, force: true }); }
});

for (const scenario of ['empty', 'unexpected_tool'] as const) {
  test(`${scenario} 不进入思考补正文流程，也不会误报完成`, async () => {
    const f = fixture();
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return scenario === 'empty' ? completion('', undefined, '') : completion('', [{ index: 0,
        id: 'unwanted', type: 'function', function: { name: 'read_file', arguments: '{"file_path":"A.ts"}' } }]);
    }) as typeof fetch;
    try {
      const response = new CapturedResponse();
      await new AIService().streamExplainDiff({ repoPath: f.repo, diff: '+input',
        config: { provider: 'custom', apiKey: 'fixture', baseUrl: 'http://fixture.invalid/v1', model: 'fixture' },
      }, response as unknown as ExpressResponse);
      assert.equal(calls, 1);
      assert.match(response.chunks.join(''), scenario === 'empty' ? /没有输出正文/ : /意外工具调用/);
      assert.doesNotMatch(response.chunks.join(''), /\[DONE\]/);
    } finally { repositoryConversations.clear(f.repo); globalThis.fetch = original; rmSync(f.root, { recursive: true, force: true }); }
  });
}

test('实际直接解释和 Agent 引擎共享仓库历史，清除后下一次请求重新开始', async () => {
  const f = fixture();
  const original = globalThis.fetch;
  const sent: any[] = [];
  globalThis.fetch = (async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return completion('已完成本轮分析。'.repeat(30));
  }) as typeof fetch;
  const config = { provider: 'custom' as const, apiKey: 'test-secret', baseUrl: 'http://fixture.invalid/v1', model: 'fixture', maxRetries: 0 };
  try {
    const fast = new CapturedResponse();
    await new AIService().streamExplainDiff({ repoPath: f.repo, diff: '+块 A', config }, fast as unknown as ExpressResponse);
    assert.match(fast.chunks.join(''), /\[DONE\]/);
    const agent = new CapturedResponse();
    await new CodexAgentEngine().streamAgentExplain({ repoPath: f.repo, diff: '+块 B', config }, agent as unknown as ExpressResponse);
    assert.match(agent.chunks.join(''), /"type":"done"/);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1].messages.slice(0, sent[0].messages.length), sent[0].messages);
    const learning = new CapturedResponse();
    await new CodexAgentEngine().streamAgentExplain({ repoPath: f.repo, task: 'learn', scopeType: 'repo',
      userPrompt: '独立的仓库学习问题', config }, learning as unknown as ExpressResponse);
    assert.match(learning.chunks.join(''), /"type":"done"/);
    assert.doesNotMatch(JSON.stringify(sent[2]), /块 A|块 B/);
    repositoryConversations.clear(f.repo);
    const fresh = new CapturedResponse();
    await new AIService().streamExplainDiff({ repoPath: f.repo, diff: '+块 C', config }, fresh as unknown as ExpressResponse);
    assert.doesNotMatch(JSON.stringify(sent[3]), /块 A|块 B|独立的仓库学习问题/);
    const learnAgain = new CapturedResponse();
    await new CodexAgentEngine().streamAgentExplain({ repoPath: f.repo, task: 'learn', scopeType: 'repo',
      userPrompt: '继续此前学习', config }, learnAgain as unknown as ExpressResponse);
    assert.match(JSON.stringify(sent[4]), /独立的仓库学习问题/);
    assert.doesNotMatch(JSON.stringify(sent[4]), /块 A|块 B|块 C/);
  } finally {
    repositoryConversations.clear(f.repo); repositoryConversations.clear(f.repo, 'learn');
    globalThis.fetch = original; rmSync(f.root, { recursive: true, force: true });
  }
});
