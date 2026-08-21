import React, { useState } from 'react';
import {
  GitBranch,
  FolderGit2,
  Sparkles,
  Settings,
  RefreshCw,
  Layers,
  ArrowRightLeft,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { RepoInfo, SelectionState } from '../types';

interface HeaderProps {
  repoInfo: RepoInfo | null;
  repoPath: string;
  onRepoChange: (path: string) => void;
  selection: SelectionState;
  onSelectWorkingTree: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  isLoading: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  repoInfo,
  repoPath,
  onRepoChange,
  selection,
  onSelectWorkingTree,
  onRefresh,
  onOpenSettings,
  isLoading,
}) => {
  const [inputPath, setInputPath] = useState(repoPath);
  const [isEditingPath, setIsEditingPath] = useState(false);

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputPath.trim()) {
      onRepoChange(inputPath.trim());
      setIsEditingPath(false);
    }
  };

  const isDemo = repoPath === 'demo';

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

        {/* Repo Switcher / Input */}
        <div className="flex items-center space-x-2">
          {isEditingPath ? (
            <form onSubmit={handlePathSubmit} className="flex items-center space-x-1">
              <input
                type="text"
                value={inputPath}
                onChange={(e) => setInputPath(e.target.value)}
                placeholder="输入本地 Git 仓库绝对路径 (如 C:\Projects\my-app)..."
                className="w-80 bg-[#1E2029] text-xs text-slate-200 border border-purple-500/50 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
                autoFocus
              />
              <button
                type="submit"
                className="text-xs bg-purple-600 hover:bg-purple-500 text-white px-2.5 py-1.5 rounded transition"
              >
                打开
              </button>
              <button
                type="button"
                onClick={() => {
                  setInputPath(repoPath);
                  setIsEditingPath(false);
                }}
                className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1.5 rounded"
              >
                取消
              </button>
            </form>
          ) : (
            <div className="flex items-center space-x-1 bg-[#1E2029] border border-white/5 rounded-lg px-2 py-1">
              <FolderGit2 className="w-3.5 h-3.5 text-slate-400 mr-1" />
              <button
                onClick={() => setIsEditingPath(true)}
                className="text-xs font-medium text-slate-200 hover:text-white truncate max-w-xs transition text-left"
                title="点击切换本地 Git 仓库路径"
              >
                {repoInfo?.name || (isDemo ? '内置演示仓库 (Demo Repo)' : repoPath)}
              </button>

              <button
                onClick={() => onRepoChange(isDemo ? 'current' : 'demo')}
                className={`ml-2 text-[11px] px-2 py-0.5 rounded font-medium transition ${
                  isDemo
                    ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                    : 'bg-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10'
                }`}
                title="在演示仓库与当前工程仓库之间快速切换"
              >
                {isDemo ? '🎮 体验模式中' : '🎮 切到演示库'}
              </button>
            </div>
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
          </div>
        )}
      </div>

      {/* Right: Actions & Settings */}
      <div className="flex items-center space-x-2">
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
};
