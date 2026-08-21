import type { AgentStatusEvent, AgentToolEvent, BatchInfo, TargetLineInfo } from '../../types';

/** What a review session was opened against. */
export interface ExplanationScope {
  type: 'commit' | 'file' | 'hunk' | 'chunks' | 'compare' | 'line';
  title: string;
  diff: string;
  filePath?: string;
  commitMessage?: string;
  initialMode?: 'agent' | 'fast';
  commitHashes?: string[];
  batchInfo?: BatchInfo;
  targetLine?: TargetLineInfo;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolEvents?: AgentToolEvent[];
}

/** One tab in the drawer: a report plus its follow-up conversation. */
export interface ReviewSession {
  id: string;
  title: string;
  shortTitle: string;
  scope: ExplanationScope;
  engineMode: 'agent' | 'fast';
  isStreaming: boolean;
  initialReport: string;
  initialReasoning?: string;
  currentFollowUpStream: string;
  currentFollowUpReasoning?: string;
  currentFollowUpToolEvents?: AgentToolEvent[];
  currentToolEvents: AgentToolEvent[];
  agentStatus: AgentStatusEvent | null;
  chatHistory: ChatMessage[];
  elapsedSeconds: number;
  isCached?: boolean;
  error?: string | null;
}
