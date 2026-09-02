import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, PanelLeftOpen } from 'lucide-react';
import type { AIProviderConfig, DiffFile } from './types';
import { fetchBatchCommitsDiff, fetchCommitDiff } from './services/api';
import { STORAGE_KEYS, storage } from './constants/storage';
import { useRepository } from './hooks/useRepository';
import { Header } from './components/Header';
import { CommitGraph } from './components/CommitGraph/CommitGraph';
import { FilesPanel } from './components/FilesPanel';
import { DiffViewer } from './components/DiffViewer/DiffViewer';
import { LearnWorkbench } from './components/Learn/LearnWorkbench';
import {
  AIExplanationDrawer,
  type ExplanationScope,
} from './components/AIExplanation/AIExplanationDrawer';
import { SettingsModal } from './components/SettingsModal';
import { OpenRepoModal } from './components/OpenRepoModal';
import { AICallInspectorModal } from './components/AICallInspector/AICallInspectorModal';
import { readPersistedWidth, ResizeGutter } from './components/common/ResizeGutter';
import type { DiffHunk } from './utils/diffParser';

const HISTORY_PANE = { defaultWidth: 380, min: 260, max: 960 };
const FILES_PANE = { defaultWidth: 240, min: 176, max: 560 };
const AI_PANE = { defaultWidth: 520, min: 320, max: 1200 };

