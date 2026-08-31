import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  ChevronRight,
  Network,
  PanelBottomClose,
  PanelBottomOpen,
  PanelTopClose,
  PanelTopOpen,
  RefreshCw,
  Send,
  ScanSearch,
  Square,
  Workflow,
} from 'lucide-react';
import type { AIProviderConfig, LearnDrillTargetContext, LearnNode } from '../../types';
import { STORAGE_KEYS, storage } from '../../constants/storage';
import { communityColor, looksLikeJsonBlob } from '../../utils/learnGraph';
import { filterLearnTestNodes, learnGraphWithFilteredNodes } from '../../utils/learnGraphFilter';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import {
  buildLearnBusinessBus,
  type LearnBusinessBusNode,
  type LearnBusinessBusOccurrence,
} from '../../utils/learnBusinessBus';
import { LearnBusinessBusGraph } from './LearnBusinessBusGraph';
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

const BUSINESS_KIND_LABEL = {
  entry: '入口', process: '处理', decision: '判断', state: '状态', external: '外部边界', result: '结果',
} as const;

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function toDrillTarget(occurrence: LearnBusinessBusOccurrence): LearnDrillTargetContext {
  const {
    routeId,
    routeLabel,
    stepIndex,
    label,
    kind,
    file,
    classSymbol,
    methodSymbol,
    relation,
    description,
    evidence,
    communityId,
    inputs,
    outputs,
    stateChanges,
    failurePaths,
  } = occurrence;
  return {
    routeId,
    routeLabel,
    stepIndex,
    label,
    kind,
    file,
    classSymbol,
    methodSymbol,
    relation,
    description,
    evidence,
    communityId,
    inputs,
    outputs,
    stateChanges,
    failurePaths,
  };
}

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
  const [graphMode, setGraphMode] = useState<'business' | 'structure'>('business');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedBusinessNodeId, setSelectedBusinessNodeId] = useState<string | null>(null);
  const [hideTestNodes, setHideTestNodes] = useState(() => storage.get(STORAGE_KEYS.learnHideTestNodes) !== 'false');
  const activeDrill = session.drillLevels[session.drillLevels.length - 1] || null;
  const sourceGraph = activeDrill?.graph || session.graph;
  const testFreeTopology = useMemo(
    () => sourceGraph ? filterLearnTestNodes(sourceGraph) : null,
    [sourceGraph?.nodes, sourceGraph?.edges]
  );
  const testFreeGraph = useMemo(
    () => sourceGraph && testFreeTopology ? learnGraphWithFilteredNodes(sourceGraph, testFreeTopology) : null,
    [sourceGraph, testFreeTopology]
  );
  const displayGraph = hideTestNodes ? testFreeGraph : sourceGraph;
  const businessBus = useMemo(
    () => displayGraph ? buildLearnBusinessBus(displayGraph) : null,
    [displayGraph]
  );
  useEffect(() => {
    setSelectedBusinessNodeId((id) => id && businessBus?.nodes.some((node) => node.id === id) ? id : null);
  }, [businessBus]);
  useEffect(() => {
    setSelectedBusinessNodeId(null);
    setSelectedNodeId(null);
    session.setSelectedCommunityId(null);
  }, [activeDrill?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const onHideTestNodesChange = useCallback((hide: boolean) => {
    setHideTestNodes(hide);
    storage.set(STORAGE_KEYS.learnHideTestNodes, String(hide));
    if (hide) {
      setSelectedNodeId((id) => testFreeGraph?.nodes.some((node) => node.id === id) ? id : null);
      const visibleBusinessNodeIds = new Set(testFreeGraph ? buildLearnBusinessBus(testFreeGraph).nodes.map((node) => node.id) : []);
      setSelectedBusinessNodeId((id) => id && visibleBusinessNodeIds.has(id) ? id : null);
      session.setSelectedCommunityId((id) => testFreeGraph?.communities.some((community) => community.id === id) ? id : null);
    }
  }, [testFreeGraph, session.setSelectedCommunityId]);
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

  const handleExpandGraph = useCallback(() => {
    const text = draft.trim();
    if (!text || session.isStreaming) return;
    setGraphMode('business');
    session.expandGraph(text);
    setDraft('');
  }, [draft, session]);

  const selectedNode: LearnNode | null =
    displayGraph?.nodes.find((n) => n.id === selectedNodeId) || null;
  const selectedBusinessNode: LearnBusinessBusNode | null =
    businessBus?.nodes.find((node) => node.id === selectedBusinessNodeId) || null;
  const selectedBusinessFacts = useMemo(() => selectedBusinessNode ? {
    routes: unique(selectedBusinessNode.occurrences.map((item) => item.routeLabel)),
    community: displayGraph?.communities.find((item) => item.id === selectedBusinessNode.communityId)?.label || selectedBusinessNode.communityId,
    descriptions: unique(selectedBusinessNode.occurrences.map((item) => `${item.routeLabel}：${item.description}`)),
    inputs: unique(selectedBusinessNode.occurrences.flatMap((item) => item.inputs)),
    outputs: unique(selectedBusinessNode.occurrences.flatMap((item) => item.outputs)),
    stateChanges: unique(selectedBusinessNode.occurrences.flatMap((item) => item.stateChanges)),
    failurePaths: unique(selectedBusinessNode.occurrences.flatMap((item) => item.failurePaths)),
    evidence: unique(selectedBusinessNode.occurrences.map((item) => item.evidence)),
  } : null, [displayGraph?.communities, selectedBusinessNode]);
  const selectedCommunity =
    displayGraph?.communities.find((c) => c.id === session.selectedCommunityId) ||
    (selectedNode
      ? displayGraph?.communities.find((c) => c.id === selectedNode.communityId)
      : null) ||
    null;
  const currentBriefing = activeDrill?.briefing || session.briefing;

  const neighbors = useMemo(() => {
    if (!displayGraph || !selectedNode) return [];
    const ids = new Set<string>();
    const rels: { node: LearnNode; relation: string }[] = [];
    for (const e of displayGraph.edges) {
      let other: string | null = null;
      if (e.source === selectedNode.id) other = e.target;
      else if (e.target === selectedNode.id) other = e.source;
      if (!other || ids.has(other)) continue;
      const node = displayGraph.nodes.find((n) => n.id === other);
      if (!node) continue;
      ids.add(other);
      rels.push({ node, relation: e.relation });
    }
    return rels.sort((a, b) => b.node.degree - a.node.degree).slice(0, 12);
  }, [displayGraph, selectedNode]);

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
            onClick={() => session.isStreaming ? session.cancel() : session.startBriefing()}
            disabled={session.graphLoading || !session.graph}
            title={session.isStreaming ? '取消当前 AI 请求并保留现有业务总线' : '仅点击时调用 AI 分析仓库，会消耗模型 token'}
            className="h-7 px-1.5 text-[11px] text-slate-400 hover:text-white flex items-center gap-1 disabled:opacity-40"
          >
            {session.isStreaming ? (
              <Square className="w-3.5 h-3.5 text-rose-400" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {session.isStreaming ? '取消分析' : session.settled ? '重新分析' : '开始 AI 分析'}
          </button>
        </div>
      </div>

      <div ref={splitContainerRef} className="flex-1 min-h-0 flex flex-col">
      <div
        className={isGraphPaneOpen ? `min-h-0 relative flex flex-col ${isDetailsPaneOpen ? 'shrink-0' : 'flex-1'}` : 'hidden'}
        style={isDetailsPaneOpen ? { height: `${graphPanePct}%` } : undefined}
      >
        <div className="min-h-9 shrink-0 border-b border-white/10 bg-[#14161d] px-2 py-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
          <div className="flex shrink-0 items-center rounded-md border border-white/10 bg-black/20 p-0.5">
            <button type="button" aria-pressed={graphMode === 'business'} onClick={() => {
              setGraphMode('business');
              setSelectedNodeId(null);
              session.setSelectedCommunityId(null);
            }} className={`h-6 px-2 rounded text-[10px] flex items-center gap-1 ${graphMode === 'business'
              ? 'bg-emerald-500/15 text-emerald-200' : 'text-slate-500 hover:text-slate-200'}`}>
              <Workflow className="h-3 w-3" />业务总线
            </button>
            <button type="button" aria-pressed={graphMode === 'structure'} onClick={() => {
              setGraphMode('structure');
              setSelectedBusinessNodeId(null);
            }} className={`h-6 px-2 rounded text-[10px] flex items-center gap-1 ${graphMode === 'structure'
              ? 'bg-amber-500/15 text-amber-200' : 'text-slate-500 hover:text-slate-200'}`}>
              <Network className="h-3 w-3" />代码结构
            </button>
          </div>
          {graphMode === 'business' && (
            <nav aria-label="业务节点钻取路径" className="flex min-w-0 items-center gap-1 overflow-hidden text-[10px]">
              <button
                type="button"
                disabled={session.isStreaming || !activeDrill}
                onClick={() => session.leaveDrill(0)}
                className={`shrink-0 rounded px-1.5 py-1 ${activeDrill ? 'text-emerald-200 hover:bg-emerald-500/10' : 'text-slate-500'} disabled:cursor-default`}
              >
                顶层业务总线
              </button>
              {session.drillLevels.map((level, index) => (
                <React.Fragment key={level.key}>
                  <ChevronRight className="h-3 w-3 shrink-0 text-slate-700" />
                  <button
                    type="button"
                    disabled={session.isStreaming || index === session.drillLevels.length - 1}
                    onClick={() => session.leaveDrill(index + 1)}
                    title={`${level.target.routeLabel} · 第 ${level.target.stepIndex + 1} 步`}
                    className={`max-w-44 truncate rounded px-1.5 py-1 ${
                      index === session.drillLevels.length - 1
                        ? 'bg-purple-500/10 text-purple-200'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                    } disabled:cursor-default`}
                  >
                    {level.target.label}
                  </button>
                </React.Fragment>
              ))}
            </nav>
          )}
          </div>
          <span className="shrink-0 text-[10px] text-slate-600">
            {graphMode === 'business'
              ? activeDrill ? `源码子图 · 第 ${session.drillLevels.length} 层` : 'AI 核实的源码业务闭环'
              : '本地解析的类级依赖骨架'}
          </span>
        </div>
        <div className="flex-1 min-h-0 relative">
        {session.graph?.communities.length && displayGraph ? (
          graphMode === 'business' && businessBus ? (
            <LearnBusinessBusGraph
              key={activeDrill?.key || 'root-business-bus'}
              bus={businessBus}
              selectedNodeId={selectedBusinessNode?.id || null}
              onSelectNode={setSelectedBusinessNodeId}
              onDrillNode={(occurrence) => session.drillDown(toDrillTarget(occurrence))}
              hideTestNodes={hideTestNodes}
              testNodeCount={sourceGraph.nodes.length - (testFreeGraph?.nodes.length || 0)}
              onHideTestNodesChange={onHideTestNodesChange}
              emptyLabel={activeDrill
                ? '该节点已到源码证据粒度，没有生成猜测节点。可从上方面包屑返回上一层。'
                : undefined}
            />
          ) : (
            <LearnGraphCanvas
              graph={displayGraph}
              selectedNodeId={selectedNode?.id || null}
              selectedCommunityId={displayGraph.communities.some((community) => community.id === session.selectedCommunityId)
                ? session.selectedCommunityId : null}
              onSelectNode={setSelectedNodeId}
              onSelectCommunity={session.setSelectedCommunityId}
              hideTestNodes={hideTestNodes}
              testNodeCount={sourceGraph.nodes.length - (testFreeGraph?.nodes.length || 0)}
              onHideTestNodesChange={onHideTestNodesChange}
            />
          )
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
                      : '本页不会自动调用 AI，需要时点击右上角「开始 AI 分析」。')}
            </span>
          </div>
        )}
        </div>
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
        {!activeDrill && session.graph && !session.graphLoading && !session.isStreaming && !session.settled && !session.error && (
          <p className="text-xs text-slate-400">
            业务总线尚未生成；「代码结构」页签仍可浏览本地候选骨架。进入本页不会消耗模型 token；需要业务路线讲解时，点击「开始 AI 分析」或主动提问。
          </p>
        )}
        {activeDrill && (
          <div className="rounded-xl border border-purple-400/20 bg-purple-500/[0.06] p-3 text-xs text-slate-300">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-purple-300/70">递归业务子图 · 第 {session.drillLevels.length} 层</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-100">{activeDrill.target.label}</div>
              </div>
              <button
                type="button"
                disabled={session.isStreaming}
                onClick={() => session.leaveDrill(Math.max(0, session.drillLevels.length - 1))}
                className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:border-purple-400/30 hover:text-purple-100 disabled:opacity-40"
              >
                返回上一层
              </button>
            </div>
            <p className="mt-1 break-all font-mono text-[11px] text-amber-200/80">
              {activeDrill.target.file} :: {activeDrill.target.classSymbol}.{activeDrill.target.methodSymbol}
            </p>
          </div>
        )}
        {(selectedBusinessNode || selectedNode || selectedCommunity) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {selectedBusinessNode && selectedBusinessFacts && (
              <div className="md:col-span-2 rounded-xl border border-emerald-400/20 bg-[#171822] p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-emerald-300/70">业务总线节点 · 源码分析</div>
                    <div className="text-sm font-bold text-slate-100 mt-0.5">{selectedBusinessNode.label}</div>
                  </div>
                  <span className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                    {BUSINESS_KIND_LABEL[selectedBusinessNode.kind]} · {selectedBusinessFacts.routes.length} 条路线
                  </span>
                </div>
                <p className="font-mono text-[11px] text-amber-200/90 mt-2 break-all">
                  {selectedBusinessNode.file} :: {selectedBusinessNode.classSymbol}.{selectedBusinessNode.methodSymbol}
                </p>
                <p className="mt-1 text-slate-500">
                  所属社区：{selectedBusinessFacts.community} · 所属路线：{selectedBusinessFacts.routes.join('、')}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">
                  {selectedBusinessNode.occurrences.map((occurrence) => (
                    <button
                      key={`${occurrence.routeId}:${occurrence.stepIndex}`}
                      type="button"
                      disabled={session.isStreaming}
                      onClick={() => session.drillDown(toDrillTarget(occurrence))}
                      title={`只深入这一次路线出现位置：${occurrence.routeLabel} 第 ${occurrence.stepIndex + 1} 步`}
                      className="flex items-center gap-1.5 rounded-md border border-purple-400/30 bg-purple-500/10 px-2.5 py-1.5 text-[11px] text-purple-100 transition hover:bg-purple-500/20 disabled:opacity-40"
                    >
                      <ScanSearch className="h-3.5 w-3.5" />
                      深入：{occurrence.routeLabel} · 第 {occurrence.stepIndex + 1} 步
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div>
                    <div className="text-slate-500 mb-1">业务动作</div>
                    <ul className="space-y-1 text-slate-300">
                      {selectedBusinessFacts.descriptions.map((item) => <li key={item}>• {item}</li>)}
                    </ul>
                  </div>
                  <div>
                    <div className="text-slate-500 mb-1">源码证据</div>
                    <ul className="space-y-1 font-mono text-[11px] text-emerald-100/80">
                      {selectedBusinessFacts.evidence.map((item) => <li key={item}>• {item}</li>)}
                    </ul>
                  </div>
                  {selectedBusinessFacts.inputs.length > 0 && (
                    <div><div className="text-slate-500 mb-1">输入 / 读取</div><p className="text-slate-300">{selectedBusinessFacts.inputs.join('；')}</p></div>
                  )}
                  {selectedBusinessFacts.outputs.length > 0 && (
                    <div><div className="text-slate-500 mb-1">输出 / 副作用</div><p className="text-slate-300">{selectedBusinessFacts.outputs.join('；')}</p></div>
                  )}
                  {selectedBusinessFacts.stateChanges.length > 0 && (
                    <div><div className="text-slate-500 mb-1">状态变化</div><p className="text-emerald-100/80">{selectedBusinessFacts.stateChanges.join('；')}</p></div>
                  )}
                  {selectedBusinessFacts.failurePaths.length > 0 && (
                    <div><div className="text-slate-500 mb-1">分支 / 失败路径</div><p className="text-rose-200/80">{selectedBusinessFacts.failurePaths.join('；')}</p></div>
                  )}
                </div>
              </div>
            )}
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

        {!activeDrill && session.settled &&
          !session.isStreaming &&
          !session.briefing &&
          !session.error &&
          !session.graph?.businessRoutes.length && (
            <p className="text-xs text-slate-500">没有识别到证据完整的业务路线，社区结构仍可正常浏览。</p>
          )}

        {currentBriefing && !looksLikeJsonBlob(currentBriefing) && (
          <div className="rounded-xl border border-white/10 bg-[#171822] p-4">
            <MarkdownRenderer
              content={currentBriefing}
              className="prose prose-invert prose-sm max-w-none text-slate-200 leading-relaxed"
            />
          </div>
        )}

        {session.drillStream && !looksLikeJsonBlob(session.drillStream) && (
          <div className="rounded-xl border border-purple-500/30 bg-[#171822] p-4 text-xs text-slate-300">
            <MarkdownRenderer content={session.drillStream} />
          </div>
        )}

        {!activeDrill && session.chat.length > 0 && (
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
          disabled={session.isStreaming || Boolean(activeDrill)}
          placeholder={
            session.isStreaming
              ? '正在探查仓库…'
              : activeDrill
                ? '当前位于递归子图；点击子节点继续深入，或从面包屑返回顶层提问/补图'
              : '输入问题；回车只问答，点“补图”会把核实出的新路线加入业务总线'
          }
          className="flex-1 min-w-0 bg-[#1C1D29] text-xs text-slate-200 px-3 py-2 rounded-lg border border-white/5 focus:outline-none focus:border-amber-500/50 placeholder:text-slate-500 disabled:opacity-50"
        />
        <button
          type="submit"
          aria-label="发送文字提问"
          title="只回答问题，不修改节点图"
          disabled={!draft.trim() || session.isStreaming || session.graphLoading || !session.graph || Boolean(activeDrill)}
          className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white p-2 rounded-lg transition"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleExpandGraph}
          aria-label="提问并补充节点图"
          title={activeDrill ? '手动补图作用于顶层业务总线，请先通过面包屑返回顶层' : '沿源码核实这个问题，并把新业务路线追加到业务总线'}
          disabled={!draft.trim() || session.isStreaming || session.graphLoading || !session.graph || Boolean(activeDrill)}
          className="h-8 px-2.5 rounded-lg border border-emerald-400/30 bg-emerald-500/15 text-emerald-100 text-xs flex items-center gap-1.5 hover:bg-emerald-500/25 disabled:opacity-40 transition"
        >
          <Workflow className="w-3.5 h-3.5" />
          补图
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
