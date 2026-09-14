import { STORAGE_KEYS, storage } from '../constants/storage';
import type { DiffViewMode, SelectionState } from '../types';

export interface WorkspaceState {
  selection?: SelectionState;
  selectedFilePath: string | null;
  mobilePane: 'history' | 'files' | 'code' | 'ai';
  workspaceMode: 'diff' | 'learn';
  viewMode: DiffViewMode;
  displayMode: 'diff' | 'file';
  wrapLines: boolean;
  positions: Record<string, { top: number; left: number }>;
}

const defaults = (): WorkspaceState => ({ selectedFilePath: null, mobilePane: 'history', workspaceMode: 'diff', viewMode: 'split', displayMode: 'diff', wrapLines: true, positions: {} });
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{7,64}$/i.test(value);

function selectionFrom(value: unknown): SelectionState | undefined {
  if (!isRecord(value)) return;
  if (value.type === 'working-tree') return { type: 'working-tree' };
  if (value.type === 'commit' && validHash(value.commitHash)) return { type: 'commit', commitHash: value.commitHash };
  if (value.type === 'compare' && validHash(value.baseHash) && validHash(value.targetHash)) return { type: 'compare', baseHash: value.baseHash, targetHash: value.targetHash };
  if (value.type === 'batch' && Array.isArray(value.commitHashes) && value.commitHashes.length > 0 && value.commitHashes.length <= 100 && value.commitHashes.every(validHash)) {
    return { type: 'batch', commitHashes: [...new Set(value.commitHashes)], batchTitle: `批量合并 [${new Set(value.commitHashes).size} 个提交]` };
  }
}

const repoKey = (path: string) => path.replace(/\\/g, '/').replace(/\/$/, '');
function readEntries(): [string, unknown][] {
  const saved = storage.getJson<unknown>(STORAGE_KEYS.workspaceState, []);
  return Array.isArray(saved) ? saved.filter((entry): entry is [string, unknown] => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string').slice(-10) : [];
}

export function readWorkspace(path: string): WorkspaceState {
  const state = defaults();
  const value = new Map(readEntries()).get(repoKey(path));
  if (!isRecord(value)) return state;
  state.selection = selectionFrom(value.selection);
  if (typeof value.selectedFilePath === 'string') state.selectedFilePath = value.selectedFilePath;
  if (value.mobilePane === 'files' || value.mobilePane === 'code' || value.mobilePane === 'ai') state.mobilePane = value.mobilePane;
  if (value.workspaceMode === 'learn') state.workspaceMode = 'learn';
  if (value.viewMode === 'unified' || value.viewMode === 'natural') state.viewMode = value.viewMode;
  if (value.displayMode === 'file') state.displayMode = 'file';
  if (typeof value.wrapLines === 'boolean') state.wrapLines = value.wrapLines;
  if (isRecord(value.positions)) {
    for (const [key, position] of Object.entries(value.positions).slice(-20)) {
      if (isRecord(position) && typeof position.top === 'number' && Number.isFinite(position.top) && position.top >= 0 && typeof position.left === 'number' && Number.isFinite(position.left) && position.left >= 0) {
        state.positions[key] = { top: position.top, left: position.left };
      }
    }
  }
  return state;
}

/** Small, bounded navigation records only; no source code or model credentials. */
export function updateWorkspace(path: string, patch: Partial<WorkspaceState>) {
  const key = repoKey(path);
  const entries = readEntries().filter(([entryKey]) => entryKey !== key);
  entries.push([key, { ...readWorkspace(path), ...patch }]);
  storage.setJson(STORAGE_KEYS.workspaceState, entries.slice(-10));
}

export function saveReadingPosition(path: string, key: string, position: { top: number; left: number }) {
  const positions = Object.entries(readWorkspace(path).positions).filter(([entryKey]) => entryKey !== key);
  positions.push([key, position]);
  updateWorkspace(path, { positions: Object.fromEntries(positions.slice(-20)) });
}

export function selectionKey(selection: SelectionState): string {
  return JSON.stringify([selection.type, selection.commitHash, selection.baseHash, selection.targetHash, selection.commitHashes]);
}
