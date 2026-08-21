import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import {
  Sparkles,
  X,
  Send,
  Bot,
  User,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  StopCircle,
  Brain,
  Zap,
  Search,
  FileText,
  FolderSearch,
  ChevronDown,
  ChevronRight,
  Terminal,
  Activity,
  Radio,
  Plus,
  Layers,
  Database,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { AIProviderConfig } from '../../types';
import {
  streamExplainDiff,
  streamAgentExplainDiff,
  AgentToolEvent,
  AgentStatusEvent,
} from '../../services/api';
import { aiCache } from '../../services/aiCache';

export interface ExplanationScope {
  type: 'commit' | 'file' | 'hunk' | 'chunks' | 'compare' | 'line';
  title: string;
  diff: string;
  filePath?: string;
  commitMessage?: string;
  initialMode?: 'agent' | 'fast';
  commitHashes?: string[];
  batchInfo?: {
    count: number;
    messages: string[];
  };
  targetLine?: {
    lineNumber?: number;
    content: string;
    type?: 'add' | 'delete' | 'normal';
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolEvents?: AgentToolEvent[];
}

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
  currentToolEvents: AgentToolEvent[];
  agentStatus: AgentStatusEvent | null;
  chatHistory: ChatMessage[];
  elapsedSeconds: number;
  isCached?: boolean;
  error?: string | null;
  abortStream?: () => void;
}

interface AIExplanationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  scope: ExplanationScope | null;
  repoPath: string;
  aiConfig: AIProviderConfig;
}

