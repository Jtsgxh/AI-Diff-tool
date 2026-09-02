import React from 'react';
import {
  AlignJustify,
  Brain,
  CheckSquare,
  Columns,
  FileCode,
  Sparkles,
  Square,
  Zap,
} from 'lucide-react';
import type { DiffFile, DiffViewMode } from '../../types';

interface DiffToolbarProps {
  file: DiffFile;
  hunkCount: number;
  selectedCount: number;
  viewMode: DiffViewMode;
  defaultMode: 'agent' | 'fast';
  isPseudocodeActive: boolean;
  isPseudocodeLoading: boolean;
  onToggleSelectAll: () => void;
  onToggleGlobalPseudocode: () => void;
  onSetDefaultMode: (mode: 'agent' | 'fast') => void;
  onExplainFile: () => void;
  onToggleViewMode: (mode: DiffViewMode) => void;
}

/** Header strip above the diff. Memoized: it must not repaint per streamed token. */
export const DiffToolbar = React.memo<DiffToolbarProps>(
  ({
    file,
    hunkCount,
    selectedCount,
    viewMode,
    defaultMode,
    isPseudocodeActive,
    isPseudocodeLoading,
    onToggleSelectAll,
    onToggleGlobalPseudocode,
    onSetDefaultMode,
    onExplainFile,
    onToggleViewMode,
  }) => {
    const allSelected = selectedCount === hunkCount && hunkCount > 0;

    return (
      <div className="h-11 bg-[var(--surface-panel)] border-b border-black/10 px-3 flex items-center justify-between select-none shrink-0 gap-2 overflow-x-auto">
        <div className="flex items-center space-x-2 min-w-0 shrink">
          <FileCode className="w-4 h-4 text-zinc-600 shrink-0" />
          <span
            className="font-mono text-xs font-semibold text-zinc-900 truncate max-w-[160px] md:max-w-[260px] lg:max-w-[360px]"
            title={file.newPath}
          >
            {file.newPath}
          </span>
          <span className="text-[11px] text-emerald-700 font-mono shrink-0">+{file.additions}</span>
          <span className="text-[11px] text-rose-700 font-mono shrink-0">-{file.deletions}</span>
          <span className="text-[11px] bg-black/[0.03] text-zinc-600 px-1.5 py-0.5 rounded font-mono shrink-0 hidden sm:inline-block">
            {hunkCount} 块
          </span>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          {hunkCount > 1 && (
            <button
              onClick={onToggleSelectAll}
              className="text-xs text-zinc-600 hover:text-zinc-700 transition flex items-center gap-1 shrink-0 whitespace-nowrap px-1"
              title="多选当前文件的所有改动块"
            >
              {allSelected ? (
                <>
                  <CheckSquare className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
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
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition border shrink-0 whitespace-nowrap ${
              isPseudocodeActive
                ? 'bg-zinc-900 text-white border-zinc-900 shadow-sm'
                : 'bg-[var(--surface-raised)] hover:bg-[#E9E9E6] text-zinc-700 border-black/10 hover:text-zinc-950'
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
                  ? 'animate-spin text-zinc-700'
                  : isPseudocodeActive
                  ? 'text-white'
                  : 'text-zinc-600'
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
          <div className="flex items-center bg-[var(--surface-raised)] border border-black/10 rounded-lg p-0.5 text-xs shrink-0 whitespace-nowrap">
            <button
              onClick={() => onSetDefaultMode('agent')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md transition font-medium whitespace-nowrap shrink-0 ${
                defaultMode === 'agent'
                  ? 'bg-zinc-900 text-white shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
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
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
              title="默认模式：直接 Diff 解释（仅看增删改动）"
            >
              <Zap className="w-3 h-3 shrink-0" />
              <span>直接 Diff</span>
            </button>
          </div>

          <button
            onClick={onExplainFile}
            className={`flex items-center space-x-1.5 text-white text-xs font-medium px-2.5 py-1 rounded-lg shadow transition shrink-0 whitespace-nowrap ${
              defaultMode === 'agent'
                ? 'bg-zinc-900 hover:bg-zinc-800'
                : 'bg-amber-600 hover:bg-amber-500'
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

          <div className="flex items-center bg-[var(--surface-raised)] border border-black/10 rounded-lg p-0.5 space-x-0.5 shrink-0 whitespace-nowrap">
            <button
              onClick={() => onToggleViewMode('split')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md text-xs transition whitespace-nowrap shrink-0 ${
                viewMode === 'split'
                  ? 'bg-zinc-900 text-white font-medium shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
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
                  ? 'bg-zinc-900 text-white font-medium shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
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
