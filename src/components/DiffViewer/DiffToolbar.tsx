import React from 'react';
import {
  AlignJustify,
  ArrowDown,
  ArrowUp,
  Brain,
  CheckSquare,
  Columns,
  FileCode,
  FileDiff,
  FileText,
  Sparkles,
  Square,
  Zap,
} from 'lucide-react';
import type { DiffFile, DiffViewMode } from '../../types';
import { ActionMenu } from '../common/ActionMenu';

interface DiffToolbarProps {
  compact?: boolean;
  wrapLines?: boolean;
  onToggleWrapLines?: () => void;
  file: DiffFile;
  hunkCount: number;
  selectedCount: number;
  viewMode: DiffViewMode;
  displayMode: 'diff' | 'file';
  defaultMode: 'agent' | 'fast';
  isPseudocodeActive: boolean;
  isPseudocodeLoading: boolean;
  onToggleSelectAll: () => void;
  onToggleGlobalPseudocode: () => void;
  onSetDefaultMode: (mode: 'agent' | 'fast') => void;
  onExplainFile: () => void;
  onToggleViewMode: (mode: DiffViewMode) => void;
  onDisplayMode: (mode: 'diff' | 'file') => void;
  currentHunkNumber: number;
  canJumpToPreviousHunk: boolean;
  canJumpToNextHunk: boolean;
  onJumpToPreviousHunk: () => void;
  onJumpToNextHunk: () => void;
}

