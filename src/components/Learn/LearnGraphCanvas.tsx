import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LearnEdge, LearnGraph, LearnNode } from '../../types';
import { communityColor } from '../../utils/learnGraph';

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

export const LearnGraphCanvas: React.FC<LearnGraphCanvasProps> = ({
  graph,
  selectedNodeId,
  selectedCommunityId,
  onSelectNode,
  onSelectCommunity,
}) => {
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
  const rafRef = useRef(0);
  const ticksRef = useRef(0);
  const neighborRef = useRef<Set<string>>(new Set());

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
        : graph.businessRoutes[0]?.id || '';
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

  const activeRouteNodeIds = useMemo(
    () => new Set(activeRoute?.steps.map((step) => step.nodeId).filter(Boolean) as string[]),
    [activeRoute]
  );

  const businessCoreNodeIds = useMemo(
    () => new Set(
      graph.businessRoutes.flatMap((route) =>
        route.steps.map((step) => step.nodeId).filter(Boolean) as string[]
      )
    ),
    [graph.businessRoutes]
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
    if (selectedNodeId) ids.add(selectedNodeId);
    for (const id of searchHit || []) ids.add(id);
    return ids;
  }, [
    activityNodeIds,
    graph.bridges,
    graph.communities,
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
      for (const node of visibleNodes) {
        if ((incidence.get(node.id) || 0) > 0) continue;
        const edge = candidates.find(
          (candidate) =>
            !keptKeys.has(`${candidate.source}|${candidate.target}`) &&
            (candidate.source === node.id || candidate.target === node.id)
        );
        if (edge) add(edge);
      }
      return kept;
    },
    [density, graph.edges, visibleNodeIds, visibleNodes]
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
    });
    return () => cancelAnimationFrame(fitFrame);
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const nbs = new Set<string>();
    if (selectedNodeId) {
      nbs.add(selectedNodeId);
      for (const e of graph.edges) {
        if (e.source === selectedNodeId) nbs.add(e.target);
        if (e.target === selectedNodeId) nbs.add(e.source);
      }
    }
    neighborRef.current = nbs;
  }, [graph.edges, selectedNodeId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const step = () => {
      const sim = simRef.current;
      const tickCap = sim.length > 220 ? 180 : 420;
      const alpha = Math.max(0.015, 0.12 * Math.pow(0.985, ticksRef.current));
      let layoutUpdated = false;
      if (ticksRef.current < tickCap && sim.length) {
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

        const byId = new Map(sim.map((n) => [n.id, n]));
        for (const e of visibleEdges) {
          const a = byId.get(e.source);
          const b = byId.get(e.target);
          if (!a || !b) continue;
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
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        if (!cameraTouchedRef.current) {
          const camera = fitCameraToNodes(sim, w, h);
          if (camera) camRef.current = camera;
        }
      } else if (
        !cameraTouchedRef.current &&
        layoutUpdated &&
        ticksRef.current > 0 &&
        (ticksRef.current % 12 === 0 || ticksRef.current === tickCap)
      ) {
        const camera = fitCameraToNodes(sim, w, h);
        if (camera) camRef.current = camera;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#12131A';
      ctx.fillRect(0, 0, w, h);

      const cam = camRef.current;
      const toScreen = (x: number, y: number) => ({
        x: (x + cam.x) * cam.k + w / 2,
        y: (y + cam.y) * cam.k + h / 2,
      });

      const hiddenComms = hidden;
      const selected = selectedNodeId;
      const neighbors = neighborRef.current;
      const byId = new Map(sim.map((n) => [n.id, n]));
      const communityById = new Map(graph.communities.map((community) => [community.id, community]));

      for (const box of communityBoxesRef.current) {
        if (hiddenComms.has(box.id)) continue;
        const topLeft = toScreen(box.x - box.width / 2, box.y - box.height / 2);
        const width = box.width * cam.k;
        const height = box.height * cam.k;
        const dimmed = Boolean(selectedCommunityId && selectedCommunityId !== box.id);
        const color = communityColor(box.id);
        ctx.globalAlpha = dimmed ? 0.015 : 0.055;
        ctx.fillStyle = color;
        ctx.fillRect(topLeft.x, topLeft.y, width, height);
        ctx.globalAlpha = dimmed ? 0.08 : 0.32;
        ctx.strokeStyle = color;
        ctx.lineWidth = selectedCommunityId === box.id ? 2 : 1;
        ctx.strokeRect(topLeft.x, topLeft.y, width, height);
        const community = communityById.get(box.id);
        ctx.globalAlpha = dimmed ? 0.25 : 0.9;
        ctx.fillStyle = color;
        ctx.font = '600 11px ui-sans-serif, system-ui';
        ctx.fillText(
          `${community?.label || `社区 ${box.id}`} · ${visibleCommunityCounts.get(box.id) || 0}`,
          topLeft.x + 10,
          topLeft.y + 18
        );
        ctx.globalAlpha = 1;
      }

      ctx.lineWidth = 1;
      for (const e of visibleEdges) {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b) continue;
        if (hiddenComms.has(a.communityId) || hiddenComms.has(b.communityId)) continue;
        const pa = toScreen(a.x, a.y);
        const pb = toScreen(b.x, b.y);
        const hot =
          selected && (e.source === selected || e.target === selected);
        ctx.strokeStyle = hot ? 'rgba(251,191,36,0.7)' : EDGE_COLOR[e.relation] || EDGE_COLOR.references;
        ctx.globalAlpha = selected && !hot ? 0.18 : 1;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      for (const route of graph.businessRoutes) {
        const isActive = route.id === activeRouteId;
        ctx.strokeStyle = isActive ? 'rgba(52,211,153,0.88)' : 'rgba(251,191,36,0.34)';
        ctx.lineWidth = isActive ? 3 : 1.5;
        for (let index = 1; index < route.steps.length; index++) {
          const previousId = route.steps[index - 1].nodeId;
          const currentId = route.steps[index].nodeId;
          if (!previousId || !currentId) continue;
          const previous = byId.get(previousId);
          const current = byId.get(currentId);
          if (!previous || !current) continue;
          const from = toScreen(previous.x, previous.y);
          const to = toScreen(current.x, current.y);
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.stroke();
        }
      }

      const showLabels = cam.k > 1.35;
      for (const n of sim) {
        if (hiddenComms.has(n.communityId)) continue;
        const p = toScreen(n.x, n.y);
        const r = n.r * Math.sqrt(cam.k);
        const isSel = n.id === selected;
        const isNb = neighbors.has(n.id);
        const isHover = n.id === hoverRef.current;
        const isBusinessCore = businessCoreNodeIds.has(n.id);
        const isActiveRoute = activeRouteNodeIds.has(n.id);
        const commSel = selectedCommunityId && n.communityId === selectedCommunityId;
        const dim = Boolean((selected && !isNb) || (selectedCommunityId && !commSel));
        const hitSearch = searchHit?.has(n.id);
        ctx.globalAlpha = dim && !hitSearch ? 0.22 : 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = communityColor(n.communityId);
        ctx.fill();
        if (n.degree >= maxDegree * 0.55) {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        if (isSel || isHover || hitSearch || isBusinessCore) {
          ctx.strokeStyle = isActiveRoute && !isSel && !isHover && !hitSearch ? '#34d399' : '#fbbf24';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        const label =
          isSel || isHover || hitSearch || isBusinessCore || n.degree >= maxDegree * 0.42 || (showLabels && r > 5);
        if (label) {
          ctx.font = `${isSel || isHover ? 12 : 10}px ui-sans-serif, system-ui`;
          ctx.fillStyle = '#e2e8f0';
          ctx.globalAlpha = dim && !hitSearch ? 0.35 : 1;
          ctx.fillText(n.label, p.x + r + 4, p.y + 3);
        }
        ctx.globalAlpha = 1;
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [
    activeRouteId,
    graph.businessRoutes,
    graph.communities,
    hidden,
    maxDegree,
    activeRouteNodeIds,
    businessCoreNodeIds,
    searchHit,
    selectedCommunityId,
    selectedNodeId,
    visibleEdges,
    visibleCommunityCounts,
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
    let bestD = Infinity;
    for (const n of simRef.current) {
      if (hidden.has(n.communityId)) continue;
      const dx = n.x - wx;
      const dy = n.y - wy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < n.r + 4 / cam.k && d < bestD) {
        best = n;
        bestD = d;
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
      return;
    }
    const node = hitTest(x, y);
    const id = node?.id || null;
    if (id !== hoverRef.current) {
      hoverRef.current = id;
      setHover(id);
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const hovered = hover ? graph.nodes.find((n) => n.id === hover) : null;

  const fitToView = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const visible = simRef.current.filter((node) => !hidden.has(node.communityId));
    const camera = fitCameraToNodes(visible, wrap.clientWidth, wrap.clientHeight);
    if (camera) camRef.current = camera;
    cameraTouchedRef.current = false;
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
            aria-label="AI 业务路线高亮"
            value={activeRouteId}
            onChange={(event) => setActiveRouteId(event.target.value)}
            className="pointer-events-auto max-w-52 rounded-md border border-white/10 bg-black/50 px-2 py-1 text-[10px] text-slate-300"
          >
            <option value="">不高亮 AI 路线</option>
            {graph.businessRoutes.map((route) => (
              <option key={route.id} value={route.id}>{route.label}</option>
            ))}
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
        {activeRoute ? ` · 路线 ${activeRoute.label}` : ''}
        <span className="ml-2 text-slate-600">滚轮缩放 · 中键拖动画布 · 左键选择节点</span>
      </div>
      {hovered && (
        <div className="absolute bottom-2 right-2 max-w-[240px] bg-black/70 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 pointer-events-none">
          <div className="font-semibold text-slate-100">{hovered.label}</div>
          <div className="text-slate-400">
            {hovered.kind} · 度 {hovered.degree}
            {hovered.file ? ` · ${hovered.file}` : ''}
          </div>
        </div>
      )}
    </div>
  );
};
