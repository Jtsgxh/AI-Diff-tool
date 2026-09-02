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
      className={`h-full w-full min-w-0 min-h-0 bg-[var(--surface-canvas)] border-l border-black/15 flex flex-col font-sans ${
        isOpen ? '' : 'pointer-events-none'
      }`}
    >
      {/* 1. Header & session tabs */}
      <div className="border-b border-black/15 bg-[#FFFFFF] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-black/10">
          <div className="flex items-center space-x-2.5">
            <div className="flex items-center space-x-2 text-sm font-semibold text-zinc-950">
              <Sparkles className="w-4 h-4 text-zinc-700" />
              <span>AI 深度审查工作台</span>
            </div>

            <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-zinc-100/80 border border-zinc-300 text-[11px] text-zinc-800 font-mono">
              <Layers className="w-3 h-3 text-zinc-700" />
              {streamingCount > 0 ? (
                <span className="text-emerald-700 font-bold">{streamingCount} 个并行运行中</span>
              ) : (
                <span>共 {sessions.length} 个审查</span>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {sessions.length > 1 && (
              <button
                onClick={closeAllSessions}
                className="p-1 hover:bg-rose-100 text-zinc-700 hover:text-rose-700 rounded transition text-xs flex items-center space-x-1"
                title="关闭所有审查标签页"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1 hover:bg-black/[0.12] text-zinc-700 hover:text-zinc-950 rounded-lg transition"
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
          <div className="flex items-center justify-between px-4 py-2 bg-[#EFEFEC] text-xs">
            <div className="flex items-center bg-[var(--surface-raised)] p-0.5 rounded-lg border border-black/10">
              <button
                onClick={() => handleSwitchMode('agent')}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                  activeSession.engineMode === 'agent'
                    ? 'bg-zinc-900 text-white shadow-sm'
                    : 'text-zinc-700 hover:text-zinc-900'
                }`}
              >
                <Brain className="w-3.5 h-3.5" />
                <span>🧠 Codex 智能体</span>
              </button>
              <button
                onClick={() => handleSwitchMode('fast')}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                  activeSession.engineMode === 'fast'
                    ? 'bg-zinc-900 text-white shadow-sm'
                    : 'text-zinc-700 hover:text-zinc-900'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>⚡ 直接 Diff</span>
              </button>
            </div>

            <div className="flex items-center space-x-2">
              {activeSession.isCached && (
                <span className="flex items-center space-x-1 text-[11px] text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full font-mono">
                  <Database className="w-3 h-3" />
                  <span>本地缓存秒开</span>
                </span>
              )}

              {activeSession.isStreaming && (
                <span className="flex items-center space-x-1.5 text-[11px] text-emerald-700 font-mono">
                  <Activity className="w-3.5 h-3.5 animate-spin" />
                  <span>{activeSession.elapsedSeconds}s</span>
                </span>
              )}

              <button
                onClick={handleRerun}
                disabled={activeSession.isStreaming}
                className="p-1 hover:bg-black/[0.12] text-zinc-700 hover:text-zinc-950 rounded-md transition disabled:opacity-50"
                title="重新审查（强制绕过缓存刷新）"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={handleCopy}
                className="p-1 hover:bg-black/[0.12] text-zinc-700 hover:text-zinc-950 rounded-md transition"
                title="复制审查报告"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-700" />
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
        className="flex-1 overflow-y-auto p-4 space-y-4 text-zinc-900 select-text scroll-smooth"
      >
        {!activeSession ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-xs space-y-2">
            <Brain className="w-10 h-10 text-zinc-500 stroke-1" />
            <span>暂无活跃审查任务，请点击改动块或文件开启审查</span>
          </div>
        ) : (
          <>
            {/* Live Progress Banner during Streaming */}
            {activeSession.isStreaming && activeSession.agentStatus?.message && (
              <div className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-zinc-100 border border-zinc-400 text-zinc-800 text-xs font-mono shadow-sm">
                <Activity className="w-3.5 h-3.5 text-zinc-700 animate-spin shrink-0" />
                <span className="truncate">{activeSession.agentStatus.message}</span>
              </div>
            )}
            {batchInfo && batchInfo.messages.length > 0 && (
              <Accordion
                icon={<Layers className="w-4 h-4 text-zinc-700" />}
                title="本次批量合并包含的提交清单"
                badge={
                  <span className="px-1.5 py-0.2 rounded bg-zinc-100 text-zinc-800 font-mono text-[10px]">
                    共 {batchInfo.count} 个提交
                  </span>
                }
                isOpen={isBatchExpanded}
                onToggle={() => setIsBatchExpanded((v) => !v)}
                tone={{
                  shell: 'border border-zinc-400 bg-[#F5F5F2] shadow-sm',
                  header:
                    'bg-zinc-100/80 hover:bg-zinc-200',
                  body: 'p-3 bg-[#EFEFEC] space-y-1.5 max-h-52 overflow-y-auto text-xs font-mono',
                  text: 'text-zinc-800',
                }}
              >
                {batchInfo.messages.map((msg, i) => (
                  <div
                    key={i}
                    className="flex items-start space-x-2 p-2 rounded-lg bg-black/[0.05] border border-black/10 text-zinc-900 hover:border-zinc-400 transition leading-snug"
                  >
                    <span className="text-zinc-700 font-bold shrink-0">#{i + 1}</span>
                    <span className="text-zinc-900 select-text whitespace-pre-wrap">{msg}</span>
                  </div>
                ))}
              </Accordion>
            )}

            {activeSession.initialReasoning && (
              <Accordion
                icon={
                  <Brain
                    className={`w-4 h-4 text-amber-700 ${
                      activeSession.isStreaming && !activeSession.initialReport
                        ? 'animate-pulse'
                        : ''
                    }`}
                  />
                }
                title="模型分析过程 (Thinking)"
                badge={
                  <span className="px-1.5 py-0.2 rounded bg-zinc-100 text-zinc-800 font-mono text-[10px]">
                    {initialReasoningDisplay.text.length} 字符
                    {initialReasoningDisplay.hiddenExplorationBlocks > 0
                      ? ` · 已隐藏 ${initialReasoningDisplay.hiddenExplorationBlocks} 段源码载荷`
                      : ''}
                  </span>
                }
                isOpen={isThinkingExpanded}
                onToggle={() => setIsThinkingExpanded((v) => !v)}
                tone={{
                  shell: 'border border-zinc-400 bg-[#F5F5F2] shadow-sm',
                  header:
                    'bg-zinc-100/80 hover:bg-zinc-200',
                  body: 'p-3.5 max-h-72 overflow-y-auto bg-[#EFEFEC] text-xs text-zinc-800 font-mono leading-relaxed whitespace-pre-wrap selection:bg-zinc-200',
                  text: 'text-zinc-800',
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
              <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
                <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold">审查异常中断</div>
                  <div className="text-[11px] opacity-80 mt-0.5">{activeSession.error}</div>
                </div>
                {activeSession.initialReport.trim() && (
                  <button
                    type="button"
                    onClick={continueInterruptedSession}
                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-800 font-semibold transition"
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
                className="prose  prose-sm max-w-none text-zinc-900 leading-relaxed overflow-x-auto select-text"
              />
            )}

            {hasFollowUpActivity && (
              <div className="space-y-3.5 pt-4 border-t border-black/15">
                <div className="flex items-center space-x-2 text-xs font-semibold text-zinc-800">
                  <Bot className="w-4 h-4 text-zinc-700" />
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
                      <div className="w-6 h-6 rounded-full bg-zinc-900 border border-zinc-400 flex items-center justify-center shrink-0 mt-0.5 animate-pulse">
                        <Bot className="w-3.5 h-3.5 text-white" />
                      </div>
                      <div className="p-3 rounded-xl text-xs max-w-[85%] leading-relaxed bg-[#FFFFFF] border border-zinc-400 text-zinc-900 shadow-sm flex-1">
                        {activeSession.currentFollowUpReasoning && (
                          <div className="mb-2.5 rounded-lg border border-zinc-400 bg-[#FFFFFF] overflow-hidden text-xs shadow-inner">
                            <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-100 text-zinc-800 border-b border-black/10">
                              <div className="flex items-center space-x-1.5 font-medium text-[11px]">
                                <Brain className="w-3.5 h-3.5 text-amber-700 animate-pulse shrink-0" />
                                <span>
                                  正在思考追问... ({followUpReasoningDisplay.text.length} 字符)
                                </span>
                              </div>
                            </div>
                            <div className="p-2.5 max-h-48 overflow-y-auto bg-[#EFEFEC] text-[11px] font-mono text-zinc-800 whitespace-pre-wrap border-t border-black/10 leading-relaxed select-text">
                              {followUpReasoningDisplay.text}
                            </div>
                          </div>
                        )}

                        {(activeSession.currentFollowUpToolEvents?.length ?? 0) > 0 && (
                          <div className="mb-2.5 rounded-lg border border-zinc-400 bg-[#FFFFFF] overflow-hidden text-xs shadow-inner">
                            <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-zinc-100 text-zinc-800 font-medium text-[11px] border-b border-black/10">
                              <Terminal className="w-3.5 h-3.5 text-zinc-700 animate-spin shrink-0" />
                              <span>
                                正在自主探查代码库... ({activeSession.currentFollowUpToolEvents!.length} 次动作)
                              </span>
                            </div>
                            <div className="p-2 space-y-1 bg-[#EFEFEC] text-[11px] font-mono max-h-36 overflow-y-auto">
                              {activeSession.currentFollowUpToolEvents!.map((evt, idx) => (
                                <div key={idx} className="flex items-center space-x-1.5 text-zinc-800">
                                  <span className="text-zinc-700 font-bold">•</span>
                                  <span className="text-zinc-800">{evt.name}:</span>
                                  <span className="text-zinc-700 truncate text-[10px]">
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
                          <div className="flex items-center space-x-2 text-zinc-700 text-xs py-1">
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
