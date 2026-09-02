import React from 'react';
import { Bot, Brain, FileText, FolderSearch, Search, Terminal, User } from 'lucide-react';
import type { AgentToolEvent } from '../../types';
import { formatReasoningForDisplay } from '../../utils/reasoningDisplay';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import type { ChatMessage } from './types';

/** Picks the icon that matches a tool name (read / search / find). */
export function toolIcon(name?: string) {
  if (name?.includes('read')) return <FileText className="w-3 h-3 text-sky-700 shrink-0" />;
  if (name?.includes('search')) return <Search className="w-3 h-3 text-emerald-700 shrink-0" />;
  return <FolderSearch className="w-3 h-3 text-amber-700 shrink-0" />;
}

const ToolEventList: React.FC<{ events: AgentToolEvent[] }> = ({ events }) => (
  <div className="p-2 space-y-1.5 bg-[#F7F7F5] text-[11px] font-mono border-t border-black/5 max-h-48 overflow-y-auto">
    {events.map((evt, idx) => (
      <div key={idx} className="p-1.5 rounded bg-black/[0.025] border border-black/5">
        <div className="flex items-center space-x-1.5 text-zinc-700 font-semibold">
          {toolIcon(evt.name)}
          <span>{evt.name}</span>
          <span className="text-zinc-600 font-normal text-[10px] truncate">
            {evt.args ? JSON.stringify(evt.args) : ''}
          </span>
        </div>
        {evt.output && (
          <pre className="mt-1 p-1.5 rounded bg-zinc-100 text-zinc-700 text-[10px] whitespace-pre-wrap max-h-32 overflow-x-auto">
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
        <div className="w-6 h-6 rounded-full bg-zinc-900 border border-zinc-300 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="w-3.5 h-3.5 text-white" />
        </div>
      )}

      <div
        className={`p-3 rounded-xl text-xs max-w-[85%] leading-relaxed select-text ${
          isAssistant
            ? 'bg-[#FFFFFF] border border-black/5 text-zinc-900'
            : 'bg-zinc-900 text-white shadow-sm'
        }`}
      >
        {isAssistant && msg.reasoning && (
          <div className="mb-2.5 rounded-lg border border-zinc-300 bg-[#FFFFFF] overflow-hidden text-xs">
            <details className="group">
              <summary className="flex items-center justify-between px-3 py-1.5 bg-zinc-100 cursor-pointer select-none text-zinc-700 hover:text-zinc-800 hover:bg-zinc-200 transition">
                <div className="flex items-center space-x-1.5 font-medium text-[11px]">
                  <Brain className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                  <span>
                    思考过程 ({reasoningDisplay.text.length} 字符
                    {reasoningDisplay.hiddenExplorationBlocks > 0
                      ? `，已隐藏 ${reasoningDisplay.hiddenExplorationBlocks} 段源码载荷`
                      : ''}
                    )
                  </span>
                </div>
                <span className="text-[10px] text-zinc-600 group-open:hidden">点击展开</span>
              </summary>
              <div className="p-2.5 max-h-48 overflow-y-auto bg-[#F7F7F5] text-[11px] font-mono text-zinc-700 whitespace-pre-wrap border-t border-black/5 leading-relaxed select-text">
                {reasoningDisplay.text}
              </div>
            </details>
          </div>
        )}

        {isAssistant && msg.toolEvents && msg.toolEvents.length > 0 && (
          <div className="mb-2.5 rounded-lg border border-zinc-300 bg-[#FFFFFF] overflow-hidden text-xs">
            <details className="group">
              <summary className="flex items-center justify-between px-3 py-1.5 bg-zinc-100 cursor-pointer select-none text-zinc-700 hover:text-zinc-800 hover:bg-zinc-200 transition">
                <div className="flex items-center space-x-1.5 font-medium text-[11px]">
                  <Terminal className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                  <span>代码库探查 ({msg.toolEvents.length} 次动作)</span>
                </div>
                <span className="text-[10px] text-zinc-600 group-open:hidden">点击展开</span>
              </summary>
              <ToolEventList events={msg.toolEvents} />
            </details>
          </div>
        )}

        <MarkdownRenderer content={msg.content} />
      </div>

      {!isAssistant && (
        <div className="w-6 h-6 rounded-full bg-zinc-100 border border-black/10 flex items-center justify-center shrink-0 mt-0.5">
          <User className="w-3.5 h-3.5 text-zinc-700" />
        </div>
      )}
    </div>
  );
});

ChatMessageItem.displayName = 'ChatMessageItem';
