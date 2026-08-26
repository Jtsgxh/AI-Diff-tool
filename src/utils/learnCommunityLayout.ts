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