const DEFAULT_AI_CONFIG: AIProviderConfig = {
  provider: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  contextWindowTokens: 1_000_000,
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
    repositoryRevision,
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
  const [workspaceMode, setWorkspaceMode] = useState<'diff' | 'learn'>('diff');
  const [learnAskFile, setLearnAskFile] = useState<string | null>(null);

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
  const [isFilesPanelCollapsed, setIsFilesPanelCollapsed] = useState(
    () => storage.get(STORAGE_KEYS.filesPanelCollapsed) === 'true'
  );
  const [historyWidth, setHistoryWidth] = useState(() =>
    readPersistedWidth(
      storage.get(STORAGE_KEYS.historyWidth),
      HISTORY_PANE.defaultWidth,
      HISTORY_PANE.min,
      HISTORY_PANE.max
    )
  );
  const [filesWidth, setFilesWidth] = useState(() =>
    readPersistedWidth(
      storage.get(STORAGE_KEYS.filesWidth),
      FILES_PANE.defaultWidth,
      FILES_PANE.min,
      FILES_PANE.max
    )
  );
  const [aiPaneWidth, setAiPaneWidth] = useState(() =>
    readPersistedWidth(
      storage.get(STORAGE_KEYS.aiPaneWidth),
      AI_PANE.defaultWidth,
      AI_PANE.min,
      AI_PANE.max
    )
  );
  const historyPaneRef = useRef<HTMLDivElement>(null);
  const filesPaneRef = useRef<HTMLDivElement>(null);
  const aiPaneRef = useRef<HTMLDivElement>(null);

  const [aiConfig, setAiConfig] = useState<AIProviderConfig>(() =>
    storage.getJson<AIProviderConfig>(STORAGE_KEYS.aiConfig, DEFAULT_AI_CONFIG)
  );

  useEffect(() => {
    storage.set(STORAGE_KEYS.explanationOpen, String(isExplanationOpen));
  }, [isExplanationOpen]);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      storage.set(STORAGE_KEYS.sidebarCollapsed, String(!prev));
      return !prev;
    });
  }, []);

  const handleToggleFilesPanel = useCallback(() => {
    setIsFilesPanelCollapsed((prev) => {
      storage.set(STORAGE_KEYS.filesPanelCollapsed, String(!prev));
      return !prev;
    });
  }, []);

  const commitHistoryWidth = useCallback((width: number) => {
    setHistoryWidth(width);
    storage.set(STORAGE_KEYS.historyWidth, String(width));
  }, []);

  const commitFilesWidth = useCallback((width: number) => {
    setFilesWidth(width);
    storage.set(STORAGE_KEYS.filesWidth, String(width));
  }, []);

  const commitAiPaneWidth = useCallback((width: number) => {
    setAiPaneWidth(width);
    storage.set(STORAGE_KEYS.aiPaneWidth, String(width));
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

  return (
    <div className="flex flex-col h-screen w-screen bg-[var(--surface-panel)] text-slate-100 overflow-hidden font-sans">
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
        isFilesPanelCollapsed={isFilesPanelCollapsed}
        onToggleFilesPanel={handleToggleFilesPanel}
        isExplanationOpen={isExplanationOpen}
        onToggleExplanation={() => setIsExplanationOpen((v) => !v)}
        workspaceMode={workspaceMode}
        onWorkspaceMode={(mode) => {
          setWorkspaceMode(mode);
          if (mode === 'learn') {
            setIsSidebarCollapsed(true);
            storage.set(STORAGE_KEYS.sidebarCollapsed, 'true');
          }
        }}
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

      {/* Workspace: history · files · diff · AI dock. Side panes are pixel-sized
          and draggable so a maximized window actually gives the extra width to
          the diff (and to the review, instead of overlaying it). */}
      <div className="flex-1 flex overflow-hidden min-w-0">
        {!isSidebarCollapsed && (
          <div
            ref={historyPaneRef}
            className="h-full flex flex-col shrink-0 min-w-0 overflow-hidden"
            style={{ width: historyWidth }}
          >
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

        {!isSidebarCollapsed && (
          <ResizeGutter
            panelRef={historyPaneRef}
            min={HISTORY_PANE.min}
            max={HISTORY_PANE.max}
            value={historyWidth}
            onChange={setHistoryWidth}
            onCommit={commitHistoryWidth}
            onReset={() => commitHistoryWidth(HISTORY_PANE.defaultWidth)}
            title="拖动调整提交历史栏宽度 · 双击恢复默认"
          />
        )}

        {isSidebarCollapsed && (
          <div
            onClick={handleToggleSidebar}
            className="w-10 bg-[var(--surface-canvas)] hover:bg-[var(--surface-raised)] border-r border-white/10 flex flex-col items-center py-4 cursor-pointer transition select-none group shrink-0"
            title="点击展开 Git 提交历史图谱面板"
          >
            <button className="p-1.5 rounded-lg bg-white/5 group-hover:bg-blue-500/20 group-hover:text-blue-300 transition mb-4">
              <PanelLeftOpen className="w-4 h-4" />
            </button>
            <div className="flex-1 flex items-center justify-center">
              <span
                className="text-[11px] font-medium text-slate-400 group-hover:text-blue-300 transition select-none"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                提交历史 ({commits.length})
              </span>
            </div>
          </div>
        )}

        {!isFilesPanelCollapsed && (
          <div
            ref={filesPaneRef}
            className="h-full flex flex-col shrink-0 min-w-0 overflow-hidden"
            style={{ width: filesWidth }}
          >
            <FilesPanel
              diffResult={diffResult}
              selectedFilePath={selectedFilePath}
              onSelectFile={setSelectedFilePath}
              onExplainAll={handleExplainAll}
              onExplainFile={handleExplainFile}
              onAskFile={
                workspaceMode === 'learn'
                  ? (file) => setLearnAskFile(file.newPath || file.oldPath)
                  : undefined
              }
              isLoading={isLoadingDiff}
              onCollapse={handleToggleFilesPanel}
            />
          </div>
        )}

        {!isFilesPanelCollapsed && (
          <ResizeGutter
            panelRef={filesPaneRef}
            min={FILES_PANE.min}
            max={FILES_PANE.max}
            value={filesWidth}
            onChange={setFilesWidth}
            onCommit={commitFilesWidth}
            onReset={() => commitFilesWidth(FILES_PANE.defaultWidth)}
            title="拖动调整变更文件栏宽度 · 双击恢复默认"
          />
        )}

        {isFilesPanelCollapsed && (
          <div
            onClick={handleToggleFilesPanel}
            className="w-10 bg-[var(--surface-canvas)] hover:bg-[var(--surface-raised)] border-r border-white/10 flex flex-col items-center py-4 cursor-pointer transition select-none group shrink-0"
            title="点击展开变更文件列表"
          >
            <button
              type="button"
              className="p-1.5 rounded-lg bg-white/5 group-hover:bg-sky-500/20 group-hover:text-sky-300 transition mb-4"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
            <div className="flex-1 flex items-center justify-center">
              <span
                className="text-[11px] font-medium text-slate-400 group-hover:text-sky-300 transition select-none"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                变更文件 ({diffResult?.files.length ?? 0})
              </span>
            </div>
          </div>
        )}

        <div className="flex-1 h-full flex flex-col min-w-0">
          {workspaceMode === 'learn' ? (
            <LearnWorkbench
              repoPath={repoInfo?.path || repoPath}
              repoName={repoInfo?.name}
              headHash={repoInfo?.headHash}
              repositoryRevision={repositoryRevision}
              aiConfig={aiConfig}
              askAboutFile={learnAskFile}
              onAskAboutFileConsumed={() => setLearnAskFile(null)}
            />
          ) : (
            <DiffViewer
              file={selectedFile}
              viewMode={viewMode}
              onToggleViewMode={setViewMode}
              onExplainHunk={handleExplainHunk}
              onExplainMultipleHunks={handleExplainMultipleHunks}
              onExplainFile={handleExplainFile}
              aiConfig={aiConfig}
            />
          )}
        </div>

        {isExplanationOpen && workspaceMode !== 'learn' && (
          <ResizeGutter
            panelRef={aiPaneRef}
            min={AI_PANE.min}
            max={AI_PANE.max}
            invert
            value={aiPaneWidth}
            onChange={setAiPaneWidth}
            onCommit={commitAiPaneWidth}
            onReset={() => commitAiPaneWidth(AI_PANE.defaultWidth)}
            title="拖动调整审查栏宽度 · 双击恢复默认"
          />
        )}

        <div
          ref={aiPaneRef}
          className="h-full min-h-0 shrink-0 overflow-hidden"
          style={{ width: isExplanationOpen && workspaceMode !== 'learn' ? aiPaneWidth : 0 }}
        >
          <AIExplanationDrawer
            isOpen={isExplanationOpen}
            onClose={() => setIsExplanationOpen(false)}
            scope={explanationScope}
            repoPath={repoInfo?.path || repoPath}
            aiConfig={aiConfig}
          />
        </div>
      </div>

      <OpenRepoModal
        isOpen={isOpenRepoModal}
        onClose={() => setIsOpenRepoModal(false)}
        currentPath={repoInfo?.path || repoPath}
        onSelectRepo={setRepoPath}
        recentRepos={recentRepos}
        onRemoveRecentRepo={removeRecentRepo}
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
