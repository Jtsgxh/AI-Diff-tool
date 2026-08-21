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
} from 'lucide-react';
import { AIProviderConfig } from '../../types';
import {
  streamExplainDiff,
  streamAgentExplainDiff,
  AgentToolEvent,
  AgentStatusEvent,
} from '../../services/api';

export interface ExplanationScope {
  type: 'commit' | 'file' | 'hunk' | 'chunks' | 'compare' | 'line';
  title: string;
  diff: string;
  filePath?: string;
  commitMessage?: string;
  initialMode?: 'agent' | 'fast';
}

interface AIExplanationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  scope: ExplanationScope | null;
  repoPath: string;
  aiConfig: AIProviderConfig;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolEvents?: AgentToolEvent[];
}

export const AIExplanationDrawer: React.FC<AIExplanationDrawerProps> = ({
  isOpen,
  onClose,
  scope,
  repoPath,
  aiConfig,
}) => {
  const [engineMode, setEngineMode] = useState<'agent' | 'fast'>('agent');
  const [streamContent, setStreamContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [userQuestion, setUserQuestion] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Agent live status and action trail
  const [agentStatus, setAgentStatus] = useState<AgentStatusEvent | null>(null);
  const [currentToolEvents, setCurrentToolEvents] = useState<AgentToolEvent[]>([]);
  const [isTrailExpanded, setIsTrailExpanded] = useState<boolean>(true);
  const [expandedToolIndex, setExpandedToolIndex] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  const abortStreamRef = useRef<(() => void) | null>(null);
  const contentEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<any>(null);

  // Timer for execution elapsed time
  useEffect(() => {
    if (isStreaming) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => +(prev + 0.5).toFixed(1));
      }, 500);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isStreaming]);

  // Sync initialMode when scope opens
  useEffect(() => {
    if (scope?.initialMode) {
      setEngineMode(scope.initialMode);
    }
  }, [scope]);

  // Trigger initial explanation when scope changes or mode changes
  useEffect(() => {
    if (isOpen && scope) {
      handleStartExplanation();
    } else {
      if (abortStreamRef.current) {
        abortStreamRef.current();
      }
    }
  }, [isOpen, scope, engineMode]);

  // Auto scroll to bottom during streaming
  useEffect(() => {
    contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamContent, currentToolEvents, agentStatus, chatHistory]);

  const handleStartExplanation = async (customPrompt?: string) => {
    if (!scope) return;

    if (abortStreamRef.current) {
      abortStreamRef.current();
    }

    setError(null);
    setIsStreaming(true);
    setCurrentToolEvents([]);
    setAgentStatus({
      type: 'status',
      phase: 'initializing',
      message: engineMode === 'agent' ? 'Codex 智能体已连接，准备探索代码库...' : 'AI 正在解析 Diff...',
    });

    if (!customPrompt) {
      setStreamContent('');
      setChatHistory([]);
    } else {
      setChatHistory((prev) => [...prev, { role: 'user', content: customPrompt }]);
      setStreamContent('');
    }

    try {
      const scopeType =
        scope.type === 'hunk' || scope.type === 'chunks'
          ? 'chunk'
          : scope.type === 'file'
          ? 'file'
          : scope.type === 'line'
          ? 'line'
          : 'commit';

      let cancel: () => void;

      if (engineMode === 'agent') {
        // Agentic Autonomous Multi-File Exploration Mode
        cancel = await streamAgentExplainDiff({
          repoPath,
          scopeType,
          diff: scope.diff,
          filePath: scope.filePath,
          commitMessage: scope.commitMessage,
          userPrompt: customPrompt,
          config: aiConfig,
          onStatusUpdate: (status) => {
            setAgentStatus(status);
          },
          onToolEvent: (event) => {
            setCurrentToolEvents((prev) => {
              if (event.type === 'tool_result' && event.id) {
                const idx = prev.findIndex((e) => e.id === event.id);
                if (idx !== -1) {
                  const copy = [...prev];
                  copy[idx] = { ...copy[idx], ...event };
                  return copy;
                }
              }
              return [...prev, event];
            });
          },
          onChunk: (chunk) => {
            setStreamContent((prev) => prev + chunk);
          },
          onComplete: () => {
            setIsStreaming(false);
            setAgentStatus({
              type: 'status',
              phase: 'completed',
              message: 'Codex 审查完成',
            });
            if (customPrompt) {
              setChatHistory((prev) => [
                ...prev,
                { role: 'assistant', content: streamContent, toolEvents: currentToolEvents },
              ]);
              setStreamContent('');
            }
          },
          onError: (err) => {
            setIsStreaming(false);
            setError(err.message);
          },
        });
      } else {
        // Fast Direct Diff Mode
        cancel = await streamExplainDiff({
          scopeType,
          diff: scope.diff,
          filePath: scope.filePath,
          commitMessage: scope.commitMessage,
          userPrompt: customPrompt,
          config: aiConfig,
          onChunk: (chunk) => {
            setStreamContent((prev) => prev + chunk);
          },
          onComplete: () => {
            setIsStreaming(false);
            setAgentStatus({
              type: 'status',
              phase: 'completed',
              message: '直接 Diff 解析完成',
            });
            if (customPrompt) {
              setChatHistory((prev) => [
                ...prev,
                { role: 'assistant', content: streamContent },
              ]);
              setStreamContent('');
            }
          },
          onError: (err) => {
            setIsStreaming(false);
            setError(err.message);
          },
        });
      }

      abortStreamRef.current = cancel;
    } catch (err: any) {
      setIsStreaming(false);
      setError(err.message);
    }
  };

  const handleSendQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userQuestion.trim() || isStreaming) return;
    const q = userQuestion.trim();
    setUserQuestion('');
    handleStartExplanation(q);
  };

  const handleCopy = () => {
    const textToCopy =
      streamContent ||
      chatHistory.map((m) => `${m.role === 'user' ? '问: ' : '答: '}${m.content}`).join('\n\n');
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStop = () => {
    if (abortStreamRef.current) {
      abortStreamRef.current();
      setIsStreaming(false);
      setAgentStatus({
        type: 'status',
        phase: 'completed',
        message: '用户已终止运行',
      });
    }
  };

  if (!isOpen || !scope) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[620px] max-w-[95vw] bg-[#15161D] border-l border-purple-500/20 shadow-2xl z-50 flex flex-col font-sans transition-all duration-300">
      {/* Top Header */}
      <div className="h-14 px-4 bg-[#121319] border-b border-white/10 flex items-center justify-between select-none shrink-0 relative overflow-hidden">
        {/* Animated Glowing Top Line when running */}
        {isStreaming && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 via-pink-500 to-indigo-500 animate-pulse" />
        )}

        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-gradient-to-tr from-purple-600 to-pink-600 flex items-center justify-center shadow-md shadow-purple-500/20 shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-1.5">
              <span className="font-semibold text-xs text-white truncate">
                AI 语义解释与审查
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono">
                {aiConfig.model || aiConfig.provider}
              </span>
            </div>
            <span className="text-[11px] text-slate-400 truncate max-w-xs" title={scope.title}>
              {scope.title}
            </span>
          </div>
        </div>

        {/* Engine Mode Toggle & Actions */}
        <div className="flex items-center space-x-2">
          {/* Mode Switcher */}
          <div className="flex items-center bg-[#1A1B24] border border-white/10 rounded-lg p-0.5 text-[11px]">
            <button
              onClick={() => setEngineMode('agent')}
              disabled={isStreaming}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition font-medium ${
                engineMode === 'agent'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="智能体自主探索：访问文件系统、全局搜索引用、多文件关联分析"
            >
              <Brain className="w-3.5 h-3.5 text-purple-300" />
              <span>关联解释 (Codex)</span>
            </button>
            <button
              onClick={() => setEngineMode('fast')}
              disabled={isStreaming}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition font-medium ${
                engineMode === 'fast'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="直接 Diff 模式：极速聚焦当前修改代码行"
            >
              <Zap className="w-3.5 h-3.5 text-amber-300" />
              <span>直接 Diff</span>
            </button>
          </div>

          <button
            onClick={handleCopy}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded transition"
            title="复制解释内容"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>

          <button
            onClick={() => handleStartExplanation()}
            disabled={isStreaming}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded transition disabled:opacity-50"
            title="重新生成解释"
          >
            <RefreshCw className={`w-4 h-4 ${isStreaming ? 'animate-spin text-purple-400' : ''}`} />
          </button>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Prominent Mode Distinction Banner */}
      <div
        className={`px-4 py-2 border-b flex items-center justify-between text-xs transition-colors select-none ${
          engineMode === 'agent'
            ? 'bg-purple-950/40 border-purple-500/30 text-purple-200'
            : 'bg-amber-950/40 border-amber-500/30 text-amber-200'
        }`}
      >
        <div className="flex items-center space-x-2 min-w-0">
          {engineMode === 'agent' ? (
            <>
              <Brain className="w-4 h-4 text-purple-400 shrink-0" />
              <div className="truncate">
                <span className="font-bold">【文件关联解释模式 (Codex Agent)】</span>
                <span className="text-[11px] text-purple-300/80 ml-1">
                  已启用文件系统访问，智能体自主跨文件检索类定义与下游调用
                </span>
              </div>
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 text-amber-400 shrink-0" />
              <div className="truncate">
                <span className="font-bold">【直接 Diff 解释模式】</span>
                <span className="text-[11px] text-amber-300/80 ml-1">
                  仅针对当前选定的增删片段直接分析，不查阅外部文件
                </span>
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => setEngineMode(engineMode === 'agent' ? 'fast' : 'agent')}
          disabled={isStreaming}
          className={`shrink-0 ml-2 px-2 py-0.5 rounded text-[11px] font-medium border transition ${
            engineMode === 'agent'
              ? 'bg-purple-600/30 hover:bg-purple-600/50 border-purple-400/40 text-purple-200'
              : 'bg-amber-600/30 hover:bg-amber-600/50 border-amber-400/40 text-amber-200'
          }`}
        >
          切为{engineMode === 'agent' ? '「直接 Diff 解释」' : '「文件关联解释」'}
        </button>
      </div>

      {/* Active Custom Prompt Pill (if configured) */}
      {aiConfig.customSystemPrompt && (
        <div className="px-4 py-1.5 bg-[#121319] border-b border-purple-500/20 flex items-center justify-between text-[11px] text-purple-300">
          <div className="flex items-center space-x-1.5 min-w-0">
            <span className="shrink-0 px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-semibold text-[10px]">
              🎯 自定义偏好指令
            </span>
            <span className="truncate text-slate-300" title={aiConfig.customSystemPrompt}>
              {aiConfig.customSystemPrompt}
            </span>
          </div>
        </div>
      )}

      {/* 🚀 Real-time Live Agent Activity HUD (Running / Idle Status Indicator) */}
      <div className="px-4 py-2 bg-[#101117] border-b border-white/5 flex items-center justify-between text-xs font-mono select-none">
        <div className="flex items-center space-x-2 min-w-0">
          {isStreaming ? (
            <>
              {/* Glowing animated green radar beacon */}
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-sm shadow-emerald-400" />
              </span>
              <span className="font-bold text-emerald-400 text-[11px] shrink-0">
                {engineMode === 'agent' ? 'Codex Agent 运行中' : 'AI 生成中'}
              </span>
              <span className="text-slate-400 truncate text-[11px]">
                {agentStatus?.message || '正在分析中...'}
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex rounded-full h-2 w-2 bg-slate-500 shrink-0" />
              <span className="text-slate-400 text-[11px]">
                {agentStatus?.message || '空闲已就绪'}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center space-x-2 text-[10px] text-slate-500 shrink-0">
          {isStreaming && (
            <span className="text-purple-400 font-bold animate-pulse">
              ⏱️ {elapsedSeconds}s
            </span>
          )}
          {currentToolEvents.length > 0 && (
            <span className="bg-purple-500/10 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/20">
              🛠️ {currentToolEvents.length} 次动作
            </span>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-slate-200 leading-relaxed font-sans">
        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 text-xs">{error}</div>
          </div>
        )}

        {/* Previous Chat Q&A history if any */}
        {chatHistory.map((msg, i) => (
          <div
            key={`chat-${i}`}
            className={`p-3 rounded-lg text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'bg-purple-950/40 border border-purple-500/30 text-purple-200 ml-6'
                : 'bg-[#1D1F2A] border border-white/5 text-slate-200 mr-2'
            }`}
          >
            <div className="flex items-center space-x-1.5 mb-1 text-[11px] font-semibold text-slate-400">
              {msg.role === 'user' ? (
                <>
                  <User className="w-3.5 h-3.5 text-purple-400" />
                  <span>您的问题:</span>
                </>
              ) : (
                <>
                  <Bot className="w-3.5 h-3.5 text-purple-400" />
                  <span>AI 架构分析:</span>
                </>
              )}
            </div>
            <div
              className="prose prose-invert prose-xs max-w-none text-slate-200"
              dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) as string }}
            />
          </div>
        ))}

        {/* Live Agent Tool-Calling Action Trail (Visible in Agent mode) */}
        {engineMode === 'agent' && (currentToolEvents.length > 0 || isStreaming) && (
          <div className="bg-[#181924] border border-purple-500/30 rounded-xl overflow-hidden shadow-lg transition-all">
            {/* Trail Header */}
            <div
              onClick={() => setIsTrailExpanded(!isTrailExpanded)}
              className="px-3.5 py-2.5 bg-gradient-to-r from-purple-950/60 to-indigo-950/50 border-b border-purple-500/20 flex items-center justify-between cursor-pointer select-none"
            >
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 rounded bg-purple-500/20 text-purple-300 flex items-center justify-center">
                  <Brain className={`w-3.5 h-3.5 ${isStreaming ? 'animate-pulse text-purple-300' : ''}`} />
                </div>
                <div className="flex items-center space-x-1.5 text-xs font-semibold text-purple-200">
                  <span>Codex 智能体代码库探索轨迹</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-purple-500/20 text-purple-300 font-mono">
                    已探查 {currentToolEvents.length} 个节点
                  </span>
                </div>
              </div>

              <div className="flex items-center space-x-2 text-slate-400">
                {isStreaming && (
                  <span className="text-[10px] text-emerald-400 flex items-center gap-1 animate-pulse">
                    <Activity className="w-3 h-3" />
                    <span>{agentStatus?.message || '智能体推理中...'}</span>
                  </span>
                )}
                {isTrailExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </div>
            </div>

            {/* Trail Events List */}
            {isTrailExpanded && (
              <div className="p-2.5 space-y-1.5 max-h-64 overflow-y-auto bg-[#12131A] text-[11px] font-mono">
                {currentToolEvents.length === 0 && isStreaming && (
                  <div className="p-3 text-center text-slate-400 flex items-center justify-center space-x-2">
                    <div className="w-3.5 h-3.5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                    <span>智能体正在评估 Diff 语义并准备探查外部文件...</span>
                  </div>
                )}

                {currentToolEvents.map((evt, idx) => {
                  const isExpanded = expandedToolIndex === idx;
                  const isSearch = evt.name === 'search_code';
                  const isRead = evt.name === 'read_file';
                  const isFind = evt.name === 'find_files';

                  return (
                    <div
                      key={idx}
                      className="border border-white/5 rounded-lg bg-[#161720] overflow-hidden"
                    >
                      <div
                        onClick={() => setExpandedToolIndex(isExpanded ? null : idx)}
                        className="px-2.5 py-1.5 flex items-center justify-between cursor-pointer hover:bg-white/5 transition text-slate-300"
                      >
                        <div className="flex items-center space-x-2 truncate">
                          {isSearch && <Search className="w-3 h-3 text-sky-400 shrink-0" />}
                          {isRead && <FileText className="w-3 h-3 text-emerald-400 shrink-0" />}
                          {isFind && <FolderSearch className="w-3 h-3 text-amber-400 shrink-0" />}
                          {!isSearch && !isRead && !isFind && (
                            <Terminal className="w-3 h-3 text-purple-400 shrink-0" />
                          )}

                          <span className="font-bold text-purple-300">{evt.name || 'action'}</span>
                          <span className="text-slate-400 truncate">
                            {evt.args
                              ? JSON.stringify(evt.args).replace(/[{}"]/g, '')
                              : evt.summary || ''}
                          </span>
                        </div>

                        <div className="flex items-center space-x-1.5 shrink-0 pl-2">
                          {evt.output ? (
                            <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                              <Check className="w-3 h-3" /> 已获取
                            </span>
                          ) : (
                            <span className="text-[10px] text-amber-400 flex items-center gap-1 animate-pulse">
                              <div className="w-2.5 h-2.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                              执行中
                            </span>
                          )}
                          {isExpanded ? (
                            <ChevronDown className="w-3 h-3 text-slate-500" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-slate-500" />
                          )}
                        </div>
                      </div>

                      {/* Tool Output Snippet */}
                      {isExpanded && evt.output && (
                        <div className="p-2 bg-[#0D0E14] border-t border-white/5 text-[10px] text-slate-400 max-h-40 overflow-y-auto whitespace-pre font-mono">
                          {evt.output}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Live Streaming Content */}
        {streamContent && (
          <div className="p-3.5 bg-[#191A22] rounded-xl border border-white/5 relative">
            <div
              className="prose prose-invert prose-xs max-w-none text-slate-200 font-sans leading-relaxed
                [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-purple-300 [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:border-b [&_h3]:border-white/5 [&_h3]:pb-1
                [&_p]:my-1.5 [&_p]:text-slate-300
                [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1.5
                [&_li]:my-0.5 [&_li]:text-slate-300
                [&_table]:w-full [&_table]:my-2 [&_table]:border-collapse
                [&_th]:bg-purple-950/40 [&_th]:p-1.5 [&_th]:text-left [&_th]:text-purple-200 [&_th]:border [&_th]:border-white/10
                [&_td]:p-1.5 [&_td]:border [&_td]:border-white/10 [&_td]:text-slate-300
                [&_blockquote]:border-l-2 [&_blockquote]:border-purple-500 [&_blockquote]:pl-2.5 [&_blockquote]:my-1.5 [&_blockquote]:text-purple-200
                [&_code]:bg-[#121319] [&_code]:px-1 [&_code]:py-0.2 [&_code]:rounded [&_code]:text-purple-300 [&_code]:font-mono"
              dangerouslySetInnerHTML={{ __html: marked.parse(streamContent) as string }}
            />
            {isStreaming && (
              <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-1 align-middle" />
            )}
          </div>
        )}

        {isStreaming && !streamContent && currentToolEvents.length === 0 && (
          <div className="flex flex-col items-center justify-center p-8 space-y-3 text-slate-400">
            <div className="relative flex items-center justify-center">
              <div className="w-10 h-10 rounded-full border-2 border-purple-500/30 animate-ping absolute" />
              <div className="w-10 h-10 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
              <Brain className="w-5 h-5 text-purple-400 absolute" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-xs font-semibold text-purple-200">
                {agentStatus?.message || 'Codex 智能体正在评估代码库依赖...'}
              </p>
              <p className="text-[11px] text-slate-500">
                智能体将自主探索关联文件并综合推理全景报告
              </p>
            </div>
          </div>
        )}

        <div ref={contentEndRef} />
      </div>

      {/* Footer / Interactive Q&A Toolbar */}
      <div className="p-3 bg-[#121319] border-t border-white/10 shrink-0">
        <form onSubmit={handleSendQuestion} className="flex items-center space-x-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={userQuestion}
              onChange={(e) => setUserQuestion(e.target.value)}
              disabled={isStreaming}
              placeholder={
                engineMode === 'agent'
                  ? '针对此差异向 Codex 智能体提问 (将结合全库文件进行关联深度解答)...'
                  : '针对此差异直接提问 (聚焦当前 Diff 语法与逻辑)...'
              }
              className="w-full bg-[#1A1B23] text-xs text-slate-200 pl-3 pr-8 py-2 rounded-lg border border-white/10 focus:outline-none focus:border-purple-500/50 transition placeholder:text-slate-500"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="absolute right-2 top-2 text-rose-400 hover:text-rose-300"
                title="停止生成"
              >
                <StopCircle className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!userQuestion.trim()}
                className="absolute right-2 top-2 text-purple-400 hover:text-purple-300 disabled:opacity-30 transition"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
