import React from 'react';
import type { CommitNode, SelectionState } from '../../types';
import { useCommitRangeSelection } from '../../hooks/useCommitRangeSelection';

interface MobileCommitListProps {
  commits: CommitNode[];
  commitOrder: string[];
  selection: SelectionState;
  searchTerm: string;
  onSearch: (term: string) => void;
  onSelectCommit: (hash: string) => void;
  onSelectBatchCommits: (hashes: string[]) => void;
}

/** Pick endpoints first; fetch the consolidated diff only after confirmation. */
export function MobileCommitList({ commits, commitOrder, selection, searchTerm, onSearch, onSelectCommit, onSelectBatchCommits }: MobileCommitListProps) {
  const rangeSelection = useCommitRangeSelection(commitOrder);
  const { active: rangeMode, endpoints, hashes: range, toggle: toggleRangeMode } = rangeSelection;
  const pick = (hash: string) => {
    if (!rangeMode) { onSelectCommit(hash); return; }
    rangeSelection.pick(hash);
  };
  const applyRange = () => {
    if (endpoints.length !== 2) return;
    onSelectBatchCommits(range);
    rangeSelection.reset();
  };
  return <section className="flex h-full min-h-0 flex-col bg-white" aria-label="提交历史">
    <div className="shrink-0 border-b border-[var(--border-subtle)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">提交历史 <span className="text-zinc-500">{commitOrder.length}</span></h2>
        <button className="px-2 text-xs text-sky-800" aria-pressed={rangeMode} onClick={toggleRangeMode}>{rangeMode ? '取消范围选择' : '选范围'}</button>
      </div>
      <input aria-label="搜索提交" value={searchTerm} onChange={(e) => onSearch(e.target.value)} placeholder="搜索提交、作者或 SHA" className="w-full rounded-lg border border-[var(--border-subtle)] bg-zinc-50 px-3 py-2 text-sm" />
      {rangeMode && <div className="mt-2 text-xs text-zinc-600" aria-live="polite">
        <p>{endpoints.length === 0 ? '先点一个提交作为起点，再点终点。' : endpoints.length === 1 ? '已选起点，再点一个提交作为终点。' : `已选 ${range.length} 个连续提交，包含起点和终点。`}</p>
        {endpoints.length > 0 && <span className="mt-1 block font-mono">{endpoints.map((hash) => hash.slice(0, 7)).join(' → ')}</span>}
        {searchTerm && <p className="mt-1">区间包含被搜索隐藏的中间提交。</p>}
      </div>}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {commits.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">{commitOrder.length ? '没有匹配的提交' : '暂无提交，可从菜单查看未提交变更'}</p>}
      {commits.map((commit) => {
        const selected = rangeMode ? range.includes(commit.hash) : selection.type === 'commit' ? selection.commitHash === commit.hash : selection.type === 'batch' && selection.commitHashes?.includes(commit.hash);
        const endpointIndex = endpoints.indexOf(commit.hash);
        return <button key={commit.hash} onClick={() => pick(commit.hash)} aria-pressed={rangeMode ? !!selected : undefined} aria-current={!rangeMode && selected ? 'true' : undefined} className={`block w-full border-b border-[var(--border-subtle)] px-4 py-3 text-left ${selected ? 'bg-sky-50' : ''}`}>
          {rangeMode && <span className="mb-1 block text-xs text-sky-800">{endpointIndex === 0 ? '起点' : endpointIndex === 1 ? '终点' : selected ? '区间内' : '未选择'}</span>}
          <span className="block break-words text-sm font-medium leading-6">{commit.message}</span>
          <span className="mt-1 flex items-center justify-between gap-3 text-xs text-zinc-500"><span className="truncate">{commit.author}</span><span className="font-mono">{commit.shortHash}</span></span>
          {commit.refs.length > 0 && <span className="mt-1 block truncate text-xs text-emerald-700">{commit.refs.join(' · ')}</span>}
        </button>;
      })}
    </div>
    {rangeMode && <div className="shrink-0 border-t border-[var(--border-subtle)] bg-white p-2">
      <button disabled={endpoints.length !== 2} onClick={applyRange} className="w-full rounded-lg bg-[var(--accent)] px-3 text-sm text-white">查看选中 {range.length} 个提交</button>
    </div>}
  </section>;
}
