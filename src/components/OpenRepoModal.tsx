import React, { useState, useEffect } from 'react';
import {
  FolderGit2,
  FolderOpen,
  X,
  Check,
  Clock,
  Trash2,
  ArrowRight,
  Sparkles,
  Layers,
  Laptop,
  HardDrive,
  CornerLeftUp,
  Folder,
  Search,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import {
  pickNativeFolder,
  browseDirectory,
  fetchQuickPaths,
  BrowseDirectoryResponse,
  QuickPathsResponse,
} from '../services/api';

interface OpenRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPath: string;
  onSelectRepo: (path: string) => void;
  recentRepos: string[];
  onRemoveRecentRepo: (path: string) => void;
}

export const OpenRepoModal: React.FC<OpenRepoModalProps> = ({
  isOpen,
  onClose,
  currentPath,
  onSelectRepo,
  recentRepos,
  onRemoveRecentRepo,
}) => {
  const [manualPath, setManualPath] = useState('');
  const [isPicking, setIsPicking] = useState(false);
  const [browseData, setBrowseData] = useState<BrowseDirectoryResponse | null>(null);
  const [quickPaths, setQuickPaths] = useState<QuickPathsResponse | null>(null);
  const [isLoadingBrowse, setIsLoadingBrowse] = useState(false);
  const [folderFilter, setFolderFilter] = useState('');

  // Load initial browse state
  useEffect(() => {
    if (isOpen) {
      loadQuickPaths();
      loadBrowse(currentPath && currentPath !== 'demo' && currentPath !== 'current' ? currentPath : undefined);
    }
  }, [isOpen, currentPath]);

  const loadQuickPaths = async () => {
    try {
      const data = await fetchQuickPaths();
      setQuickPaths(data);
    } catch (e) {}
  };

  const loadBrowse = async (path?: string) => {
    setIsLoadingBrowse(true);
    try {
      const data = await browseDirectory(path);
      setBrowseData(data);
      setManualPath(data.current);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingBrowse(false);
    }
  };

  if (!isOpen) return null;

  const handlePickNative = async () => {
    setIsPicking(true);
    try {
      const selected = await pickNativeFolder();
      if (selected) {
        onSelectRepo(selected);
        onClose();
      }
    } finally {
      setIsPicking(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualPath.trim()) {
      onSelectRepo(manualPath.trim());
      onClose();
    }
  };

  const filteredDirs = (browseData?.directories || []).filter((d) =>
    d.name.toLowerCase().includes(folderFilter.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#181922] border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] shadow-2xl overflow-hidden flex flex-col text-slate-200 animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="px-6 py-3.5 bg-[#14151B] border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md shadow-purple-500/20">
              <FolderGit2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">打开本地 Git 仓库</h2>
              <p className="text-[11px] text-slate-400">
                支持系统目录可视化导航、输入路径或选择历史仓库
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: 2 Columns (Shortcuts & Visual Browser) */}
        <div className="flex-1 flex overflow-hidden min-h-[420px]">
          {/* Left Sidebar: Quick Shortcuts & Drives */}
          <div className="w-48 bg-[#14151B]/80 border-r border-white/5 p-3 flex flex-col space-y-4 shrink-0 overflow-y-auto">
            {/* Quick Shortcuts */}
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1.5">
                常用位置
              </span>
              <div className="space-y-1">
                {quickPaths?.shortcuts.map((sc) => (
                  <button
                    key={sc.path}
                    onClick={() => loadBrowse(sc.path)}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/5 text-[11px] text-slate-300 hover:text-white transition truncate flex items-center space-x-2 group"
                    title={sc.path}
                  >
                    <Folder className="w-3.5 h-3.5 text-purple-400 shrink-0 group-hover:scale-110 transition" />
                    <span className="truncate">{sc.name.split(' (')[0]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Drives (C:, D:, etc.) */}
            {quickPaths?.drives && quickPaths.drives.length > 0 && (
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1.5">
                  本地磁盘
                </span>
                <div className="space-y-1">
                  {quickPaths.drives.map((d) => (
                    <button
                      key={d.path}
                      onClick={() => loadBrowse(d.path)}
                      className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/5 text-[11px] text-slate-300 hover:text-white transition truncate flex items-center space-x-2 group"
                    >
                      <HardDrive className="w-3.5 h-3.5 text-sky-400 shrink-0 group-hover:scale-110 transition" />
                      <span>{d.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Simulated Demo Switch */}
            <div className="pt-2 border-t border-white/5">
              <button
                onClick={() => {
                  onSelectRepo('demo');
                  onClose();
                }}
                className="w-full text-left p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-300 text-[11px] font-semibold transition flex items-center space-x-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>切到演示仓库</span>
              </button>
            </div>
          </div>

          {/* Right Main Area: Visual Folder Navigator */}
          <div className="flex-1 flex flex-col bg-[#181922] p-4 overflow-hidden space-y-3">
            {/* Current Path Bar & Up Button */}
            <div className="flex items-center space-x-2 bg-[#13141A] border border-white/10 rounded-xl p-1.5">
              <button
                onClick={() => browseData?.parent && loadBrowse(browseData.parent)}
                disabled={!browseData?.parent}
                className="p-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-lg text-slate-300 transition"
                title="返回上一级目录 (Up)"
              >
                <CornerLeftUp className="w-4 h-4" />
              </button>

              <form onSubmit={handleManualSubmit} className="flex-1 flex items-center">
                <input
                  type="text"
                  value={manualPath}
                  onChange={(e) => setManualPath(e.target.value)}
                  placeholder="输入或粘贴本地目录路径..."
                  className="w-full bg-transparent text-xs text-slate-200 font-mono px-2 py-1 focus:outline-none placeholder:text-slate-600"
                />
              </form>

              <button
                onClick={handleManualSubmit}
                disabled={!manualPath.trim()}
                className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition shadow"
              >
                前往
              </button>
            </div>

            {/* Current Folder Status Banner (If it is a Git repo) */}
            {browseData?.isCurrentGitRepo && (
              <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="text-xs text-emerald-300">
                    当前目录是一个有效的 <strong>Git 仓库</strong>
                  </div>
                </div>
                <button
                  onClick={() => {
                    onSelectRepo(browseData.current);
                    onClose();
                  }}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition shadow-md shadow-emerald-600/20"
                >
                  打开此仓库
                </button>
              </div>
            )}

            {/* Subdirectories Filter */}
            <div className="flex items-center justify-between pt-1">
              <div className="relative flex-1 mr-3">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={folderFilter}
                  onChange={(e) => setFolderFilter(e.target.value)}
                  placeholder="在当前目录下筛选文件夹..."
                  className="w-full bg-[#13141A] text-xs text-slate-300 pl-8 pr-3 py-1.5 rounded-lg border border-white/5 focus:outline-none focus:border-purple-500/50"
                />
              </div>

              {/* Native System Picker Fallback */}
              <button
                onClick={handlePickNative}
                disabled={isPicking}
                className="text-[11px] px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg transition flex items-center space-x-1 shrink-0"
                title="若需要在系统原生弹窗中选择"
              >
                <FolderOpen className="w-3 h-3 text-purple-400" />
                <span>{isPicking ? '选择中...' : '系统弹窗'}</span>
              </button>
            </div>

            {/* Folders Grid / List */}
            <div className="flex-1 overflow-y-auto pr-1">
              {isLoadingBrowse ? (
                <div className="p-12 text-center text-xs text-slate-500 flex flex-col items-center justify-center space-y-2">
                  <div className="w-5 h-5 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
                  <span>正在扫描本地文件夹...</span>
                </div>
              ) : filteredDirs.length === 0 ? (
                <div className="p-12 text-center text-xs text-slate-500">
                  当前目录下没有子文件夹
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {filteredDirs.map((dir) => (
                    <div
                      key={dir.path}
                      className={`p-2.5 rounded-xl border transition flex items-center justify-between group select-none ${
                        dir.isGitRepo
                          ? 'bg-purple-950/25 hover:bg-purple-900/40 border-purple-500/30'
                          : 'bg-[#14151B] hover:bg-[#1C1D26] border-white/5'
                      }`}
                    >
                      <div
                        onClick={() => loadBrowse(dir.path)}
                        className="flex items-center space-x-2.5 min-w-0 cursor-pointer flex-1 mr-2"
                      >
                        <div
                          className={`p-1.5 rounded-lg shrink-0 ${
                            dir.isGitRepo
                              ? 'bg-purple-500/20 text-purple-300'
                              : 'bg-white/5 text-slate-400'
                          }`}
                        >
                          {dir.isGitRepo ? (
                            <FolderGit2 className="w-4 h-4" />
                          ) : (
                            <Folder className="w-4 h-4" />
                          )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-semibold text-slate-200 group-hover:text-white truncate">
                            {dir.name}
                          </span>
                          {dir.isGitRepo && (
                            <span className="text-[10px] text-emerald-400 font-medium">
                              🌿 Git 仓库
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Direct Open Button if Git Repo */}
                      {dir.isGitRepo ? (
                        <button
                          onClick={() => {
                            onSelectRepo(dir.path);
                            onClose();
                          }}
                          className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-semibold rounded-md transition shrink-0 shadow-sm"
                        >
                          打开
                        </button>
                      ) : (
                        <button
                          onClick={() => loadBrowse(dir.path)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-white transition"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer: Recent Repos */}
        {recentRepos.length > 0 && (
          <div className="px-6 py-2.5 bg-[#121318] border-t border-white/10 flex items-center justify-between text-xs shrink-0">
            <div className="flex items-center space-x-2 text-slate-400 text-[11px] overflow-x-auto max-w-[80%] py-0.5">
              <span className="font-semibold text-slate-500 shrink-0">最近打开:</span>
              {recentRepos.slice(0, 4).map((r) => {
                const name = r.split(/[\/\\]/).pop() || r;
                return (
                  <button
                    key={r}
                    onClick={() => {
                      onSelectRepo(r);
                      onClose();
                    }}
                    className="shrink-0 bg-white/5 hover:bg-purple-600/20 hover:border-purple-500/30 border border-white/10 text-slate-300 hover:text-purple-200 px-2 py-0.5 rounded text-[11px] font-mono transition"
                    title={r}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            <span className="text-[11px] text-slate-500">双击文件夹可向下深入浏览</span>
          </div>
        )}
      </div>
    </div>
  );
};
