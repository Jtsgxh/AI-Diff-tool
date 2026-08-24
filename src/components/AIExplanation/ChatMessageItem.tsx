import React from 'react';
import { Bot, Brain, FileText, FolderSearch, Search, Terminal, User } from 'lucide-react';
import type { AgentToolEvent } from '../../types';
import { formatReasoningForDisplay } from '../../utils/reasoningDisplay';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import type { ChatMessage } from './types';

/** Picks the icon that matches a tool name (read / search / find). */
export function toolIcon(name?: string) {
  if (name?.includes('read')) return <FileText className="w-3 h-3 text-sky-400 shrink-0" />;
  if (name?.includes('search')) return <Search className="w-3 h-3 text-emerald-400 shrink-0" />;
  return <FolderSearch className="w-3 h-3 text-amber-400 shrink-0" />;
}

const ToolEventList: React.FC<{ events: AgentToolEvent[] }> = ({ events }) => (
  <div className="p-2 space-y-1.5 bg-[#0E0D17] text-[11px] font-mono border-t border-white/5 max-h-48 overflow-y-auto">
    {events.map((evt, idx) => (
      <div key={idx} className="p-1.5 rounded bg-white/[0.03] border border-white/5">
        <div className="flex items-center space-x-1.5 text-purple-300 font-semibold">
          {toolIcon(evt.name)}
          <span>{evt.name}</span>
          <span className="text-slate-400 font-normal text-[10px] truncate">
            {evt.args ? JSON.stringify(evt.args) : ''}
          </span>
        </div>
        {evt.output && (
          <pre className="mt-1 p-1.5 rounded bg-black/60 text-slate-300 text-[10px] whitespace-pre-wrap max-h-32 overflow-x-auto">
            {evt.output}
          </pre>
        )}
      </div>
    ))}
  </div>
);

/**
 * One bubble in the follow-up conversation. Memoized so an in-flight answer
 * does not re-render the entire finished history on every flush.
 */
export const ChatMessageItem = React.memo<{ msg: ChatMessage }>(({ msg }) => {
  const isAssistant = msg.role === 'assistant';
  const reasoningDisplay = formatReasoningForDisplay(msg.reasoning || '');

  return (
    <div className={`flex items-start space-x-2.5 ${isAssistant ? 'justify-start' : 'justify-end'}`}>
      {isAssistant && (
        <div className="w-6 h-6 rounded-full bg-purple-600/30 border border-purple-500/40 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="w-3.5 h-3.5 text-purple-300" />
        </div>
      )}

      <div
        className={`p-3 rounded-2xl text-xs max-w-[85%] leading-relaxed select-text ${
          isAssistant
            ? 'bg-[#181924] border border-white/5 text-slate-200'
            : 'bg-purple-600 text-white shadow-md'
        }`}
      >
        {isAssistant && msg.reasoning && (
          <div className="mb-2.5 rounded-lg border border-purple-500/30 bg-[#12111E] overflow-hidden text-xs">
            <details className="group">
              <summary className="flex items-center justify-between px-3 py-1.5 bg-purple-950/40 cursor-pointer select-none text-purple-300 hover:text-purple-200 hover:bg-purple-900/40 transition">
                <div className="flex items-center space-x-1.5 font-medium text-[11px]">
                  <Brain className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span>
                    思考过程 ({reasoningDisplay.text.length} 字符
                    {reasoningDisplay.hiddenExplorationBlocks > 0
                      ? `，已隐藏 ${reasoningDisplay.hiddenExplorationBlocks} 段源码载荷`
                      : ''}
                    )
                  </span>
                </div>
                <span className="text-[10px] text-purple-400 group-open:hidden">点击展开</span>
              </summary>
              <div className="p-2.5 max-h-48 overflow-y-auto bg-[#0E0D17] text-[11px] font-mono text-slate-300 whitespace-pre-wrap border-t border-white/5 leading-relaxed select-text">
                {reasoningDisplay.text}
              </div>
            </details>
          </div>
        )}

        {isAssistant && msg.toolEvents && msg.toolEvents.length > 0 && (
          <div className="mb-2.5 rounded-lg border border-purple-500/30 bg-[#12111E] overflow-hidden text-xs">
            <details className="group">
              <summary className="flex items-center justify-between px-3 py-1.5 bg-purple-950/40 cursor-pointer select-none text-purple-300 hover:text-purple-200 hover:bg-purple-900/40 transition">
                <div className="flex items-center space-x-1.5 font-medium text-[11px]">
                  <Terminal className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span>代码库探查 ({msg.toolEvents.length} 次动作)</span>
                </div>
                <span className="text-[10px] text-purple-400 group-open:hidden">点击展开</span>
              </summary>
              <ToolEventList events={msg.toolEvents} />
            </details>
          </div>
        )}

        <MarkdownRenderer content={msg.content} />
      </div>

      {!isAssistant && (
        <div className="w-6 h-6 rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
          <User className="w-3.5 h-3.5 text-slate-300" />
        </div>
      )}
    </div>
  );
});

ChatMessageItem.displayName = 'ChatMessageItem';
