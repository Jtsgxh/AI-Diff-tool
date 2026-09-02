import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LearnEdge, LearnGraph, LearnNode } from '../../types';
import { communityColor } from '../../utils/learnGraph';
import { createGraphFrameScheduler } from '../../utils/graphFrameScheduler';
import { placeLearnGraphLabels, type LearnGraphLabel, type GraphLabelRect } from '../../utils/learnGraphLabels';
import {
  createLearnCommunityLayout,
  type LearnCommunityLayout,
  type LearnCommunityBox,
  type LearnLayoutNode,
} from '../../utils/learnCommunityLayout';

interface LearnGraphCanvasProps {
  graph: LearnGraph;
  selectedNodeId: string | null;
  selectedCommunityId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectCommunity: (id: string | null) => void;
  hideTestNodes: boolean;
  testNodeCount: number;
  onHideTestNodesChange: (hide: boolean) => void;
}

interface Camera {
  x: number;
  y: number;
  k: number;
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
  source: LearnLayoutNode;
  target: LearnLayoutNode;
  bend: EdgeBend;
  sourcePadding: number;
  targetPadding: number;
  zoom: number;
  geometry: CurvedEdgeGeometry | null;
}

type GraphDensity = 'simple' | 'rich';
interface CachedLayout {
  key: string;
  layout: LearnCommunityLayout;
  worker: Worker | null;
  error: string | null;
}

