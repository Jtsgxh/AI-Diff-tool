import type {
  AgentStatusEvent,
  AgentToolEvent,
  AIProviderConfig,
  CommitNode,
  DiffResult,
  ExplainTask,
  RepoInfo,
  LearnGraph,
  LearnExistingRouteContext,
  LearnRequestMode,
  RepoOverview,
  ScopeType,
  TargetLineInfo,
} from '../types';
import { aiLogger } from './aiLogger';
import { readEventStream, SSE_DONE } from './sseClient';

export const API_BASE = '/api';

export type { AgentStatusEvent, AgentToolEvent } from '../types';

// ------------------------------ REST endpoints ------------------------------

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

/** Every REST call shares this shape: JSON on success, `{error}` on failure. */
async function getJson<T>(path: string, fallbackError: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || fallbackError);
  }
  return res.json();
}

async function postJson<T>(path: string, body: unknown, fallbackError: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || fallbackError);
  }
  return res.json();
}

export function fetchQuickPaths(): Promise<QuickPathsResponse> {
  return getJson('/system/quick-paths', 'Failed to fetch quick paths');
}

export function browseDirectory(targetPath?: string): Promise<BrowseDirectoryResponse> {
  const query = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
  return getJson(`/system/browse${query}`, 'Failed to browse directory');
}

export async function pickNativeFolder(): Promise<string | null> {
  try {
    const data = await postJson<{ path: string | null }>(
      '/system/pick-folder',
      {},
      'Folder picker unavailable'
    );
    return data.path || null;
  } catch {
    return null;
  }
}

export function fetchRepoInfo(path: string): Promise<RepoInfo> {
  return getJson(
    `/repo/info?path=${encodeURIComponent(path)}`,
    'Failed to fetch repository information'
  );
}

export function fetchCommits(path: string, limit = 100): Promise<{ commits: CommitNode[] }> {
  return getJson(
    `/repo/commits?path=${encodeURIComponent(path)}&limit=${limit}`,
    'Failed to fetch commits'
  );
}

export function fetchCommitDiff(path: string, hash: string): Promise<DiffResult> {
  return getJson(
    `/repo/diff/commit?path=${encodeURIComponent(path)}&hash=${encodeURIComponent(hash)}`,
    'Failed to fetch commit diff'
  );
}

export function fetchCompareDiff(
  path: string,
  base: string,
  target: string
): Promise<DiffResult> {
  return getJson(
    `/repo/diff/compare?path=${encodeURIComponent(path)}&base=${encodeURIComponent(
      base
    )}&target=${encodeURIComponent(target)}`,
    'Failed to fetch comparison diff'
  );
}

export function fetchRepoOverview(path: string): Promise<RepoOverview> {
  return getJson(
    `/repo/overview?path=${encodeURIComponent(path)}`,
    'Failed to fetch repository overview'
  );
}

export function fetchLearnGraph(path: string): Promise<LearnGraph> {
  return getJson(
    `/repo/learn-graph?path=${encodeURIComponent(path)}`,
    'Failed to fetch code graph'
  );
}

export function fetchWorkingTreeDiff(path: string): Promise<DiffResult> {
  return getJson(
    `/repo/diff/working-tree?path=${encodeURIComponent(path)}`,
    'Failed to fetch working tree diff'
  );
}

export function fetchBatchCommitsDiff(
  repoPath: string,
  commitHashes: string[]
): Promise<DiffResult> {
  return postJson(
    '/repo/diff/batch',
    { repoPath, commitHashes },
    'Failed to fetch batch commits diff'
  );
}

// ------------------------------ Streaming endpoints ------------------------------

interface BaseStreamPayload {
  sessionId?: string;
  scopeType?: ScopeType;
  targetLine?: TargetLineInfo;
  diff: string;
  filePath?: string;
  commitMessage?: string;
  userPrompt?: string;
  task?: ExplainTask;
  learnRequestMode?: LearnRequestMode;
  existingBusinessRoutes?: LearnExistingRouteContext[];
  config?: AIProviderConfig;
  onReasoning?: (chunk: string) => void;
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (err: Error) => void;
}

