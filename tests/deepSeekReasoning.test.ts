import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Response as ExpressResponse } from 'express';
import { CodexAgentEngine } from '../server/agentEngine';
import {
  normalizeDeepSeekReasoningResponse,
  prepareDeepSeekToolRequest,
} from '../server/deepSeekReasoning';

function completionStream(deltas: Record<string, unknown>[], finishReason: string): Response {
  const frames = [
    ...deltas.map((delta) => ({
      id: 'chatcmpl-deepseek-fixture',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'deepseek-flash',
      choices: [{ index: 0, delta, finish_reason: null }],
    })),
    {
      id: 'chatcmpl-deepseek-fixture',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'deepseek-flash',
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    },
  ];
  return new Response(
    `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } }
  );
}

class CapturedResponse extends EventEmitter {
  readonly chunks: string[] = [];
  writableEnded = false;
  setHeader(): void {}
  flushHeaders(): void {}
  write(value: string): boolean {
    this.chunks.push(value);
    return true;
  }
  end(): void {
    this.writableEnded = true;
  }
}

test('DeepSeek reasoning stream is mirrored into the field understood by the Agents SDK', async () => {
  const source = completionStream([{ reasoning_content: '完整推理' }], 'stop');
  let detected = false;
  const normalized = normalizeDeepSeekReasoningResponse(source, () => {
    detected = true;
  });
  const text = await normalized.text();
  const firstDataLine = text.split('\n').find((line) => line.startsWith('data: {'))!;
  const event = JSON.parse(firstDataLine.slice('data: '.length));

  assert.equal(event.choices[0].delta.reasoning_content, '完整推理');
  assert.equal(event.choices[0].delta.reasoning, '完整推理');
  assert.equal(detected, true);
  assert.match(text, /data: \[DONE\]/);
});

test('non-thinking tool history is left unchanged', () => {
  const body = JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      { role: 'user', content: '检查代码' },
      { role: 'assistant', content: '调用工具', tool_calls: [{ id: 'call_1' }] },
      { role: 'tool', tool_call_id: 'call_1', content: '结果' },
    ],
    tools: [{ type: 'function' }],
  });

  assert.equal(prepareDeepSeekToolRequest(body), body);
});

test('DeepSeek agent detects an unlisted thinking model and replays consecutive tool turns', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'deepseek-reasoning-'));
  const originalFetch = globalThis.fetch;
  const requestBodies: any[] = [];
  let requestNo = 0;

  try {
    await writeFile(path.join(repo, 'Entry.ts'), 'export const entry = true;\n');
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requestBodies.push(body);
      requestNo += 1;

      const assistantMessages = body.messages.filter((message: any) => message.role === 'assistant');
      const invalidReplay = assistantMessages.some(
        (message: any) =>
          typeof message.reasoning_content !== 'string' ||
          !message.reasoning_content ||
          Object.hasOwn(message, 'reasoning') ||
          typeof message.content !== 'string'
      );
      const consecutiveAssistant = body.messages.some(
        (message: any, index: number) =>
          message.role === 'assistant' && body.messages[index + 1]?.role === 'assistant'
      );
      if (invalidReplay || consecutiveAssistant) {
        return new Response(
          JSON.stringify({
            error: {
              message:
                'The `reasoning_content` in the thinking mode must be passed back to the API.',
              type: 'invalid_request_error',
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (requestNo === 1) {
        return completionStream(
          [
            { reasoning_content: 'reasoning-turn-1' },
            { content: '先读取入口文件。' },
            {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"Entry.ts"}' },
                },
              ],
            },
          ],
          'tool_calls'
        );
      }
      if (requestNo === 2) {
        return completionStream(
          [
            { reasoning_content: 'reasoning-turn-2' },
            {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_2',
                  type: 'function',
                  function: {
                    name: 'search_code',
                    arguments: '{"query":"entry","file_extension":"*.ts","max_results":2}',
                  },
                },
              ],
            },
          ],
          'tool_calls'
        );
      }
      return completionStream(
        [{ reasoning_content: 'reasoning-turn-3' }, { content: '审查完成。' }],
        'stop'
      );
    }) as typeof fetch;

    const response = new CapturedResponse();
    await new CodexAgentEngine().streamAgentExplain(
      {
        repoPath: repo,
        scopeType: 'chunk',
        filePath: 'Entry.ts',
        diff: '+export const entry = true;',
        config: {
          provider: 'custom',
          apiKey: 'fixture-key',
          baseUrl: 'http://fixture.invalid/v1',
          // This name deliberately did not match the old v4/reasoner heuristic.
          model: 'deepseek-flash',
          maxExplorationTurns: 10,
          maxRetries: 0,
        },
      },
      response as unknown as ExpressResponse
    );

    assert.equal(requestBodies.length, 3);
    assert.deepEqual(
      requestBodies[1].messages
        .filter((message: any) => message.role === 'assistant')
        .map((message: any) => ({
          reasoning: message.reasoning_content,
          toolCalls: message.tool_calls?.length ?? 0,
        })),
      [{ reasoning: 'reasoning-turn-1', toolCalls: 1 }]
    );
    assert.deepEqual(
      requestBodies[2].messages
        .filter((message: any) => message.role === 'assistant')
        .map((message: any) => ({
          reasoning: message.reasoning_content,
          toolCalls: message.tool_calls?.length ?? 0,
          content: message.content,
        })),
      [
        {
          reasoning: 'reasoning-turn-1',
          toolCalls: 1,
          content: '先读取入口文件。',
        },
        { reasoning: 'reasoning-turn-2', toolCalls: 1, content: '' },
      ]
    );

    const wire = response.chunks.join('');
    assert.match(wire, /reasoning-turn-1/);
    assert.match(wire, /reasoning-turn-2/);
    assert.match(wire, /审查完成/);
    assert.match(wire, /"type":"done"/);
    assert.doesNotMatch(wire, /"type":"error"/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(repo, { recursive: true, force: true });
  }
});
