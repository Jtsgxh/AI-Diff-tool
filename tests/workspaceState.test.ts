import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { readWorkspace, saveReadingPosition, updateWorkspace } from '../src/services/workspaceState';
import { STORAGE_KEYS } from '../src/constants/storage';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
} });
beforeEach(() => values.clear());

test('repository state and reading positions are isolated and partial writes preserve other fields', () => {
  updateWorkspace('C:\\repo', { mobilePane: 'code', selectedFilePath: 'second.ts', selection: { type: 'batch', commitHashes: ['a'.repeat(40), 'b'.repeat(40)] } });
  saveReadingPosition('C:/repo', 'file:diff', { top: 420, left: 80 });
  updateWorkspace('C:/repo', { displayMode: 'file' });
  assert.equal(readWorkspace('C:/repo').selectedFilePath, 'second.ts');
  assert.equal(readWorkspace('C:/repo').selection?.commitHashes?.length, 2);
  assert.deepEqual(readWorkspace('C:/repo').positions['file:diff'], { top: 420, left: 80 });
  assert.equal(readWorkspace('C:/other').mobilePane, 'history');
});

test('invalid stored records fall back to usable defaults', () => {
  values.set(STORAGE_KEYS.workspaceState, JSON.stringify([['repo', { mobilePane: 'broken', selection: { type: 'batch', commitHashes: [null] }, positions: { invalid: { top: -1, left: 'bad' } } }]]));
  const state = readWorkspace('repo');
  assert.equal(state.mobilePane, 'history');
  assert.equal(state.selection, undefined);
  assert.deepEqual(state.positions, {});
  values.set(STORAGE_KEYS.workspaceState, '{broken JSON');
  assert.equal(readWorkspace('repo').displayMode, 'diff');
});

test('workspace and file-position history remain bounded', () => {
  for (let i = 0; i < 15; i++) updateWorkspace(`repo${i}`, { mobilePane: 'code' });
  assert.equal(JSON.parse(values.get(STORAGE_KEYS.workspaceState)!).length, 10);
  assert.equal(readWorkspace('repo0').mobilePane, 'history');
  for (let i = 0; i < 30; i++) saveReadingPosition('repo14', `file${i}`, { top: i, left: 0 });
  assert.equal(Object.keys(readWorkspace('repo14').positions).length, 20);
});
