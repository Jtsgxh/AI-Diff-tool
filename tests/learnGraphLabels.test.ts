import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeLearnGraphLabels, type LearnGraphLabel } from '../src/utils/learnGraphLabels';

const viewport = { x: 0, y: 0, width: 300, height: 120 };
const label = (text: string, priority: number, x: number, y: number): LearnGraphLabel => ({
  text, priority, width: 100, height: 20, positions: [{ x, y }],
  color: '#fff', alpha: 1, font: '10px sans-serif',
});

test('selected class labels take precedence over overlapping relation labels', () => {
  const labels = [label('入 · 引用', 10, 0, 0), label('BaseScene', 110, 0, 0)];
  assert.deepEqual(placeLearnGraphLabels(labels, viewport).map((item) => item.text), ['BaseScene']);
});

test('labels try alternative positions without mutating input or overlapping badges', () => {
  const labels = [label('first', 80, 0, 0), {
    ...label('second', 70, 0, 0), positions: [{ x: 0, y: 0 }, { x: 0, y: 30 }, { x: 110, y: 30 }],
  }];
  const before = structuredClone(labels);
  const placed = placeLearnGraphLabels(labels, viewport, [{ x: 0, y: 30, width: 100, height: 20 }]);
  assert.deepEqual(placed.map(({ text, x, y }) => ({ text, x, y })), [
    { text: 'first', x: 0, y: 0 }, { text: 'second', x: 110, y: 30 },
  ]);
  assert.deepEqual(labels, before);
});

test('viewport and spatial-cell boundaries still prevent overlapping labels', () => {
  const placed = placeLearnGraphLabels([
    label('outside', 120, -10, 0), label('across cells', 110, 60, 0),
    label('overlap', 100, 130, 0), label('below', 90, 60, 30),
  ], viewport);
  assert.deepEqual(placed.map((item) => item.text), ['across cells', 'below']);
});