export type StreamExplainPayload = BaseStreamPayload;

export interface StreamAgentExplainPayload extends BaseStreamPayload {
  repoPath: string;
  onStatusUpdate?: (status: AgentStatusEvent) => void;
  onToolEvent: (event: AgentToolEvent) => void;
}

/**
 * In-flight streams keyed by request fingerprint, so re-issuing the same
 * request supersedes the previous one rather than racing it.
 */
const activeStreams = new Map<string, () => void>();

type SessionType = 'agent' | 'fast_diff' | 'pseudocode' | 'natural_language';

function describeFastSession(payload: StreamExplainPayload): {
  title: string;
  type: SessionType;
} {
  const fileName = payload.filePath ? payload.filePath.split('/').pop() : undefined;

  if (payload.task === 'pseudocode' || payload.userPrompt?.includes('伪代码')) {
    return { type: 'pseudocode', title: `🤖 原位伪代码转译 (${fileName || 'Diff'})` };
  }
  if (payload.task === 'natural_language' || payload.userPrompt?.includes('自然语言')) {
    return { type: 'natural_language', title: `📖 自然语言改动直读 (${fileName || 'Diff'})` };
  }
  if (payload.scopeType === 'line') {
    return {
      type: 'fast_diff',
      title: `⚡ 聚焦代码行解释 (Line ${payload.targetLine?.lineNumber || ''})`,
    };
  }
  return {
    type: 'fast_diff',
    title: fileName ? `⚡ 直接 Diff 解释 (${fileName})` : '⚡ 直接 Diff 解释',
  };
}

/**
 * Shared lifecycle for both streaming endpoints: fingerprint-based
 * deduplication, logger session bookkeeping, and a cancel handle.
 */
function runStream(params: {
  fingerprint: string;
  url: string;
  body: unknown;
  logSession: { title: string; type: SessionType };
  payload: BaseStreamPayload;
  onEvent: (event: any, raw: string, ctx: { logSessionId: string }) => boolean | void;
}): () => void {
  const { fingerprint, url, body, payload } = params;

  // Supersede an identical in-flight request.
  activeStreams.get(fingerprint)?.();
  activeStreams.delete(fingerprint);

  const abortController = new AbortController();
  const logSessionId = aiLogger.startSession({
    title: params.logSession.title,
    type: params.logSession.type,
    config: payload.config,
    filePath: payload.filePath,
    scopeType: payload.scopeType,
    userPrompt: payload.userPrompt,
    inputDiff: payload.diff,
  });

  const cleanup = () => {
    if (activeStreams.get(fingerprint) === cancel) {
      activeStreams.delete(fingerprint);
    }
  };

  const cancel = () => {
    cleanup();
    aiLogger.abortSession(logSessionId);
    abortController.abort();
  };

  activeStreams.set(fingerprint, cancel);

  let settled = false;
  let receivedDone = false;

  const complete = () => {
    if (settled) return;
    settled = true;
    cleanup();
    aiLogger.completeSession(logSessionId);
    payload.onComplete();
  };

  const fail = (err: Error) => {
    if (settled) return;
    settled = true;
    cleanup();
    aiLogger.errorSession(logSessionId, err.message);
    payload.onError(err);
  };

  readEventStream({
    url,
    body,
    signal: abortController.signal,
    onEvent: (event, raw) => {
      if (event === SSE_DONE || event?.type === 'done') receivedDone = true;
      return params.onEvent(event, raw, { logSessionId });
    },
  })
    .then(() => {
      if (receivedDone) {
        complete();
        return;
      }
      // The socket closed without the terminal sentinel — the report is
      // truncated. Treating this as success used to leave a half-written
      // review marked "已完成".
      fail(new Error('审查连接中断，报告可能不完整。请点击右上角重新审查。'));
    })
    .catch((err: any) => {
      if (err?.name === 'AbortError') {
        if (settled) return;
        settled = true;
        cleanup();
        aiLogger.abortSession(logSessionId);
        return;
      }
      fail(err instanceof Error ? err : new Error(String(err?.message || err)));
    });

  return cancel;
}

