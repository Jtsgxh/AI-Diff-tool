import React, { useState, useEffect, useCallback } from 'react';
import {
  RepoInfo,
  CommitNode,
  DiffResult,
  DiffFile,
  DiffViewMode,
  SelectionState,
  AIProviderConfig,
} from './types';
import {
  fetchRepoInfo,
  fetchCommits,
  fetchCommitDiff,
  fetchCompareDiff,
  fetchWorkingTreeDiff,
} from './services/api';
import { Header } from './components/Header';
import { CommitGraph } from './components/CommitGraph/CommitGraph';
import { FilesPanel } from './components/FilesPanel';
import { DiffViewer } from './components/DiffViewer/DiffViewer';
import {
  AIExplanationDrawer,
  ExplanationScope,
} from './components/AIExplanation/AIExplanationDrawer';
import { SettingsModal } from './components/SettingsModal';

const DEFAULT_AI_CONFIG: AIProviderConfig = {
  provider: 'demo',
  apiKey: '',
  baseUrl: '',
  model: 'Built-in Demo Engine',
};

export const App: React.FC = () => {
  // State
  const [repoPath, setRepoPath] = useState<string>('demo');
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [selection, setSelection] = useState<SelectionState>({
    type: 'commit',
    commitHash: '',
  });

  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DiffViewMode>('split');

  const [isLoadingRepo, setIsLoadingRepo] = useState<boolean>(false);
  const [isLoadingDiff, setIsLoadingDiff] = useState<boolean>(false);

  // AI Drawer State
  const [isExplanationOpen, setIsExplanationOpen] = useState(false);
  const [explanationScope, setExplanationScope] = useState<ExplanationScope | null>(null);

  // Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [aiConfig, setAiConfig] = useState<AIProviderConfig>(() => {
    const saved = localStorage.getItem('git_ai_config');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return DEFAULT_AI_CONFIG;
  });

  const handleSaveConfig = (newConfig: AIProviderConfig) => {
    setAiConfig(newConfig);
    localStorage.setItem('git_ai_config', JSON.stringify(newConfig));
  };

  // Load Repository & Commits
  const loadRepo = useCallback(async (path: string) => {
    setIsLoadingRepo(true);
    try {
      const [info, commitData] = await Promise.all([
        fetchRepoInfo(path),
        fetchCommits(path),
      ]);
      setRepoInfo(info);
      setCommits(commitData.commits);

      // Default select the first commit
      if (commitData.commits.length > 0) {
        const firstHash = commitData.commits[0].hash;
        setSelection({ type: 'commit', commitHash: firstHash });
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoadingRepo(false);
    }
  }, []);

  useEffect(() => {
    loadRepo(repoPath);
  }, [repoPath, loadRepo]);

  // Load Diff based on selection state
  useEffect(() => {
    const loadDiff = async () => {
      setIsLoadingDiff(true);
      try {
        let res: DiffResult | null = null;
        if (selection.type === 'commit' && selection.commitHash) {
          res = await fetchCommitDiff(repoPath, selection.commitHash);
        } else if (selection.type === 'compare' && selection.baseHash && selection.targetHash) {
          res = await fetchCompareDiff(repoPath, selection.baseHash, selection.targetHash);
        } else if (selection.type === 'working-tree') {
          res = await fetchWorkingTreeDiff(repoPath);
        }

        setDiffResult(res);
        if (res && res.files.length > 0) {
          setSelectedFilePath(res.files[0].newPath);
        } else {
          setSelectedFilePath(null);
        }
      } catch (err: any) {
        console.error(err);
      } finally {
        setIsLoadingDiff(false);
      }
    };

    if (selection.commitHash || (selection.baseHash && selection.targetHash) || selection.type === 'working-tree') {
      loadDiff();
    }
  }, [selection, repoPath]);

  // Handler: Select single commit
  const handleSelectCommit = (hash: string) => {
    setSelection({ type: 'commit', commitHash: hash });
  };

  // Handler: Compare two commits
  const handleCompareCommits = (baseHash: string, targetHash: string) => {
    setSelection({ type: 'compare', baseHash, targetHash });
  };

  // Handler: Select working tree
  const handleSelectWorkingTree = () => {
    setSelection({ type: 'working-tree' });
  };

  // Handlers: AI Explanations
  const handleExplainAll = () => {
    if (!diffResult) return;
    const allDiff = diffResult.files.map((f) => f.diff).join('\n\n');
    setExplanationScope({
      type: selection.type === 'compare' ? 'compare' : 'commit',
      title: diffResult.title || '本次全量变更 (Full Diff)',
      diff: allDiff,
      commitMessage: diffResult.title,
    });
    setIsExplanationOpen(true);
  };

  const handleExplainFile = (file: DiffFile) => {
    setExplanationScope({
      type: 'file',
      title: `文件差异: ${file.newPath}`,
      filePath: file.newPath,
      diff: file.diff,
      commitMessage: diffResult?.title,
    });
    setIsExplanationOpen(true);
  };

  const handleExplainHunk = (hunkHeader: string, hunkDiff: string) => {
    setExplanationScope({
      type: 'hunk',
      title: `代码块: ${hunkHeader}`,
      filePath: selectedFilePath || undefined,
      diff: hunkDiff,
      commitMessage: diffResult?.title,
    });
    setIsExplanationOpen(true);
  };

  const handleExplainCommit = (hash: string, message: string) => {
    fetchCommitDiff(repoPath, hash).then((res) => {
      const allDiff = res.files.map((f) => f.diff).join('\n\n');
      setExplanationScope({
        type: 'commit',
        title: `提交 [${hash.slice(0, 7)}]: ${message}`,
        diff: allDiff,
        commitMessage: message,
      });
      setIsExplanationOpen(true);
    });
  };

  const selectedFile = diffResult?.files.find(
    (f) => f.newPath === selectedFilePath || f.oldPath === selectedFilePath
  ) || null;

  return (
    <div className="flex flex-col h-screen w-screen bg-[#181920] text-slate-100 overflow-hidden select-none font-sans">
      {/* Top Header */}
      <Header
        repoInfo={repoInfo}
        repoPath={repoPath}
        onRepoChange={setRepoPath}
        selection={selection}
        onSelectWorkingTree={handleSelectWorkingTree}
        onRefresh={() => loadRepo(repoPath)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isLoading={isLoadingRepo || isLoadingDiff}
      />

      {/* Main 3-Column Workspace Layout (Fork-Style) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Commit Graph DAG (38% width) */}
        <div className="w-[38%] min-w-[340px] max-w-[580px] h-full flex flex-col">
          <CommitGraph
            commits={commits}
            selection={selection}
            onSelectCommit={handleSelectCommit}
            onCompareCommits={handleCompareCommits}
            onExplainCommit={handleExplainCommit}
          />
        </div>

        {/* Middle Column: Files Panel (22% width) */}
        <div className="w-[22%] min-w-[220px] max-w-[340px] h-full flex flex-col">
          <FilesPanel
            diffResult={diffResult}
            selectedFilePath={selectedFilePath}
            onSelectFile={setSelectedFilePath}
            onExplainAll={handleExplainAll}
            onExplainFile={handleExplainFile}
            isLoading={isLoadingDiff}
          />
        </div>

        {/* Right Column: Code Diff Viewer (Remaining 40%+) */}
        <div className="flex-1 h-full flex flex-col min-w-0">
          <DiffViewer
            file={selectedFile}
            viewMode={viewMode}
            onToggleViewMode={setViewMode}
            onExplainHunk={handleExplainHunk}
            onExplainFile={handleExplainFile}
          />
        </div>
      </div>

      {/* AI Explanation Slide-over Panel */}
      <AIExplanationDrawer
        isOpen={isExplanationOpen}
        onClose={() => setIsExplanationOpen(false)}
        scope={explanationScope}
        aiConfig={aiConfig}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={aiConfig}
        onSaveConfig={handleSaveConfig}
      />
    </div>
  );
};

export default App;
