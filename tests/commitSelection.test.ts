import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillContiguousCommitSelection } from '../src/utils/commitSelection';

const commits = ['newest', 'middle-1', 'middle-2', 'oldest'];

test('fills every commit between non-adjacent selections', () => {
  assert.deepEqual(
    fillContiguousCommitSelection(commits, ['newest', 'oldest']),
    commits
  );
});

test('removing an interior commit cannot create a gap', () => {
  const selected = new Set(commits.slice(0, 3));
  selected.delete('middle-1');
  assert.deepEqual(
    fillContiguousCommitSelection(commits, selected),
    ['newest', 'middle-1', 'middle-2']
  );
});

test('removing an edge shrinks the contiguous interval', () => {
  assert.deepEqual(
    fillContiguousCommitSelection(commits, ['middle-1', 'middle-2']),
    ['middle-1', 'middle-2']
  );
});

test('ignores hashes outside the current commit history', () => {
  assert.deepEqual(fillContiguousCommitSelection(commits, ['missing']), []);
});
