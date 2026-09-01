import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentToolEvent, AIProviderConfig } from '../../types';
import { streamAgentExplainDiff, streamExplainDiff } from '../../services/api';
import { aiCache } from '../../services/aiCache';
import { STORAGE_KEYS, storage } from '../../constants/storage';
import {
  appendReviewContinuation,
  buildReviewContinuationPrompt,
} from '../../utils/reviewContinuation';
import {
  cancelStreamFlush,
  flushStreamsNow,
  scheduleStreamFlush,
} from '../../services/streamScheduler';
import type { ChatMessage, ExplanationScope, ReviewSession } from './types';

/** Session persistence is debounced and skipped entirely while streaming. */
const PERSIST_DEBOUNCE_MS = 1000;
const ELAPSED_TICK_MS = 500;

/**
 * Streamed text lands here first and is committed to React state on the shared
 * flush tick, bounding both re-renders and markdown re-parses no matter how
 * fast the provider streams — and keeping the workbench in lockstep with the
 * AI console, which batches on the same tick.
 */
interface StreamAccumulator {
  text: string;
  reasoning: string;
  toolEvents: AgentToolEvent[];
  /** The registered flush, kept so it can be cancelled when the stream ends. */
  commit: (() => void) | null;
}

type SubsequentStreamRequest =
  | { kind: 'follow-up'; prompt: string }
  | {
      kind: 'continuation';
      prompt: string;
      baseReport: string;
      baseReasoning: string;
      baseToolEvents: AgentToolEvent[];
    };

function shortTitleFor(scope: ExplanationScope): string {
  if (scope.batchInfo || scope.commitHashes || scope.title.includes('批量')) {
    const count = scope.batchInfo?.count || scope.commitHashes?.length || '';
    return `📦 批量(${count ? `${count}个` : '合并'})`;
  }
  if (scope.filePath) {
    const fileName = scope.filePath.replace(/\\/g, '/').split('/').pop() || scope.filePath;
    if (scope.type === 'hunk') return `${fileName}: 块`;
    if (scope.type === 'line') return `${fileName}: L${scope.targetLine?.lineNumber || ''}`;
    return fileName;
  }
  return scope.title.slice(0, 16);
}

/** Scope types map onto the narrower set the AI endpoints understand. */
function toScopeType(scope: ExplanationScope) {
  switch (scope.type) {
    case 'hunk':
    case 'chunks':
      return 'chunk' as const;
    case 'file':
      return 'file' as const;
    case 'line':
      return 'line' as const;
    default:
      return 'commit' as const;
  }
}

function loadPersistedSessions(): ReviewSession[] {
  const parsed = storage.getJson<ReviewSession[]>(STORAGE_KEYS.activeSessions, []);
  if (!Array.isArray(parsed)) return [];

  // Streams never survive a reload, so restore every tab as settled.
  return parsed.map((s) => ({
    ...s,
    isStreaming: false,
    currentFollowUpStream: '',
    currentFollowUpReasoning: '',
    currentFollowUpToolEvents: [],
  }));
}

/**
 * Owns the drawer's review sessions: creation, cache lookup, streaming,
 * follow-up turns, and persistence. The drawer component is left rendering only.
 */
