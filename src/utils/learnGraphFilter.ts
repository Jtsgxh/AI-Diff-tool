import type { LearnGraph, LearnNode } from '../types';

export function isLearnTestNode(node: Pick<LearnNode, 'label' | 'file'>): boolean {
  // Match naming parts, not substrings like laTEST/conTEST. Do not inspect
  // method symbols: a production class can legitimately contain TestConnection.
  const parts = `${node.label} ${node.file || ''}`
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase().split(/[^a-z0-9]+/);
  if (parts.some((part) => /^(?:tests?|testing|testers?|testcases?|testsuites?|unittests?)\d*$/.test(part))) return true;
  const file = (node.file || '').replace(/\\/g, '/');
  // Spec is a common business-class suffix (AbilitySpec), so only recognize
  // test directories and dotted test-file suffixes, never every *Spec class.
  return /(?:^|\/)(?:__)?(?:specs?|e2e)(?:__)?(?:\/|$)/i.test(file) || /\.spec\.[^/]+$/i.test(file);
}

/** Memoize this by source nodes/edges, independently of streamed AI labels. */
export function filterLearnTestNodes(source: Pick<LearnGraph, 'nodes' | 'edges'>): Pick<LearnGraph, 'nodes' | 'edges'> {
  const remaining = source.nodes.filter((node) => !isLearnTestNode(node));
  if (remaining.length === source.nodes.length) return source;
  const ids = new Set(remaining.map((node) => node.id));
  const edges = source.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const degrees = new Map<string, number>();
  for (const edge of edges) {
    degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
  }
  const nodes = remaining.map((node) => {
    const degree = degrees.get(node.id) || 0;
    return degree === node.degree ? node : { ...node, degree };
  });
  return { nodes, edges };
}

/** One display projection for both the canvas and its node/community details. */
export function learnGraphWithFilteredNodes(graph: LearnGraph, topology: Pick<LearnGraph, 'nodes' | 'edges'>): LearnGraph {
  if (topology.nodes === graph.nodes && topology.edges === graph.edges) return graph;
  const byId = new Map(topology.nodes.map((node) => [node.id, node]));
  const members = new Map<string, LearnNode[]>();
  for (const node of topology.nodes) {
    const group = members.get(node.communityId);
    if (group) group.push(node);
    else members.set(node.communityId, [node]);
  }
  const internal = new Map<string, number>();
  const incident = new Map<string, number>();
  for (const edge of topology.edges) {
    const a = byId.get(edge.source)!.communityId, b = byId.get(edge.target)!.communityId;
    incident.set(a, (incident.get(a) || 0) + 1);
    if (a === b) internal.set(a, (internal.get(a) || 0) + 1);
    else incident.set(b, (incident.get(b) || 0) + 1);
  }
  const removedLabels = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    if (byId.has(node.id)) continue;
    const labels = removedLabels.get(node.communityId) || new Set<string>();
    labels.add(node.label);
    removedLabels.set(node.communityId, labels);
  }
  const communities = graph.communities.flatMap((community) => {
    const nodes = members.get(community.id);
    if (!nodes?.length) return [];
    const labels = new Set(nodes.map((node) => node.label));
    const entry = community.entry;
    const entryVisible = entry && nodes.some((node) => node.file?.replace(/\\/g, '/') === entry.file.replace(/\\/g, '/') &&
      (!entry.symbol || node.label === entry.symbol || node.symbols?.includes(entry.symbol)));
    return [{
      ...community,
      // Structural community names are their top class. Replace a hidden top
      // class, but preserve AI-authored business labels and the original grouping.
      label: removedLabels.get(community.id)?.has(community.label) && !labels.has(community.label)
        ? nodes.reduce((best, node) => node.degree > best.degree ? node : best).label : community.label,
      nodeCount: nodes.length,
      files: [...new Set(nodes.flatMap((node) => node.file ? [node.file] : []))],
      godNodes: community.godNodes.filter((label) => labels.has(label)),
      entry: entryVisible ? entry : undefined,
      cohesion: (internal.get(community.id) || 0) / (incident.get(community.id) || 1),
    }];
  });
  const communityIds = new Set(communities.map((community) => community.id));
  return {
    ...graph,
    nodes: topology.nodes,
    edges: topology.edges,
    communities,
    godNodes: graph.godNodes.filter((node) => byId.has(node.id)).map((node) => ({ ...node, degree: byId.get(node.id)!.degree })),
    bridges: graph.bridges.filter((edge) => byId.has(edge.source) && byId.has(edge.target)),
    runtimePath: graph.runtimePath.filter((id) => communityIds.has(id)),
    // Preserve original route steps/numbers and source stats. A hidden middle
    // step is a gap, not a new direct connection between its surviving neighbors.
  };
}
