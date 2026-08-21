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

export interface DiffResult {
  title: string;
  summary: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  files: DiffFile[];
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

export type DiffViewMode = 'split' | 'unified' | 'natural';

export interface AIPromptsConfig {
  // 1. Codex 深度代码审查提示词
  reviewPrompt?: string;
  // 2. 直接 Diff 快速解释提示词
  fastDiffPrompt?: string;
  // 3. 概括性伪代码提炼提示词
  pseudocodePrompt?: string;
  // 4. 自然语言改动直读提示词
  naturalLanguagePrompt?: string;
}

export interface AIProviderConfig extends AIPromptsConfig {
  provider: 'deepseek' | 'gemini' | 'openai' | 'openrouter' | 'ollama' | 'custom';
  apiKey: string;
  baseUrl: string;
  model: string;
  // Custom Prompts (legacy alias)
  customSystemPrompt?: string;
  // Codex Agent Runtime Controls
  maxExplorationTurns?: number;
  timeoutSeconds?: number;
  maxRetries?: number;
  maxReadFileLines?: number;
  maxSearchResults?: number;
}

export interface SelectionState {
  type: 'commit' | 'compare' | 'working-tree';
  commitHash?: string;
  baseHash?: string;
  targetHash?: string;
}

export interface GraphNode extends CommitNode {
  column: number;
  color: string;
  isHead?: boolean;
}

export interface GraphLink {
  fromHash: string;
  toHash: string;
  fromCol: number;
  toCol: number;
  color: string;
}
