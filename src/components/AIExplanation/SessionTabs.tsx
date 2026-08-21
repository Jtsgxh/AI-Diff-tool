import React from 'react';
import { Brain, CheckCircle2, Database, X, Zap } from 'lucide-react';
import type { ReviewSession } from './types';

interface SessionTabsProps {
  sessions: ReviewSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

/** Tab strip across the top of the drawer, one tab per open review. */
export const SessionTabs = React.memo<SessionTabsProps>(
  ({ sessions, activeSessionId, onSelect, onClose }) => {
    if (sessions.length === 0) return null;

    return (
      <div className="flex items-center space-x-1 px-3 py-1.5 overflow-x-auto scrollbar-none bg-[#111218]">
        {sessions.map((sess) => {
          const isActive = sess.id === activeSessionId;
          const batch = sess.scope.batchInfo;
          const tooltip =
            batch?.messages && batch.messages.length > 0
              ? `【批量审查包含的 ${batch.count} 个提交】:\n${batch.messages.join('\n')}`
              : sess.title;

          return (
            <div
              key={sess.id}
              onClick={() => onSelect(sess.id)}
              title={tooltip}
              className={`flex items-center space-x-2 px-2.5 py-1 rounded-lg text-xs cursor-pointer select-none transition shrink-0 group border ${
                isActive
                  ? 'bg-purple-600/25 border-purple-500/40 text-white font-medium shadow-sm'
                  : 'bg-white/[0.03] border-transparent text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
              }`}
            >
              {sess.engineMode === 'agent' ? (
                <Brain className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              ) : (
                <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}

              <span className="truncate max-w-[130px] font-mono text-[11px]">{sess.shortTitle}</span>

              {sess.isStreaming ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
              ) : sess.isCached ? (
                <span title="来自本地缓存">
                  <Database className="w-3 h-3 text-sky-400 shrink-0" />
                </span>
              ) : (
                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(sess.id);
                }}
                className="opacity-40 group-hover:opacity-100 hover:text-rose-400 p-0.5 rounded transition"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>
    );
  }
);

SessionTabs.displayName = 'SessionTabs';
