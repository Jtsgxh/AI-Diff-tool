import React, { useCallback, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  ChevronRight,
  Network,
  RefreshCw,
  Send,
} from 'lucide-react';
import type { AIProviderConfig, LearnCommunity, LearnNode } from '../../types';
import { communityColor, looksLikeJsonBlob } from '../../utils/learnGraph';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { LearnGraphCanvas } from './LearnGraphCanvas';
import { useLearnSession } from './useLearnSession';

interface LearnWorkbenchProps {
  repoPath: string;
  repoName?: string;
  headHash?: string;
  aiConfig: AIProviderConfig;
  askAboutFile?: string | null;
  onAskAboutFileConsumed?: () => void;
}

export const LearnWorkbench: React.FC<LearnWorkbenchProps> = ({
  repoPath,
  repoName,
  headHash,
  aiConfig,
  askAboutFile,
  onAskAboutFileConsumed,
}) => {
  const session = useLearnSession(repoPath, aiConfig, headHash);
  const [draft, setDraft] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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

  const pathCommunities = session.graph
    ? session.graph.runtimePath
        .map((id) => session.graph!.communities.find((c) => c.id === id))
        .filter((c): c is LearnCommunity => Boolean(c))
    : [];

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
            <span className="text-[11px] font-mono text-sky-400">解析图谱…</span>
          )}
          {session.isStreaming && (
            <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 animate-spin" />
              {session.elapsedSeconds}s
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => session.startBriefing(true)}
          disabled={session.isStreaming}
          className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${session.isStreaming ? 'animate-spin' : ''}`} />
          重新开仓
        </button>
      </div>

      <div className="h-[46%] min-h-[260px] shrink-0 border-b border-white/10 relative">
        {session.graph && session.graph.nodes.length > 0 ? (
          <LearnGraphCanvas
            graph={session.graph}
            selectedNodeId={selectedNodeId}
            selectedCommunityId={session.selectedCommunityId}
            onSelectNode={setSelectedNodeId}
            onSelectCommunity={session.setSelectedCommunityId}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs gap-2">
            <Network className="w-6 h-6 text-slate-600" />
            {session.graphError || '正在从源码抽出节点和边…'}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {pathCommunities.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold text-slate-400 mb-1.5">运行时主路径</div>
            <div className="flex flex-wrap items-center gap-1">
              {pathCommunities.map((c, i) => (
                <React.Fragment key={c.id}>
                  {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />}
                  <button
                    type="button"
                    onClick={() => session.setSelectedCommunityId(c.id)}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                      session.selectedCommunityId === c.id
                        ? 'bg-amber-600/30 border-amber-400 text-amber-100'
                        : 'bg-[#171822] border-white/10 text-slate-300'
                    }`}
                  >
                    {c.label}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

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

        {session.graph && session.graph.godNodes.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold text-slate-400 mb-1.5">枢纽 God nodes</div>
            <div className="flex flex-wrap gap-1.5">
              {session.graph.godNodes.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    setSelectedNodeId(g.id);
                    const n = session.graph?.nodes.find((x) => x.id === g.id);
                    if (n) session.setSelectedCommunityId(n.communityId);
                  }}
                  className="text-[11px] px-2 py-1 rounded-lg bg-[#171822] border border-white/10 text-slate-200 hover:border-amber-400/50"
                >
                  {g.label}
                  <span className="text-slate-500 ml-1">度{g.degree}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {session.graph && session.graph.bridges.length > 0 && !session.briefing && (
          <div>
            <div className="text-[11px] font-semibold text-slate-400 mb-1.5">跨社区桥</div>
            <ul className="text-[11px] text-slate-400 space-y-0.5">
              {session.graph.bridges.slice(0, 8).map((b, i) => (
                <li key={`${b.source}-${b.target}-${i}`}>
                  {b.sourceLabel} <span className="text-slate-600">--{b.relation}--</span> {b.targetLabel}
                </li>
              ))}
            </ul>
          </div>
        )}

        {session.status?.message && session.isStreaming && (
          <p className="text-[11px] font-mono text-purple-300 truncate">{session.status.message}</p>
        )}

        {session.error && (
          <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{session.error}</span>
          </div>
        )}

        {session.settled &&
          !session.isStreaming &&
          !session.briefing &&
          !session.error &&
          !session.graph?.nodes.length && (
            <p className="text-xs text-slate-500">没能抽出图谱。点右上角「重新开仓」再试一次。</p>
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
  );
};
