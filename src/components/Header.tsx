import React, { useState, useEffect } from 'react';
import {
  GitBranch,
  FolderGit2,
  Settings,
  RefreshCw,
  Layers,
  CheckCircle2,
  ChevronDown,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  Terminal,
  FileDiff,
  BookOpen,
} from 'lucide-react';
import { RepoInfo, SelectionState } from '../types';
import { aiLogger } from '../services/aiLogger';

interface HeaderProps {
  repoInfo: RepoInfo | null;
  repoPath: string;
  onRepoChange: (path: string) => void;
  onOpenRepoModal: () => void;
  selection: SelectionState;
  onSelectWorkingTree: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOpenAIInspector: () => void;
  isLoading: boolean;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  isFilesPanelCollapsed?: boolean;
  onToggleFilesPanel?: () => void;
  isExplanationOpen?: boolean;
  onToggleExplanation?: () => void;
  workspaceMode?: 'diff' | 'learn';
  onWorkspaceMode?: (mode: 'diff' | 'learn') => void;
}

/**
 * Top chrome. Memoized so a streaming review, which re-renders App's tree,
 * does not repaint the header on every flush.
 */
export const Header = React.memo<HeaderProps>(({
  repoInfo,
  repoPath,
  onOpenRepoModal,
  selection,
  onSelectWorkingTree,
  onRefresh,
  onOpenSettings,
  onOpenAIInspector,
  isLoading,
  isSidebarCollapsed,
  onToggleSidebar,
  isFilesPanelCollapsed,
  onToggleFilesPanel,
  isExplanationOpen,
  onToggleExplanation,
  workspaceMode = 'diff',
  onWorkspaceMode,
}) => {
  const [sessions, setSessions] = useState(() => aiLogger.getSessions());

  useEffect(() => {
    return aiLogger.subscribe((updated) => {
      setSessions(updated);
    });
  }, []);

  const isAIRunning = sessions.some((s) => s.status === 'running');
  return (
    <header className="h-14 bg-[#14151B] border-b border-white/10 px-4 flex items-center justify-between select-none z-20">
      {/* Left: Brand Logo & Repo Selector */}
      <div className="flex items-center space-x-3 min-w-0">
        <div className="flex items-center space-x-2 mr-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <GitBranch className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center space-x-1.5">
              <span className="font-bold text-sm text-slate-100 tracking-wide">GitSemantic</span>
              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-0.5">
                <Sparkles className="w-2.5 h-2.5" /> AI Diff
              </span>
            </div>
          </div>
        </div>

        {/* Prominent Open Local Repo Button & Active Path */}
        <div className="flex items-center space-x-2">
          <button
            onClick={onOpenRepoModal}
            className="flex items-center space-x-2 bg-[#1E2029] hover:bg-[#252834] border border-white/10 hover:border-purple-500/40 rounded-lg px-3 py-1.5 text-xs text-slate-200 hover:text-white transition group shadow-sm"
            title="打开本地 Git 仓库 / 切换仓库"
          >
            <FolderGit2 className="w-4 h-4 text-purple-400 group-hover:scale-105 transition" />
            <div className="flex items-center space-x-1.5 max-w-xs md:max-w-md truncate">
              <span className="font-bold text-white truncate">
                {repoInfo?.name || repoPath}
              </span>
              {repoInfo?.path && (
                <span className="text-[10px] text-slate-500 truncate hidden xl:inline">
                  ({repoInfo.path})
                </span>
              )}
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 shrink-0" />
          </button>

          {/* Collapsible Toggle for Left Git Commit Graph */}
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition shadow-sm ${
                isSidebarCollapsed
                  ? 'bg-purple-600/20 border-purple-500/50 text-purple-300 hover:bg-purple-600/30'
                  : 'bg-[#1E2029] hover:bg-[#252834] border-white/10 text-slate-300 hover:text-white'
              }`}
              title={
                isSidebarCollapsed
                  ? '展开左侧 Git 提交历史图谱'
                  : '收起左侧 Git 提交历史 (释放更多代码对比空间)'
              }
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4 text-purple-400" />
              ) : (
                <PanelLeftClose className="w-4 h-4 text-slate-400" />
              )}
              <span className="hidden sm:inline font-medium text-[11px]">
                {isSidebarCollapsed ? '展开历史' : '收起历史'}
              </span>
            </button>
          )}

          {onToggleFilesPanel && (
            <button
              onClick={onToggleFilesPanel}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition shadow-sm ${
                isFilesPanelCollapsed
                  ? 'bg-sky-600/20 border-sky-500/50 text-sky-300 hover:bg-sky-600/30'
                  : 'bg-[#1E2029] hover:bg-[#252834] border-white/10 text-slate-300 hover:text-white'
              }`}
              title={
                isFilesPanelCollapsed
                  ? '展开变更文件列表'
                  : '收起变更文件列表 (释放更多代码对比空间)'
              }
            >
              {isFilesPanelCollapsed ? (
                <PanelLeftOpen className="w-4 h-4 text-sky-400" />
              ) : (
                <FileDiff className="w-4 h-4 text-slate-400" />
              )}
              <span className="hidden sm:inline font-medium text-[11px]">
                {isFilesPanelCollapsed ? '展开文件' : '收起文件'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Center: Branch Status & Working Tree quick button */}
      <div className="flex items-center space-x-2">
        {repoInfo && (
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1.5 bg-[#1E2029] border border-white/5 px-2.5 py-1 rounded-md text-xs text-slate-300">
              <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold text-slate-200">{repoInfo.currentBranch || 'HEAD'}</span>
              {repoInfo.ahead > 0 && (
                <span className="text-[10px] text-sky-400 bg-sky-500/10 px-1 rounded">↑{repoInfo.ahead}</span>
              )}
              {repoInfo.behind > 0 && (
                <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1 rounded">↓{repoInfo.behind}</span>
              )}
            </div>

            {/* Uncommitted / Working Tree button */}
            <button
              onClick={onSelectWorkingTree}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs transition font-medium ${
                selection.type === 'working-tree'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm shadow-amber-500/10'
                  : 'bg-[#1E2029] text-slate-400 hover:text-slate-200 border border-white/5 hover:border-white/10'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>未提交变更</span>
              {repoInfo.modifiedFilesCount > 0 ? (
                <span className="bg-amber-500/30 text-amber-300 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                  {repoInfo.modifiedFilesCount}
                </span>
              ) : (
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              )}
            </button>

            {/* Batch Selection Active Pill */}
            {selection.type === 'batch' && (
              <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm">
                <Layers className="w-3.5 h-3.5 text-purple-400" />
                <span>批量合并 ({selection.commitHashes?.length || 0} 个提交)</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Actions, AI Console & Settings */}
      <div className="flex items-center space-x-2">
        {/* AI Explanation Workspace Drawer Button */}
        {onWorkspaceMode && (
          <button
            onClick={() => onWorkspaceMode(workspaceMode === 'learn' ? 'diff' : 'learn')}
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs transition font-medium border shadow-sm ${
              workspaceMode === 'learn'
                ? 'bg-amber-600/30 text-white border-amber-500/50 shadow-amber-500/20'
                : 'bg-[#1E2029] hover:bg-[#252834] text-slate-300 hover:text-white border-white/10 hover:border-amber-500/30'
            }`}
            title={workspaceMode === 'learn' ? '返回代码 Diff 审查' : '打开学习此仓库页面'}
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-semibold">
              {workspaceMode === 'learn' ? '返回审查' : '学习此仓库'}
            </span>
          </button>
        )}

        {onToggleExplanation && workspaceMode !== 'learn' && (
          <button
            onClick={onToggleExplanation}
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs transition font-medium border shadow-sm ${
              isExplanationOpen
                ? 'bg-purple-600/30 text-white border-purple-500/50 shadow-purple-500/20'
                : 'bg-[#1E2029] hover:bg-[#252834] text-slate-300 hover:text-white border-white/10 hover:border-purple-500/30'
            }`}
            title="打开/收起 AI 深度审查工作台 (查看所有审查标签页与多轮追问对话)"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span className="font-semibold">AI 审查工作台</span>
          </button>
        )}

        {/* AI Call Live Inspector Console Button */}
        <button
          onClick={onOpenAIInspector}
          className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs transition font-medium border shadow-sm ${
            isAIRunning
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse shadow-emerald-500/20'
              : 'bg-[#1E2029] hover:bg-[#252834] text-slate-300 hover:text-white border-white/10 hover:border-purple-500/30'
          }`}
          title="打开 AI 实时调用控制台 (实时观察大模型完整输出流、思考过程与 Prompt)"
        >
          <Terminal className={`w-3.5 h-3.5 ${isAIRunning ? 'text-emerald-400' : 'text-purple-400'}`} />
          <span className="font-semibold">AI 控制台</span>
          {isAIRunning ? (
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          ) : (
            sessions.length > 0 && (
              <span className="bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] px-1.5 py-0.2 rounded-full font-mono">
                {sessions.length}
              </span>
            )
          )}
        </button>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded-md transition"
          title="刷新仓库与提交历史"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-purple-400' : ''}`} />
        </button>

        <button
          onClick={onOpenSettings}
          className="flex items-center space-x-1.5 bg-gradient-to-r from-purple-600/20 to-indigo-600/20 hover:from-purple-600/30 hover:to-indigo-600/30 border border-purple-500/30 text-purple-300 text-xs px-2.5 py-1.5 rounded-md transition font-medium"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>AI 引擎配置</span>
        </button>
      </div>
    </header>
  );
});

Header.displayName = 'Header';
