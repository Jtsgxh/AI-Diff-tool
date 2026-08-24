import type {
  LearnBusinessRoute,
  LearnCommunity,
  LearnGraph,
} from '../types';

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

const FENCES = [
  /```learn-graph\s*([\s\S]*?)```/i,
  /```json\s*([\s\S]*?)```/i,
];

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extractBalancedObject(text: string, from: number): string | null {
  let depth = 0;
  let start = -1;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) return text.slice(start, i + 1);
    }
  }
  return null;
}

function extractObjectContainingCommunities(text: string): string | null {
  const idx = text.search(/"communities"\s*:/);
  if (idx === -1) return null;
  let start = -1;
  let depth = 0;
  for (let i = idx; i >= 0; i--) {
    const ch = text[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) start = i;
      else depth--;
    }
  }
  if (start === -1) return null;
  return extractBalancedObject(text, start);
}

function extractJsonCandidate(text: string): string | null {
  let candidate: string | null = null;
  const matches = text.matchAll(/```(?:learn-graph|json)\s*([\s\S]*?)```/gi);
  for (const match of matches) {
    const inner = match[1].trim();
    if (/"communities"\s*:/.test(inner)) candidate = inner;
  }
  return candidate || extractObjectContainingCommunities(text);
}

function parseJsonLoose(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

export interface LearnLabelOverlay {
  communities: Pick<LearnCommunity, 'id' | 'label' | 'summary' | 'entry' | 'files'>[];
  businessRoutes: LearnBusinessRoute[];
  runtimePath: string[];
}

function coerceOverlay(raw: unknown): LearnLabelOverlay | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as {
    communities?: unknown;
    businessRoutes?: unknown;
    runtimePath?: unknown;
  };
  if (!Array.isArray(src.communities)) return null;
  const communities: LearnLabelOverlay['communities'] = [];
  const ids = new Set<string>();
  for (const item of src.communities) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = asString(row.id);
    const label = asString(row.label) || asString(row.name);
    if (!id || !label || ids.has(id)) continue;
    const files = Array.isArray(row.files)
      ? row.files.map((f) => asString(f).replace(/\\/g, '/')).filter(Boolean)
      : [];
    let entry: LearnCommunity['entry'];
    if (row.entry && typeof row.entry === 'object') {
      const e = row.entry as Record<string, unknown>;
      const file = asString(e.file).replace(/\\/g, '/');
      if (file) entry = { file, symbol: asString(e.symbol) || undefined };
    }
    ids.add(id);
    communities.push({ id, label, summary: asString(row.summary), entry, files });
  }
  if (communities.length === 0) return null;
  if (!Array.isArray(src.businessRoutes)) return null;
  const businessRoutes: LearnBusinessRoute[] = [];
  const routeIds = new Set<string>();
  for (const item of src.businessRoutes) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = asString(row.id);
    const label = asString(row.label);
    if (!id || !label || routeIds.has(id) || !Array.isArray(row.steps)) continue;
    const steps: LearnBusinessRoute['steps'] = [];
    for (const value of row.steps) {
      if (!value || typeof value !== 'object') continue;
      const step = value as Record<string, unknown>;
      const file = asString(step.file).replace(/\\/g, '/');
      const stepLabel = asString(step.label);
      const description = asString(step.description);
      const relation = asString(step.relation);
      const evidence = asString(step.evidence);
      if (!file || !stepLabel || !description || !relation || !evidence) continue;
      steps.push({
        label: stepLabel,
        description,
        relation,
        evidence,
        file,
        symbol: asString(step.symbol) || undefined,
        communityId: asString(step.communityId) || undefined,
      });
    }
    if (steps.length < 2) continue;
    routeIds.add(id);
    businessRoutes.push({
      id,
      label,
      summary: asString(row.summary),
      steps,
    });
  }
  const idSet = new Set(communities.map((c) => c.id));
  const runtimePath = Array.isArray(src.runtimePath)
    ? src.runtimePath.map((x) => asString(x)).filter((id) => idSet.has(id))
    : communities.map((c) => c.id);
  return { communities, businessRoutes, runtimePath };
}

export function parseLearnOverlay(text: string): LearnLabelOverlay | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;
  return coerceOverlay(parseJsonLoose(candidate));
}

export function applyLearnAnalysis(base: LearnGraph, text: string): LearnGraph {
  const overlay = parseLearnOverlay(text);
  if (!overlay) return base;
  const byId = new Map(overlay.communities.map((c) => [c.id, c]));
  const communities = base.communities.map((c) => {
    const o =
      byId.get(c.id) ||
      byId.get(String(Number(c.id))) ||
      byId.get(c.id.replace(/^c/i, '')) ||
      overlay.communities.find(
        (x) => x.files.some((f) => c.files.includes(f)) && x.label
      );
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
  const businessRoutes = overlay.businessRoutes.map((route) => ({
    ...route,
    steps: route.steps.map((step) => {
      const file = step.file.replace(/\\/g, '/');
      const candidates = base.nodes.filter((node) => node.file?.replace(/\\/g, '/') === file);
      const node = step.symbol
        ? candidates.find(
            (candidate) =>
              candidate.label.toLowerCase() === step.symbol!.toLowerCase() ||
              candidate.symbols?.some(
                (symbol) => symbol.toLowerCase() === step.symbol!.toLowerCase()
              )
          )
        : candidates[0];
      const declaredCommunity = step.communityId && idSet.has(step.communityId)
        ? step.communityId
        : undefined;
      const fileCommunity = communities.find((community) => community.files.includes(file));
      return {
        ...step,
        file,
        nodeId: node?.id,
        communityId: node?.communityId || declaredCommunity || fileCommunity?.id,
      };
    }),
  }));
  return {
    ...base,
    communities,
    businessRoutes,
    runtimePath: runtimePath.length ? runtimePath : base.runtimePath,
  };
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
        .map((step, index) => `${index + 1}. **${step.label}**（${step.relation}，\`${step.file}${step.symbol ? ` :: ${step.symbol}` : ''}\`）${step.description}；证据：${step.evidence}`)
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
    businessRoutes: overlay.businessRoutes,
    runtimePath: overlay.runtimePath,
    godNodes: [],
    bridges: [],
    stats: { filesParsed: 0, symbolCount: 0, edgeCount: 0, truncated: false },
  };
  return { graph, prose: prose || briefingFromGraph(graph) };
}
