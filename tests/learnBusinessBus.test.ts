import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLearnAnalysisEnvelope } from '../shared/learnGraphSchema';
import type { LearnBusinessRoute, LearnBusinessRouteStep, LearnGraph, LearnNode } from '../src/types';
import { buildLearnBusinessBus, layoutLearnBusinessBus } from '../src/utils/learnBusinessBus';
import { buildLearnSystemPrompt, buildLearnUserMessage } from '../server/prompts';
import {
  applyLearnAnalysis,
  mergeLearnGraphExpansion,
  parseLearnOverlay,
  serializeLearnGraphReport,
} from '../src/utils/learnGraph';

function step(
  node: LearnNode,
  kind: LearnBusinessRouteStep['kind'],
  methodSymbol: string,
  label = `${kind}-${node.label}`
): LearnBusinessRouteStep {
  return {
    label,
    kind,
    file: node.file!,
    classSymbol: node.label,
    methodSymbol,
    communityId: node.communityId,
    relation: kind === 'entry' ? '入口' : kind === 'result' ? '返回' : '调用',
    description: `${node.label}.${methodSymbol} 的业务动作`,
    evidence: `${node.label}.${methodSymbol}(...)`,
    inputs: kind === 'entry' ? ['Request'] : [],
    outputs: kind === 'result' ? ['Response'] : [],
    stateChanges: kind === 'state' ? ['pending -> saved'] : [],
    failurePaths: kind === 'decision' ? ['校验失败直接返回'] : [],
    nodeId: node.id,
  };
}

const nodes: LearnNode[] = [
  ['entry-a', 'EntryA'], ['entry-b', 'EntryB'], ['auth', 'Auth'], ['finish-a', 'FinishA'], ['finish-b', 'FinishB'], ['loop', 'Loop'],
].map(([id, label]) => ({ id, label, kind: 'class', file: `src/${label}.ts`, communityId: '0', degree: 1 }));
const byId = new Map(nodes.map((node) => [node.id, node]));

function route(id: string, label: string, steps: LearnBusinessRouteStep[]): LearnBusinessRoute {
  return { id, label, summary: `${label} summary`, steps };
}

function graphWithRoutes(businessRoutes: LearnBusinessRoute[], visibleNodes = nodes): LearnGraph {
  return {
    nodes: visibleNodes,
    edges: [],
    communities: [{ id: '0', label: '业务', summary: '', files: nodes.map((node) => node.file!), godNodes: [], cohesion: 1, nodeCount: nodes.length }],
    businessRoutes,
    runtimePath: ['0'],
    godNodes: [],
    bridges: [],
    stats: { filesParsed: nodes.length, symbolCount: nodes.length, edgeCount: 0, truncated: false, sourceFingerprint: 'fixture' },
  };
}

const sharedRoutes = [
  route('a', '路线 A', [
    step(byId.get('entry-a')!, 'entry', 'start'),
    step(byId.get('auth')!, 'decision', 'authorize', '鉴权'),
    step(byId.get('finish-a')!, 'result', 'finish'),
  ]),
  route('b', '路线 B', [
    step(byId.get('entry-b')!, 'entry', 'start'),
    step(byId.get('auth')!, 'decision', 'authorize', '鉴权'),
    step(byId.get('finish-b')!, 'result', 'finish'),
  ]),
];

function envelope(routes = sharedRoutes) {
  return {
    communities: [{ id: '0', label: '业务', summary: '业务社区', files: nodes.map((node) => node.file) }],
    businessRoutes: routes.map((item) => ({
      ...item,
      steps: item.steps.map(({ nodeId: _nodeId, ...item }) => item),
    })),
    runtimePath: ['0'],
  };
}

test('v2 learn analysis accepts complete routes and rejects malformed or duplicate data', () => {
  assert.ok(parseLearnAnalysisEnvelope(envelope()));
  assert.equal(parseLearnAnalysisEnvelope({ ...envelope(), businessRoutes: [
    { ...envelope().businessRoutes[0], steps: envelope().businessRoutes[0].steps.map(({ kind: _kind, ...item }) => item) },
  ] }), null);
  assert.equal(parseLearnAnalysisEnvelope({ ...envelope(), businessRoutes: [
    { ...envelope().businessRoutes[0], steps: envelope().businessRoutes[0].steps.map(({ inputs: _inputs, ...item }) => item) },
  ] }), null);
  assert.equal(parseLearnAnalysisEnvelope({ ...envelope(), businessRoutes: [
    envelope().businessRoutes[0], envelope().businessRoutes[0],
  ] }), null);
  assert.equal(parseLearnAnalysisEnvelope({ ...envelope(), runtimePath: ['missing'] }), null);
});

test('front-end parser only accepts closed strict learn-graph fences', () => {
  const text = `\`\`\`learn-graph\n${JSON.stringify(envelope())}\n\`\`\`\n正文`;
  assert.ok(parseLearnOverlay(text));
  assert.equal(parseLearnOverlay(JSON.stringify(envelope())), null);
  assert.equal(parseLearnOverlay(`\`\`\`json\n${JSON.stringify(envelope())}\n\`\`\``), null);
});