/** Header strip above the diff. Memoized: it must not repaint per streamed token. */
export const DiffToolbar = React.memo<DiffToolbarProps>(
  ({
    compact = false,
    wrapLines = false,
    onToggleWrapLines,
    file,
    hunkCount,
    selectedCount,
    viewMode,
    displayMode,
    defaultMode,
    isPseudocodeActive,
    isPseudocodeLoading,
    onToggleSelectAll,
    onToggleGlobalPseudocode,
    onSetDefaultMode,
    onExplainFile,
    onToggleViewMode,
    onDisplayMode,
    currentHunkNumber,
    canJumpToPreviousHunk,
    canJumpToNextHunk,
    onJumpToPreviousHunk,
    onJumpToNextHunk,
  }) => {
    const allSelected = selectedCount === hunkCount && hunkCount > 0;

    if (compact) return <div className="mobile-diff-toolbar shrink-0 border-b border-black/15 bg-white text-xs">
      <div className="flex items-center justify-between gap-1 px-2">
        <button onClick={() => onDisplayMode(displayMode === 'diff' ? 'file' : 'diff')} disabled={displayMode === 'diff' && !file.previewSource} className="px-2">{displayMode === 'diff' ? '看全文' : '看差异'}</button>
        <div className="flex items-center">
          <button aria-label="上一处差异" disabled={!canJumpToPreviousHunk} onClick={onJumpToPreviousHunk}><ArrowUp className="h-4 w-4" /></button>
          <span className="font-mono">{currentHunkNumber}/{hunkCount}</span>
          <button aria-label="下一处差异" disabled={!canJumpToNextHunk} onClick={onJumpToNextHunk}><ArrowDown className="h-4 w-4" /></button>
        </div>
        <button className="px-2 font-semibold text-sky-800" onClick={onExplainFile}>AI 解释</button>
        <ActionMenu label="文件的更多操作">
            <div className="border-b border-[var(--border-subtle)] px-2 py-2">
              <p className="break-all font-mono text-[11px]">{file.newPath}</p>
              <p className="mt-1"><span className="text-emerald-700">+{file.additions}</span> <span className="text-rose-700">-{file.deletions}</span></p>
            </div>
            <button className="px-2 text-left" aria-label="代码自动换行" aria-pressed={wrapLines} onClick={onToggleWrapLines}>{wrapLines ? '自动换行 ✓' : '自动换行'}</button>
            <button onClick={onToggleSelectAll} className="px-2 text-left">{allSelected ? '取消全选改动块' : '选择全部改动块'}</button>
            <button onClick={onToggleGlobalPseudocode} className="px-2 text-left">{isPseudocodeActive ? '关闭 AI 伪代码' : '开启 AI 伪代码'}{isPseudocodeLoading ? '（生成中）' : ''}</button>
            <label className="px-2 py-2">解释模式
              <select aria-label="解释模式" className="mt-1 w-full rounded border border-black/15 p-2" value={defaultMode} onChange={(e) => onSetDefaultMode(e.target.value as 'agent' | 'fast')}>
                <option value="agent">关联解释（Codex）</option><option value="fast">直接 Diff</option>
              </select>
            </label>
        </ActionMenu>
      </div>
    </div>;

    return (
      <div className="h-11 bg-[var(--surface-panel)] border-b border-[var(--border-subtle)] px-3 flex items-center justify-between select-none shrink-0 gap-2 overflow-x-auto">
        <div className="flex items-center space-x-2 min-w-0 shrink">
          <FileCode className="w-4 h-4 text-zinc-700 shrink-0" />
          <span
            className="font-mono text-xs font-medium text-zinc-900 truncate max-w-[160px] md:max-w-[260px] lg:max-w-[360px]"
            title={file.newPath}
          >
            {file.newPath}
          </span>
          <span className="text-[11px] text-emerald-700 font-mono shrink-0">+{file.additions}</span>
          <span className="text-[11px] text-rose-700 font-mono shrink-0">-{file.deletions}</span>
          <span className="text-[11px] bg-black/[0.06] text-zinc-700 px-1.5 py-0.5 rounded font-mono shrink-0 hidden sm:inline-block">
            {hunkCount} 块
          </span>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <div className="flex items-center bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-md p-0.5 text-xs shrink-0 whitespace-nowrap">
            <button
              onClick={() => onDisplayMode('diff')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md transition font-medium ${
                displayMode === 'diff'
                  ? 'bg-[var(--surface-selected)] text-zinc-950 shadow-none'
                  : 'text-zinc-700 hover:text-zinc-900'
              }`}
              title="查看代码差异"
            >
              <FileDiff className="w-3 h-3" />
              <span>Diff</span>
            </button>
            <button
              onClick={() => onDisplayMode('file')}
              disabled={!file.previewSource}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md transition font-medium disabled:opacity-40 disabled:cursor-not-allowed ${
                displayMode === 'file'
                  ? 'bg-[var(--surface-selected)] text-zinc-950 shadow-none'
                  : 'text-zinc-700 hover:text-zinc-900'
              }`}
              title={file.previewSource ? '展开完整文件上下文，并保留 Diff 增删高亮' : '该文件没有可展开的版本'}
            >
              <FileText className="w-3 h-3" />
              <span>全文件</span>
            </button>
          </div>

          {displayMode === 'file' && hunkCount > 0 && (
            <div className="flex items-center bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-md p-0.5 text-xs shrink-0 whitespace-nowrap">
              <button
                type="button"
                onClick={onJumpToPreviousHunk}
                disabled={!canJumpToPreviousHunk}
                aria-label="上一处差异"
                className="p-1 rounded-md text-zinc-700 hover:text-zinc-950 hover:bg-[var(--surface-hover)] transition disabled:opacity-35 disabled:cursor-not-allowed"
                title="跳到上一处差异"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <span className="px-1.5 min-w-14 text-center font-mono text-[11px] text-zinc-700">
                差异 {currentHunkNumber}/{hunkCount}
              </span>
              <button
                type="button"
                onClick={onJumpToNextHunk}
                disabled={!canJumpToNextHunk}
                aria-label="下一处差异"
                className="p-1 rounded-md text-zinc-700 hover:text-zinc-950 hover:bg-[var(--surface-hover)] transition disabled:opacity-35 disabled:cursor-not-allowed"
                title="跳到下一处差异"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {hunkCount > 1 && (
            <button
              onClick={onToggleSelectAll}
              className="text-xs text-zinc-700 hover:text-zinc-800 transition flex items-center gap-1 shrink-0 whitespace-nowrap px-1"
              title="多选当前文件的所有改动块"
            >
              {allSelected ? (
                <>
                  <CheckSquare className="w-3.5 h-3.5 text-zinc-700 shrink-0" />
                  <span>已全选</span>
                </>
              ) : (
                <>
                  <Square className="w-3.5 h-3.5 shrink-0" />
                  <span>多选块</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={onToggleGlobalPseudocode}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition border shrink-0 whitespace-nowrap ${
              isPseudocodeActive
                ? 'bg-[var(--surface-selected)] text-zinc-950 border-[var(--border-subtle)] shadow-none'
                : 'bg-[var(--surface-raised)] hover:bg-[var(--surface-hover)] text-zinc-800 border-[var(--border-subtle)] hover:text-zinc-950'
            }`}
            title={
              isPseudocodeActive
                ? '点击关闭全部伪代码，恢复显示原始代码'
                : '将 Diff 改动代码直接替换为高度提炼概括的中文自然语言伪代码'
            }
          >
            <Sparkles
              className={`w-3.5 h-3.5 shrink-0 ${
                isPseudocodeLoading
                  ? 'animate-spin text-zinc-800'
                  : 'text-zinc-700'
              }`}
            />
            <span>
              {isPseudocodeActive
                ? isPseudocodeLoading
                  ? 'AI 转换中...'
                  : '🔤 伪代码 [开]'
                : '🔤 伪代码'}
            </span>
          </button>

          {/* Default engine for per-hunk and per-file explanations */}
          <div className="flex items-center bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-md p-0.5 text-xs shrink-0 whitespace-nowrap">
            <button
              onClick={() => onSetDefaultMode('agent')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md transition font-medium whitespace-nowrap shrink-0 ${
                defaultMode === 'agent'
                  ? 'bg-[var(--surface-selected)] text-zinc-950 shadow-none'
                  : 'text-zinc-700 hover:text-zinc-900'
              }`}
              title="默认模式：关联解释（Codex Agent 自主全库探查）"
            >
              <Brain className="w-3 h-3 shrink-0" />
              <span>关联解释</span>
            </button>
            <button
              onClick={() => onSetDefaultMode('fast')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md transition font-medium whitespace-nowrap shrink-0 ${
                defaultMode === 'fast'
                  ? 'bg-amber-600 text-white shadow-none'
                  : 'text-zinc-700 hover:text-zinc-900'
              }`}
              title="默认模式：直接 Diff 解释（仅看增删改动）"
            >
              <Zap className="w-3 h-3 shrink-0" />
              <span>直接 Diff</span>
            </button>
          </div>

          <button
            onClick={onExplainFile}
            className={`flex items-center space-x-1.5 text-xs font-medium px-2.5 py-1 rounded-md shadow transition shrink-0 whitespace-nowrap ${
              defaultMode === 'agent'
                ? 'bg-[var(--surface-selected)] hover:bg-[var(--surface-hover)] text-zinc-950'
                : 'bg-amber-600 hover:bg-amber-500 text-white'
            }`}
            title={`使用当前「${defaultMode === 'agent' ? '文件关联模式' : '直接 Diff 模式'}」审查整个文件`}
          >
            {defaultMode === 'agent' ? (
              <Brain className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Zap className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{defaultMode === 'agent' ? 'Codex 解释此文件' : '解释此文件'}</span>
          </button>

          <div className="flex items-center bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-md p-0.5 space-x-0.5 shrink-0 whitespace-nowrap">
            <button
              onClick={() => onToggleViewMode('split')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md text-xs transition whitespace-nowrap shrink-0 ${
                viewMode === 'split'
                  ? 'bg-[var(--surface-selected)] text-zinc-950 font-medium shadow-none'
                  : 'text-zinc-700 hover:text-zinc-900'
              }`}
              title="双栏代码对比 (Side-by-Side Split Diff)"
            >
              <Columns className="w-3 h-3 shrink-0" />
              <span>Split</span>
            </button>
            <button
              onClick={() => onToggleViewMode('unified')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md text-xs transition whitespace-nowrap shrink-0 ${
                viewMode === 'unified'
                  ? 'bg-[var(--surface-selected)] text-zinc-950 font-medium shadow-none'
                  : 'text-zinc-700 hover:text-zinc-900'
              }`}
              title="单栏内联代码对比 (Inline Unified Diff)"
            >
              <AlignJustify className="w-3 h-3 shrink-0" />
              <span>Unified</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
);

DiffToolbar.displayName = 'DiffToolbar';
