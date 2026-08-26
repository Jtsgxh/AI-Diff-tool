import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LearnEdge, LearnGraph, LearnNode } from '../../types';
import { communityColor } from '../../utils/learnGraph';
import { createGraphFrameScheduler } from '../../utils/graphFrameScheduler';

interface LearnGraphCanvasProps {
  graph: LearnGraph;
  selectedNodeId: string | null;
  selectedCommunityId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectCommunity: (id: string | null) => void;
}

interface SimNode extends LearnNode {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  r: number;
}

interface Camera {
  x: number;
  y: number;
  k: number;
}

interface CommunityBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenPoint {
  x: number;
  y: number;
}

interface CurvedEdgeGeometry {
  start: ScreenPoint;
  control: ScreenPoint;
  end: ScreenPoint;
  midpoint: ScreenPoint;
  endAngle: number;
}

interface EdgeBend {
  direction: number;
  ratio: number;
}

interface RenderCurve {
  source: SimNode;
  target: SimNode;
  bend: EdgeBend;
  sourcePadding: number;
  targetPadding: number;
  zoom: number;
  tick: number;
  geometry: CurvedEdgeGeometry | null;
}

type GraphDensity = 'simple' | 'rich';

const MIN_ZOOM = 0.01;
const NODE_SPACING = 52;
const COMMUNITY_GAP = 40;
const COMMUNITY_PADDING_X = 48;
const COMMUNITY_PADDING_TOP = 58;
const COMMUNITY_PADDING_BOTTOM = 36;

const fitCameraToNodes = (
  nodes: SimNode[],
  width: number,
  height: number
): Camera | null => {
  if (!nodes.length || width <= 0 || height <= 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.r);
    minY = Math.min(minY, node.y - node.r);
    maxX = Math.max(maxX, node.x + node.r);
    maxY = Math.max(maxY, node.y + node.r);
  }
  const padding = 72;
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const zoom = Math.min(
    1,
    Math.max(
      MIN_ZOOM,
      Math.min(
        Math.max(1, width - padding * 2) / graphWidth,
        Math.max(1, height - padding * 2) / graphHeight
      )
    )
  );
  return {
    x: -(minX + maxX) / 2,
    y: -(minY + maxY) / 2,
    k: zoom,
  };
};

const EDGE_COLOR: Record<string, string> = {
  calls: 'rgba(52,211,153,0.38)',
  imports: 'rgba(56,189,248,0.28)',
  inherits: 'rgba(251,191,36,0.35)',
  references: 'rgba(255,255,255,0.10)',
};

const EDGE_LABEL: Record<string, string> = {
  calls: '调用',
  imports: '导入',
  inherits: '继承',
  references: '引用',
};

const EDGE_DASH: Record<string, number[]> = {
  calls: [], imports: [6, 4], references: [2, 4], inherits: [9, 4],
};

// IDs contain full file paths. Hash once per edge, never once per animation frame.
const edgeBend = (sourceId: string, targetId: string): EdgeBend => {
  const pairKey = sourceId < targetId
    ? `${sourceId}|${targetId}`
    : `${targetId}|${sourceId}`;
  let hash = 0;
  for (let index = 0; index < pairKey.length; index++) {
    hash = ((hash << 5) - hash + pairKey.charCodeAt(index)) | 0;
  }
  return { direction: (hash & 1) === 0 ? 1 : -1, ratio: 0.08 + (Math.abs(hash >> 1) % 5) * 0.03 };
};

const curvedEdgeGeometry = (
  curve: EdgeBend,
  source: ScreenPoint,
  target: ScreenPoint,
  sourceRadius: number,
  targetRadius: number
): CurvedEdgeGeometry | null => {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance < 1) return null;
  const bend = Math.min(64, Math.max(7, distance * curve.ratio)) * curve.direction;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const control = {
    x: (source.x + target.x) / 2 + normalX * bend,
    y: (source.y + target.y) / 2 + normalY * bend,
  };
  const startDx = control.x - source.x;
  const startDy = control.y - source.y;
  const startDistance = Math.sqrt(startDx * startDx + startDy * startDy) || 1;
  const endDx = target.x - control.x;
  const endDy = target.y - control.y;
  const endDistance = Math.sqrt(endDx * endDx + endDy * endDy) || 1;
  const start = {
    x: source.x + (startDx / startDistance) * sourceRadius,
    y: source.y + (startDy / startDistance) * sourceRadius,
  };
  const end = {
    x: target.x - (endDx / endDistance) * targetRadius,
    y: target.y - (endDy / endDistance) * targetRadius,
  };
  return {
    start,
    control,
    end,
    midpoint: {
      x: start.x * 0.25 + control.x * 0.5 + end.x * 0.25,
      y: start.y * 0.25 + control.y * 0.5 + end.y * 0.25,
    },
    endAngle: Math.atan2(end.y - control.y, end.x - control.x),
  };
};

const makeRenderCurve = (
  source: SimNode, target: SimNode, bend: EdgeBend, sourcePadding = 2, targetPadding = 5
): RenderCurve => ({
  source, target, bend, sourcePadding, targetPadding, zoom: NaN, tick: -1, geometry: null,
});

// Geometry is independent of camera translation. Panning reuses curves and arrows.
const cachedCurveGeometry = (curve: RenderCurve, zoom: number, tick: number) => {
  if (curve.zoom !== zoom || curve.tick !== tick) {
    const { source, target } = curve;
    const radiusScale = Math.sqrt(zoom);
    curve.geometry = curvedEdgeGeometry(
      curve.bend,
      { x: source.x * zoom, y: source.y * zoom },
      { x: target.x * zoom, y: target.y * zoom },
      source.r * radiusScale + curve.sourcePadding,
      target.r * radiusScale + curve.targetPadding
    );
    curve.zoom = zoom;
    curve.tick = tick;
  }
  return curve.geometry;
};

