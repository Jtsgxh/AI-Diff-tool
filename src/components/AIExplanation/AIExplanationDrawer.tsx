import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  Brain,
  Check,
  Copy,
  Database,
  Layers,
  RefreshCw,
  StepForward,
  Sparkles,
  Terminal,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { AIProviderConfig } from '../../types';
import { formatReasoningForDisplay } from '../../utils/reasoningDisplay';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { Accordion } from './Accordion';
import { ChatMessageItem } from './ChatMessageItem';
import { ExplorationTrail } from './ExplorationTrail';
import { FollowUpInput } from './FollowUpInput';
import { SessionTabs } from './SessionTabs';
import { useReviewSessions } from './useReviewSessions';
import type { ExplanationScope } from './types';

export type { ExplanationScope, ChatMessage, ReviewSession } from './types';

const COPIED_FEEDBACK_MS = 2000;

interface AIExplanationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  scope: ExplanationScope | null;
  repoPath: string;
  aiConfig: AIProviderConfig;
}

/**
 * Slide-over review workbench. All session and streaming logic lives in
 * `useReviewSessions`; this component renders it.
 *
 * The drawer stays mounted as a workspace column (width 0 when closed) rather
 * than unmounting, so closing it never aborts an in-flight review.
 */
export const AIExplanationDrawer: React.FC<AIExplanationDrawerProps> = ({
  isOpen,
  onClose,
  scope,
  repoPath,
  aiConfig,
}) => {
  const {
    sessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    startOrActivateSession,
    closeSession,
    closeAllSessions,
    sendFollowUp,
    continueInterruptedSession,
  } = useReviewSessions(repoPath, aiConfig);

  const [copied, setCopied] = useState(false);
  const [isTrailExpanded, setIsTrailExpanded] = useState(false);
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const [isBatchExpanded, setIsBatchExpanded] = useState(true);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when streaming to ensure new output is always in view
  useEffect(() => {
    if (activeSession?.isStreaming) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [
    activeSession?.isStreaming,
    activeSession?.initialReport,
    activeSession?.initialReasoning,
    activeSession?.currentFollowUpStream,
    activeSession?.currentFollowUpReasoning,
    activeSession?.currentToolEvents?.length,
    activeSession?.currentFollowUpToolEvents?.length,
    activeSession?.agentStatus?.message,
  ]);

  // A new scope object means the user asked for a new review; re-opening the
  // drawer with the same scope must not restart anything.
  const prevScopeRef = useRef<ExplanationScope | null>(null);
  useEffect(() => {
    if (scope && scope !== prevScopeRef.current) {
      prevScopeRef.current = scope;
      startOrActivateSession(scope, scope.initialMode || 'agent', false);
    }
  }, [scope, startOrActivateSession]);

  const streamingCount = sessions.reduce((n, s) => n + (s.isStreaming ? 1 : 0), 0);

  const handleRerun = useCallback(() => {
    if (activeSession) startOrActivateSession(activeSession.scope, activeSession.engineMode, true);
  }, [activeSession, startOrActivateSession]);

  const handleSwitchMode = useCallback(
    (mode: 'agent' | 'fast') => {
      if (!activeSession || activeSession.engineMode === mode) return;
      startOrActivateSession(activeSession.scope, mode, false);
    },
    [activeSession, startOrActivateSession]
  );

  const handleCopy = useCallback(() => {
    if (!activeSession) return;

    const parts: string[] = [];
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

    navigator.clipboard.writeText(parts.join('\n\n---\n\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }, [activeSession]);

  const batchInfo = activeSession?.scope.batchInfo;
  const initialReasoningDisplay = useMemo(
    () => formatReasoningForDisplay(activeSession?.initialReasoning || ''),
    [activeSession?.initialReasoning]
  );
  const followUpReasoningDisplay = useMemo(
    () => formatReasoningForDisplay(activeSession?.currentFollowUpReasoning || ''),
    [activeSession?.currentFollowUpReasoning]
  );
  const hasFollowUpActivity =
    !!activeSession &&
    (activeSession.chatHistory.length > 0 ||
      !!activeSession.currentFollowUpStream ||
      !!activeSession.currentFollowUpReasoning);

  return (
    <div
      className={`h-full w-full min-w-0 min-h-0 bg-[var(--surface-canvas)] border-l border-white/10 flex flex-col font-sans ${
        isOpen ? '' : 'pointer-events-none'
      }`}
    >
      {/* 1. Header & session tabs */}
      <div className="border-b border-white/10 bg-[#191C21] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
          <div className="flex items-center space-x-2.5">
            <div className="flex items-center space-x-2 text-sm font-semibold text-slate-100">
              <Sparkles className="w-4 h-4 text-blue-400" />
              <span>AI 深度审查工作台</span>
            </div>

            <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-300 font-mono">
              <Layers className="w-3 h-3 text-blue-400" />
              {streamingCount > 0 ? (
                <span className="text-emerald-400 font-bold">{streamingCount} 个并行运行中</span>
              ) : (
                <span>共 {sessions.length} 个审查</span>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {sessions.length > 1 && (
              <button
                onClick={closeAllSessions}
                className="p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 rounded transition text-xs flex items-center space-x-1"
                title="关闭所有审查标签页"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition"
              title="关闭抽屉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <SessionTabs
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={setActiveSessionId}
          onClose={closeSession}
        />

        {activeSession && (
          <div className="flex items-center justify-between px-4 py-2 bg-[#15181C] text-xs">
            <div className="flex items-center bg-[var(--surface-raised)] p-0.5 rounded-lg border border-white/5">
              <button
                onClick={() => handleSwitchMode('agent')}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                  activeSession.engineMode === 'agent'
                    ? 'bg-blue-600 text-white shadow-sm'
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
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>⚡ 直接 Diff</span>
              </button>
            </div>

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

              <button
                onClick={handleRerun}
                disabled={activeSession.isStreaming}
                className="p-1 hover:bg-white/10 text-slate-400 hover:text-white rounded-md transition disabled:opacity-50"
                title="重新审查（强制绕过缓存刷新）"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={handleCopy}
                className="p-1 hover:bg-white/10 text-slate-400 hover:text-white rounded-md transition"
                title="复制审查报告"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Report body */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 text-slate-200 select-text scroll-smooth"
      >
        {!activeSession ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs space-y-2">
            <Brain className="w-10 h-10 text-slate-600 stroke-1" />
            <span>暂无活跃审查任务，请点击改动块或文件开启审查</span>
          </div>
        ) : (
          <>
            {/* Live Progress Banner during Streaming */}
            {activeSession.isStreaming && activeSession.agentStatus?.message && (
              <div className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-blue-950/40 border border-blue-500/30 text-blue-200 text-xs font-mono shadow-sm">
                <Activity className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
                <span className="truncate">{activeSession.agentStatus.message}</span>
              </div>
            )}
            {batchInfo && batchInfo.messages.length > 0 && (
              <Accordion
                icon={<Layers className="w-4 h-4 text-blue-400" />}
                title="本次批量合并包含的提交清单"
                badge={
                  <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-mono text-[10px]">
                    共 {batchInfo.count} 个提交
                  </span>
                }
                isOpen={isBatchExpanded}
                onToggle={() => setIsBatchExpanded((v) => !v)}
                tone={{
                  shell: 'border border-blue-500/30 bg-[#171A1F] shadow-md',
                  header:
                    'bg-blue-500/10 hover:bg-blue-900/40',
                  body: 'p-3 bg-[#101216] space-y-1.5 max-h-52 overflow-y-auto text-xs font-mono',
                  text: 'text-blue-200',
                }}
              >
                {batchInfo.messages.map((msg, i) => (
                  <div
                    key={i}
                    className="flex items-start space-x-2 p-2 rounded-lg bg-white/[0.03] border border-white/5 text-slate-200 hover:border-blue-500/30 transition leading-snug"
                  >
                    <span className="text-blue-400 font-bold shrink-0">#{i + 1}</span>
                    <span className="text-slate-200 select-text whitespace-pre-wrap">{msg}</span>
                  </div>
                ))}
              </Accordion>
            )}

            {activeSession.initialReasoning && (
              <Accordion
                icon={
                  <Brain
                    className={`w-4 h-4 text-amber-300 ${
                      activeSession.isStreaming && !activeSession.initialReport
                        ? 'animate-pulse'
                        : ''
                    }`}
                  />
                }
                title="模型分析过程 (Thinking)"
                badge={
                  <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-mono text-[10px]">
                    {initialReasoningDisplay.text.length} 字符
                    {initialReasoningDisplay.hiddenExplorationBlocks > 0
                      ? ` · 已隐藏 ${initialReasoningDisplay.hiddenExplorationBlocks} 段源码载荷`
                      : ''}
                  </span>
                }
                isOpen={isThinkingExpanded}
                onToggle={() => setIsThinkingExpanded((v) => !v)}
                tone={{
                  shell: 'border border-blue-500/30 bg-[#161524] shadow-md',
                  header:
                    'bg-blue-500/10 hover:bg-blue-900/40',
                  body: 'p-3.5 max-h-72 overflow-y-auto bg-[#101216] text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap selection:bg-blue-500/30',
                  text: 'text-blue-200',
                }}
              >
                {initialReasoningDisplay.text}
              </Accordion>
            )}

            {activeSession.engineMode === 'agent' && activeSession.currentToolEvents.length > 0 && (
              <ExplorationTrail
                events={activeSession.currentToolEvents}
                isOpen={isTrailExpanded}
                onToggle={() => setIsTrailExpanded((v) => !v)}
              />
            )}

            {activeSession.error && (
              <div className="flex items-start gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold">审查异常中断</div>
                  <div className="text-[11px] opacity-80 mt-0.5">{activeSession.error}</div>
                </div>
                {activeSession.initialReport.trim() && (
                  <button
                    type="button"
                    onClick={continueInterruptedSession}
                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-rose-200 font-semibold transition"
                    title="保留已输出报告，从中断位置继续生成"
                  >
                    <StepForward className="w-3.5 h-3.5" />
                    <span>继续生成</span>
                  </button>
                )}
              </div>
            )}

            {activeSession.initialReport && (
              <MarkdownRenderer
                content={activeSession.initialReport}
                className="prose prose-invert prose-sm max-w-none text-slate-200 leading-relaxed overflow-x-auto select-text"
              />
            )}

            {hasFollowUpActivity && (
              <div className="space-y-3.5 pt-4 border-t border-white/10">
                <div className="flex items-center space-x-2 text-xs font-semibold text-blue-300">
                  <Bot className="w-4 h-4 text-blue-400" />
                  <span>💬 追问与延伸讨论记录</span>
                </div>

                {activeSession.chatHistory.map((msg, i) => (
                  <ChatMessageItem key={i} msg={msg} />
                ))}

                {activeSession.isStreaming &&
                  (activeSession.currentFollowUpStream ||
                    activeSession.currentFollowUpReasoning ||
                    (activeSession.currentFollowUpToolEvents?.length ?? 0) > 0) && (
                    <div className="flex items-start space-x-2.5 justify-start">
                      <div className="w-6 h-6 rounded-full bg-blue-600/30 border border-blue-500/40 flex items-center justify-center shrink-0 mt-0.5 animate-pulse">
                        <Bot className="w-3.5 h-3.5 text-blue-300" />
                      </div>
                      <div className="p-3 rounded-xl text-xs max-w-[85%] leading-relaxed bg-[#191C21] border border-blue-500/30 text-slate-200 shadow-md flex-1">
                        {activeSession.currentFollowUpReasoning && (
                          <div className="mb-2.5 rounded-lg border border-blue-500/30 bg-[#121417] overflow-hidden text-xs shadow-inner">
                            <div className="flex items-center justify-between px-3 py-1.5 bg-blue-950/50 text-blue-300 border-b border-white/5">
                              <div className="flex items-center space-x-1.5 font-medium text-[11px]">
                                <Brain className="w-3.5 h-3.5 text-amber-300 animate-pulse shrink-0" />
                                <span>
                                  正在思考追问... ({followUpReasoningDisplay.text.length} 字符)
                                </span>
                              </div>
                            </div>
                            <div className="p-2.5 max-h-48 overflow-y-auto bg-[#0F1114] text-[11px] font-mono text-blue-200/90 whitespace-pre-wrap border-t border-white/5 leading-relaxed select-text">
                              {followUpReasoningDisplay.text}
                            </div>
                          </div>
                        )}

                        {(activeSession.currentFollowUpToolEvents?.length ?? 0) > 0 && (
                          <div className="mb-2.5 rounded-lg border border-blue-500/30 bg-[#121417] overflow-hidden text-xs shadow-inner">
                            <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-950/50 text-blue-300 font-medium text-[11px] border-b border-white/5">
                              <Terminal className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
                              <span>
                                正在自主探查代码库... ({activeSession.currentFollowUpToolEvents!.length} 次动作)
                              </span>
                            </div>
                            <div className="p-2 space-y-1 bg-[#0F1114] text-[11px] font-mono max-h-36 overflow-y-auto">
                              {activeSession.currentFollowUpToolEvents!.map((evt, idx) => (
                                <div key={idx} className="flex items-center space-x-1.5 text-slate-300">
                                  <span className="text-blue-400 font-bold">•</span>
                                  <span className="text-blue-300">{evt.name}:</span>
                                  <span className="text-slate-400 truncate text-[10px]">
                                    {evt.args ? JSON.stringify(evt.args) : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {activeSession.currentFollowUpStream ? (
                          <MarkdownRenderer content={activeSession.currentFollowUpStream} />
                        ) : (
                          <div className="flex items-center space-x-2 text-blue-400 text-xs py-1">
                            <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                            <span>AI 正在组织追问解答...</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
              </div>
            )}

            <div ref={messagesEndRef} className="h-2 shrink-0" />
          </>
        )}
      </div>

      {/* 3. Follow-up composer */}
      {activeSession && (
        <FollowUpInput disabled={Boolean(activeSession.isStreaming)} onSend={sendFollowUp} />
      )}
    </div>
  );
};
