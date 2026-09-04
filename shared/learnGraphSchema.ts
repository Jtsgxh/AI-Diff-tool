import {
  LEARN_BUSINESS_STEP_KINDS,
  type LearnAnalysisCommunity,
  type LearnAnalysisEnvelope,
  type LearnBusinessRoute,
  type LearnBusinessRouteStep,
  type LearnBusinessStepKind,
} from './types';

const STEP_KINDS = new Set<string>(LEARN_BUSINESS_STEP_KINDS);

class LearnGraphContractError extends Error {}

function reject(path: string, reason: string): never {
  throw new LearnGraphContractError(`${path} ${reason}`);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string') reject(path, '必须是字符串');
  const normalized = value.trim();
  if (!normalized) reject(path, '不能为空');
  return normalized;
}

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) reject(path, '必须是字符串数组');
  const result: string[] = [];
  for (let index = 0; index < value.length; index++) {
    result.push(requiredString(value[index], `${path}[${index}]`));
  }
  return result;
}

function parseCommunity(value: unknown, path: string): LearnAnalysisCommunity {
  if (!value || typeof value !== 'object') reject(path, '必须是对象');
  const row = value as Record<string, unknown>;
  const id = requiredString(row.id, `${path}.id`);
  const label = requiredString(row.label, `${path}.label`);
  if (typeof row.summary !== 'string') reject(`${path}.summary`, '必须是字符串');

  let entry: LearnAnalysisCommunity['entry'];
  if (row.entry !== undefined) {
    if (!row.entry || typeof row.entry !== 'object') reject(`${path}.entry`, '必须是对象');
    const source = row.entry as Record<string, unknown>;
    const file = requiredString(source.file, `${path}.entry.file`).replace(/\\/g, '/');
    const symbol = source.symbol === undefined
      ? undefined
      : requiredString(source.symbol, `${path}.entry.symbol`);
    entry = { file, symbol };
  }

  const files = row.files === undefined ? [] : stringList(row.files, `${path}.files`);
  return {
    id,
    label,
    summary: row.summary.trim(),
    entry,
    files: files.map((file) => file.replace(/\\/g, '/')),
  };
}

function parseStep(
  value: unknown,
  communityIds: Set<string>,
  path: string
): LearnBusinessRouteStep {
  if (!value || typeof value !== 'object') reject(path, '必须是对象');
  const row = value as Record<string, unknown>;
  const label = requiredString(row.label, `${path}.label`);
  const description = requiredString(row.description, `${path}.description`);
  const relation = requiredString(row.relation, `${path}.relation`);
  const evidence = requiredString(row.evidence, `${path}.evidence`);
  const file = requiredString(row.file, `${path}.file`).replace(/\\/g, '/');
  const classSymbol = requiredString(row.classSymbol, `${path}.classSymbol`);
  const methodSymbol = requiredString(row.methodSymbol, `${path}.methodSymbol`);
  const communityId = requiredString(row.communityId, `${path}.communityId`);
  if (!communityIds.has(communityId)) {
    reject(`${path}.communityId`, `引用了不存在的社区 ${communityId}`);
  }
  const kind = requiredString(row.kind, `${path}.kind`);
  if (!STEP_KINDS.has(kind)) {
    reject(`${path}.kind`, `必须是 ${LEARN_BUSINESS_STEP_KINDS.join('/')}`);
  }
  const inputs = stringList(row.inputs, `${path}.inputs`);
  const outputs = stringList(row.outputs, `${path}.outputs`);
  const stateChanges = stringList(row.stateChanges, `${path}.stateChanges`);
  const failurePaths = stringList(row.failurePaths, `${path}.failurePaths`);

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

function parseRoute(
  value: unknown,
  communityIds: Set<string>,
  path: string
): LearnBusinessRoute {
  if (!value || typeof value !== 'object') reject(path, '必须是对象');
  const row = value as Record<string, unknown>;
  const id = requiredString(row.id, `${path}.id`);
  const label = requiredString(row.label, `${path}.label`);
  if (typeof row.summary !== 'string') reject(`${path}.summary`, '必须是字符串');
  if (!Array.isArray(row.steps)) reject(`${path}.steps`, '必须是数组');
  if (row.steps.length < 2) reject(`${path}.steps`, '至少需要 entry 和 result 两步');
  const steps: LearnBusinessRouteStep[] = [];
  for (let index = 0; index < row.steps.length; index++) {
    steps.push(parseStep(row.steps[index], communityIds, `${path}.steps[${index}]`));
  }
  if (steps[0].kind !== 'entry') reject(`${path}.steps[0].kind`, '必须是 entry');
  if (steps[steps.length - 1].kind !== 'result') {
    reject(`${path}.steps[${steps.length - 1}].kind`, '必须是 result');
  }
  return { id, label, summary: row.summary.trim(), steps };
}

function parseEnvelope(value: unknown): LearnAnalysisEnvelope {
  if (!value || typeof value !== 'object') reject('$', '必须是对象');
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.communities)) reject('communities', '必须是数组');
  if (row.communities.length === 0) reject('communities', '不能为空');
  if (!Array.isArray(row.businessRoutes)) reject('businessRoutes', '必须是数组');

  const communities: LearnAnalysisCommunity[] = [];
  const communityIds = new Set<string>();
  for (let index = 0; index < row.communities.length; index++) {
    const community = parseCommunity(row.communities[index], `communities[${index}]`);
    if (communityIds.has(community.id)) {
      reject(`communities[${index}].id`, `与已有社区 ${community.id} 重复`);
    }
    communityIds.add(community.id);
    communities.push(community);
  }

  const businessRoutes: LearnBusinessRoute[] = [];
  const routeIds = new Set<string>();
  for (let index = 0; index < row.businessRoutes.length; index++) {
    const route = parseRoute(row.businessRoutes[index], communityIds, `businessRoutes[${index}]`);
    if (routeIds.has(route.id)) {
      reject(`businessRoutes[${index}].id`, `与已有路线 ${route.id} 重复`);
    }
    routeIds.add(route.id);
    businessRoutes.push(route);
  }

  const runtimePath = stringList(row.runtimePath, 'runtimePath');
  for (let index = 0; index < runtimePath.length; index++) {
    if (!communityIds.has(runtimePath[index])) {
      reject(`runtimePath[${index}]`, `引用了不存在的社区 ${runtimePath[index]}`);
    }
  }
  return { communities, businessRoutes, runtimePath };
}

export type LearnAnalysisValidationResult =
  | { graph: LearnAnalysisEnvelope; error: null }
  | { graph: null; error: string };

/** One strict source of truth with an exact path for rejected model data. */
export function validateLearnAnalysisEnvelope(value: unknown): LearnAnalysisValidationResult {
  try {
    return { graph: parseEnvelope(value), error: null };
  } catch (err) {
    if (err instanceof LearnGraphContractError) {
      return { graph: null, error: err.message };
    }
    throw err;
  }
}

/** Parse-only view for callers that only need valid/null. */
export function parseLearnAnalysisEnvelope(value: unknown): LearnAnalysisEnvelope | null {
  return validateLearnAnalysisEnvelope(value).graph;
}