const MIN_ZOOM = 0.01;
const DRAG_THRESHOLD = 4;
const fitCameraToNodes = (
  nodes: LearnLayoutNode[],
  width: number,
  height: number,
  controlsHeight: number
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
  const topPadding = Math.max(padding, controlsHeight + 24);
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const zoom = Math.min(
    1,
    Math.max(
      MIN_ZOOM,
      Math.min(
        Math.max(1, width - padding * 2) / graphWidth,
        Math.max(1, height - topPadding - padding) / graphHeight
      )
    )
  );
  return {
    x: -(minX + maxX) / 2,
    y: -(minY + maxY) / 2 + (topPadding - padding) / (2 * zoom),
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
  source: LearnLayoutNode, target: LearnLayoutNode, bend: EdgeBend, sourcePadding = 2, targetPadding = 5
): RenderCurve => ({
  source, target, bend, sourcePadding, targetPadding, zoom: NaN, geometry: null,
});

// Geometry is independent of camera translation. Panning reuses curves and arrows.
const cachedCurveGeometry = (curve: RenderCurve, zoom: number) => {
  if (curve.zoom !== zoom) {
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
  }
  return curve.geometry;
};

export const LearnGraphCanvas = React.memo(function LearnGraphCanvas({
  graph,
  selectedNodeId,
  selectedCommunityId,
  onSelectNode,
  onSelectCommunity,
  hideTestNodes,
  testNodeCount,
  onHideTestNodesChange,
}: LearnGraphCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const layoutNodesRef = useRef<LearnLayoutNode[]>([]);
  const communityBoxesRef = useRef<LearnCommunityBox[]>([]);
  const camRef = useRef({ x: 0, y: 0, k: 1 });
  const cameraTouchedRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    button: number;
    startX: number;
    startY: number;
    lx: number;
    ly: number;
    moved: boolean;
    node: LearnLayoutNode | null;
  } | null>(null);
  const hoverRef = useRef<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<GraphDensity>('simple');
  const [activeRouteId, setActiveRouteId] = useState('');
  const routeSetRef = useRef('');
  const invalidateRef = useRef<() => void>(() => {});
  const wheelTimerRef = useRef<number | null>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const activeLayoutRef = useRef<CachedLayout | null>(null);

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

  const simplifiedNodes = useMemo(
    () => graph.nodes.filter((node) => simplifiedNodeIds.has(node.id)),
    [graph.nodes, simplifiedNodeIds]
  );
  const visibleNodes = density === 'rich' ? graph.nodes : simplifiedNodes;
  const visibleCommunityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of visibleNodes) {
      counts.set(node.communityId, (counts.get(node.communityId) || 0) + 1);
    }
    return counts;
  }, [visibleNodes]);
  const simplifiedVisibleNodeIds = useMemo(
    () => new Set(simplifiedNodes.map((node) => node.id)),
    [simplifiedNodes]
  );
  const simplifiedEdges = useMemo(
    () => {
      const nodesById = new Map(simplifiedNodes.map((node) => [node.id, node]));
      const candidates = graph.edges
        .filter(
          (edge) =>
            edge.relation === 'calls' &&
            simplifiedVisibleNodeIds.has(edge.source) &&
            simplifiedVisibleNodeIds.has(edge.target)
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
      if (candidates.length <= simplifiedNodes.length * 2) return candidates;

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
      for (const node of simplifiedNodes) {
        if ((incidence.get(node.id) || 0) > 0) continue;
        const edge = firstIncidentEdge.get(node.id);
        if (edge) add(edge);
      }
      return kept;
    },
    [graph.edges, simplifiedVisibleNodeIds, simplifiedNodes]
  );
  const visibleEdges = density === 'rich' ? graph.edges : simplifiedEdges;

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

  const edgeBends = useMemo(
    () => new WeakMap<LearnEdge, EdgeBend>(),
    [graph.edges]
  );
  const edgeShapes = useMemo(
    () => visibleEdges.map((edge) => {
      let bend = edgeBends.get(edge);
      if (!bend) {
        bend = edgeBend(edge.source, edge.target);
        edgeBends.set(edge, bend);
      }
      return { edge, bend };
    }),
    [edgeBends, visibleEdges]
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

  // Keep only the two display layouts for this source graph. AI prose/labels do
  // not invalidate positions; new source data or a changed community order does.
  const communityOrderKey = useMemo(
    () => JSON.stringify(graph.communities.map((community) => community.id)),
    [graph.communities]
  );
  const layoutCache = useMemo(
    () => new Map<GraphDensity, CachedLayout>(),
    [graph.nodes, graph.edges, graph.stats.sourceFingerprint, communityOrderKey]
  );

  useEffect(() => () => {
    for (const entry of layoutCache.values()) {
      entry.worker?.terminate();
      entry.worker = null;
    }
    layoutCache.clear();
    activeLayoutRef.current = null;
  }, [layoutCache]);

  useEffect(() => {
    let cached = layoutCache.get(density);
    if (!cached || cached.key !== layoutKey) {
      cached?.worker?.terminate();
      const wrap = wrapRef.current;
      cached = {
        key: layoutKey,
        layout: createLearnCommunityLayout(
          visibleNodes, visibleEdges, JSON.parse(communityOrderKey),
          wrap?.clientWidth || 0, wrap?.clientHeight || 0
        ),
        worker: null,
        error: null,
      };
      layoutCache.set(density, cached);
      const entry = cached;
      try {
        const worker = new Worker(new URL('../../workers/learnGraphLayout.worker.ts', import.meta.url), { type: 'module' });
        entry.worker = worker;
        worker.onmessage = ({ data }: MessageEvent<LearnCommunityLayout>) => {
          if (layoutCache.get(density) !== entry || entry.worker !== worker) return;
          const active = activeLayoutRef.current === entry;
          entry.layout = data;
          entry.worker = null;
          worker.terminate();
          if (active) setLayoutRevision((revision) => revision + 1);
        };
        worker.onerror = (event) => {
          if (layoutCache.get(density) !== entry || entry.worker !== worker) return;
          entry.error = event.message || '社区布局计算失败';
          entry.worker = null;
          worker.terminate();
          if (activeLayoutRef.current === entry) setLayoutRevision((revision) => revision + 1);
        };
        worker.postMessage({ layout: entry.layout, edges: visibleEdges });
      } catch (error) {
        entry.worker?.terminate();
        entry.worker = null;
        entry.error = error instanceof Error ? error.message : String(error);
        setLayoutRevision((revision) => revision + 1);
      }
    }
    const changedView = activeLayoutRef.current !== cached;
    activeLayoutRef.current = cached;
    layoutNodesRef.current = cached.layout.nodes;
    communityBoxesRef.current = cached.layout.boxes;
    if (changedView) {
      cameraTouchedRef.current = false;
    } else if (!cameraTouchedRef.current && wrapRef.current) {
      // A completed background calculation must not undo a pan/zoom performed
      // while it was running. Untouched views can still fit the settled positions.
      const targets = cached.layout.nodes.filter((node) => !hidden.has(node.communityId) &&
        (!routeFocusActive || activeRouteNodeIds.has(node.id)));
      const camera = fitCameraToNodes(targets, wrapRef.current.clientWidth, wrapRef.current.clientHeight, controlsRef.current?.offsetHeight || 0);
      if (camera) camRef.current = camera;
    }
  }, [density, layoutCache, layoutKey, communityOrderKey, layoutRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const targetNodes = layoutNodesRef.current.filter(
        (node) =>
          !hidden.has(node.communityId) &&
          (!routeFocusActive || activeRouteNodeIds.has(node.id))
      );
      const camera = fitCameraToNodes(targetNodes, wrap.clientWidth, wrap.clientHeight, controlsRef.current?.offsetHeight || 0);
      if (camera) camRef.current = camera;
      cameraTouchedRef.current = routeFocusActive;
      invalidateRef.current();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeRouteNodeIds, hidden, layoutKey, layoutCache, density, routeFocusActive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Only the background relationship network is cached. Nodes, focus arrows,
    // labels and route steps remain live, so pointer interaction keeps its meaning.
    const edgeCanvas = document.createElement('canvas');
    const edgeCtx = edgeCanvas.getContext('2d');
    if (!edgeCtx) throw new Error('无法创建图谱连线画布');
    let edgeRaster: { left: number; top: number; width: number; height: number;
      zoom: number; dpr: number; viewportWidth: number; viewportHeight: number; complete: boolean } | null = null;
    const layoutNodes = layoutNodesRef.current;
    const byId = new Map(layoutNodes.map((node) => [node.id, node]));
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
    const routeSteps = activeRoute?.steps || [];
    for (let index = 1; index < routeSteps.length; index++) {
      const source = byId.get(routeSteps[index - 1].nodeId!);
      const target = byId.get(routeSteps[index].nodeId!);
      if (source && target && source.id !== target.id) {
        routeCurves.push(makeRenderCurve(source, target, edgeBend(source.id, target.id), 4, 7));
      }
    }
    const viewNodes = layoutNodes.filter((node) => !hidden.has(node.communityId));
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
      // A CSS-hidden pane is still mounted. Do not paint it.
      if (document.hidden || w <= 0 || h <= 0) return false;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        if (!cameraTouchedRef.current) {
          const camera = fitCameraToNodes(fitNodes, w, h, controlsRef.current?.offsetHeight || 0);
          if (camera) camRef.current = camera;
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#EFEFEC';
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
      const labels: LearnGraphLabel[] = [];
      const labelObstacles: GraphLabelRect[] = [];
      const selected = selectedNodeId;
      const focusedNodeId = selected || hoverRef.current;
      const focusedNeighbors = new Set<string>();
      if (focusedNodeId) {
        focusedNeighbors.add(focusedNodeId);
        for (const edge of connections.outgoing.get(focusedNodeId) || []) focusedNeighbors.add(edge.target);
        for (const edge of connections.incoming.get(focusedNodeId) || []) focusedNeighbors.add(edge.source);
      }
      const appendArrowHead = (
        target: CanvasRenderingContext2D,
        point: ScreenPoint,
        angle: number,
        size: number
      ) => {
        target.moveTo(point.x, point.y);
        target.lineTo(
          point.x - size * Math.cos(angle - Math.PI / 6),
          point.y - size * Math.sin(angle - Math.PI / 6)
        );
        target.lineTo(
          point.x - size * Math.cos(angle + Math.PI / 6),
          point.y - size * Math.sin(angle + Math.PI / 6)
        );
        target.closePath();
      };
      const drawArrowHead = (point: ScreenPoint, angle: number, size: number, color: string) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        appendArrowHead(ctx, point, angle, size);
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
        const title = `${community?.label || `社区 ${box.id}`} · ${visibleCommunityCounts.get(box.id) || 0}`;
        labels.push({ text: title, font: ctx.font, color, alpha: dimmed ? 0.58 : 0.95,
          priority: 120, width: textWidth(title) + 8, height: 19,
          positions: [{ x: topLeft.x + 7, y: topLeft.y + 4 }] });
        ctx.globalAlpha = 1;
      }

      // Rasterizing thousands of crossing/dashed curves is much slower than the
      // JS callback suggests. Reuse those pixels while panning/hovering. Overscan
      // keeps newly exposed areas covered; crossing its bounds rebuilds the image.
      // During a wheel gesture only the background bitmap scales. Once the wheel
      // settles, regenerate exact curves/arrow sizes at the final zoom.
      const rasterScale = edgeRaster ? cam.k / edgeRaster.zoom : 1;
      if (!edgeRaster || edgeRaster.dpr !== dpr ||
        edgeRaster.viewportWidth !== w || edgeRaster.viewportHeight !== h ||
        (edgeRaster.zoom !== cam.k && wheelTimerRef.current === null) ||
        (!edgeRaster.complete && (edgeRaster.left * rasterScale > -originX ||
        edgeRaster.top * rasterScale > -originY ||
        (edgeRaster.left + edgeRaster.width) * rasterScale < w - originX ||
        (edgeRaster.top + edgeRaster.height) * rasterScale < h - originY))) {
        const paddingX = Math.ceil(w / 4);
        const paddingY = Math.ceil(h / 4);
        const left = Math.floor((-originX - paddingX) * dpr) / dpr;
        const top = Math.floor((-originY - paddingY) * dpr) / dpr;
        const pixelWidth = Math.ceil((w + paddingX * 2) * dpr);
        const pixelHeight = Math.ceil((h + paddingY * 2) * dpr);
        if (edgeCanvas.width !== pixelWidth) edgeCanvas.width = pixelWidth;
        if (edgeCanvas.height !== pixelHeight) edgeCanvas.height = pixelHeight;
        const width = pixelWidth / dpr;
        const height = pixelHeight / dpr;
        let complete = true;
        edgeCtx.setTransform(dpr, 0, 0, dpr, -left * dpr, -top * dpr);
        edgeCtx.clearRect(left, top, width, height);
        for (const [relation, group] of edgesByRelation) {
          const color = EDGE_COLOR[relation] || EDGE_COLOR.references;
          const arrows: CurvedEdgeGeometry[] = [];
          let batchSize = 0;
          edgeCtx.strokeStyle = color;
          edgeCtx.lineWidth = 1;
          edgeCtx.setLineDash(EDGE_DASH[relation] || EDGE_DASH.calls);
          edgeCtx.beginPath();
          for (const { curve } of group) {
            const { source: a, target: b } = curve;
            if (hiddenComms.has(a.communityId) || hiddenComms.has(b.communityId)) continue;
            const ax = a.x * cam.k, ay = a.y * cam.k;
            const bx = b.x * cam.k, by = b.y * cam.k;
            if (Math.min(ax, bx) - 96 < left || Math.min(ay, by) - 96 < top ||
              Math.max(ax, bx) + 96 > left + width || Math.max(ay, by) + 96 > top + height) complete = false;
            if (Math.max(ax, bx) + 96 < left || Math.max(ay, by) + 96 < top ||
              Math.min(ax, bx) - 96 > left + width || Math.min(ay, by) - 96 > top + height) continue;
            const geometry = cachedCurveGeometry(curve, cam.k);
            if (!geometry) continue;
            edgeCtx.moveTo(geometry.start.x, geometry.start.y);
            edgeCtx.quadraticCurveTo(geometry.control.x, geometry.control.y, geometry.end.x, geometry.end.y);
            // Small paths avoid a costly single raster operation for the entire graph.
            if (++batchSize === 64) {
              edgeCtx.stroke();
              edgeCtx.beginPath();
              batchSize = 0;
            }
            if (density === 'simple' || cam.k >= 0.85) arrows.push(geometry);
          }
          if (batchSize) edgeCtx.stroke();
          edgeCtx.setLineDash([]);
          if (arrows.length) {
            edgeCtx.fillStyle = color;
            edgeCtx.beginPath();
            for (const geometry of arrows) appendArrowHead(edgeCtx, geometry.end, geometry.endAngle, 5.5);
            edgeCtx.fill();
          }
        }
        // When the whole graph fits in the image, even a long pan exposes only
        // empty space, so it never needs another background rasterization.
        edgeRaster = { left, top, width, height, zoom: cam.k, dpr, viewportWidth: w, viewportHeight: h, complete };
      }
      const scale = cam.k / edgeRaster.zoom;
      ctx.globalAlpha = routeFocusActive ? 0.13 : focusedNodeId ? 0.08 : 1;
      ctx.drawImage(edgeCanvas, edgeRaster.left * scale, edgeRaster.top * scale,
        edgeRaster.width * scale, edgeRaster.height * scale);
      ctx.globalAlpha = 1;

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
        const geometry = cachedCurveGeometry(curve, cam.k);
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
          labels.push({ text: edgeLabel, font: ctx.font, color: outgoing ? '#047857' : '#0369a1',
            alpha: 1, priority: 10, width: labelWidth + 8, height: 18,
            positions: [0.5, 0.3, 0.7].map((t) => ({
              x: (1 - t) ** 2 * geometry.start.x + 2 * (1 - t) * t * geometry.control.x + t ** 2 * geometry.end.x - (labelWidth + 8) / 2,
              y: (1 - t) ** 2 * geometry.start.y + 2 * (1 - t) * t * geometry.control.y + t ** 2 * geometry.end.y - 18,
            })) });
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
          const geometry = cachedCurveGeometry(curve, cam.k);
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
      for (const n of layoutNodes) {
        if (hiddenComms.has(n.communityId)) continue;
        const p = toScreen(n.x, n.y);
        const r = n.r * Math.sqrt(cam.k);
        const isSel = n.id === selected;
        const isNb = focusedNeighbors.has(n.id);
        const isHover = !selected && n.id === hoverRef.current;
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
          (focusedNodeId ? isNb :
            (!routeFocusActive && isBusinessCore) || n.degree >= maxDegree * 0.42 || (showLabels && r > 5));
        const labelSize = isSel || isHover || (isActiveRoute && routeFocusActive) ? 12 : 10;
        ctx.font = `${isActiveRoute && routeFocusActive ? '700 ' : ''}${labelSize}px ui-sans-serif, system-ui`;
        const labelWidth = label ? textWidth(n.label) : 0;
        // Keep offscreen-node labels/badges when their pixels still enter the viewport.
        const badgeMargin = routeFocusActive ? 24 + (activeRouteStepNumbers.get(n.id)?.join('·').length || 0) * 10 : 8;
        if (!inViewport(p.x - r - badgeMargin - labelWidth, p.y - r - 32,
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
          ctx.strokeStyle = 'rgba(24,24,27,0.72)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        if (isSel || isHover || hitSearch || isActiveRoute || (!routeFocusActive && isBusinessCore)) {
          ctx.strokeStyle = isActiveRoute && !isSel && !isHover && !hitSearch ? '#34d399' : '#fbbf24';
          ctx.lineWidth = isActiveRoute && routeFocusActive ? 3 : 2;
          ctx.stroke();
        }
        if (label) {
          const width = labelWidth + 8, height = labelSize + 8;
          labels.push({ text: n.label, font: ctx.font, color: isActiveRoute && routeFocusActive ? '#065f46' : '#27272a',
            alpha: dim && !hitSearch ? (routeFocusActive ? 0.48 : 0.35) : 1,
            priority: isSel || isHover ? 110 : isActiveRoute ? 105 : hitSearch ? 104 : isNb ? 80 : isBusinessCore ? 70 : 30,
            width, height, positions: [
              { x: p.x + r + 5, y: p.y - height / 2 },
              { x: p.x - r - 5 - width, y: p.y - height / 2 },
              { x: p.x - width / 2, y: p.y - r - height - 5 },
              { x: p.x - width / 2, y: p.y + r + 5 },
            ] });
        }
        const stepNumbers = activeRouteStepNumbers.get(n.id);
        if (stepNumbers && routeFocusActive) {
          const stepText = stepNumbers.join('·');
          ctx.font = '800 10px ui-sans-serif, system-ui';
          const badgeWidth = Math.max(18, textWidth(stepText) + 10);
          const badgeHeight = 18;
          const badgeX = p.x - r - badgeWidth * 0.7;
          const badgeY = p.y - r - badgeHeight * 0.75;
          labelObstacles.push({ x: badgeX, y: badgeY, width: badgeWidth, height: badgeHeight });
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

      const controlsHeight = (controlsRef.current?.offsetHeight || 0) + 16;
      for (const label of placeLearnGraphLabels(labels, {
        x: -originX + 4, y: -originY + controlsHeight,
        width: Math.max(0, w - 8), height: Math.max(0, h - controlsHeight - 24),
      }, labelObstacles)) {
        ctx.globalAlpha = label.alpha;
        ctx.fillStyle = 'rgba(255,255,255,0.94)';
        ctx.fillRect(label.x, label.y, label.width, label.height);
        ctx.strokeStyle = 'rgba(24,24,27,0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(label.x, label.y, label.width, label.height);
        ctx.font = label.font;
        ctx.fillStyle = label.color;
        ctx.fillText(label.text, label.x + 4, label.y + label.height - 5);
      }
      ctx.globalAlpha = 1;

      return false;
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
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = null;
      edgeCanvas.width = edgeCanvas.height = 0;
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
    layoutCache,
    layoutRevision,
    connections,
    edgeShapes,
  ]);

  const hitTest = (sx: number, sy: number): LearnLayoutNode | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const cam = camRef.current;
    const wx = (sx - w / 2) / cam.k - cam.x;
    const wy = (sy - h / 2) / cam.k - cam.y;
    let best: LearnLayoutNode | null = null;
    let bestDistanceSquared = Infinity;
    for (const n of layoutNodesRef.current) {
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
    if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = window.setTimeout(() => {
      wheelTimerRef.current = null;
      invalidateRef.current();
    }, 120);
    invalidateRef.current();
  };

  const clearHover = () => {
    if (hoverRef.current === null) return;
    hoverRef.current = null;
    setHover(null);
    invalidateRef.current();
  };

  const clearSelection = () => {
    clearHover();
    onSelectNode(null);
    onSelectCommunity(null);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if ((e.button !== 0 && e.button !== 1) || dragRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Select only after a click finishes: dragging from a node or blank space
    // must not replace or clear the pinned connections.
    dragRef.current = {
      pointerId: e.pointerId, button: e.button,
      startX: x, startY: y, lx: x, ly: y, moved: false,
      node: e.button === 0 ? hitTest(x, y) : null,
    };
    clearHover();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const drag = dragRef.current;
    if (drag) {
      if (e.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) < DRAG_THRESHOLD) return;
      drag.moved = true;
      cameraTouchedRef.current = true;
      const cam = camRef.current;
      cam.x += (x - drag.lx) / cam.k;
      cam.y += (y - drag.ly) / cam.k;
      drag.lx = x;
      drag.ly = y;
      invalidateRef.current();
      return;
    }
    // A pin owns both the canvas highlights and the connection details until
    // another node is clicked or the user explicitly clears it.
    if (selectedNodeId) return;
    const node = hitTest(x, y);
    const id = node?.id || null;
    if (id !== hoverRef.current) {
      hoverRef.current = id;
      setHover(id);
      invalidateRef.current();
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId || e.button !== drag.button) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const distance = Math.hypot(e.clientX - rect.left - drag.startX, e.clientY - rect.top - drag.startY);
    if (drag.button === 0 && !drag.moved && distance < DRAG_THRESHOLD && drag.node) {
      onSelectNode(drag.node.id);
      onSelectCommunity(drag.node.communityId);
    }
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const onPointerLeave = () => {
    if (dragRef.current) return;
    clearHover();
  };

  const focusedDetailsNodeId = selectedNodeId || hover;
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
    const visible = layoutNodesRef.current.filter((node) => !hidden.has(node.communityId));
    const camera = fitCameraToNodes(visible, wrap.clientWidth, wrap.clientHeight, controlsRef.current?.offsetHeight || 0);
    if (camera) camRef.current = camera;
    cameraTouchedRef.current = false;
    invalidateRef.current();
  };

  return (
    <div className="relative w-full h-full min-h-0 bg-[var(--surface-canvas)]" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onAuxClick={(e) => e.preventDefault()}
      />
      <div ref={controlsRef} className="absolute top-2 left-2 right-2 flex flex-wrap items-center gap-1.5 pointer-events-none">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索节点"
          className="pointer-events-auto w-36 bg-white/90 border border-black/15 rounded-md px-2 py-1 text-[11px] text-zinc-900 placeholder:text-zinc-600 shadow-sm"
        />
        <button
          type="button"
          onClick={fitToView}
          className="pointer-events-auto text-[10px] px-2 py-0.5 rounded-md border border-black/15 bg-white/90 text-zinc-800 hover:text-zinc-950 hover:border-black/20 shadow-sm"
        >
          适应视图
        </button>
        {selectedNodeId && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-900 shadow-sm">
            <span className="max-w-52 truncate" title={focusedDetailsNode?.label || selectedNodeId}>
              已固定：{focusedDetailsNode?.label || selectedNodeId}
            </span>
            <button type="button" onClick={clearSelection} className="shrink-0 text-zinc-800 hover:text-zinc-950">
              取消固定
            </button>
          </div>
        )}
        <div className="pointer-events-auto flex items-center rounded-md border border-black/15 bg-white/90 p-0.5 shadow-sm">
          <button
            type="button"
            title="只显示主要跨类调用活动"
            aria-pressed={density === 'simple'}
            onClick={() => setDensity('simple')}
            className={`rounded px-2 py-0.5 text-[10px] ${
              density === 'simple'
                ? 'bg-amber-100 text-amber-900'
                : 'text-zinc-600 hover:text-zinc-900'
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
                ? 'bg-amber-100 text-amber-900'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            丰富
          </button>
        </div>
        <button
          type="button"
          aria-label="隐藏测试节点"
          aria-pressed={hideTestNodes}
          title="隐藏类名或路径中的 Test / Tests / Testing，以及测试目录、.spec 文件；只过滤显示，不调用 AI"
          onClick={() => {
            clearHover();
            onHideTestNodesChange(!hideTestNodes);
          }}
          className={`pointer-events-auto rounded-md border bg-white/90 px-2 py-1 text-[10px] shadow-sm ${
            hideTestNodes ? 'border-sky-300 text-sky-800' : 'border-black/15 text-zinc-700'
          }`}
        >
          隐藏测试节点{hideTestNodes ? ' ✓' : ''} · {testNodeCount}
        </button>
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
              clearSelection();
            }}
            title={activeRoute?.summary || '选择一条 AI 核实的业务路线并聚焦其类级节点'}
            className={`pointer-events-auto max-w-52 rounded-md border bg-white/90 px-2 py-1 text-[10px] shadow-sm ${
              routeFocusActive
                ? 'border-emerald-300 text-emerald-800'
                : 'border-black/15 text-zinc-800'
            }`}
          >
            <option value="">社区总览（不聚焦路线）</option>
            {graph.businessRoutes.map((route) => {
              const mappedSteps = routeMappedStepCounts.get(route.id) || 0;
              const filteredSteps = hideTestNodes && route.steps.some((step) => step.nodeId && !graphNodeIds.has(step.nodeId));
              return (
                <option key={route.id} value={route.id} disabled={mappedSteps === 0}>
                  {route.label} · {mappedSteps}/{route.steps.length} 步
                  {filteredSteps ? '（测试步骤已隐藏）' : mappedSteps === 0 ? '（无法映射）' : ''}
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
                active ? 'text-zinc-950 border-black/30' : 'text-zinc-800 border-black/15'
              } ${on ? 'bg-white/90' : 'bg-zinc-100 opacity-40'}`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: communityColor(c.id) }}
              />
              {c.label}
              <span className="text-zinc-600">
                {density === 'simple'
                  ? `${visibleCommunityCounts.get(c.id) || 0}/${c.nodeCount}`
                  : c.nodeCount}
              </span>
            </button>
          );
        })}
      </div>
      {hideTestNodes && testNodeCount > 0 && graph.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-xs text-zinc-700">
          所有节点都已按测试规则隐藏，关闭「隐藏测试节点」即可恢复。
        </div>
      )}
      <div className="absolute bottom-2 left-2 text-[10px] text-zinc-600 pointer-events-none">
        {(layoutCache.get(density)?.key !== layoutKey || layoutCache.get(density)?.worker) && (
          <span className="mr-2 text-amber-700">正在后台整理社区布局…</span>
        )}
        {layoutCache.get(density)?.key === layoutKey && layoutCache.get(density)?.error && (
          <span className="mr-2 text-rose-700">布局失败：{layoutCache.get(density)?.error}</span>
        )}
        {density === 'simple'
          ? `简化（${businessCoreNodeIds.size ? 'AI 业务核心' : '候选调用骨架'}）· ${visibleNodes.length}/${graph.nodes.length} 类级节点 · ${visibleEdges.length}/${graph.edges.length} 边`
          : `丰富 · ${graph.nodes.length} 类级节点 · ${graph.edges.length} 边`}
        {graph.stats.truncated ? ' · 已裁大图' : ''}
        {routeFocusActive && activeRoute
          ? ` · 路线聚焦 ${activeRoute.label} · ${routeMappedStepCounts.get(activeRoute.id) || 0}/${activeRoute.steps.length} 步可见`
          : ' · 社区总览'}
        {hideTestNodes && testNodeCount > 0 ? ` · 已隐藏 ${testNodeCount} 个测试节点及相关连线` : ''}
        <span className="ml-2 text-zinc-500">滚轮缩放 · 左键/中键拖动画布 · 单击节点固定路线 · 固定后缩放、拖动、悬停不切换</span>
      </div>
      {focusedDetailsNode && (
        <div role="region" aria-label="节点连接详情" className="absolute bottom-2 right-2 max-w-[320px] bg-white/95 border border-black/15 rounded-lg px-2.5 py-2 text-[11px] text-zinc-900 shadow-sm pointer-events-none">
          <div className="font-semibold text-zinc-950">{focusedDetailsNode.label}</div>
          <div className="text-zinc-700">
            {focusedDetailsNode.kind} · 度 {focusedDetailsNode.degree}
            {focusedDetailsNode.file ? ` · ${focusedDetailsNode.file}` : ''}
          </div>
          <div className="mt-1 flex gap-3 text-[10px]">
            <span className="text-emerald-700">绿色出边 {outgoingConnections.length}</span>
            <span className="text-sky-700">蓝色入边 {incomingConnections.length}</span>
          </div>
          {outgoingConnections.slice(0, 5).map(({ edge, node }) => (
            <div key={`out:${edge.source}:${edge.target}:${edge.relation}`} className="truncate text-[10px] text-emerald-800">
              → {EDGE_LABEL[edge.relation] || edge.relation} · {node?.label || edge.target}
            </div>
          ))}
          {incomingConnections.slice(0, 5).map(({ edge, node }) => (
            <div key={`in:${edge.source}:${edge.target}:${edge.relation}`} className="truncate text-[10px] text-sky-800">
              ← {EDGE_LABEL[edge.relation] || edge.relation} · {node?.label || edge.source}
            </div>
          ))}
          {outgoingConnections.length + incomingConnections.length > 10 && (
            <div className="text-[10px] text-zinc-600">其余连接继续沿高亮曲线查看</div>
          )}
        </div>
      )}
    </div>
  );
});
