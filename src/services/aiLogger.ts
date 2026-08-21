import { AIProviderConfig } from '../types';

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

type Listener = (sessions: AICallSession[]) => void;

class AILoggerService {
  private sessions: AICallSession[] = [];
  private listeners: Set<Listener> = new Set();
  private maxSessions = 50;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener([...this.sessions]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const copy = [...this.sessions];
    this.listeners.forEach((listener) => listener(copy));
  }

  getSessions(): AICallSession[] {
    return [...this.sessions];
  }

  startSession(params: {
    id?: string;
    title: string;
    type: 'agent' | 'fast_diff' | 'pseudocode' | 'natural_language';
    config?: AIProviderConfig;
    filePath?: string;
    scopeType?: string;
    systemPrompt?: string;
    userPrompt?: string;
    inputDiff?: string;
  }): string {
    const id = params.id || `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newSession: AICallSession = {
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
    };

    // Prepend to list (most recent first)
    this.sessions = [newSession, ...this.sessions.slice(0, this.maxSessions - 1)];
    this.notify();
    return id;
  }

  appendChunk(id: string, chunk: string) {
    const session = this.sessions.find((s) => s.id === id);
    if (!session) return;

    session.rawOutput += chunk;
    this.notify();
  }

  appendReasoning(id: string, reasoning: string) {
    const session = this.sessions.find((s) => s.id === id);
    if (!session) return;

    session.reasoningContent = (session.reasoningContent || '') + reasoning;
    this.notify();
  }

  appendToolEvent(id: string, tool: { name: string; args?: any; output?: string }) {
    const session = this.sessions.find((s) => s.id === id);
    if (!session) return;

    session.toolEvents.push({
      ...tool,
      timestamp: Date.now(),
    });
    this.notify();
  }

  completeSession(id: string) {
    const session = this.sessions.find((s) => s.id === id);
    if (!session) return;

    session.status = 'completed';
    session.endTime = Date.now();
    this.notify();
  }

  errorSession(id: string, error: string) {
    const session = this.sessions.find((s) => s.id === id);
    if (!session) return;

    session.status = 'error';
    session.error = error;
    session.endTime = Date.now();
    this.notify();
  }

  abortSession(id: string) {
    const session = this.sessions.find((s) => s.id === id);
    if (!session) return;

    if (session.status === 'running') {
      session.status = 'aborted';
      session.endTime = Date.now();
      this.notify();
    }
  }

  clearLogs() {
    this.sessions = [];
    this.notify();
  }

  hasActiveSessions(): boolean {
    return this.sessions.some((s) => s.status === 'running');
  }
}

export const aiLogger = new AILoggerService();
