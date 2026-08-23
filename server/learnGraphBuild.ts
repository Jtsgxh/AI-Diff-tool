import fs from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import { LruCache } from './cache/lru';
import type {
  LearnBridge,
  LearnCommunity,
  LearnEdge,
  LearnGodNode,
  LearnGraph,
  LearnNode,
  LearnNodeKind,
  LearnRelation,
} from '../shared/types';

const MAX_FILES = 600;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_VIZ_NODES = 360;
const MAX_REF_EDGES_PER_FILE = 36;
const DIGEST_CHARS = 12_000;

const SKIP_DIR =
  /(?:^|\/)(?:node_modules|dist|build|bin|obj|target|vendor|__pycache__|\.git|Library|Temp|Logs|DerivedData|Pods|coverage)(?:\/|$)/i;

const SOURCE_EXT = new Set([
  '.cs',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.java',
  '.kt',
  '.rs',
  '.lua',
  '.cpp',
  '.cc',
  '.cxx',
  '.c',
  '.h',
  '.hpp',
  '.swift',
  '.rb',
  '.php',
  '.vue',
]);

const SKIP_NAME = new Set(
  [
    'string',
    'int',
    'float',
    'bool',
    'boolean',
    'void',
    'object',
    'var',
    'let',
    'const',
    'this',
    'self',
    'super',
    'function',
    'class',
    'public',
    'private',
    'return',
    'true',
    'false',
    'null',
    'undefined',
    'none',
    'task',
    'list',
    'dict',
    'map',
    'array',
    'vector3',
    'monobehaviour',
    'scriptableobject',
    'gameobject',
    'transform',
    'component',
    'exception',
    'type',
    'error',
    'promise',
    'object',
    'system',
    'unityengine',
    'debug',
    'mathf',
    'time',
    'input',
    'random',
    'console',
    'window',
    'document',
    'export',
    'import',
    'from',
    'await',
    'async',
  ].map((s) => s.toLowerCase())
);

const graphCache = new LruCache<LearnGraph>(12);

interface RawNode {
  id: string;
  label: string;
  kind: LearnNodeKind;
  file?: string;
}

interface RawEdge {
  source: string;
  target: string;
  relation: LearnRelation;
}

function extOf(file: string): string {
  const dot = file.lastIndexOf('.');
  const slash = file.lastIndexOf('/');
  return dot > slash ? file.slice(dot).toLowerCase() : '';
}

function shouldSkip(file: string): boolean {
  if (SKIP_DIR.test(file)) return true;
  if (/\.(meta|min\.js|d\.ts|g\.cs|designer\.cs)$/i.test(file)) return true;
  if (/\.(test|spec|stories)\./i.test(file)) return true;
  return !SOURCE_EXT.has(extOf(file));
}

function joinRel(fromFile: string, spec: string): string {
  const dir = fromFile.split('/').slice(0, -1);
  const parts = spec.replace(/\\/g, '/').split('/');
  const out = [...dir];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function stripNoise(src: string, ext: string): string {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/^\s*\/\/.*$/gm, ' ');
  if (ext === '.py' || ext === '.rb') s = s.replace(/^\s*#.*$/gm, ' ');
  s = s.replace(/`(?:\\.|[^`\\])*`/g, ' ');
  s = s.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' ');
  return s;
}

function addEdge(edges: RawEdge[], seen: Set<string>, source: string, target: string, relation: LearnRelation) {
  if (!source || !target || source === target) return;
  const key = `${source}|${target}|${relation}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ source, target, relation });
}

interface ExtractedFile {
  path: string;
  types: { name: string; kind: LearnNodeKind; bases: string[] }[];
  imports: string[];
}

