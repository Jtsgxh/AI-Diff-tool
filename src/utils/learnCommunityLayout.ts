import type { LearnEdge, LearnNode } from '../types';

export interface LearnLayoutNode extends LearnNode {
  x: number;
  y: number;
  r: number;
}

export interface LearnCommunityBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LearnCommunityLayout {
  nodes: LearnLayoutNode[];
  boxes: LearnCommunityBox[];
}

const NODE_SPACING = 52;
const COMMUNITY_GAP = 40;
const COMMUNITY_PADDING_X = 48;
const COMMUNITY_PADDING_TOP = 58;
const COMMUNITY_PADDING_BOTTOM = 36;

/** Community-first, deterministic positions. Display density does not start a simulation. */
export function createLearnCommunityLayout(
  nodes: LearnNode[],
  edges: LearnEdge[],
  communityIds: string[],
  width: number,
  height: number
): LearnCommunityLayout {
  const maxD = Math.max(1, ...nodes.map((n) => n.degree));
  const viewportAspect = Math.max(
    1,
    (width || 1600) / Math.max(1, height || 450)
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const sourceNeighbors = adjacency.get(edge.source);
    if (sourceNeighbors) sourceNeighbors.push(edge.target);
    else adjacency.set(edge.source, [edge.target]);
    const targetNeighbors = adjacency.get(edge.target);
    if (targetNeighbors) targetNeighbors.push(edge.source);
    else adjacency.set(edge.target, [edge.source]);
  }
  const grouped = new Map<string, LearnNode[]>();
  for (const node of nodes) {
    const members = grouped.get(node.communityId);
    if (members) members.push(node);
    else grouped.set(node.communityId, [node]);
  }
  const entries: [string, LearnNode[]][] = [];
  for (const communityId of communityIds) {
    const members = grouped.get(communityId);
    if (!members?.length) continue;
    entries.push([communityId, members]);
    grouped.delete(communityId);
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
  const positioned: LearnLayoutNode[] = [];
  const boxes: LearnCommunityBox[] = [];

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
      positioned.push({
        ...node,
        x,
        y,
        r: 3.5 + 9.5 * Math.sqrt(node.degree / maxD),
      });
    });
  });
  return { nodes: positioned, boxes };
}

/** The original community-anchored force layout, settled once in a worker. */
export function settleLearnCommunityLayout(
  layout: LearnCommunityLayout,
  edges: LearnEdge[]
): LearnCommunityLayout {
  const nodes = layout.nodes.map((node) => ({ ...node, homeX: node.x, homeY: node.y, vx: 0, vy: 0 }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const boxes = new Map(layout.boxes.map((box) => [box.id, box]));
  const links = edges.flatMap((edge) => {
    const source = byId.get(edge.source), target = byId.get(edge.target);
    return source && target ? [{ source, target, relation: edge.relation }] : [];
  });
  const iterations = nodes.length > 220 ? 180 : 420;
  const range = nodes.length > 220 ? 120 : 180;
  for (let tick = 0; tick < iterations && nodes.length > 1; tick++) {
    const alpha = Math.max(0.015, 0.12 * Math.pow(0.985, tick));
    const buckets = new Map<string, number[]>();
    nodes.forEach((node, index) => {
      const key = `${Math.floor(node.x / range)},${Math.floor(node.y / range)}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(index);
      else buckets.set(key, [index]);
    });
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const cellX = Math.floor(a.x / range), cellY = Math.floor(a.y / range);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        for (const j of buckets.get(`${cellX + ox},${cellY + oy}`) || []) {
          if (j <= i) continue;
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          if (Math.abs(dx) > range || Math.abs(dy) > range) continue;
          let squared = dx * dx + dy * dy;
          if (squared < 0.01) {
            // Stable separation for coincident nodes, so a new run is reproducible.
            dx = 0.1;
            dy = (i + j) % 2 ? 0.1 : -0.1;
            squared = dx * dx + dy * dy;
          }
          const distance = Math.sqrt(squared);
          const collision = Math.max(0, a.r + b.r + 18 - distance) * 0.08;
          const force = Math.max(collision, Math.min(1.8, alpha * 1400 / squared));
          const fx = dx / distance * force, fy = dy / distance * force;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
      }
    }
    for (const { source: a, target: b, relation } of links) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const sameCommunity = a.communityId === b.communityId;
      const rest = sameCommunity ? (relation === 'calls' ? 82 : 108) : 180;
      const force = alpha * (sameCommunity ? 0.04 : 0.006) * (distance - rest);
      const fx = dx / distance * force, fy = dy / distance * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    for (const node of nodes) {
      node.vx = (node.vx + (node.homeX - node.x) * 0.018) * 0.72;
      node.vy = (node.vy + (node.homeY - node.y) * 0.018) * 0.72;
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > 8) { node.vx *= 8 / speed; node.vy *= 8 / speed; }
      node.x += node.vx;
      node.y += node.vy;
      const box = boxes.get(node.communityId);
      if (!box) throw new Error(`社区布局缺少边界：${node.communityId}`);
      // A highly connected hub must not be pulled into another community.
      const x = Math.max(box.x - box.width / 2 + node.r + 12,
        Math.min(box.x + box.width / 2 - node.r - 12, node.x));
      const y = Math.max(box.y - box.height / 2 + node.r + 32,
        Math.min(box.y + box.height / 2 - node.r - 12, node.y));
      if (x !== node.x) node.vx = 0;
      if (y !== node.y) node.vy = 0;
      node.x = x;
      node.y = y;
    }
  }
  return {
    boxes: layout.boxes,
    nodes: nodes.map(({ homeX, homeY, vx, vy, ...node }) => node),
  };
}
