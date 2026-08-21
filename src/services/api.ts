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

export interface StreamExplainPayload {
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
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (err: Error) => void;
}

export async function streamExplainDiff(payload: StreamExplainPayload): Promise<() => void> {
  const abortController = new AbortController();

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
              payload.onComplete();
              return;
            }

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.text) {
                payload.onChunk(parsed.text);
              }
            } catch (e) {
              payload.onChunk(dataStr);
            }
          }
        }
        payload.onComplete();
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          payload.onError(err);
        }
      }
    };

    read();
    return () => abortController.abort();
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      payload.onError(err);
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
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (err: Error) => void;
}

export async function streamAgentExplainDiff(
  payload: StreamAgentExplainPayload
): Promise<() => void> {
  const abortController = new AbortController();

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
                payload.onComplete();
                return;
              } else if (event.type === 'status') {
                payload.onStatusUpdate?.(event);
              } else if (
                event.type === 'tool_call' ||
                event.type === 'tool_result' ||
                event.type === 'thought'
              ) {
                payload.onToolEvent(event);
              } else if (event.type === 'chunk' && event.text) {
                payload.onChunk(event.text);
              }
            } catch (e) {
              // fallback
            }
          }
        }
        payload.onComplete();
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          payload.onError(err);
        }
      }
    };

    read();
    return () => abortController.abort();
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      payload.onError(err);
    }
    return () => {};
  }
}
