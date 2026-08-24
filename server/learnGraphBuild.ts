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

// Local parsing and browser rendering still need resource protection, but the
// previous limits were sized for small demos and silently hid most real repos.
const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_VIZ_NODES = 1_500;
const MAX_REF_EDGES_PER_FILE = 128;
const DIGEST_CHARS = 120_000;

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
  symbols?: string[];
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

interface ClassLevelOwner {
  id: string;
  label: string;
  kind: 'class' | 'component' | 'module';
  file: string;
  bases: string[];
  symbols: string[];
  source: string;
  hasBehavior: boolean;
}

const CONTROL_WORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'typeof',
  'sizeof',
  'new',
  'await',
  'async',
  'function',
  'constructor',
]);

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maskSource(src: string): string {
  const chars = src.split('');
  let state: 'normal' | 'line' | 'block' | 'string' | 'template' | 'regex' = 'normal';
  let quote = '';
  let escaped = false;
  let regexClass = false;
  let previous = '';
  const hide = (index: number) => {
    if (chars[index] !== '\r' && chars[index] !== '\n') chars[index] = ' ';
  };

  for (let index = 0; index < src.length; index++) {
    const ch = src[index];
    const next = src[index + 1] || '';
    if (state === 'line') {
      if (ch === '\r' || ch === '\n') state = 'normal';
      else hide(index);
      continue;
    }
    if (state === 'block') {
      hide(index);
      if (ch === '*' && next === '/') {
        hide(index + 1);
        index++;
        state = 'normal';
      }
      continue;
    }
    if (state === 'string' || state === 'template') {
      hide(index);
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        state = 'normal';
      }
      continue;
    }
    if (state === 'regex') {
      hide(index);
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '[') {
        regexClass = true;
      } else if (ch === ']') {
        regexClass = false;
      } else if (ch === '/' && !regexClass) {
        while (/[A-Za-z]/.test(src[index + 1] || '')) {
          hide(++index);
        }
        state = 'normal';
        previous = '/';
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      hide(index);
      hide(index + 1);
      index++;
      state = 'line';
      continue;
    }
    if (ch === '/' && next === '*') {
      hide(index);
      hide(index + 1);
      index++;
      state = 'block';
      continue;
    }
    if (ch === '"' || ch === "'") {
      hide(index);
      state = 'string';
      quote = ch;
      escaped = false;
      continue;
    }
    if (ch === '`') {
      hide(index);
      state = 'template';
      quote = ch;
      escaped = false;
      continue;
    }
    if (ch === '/' && (!previous || /[([{=:;,!?&|+\-*%^~<>]/.test(previous))) {
      hide(index);
      state = 'regex';
      escaped = false;
      regexClass = false;
      continue;
    }
    if (!/\s/.test(ch)) previous = ch;
  }
  return chars.join('');
}

function blockSource(src: string, declarationStart: number, searchFrom = declarationStart): string {
  const masked = maskSource(src);
  const open = masked.indexOf('{', searchFrom);
  if (open === -1) return src.slice(declarationStart);
  let depth = 0;
  for (let index = open; index < masked.length; index++) {
    if (masked[index] === '{') depth++;
    else if (masked[index] === '}') {
      depth--;
      if (depth === 0) return src.slice(declarationStart, index + 1);
    }
  }
  return src.slice(declarationStart);
}

function declarationSource(
  src: string,
  name: string,
  kind: 'class' | 'component'
): string {
  const escaped = escapeRegex(name);
  const masked = maskSource(src);
  if (kind === 'class') {
    const match = new RegExp(`\\b(?:class|struct|record)\\s+${escaped}\\b`).exec(masked);
    return match ? blockSource(src, match.index) : src;
  }
  const fn = new RegExp(`\\bfunction\\s+${escaped}\\b`).exec(masked);
  if (fn) return blockSource(src, fn.index);
  const variable = new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\b`).exec(masked);
  if (!variable) return src;
  const arrow = src.indexOf('=>', variable.index);
  return blockSource(src, variable.index, arrow === -1 ? variable.index : arrow + 2);
}

function callableNames(src: string): string[] {
  const names = new Set<string>();
  const masked = maskSource(src);
  let match: RegExpExecArray | null;
  const functionRe = /\b(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(/g;
  while ((match = functionRe.exec(masked))) names.add(match[1]);
  const defRe = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm;
  while ((match = defRe.exec(masked))) names.add(match[1]);
  const goRe = /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/g;
  while ((match = goRe.exec(masked))) names.add(match[1]);
  const luaRe = /\bfunction\s+([A-Za-z_]\w*)\s*\(/g;
  while ((match = luaRe.exec(masked))) names.add(match[1]);
  const variableRe = /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*(?::[^=;\r\n]+)?=\s*(?:async\s*)?(?:function\b|(?:\([^;\r\n]*\)|[A-Za-z_]\w*)\s*=>)/g;
  while ((match = variableRe.exec(masked))) names.add(match[1]);
  return [...names];
}

function exportedValueNames(src: string): string[] {
  const names = new Set<string>();
  const masked = maskSource(src);
  const valueRe = /\bexport\s+(?:default\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = valueRe.exec(masked))) names.add(match[1]);
  return [...names];
}

function receiverTypes(src: string): Map<string, string> {
  const types = new Map<string, string>();
  const masked = maskSource(src);
  let match: RegExpExecArray | null;
  const javaLikeRe = /\b([A-Z][A-Za-z0-9_$.]*(?:<[^;={}()]+>)?)\s+([a-z_][A-Za-z0-9_]*)\s*(?=[=;,)])/g;
  while ((match = javaLikeRe.exec(masked))) {
    const type = match[1].replace(/<.*>/g, '').split('.').pop() || '';
    if (type) types.set(match[2], type);
  }
  const tsLikeRe = /\b([a-z_][A-Za-z0-9_]*)\s*\??:\s*([A-Z][A-Za-z0-9_$.]*)/g;
  while ((match = tsLikeRe.exec(masked))) {
    const type = match[2].split('.').pop() || '';
    if (type) types.set(match[1], type);
  }
  return types;
}

function isCallableDeclaration(src: string, nameStart: number, nameLength: number): boolean {
  let open = nameStart + nameLength;
  while (/\s/.test(src[open] || '')) open++;
  if (src[open] !== '(') return false;
  let depth = 0;
  let close = -1;
  for (let index = open; index < src.length; index++) {
    if (src[index] === '(') depth++;
    else if (src[index] === ')') {
      depth--;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close === -1) return false;
  const lineStart = Math.max(src.lastIndexOf('\n', nameStart), src.lastIndexOf('\r', nameStart)) + 1;
  const prefix = src.slice(lineStart, nameStart);
  if (/\bnew\s*$/.test(prefix)) return false;
  if (/\b(?:def|function)\s*$/.test(prefix) || /\bfunc\b[^;{}]*$/.test(prefix)) {
    return true;
  }
  const tail = src.slice(close + 1, Math.min(src.length, close + 240));
  return /^\s*(?:(?::|throws\b)[^{;=>]+|(?:const|noexcept|override|final)\b\s*)*(?:\{|=>)/.test(tail);
}

function methodNames(src: string): string[] {
  const names = new Set<string>();
  const masked = maskSource(src);
  let match: RegExpExecArray | null;
  const modifiers = '(?:(?:public|private|protected|internal|static|async|virtual|override|abstract|sealed|readonly|final|open|synchronized|suspend|inline|constexpr|get|set)\\s+)*';
  const tsMethodRe = new RegExp(
    `(?:^|[;{}])[ \\t]*${modifiers}([A-Za-z_]\\w*)\\s*(?:<[^>{}]+>)?\\s*\\([^;{}]*\\)\\s*(?::[^\\r\\n{]+)?(?:throws\\s+[^;{]+\\s*)?(?:\\{|=>)`,
    'gm'
  );
  while ((match = tsMethodRe.exec(masked))) {
    if (!CONTROL_WORDS.has(match[1])) names.add(match[1]);
  }
  const typedMethodRe = new RegExp(
    `(?:^|[;{}])[ \\t]*${modifiers}[A-Za-z_][\\w<>,.?\\[\\]:*&]*\\s+([A-Za-z_]\\w*)\\s*\\([^;{}]*\\)\\s*(?:const\\s*)?(?:throws\\s+[^;{]+\\s*)?(?:\\{|=>)`,
    'gm'
  );
  while ((match = typedMethodRe.exec(masked))) {
    if (!CONTROL_WORDS.has(match[1])) names.add(match[1]);
  }
  const defMethodRe = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm;
  while ((match = defMethodRe.exec(masked))) names.add(match[1]);
  return [...names];
}

function moduleLabel(file: string): string {
  const parts = file.split('/');
  const base = (parts.pop() || file).replace(/\.[^.]+$/, '');
  if (base.toLowerCase() !== 'index') return base;
  return parts.pop() || base;
}

function collectClassLevelOwners(
  file: string,
  src: string,
  extracted: ExtractedFile
): ClassLevelOwner[] {
  const owners: ClassLevelOwner[] = [];
  const seen = new Set<string>();
  const push = (
    name: string,
    kind: ClassLevelOwner['kind'],
    bases: string[] = []
  ) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    const source = kind === 'module' ? src : declarationSource(src, name, kind);
    const behaviorSymbols = kind === 'class'
      ? methodNames(source).filter((symbol) => symbol !== name)
      : callableNames(source);
    const symbols = new Set([name]);
    for (const symbol of behaviorSymbols) {
      symbols.add(symbol);
    }
    if (kind === 'module') {
      for (const symbol of exportedValueNames(source)) symbols.add(symbol);
    }
    const prefix = kind === 'class' ? 'c' : kind === 'component' ? 'p' : 'm';
    owners.push({
      id: `${prefix}:${file}::${name}`,
      label: name,
      kind,
      file,
      bases,
      symbols: [...symbols],
      source,
      hasBehavior: kind !== 'class' || behaviorSymbols.length > 0,
    });
  };

  for (const type of extracted.types) {
    if (type.kind === 'class') push(type.name, 'class', type.bases);
  }

  const ext = extOf(file);
  if (/\.(?:tsx|jsx|vue)$/.test(ext)) {
    for (const type of extracted.types) {
      if (type.kind === 'function' && /^[A-Z].*[a-z]/.test(type.name)) {
        push(type.name, 'component');
      }
    }
    const variableComponentRe = /\b(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\b/g;
    let match: RegExpExecArray | null;
    const masked = maskSource(src);
    while ((match = variableComponentRe.exec(masked))) {
      if (!/[a-z]/.test(match[1])) continue;
      const declaration = src.slice(match.index, Math.min(src.length, match.index + 500));
      if (/\bReact\.(?:FC|FunctionComponent)\b|=>/.test(declaration)) {
        push(match[1], 'component');
      }
    }
  }

  const fileCallables = callableNames(src);
  if (owners.length === 0) {
    const entryModule = /(?:^|\/)(?:main|index|server)\.[^/]+$/i.test(file);
    const routerModule = /\bRouter\s*\(/.test(maskSource(src));
    if (
      fileCallables.length > 0 ||
      routerModule ||
      (entryModule && /[A-Za-z_]\w*\s*\(/.test(maskSource(src)))
    ) {
      push(moduleLabel(file), 'module');
    }
  } else {
    for (const owner of owners) {
      const aliasRe = new RegExp(
        `\\b(?:export\\s+)?(?:const|let|var)\\s+([A-Za-z_]\\w*)\\s*=\\s*new\\s+${escapeRegex(owner.label)}\\s*\\(`,
        'g'
      );
      let alias: RegExpExecArray | null;
      const masked = maskSource(src);
      while ((alias = aliasRe.exec(masked))) owner.symbols.push(alias[1]);
      owner.symbols = [...new Set(owner.symbols)];
    }
    const assigned = new Set(owners.flatMap((owner) => owner.symbols));
    const unowned = fileCallables.filter((name) => !assigned.has(name));
    if (owners.length === 1 && unowned.length > 0) {
      owners[0].symbols = [...new Set([...owners[0].symbols, ...unowned])];
    }
  }
  return owners;
}

function extractFile(file: string, src: string): ExtractedFile {
  const ext = extOf(file);
  const searchable = maskSource(src);
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
    while ((m = typeRe.exec(searchable))) {
      const bases = m[3] ? m[3].split(/[,]/).map((s) => s.trim()) : [];
      const kind: LearnNodeKind =
        m[1] === 'interface' ? 'interface' : m[1] === 'enum' ? 'enum' : 'class';
      pushType(m[2], kind, bases);
    }
    if (ext === '.java' || ext === '.kt') {
      const importRe = /^\s*import\s+(static\s+)?([A-Za-z_]\w*(?:\.[A-Za-z_*]\w*)+)\s*;?/gm;
      while ((m = importRe.exec(searchable))) {
        let spec = m[2].replace(/\.\*$/, '');
        if (m[1]) spec = spec.replace(/\.[^.]+$/, '');
        if (spec) imports.push(spec);
      }
    }
  } else if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs' || ext === '.vue') {
    const typeRe =
      /\b(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(class|interface|enum|function)\s+([A-Za-z_]\w*)(?:\s+extends\s+([A-Za-z_]\w*))?(?:\s+implements\s+([^{]+))?/g;
    let m: RegExpExecArray | null;
    while ((m = typeRe.exec(searchable))) {
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
    while ((m = classRe.exec(searchable))) {
      pushType(m[1], 'class', m[2] ? m[2].split(',') : []);
    }
    const fromRe = /^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
    while ((m = fromRe.exec(src))) imports.push((m[1] || m[2] || '').replace(/\./g, '/'));
  } else if (ext === '.go') {
    const typeRe = /\btype\s+([A-Za-z_]\w*)\s+(struct|interface)\b/g;
    let m: RegExpExecArray | null;
    while ((m = typeRe.exec(searchable))) {
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
    while ((m = typeRe.exec(searchable))) {
      const kind: LearnNodeKind =
        m[1] === 'trait' ? 'interface' : m[1] === 'enum' ? 'enum' : m[1] === 'mod' ? 'module' : 'class';
      pushType(m[2], kind);
    }
  } else {
    const typeRe = /\b(?:class|struct|interface|enum|func(?:tion)?|def)\s+([A-Za-z_]\w*)/g;
    let m: RegExpExecArray | null;
    while ((m = typeRe.exec(searchable))) pushType(m[1], 'class');
  }

  return { path: file, types, imports };
}

function resolveImport(
  fromFile: string,
  spec: string,
  files: Set<string>,
  filesByStem: Map<string, string[]>
): string | null {
  if (!spec || spec.startsWith('http')) return null;
  const cleaned = spec
    .replace(/\\/g, '/')
    .replace(/\.(js|ts|tsx|jsx|mjs|cjs|java|kt|cs|py|go|rs)$/, '');
  const tryPaths = (base: string): string | null => {
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.jsx`,
      `${base}.mjs`,
      `${base}.java`,
      `${base}.kt`,
      `${base}.cs`,
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
  if (/\.(?:java|kt)$/.test(extOf(fromFile)) && spec.includes('.')) {
    const packagePath = cleaned.replace(/\./g, '/');
    const direct = tryPaths(packagePath);
    if (direct) return direct;
    const stem = packagePath.split('/').pop() || '';
    const candidates = (filesByStem.get(stem) || []).filter((file) =>
      file.replace(/\.[^.]+$/, '').endsWith(packagePath)
    );
    if (candidates.length === 1) return candidates[0];
    const uniqueStem = filesByStem.get(stem) || [];
    return uniqueStem.length === 1 ? uniqueStem[0] : null;
  }
  // python-style module path already converted to slashes
  if (!spec.includes('/') && !cleaned.includes('/')) return null;
  return tryPaths(cleaned) || tryPaths(joinRel('', cleaned));
}

function relationWeight(relation: LearnRelation): number {
  return relation === 'calls'
    ? 4
    : relation === 'inherits'
      ? 3
      : relation === 'references'
        ? 2
        : 1;
}

function detectCommunities(nodeIds: string[], edges: RawEdge[]): Map<string, number> {
  const adj = new Map<string, Map<string, number>>();
  const idSet = new Set(nodeIds);

  const bump = (a: string, b: string, w: number) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Map());
    if (!adj.has(b)) adj.set(b, new Map());
    adj.get(a)!.set(b, (adj.get(a)!.get(b) || 0) + w);
    adj.get(b)!.set(a, (adj.get(b)!.get(a) || 0) + w);
  };
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    bump(e.source, e.target, relationWeight(e.relation));
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
  const filesByStem = new Map<string, string[]>();
  for (const file of fileSet) {
    const stem = file.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
    if (!stem) continue;
    const matches = filesByStem.get(stem);
    if (matches) matches.push(file);
    else filesByStem.set(stem, [file]);
  }
  const nodes = new Map<string, RawNode>();
  const edges: RawEdge[] = [];
  const seenEdge = new Set<string>();
  const owners: ClassLevelOwner[] = [];
  const ownersByFile = new Map<string, ClassLevelOwner[]>();
  const importsByFile = new Map<string, Set<string>>();
  let filesParsed = 0;

  for (const { path: file, content } of files) {
    if (!content || content.includes('\0')) continue;
    filesParsed++;
    const extracted = extractFile(file, content);
    const fileOwners = collectClassLevelOwners(file, content, extracted);
    owners.push(...fileOwners);
    ownersByFile.set(file, fileOwners);
    const imports = new Set<string>();
    for (const spec of extracted.imports) {
      const resolved = resolveImport(file, spec, fileSet, filesByStem);
      if (resolved) imports.add(resolved);
    }
    importsByFile.set(file, imports);
  }

  for (const owner of owners) {
    nodes.set(owner.id, {
      id: owner.id,
      label: owner.label,
      kind: owner.kind,
      file: owner.file,
      symbols: owner.symbols,
    });
  }

  const ownersBySymbol = new Map<string, ClassLevelOwner[]>();
  for (const owner of owners) {
    for (const symbol of owner.symbols) {
      const matches = ownersBySymbol.get(symbol);
      if (matches) matches.push(owner);
      else ownersBySymbol.set(symbol, [owner]);
    }
  }

  const targetsFor = (symbol: string, source: ClassLevelOwner): ClassLevelOwner[] => {
    const candidates = (ownersBySymbol.get(symbol) || []).filter(
      (candidate) => candidate.id !== source.id
    );
    if (candidates.length <= 1) return candidates;
    const importedFiles = importsByFile.get(source.file) || new Set<string>();
    const sourceDirectory = source.file.slice(0, source.file.lastIndexOf('/') + 1);
    const scoped = candidates.filter(
      (candidate) =>
        candidate.file === source.file ||
        importedFiles.has(candidate.file) ||
        candidate.file.slice(0, candidate.file.lastIndexOf('/') + 1) === sourceDirectory
    );
    return scoped.length === 1 ? scoped : [];
  };

  for (const owner of owners) {
    for (const base of owner.bases) {
      for (const target of targetsFor(base, owner)) {
        addEdge(edges, seenEdge, owner.id, target.id, 'inherits');
      }
    }

    const masked = maskSource(owner.source);
    const usedCalls = new Set<string>();
    const memberMethods = new Set<string>();
    const typesByReceiver = receiverTypes(owner.source);
    const memberCallRe = /\b([A-Za-z_]\w*)\s*(?:\?\.|\.)\s*([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = memberCallRe.exec(masked))) {
      const receiver = m[1];
      const method = m[2];
      memberMethods.add(method);
      const receiverType = typesByReceiver.get(receiver);
      const targetOwners = receiverType
        ? targetsFor(receiverType, owner)
        : targetsFor(receiver, owner);
      for (const target of targetOwners) {
        if (!target.symbols.includes(method)) continue;
        addEdge(edges, seenEdge, owner.id, target.id, 'calls');
      }
    }
    const callRe = /\b([A-Za-z_]\w*)\s*\(/g;
    while ((m = callRe.exec(masked))) {
      const symbol = m[1];
      if (
        CONTROL_WORDS.has(symbol) ||
        memberMethods.has(symbol) ||
        usedCalls.has(symbol) ||
        isCallableDeclaration(masked, m.index, symbol.length)
      ) continue;
      usedCalls.add(symbol);
      for (const target of targetsFor(symbol, owner)) {
        addEdge(edges, seenEdge, owner.id, target.id, 'calls');
      }
      if (usedCalls.size >= MAX_REF_EDGES_PER_FILE) break;
    }

    const usedReferences = new Set<string>();
    const referenceRe = /\b[A-Z][A-Za-z0-9_]{2,}\b/g;
    while ((m = referenceRe.exec(masked))) {
      const symbol = m[0];
      if (SKIP_NAME.has(symbol.toLowerCase()) || usedReferences.has(symbol)) continue;
      usedReferences.add(symbol);
      for (const target of targetsFor(symbol, owner)) {
        addEdge(edges, seenEdge, owner.id, target.id, 'references');
      }
      if (usedReferences.size >= MAX_REF_EDGES_PER_FILE) break;
    }
  }

  for (const [file, importedFiles] of importsByFile) {
    const sourceOwners = ownersByFile.get(file) || [];
    if (sourceOwners.length !== 1) continue;
    for (const importedFile of importedFiles) {
      const targetOwners = ownersByFile.get(importedFile) || [];
      if (targetOwners.length !== 1) continue;
      addEdge(edges, seenEdge, sourceOwners[0].id, targetOwners[0].id, 'imports');
    }
  }

  // A class declaration alone is not a business activity. Pure marker/placeholder/data
  // shells only connected by imports, references, or inheritance would otherwise crowd
  // out the classes that actually execute the repository's work.
  const calledClassIds = new Set<string>();
  for (const edge of edges) {
    if (edge.relation !== 'calls') continue;
    calledClassIds.add(edge.source);
    calledClassIds.add(edge.target);
  }
  let nodeList = owners
    .filter(
      (owner) => owner.kind !== 'class' || owner.hasBehavior || calledClassIds.has(owner.id)
    )
    .map((owner) => owner.id);
  const relevantNodeIds = new Set(nodeList);
  const degree = new Map<string, number>();
  const activityDegree = new Map<string, number>();
  for (const id of nodeList) {
    degree.set(id, 0);
    activityDegree.set(id, 0);
  }
  for (const e of edges) {
    if (!relevantNodeIds.has(e.source) || !relevantNodeIds.has(e.target)) continue;
    const weight = relationWeight(e.relation);
    degree.set(e.source, (degree.get(e.source) || 0) + weight);
    degree.set(e.target, (degree.get(e.target) || 0) + weight);
    if (e.relation === 'calls') {
      activityDegree.set(e.source, (activityDegree.get(e.source) || 0) + 1);
      activityDegree.set(e.target, (activityDegree.get(e.target) || 0) + 1);
    }
  }

  if (nodeList.length === 0) {
    return {
      nodes: [],
      edges: [],
      communities: [],
      businessRoutes: [],
      runtimePath: [],
      godNodes: [],
      bridges: [],
      stats: { filesParsed, symbolCount: 0, edgeCount: 0, truncated: false },
    };
  }

  let truncated = false;
  if (nodeList.length > MAX_VIZ_NODES) {
    truncated = true;
    nodeList.sort(
      (a, b) =>
        (activityDegree.get(b) || 0) - (activityDegree.get(a) || 0) ||
        (degree.get(b) || 0) - (degree.get(a) || 0)
    );
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
      symbols: n.symbols,
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
        .sort(
          (a, b) =>
            (activityDegree.get(b) || 0) - (activityDegree.get(a) || 0) ||
            (degree.get(b) || 0) - (degree.get(a) || 0)
        );
      const godLabels = ranked.slice(0, 4).map((m) => nodes.get(m)!.label);
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
        entry: top?.file ? { file: top.file, symbol: top.label } : undefined,
      };
    });

  const godNodes: LearnGodNode[] = learnNodes
    .sort(
      (a, b) =>
        (activityDegree.get(b.id) || 0) - (activityDegree.get(a.id) || 0) ||
        b.degree - a.degree
    )
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
    businessRoutes: [],
    runtimePath,
    godNodes,
    bridges: bridges.slice(0, 14),
    stats: {
      filesParsed,
      symbolCount: learnNodes.length,
      edgeCount: liveEdges.length,
      truncated,
    },
  };
}

export async function buildLearnGraph(repoPath: string): Promise<LearnGraph> {
  const git = simpleGit(repoPath);
  let head = '';
  let dirty = false;
  try {
    const [resolvedHead, status] = await Promise.all([
      git.raw(['rev-parse', 'HEAD']),
      git.raw(['status', '--porcelain=v1']),
    ]);
    head = resolvedHead.trim();
    dirty = Boolean(status.trim());
  } catch {
    head = '';
    dirty = true;
  }
  const cacheKey = `${repoPath}::${head}`;
  // A HEAD-only cache returns stale graphs for every working-tree edit. Dirty
  // repositories are rebuilt so modified and untracked source is visible.
  const cached = dirty ? undefined : graphCache.get(cacheKey);
  if (cached) return cached;

  let listed: string[] = [];
  try {
    listed = (await git.raw([
      '-c',
      'core.quotepath=false',
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
    ]))
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
  if (!dirty) graphCache.set(cacheKey, graph);
  return graph;
}

export function formatLearnGraphDigest(graph: LearnGraph): string {
  const commName = (id: string) => graph.communities.find((c) => c.id === id)?.label || id;
  const lines: string[] = [];
  lines.push('【结构图谱 · 本地解析 · EXTRACTED】');
  lines.push(
    `${graph.nodes.length} 节点 · ${graph.stats.edgeCount} 边 · ${graph.communities.length} 社区 · ${graph.stats.filesParsed} 文件（符号 ${graph.stats.symbolCount}）${graph.stats.truncated ? ' · 已裁剪大图' : ''}`
  );
  lines.push('节点=类/React组件/职责模块，普通函数归入所属节点；边=calls/imports/references/inherits。这些不是模型编的。');
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