function extractFile(file: string, src: string): ExtractedFile {
  const ext = extOf(file);
  const types: ExtractedFile['types'] = [];
  const imports: string[] = [];
  const seenType = new Set<string>();

  const pushType = (name: string, kind: LearnNodeKind, bases: string[] = []) => {
    if (!name || name.length < 2 || SKIP_NAME.has(name.toLowerCase())) return;
    if (seenType.has(name)) return;
    seenType.add(name);
    types.push({
      name,
      kind,
      bases: bases
        .map((b) => b.replace(/<.*>/g, '').replace(/[^\w.]/g, '').split('.').pop() || '')
        .filter((b) => b && b.length > 1 && !SKIP_NAME.has(b.toLowerCase())),
    });
  };

  if (ext === '.cs' || ext === '.java' || ext === '.kt') {
    const typeRe =
      /\b(?:(?:public|private|internal|protected|static|abstract|sealed|partial|readonly|new|open|inner|data|final)\s+)*(class|struct|interface|enum|record)\s+([A-Za-z_]\w*)(?:\s*<[^>]+>)?(?:\s*(?:[:]|extends|implements)\s*([^{]+))?/g;
    let m: RegExpExecArray | null;
    while ((m = typeRe.exec(src))) {
      const bases = m[3] ? m[3].split(/[,]/).map((s) => s.trim()) : [];
      const kind: LearnNodeKind =
        m[1] === 'interface' ? 'interface' : m[1] === 'enum' ? 'enum' : 'class';
      pushType(m[2], kind, bases);
    }
  } else if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs' || ext === '.vue') {
    const typeRe =
      /\b(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(class|interface|enum|function)\s+([A-Za-z_]\w*)(?:\s+extends\s+([A-Za-z_]\w*))?(?:\s+implements\s+([^{]+))?/g;
    let m: RegExpExecArray | null;
    while ((m = typeRe.exec(src))) {
      if (m[1] === 'function' && m[2] === 'function') continue;
      const bases = [m[3], ...(m[4] ? m[4].split(',') : [])].filter(Boolean) as string[];
      const kind: LearnNodeKind =
        m[1] === 'interface' ? 'interface' : m[1] === 'enum' ? 'enum' : m[1] === 'function' ? 'function' : 'class';
      pushType(m[2], kind, bases);
    }
    const impRe = /(?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\(\s*)['"]([^'"]+)['"]/g;
    while ((m = impRe.exec(src))) imports.push(m[1]);
  } else if (ext === '.py') {
    const classRe = /^class\s+([A-Za-z_]\w*)(?:\(([^)]*)\))?:/gm;
    let m: RegExpExecArray | null;
    while ((m = classRe.exec(src))) {
      pushType(m[1], 'class', m[2] ? m[2].split(',') : []);
    }
    const fromRe = /^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
    while ((m = fromRe.exec(src))) imports.push((m[1] || m[2] || '').replace(/\./g, '/'));
  } else if (ext === '.go') {
    const typeRe = /\btype\s+([A-Za-z_]\w*)\s+(struct|interface)\b/g;
    let m: RegExpExecArray | null;
    while ((m = typeRe.exec(src))) {
      pushType(m[1], m[2] === 'interface' ? 'interface' : 'class');
    }
    const impRe = /"([^"]+)"/g;
    const importBlock = src.match(/import\s*(?:\(([\s\S]*?)\)|"([^"]+)")/);
    if (importBlock) {
      const body = importBlock[1] || importBlock[2] || '';
      while ((m = impRe.exec(body))) imports.push(m[1]);
    }
  } else if (ext === '.rs') {
    const typeRe = /\b(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait|mod|type)\s+([A-Za-z_]\w*)/g;
    let m: RegExpExecArray | null;
    while ((m = typeRe.exec(src))) {
      const kind: LearnNodeKind =
        m[1] === 'trait' ? 'interface' : m[1] === 'enum' ? 'enum' : m[1] === 'mod' ? 'module' : 'class';
      pushType(m[2], kind);
    }
  } else {
    const typeRe = /\b(?:class|struct|interface|enum|func(?:tion)?|def)\s+([A-Za-z_]\w*)/g;
    let m: RegExpExecArray | null;
    while ((m = typeRe.exec(src))) pushType(m[1], 'class');
  }

  return { path: file, types, imports };
}

