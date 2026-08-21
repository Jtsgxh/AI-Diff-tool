import React, { useMemo, useState } from 'react';
import { DiffFile, DiffViewMode, AIProviderConfig } from '../../types';
import { parseRawDiff, DiffHunk, SplitDiffRow, DiffLine } from '../../utils/diffParser';
import {
  Columns,
  AlignJustify,
  Sparkles,
  FileCode,
  Check,
  Copy,
  Terminal,
  HelpCircle,
  CheckSquare,
  Square,
  Layers,
  Zap,
} from 'lucide-react';
import { InlineLineExplanation } from './InlineLineExplanation';

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
  aiConfig,
}) => {
  // Track inline line explanations
  const [expandedLines, setExpandedLines] = useState<Record<string, DiffLine>>({});

  // Track multi-selected hunk IDs for batch hunk explanation
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
          支持勾选多选 Diff 块进行联合 AI 解析、单块独立解析、或点击任意代码行进行行级解析
        </p>
      </div>
    );
  }

  const hunks = parsedDiff.hunks;

  // Toggle single hunk selection
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

  // Select all hunks
  const selectAllHunks = () => {
    setSelectedHunkIds(new Set(hunks.map((h) => h.id)));
  };

  // Clear all selections
  const clearHunkSelection = () => {
    setSelectedHunkIds(new Set());
  };

  // Get selected hunk objects
  const selectedHunkObjects = hunks.filter((h) => selectedHunkIds.has(h.id));
  const totalSelectedAdds = selectedHunkObjects.reduce((sum, h) => sum + h.additions, 0);
  const totalSelectedDels = selectedHunkObjects.reduce((sum, h) => sum + h.deletions, 0);

  const toggleLineExplanation = (key: string, line: DiffLine) => {
    setExpandedLines((prev) => {
      const copy = { ...prev };
      if (copy[key]) {
        delete copy[key];
      } else {
        copy[key] = line;
      }
      return copy;
    });
  };

  const getHunkDiffText = (hunk: DiffHunk) => {
    return hunk.lines
      .map((l) =>
        l.type === 'add' ? `+${l.content}` : l.type === 'delete' ? `-${l.content}` : ` ${l.content}`
      )
      .join('\n');
  };

  const renderHunkHeader = (hunk: DiffHunk) => {
    const isSelected = selectedHunkIds.has(hunk.id);

    return (
      <div
        onClick={() => toggleHunkSelection(hunk.id)}
        className={`flex items-center justify-between px-3.5 py-1.5 text-xs font-mono select-none sticky top-0 z-10 backdrop-blur-md cursor-pointer transition-colors border-y ${
          isSelected
            ? 'bg-purple-950/80 border-purple-500/50 text-purple-200 shadow-sm shadow-purple-500/10'
            : 'bg-[#15161E]/95 border-white/10 text-indigo-300 hover:bg-[#1A1C27]'
        }`}
      >
        {/* Left: Checkbox + Hunk Index + Range */}
        <div className="flex items-center space-x-2.5">
          <button
            type="button"
            onClick={(e) => toggleHunkSelection(hunk.id, e)}
            className={`w-4 h-4 rounded flex items-center justify-center transition border ${
              isSelected
                ? 'bg-purple-600 border-purple-500 text-white'
                : 'border-slate-500 hover:border-slate-300 text-transparent'
            }`}
          >
            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
          </button>

          <span
            className={`font-semibold px-1.5 py-0.5 rounded text-[11px] ${
              isSelected
                ? 'bg-purple-500/30 text-purple-200 border border-purple-500/40'
                : 'bg-white/5 text-slate-300'
            }`}
          >
            块 #{hunk.index}
          </span>

          <span className="text-slate-300 font-semibold">{hunk.header}</span>

          <div className="flex items-center space-x-1.5 text-[11px]">
            {hunk.additions > 0 && <span className="text-emerald-400">+{hunk.additions}</span>}
            {hunk.deletions > 0 && <span className="text-rose-400">-{hunk.deletions}</span>}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onExplainHunk(hunk.header, getHunkDiffText(hunk), hunk.index)}
            className="flex items-center space-x-1 text-[11px] bg-purple-600/25 hover:bg-purple-600/50 text-purple-200 border border-purple-500/30 px-2.5 py-0.5 rounded transition font-sans font-medium"
            title="单独分析该改动块"
          >
            <Sparkles className="w-3 h-3" />
            <span>AI 解释此块</span>
          </button>
        </div>
      </div>
    );
  };

  const renderUnifiedLine = (line: DiffLine, index: number, hunk: DiffHunk, hunkIdx: number) => {
    if (line.type === 'hunk-header') return null;

    const isAdd = line.type === 'add';
    const isDelete = line.type === 'delete';
    const lineKey = `uni-${hunkIdx}-${index}-${line.oldLineNumber || line.newLineNumber}`;
    const isExpanded = !!expandedLines[lineKey];
    const hunkText = getHunkDiffText(hunk);

    return (
      <React.Fragment key={`unified-wrapper-${index}`}>
        <div
          onClick={() => toggleLineExplanation(lineKey, line)}
          className={`flex items-stretch font-mono text-xs leading-5 hover:bg-purple-600/10 cursor-pointer transition-colors group relative ${
            isExpanded
              ? 'bg-purple-950/30 border-l-2 border-purple-500'
              : isAdd
              ? 'bg-emerald-950/25 text-emerald-200'
              : isDelete
              ? 'bg-rose-950/25 text-rose-200'
              : 'text-slate-300'
          }`}
          title="点击此行展开行级 AI 解释"
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
          <div className="flex-1 whitespace-pre pl-1 pr-16 overflow-x-auto min-w-0">{line.content}</div>

          {/* Floating Action Badge on Hover */}
          <div className="absolute right-2 top-0.5 bottom-0.5 flex items-center opacity-0 group-hover:opacity-100 transition z-10">
            <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-sans font-medium shadow-md">
              <Sparkles className="w-2.5 h-2.5" />
              <span>{isExpanded ? '收起解释' : '行级解释'}</span>
            </span>
          </div>
        </div>

        {/* Embedded Inline AI Explanation Box */}
        {isExpanded && (
          <InlineLineExplanation
            line={line}
            filePath={file.newPath}
            hunkDiff={hunkText}
            aiConfig={aiConfig}
            onClose={() => toggleLineExplanation(lineKey, line)}
          />
        )}
      </React.Fragment>
    );
  };

  const renderSplitRow = (row: SplitDiffRow, index: number, hunk: DiffHunk, hunkIdx: number) => {
    const leftIsDelete = row.left?.type === 'delete';
    const rightIsAdd = row.right?.type === 'add';

    const leftKey = `split-l-${hunkIdx}-${index}-${row.left?.lineNumber}`;
    const rightKey = `split-r-${hunkIdx}-${index}-${row.right?.lineNumber}`;

    const isLeftExpanded = row.left && !!expandedLines[leftKey];
    const isRightExpanded = row.right && !!expandedLines[rightKey];
    const hunkText = getHunkDiffText(hunk);

    return (
      <React.Fragment key={`split-wrapper-${index}`}>
        <div className="flex items-stretch font-mono text-xs leading-5 border-b border-white/[0.02]">
          {/* Left (Old Version) */}
          <div
            onClick={() => {
              if (row.left) {
                toggleLineExplanation(leftKey, {
                  type: row.left.type,
                  oldLineNumber: row.left.lineNumber,
                  content: row.left.content,
                });
              }
            }}
            className={`flex-1 flex min-w-0 border-r border-white/10 group cursor-pointer relative hover:bg-purple-600/10 transition-colors ${
              isLeftExpanded
                ? 'bg-purple-950/30 border-l-2 border-purple-500'
                : leftIsDelete
                ? 'bg-rose-950/25 text-rose-200'
                : 'text-slate-300'
            }`}
            title={row.left ? '点击此行展开行级 AI 解释' : undefined}
          >
            <div className="w-12 shrink-0 text-right pr-2 text-slate-500 bg-[#14151B]/60 select-none border-r border-white/5">
              {row.left?.lineNumber || ''}
            </div>
            <div className="w-5 shrink-0 text-center font-bold select-none text-rose-400">
              {leftIsDelete ? '-' : ''}
            </div>
            <div className="flex-1 whitespace-pre pl-1 pr-14 overflow-x-auto min-w-0">
              {row.left?.content || ''}
            </div>
            {row.left && (
              <div className="absolute right-2 top-0.5 bottom-0.5 flex items-center opacity-0 group-hover:opacity-100 transition z-10">
                <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-sans font-medium shadow-md">
                  <Sparkles className="w-2.5 h-2.5" />
                  <span>行解释</span>
                </span>
              </div>
            )}
          </div>

          {/* Right (New Version) */}
          <div
            onClick={() => {
              if (row.right) {
                toggleLineExplanation(rightKey, {
                  type: row.right.type,
                  newLineNumber: row.right.lineNumber,
                  content: row.right.content,
                });
              }
            }}
            className={`flex-1 flex min-w-0 group cursor-pointer relative hover:bg-purple-600/10 transition-colors ${
              isRightExpanded
                ? 'bg-purple-950/30 border-l-2 border-purple-500'
                : rightIsAdd
                ? 'bg-emerald-950/25 text-emerald-200'
                : 'text-slate-300'
            }`}
            title={row.right ? '点击此行展开行级 AI 解释' : undefined}
          >
            <div className="w-12 shrink-0 text-right pr-2 text-slate-500 bg-[#14151B]/60 select-none border-r border-white/5">
              {row.right?.lineNumber || ''}
            </div>
            <div className="w-5 shrink-0 text-center font-bold select-none text-emerald-400">
              {rightIsAdd ? '+' : ''}
            </div>
            <div className="flex-1 whitespace-pre pl-1 pr-14 overflow-x-auto min-w-0">
              {row.right?.content || ''}
            </div>
            {row.right && (
              <div className="absolute right-2 top-0.5 bottom-0.5 flex items-center opacity-0 group-hover:opacity-100 transition z-10">
                <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-sans font-medium shadow-md">
                  <Sparkles className="w-2.5 h-2.5" />
                  <span>行解释</span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Embedded Inline AI Explanation Box for Left */}
        {isLeftExpanded && row.left && (
          <InlineLineExplanation
            line={{
              type: row.left.type,
              oldLineNumber: row.left.lineNumber,
              content: row.left.content,
            }}
            filePath={file.newPath}
            hunkDiff={hunkText}
            aiConfig={aiConfig}
            onClose={() =>
              toggleLineExplanation(leftKey, {
                type: row.left!.type,
                oldLineNumber: row.left!.lineNumber,
                content: row.left!.content,
              })
            }
          />
        )}

        {/* Embedded Inline AI Explanation Box for Right */}
        {isRightExpanded && row.right && (
          <InlineLineExplanation
            line={{
              type: row.right.type,
              newLineNumber: row.right.lineNumber,
              content: row.right.content,
            }}
            filePath={file.newPath}
            hunkDiff={hunkText}
            aiConfig={aiConfig}
            onClose={() =>
              toggleLineExplanation(rightKey, {
                type: row.right!.type,
                newLineNumber: row.right!.lineNumber,
                content: row.right!.content,
              })
            }
          />
        )}
      </React.Fragment>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181921] overflow-hidden relative">
      {/* Diff Toolbar */}
      <div className="h-11 bg-[#15161C] border-b border-white/10 px-4 flex items-center justify-between select-none shrink-0">
        <div className="flex items-center space-x-2 min-w-0">
          <FileCode className="w-4 h-4 text-purple-400 shrink-0" />
          <span className="font-mono text-xs font-semibold text-slate-200 truncate">
            {file.newPath}
          </span>
          <span className="text-[11px] text-emerald-400 font-mono">+{file.additions}</span>
          <span className="text-[11px] text-rose-400 font-mono">-{file.deletions}</span>
          <span className="text-[11px] bg-white/5 text-slate-400 px-1.5 py-0.5 rounded font-mono">
            {hunks.length} 个 Diff 块
          </span>
        </div>

        {/* Right Action buttons */}
        <div className="flex items-center space-x-3">
          {/* Quick select all blocks button if file has multiple hunks */}
          {hunks.length > 1 && (
            <button
              onClick={selectedHunkIds.size === hunks.length ? clearHunkSelection : selectAllHunks}
              className="text-xs text-slate-400 hover:text-purple-300 transition flex items-center gap-1"
            >
              {selectedHunkIds.size === hunks.length ? (
                <>
                  <CheckSquare className="w-3.5 h-3.5 text-purple-400" />
                  <span>已全选块</span>
                </>
              ) : (
                <>
                  <Square className="w-3.5 h-3.5" />
                  <span>勾选所有块</span>
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

          return (
            <div
              key={`hunk-block-${hunkIdx}`}
              className={`border-b last:border-0 transition-colors ${
                isSelected
                  ? 'border-purple-500/40 bg-purple-950/10'
                  : 'border-white/5'
              }`}
            >
              {/* Hunk Header */}
              {renderHunkHeader(hunk)}

              {/* Code lines */}
              {viewMode === 'unified' ? (
                <div>{hunk.lines.map((line, lineIdx) => renderUnifiedLine(line, lineIdx, hunk, hunkIdx))}</div>
              ) : (
                <div>{hunk.splitRows.map((row, rowIdx) => renderSplitRow(row, rowIdx, hunk, hunkIdx))}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating Multi-Selection Action Bar at Bottom */}
      {selectedHunkIds.size > 0 && (
        <div className="absolute bottom-3 left-6 right-6 bg-[#161722]/95 border border-purple-500/50 rounded-xl px-4 py-2.5 shadow-2xl backdrop-blur-md flex items-center justify-between z-30 animate-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center space-x-3 text-xs">
            <div className="flex items-center space-x-1.5 text-purple-300 font-semibold font-mono">
              <Layers className="w-4 h-4 text-purple-400" />
              <span>
                已勾选 {selectedHunkIds.size} / {hunks.length} 个 Diff 改动块
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
