import React, { useCallback, useState } from 'react';
import { Send } from 'lucide-react';

interface FollowUpInputProps {
  disabled: boolean;
  onSend: (text: string) => void;
}

/**
 * The composer keeps its draft in local state so typing never re-renders the
 * report above it — the reason this lives in its own memoized component.
 */
export const FollowUpInput = React.memo<FollowUpInputProps>(({ disabled, onSend }) => {
  const [text, setText] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = text.trim();
      if (!trimmed || disabled) return;
      onSend(trimmed);
      setText('');
    },
    [disabled, onSend, text]
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 border-t border-white/10 bg-[#171A1F] flex items-center space-x-2 shrink-0 select-text"
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        placeholder={
          disabled
            ? 'AI 正在自主探查与生成中...'
            : '追问 AI：例如“这个方法有潜在并发问题吗？”或“在哪些地方被调用了？”'
        }
        className="flex-1 bg-[var(--surface-raised)] text-xs text-slate-200 px-3 py-2 rounded-lg border border-white/5 focus:outline-none focus:border-blue-500/50 transition placeholder:text-slate-500 disabled:opacity-50 font-sans"
      />

      <button
        type="submit"
        disabled={!text.trim() || disabled}
        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white p-2 rounded-lg transition shrink-0"
      >
        <Send className="w-3.5 h-3.5" />
      </button>
    </form>
  );
});

FollowUpInput.displayName = 'FollowUpInput';
