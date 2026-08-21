import React, { useState, useMemo } from 'react';
import { DiffFile, DiffViewMode, AIProviderConfig } from '../../types';
import { DiffHunk } from '../../utils/diffParser';
import { streamExplainDiff } from '../../services/api';
import { DEFAULT_PROMPTS } from '../../constants/defaultPrompts';
import {
  BookOpen,
  Sparkles,
  Copy,
  Check,
  ArrowRight,
  Code2,
  Layers,
  RotateCcw,
} from 'lucide-react';
import { marked } from 'marked';

interface NaturalLanguageDiffViewProps {
  file: DiffFile;
  hunks: DiffHunk[];
  aiConfig: AIProviderConfig;
  onSwitchMode: (mode: DiffViewMode) => void;
}

// Heuristic rule-based natural language generator (Instant zero-delay translation)
function generateHeuristicSummary(file: DiffFile, hunks: DiffHunk[]): {
  overview: string;
  points: { title: string; desc: string; oldSnippet?: string; newSnippet?: string }[];
} {
  const points: { title: string; desc: string; oldSnippet?: string; newSnippet?: string }[] = [];
  const fileName = file.newPath.split('/').pop() || file.newPath;

  hunks.forEach((hunk, index) => {
    const adds = hunk.lines.filter((l) => l.type === 'add').map((l) => l.content);
    const dels = hunk.lines.filter((l) => l.type === 'delete').map((l) => l.content);

    // 1. Check for using / import changes
    const addImports = adds.filter((l) => /^\s*(using|import|from|#include)\s+/.test(l));
    const delImports = dels.filter((l) => /^\s*(using|import|from|#include)\s+/.test(l));
    if (addImports.length > 0 || delImports.length > 0) {
      const addedNames = addImports.map((i) => i.trim().replace(/;$/, '')).join(', ');
      const removedNames = delImports.map((i) => i.trim().replace(/;$/, '')).join(', ');

      let desc = '';
      if (addedNames && removedNames) {
        desc = `调整了模块引用依赖，移除了 \`${removedNames}\` 并引入了 \`${addedNames}\`。`;
      } else if (addedNames) {
        desc = `引入了新的外部依赖或命名空间：\`${addedNames}\`。`;
      } else {
        desc = `清理了不再使用的命名空间引用：\`${removedNames}\`。`;
      }

      points.push({
        title: `依赖引入与命名空间调整`,
        desc,
        oldSnippet: delImports.join('\n'),
        newSnippet: addImports.join('\n'),
      });
    }

    // 2. Check for class / struct / interface declarations
    const classAdd = adds.find((l) => /(class|interface|struct|enum|record)\s+(\w+)/.test(l));
    const classDel = dels.find((l) => /(class|interface|struct|enum|record)\s+(\w+)/.test(l));
    if (classAdd || classDel) {
      const addMatch = classAdd?.match(/(class|interface|struct|enum|record)\s+(\w+)/);
      const delMatch = classDel?.match(/(class|interface|struct|enum|record)\s+(\w+)/);

      let desc = '';
      if (addMatch && delMatch && addMatch[2] === delMatch[2]) {
        desc = `修改了类型 \`${addMatch[2]}\` 的声明定义或继承基类。`;
      } else if (addMatch) {
        desc = `新增了 ${addMatch[1]} 定义：\`${addMatch[2]}\`。`;
      } else if (delMatch) {
        desc = `删除了 ${delMatch[1]} 定义：\`${delMatch[2]}\`。`;
      }

      points.push({
        title: `类型结构与类定义变更`,
        desc,
        oldSnippet: classDel,
        newSnippet: classAdd,
      });
    }

    // 3. Check for method / function definitions
    const methodAdd = adds.find((l) => /(public|private|protected|internal|async|function|def|void|Task)\s+.*\(.*\)/.test(l));
    const methodDel = dels.find((l) => /(public|private|protected|internal|async|function|def|void|Task)\s+.*\(.*\)/.test(l));
    if (methodAdd || methodDel) {
      points.push({
        title: `方法实现与核心逻辑改动 (改动块 #${index + 1})`,
        desc: `在此处重构或调整了核心函数方法逻辑，修改涉及 +${adds.length} 行新增与 -${dels.length} 行移除。`,
        oldSnippet: dels.slice(0, 4).join('\n'),
        newSnippet: adds.slice(0, 4).join('\n'),
      });
    } else if (adds.length > 0 || dels.length > 0) {
      points.push({
        title: `代码语句与内部逻辑更新 (改动块 #${index + 1})`,
        desc: `进行了代码细节调整，移除了 ${dels.length} 行旧代码并新增了 ${adds.length} 行新实现。`,
        oldSnippet: dels.slice(0, 3).join('\n'),
        newSnippet: adds.slice(0, 3).join('\n'),
      });
    }
  });

  const overview = `在文件 \`${fileName}\` 中，共进行了 ${hunks.length} 处修改（新增 ${file.additions} 行，删除 ${file.deletions} 行）。主要涵盖${points.map((p) => p.title).slice(0, 3).join('、')}等变更。`;

  return { overview, points };
}

export const NaturalLanguageDiffView: React.FC<NaturalLanguageDiffViewProps> = ({
  file,
  hunks,
  aiConfig,
  onSwitchMode,
}) => {
  const [aiNarrative, setAiNarrative] = useState<string>('');
  const [isLoadingAi, setIsLoadingAi] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [hasRequested, setHasRequested] = useState<boolean>(false);

  // Instant heuristic summary
  const heuristic = useMemo(() => {
    return generateHeuristicSummary(file, hunks);
  }, [file, hunks]);

  // Request AI Natural Language Narrative Translation (ONLY ON USER CLICK)
  const requestAiNarrative = () => {
    if (isLoadingAi) return;
    setIsLoadingAi(true);
    setHasRequested(true);
    setAiNarrative('');

    const prompt = aiConfig.naturalLanguagePrompt?.trim() || DEFAULT_PROMPTS.naturalLanguagePrompt;

    streamExplainDiff({
      scopeType: 'file',
      filePath: file.newPath,
      diff: file.diff,
      userPrompt: prompt,
      config: aiConfig,
      onChunk: (chunk: string) => {
        setAiNarrative((prev) => prev + chunk);
      },
      onComplete: () => {
        setIsLoadingAi(false);
      },
      onError: (err: Error) => {
        setIsLoadingAi(false);
        setAiNarrative((prev) => prev + `\n\n*(AI 生成异常: ${err.message})*`);
      },
    });
  };

  const handleCopyProse = () => {
    const textToCopy = aiNarrative
      ? aiNarrative
      : `${heuristic.overview}\n\n` +
        heuristic.points.map((p, i) => `${i + 1}. **${p.title}**\n   ${p.desc}`).join('\n');

    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#14151B] text-slate-200 overflow-y-auto p-6 space-y-6">
      {/* Top Banner: File Summary & Action Bar */}
      <div className="bg-[#1B1C25] border border-white/10 rounded-xl p-4 shadow-lg flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-lg bg-gradient-to-br from-purple-500/20 to-indigo-500/20 text-purple-300 border border-purple-500/30">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-sm text-white">
                {file.newPath.split('/').pop()} · 自然语言改动直读
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-slate-400 border border-white/5">
                +{file.additions} / -{file.deletions} 行
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{heuristic.overview}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={requestAiNarrative}
            disabled={isLoadingAi}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold transition shadow-md shadow-purple-600/20 active:scale-95"
            title="点击开始将当前 Diff 转译为通俗自然语言"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isLoadingAi ? 'animate-spin' : ''}`} />
            <span>{isLoadingAi ? 'AI 正在转译...' : hasRequested ? '重新 AI 转译' : '✨ 开始自然语言转译'}</span>
          </button>

          <button
            onClick={handleCopyProse}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#252834] hover:bg-[#2F3240] border border-white/10 text-slate-300 text-xs font-medium transition"
            title="复制为 PR / 提交说明文案"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? '已复制' : '复制说明'}</span>
          </button>

          <button
            onClick={() => onSwitchMode('split')}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition border border-white/5"
            title="切回双栏代码 Diff 对比"
          >
            <Code2 className="w-3.5 h-3.5 text-sky-400" />
            <span>查看代码 Diff</span>
          </button>
        </div>
      </div>

      {/* Hero Card Before User Initiates AI Translation */}
      {!hasRequested && !aiNarrative && (
        <div className="bg-gradient-to-b from-[#1C1E2A] to-[#161722] border border-purple-500/25 rounded-2xl p-8 text-center space-y-4 shadow-xl">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 text-purple-300 flex items-center justify-center mx-auto border border-purple-500/30 shadow-lg shadow-purple-500/10">
            <BookOpen className="w-7 h-7 text-purple-400" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h3 className="font-bold text-sm text-white">
              点击将本次代码修改转译为自然语言
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              将枯燥的代码行差异转换为像技术博客或 PR 描述一样的自然语言故事，清晰解释改动意图与业务逻辑。
            </p>
          </div>
          <div>
            <button
              onClick={requestAiNarrative}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-purple-600/30 transition hover:scale-105 active:scale-95 inline-flex items-center space-x-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>✨ 点击开始自然语言转译</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Section 1: AI Generated Prose Narrative (After Conversion) */}
      {(hasRequested || aiNarrative) && (
        <div className="bg-[#181923] border border-purple-500/30 rounded-xl p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between pb-2 border-b border-white/5 mb-3">
            <div className="flex items-center space-x-2 text-xs font-bold text-purple-300">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span>AI 自然语言深度叙述 (Natural Language Narrative)</span>
            </div>
            {isLoadingAi && (
              <span className="text-[11px] text-purple-400 animate-pulse font-mono">
                正在生成自然语言转译中...
              </span>
            )}
          </div>

          {aiNarrative ? (
            <div
              className="prose prose-invert prose-sm max-w-none text-slate-200 text-xs leading-relaxed font-sans"
              dangerouslySetInnerHTML={{ __html: marked.parse(aiNarrative) as string }}
            />
          ) : (
            <div className="py-8 text-center text-xs text-slate-500 animate-pulse">
              正在调用 AI 深度转译代码改动逻辑，请稍候...
            </div>
          )}
        </div>
      )}

      {/* Main Section 2: Hunk-by-Hunk Natural Language Action Cards */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2 text-xs font-bold text-slate-300">
          <Layers className="w-4 h-4 text-emerald-400" />
          <span>改动块逐项自然语言转译卡片 ({heuristic.points.length} 处)</span>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {heuristic.points.map((point, idx) => (
            <div
              key={`point-${idx}`}
              className="bg-[#191A24] border border-white/5 hover:border-purple-500/30 rounded-xl p-4 transition shadow-sm space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 text-[11px] font-bold flex items-center justify-center font-mono">
                    {idx + 1}
                  </span>
                  <span className="font-bold text-xs text-white">{point.title}</span>
                </div>
                <button
                  onClick={() => onSwitchMode('split')}
                  className="text-[11px] text-purple-400 hover:text-purple-300 flex items-center gap-1 transition"
                >
                  <span>对应代码</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">{point.desc}</p>

              {/* Code Snapshot Previews */}
              {(point.oldSnippet || point.newSnippet) && (
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5 text-[11px] font-mono">
                  {point.oldSnippet && (
                    <div className="bg-rose-950/20 border border-rose-500/20 rounded-lg p-2.5 space-y-1">
                      <span className="text-[10px] text-rose-400 font-bold block uppercase">
                        🔴 改动前 (旧逻辑)
                      </span>
                      <pre className="text-rose-200 overflow-x-auto whitespace-pre-wrap">
                        {point.oldSnippet}
                      </pre>
                    </div>
                  )}
                  {point.newSnippet && (
                    <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-lg p-2.5 space-y-1">
                      <span className="text-[10px] text-emerald-400 font-bold block uppercase">
                        🟢 改动后 (新逻辑)
                      </span>
                      <pre className="text-emerald-200 overflow-x-auto whitespace-pre-wrap">
                        {point.newSnippet}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
