import React, { useState, useMemo } from 'react';
import { DiffFile, DiffResult } from '../types';
import {
  FileText,
  FileCode,
  Sparkles,
  Search,
  CheckCircle2,
  FolderOpen,
  Folder,
  Plus,
  Minus,
  FileDiff,
  List,
  FolderTree,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';

interface FilesPanelProps {
  diffResult: DiffResult | null;
  selectedFilePath: string | null;
  onSelectFile: (filePath: string) => void;
  onExplainAll: () => void;
  onExplainFile: (file: DiffFile) => void;
  isLoading: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  file?: DiffFile;
  children: TreeNode[];
  additions: number;
  deletions: number;
}

export const FilesPanel: React.FC<FilesPanelProps> = ({
  diffResult,
  selectedFilePath,
  onSelectFile,
  onExplainAll,
  onExplainFile,
  isLoading,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const files = diffResult?.files || [];

  const toggleFolder = (folderPath: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  const getCleanPath = (file: DiffFile) => {
    const raw = file.status === 'deleted' || !file.newPath || file.newPath === '/dev/null' ? file.oldPath : file.newPath;
    return (raw || '').replace(/\\/g, '/');
  };

  const filteredFiles = useMemo(() => {
    if (!searchTerm.trim()) return files;
    const term = searchTerm.toLowerCase();
    return files.filter((f) => {
      const p1 = (f.newPath || '').toLowerCase();
      const p2 = (f.oldPath || '').toLowerCase();
      return p1.includes(term) || p2.includes(term);
    });
  }, [files, searchTerm]);

  // Build hierarchical directory tree from filtered files
  const fileTree = useMemo(() => {
    const root: TreeNode = {
      name: 'root',
      path: '',
      isDir: true,
      children: [],
      additions: 0,
      deletions: 0,
    };

    filteredFiles.forEach((file) => {
      const clean = getCleanPath(file);
      const parts = clean.split('/').filter(Boolean);
      let current = root;
      current.additions += file.additions;
      current.deletions += file.deletions;

      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        let child = current.children.find((c) => c.name === part);
        if (!child) {
          child = {
            name: part,
            path: currentPath,
            isDir: !isFile,
            file: isFile ? file : undefined,
            children: [],
            additions: file.additions,
            deletions: file.deletions,
          };
          current.children.push(child);
        } else {
          child.additions += file.additions;
          child.deletions += file.deletions;
        }
        current = child;
      }
    });

    // Sort: directories first, then files
    const sortNodes = (node: TreeNode) => {
      node.children.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      node.children.forEach(sortNodes);
    };

    sortNodes(root);
    return root;
  }, [filteredFiles]);

  const getStatusBadge = (status: DiffFile['status']) => {
    switch (status) {
      case 'added':
        return (
          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
            A
          </span>
        );
      case 'deleted':
        return (
          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 shrink-0">
            D
          </span>
        );
      case 'renamed':
        return (
          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 shrink-0">
            R
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
            M
          </span>
        );
    }
  };

  const isFileSelected = (file: DiffFile) => {
    if (!selectedFilePath) return false;
    const cleanSel = selectedFilePath.replace(/\\/g, '/');
    const cleanNew = (file.newPath || '').replace(/\\/g, '/');
    const cleanOld = (file.oldPath || '').replace(/\\/g, '/');
    return cleanSel === cleanNew || cleanSel === cleanOld;
  };

  const renderTreeNode = (node: TreeNode, depth = 0) => {
    if (node.isDir) {
      const isCollapsed = collapsedFolders.has(node.path);
      return (
        <div key={`dir-${node.path}`} className="space-y-0.5">
          <div
            onClick={() => toggleFolder(node.path)}
            style={{ paddingLeft: `${Math.max(6, depth * 14)}px` }}
            className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-white/[0.06] text-xs text-slate-300 hover:text-white cursor-pointer select-none group transition"
          >
            <div className="flex items-center space-x-1.5 min-w-0">
              {isCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0 group-hover:text-purple-300" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 group-hover:text-purple-300" />
              )}
              {isCollapsed ? (
                <Folder className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              ) : (
                <FolderOpen className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              )}
              <span className="font-semibold truncate text-[11px] text-slate-200 group-hover:text-white">
                {node.name}
              </span>
            </div>

            <div className="flex items-center space-x-1 text-[10px] font-mono shrink-0 opacity-60 group-hover:opacity-100 transition">
              {node.additions > 0 && <span className="text-emerald-400">+{node.additions}</span>}
              {node.deletions > 0 && <span className="text-rose-400">-{node.deletions}</span>}
            </div>
          </div>

          {!isCollapsed && (
            <div className="space-y-0.5">
              {node.children.map((child) => renderTreeNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    if (!node.file) return null;
    const file = node.file;
    const isSelected = isFileSelected(file);

    return (
      <div
        key={`file-${node.path}`}
        onClick={() => onSelectFile(file.newPath || file.oldPath)}
        style={{ paddingLeft: `${Math.max(8, depth * 14)}px` }}
        className={`flex items-center justify-between py-1.5 px-2 rounded-lg cursor-pointer transition select-none group text-xs ${
          isSelected
            ? 'bg-purple-600/25 text-white border border-purple-500/40 shadow-sm'
            : 'text-slate-300 hover:bg-white/[0.04]'
        }`}
      >
        <div className="flex items-center space-x-1.5 min-w-0 mr-1.5">
          {getStatusBadge(file.status)}
          <span
            className={`font-medium truncate text-xs ${
              isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'
            }`}
          >
            {node.name}
          </span>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0 font-mono text-[11px]">
          {file.additions > 0 && <span className="text-emerald-400">+{file.additions}</span>}
          {file.deletions > 0 && <span className="text-rose-400">-{file.deletions}</span>}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onExplainFile(file);
            }}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-purple-500/20 text-purple-300 rounded transition ml-1"
            title="使用 AI 语义解释该文件"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#16171D] border-r border-white/10 text-slate-200">
      {/* Header & Stats */}
      <div className="p-3 border-b border-white/10 flex flex-col space-y-2.5 bg-[#13141A]">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
            <FileDiff className="w-4 h-4 text-sky-400" />
            <span>变更文件</span>
            <span className="text-[11px] bg-white/5 text-slate-400 px-1.5 py-0.2 rounded font-mono">
              {files.length}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {diffResult?.summary && (
              <div className="flex items-center space-x-1.5 text-[11px] font-mono">
                <span className="text-emerald-400 flex items-center">
                  <Plus className="w-3 h-3 mr-0.5" />
                  {diffResult.summary.insertions}
                </span>
                <span className="text-rose-400 flex items-center">
                  <Minus className="w-3 h-3 mr-0.5" />
                  {diffResult.summary.deletions}
                </span>
              </div>
            )}

            {/* Tree vs List View Toggle */}
            <div className="flex items-center bg-[#1D1F2B] border border-white/10 rounded-md p-0.5 text-xs">
              <button
                onClick={() => setViewMode('tree')}
                className={`p-1 rounded transition ${
                  viewMode === 'tree' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
                title="树状目录层级视图"
              >
                <FolderTree className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1 rounded transition ${
                  viewMode === 'list' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
                title="平铺文件列表视图"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* AI Explain All Button */}
        <button
          onClick={onExplainAll}
          disabled={files.length === 0 || isLoading}
          className="w-full flex items-center justify-center space-x-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-semibold py-1.5 px-3 rounded-lg transition shadow-md shadow-purple-600/20"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI 语义解析整体改动</span>
        </button>

        {/* Filter Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="筛选改动文件 / 目录..."
            className="w-full bg-[#1C1D24] text-xs text-slate-200 pl-8 pr-3 py-1.5 rounded-lg border border-white/5 focus:outline-none focus:border-purple-500/50 transition placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* Files Content */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {filteredFiles.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center justify-center space-y-1.5">
            <FileCode className="w-8 h-8 text-slate-600 stroke-1" />
            <span>{isLoading ? '正在加载文件差异...' : '暂无变更文件'}</span>
          </div>
        ) : viewMode === 'tree' ? (
          <div className="space-y-0.5">
            {fileTree.children.map((node) => renderTreeNode(node, 0))}
          </div>
        ) : (
          filteredFiles.map((file) => {
            const isSelected = isFileSelected(file);
            const cleanPath = getCleanPath(file);
            const parts = cleanPath.split('/').filter(Boolean);
            const fileName = parts.pop() || cleanPath;
            const dirPath = parts.join('/');

            return (
              <div
                key={file.newPath || file.oldPath}
                onClick={() => onSelectFile(file.newPath || file.oldPath)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition select-none group text-xs ${
                  isSelected
                    ? 'bg-purple-600/25 text-white border border-purple-500/40 shadow-sm'
                    : 'text-slate-300 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center space-x-2 min-w-0 mr-2">
                  {getStatusBadge(file.status)}
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate text-slate-200 group-hover:text-white">
                      {fileName}
                    </span>
                    {dirPath && (
                      <span className="text-[10px] text-slate-500 truncate">{dirPath}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0 font-mono text-[11px]">
                  {file.additions > 0 && <span className="text-emerald-400">+{file.additions}</span>}
                  {file.deletions > 0 && <span className="text-rose-400">-{file.deletions}</span>}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onExplainFile(file);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-purple-500/20 text-purple-300 rounded transition ml-1"
                    title="使用 AI 语义解释该文件"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
