import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, PanelLeftOpen, Terminal } from 'lucide-react';
import type { AIProviderConfig, DiffFile } from './types';
import { fetchBatchCommitsDiff, fetchCommitDiff } from './services/api';
import { aiLogger, type AILoggerSummary } from './services/aiLogger';
import { STORAGE_KEYS, storage } from './constants/storage';
import { useRepository } from './hooks/useRepository';
import { Header } from './components/Header';
import { CommitGraph } from './components/CommitGraph/CommitGraph';
import { FilesPanel } from './components/FilesPanel';
import { DiffViewer } from './components/DiffViewer/DiffViewer';
import {
  AIExplanationDrawer,
  type ExplanationScope,
} from './components/AIExplanation/AIExplanationDrawer';
import { SettingsModal } from './components/SettingsModal';
import { OpenRepoModal } from './components/OpenRepoModal';
import { AICallInspectorModal } from './components/AICallInspector/AICallInspectorModal';
import type { DiffHunk } from './utils/diffParser';

const DEFAULT_AI_CONFIG: AIProviderConfig = {
  provider: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
};

/** Normalizes Windows separators before comparing repository-relative paths. */
const normalizePath = (p?: string | null) => (p || '').replace(/\\/g, '/');

export const App: React.FC = () => {
  const {
    repoPath,
    setRepoPath,
    recentRepos,
    removeRecentRepo,
    repoInfo,
    commits,
    selection,
    setSelection,
    diffResult,
    isLoadingRepo,
    isLoadingDiff,
    repoError,
    refresh,
  } = useRepository();

  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'split' | 'unified' | 'natural'>('split');

  const [isOpenRepoModal, setIsOpenRepoModal] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAIInspectorOpen, setIsAIInspectorOpen] = useState(false);
  const [explanationScope, setExplanationScope] = useState<ExplanationScope | null>(null);
  const [isExplanationOpen, setIsExplanationOpen] = useState(
    () => storage.get(STORAGE_KEYS.explanationOpen) === 'true'
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => storage.get(STORAGE_KEYS.sidebarCollapsed) === 'true'
  );

  const [aiConfig, setAiConfig] = useState<AIProviderConfig>(() =>
    storage.getJson<AIProviderConfig>(STORAGE_KEYS.aiConfig, DEFAULT_AI_CONFIG)
  );

  /**
   * Only the counts are needed here. Subscribing to the full session list would
   * re-render the entire workspace on every streamed token.
   */
  const [aiSummary, setAiSummary] = useState<AILoggerSummary>(() => aiLogger.getSummary());
  useEffect(() => aiLogger.subscribeSummary(setAiSummary), []);

  useEffect(() => {
    storage.set(STORAGE_KEYS.explanationOpen, String(isExplanationOpen));
  }, [isExplanationOpen]);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      storage.set(STORAGE_KEYS.sidebarCollapsed, String(!prev));
      return !prev;
    });
  }, []);

  const handleSaveConfig = useCallback((newConfig: AIProviderConfig) => {
    setAiConfig(newConfig);
    storage.setJson(STORAGE_KEYS.aiConfig, newConfig);
  }, []);

  // Auto-select the first changed file whenever a new diff arrives.
  useEffect(() => {
    setSelectedFilePath(diffResult?.files.length ? diffResult.files[0].newPath : null);
  }, [diffResult]);

  // ---------------------------- selection handlers ----------------------------

  const handleSelectCommit = useCallback(
    (hash: string) => setSelection({ type: 'commit', commitHash: hash }),
    [setSelection]
  );

  const handleCompareCommits = useCallback(
    (baseHash: string, targetHash: string) =>
      setSelection({ type: 'compare', baseHash, targetHash }),
    [setSelection]
  );

  const handleSelectWorkingTree = useCallback(
    () => setSelection({ type: 'working-tree' }),
    [setSelection]
  );

  const handleSelectBatchCommits = useCallback(
    (hashes: string[]) =>
      setSelection({
        type: 'batch',
        commitHashes: hashes,
        batchTitle: `批量合并 [${hashes.length} 个提交]`,
      }),
    [setSelection]
  );

  // ---------------------------- explanation handlers ----------------------------

  const openExplanation = useCallback((scope: ExplanationScope) => {
    setExplanationScope(scope);
    setIsExplanationOpen(true);
  }, []);

  const handleExplainBatchCommits = useCallback(
    (hashes: string[]) => {
      fetchBatchCommitsDiff(repoPath, hashes)
        .then((res) => {
          const allDiff = res.files.map((f) => f.diff).join('\n\n');
          const history = res.batchInfo?.messages?.join('\n') || '';
          openExplanation({
            type: 'chunks',
            title: res.title || `批量合并审查 (${hashes.length} 个提交)`,
            diff: `【整批提交演进历史】\n${history}\n\n【合并最终生效的净代码变动 (Consolidated Net Diff)】\n${allDiff}`,
            commitMessage: res.title,
            commitHashes: hashes,
            batchInfo: res.batchInfo,
            initialMode: 'agent',
          });
        })
        .catch(console.error);
    },
    [openExplanation, repoPath]
  );

  const handleExplainAll = useCallback(() => {
    if (!diffResult) return;
    openExplanation({
      type: selection.type === 'compare' ? 'compare' : 'commit',
      title: diffResult.title || '本次全量变更 (Full Diff)',
      diff: diffResult.files.map((f) => f.diff).join('\n\n'),
      commitMessage: diffResult.title,
    });
  }, [diffResult, openExplanation, selection.type]);

  const handleExplainFile = useCallback(
    (file: DiffFile, mode: 'agent' | 'fast' = 'agent') => {
      openExplanation({
        type: 'file',
        title: `文件差异: ${file.newPath}`,
        filePath: file.newPath,
        diff: file.diff,
        commitMessage: diffResult?.title,
        initialMode: mode,
      });
    },
    [diffResult?.title, openExplanation]
  );

  const handleExplainHunk = useCallback(
    (hunkHeader: string, hunkDiff: string, hunkIndex?: number, mode: 'agent' | 'fast' = 'agent') => {
      openExplanation({
        type: 'hunk',
        title: `改动块${hunkIndex ? ` #${hunkIndex}` : ''}: ${hunkHeader}`,
        filePath: selectedFilePath || undefined,
        diff: hunkDiff,
        commitMessage: diffResult?.title,
        initialMode: mode,
      });
    },
    [diffResult?.title, openExplanation, selectedFilePath]
  );

  const handleExplainMultipleHunks = useCallback(
    (selectedHunks: DiffHunk[], file: DiffFile, mode: 'agent' | 'fast' = 'agent') => {
      const hunkIndices = selectedHunks.map((h) => `#${h.index}`).join(', ');
      const combinedDiff = selectedHunks
        .map(
          (h) =>
            `// ==========================================\n// 改动块 #${h.index} (${h.header}) (+${h.additions} -${h.deletions})\n// ==========================================\n${h.text}`
        )
        .join('\n\n');

      openExplanation({
        type: 'chunks',
        title: `联合解释选中的 ${selectedHunks.length} 个改动块 (${file.newPath}: 块 ${hunkIndices})`,
        filePath: file.newPath,
        diff: combinedDiff,
        commitMessage: diffResult?.title,
        initialMode: mode,
      });
    },
    [diffResult?.title, openExplanation]
  );

  const handleExplainCommit = useCallback(
    (hash: string, message: string) => {
      fetchCommitDiff(repoPath, hash)
        .then((res) => {
          openExplanation({
            type: 'commit',
            title: `提交 [${hash.slice(0, 7)}]: ${message}`,
            diff: res.files.map((f) => f.diff).join('\n\n'),
            commitMessage: message,
          });
        })
        .catch(console.error);
    },
    [openExplanation, repoPath]
  );

  const selectedFile = useMemo(() => {
    if (!diffResult || !selectedFilePath) return null;
    const target = normalizePath(selectedFilePath);
    return (
      diffResult.files.find(
        (f) => normalizePath(f.newPath) === target || normalizePath(f.oldPath) === target
      ) || null
    );
  }, [diffResult, selectedFilePath]);

  const isAIRunning = aiSummary.running > 0;

  return (
    <div className="flex flex-col h-screen w-screen bg-[#181920] text-slate-100 overflow-hidden font-sans">
      <Header
        repoInfo={repoInfo}
        repoPath={repoPath}
        onRepoChange={setRepoPath}
        onOpenRepoModal={() => setIsOpenRepoModal(true)}
        selection={selection}
        onSelectWorkingTree={handleSelectWorkingTree}
        onRefresh={refresh}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenAIInspector={() => setIsAIInspectorOpen(true)}
        isLoading={isLoadingRepo || isLoadingDiff}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={handleToggleSidebar}
        isExplanationOpen={isExplanationOpen}
        onToggleExplanation={() => setIsExplanationOpen((v) => !v)}
      />

      {repoError && (
        <div className="bg-rose-500/15 border-b border-rose-500/30 px-4 py-2 text-xs text-rose-300 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{repoError}</span>
          </div>
          <button
            onClick={() => setIsOpenRepoModal(true)}
            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[11px] font-semibold transition"
          >
            切换到有效仓库
          </button>
        </div>
      )}

      {/* Three-column workspace: DAG · files · diff */}
      <div className="flex-1 flex overflow-hidden">
        {!isSidebarCollapsed && (
          <div className="w-[42%] min-w-[360px] max-w-[700px] h-full flex flex-col transition-all duration-200">
            <CommitGraph
              commits={commits}
              selection={selection}
              onSelectCommit={handleSelectCommit}
              onCompareCommits={handleCompareCommits}
              onExplainCommit={handleExplainCommit}
              onSelectBatchCommits={handleSelectBatchCommits}
              onExplainBatchCommits={handleExplainBatchCommits}
              onCollapse={handleToggleSidebar}
            />
          </div>
        )}

        {isSidebarCollapsed && (
          <div
            onClick={handleToggleSidebar}
            className="w-10 bg-[#121319] hover:bg-[#1A1C24] border-r border-white/10 flex flex-col items-center py-4 cursor-pointer transition select-none group shrink-0"
            title="点击展开 Git 提交历史图谱面板"
          >
            <button className="p-1.5 rounded-lg bg-white/5 group-hover:bg-purple-500/20 group-hover:text-purple-300 transition mb-4">
              <PanelLeftOpen className="w-4 h-4" />
            </button>
            <div className="flex-1 flex items-center justify-center">
              <span
                className="text-[11px] font-semibold tracking-wider text-slate-400 group-hover:text-purple-300 uppercase transition select-none"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                📑 提交历史 ({commits.length})
              </span>
            </div>
          </div>
        )}

        <div
          className={`${
            isSidebarCollapsed
              ? 'w-[24%] min-w-[240px] max-w-[380px]'
              : 'w-[20%] min-w-[200px] max-w-[320px]'
          } h-full flex flex-col transition-all duration-200`}
        >
          <FilesPanel
            diffResult={diffResult}
            selectedFilePath={selectedFilePath}
            onSelectFile={setSelectedFilePath}
            onExplainAll={handleExplainAll}
            onExplainFile={handleExplainFile}
            isLoading={isLoadingDiff}
          />
        </div>

        <div className="flex-1 h-full flex flex-col min-w-0">
          <DiffViewer
            file={selectedFile}
            viewMode={viewMode}
            onToggleViewMode={setViewMode}
            onExplainHunk={handleExplainHunk}
            onExplainMultipleHunks={handleExplainMultipleHunks}
            onExplainFile={handleExplainFile}
            aiConfig={aiConfig}
          />
        </div>
      </div>

      {/* Floating AI console trigger */}
      <button
        onClick={() => setIsAIInspectorOpen(true)}
        className={`fixed bottom-4 right-4 z-40 flex items-center space-x-2 px-3 py-2 rounded-full border shadow-xl transition transform active:scale-95 ${
          isAIRunning
            ? 'bg-emerald-600/90 hover:bg-emerald-600 text-white border-emerald-400 shadow-emerald-500/30 animate-pulse'
            : 'bg-[#181924]/90 hover:bg-[#202230] text-slate-300 hover:text-white border-purple-500/30 hover:border-purple-500/60 shadow-purple-500/10'
        }`}
        title="打开 AI 实时调用控制台"
      >
        <Terminal className={`w-4 h-4 ${isAIRunning ? 'text-white' : 'text-purple-400'}`} />
        <span className="text-xs font-semibold">
          {isAIRunning ? 'AI 流式输出中...' : 'AI 控制台'}
        </span>
        {aiSummary.total > 0 && !isAIRunning && (
          <span className="bg-purple-500/30 text-purple-200 text-[10px] px-1.5 py-0.2 rounded-full font-mono">
            {aiSummary.total}
          </span>
        )}
      </button>

      <OpenRepoModal
        isOpen={isOpenRepoModal}
        onClose={() => setIsOpenRepoModal(false)}
        currentPath={repoInfo?.path || repoPath}
        onSelectRepo={setRepoPath}
        recentRepos={recentRepos}
        onRemoveRecentRepo={removeRecentRepo}
      />

      <AIExplanationDrawer
        isOpen={isExplanationOpen}
        onClose={() => setIsExplanationOpen(false)}
        scope={explanationScope}
        repoPath={repoInfo?.path || repoPath}
        aiConfig={aiConfig}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={aiConfig}
        onSaveConfig={handleSaveConfig}
      />

      <AICallInspectorModal
        isOpen={isAIInspectorOpen}
        onClose={() => setIsAIInspectorOpen(false)}
      />
    </div>
  );
};

export default App;
