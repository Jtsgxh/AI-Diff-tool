import { RepoInfo, CommitNode, DiffResult, AIProviderConfig } from '../types';

export const API_BASE = '/api';

export interface QuickPathsResponse {
  shortcuts: { name: string; path: string }[];
  drives: { name: string; path: string }[];
}

export interface BrowseDirectoryResponse {
  current: string;
  parent: string | null;
  isCurrentGitRepo: boolean;
  directories: { name: string; path: string; isGitRepo: boolean }[];
}

export async function fetchQuickPaths(): Promise<QuickPathsResponse> {
  const res = await fetch(`${API_BASE}/system/quick-paths`);
  if (!res.ok) throw new Error('Failed to fetch quick paths');
  return res.json();
}

export async function browseDirectory(targetPath?: string): Promise<BrowseDirectoryResponse> {
  const query = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
  const res = await fetch(`${API_BASE}/system/browse${query}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to browse directory');
  }
  return res.json();
}

export async function pickNativeFolder(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/system/pick-folder`, { method: 'POST' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.path || null;
  } catch (err) {
    return null;
  }
}

export async function fetchRepoInfo(path: string): Promise<RepoInfo> {
  const res = await fetch(`${API_BASE}/repo/info?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch repository information');
  }
  return res.json();
}

export async function fetchCommits(path: string, limit = 100): Promise<{ commits: CommitNode[] }> {
  const res = await fetch(`${API_BASE}/repo/commits?path=${encodeURIComponent(path)}&limit=${limit}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch commits');
  }
  return res.json();
}

export async function fetchCommitDiff(path: string, hash: string): Promise<DiffResult> {
  const res = await fetch(
    `${API_BASE}/repo/diff/commit?path=${encodeURIComponent(path)}&hash=${encodeURIComponent(hash)}`
  );
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch commit diff');
  }
  return res.json();
}

export async function fetchCompareDiff(path: string, base: string, target: string): Promise<DiffResult> {
  const res = await fetch(
    `${API_BASE}/repo/diff/compare?path=${encodeURIComponent(path)}&base=${encodeURIComponent(
      base
    )}&target=${encodeURIComponent(target)}`
  );
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch comparison diff');
  }
  return res.json();
}

export async function fetchWorkingTreeDiff(path: string): Promise<DiffResult> {
  const res = await fetch(`${API_BASE}/repo/diff/working-tree?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch working tree diff');
  }
  return res.json();
}

export async function fetchBatchCommitsDiff(
  repoPath: string,
  commitHashes: string[]
): Promise<DiffResult> {
  const res = await fetch(`${API_BASE}/repo/diff/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repoPath,
      commitHashes,
    }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch batch commits diff');
  }
  return res.json();
}

import { aiLogger } from './aiLogger';

export interface StreamExplainPayload {
  sessionId?: string;
  scopeType?: 'line' | 'chunk' | 'file' | 'commit';
  targetLine?: {
    lineNumber?: number;
    content: string;
    type?: 'add' | 'delete' | 'normal';
  };
  diff: string;
  filePath?: string;
  commitMessage?: string;
  userPrompt?: string;
  config?: AIProviderConfig;
  onReasoning?: (chunk: string) => void;
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (err: Error) => void;
}

const activeStreams = new Map<string, () => void>();

