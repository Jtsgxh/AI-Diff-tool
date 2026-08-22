import React, { useCallback, useMemo, useState } from 'react';
import { STORAGE_KEYS } from '../../constants/storage';
import { useResizableSplit } from '../../hooks/useResizableSplit';
import { Brain, FileCode, Layers, Zap } from 'lucide-react';
import type { AIProviderConfig, DiffFile, DiffViewMode } from '../../types';
import { parseRawDiff, type DiffHunk } from '../../utils/diffParser';
import { DiffToolbar } from './DiffToolbar';
import { HunkBlock } from './HunkBlock';
import { useHunkAnnotations } from './hooks/useHunkAnnotations';
import { DEFERRED_MOUNT_ROW_THRESHOLD, totalRenderedRows } from './hunkMetrics';

interface DiffViewerProps {
  file: DiffFile | null;
  viewMode: DiffViewMode;
  onToggleViewMode: (mode: DiffViewMode) => void;
  onExplainHunk: (
    hunkHeader: string,
    hunkDiff: string,
    hunkIndex?: number,
    mode?: 'agent' | 'fast'
  ) => void;
  onExplainMultipleHunks: (
    selectedHunks: DiffHunk[],
    file: DiffFile,
    mode?: 'agent' | 'fast'
  ) => void;
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
  /** Engine used by the per-hunk and per-file explain buttons. */
  const [defaultMode, setDefaultMode] = useState<'agent' | 'fast'>('agent');
  const [selectedHunkIds, setSelectedHunkIds] = useState<Set<string>>(new Set());
  const split = useResizableSplit(STORAGE_KEYS.diffSplitPct);

  const annotations = useHunkAnnotations(file, aiConfig);

  const parsedDiff = useMemo(() => {
    if (!file?.diff) return null;
    return parseRawDiff(file.diff);
  }, [file?.diff]);

  const hunks = parsedDiff?.hunks;

  // Hunk ids are only unique within one parsed diff, so a stale selection must
  // not survive a new one. Adjusting during render (rather than in an effect)
  // avoids a frame where the wrong hunks appear selected.
  const lastParsedRef = React.useRef(parsedDiff);
  if (lastParsedRef.current !== parsedDiff) {
    lastParsedRef.current = parsedDiff;
    if (selectedHunkIds.size > 0) setSelectedHunkIds(new Set());
  }

  /** Large files mount their rows lazily; small ones render eagerly. */
  const deferMount = useMemo(
    () => (hunks ? totalRenderedRows(hunks, viewMode) > DEFERRED_MOUNT_ROW_THRESHOLD : false),
    [hunks, viewMode]
  );

  const toggleHunkSelection = useCallback((hunkId: string) => {
    setSelectedHunkIds((prev) => {
      const next = new Set(prev);
      if (next.has(hunkId)) next.delete(hunkId);
      else next.add(hunkId);
      return next;
    });
  }, []);

  const handleExplainHunk = useCallback(
    (hunk: DiffHunk, mode: 'agent' | 'fast') => {
      onExplainHunk(hunk.header, hunk.text, hunk.index, mode);
    },
    [onExplainHunk]
  );

  const selectAllHunks = useCallback(() => {
    setSelectedHunkIds(new Set((hunks || []).map((h) => h.id)));
  }, [hunks]);

  const clearHunkSelection = useCallback(() => setSelectedHunkIds(new Set()), []);

  const handleToggleSelectAll = useCallback(() => {
    if (hunks && selectedHunkIds.size === hunks.length) clearHunkSelection();
    else selectAllHunks();
  }, [clearHunkSelection, hunks, selectAllHunks, selectedHunkIds.size]);

  const { toggleAllPseudocode } = annotations;
  const handleToggleGlobalPseudocode = useCallback(() => {
    if (hunks) toggleAllPseudocode(hunks);
  }, [hunks, toggleAllPseudocode]);

  const handleExplainFile = useCallback(() => {
    if (file) onExplainFile(file, defaultMode);
  }, [defaultMode, file, onExplainFile]);

  const selection = useMemo(() => {
    if (!hunks) return { hunks: [] as DiffHunk[], additions: 0, deletions: 0 };
    const selected = hunks.filter((h) => selectedHunkIds.has(h.id));
    return {
      hunks: selected,
      additions: selected.reduce((sum, h) => sum + h.additions, 0),
      deletions: selected.reduce((sum, h) => sum + h.deletions, 0),
    };
  }, [hunks, selectedHunkIds]);

