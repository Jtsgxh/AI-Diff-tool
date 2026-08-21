import React, { useMemo, useState } from 'react';
import { DiffFile, DiffViewMode, AIProviderConfig } from '../../types';
import { parseRawDiff, DiffHunk, SplitDiffRow, DiffLine } from '../../utils/diffParser';
import { generateConceptualHunkPseudocode } from '../../utils/pseudocodeConverter';
import { streamExplainDiff } from '../../services/api';
import {
  Columns,
  AlignJustify,
  FileCode,
  Check,
  Layers,
  CheckSquare,
  Square,
  Zap,
  Brain,
  BookOpen,
  Sparkles,
} from 'lucide-react';
import { marked } from 'marked';

interface DiffViewerProps {
  file: DiffFile | null;
  viewMode: DiffViewMode;
  onToggleViewMode: (mode: DiffViewMode) => void;
  onExplainHunk: (hunkHeader: string, hunkDiff: string, hunkIndex?: number, mode?: 'agent' | 'fast') => void;
  onExplainMultipleHunks: (selectedHunks: DiffHunk[], file: DiffFile, mode?: 'agent' | 'fast') => void;
  onExplainFile: (file: DiffFile, mode?: 'agent' | 'fast') => void;
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
  // Global default explanation mode in this viewer: 'agent' (default) or 'fast'
  const [defaultMode, setDefaultMode] = useState<'agent' | 'fast'>('agent');

  // Multi-selected hunk IDs
  const [selectedHunkIds, setSelectedHunkIds] = useState<Set<string>>(new Set());

  // Global & Per-Hunk Pseudocode / Natural Language Code Mode
  const [isGlobalPseudocode, setIsGlobalPseudocode] = useState<boolean>(false);
  const [hunkPseudocodeSet, setHunkPseudocodeSet] = useState<Set<string>>(new Set());

  // Inline Natural Language State per Hunk
  const [expandedNaturalHunkIds, setExpandedNaturalHunkIds] = useState<Set<string>>(new Set());
  const [hunkNaturalContent, setHunkNaturalContent] = useState<
    Record<string, { text: string; loading: boolean }>
  >({});

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
          支持「⚡ 直接 Diff 解释」、「🧠 文件关联解释 (Codex)」与「🔤 概括性伪代码对照」
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

