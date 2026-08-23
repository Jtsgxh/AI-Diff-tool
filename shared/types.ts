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

/** Model context-window size in tokens. Diff budgets are derived from this. */
export const CONTEXT_WINDOW_TOKENS = {
  min: 8_000,
  default: 1_000_000,
  max: 2_000_000,
} as const;

/**
 * Source is mostly ASCII (~4 chars/token). 3.5 leaves room for Chinese
 * prompts and tokenizer variance so we do not walk into the output budget.
 */
export const CONTEXT_CHARS_PER_TOKEN = 3.5;

/** Share of the window spent on the Diff itself. Agent keeps the rest for tools. */
export const CONTEXT_DIFF_FRACTION = {
  fast: 0.7,
  agent: 0.4,
  line: 0.16,
} as const;

const MODEL_CONTEXT_RULES: Array<{ test: RegExp; tokens: number }> = [
  { test: /gemini/i, tokens: 1_000_000 },
  { test: /claude/i, tokens: 200_000 },
  { test: /gpt-4o|gpt-4\.1|gpt-4-turbo|o3|o4-mini/i, tokens: 128_000 },
  { test: /gpt-4/i, tokens: 128_000 },
  { test: /deepseek/i, tokens: 64_000 },
  { test: /qwen|llama|mistral|phi|coder/i, tokens: 32_768 },
];

export function clampContextWindowTokens(tokens: number): number {
  return Math.max(
    CONTEXT_WINDOW_TOKENS.min,
    Math.min(CONTEXT_WINDOW_TOKENS.max, Math.round(tokens))
  );
}

/** Hint for the settings UI only — never applied unless the user clicks it. */
export function suggestContextWindowTokens(input: {
  provider?: string;
  model?: string;
}): number {
  const model = input.model || '';
  for (const rule of MODEL_CONTEXT_RULES) {
    if (rule.test.test(model)) return rule.tokens;
  }
  switch (input.provider) {
    case 'gemini':
      return 1_000_000;
    case 'openai':
    case 'openrouter':
      return 128_000;
    case 'ollama':
      return 32_768;
    default:
      return CONTEXT_WINDOW_TOKENS.default;
  }
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

/**
 * Wait for the provider's first response byte (headers / first SSE frame).
 * Streaming the rest of the body is not bound by this — a review can run
 * for many minutes after the stream has started.
 */
export const REQUEST_TIMEOUT_SECONDS = {
  min: 20,
  default: 180,
  max: 600,
} as const;

/**
 * Output cap sent on chat-completions / agent turns. 8k is accepted by
 * DeepSeek and most OpenAI-compatible gateways; the previous implicit
 * provider default (often 4k) cut long Chinese reviews off mid-sentence.
 */
export const MAX_OUTPUT_TOKENS = 8_192;

export interface AIRuntimeConfig {
  maxExplorationTurns?: number;
  timeoutSeconds?: number;
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
