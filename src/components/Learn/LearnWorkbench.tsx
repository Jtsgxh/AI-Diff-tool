import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Network,
  PanelBottomClose,
  PanelBottomOpen,
  PanelTopClose,
  PanelTopOpen,
  RefreshCw,
  Send,
} from 'lucide-react';
import type { AIProviderConfig, LearnNode } from '../../types';
import { STORAGE_KEYS, storage } from '../../constants/storage';
import { communityColor, looksLikeJsonBlob } from '../../utils/learnGraph';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { LearnGraphCanvas } from './LearnGraphCanvas';
import { useLearnSession } from './useLearnSession';

interface LearnWorkbenchProps {
  repoPath: string;
  repoName?: string;
  headHash?: string;
  repositoryRevision: number;
  aiConfig: AIProviderConfig;
  askAboutFile?: string | null;
  onAskAboutFileConsumed?: () => void;
}

const DEFAULT_GRAPH_PANE_PCT = 58;
const MIN_GRAPH_PANE_PCT = 20;
const MAX_GRAPH_PANE_PCT = 85;

function clampGraphPanePct(value: number): number {
  return Math.min(MAX_GRAPH_PANE_PCT, Math.max(MIN_GRAPH_PANE_PCT, value));
}

export const LearnWorkbench: React.FC<LearnWorkbenchProps> = ({
  repoPath,
  repoName,
  headHash,
  repositoryRevision,
  aiConfig,
  askAboutFile,
  onAskAboutFileConsumed,
}) => {
  const session = useLearnSession(repoPath, aiConfig, headHash, repositoryRevision);
  const [draft, setDraft] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [graphPanePct, setGraphPanePct] = useState(() => {
    const raw = storage.get(STORAGE_KEYS.learnGraphPanePct);
    const stored = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(stored)
      ? clampGraphPanePct(stored)
      : DEFAULT_GRAPH_PANE_PCT;
  });
  const [isGraphPaneOpen, setIsGraphPaneOpen] = useState(
    () => storage.get(STORAGE_KEYS.learnGraphPaneOpen) !== 'false'
  );
  const [isDetailsPaneOpen, setIsDetailsPaneOpen] = useState(
    () => storage.get(STORAGE_KEYS.learnDetailsPaneOpen) !== 'false'
  );
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const splitDraggingRef = useRef(false);
  const graphPanePctRef = useRef(graphPanePct);
  graphPanePctRef.current = graphPanePct;
  const plainError = session.error?.replace(/^#+\s*/, '').replace(/\*\*/g, '');

  const toggleGraphPane = useCallback(() => {
    setIsGraphPaneOpen((open) => {
      storage.set(STORAGE_KEYS.learnGraphPaneOpen, String(!open));
      return !open;
    });
  }, []);

  const toggleDetailsPane = useCallback(() => {
    setIsDetailsPaneOpen((open) => {
      storage.set(STORAGE_KEYS.learnDetailsPaneOpen, String(!open));
      return !open;
    });
  }, []);

  const finishSplitDrag = useCallback(() => {
    if (!splitDraggingRef.current) return;
    splitDraggingRef.current = false;
    document.body.classList.remove('learn-row-splitting');
    storage.set(STORAGE_KEYS.learnGraphPanePct, String(Math.round(graphPanePctRef.current)));
  }, []);

  useEffect(
    () => () => {
      document.body.classList.remove('learn-row-splitting');
    },
    []
  );

  React.useEffect(() => {
    if (!askAboutFile) return;
    session.ask(
      `请说明这个文件在业务里扮演什么角色，属于哪个社区，运行时何时进入，和哪些枢纽节点相连：${askAboutFile}`,
      askAboutFile
    );
    onAskAboutFileConsumed?.();
  }, [askAboutFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = draft.trim();
      if (!text || session.isStreaming) return;
      session.ask(text);
      setDraft('');
    },
    [draft, session]
  );

  const selectedNode: LearnNode | null =
    session.graph?.nodes.find((n) => n.id === selectedNodeId) || null;
  const selectedCommunity =
    session.graph?.communities.find((c) => c.id === session.selectedCommunityId) ||
    (selectedNode
      ? session.graph?.communities.find((c) => c.id === selectedNode.communityId)
      : null) ||
    null;

  const neighbors = useMemo(() => {
    if (!session.graph || !selectedNode) return [];
    const ids = new Set<string>();
    const rels: { node: LearnNode; relation: string }[] = [];
    for (const e of session.graph.edges) {
      let other: string | null = null;
      if (e.source === selectedNode.id) other = e.target;
      else if (e.target === selectedNode.id) other = e.source;
      if (!other || ids.has(other)) continue;
      const node = session.graph.nodes.find((n) => n.id === other);
      if (!node) continue;
      ids.add(other);
      rels.push({ node, relation: e.relation });
    }
    return rels.sort((a, b) => b.node.degree - a.node.degree).slice(0, 12);
  }, [session.graph, selectedNode]);

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col bg-[#13141A] overflow-hidden">
      <div className="h-11 shrink-0 border-b border-white/10 px-4 flex items-center justify-between bg-[#15161C]">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-sm font-semibold text-slate-100 truncate">
            学习 {repoName || '此仓库'}
          </span>
          {session.graphLoading && (
            <span className="text-[11px] font-mono text-sky-400">准备候选结构…</span>
          )}
          {session.isStreaming && (
            <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 animate-spin" />
              AI 分析业务路线 {session.elapsedSeconds}s
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            aria-pressed={isGraphPaneOpen}
            title={isGraphPaneOpen ? '关闭上方图谱' : '打开上方图谱'}
            onClick={toggleGraphPane}
            className={`h-7 px-2 rounded-md border flex items-center gap-1 text-[11px] transition ${
              isGraphPaneOpen
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                : 'border-white/10 bg-white/[0.03] text-slate-500 hover:text-slate-200'
            }`}
          >
            {isGraphPaneOpen ? (
              <PanelTopClose className="w-3.5 h-3.5" />
            ) : (
              <PanelTopOpen className="w-3.5 h-3.5" />
            )}
            {isGraphPaneOpen ? '收起图谱' : '展开图谱'}
          </button>
          <button
            type="button"
            aria-pressed={isDetailsPaneOpen}
            title={isDetailsPaneOpen ? '关闭下方讲解' : '打开下方讲解'}
            onClick={toggleDetailsPane}
            className={`h-7 px-2 rounded-md border flex items-center gap-1 text-[11px] transition ${
              isDetailsPaneOpen
                ? 'border-purple-500/30 bg-purple-500/10 text-purple-200'
                : 'border-white/10 bg-white/[0.03] text-slate-500 hover:text-slate-200'
            }`}
          >
            {isDetailsPaneOpen ? (
              <PanelBottomClose className="w-3.5 h-3.5" />
            ) : (
              <PanelBottomOpen className="w-3.5 h-3.5" />
            )}
            {isDetailsPaneOpen ? '收起讲解' : '展开讲解'}
          </button>
          <button
            type="button"
            onClick={() => session.startBriefing(true)}
            disabled={session.isStreaming}
            className="h-7 px-1.5 text-[11px] text-slate-400 hover:text-white flex items-center gap-1 disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${session.isStreaming ? 'animate-spin' : ''}`} />
            重新分析
          </button>
        </div>
      </div>

      <div ref={splitContainerRef} className="flex-1 min-h-0 flex flex-col">
      <div
        className={isGraphPaneOpen ? `min-h-0 relative ${isDetailsPaneOpen ? 'shrink-0' : 'flex-1'}` : 'hidden'}
        style={isDetailsPaneOpen ? { height: `${graphPanePct}%` } : undefined}
      >
        {session.graph?.communities.length ? (
          <LearnGraphCanvas
            graph={session.graph}
            selectedNodeId={selectedNodeId}
            selectedCommunityId={session.selectedCommunityId}
            onSelectNode={setSelectedNodeId}
            onSelectCommunity={session.setSelectedCommunityId}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs gap-2">
            {session.isStreaming ? (
              <Activity className="w-6 h-6 text-emerald-500 animate-spin" />
            ) : (
              <Network className="w-6 h-6 text-slate-600" />
            )}
            <span className="max-w-lg text-center leading-relaxed">
              {session.graphLoading
                ? '正在从源码构建 AI 分析所需的候选结构…'
                : session.isStreaming
                  ? session.status?.message || 'AI 正在核实入口、调用链和主要业务闭环…'
                  : plainError ||
                    session.graphError ||
                    (session.settled
                      ? 'AI 没有返回可用的主要业务路线，请点击右上角重新分析。'
                      : '等待 AI 分析主要业务路线…')}
            </span>
          </div>
        )}
      </div>

      {isGraphPaneOpen && isDetailsPaneOpen && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-valuenow={Math.round(graphPanePct)}
          aria-valuemin={MIN_GRAPH_PANE_PCT}
          aria-valuemax={MAX_GRAPH_PANE_PCT}
          title="拖动调整图谱与讲解高度 · 双击恢复默认"
          onPointerDown={(e) => {
            e.preventDefault();
            splitDraggingRef.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            document.body.classList.add('learn-row-splitting');
          }}
          onPointerMove={(e) => {
            if (!splitDraggingRef.current) return;
            const rect = splitContainerRef.current?.getBoundingClientRect();
            if (!rect || rect.height <= 0) return;
            const value = clampGraphPanePct(((e.clientY - rect.top) / rect.height) * 100);
            graphPanePctRef.current = value;
            setGraphPanePct(value);
          }}
          onPointerUp={finishSplitDrag}
          onPointerCancel={finishSplitDrag}
          onKeyDown={(e) => {
            let next: number | null = null;
            if (e.key === 'ArrowUp') next = graphPanePct - 2;
            else if (e.key === 'ArrowDown') next = graphPanePct + 2;
            else if (e.key === 'Home') next = MIN_GRAPH_PANE_PCT;
            else if (e.key === 'End') next = MAX_GRAPH_PANE_PCT;
            if (next === null) return;
            e.preventDefault();
            const value = clampGraphPanePct(next);
            graphPanePctRef.current = value;
            setGraphPanePct(value);
            storage.set(STORAGE_KEYS.learnGraphPanePct, String(Math.round(value)));
          }}
          onDoubleClick={() => {
            graphPanePctRef.current = DEFAULT_GRAPH_PANE_PCT;
            setGraphPanePct(DEFAULT_GRAPH_PANE_PCT);
            storage.set(STORAGE_KEYS.learnGraphPanePct, String(DEFAULT_GRAPH_PANE_PCT));
          }}
          tabIndex={0}
          className="h-2 shrink-0 cursor-row-resize relative z-20 group/split bg-white/[0.025] hover:bg-purple-500/20 active:bg-purple-500/30"
        >
          <div className="absolute inset-x-0 top-1/2 -mt-px h-px bg-white/10 group-hover/split:bg-purple-400" />
        </div>
      )}

      <div className={isDetailsPaneOpen ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {(selectedNode || selectedCommunity) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {selectedNode && (
              <div className="rounded-xl border border-white/10 bg-[#171822] p-3 text-xs">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">节点</div>
                <div className="text-sm font-bold text-slate-100 mt-0.5">{selectedNode.label}</div>
                <p className="text-slate-400 mt-1">
                  {selectedNode.kind} · 度 {selectedNode.degree}
                </p>
                {selectedNode.file && (
                  <p className="font-mono text-[11px] text-amber-200/80 mt-1 break-all">
                    {selectedNode.file}
                  </p>
                )}
                {neighbors.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-slate-400">
                    {neighbors.map(({ node, relation }) => (
                      <li key={node.id}>
                        <button
                          type="button"
                          className="hover:text-amber-200"
                          onClick={() => {
                            setSelectedNodeId(node.id);
                            session.setSelectedCommunityId(node.communityId);
                          }}
                        >
                          <span className="text-slate-600">{relation}</span> {node.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {selectedCommunity && (
              <div
                className="rounded-xl border bg-[#171822] p-3 text-xs"
                style={{ borderColor: `${communityColor(selectedCommunity.id)}66` }}
              >
                <div className="text-[10px] uppercase tracking-wide text-slate-500">社区</div>
                <div className="text-sm font-bold text-slate-100 mt-0.5">{selectedCommunity.label}</div>
                <p className="text-slate-300 mt-1 leading-relaxed">
                  {selectedCommunity.summary ||
                    `凝聚力 ${selectedCommunity.cohesion.toFixed(2)} · ${selectedCommunity.nodeCount} 个节点`}
                </p>
                {selectedCommunity.godNodes.length > 0 && (
                  <p className="text-amber-200/80 mt-2">枢纽 {selectedCommunity.godNodes.join('、')}</p>
                )}
                {selectedCommunity.entry && (
                  <p className="font-mono text-amber-200/90 mt-1">
                    入口 {selectedCommunity.entry.file}
                    {selectedCommunity.entry.symbol ? ` :: ${selectedCommunity.entry.symbol}` : ''}
                  </p>
                )}
                <ul className="mt-2 space-y-0.5 text-slate-500 font-mono">
                  {selectedCommunity.files.slice(0, 8).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {session.status?.message && session.isStreaming && (
          <p className="text-[11px] font-mono text-purple-300 truncate">{session.status.message}</p>
        )}

        {session.error && session.graph?.communities.length ? (
          <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{plainError}</span>
          </div>
        ) : null}

        {session.settled &&
          !session.isStreaming &&
          !session.briefing &&
          !session.error &&
          !session.graph?.businessRoutes.length && (
            <p className="text-xs text-slate-500">没有识别到证据完整的业务路线，社区结构仍可正常浏览。</p>
          )}

        {session.briefing && !looksLikeJsonBlob(session.briefing) && (
          <div className="rounded-xl border border-white/10 bg-[#171822] p-4">
            <MarkdownRenderer
              content={session.briefing}
              className="prose prose-invert prose-sm max-w-none text-slate-200 leading-relaxed"
            />
          </div>
        )}

        {session.chat.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-white/10">
            {session.chat.map((turn, i) => {
              if (turn.role === 'assistant' && looksLikeJsonBlob(turn.content)) return null;
              return (
                <div
                  key={i}
                  className={`text-xs rounded-lg p-3 ${
                    turn.role === 'user'
                      ? 'bg-purple-600/15 border border-purple-500/20 text-slate-200'
                      : 'bg-[#171822] border border-white/10 text-slate-300'
                  }`}
                >
                  {turn.role === 'assistant' ? (
                    <MarkdownRenderer content={turn.content} />
                  ) : (
                    <p className="whitespace-pre-wrap">{turn.content}</p>
                  )}
                </div>
              );
            })}
            {session.followUpStream && !looksLikeJsonBlob(session.followUpStream) && (
              <div className="bg-[#171822] border border-purple-500/30 rounded-lg p-3 text-xs text-slate-300">
                <MarkdownRenderer content={session.followUpStream} />
              </div>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSend}
        className="shrink-0 p-3 border-t border-white/10 bg-[#161722] flex items-center gap-2"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={session.isStreaming}
          placeholder={
            session.isStreaming
              ? '正在探查仓库…'
              : '问这个仓库：例如「登录之后怎么进战斗？」或「这个枢纽为什么度这么高？」'
          }
          className="flex-1 bg-[#1C1D29] text-xs text-slate-200 px-3 py-2 rounded-lg border border-white/5 focus:outline-none focus:border-amber-500/50 placeholder:text-slate-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!draft.trim() || session.isStreaming}
          className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white p-2 rounded-lg transition"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
      </div>

      {!isGraphPaneOpen && !isDetailsPaneOpen && (
        <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-slate-500">
          图谱和讲解均已关闭，可从右上角重新打开。
        </div>
      )}
      </div>
    </div>
  );
};