test('unmappable route is excluded from the current structural graph', () => {
  const bad = envelope([route('bad', '无法绑定', [
    step(byId.get('entry-a')!, 'entry', 'start'),
    { ...step(byId.get('finish-a')!, 'result', 'finish'), classSymbol: 'MissingClass' },
  ])]);
  const applied = applyLearnAnalysis(graphWithRoutes([]), `\`\`\`learn-graph\n${JSON.stringify(bad)}\n\`\`\``);
  assert.deepEqual(applied.businessRoutes, []);
});

test('business bus merges shared cross-route actions and derives directed edges', () => {
  const bus = buildLearnBusinessBus(graphWithRoutes(sharedRoutes));
  assert.equal(bus.nodes.length, 5);
  assert.equal(bus.edges.length, 4);
  const shared = bus.nodes.find((node) => node.methodSymbol === 'authorize');
  assert.deepEqual(shared?.routeIds, ['a', 'b']);
  assert.equal(shared?.occurrences.length, 2);
  assert.deepEqual(bus.routes.map((item) => item.visibleStepCount), [3, 3]);
  assert.deepEqual(layoutLearnBusinessBus(bus), layoutLearnBusinessBus(bus));
});

test('same method repeated within one route remains separate and never becomes a self-edge', () => {
  const repeated = route('loop-route', '循环路线', [
    step(byId.get('entry-a')!, 'entry', 'start'),
    step(byId.get('loop')!, 'process', 'tick', '第一次执行'),
    step(byId.get('loop')!, 'process', 'tick', '第二次执行'),
    step(byId.get('finish-a')!, 'result', 'finish'),
  ]);
  const bus = buildLearnBusinessBus(graphWithRoutes([repeated]));
  assert.equal(bus.nodes.filter((node) => node.methodSymbol === 'tick').length, 2);
  assert.equal(bus.edges.length, 3);
  assert.equal(bus.edges.some((edge) => edge.source === edge.target), false);
});

test('hidden middle step creates a gap instead of an invented shortcut', () => {
  const visible = nodes.filter((node) => node.id !== 'auth');
  const bus = buildLearnBusinessBus(graphWithRoutes([sharedRoutes[0]], visible));
  assert.equal(bus.routes[0].visibleStepCount, 2);
  assert.deepEqual(bus.routes[0].nodeIds.map(Boolean), [true, false, true]);
  assert.deepEqual(bus.edges, []);
});

test('manual graph expansion appends only new bound routes and serializes the combined graph', () => {
  const base = graphWithRoutes([sharedRoutes[0]]);
  const supplement = envelope([sharedRoutes[1]]);
  const result = mergeLearnGraphExpansion(base, `\`\`\`learn-graph\n${JSON.stringify(supplement)}\n\`\`\``);
  assert.equal(result.hasOverlay, true);
  assert.deepEqual(result.addedRoutes.map((item) => item.id), ['b']);
  assert.deepEqual(result.graph.businessRoutes.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(base.businessRoutes.map((item) => item.id), ['a']);

  const persisted = serializeLearnGraphReport(result.graph, '原始讲解');
  const restored = applyLearnAnalysis(graphWithRoutes([]), persisted);
  assert.deepEqual(restored.businessRoutes.map((item) => item.id), ['a', 'b']);
  assert.equal(persisted.endsWith('原始讲解'), true);
});

test('manual graph expansion rejects duplicate and unmappable routes without changing the graph', () => {
  const base = graphWithRoutes([sharedRoutes[0]]);
  const duplicate = mergeLearnGraphExpansion(base,
    `\`\`\`learn-graph\n${JSON.stringify(envelope([sharedRoutes[0]]))}\n\`\`\``);
  assert.deepEqual(duplicate.duplicateRouteLabels, ['路线 A']);
  assert.equal(duplicate.graph, base);

  const missingRoute = route('missing', '无法绑定', [
    step(byId.get('entry-b')!, 'entry', 'start'),
    { ...step(byId.get('finish-b')!, 'result', 'finish'), classSymbol: 'MissingClass' },
  ]);
  const invalid = mergeLearnGraphExpansion(base,
    `\`\`\`learn-graph\n${JSON.stringify(envelope([missingRoute]))}\n\`\`\``);
  assert.deepEqual(invalid.invalidRouteLabels, ['无法绑定']);
  assert.equal(invalid.graph, base);
});

test('manual graph expansion prompt requires supplemental graph data while normal questions stay prose-only', () => {
  const existingBusinessRoutes = [{
    id: 'a',
    label: '路线 A',
    steps: sharedRoutes[0].steps.map(({ file, classSymbol, methodSymbol, kind }) => ({
      file, classSymbol, methodSymbol, kind,
    })),
  }];
  const expansion = {
    scopeType: 'repo' as const,
    task: 'learn' as const,
    userPrompt: '补充管理流程',
    learnRequestMode: 'expand_graph' as const,
    existingBusinessRoutes,
    graphDigest: 'EXTRACTED',
  };
  assert.match(buildLearnSystemPrompt(expansion), /手动补充业务总线/);
  assert.match(buildLearnSystemPrompt(expansion), /只能包含本轮新增路线/);
  assert.match(buildLearnUserMessage(expansion), /路线 A/);
  assert.match(buildLearnUserMessage(expansion), /补充管理流程/);

  const questionSystem = buildLearnSystemPrompt({ ...expansion, learnRequestMode: 'question' });
  assert.match(questionSystem, /禁止输出 JSON/);
  assert.doesNotMatch(questionSystem, /手动补充业务总线/);
});
