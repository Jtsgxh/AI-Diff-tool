/**
 * Wire types are defined once in `shared/types.ts` and re-exported here so
 * application code keeps importing from `@/types`.
 */
export type {
  AgentPhase,
  AgentErrorEvent,
  AgentStatusEvent,
  AgentToolEvent,
  AIPromptsConfig,
  AIProvider,
  AIProviderConfig,
  AIRuntimeConfig,
  BatchInfo,
  CommitNode,
  DiffFile,
  DiffResult,
  DiffSummary,
  ExplainTask,
  LearnAnalysisCommunity,
  LearnAnalysisEnvelope,
  LearnBridge,
  LearnBusinessRoute,
  LearnBusinessRouteStep,
  LearnBusinessStepKind,
  LearnCommunity,
  LearnEdge,
  LearnGodNode,
  LearnGraph,
  LearnNode,
  LearnNodeKind,
  LearnRelation,
  RepoInfo,
  RepoOverview,
  ScopeType,
  TargetLineInfo,
} from '../../shared/types';

export {
  CONTEXT_WINDOW_TOKENS,
  LEARN_ANALYSIS_SCHEMA_VERSION,
  LEARN_BUSINESS_STEP_KINDS,
  REQUEST_TIMEOUT_SECONDS,
  diffCharBudgetFromWindow,
  inferContextWindowTokens,
} from '../../shared/types';

import type { CommitNode } from '../../shared/types';

// ------------------------------ Client-only types ------------------------------

export type DiffViewMode = 'split' | 'unified' | 'natural';

export interface SelectionState {
  type: 'commit' | 'compare' | 'working-tree' | 'batch';
  commitHash?: string;
  baseHash?: string;
  targetHash?: string;
  commitHashes?: string[];
  batchTitle?: string;
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