export async function streamExplainDiff(payload: StreamExplainPayload): Promise<() => void> {
  const abortController = new AbortController();

  // Deduplicate: only cancel exact same session or exact same request fingerprint
  const requestFingerprint =
    payload.sessionId ||
    `diff::${payload.scopeType || ''}::${payload.filePath || ''}::${
      payload.targetLine?.lineNumber || ''
    }::${payload.userPrompt || ''}::${payload.diff?.length || 0}`;

  if (activeStreams.has(requestFingerprint)) {
    activeStreams.get(requestFingerprint)?.();
    activeStreams.delete(requestFingerprint);
  }

  // Determine session title & type for AI Logger
  let title = '⚡ 直接 Diff 解释';
  let type: 'agent' | 'fast_diff' | 'pseudocode' | 'natural_language' = 'fast_diff';

  if (payload.userPrompt?.includes('伪代码')) {
    type = 'pseudocode';
    title = `🤖 原位伪代码转译 (${payload.filePath ? payload.filePath.split('/').pop() : 'Diff'})`;
  } else if (payload.userPrompt?.includes('自然语言')) {
    type = 'natural_language';
    title = `📖 自然语言改动直读 (${payload.filePath ? payload.filePath.split('/').pop() : 'Diff'})`;
  } else if (payload.scopeType === 'line') {
    title = `⚡ 聚焦代码行解释 (Line ${payload.targetLine?.lineNumber || ''})`;
  } else if (payload.filePath) {
    title = `⚡ 直接 Diff 解释 (${payload.filePath.split('/').pop()})`;
  }

  const logSessionId = aiLogger.startSession({
    title,
    type,
    config: payload.config,
    filePath: payload.filePath,
    scopeType: payload.scopeType,
    userPrompt: payload.userPrompt,
    inputDiff: payload.diff,
  });

  const cleanup = () => {
    if (activeStreams.get(requestFingerprint) === cancel) {
      activeStreams.delete(requestFingerprint);
    }
  };

  const cancel = () => {
    cleanup();
    aiLogger.abortSession(logSessionId);
    abortController.abort();
  };

  activeStreams.set(requestFingerprint, cancel);

  try {
    const res = await fetch(`${API_BASE}/ai/explain/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        scopeType: payload.scopeType,
        targetLine: payload.targetLine,
        diff: payload.diff,
        filePath: payload.filePath,
        commitMessage: payload.commitMessage,
        userPrompt: payload.userPrompt,
        config: payload.config,
      }),
      signal: abortController.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      aiLogger.errorSession(logSessionId, errText);
      throw new Error(`AI Request Failed (${res.status}): ${errText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('Readable stream not supported');

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const read = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.slice(6);

            if (dataStr === '[DONE]') {
              cleanup();
              aiLogger.completeSession(logSessionId);
              payload.onComplete();
              return;
            }

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.reasoning) {
                aiLogger.appendReasoning(logSessionId, parsed.reasoning);
                payload.onReasoning?.(parsed.reasoning);
              }
              if (parsed.text) {
                aiLogger.appendChunk(logSessionId, parsed.text);
                payload.onChunk(parsed.text);
              }
            } catch (e) {
              aiLogger.appendChunk(logSessionId, dataStr);
              payload.onChunk(dataStr);
            }
          }
        }
        cleanup();
        aiLogger.completeSession(logSessionId);
        payload.onComplete();
      } catch (err: any) {
        cleanup();
        if (err.name !== 'AbortError') {
          aiLogger.errorSession(logSessionId, err.message);
          payload.onError(err);
        } else {
          aiLogger.abortSession(logSessionId);
        }
      }
    };

    read();
    return cancel;
  } catch (err: any) {
    cleanup();
    if (err.name !== 'AbortError') {
      aiLogger.errorSession(logSessionId, err.message);
      payload.onError(err);
    } else {
      aiLogger.abortSession(logSessionId);
    }
    return () => {};
  }
}

export interface AgentToolEvent {
  type: 'tool_call' | 'tool_result' | 'thought';
  id?: string;
  name?: string;
  args?: any;
  summary?: string;
  output?: string;
  text?: string;
}

export interface AgentStatusEvent {
  type: 'status';
  phase: 'initializing' | 'thinking' | 'executing_tools' | 'reporting' | 'completed';
  message: string;
  step?: number;
}

export interface StreamAgentExplainPayload {
  sessionId?: string;
  repoPath: string;
  scopeType?: 'line' | 'chunk' | 'file' | 'commit';
  targetLine?: {
    lineNumber?: number;
    content: string;
    type?: 'add' | 'delete' | 'normal';
  };
  diff: string;
  filePath?: string;
  commitMessage?: string;
  userPrompt?: string;
  config?: AIProviderConfig;
  onStatusUpdate?: (status: AgentStatusEvent) => void;
  onToolEvent: (event: AgentToolEvent) => void;
  onReasoning?: (chunk: string) => void;
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (err: Error) => void;
}

