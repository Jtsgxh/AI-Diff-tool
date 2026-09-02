import { CommitNode, GraphNode } from '../types';

export const BRANCH_COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Emerald
  '#60A5FA', // Light blue
  '#F59E0B', // Amber
  '#2DD4BF', // Teal
  '#06B6D4', // Cyan
  '#F97316', // Orange
  '#14B8A6', // Teal
];

export interface ComputedGraph {
  nodes: GraphNode[];
  maxColumns: number;
}

/**
 * Computes lane allocations (columns) for Git commits DAG.
 * Compatible with multi-branch merge & fork patterns.
 */
export function computeGraphLayout(commits: CommitNode[]): ComputedGraph {
  if (!commits || commits.length === 0) {
    return { nodes: [], maxColumns: 1 };
  }

  // Active branches tracking: activeTracks[col] = nextExpectedParentHash
  const activeTracks: (string | null)[] = [];
  const nodes: GraphNode[] = [];
  let maxColReached = 0;

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    let col = -1;

    // 1. Check if an active track is waiting for this commit
    for (let c = 0; c < activeTracks.length; c++) {
      if (activeTracks[c] === commit.hash) {
        col = c;
        activeTracks[c] = null; // consume track
        break;
      }
    }

    // 2. If no track was waiting, find first empty track or allocate a new column
    if (col === -1) {
      col = activeTracks.indexOf(null);
      if (col === -1) {
        col = activeTracks.length;
        activeTracks.push(null);
      }
    }

    maxColReached = Math.max(maxColReached, col);

    // 3. Assign first parent to the same column
    if (commit.parents && commit.parents.length > 0) {
      activeTracks[col] = commit.parents[0];

      // Other parents (merge parents) get allocated into other tracks
      for (let p = 1; p < commit.parents.length; p++) {
        const parentHash = commit.parents[p];
        let mergeCol = activeTracks.indexOf(null);
        if (mergeCol === -1) {
          mergeCol = activeTracks.length;
          activeTracks.push(null);
        }
        activeTracks[mergeCol] = parentHash;
        maxColReached = Math.max(maxColReached, mergeCol);
      }
    }

    const color = BRANCH_COLORS[col % BRANCH_COLORS.length];
    const isHead = commit.refs.some((r) => r.includes('HEAD'));

    nodes.push({
      ...commit,
      column: col,
      color,
      isHead,
    });
  }

  return {
    nodes,
    maxColumns: maxColReached + 1,
  };
}
