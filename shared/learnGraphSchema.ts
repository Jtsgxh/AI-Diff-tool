import {
  LEARN_BUSINESS_STEP_KINDS,
  type LearnAnalysisCommunity,
  type LearnAnalysisEnvelope,
  type LearnBusinessRoute,
  type LearnBusinessRouteStep,
  type LearnBusinessStepKind,
} from './types';

const STEP_KINDS = new Set<string>(LEARN_BUSINESS_STEP_KINDS);

function requiredString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const item of value) {
    const text = requiredString(item);
    if (!text) return null;
    result.push(text);
  }
  return result;
}

function parseCommunity(value: unknown): LearnAnalysisCommunity | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = requiredString(row.id);
  const label = requiredString(row.label);
  if (!id || !label || typeof row.summary !== 'string') return null;

  let entry: LearnAnalysisCommunity['entry'];
  if (row.entry !== undefined) {
    if (!row.entry || typeof row.entry !== 'object') return null;
    const source = row.entry as Record<string, unknown>;
    const file = requiredString(source.file)?.replace(/\\/g, '/');
    if (!file) return null;
    const symbol = source.symbol === undefined ? undefined : requiredString(source.symbol);
    if (source.symbol !== undefined && !symbol) return null;
    entry = { file, symbol: symbol || undefined };
  }

  const files = row.files === undefined ? [] : stringList(row.files);
  if (!files) return null;
  return {
    id,
    label,
    summary: row.summary.trim(),
    entry,
    files: files.map((file) => file.replace(/\\/g, '/')),
  };
}

function parseStep(value: unknown, communityIds: Set<string>): LearnBusinessRouteStep | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const label = requiredString(row.label);
  const description = requiredString(row.description);
  const relation = requiredString(row.relation);
  const evidence = requiredString(row.evidence);
  const file = requiredString(row.file)?.replace(/\\/g, '/');
  const classSymbol = requiredString(row.classSymbol);
  const methodSymbol = requiredString(row.methodSymbol);
  const communityId = requiredString(row.communityId);
  const kind = requiredString(row.kind);
  const inputs = stringList(row.inputs);
  const outputs = stringList(row.outputs);
  const stateChanges = stringList(row.stateChanges);
  const failurePaths = stringList(row.failurePaths);

  if (
    !label || !description || !relation || !evidence || !file || !classSymbol ||
    !methodSymbol || !communityId || !communityIds.has(communityId) || !kind ||
    !STEP_KINDS.has(kind) || !inputs || !outputs || !stateChanges || !failurePaths
  ) return null;

  return {
    label,
    kind: kind as LearnBusinessStepKind,
    description,
    relation,
    evidence,
    file,
    classSymbol,
    methodSymbol,
    communityId,
    inputs,
    outputs,
    stateChanges,
    failurePaths,
  };
}

function parseRoute(value: unknown, communityIds: Set<string>): LearnBusinessRoute | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = requiredString(row.id);
  const label = requiredString(row.label);
  if (!id || !label || typeof row.summary !== 'string' || !Array.isArray(row.steps) || row.steps.length < 2) {
    return null;
  }
  const steps: LearnBusinessRouteStep[] = [];
  for (const value of row.steps) {
    const step = parseStep(value, communityIds);
    if (!step) return null;
    steps.push(step);
  }
  if (steps[0].kind !== 'entry' || steps[steps.length - 1].kind !== 'result') return null;
  return { id, label, summary: row.summary.trim(), steps };
}

/** One strict source of truth for the AI learn-graph wire contract. */
export function parseLearnAnalysisEnvelope(value: unknown): LearnAnalysisEnvelope | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.communities) || row.communities.length === 0 ||
      !Array.isArray(row.businessRoutes) || !Array.isArray(row.runtimePath)) return null;

  const communities: LearnAnalysisCommunity[] = [];
  const communityIds = new Set<string>();
  for (const value of row.communities) {
    const community = parseCommunity(value);
    if (!community || communityIds.has(community.id)) return null;
    communityIds.add(community.id);
    communities.push(community);
  }

  const businessRoutes: LearnBusinessRoute[] = [];
  const routeIds = new Set<string>();
  for (const value of row.businessRoutes) {
    const route = parseRoute(value, communityIds);
    if (!route || routeIds.has(route.id)) return null;
    routeIds.add(route.id);
    businessRoutes.push(route);
  }

  const runtimePath = stringList(row.runtimePath);
  if (!runtimePath || runtimePath.some((id) => !communityIds.has(id))) return null;
  return { communities, businessRoutes, runtimePath };
}