function resolveImport(fromFile: string, spec: string, files: Set<string>): string | null {
  if (!spec || spec.startsWith('http')) return null;
  const cleaned = spec.replace(/\\/g, '/').replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, '');
  const tryPaths = (base: string): string | null => {
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.jsx`,
      `${base}.mjs`,
      `${base}.py`,
      `${base}.go`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
      `${base}/index.js`,
      `${base}/__init__.py`,
    ];
    for (const c of candidates) {
      if (files.has(c)) return c;
    }
    return null;
  };
  if (spec.startsWith('.')) return tryPaths(joinRel(fromFile, cleaned));
  // python-style module path already converted to slashes
  if (!spec.includes('/') && !cleaned.includes('/')) return null;
  return tryPaths(cleaned) || tryPaths(joinRel('', cleaned));
}

function detectCommunities(nodeIds: string[], edges: RawEdge[]): Map<string, number> {
  const adj = new Map<string, Map<string, number>>();
  const idSet = new Set(nodeIds);
  const weightOf = (rel: LearnRelation) =>
    rel === 'inherits' ? 3 : rel === 'imports' ? 2 : 1;

  const bump = (a: string, b: string, w: number) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Map());
    if (!adj.has(b)) adj.set(b, new Map());
    adj.get(a)!.set(b, (adj.get(a)!.get(b) || 0) + w);
    adj.get(b)!.set(a, (adj.get(b)!.get(a) || 0) + w);
  };
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    bump(e.source, e.target, weightOf(e.relation));
  }

  const k = new Map<string, number>();
  let m = 0;
  for (const id of nodeIds) {
    let s = 0;
    for (const w of adj.get(id)?.values() || []) s += w;
    k.set(id, s);
    m += s;
  }
  m /= 2;
  if (m <= 0) return new Map(nodeIds.map((id, i) => [id, i]));

  const comm = new Map<string, number>();
  nodeIds.forEach((id, i) => comm.set(id, i));
  const tot = new Map<number, number>();
  for (const id of nodeIds) tot.set(comm.get(id)!, k.get(id) || 0);

  for (let iter = 0; iter < 15; iter++) {
    let moved = false;
    for (const id of nodeIds) {
      const ki = k.get(id) || 0;
      if (ki === 0) continue;
      const cur = comm.get(id)!;
      const neighborWeight = new Map<number, number>();
      for (const [nb, w] of adj.get(id) || []) {
        const c = comm.get(nb);
        if (c === undefined) continue;
        neighborWeight.set(c, (neighborWeight.get(c) || 0) + w);
      }
      tot.set(cur, (tot.get(cur) || 0) - ki);
      comm.set(id, -1);
      let best = cur;
      let bestGain = 0;
      for (const [c, kiin] of neighborWeight) {
        const sigmaTot = tot.get(c) || 0;
        const gain = kiin / m - (sigmaTot * ki) / (2 * m * m);
        if (gain > bestGain + 1e-12) {
          bestGain = gain;
          best = c;
        }
      }
      comm.set(id, best);
      tot.set(best, (tot.get(best) || 0) + ki);
      if (best !== cur) moved = true;
    }
    if (!moved) break;
  }

  return comm;
}

function compactCommunities(
  nodeIds: string[],
  nodes: Map<string, RawNode>,
  edges: RawEdge[],
  raw: Map<string, number>
): Map<string, string> {
  const members = new Map<number, string[]>();
  for (const id of nodeIds) {
    const c = raw.get(id);
    if (c === undefined) continue;
    if (!members.has(c)) members.set(c, []);
    members.get(c)!.push(id);
  }

  const cut = (a: string[], b: Set<string>) => {
    let n = 0;
    for (const e of edges) {
      const aHas = a.includes(e.source) || a.includes(e.target);
      if (!aHas) continue;
      if (b.has(e.source) || b.has(e.target)) n++;
    }
    return n;
  };

  let groups = [...members.values()].filter((g) => g.length > 0);
  groups.sort((a, b) => b.length - a.length);

  const dirOf = (id: string) => {
    const file = nodes.get(id)?.file || id.replace(/^f:/, '');
    const slash = file.indexOf('/');
    return slash === -1 ? '(root)' : file.slice(0, slash);
  };

  if (groups.length < 4 && nodeIds.length > 24) {
    const next: string[][] = [];
    for (const g of groups) {
      if (g.length < 16) {
        next.push(g);
        continue;
      }
      const byDir = new Map<string, string[]>();
      for (const id of g) {
        const d = dirOf(id);
        if (!byDir.has(d)) byDir.set(d, []);
        byDir.get(d)!.push(id);
      }
      const parts = [...byDir.values()].sort((a, b) => b.length - a.length);
      if (parts.length >= 2) next.push(...parts);
      else next.push(g);
    }
    groups = next;
  }

  while (groups.length > 8) {
    groups.sort((a, b) => a.length - b.length);
    const small = groups.shift()!;
    let bestI = 0;
    let bestCut = -1;
    for (let i = 0; i < groups.length; i++) {
      const c = cut(small, new Set(groups[i]));
      if (c > bestCut) {
        bestCut = c;
        bestI = i;
      }
    }
    groups[bestI] = groups[bestI].concat(small);
  }

  groups.sort((a, b) => b.length - a.length);
  const out = new Map<string, string>();
  groups.forEach((g, i) => {
    const cid = String(i);
    for (const id of g) out.set(id, cid);
  });
  return out;
}

function cohesionOf(memberIds: Set<string>, edges: RawEdge[]): number {
  let inner = 0;
  let outer = 0;
  for (const e of edges) {
    const a = memberIds.has(e.source);
    const b = memberIds.has(e.target);
    if (a && b) inner++;
    else if (a || b) outer++;
  }
  const denom = inner + outer;
  return denom === 0 ? 0 : inner / denom;
}

export function buildLearnGraphFromFiles(files: { path: string; content: string }[]): LearnGraph {
  const fileSet = new Set(files.map((f) => f.path));
  const nodes = new Map<string, RawNode>();
  const edges: RawEdge[] = [];
  const seenEdge = new Set<string>();
  const typesByName = new Map<string, string[]>();
  const fileTypes = new Map<string, string[]>();
  const pendingInherits: { from: string; base: string }[] = [];
  let filesParsed = 0;

  const fileId = (p: string) => `f:${p}`;
  const typeId = (p: string, name: string) => `t:${p}::${name}`;

  for (const { path: file, content } of files) {
    if (!content || content.includes('\0')) continue;
    filesParsed++;
    const fid = fileId(file);
    nodes.set(fid, { id: fid, label: file.split('/').pop() || file, kind: 'file', file });
    const extracted = extractFile(file, content);
    const tIds: string[] = [];
    for (const t of extracted.types) {
      const id = typeId(file, t.name);
      nodes.set(id, { id, label: t.name, kind: t.kind, file });
      tIds.push(id);
      addEdge(edges, seenEdge, fid, id, 'contains');
      if (!typesByName.has(t.name)) typesByName.set(t.name, []);
      typesByName.get(t.name)!.push(id);
      for (const base of t.bases) pendingInherits.push({ from: id, base });
    }
    fileTypes.set(file, tIds);

    for (const spec of extracted.imports) {
      const resolved = resolveImport(file, spec, fileSet);
      if (resolved) addEdge(edges, seenEdge, fid, fileId(resolved), 'imports');
    }
  }

  for (const { from, base } of pendingInherits) {
    for (const tgt of typesByName.get(base) || []) {
      addEdge(edges, seenEdge, from, tgt, 'inherits');
    }
  }

  for (const { path: file, content } of files) {
    const noise = stripNoise(content, extOf(file));
    const fromIds = fileTypes.get(file) || [];
    if (fromIds.length === 0 && !nodes.has(fileId(file))) continue;
    let added = 0;
    const used = new Set<string>();
    const identRe = /\b[A-Z][A-Za-z0-9_]{2,}\b/g;
    let m: RegExpExecArray | null;
    while ((m = identRe.exec(noise))) {
      const name = m[0];
      if (SKIP_NAME.has(name.toLowerCase()) || used.has(name)) continue;
      const targets = typesByName.get(name);
      if (!targets) continue;
      used.add(name);
      for (const tgt of targets) {
        if (tgt.startsWith(`t:${file}::`)) continue;
        const src = fromIds[0] || fileId(file);
        addEdge(edges, seenEdge, src, tgt, 'references');
        added++;
        if (added >= MAX_REF_EDGES_PER_FILE) break;
      }
      if (added >= MAX_REF_EDGES_PER_FILE) break;
    }
  }

  const live = new Set<string>();
  for (const e of edges) {
    live.add(e.source);
    live.add(e.target);
  }
  for (const [id, n] of nodes) {
    if (n.kind !== 'file' || live.has(id)) live.add(id);
  }

  let nodeList = [...live].filter((id) => nodes.has(id));
  const degree = new Map<string, number>();
  for (const id of nodeList) degree.set(id, 0);
  for (const e of edges) {
    if (!live.has(e.source) || !live.has(e.target)) continue;
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }
  const connected = nodeList.filter((id) => (degree.get(id) || 0) > 0);
  if (connected.length >= 8) nodeList = connected;

  if (nodeList.length === 0) {
    return {
      nodes: [],
      edges: [],
      communities: [],
      runtimePath: [],
      godNodes: [],
      bridges: [],
      stats: { filesParsed, symbolCount: 0, edgeCount: 0, truncated: false },
    };
  }

  let truncated = false;
  if (nodeList.length > MAX_VIZ_NODES) {
    truncated = true;
    nodeList.sort((a, b) => (degree.get(b) || 0) - (degree.get(a) || 0));
    const keep = new Set(nodeList.slice(0, MAX_VIZ_NODES));
    nodeList = nodeList.filter((id) => keep.has(id));
  }
  const keepSet = new Set(nodeList);
  const liveEdges = edges.filter((e) => keepSet.has(e.source) && keepSet.has(e.target));

  const rawComm = detectCommunities(nodeList, liveEdges);
  const commOf = compactCommunities(nodeList, nodes, liveEdges, rawComm);

  const byComm = new Map<string, string[]>();
  for (const id of nodeList) {
    const c = commOf.get(id) || '0';
    if (!byComm.has(c)) byComm.set(c, []);
    byComm.get(c)!.push(id);
  }

  const learnNodes: LearnNode[] = nodeList.map((id) => {
    const n = nodes.get(id)!;
    return {
      id,
      label: n.label,
      kind: n.kind,
      file: n.file,
      communityId: commOf.get(id) || '0',
      degree: degree.get(id) || 0,
    };
  });

  const communities: LearnCommunity[] = [...byComm.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([id, members]) => {
      const set = new Set(members);
      const ranked = members
        .slice()
        .sort((a, b) => (degree.get(b) || 0) - (degree.get(a) || 0));
      const god = ranked.filter((m) => nodes.get(m)?.kind !== 'file').slice(0, 4);
      const godLabels = (god.length ? god : ranked.slice(0, 3)).map((m) => nodes.get(m)!.label);
      const files = [
        ...new Set(
          members
            .map((m) => nodes.get(m)?.file)
            .filter((f): f is string => Boolean(f))
        ),
      ].slice(0, 12);
      const top = nodes.get(ranked[0]);
      return {
        id,
        label: godLabels[0] || top?.label || `社区 ${Number(id) + 1}`,
        summary: '',
        files,
        godNodes: godLabels,
        cohesion: cohesionOf(set, liveEdges),
        nodeCount: members.length,
        entry: files[0] ? { file: files[0], symbol: godLabels[0] } : undefined,
      };
    });

  const godNodes: LearnGodNode[] = learnNodes
    .filter((n) => n.kind !== 'file')
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 8)
    .map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      file: n.file,
      degree: n.degree,
    }));

  const bridges: LearnBridge[] = [];
  const seenBridge = new Set<string>();
  for (const e of liveEdges) {
    const a = commOf.get(e.source);
    const b = commOf.get(e.target);
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a}|${b}|${e.source}|${e.target}` : `${b}|${a}|${e.target}|${e.source}`;
    if (seenBridge.has(key)) continue;
    seenBridge.add(key);
    bridges.push({
      source: e.source,
      target: e.target,
      sourceLabel: nodes.get(e.source)?.label || e.source,
      targetLabel: nodes.get(e.target)?.label || e.target,
      sourceCommunity: a,
      targetCommunity: b,
      relation: e.relation,
    });
  }
  bridges.sort((x, y) => {
    const dx = (degree.get(x.source) || 0) + (degree.get(x.target) || 0);
    const dy = (degree.get(y.source) || 0) + (degree.get(y.target) || 0);
    return dy - dx;
  });

  const runtimePath = communities.map((c) => c.id);

  return {
    nodes: learnNodes,
    edges: liveEdges,
    communities,
    runtimePath,
    godNodes,
    bridges: bridges.slice(0, 14),
    stats: {
      filesParsed,
      symbolCount: learnNodes.filter((n) => n.kind !== 'file').length,
      edgeCount: liveEdges.length,
      truncated,
    },
  };
}