export async function streamAgentExplainDiff(
  payload: StreamAgentExplainPayload
): Promise<() => void> {
  const abortController = new AbortController();

  // Deduplicate: only cancel exact same session or exact same agent fingerprint
  const requestFingerprint =
    payload.sessionId ||
    `agent::${payload.repoPath}::${payload.scopeType || ''}::${payload.filePath || ''}::${
      payload.userPrompt || ''
    }::${payload.diff?.length || 0}`;

  if (activeStreams.has(requestFingerprint)) {
    activeStreams.get(requestFingerprint)?.();
    activeStreams.delete(requestFingerprint);
  }

  const title = `🧠 Codex 智能体深度审查 (${
    payload.filePath ? payload.filePath.split('/').pop() : '全库探查'
  })`;
  const logSessionId = aiLogger.startSession({
    title,
    type: 'agent',
    config: payload.config,
    filePath: payload.filePath,
    scopeType: payload.scopeType,
    userPrompt: payload.userPrompt,
    inputDiff: payload.diff,
  });

  const cleanup = () => {
    if (activeStreams.get(requestFingerprint) === cancel) {
      activeStreams.delete(requestFingerprint);
    }
  };

  const cancel = () => {
    cleanup();
    aiLogger.abortSession(logSessionId);
    abortController.abort();
  };

  activeStreams.set(requestFingerprint, cancel);

  try {
    const res = await fetch(`${API_BASE}/ai/agent/explain/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        repoPath: payload.repoPath,
        scopeType: payload.scopeType,
        targetLine: payload.targetLine,
        diff: payload.diff,
        filePath: payload.filePath,
        commitMessage: payload.commitMessage,
        userPrompt: payload.userPrompt,
        config: payload.config,
      }),
      signal: abortController.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      aiLogger.errorSession(logSessionId, errText);
      throw new Error(`AI Agent Request Failed (${res.status}): ${errText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('Readable stream not supported');

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const read = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.slice(6);

            try {
              const event = JSON.parse(dataStr);
              if (event.type === 'done') {
                cleanup();
                aiLogger.completeSession(logSessionId);
                payload.onComplete();
                return;
              } else if (event.type === 'status') {
                payload.onStatusUpdate?.(event);
              } else if (
                event.type === 'tool_call' ||
                event.type === 'tool_result' ||
                event.type === 'thought'
              ) {
                if (event.type === 'thought' && event.text) {
                  aiLogger.appendReasoning(logSessionId, event.text);
                  payload.onReasoning?.(event.text);
                } else if (event.type === 'tool_call') {
                  aiLogger.appendToolEvent(logSessionId, {
                    name: event.name || 'tool_call',
                    args: event.args,
                  });
                } else if (event.type === 'tool_result') {
                  aiLogger.appendToolEvent(logSessionId, {
                    name: event.name || 'tool_result',
                    output: event.output,
                  });
                }
                payload.onToolEvent(event);
              } else if (event.type === 'chunk' && event.text) {
                aiLogger.appendChunk(logSessionId, event.text);
                payload.onChunk(event.text);
              }
            } catch (e) {
              // fallback
            }
          }
        }
        cleanup();
        aiLogger.completeSession(logSessionId);
        payload.onComplete();
      } catch (err: any) {
        cleanup();
        if (err.name !== 'AbortError') {
          aiLogger.errorSession(logSessionId, err.message);
          payload.onError(err);
        } else {
          aiLogger.abortSession(logSessionId);
        }
      }
    };

    read();
    return cancel;
  } catch (err: any) {
    cleanup();
    if (err.name !== 'AbortError') {
      aiLogger.errorSession(logSessionId, err.message);
      payload.onError(err);
    } else {
      aiLogger.abortSession(logSessionId);
    }
    return () => {};
  }
}
