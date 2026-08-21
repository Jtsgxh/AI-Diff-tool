import React, { useMemo, useState } from 'react';
import { DiffFile, DiffViewMode, AIProviderConfig } from '../../types';
import { parseRawDiff, DiffHunk, SplitDiffRow, DiffLine } from '../../utils/diffParser';
import {
  Columns,
  AlignJustify,
  Sparkles,
  FileCode,
  Check,
  Layers,
  CheckSquare,
  Square,
} from 'lucide-react';

interface DiffViewerProps {
  file: DiffFile | null;
  viewMode: DiffViewMode;
  onToggleViewMode: (mode: DiffViewMode) => void;
  onExplainHunk: (hunkHeader: string, hunkDiff: string, hunkIndex?: number) => void;
  onExplainMultipleHunks: (selectedHunks: DiffHunk[], file: DiffFile) => void;
  onExplainFile: (file: DiffFile) => void;
  aiConfig: AIProviderConfig;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  file,
  viewMode,
  onToggleViewMode,
  onExplainHunk,
  onExplainMultipleHunks,
  onExplainFile,
}) => {
  // Multi-selected hunk IDs
  const [selectedHunkIds, setSelectedHunkIds] = useState<Set<string>>(new Set());

  const parsedDiff = useMemo(() => {
    if (!file || !file.diff) return null;
    return parseRawDiff(file.diff);
  }, [file]);

  if (!file || !parsedDiff) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#17181F] text-slate-500 p-8">
        <FileCode className="w-12 h-12 mb-3 text-slate-600 stroke-1" />
        <p className="text-sm font-medium text-slate-400">请选择左侧文件以查看代码差异对比</p>
        <p className="text-xs text-slate-600 mt-1">
          悬浮代码块即可唤起 AI 块级解释，或勾选多块进行联合分析
        </p>
      </div>
    );
  }

  const hunks = parsedDiff.hunks;

  const toggleHunkSelection = (hunkId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedHunkIds((prev) => {
      const next = new Set(prev);
      if (next.has(hunkId)) {
        next.delete(hunkId);
      } else {
        next.add(hunkId);
      }
      return next;
    });
  };

  const selectAllHunks = () => {
    setSelectedHunkIds(new Set(hunks.map((h) => h.id)));
  };

  const clearHunkSelection = () => {
    setSelectedHunkIds(new Set());
  };

  const selectedHunkObjects = hunks.filter((h) => selectedHunkIds.has(h.id));
  const totalSelectedAdds = selectedHunkObjects.reduce((sum, h) => sum + h.additions, 0);
  const totalSelectedDels = selectedHunkObjects.reduce((sum, h) => sum + h.deletions, 0);

  const getHunkDiffText = (hunk: DiffHunk) => {
    return hunk.lines
      .map((l) =>
        l.type === 'add' ? `+${l.content}` : l.type === 'delete' ? `-${l.content}` : ` ${l.content}`
      )
      .join('\n');
  };

  const renderUnifiedLine = (line: DiffLine, index: number) => {
    if (line.type === 'hunk-header') {
      return (
        <div
          key={`hunk-hdr-${index}`}
          className="bg-indigo-950/30 border-y border-indigo-500/20 px-3 py-1 text-xs text-indigo-300 font-mono select-none"
        >
          {line.content}
        </div>
      );
    }

    const isAdd = line.type === 'add';
    const isDelete = line.type === 'delete';

    return (
      <div
        key={`line-${index}`}
        className={`flex items-stretch font-mono text-xs leading-5 hover:bg-white/[0.04] transition-colors ${
          isAdd
            ? 'bg-emerald-950/25 text-emerald-200'
            : isDelete
            ? 'bg-rose-950/25 text-rose-200'
            : 'text-slate-300'
        }`}
      >
        {/* Old Line # */}
        <div className="w-12 shrink-0 text-right pr-2 text-slate-500 bg-[#14151B]/60 select-none border-r border-white/5">
          {line.oldLineNumber || ''}
        </div>

        {/* New Line # */}
        <div className="w-12 shrink-0 text-right pr-2 text-slate-500 bg-[#14151B]/60 select-none border-r border-white/5">
          {line.newLineNumber || ''}
        </div>

        {/* Marker (+ / -) */}
        <div
          className={`w-6 shrink-0 text-center font-bold select-none ${
            isAdd ? 'text-emerald-400' : isDelete ? 'text-rose-400' : 'text-slate-600'
          }`}
        >
          {isAdd ? '+' : isDelete ? '-' : ' '}
        </div>

        {/* Code Content */}
        <div className="flex-1 whitespace-pre pl-1 pr-4 overflow-x-auto min-w-0">{line.content}</div>
      </div>
    );
  };

  const renderSplitRow = (row: SplitDiffRow, index: number) => {
    const leftIsDelete = row.left?.type === 'delete';
    const rightIsAdd = row.right?.type === 'add';

    return (
      <div
        key={`split-row-${index}`}
        className="flex items-stretch font-mono text-xs leading-5 border-b border-white/[0.02] hover:bg-white/[0.04] transition-colors"
      >
        {/* Left (Old Version) */}
        <div
          className={`flex-1 flex min-w-0 border-r border-white/10 ${
            leftIsDelete ? 'bg-rose-950/25 text-rose-200' : 'text-slate-300'
          }`}
        >
          <div className="w-12 shrink-0 text-right pr-2 text-slate-500 bg-[#14151B]/60 select-none border-r border-white/5">
            {row.left?.lineNumber || ''}
          </div>
          <div className="w-5 shrink-0 text-center font-bold select-none text-rose-400">
            {leftIsDelete ? '-' : ''}
          </div>
          <div className="flex-1 whitespace-pre pl-1 pr-3 overflow-x-auto min-w-0">
            {row.left?.content || ''}
          </div>
        </div>

        {/* Right (New Version) */}
        <div
          className={`flex-1 flex min-w-0 ${
            rightIsAdd ? 'bg-emerald-950/25 text-emerald-200' : 'text-slate-300'
          }`}
        >
          <div className="w-12 shrink-0 text-right pr-2 text-slate-500 bg-[#14151B]/60 select-none border-r border-white/5">
            {row.right?.lineNumber || ''}
          </div>
          <div className="w-5 shrink-0 text-center font-bold select-none text-emerald-400">
            {rightIsAdd ? '+' : ''}
          </div>
          <div className="flex-1 whitespace-pre pl-1 pr-3 overflow-x-auto min-w-0">
            {row.right?.content || ''}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181921] overflow-hidden relative">
      {/* Diff Toolbar (Clean standard toolbar) */}
      <div className="h-11 bg-[#15161C] border-b border-white/10 px-4 flex items-center justify-between select-none shrink-0">
        <div className="flex items-center space-x-2 min-w-0">
          <FileCode className="w-4 h-4 text-purple-400 shrink-0" />
          <span className="font-mono text-xs font-semibold text-slate-200 truncate">
            {file.newPath}
          </span>
          <span className="text-[11px] text-emerald-400 font-mono">+{file.additions}</span>
          <span className="text-[11px] text-rose-400 font-mono">-{file.deletions}</span>
          <span className="text-[11px] bg-white/5 text-slate-400 px-1.5 py-0.5 rounded font-mono">
            {hunks.length} 个改动块
          </span>
        </div>

        {/* Right Action buttons */}
        <div className="flex items-center space-x-3">
          {/* Quick select all blocks button if file has multiple hunks */}
          {hunks.length > 1 && (
            <button
              onClick={selectedHunkIds.size === hunks.length ? clearHunkSelection : selectAllHunks}
              className="text-xs text-slate-400 hover:text-purple-300 transition flex items-center gap-1"
              title="多选当前文件的所有改动块"
            >
              {selectedHunkIds.size === hunks.length ? (
                <>
                  <CheckSquare className="w-3.5 h-3.5 text-purple-400" />
                  <span>已全选块</span>
                </>
              ) : (
                <>
                  <Square className="w-3.5 h-3.5" />
                  <span>多选所有块</span>
                </>
              )}
            </button>
          )}

          {/* AI Explain File Button */}
          <button
            onClick={() => onExplainFile(file)}
            className="flex items-center space-x-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-medium px-2.5 py-1 rounded shadow transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI 汇总解释此文件</span>
          </button>

          {/* Mode Switcher: Split vs Unified */}
          <div className="flex items-center bg-[#1E202A] border border-white/10 rounded p-0.5">
            <button
              onClick={() => onToggleViewMode('split')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-xs transition ${
                viewMode === 'split'
                  ? 'bg-purple-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="双栏对比 (Side-by-Side)"
            >
              <Columns className="w-3 h-3" />
              <span>Split</span>
            </button>
            <button
              onClick={() => onToggleViewMode('unified')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-xs transition ${
                viewMode === 'unified'
                  ? 'bg-purple-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="单栏内联 (Inline)"
            >
              <AlignJustify className="w-3 h-3" />
              <span>Unified</span>
            </button>
          </div>
        </div>
      </div>

      {/* Code Diff Display Container */}
      <div className="flex-1 overflow-auto bg-[#13141A] pb-16">
        {hunks.map((hunk, hunkIdx) => {
          const isSelected = selectedHunkIds.has(hunk.id);
          const hunkText = getHunkDiffText(hunk);

          return (
            <div
              key={`hunk-block-${hunkIdx}`}
              className={`relative group transition-all duration-150 border-b border-white/5 ${
                isSelected
                  ? 'bg-purple-950/15 border-l-4 border-l-purple-500 shadow-sm'
                  : 'hover:bg-white/[0.015]'
              }`}
            >
              {/* Floating Hunk Hover Toolbar (Only visible on hover or when selected) */}
              <div
                className={`absolute right-4 top-2 z-20 flex items-center space-x-1.5 transition-opacity duration-150 ${
                  isSelected
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto'
                }`}
              >
                {/* Multi-select Checkbox */}
                <button
                  type="button"
                  onClick={(e) => toggleHunkSelection(hunk.id, e)}
                  className={`px-2 py-1 rounded-md text-[11px] font-sans font-medium flex items-center space-x-1 border backdrop-blur-md shadow-md transition ${
                    isSelected
                      ? 'bg-purple-600 border-purple-400 text-white'
                      : 'bg-[#181924]/90 hover:bg-purple-600/30 border-white/10 text-slate-300 hover:text-white'
                  }`}
                  title="勾选此块以进行多块联合分析"
                >
                  <div
                    className={`w-3 h-3 rounded flex items-center justify-center border ${
                      isSelected
                        ? 'bg-white border-white text-purple-600'
                        : 'border-slate-400'
                    }`}
                  >
                    {isSelected && <Check className="w-2.5 h-2.5 stroke-[4]" />}
                  </div>
                  <span>{isSelected ? `块 #${hunk.index} 已选` : `选择块 #${hunk.index}`}</span>
                </button>

                {/* Single Hunk AI Explain Button */}
                <button
                  type="button"
                  onClick={() => onExplainHunk(hunk.header, hunkText, hunk.index)}
                  className="px-2.5 py-1 rounded-md bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-[11px] font-sans font-semibold flex items-center space-x-1 shadow-lg shadow-purple-600/30 border border-purple-400/30 transition hover:scale-105 active:scale-95"
                  title="针对当前改动块进行 AI 语义解释"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI 解释此块</span>
                </button>
              </div>

              {/* Hunk Header for Split Mode */}
              {viewMode === 'split' && (
                <div className="bg-indigo-950/30 border-y border-indigo-500/20 px-3 py-1 text-xs text-indigo-300 font-mono select-none flex items-center justify-between">
                  <span>{hunk.header}</span>
                  <span className="text-[11px] text-slate-500 font-sans">块 #{hunk.index}</span>
                </div>
              )}

              {/* Diff Lines Rendering (Clean, Standard) */}
              {viewMode === 'unified' ? (
                <div>{hunk.lines.map((line, lineIdx) => renderUnifiedLine(line, lineIdx))}</div>
              ) : (
                <div>{hunk.splitRows.map((row, rowIdx) => renderSplitRow(row, rowIdx))}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating Multi-Selection Action Bar (Only when 1+ hunks are selected) */}
      {selectedHunkIds.size > 0 && (
        <div className="absolute bottom-3 left-6 right-6 bg-[#161722]/95 border border-purple-500/50 rounded-xl px-4 py-2.5 shadow-2xl backdrop-blur-md flex items-center justify-between z-30 animate-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center space-x-3 text-xs">
            <div className="flex items-center space-x-1.5 text-purple-300 font-semibold font-mono">
              <Layers className="w-4 h-4 text-purple-400" />
              <span>
                已选中 {selectedHunkIds.size} / {hunks.length} 个改动块
              </span>
            </div>

            <div className="flex items-center space-x-1.5 text-[11px] font-mono">
              {totalSelectedAdds > 0 && (
                <span className="text-emerald-400">+{totalSelectedAdds}</span>
              )}
              {totalSelectedDels > 0 && (
                <span className="text-rose-400">-{totalSelectedDels}</span>
              )}
            </div>

            <div className="flex items-center space-x-2 text-[11px] text-slate-400 pl-2 border-l border-white/10">
              <button
                onClick={selectAllHunks}
                className="hover:text-white underline transition"
              >
                全选
              </button>
              <button
                onClick={clearHunkSelection}
                className="hover:text-rose-400 underline transition"
              >
                取消选择
              </button>
            </div>
          </div>

          {/* AI Explain Multi-Hunk Button */}
          <button
            onClick={() => onExplainMultipleHunks(selectedHunkObjects, file)}
            className="flex items-center space-x-2 px-4 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs rounded-lg shadow-lg shadow-purple-600/30 transition hover:scale-105 active:scale-95"
          >
            <Sparkles className="w-4 h-4" />
            <span>AI 联合解释选中的 {selectedHunkIds.size} 个改动块</span>
          </button>
        </div>
      )}
    </div>
  );
};