  const toggleHunkPseudocode = (hunkId: string) => {
    setHunkPseudocodeSet((prev) => {
      const next = new Set(prev);
      if (next.has(hunkId)) {
        next.delete(hunkId);
      } else {
        next.add(hunkId);
      }
      return next;
    });
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

  // Toggle Inline Natural Language for a specific Hunk (ONLY ON CLICK)
  const toggleHunkNaturalLanguage = (hunkId: string, hunk: DiffHunk) => {
    setExpandedNaturalHunkIds((prev) => {
      const next = new Set(prev);
      if (next.has(hunkId)) {
        next.delete(hunkId);
        return next;
      } else {
        next.add(hunkId);

        // Fetch AI translation if not yet loaded
        if (!hunkNaturalContent[hunkId]?.text && !hunkNaturalContent[hunkId]?.loading) {
          setHunkNaturalContent((c) => ({
            ...c,
            [hunkId]: { text: '', loading: true },
          }));

          const hunkDiffText = getHunkDiffText(hunk);
          const prompt = `请用 1~2 段通俗易懂的大白话（自然语言），直接解释这个代码改动块的具体意图、前后逻辑行为差异与影响。零套话，直击要害。`;

          streamExplainDiff({
            scopeType: 'chunk',
            filePath: file.newPath,
            diff: hunkDiffText,
            userPrompt: prompt,
            config: aiConfig,
            onChunk: (chunk: string) => {
              setHunkNaturalContent((c) => ({
                ...c,
                [hunkId]: { text: (c[hunkId]?.text || '') + chunk, loading: true },
              }));
            },
            onComplete: () => {
              setHunkNaturalContent((c) => ({
                ...c,
                [hunkId]: { text: c[hunkId]?.text || '', loading: false },
              }));
            },
            onError: (err: Error) => {
              setHunkNaturalContent((c) => ({
                ...c,
                [hunkId]: {
                  text: (c[hunkId]?.text || '') + `\n\n*(转译异常: ${err.message})*`,
                  loading: false,
                },
              }));
            },
          });
        }
        return next;
      }
    });
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
            {hunks.length} 个改动块
          </span>
        </div>

        {/* Right Action buttons */}
        <div className="flex items-center space-x-2.5">
          {/* Quick select all blocks button if file has multiple hunks */}
          {hunks.length > 1 && (
            <button
              onClick={selectedHunkIds.size === hunks.length ? clearHunkSelection : selectAllHunks}
              className="text-xs text-slate-400 hover:text-purple-300 transition flex items-center gap-1 mr-1"
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

          {/* Global Pseudocode / Natural Language Code Switcher */}
          <button
            onClick={() => setIsGlobalPseudocode((prev) => !prev)}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition border ${
              isGlobalPseudocode
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white border-purple-400 shadow-md shadow-purple-500/20'
                : 'bg-[#1E202A] hover:bg-[#282A38] text-slate-300 border-white/10 hover:text-white'
            }`}
            title="将 Diff 改动代码直接替换为高度提炼概括的中文自然语言伪代码"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isGlobalPseudocode ? 'text-white' : 'text-purple-400'}`} />
            <span>{isGlobalPseudocode ? '🔤 概括伪代码显示中' : '显示为概括伪代码'}</span>
          </button>

          {/* Mode Selector Segmented Button in Toolbar */}
          <div className="flex items-center bg-[#1E202A] border border-white/10 rounded-lg p-0.5 text-xs">
            <button
              onClick={() => setDefaultMode('agent')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md transition font-medium ${
                defaultMode === 'agent'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="默认模式：关联解释（Codex Agent 自主全库探查）"
            >
              <Brain className="w-3 h-3 text-purple-300" />
              <span>关联解释</span>
            </button>
            <button
              onClick={() => setDefaultMode('fast')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md transition font-medium ${
                defaultMode === 'fast'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="默认模式：直接 Diff 解释（仅看增删改动）"
            >
              <Zap className="w-3 h-3 text-amber-300" />
              <span>直接 Diff</span>
            </button>
          </div>

          {/* AI Explain File Button */}
          <button
            onClick={() => onExplainFile(file, defaultMode)}
            className={`flex items-center space-x-1.5 text-white text-xs font-medium px-2.5 py-1 rounded shadow transition ${
              defaultMode === 'agent'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500'
                : 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500'
            }`}
            title={`使用当前「${defaultMode === 'agent' ? '文件关联模式' : '直接 Diff 模式'}」审查整个文件`}
          >
            {defaultMode === 'agent' ? <Brain className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
            <span>
              {defaultMode === 'agent' ? 'Codex 关联解释此文件' : '直接解释此文件'}
            </span>
          </button>

          {/* Mode Switcher: Split vs Unified */}
          <div className="flex items-center bg-[#1E202A] border border-white/10 rounded p-0.5 space-x-0.5">
            <button
              onClick={() => onToggleViewMode('split')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-xs transition ${
                viewMode === 'split'
                  ? 'bg-purple-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="双栏代码对比 (Side-by-Side Split Diff)"
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
              title="单栏内联代码对比 (Inline Unified Diff)"
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
          const isNaturalExpanded = expandedNaturalHunkIds.has(hunk.id);
          const isHunkPseudocode = isGlobalPseudocode || hunkPseudocodeSet.has(hunk.id);
          const hunkText = getHunkDiffText(hunk);

          const conceptual = isHunkPseudocode ? generateConceptualHunkPseudocode(hunk) : null;

          return (
            <div
              key={`hunk-block-${hunkIdx}`}
              className={`relative group transition-all duration-150 border-b border-white/5 ${
                isSelected
                  ? 'bg-purple-950/15 border-l-4 border-l-purple-500 shadow-sm'
                  : 'hover:bg-white/[0.015]'
              }`}
            >
              {/* Floating Hunk Hover Toolbar with Clear Distinction Buttons */}
              <div
                className={`absolute right-4 top-2 z-20 flex items-center space-x-1.5 transition-opacity duration-150 ${
                  isSelected || isNaturalExpanded || isHunkPseudocode
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
                      ? 'bg-purple-600 text-white border-purple-400'
                      : 'bg-[#1D1F2A]/90 text-slate-300 border-white/10 hover:border-purple-500/50 hover:text-white'
                  }`}
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

                {/* Per-Hunk Conceptual Pseudocode Toggle */}
                <button
                  type="button"
                  onClick={() => toggleHunkPseudocode(hunk.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-sans font-semibold flex items-center space-x-1 border backdrop-blur-md shadow-md transition hover:scale-105 active:scale-95 ${
                    isHunkPseudocode
                      ? 'bg-purple-600 text-white border-purple-400 shadow-purple-600/30'
                      : 'bg-[#1D1F2A]/90 hover:bg-purple-600/30 text-purple-300 hover:text-white border-purple-500/30'
                  }`}
                  title="将本块代码直接替换为概括性伪代码"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{isHunkPseudocode ? '概括伪代码 [开]' : '显示为伪代码'}</span>
                </button>

                {/* Inline Natural Language Summary Toggle Button on this Hunk */}
                <button
                  type="button"
                  onClick={() => toggleHunkNaturalLanguage(hunk.id, hunk)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-sans font-semibold flex items-center space-x-1 border backdrop-blur-md shadow-md transition hover:scale-105 active:scale-95 ${
                    isNaturalExpanded
                      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white border-purple-400 shadow-purple-600/30'
                      : 'bg-[#1D1F2A]/90 hover:bg-purple-600/30 text-purple-300 hover:text-white border-purple-500/30'
                  }`}
                  title="点击在此 Diff 块内直接展开/折叠自然语言直读释义"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>{isNaturalExpanded ? '收起释义' : '📖 块释义'}</span>
                </button>

                {/* Option 1: Fast Direct Diff Explain Button */}
                <button
                  type="button"
                  onClick={() => onExplainHunk(hunk.header, hunkText, hunk.index, 'fast')}
                  className="px-2 py-1 rounded-md bg-amber-600/30 hover:bg-amber-600/60 text-amber-200 border border-amber-500/40 text-[11px] font-sans font-medium flex items-center space-x-1 backdrop-blur-md shadow transition hover:scale-105"
                  title="【直接 Diff 解释】仅针对当前增删代码直接解释，不查阅外部文件"
                >
                  <Zap className="w-3 h-3 text-amber-400" />
                  <span>直接解释</span>
                </button>

                {/* Option 2: Codex Agent Context-Aware Explain Button */}
                <button
                  type="button"
                  onClick={() => onExplainHunk(hunk.header, hunkText, hunk.index, 'agent')}
                  className="px-2.5 py-1 rounded-md bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-[11px] font-sans font-semibold flex items-center space-x-1 shadow-lg shadow-purple-600/30 border border-purple-400/30 transition hover:scale-105 active:scale-95"
                  title="【文件关联解释】Codex 智能体将自主检索全库关联文件与下游调用"
                >
                  <Brain className="w-3.5 h-3.5" />
                  <span>关联解释 (Codex)</span>
                </button>
              </div>

              {/* Hunk Header for Split Mode */}
              {viewMode === 'split' && (
                <div className="bg-indigo-950/30 border-y border-indigo-500/20 px-3 py-1 text-xs text-indigo-300 font-mono select-none flex items-center justify-between">
                  <span>{hunk.header}</span>
                  <div className="flex items-center space-x-2">
                    {isHunkPseudocode && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-sans font-medium">
                        ✨ 概括性伪代码模式
                      </span>
                    )}
                    <span className="text-[11px] text-slate-500 font-sans">块 #{hunk.index}</span>
                  </div>
                </div>
              )}

              {/* Inline Natural Language Explanation Banner */}
              {isNaturalExpanded && (
                <div className="bg-gradient-to-r from-purple-950/35 via-[#181926] to-indigo-950/35 border-y border-purple-500/30 px-5 py-3.5 text-xs text-slate-200 backdrop-blur-md flex items-start space-x-3 shadow-inner animate-in fade-in duration-150">
                  <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300 shrink-0 mt-0.5 border border-purple-500/30">
                    <BookOpen className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-purple-200 text-xs">
                          改动块 #{hunk.index} 自然语言直读
                        </span>
                        {hunkNaturalContent[hunk.id]?.loading && (
                          <span className="text-[10px] text-purple-400 animate-pulse font-mono font-normal">
                            (AI 正在实时转译中...)
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => toggleHunkNaturalLanguage(hunk.id, hunk)}
                        className="text-[10px] text-slate-400 hover:text-slate-200 transition"
                      >
                        收起
                      </button>
                    </div>
                    <div className="text-slate-300 leading-relaxed font-sans text-xs">
                      {hunkNaturalContent[hunk.id]?.text ? (
                        <div
                          className="prose prose-invert prose-sm max-w-none text-slate-200 text-xs leading-relaxed"
                          dangerouslySetInnerHTML={{
                            __html: marked.parse(hunkNaturalContent[hunk.id].text) as string,
                          }}
                        />
                      ) : (
                        <span className="text-slate-400 animate-pulse text-[11px]">
                          正在调用 AI 将该块代码改动转译为自然语言叙述...
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Main Hunk Content: Conceptual Pseudocode Summary VS Raw Diff Lines */}
              {isHunkPseudocode && conceptual ? (
                <div className="p-4 bg-[#14151E] border-b border-white/5 space-y-3 font-sans">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-xs font-bold text-purple-300">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      <span>改动块 #{hunk.index} 概括性伪代码对照 (Conceptual Pseudocode)</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">已将繁杂代码行提炼为高层语义步骤</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {/* Old Logic Conceptual Summary */}
                    <div className="bg-rose-950/20 border border-rose-500/20 rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-rose-400 pb-1.5 border-b border-rose-500/10">
                        <span>🔴 变更前旧逻辑概括 ({hunk.deletions} 行)</span>
                      </div>
                      {conceptual.oldPseudocode.length > 0 ? (
                        <ul className="space-y-1.5 text-rose-200">
                          {conceptual.oldPseudocode.map((step, sIdx) => (
                            <li key={`old-s-${sIdx}`} className="flex items-start space-x-2 leading-relaxed">
                              <span className="text-rose-400 shrink-0 font-bold">•</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-slate-500 text-xs italic">无删除行 (纯新增逻辑)</span>
                      )}
                    </div>

                    {/* New Logic Conceptual Summary */}
                    <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-emerald-400 pb-1.5 border-b border-emerald-500/10">
                        <span>🟢 变更后新逻辑概括 (+{hunk.additions} 行)</span>
                      </div>
                      {conceptual.newPseudocode.length > 0 ? (
                        <ul className="space-y-1.5 text-emerald-200">
                          {conceptual.newPseudocode.map((step, sIdx) => (
                            <li key={`new-s-${sIdx}`} className="flex items-start space-x-2 leading-relaxed">
                              <span className="text-emerald-400 shrink-0 font-bold">•</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-slate-500 text-xs italic">无新增行 (纯删除逻辑)</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* Raw Diff Lines Rendering (Split / Unified) */
                viewMode === 'unified' ? (
                  <div>{hunk.lines.map((line, lineIdx) => renderUnifiedLine(line, lineIdx))}</div>
                ) : (
                  <div>{hunk.splitRows.map((row, rowIdx) => renderSplitRow(row, rowIdx))}</div>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Floating Multi-Selection Action Bar (with Dual Mode Buttons) */}
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

          {/* Dual Action Buttons for Multi-Selection */}
          <div className="flex items-center space-x-2">
            {/* Direct Diff Multi-Explain */}
            <button
              onClick={() => onExplainMultipleHunks(selectedHunkObjects, file, 'fast')}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/40 font-medium text-xs rounded-lg transition"
              title="仅针对选中的改动块进行直接快速对比解释"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>直接联合解释 ({selectedHunkIds.size} 块)</span>
            </button>

            {/* Codex Agent Multi-Explain */}
            <button
              onClick={() => onExplainMultipleHunks(selectedHunkObjects, file, 'agent')}
              className="flex items-center space-x-2 px-4 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs rounded-lg shadow-lg shadow-purple-600/30 transition hover:scale-105 active:scale-95"
              title="Codex 智能体将探查代码库，联合分析所选改动块的跨文件影响"
            >
              <Brain className="w-4 h-4" />
              <span>Codex 关联联合解释 ({selectedHunkIds.size} 块)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
