import React, { useState, useEffect, useRef } from 'react';
import { aiLogger, AICallSession, AIToolExecution } from '../../services/aiLogger';
import {
  Terminal,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Copy,
  Check,
  Trash2,
  X,
  Sparkles,
  Brain,
  FileCode,
  Zap,
  BookOpen,
  ArrowDown,
  Code2,
  Wrench,
  Search,
} from 'lucide-react';
import { marked } from 'marked';

interface AICallInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AICallInspectorModal: React.FC<AICallInspectorModalProps> = ({ isOpen, onClose }) => {
  const [sessions, setSessions] = useState<AICallSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'stream' | 'reasoning' | 'input'>('stream');
  const [outputViewFormat, setOutputViewFormat] = useState<'raw' | 'markdown'>('raw');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [searchFilter, setSearchFilter] = useState<string>('');

  const outputScrollRef = useRef<HTMLDivElement>(null);

  // Subscribe only while the console is on screen. A permanent subscription
  // kept this modal re-rendering on every streamed token even when closed.
  useEffect(() => {
    if (!isOpen) return;
    return aiLogger.subscribe(setSessions);
  }, [isOpen]);

  // Auto select the first / newest session when modal opens or if selected is null
  useEffect(() => {
    if (sessions.length > 0) {
      if (!selectedSessionId || !sessions.some((s) => s.id === selectedSessionId)) {
        setSelectedSessionId(sessions[0].id);
      }
    }
  }, [sessions, selectedSessionId]);

  const activeSession = sessions.find((s) => s.id === selectedSessionId) || sessions[0] || null;

  // Auto-scroll to bottom as new chunks stream in
  useEffect(() => {
    if (autoScroll && outputScrollRef.current && activeSession?.status === 'running') {
      outputScrollRef.current.scrollTop = outputScrollRef.current.scrollHeight;
    }
  }, [activeSession?.rawOutput, activeSession?.reasoningContent, autoScroll]);

  if (!isOpen) return null;

  const handleCopyOutput = () => {
    if (!activeSession) return;
    navigator.clipboard.writeText(activeSession.rawOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClearLogs = () => {
    aiLogger.clearLogs();
    setSelectedSessionId(null);
  };

  const filteredSessions = sessions.filter((s) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.model.toLowerCase().includes(q) ||
      (s.filePath && s.filePath.toLowerCase().includes(q))
    );
  });

  const isAnyRunning = sessions.some((s) => s.status === 'running');

  const formatDuration = (startTime: number, endTime?: number) => {
    const duration = (endTime || Date.now()) - startTime;
    if (duration < 1000) return `${duration}ms`;
    return `${(duration / 1000).toFixed(1)}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md animate-in fade-in duration-150 p-3 md:p-6">
      <div className="bg-[#12131A] border border-purple-500/30 rounded-2xl w-full max-w-6xl h-[88vh] flex flex-col shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="h-14 bg-[#161722] border-b border-white/10 px-5 flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-sm text-slate-100">
                  AI 实时调用控制台 (AI Stream & Call Inspector)
                </span>
                {isAnyRunning ? (
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span>正在实时流式输出</span>
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500 font-mono">
                    已捕获 {sessions.length} 次调用
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Header Action Tools */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs transition border ${
                autoScroll
                  ? 'bg-purple-600/20 text-purple-300 border-purple-500/40'
                  : 'bg-white/5 text-slate-400 border-white/10 hover:text-slate-200'
              }`}
              title="大模型流式输出时自动滚动至底部"
            >
              <ArrowDown className="w-3 h-3" />
              <span>自动滚屏</span>
            </button>

