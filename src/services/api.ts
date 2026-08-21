import { RepoInfo, CommitNode, DiffResult, AIProviderConfig } from '../types';

export const API_BASE = '/api';

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
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      payload.onError(err);
    }
  }

  return () => abortController.abort();
}