export const LearnGraphCanvas = React.memo(function LearnGraphCanvas({
  graph,
  selectedNodeId,
  selectedCommunityId,
  onSelectNode,
  onSelectCommunity,
}: LearnGraphCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<SimNode[]>([]);
  const communityBoxesRef = useRef<CommunityBox[]>([]);
  const camRef = useRef({ x: 0, y: 0, k: 1 });
  const cameraTouchedRef = useRef(false);
  const dragRef = useRef<{ lx: number; ly: number } | null>(null);
  const hoverRef = useRef<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<GraphDensity>('simple');
  const [activeRouteId, setActiveRouteId] = useState('');
  const routeSetRef = useRef('');
  const invalidateRef = useRef<() => void>(() => {});
  const ticksRef = useRef(0);

  const activeRoute = useMemo(
    () => graph.businessRoutes.find((route) => route.id === activeRouteId) || null,
    [activeRouteId, graph.businessRoutes]
  );

  useEffect(() => {
    const routeSet = graph.businessRoutes.map((route) => route.id).join('\n');
    if (routeSet !== routeSetRef.current) {
      routeSetRef.current = routeSet;
      const nextRouteId = graph.businessRoutes.some((route) => route.id === activeRouteId)
        ? activeRouteId
        : '';
      if (nextRouteId !== activeRouteId) setActiveRouteId(nextRouteId);
      return;
    }
    if (activeRouteId && !activeRoute) setActiveRouteId('');
  }, [activeRoute, activeRouteId, graph.businessRoutes]);

  const searchHit = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      graph.nodes
        .filter(
          (node) =>
            node.label.toLowerCase().includes(q) ||
            node.symbols?.some((symbol) => symbol.toLowerCase().includes(q)) ||
            (node.file || '').toLowerCase().includes(q)
        )
        .map((node) => node.id)
    );
  }, [graph.nodes, query]);

  const graphNodeIds = useMemo(
    () => new Set(graph.nodes.map((node) => node.id)),
    [graph.nodes]
  );
  const graphNodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes]
  );

  const activeRouteNodeIds = useMemo(
    () => new Set(
      activeRoute?.steps
        .map((step) => step.nodeId)
        .filter((nodeId): nodeId is string => Boolean(nodeId && graphNodeIds.has(nodeId))) || []
    ),
    [activeRoute, graphNodeIds]
  );

  const activeRouteVisibleNodeIds = useMemo(
    () => new Set(
      graph.nodes
        .filter(
          (node) => activeRouteNodeIds.has(node.id) && !hidden.has(node.communityId)
        )
        .map((node) => node.id)
    ),
    [activeRouteNodeIds, graph.nodes, hidden]
  );

  const routeFocusActive = Boolean(activeRoute && activeRouteVisibleNodeIds.size > 0);

  useEffect(() => {
    if (activeRoute && activeRouteNodeIds.size === 0) setActiveRouteId('');
  }, [activeRoute, activeRouteNodeIds]);

  const activeRouteStepNumbers = useMemo(() => {
    const numbers = new Map<string, number[]>();
    activeRoute?.steps.forEach((step, index) => {
      if (!step.nodeId) return;
      const nodeSteps = numbers.get(step.nodeId);
      if (nodeSteps) nodeSteps.push(index + 1);
      else numbers.set(step.nodeId, [index + 1]);
    });
    return numbers;
  }, [activeRoute]);

  const activeRouteCommunityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of graph.nodes) {
      if (activeRouteNodeIds.has(node.id)) ids.add(node.communityId);
    }
    return ids;
  }, [activeRouteNodeIds, graph.nodes]);

  const routeMappedStepCounts = useMemo(
    () => new Map(
      graph.businessRoutes.map((route) => [
        route.id,
        route.steps.filter((step) => Boolean(step.nodeId && graphNodeIds.has(step.nodeId))).length,
      ])
    ),
    [graph.businessRoutes, graphNodeIds]
  );

  const businessCoreNodeIds = useMemo(
    () => new Set(
      graph.businessRoutes.flatMap((route) =>
        route.steps
          .map((step) => step.nodeId)
          .filter((nodeId): nodeId is string => Boolean(nodeId && graphNodeIds.has(nodeId)))
      )
    ),
    [graph.businessRoutes, graphNodeIds]
  );

  const activityNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.relation !== 'calls') continue;
      ids.add(edge.source);
      ids.add(edge.target);
    }
    return ids;
  }, [graph.edges]);

  const simplifiedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    const nodesByCommunity = new Map<string, LearnNode[]>();
    for (const node of graph.nodes) {
      const members = nodesByCommunity.get(node.communityId);
      if (members) members.push(node);
      else nodesByCommunity.set(node.communityId, [node]);
    }
    for (const community of graph.communities) {
      const members = (nodesByCommunity.get(community.id) || [])
        .slice()
        .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
      const coreLabels = new Set(community.godNodes.map((label) => label.toLowerCase()));
      for (const node of members) {
        if (activityNodeIds.has(node.id) && coreLabels.has(node.label.toLowerCase())) {
          ids.add(node.id);
        }
      }
      if (community.entry) {
        const entryFile = community.entry.file.replace(/\\/g, '/');
        const entry = members.find(
          (node) =>
            node.file?.replace(/\\/g, '/') === entryFile &&
            (!community.entry?.symbol ||
              node.label.toLowerCase() === community.entry.symbol.toLowerCase() ||
              node.symbols?.some(
                (symbol) => symbol.toLowerCase() === community.entry!.symbol!.toLowerCase()
              ))
        ) || members.find(
          (node) => node.file?.replace(/\\/g, '/') === entryFile
        );
        if (entry && activityNodeIds.has(entry.id)) ids.add(entry.id);
      }
      if (!members.some((node) => ids.has(node.id))) {
        const activityMember = members.find((node) => activityNodeIds.has(node.id));
        if (activityMember) ids.add(activityMember.id);
      }
    }
    for (const bridge of graph.bridges) {
      if (bridge.relation !== 'calls') continue;
      ids.add(bridge.source);
      ids.add(bridge.target);
    }
    for (const id of businessCoreNodeIds) ids.add(id);
    if (selectedNodeId) {
      ids.add(selectedNodeId);
      for (const edge of graph.edges) {
        if (edge.relation !== 'calls') continue;
        if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
          ids.add(edge.source);
          ids.add(edge.target);
        }
      }
    }
    for (const id of searchHit || []) ids.add(id);
    return ids;
  }, [
    activityNodeIds,
    graph.bridges,
    graph.communities,
    graph.edges,
    graph.nodes,
    businessCoreNodeIds,
    searchHit,
    selectedNodeId,
  ]);

  const visibleNodes = useMemo(
    () => density === 'rich'
      ? graph.nodes
      : graph.nodes.filter((node) => simplifiedNodeIds.has(node.id)),
    [density, graph.nodes, simplifiedNodeIds]
  );
  const visibleCommunityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of visibleNodes) {
      counts.set(node.communityId, (counts.get(node.communityId) || 0) + 1);
    }
    return counts;
  }, [visibleNodes]);
  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes]
  );
  const visibleEdges = useMemo(
    () => {
      if (density === 'rich') return graph.edges;
      const nodesById = new Map(visibleNodes.map((node) => [node.id, node]));
      const candidates = graph.edges
        .filter(
          (edge) =>
            edge.relation === 'calls' &&
            visibleNodeIds.has(edge.source) &&
            visibleNodeIds.has(edge.target)
        )
        .sort((a, b) => {
          const aSource = nodesById.get(a.source);
          const aTarget = nodesById.get(a.target);
          const bSource = nodesById.get(b.source);
          const bTarget = nodesById.get(b.target);
          const aCross = aSource?.communityId !== aTarget?.communityId ? 1 : 0;
          const bCross = bSource?.communityId !== bTarget?.communityId ? 1 : 0;
          return bCross - aCross ||
            (bSource?.degree || 0) + (bTarget?.degree || 0) -
              (aSource?.degree || 0) - (aTarget?.degree || 0);
        });
      if (candidates.length <= visibleNodes.length * 2) return candidates;

      const kept: LearnEdge[] = [];
      const keptKeys = new Set<string>();
      const incidence = new Map<string, number>();
      const add = (edge: LearnEdge) => {
        const key = `${edge.source}|${edge.target}`;
        if (keptKeys.has(key)) return;
        keptKeys.add(key);
        kept.push(edge);
        incidence.set(edge.source, (incidence.get(edge.source) || 0) + 1);
        incidence.set(edge.target, (incidence.get(edge.target) || 0) + 1);
      };
      for (const edge of candidates) {
        if ((incidence.get(edge.source) || 0) >= 2) continue;
        if ((incidence.get(edge.target) || 0) >= 2) continue;
        add(edge);
      }
      const firstIncidentEdge = new Map<string, LearnEdge>();
      for (const edge of candidates) {
        if (!firstIncidentEdge.has(edge.source)) firstIncidentEdge.set(edge.source, edge);
        if (!firstIncidentEdge.has(edge.target)) firstIncidentEdge.set(edge.target, edge);
      }
      for (const node of visibleNodes) {
        if ((incidence.get(node.id) || 0) > 0) continue;
        const edge = firstIncidentEdge.get(node.id);
        if (edge) add(edge);
      }
      return kept;
    },
    [density, graph.edges, visibleNodeIds, visibleNodes]
  );

  const connections = useMemo(() => {
    const outgoing = new Map<string, LearnEdge[]>();
    const incoming = new Map<string, LearnEdge[]>();
    for (const edge of visibleEdges) {
      const source = graphNodesById.get(edge.source);
      const target = graphNodesById.get(edge.target);
      if (!source || !target || hidden.has(source.communityId) || hidden.has(target.communityId)) continue;
      const out = outgoing.get(edge.source);
      if (out) out.push(edge);
      else outgoing.set(edge.source, [edge]);
      const into = incoming.get(edge.target);
      if (into) into.push(edge);
      else incoming.set(edge.target, [edge]);
    }
    return { outgoing, incoming };
  }, [graphNodesById, hidden, visibleEdges]);

  const edgeShapes = useMemo(
    () => visibleEdges.map((edge) => ({ edge, bend: edgeBend(edge.source, edge.target) })),
    [visibleEdges]
  );

  const maxDegree = useMemo(
    () => Math.max(1, ...graph.nodes.map((n) => n.degree)),
    [graph.nodes]
  );
  const layoutKey = useMemo(
    () =>
      visibleNodes.map((n) => n.id).join('\n') +
      '#' +
      visibleEdges.map((e) => `${e.source}>${e.target}:${e.relation}`).join('\n'),
    [visibleEdges, visibleNodes]
  );

  useEffect(() => {
    const maxD = Math.max(1, ...visibleNodes.map((n) => n.degree));
    const wrap = wrapRef.current;
    const viewportAspect = Math.max(
      1,
      (wrap?.clientWidth || 1600) / Math.max(1, wrap?.clientHeight || 450)
    );
    const byId = new Map(visibleNodes.map((n) => [n.id, n]));
    const adjacency = new Map<string, string[]>();
    for (const edge of visibleEdges) {
      if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
      const sourceNeighbors = adjacency.get(edge.source);
      if (sourceNeighbors) sourceNeighbors.push(edge.target);
      else adjacency.set(edge.source, [edge.target]);
      const targetNeighbors = adjacency.get(edge.target);
      if (targetNeighbors) targetNeighbors.push(edge.source);
      else adjacency.set(edge.target, [edge.source]);
    }
    const grouped = new Map<string, LearnNode[]>();
    for (const node of visibleNodes) {
      const members = grouped.get(node.communityId);
      if (members) members.push(node);
      else grouped.set(node.communityId, [node]);
    }
    const entries: [string, LearnNode[]][] = [];
    for (const community of graph.communities) {
      const members = grouped.get(community.id);
      if (!members?.length) continue;
      entries.push([community.id, members]);
      grouped.delete(community.id);
    }
    entries.push(...grouped.entries());

    const communityRows = Math.max(
      1,
      Math.ceil(Math.sqrt(entries.length / viewportAspect))
    );
    const communityColumns = Math.max(1, Math.ceil(entries.length / communityRows));
    const communityAspect = Math.max(
      1,
      viewportAspect / Math.max(1, communityColumns / communityRows)
    );

    const layouts = entries.map(([id, members]) => {
      const memberIds = new Set(members.map((node) => node.id));
      const ranked = members
        .slice()
        .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
      const ordered: LearnNode[] = [];
      const seen = new Set<string>();
      for (const seed of ranked) {
        if (seen.has(seed.id)) continue;
        const queue = [seed.id];
        seen.add(seed.id);
        for (let cursor = 0; cursor < queue.length; cursor++) {
          const nodeId = queue[cursor];
          const node = byId.get(nodeId);
          if (node) ordered.push(node);
          const neighbors = (adjacency.get(nodeId) || [])
            .filter((neighborId) => memberIds.has(neighborId) && !seen.has(neighborId))
            .sort((a, b) => (byId.get(b)?.degree || 0) - (byId.get(a)?.degree || 0));
          for (const neighborId of neighbors) {
            if (seen.has(neighborId)) continue;
            seen.add(neighborId);
            queue.push(neighborId);
          }
        }
      }
      const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length * communityAspect)));
      const rows = Math.max(1, Math.ceil(ordered.length / columns));
      return { id, nodes: ordered, columns, rows };
    });

    const boxWidth =
      Math.max(0, ...layouts.map((layout) => (layout.columns - 1) * NODE_SPACING)) +
      COMMUNITY_PADDING_X * 2;
    const boxHeight =
      Math.max(0, ...layouts.map((layout) => (layout.rows - 1) * NODE_SPACING)) +
      COMMUNITY_PADDING_TOP +
      COMMUNITY_PADDING_BOTTOM;
    const cellWidth = boxWidth + COMMUNITY_GAP;
    const cellHeight = boxHeight + COMMUNITY_GAP;
    const sim: SimNode[] = [];
    const boxes: CommunityBox[] = [];

    layouts.forEach((layout, communityIndex) => {
      const communityRow = Math.floor(communityIndex / communityColumns);
      const columnOffset = communityIndex % communityColumns;
      const rowSize = Math.min(
        communityColumns,
        layouts.length - communityRow * communityColumns
      );
      const centerX = (columnOffset - (rowSize - 1) / 2) * cellWidth;
      const centerY = (communityRow - (communityRows - 1) / 2) * cellHeight;
      boxes.push({ id: layout.id, x: centerX, y: centerY, width: boxWidth, height: boxHeight });

      layout.nodes.forEach((node, nodeIndex) => {
        const row = Math.floor(nodeIndex / layout.columns);
        const offsetInRow = nodeIndex % layout.columns;
        const rowNodeCount = Math.min(
          layout.columns,
          layout.nodes.length - row * layout.columns
        );
        const column = row % 2 === 0 ? offsetInRow : rowNodeCount - 1 - offsetInRow;
        const x = centerX + (column - (rowNodeCount - 1) / 2) * NODE_SPACING;
        const contentCenterOffset = (COMMUNITY_PADDING_TOP - COMMUNITY_PADDING_BOTTOM) / 2;
        const y =
          centerY +
          (row - (layout.rows - 1) / 2) * NODE_SPACING +
          contentCenterOffset;
        sim.push({
          ...node,
          x,
          y,
          homeX: x,
          homeY: y,
          vx: 0,
          vy: 0,
          r: 3.5 + 9.5 * Math.sqrt(node.degree / maxD),
        });
      });
    });
    simRef.current = sim;
    communityBoxesRef.current = boxes;
    ticksRef.current = 0;
    cameraTouchedRef.current = false;
    const fitFrame = requestAnimationFrame(() => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const camera = fitCameraToNodes(simRef.current, wrap.clientWidth, wrap.clientHeight);
      if (camera) camRef.current = camera;
      invalidateRef.current();
    });
    return () => cancelAnimationFrame(fitFrame);
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const targetNodes = simRef.current.filter(
        (node) =>
          !hidden.has(node.communityId) &&
          (!routeFocusActive || activeRouteNodeIds.has(node.id))
      );
      const camera = fitCameraToNodes(targetNodes, wrap.clientWidth, wrap.clientHeight);
      if (camera) camRef.current = camera;
      cameraTouchedRef.current = routeFocusActive;
      invalidateRef.current();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeRouteNodeIds, hidden, layoutKey, routeFocusActive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sim = simRef.current;
    const byId = new Map(sim.map((node) => [node.id, node]));
    const communityById = new Map(graph.communities.map((community) => [community.id, community]));
    const communityColors = new Map(graph.communities.map((community) => [community.id, communityColor(community.id)]));
    const edges = edgeShapes.flatMap(({ edge, bend }) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) return [];
      return [{ edge, curve: makeRenderCurve(source, target, bend) }];
    });
    const edgesByRelation = new Map<string, typeof edges>();
    const edgeByReference = new Map(edges.map((item) => [item.edge, item]));
    for (const item of edges) {
      const group = edgesByRelation.get(item.edge.relation);
      if (group) group.push(item);
      else edgesByRelation.set(item.edge.relation, [item]);
    }
    const routeCurves: RenderCurve[] = [];
    const mappedSteps = activeRoute?.steps.filter(
      (step) => step.nodeId && activeRouteNodeIds.has(step.nodeId)
    ) || [];
    for (let index = 1; index < mappedSteps.length; index++) {
      const source = byId.get(mappedSteps[index - 1].nodeId!);
      const target = byId.get(mappedSteps[index].nodeId!);
      if (source && target && source.id !== target.id) {
        routeCurves.push(makeRenderCurve(source, target, edgeBend(source.id, target.id), 4, 7));
      }
    }
    const viewNodes = sim.filter((node) => !hidden.has(node.communityId));
    const fitNodes = routeFocusActive
      ? viewNodes.filter((node) => activeRouteNodeIds.has(node.id))
      : viewNodes;
    const textWidths = new Map<string, number>();
    const textWidth = (text: string) => {
      const key = `${ctx.font}:${text}`;
      let width = textWidths.get(key);
      if (width === undefined) {
        width = ctx.measureText(text).width;
        textWidths.set(key, width);
      }
      return width;
    };
    let w = wrap.clientWidth;
    let h = wrap.clientHeight;

    const step = () => {
      // A CSS-hidden pane is still mounted. Do not simulate or paint it.
      if (document.hidden || w <= 0 || h <= 0) return false;
      const tickCap = sim.length > 220 ? 180 : 420;
      const alpha = Math.max(0.015, 0.12 * Math.pow(0.985, ticksRef.current));
      let layoutUpdated = false;
      if (ticksRef.current < tickCap && viewNodes.length) {
        const range = sim.length > 220 ? 120 : 180;
        const cellSize = range;
        const buckets = new Map<string, number[]>();
        for (let i = 0; i < sim.length; i++) {
          const cellX = Math.floor(sim[i].x / cellSize);
          const cellY = Math.floor(sim[i].y / cellSize);
          const key = `${cellX},${cellY}`;
          const bucket = buckets.get(key);
          if (bucket) bucket.push(i);
          else buckets.set(key, [i]);
        }
        for (let i = 0; i < sim.length; i++) {
          const cellX = Math.floor(sim[i].x / cellSize);
          const cellY = Math.floor(sim[i].y / cellSize);
          const nearby: number[] = [];
          for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              const bucket = buckets.get(`${cellX + ox},${cellY + oy}`);
              if (bucket) nearby.push(...bucket);
            }
          }
          for (const j of nearby) {
            if (j <= i) continue;
            const a = sim[i];
            const b = sim[j];
            if (Math.abs(a.x - b.x) > range || Math.abs(a.y - b.y) > range) continue;
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 0.01) {
              dx = Math.random() - 0.5;
              dy = Math.random() - 0.5;
              d2 = dx * dx + dy * dy;
            }
            const dist = Math.sqrt(d2);
            const minDistance = a.r + b.r + 18;
            const collisionPush =
              dist < minDistance ? (minDistance - dist) * 0.08 : 0;
            const f = Math.max(collisionPush, Math.min(1.8, (alpha * 1400) / d2));
            const fx = (dx / dist) * f;
            const fy = (dy / dist) * f;
            a.vx += fx;
            a.vy += fy;
            b.vx -= fx;
            b.vy -= fy;
          }
        }

        for (const { edge: e, curve: { source: a, target: b } } of edges) {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const sameCommunity = a.communityId === b.communityId;
          const rest = sameCommunity
            ? e.relation === 'calls'
              ? 82
              : 108
            : 180;
          const f = alpha * (sameCommunity ? 0.04 : 0.006) * (dist - rest);
          const fx = (dx / dist) * f;
          const fy = (dy / dist) * f;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }

        for (const n of sim) {
          n.vx += (n.homeX - n.x) * 0.018;
          n.vy += (n.homeY - n.y) * 0.018;
          n.vx *= 0.72;
          n.vy *= 0.72;
          const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
          if (speed > 8) {
            n.vx = (n.vx / speed) * 8;
            n.vy = (n.vy / speed) * 8;
          }
          n.x += n.vx;
          n.y += n.vy;
        }
        ticksRef.current++;
        layoutUpdated = true;
      }

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        if (!cameraTouchedRef.current) {
          const camera = fitCameraToNodes(fitNodes, w, h);
          if (camera) camRef.current = camera;
        }
      } else if (
        !cameraTouchedRef.current &&
        layoutUpdated &&
        ticksRef.current > 0 &&
        (ticksRef.current % 12 === 0 || ticksRef.current === tickCap)
      ) {
        const camera = fitCameraToNodes(fitNodes, w, h);
        if (camera) camRef.current = camera;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#12131A';
      ctx.fillRect(0, 0, w, h);

      const cam = camRef.current;
      const originX = cam.x * cam.k + w / 2;
      const originY = cam.y * cam.k + h / 2;
      ctx.translate(originX, originY);
      const toScreen = (x: number, y: number) => ({
        x: x * cam.k,
        y: y * cam.k,
      });
      const inViewport = (left: number, top: number, right: number, bottom: number) =>
        right + originX >= 0 && bottom + originY >= 0 && left + originX <= w && top + originY <= h;

      const hiddenComms = hidden;
      const selected = selectedNodeId;
      const focusedNodeId = hoverRef.current || selected;
      const focusedNeighbors = new Set<string>();
      if (focusedNodeId) {
        focusedNeighbors.add(focusedNodeId);
        for (const edge of connections.outgoing.get(focusedNodeId) || []) focusedNeighbors.add(edge.target);
        for (const edge of connections.incoming.get(focusedNodeId) || []) focusedNeighbors.add(edge.source);
      }
      const appendArrowHead = (
        point: ScreenPoint,
        angle: number,
        size: number
      ) => {
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(
          point.x - size * Math.cos(angle - Math.PI / 6),
          point.y - size * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          point.x - size * Math.cos(angle + Math.PI / 6),
          point.y - size * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
      };
      const drawArrowHead = (point: ScreenPoint, angle: number, size: number, color: string) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        appendArrowHead(point, angle, size);
        ctx.fill();
      };

      for (const box of communityBoxesRef.current) {
        if (hiddenComms.has(box.id)) continue;
        const topLeft = toScreen(box.x - box.width / 2, box.y - box.height / 2);
        const width = box.width * cam.k;
        const height = box.height * cam.k;
        if (!inViewport(topLeft.x - 2, topLeft.y - 2, topLeft.x + width + 2, topLeft.y + height + 2)) continue;
        const dimmed = Boolean(
          (selectedCommunityId && selectedCommunityId !== box.id) ||
          (routeFocusActive && !activeRouteCommunityIds.has(box.id))
        );
        const color = communityColors.get(box.id) || communityColor(box.id);
        ctx.globalAlpha = dimmed ? 0.032 : 0.065;
        ctx.fillStyle = color;
        ctx.fillRect(topLeft.x, topLeft.y, width, height);
        ctx.globalAlpha = dimmed ? 0.2 : 0.4;
        ctx.strokeStyle = color;
        ctx.lineWidth = selectedCommunityId === box.id ||
          (routeFocusActive && activeRouteCommunityIds.has(box.id)) ? 2 : 1;
        ctx.strokeRect(topLeft.x, topLeft.y, width, height);
        const community = communityById.get(box.id);
        ctx.globalAlpha = dimmed ? 0.58 : 0.95;
        ctx.fillStyle = color;
        ctx.font = '600 11px ui-sans-serif, system-ui';
        ctx.fillText(
          `${community?.label || `社区 ${box.id}`} · ${visibleCommunityCounts.get(box.id) || 0}`,
          topLeft.x + 10,
          topLeft.y + 18
        );
        ctx.globalAlpha = 1;
      }

      // Thousands of separate strokes/dash state changes stall canvas rendering.
      // Batch background edges by relation, then paint focused connections on top.
      for (const [relation, group] of edgesByRelation) {
        const color = EDGE_COLOR[relation] || EDGE_COLOR.references;
        const arrows: CurvedEdgeGeometry[] = [];
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash(EDGE_DASH[relation] || EDGE_DASH.calls);
        ctx.globalAlpha = routeFocusActive ? 0.13 : focusedNodeId ? 0.08 : 1;
        ctx.beginPath();
        for (const { curve } of group) {
          const { source: a, target: b } = curve;
          if (a.id === focusedNodeId || b.id === focusedNodeId) continue;
          if (hiddenComms.has(a.communityId) || hiddenComms.has(b.communityId)) continue;
          const ax = a.x * cam.k;
          const ay = a.y * cam.k;
          const bx = b.x * cam.k;
          const by = b.y * cam.k;
          if (!inViewport(Math.min(ax, bx) - 96, Math.min(ay, by) - 96,
            Math.max(ax, bx) + 96, Math.max(ay, by) + 96)) continue;
          const geometry = cachedCurveGeometry(curve, cam.k, ticksRef.current);
          if (!geometry) continue;
          ctx.moveTo(geometry.start.x, geometry.start.y);
          ctx.quadraticCurveTo(geometry.control.x, geometry.control.y, geometry.end.x, geometry.end.y);
          if (density === 'simple' || cam.k >= 0.85) arrows.push(geometry);
        }
        ctx.stroke();
        ctx.setLineDash(EDGE_DASH.calls);
        if (arrows.length) {
          ctx.fillStyle = color;
          ctx.beginPath();
          for (const geometry of arrows) appendArrowHead(geometry.end, geometry.endAngle, 5.5);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      const focusedEdges = focusedNodeId ? [
        ...(connections.outgoing.get(focusedNodeId) || []),
        ...(connections.incoming.get(focusedNodeId) || []),
      ] : [];
      for (const e of focusedEdges) {
        const item = edgeByReference.get(e);
        if (!item) continue;
        const { curve } = item;
        const { source: a, target: b } = curve;
        if (hiddenComms.has(a.communityId) || hiddenComms.has(b.communityId)) continue;
        const pa = toScreen(a.x, a.y);
        const pb = toScreen(b.x, b.y);
        const outgoing = Boolean(focusedNodeId && e.source === focusedNodeId);
        // Quadratic control points bend at most 64px. Include arrows and focus labels.
        const margin = Math.max(a.label.length, b.label.length) * 12 + 96;
        if (!inViewport(Math.min(pa.x, pb.x) - margin, Math.min(pa.y, pb.y) - margin,
          Math.max(pa.x, pb.x) + margin, Math.max(pa.y, pb.y) + margin)) continue;
        const geometry = cachedCurveGeometry(curve, cam.k, ticksRef.current);
        if (!geometry) continue;
        const edgeColor = outgoing
          ? 'rgba(52,211,153,1)'
          : 'rgba(56,189,248,1)';
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = 2.4;
        ctx.setLineDash(EDGE_DASH[e.relation] || EDGE_DASH.calls);
        ctx.globalAlpha = routeFocusActive ? 0.9 : 1;
        ctx.beginPath();
        ctx.moveTo(geometry.start.x, geometry.start.y);
        ctx.quadraticCurveTo(
          geometry.control.x,
          geometry.control.y,
          geometry.end.x,
          geometry.end.y
        );
        ctx.stroke();
        ctx.setLineDash([]);

        drawArrowHead(geometry.end, geometry.endAngle, 8, edgeColor);

        const relation = EDGE_LABEL[e.relation] || e.relation;
        const edgeLabel = outgoing
          ? `出 · ${relation} · ${b.label}`
          : `入 · ${a.label} · ${relation}`;
        ctx.globalAlpha = 1;
        ctx.font = '700 10px ui-sans-serif, system-ui';
        const labelWidth = textWidth(edgeLabel);
        const screenDistance = Math.sqrt(
          (pb.x - pa.x) * (pb.x - pa.x) + (pb.y - pa.y) * (pb.y - pa.y)
        );
        if (screenDistance > labelWidth + 42) {
          const labelX = geometry.midpoint.x - labelWidth / 2;
          const labelY = geometry.midpoint.y - 6;
          ctx.fillStyle = 'rgba(3,7,18,0.9)';
          ctx.fillRect(labelX - 4, labelY - 10, labelWidth + 8, 16);
          ctx.fillStyle = outgoing ? '#a7f3d0' : '#bae6fd';
          ctx.fillText(edgeLabel, labelX, labelY + 2);
        }
        ctx.globalAlpha = 1;
      }

      if (routeFocusActive && activeRoute) {
        for (const curve of routeCurves) {
          const { source: previous, target: current } = curve;
          if (hiddenComms.has(previous.communityId) || hiddenComms.has(current.communityId)) continue;
          const from = toScreen(previous.x, previous.y);
          const to = toScreen(current.x, current.y);
          if (!inViewport(Math.min(from.x, to.x) - 96, Math.min(from.y, to.y) - 96,
            Math.max(from.x, to.x) + 96, Math.max(from.y, to.y) + 96)) continue;
          const geometry = cachedCurveGeometry(curve, cam.k, ticksRef.current);
          if (!geometry) continue;
          ctx.strokeStyle = 'rgba(3,7,18,0.9)';
          ctx.lineWidth = 7;
          ctx.beginPath();
          ctx.moveTo(geometry.start.x, geometry.start.y);
          ctx.quadraticCurveTo(
            geometry.control.x,
            geometry.control.y,
            geometry.end.x,
            geometry.end.y
          );
          ctx.stroke();

          ctx.strokeStyle = 'rgba(52,211,153,1)';
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.moveTo(geometry.start.x, geometry.start.y);
          ctx.quadraticCurveTo(
            geometry.control.x,
            geometry.control.y,
            geometry.end.x,
            geometry.end.y
          );
          ctx.stroke();
          drawArrowHead(geometry.end, geometry.endAngle, 9, 'rgba(52,211,153,1)');
        }
      }

      const showLabels = cam.k > 1.35;
      for (const n of sim) {
        if (hiddenComms.has(n.communityId)) continue;
        const p = toScreen(n.x, n.y);
        const r = n.r * Math.sqrt(cam.k);
        const isSel = n.id === selected;
        const isNb = focusedNeighbors.has(n.id);
        const isHover = n.id === hoverRef.current;
        const isBusinessCore = businessCoreNodeIds.has(n.id);
        const isActiveRoute = activeRouteNodeIds.has(n.id);
        const commSel = selectedCommunityId && n.communityId === selectedCommunityId;
        const inFocusedNeighborhood = Boolean(focusedNodeId && isNb);
        const dim = Boolean(
          (focusedNodeId && !isNb) ||
          (selectedCommunityId && !commSel && !inFocusedNeighborhood) ||
          (routeFocusActive && !isActiveRoute && !inFocusedNeighborhood)
        );
        const hitSearch = searchHit?.has(n.id);
        const label =
          isSel || isHover || hitSearch || isActiveRoute ||
          (focusedNodeId && isNb) ||
          (!routeFocusActive && isBusinessCore) || n.degree >= maxDegree * 0.42 || (showLabels && r > 5);
        const labelSize = isSel || isHover || (isActiveRoute && routeFocusActive) ? 12 : 10;
        ctx.font = `${isActiveRoute && routeFocusActive ? '700 ' : ''}${labelSize}px ui-sans-serif, system-ui`;
        const labelWidth = label ? textWidth(n.label) : 0;
        // Keep offscreen-node labels/badges when their pixels still enter the viewport.
        const badgeMargin = routeFocusActive ? 24 + (activeRouteStepNumbers.get(n.id)?.join('·').length || 0) * 10 : 8;
        if (!inViewport(p.x - r - badgeMargin, p.y - r - 32,
          p.x + r + 8 + labelWidth, p.y + r + 16)) continue;
        ctx.globalAlpha = dim && !hitSearch ? (routeFocusActive ? 0.34 : 0.22) : 1;
        if (isActiveRoute && routeFocusActive) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(52,211,153,0.24)';
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = communityColors.get(n.communityId) || communityColor(n.communityId);
        ctx.fill();
        if (n.degree >= maxDegree * 0.55) {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        if (isSel || isHover || hitSearch || isActiveRoute || (!routeFocusActive && isBusinessCore)) {
          ctx.strokeStyle = isActiveRoute && !isSel && !isHover && !hitSearch ? '#34d399' : '#fbbf24';
          ctx.lineWidth = isActiveRoute && routeFocusActive ? 3 : 2;
          ctx.stroke();
        }
        if (label) {
          const labelX = p.x + r + 5;
          const labelY = p.y + 4;
          ctx.globalAlpha = dim && !hitSearch ? (routeFocusActive ? 0.48 : 0.35) : 1;
          if (isActiveRoute && routeFocusActive) {
            ctx.fillStyle = 'rgba(3,7,18,0.88)';
            ctx.fillRect(labelX - 3, labelY - labelSize - 2, labelWidth + 7, labelSize + 6);
            ctx.fillStyle = '#ecfdf5';
          } else {
            ctx.fillStyle = '#e2e8f0';
          }
          ctx.fillText(n.label, labelX, labelY);
        }
        const stepNumbers = activeRouteStepNumbers.get(n.id);
        if (stepNumbers && routeFocusActive) {
          const stepText = stepNumbers.join('·');
          ctx.font = '800 10px ui-sans-serif, system-ui';
          const badgeWidth = Math.max(18, textWidth(stepText) + 10);
          const badgeHeight = 18;
          const badgeX = p.x - r - badgeWidth * 0.7;
          const badgeY = p.y - r - badgeHeight * 0.75;
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#34d399';
          ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
          ctx.strokeStyle = '#d1fae5';
          ctx.lineWidth = 1;
          ctx.strokeRect(badgeX, badgeY, badgeWidth, badgeHeight);
          ctx.fillStyle = '#052e2b';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(stepText, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2 + 0.5);
          ctx.textAlign = 'start';
          ctx.textBaseline = 'alphabetic';
        }
        ctx.globalAlpha = 1;
      }

      return ticksRef.current < tickCap && viewNodes.length > 0;
    };

    const scheduler = createGraphFrameScheduler(step);
    invalidateRef.current = scheduler.invalidate;
    const resize = () => {
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      if (w <= 0 || h <= 0 || document.hidden) scheduler.pause();
      else scheduler.invalidate();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    document.addEventListener('visibilitychange', resize);
    window.addEventListener('resize', resize); // Includes display/DPR changes.
    scheduler.invalidate();
    return () => {
      scheduler.dispose();
      observer.disconnect();
      document.removeEventListener('visibilitychange', resize);
      window.removeEventListener('resize', resize);
      invalidateRef.current = () => {};
    };
  }, [
    activeRoute,
    activeRouteId,
    activeRouteCommunityIds,
    activeRouteStepNumbers,
    graph.businessRoutes,
    graph.communities,
    density,
    hidden,
    maxDegree,
    activeRouteNodeIds,
    routeFocusActive,
    businessCoreNodeIds,
    searchHit,
    selectedCommunityId,
    selectedNodeId,
    visibleEdges,
    visibleCommunityCounts,
    layoutKey,
    connections,
    edgeShapes,
  ]);

  const hitTest = (sx: number, sy: number): SimNode | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const cam = camRef.current;
    const wx = (sx - w / 2) / cam.k - cam.x;
    const wy = (sy - h / 2) / cam.k - cam.y;
    let best: SimNode | null = null;
    let bestDistanceSquared = Infinity;
    for (const n of simRef.current) {
      if (hidden.has(n.communityId)) continue;
      const dx = n.x - wx;
      const dy = n.y - wy;
      const distanceSquared = dx * dx + dy * dy;
      const hitRadius = n.r + 4 / cam.k;
      if (distanceSquared < hitRadius * hitRadius && distanceSquared < bestDistanceSquared) {
        best = n;
        bestDistanceSquared = distanceSquared;
      }
    }
    return best;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    cameraTouchedRef.current = true;
    const cam = camRef.current;
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    cam.k = Math.min(4, Math.max(MIN_ZOOM, cam.k * factor));
    invalidateRef.current();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (e.button === 0) {
      const node = hitTest(x, y);
      if (node) {
        onSelectNode(node.id);
        onSelectCommunity(node.communityId);
      } else {
        onSelectNode(null);
      }
    }
    dragRef.current = { lx: x, ly: y };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const drag = dragRef.current;
    if (drag) {
      cameraTouchedRef.current = true;
      const cam = camRef.current;
      cam.x += (x - drag.lx) / cam.k;
      cam.y += (y - drag.ly) / cam.k;
      drag.lx = x;
      drag.ly = y;
      invalidateRef.current();
      return;
    }
    const node = hitTest(x, y);
    const id = node?.id || null;
    if (id !== hoverRef.current) {
      hoverRef.current = id;
      setHover(id);
      invalidateRef.current();
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onPointerLeave = () => {
    if (dragRef.current) return;
    hoverRef.current = null;
    setHover(null);
    invalidateRef.current();
  };

  const focusedDetailsNodeId = hover || selectedNodeId;
  const focusedDetailsNode = focusedDetailsNodeId
    ? graphNodesById.get(focusedDetailsNodeId) || null
    : null;
  const outgoingConnections = focusedDetailsNodeId
    ? (connections.outgoing.get(focusedDetailsNodeId) || [])
      .map((edge) => ({
        edge,
        node: graphNodesById.get(edge.target),
      }))
    : [];
  const incomingConnections = focusedDetailsNodeId
    ? (connections.incoming.get(focusedDetailsNodeId) || [])
      .map((edge) => ({
        edge,
        node: graphNodesById.get(edge.source),
      }))
    : [];

  const fitToView = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const visible = simRef.current.filter((node) => !hidden.has(node.communityId));
    const camera = fitCameraToNodes(visible, wrap.clientWidth, wrap.clientHeight);
    if (camera) camRef.current = camera;
    cameraTouchedRef.current = false;
    invalidateRef.current();
  };

  return (
    <div className="relative w-full h-full min-h-0 bg-[#12131A]" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onAuxClick={(e) => e.preventDefault()}
      />
      <div className="absolute top-2 left-2 right-2 flex flex-wrap items-center gap-1.5 pointer-events-none">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索节点"
          className="pointer-events-auto w-36 bg-black/50 border border-white/10 rounded-md px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-500"
        />
        <button
          type="button"
          onClick={fitToView}
          className="pointer-events-auto text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-black/50 text-slate-300 hover:text-white hover:border-white/30"
        >
          适应视图
        </button>
        <div className="pointer-events-auto flex items-center rounded-md border border-white/10 bg-black/50 p-0.5">
          <button
            type="button"
            title="只显示主要跨类调用活动"
            aria-pressed={density === 'simple'}
            onClick={() => setDensity('simple')}
            className={`rounded px-2 py-0.5 text-[10px] ${
              density === 'simple'
                ? 'bg-amber-500/20 text-amber-100'
                : 'text-slate-500 hover:text-slate-200'
            }`}
          >
            简化
          </button>
          <button
            type="button"
            title="显示有行为的辅助类以及继承、引用、导入关系"
            aria-pressed={density === 'rich'}
            onClick={() => setDensity('rich')}
            className={`rounded px-2 py-0.5 text-[10px] ${
              density === 'rich'
                ? 'bg-amber-500/20 text-amber-100'
                : 'text-slate-500 hover:text-slate-200'
            }`}
          >
            丰富
          </button>
        </div>
        {graph.businessRoutes.length > 0 && (
          <select
            aria-label="聚焦业务路线"
            value={activeRouteId}
            onChange={(event) => {
              const nextRouteId = event.target.value;
              setActiveRouteId(nextRouteId);
              const nextRoute = graph.businessRoutes.find((route) => route.id === nextRouteId);
              if (nextRoute) {
                const nextNodeIds = new Set(
                  nextRoute.steps
                    .map((step) => step.nodeId)
                    .filter((nodeId): nodeId is string => Boolean(nodeId && graphNodeIds.has(nodeId)))
                );
                const nextCommunityIds = new Set(
                  graph.nodes
                    .filter((node) => nextNodeIds.has(node.id))
                    .map((node) => node.communityId)
                );
                setHidden((previous) => new Set(
                  [...previous].filter((communityId) => !nextCommunityIds.has(communityId))
                ));
              }
              onSelectNode(null);
              onSelectCommunity(null);
            }}
            title={activeRoute?.summary || '选择一条 AI 核实的业务路线并聚焦其类级节点'}
            className={`pointer-events-auto max-w-52 rounded-md border bg-black/50 px-2 py-1 text-[10px] ${
              routeFocusActive
                ? 'border-emerald-400/50 text-emerald-200'
                : 'border-white/10 text-slate-300'
            }`}
          >
            <option value="">社区总览（不聚焦路线）</option>
            {graph.businessRoutes.map((route) => {
              const mappedSteps = routeMappedStepCounts.get(route.id) || 0;
              return (
                <option key={route.id} value={route.id} disabled={mappedSteps === 0}>
                  {route.label} · {mappedSteps}/{route.steps.length} 步
                  {mappedSteps === 0 ? '（无法映射）' : ''}
                </option>
              );
            })}
          </select>
        )}
        {graph.communities.map((c) => {
          const on = !hidden.has(c.id);
          const active = selectedCommunityId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={(ev) => {
                if (ev.shiftKey) {
                  setHidden((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  });
                  return;
                }
                onSelectCommunity(selectedCommunityId === c.id ? null : c.id);
              }}
              className={`pointer-events-auto text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                active ? 'text-white border-white/40' : 'text-slate-300 border-white/10'
              } ${on ? 'bg-black/50' : 'bg-black/20 opacity-40'}`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: communityColor(c.id) }}
              />
              {c.label}
              <span className="text-slate-500">
                {density === 'simple'
                  ? `${visibleCommunityCounts.get(c.id) || 0}/${c.nodeCount}`
                  : c.nodeCount}
              </span>
            </button>
          );
        })}
      </div>
      <div className="absolute bottom-2 left-2 text-[10px] text-slate-500 pointer-events-none">
        {density === 'simple'
          ? `简化（${businessCoreNodeIds.size ? 'AI 业务核心' : '候选调用骨架'}）· ${visibleNodes.length}/${graph.nodes.length} 类级节点 · ${visibleEdges.length}/${graph.edges.length} 边`
          : `丰富 · ${graph.nodes.length} 类级节点 · ${graph.edges.length} 边`}
        {graph.stats.truncated ? ' · 已裁大图' : ''}
        {routeFocusActive && activeRoute
          ? ` · 路线聚焦 ${activeRoute.label} · ${routeMappedStepCounts.get(activeRoute.id) || 0}/${activeRoute.steps.length} 步已映射`
          : ' · 社区总览'}
        <span className="ml-2 text-slate-600">滚轮缩放 · 中键拖动画布 · 悬停看方向 · 左键固定节点</span>
      </div>
      {focusedDetailsNode && (
        <div className="absolute bottom-2 right-2 max-w-[320px] bg-black/80 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-slate-200 pointer-events-none">
          <div className="font-semibold text-slate-100">{focusedDetailsNode.label}</div>
          <div className="text-slate-400">
            {focusedDetailsNode.kind} · 度 {focusedDetailsNode.degree}
            {focusedDetailsNode.file ? ` · ${focusedDetailsNode.file}` : ''}
          </div>
          <div className="mt-1 flex gap-3 text-[10px]">
            <span className="text-emerald-300">绿色出边 {outgoingConnections.length}</span>
            <span className="text-sky-300">蓝色入边 {incomingConnections.length}</span>
          </div>
          {outgoingConnections.slice(0, 5).map(({ edge, node }) => (
            <div key={`out:${edge.source}:${edge.target}:${edge.relation}`} className="truncate text-[10px] text-emerald-100/80">
              → {EDGE_LABEL[edge.relation] || edge.relation} · {node?.label || edge.target}
            </div>
          ))}
          {incomingConnections.slice(0, 5).map(({ edge, node }) => (
            <div key={`in:${edge.source}:${edge.target}:${edge.relation}`} className="truncate text-[10px] text-sky-100/80">
              ← {EDGE_LABEL[edge.relation] || edge.relation} · {node?.label || edge.source}
            </div>
          ))}
          {outgoingConnections.length + incomingConnections.length > 10 && (
            <div className="text-[10px] text-slate-500">其余连接继续沿高亮曲线查看</div>
          )}
        </div>
      )}
    </div>
  );
});
