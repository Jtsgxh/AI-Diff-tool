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
        icon={<Terminal className="w-3.5 h-3.5 text-zinc-700" />}
        title="Codex 自主代码库探查轨迹"
        badge={
          <span className="px-1.5 py-0.2 rounded bg-zinc-100 text-zinc-800 font-mono text-[10px]">
            {events.length} 次动作
          </span>
        }
        isOpen={isOpen}
        onToggle={onToggle}
        showToggleLabel={false}
        tone={{
          shell: 'border border-zinc-300 bg-zinc-100 shadow-inner',
          header: 'bg-zinc-100 hover:bg-zinc-200',
          body: 'p-2 space-y-1.5 bg-[#EFEFEC]/60 max-h-56 overflow-y-auto text-[11px] font-mono',
          text: 'text-zinc-800',
        }}
      >
        {events.map((evt, idx) => {
          const isExpanded = expandedIndex === idx;
          return (
            <div
              key={`tool-${idx}`}
              className="p-1.5 rounded bg-black/[0.05] border border-black/10 hover:border-zinc-400 transition"
            >
              <div
                onClick={() => setExpandedIndex(isExpanded ? null : idx)}
                className="flex items-center justify-between cursor-pointer text-zinc-800 hover:text-zinc-950"
              >
                <div className="flex items-center space-x-1.5 truncate">
                  {toolIcon(evt.name)}
                  <span className="font-bold text-zinc-800">{evt.name || '工具调用'}</span>
                  <span className="text-zinc-700 truncate text-[10px]">
                    {evt.args ? JSON.stringify(evt.args) : evt.summary || ''}
                  </span>
                </div>

                {evt.output && (
                  <span className="text-[10px] text-zinc-700 hover:underline shrink-0 ml-1">
                    {isExpanded ? '收起' : '详情'}
                  </span>
                )}
              </div>

              {isExpanded && evt.output && (
                <pre className="mt-1.5 p-2 rounded bg-zinc-100 text-zinc-800 text-[10px] overflow-x-auto whitespace-pre-wrap max-h-40 border border-black/10">
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
