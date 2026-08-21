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
} from 'lucide-react';
import { InlineLineExplanation } from './InlineLineExplanation';

interface DiffViewerProps {
  file: DiffFile | null;
  viewMode: DiffViewMode;
  onToggleViewMode: (mode: DiffViewMode) => void;
  onExplainHunk: (hunkHeader: string, hunkDiff: string) => void;
  onExplainFile: (file: DiffFile) => void;
  aiConfig: AIProviderConfig;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  file,
  viewMode,
  onToggleViewMode,
  onExplainHunk,
  onExplainFile,
  aiConfig,
}) => {
  // Track which line keys have inline AI explanations open: e.g. "unified-5" or "split-left-5"
  const [expandedLines, setExpandedLines] = useState<Record<string, DiffLine>>({});

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
          支持点击任意代码行即刻行内弹出 AI 解释，或点击顶部进行整体语义审查
        </p>
      </div>
    );
  }

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

  const renderUnifiedLine = (line: DiffLine, index: number, hunk: DiffHunk, hunkIdx: number) => {
    if (line.type === 'hunk-header') {
      return (
        <div
          key={`hunk-${index}`}
          className="flex items-center justify-between bg-indigo-950/40 border-y border-indigo-500/20 px-3 py-1 text-xs text-indigo-300 font-mono select-none sticky top-0 z-10 backdrop-blur-sm"
        >
          <div className="flex items-center space-x-2">
            <span className="text-indigo-400 font-semibold">{line.content}</span>
          </div>

          <button
            onClick={() => {
              const hunkText = hunk.lines
                .map((l) =>
                  l.type === 'add' ? `+${l.content}` : l.type === 'delete' ? `-${l.content}` : ` ${l.content}`
                )
                .join('\n');
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
    const lineKey = `uni-${hunkIdx}-${index}-${line.oldLineNumber || line.newLineNumber}`;
    const isExpanded = !!expandedLines[lineKey];

    const hunkText = hunk.lines
      .map((l) => (l.type === 'add' ? `+${l.content}` : l.type === 'delete' ? `-${l.content}` : ` ${l.content}`))
      .join('\n');

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
          title="点击此行展开 / 收起 AI 语义解释"
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
              <span>{isExpanded ? '收起解释' : '点此 AI 解释'}</span>
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

    const hunkText = hunk.lines
      .map((l) => (l.type === 'add' ? `+${l.content}` : l.type === 'delete' ? `-${l.content}` : ` ${l.content}`))
      .join('\n');

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
            title={row.left ? '点击此行展开 AI 解释' : undefined}
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
                  <span>AI 解释</span>
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
            title={row.right ? '点击此行展开 AI 解释' : undefined}
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
                  <span>AI 解释</span>
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
          <span className="text-[11px] text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded border border-purple-500/30 flex items-center gap-1 font-sans">
            <Sparkles className="w-3 h-3" /> 点击任意代码行可直接展开行级 AI 解释
          </span>
        </div>

        {/* Right Action buttons */}
        <div className="flex items-center space-x-3">
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
      <div className="flex-1 overflow-auto bg-[#13141A]">
        {parsedDiff.hunks.map((hunk, hunkIdx) => (
          <div key={`hunk-block-${hunkIdx}`} className="border-b border-white/5 last:border-0">
            {viewMode === 'unified' ? (
              <div>{hunk.lines.map((line, lineIdx) => renderUnifiedLine(line, lineIdx, hunk, hunkIdx))}</div>
            ) : (
              <div>
                {/* Hunk Header for Split Mode */}
                <div className="flex items-center justify-between bg-indigo-950/40 border-y border-indigo-500/20 px-3 py-1 text-xs text-indigo-300 font-mono select-none sticky top-0 z-10 backdrop-blur-sm">
                  <span>{hunk.header}</span>
                  <button
                    onClick={() => {
                      const hunkText = hunk.lines
                        .map((l) =>
                          l.type === 'add' ? `+${l.content}` : l.type === 'delete' ? `-${l.content}` : ` ${l.content}`
                        )
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
                {hunk.splitRows.map((row, rowIdx) => renderSplitRow(row, rowIdx, hunk, hunkIdx))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
