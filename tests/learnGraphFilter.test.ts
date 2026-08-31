import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LearnGraph, LearnNode } from '../src/types';
import { filterLearnTestNodes, isLearnTestNode, learnGraphWithFilteredNodes } from '../src/utils/learnGraphFilter';

test('recognizes test naming parts, casing, numbering and test paths', () => {
  for (const label of ['Test', 'tests', 'TESTS', 'Testing', 'Tester', 'TestCase', 'TESTCASE', 'ServiceTests2',
    'CombatTestPipelineAbilitySpec', 'TestCombat', 'ServiceTest', 'UITests', 'Service_Test', 'Service.test', 'UnitTests']) {
    assert.equal(isLearnTestNode({ label }), true, label);
  }
  for (const file of ['src/test/java/Config.java', 'src/__tests__/Config.ts', 'src/Demo.Tests/Config.cs',
    'src\\Testing\\Config.cs', 'spec/Config.rb', 'src/e2e/Config.ts', 'src/config.spec.ts', 'src/config.test.tsx']) {
    assert.equal(isLearnTestNode({ label: 'Config', file }), true, file);
  }
});

test('keeps production words and domain Spec classes', () => {
  for (const label of ['LatestSnapshot', 'ContestReward', 'Attestation', 'AbilitySpec', 'GameplayEffectSpec', 'Spec', 'Specification']) {
    assert.equal(isLearnTestNode({ label, file: `src/${label}.cs` }), false, label);
  }
  const node: LearnNode = { id: 'a', label: 'Database', file: 'src/Database.ts', communityId: '0', kind: 'class',
    degree: 0, symbols: ['TestConnection', 'RunTest'] };
  assert.equal(isLearnTestNode(node), false);
});

function sourceGraph(): LearnGraph {
  const nodes: LearnNode[] = [
    { id: 'a', label: 'Entry', file: 'src/Entry.cs', communityId: '0', kind: 'class', degree: 2 },
    { id: 't', label: 'CombatTest', file: 'src/CombatTest.cs', communityId: '0', kind: 'class', degree: 4 },
    { id: 'b', label: 'AbilitySpec', file: 'src/AbilitySpec.cs', communityId: '0', kind: 'class', degree: 2 },
    { id: 'h', label: 'Helper', file: 'src/__tests__/Helper.cs', communityId: '1', kind: 'class', degree: 1 },
    { id: 'c', label: 'Contest', file: 'src/Contest.cs', communityId: '2', kind: 'class', degree: 1 },
  ];
  return {
    nodes,
    edges: [['a', 't'], ['t', 'b'], ['a', 'b'], ['t', 'h'], ['t', 'c']].map(([source, target]) => ({ source, target, relation: 'calls' })),
    communities: ['0', '1', '2'].map((id) => ({ id, label: id === '0' ? 'CombatTest' : `社区${id}`, summary: '',
      nodeCount: nodes.filter((node) => node.communityId === id).length,
      files: nodes.filter((node) => node.communityId === id).map((node) => node.file!),
      godNodes: nodes.filter((node) => node.communityId === id).map((node) => node.label), cohesion: 1,
      entry: id === '0' ? { file: 'src/CombatTest.cs', symbol: 'CombatTest' } : undefined,
    })),
    businessRoutes: [{ id: 'route', label: '含测试的路线', summary: '', steps: nodes.slice(0, 3).map((node, index, steps) => ({
      nodeId: node.id, label: node.label, file: node.file!, classSymbol: node.label, methodSymbol: 'run', communityId: node.communityId,
      kind: index === 0 ? 'entry' as const : index === steps.length - 1 ? 'result' as const : 'process' as const,
      relation: '调用', description: '步骤', evidence: 'fixture', inputs: [], outputs: [], stateChanges: [], failurePaths: [],
    })) }],
    runtimePath: ['0', '1', '2'], godNodes: nodes,
    bridges: [{ source: 't', target: 'h', sourceLabel: 'CombatTest', targetLabel: 'Helper',
      sourceCommunity: '0', targetCommunity: '1', relation: 'calls' }],
    stats: { filesParsed: 5, symbolCount: 5, edgeCount: 5, truncated: false, sourceFingerprint: 'original' },
  };
}

test('removes incident edges, updates visible degrees and does not invent shortcuts', () => {
  const source = sourceGraph(), before = structuredClone(source);
  const topology = filterLearnTestNodes(source);
  assert.deepEqual(topology.nodes.map((node) => [node.id, node.degree]), [['a', 1], ['b', 1], ['c', 0]]);
  assert.deepEqual(topology.edges, [source.edges[2]]);
  assert.deepEqual(source, before);
});

test('keeps community grouping but removes test-only communities and detail entries', () => {
  const source = sourceGraph();
  const view = learnGraphWithFilteredNodes(source, filterLearnTestNodes(source));
  assert.deepEqual(view.communities.map((community) => community.id), ['0', '2']);
  assert.equal(view.communities[0].label, 'Entry');
  assert.equal(view.communities[0].nodeCount, 2);
  assert.deepEqual(view.communities[0].files, ['src/Entry.cs', 'src/AbilitySpec.cs']);
  assert.deepEqual(view.communities[0].godNodes, ['Entry', 'AbilitySpec']);
  assert.equal(view.communities[0].entry, undefined);
  assert.equal(view.communities[0].cohesion, 1);
  assert.equal(view.communities[1].cohesion, 0);
  assert.deepEqual(view.runtimePath, ['0', '2']);
  assert.deepEqual(view.bridges, []);
  assert.deepEqual(view.godNodes.map((node) => node.id), ['a', 'b', 'c']);
  assert.equal(view.businessRoutes, source.businessRoutes);
  assert.equal(view.stats, source.stats);
  assert.deepEqual(view.businessRoutes[0].steps.map((step) => step.nodeId), ['a', 't', 'b']);
});

test('streamed AI labels do not invalidate filtered topology or replace business labels', () => {
  const source = sourceGraph();
  const topology = filterLearnTestNodes(source);
  const overlay = { ...source, communities: source.communities.map((community) => ({ ...community, label: 'AI 业务社区' })) };
  const first = learnGraphWithFilteredNodes(source, topology), next = learnGraphWithFilteredNodes(overlay, topology);
  assert.equal(next.nodes, first.nodes);
  assert.equal(next.edges, first.edges);
  assert.equal(next.communities[0].label, 'AI 业务社区');
});

test('empty filtered view keeps original routes available for restoring the filter', () => {
  const source = sourceGraph();
  source.nodes = source.nodes.map((node) => ({ ...node, label: `Test${node.label}` }));
  const view = learnGraphWithFilteredNodes(source, filterLearnTestNodes(source));
  assert.deepEqual(view.nodes, []);
  assert.deepEqual(view.edges, []);
  assert.deepEqual(view.communities, []);
  assert.equal(view.businessRoutes, source.businessRoutes);
  assert.equal(source.nodes.length, 5);
});

test('test-free sources keep their existing array identities and layout reuse', () => {
  const source = sourceGraph();
  source.nodes = source.nodes.filter((node) => !isLearnTestNode(node));
  source.edges = [source.edges[2]];
  const topology = filterLearnTestNodes(source);
  assert.equal(topology.nodes, source.nodes);
  assert.equal(topology.edges, source.edges);
  assert.equal(learnGraphWithFilteredNodes(source, topology), source);
});
