import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Response as ExpressResponse } from 'express';
import { CodexAgentEngine } from '../server/agentEngine';

const graph = {
  communities: [{ id: '0', label: '业务', summary: '测试业务', files: ['Entry.ts'] }],
  businessRoutes: [{
    id: 'route-1',
    label: '测试路线',
    summary: '从入口到结果',
    steps: [
      {
        label: '进入', kind: 'entry', file: 'Entry.ts', classSymbol: 'Entry',
        methodSymbol: 'run', relation: '入口', description: '接收请求', evidence: 'Entry.run()',
        communityId: '0', inputs: ['request'], outputs: ['result'], stateChanges: [], failurePaths: [],
      },
      {
        label: '返回', kind: 'result', file: 'Entry.ts', classSymbol: 'Entry',
        methodSymbol: 'run', relation: '返回', description: '返回结果', evidence: 'return result',
        communityId: '0', inputs: ['result'], outputs: ['response'], stateChanges: [], failurePaths: [],
      },
    ],
  }],
  runtimePath: ['0'],
};

function completionStream(content: string): Response {
  const frames = [
    {
      id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
  ];
  return new Response(`${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
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

test('learn analysis uses JSON Output before streaming the prose stage', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'structured-learn-'));
  const originalFetch = globalThis.fetch;
  const requestBodies: any[] = [];
  try {
    await writeFile(path.join(repo, 'Entry.ts'), 'export class Entry { run() { return true; } }\n');
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requestBodies.push(body);
      if (body.tools?.length) return completionStream('探查完成');
      if (body.response_format?.type === 'json_object') {
        return completionStream(JSON.stringify(graph));
      }
      return completionStream('## 业务全景\n\n结构化讲解已返回。');
    }) as typeof fetch;

    const response = new CapturedResponse();
    await new CodexAgentEngine().streamAgentExplain({
      repoPath: repo,
      scopeType: 'repo',
      task: 'learn',
      diff: '',
      config: {
        provider: 'custom',
        apiKey: 'fixture-key',
        baseUrl: 'http://fixture.invalid/v1',
        model: 'fixture-model',
        maxExplorationTurns: 10,
      },
    }, response as unknown as ExpressResponse);

    assert.equal(requestBodies.length, 3);
    assert.ok(requestBodies[0].tools?.length);
    assert.deepEqual(requestBodies[1].response_format, { type: 'json_object' });
    assert.equal(requestBodies[2].response_format, undefined);

    const wire = response.chunks.join('');
    const graphAt = wire.indexOf('```learn-graph');
    const proseAt = wire.indexOf('结构化讲解已返回');
    assert.match(wire, /结构化业务路线（1\/2）/);
    assert.match(wire, /中文讲解（2\/2）/);
    assert.ok(graphAt >= 0 && proseAt > graphAt);
    assert.match(wire, /"type":"done"/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(repo, { recursive: true, force: true });
  }
});
