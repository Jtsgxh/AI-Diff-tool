/**
 * Single source of truth for types crossing the client/server boundary.
 * Both `src/**` (browser) and `server/**` (node) import from here so a wire
 * format can never drift between the two sides.
 */

// ------------------------------ Git domain ------------------------------

export interface CommitNode {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  date: string;
  message: string;
  refs: string[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  diff: string;
  /** Exact snapshot shown by the full-file preview for this diff entry. */
  previewSource?: FilePreviewSource;
}

export type FilePreviewSource =
  | { type: 'working-tree'; path: string }
  | { type: 'revision'; path: string; revision: string };

export interface FilePreview {
  path: string;
  source: 'working-tree' | 'revision';
  revision?: string;
  content: string | null;
  byteSize: number;
  lineCount: number | null;
  encoding: 'utf-8' | 'gb18030' | null;
  isBinary: boolean;
  isTooLarge: boolean;
}

export interface DiffSummary {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface BatchInfo {
  count: number;
  messages: string[];
}

export interface DiffResult {
  title: string;
  summary: DiffSummary;
  files: DiffFile[];
  batchInfo?: BatchInfo;
}

export interface RepoInfo {
  path: string;
  name: string;
  currentBranch: string;
  tracking?: string;
  ahead: number;
  behind: number;
  isClean: boolean;
  modifiedFilesCount: number;
  branches: string[];
  headHash?: string;
}

export interface RepoOverview {
  fileCount: number;
  headHash?: string;
  languages: { ext: string; count: number }[];
  topDirs: { name: string; count: number }[];
  manifests: { path: string; preview: string }[];
  entryCandidates: string[];
}

export type LearnNodeKind = 'file' | 'class' | 'component' | 'function' | 'interface' | 'enum' | 'module';
export type LearnRelation = 'calls' | 'imports' | 'references' | 'inherits';

export interface LearnNode {
  id: string;
  label: string;
  kind: LearnNodeKind;
  file?: string;
  symbols?: string[];
  communityId: string;
  degree: number;
}

export interface LearnEdge {
  source: string;
  target: string;
  relation: LearnRelation;
}

export interface LearnGodNode {
  id: string;
  label: string;
  kind: LearnNodeKind;
  file?: string;
  degree: number;
}

export interface LearnBridge {
  source: string;
  target: string;
  sourceLabel: string;
  targetLabel: string;
  sourceCommunity: string;
  targetCommunity: string;
  relation: LearnRelation;
}

export interface LearnCommunity {
  id: string;
  label: string;
  summary: string;
  entry?: { file: string; symbol?: string };
  files: string[];
  godNodes: string[];
  cohesion: number;
  nodeCount: number;
}

export const LEARN_ANALYSIS_SCHEMA_VERSION = 2;

export const LEARN_BUSINESS_STEP_KINDS = [
  'entry',
  'process',
  'decision',
  'state',
  'external',
  'result',
] as const;

export type LearnBusinessStepKind = typeof LEARN_BUSINESS_STEP_KINDS[number];

export interface LearnBusinessRouteStep {
  label: string;
  kind: LearnBusinessStepKind;
  description: string;
  relation: string;
  evidence: string;
  file: string;
  classSymbol: string;
  methodSymbol: string;
  communityId: string;
  inputs: string[];
  outputs: string[];
  stateChanges: string[];
  failurePaths: string[];
  nodeId?: string;
}

export interface LearnBusinessRoute {
  id: string;
  label: string;
  summary: string;
  steps: LearnBusinessRouteStep[];
}

export interface LearnAnalysisCommunity {
  id: string;
  label: string;
  summary: string;
  entry?: { file: string; symbol?: string };
  files: string[];
}

export interface LearnAnalysisEnvelope {
  communities: LearnAnalysisCommunity[];
  businessRoutes: LearnBusinessRoute[];
  runtimePath: string[];
}

export interface LearnGraph {
  nodes: LearnNode[];
  edges: LearnEdge[];
  communities: LearnCommunity[];
  businessRoutes: LearnBusinessRoute[];
  runtimePath: string[];
  godNodes: LearnGodNode[];
  bridges: LearnBridge[];
  stats: {
    filesParsed: number;
    symbolCount: number;
    edgeCount: number;
    truncated: boolean;
    sourceFingerprint: string;
  };
}

// ------------------------------ AI domain ------------------------------

export type AIProvider = 'deepseek' | 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'custom';

export interface AIPromptsConfig {
  /** 1. Codex 深度代码审查提示词 */
  reviewPrompt?: string;
  /** 2. 仓库业务路线分析提示词 */
  learnPrompt?: string;
  /** 3. 直接 Diff 快速解释提示词 */
  fastDiffPrompt?: string;
  /** 4. 概括性伪代码提炼提示词 */
  pseudocodePrompt?: string;
  /** 5. 自然语言改动直读提示词 */
  naturalLanguagePrompt?: string;
}

/** Model context-window size in tokens. Diff budgets are derived from this. */
export const CONTEXT_WINDOW_TOKENS = {
  min: 8_000,
  default: 1_000_000,
} as const;

/**
 * Source is mostly ASCII (~4 chars/token). 3.5 leaves room for Chinese
 * prompts and tokenizer variance so we do not walk into the output budget.
 */
export const CONTEXT_CHARS_PER_TOKEN = 3.5;

/**
 * Input allocation inside the model's configured physical context window.
 * These are headroom ratios, not product caps: fast mode keeps room for the
 * answer, while Agent mode also keeps room for tool results and synthesis.
 */
export const CONTEXT_DIFF_FRACTION = {
  fast: 0.85,
  agent: 0.6,
  line: 0.35,
} as const;

export function clampContextWindowTokens(tokens: number): number {
  return Math.max(CONTEXT_WINDOW_TOKENS.min, Math.round(tokens));
}

/** Resolve the token window: explicit setting, otherwise 1M. */
export function inferContextWindowTokens(input: {
  contextWindowTokens?: number;
  provider?: string;
  model?: string;
}): number {
  const raw = input.contextWindowTokens;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return clampContextWindowTokens(raw);
  }
  return CONTEXT_WINDOW_TOKENS.default;
}

export function diffCharBudgetFromWindow(
  tokens: number,
  kind: 'fast' | 'agent' | 'line'
): number {
  return Math.max(
    8_000,
    Math.round(clampContextWindowTokens(tokens) * CONTEXT_CHARS_PER_TOKEN * CONTEXT_DIFF_FRACTION[kind])
  );
}

export function totalContextChars(tokens: number): number {
  return Math.round(clampContextWindowTokens(tokens) * CONTEXT_CHARS_PER_TOKEN);
}

/** Wait for the provider to return response headers / its first stream byte. */
export const REQUEST_TIMEOUT_SECONDS = {
  min: 20,
  default: 180,
  max: 1800,
} as const;

/** Maximum time after streaming starts without a real AI progress event. */
export const STREAM_IDLE_TIMEOUT_SECONDS = {
  min: 30,
  default: 180,
  max: 1800,
} as const;

export function resolveRequestTimeoutSeconds(value: number | undefined): number {
  return Math.min(
    REQUEST_TIMEOUT_SECONDS.max,
    Math.max(
      REQUEST_TIMEOUT_SECONDS.min,
      typeof value === 'number' && Number.isFinite(value)
        ? value
        : REQUEST_TIMEOUT_SECONDS.default
    )
  );
}

export function resolveStreamIdleTimeoutSeconds(value: number | undefined): number {
  return Math.min(
    STREAM_IDLE_TIMEOUT_SECONDS.max,
    Math.max(
      STREAM_IDLE_TIMEOUT_SECONDS.min,
      typeof value === 'number' && Number.isFinite(value)
        ? value
        : STREAM_IDLE_TIMEOUT_SECONDS.default
    )
  );
}

export const DEFAULT_AGENT_MAX_TURNS = 10;

/** `null` deliberately disables the SDK turn ceiling; legacy 0/unset stays at 10. */
export function resolveAgentMaxTurns(value: number | null | undefined): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.trunc(value));
  }
  return DEFAULT_AGENT_MAX_TURNS;
}

