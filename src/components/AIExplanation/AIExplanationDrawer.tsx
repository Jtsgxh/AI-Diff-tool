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
  FileCode,
  Layers,
  StopCircle,
  HelpCircle,
  MessageSquare,
} from 'lucide-react';
import { AIProviderConfig } from '../../types';
import { streamExplainDiff } from '../../services/api';

export interface ExplanationScope {
  type: 'commit' | 'file' | 'hunk' | 'chunks' | 'compare' | 'line';
  title: string;
  diff: string;
  filePath?: string;
  commitMessage?: string;
}

interface AIExplanationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  scope: ExplanationScope | null;
  aiConfig: AIProviderConfig;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const AIExplanationDrawer: React.FC<AIExplanationDrawerProps> = ({
  isOpen,
  onClose,
  scope,
  aiConfig,
}) => {
  const [streamContent, setStreamContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [userQuestion, setUserQuestion] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortStreamRef = useRef<(() => void) | null>(null);
  const contentEndRef = useRef<HTMLDivElement>(null);

  // Trigger initial explanation when scope changes
  useEffect(() => {
    if (isOpen && scope) {
      handleStartExplanation();
    } else {
      if (abortStreamRef.current) {
        abortStreamRef.current();
      }
    }
  }, [isOpen, scope]);

  // Auto scroll to bottom
  useEffect(() => {
    contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamContent, chatHistory]);

  const handleStartExplanation = async (customPrompt?: string) => {
    if (!scope) return;

    if (abortStreamRef.current) {
      abortStreamRef.current();
    }

    setError(null);
    setIsStreaming(true);

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

      const cancel = await streamExplainDiff({
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
    const textToCopy = streamContent || chatHistory.map((m) => `${m.role === 'user' ? '问: ' : '答: '}${m.content}`).join('\n\n');
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStop = () => {
    if (abortStreamRef.current) {
      abortStreamRef.current();
      setIsStreaming(false);
    }
  };

  if (!isOpen || !scope) return null;

  const quickQuestions = [
    '⚠️ 存在并发竞争或死锁风险吗？',
    '⚡ 性能开销如何评估？',
    '🔍 是否破坏了接口向后兼容性？',
    '🧪 建议如何编写单元测试用例？',
  ];

  return (
    <div className="fixed inset-y-0 right-0 w-[540px] max-w-[90vw] bg-[#15161D] border-l border-purple-500/20 shadow-2xl z-50 flex flex-col font-sans transition-all duration-300">
      {/* Header */}
      <div className="h-14 px-4 bg-[#121319] border-b border-white/10 flex items-center justify-between select-none shrink-0">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-gradient-to-tr from-purple-600 to-pink-600 flex items-center justify-center shadow-md shadow-purple-500/20 shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-1.5">
              <span className="font-semibold text-xs text-white truncate">
                AI 语义解释与审查
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase font-mono">
                {aiConfig.provider === 'demo' ? '⚡ Demo Engine' : aiConfig.model || 'LLM'}
              </span>
            </div>
            <span className="text-[11px] text-slate-400 truncate max-w-xs" title={scope.title}>
              {scope.title}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-1">
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
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded transition ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content (Markdown Render Area) */}
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
                ? 'bg-purple-950/40 border border-purple-500/20 text-purple-200 ml-4'
                : 'bg-[#1A1B23] border border-white/5 text-slate-200 mr-2'
            }`}
          >
            <div className="flex items-center space-x-1.5 mb-1.5 font-semibold text-[11px]">
              {msg.role === 'user' ? (
                <>
                  <User className="w-3 h-3 text-purple-400" />
                  <span className="text-purple-300">用户提问</span>
                </>
              ) : (
                <>
                  <Bot className="w-3 h-3 text-indigo-400" />
                  <span className="text-indigo-300">AI 语义分析解答</span>
                </>
              )}
            </div>
            <div
              className="prose prose-invert prose-xs max-w-none text-slate-200"
              dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) as string }}
            />
          </div>
        ))}

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

        {isStreaming && !streamContent && (
          <div className="flex flex-col items-center justify-center p-8 space-y-3 text-slate-400">
            <div className="w-8 h-8 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
            <p className="text-xs">AI 正在深度解析代码差异上下文...</p>
          </div>
        )}

        <div ref={contentEndRef} />
      </div>

      {/* Footer / Interactive Q&A Toolbar */}
      <div className="p-3 bg-[#121319] border-t border-white/10 shrink-0 space-y-2.5">
        {/* Quick Suggestion Chips */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-[11px]">
          {quickQuestions.map((q, idx) => (
            <button
              key={idx}
              onClick={() => handleStartExplanation(q)}
              disabled={isStreaming}
              className="shrink-0 bg-white/5 hover:bg-purple-600/20 hover:border-purple-500/40 border border-white/10 text-slate-300 hover:text-purple-200 px-2 py-1 rounded transition disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Input Form */}
        <form onSubmit={handleSendQuestion} className="flex items-center space-x-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={userQuestion}
              onChange={(e) => setUserQuestion(e.target.value)}
              disabled={isStreaming}
              placeholder="针对此差异向 AI 提问 (例如: 解释这里的加锁机制)..."
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