export async function buildLearnGraph(repoPath: string): Promise<LearnGraph> {
  const git = simpleGit(repoPath);
  let head = '';
  try {
    head = (await git.raw(['rev-parse', 'HEAD'])).trim();
  } catch {
    head = '';
  }
  const cacheKey = `${repoPath}::${head}`;
  const cached = graphCache.get(cacheKey);
  if (cached) return cached;

  let listed: string[] = [];
  try {
    listed = (await git.raw(['-c', 'core.quotepath=false', 'ls-files']))
      .split('\n')
      .map((s) => s.replace(/\\/g, '/').trim())
      .filter(Boolean);
  } catch {
    listed = [];
  }

  const candidates = listed.filter((f) => !shouldSkip(f));
  const rank = (f: string) => {
    const base = f.toLowerCase();
    if (/(^|\/)(src|app|lib|server|assets\/scripts)\//.test(base)) return 0;
    if (/(^|\/)(test|tests|spec|__tests__)\//.test(base)) return 2;
    return 1;
  };
  candidates.sort((a, b) => rank(a) - rank(b) || a.length - b.length);

  const picked = candidates.slice(0, MAX_FILES);
  const files: { path: string; content: string }[] = [];
  for (const rel of picked) {
    try {
      const full = path.join(repoPath, rel);
      const st = fs.statSync(full);
      if (!st.isFile() || st.size > MAX_FILE_BYTES || st.size === 0) continue;
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes('\0')) continue;
      files.push({ path: rel, content });
    } catch {
      // unreadable
    }
  }

  const graph = buildLearnGraphFromFiles(files);
  graphCache.set(cacheKey, graph);
  return graph;
}

export function formatLearnGraphDigest(graph: LearnGraph): string {
  const commName = (id: string) => graph.communities.find((c) => c.id === id)?.label || id;
  const lines: string[] = [];
  lines.push('【结构图谱 · 本地解析 · EXTRACTED】');
  lines.push(
    `${graph.nodes.length} 节点 · ${graph.stats.edgeCount} 边 · ${graph.communities.length} 社区 · ${graph.stats.filesParsed} 文件（符号 ${graph.stats.symbolCount}）${graph.stats.truncated ? ' · 已裁剪大图' : ''}`
  );
  lines.push('节点=文件/类型，边=contains/imports/references/inherits。这些不是模型编的。');
  lines.push('');
  lines.push('枢纽 God nodes（度最高）：');
  for (const g of graph.godNodes.slice(0, 8)) {
    lines.push(`- ${g.label}  ${g.kind}  度${g.degree}  ${g.file || ''}`);
  }
  if (graph.bridges.length) {
    lines.push('');
    lines.push('跨社区桥：');
    for (const b of graph.bridges.slice(0, 10)) {
      lines.push(
        `- ${b.sourceLabel} --${b.relation}--> ${b.targetLabel}  (${commName(b.sourceCommunity)} → ${commName(b.targetCommunity)})`
      );
    }
  }
  lines.push('');
  for (const c of graph.communities) {
    lines.push(
      `社区 ${c.id}  cohesion=${c.cohesion.toFixed(2)}  ${c.nodeCount}节点  默认名:${c.label}`
    );
    if (c.godNodes.length) lines.push(`  枢纽: ${c.godNodes.join(', ')}`);
    if (c.files.length) lines.push(`  文件: ${c.files.slice(0, 8).join(', ')}`);
  }
  let text = lines.join('\n');
  if (text.length > DIGEST_CHARS) text = `${text.slice(0, DIGEST_CHARS)}\n…(图谱摘要已截断)`;
  return text;
}