export interface AIRuntimeConfig {
  /** Positive integer for a finite ceiling; `null` means no turn ceiling. */
  maxExplorationTurns?: number | null;
  timeoutSeconds?: number;
  streamIdleTimeoutSeconds?: number;
  maxRetries?: number;
  maxReadFileLines?: number;
  maxSearchResults?: number;
  /**
   * Model context window in tokens. Diff and tool budgets are derived from
   * this so a 64k/128k/1M model actually uses the extra room.
   */
  contextWindowTokens?: number;
  /** @deprecated Derived from contextWindowTokens. Ignored by the server. */
  maxDiffChars?: number;
}

export interface AIProviderConfig extends AIPromptsConfig, AIRuntimeConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Legacy alias kept for backwards compatible persisted configs. */
  customSystemPrompt?: string;
}

/** Server-side view: every field is optional because it arrives over the wire. */
export type PartialAIProviderConfig = Partial<AIProviderConfig>;

export type ScopeType = 'line' | 'chunk' | 'file' | 'commit' | 'repo';

/**
 * Distinguishes formatting jobs (in-place pseudocode / NL reading) from a
 * free-form review so the server does not have to sniff the prompt text.
 */
export type ExplainTask = 'review' | 'pseudocode' | 'natural_language' | 'learn';
export type LearnRequestMode = 'question' | 'expand_graph' | 'drilldown_graph';

/** Identifies one concrete route occurrence selected for recursive drill-down. */
export interface LearnDrillTargetContext {
  routeId: string;
  routeLabel: string;
  stepIndex: number;
  label: string;
  kind: LearnBusinessStepKind;
  file: string;
  classSymbol: string;
  methodSymbol: string;
  relation: string;
  description: string;
  evidence: string;
  communityId: string;
  inputs: string[];
  outputs: string[];
  stateChanges: string[];
  failurePaths: string[];
}

export interface LearnExistingRouteContext {
  id: string;
  label: string;
  steps: Pick<LearnBusinessRouteStep, 'file' | 'classSymbol' | 'methodSymbol' | 'kind'>[];
}

export interface TargetLineInfo {
  lineNumber?: number;
  content: string;
  type?: 'add' | 'delete' | 'normal';
}

export interface ExplainRequest {
  scopeType?: ScopeType;
  targetLine?: TargetLineInfo;
  diff?: string;
  filePath?: string;
  commitMessage?: string;
  userPrompt?: string;
  task?: ExplainTask;
  learnRequestMode?: LearnRequestMode;
  existingBusinessRoutes?: LearnExistingRouteContext[];
  drillPath?: LearnDrillTargetContext[];
  config?: PartialAIProviderConfig;
}

export interface AgentExplainRequest extends ExplainRequest {
  repoPath: string;
}

// ------------------------------ SSE wire events ------------------------------

export type AgentPhase =
  | 'initializing'
  | 'thinking'
  | 'executing_tools'
  | 'reporting'
  | 'completed';

export interface AgentStatusEvent {
  type: 'status';
  phase: AgentPhase;
  message: string;
  step?: number;
}

export interface AgentToolEvent {
  type: 'tool_call' | 'tool_result' | 'thought';
  id?: string;
  name?: string;
  args?: unknown;
  summary?: string;
  output?: string;
  text?: string;
}

export interface AgentErrorEvent {
  type: 'error';
  message: string;
}
