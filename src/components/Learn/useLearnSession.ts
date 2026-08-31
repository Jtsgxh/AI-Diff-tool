import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LEARN_ANALYSIS_SCHEMA_VERSION,
  type AgentStatusEvent,
  type AgentToolEvent,
  type AIProviderConfig,
  type LearnGraph,
  type LearnRequestMode,
  type RepoOverview,
} from '../../types';
import { fetchLearnGraph, fetchRepoOverview, streamAgentExplainDiff } from '../../services/api';
import { aiCache } from '../../services/aiCache';
import {
  humanizeLearnReport,
  mergeLearnGraphExpansion,
  parseLearnOverlay,
  serializeLearnGraphReport,
  visibleLearnProse,
} from '../../utils/learnGraph';
import { flushStreamsNow, scheduleStreamFlush } from '../../services/streamScheduler';
import { DEFAULT_LEARN_PROMPT } from '../../../shared/defaultLearnPrompt';

export interface LearnChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const ELAPSED_TICK_MS = 500;

function rejectedRouteLabels(report: string, graph: LearnGraph | null): string[] {
  const overlay = parseLearnOverlay(report);
  if (!overlay) return [];
  const mappedRouteIds = new Set(graph?.businessRoutes.map((route) => route.id) || []);
  return overlay.businessRoutes
    .filter((route) => !mappedRouteIds.has(route.id))
    .map((route) => route.label);
}

