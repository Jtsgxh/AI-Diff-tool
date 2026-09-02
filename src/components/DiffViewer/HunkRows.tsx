import React from 'react';
import { Sparkles } from 'lucide-react';
import type { DiffHunk } from '../../utils/diffParser';
import type { PseudocodeLines } from './hooks/useHunkAnnotations';

interface HunkRowsProps {
  hunk: DiffHunk;
  showPseudocode: boolean;
  pseudocode?: PseudocodeLines;
}

/**
 * Renders the code rows of a single hunk.
 *
 * Memoized and split out from the surrounding chrome: toggling an unrelated
 * hunk, hovering the toolbar, or streaming an explanation elsewhere in the file
 * used to re-render every line of every hunk in the file.
 */
export const HunkUnifiedRows = React.memo<HunkRowsProps>(
  ({ hunk, showPseudocode, pseudocode }) => {
    let delCounter = 0;
    let addCounter = 0;

    return (
      <div>
        {hunk.lines.map((line, lineIdx) => {
          if (line.type === 'hunk-header') {
            return (
              <div
                key={`hunk-hdr-${lineIdx}`}
                className="bg-zinc-100 border-y border-zinc-300 px-3 py-1 text-xs text-zinc-800 font-mono select-none flex items-center justify-between"
              >
                <span>{line.content}</span>
                {showPseudocode && (
                  <span className="text-[10px] bg-zinc-100 text-zinc-800 px-1.5 py-0.5 rounded border border-zinc-400 font-sans flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>AI 伪代码转换</span>
                    {pseudocode?.loading && <span className="animate-pulse">(大模型生成中...)</span>}
                  </span>
                )}
              </div>
            );
          }

          const isAdd = line.type === 'add';
          const isDelete = line.type === 'delete';

          // Counters walk changed lines in order so AI output lines up 1:1
          // with the diff lines they were generated from.
          const aiText = isDelete
            ? pseudocode?.dels[delCounter++]
            : isAdd
            ? pseudocode?.adds[addCounter++]
            : undefined;

          const displayContent =
            showPseudocode && (isAdd || isDelete) ? aiText || line.content : line.content;

          return (
            <div
              key={`line-${lineIdx}`}
              className={`flex items-stretch font-mono text-xs leading-5 min-w-max w-full hover:bg-black/[0.07] transition-colors ${
                isAdd
                  ? 'bg-emerald-50 text-emerald-800'
                  : isDelete
                  ? 'bg-rose-50 text-rose-800'
                  : 'text-zinc-800'
              }`}
            >
              <div className="w-12 shrink-0 text-right pr-2 text-zinc-600 bg-[#FFFFFF]/60 select-none border-r border-black/10">
                {line.oldLineNumber || ''}
              </div>
              <div className="w-12 shrink-0 text-right pr-2 text-zinc-600 bg-[#FFFFFF]/60 select-none border-r border-black/10">
                {line.newLineNumber || ''}
              </div>
              <div
                className={`w-6 shrink-0 text-center font-bold select-none ${
                  isAdd ? 'text-emerald-700' : isDelete ? 'text-rose-700' : 'text-zinc-500'
                }`}
              >
                {isAdd ? '+' : isDelete ? '-' : ' '}
              </div>
              <div className="whitespace-pre pl-1 pr-4">{displayContent}</div>
            </div>
          );
        })}
      </div>
    );
  }
);

HunkUnifiedRows.displayName = 'HunkUnifiedRows';

export const HunkSplitRows = React.memo<HunkRowsProps>(({ hunk, showPseudocode, pseudocode }) => {
  let delCounter = 0;
  let addCounter = 0;

  const rows = hunk.splitRows.map((row) => {
    const leftIsDelete = row.left?.type === 'delete';
    const rightIsAdd = row.right?.type === 'add';
    const aiDelText = leftIsDelete ? pseudocode?.dels[delCounter++] : undefined;
    const aiAddText = rightIsAdd ? pseudocode?.adds[addCounter++] : undefined;
    return {
      leftIsDelete,
      rightIsAdd,
      leftNumber: row.left?.lineNumber || '',
      rightNumber: row.right?.lineNumber || '',
      leftContent:
        showPseudocode && leftIsDelete && row.left?.content
          ? aiDelText || row.left.content
          : row.left?.content || '',
      rightContent:
        showPseudocode && rightIsAdd && row.right?.content
          ? aiAddText || row.right.content
          : row.right?.content || '',
    };
  });

  return (
    <div className="flex items-stretch min-w-0">
      <div
        className="diff-split-pane min-w-0 border-r border-black/15"
        style={{ width: 'var(--diff-split-left, 50%)' }}
      >
        {rows.map((row, rowIdx) => (
          <div
            key={`split-left-${rowIdx}`}
            className={`flex items-stretch h-5 font-mono text-xs leading-5 w-max min-w-full border-b border-black/10 ${
              row.leftIsDelete ? 'bg-rose-50 text-rose-800' : 'text-zinc-800'
            }`}
          >
            <div className="w-12 shrink-0 text-right pr-2 text-zinc-600 bg-[#FFFFFF]/60 select-none border-r border-black/10">
              {row.leftNumber}
            </div>
            <div className="w-5 shrink-0 text-center font-bold select-none text-rose-700">
              {row.leftIsDelete ? '-' : ''}
            </div>
            <div className="whitespace-pre pl-1 pr-3">{row.leftContent}</div>
          </div>
        ))}
      </div>

      <div className="diff-split-pane min-w-0 flex-1">
        {rows.map((row, rowIdx) => (
          <div
            key={`split-right-${rowIdx}`}
            className={`flex items-stretch h-5 font-mono text-xs leading-5 w-max min-w-full border-b border-black/10 ${
              row.rightIsAdd ? 'bg-emerald-50 text-emerald-800' : 'text-zinc-800'
            }`}
          >
            <div className="w-12 shrink-0 text-right pr-2 text-zinc-600 bg-[#FFFFFF]/60 select-none border-r border-black/10">
              {row.rightNumber}
            </div>
            <div className="w-5 shrink-0 text-center font-bold select-none text-emerald-700">
              {row.rightIsAdd ? '+' : ''}
            </div>
            <div className="whitespace-pre pl-1 pr-3">{row.rightContent}</div>
          </div>
        ))}
      </div>
    </div>
  );
});

HunkSplitRows.displayName = 'HunkSplitRows';
