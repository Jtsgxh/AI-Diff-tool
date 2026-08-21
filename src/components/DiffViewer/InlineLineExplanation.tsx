import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import {
  Sparkles,
  X,
  Send,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  StopCircle,
  MessageSquare,
  Bot,
} from 'lucide-react';
import { AIProviderConfig } from '../../types';
import { streamExplainDiff } from '../../services/api';
import { DiffLine } from '../../utils/diffParser';

interface InlineLineExplanationProps {
  line: DiffLine;
  filePath?: string;
  hunkDiff: string;
  aiConfig: AIProviderConfig;
  onClose: () => void;
}

export const InlineLineExplanation: React.FC<InlineLineExplanationProps> = ({
  line,
  filePath,
  hunkDiff,
  aiConfig,
  onClose,
}) => {
  const [content, setContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);

  const abortRef = useRef<(() => void) | null>(null);

  const startExplanation = async (userPrompt?: string) => {
    if (abortRef.current) abortRef.current();

    setError(null);
    setIsStreaming(true);

    if (!userPrompt) {
      setContent('');
      setChatHistory([]);
    } else {
      setChatHistory((prev) => [...prev, { role: 'user', text: userPrompt }]);
      setContent('');
    }

    try {
      const cancel = await streamExplainDiff({
        scopeType: 'line',
        targetLine: {
          lineNumber: line.newLineNumber || line.oldLineNumber,
          content: line.content,
          type: line.type === 'add' ? 'add' : line.type === 'delete' ? 'delete' : 'normal',
        },
        diff: hunkDiff,
        filePath,
        userPrompt,
        config: aiConfig,
        onChunk: (chunk) => {
          setContent((prev) => prev + chunk);
        },
        onComplete: () => {
          setIsStreaming(false);
          if (userPrompt) {
            setChatHistory((prev) => [...prev, { role: 'assistant', text: content }]);
            setContent('');
          }
        },
        onError: (err) => {
          setIsStreaming(false);
          setError(err.message);
        },
      });

      abortRef.current = cancel;
    } catch (err: any) {
      setIsStreaming(false);
      setError(err.message);
    }
  };

  useEffect(() => {
    startExplanation();
    return () => {
      if (abortRef.current) abortRef.current();
    };
  }, [line]);

  const handleSendQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || isStreaming) return;
    const q = question.trim();
    setQuestion('');
    startExplanation(q);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lineNumber = line.newLineNumber || line.oldLineNumber;

  return (
    <div className="my-2 mx-3 bg-[#161720] border border-purple-500/40 rounded-xl overflow-hidden shadow-xl animate-in fade-in duration-150 select-text">
      {/* Header */}
      <div className="px-3.5 py-2 bg-gradient-to-r from-purple-950/60 to-indigo-950/40 border-b border-purple-500/20 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-5 h-5 rounded-md bg-purple-500/30 flex items-center justify-center text-purple-300">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="flex items-center space-x-1.5 font-mono text-xs">
            <span className="font-semibold text-purple-200">
              行级 AI 语义解释
            </span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
              Line {lineNumber}
            </span>
            <span className={`text-[10px] px-1 py-0.2 rounded font-bold ${
              line.type === 'add'
                ? 'bg-emerald-500/20 text-emerald-400'
                : line.type === 'delete'
                ? 'bg-rose-500/20 text-rose-400'
                : 'bg-slate-700 text-slate-300'
            }`}>
              {line.type === 'add' ? '+ 新增' : line.type === 'delete' ? '- 删除' : '修改'}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={handleCopy}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded transition"
            title="复制解释"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => startExplanation()}
            disabled={isStreaming}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded transition disabled:opacity-50"
            title="重新分析"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isStreaming ? 'animate-spin text-purple-400' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded transition"
            title="收起解释"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Target Line Display Snippet */}
      <div className="px-3.5 py-1.5 bg-[#121318] border-b border-white/5 font-mono text-[11px] flex items-center space-x-2 text-slate-300 overflow-x-auto">
        <span className="text-slate-500 select-none">聚焦代码:</span>
        <code className={`px-1 rounded ${
          line.type === 'add'
            ? 'text-emerald-300 bg-emerald-950/40'
            : line.type === 'delete'
            ? 'text-rose-300 bg-rose-950/40'
            : 'text-slate-200'
        }`}>
          {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '} {line.content}
        </code>
      </div>

      {/* Markdown Content */}
      <div className="p-3.5 text-xs text-slate-200 leading-relaxed font-sans space-y-2.5 max-h-80 overflow-y-auto">
        {error && (
          <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded text-rose-300 text-xs flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {chatHistory.map((m, idx) => (
          <div
            key={idx}
            className={`p-2.5 rounded-lg text-xs ${
              m.role === 'user'
                ? 'bg-purple-950/40 border border-purple-500/30 text-purple-200 ml-4'
                : 'bg-[#1D1F2A] border border-white/5 text-slate-200 mr-2'
            }`}
          >
            <div className="font-semibold text-[10px] text-slate-400 mb-1">
              {m.role === 'user' ? '提问:' : '解答:'}
            </div>
            <div
              className="prose prose-invert prose-xs max-w-none"
              dangerouslySetInnerHTML={{ __html: marked.parse(m.text) as string }}
            />
          </div>
        ))}

        {content && (
          <div className="prose prose-invert prose-xs max-w-none font-sans
            [&_h3]:text-xs [&_h3]:font-bold [&_h3]:text-purple-300 [&_h3]:mt-2 [&_h3]:mb-1
            [&_p]:my-1 [&_p]:text-slate-300
            [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1
            [&_li]:my-0.5 [&_li]:text-slate-300
            [&_code]:bg-[#121319] [&_code]:px-1 [&_code]:py-0.2 [&_code]:rounded [&_code]:text-purple-300 [&_code]:font-mono">
            <div dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }} />
            {isStreaming && (
              <span className="inline-block w-1.5 h-3.5 bg-purple-400 animate-pulse ml-1 align-middle" />
            )}
          </div>
        )}

        {isStreaming && !content && (
          <div className="flex items-center space-x-2 text-slate-400 text-xs py-2">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
            <span>AI 正在分析此行改动的上下文与影响...</span>
          </div>
        )}
      </div>

      {/* Inline Q&A Input */}
      <form
        onSubmit={handleSendQuestion}
        className="p-2 bg-[#121318] border-t border-white/5 flex items-center space-x-2"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={isStreaming}
          placeholder={`针对第 ${lineNumber} 行改动提问 (例如: 为什么要删除该命名空间?)...`}
          className="flex-1 bg-[#1A1B24] text-xs text-slate-200 px-3 py-1.5 rounded-lg border border-white/10 focus:outline-none focus:border-purple-500/50 placeholder:text-slate-500"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={() => abortRef.current && abortRef.current()}
            className="p-1.5 text-rose-400 hover:text-rose-300"
            title="停止"
          >
            <StopCircle className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!question.trim()}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-30 text-white rounded-lg text-xs font-medium transition flex items-center space-x-1"
          >
            <Send className="w-3 h-3" />
            <span>提问</span>
          </button>
        )}
      </form>
    </div>
  );
};
