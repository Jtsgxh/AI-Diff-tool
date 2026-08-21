import type { AIProviderConfig } from '../types';
import { cancelStreamFlush, flushStreamsNow, scheduleStreamFlush } from './streamScheduler';

export interface AIToolExecution {
  name: string;
  args?: any;
  output?: string;
  timestamp: number;
}

export interface AICallSession {
  id: string;
  title: string;
  type: 'agent' | 'fast_diff' | 'pseudocode' | 'natural_language';
  status: 'running' | 'completed' | 'error' | 'aborted';
  startTime: number;
  endTime?: number;
  provider: string;
  model: string;
  baseUrl?: string;
  filePath?: string;
  scopeType?: string;
  systemPrompt?: string;
  userPrompt?: string;
  inputDiff?: string;
  rawOutput: string;
  reasoningContent?: string;
  toolEvents: AIToolExecution[];
  error?: string;
}

/** Cheap scalars derived from the session list, for consumers that only need counts. */
export interface AILoggerSummary {
  total: number;
  running: number;
}

type Listener = (sessions: AICallSession[]) => void;
type SummaryListener = (summary: AILoggerSummary) => void;

class AILoggerService {
  private sessions: AICallSession[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly summaryListeners = new Set<SummaryListener>();
  private readonly maxSessions = 50;

  private lastSummary: AILoggerSummary = { total: 0, running: 0 };
  /**
   * Stable identity so the shared scheduler can coalesce and cancel this
   * logger's flush. Notifications are batched there together with the review
   * workbench's, so the AI console and the workbench update in the same render.
   */
  private readonly boundEmit = () => this.emit();

  /** Full session stream. Batched on the shared flush tick while streaming. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener([...this.sessions]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Counts only. Fires solely when a count actually changes, so a component
   * showing "N running" does not re-render once per token.
   */
  subscribeSummary(listener: SummaryListener): () => void {
    this.summaryListeners.add(listener);
    listener(this.lastSummary);
    return () => {
      this.summaryListeners.delete(listener);
    };
  }

  getSessions(): AICallSession[] {
    return [...this.sessions];
  }

  getSummary(): AILoggerSummary {
    return this.lastSummary;
  }

  startSession(params: {
    id?: string;
    title: string;
    type: AICallSession['type'];
    config?: AIProviderConfig;
    filePath?: string;
    scopeType?: string;
    systemPrompt?: string;
    userPrompt?: string;
    inputDiff?: string;
  }): string {
    const id = params.id || `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    this.sessions = [
      {
        id,
        title: params.title,
        type: params.type,
        status: 'running',
        startTime: Date.now(),
        provider: params.config?.provider || 'deepseek',
        model: params.config?.model || 'deepseek-chat',
        baseUrl: params.config?.baseUrl,
        filePath: params.filePath,
        scopeType: params.scopeType,
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        inputDiff: params.inputDiff,
        rawOutput: '',
        reasoningContent: '',
        toolEvents: [],
      },
      ...this.sessions.slice(0, this.maxSessions - 1),
    ];

    this.notifyNow();
    return id;
  }

  appendChunk(id: string, chunk: string): void {
    const session = this.find(id);
    if (!session) return;
    session.rawOutput += chunk;
    this.scheduleNotify();
  }

  appendReasoning(id: string, reasoning: string): void {
    const session = this.find(id);
    if (!session) return;
    session.reasoningContent = (session.reasoningContent || '') + reasoning;
    this.scheduleNotify();
  }

  appendToolEvent(id: string, tool: { name: string; args?: any; output?: string }): void {
    const session = this.find(id);
    if (!session) return;
    session.toolEvents.push({ ...tool, timestamp: Date.now() });
    this.scheduleNotify();
  }

  completeSession(id: string): void {
    this.endSession(id, 'completed');
  }

  errorSession(id: string, error: string): void {
    const session = this.find(id);
    if (!session) return;
    session.error = error;
    this.endSession(id, 'error');
  }

  abortSession(id: string): void {
    // Only a live session can be aborted; a finished one keeps its outcome.
    if (this.find(id)?.status !== 'running') return;
    this.endSession(id, 'aborted');
  }

  clearLogs(): void {
    cancelStreamFlush(this.boundEmit);
    this.sessions = [];
    this.notifyNow();
  }

  hasActiveSessions(): boolean {
    return this.lastSummary.running > 0;
  }

  private find(id: string): AICallSession | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  private endSession(id: string, status: AICallSession['status']): void {
    const session = this.find(id);
    if (!session) return;
    session.status = status;
    session.endTime = Date.now();
    this.notifyNow();
  }

  /** Coalesces high-frequency appends onto the shared flush tick. */
  private scheduleNotify(): void {
    scheduleStreamFlush(this.boundEmit);
  }

  /**
   * For lifecycle transitions, where the delay would be perceptible. Flushes
   * every other pending stream consumer too, so no pane is left a tick behind
   * on a session that just started or finished.
   */
  private notifyNow(): void {
    scheduleStreamFlush(this.boundEmit);
    flushStreamsNow();
  }

  private emit(): void {
    if (this.listeners.size > 0) {
      const copy = [...this.sessions];
      this.listeners.forEach((listener) => listener(copy));
    }

    const summary: AILoggerSummary = {
      total: this.sessions.length,
      running: this.sessions.reduce((n, s) => n + (s.status === 'running' ? 1 : 0), 0),
    };

    if (summary.total !== this.lastSummary.total || summary.running !== this.lastSummary.running) {
      this.lastSummary = summary;
      this.summaryListeners.forEach((listener) => listener(summary));
    }
  }
}

export const aiLogger = new AILoggerService();
