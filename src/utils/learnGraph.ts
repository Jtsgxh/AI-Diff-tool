import type {
  LearnAnalysisEnvelope,
  LearnBusinessRoute,
  LearnGraph,
  LearnNode,
} from '../types';
import { parseLearnAnalysisEnvelope } from '../../shared/learnGraphSchema';

export const COMMUNITY_COLORS = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ac',
  '#86bcb6',
  '#d37295',
];

export function communityColor(id: string | number): string {
  const n = typeof id === 'number' ? id : Number.parseInt(id, 10);
  const i = Number.isFinite(n) ? n : Math.abs(hashCode(String(id)));
  return COMMUNITY_COLORS[i % COMMUNITY_COLORS.length];
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// Fences are structural only when both delimiters occupy their own lines.
// Route evidence may legitimately quote source containing strings such as
// `'```learn-graph\\n'`; a generic non-greedy matcher cuts the JSON at that
// quoted text even though the server sent a complete, validated envelope.
const FENCES = [
  /^```learn-graph[^\S\r\n]*\r?\n[\s\S]*?\r?\n```[^\S\r\n]*(?=\r?\n|$)/gim,
  /^```json[^\S\r\n]*\r?\n[\s\S]*?\r?\n```[^\S\r\n]*(?=\r?\n|$)/gim,
];

export type LearnLabelOverlay = LearnAnalysisEnvelope;

export function parseLearnOverlay(text: string): LearnLabelOverlay | null {
  let result: LearnLabelOverlay | null = null;
  for (const match of text.matchAll(
    /^```learn-graph[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```[^\S\r\n]*(?=\r?\n|$)/gim
  )) {
    try {
      const parsed = parseLearnAnalysisEnvelope(JSON.parse(match[1].trim()));
      if (parsed) result = parsed;
    } catch {
      // Keep scanning in case a later fence contains a corrected payload.
    }
  }
  return result;
}

export function applyLearnAnalysis(base: LearnGraph, text: string): LearnGraph {
  const overlay = parseLearnOverlay(text);
  if (!overlay) return base;
  const nodesByFile = new Map<string, LearnNode[]>();
  for (const node of base.nodes) {
    const file = node.file?.replace(/\\/g, '/');
    if (!file) continue;
    const matches = nodesByFile.get(file);
    if (matches) matches.push(node);
    else nodesByFile.set(file, [node]);
  }
  const findNode = (file: string, classSymbol: string) => {
    const candidates = nodesByFile.get(file.replace(/\\/g, '/')) || [];
    const normalized = classSymbol.toLowerCase();
    return candidates.find((candidate) => candidate.label.toLowerCase() === normalized);
  };
  const overlayByCommunity = new Map(overlay.communities.map((community) => [community.id, community]));
  const communities = base.communities.map((c) => {
    const o = overlayByCommunity.get(c.id);
    if (!o) return c;
    return {
      ...c,
      label: o.label || c.label,
      summary: o.summary || c.summary,
      entry: o.entry || c.entry,
    };
  });
  const idSet = new Set(communities.map((c) => c.id));
  const runtimePath = overlay.runtimePath.filter((id) => idSet.has(id));
  const businessRoutes = overlay.businessRoutes
    .map((route) => ({
      ...route,
      steps: route.steps.map((step) => {
        const file = step.file.replace(/\\/g, '/');
        const node = findNode(file, step.classSymbol);
        const nodeMatchesCommunity = node?.communityId === step.communityId;
        return {
          ...step,
          file,
          nodeId: nodeMatchesCommunity ? node.id : undefined,
        };
      }),
    }))
    .filter((route) => route.steps.every((step) => Boolean(step.nodeId)));
  return {
    ...base,
    communities,
    businessRoutes,
    runtimePath: runtimePath.length ? runtimePath : base.runtimePath,
  };
}

function businessRouteSignature(route: LearnBusinessRoute): string {
  return JSON.stringify(route.steps.map((step) => ({
    file: step.file.replace(/\\/g, '/').toLowerCase(),
    classSymbol: step.classSymbol.toLowerCase(),
    methodSymbol: step.methodSymbol.toLowerCase(),
    kind: step.kind,
    relation: step.relation,
    description: step.description,
    inputs: step.inputs,
    outputs: step.outputs,
    stateChanges: step.stateChanges,
    failurePaths: step.failurePaths,
  })));
}

export interface LearnGraphExpansionResult {
  hasOverlay: boolean;
  graph: LearnGraph;
  addedRoutes: LearnBusinessRoute[];
  invalidRouteLabels: string[];
  duplicateRouteLabels: string[];
}

/** Bind and append a manual supplement without changing accepted routes or labels. */
export function mergeLearnGraphExpansion(base: LearnGraph, text: string): LearnGraphExpansionResult {
  const overlay = parseLearnOverlay(text);
  if (!overlay) {
    return { hasOverlay: false, graph: base, addedRoutes: [], invalidRouteLabels: [], duplicateRouteLabels: [] };
  }
  const mapped = applyLearnAnalysis(base, text);
  const mappedIds = new Set(mapped.businessRoutes.map((route) => route.id));
  const invalidRouteLabels = overlay.businessRoutes
    .filter((route) => !mappedIds.has(route.id))
    .map((route) => route.label);
  if (invalidRouteLabels.length) {
    return { hasOverlay: true, graph: base, addedRoutes: [], invalidRouteLabels, duplicateRouteLabels: [] };
  }

  const routeIds = new Set(base.businessRoutes.map((route) => route.id));
  const signatures = new Set(base.businessRoutes.map(businessRouteSignature));
  const duplicateRouteLabels: string[] = [];
  for (const route of mapped.businessRoutes) {
    const signature = businessRouteSignature(route);
    if (routeIds.has(route.id) || signatures.has(signature)) duplicateRouteLabels.push(route.label);
    routeIds.add(route.id);
    signatures.add(signature);
  }
  if (duplicateRouteLabels.length) {
    return { hasOverlay: true, graph: base, addedRoutes: [], invalidRouteLabels: [], duplicateRouteLabels };
  }

  const graph = {
    ...base,
    businessRoutes: [...base.businessRoutes, ...mapped.businessRoutes],
  };
  return {
    hasOverlay: true,
    graph,
    addedRoutes: mapped.businessRoutes,
    invalidRouteLabels: [],
    duplicateRouteLabels: [],
  };
}

export function serializeLearnGraphReport(graph: LearnGraph, prose = ''): string {
  const envelope: LearnAnalysisEnvelope = {
    communities: graph.communities.map(({ id, label, summary, entry, files }) => ({
      id, label, summary, entry, files,
    })),
    businessRoutes: graph.businessRoutes.map((route) => ({
      ...route,
      steps: route.steps.map(({ nodeId: _nodeId, ...step }) => step),
    })),
    runtimePath: graph.runtimePath,
  };
  return `\`\`\`learn-graph\n${JSON.stringify(envelope)}\n\`\`\`${prose.trim() ? `\n\n${prose.trim()}` : ''}`;
}

export function looksLikeJsonBlob(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith('{') || t.startsWith('[') || t.startsWith('```')) return true;
  const afterProse = t.replace(/^[\s\S]*?(?=[{\[])/, '');
  if (afterProse !== t && /"(communities|businessRoutes|runtimePath)"\s*:/.test(afterProse)) return true;
  if (/"(communities|businessRoutes|runtimePath)"\s*:/.test(t) && t.includes('{')) return true;
  const brace = (t.match(/[{}]/g) || []).length;
  return brace >= 4 && /"(id|label|entry|files)"\s*:/.test(t);
}

function cutIncompleteGraphJson(text: string): string {
  let s = text;
  const fenceOpen = s.search(/```(?:learn-graph|json)\b/i);
  if (fenceOpen !== -1 && !/```(?:learn-graph|json)\s*[\s\S]*?```/i.test(s.slice(fenceOpen))) {
    s = s.slice(0, fenceOpen);
  }
  const idx = s.search(/"(?:communities|businessRoutes|runtimePath)"\s*:/);
  if (idx === -1) return s;
  let start = -1;
  let depth = 0;
  for (let i = idx; i >= 0; i--) {
    const ch = s[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) start = i;
      else depth--;
    }
  }
  return start !== -1 ? s.slice(0, start) : s.slice(0, idx);
}

export function visibleLearnProse(text: string): string {
  let s = text;
  for (const re of FENCES) s = s.replace(re, '');
  s = cutIncompleteGraphJson(s);
  s = s.replace(/```[\s\S]*?```/g, (block) =>
    /communities|businessRoutes|runtimePath/.test(block) ? '' : block
  );
  s = s.trim();
  if (!s || looksLikeJsonBlob(s)) return '';
  return s;
}

export function briefingFromGraph(graph: LearnGraph): string {
  const labels = graph.communities.map((c) => c.label).join('、');
  const path =
    graph.runtimePath
      .map((id) => graph.communities.find((c) => c.id === id)?.label)
      .filter(Boolean)
      .join(' → ') || labels;
  const routes = graph.businessRoutes
    .map((route) => {
      const steps = route.steps
        .map((step, index) => `${index + 1}. **${step.label}**（${step.relation}，\`${step.file} :: ${step.classSymbol}${step.methodSymbol ? `.${step.methodSymbol}` : ''}\`）${step.description}；证据：${step.evidence}`)
        .join('\n');
      return `#### ${route.label}\n${route.summary ? `${route.summary}\n\n` : ''}${steps}`;
    })
    .join('\n\n');
  const order = graph.communities
    .map((c, i) => {
      const entry = c.entry
        ? `（先读 \`${c.entry.file}${c.entry.symbol ? ` :: ${c.entry.symbol}` : ''}\`）`
        : c.godNodes[0]
          ? `（枢纽 ${c.godNodes[0]}）`
          : '';
      const extra = c.summary ? `：${c.summary}` : '';
      return `${i + 1}. **${c.label}**${entry}${extra}`;
    })
    .join('\n');
  const parts = [
    `### 这是什么\nAI 从源码中识别出 ${graph.businessRoutes.length} 条主要业务路线，涉及这些职责社区：${labels}。`,
    `### 社区主路径\n${path}`,
  ];
  if (routes) parts.push(`### 主要业务路线\n${routes}`);
  parts.push(`### 建议阅读顺序\n${order}`);
  return parts.join('\n\n');
}

export function humanizeLearnReport(
  text: string,
  base?: LearnGraph | null
): { graph: LearnGraph | null; prose: string } {
  const prose = visibleLearnProse(text);
  if (base && base.nodes.length + base.communities.length > 0) {
    const graph = applyLearnAnalysis(base, text);
    return { graph, prose: prose || briefingFromGraph(graph) };
  }
  const overlay = parseLearnOverlay(text);
  if (!overlay) return { graph: base ?? null, prose };
  const graph: LearnGraph = {
    nodes: [],
    edges: [],
    communities: overlay.communities.map((c) => ({
      id: c.id,
      label: c.label,
      summary: c.summary,
      entry: c.entry,
      files: c.files,
      godNodes: [],
      cohesion: 0,
      nodeCount: c.files.length,
    })),
    businessRoutes: [],
    runtimePath: overlay.runtimePath,
    godNodes: [],
    bridges: [],
    stats: {
      filesParsed: 0,
      symbolCount: 0,
      edgeCount: 0,
      truncated: false,
      sourceFingerprint: '',
    },
  };
  return { graph, prose: prose || briefingFromGraph(graph) };
}