  const isPseudocodeLoading = useMemo(
    () => (hunks || []).some((h) => annotations.pseudocodeLines[h.id]?.loading),
    [annotations.pseudocodeLines, hunks]
  );

  if (!file || !parsedDiff || !hunks) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#17181F] text-slate-500 p-8">
        <FileCode className="w-12 h-12 mb-3 text-slate-600 stroke-1" />
        <p className="text-sm font-medium text-slate-400">请选择左侧文件以查看代码差异对比</p>
        <p className="text-xs text-slate-600 mt-1">
          支持「⚡ 直接 Diff 解释」、「🧠 文件关联解释 (Codex)」与「🤖 AI 伪代码对照」
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181921] overflow-hidden relative">
      <DiffToolbar
        file={file}
        hunkCount={hunks.length}
        selectedCount={selectedHunkIds.size}
        viewMode={viewMode}
        defaultMode={defaultMode}
        isPseudocodeActive={annotations.pseudocodeHunkIds.size > 0}
        isPseudocodeLoading={isPseudocodeLoading}
        onToggleSelectAll={handleToggleSelectAll}
        onToggleGlobalPseudocode={handleToggleGlobalPseudocode}
        onSetDefaultMode={setDefaultMode}
        onExplainFile={handleExplainFile}
        onToggleViewMode={onToggleViewMode}
      />

      <div ref={split.containerRef} className="flex-1 relative min-h-0 bg-[#13141A]">
        <div
          className="absolute inset-0 overflow-auto pb-16"
          style={{ ['--diff-split-left' as string]: `${split.pct}%` }}
        >
          {hunks.map((hunk) => (
            <HunkBlock
              key={hunk.id}
              hunk={hunk}
              viewMode={viewMode}
              isSelected={selectedHunkIds.has(hunk.id)}
              showPseudocode={annotations.pseudocodeHunkIds.has(hunk.id)}
              pseudocode={annotations.pseudocodeLines[hunk.id]}
              showNaturalLanguage={annotations.naturalHunkIds.has(hunk.id)}
              naturalLanguage={annotations.naturalContent[hunk.id]}
              deferMount={deferMount}
              onToggleSelection={toggleHunkSelection}
              onTogglePseudocode={annotations.togglePseudocode}
              onToggleNaturalLanguage={annotations.toggleNaturalLanguage}
              onExplain={handleExplainHunk}
            />
          ))}
        </div>

        {viewMode === 'split' && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(split.pct)}
            aria-valuemin={20}
            aria-valuemax={80}
            title="拖动调整左右栏宽度 · 双击恢复 50/50"
            onPointerDown={split.onPointerDown}
            onPointerMove={split.onPointerMove}
            onPointerUp={split.onPointerUp}
            onPointerCancel={split.onPointerUp}
            onDoubleClick={split.reset}
            className="absolute top-0 bottom-0 z-20 w-2 -ml-1 cursor-col-resize group/split"
            style={{ left: `${split.pct}%` }}
          >
            <div className="mx-auto h-full w-px bg-white/20 group-hover/split:w-0.5 group-hover/split:bg-purple-400 group-active/split:bg-purple-300 transition-[width,background-color]" />
          </div>
        )}
      </div>

      {/* Multi-selection action bar */}
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
              {selection.additions > 0 && (
                <span className="text-emerald-400">+{selection.additions}</span>
              )}
              {selection.deletions > 0 && (
                <span className="text-rose-400">-{selection.deletions}</span>
              )}
            </div>

            <div className="flex items-center space-x-2 text-[11px] text-slate-400 pl-2 border-l border-white/10">
              <button onClick={selectAllHunks} className="hover:text-white underline transition">
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

          <div className="flex items-center space-x-2">
            <button
              onClick={() => onExplainMultipleHunks(selection.hunks, file, 'fast')}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/40 font-medium text-xs rounded-lg transition"
              title="仅针对选中的改动块进行直接快速对比解释"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>直接联合解释 ({selectedHunkIds.size} 块)</span>
            </button>

            <button
              onClick={() => onExplainMultipleHunks(selection.hunks, file, 'agent')}
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