export function useLearnSession(
  repoPath: string,
  aiConfig: AIProviderConfig,
  headHash: string | undefined,
  repositoryRevision: number
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
  const acceptedReportRef = useRef('');

  const effectiveLearnPrompt = aiConfig.learnPrompt?.trim() || DEFAULT_LEARN_PROMPT;
  const cacheKeyForGraph = useCallback(
    (source: LearnGraph) => aiCache.generateKey({
      type: `learn-v${LEARN_ANALYSIS_SCHEMA_VERSION}-business-bus`,
      filePath: repoPath,
      diff: `${headHash || ''}:${source.stats.sourceFingerprint}`,
      userPrompt: effectiveLearnPrompt,
      model: aiConfig.model,
    }),
    [aiConfig.model, effectiveLearnPrompt, headHash, repoPath]
  );

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
    acceptedReportRef.current = '';
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
        graphRef.current = g;
        setGraph(g);
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
  }, [repoPath, headHash, repositoryRevision, cancelInFlight]);

  const runAgent = useCallback(
    async (opts: { userPrompt?: string; filePath?: string; learnRequestMode?: LearnRequestMode }) => {
      const config = configRef.current;
      const isFollowUp = Boolean(opts.userPrompt?.trim());
      const isExpansion = opts.learnRequestMode === 'expand_graph';
      const base = isFollowUp
        ? graphRef.current || structuralRef.current
        : structuralRef.current;

      if (!isFollowUp && (!base || structuralPathRef.current !== repoPath)) {
        setError('候选代码结构尚未准备完成，无法开始业务路线分析。');
        return;
      }

      if (!base) {
        setError('代码结构不存在，无法绑定业务路线。');
        return;
      }

      const cacheKey = cacheKeyForGraph(base);

      cancelInFlight();
      setIsStreaming(true);
      setError(null);
      setStatus(null);
      if (isFollowUp) {
        setFollowUpStream('');
        setChat((prev) => [...prev, {
          role: 'user',
          content: isExpansion ? `补图：${opts.userPrompt!.trim()}` : opts.userPrompt!.trim(),
        }]);
      } else {
        const previous = graphRef.current;
        const hasPreviousRoutes = Boolean(previous?.businessRoutes.length);
        if (!hasPreviousRoutes) setBriefing('');
        setToolEvents([]);
        setChat([]);
        setSettled(false);
        if (base) {
          const visible = hasPreviousRoutes && previous ? previous : base;
          graphRef.current = visible;
          setGraph(visible);
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
        if (parseLearnOverlay(raw)) {
          graphRef.current = next;
          setGraph(next);
        }
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
          learnRequestMode: opts.learnRequestMode || (isFollowUp ? 'question' : undefined),
          existingBusinessRoutes: isExpansion ? base.businessRoutes.map((route) => ({
            id: route.id,
            label: route.label,
            steps: route.steps.map(({ file, classSymbol, methodSymbol, kind }) => ({
              file, classSymbol, methodSymbol, kind,
            })),
          })) : undefined,
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
            if (isExpansion) {
              const expansion = mergeLearnGraphExpansion(base, raw);
              if (!expansion.hasOverlay) {
                setError('补图请求已结束，但 AI 没有返回合法的 learn-graph 数据。现有业务总线未改变。');
              } else if (expansion.invalidRouteLabels.length > 0) {
                setError(`补充路线无法绑定到当前类图：${expansion.invalidRouteLabels.join('、')}。现有业务总线未改变。`);
              } else if (expansion.duplicateRouteLabels.length > 0) {
                setError(`补充路线与现有业务总线重复或 id 冲突：${expansion.duplicateRouteLabels.join('、')}。请换个缺失业务继续补图。`);
              } else {
                if (expansion.addedRoutes.length > 0) {
                  graphRef.current = expansion.graph;
                  setGraph(expansion.graph);
                  setSettled(true);
                  const retainedProse = visibleLearnProse(acceptedReportRef.current);
                  const combinedReport = serializeLearnGraphReport(expansion.graph, retainedProse);
                  acceptedReportRef.current = combinedReport;
                  aiCache.set(cacheKey, {
                    report: combinedReport,
                    model: config.model,
                    provider: config.provider,
                  });
                }
                const reply = prose || (expansion.addedRoutes.length > 0
                  ? `已补充 ${expansion.addedRoutes.length} 条业务路线到节点图。`
                  : '已核实这次提问，但没有找到可形成新业务闭环的路线，节点图未改变。');
                setChat((prev) => [...prev, { role: 'assistant', content: reply }]);
              }
              setFollowUpStream('');
            } else if (isFollowUp) {
              const reply =
                prose ||
                '没有读到有效说明，换个问法或点重新开仓。';
              setChat((prev) => [...prev, { role: 'assistant', content: reply }]);
              setFollowUpStream('');
            } else {
              setBriefing(prose);
              const overlay = parseLearnOverlay(raw);
              const rejectedRoutes = rejectedRouteLabels(raw, next);
              if (overlay && rejectedRoutes.length === 0) {
                graphRef.current = next;
                setGraph(next);
                acceptedReportRef.current = raw;
                aiCache.set(cacheKey, {
                  report: raw,
                  model: config.model,
                  provider: config.provider,
                });
              } else if (overlay) {
                graphRef.current = base;
                setGraph(base);
                acceptedReportRef.current = '';
                setError(
                  `AI 返回的路线无法绑定到当前类图：${rejectedRoutes.join('、')}。已拒绝这份路线数据，请重新分析。`
                );
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
    [cacheKeyForGraph, cancelInFlight, repoPath, startTimer, stopTimer]
  );

  const startBriefing = useCallback(
    () => runAgent({}),
    [runAgent]
  );

  const ask = useCallback(
    (question: string, filePath?: string) => runAgent({ userPrompt: question, filePath, learnRequestMode: 'question' }),
    [runAgent]
  );

  const expandGraph = useCallback(
    (question: string, filePath?: string) => runAgent({ userPrompt: question, filePath, learnRequestMode: 'expand_graph' }),
    [runAgent]
  );

  useEffect(() => {
    const base = structuralRef.current;
    if (!repoPath || !structureReady || !base || structuralPathRef.current !== repoPath) return;
    // Opening the page (or changing source/model/prompt) may restore a matching
    // report, but must never start an AI request on a cache miss. An explicit
    // analysis already in flight keeps its own config and completion lifecycle.
    if (abortRef.current) return;
    graphRef.current = base;
    setGraph(base);
    setBriefing('');
    setError(null);
    setSettled(false);
    acceptedReportRef.current = '';
    const cacheKey = cacheKeyForGraph(base);
    const cached = aiCache.get(cacheKey);
    if (!cached?.report?.trim()) return;
    const { graph: next, prose } = humanizeLearnReport(cached.report, base);
    const rejectedRoutes = rejectedRouteLabels(cached.report, next);
    if (!parseLearnOverlay(cached.report) || rejectedRoutes.length > 0) {
      acceptedReportRef.current = '';
      aiCache.remove(cacheKey);
      setError('已有分析结果无效或无法绑定到当前类图，请手动开始 AI 分析。');
      return;
    }
    graphRef.current = next;
    acceptedReportRef.current = cached.report;
    setGraph(next);
    setBriefing(prose);
    setSettled(true);
  }, [repoPath, cacheKeyForGraph, structureReady]);

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
    expandGraph,
  };
}
