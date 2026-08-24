import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentStatusEvent, AgentToolEvent, AIProviderConfig, LearnGraph, RepoOverview } from '../../types';
import { fetchLearnGraph, fetchRepoOverview, streamAgentExplainDiff } from '../../services/api';
import { aiCache } from '../../services/aiCache';
import {
  applyLearnAnalysis,
  humanizeLearnReport,
  parseLearnOverlay,
  visibleLearnProse,
} from '../../utils/learnGraph';
import { flushStreamsNow, scheduleStreamFlush } from '../../services/streamScheduler';

export interface LearnChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const ELAPSED_TICK_MS = 500;

export function useLearnSession(
  repoPath: string,
  aiConfig: AIProviderConfig,
  headHash?: string
) {
  const [overview, setOverview] = useState<RepoOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState('');
  const [graph, setGraph] = useState<LearnGraph | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState<AgentStatusEvent | null>(null);
  const [toolEvents, setToolEvents] = useState<AgentToolEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<LearnChatTurn[]>([]);
  const [followUpStream, setFollowUpStream] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const [structureReady, setStructureReady] = useState(false);

  const abortRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const configRef = useRef(aiConfig);
  configRef.current = aiConfig;
  const textRef = useRef('');
  const structuralRef = useRef<LearnGraph | null>(null);
  const structuralPathRef = useRef('');
  const graphRef = useRef<LearnGraph | null>(null);

  const cacheKey = `learn-v5::${repoPath}::${headHash || ''}::${aiConfig.model}`;

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => +(s + ELAPSED_TICK_MS / 1000).toFixed(1));
    }, ELAPSED_TICK_MS);
  }, [stopTimer]);

  const cancelInFlight = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    stopTimer();
  }, [stopTimer]);

  useEffect(() => () => cancelInFlight(), [cancelInFlight]);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    fetchRepoOverview(repoPath)
      .then((ov) => {
        if (!cancelled) {
          setOverview(ov);
          setOverviewError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setOverviewError(err.message || '无法读取仓库骨架');
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    cancelInFlight();
    structuralRef.current = null;
    structuralPathRef.current = '';
    setStructureReady(false);
    setIsStreaming(false);
    setGraph(null);
    setBriefing('');
    setError(null);
    setChat([]);
    setSelectedCommunityId(null);
    setSettled(false);
    setGraphLoading(true);
    setGraphError(null);
    fetchLearnGraph(repoPath)
      .then((g) => {
        if (cancelled) return;
        structuralRef.current = g;
        structuralPathRef.current = repoPath;
        const cached = aiCache.get(cacheKey);
        const merged = cached?.report?.trim() ? applyLearnAnalysis(g, cached.report) : g;
        setGraph(merged);
        if (cached?.report?.trim() && parseLearnOverlay(cached.report)) {
          const { prose } = humanizeLearnReport(cached.report, merged);
          setBriefing(prose);
          setSettled(true);
        } else if (cached) {
          aiCache.remove(cacheKey);
        }
        setStructureReady(true);
      })
      .catch((err: Error) => {
        if (!cancelled) setGraphError(err.message || '无法解析代码图谱');
      })
      .finally(() => {
        if (!cancelled) setGraphLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, headHash, cacheKey, cancelInFlight]);

  const runAgent = useCallback(
    async (opts: { userPrompt?: string; filePath?: string; force?: boolean }) => {
      const config = configRef.current;
      const isFollowUp = Boolean(opts.userPrompt?.trim());
      const base = isFollowUp
        ? graphRef.current || structuralRef.current
        : structuralRef.current;

      if (!isFollowUp && (!base || structuralPathRef.current !== repoPath)) {
        setError('候选代码结构尚未准备完成，无法开始业务路线分析。');
        return;
      }

      if (!isFollowUp && !opts.force) {
        const cached = aiCache.get(cacheKey);
        if (cached?.report?.trim()) {
          const { graph: next, prose } = humanizeLearnReport(cached.report, base);
          if (parseLearnOverlay(cached.report)) {
            setGraph(next);
            setBriefing(prose);
            setError(null);
            setSettled(true);
            return;
          }
          aiCache.remove(cacheKey);
        }
      }

      cancelInFlight();
      setIsStreaming(true);
      setError(null);
      setStatus(null);
      if (isFollowUp) {
        setFollowUpStream('');
        setChat((prev) => [...prev, { role: 'user', content: opts.userPrompt!.trim() }]);
      } else {
        setBriefing('');
        setToolEvents([]);
        setChat([]);
        setSettled(false);
        if (base) {
          const structural = { ...base, businessRoutes: [] };
          graphRef.current = structural;
          setGraph(structural);
        }
      }
      textRef.current = '';
      startTimer();

      const paint = () => {
        const raw = textRef.current;
        if (isFollowUp) {
          setFollowUpStream(visibleLearnProse(raw));
          return;
        }
        const { graph: next, prose } = humanizeLearnReport(raw, base);
        setBriefing(prose);
        if (parseLearnOverlay(raw)) setGraph(next);
      };

      try {
        const cancel = await streamAgentExplainDiff({
          sessionId: `learn_${Date.now()}`,
          repoPath,
          scopeType: 'repo',
          task: 'learn',
          diff: '',
          filePath: opts.filePath,
          userPrompt: opts.userPrompt,
          config,
          onStatusUpdate: setStatus,
          onToolEvent: (event) => {
            setToolEvents((prev) => {
              if (event.type === 'tool_result' && event.id) {
                const idx = prev.findIndex((e) => e.id === event.id);
                if (idx !== -1) {
                  const next = prev.slice();
                  next[idx] = { ...next[idx], ...event };
                  return next;
                }
              }
              return [...prev, event];
            });
            flushStreamsNow();
          },
          onReasoning: () => {},
          onChunk: (chunk) => {
            const first = !textRef.current;
            textRef.current += chunk;
            scheduleStreamFlush(paint);
            if (first) flushStreamsNow();
          },
          onComplete: () => {
            const raw = textRef.current;
            const { graph: next, prose } = humanizeLearnReport(raw, base);
            if (isFollowUp) {
              if (next) setGraph(next);
              const reply =
                prose ||
                (next ? '已根据仓库更新说明。' : '没有读到有效说明，换个问法或点重新开仓。');
              setChat((prev) => [...prev, { role: 'assistant', content: reply }]);
              setFollowUpStream('');
            } else {
              setBriefing(prose);
              if (parseLearnOverlay(raw)) {
                setGraph(next);
                aiCache.set(cacheKey, {
                  report: raw,
                  model: config.model,
                  provider: config.provider,
                });
              } else {
                setError('AI 分析已结束，但没有返回有效的社区与路线数据。请重新分析。');
              }
            }
            setIsStreaming(false);
            abortRef.current = null;
            stopTimer();
            if (!isFollowUp) setSettled(true);
          },
          onError: (err) => {
            setError(err.message);
            setIsStreaming(false);
            abortRef.current = null;
            stopTimer();
            if (!isFollowUp) setSettled(true);
          },
        });
        abortRef.current = cancel;
      } catch (err: any) {
        setError(err.message || '学习请求失败');
        setIsStreaming(false);
        stopTimer();
        if (!isFollowUp) setSettled(true);
      }
    },
    [cacheKey, cancelInFlight, repoPath, startTimer, stopTimer]
  );

  const startBriefing = useCallback(
    (force = false) => runAgent({ force }),
    [runAgent]
  );

  const ask = useCallback(
    (question: string, filePath?: string) => runAgent({ userPrompt: question, filePath }),
    [runAgent]
  );

  useEffect(() => {
    if (!repoPath || !structureReady || structuralPathRef.current !== repoPath) return;
    startBriefing(false);
  }, [repoPath, headHash, aiConfig.model, structureReady]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    overview,
    overviewError,
    briefing,
    graph,
    graphError,
    graphLoading,
    isStreaming,
    status,
    toolEvents,
    error,
    chat,
    followUpStream,
    elapsedSeconds,
    selectedCommunityId,
    setSelectedCommunityId,
    settled,
    startBriefing,
    ask,
  };
}
