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
  PanelLeftClose,
  MessageSquare,
} from 'lucide-react';

interface FilesPanelProps {
  diffResult: DiffResult | null;
  selectedFilePath: string | null;
  onSelectFile: (filePath: string) => void;
  onExplainAll: () => void;
  onExplainFile: (file: DiffFile) => void;
  onAskFile?: (file: DiffFile) => void;
  isLoading: boolean;
  onCollapse?: () => void;
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

/**
 * Changed-file tree. Memoized: it depends only on the diff result and the
 * selected path, neither of which changes while an AI review streams.
 */
export const FilesPanel = React.memo<FilesPanelProps>(({
  diffResult,
  selectedFilePath,
  onSelectFile,
  onExplainAll,
  onExplainFile,
  onAskFile,
  isLoading,
  onCollapse,
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
          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 border border-emerald-200 shrink-0">
            A
          </span>
        );
      case 'deleted':
        return (
          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 border border-rose-200 shrink-0">
            D
          </span>
        );
      case 'renamed':
        return (
          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-sky-100 text-sky-700 border border-sky-200 shrink-0">
            R
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-700 border border-amber-200 shrink-0">
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
            className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-black/[0.10] text-xs text-zinc-800 hover:text-zinc-950 cursor-pointer select-none group transition"
          >
            <div className="flex items-center space-x-1.5 min-w-0">
              {isCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0 group-hover:text-zinc-950" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-700 shrink-0 group-hover:text-zinc-950" />
              )}
              {isCollapsed ? (
                <Folder className="w-3.5 h-3.5 text-zinc-700 shrink-0" />
              ) : (
                <FolderOpen className="w-3.5 h-3.5 text-zinc-700 shrink-0" />
              )}
              <span className="font-semibold truncate text-[11px] text-zinc-900 group-hover:text-zinc-950">
                {node.name}
              </span>
            </div>

            <div className="flex items-center space-x-1 text-[10px] font-mono shrink-0 opacity-60 group-hover:opacity-100 transition">
              {node.additions > 0 && <span className="text-emerald-700">+{node.additions}</span>}
              {node.deletions > 0 && <span className="text-rose-700">-{node.deletions}</span>}
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
            ? 'bg-zinc-300 text-zinc-950 border border-zinc-400 shadow-sm'
            : 'text-zinc-800 hover:bg-black/[0.07]'
        }`}
      >
        <div className="flex items-center space-x-1.5 min-w-0 mr-1.5">
          {getStatusBadge(file.status)}
          <span
            className={`font-medium truncate text-xs ${
              isSelected ? 'text-zinc-950' : 'text-zinc-900 group-hover:text-zinc-950'
            }`}
          >
            {node.name}
          </span>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0 font-mono text-[11px]">
          {file.additions > 0 && <span className="text-emerald-700">+{file.additions}</span>}
          {file.deletions > 0 && <span className="text-rose-700">-{file.deletions}</span>}

          {onAskFile ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAskFile(file);
              }}
              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-amber-100 text-amber-700 rounded transition ml-1"
              title="在学习页询问这个文件"
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onExplainFile(file);
              }}
              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-100 text-zinc-800 rounded transition ml-1"
              title="使用 AI 语义解释该文件"
            >
              <Sparkles className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[var(--surface-panel)] border-r border-black/15 text-zinc-900">
      {/* Header & Stats */}
      <div className="p-3 border-b border-black/15 flex flex-col space-y-2.5 bg-[#F5F5F2]">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs font-semibold text-zinc-800">
            <FileDiff className="w-4 h-4 text-sky-700" />
            <span>变更文件</span>
            <span className="text-[11px] bg-black/[0.06] text-zinc-700 px-1.5 py-0.2 rounded font-mono">
              {files.length}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {diffResult?.summary && (
              <div className="flex items-center space-x-1.5 text-[11px] font-mono">
                <span className="text-emerald-700 flex items-center">
                  <Plus className="w-3 h-3 mr-0.5" />
                  {diffResult.summary.insertions}
                </span>
                <span className="text-rose-700 flex items-center">
                  <Minus className="w-3 h-3 mr-0.5" />
                  {diffResult.summary.deletions}
                </span>
              </div>
            )}

            {/* Tree vs List View Toggle */}
            <div className="flex items-center bg-[#E5E5E1] border border-black/15 rounded-md p-0.5 text-xs">
              <button
                onClick={() => setViewMode('tree')}
                className={`p-1 rounded transition ${
                  viewMode === 'tree' ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:text-zinc-950'
                }`}
                title="树状目录层级视图"
              >
                <FolderTree className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1 rounded transition ${
                  viewMode === 'list' ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:text-zinc-950'
                }`}
                title="平铺文件列表视图"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>

            {onCollapse && (
              <button
                onClick={onCollapse}
                className="p-1 text-zinc-700 hover:text-zinc-900 hover:bg-black/[0.06] rounded transition flex items-center gap-1 text-[11px]"
                title="收起变更文件列表"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
                <span>收起</span>
              </button>
            )}
          </div>
        </div>

        {/* AI Explain All Button */}
        <button
          onClick={onExplainAll}
          disabled={files.length === 0 || isLoading}
          className="w-full flex items-center justify-center space-x-2 bg-black/80 hover:bg-black/90 disabled:opacity-50 text-white text-xs font-semibold py-1.5 px-3 rounded-lg transition shadow-sm"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI 语义解析整体改动</span>
        </button>

        {/* Filter Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-zinc-600 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="筛选改动文件 / 目录..."
            className="w-full bg-[var(--surface-raised)] text-xs text-zinc-900 pl-8 pr-3 py-1.5 rounded-lg border border-black/10 focus:outline-none focus:border-zinc-400 transition placeholder:text-zinc-600"
          />
        </div>
      </div>

      {/* Files Content */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {filteredFiles.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-600 flex flex-col items-center justify-center space-y-1.5">
            <FileCode className="w-8 h-8 text-zinc-500 stroke-1" />
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
                    ? 'bg-zinc-300 text-zinc-950 border border-zinc-400 shadow-sm'
                    : 'text-zinc-800 hover:bg-black/[0.07]'
                }`}
              >
                <div className="flex items-center space-x-2 min-w-0 mr-2">
                  {getStatusBadge(file.status)}
                  <div className="flex flex-col min-w-0">
                    <span className={`font-medium truncate ${
                      isSelected ? 'text-zinc-950' : 'text-zinc-900 group-hover:text-zinc-950'
                    }`}>
                      {fileName}
                    </span>
                    {dirPath && (
                      <span className="text-[10px] text-zinc-600 truncate">{dirPath}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0 font-mono text-[11px]">
                  {file.additions > 0 && <span className="text-emerald-700">+{file.additions}</span>}
                  {file.deletions > 0 && <span className="text-rose-700">-{file.deletions}</span>}

                  {onAskFile ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAskFile(file);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-amber-100 text-amber-700 rounded transition ml-1"
                      title="在学习页询问这个文件"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onExplainFile(file);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-100 text-zinc-800 rounded transition ml-1"
                      title="使用 AI 语义解释该文件"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

FilesPanel.displayName = 'FilesPanel';
