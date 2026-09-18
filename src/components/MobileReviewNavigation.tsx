import React, { useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Code, Files, FolderGit2, GitCommit, Menu, Sparkles, X } from 'lucide-react';
import type { RepoInfo } from '../types';
import { ClearRepositoryConversation } from './ClearRepositoryConversation';

export type MobileReviewPane = 'history' | 'files' | 'code' | 'ai';

interface MobileHeaderProps {
  repoInfo: RepoInfo | null;
  repoPath: string;
  isLoading: boolean;
  workspaceMode: 'diff' | 'learn';
  onOpenRepo: () => void;
  onWorkingTree: () => void;
  onRefresh: () => void;
  onSettings: () => void;
  onWorkspaceMode: (mode: 'diff' | 'learn') => void;
}

export function MobileReviewHeader(props: MobileHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const run = (action: () => void) => { setMenuOpen(false); action(); };
  return (
    <header className="mobile-header relative z-40 shrink-0 border-b border-black/15 bg-white">
      <div className="flex min-w-0 items-center gap-2 px-3">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={props.onOpenRepo} aria-label="切换仓库">
          <FolderGit2 className="h-5 w-5 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{props.repoInfo?.name || props.repoPath}</span>
            <span className="block truncate text-[11px] text-zinc-500">{props.repoInfo?.currentBranch || '代码审查'}</span>
          </span>
        </button>
        <button className="shrink-0 px-2 text-xs" onClick={() => props.onWorkspaceMode(props.workspaceMode === 'diff' ? 'learn' : 'diff')}>
          {props.workspaceMode === 'diff' ? '学习' : '返回审查'}
        </button>
        <button aria-label={menuOpen ? '关闭菜单' : '更多操作'} aria-expanded={menuOpen} aria-controls="mobile-actions" onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {menuOpen && <>
        <button className="fixed inset-0 top-14 z-[-1] bg-black/20" aria-label="收起菜单" onClick={() => setMenuOpen(false)} />
        <div id="mobile-actions" className="absolute right-2 top-full mt-1 flex w-56 flex-col rounded-xl border border-black/15 bg-white p-2 text-sm shadow-xl" onKeyDown={(e) => { if (e.key === 'Escape') setMenuOpen(false); }}>
          <button className="text-left px-3" onClick={() => run(props.onWorkingTree)}>未提交变更 ({props.repoInfo?.modifiedFilesCount ?? 0})</button>
          <button className="text-left px-3" disabled={props.isLoading} onClick={() => run(props.onRefresh)}>{props.isLoading ? '正在刷新…' : '刷新仓库'}</button>
          <button className="text-left px-3" onClick={() => run(props.onSettings)}>AI 引擎配置</button>
          <ClearRepositoryConversation key={`${props.repoInfo?.path || props.repoPath}:${props.workspaceMode}`} repoPath={props.repoInfo?.path || props.repoPath}
            lane={props.workspaceMode === 'learn' ? 'learn' : 'review'} disabled={!props.repoInfo} />
        </div>
      </>}
    </header>
  );
}

const panes = [
  { id: 'history', label: '提交', icon: GitCommit },
  { id: 'files', label: '文件', icon: Files },
  { id: 'code', label: '代码', icon: Code },
  { id: 'ai', label: 'AI 审查', icon: Sparkles },
] as const;

export function MobileReviewNavigation({ pane, onChange }: { pane: MobileReviewPane; onChange: (pane: MobileReviewPane) => void }) {
  return <nav aria-label="手机审查导航" className="mobile-review-nav grid shrink-0 grid-cols-4 border-t border-black/15 bg-white">
    {panes.map(({ id, label, icon: Icon }) => <button key={id} aria-current={pane === id ? 'page' : undefined} onClick={() => onChange(id)} className={`flex items-center justify-center gap-1 text-[11px] ${pane === id ? 'bg-sky-50 font-semibold text-sky-800' : 'text-zinc-600'}`}>
      <Icon className="h-4 w-4" />{label}
    </button>)}
  </nav>;
}

export function MobileFileNavigation({ index, count, filePath, onBack, onPrevious, onNext }: {
  index: number; count: number; filePath: string | null; onBack: () => void; onPrevious: () => void; onNext: () => void;
}) {
  return <div className="mobile-file-navigation flex min-w-0 shrink-0 items-center border-b border-black/10 bg-white px-1 text-xs">
    <button aria-label="文件列表" onClick={onBack} className="flex shrink-0 items-center justify-center"><ArrowLeft className="h-4 w-4" /></button>
    <span className="min-w-0 flex-1 truncate font-mono font-medium" title={filePath || undefined}>{filePath || '选择文件'}</span>
    <div className="flex shrink-0 items-center">
      <button aria-label="上一个文件" disabled={index <= 0} onClick={onPrevious}><ChevronLeft className="h-4 w-4" /></button>
      <span className="font-mono text-[11px]">{index + 1}/{count}</span>
      <button aria-label="下一个文件" disabled={index < 0 || index >= count - 1} onClick={onNext}><ChevronRight className="h-4 w-4" /></button>
    </div>
  </div>;
}