/** Fast mode: `{text}` / `{reasoning}` frames terminated by `[DONE]`. */
export async function streamExplainDiff(
  payload: StreamExplainPayload
): Promise<() => void> {
  const fingerprint =
    payload.sessionId ||
    `diff::${payload.scopeType || ''}::${payload.filePath || ''}::${
      payload.targetLine?.lineNumber || ''
    }::${payload.userPrompt || ''}::${payload.diff?.length || 0}`;

  return runStream({
    fingerprint,
    url: `${API_BASE}/ai/explain/stream`,
    body: {
      scopeType: payload.scopeType,
      targetLine: payload.targetLine,
      diff: payload.diff,
      filePath: payload.filePath,
      commitMessage: payload.commitMessage,
      userPrompt: payload.userPrompt,
      task: payload.task,
      config: payload.config,
    },
    logSession: describeFastSession(payload),
    payload,
    onEvent: (event, raw, { logSessionId }) => {
      // `[DONE]` ends the stream; `runStream` turns that into onComplete().
      if (event === SSE_DONE) return true;

      if (event === undefined) {
        // Non-JSON frame: surface it verbatim rather than dropping it.
        aiLogger.appendChunk(logSessionId, raw);
        payload.onChunk(raw);
        return;
      }

      if (event.error) {
        throw new Error(String(event.error));
      }

      if (event.reasoning) {
        aiLogger.appendReasoning(logSessionId, event.reasoning);
        payload.onReasoning?.(event.reasoning);
      }
      if (event.text) {
        aiLogger.appendChunk(logSessionId, event.text);
        payload.onChunk(event.text);
      }
    },
  });
}

/** Agent mode: typed `{type: 'status'|'tool_call'|'thought'|'chunk'|'done'}` frames. */
export async function streamAgentExplainDiff(
  payload: StreamAgentExplainPayload
): Promise<() => void> {
  const fingerprint =
    payload.sessionId ||
    `agent::${payload.repoPath}::${payload.scopeType || ''}::${payload.filePath || ''}::${
      payload.userPrompt || ''
    }::${payload.learnRequestMode || ''}::${
      payload.diff?.length || 0}`;

  const fileName = payload.filePath ? payload.filePath.split('/').pop() : '全库探查';

  return runStream({
    fingerprint,
    url: `${API_BASE}/ai/agent/explain/stream`,
    body: {
      repoPath: payload.repoPath,
      scopeType: payload.scopeType,
      targetLine: payload.targetLine,
      diff: payload.diff,
      filePath: payload.filePath,
      commitMessage: payload.commitMessage,
      userPrompt: payload.userPrompt,
      task: payload.task,
      learnRequestMode: payload.learnRequestMode,
      existingBusinessRoutes: payload.existingBusinessRoutes,
      config: payload.config,
    },
    logSession: { title: `🧠 Codex 智能体深度审查 (${fileName})`, type: 'agent' },
    payload,
    onEvent: (event, _raw, { logSessionId }) => {
      if (!event || event === SSE_DONE) return;

      switch (event.type) {
        // `runStream` turns the stop signal into onComplete().
        case 'done':
          return true;

        case 'error':
          throw new Error(String(event.message || '智能体审查失败'));

        case 'status':
          payload.onStatusUpdate?.(event);
          return;

        // A reasoning delta is not an exploration action: forwarding it to
        // onToolEvent made every thought show up in the tool trail as an
        // unnamed "工具调用" entry and inflated the action count.
        case 'thought':
          if (event.text) {
            aiLogger.appendReasoning(logSessionId, event.text);
            payload.onReasoning?.(event.text);
          }
          return;

        case 'tool_call':
          aiLogger.appendToolEvent(logSessionId, {
            name: event.name || 'tool_call',
            args: event.args,
          });
          payload.onToolEvent(event);
          return;

        case 'tool_result':
          aiLogger.appendToolEvent(logSessionId, {
            name: event.name || 'tool_result',
            output: event.output,
          });
          payload.onToolEvent(event);
          return;

        case 'chunk':
          if (event.text) {
            aiLogger.appendChunk(logSessionId, event.text);
            payload.onChunk(event.text);
          }
          return;

        default:
          return;
      }
    },
  });
}
