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
      className="p-3 border-t border-[var(--border-subtle)] bg-[var(--surface-canvas)] flex items-center space-x-2 shrink-0 select-text"
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
        className="flex-1 min-w-0 bg-[var(--surface-panel)] text-xs text-zinc-900 px-3 py-2 rounded-md border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--accent)] transition placeholder:text-zinc-600 disabled:opacity-50 font-sans"
      />

      <button
        type="submit"
        aria-label="发送追问"
        disabled={!text.trim() || disabled}
        className="bg-[var(--accent)] hover:bg-zinc-700 disabled:opacity-40 text-white p-2 rounded-md transition shrink-0"
      >
        <Send className="w-3.5 h-3.5" />
      </button>
    </form>
  );
});

FollowUpInput.displayName = 'FollowUpInput';
