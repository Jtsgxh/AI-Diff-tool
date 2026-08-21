import React, { useMemo } from 'react';
import { DiffFile, DiffViewMode } from '../../types';
import { parseRawDiff, DiffHunk, SplitDiffRow, DiffLine } from '../../utils/diffParser';
import {
  Columns,
  AlignJustify,
  Sparkles,
  FileCode,
  Check,
  Copy,
  Terminal,
} from 'lucide-react';

interface DiffViewerProps {
  file: DiffFile | null;
  viewMode: DiffViewMode;
  onToggleViewMode: (mode: DiffViewMode) => void;
  onExplainHunk: (hunkHeader: string, hunkDiff: string) => void;
  onExplainFile: (file: DiffFile) => void;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  file,
  viewMode,
  onToggleViewMode,
  onExplainHunk,
  onExplainFile,
}) => {
  const parsedDiff = useMemo(() => {
    if (!file || !file.diff) return null;
    return parseRawDiff(file.diff);
  }, [file]);

  if (!file || !parsedDiff) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#17181F] text-slate-500 p-8">
        <FileCode className="w-12 h-12 mb-3 text-slate-600 stroke-1" />
        <p className="text-sm font-medium text-slate-400">请选择左侧文件以查看代码差异对比</p>
        <p className="text-xs text-slate-600 mt-1">支持 Split 双栏与 Unified 单栏对比，并可一键唤起 AI 语义解析</p>
      </div>
    );
  }

  const renderUnifiedLine = (line: DiffLine, index: number, hunk: DiffHunk) => {
    if (line.type === 'hunk-header') {
      return (
        <div
          key={`hunk-${index}`}
          className="flex items-center justify-between bg-indigo-950/40 border-y border-indigo-500/20 px-3 py-1 text-xs text-indigo-300 font-mono select-none"
        >
          <div className="flex items-center space-x-2">
            <span className="text-indigo-400 font-semibold">{line.content}</span>
          </div>

          <button
            onClick={() => {
              const hunkText = hunk.lines.map((l) => (l.type === 'add' ? `+${l.content}` : l.type === 'delete' ? `-${l.content}` : ` ${l.content}`)).join('\n');
              onExplainHunk(line.content, hunkText);
            }}
            className="flex items-center space-x-1 text-[11px] bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/30 px-2 py-0.5 rounded transition font-sans"
          >
            <Sparkles className="w-3 h-3" />
            <span>AI 解释此代码块</span>
          </button>
        </div>
      );
    }

    const isAdd = line.type === 'add';
    const isDelete = line.type === 'delete';

    return (
      <div
        key={`line-${index}`}
        className={`flex items-stretch font-mono text-xs leading-5 hover:bg-white/[0.03] transition-colors ${
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
        <div className="flex-1 whitespace-pre pl-1 pr-4 overflow-x-auto">{line.content}</div>
      </div>
    );
  };

  const renderSplitRow = (row: SplitDiffRow, index: number) => {
    const leftIsDelete = row.left?.type === 'delete';
    const rightIsAdd = row.right?.type === 'add';

    return (
      <div
        key={`split-row-${index}`}
        className="flex items-stretch font-mono text-xs leading-5 border-b border-white/[0.02]"
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
          <div className="flex-1 whitespace-pre pl-1 pr-3 overflow-x-auto">
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
          <div className="flex-1 whitespace-pre pl-1 pr-3 overflow-x-auto">
            {row.right?.content || ''}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181921] overflow-hidden">
      {/* Diff Toolbar */}
      <div className="h-11 bg-[#15161C] border-b border-white/10 px-4 flex items-center justify-between select-none shrink-0">
        <div className="flex items-center space-x-2 min-w-0">
          <FileCode className="w-4 h-4 text-purple-400 shrink-0" />
          <span className="font-mono text-xs font-semibold text-slate-200 truncate">
            {file.newPath}
          </span>
          <span className="text-[11px] text-emerald-400 font-mono">+{file.additions}</span>
          <span className="text-[11px] text-rose-400 font-mono">-{file.deletions}</span>
        </div>

        {/* Right Action buttons */}
        <div className="flex items-center space-x-3">
          {/* AI Explain File Button */}
          <button
            onClick={() => onExplainFile(file)}
            className="flex items-center space-x-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-medium px-2.5 py-1 rounded shadow transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI 解释此文件</span>
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
      <div className="flex-1 overflow-auto bg-[#13141A]">
        {parsedDiff.hunks.map((hunk, hunkIdx) => (
          <div key={`hunk-block-${hunkIdx}`} className="border-b border-white/5 last:border-0">
            {viewMode === 'unified' ? (
              <div>{hunk.lines.map((line, lineIdx) => renderUnifiedLine(line, lineIdx, hunk))}</div>
            ) : (
              <div>
                {/* Hunk Header for Split Mode */}
                <div className="flex items-center justify-between bg-indigo-950/40 border-y border-indigo-500/20 px-3 py-1 text-xs text-indigo-300 font-mono select-none">
                  <span>{hunk.header}</span>
                  <button
                    onClick={() => {
                      const hunkText = hunk.lines
                        .map((l) => (l.type === 'add' ? `+${l.content}` : l.type === 'delete' ? `-${l.content}` : ` ${l.content}`))
                        .join('\n');
                      onExplainHunk(hunk.header, hunkText);
                    }}
                    className="flex items-center space-x-1 text-[11px] bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/30 px-2 py-0.5 rounded transition font-sans"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>AI 解释代码块</span>
                  </button>
                </div>

                {/* Split rows */}
                {hunk.splitRows.map((row, rowIdx) => renderSplitRow(row, rowIdx))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
