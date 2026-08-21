import React, { useState } from 'react';
import { Terminal } from 'lucide-react';
import type { AgentToolEvent } from '../../types';
import { Accordion } from './Accordion';
import { toolIcon } from './ChatMessageItem';

interface ExplorationTrailProps {
  events: AgentToolEvent[];
  isOpen: boolean;
  onToggle: () => void;
}

/** The agent's tool-call log for the initial review, with expandable outputs. */
export const ExplorationTrail = React.memo<ExplorationTrailProps>(
  ({ events, isOpen, onToggle }) => {
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

    return (
      <Accordion
        icon={<Terminal className="w-3.5 h-3.5 text-purple-400" />}
        title="Codex 自主代码库探查轨迹"
        badge={
          <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono text-[10px]">
            {events.length} 次动作
          </span>
        }
        isOpen={isOpen}
        onToggle={onToggle}
        showToggleLabel={false}
        tone={{
          shell: 'border border-purple-500/20 bg-purple-950/20 shadow-inner',
          header: 'bg-purple-900/30 hover:bg-purple-900/40',
          body: 'p-2 space-y-1.5 bg-[#141320]/60 max-h-56 overflow-y-auto text-[11px] font-mono',
          text: 'text-purple-200',
        }}
      >
        {events.map((evt, idx) => {
          const isExpanded = expandedIndex === idx;
          return (
            <div
              key={`tool-${idx}`}
              className="p-1.5 rounded bg-white/[0.03] border border-white/5 hover:border-purple-500/30 transition"
            >
              <div
                onClick={() => setExpandedIndex(isExpanded ? null : idx)}
                className="flex items-center justify-between cursor-pointer text-slate-300 hover:text-white"
              >
                <div className="flex items-center space-x-1.5 truncate">
                  {toolIcon(evt.name)}
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
      </Accordion>
    );
  }
);

ExplorationTrail.displayName = 'ExplorationTrail';
