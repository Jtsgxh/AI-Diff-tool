import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_AGENT_MAX_TURNS,
  resolveAgentMaxTurns,
} from '../shared/types';
import { aiCache } from '../src/services/aiCache';

test('agent turn settings preserve the finite default and explicit unlimited mode', () => {
  assert.equal(resolveAgentMaxTurns(undefined), DEFAULT_AGENT_MAX_TURNS);
  assert.equal(resolveAgentMaxTurns(0), DEFAULT_AGENT_MAX_TURNS);
  assert.equal(resolveAgentMaxTurns(Number.NaN), DEFAULT_AGENT_MAX_TURNS);
  assert.equal(resolveAgentMaxTurns(-5), DEFAULT_AGENT_MAX_TURNS);
  assert.equal(resolveAgentMaxTurns(20), 20);
  assert.equal(resolveAgentMaxTurns(30.9), 30);
  assert.equal(resolveAgentMaxTurns(null), null);
});

test('agent review caches distinguish different turn ceilings', () => {
  const keyFor = (maxTurns: number | null | undefined) =>
    aiCache.generateKey({
      type: 'file',
      filePath: 'src/example.ts',
      diff: '+changed',
      engineMode: 'agent',
      model: 'test-model',
      agentMaxTurns: resolveAgentMaxTurns(maxTurns),
    });

  assert.equal(keyFor(undefined), keyFor(0));
  assert.notEqual(keyFor(10), keyFor(20));
  assert.notEqual(keyFor(20), keyFor(30));
  assert.notEqual(keyFor(30), keyFor(null));
});
