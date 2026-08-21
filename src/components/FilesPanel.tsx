import React, { useState, useMemo } from 'react';
import { DiffFile, DiffResult } from '../types';
import {
  FileText,
  FileCode,
  Sparkles,
  Search,
  CheckCircle2,
  FolderOpen,
  Plus,
  Minus,
  FileDiff,
} from 'lucide-react';

interface FilesPanelProps {
  diffResult: DiffResult | null;
  selectedFilePath: string | null;
  onSelectFile: (filePath: string) => void;
  onExplainAll: () => void;
  onExplainFile: (file: DiffFile) => void;
  isLoading: boolean;
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

  const files = diffResult?.files || [];

  const filteredFiles = useMemo(() => {
    if (!searchTerm.trim()) return files;
    const term = searchTerm.toLowerCase();
    return files.filter(
      (f) => f.newPath.toLowerCase().includes(term) || f.oldPath.toLowerCase().includes(term)
    );
  }, [files, searchTerm]);

  const getStatusBadge = (status: DiffFile['status']) => {
    switch (status) {
      case 'added':
        return (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            A
          </span>
        );
      case 'deleted':
        return (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
            D
          </span>
        );
      case 'renamed':
        return (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
            R
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
            M
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#16171D] border-r border-white/10 text-slate-200">
      {/* Header & Stats */}
      <div className="p-3 border-b border-white/10 flex flex-col space-y-2 bg-[#13141A]">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
            <FileDiff className="w-4 h-4 text-sky-400" />
            <span>变更文件列表</span>
            <span className="text-[11px] bg-white/5 text-slate-400 px-1.5 py-0.2 rounded">
              {files.length}
            </span>
          </div>

          {diffResult?.summary && (
            <div className="flex items-center space-x-2 text-[11px] font-mono">
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
        </div>

        {/* AI Explain All Button */}
        <button
          onClick={onExplainAll}
          disabled={files.length === 0 || isLoading}
          className="w-full flex items-center justify-center space-x-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-semibold py-1.5 px-3 rounded-md transition shadow-md shadow-purple-600/20"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI 语义解析整体改动</span>
        </button>

        {/* Filter Input */}
        <div className="relative">
          <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="过滤文件..."
            className="w-full bg-[#1C1D24] text-xs text-slate-200 pl-7 pr-3 py-1 rounded border border-white/5 focus:outline-none focus:border-purple-500/50 transition placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* Files List */}
      <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
        {filteredFiles.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            {isLoading ? '加载差异中...' : '暂无变更文件'}
          </div>
        ) : (
          filteredFiles.map((file) => {
            const isSelected = selectedFilePath === file.newPath || selectedFilePath === file.oldPath;
            const fileName = file.newPath.split('/').pop() || file.newPath;
            const dirPath = file.newPath.includes('/')
              ? file.newPath.slice(0, file.newPath.lastIndexOf('/'))
              : '';

            return (
              <div
                key={file.newPath}
                onClick={() => onSelectFile(file.newPath)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer transition select-none group text-xs ${
                  isSelected
                    ? 'bg-purple-600/20 text-white border border-purple-500/30'
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

                  {/* AI Explain File button */}
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