export const AIExplanationDrawer: React.FC<AIExplanationDrawerProps> = ({
  isOpen,
  onClose,
  scope,
  repoPath,
  aiConfig,
}) => {
  const [sessions, setSessions] = useState<ReviewSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [userQuestion, setUserQuestion] = useState('');
  const [copied, setCopied] = useState(false);

  // Active session tool trail & reasoning expansion
  const [isTrailExpanded, setIsTrailExpanded] = useState<boolean>(true);
  const [isThinkingExpanded, setIsThinkingExpanded] = useState<boolean>(true);
  const [isBatchCommitsExpanded, setIsBatchCommitsExpanded] = useState<boolean>(true);
  const [expandedToolIndex, setExpandedToolIndex] = useState<number | null>(null);

  const contentEndRef = useRef<HTMLDivElement>(null);
  const activeAbortsRef = useRef<Map<string, () => void>>(new Map());
  const timersRef = useRef<Map<string, any>>(new Map());
  const sessionsRef = useRef<ReviewSession[]>(sessions);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0] || null;

  const getShortTitle = (s: ExplanationScope) => {
    if (s.batchInfo || s.commitHashes || s.title.includes('批量')) {
      const count = s.batchInfo?.count || s.commitHashes?.length || '';
      return `📦 批量(${count ? `${count}个` : '合并'})`;
    }
    if (s.filePath) {
      const fileName = s.filePath.replace(/\\/g, '/').split('/').pop() || s.filePath;
      if (s.type === 'hunk') return `${fileName}: 块`;
      if (s.type === 'line') return `${fileName}: L${s.targetLine?.lineNumber || ''}`;
      return fileName;
    }
    if (s.type === 'commit') return s.title.slice(0, 16);
    return s.title.slice(0, 16);
  };

  // Launch or switch to review session when scope prop changes
  useEffect(() => {
    if (isOpen && scope) {
      startOrActivateSession(scope, scope.initialMode || 'agent', false);
    }
  }, [isOpen, scope]);



  const updateSession = (id: string, updater: (prev: ReviewSession) => ReviewSession) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
  };

  const startOrActivateSession = (
    targetScope: ExplanationScope,
    mode: 'agent' | 'fast',
    forceRefresh = false
  ) => {
    const sessionId = `session_${targetScope.type}_${targetScope.filePath || 'global'}_${
      targetScope.diff.length
    }_${mode}`;

    const existing = sessions.find((s) => s.id === sessionId);
    if (existing && !forceRefresh) {
      setActiveSessionId(sessionId);
      return;
    }

    const shortTitle = getShortTitle(targetScope);
    const fullTitle = targetScope.title || shortTitle;

    // Check Cache
    const cacheKey = aiCache.generateKey({
      type: targetScope.type,
      filePath: targetScope.filePath,
      diff: targetScope.diff,
      targetLine: targetScope.targetLine?.lineNumber,
      engineMode: mode,
      model: aiConfig.model,
    });

    if (!forceRefresh) {
      const cached = aiCache.get(cacheKey);
      if (cached) {
        const cachedSession: ReviewSession = {
          id: sessionId,
          title: fullTitle,
          shortTitle,
          scope: targetScope,
          engineMode: mode,
          isStreaming: false,
          initialReport: cached.report,
          initialReasoning: cached.reasoning || '',
          currentFollowUpStream: '',
          currentFollowUpReasoning: '',
          currentToolEvents: cached.toolEvents || [],
          agentStatus: {
            type: 'status',
            phase: 'completed',
            message: '已从本地缓存秒开加载',
          },
          chatHistory: cached.chatHistory || [],
          elapsedSeconds: 0,
          isCached: true,
          error: null,
        };

        setSessions((prev) => {
          const filtered = prev.filter((s) => s.id !== sessionId);
          return [cachedSession, ...filtered];
        });
        setActiveSessionId(sessionId);
        return;
      }
    }

    // Abort previous stream for this specific session ID if running
    if (activeAbortsRef.current.has(sessionId)) {
      activeAbortsRef.current.get(sessionId)?.();
      activeAbortsRef.current.delete(sessionId);
    }
    if (timersRef.current.has(sessionId)) {
      clearInterval(timersRef.current.get(sessionId));
      timersRef.current.delete(sessionId);
    }

    const newSession: ReviewSession = {
      id: sessionId,
      title: fullTitle,
      shortTitle,
      scope: targetScope,
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

    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== sessionId);
      return [newSession, ...filtered];
    });
    setActiveSessionId(sessionId);

    // Timer for elapsed seconds
    const timer = setInterval(() => {
      updateSession(sessionId, (s) => ({
        ...s,
        elapsedSeconds: +(s.elapsedSeconds + 0.5).toFixed(1),
      }));
    }, 500);
    timersRef.current.set(sessionId, timer);

    // Execute Streaming in background
    executeStreamSession(sessionId, targetScope, mode, cacheKey);
  };

  const executeStreamSession = async (
    sessionId: string,
    targetScope: ExplanationScope,
    mode: 'agent' | 'fast',
    cacheKey: string,
    customPrompt?: string
  ) => {
    const scopeType =
      targetScope.type === 'hunk' || targetScope.type === 'chunks'
        ? 'chunk'
        : targetScope.type === 'file'
        ? 'file'
        : targetScope.type === 'line'
        ? 'line'
        : 'commit';

    let accumulatedStream = '';
    let accumulatedReasoning = '';
    let accumulatedToolEvents: AgentToolEvent[] = [];

    const onCompleteCleanup = () => {
      if (timersRef.current.has(sessionId)) {
        clearInterval(timersRef.current.get(sessionId));
        timersRef.current.delete(sessionId);
      }
      activeAbortsRef.current.delete(sessionId);

      // Save into persistent cache
      setSessions((currentSessions) => {
        const sess = currentSessions.find((s) => s.id === sessionId);
        if (sess && sess.initialReport.trim().length > 0) {
          aiCache.set(cacheKey, {
            report: sess.initialReport,
            toolEvents: sess.currentToolEvents,
            chatHistory: sess.chatHistory,
            reasoning: sess.initialReasoning,
            model: aiConfig.model,
            provider: aiConfig.provider,
          });
        }
        return currentSessions;
      });
    };

    try {
      let cancel: () => void;

      if (mode === 'agent') {
        cancel = await streamAgentExplainDiff({
          sessionId,
          repoPath,
          scopeType,
          diff: targetScope.diff,
          filePath: targetScope.filePath,
          commitMessage: targetScope.commitMessage,
          userPrompt: customPrompt,
          config: aiConfig,
          onStatusUpdate: (status) => {
            updateSession(sessionId, (s) => ({ ...s, agentStatus: status }));
          },
          onReasoning: (chunk) => {
            accumulatedReasoning += chunk;
            updateSession(sessionId, (s) => ({
              ...s,
              initialReasoning: customPrompt
                ? s.initialReasoning
                : (s.initialReasoning || '') + chunk,
              currentFollowUpReasoning: customPrompt
                ? (s.currentFollowUpReasoning || '') + chunk
                : '',
            }));
          },
          onToolEvent: (event) => {
            updateSession(sessionId, (s) => {
              let updatedEvents = [...s.currentToolEvents];
              if (event.type === 'tool_result' && event.id) {
                const idx = updatedEvents.findIndex((e) => e.id === event.id);
                if (idx !== -1) {
                  updatedEvents[idx] = { ...updatedEvents[idx], ...event };
                } else {
                  updatedEvents.push(event);
                }
              } else {
                updatedEvents.push(event);
              }
              accumulatedToolEvents = updatedEvents;
              return { ...s, currentToolEvents: updatedEvents };
            });
          },
          onChunk: (chunk) => {
            accumulatedStream += chunk;
            updateSession(sessionId, (s) => ({
              ...s,
              initialReport: customPrompt ? s.initialReport : s.initialReport + chunk,
              currentFollowUpStream: customPrompt ? s.currentFollowUpStream + chunk : '',
            }));
          },
          onComplete: () => {
            const latestSession = sessionsRef.current.find((s) => s.id === sessionId);
            const updatedChatHistory: ChatMessage[] = customPrompt
              ? [
                  ...(latestSession?.chatHistory || []),
                  {
                    role: 'assistant',
                    content: accumulatedStream,
                    reasoning: accumulatedReasoning,
                    toolEvents: latestSession?.currentToolEvents,
                  },
                ]
              : latestSession?.chatHistory || [];

            const finalReport = customPrompt
              ? latestSession?.initialReport || ''
              : accumulatedStream;

            const finalInitialReasoning = customPrompt
              ? latestSession?.initialReasoning || ''
              : accumulatedReasoning;

            updateSession(sessionId, (s) => ({
              ...s,
              isStreaming: false,
              agentStatus: {
                type: 'status',
                phase: 'completed',
                message: customPrompt ? '追问解答完成' : 'Codex 深度审查完成',
              },
              chatHistory: updatedChatHistory,
              currentFollowUpStream: '',
              currentFollowUpReasoning: '',
            }));

            aiCache.set(cacheKey, {
              report: finalReport,
              toolEvents: latestSession?.currentToolEvents || accumulatedToolEvents,
              chatHistory: updatedChatHistory,
              reasoning: finalInitialReasoning,
              model: aiConfig.model,
              provider: aiConfig.provider,
            });

            onCompleteCleanup();
          },
          onError: (err) => {
            updateSession(sessionId, (s) => ({
              ...s,
              isStreaming: false,
              error: err.message,
            }));
            onCompleteCleanup();
          },
        });
      } else {
        cancel = await streamExplainDiff({
          sessionId,
          scopeType,
          diff: targetScope.diff,
          filePath: targetScope.filePath,
          commitMessage: targetScope.commitMessage,
          userPrompt: customPrompt,
          config: aiConfig,
          onReasoning: (chunk) => {
            accumulatedReasoning += chunk;
            updateSession(sessionId, (s) => ({
              ...s,
              initialReasoning: customPrompt
                ? s.initialReasoning
                : (s.initialReasoning || '') + chunk,
              currentFollowUpReasoning: customPrompt
                ? (s.currentFollowUpReasoning || '') + chunk
                : '',
            }));
          },
          onChunk: (chunk) => {
            accumulatedStream += chunk;
            updateSession(sessionId, (s) => ({
              ...s,
              initialReport: customPrompt ? s.initialReport : s.initialReport + chunk,
              currentFollowUpStream: customPrompt ? s.currentFollowUpStream + chunk : '',
            }));
          },
          onComplete: () => {
            const latestSession = sessionsRef.current.find((s) => s.id === sessionId);
            const updatedChatHistory: ChatMessage[] = customPrompt
              ? [
                  ...(latestSession?.chatHistory || []),
                  {
                    role: 'assistant',
                    content: accumulatedStream,
                    reasoning: accumulatedReasoning,
                  },
                ]
              : latestSession?.chatHistory || [];

            const finalReport = customPrompt
              ? latestSession?.initialReport || ''
              : accumulatedStream;

            const finalInitialReasoning = customPrompt
              ? latestSession?.initialReasoning || ''
              : accumulatedReasoning;

            updateSession(sessionId, (s) => ({
              ...s,
              isStreaming: false,
              agentStatus: {
                type: 'status',
                phase: 'completed',
                message: customPrompt ? '追问解答完成' : '直接 Diff 解析完成',
              },
              chatHistory: updatedChatHistory,
              currentFollowUpStream: '',
              currentFollowUpReasoning: '',
            }));

            aiCache.set(cacheKey, {
              report: finalReport,
              toolEvents: latestSession?.currentToolEvents || [],
              chatHistory: updatedChatHistory,
              reasoning: finalInitialReasoning,
              model: aiConfig.model,
              provider: aiConfig.provider,
            });

            onCompleteCleanup();
          },
          onError: (err) => {
            updateSession(sessionId, (s) => ({
              ...s,
              isStreaming: false,
              error: err.message,
            }));
            onCompleteCleanup();
          },
        });
      }

      activeAbortsRef.current.set(sessionId, cancel);
      updateSession(sessionId, (s) => ({ ...s, abortStream: cancel }));
    } catch (err: any) {
      updateSession(sessionId, (s) => ({
        ...s,
        isStreaming: false,
        error: err.message,
      }));
      onCompleteCleanup();
    }
  };

  const handleCloseSession = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (activeAbortsRef.current.has(id)) {
      activeAbortsRef.current.get(id)?.();
      activeAbortsRef.current.delete(id);
    }
    if (timersRef.current.has(id)) {
      clearInterval(timersRef.current.get(id));
      timersRef.current.delete(id);
    }

    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (activeSessionId === id) {
        setActiveSessionId(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });
  };

  const handleClearAllSessions = () => {
    activeAbortsRef.current.forEach((abort) => abort());
    activeAbortsRef.current.clear();
    timersRef.current.forEach((t) => clearInterval(t));
    timersRef.current.clear();
    setSessions([]);
    setActiveSessionId(null);
  };

  const handleRerunCurrentSession = () => {
    if (!activeSession) return;
    startOrActivateSession(activeSession.scope, activeSession.engineMode, true);
  };

  const handleSwitchMode = (newMode: 'agent' | 'fast') => {
    if (!activeSession || activeSession.engineMode === newMode) return;
    startOrActivateSession(activeSession.scope, newMode, false);
  };

  const handleSendFollowUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userQuestion.trim() || !activeSession || activeSession.isStreaming) return;

    const q = userQuestion.trim();
    setUserQuestion('');

    const nextChatHistory: ChatMessage[] = [
      ...activeSession.chatHistory,
      { role: 'user', content: q },
    ];

    updateSession(activeSession.id, (s) => ({
      ...s,
      chatHistory: nextChatHistory,
      currentFollowUpStream: '',
      isStreaming: true,
      error: null,
    }));

    const cacheKey = aiCache.generateKey({
      type: activeSession.scope.type,
      filePath: activeSession.scope.filePath,
      diff: activeSession.scope.diff,
      targetLine: activeSession.scope.targetLine?.lineNumber,
      engineMode: activeSession.engineMode,
      model: aiConfig.model,
    });

    aiCache.set(cacheKey, {
      report: activeSession.initialReport,
      toolEvents: activeSession.currentToolEvents,
      chatHistory: nextChatHistory,
      reasoning: activeSession.initialReasoning,
      model: aiConfig.model,
      provider: aiConfig.provider,
    });

    executeStreamSession(activeSession.id, activeSession.scope, activeSession.engineMode, cacheKey, q);
  };

  const handleCopy = () => {
    if (!activeSession) return;
    const parts = [];
    if (activeSession.initialReport) {
      parts.push(`【审查报告】\n${activeSession.initialReport}`);
    }
    if (activeSession.chatHistory.length > 0) {
      parts.push(
        activeSession.chatHistory
          .map((m) => `【${m.role === 'user' ? '用户追问' : 'AI 回复'}】\n${m.content}`)
          .join('\n\n')
      );
    }
    const textToCopy = parts.join('\n\n---\n\n') || '';
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={`fixed inset-y-0 right-0 w-full max-w-2xl bg-[#12131A]/95 backdrop-blur-xl border-l border-white/10 shadow-2xl z-50 flex flex-col font-sans transition-transform duration-300 ease-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
      }`}
    >
      {/* 1. Header & Multi-Session Tab Bar */}
      <div className="border-b border-white/10 bg-[#171822] flex flex-col">
        {/* Top Controls Bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
          <div className="flex items-center space-x-2.5">
            <div className="flex items-center space-x-2 text-sm font-semibold text-slate-100">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span>AI 深度审查工作台</span>
            </div>

            {/* Global Parallel Counter */}
            <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-[11px] text-purple-300 font-mono">
              <Layers className="w-3 h-3 text-purple-400" />
              <span>
                {sessions.filter((s) => s.isStreaming).length > 0 ? (
                  <span className="text-emerald-400 font-bold">
                    {sessions.filter((s) => s.isStreaming).length} 个并行运行中
                  </span>
                ) : (
                  <span>共 {sessions.length} 个审查</span>
                )}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Clear All Sessions */}
            {sessions.length > 1 && (
              <button
                onClick={handleClearAllSessions}
                className="p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 rounded transition text-xs flex items-center space-x-1"
                title="关闭所有审查标签页"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Close Entire Drawer */}
            <button
              onClick={onClose}
              className="p-1 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition"
              title="关闭抽屉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Multi-Tab Strip (Tabs Bar) */}
        {sessions.length > 0 && (
          <div className="flex items-center space-x-1 px-3 py-1.5 overflow-x-auto scrollbar-none bg-[#111218]">
            {sessions.map((sess) => {
              const isActive = sess.id === activeSessionId;
              const tabTooltip =
                sess.scope.batchInfo?.messages && sess.scope.batchInfo.messages.length > 0
                  ? `【批量审查包含的 ${sess.scope.batchInfo.count} 个提交】:\n${sess.scope.batchInfo.messages.join('\n')}`
                  : sess.title;

              return (
                <div
                  key={sess.id}
                  onClick={() => setActiveSessionId(sess.id)}
                  title={tabTooltip}
                  className={`flex items-center space-x-2 px-2.5 py-1 rounded-lg text-xs cursor-pointer select-none transition shrink-0 group border ${
                    isActive
                      ? 'bg-purple-600/25 border-purple-500/40 text-white font-medium shadow-sm'
                      : 'bg-white/[0.03] border-transparent text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
                  }`}
                >
                  {/* Mode Icon */}
                  {sess.engineMode === 'agent' ? (
                    <Brain className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  ) : (
                    <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  )}

                  {/* Short Title */}
                  <span className="truncate max-w-[130px] font-mono text-[11px]">
                    {sess.shortTitle}
                  </span>

                  {/* Status Indicator */}
                  {sess.isStreaming ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                  ) : sess.isCached ? (
                    <span title="来自本地缓存">
                      <Database className="w-3 h-3 text-sky-400 shrink-0" />
                    </span>
                  ) : (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  )}

                  {/* Close Tab Button */}
                  <button
                    onClick={(e) => handleCloseSession(sess.id, e)}
                    className="opacity-40 group-hover:opacity-100 hover:text-rose-400 p-0.5 rounded transition"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Active Session Mode Switch & Meta Bar */}
        {activeSession && (
          <div className="flex items-center justify-between px-4 py-2 bg-[#14151F] text-xs">
            {/* Mode Switcher */}
            <div className="flex items-center bg-[#1B1C27] p-0.5 rounded-lg border border-white/5">
              <button
                onClick={() => handleSwitchMode('agent')}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                  activeSession.engineMode === 'agent'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Brain className="w-3.5 h-3.5" />
                <span>🧠 Codex 智能体</span>
              </button>
              <button
                onClick={() => handleSwitchMode('fast')}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                  activeSession.engineMode === 'fast'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>⚡ 直接 Diff</span>
              </button>
            </div>

            {/* Cache / Status Badge & Actions */}
            <div className="flex items-center space-x-2">
              {activeSession.isCached && (
                <span className="flex items-center space-x-1 text-[11px] text-sky-300 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-full font-mono">
                  <Database className="w-3 h-3" />
                  <span>本地缓存秒开</span>
                </span>
              )}

              {activeSession.isStreaming && (
                <span className="flex items-center space-x-1.5 text-[11px] text-emerald-400 font-mono">
                  <Activity className="w-3.5 h-3.5 animate-spin" />
                  <span>{activeSession.elapsedSeconds}s</span>
                </span>
              )}

              {/* Rerun / Refresh */}
              <button
                onClick={handleRerunCurrentSession}
                disabled={activeSession.isStreaming}
                className="p-1 hover:bg-white/10 text-slate-400 hover:text-white rounded-md transition disabled:opacity-50"
                title="重新审查（强制绕过缓存刷新）"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>

              {/* Copy Report */}
              <button
                onClick={handleCopy}
                className="p-1 hover:bg-white/10 text-slate-400 hover:text-white rounded-md transition"
                title="复制审查报告"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-slate-200">
        {!activeSession ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs space-y-2">
            <Brain className="w-10 h-10 text-slate-600 stroke-1" />
            <span>暂无活跃审查任务，请点击改动块或文件开启审查</span>
          </div>
        ) : (
          <>
            {/* 📦 Batch Commits Manifest (批量包含的提交清单) */}
            {activeSession.scope.batchInfo &&
              activeSession.scope.batchInfo.messages &&
              activeSession.scope.batchInfo.messages.length > 0 && (
                <div className="border border-indigo-500/30 bg-[#151624] rounded-xl overflow-hidden shadow-md">
                  <div
                    onClick={() => setIsBatchCommitsExpanded(!isBatchCommitsExpanded)}
                    className="flex items-center justify-between px-3.5 py-2.5 bg-gradient-to-r from-indigo-950/70 to-purple-950/50 cursor-pointer select-none hover:bg-indigo-900/40 transition border-b border-white/5"
                  >
                    <div className="flex items-center space-x-2 text-xs font-semibold text-indigo-200">
                      <Layers className="w-4 h-4 text-indigo-400" />
                      <span>本次批量合并包含的提交清单</span>
                      <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono text-[10px]">
                        共 {activeSession.scope.batchInfo.count} 个提交
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5 text-xs text-indigo-300">
                      <span className="text-[10px] text-indigo-400 font-mono">
                        {isBatchCommitsExpanded ? '收起' : '展开'}
                      </span>
                      {isBatchCommitsExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </div>

                  {isBatchCommitsExpanded && (
                    <div className="p-3 bg-[#0F1017] space-y-1.5 max-h-52 overflow-y-auto border-t border-white/5 text-xs font-mono">
                      {activeSession.scope.batchInfo.messages.map((msg, i) => (
                        <div
                          key={i}
                          className="flex items-start space-x-2 p-2 rounded-lg bg-white/[0.03] border border-white/5 text-slate-200 hover:border-indigo-500/30 transition leading-snug"
                        >
                          <span className="text-indigo-400 font-bold shrink-0">#{i + 1}</span>
                          <span className="text-slate-200 select-text whitespace-pre-wrap">{msg}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            {/* 🧠 初始审查深度思维推理链 (Thinking Process Accordion) */}
            {activeSession.initialReasoning && (
              <div className="border border-purple-500/30 bg-[#161524] rounded-xl overflow-hidden shadow-md">
                <div
                  onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                  className="flex items-center justify-between px-3.5 py-2.5 bg-gradient-to-r from-purple-950/60 to-indigo-950/40 cursor-pointer select-none hover:bg-purple-900/40 transition border-b border-white/5"
                >
                  <div className="flex items-center space-x-2 text-xs font-semibold text-purple-200">
                    <Brain
                      className={`w-4 h-4 text-amber-300 ${
                        activeSession.isStreaming && !activeSession.initialReport
                          ? 'animate-pulse'
                          : ''
                      }`}
                    />
                    <span>初始审查深度思维推理链 (Thinking Process)</span>
                    <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono text-[10px]">
                      {activeSession.initialReasoning.length} 字符
                    </span>
                  </div>
                  <div className="flex items-center space-x-1.5 text-xs text-purple-300">
                    <span className="text-[10px] text-purple-400 font-mono">
                      {isThinkingExpanded ? '收起' : '展开'}
                    </span>
                    {isThinkingExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </div>
                </div>

                {isThinkingExpanded && (
                  <div className="p-3.5 max-h-72 overflow-y-auto bg-[#101018] text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap selection:bg-purple-500/30 border-t border-white/5">
                    {activeSession.initialReasoning}
                  </div>
                )}
              </div>
            )}

            {/* Codex Agent Tool Calling Trace (Foldable Accordion) */}
            {activeSession.engineMode === 'agent' && activeSession.currentToolEvents.length > 0 && (
              <div className="border border-purple-500/20 bg-purple-950/20 rounded-xl overflow-hidden shadow-inner">
                <div
                  onClick={() => setIsTrailExpanded(!isTrailExpanded)}
                  className="flex items-center justify-between px-3 py-2 bg-purple-900/30 cursor-pointer select-none hover:bg-purple-900/40 transition"
                >
                  <div className="flex items-center space-x-2 text-xs font-semibold text-purple-200">
                    <Terminal className="w-3.5 h-3.5 text-purple-400" />
                    <span>Codex 自主代码库探查轨迹</span>
                    <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono text-[10px]">
                      {activeSession.currentToolEvents.length} 次动作
                    </span>
                  </div>

                  {isTrailExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-purple-300" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-purple-300" />
                  )}
                </div>

                {isTrailExpanded && (
                  <div className="p-2 space-y-1.5 bg-[#141320]/60 max-h-56 overflow-y-auto text-[11px] font-mono">
                    {activeSession.currentToolEvents.map((evt, idx) => {
                      const isToolResult = evt.type === 'tool_result';
                      const isExpanded = expandedToolIndex === idx;

                      return (
                        <div
                          key={`tool-${idx}`}
                          className="p-1.5 rounded bg-white/[0.03] border border-white/5 hover:border-purple-500/30 transition"
                        >
                          <div
                            onClick={() => setExpandedToolIndex(isExpanded ? null : idx)}
                            className="flex items-center justify-between cursor-pointer text-slate-300 hover:text-white"
                          >
                            <div className="flex items-center space-x-1.5 truncate">
                              {evt.name?.includes('read') ? (
                                <FileText className="w-3 h-3 text-sky-400 shrink-0" />
                              ) : evt.name?.includes('search') ? (
                                <Search className="w-3 h-3 text-emerald-400 shrink-0" />
                              ) : (
                                <FolderSearch className="w-3 h-3 text-amber-400 shrink-0" />
                              )}
                              <span className="font-bold text-purple-300">{evt.name || '工具调用'}</span>
                              <span className="text-slate-400 truncate text-[10px]">
                                {evt.args ? JSON.stringify(evt.args) : evt.summary || ''}
                              </span>
                            </div>

                            {evt.output && (
                              <span className="text-[10px] text-purple-400 hover:underline shrink-0 ml-1">
                                {isExpanded ? '收起' : '详情'}
                              </span>
                            )}
                          </div>

                          {isExpanded && evt.output && (
                            <pre className="mt-1.5 p-2 rounded bg-black/60 text-slate-300 text-[10px] overflow-x-auto whitespace-pre-wrap max-h-40 border border-white/5">
                              {evt.output}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Error Banner */}
            {activeSession.error && (
              <div className="flex items-start space-x-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold">审查异常中断</div>
                  <div className="text-[11px] opacity-80 mt-0.5">{activeSession.error}</div>
                </div>
              </div>
            )}

            {/* Primary Markdown Report Output */}
            {activeSession.initialReport && (
              <div
                className="prose prose-invert prose-sm max-w-none text-slate-200 leading-relaxed overflow-x-auto"
                dangerouslySetInnerHTML={{ __html: marked.parse(activeSession.initialReport) }}
              />
            )}

            {/* Chat Follow-Up History & Active Streaming */}
            {(activeSession.chatHistory.length > 0 ||
              activeSession.currentFollowUpStream ||
              activeSession.currentFollowUpReasoning) && (
              <div className="space-y-3.5 pt-4 border-t border-white/10">
                <div className="flex items-center space-x-2 text-xs font-semibold text-purple-300">
                  <Bot className="w-4 h-4 text-purple-400" />
                  <span>💬 追问与延伸讨论记录</span>
                </div>

                {activeSession.chatHistory.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex items-start space-x-2.5 ${
                      msg.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {msg.role === 'assistant' && (
                      <div className="w-6 h-6 rounded-full bg-purple-600/30 border border-purple-500/40 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-3.5 h-3.5 text-purple-300" />
                      </div>
                    )}

                    <div
                      className={`p-3 rounded-2xl text-xs max-w-[85%] leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-purple-600 text-white shadow-md'
                          : 'bg-[#181924] border border-white/5 text-slate-200'
                      }`}
                    >
                      {/* Follow-up assistant message thinking chain accordion */}
                      {msg.role === 'assistant' && msg.reasoning && (
                        <div className="mb-2.5 rounded-lg border border-purple-500/30 bg-[#12111E] overflow-hidden text-xs">
                          <details className="group">
                            <summary className="flex items-center justify-between px-3 py-1.5 bg-purple-950/40 cursor-pointer select-none text-purple-300 hover:text-purple-200 hover:bg-purple-900/40 transition">
                              <div className="flex items-center space-x-1.5 font-medium text-[11px]">
                                <Brain className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                                <span>思考过程 ({msg.reasoning.length} 字符)</span>
                              </div>
                              <span className="text-[10px] text-purple-400 group-open:hidden">点击展开</span>
                            </summary>
                            <div className="p-2.5 max-h-48 overflow-y-auto bg-[#0E0D17] text-[11px] font-mono text-slate-300 whitespace-pre-wrap border-t border-white/5 leading-relaxed select-text">
                              {msg.reasoning}
                            </div>
                          </details>
                        </div>
                      )}

                      <div
                        className="prose prose-invert prose-xs max-w-none"
                        dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) }}
                      />
                    </div>

                    {msg.role === 'user' && (
                      <div className="w-6 h-6 rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
                        <User className="w-3.5 h-3.5 text-slate-300" />
                      </div>
                    )}
                  </div>
                ))}

                {/* Active Streaming Follow-Up Bubble */}
                {activeSession.isStreaming &&
                  (activeSession.currentFollowUpStream ||
                    activeSession.currentFollowUpReasoning) && (
                    <div className="flex items-start space-x-2.5 justify-start">
                      <div className="w-6 h-6 rounded-full bg-purple-600/30 border border-purple-500/40 flex items-center justify-center shrink-0 mt-0.5 animate-pulse">
                        <Bot className="w-3.5 h-3.5 text-purple-300" />
                      </div>
                      <div className="p-3 rounded-2xl text-xs max-w-[85%] leading-relaxed bg-[#181924] border border-purple-500/30 text-slate-200 shadow-md flex-1">
                        {/* Live reasoning during follow-up stream */}
                        {activeSession.currentFollowUpReasoning && (
                          <div className="mb-2.5 rounded-lg border border-purple-500/30 bg-[#12111E] overflow-hidden text-xs shadow-inner">
                            <div className="flex items-center justify-between px-3 py-1.5 bg-purple-950/50 text-purple-300 border-b border-white/5">
                              <div className="flex items-center space-x-1.5 font-medium text-[11px]">
                                <Brain className="w-3.5 h-3.5 text-amber-300 animate-pulse shrink-0" />
                                <span>
                                  正在思考追问... ({activeSession.currentFollowUpReasoning.length} 字符)
                                </span>
                              </div>
                            </div>
                            <div className="p-2.5 max-h-48 overflow-y-auto bg-[#0E0D17] text-[11px] font-mono text-purple-200/90 whitespace-pre-wrap border-t border-white/5 leading-relaxed select-text">
                              {activeSession.currentFollowUpReasoning}
                            </div>
                          </div>
                        )}

                        {activeSession.currentFollowUpStream ? (
                          <div
                            className="prose prose-invert prose-xs max-w-none"
                            dangerouslySetInnerHTML={{
                              __html: marked.parse(activeSession.currentFollowUpStream),
                            }}
                          />
                        ) : (
                          <div className="flex items-center space-x-2 text-purple-400 text-xs py-1">
                            <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
                            <span>AI 正在组织追问解答...</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
              </div>
            )}

            <div ref={contentEndRef} />
          </>
        )}
      </div>

      {/* 3. Follow-Up Chat Input */}
      {activeSession && (
        <form
          onSubmit={handleSendFollowUp}
          className="p-3 border-t border-white/10 bg-[#161722] flex items-center space-x-2"
        >
          <input
            type="text"
            value={userQuestion}
            onChange={(e) => setUserQuestion(e.target.value)}
            disabled={activeSession.isStreaming}
            placeholder={
              activeSession.isStreaming
                ? 'AI 正在分析生成中...'
                : '追问 AI：例如“这个方法有潜在并发问题吗？”'
            }
            className="flex-1 bg-[#1C1D29] text-xs text-slate-200 px-3 py-2 rounded-lg border border-white/5 focus:outline-none focus:border-purple-500/50 transition placeholder:text-slate-500 disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={!userQuestion.trim() || activeSession.isStreaming}
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white p-2 rounded-lg transition shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      )}
    </div>
  );
};
