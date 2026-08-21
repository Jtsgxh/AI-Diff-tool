import React, { useMemo, useState, useEffect, useRef } from 'react';
import { DiffFile, DiffViewMode, AIProviderConfig } from '../../types';
import { parseRawDiff, DiffHunk, SplitDiffRow, DiffLine } from '../../utils/diffParser';
import { parseAiPseudocodeLines } from '../../utils/pseudocodeConverter';
import { streamExplainDiff } from '../../services/api';
import { DEFAULT_PROMPTS } from '../../constants/defaultPrompts';
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
  RotateCcw,
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

  // Hunks with Pseudocode enabled
  const [hunkPseudocodeSet, setHunkPseudocodeSet] = useState<Set<string>>(new Set());

  // AI-Driven In-Place Pseudocode Line Map per Hunk
  const [hunkAiLineMap, setHunkAiLineMap] = useState<
    Record<string, { dels: string[]; adds: string[]; loading: boolean }>
  >({});

  // In-memory cache for generated pseudocode lines to prevent duplicate AI calls
  const pseudocodeCacheRef = useRef<Map<string, { dels: string[]; adds: string[] }>>(new Map());

  // Active abort controllers for in-flight requests per hunk
  const activeAbortsRef = useRef<Map<string, () => void>>(new Map());

  // Inline Natural Language State per Hunk
  const [expandedNaturalHunkIds, setExpandedNaturalHunkIds] = useState<Set<string>>(new Set());
  const [hunkNaturalContent, setHunkNaturalContent] = useState<
    Record<string, { text: string; loading: boolean }>
  >({});

  // Reset per-file UI states immediately when switching to a different file or commit
  useEffect(() => {
    // Abort all in-flight AI requests when switching files
    activeAbortsRef.current.forEach((abort) => abort());
    activeAbortsRef.current.clear();

    setSelectedHunkIds(new Set());
    setHunkPseudocodeSet(new Set());
    setExpandedNaturalHunkIds(new Set());
  }, [file?.newPath, file?.oldPath, file?.diff]);

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
          支持「⚡ 直接 Diff 解释」、「🧠 文件关联解释 (Codex)」与「🤖 AI 伪代码对照」
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

  const getHunkDiffText = (hunk: DiffHunk) => {
    return hunk.lines
      .map((l) =>
        l.type === 'add' ? `+${l.content}` : l.type === 'delete' ? `-${l.content}` : ` ${l.content}`
      )
      .join('\n');
  };

  // Fetch AI-Driven Pseudocode for a specific Hunk (with cache & duplicate request prevention)
  const fetchAiPseudocode = async (hunkId: string, hunk: DiffHunk) => {
    const hunkDiffText = getHunkDiffText(hunk);
    const cacheKey = `${file.newPath}::${hunkId}::${hunkDiffText.length}`;

    // 1. Check in-memory cache: if already translated, load instantly with 0 network calls
    const cached = pseudocodeCacheRef.current.get(cacheKey);
    if (cached) {
      setHunkAiLineMap((prev) => ({
        ...prev,
        [hunkId]: { dels: cached.dels, adds: cached.adds, loading: false },
      }));
      return;
    }

    // 2. Abort any previous in-flight request for this hunk
    if (activeAbortsRef.current.has(hunkId)) {
      activeAbortsRef.current.get(hunkId)?.();
      activeAbortsRef.current.delete(hunkId);
    }

    setHunkAiLineMap((prev) => ({
      ...prev,
      [hunkId]: { dels: prev[hunkId]?.dels || [], adds: prev[hunkId]?.adds || [], loading: true },
    }));

    const prompt = aiConfig.pseudocodePrompt?.trim() || DEFAULT_PROMPTS.pseudocodePrompt;
    let accumulatedText = '';
    let lastRenderedLineCount = 0;

    const cancelStream = await streamExplainDiff({
      scopeType: 'chunk',
      filePath: file.newPath,
      diff: hunkDiffText,
      userPrompt: prompt,
      config: aiConfig,
      onChunk: (chunk: string) => {
        accumulatedText += chunk;
        // Only trigger UI update on complete line boundaries to avoid token-by-token flickering
        const lineCount = (accumulatedText.match(/\n/g) || []).length;
        if (lineCount > lastRenderedLineCount) {
          lastRenderedLineCount = lineCount;
          const parsed = parseAiPseudocodeLines(accumulatedText);
          setHunkAiLineMap((prev) => ({
            ...prev,
            [hunkId]: { dels: parsed.dels, adds: parsed.adds, loading: true },
          }));
        }
      },
      onComplete: () => {
        activeAbortsRef.current.delete(hunkId);
        const parsed = parseAiPseudocodeLines(accumulatedText);
        pseudocodeCacheRef.current.set(cacheKey, parsed);
        setHunkAiLineMap((prev) => ({
          ...prev,
          [hunkId]: { dels: parsed.dels, adds: parsed.adds, loading: false },
        }));
      },
      onError: (err: Error) => {
        activeAbortsRef.current.delete(hunkId);
        console.warn('AI pseudocode error:', err);
        setHunkAiLineMap((prev) => ({
          ...prev,
          [hunkId]: { dels: prev[hunkId]?.dels || [], adds: prev[hunkId]?.adds || [], loading: false },
        }));
      },
    });

    activeAbortsRef.current.set(hunkId, cancelStream);
  };

  // Toggle Pseudocode for an individual Hunk (guaranteed 2-way on/off toggle + AI trigger)
  const toggleHunkPseudocode = (hunkId: string, hunk?: DiffHunk) => {
    const isCurrentlyOn = hunkPseudocodeSet.has(hunkId);

    if (isCurrentlyOn) {
      // Turn off
      setHunkPseudocodeSet((prev) => {
        const next = new Set(prev);
        next.delete(hunkId);
        return next;
      });
      // Abort in-flight request if user turns off
      if (activeAbortsRef.current.has(hunkId)) {
        activeAbortsRef.current.get(hunkId)?.();
        activeAbortsRef.current.delete(hunkId);
      }
    } else {
      // Turn on
      setHunkPseudocodeSet((prev) => {
        const next = new Set(prev);
        next.add(hunkId);
        return next;
      });

      if (hunk && (aiConfig.apiKey || aiConfig.provider === 'ollama')) {
        const isAlreadyLoaded =
          (hunkAiLineMap[hunkId]?.dels?.length || 0) > 0 ||
          (hunkAiLineMap[hunkId]?.adds?.length || 0) > 0;
        const isLoading = hunkAiLineMap[hunkId]?.loading;
        if (!isAlreadyLoaded && !isLoading) {
          fetchAiPseudocode(hunkId, hunk);
        }
      }
    }
  };

  // Global Toggle Pseudocode for all Hunks
  const toggleGlobalPseudocode = () => {
    if (hunkPseudocodeSet.size > 0) {
      // Turn all off & abort any in-flight requests
      activeAbortsRef.current.forEach((abort) => abort());
      activeAbortsRef.current.clear();
      setHunkPseudocodeSet(new Set());
    } else {
      const newSet = new Set(hunks.map((h) => h.id));
      setHunkPseudocodeSet(newSet); // Turn all on
      if (aiConfig.apiKey || aiConfig.provider === 'ollama') {
        hunks.forEach((h) => {
          const isAlreadyLoaded =
            (hunkAiLineMap[h.id]?.dels?.length || 0) > 0 ||
            (hunkAiLineMap[h.id]?.adds?.length || 0) > 0;
          const isLoading = hunkAiLineMap[h.id]?.loading;
          if (!isAlreadyLoaded && !isLoading) {
            fetchAiPseudocode(h.id, h);
          }
        });
      }
    }
  };

  const selectedHunkObjects = hunks.filter((h) => selectedHunkIds.has(h.id));
  const totalSelectedAdds = selectedHunkObjects.reduce((sum, h) => sum + h.additions, 0);
  const totalSelectedDels = selectedHunkObjects.reduce((sum, h) => sum + h.deletions, 0);

  // Toggle Inline Natural Language for a specific Hunk (ONLY ON CLICK)
  const toggleHunkNaturalLanguage = (hunkId: string, hunk: DiffHunk) => {
    const isCurrentlyExpanded = expandedNaturalHunkIds.has(hunkId);

    if (isCurrentlyExpanded) {
      setExpandedNaturalHunkIds((prev) => {
        const next = new Set(prev);
        next.delete(hunkId);
        return next;
      });
    } else {
      setExpandedNaturalHunkIds((prev) => {
        const next = new Set(prev);
        next.add(hunkId);
        return next;
      });

      // Fetch AI translation if not yet loaded
      if (!hunkNaturalContent[hunkId]?.text && !hunkNaturalContent[hunkId]?.loading) {
        setHunkNaturalContent((c) => ({
          ...c,
          [hunkId]: { text: '', loading: true },
        }));

        const hunkDiffText = getHunkDiffText(hunk);
        const prompt =
          aiConfig.naturalLanguagePrompt?.trim() || DEFAULT_PROMPTS.naturalLanguagePrompt;

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
    }
  };

  const renderHunkUnifiedLines = (hunk: DiffHunk, isHunkPseudocode: boolean) => {
    const aiMap = hunkAiLineMap[hunk.id];
    let delCounter = 0;
    let addCounter = 0;

    return hunk.lines.map((line, lineIdx) => {
      if (line.type === 'hunk-header') {
        return (
          <div
            key={`hunk-hdr-${lineIdx}`}
            className="bg-indigo-950/30 border-y border-indigo-500/20 px-3 py-1 text-xs text-indigo-300 font-mono select-none flex items-center justify-between"
          >
            <span>{line.content}</span>
            {isHunkPseudocode && (
              <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30 font-sans flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                <span>AI 伪代码转换</span>
                {aiMap?.loading && <span className="animate-pulse">(大模型生成中...)</span>}
              </span>
            )}
          </div>
        );
      }

      const isAdd = line.type === 'add';
      const isDelete = line.type === 'delete';

      const currentDelIdx = isDelete ? delCounter++ : -1;
      const currentAddIdx = isAdd ? addCounter++ : -1;

      const aiDelText = isDelete && aiMap?.dels && currentDelIdx < aiMap.dels.length ? aiMap.dels[currentDelIdx] : null;
      const aiAddText = isAdd && aiMap?.adds && currentAddIdx < aiMap.adds.length ? aiMap.adds[currentAddIdx] : null;

      const displayContent =
        isHunkPseudocode && (isAdd || isDelete)
          ? (aiDelText || aiAddText || line.content)
          : line.content;

      return (
        <div
          key={`line-${lineIdx}`}
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

          {/* Code Content (In-place translated purely by AI when pseudocode is on) */}
          <div className="flex-1 whitespace-pre pl-1 pr-4 overflow-x-auto min-w-0">
            {displayContent}
          </div>
        </div>
      );
    });
  };

  const renderHunkSplitRows = (hunk: DiffHunk, isHunkPseudocode: boolean) => {
    const aiMap = hunkAiLineMap[hunk.id];
    let delCounter = 0;
    let addCounter = 0;

    return hunk.splitRows.map((row, rowIdx) => {
      const leftIsDelete = row.left?.type === 'delete';
      const rightIsAdd = row.right?.type === 'add';

      const currentDelIdx = leftIsDelete ? delCounter++ : -1;
      const currentAddIdx = rightIsAdd ? addCounter++ : -1;

      const aiDelText = leftIsDelete && aiMap?.dels && currentDelIdx < aiMap.dels.length ? aiMap.dels[currentDelIdx] : null;
      const aiAddText = rightIsAdd && aiMap?.adds && currentAddIdx < aiMap.adds.length ? aiMap.adds[currentAddIdx] : null;

      const leftContent =
        isHunkPseudocode && leftIsDelete && row.left?.content
          ? (aiDelText || row.left.content)
          : row.left?.content || '';

      const rightContent =
        isHunkPseudocode && rightIsAdd && row.right?.content
          ? (aiAddText || row.right.content)
          : row.right?.content || '';

      return (
        <div
          key={`split-row-${rowIdx}`}
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
              {leftContent}
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
              {rightContent}
            </div>
          </div>
        </div>
      );
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181921] overflow-hidden relative">
      {/* Diff Toolbar */}
      <div className="h-11 bg-[#15161C] border-b border-white/10 px-3 flex items-center justify-between select-none shrink-0 gap-2 overflow-x-auto">
        <div className="flex items-center space-x-2 min-w-0 shrink">
          <FileCode className="w-4 h-4 text-purple-400 shrink-0" />
          <span className="font-mono text-xs font-semibold text-slate-200 truncate max-w-[160px] md:max-w-[260px] lg:max-w-[360px]" title={file.newPath}>
            {file.newPath}
          </span>
          <span className="text-[11px] text-emerald-400 font-mono shrink-0">+{file.additions}</span>
          <span className="text-[11px] text-rose-400 font-mono shrink-0">-{file.deletions}</span>
          <span className="text-[11px] bg-white/5 text-slate-400 px-1.5 py-0.5 rounded font-mono shrink-0 hidden sm:inline-block">
            {hunks.length} 块
          </span>
        </div>

        {/* Right Action buttons */}
        <div className="flex items-center space-x-2 shrink-0">
          {/* Quick select all blocks button if file has multiple hunks */}
          {hunks.length > 1 && (
            <button
              onClick={selectedHunkIds.size === hunks.length ? clearHunkSelection : selectAllHunks}
              className="text-xs text-slate-400 hover:text-purple-300 transition flex items-center gap-1 shrink-0 whitespace-nowrap px-1"
              title="多选当前文件的所有改动块"
            >
              {selectedHunkIds.size === hunks.length ? (
                <>
                  <CheckSquare className="w-3.5 h-3.5 text-purple-400 shrink-0" />
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

          {/* Global Pseudocode Toggle Button */}
          {(() => {
            const isGlobalLoading = hunks.some((h) => hunkAiLineMap[h.id]?.loading);
            const isAnyActive = hunkPseudocodeSet.size > 0;
            return (
              <button
                onClick={toggleGlobalPseudocode}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition border shrink-0 whitespace-nowrap ${
                  isAnyActive
                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white border-purple-400 shadow-md shadow-purple-500/20'
                    : 'bg-[#1E202A] hover:bg-[#282A38] text-slate-300 border-white/10 hover:text-white'
                }`}
                title={isAnyActive ? "点击关闭全部伪代码，恢复显示原始代码" : "将 Diff 改动代码直接替换为高度提炼概括的中文自然语言伪代码"}
              >
                <Sparkles className={`w-3.5 h-3.5 shrink-0 ${isGlobalLoading ? 'animate-spin text-purple-300' : isAnyActive ? 'text-white' : 'text-purple-400'}`} />
                <span>
                  {isAnyActive
                    ? isGlobalLoading
                      ? 'AI 转换中...'
                      : '🔤 伪代码 [开]'
                    : '🔤 伪代码'}
                </span>
              </button>
            );
          })()}

          {/* Mode Selector Segmented Button in Toolbar */}
          <div className="flex items-center bg-[#1E202A] border border-white/10 rounded-lg p-0.5 text-xs shrink-0 whitespace-nowrap">
            <button
              onClick={() => setDefaultMode('agent')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md transition font-medium whitespace-nowrap shrink-0 ${
                defaultMode === 'agent'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="默认模式：关联解释（Codex Agent 自主全库探查）"
            >
              <Brain className="w-3 h-3 text-purple-300 shrink-0" />
              <span>关联解释</span>
            </button>
            <button
              onClick={() => setDefaultMode('fast')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md transition font-medium whitespace-nowrap shrink-0 ${
                defaultMode === 'fast'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="默认模式：直接 Diff 解释（仅看增删改动）"
            >
              <Zap className="w-3 h-3 text-amber-300 shrink-0" />
              <span>直接 Diff</span>
            </button>
          </div>

          {/* AI Explain File Button */}
          <button
            onClick={() => onExplainFile(file, defaultMode)}
            className={`flex items-center space-x-1.5 text-white text-xs font-medium px-2.5 py-1 rounded-lg shadow transition shrink-0 whitespace-nowrap ${
              defaultMode === 'agent'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500'
                : 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500'
            }`}
            title={`使用当前「${defaultMode === 'agent' ? '文件关联模式' : '直接 Diff 模式'}」审查整个文件`}
          >
            {defaultMode === 'agent' ? <Brain className="w-3.5 h-3.5 shrink-0" /> : <Zap className="w-3.5 h-3.5 shrink-0" />}
            <span>
              {defaultMode === 'agent' ? 'Codex 解释此文件' : '解释此文件'}
            </span>
          </button>

          {/* Mode Switcher: Split vs Unified */}
          <div className="flex items-center bg-[#1E202A] border border-white/10 rounded-lg p-0.5 space-x-0.5 shrink-0 whitespace-nowrap">
            <button
              onClick={() => onToggleViewMode('split')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md text-xs transition whitespace-nowrap shrink-0 ${
                viewMode === 'split'
                  ? 'bg-purple-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
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
                  ? 'bg-purple-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="单栏内联代码对比 (Inline Unified Diff)"
            >
              <AlignJustify className="w-3 h-3 shrink-0" />
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
          const isHunkPseudocode = hunkPseudocodeSet.has(hunk.id);
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

                {/* Per-Hunk In-Place AI Pseudocode Toggle */}
                <button
                  type="button"
                  onClick={() => toggleHunkPseudocode(hunk.id, hunk)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-sans font-semibold flex items-center space-x-1 border backdrop-blur-md shadow-md transition hover:scale-105 active:scale-95 ${
                    isHunkPseudocode
                      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white border-purple-400 shadow-purple-600/30'
                      : 'bg-[#1D1F2A]/90 hover:bg-purple-600/30 text-purple-300 hover:text-white border-purple-500/30'
                  }`}
                  title={isHunkPseudocode ? "点击关闭伪代码，恢复显示原始代码" : "点击通过 AI 将本块 Diff 改动行原位转译为伪代码"}
                >
                  <Sparkles className={`w-3 h-3 ${hunkAiLineMap[hunk.id]?.loading ? 'animate-spin text-purple-300' : ''}`} />
                  <span>
                    {isHunkPseudocode
                      ? hunkAiLineMap[hunk.id]?.loading
                        ? 'AI 伪代码 (生成中...)'
                        : 'AI 伪代码 [开]'
                      : '🤖 AI 伪代码'}
                  </span>
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

              {/* Standard Diff Rows Rendering with In-Place Pseudocode Replacement on Changed Lines */}
              {viewMode === 'unified' ? (
                <div>{renderHunkUnifiedLines(hunk, isHunkPseudocode)}</div>
              ) : (
                <div>{renderHunkSplitRows(hunk, isHunkPseudocode)}</div>
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
