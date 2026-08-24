import React, { useEffect, useMemo, useState } from 'react';
import type { LearnBusinessRoute, LearnGraph } from '../../types';
import { communityColor } from '../../utils/learnGraph';

interface LearnGraphCanvasProps {
  graph: LearnGraph;
  selectedNodeId: string | null;
  selectedCommunityId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectCommunity: (id: string | null) => void;
}

type DetailLevel = 'overview' | 'core' | 'expanded' | 'all';

interface CommunityConnection {
  key: string;
  source: string;
  target: string;
  weight: number;
}

const DETAIL_LEVELS: { id: DetailLevel; label: string; hint: string }[] = [
  { id: 'overview', label: '概览', hint: '只看社区职责' },
  { id: 'core', label: '核心', hint: '入口、枢纽、桥接与路线节点' },
  { id: 'expanded', label: '扩展', hint: '核心节点及其一跳邻居' },
  { id: 'all', label: '完整', hint: '该社区的全部节点与内部关系' },
];

function connectionKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function shorten(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, Math.max(1, length - 1))}…` : text;
}

function buildCommunityConnections(graph: LearnGraph): CommunityConnection[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const grouped = new Map<string, CommunityConnection>();
  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source)?.communityId;
    const target = nodeById.get(edge.target)?.communityId;
    if (!source || !target || source === target) continue;
    const key = connectionKey(source, target);
    const existing = grouped.get(key);
    if (existing) existing.weight++;
    else {
      const [a, b] = key.split('|');
      grouped.set(key, { key, source: a, target: b, weight: 1 });
    }
  }
  return [...grouped.values()].sort(
    (a, b) => b.weight - a.weight || a.key.localeCompare(b.key)
  );
}

function buildBackboneKeys(
  communityIds: string[],
  connections: CommunityConnection[]
): Set<string> {
  const parent = new Map(communityIds.map((id) => [id, id]));
  const find = (id: string): string => {
    const current = parent.get(id) || id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const backbone = new Set<string>();
  for (const connection of connections) {
    const sourceRoot = find(connection.source);
    const targetRoot = find(connection.target);
    if (sourceRoot === targetRoot) continue;
    parent.set(sourceRoot, targetRoot);
    backbone.add(connection.key);
  }
  for (const id of communityIds) {
    const strongest = connections.find(
      (connection) =>
        !backbone.has(connection.key) &&
        (connection.source === id || connection.target === id)
    );
    if (strongest) backbone.add(strongest.key);
  }
  return backbone;
}

function orderCommunities(
  ids: string[],
  connections: CommunityConnection[]
): string[] {
  const adjacency = new Map<string, { id: string; weight: number }[]>();
  const weights = new Map<string, number>();
  for (const id of ids) adjacency.set(id, []);
  for (const connection of connections) {
    adjacency.get(connection.source)?.push({ id: connection.target, weight: connection.weight });
    adjacency.get(connection.target)?.push({ id: connection.source, weight: connection.weight });
    weights.set(connection.source, (weights.get(connection.source) || 0) + connection.weight);
    weights.set(connection.target, (weights.get(connection.target) || 0) + connection.weight);
  }
  const remaining = new Set(ids);
  const ordered: string[] = [];
  while (remaining.size > 0) {
    const root = [...remaining].sort(
      (a, b) => (weights.get(b) || 0) - (weights.get(a) || 0) || a.localeCompare(b)
    )[0];
    const queue = [root];
    remaining.delete(root);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor];
      ordered.push(id);
      const neighbors = (adjacency.get(id) || [])
        .filter((neighbor) => remaining.has(neighbor.id))
        .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
      for (const neighbor of neighbors) {
        if (!remaining.delete(neighbor.id)) continue;
        queue.push(neighbor.id);
      }
    }
  }
  return ordered;
}

function routeCommunityIds(route: LearnBusinessRoute | null): string[] {
  if (!route) return [];
  const ids: string[] = [];
  for (const step of route.steps) {
    if (!step.communityId || ids[ids.length - 1] === step.communityId) continue;
    ids.push(step.communityId);
  }
  return ids;
}

export const LearnGraphCanvas: React.FC<LearnGraphCanvasProps> = ({
  graph,
  selectedNodeId,
  selectedCommunityId,
  onSelectNode,
  onSelectCommunity,
}) => {
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('core');
  const [hoveredCommunityId, setHoveredCommunityId] = useState<string | null>(null);

  useEffect(() => {
    if (activeRouteId && !graph.businessRoutes.some((route) => route.id === activeRouteId)) {
      setActiveRouteId(null);
    }
  }, [activeRouteId, graph.businessRoutes]);

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes]
  );
  const communityById = useMemo(
    () => new Map(graph.communities.map((community) => [community.id, community])),
    [graph.communities]
  );
  const connections = useMemo(() => buildCommunityConnections(graph), [graph]);
  const backboneKeys = useMemo(
    () => buildBackboneKeys(graph.communities.map((community) => community.id), connections),
    [connections, graph.communities]
  );
  const orderedIds = useMemo(
    () => orderCommunities(graph.communities.map((community) => community.id), connections),
    [connections, graph.communities]
  );
  const activeRoute =
    graph.businessRoutes.find((route) => route.id === activeRouteId) || null;
  const activeRouteCommunities = useMemo(
    () => routeCommunityIds(activeRoute),
    [activeRoute]
  );
  const activeRouteSet = useMemo(
    () => new Set(activeRouteCommunities),
    [activeRouteCommunities]
  );
  const activeRouteConnectionKeys = useMemo(() => {
    const keys = new Set<string>();
    for (let index = 1; index < activeRouteCommunities.length; index++) {
      keys.add(connectionKey(activeRouteCommunities[index - 1], activeRouteCommunities[index]));
    }
    return keys;
  }, [activeRouteCommunities]);

  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, orderedIds.length) * 1.6)));
  const rows = Math.max(1, Math.ceil(orderedIds.length / columns));
  const overviewWidth = Math.max(760, columns * 220 + 80);
  const overviewHeight = Math.max(330, rows * 126 + 70);
  const communityPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    orderedIds.forEach((id, index) => {
      const row = Math.floor(index / columns);
      const countInRow = Math.min(columns, orderedIds.length - row * columns);
      const column = index % columns;
      const rowWidth = Math.max(0, (countInRow - 1) * 220);
      positions.set(id, {
        x: overviewWidth / 2 - rowWidth / 2 + column * 220,
        y: 62 + row * 126,
      });
    });
    return positions;
  }, [columns, orderedIds, overviewWidth]);

  const visibleConnections = useMemo(() => {
    return connections.filter((connection) => {
      if (backboneKeys.has(connection.key)) return true;
      if (activeRouteConnectionKeys.has(connection.key)) return true;
      const focus = selectedCommunityId || hoveredCommunityId;
      return Boolean(focus && (connection.source === focus || connection.target === focus));
    });
  }, [
    activeRouteConnectionKeys,
    backboneKeys,
    connections,
    hoveredCommunityId,
    selectedCommunityId,
  ]);

  const selectedCommunity = selectedCommunityId
    ? communityById.get(selectedCommunityId) || null
    : null;
  const communityNodes = useMemo(
    () =>
      selectedCommunityId
        ? graph.nodes
            .filter((node) => node.communityId === selectedCommunityId)
            .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
        : [],
    [graph.nodes, selectedCommunityId]
  );

  const coreNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedCommunity) return ids;
    const addMatching = (file?: string, symbol?: string) => {
      const normalizedFile = file?.replace(/\\/g, '/');
      const match = communityNodes.find(
        (node) =>
          (!normalizedFile || node.file?.replace(/\\/g, '/') === normalizedFile) &&
          (!symbol || node.label.toLowerCase() === symbol.toLowerCase())
      );
      if (match) ids.add(match.id);
    };
    addMatching(selectedCommunity.entry?.file, selectedCommunity.entry?.symbol);
    for (const label of selectedCommunity.godNodes) addMatching(undefined, label);
    for (const bridge of graph.bridges) {
      if (bridge.sourceCommunity === selectedCommunity.id) ids.add(bridge.source);
      if (bridge.targetCommunity === selectedCommunity.id) ids.add(bridge.target);
    }
    if (activeRoute) {
      for (const step of activeRoute.steps) {
        if (step.communityId !== selectedCommunity.id) continue;
        if (step.nodeId) ids.add(step.nodeId);
        else addMatching(step.file, step.symbol);
      }
    }
    if (selectedNodeId && nodeById.get(selectedNodeId)?.communityId === selectedCommunity.id) {
      ids.add(selectedNodeId);
    }
    if (ids.size === 0) {
      for (const node of communityNodes.slice(0, 4)) ids.add(node.id);
    }
    return ids;
  }, [
    communityNodes,
    activeRoute,
    graph.bridges,
    nodeById,
    selectedCommunity,
    selectedNodeId,
  ]);

  const detailNodes = useMemo(() => {
    if (detailLevel === 'overview') return [];
    if (detailLevel === 'all') return communityNodes;
    const ids = new Set(coreNodeIds);
    if (detailLevel === 'expanded') {
      for (const edge of graph.edges) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (
          source?.communityId !== selectedCommunityId ||
          target?.communityId !== selectedCommunityId
        ) {
          continue;
        }
        if (coreNodeIds.has(edge.source)) ids.add(edge.target);
        if (coreNodeIds.has(edge.target)) ids.add(edge.source);
      }
    }
    return communityNodes.filter((node) => ids.has(node.id));
  }, [
    communityNodes,
    coreNodeIds,
    detailLevel,
    graph.edges,
    nodeById,
    selectedCommunityId,
  ]);
  const detailNodeIds = useMemo(
    () => new Set(detailNodes.map((node) => node.id)),
    [detailNodes]
  );
  const detailEdges = useMemo(
    () =>
      graph.edges.filter((edge) => {
        if (!detailNodeIds.has(edge.source) || !detailNodeIds.has(edge.target)) return false;
        if (detailLevel !== 'expanded') return true;
        return coreNodeIds.has(edge.source) || coreNodeIds.has(edge.target);
      }),
    [coreNodeIds, detailLevel, detailNodeIds, graph.edges]
  );

  const detailColumns = detailNodes.length > 18 ? 4 : detailNodes.length > 7 ? 3 : 2;
  const detailRows = Math.max(1, Math.ceil(detailNodes.length / detailColumns));
  const detailWidth = 420;
  const detailHeight = Math.max(230, detailRows * 68 + 42);
  const detailPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const horizontal = detailWidth / detailColumns;
    detailNodes.forEach((node, index) => {
      const row = Math.floor(index / detailColumns);
      const countInRow = Math.min(detailColumns, detailNodes.length - row * detailColumns);
      const column = index % detailColumns;
      const rowWidth = countInRow * horizontal;
      positions.set(node.id, {
        x: (detailWidth - rowWidth) / 2 + horizontal * (column + 0.5),
        y: 34 + row * 68,
      });
    });
    return positions;
  }, [detailColumns, detailNodes]);

  const routeStepsByCommunity = useMemo(() => {
    const grouped = new Map<string, number[]>();
    activeRoute?.steps.forEach((step, index) => {
      if (!step.communityId) return;
      const steps = grouped.get(step.communityId) || [];
      steps.push(index + 1);
      grouped.set(step.communityId, steps);
    });
    return grouped;
  }, [activeRoute]);

  return (
    <div className="w-full h-full flex flex-col bg-[#12131A] text-slate-200">
      <div className="shrink-0 border-b border-white/10 px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-slate-100">社区结构与业务路线</div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              社区连线已按依赖聚合；选择路线只做高亮，不替代确定性的结构图。
            </p>
          </div>
          <span className="shrink-0 text-[10px] text-slate-500 border border-white/10 rounded-full px-2 py-0.5">
            {graph.communities.length} 社区 · {graph.nodes.length} 节点
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setActiveRouteId(null)}
            className={`shrink-0 rounded-md border px-2 py-1 text-[10px] transition ${
              !activeRouteId
                ? 'border-amber-400/70 bg-amber-500/15 text-amber-100'
                : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200'
            }`}
          >
            结构总览
          </button>
          {graph.businessRoutes.map((route) => (
            <button
              key={route.id}
              type="button"
              onClick={() => setActiveRouteId(route.id)}
              className={`shrink-0 rounded-md border px-2 py-1 text-[10px] transition ${
                activeRouteId === route.id
                  ? 'border-emerald-400/70 bg-emerald-500/15 text-emerald-100'
                  : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200'
              }`}
            >
              {route.label}
            </button>
          ))}
          {!graph.businessRoutes.length && (
            <span className="text-[10px] text-slate-600 px-1">AI 路线分析中，社区结构已可浏览</span>
          )}
        </div>
        {activeRoute?.summary && (
          <p className="mt-1.5 text-[10px] text-emerald-200/70 leading-relaxed">
            {activeRoute.summary}
          </p>
        )}
        {activeRoute && (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
            {activeRoute.steps.map((step, index) => (
              <button
                key={`${activeRoute.id}-${index}-${step.file}-${step.symbol || ''}`}
                type="button"
                onClick={() => {
                  onSelectCommunity(step.communityId || null);
                  onSelectNode(step.nodeId || null);
                }}
                className="w-[190px] shrink-0 rounded-md border border-emerald-500/20 bg-emerald-500/[0.04] p-1.5 text-left hover:border-emerald-400/50"
              >
                <span className="block text-[10px] font-semibold text-slate-200 truncate">
                  {index + 1}. {step.label}
                </span>
                <span className="block mt-0.5 text-[9px] text-emerald-300/70 truncate">
                  {step.relation} · {step.symbol || step.file}
                </span>
                <span className="block mt-1 text-[9px] text-slate-500 leading-snug line-clamp-2">
                  {step.evidence}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-auto">
          <svg
            width={overviewWidth}
            height={overviewHeight}
            viewBox={`0 0 ${overviewWidth} ${overviewHeight}`}
            role="img"
            aria-label="代码社区聚合关系图"
            onClick={() => {
              onSelectNode(null);
              onSelectCommunity(null);
            }}
          >
            <title>代码社区聚合关系图</title>
            {visibleConnections.map((connection) => {
              const source = communityPositions.get(connection.source);
              const target = communityPositions.get(connection.target);
              if (!source || !target) return null;
              const routeHot = activeRouteConnectionKeys.has(connection.key);
              const focus = selectedCommunityId || hoveredCommunityId;
              const focused = Boolean(
                focus && (connection.source === focus || connection.target === focus)
              );
              const dimmed = Boolean(activeRoute && !routeHot && !focused);
              return (
                <g key={connection.key}>
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={routeHot ? '#34d399' : focused ? '#fbbf24' : '#64748b'}
                    strokeOpacity={dimmed ? 0.08 : routeHot || focused ? 0.78 : 0.24}
                    strokeWidth={routeHot ? 4 : Math.min(3, 1 + Math.log2(connection.weight + 1) * 0.45)}
                  />
                  {(routeHot || focused || backboneKeys.has(connection.key)) && (
                    <text
                      x={(source.x + target.x) / 2}
                      y={(source.y + target.y) / 2 - 5}
                      textAnchor="middle"
                      fill={routeHot ? '#a7f3d0' : '#94a3b8'}
                      fontSize="10"
                    >
                      {connection.weight}
                    </text>
                  )}
                </g>
              );
            })}

            {orderedIds.map((id) => {
              const community = communityById.get(id);
              const position = communityPositions.get(id);
              if (!community || !position) return null;
              const selected = selectedCommunityId === id;
              const hovered = hoveredCommunityId === id;
              const routeHot = activeRouteSet.has(id);
              const dimmed = Boolean(activeRoute && !routeHot);
              const color = communityColor(id);
              const steps = routeStepsByCommunity.get(id) || [];
              return (
                <g
                  key={id}
                  role="button"
                  tabIndex={0}
                  aria-label={`社区 ${community.label}，${community.nodeCount} 个节点`}
                  transform={`translate(${position.x - 88} ${position.y - 34})`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectNode(null);
                    onSelectCommunity(id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    onSelectNode(null);
                    onSelectCommunity(id);
                  }}
                  onMouseEnter={() => setHoveredCommunityId(id)}
                  onMouseLeave={() => setHoveredCommunityId(null)}
                  className="cursor-pointer outline-none"
                >
                  <rect
                    width="176"
                    height="68"
                    rx="10"
                    fill={color}
                    fillOpacity={selected ? 0.25 : routeHot ? 0.18 : dimmed ? 0.035 : 0.1}
                    stroke={selected ? '#fbbf24' : routeHot ? '#34d399' : color}
                    strokeOpacity={selected || routeHot || hovered ? 0.95 : dimmed ? 0.12 : 0.48}
                    strokeWidth={selected || routeHot ? 2.5 : 1.2}
                  />
                  <text x="12" y="22" fill="#f1f5f9" fontSize="12" fontWeight="600">
                    {shorten(community.label, 20)}
                  </text>
                  <text x="12" y="41" fill="#94a3b8" fontSize="9.5">
                    {community.nodeCount} 节点
                    {community.godNodes[0]
                      ? ` · ${shorten(community.godNodes[0], 15)}`
                      : ''}
                  </text>
                  {steps.length > 0 && (
                    <text x="12" y="57" fill="#a7f3d0" fontSize="9.5">
                      路线步骤 {steps.join('、')}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {selectedCommunity && (
          <aside className="w-[42%] min-w-[330px] max-w-[520px] shrink-0 border-l border-white/10 bg-[#151620] flex flex-col overflow-hidden">
            <div className="shrink-0 p-3 border-b border-white/10">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-100 truncate">
                    {selectedCommunity.label}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                    {selectedCommunity.summary ||
                      `${selectedCommunity.nodeCount} 个节点，凝聚力 ${selectedCommunity.cohesion.toFixed(2)}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onSelectNode(null);
                    onSelectCommunity(null);
                  }}
                  className="text-[10px] text-slate-500 hover:text-slate-200 shrink-0"
                >
                  收起
                </button>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {DETAIL_LEVELS.map((level) => (
                  <button
                    key={level.id}
                    type="button"
                    title={level.hint}
                    onClick={() => setDetailLevel(level.id)}
                    className={`rounded-md border px-1.5 py-1 text-[9.5px] transition ${
                      detailLevel === level.id
                        ? 'border-amber-400/70 bg-amber-500/15 text-amber-100'
                        : 'border-white/10 text-slate-500 hover:text-slate-200'
                    }`}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-3">
              {detailLevel === 'overview' ? (
                <div className="space-y-3 text-[10px]">
                  {selectedCommunity.entry && (
                    <div>
                      <div className="text-slate-500 mb-1">候选入口</div>
                      <div className="font-mono text-amber-200/80 break-all">
                        {selectedCommunity.entry.file}
                        {selectedCommunity.entry.symbol
                          ? ` :: ${selectedCommunity.entry.symbol}`
                          : ''}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="text-slate-500 mb-1">核心符号</div>
                    <div className="flex flex-wrap gap-1">
                      {selectedCommunity.godNodes.map((name) => (
                        <span key={name} className="rounded bg-white/5 px-1.5 py-0.5 text-slate-300">
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 mb-1">文件范围</div>
                    <ul className="space-y-0.5 font-mono text-slate-500">
                      {selectedCommunity.files.map((file) => (
                        <li key={file} className="break-all">{file}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : detailNodes.length > 0 ? (
                <>
                  <div className="flex items-center justify-between text-[9.5px] text-slate-500 mb-2">
                    <span>{detailNodes.length} 节点 · {detailEdges.length} 内部关系</span>
                    <span>{DETAIL_LEVELS.find((level) => level.id === detailLevel)?.hint}</span>
                  </div>
                  <svg
                    width="100%"
                    height={detailHeight}
                    viewBox={`0 0 ${detailWidth} ${detailHeight}`}
                    role="img"
                    aria-label={`${selectedCommunity.label}社区内部关系`}
                  >
                    <title>{`${selectedCommunity.label}社区内部关系`}</title>
                    {detailEdges.map((edge) => {
                      const source = detailPositions.get(edge.source);
                      const target = detailPositions.get(edge.target);
                      if (!source || !target) return null;
                      const hot =
                        selectedNodeId === edge.source || selectedNodeId === edge.target;
                      return (
                        <line
                          key={`${edge.source}-${edge.target}-${edge.relation}`}
                          x1={source.x}
                          y1={source.y}
                          x2={target.x}
                          y2={target.y}
                          stroke={hot ? '#fbbf24' : '#64748b'}
                          strokeOpacity={hot ? 0.75 : 0.2}
                          strokeWidth={hot ? 2 : 1}
                        />
                      );
                    })}
                    {detailNodes.map((node) => {
                      const position = detailPositions.get(node.id);
                      if (!position) return null;
                      const selected = selectedNodeId === node.id;
                      const isCore = coreNodeIds.has(node.id);
                      const routeStep = activeRoute?.steps.findIndex(
                        (step) => step.nodeId === node.id
                      );
                      const showLabel = detailNodes.length <= 28 || isCore || selected;
                      return (
                        <g
                          key={node.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`${node.label}，${node.kind}，度 ${node.degree}`}
                          onClick={() => onSelectNode(node.id)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            onSelectNode(node.id);
                          }}
                          className="cursor-pointer outline-none"
                        >
                          <title>{`${node.label}${node.file ? ` · ${node.file}` : ''}`}</title>
                          {node.kind === 'file' ? (
                            <rect
                              x={position.x - 7}
                              y={position.y - 7}
                              width="14"
                              height="14"
                              rx="3"
                              fill={selected ? '#fbbf24' : communityColor(node.communityId)}
                              fillOpacity={selected ? 1 : isCore ? 0.9 : 0.55}
                            />
                          ) : (
                            <circle
                              cx={position.x}
                              cy={position.y}
                              r={selected ? 8 : isCore ? 7 : 5}
                              fill={selected ? '#fbbf24' : communityColor(node.communityId)}
                              fillOpacity={selected ? 1 : isCore ? 0.9 : 0.55}
                            />
                          )}
                          {typeof routeStep === 'number' && routeStep >= 0 && (
                            <text
                              x={position.x + 8}
                              y={position.y - 8}
                              fill="#a7f3d0"
                              fontSize="9"
                            >
                              {routeStep + 1}
                            </text>
                          )}
                          {showLabel && (
                            <text
                              x={position.x}
                              y={position.y + 18}
                              textAnchor="middle"
                              fill={selected ? '#fde68a' : '#cbd5e1'}
                              fontSize="8.5"
                            >
                              {shorten(node.label, 16)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </>
              ) : (
                <p className="text-[10px] text-slate-500">这个展开层级没有可显示的节点。</p>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
