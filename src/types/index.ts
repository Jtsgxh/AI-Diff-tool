/**
 * Wire types are defined once in `shared/types.ts` and re-exported here so
 * application code keeps importing from `@/types`.
 */
export type {
  AgentPhase,
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
  RepoInfo,
  ScopeType,
  TargetLineInfo,
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
