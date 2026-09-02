import React from 'react';
import { BookOpen, Brain, Check, Sparkles, Zap } from 'lucide-react';
import type { DiffHunk } from '../../utils/diffParser';
import type { DiffViewMode } from '../../types';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { useDeferredMount } from '../../hooks/useDeferredMount';
import { HunkSplitRows, HunkUnifiedRows } from './HunkRows';
import { estimateHunkHeight } from './hunkMetrics';
import type { NaturalLanguageEntry, PseudocodeLines } from './hooks/useHunkAnnotations';

export interface HunkBlockProps {
  hunk: DiffHunk;
  viewMode: DiffViewMode;
  isSelected: boolean;
  showPseudocode: boolean;
  pseudocode?: PseudocodeLines;
  showNaturalLanguage: boolean;
  naturalLanguage?: NaturalLanguageEntry;
  /** Mount the rows only once they scroll into range (large files only). */
  deferMount: boolean;
  onToggleSelection: (hunkId: string) => void;
  onTogglePseudocode: (hunk: DiffHunk) => void;
  onToggleNaturalLanguage: (hunk: DiffHunk) => void;
  onExplain: (hunk: DiffHunk, mode: 'agent' | 'fast') => void;
}

/**
 * One hunk: hover actions, optional annotations, and the code rows.
 *
 * Memoized on its own props so hovering or toggling one hunk leaves the rest of
 * the file untouched.
 */
