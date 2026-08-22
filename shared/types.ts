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
}

// ------------------------------ AI domain ------------------------------

export type AIProvider = 'deepseek' | 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'custom';

export interface AIPromptsConfig {
  /** 1. Codex 深度代码审查提示词 */
  reviewPrompt?: string;
  /** 2. 直接 Diff 快速解释提示词 */
  fastDiffPrompt?: string;
  /** 3. 概括性伪代码提炼提示词 */
  pseudocodePrompt?: string;
  /** 4. 自然语言改动直读提示词 */
  naturalLanguagePrompt?: string;
}

/** Caps on how much diff text is forwarded to the model. Characters, not tokens. */
export const DIFF_CHAR_LIMITS = {
  /** Full-file / multi-file / hunk review (fast + agent). */
  default: 64_000,
  /** Surrounding context when the user focused a single line. */
  line: 16_000,
  min: 8_000,
  max: 120_000,
} as const;

export interface AIRuntimeConfig {
  maxExplorationTurns?: number;
  timeoutSeconds?: number;
  maxRetries?: number;
  maxReadFileLines?: number;
  maxSearchResults?: number;
  /** Max characters of diff body sent to the model (clamped to DIFF_CHAR_LIMITS). */
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

export type ScopeType = 'line' | 'chunk' | 'file' | 'commit';

/**
 * Distinguishes formatting jobs (in-place pseudocode / NL reading) from a
 * free-form review so the server does not have to sniff the prompt text.
 */
export type ExplainTask = 'review' | 'pseudocode' | 'natural_language';

export interface TargetLineInfo {
  lineNumber?: number;
  content: string;
  type?: 'add' | 'delete' | 'normal';
}

export interface ExplainRequest {
  scopeType?: ScopeType;
  targetLine?: TargetLineInfo;
  diff: string;
  filePath?: string;
  commitMessage?: string;
  userPrompt?: string;
  task?: ExplainTask;
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