            <button
              onClick={handleCopyOutput}
              disabled={!activeSession?.rawOutput}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs transition disabled:opacity-40"
              title="复制当前会话的完整原始输出"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? '已复制' : '复制输出'}</span>
            </button>

            <button
              onClick={handleClearLogs}
              disabled={sessions.length === 0}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 hover:text-rose-200 text-xs transition disabled:opacity-40"
              title="清空所有调用日志"
            >
              <Trash2 className="w-3 h-3" />
              <span>清空</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body (2 Columns) */}
        <div className="flex-1 flex min-h-0">
          {/* Left Column: Call Sessions List (w-80) */}
          <div className="w-80 border-r border-white/10 bg-[#13141D] flex flex-col shrink-0">
            {/* Search / Filter */}
            <div className="p-3 border-b border-white/5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="筛选调用记录..."
                  className="w-full bg-[#181926] border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
                />
              </div>
            </div>

            {/* Sessions Scroll List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {filteredSessions.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs">
                  <Activity className="w-8 h-8 mx-auto mb-2 text-slate-600 stroke-1" />
                  <span>暂无 AI 调用记录</span>
                  <p className="text-[11px] text-slate-600 mt-1">
                    点击伪代码、直接解释或深度审查即可在此实时监控
                  </p>
                </div>
              ) : (
                filteredSessions.map((s) => {
                  const isSelected = s.id === (activeSession?.id || '');
                  const isRunning = s.status === 'running';
                  const isError = s.status === 'error';

                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSessionId(s.id)}
                      className={`w-full text-left p-3 rounded-xl border transition flex flex-col space-y-1.5 ${
                        isSelected
                          ? 'bg-purple-950/30 border-purple-500/60 shadow-sm'
                          : 'bg-[#181924]/60 hover:bg-[#1C1D2C] border-white/5 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5 min-w-0">
                          {isRunning ? (
                            <Activity className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />
                          ) : isError ? (
                            <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          )}
                          <span
                            className={`font-semibold text-xs truncate ${
                              isSelected ? 'text-white' : 'text-slate-200'
                            }`}
                          >
                            {s.title}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono shrink-0">
                          {formatDuration(s.startTime, s.endTime)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                        <span className="truncate max-w-[140px]" title={s.model}>
                          🏷️ {s.model}
                        </span>
                        <span>{s.rawOutput.length} 字符</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Active Session Inspector */}
          {activeSession ? (
            <div className="flex-1 flex flex-col min-w-0 bg-[#0E0F15]">
              {/* Session Meta Header & Sub-Tabs */}
              <div className="bg-[#151620] border-b border-white/10 px-5 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="flex items-center space-x-3">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-slate-100 text-sm">{activeSession.title}</span>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                          activeSession.status === 'running'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 animate-pulse'
                            : activeSession.status === 'error'
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                            : 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                        }`}
                      >
                        {activeSession.status === 'running'
                          ? '⏳ 输出中 (Streaming)'
                          : activeSession.status === 'error'
                          ? '✕ 执行异常'
                          : '✓ 执行完成'}
                      </span>
                    </div>
                    <div className="flex items-center space-x-3 text-xs text-slate-400 mt-1 font-mono">
                      <span>模型: <strong className="text-purple-300">{activeSession.model}</strong></span>
                      <span>提供商: <strong className="text-slate-300">{activeSession.provider}</strong></span>
                      <span>耗时: <strong className="text-slate-300">{formatDuration(activeSession.startTime, activeSession.endTime)}</strong></span>
                      <span>字符数: <strong className="text-slate-300">{activeSession.rawOutput.length}</strong></span>
                    </div>
                  </div>
                </div>

                {/* Sub-Tabs */}
                <div className="flex items-center bg-[#1D1F2D] border border-white/10 rounded-lg p-1 space-x-1">
                  <button
                    onClick={() => setActiveTab('stream')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition flex items-center space-x-1.5 ${
                      activeTab === 'stream'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>📺 完整输出流</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('reasoning')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition flex items-center space-x-1.5 ${
                      activeTab === 'reasoning'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Brain className="w-3.5 h-3.5" />
                    <span>
                      🧠 思考/工具 (
                      {(activeSession.toolEvents?.length || 0) +
                        (activeSession.reasoningContent ? 1 : 0)}
                      )
                    </span>
                  </button>

                  <button
                    onClick={() => setActiveTab('input')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition flex items-center space-x-1.5 ${
                      activeTab === 'input'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    <span>📥 输入与 Prompt</span>
                  </button>
                </div>
              </div>

              {/* Inspector Content Panel */}
              <div className="flex-1 overflow-y-auto p-5" ref={outputScrollRef}>
                {/* TAB 1: Live Stream Output */}
                {activeTab === 'stream' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-slate-300">原始大模型流式输出：</span>
                        {activeSession.status === 'running' && (
                          <span className="text-emerald-400 animate-pulse font-mono text-[11px]">
                            ● 正在接收来自大模型服务端的实时 Token 数据流...
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-1 bg-[#171824] border border-white/10 rounded-md p-0.5 text-[11px]">
                        <button
                          onClick={() => setOutputViewFormat('raw')}
                          className={`px-2 py-0.5 rounded transition ${
                            outputViewFormat === 'raw'
                              ? 'bg-purple-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          💻 纯文本 (Raw)
                        </button>
                        <button
                          onClick={() => setOutputViewFormat('markdown')}
                          className={`px-2 py-0.5 rounded transition ${
                            outputViewFormat === 'markdown'
                              ? 'bg-purple-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          📝 Markdown 预览
                        </button>
                      </div>
                    </div>

                    {activeSession.error && (
                      <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-200 text-xs font-mono">
                        <strong>❌ 错误信息：</strong>
                        <pre className="mt-1 whitespace-pre-wrap">{activeSession.error}</pre>
                      </div>
                    )}

                    {outputViewFormat === 'raw' ? (
                      <div className="p-4 rounded-xl bg-[#090A0F] border border-white/10 font-mono text-xs text-emerald-300 leading-relaxed overflow-x-auto whitespace-pre-wrap selection:bg-purple-600 selection:text-white min-h-[300px]">
                        {activeSession.rawOutput ? (
                          activeSession.rawOutput
                        ) : activeSession.status === 'running' ? (
                          <span className="text-slate-500 italic animate-pulse">
                            (正在连接模型并等待首个 Token 返回...)
                          </span>
                        ) : (
                          <span className="text-slate-500 italic">(无输出内容)</span>
                        )}
                        {activeSession.status === 'running' && (
                          <span className="inline-block w-2 h-4 bg-emerald-400 ml-1 animate-pulse align-middle"></span>
                        )}
                      </div>
                    ) : (
                      <div className="p-5 rounded-xl bg-[#14151F] border border-white/5 text-slate-200 text-xs leading-relaxed prose prose-invert prose-sm max-w-none min-h-[300px]">
                        {activeSession.rawOutput ? (
                          <div
                            dangerouslySetInnerHTML={{
                              __html: marked.parse(activeSession.rawOutput) as string,
                            }}
                          />
                        ) : (
                          <span className="text-slate-500 italic">(等待 Markdown 输出...)</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: Reasoning & Tool Events */}
                {activeTab === 'reasoning' && (
                  <div className="space-y-4 text-xs">
                    {/* DeepSeek Reasoning Content */}
                    {activeSession.reasoningContent ? (
                      <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-500/20 space-y-2">
                        <div className="flex items-center space-x-2 text-purple-300 font-bold text-xs">
                          <Brain className="w-4 h-4 text-purple-400" />
                          <span>大模型思维链推导 (DeepSeek Reasoner / Thinking Trace)</span>
                        </div>
                        <div className="font-mono text-slate-300 text-xs whitespace-pre-wrap leading-relaxed bg-[#0A0B10] p-3 rounded-lg border border-white/5">
                          {activeSession.reasoningContent}
                        </div>
                      </div>
                    ) : null}

                    {/* Codex Agent Tool Call Events */}
                    {activeSession.toolEvents && activeSession.toolEvents.length > 0 ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center space-x-2 text-slate-300 font-bold">
                          <Wrench className="w-4 h-4 text-purple-400" />
                          <span>Codex 智能体探查轨迹 ({activeSession.toolEvents.length} 次工具调用)</span>
                        </div>

                        {activeSession.toolEvents.map((t, idx) => (
                          <div
                            key={`tool-${idx}`}
                            className="p-3.5 rounded-xl bg-[#141520] border border-white/5 space-y-2 font-mono text-xs"
                          >
                            <div className="flex items-center justify-between text-purple-300 font-semibold">
                              <span>
                                #{idx + 1} 工具: <strong className="text-white">{t.name}</strong>
                              </span>
                              <span className="text-slate-500 text-[10px]">
                                {new Date(t.timestamp).toLocaleTimeString()}
                              </span>
                            </div>

                            {t.args && (
                              <div className="bg-[#0B0C12] p-2 rounded-lg border border-white/5 text-sky-300">
                                <strong>参数 (Args):</strong>
                                <pre className="mt-1 whitespace-pre-wrap text-[11px]">
                                  {JSON.stringify(t.args, null, 2)}
                                </pre>
                              </div>
                            )}

                            {t.output && (
                              <div className="bg-[#0B0C12] p-2 rounded-lg border border-white/5 text-slate-300">
                                <strong>输出 (Output):</strong>
                                <pre className="mt-1 whitespace-pre-wrap text-[11px] max-h-48 overflow-y-auto">
                                  {t.output}
                                </pre>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {!activeSession.reasoningContent &&
                      (!activeSession.toolEvents || activeSession.toolEvents.length === 0) && (
                        <div className="text-center py-16 text-slate-500">
                          <Brain className="w-10 h-10 mx-auto mb-2 text-slate-600 stroke-1" />
                          <span>该次调用为直连推理，无独立工具调用或推理链</span>
                        </div>
                      )}
                  </div>
                )}

                {/* TAB 3: Inputs & Prompts */}
                {activeTab === 'input' && (
                  <div className="space-y-4 text-xs">
                    {/* User Prompt / Instruction */}
                    {activeSession.userPrompt && (
                      <div className="p-4 rounded-xl bg-[#141520] border border-white/5 space-y-1.5">
                        <span className="font-bold text-slate-200">
                          📌 发送的用户指令 / 专用提示词 (User Prompt)
                        </span>
                        <pre className="font-mono text-slate-300 bg-[#0A0B10] p-3 rounded-lg border border-white/5 whitespace-pre-wrap leading-relaxed">
                          {activeSession.userPrompt}
                        </pre>
                      </div>
                    )}

                    {/* System Prompt */}
                    {activeSession.systemPrompt && (
                      <div className="p-4 rounded-xl bg-[#141520] border border-white/5 space-y-1.5">
                        <span className="font-bold text-slate-200">
                          ⚙️ 系统设定提示词 (System Prompt)
                        </span>
                        <pre className="font-mono text-slate-300 bg-[#0A0B10] p-3 rounded-lg border border-white/5 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                          {activeSession.systemPrompt}
                        </pre>
                      </div>
                    )}

                    {/* Input Diff */}
                    {activeSession.inputDiff && (
                      <div className="p-4 rounded-xl bg-[#141520] border border-white/5 space-y-1.5">
                        <span className="font-bold text-slate-200">
                          📄 输入的 Git Diff 上下文代码
                        </span>
                        <pre className="font-mono text-slate-300 bg-[#0A0B10] p-3 rounded-lg border border-white/5 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                          {activeSession.inputDiff}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs">
              <Terminal className="w-12 h-12 mb-2 text-slate-600 stroke-1" />
              <span>请选择左侧调用会话以查看完整输出过程</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
