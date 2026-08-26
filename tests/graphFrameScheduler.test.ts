import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGraphFrameScheduler } from '../src/utils/graphFrameScheduler';

function fixture(draw: () => boolean) {
  let nextId = 0;
  const queue = new Map<number, FrameRequestCallback>();
  const scheduler = createGraphFrameScheduler(draw, (callback) => {
    queue.set(++nextId, callback);
    return nextId;
  }, (id) => { queue.delete(id); });
  const frame = () => {
    const callbacks = [...queue.values()];
    queue.clear();
    callbacks.forEach((callback) => callback(0));
  };
  return { scheduler, queue, frame };
}

test('idle graph draws only on invalidation and coalesces pointer events', () => {
  let draws = 0;
  const { scheduler, queue, frame } = fixture(() => { draws++; return false; });
  for (let i = 0; i < 100; i++) scheduler.invalidate();
  assert.equal(queue.size, 1);
  frame();
  assert.equal(draws, 1);
  assert.equal(queue.size, 0);
  scheduler.invalidate();
  frame();
  assert.equal(draws, 2);
  assert.equal(queue.size, 0);
});

test('layout animates until finished, then stops without losing a later update', () => {
  let remaining = 3;
  const { scheduler, queue, frame } = fixture(() => --remaining > 0);
  scheduler.invalidate();
  frame();
  frame();
  assert.equal(queue.size, 1);
  frame();
  assert.equal(queue.size, 0);
  remaining = 1;
  scheduler.invalidate();
  frame();
  assert.equal(remaining, 0);
});

test('closing a panel pauses; reopening resumes; unmount cannot reschedule', () => {
  let draws = 0;
  const { scheduler, queue, frame } = fixture(() => { draws++; return true; });
  scheduler.invalidate();
  scheduler.pause();
  frame();
  assert.equal(draws, 0);
  scheduler.invalidate();
  frame();
  assert.equal(draws, 1);
  scheduler.dispose();
  scheduler.invalidate();
  frame();
  assert.equal(queue.size, 0);
  assert.equal(draws, 1);
});
