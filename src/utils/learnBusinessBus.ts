import type {
  LearnBusinessRouteStep,
  LearnBusinessStepKind,
  LearnGraph,
} from '../types';

export interface LearnBusinessBusOccurrence extends LearnBusinessRouteStep {
  routeId: string;
  routeLabel: string;
  routeIndex: number;
  stepIndex: number;
}

export interface LearnBusinessBusNode {
  id: string;
  label: string;
  kind: LearnBusinessStepKind;
  file: string;
  classSymbol: string;
  methodSymbol: string;
  communityId: string;
  routeIds: string[];
  occurrences: LearnBusinessBusOccurrence[];
  column: number;
  lane: number;
}

export interface LearnBusinessBusEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  routeIds: string[];
}

export interface LearnBusinessBusRoute {
  id: string;
  label: string;
  summary: string;
  totalStepCount: number;
  visibleStepCount: number;
  nodeIds: (string | null)[];
}

export interface LearnBusinessBus {
  nodes: LearnBusinessBusNode[];
  edges: LearnBusinessBusEdge[];
  routes: LearnBusinessBusRoute[];
}

export interface PositionedLearnBusinessBusNode extends LearnBusinessBusNode {
  x: number;
  y: number;
}

export interface LearnBusinessBusLayout {
  nodes: PositionedLearnBusinessBusNode[];
  width: number;
  height: number;
  laneY: number[];
}

export const BUSINESS_BUS_NODE_WIDTH = 196;
export const BUSINESS_BUS_NODE_HEIGHT = 96;
const COLUMN_GAP = 272;
const LANE_GAP = 176;
const COLUMN_NODE_GAP = 24;
const LABEL_WIDTH = 152;
const TOP = 76;
const PADDING = 44;

function normalizedAnchor(step: LearnBusinessRouteStep): string {
  return [
    step.file.replace(/\\/g, '/').toLowerCase(),
    step.classSymbol.toLowerCase(),
    step.methodSymbol.toLowerCase(),
    step.kind,
  ].join('\u001f');
}

/**
 * Derive the independent business bus from the accepted routes. Route steps
 * remain the only source of truth; hidden class nodes create gaps, never links.
 */
export function buildLearnBusinessBus(graph: LearnGraph): LearnBusinessBus {
  const visibleClassNodeIds = new Set(graph.nodes.map((node) => node.id));
  const nodesById = new Map<string, LearnBusinessBusNode>();
  const edgeByKey = new Map<string, LearnBusinessBusEdge>();
  const routes: LearnBusinessBusRoute[] = [];

  graph.businessRoutes.forEach((route, routeIndex) => {
    const occurrences = new Map<string, number>();
    const nodeIds = route.steps.map((step, stepIndex) => {
      if (!step.nodeId || !visibleClassNodeIds.has(step.nodeId)) return null;
      const anchor = normalizedAnchor(step);
      const ordinal = (occurrences.get(anchor) || 0) + 1;
      occurrences.set(anchor, ordinal);
      const id = `${anchor}\u001f${ordinal}`;
      const occurrence: LearnBusinessBusOccurrence = {
        ...step,
        routeId: route.id,
        routeLabel: route.label,
        routeIndex,
        stepIndex,
      };
      const existing = nodesById.get(id);
      if (existing) {
        if (!existing.routeIds.includes(route.id)) existing.routeIds.push(route.id);
        existing.occurrences.push(occurrence);
        existing.column = Math.min(existing.column, stepIndex);
        existing.lane = existing.occurrences.reduce((sum, item) => sum + item.routeIndex, 0) /
          existing.occurrences.length;
      } else {
        nodesById.set(id, {
          id,
          label: step.label,
          kind: step.kind,
          file: step.file,
          classSymbol: step.classSymbol,
          methodSymbol: step.methodSymbol,
          communityId: step.communityId,
          routeIds: [route.id],
          occurrences: [occurrence],
          column: stepIndex,
          lane: routeIndex,
        });
      }
      return id;
    });

    for (let index = 1; index < nodeIds.length; index++) {
      const source = nodeIds[index - 1];
      const target = nodeIds[index];
      if (!source || !target) continue;
      const relation = route.steps[index].relation;
      const key = `${source}\u001e${target}\u001e${relation}`;
      const existing = edgeByKey.get(key);
      if (existing) {
        if (!existing.routeIds.includes(route.id)) existing.routeIds.push(route.id);
      } else {
        edgeByKey.set(key, {
          id: key,
          source,
          target,
          relation,
          routeIds: [route.id],
        });
      }
    }

    routes.push({
      id: route.id,
      label: route.label,
      summary: route.summary,
      totalStepCount: route.steps.length,
      visibleStepCount: nodeIds.filter(Boolean).length,
      nodeIds,
    });
  });

  return {
    nodes: [...nodesById.values()].sort((a, b) =>
      a.column - b.column || a.lane - b.lane || a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
    edges: [...edgeByKey.values()],
    routes,
  };
}

/** Stable layered placement; cycles remain explicit back-edges in the SVG. */
export function layoutLearnBusinessBus(bus: LearnBusinessBus): LearnBusinessBusLayout {
  const laneY = bus.routes.map((_, index) => TOP + index * LANE_GAP + BUSINESS_BUS_NODE_HEIGHT / 2);
  const lastBottomByColumn = new Map<number, number>();
  const nodes = bus.nodes.map((node) => {
    const preferredY = TOP + node.lane * LANE_GAP;
    const lastBottom = lastBottomByColumn.get(node.column) ?? Number.NEGATIVE_INFINITY;
    const y = Math.max(preferredY, lastBottom + COLUMN_NODE_GAP);
    lastBottomByColumn.set(node.column, y + BUSINESS_BUS_NODE_HEIGHT);
    return {
      ...node,
      x: LABEL_WIDTH + node.column * COLUMN_GAP,
      y,
    };
  });
  const maxColumn = Math.max(0, ...nodes.map((node) => node.column));
  const maxBottom = Math.max(
    TOP + Math.max(0, bus.routes.length - 1) * LANE_GAP + BUSINESS_BUS_NODE_HEIGHT,
    ...nodes.map((node) => node.y + BUSINESS_BUS_NODE_HEIGHT)
  );
  return {
    nodes,
    width: LABEL_WIDTH + maxColumn * COLUMN_GAP + BUSINESS_BUS_NODE_WIDTH + PADDING,
    height: maxBottom + PADDING,
    laneY,
  };
}