export function useReviewSessions(repoPath: string, aiConfig: AIProviderConfig) {
  const [sessions, setSessions] = useState<ReviewSession[]>(loadPersistedSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() =>
    storage.get(STORAGE_KEYS.activeSessionId)
  );

  const sessionsRef = useRef<ReviewSession[]>(sessions);
  const abortsRef = useRef<Map<string, () => void>>(new Map());
  const timersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const accumulatorsRef = useRef<Map<string, StreamAccumulator>>(new Map());
  const persistHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read inside callbacks without making them depend on config identity.
  const configRef = useRef(aiConfig);
  configRef.current = aiConfig;
  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;

  sessionsRef.current = sessions;

  const updateSession = useCallback(
    (id: string, updater: (prev: ReviewSession) => ReviewSession) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
    },
    []
  );

  // ---------------------------- persistence ----------------------------

  useEffect(() => {
    // JSON.stringify over every report is expensive; never run it inside the
    // token stream, where it would stall the frame that renders the tokens.
    if (sessions.some((s) => s.isStreaming)) return;

    if (persistHandleRef.current) clearTimeout(persistHandleRef.current);
    persistHandleRef.current = setTimeout(() => {
      if (sessions.length === 0) {
        storage.remove(STORAGE_KEYS.activeSessions);
        return;
      }
      storage.setJson(
        STORAGE_KEYS.activeSessions,
        sessions.map((s) => ({
          ...s,
          isStreaming: false,
          currentFollowUpStream: '',
          currentFollowUpReasoning: '',
        }))
      );
    }, PERSIST_DEBOUNCE_MS);

    return () => {
      if (persistHandleRef.current) clearTimeout(persistHandleRef.current);
    };
  }, [sessions]);

  useEffect(() => {
    if (activeSessionId) storage.set(STORAGE_KEYS.activeSessionId, activeSessionId);
    else storage.remove(STORAGE_KEYS.activeSessionId);
  }, [activeSessionId]);

  // Abort every stream and timer if the drawer unmounts entirely.
  useEffect(
    () => () => {
      abortsRef.current.forEach((abort) => abort());
      abortsRef.current.clear();
      timersRef.current.forEach((timer) => clearInterval(timer));
      timersRef.current.clear();
      accumulatorsRef.current.forEach((acc) => {
        if (acc.commit) cancelStreamFlush(acc.commit);
      });
      accumulatorsRef.current.clear();
    },
    []
  );

  // ---------------------------- streaming ----------------------------

  const cacheKeyFor = useCallback(
    (scope: ExplanationScope, mode: 'agent' | 'fast') =>
      aiCache.generateKey({
        type: scope.type,
        filePath: scope.filePath,
        diff: scope.diff,
        targetLine: scope.targetLine?.lineNumber,
        engineMode: mode,
        model: configRef.current.model,
      }),
    []
  );

  const stopSessionTimers = useCallback((sessionId: string) => {
    const timer = timersRef.current.get(sessionId);
    if (timer) {
      clearInterval(timer);
      timersRef.current.delete(sessionId);
    }
    const acc = accumulatorsRef.current.get(sessionId);
    if (acc?.commit) {
      cancelStreamFlush(acc.commit);
      acc.commit = null;
    }
  }, []);

  const startSessionTimer = useCallback(
    (sessionId: string) => {
      const existing = timersRef.current.get(sessionId);
      if (existing) clearInterval(existing);
      timersRef.current.set(
        sessionId,
        setInterval(() => {
          updateSession(sessionId, (s) => ({
            ...s,
            elapsedSeconds: +(s.elapsedSeconds + ELAPSED_TICK_MS / 1000).toFixed(1),
          }));
        }, ELAPSED_TICK_MS)
      );
    },
    [updateSession]
  );

  const executeStreamSession = useCallback(
    async (
      sessionId: string,
      scope: ExplanationScope,
      mode: 'agent' | 'fast',
      cacheKey: string,
      request?: SubsequentStreamRequest
    ) => {
      const config = configRef.current;
      const isFollowUp = request?.kind === 'follow-up';
      const isContinuation = request?.kind === 'continuation';

      const acc: StreamAccumulator = {
        text: '',
        reasoning: '',
        toolEvents: [],
        commit: null,
      };
      accumulatorsRef.current.set(sessionId, acc);

      const continuedReport = () =>
        isContinuation
          ? appendReviewContinuation(request.baseReport, acc.text)
          : acc.text;
      const continuedReasoning = () =>
        isContinuation
          ? appendReviewContinuation(request.baseReasoning, acc.reasoning)
          : acc.reasoning;
      const continuedToolEvents = () =>
        isContinuation
          ? [...request.baseToolEvents, ...acc.toolEvents]
          : acc.toolEvents;

      /** Writes whatever has accumulated so far into React state. */
      const commit = () => {
        updateSession(sessionId, (s) =>
          isFollowUp
            ? {
                ...s,
                currentFollowUpStream: acc.text,
                currentFollowUpReasoning: acc.reasoning,
                currentFollowUpToolEvents: acc.toolEvents,
              }
            : {
                ...s,
                initialReport: continuedReport(),
                initialReasoning: continuedReasoning(),
                currentToolEvents: continuedToolEvents(),
              }
        );
      };

      acc.commit = commit;

      /**
       * `immediate` is for the moments where a tick of latency is perceptible:
       * the first token of a response, and every tool event. It flushes through
       * the shared scheduler rather than calling `commit` directly, so the AI
       * console lands in the same React render instead of a tick behind.
       */
      const scheduleCommit = (immediate = false) => {
        scheduleStreamFlush(commit);
        if (immediate) flushStreamsNow();
      };

      /** tool_result frames update the matching tool_call in place. */
      const recordToolEvent = (event: AgentToolEvent) => {
        if (event.type === 'tool_result' && event.id) {
          const idx = acc.toolEvents.findIndex((e) => e.id === event.id);
          if (idx !== -1) {
            acc.toolEvents = [
              ...acc.toolEvents.slice(0, idx),
              { ...acc.toolEvents[idx], ...event },
              ...acc.toolEvents.slice(idx + 1),
            ];
            scheduleCommit(true);
            return;
          }
        }
        acc.toolEvents = [...acc.toolEvents, event];
        scheduleCommit(true);
      };

      const finalize = () => {
        stopSessionTimers(sessionId);
        abortsRef.current.delete(sessionId);
        accumulatorsRef.current.delete(sessionId);
      };

      const handleComplete = () => {
        const latest = sessionsRef.current.find((s) => s.id === sessionId);

        const chatHistory: ChatMessage[] = isFollowUp
          ? [
              ...(latest?.chatHistory || []),
              {
                role: 'assistant',
                content: acc.text,
                reasoning: acc.reasoning,
                toolEvents: acc.toolEvents.length > 0 ? acc.toolEvents : undefined,
              },
            ]
          : latest?.chatHistory || [];

        const report = isFollowUp ? latest?.initialReport || '' : continuedReport();
        const reasoning = isFollowUp ? latest?.initialReasoning || '' : continuedReasoning();
        const toolEvents = isFollowUp ? latest?.currentToolEvents || [] : continuedToolEvents();

        updateSession(sessionId, (s) => ({
          ...s,
          // The last partial flush may still be pending — apply it here.
          initialReport: report,
          initialReasoning: reasoning,
          currentToolEvents: toolEvents,
          isStreaming: false,
          agentStatus: {
            type: 'status',
            phase: 'completed',
            message: isFollowUp
              ? '追问解答完成'
              : isContinuation
              ? '已从中断点继续完成'
              : mode === 'agent'
              ? 'Codex 深度审查完成'
              : '直接 Diff 解析完成',
          },
          chatHistory,
          currentFollowUpStream: '',
          currentFollowUpReasoning: '',
          currentFollowUpToolEvents: [],
          error: null,
          isCached: false,
        }));

        if (report.trim()) {
          aiCache.set(cacheKey, {
            report,
            toolEvents,
            chatHistory,
            reasoning,
            model: config.model,
            provider: config.provider,
          });
        }

        finalize();
      };

      const handleError = (err: Error) => {
        commit();
        updateSession(sessionId, (s) => ({
          ...s,
          isStreaming: false,
          error: err.message,
          agentStatus: {
            type: 'status',
            phase: 'completed',
            message: '审查异常中断',
          },
        }));
        finalize();
      };

      const shared = {
        sessionId,
        scopeType: toScopeType(scope),
        diff: scope.diff,
        filePath: scope.filePath,
        commitMessage: scope.commitMessage,
        userPrompt: request?.prompt,
        config,
        onReasoning: (chunk: string) => {
          const isFirst = !acc.reasoning;
          acc.reasoning += chunk;
          scheduleCommit(isFirst);
        },
        onChunk: (chunk: string) => {
          const isFirst = !acc.text;
          acc.text += chunk;
          scheduleCommit(isFirst);
        },
        onComplete: handleComplete,
        onError: handleError,
      };

      try {
        const cancel =
          mode === 'agent'
            ? await streamAgentExplainDiff({
                ...shared,
                repoPath: repoPathRef.current,
                onStatusUpdate: (status) => {
                  updateSession(sessionId, (s) => ({ ...s, agentStatus: status }));
                },
                onToolEvent: recordToolEvent,
              })
            : await streamExplainDiff(shared);

        abortsRef.current.set(sessionId, cancel);
      } catch (err: any) {
        handleError(err);
      }
    },
    [stopSessionTimers, updateSession]
  );

  // ---------------------------- session lifecycle ----------------------------

  const startOrActivateSession = useCallback(
    (scope: ExplanationScope, mode: 'agent' | 'fast', forceRefresh = false) => {
      const sessionId = `session_${scope.type}_${scope.filePath || 'global'}_${
        scope.diff.length
      }_${mode}`;

      if (!forceRefresh) {
        const existing = sessionsRef.current.find((s) => s.id === sessionId);
        // Reuse a live or successful tab. A completed tab with no report, or
        // one that ended in error (connection drop mid-review), is retried.
        if (
          existing &&
          !existing.error &&
          (existing.isStreaming || existing.initialReport?.trim())
        ) {
          setActiveSessionId(sessionId);
          return;
        }
      }

      const shortTitle = shortTitleFor(scope);
      const fullTitle = scope.title || shortTitle;
      const cacheKey = cacheKeyFor(scope, mode);

      if (!forceRefresh) {
        const cached = aiCache.get(cacheKey);
        // Empty reports used to get cached when an agent run blew the context
        // window and finished with no tokens — reopening then "succeeded" instantly
        // with a blank pane. Ignore those entries so the request is retried.
        if (cached?.report?.trim()) {
          const cachedSession: ReviewSession = {
            id: sessionId,
            title: fullTitle,
            shortTitle,
            scope,
            engineMode: mode,
            isStreaming: false,
            initialReport: cached.report,
            initialReasoning: cached.reasoning || '',
            currentFollowUpStream: '',
            currentFollowUpReasoning: '',
            currentToolEvents: cached.toolEvents || [],
            agentStatus: { type: 'status', phase: 'completed', message: '已从本地缓存秒开加载' },
            chatHistory: cached.chatHistory || [],
            elapsedSeconds: 0,
            isCached: true,
            error: null,
          };

          setSessions((prev) => [cachedSession, ...prev.filter((s) => s.id !== sessionId)]);
          setActiveSessionId(sessionId);
          return;
        }
      }

      // Re-running the same tab supersedes whatever it was already doing.
      abortsRef.current.get(sessionId)?.();
      abortsRef.current.delete(sessionId);
      stopSessionTimers(sessionId);

      const newSession: ReviewSession = {
        id: sessionId,
        title: fullTitle,
        shortTitle,
        scope,
        engineMode: mode,
        isStreaming: true,
        initialReport: '',
        initialReasoning: '',
        currentFollowUpStream: '',
        currentFollowUpReasoning: '',
        currentToolEvents: [],
        agentStatus: {
          type: 'status',
          phase: 'initializing',
          message: mode === 'agent' ? 'Codex 智能体探查中...' : 'Diff 解析中...',
        },
        chatHistory: [],
        elapsedSeconds: 0,
        isCached: false,
        error: null,
      };

      setSessions((prev) => [newSession, ...prev.filter((s) => s.id !== sessionId)]);
      setActiveSessionId(sessionId);

      startSessionTimer(sessionId);

      executeStreamSession(sessionId, scope, mode, cacheKey);
    },
    [cacheKeyFor, executeStreamSession, startSessionTimer, stopSessionTimers]
  );

  const closeSession = useCallback((id: string) => {
    abortsRef.current.get(id)?.();
    abortsRef.current.delete(id);

    const timer = timersRef.current.get(id);
    if (timer) {
      clearInterval(timer);
      timersRef.current.delete(id);
    }

    // Computed outside the updater: a state updater must stay pure, and React
    // may invoke it more than once.
    const remaining = sessionsRef.current.filter((s) => s.id !== id);
    setSessions(remaining);
    setActiveSessionId((current) =>
      current === id ? (remaining.length > 0 ? remaining[0].id : null) : current
    );
  }, []);

  const closeAllSessions = useCallback(() => {
    abortsRef.current.forEach((abort) => abort());
    abortsRef.current.clear();
    timersRef.current.forEach((timer) => clearInterval(timer));
    timersRef.current.clear();
    setSessions([]);
    setActiveSessionId(null);
  }, []);

  const sendFollowUp = useCallback(
    (question: string) => {
      const active = sessionsRef.current.find((s) => s.id === activeSessionId) || null;
      if (!question || !active || active.isStreaming) return;

      const nextChatHistory: ChatMessage[] = [
        ...active.chatHistory,
        { role: 'user', content: question },
      ];

      updateSession(active.id, (s) => ({
        ...s,
        chatHistory: nextChatHistory,
        currentFollowUpStream: '',
        currentFollowUpReasoning: '',
        currentFollowUpToolEvents: [],
        isStreaming: true,
        error: null,
      }));

      const cacheKey = cacheKeyFor(active.scope, active.engineMode);
      // Persist the question immediately so it survives a reload mid-answer.
      aiCache.set(cacheKey, {
        report: active.initialReport,
        toolEvents: active.currentToolEvents,
        chatHistory: nextChatHistory,
        reasoning: active.initialReasoning,
        model: configRef.current.model,
        provider: configRef.current.provider,
      });

      executeStreamSession(active.id, active.scope, active.engineMode, cacheKey, {
        kind: 'follow-up',
        prompt: question,
      });
    },
    [activeSessionId, cacheKeyFor, executeStreamSession, updateSession]
  );

  const continueInterruptedSession = useCallback(() => {
    const active = sessionsRef.current.find((s) => s.id === activeSessionId) || null;
    if (!active || active.isStreaming || !active.error || !active.initialReport.trim()) return;

    const cacheKey = cacheKeyFor(active.scope, active.engineMode);
    const request: SubsequentStreamRequest = {
      kind: 'continuation',
      prompt: buildReviewContinuationPrompt(active.initialReport, configRef.current),
      baseReport: active.initialReport,
      baseReasoning: active.initialReasoning || '',
      baseToolEvents: active.currentToolEvents,
    };

    stopSessionTimers(active.id);
    abortsRef.current.get(active.id)?.();
    abortsRef.current.delete(active.id);
    updateSession(active.id, (s) => ({
      ...s,
      isStreaming: true,
      error: null,
      isCached: false,
      agentStatus: {
        type: 'status',
        phase: 'initializing',
        message: '正在从中断点继续生成...',
      },
    }));
    startSessionTimer(active.id);
    executeStreamSession(active.id, active.scope, active.engineMode, cacheKey, request);
  }, [
    activeSessionId,
    cacheKeyFor,
    executeStreamSession,
    startSessionTimer,
    stopSessionTimers,
    updateSession,
  ]);

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) || sessions[0] || null;

  return {
    sessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    startOrActivateSession,
    closeSession,
    closeAllSessions,
    sendFollowUp,
    continueInterruptedSession,
  };
}