export const HunkBlock = React.memo<HunkBlockProps>(
  ({
    hunk,
    viewMode,
    isSelected,
    showPseudocode,
    pseudocode,
    showNaturalLanguage,
    naturalLanguage,
    deferMount,
    onToggleSelection,
    onTogglePseudocode,
    onToggleNaturalLanguage,
    onExplain,
  }) => {
    const { ref, isMounted } = useDeferredMount(deferMount);

    return (
      <div
        ref={ref}
        className={`relative group transition-all duration-150 border-b border-black/5 ${
          isSelected
            ? 'bg-zinc-100/70 border-l-4 border-l-blue-500 shadow-sm'
            : 'hover:bg-black/[0.015]'
        }`}
      >
        {/* Floating hover toolbar */}
        <div
          className={`absolute right-4 top-2 z-20 flex items-center space-x-1.5 transition-opacity duration-150 ${
            isSelected || showNaturalLanguage || showPseudocode
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto'
          }`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelection(hunk.id);
            }}
            className={`px-2 py-1 rounded-md text-[11px] font-sans font-medium flex items-center space-x-1 border shadow-sm transition ${
              isSelected
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-[#F1F1EF]/90 text-zinc-700 border-black/10 hover:border-zinc-400 hover:text-zinc-950'
            }`}
          >
            <div
              className={`w-3 h-3 rounded flex items-center justify-center border ${
                isSelected ? 'bg-white border-white text-zinc-950' : 'border-zinc-400'
              }`}
            >
              {isSelected && <Check className="w-2.5 h-2.5 stroke-[4]" />}
            </div>
            <span>{isSelected ? `块 #${hunk.index} 已选` : `选择块 #${hunk.index}`}</span>
          </button>

          <button
            type="button"
            onClick={() => onTogglePseudocode(hunk)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-sans font-semibold flex items-center space-x-1 border shadow-sm transition ${
              showPseudocode
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-[#F1F1EF]/90 hover:bg-zinc-900 text-zinc-700 hover:text-white border-zinc-300'
            }`}
            title={
              showPseudocode
                ? pseudocode?.error || pseudocode?.warning
                  ? '生成不完整或失败，点击重试'
                  : '点击关闭伪代码，恢复显示原始代码'
                : '点击通过 AI 将本块 Diff 改动行原位转译为伪代码'
            }
          >
            <Sparkles className={`w-3 h-3 ${pseudocode?.loading ? 'animate-spin text-zinc-700' : ''}`} />
            <span>
              {showPseudocode
                ? pseudocode?.loading
                  ? 'AI 伪代码 (生成中...)'
                  : pseudocode?.error
                    ? 'AI 伪代码 [失败·点击重试]'
                    : pseudocode?.warning
                      ? 'AI 伪代码 [部分·点击重试]'
                      : 'AI 伪代码 [开]'
                : '🤖 AI 伪代码'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onToggleNaturalLanguage(hunk)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-sans font-semibold flex items-center space-x-1 border shadow-sm transition ${
              showNaturalLanguage
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-[#F1F1EF]/90 hover:bg-zinc-900 text-zinc-700 hover:text-white border-zinc-300'
            }`}
            title="点击在此 Diff 块内直接展开/折叠自然语言直读释义"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>{showNaturalLanguage ? '收起释义' : '📖 块释义'}</span>
          </button>

          <button
            type="button"
            onClick={() => onExplain(hunk, 'fast')}
            className="px-2 py-1 rounded-md bg-amber-600/30 hover:bg-amber-600/60 text-amber-800 border border-amber-300 text-[11px] font-sans font-medium flex items-center space-x-1 shadow transition"
            title="【直接 Diff 解释】仅针对当前增删代码直接解释，不查阅外部文件"
          >
            <Zap className="w-3 h-3 text-amber-700" />
            <span>直接解释</span>
          </button>

          <button
            type="button"
            onClick={() => onExplain(hunk, 'agent')}
            className="px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white text-[11px] font-sans font-semibold flex items-center space-x-1 shadow-sm border border-zinc-300 transition"
            title="【文件关联解释】Codex 智能体将自主检索全库关联文件与下游调用"
          >
            <Brain className="w-3.5 h-3.5" />
            <span>关联解释 (Codex)</span>
          </button>
        </div>

        {/* Split mode carries its own header; unified renders it inline with the rows. */}
        {viewMode === 'split' && (
          <div className="bg-zinc-100 border-y border-zinc-200 px-3 py-1 text-xs text-zinc-700 font-mono select-none flex items-center justify-between">
            <span>{hunk.header}</span>
            <div className="flex items-center space-x-2">
              {showPseudocode && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 border border-zinc-300 font-sans font-medium">
                  ✨ 概括性伪代码模式
                </span>
              )}
              <span className="text-[11px] text-zinc-500 font-sans">块 #{hunk.index}</span>
            </div>
          </div>
        )}

        {showPseudocode && (pseudocode?.error || pseudocode?.warning) && (
          <div
            className={`border-y px-5 py-2.5 text-xs flex items-start space-x-2 ${
              pseudocode.error
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <span className="shrink-0 mt-0.5">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="leading-relaxed">{pseudocode.error || pseudocode.warning}</p>
              <button
                type="button"
                onClick={() => onTogglePseudocode(hunk)}
                className={`mt-1.5 text-[11px] hover:text-zinc-950 underline underline-offset-2 ${
                  pseudocode.error ? 'text-rose-800' : 'text-amber-800'
                }`}
              >
                点击重试
              </button>
            </div>
          </div>
        )}

        {showNaturalLanguage && (
          <div className="bg-zinc-100/80 border-y border-zinc-300 px-5 py-3.5 text-xs text-zinc-900 flex items-start space-x-3 shadow-inner animate-in fade-in duration-150">
            <div className="p-1.5 rounded-lg bg-zinc-100 text-zinc-700 shrink-0 mt-0.5 border border-zinc-300">
              <BookOpen className="w-4 h-4 text-zinc-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-zinc-800 text-xs">
                    改动块 #{hunk.index} 自然语言直读
                  </span>
                  {naturalLanguage?.loading && (
                    <span className="text-[10px] text-zinc-600 animate-pulse font-mono font-normal">
                      (AI 正在实时转译中...)
                    </span>
                  )}
                </div>
                <button
                  onClick={() => onToggleNaturalLanguage(hunk)}
                  className="text-[10px] text-zinc-600 hover:text-zinc-900 transition"
                >
                  收起
                </button>
              </div>
              <div className="text-zinc-700 leading-relaxed font-sans text-xs">
                {naturalLanguage?.text ? (
                  <MarkdownRenderer
                    content={naturalLanguage.text}
                    className="prose prose-sm max-w-none text-zinc-900 text-xs leading-relaxed"
                  />
                ) : (
                  <span className="text-zinc-600 animate-pulse text-[11px]">
                    正在调用 AI 将该块代码改动转译为自然语言叙述...
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {isMounted ? (
          viewMode === 'unified' ? (
            <HunkUnifiedRows hunk={hunk} showPseudocode={showPseudocode} pseudocode={pseudocode} />
          ) : (
            <HunkSplitRows hunk={hunk} showPseudocode={showPseudocode} pseudocode={pseudocode} />
          )
        ) : (
          // Placeholder sized from the hunk's own line count so the scrollbar
          // stays stable as blocks mount.
          <div style={{ height: estimateHunkHeight(hunk, viewMode) }} aria-hidden />
        )}
      </div>
    );
  }
);

HunkBlock.displayName = 'HunkBlock';
