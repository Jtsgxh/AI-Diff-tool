import assert from 'node:assert/strict';
import test from 'node:test';
import { computeGraphLayout } from '../src/utils/graphLayout';
import type { CommitNode } from '../src/types';

const commit = (hash: string, parents: string[] = []): CommitNode => ({
  hash, parents, shortHash: hash, author: 'Test', authorEmail: '', date: '', message: hash, refs: [],
});

test('repeated merged branches release shared-ancestor lanes instead of leaving ghost tracks', () => {
  const commits: CommitNode[] = [];
  for (let i = 0; i < 20; i++) {
    commits.push(commit(`merge${i}`, [`left${i}`, `right${i}`]));
    commits.push(commit(`left${i}`, [`merge${i + 1}`]));
    commits.push(commit(`right${i}`, [`merge${i + 1}`]));
  }
  commits.push(commit('merge20'));
  const graph = computeGraphLayout(commits);
  assert.equal(graph.maxColumns, 2);
  assert.deepEqual(graph.nodes.filter((n) => n.hash.startsWith('merge')).map((n) => n.column), Array(21).fill(0));
  assert.deepEqual(graph.nodes.map((n) => n.parents), commits.map((n) => n.parents));
});

test('simultaneously pending independent parents retain distinct lanes', () => {
  const graph = computeGraphLayout([
    commit('merge', ['a', 'b', 'c']), commit('a', ['root']),
    commit('b', ['root']), commit('c', ['root']), commit('root'),
  ]);
  assert.deepEqual(graph.nodes.map((n) => n.column), [0, 0, 1, 2, 0]);
  assert.equal(graph.maxColumns, 3);
});

test('truncated or filtered history does not reserve lanes for unrendered parents', () => {
  const graph = computeGraphLayout([
    commit('a', ['outside1', 'outside2']), commit('b', ['outside3']), commit('c'),
  ]);
  assert.deepEqual(graph.nodes.map((n) => n.column), [0, 0, 0]);
  assert.equal(graph.maxColumns, 1);
});
