import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Response as ExpressResponse } from 'express';
import { CodexAgentEngine } from '../server/agentEngine';
import { LEARN_PROSE_COMPLETE_MARKER } from '../server/prompts';

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

function completionStream(content: string | string[], finishReason = 'stop'): Response {
  const chunks = Array.isArray(content) ? content : [content];
  const frames = [
    ...chunks.map((text) => ({
      id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    })),
    {
      id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model',
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
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

function emittedChunkText(response: CapturedResponse): string {
  return response.chunks
    .flatMap((frame) => frame.split('\n'))
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
    .filter((event) => event.type === 'chunk')
    .map((event) => String(event.text || ''))
    .join('');
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
      const markerSplit = Math.floor(LEARN_PROSE_COMPLETE_MARKER.length / 2);
      return completionStream([
        '## 业务全景\n\n结构化讲解已返回。\n\n',
        LEARN_PROSE_COMPLETE_MARKER.slice(0, markerSplit),
        LEARN_PROSE_COMPLETE_MARKER.slice(markerSplit),
      ]);
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
    assert.doesNotMatch(wire, /AI_DIFF_TOOL_LEARN_REPORT_COMPLETE/);
    assert.match(wire, /"type":"done"/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(repo, { recursive: true, force: true });
  }
});

test('invalid structured data is regenerated once using the exact field error', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'structured-learn-repair-'));
  const originalFetch = globalThis.fetch;
  const requestBodies: any[] = [];
  let structuredPass = 0;
  try {
    await writeFile(path.join(repo, 'Entry.ts'), 'export class Entry { run() { return true; } }\n');
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requestBodies.push(body);
      if (body.tools?.length) return completionStream('探查完成');
      if (body.response_format?.type === 'json_object') {
        structuredPass += 1;
        if (structuredPass === 1) {
          const invalid = structuredClone(graph);
          delete (invalid.businessRoutes[0].steps[0] as Partial<typeof graph.businessRoutes[0]['steps'][0]>).inputs;
          return completionStream(JSON.stringify(invalid));
        }
        return completionStream(JSON.stringify(graph));
      }
      return completionStream(
        '## 业务全景\n\n校正后的结构化讲解已返回。\n\n' + LEARN_PROSE_COMPLETE_MARKER
      );
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

    assert.equal(structuredPass, 2);
    assert.equal(requestBodies.length, 4);
    assert.match(
      requestBodies[2].messages.at(-1).content,
      /businessRoutes\[0\]\.steps\[0\]\.inputs 必须是字符串数组/
    );
    const wire = response.chunks.join('');
    assert.match(wire, /正在根据字段错误重新生成一次/);
    assert.match(wire, /校正后的结构化讲解已返回/);
    assert.match(wire, /"type":"done"/);
    assert.doesNotMatch(wire, /"type":"error"/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(repo, { recursive: true, force: true });
  }
});

test('learn prose continues when provider reports stop before the completion marker', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'structured-learn-stop-'));
  const originalFetch = globalThis.fetch;
  const requestBodies: any[] = [];
  let prosePass = 0;
  try {
    await writeFile(path.join(repo, 'Entry.ts'), 'export class Entry { run() { return true; } }\n');
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requestBodies.push(body);
      if (body.tools?.length) return completionStream('探查完成');
      if (body.response_format?.type === 'json_object') {
        return completionStream(JSON.stringify(graph));
      }
      prosePass += 1;
      if (prosePass === 1) {
        // Reproduce the observed provider failure: a mid-symbol response that
        // incorrectly claims it reached a natural stop.
        return completionStream('## 外部依赖与边界\n\n- `GitService`: 调用 `fet', 'stop');
      }
      return completionStream(
        'chRepo()` 完成读取。\n\n## 建议阅读顺序\n\n1. Entry.run()\n\n' +
          LEARN_PROSE_COMPLETE_MARKER
      );
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

    assert.equal(requestBodies.length, 4);
    assert.equal(prosePass, 2);
    assert.match(
      requestBodies[3].messages.at(-1).content,
      /完整性结束标记之前提前停止/
    );

    const wire = response.chunks.join('');
    const visibleText = emittedChunkText(response);
    assert.match(wire, /模型提前结束但中文讲解尚未完整/);
    assert.match(visibleText, /`fetchRepo\(\)` 完成读取/);
    assert.doesNotMatch(wire, /AI_DIFF_TOOL_LEARN_REPORT_COMPLETE/);
    assert.match(wire, /"type":"done"/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(repo, { recursive: true, force: true });
  }
});
