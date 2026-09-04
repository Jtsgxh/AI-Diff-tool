import assert from 'node:assert/strict';
import test from 'node:test';
import { expandDiffWithFullContext, parseRawDiff } from '../src/utils/diffParser';

const rawDiff = `diff --git a/sample.txt b/sample.txt
--- a/sample.txt
+++ b/sample.txt
@@ -2,3 +2,3 @@
 line 2
-old 3
+new 3
 line 4
@@ -7,3 +7,3 @@
 line 7
-old 8
+new 8
 line 9`;

test('full context keeps change hunks and fills every omitted target line', () => {
  const hunks = parseRawDiff(rawDiff).hunks;
  const content = [
    'line 1',
    'line 2',
    'new 3',
    'line 4',
    'line 5',
    'line 6',
    'line 7',
    'new 8',
    'line 9',
    'line 10',
  ].join('\n');
  const blocks = expandDiffWithFullContext(hunks, content, 'new');

  assert.deepEqual(blocks.map((block) => block.type), [
    'context',
    'change',
    'context',
    'change',
    'context',
  ]);
  assert.equal(blocks.filter((block) => block.type === 'change').length, 2);

  const renderedTarget = blocks.flatMap((block) =>
    block.hunk.lines
      .filter((line) => line.type === 'normal' || line.type === 'add')
      .map((line) => line.content)
  );
  assert.deepEqual(renderedTarget, content.split('\n'));
  assert.equal(
    blocks.flatMap((block) => block.hunk.lines).filter((line) => line.type === 'delete').length,
    2
  );

  const oldContent = content.replace('new 3', 'old 3').replace('new 8', 'old 8');
  const oldBlocks = expandDiffWithFullContext(hunks, oldContent, 'old');
  const renderedSource = oldBlocks.flatMap((block) =>
    block.hunk.lines
      .filter((line) => line.type === 'normal' || line.type === 'delete')
      .map((line) => line.content)
  );
  assert.deepEqual(renderedSource, oldContent.split('\n'));
});

test('a rename-only diff expands to the complete unchanged file', () => {
  const blocks = expandDiffWithFullContext([], 'one\ntwo\nthree\n', 'new');
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].hunk.lines.map((line) => line.content), ['one', 'two', 'three']);
});
