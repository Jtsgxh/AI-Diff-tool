import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LearnNode, LearnEdge } from '../src/types';
import { createLearnCommunityLayout, settleLearnCommunityLayout } from '../src/utils/learnCommunityLayout';

const nodes: LearnNode[] = Array.from({ length: 200 }, (_, index) => ({
  id: `class-${index}`, label: `Class${index}`, kind: 'class',
  communityId: String(Math.floor(index / 40)), degree: index % 17,
}));
const edges: LearnEdge[] = nodes.flatMap((node, index) => [
  { source: node.id, target: nodes[(index + 1) % nodes.length].id, relation: 'calls' },
  { source: node.id, target: nodes[(index + 41) % nodes.length].id, relation: 'inherits' },
]);
const order = ['0', '1', '2', '3', '4'];

test('community layout is complete, deterministic and does not mutate source data', () => {
  const input = structuredClone({ nodes, edges });
  const first = createLearnCommunityLayout(nodes, edges, order, 1280, 680);
  const second = createLearnCommunityLayout(nodes, edges, order, 1280, 680);
  assert.deepEqual(second, first);
  assert.deepEqual({ nodes, edges }, input);
  assert.equal(first.nodes.length, nodes.length);
  assert.equal(new Set(first.nodes.map((node) => node.id)).size, nodes.length);
  for (const node of first.nodes) {
    const box = first.boxes.find((item) => item.id === node.communityId)!;
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y) && node.r > 0);
    assert.ok(Math.abs(node.x - box.x) + node.r < box.width / 2);
    assert.ok(Math.abs(node.y - box.y) + node.r < box.height / 2);
    assert.equal('vx' in node, false);
    assert.equal('homeX' in node, false);
  }
});

test('simplified and rich layouts have independent positions and include every requested class', () => {
  const rich = createLearnCommunityLayout(nodes, edges, order, 1280, 680);
  const before = structuredClone(rich);
  const subset = nodes.filter((_, index) => index % 10 === 0);
  const visibleIds = new Set(subset.map((node) => node.id));
  const simple = createLearnCommunityLayout(subset,
    edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)), order, 1280, 680);
  assert.equal(simple.nodes.length, subset.length);
  assert.equal(simple.boxes.length, 5);
  assert.deepEqual(rich, before);
  assert.ok(simple.boxes[0].width < rich.boxes[0].width);
});

test('changed degree, community assignment and order produce current node metadata and grouping', () => {
  const changed = nodes.map((node, index) => index === 0
    ? { ...node, label: 'ChangedClass', degree: 100, communityId: '4' } : node);
  const layout = createLearnCommunityLayout(changed, edges, [...order].reverse(), 1280, 680);
  const changedNode = layout.nodes.find((node) => node.id === nodes[0].id)!;
  assert.equal(changedNode.label, 'ChangedClass');
  assert.equal(changedNode.degree, 100);
  assert.equal(changedNode.communityId, '4');
  assert.equal(layout.boxes[0].id, '4');
  assert.ok(Math.abs(changedNode.x - layout.boxes[0].x) < layout.boxes[0].width / 2);
});

test('empty graphs and isolated classes need no animation to become drawable', () => {
  assert.deepEqual(createLearnCommunityLayout([], [], order, 1280, 680), { nodes: [], boxes: [] });
  const single = createLearnCommunityLayout([nodes[0]], [], order, 1280, 680);
  assert.equal(single.nodes.length, 1);
  assert.equal(single.boxes.length, 1);
  assert.equal(single.nodes[0].r, 3.5);
});

test('settled layout restores relation-driven positions without changing the graph or input', () => {
  const initial = createLearnCommunityLayout(nodes, edges, order, 1280, 680);
  const before = structuredClone(initial);
  const settled = settleLearnCommunityLayout(initial, edges);
  assert.deepEqual(initial, before);
  assert.deepEqual(settled.boxes, initial.boxes);
  assert.deepEqual(settled.nodes.map((node) => [node.id, node.communityId]), initial.nodes.map((node) => [node.id, node.communityId]));
  assert.ok(settled.nodes.some((node, index) => Math.abs(node.x - initial.nodes[index].x) > 1));
  assert.ok(settled.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y) && !('vx' in node)));
  for (const node of settled.nodes) {
    const box = settled.boxes.find((item) => item.id === node.communityId)!;
    assert.ok(Math.abs(node.x - box.x) + node.r < box.width / 2);
    assert.ok(Math.abs(node.y - box.y) + node.r < box.height / 2);
  }
  assert.deepEqual(settleLearnCommunityLayout(initial, edges), settled);
  assert.deepEqual(settleLearnCommunityLayout({ nodes: [], boxes: [] }, []), { nodes: [], boxes: [] });
});

test('cross-community hub attraction cannot drag a class outside its community', () => {
  const initial = createLearnCommunityLayout(nodes, edges, order, 1280, 680);
  const hubEdges: LearnEdge[] = nodes.slice(40).map((node) => ({
    source: nodes[0].id, target: node.id, relation: 'calls',
  }));
  const settled = settleLearnCommunityLayout(initial, [...edges, ...hubEdges]);
  for (const node of settled.nodes) {
    const box = settled.boxes.find((item) => item.id === node.communityId)!;
    assert.ok(Math.abs(node.x - box.x) + node.r < box.width / 2);
    assert.ok(Math.abs(node.y - box.y) + node.r < box.height / 2);
  }
});
