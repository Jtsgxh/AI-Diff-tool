import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { API_BASE } from '../services/api';
import type { RepositoryConversationLane } from '../types';

/** 清除当前仓库的后台对话，保留界面中的报告和本地结果缓存。 */
export function ClearRepositoryConversation({ repoPath, lane = 'review', disabled = false, compact = false }: {
  repoPath: string; lane?: RepositoryConversationLane; disabled?: boolean; compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const label = lane === 'learn' ? '清除学习对话' : '清除仓库对话';
  const conversationName = lane === 'learn' ? '学习对话' : '仓库对话';

  /** 后台负责取消旧请求并清空历史；只有成功响应才显示清除完成。 */
  const clear = async () => {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${API_BASE}/ai/conversation/clear`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoPath, lane }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '清除失败');
      setMessage(`${conversationName}已清除，下次分析将开始新对话。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '清除失败');
    } finally { setBusy(false); }
  };

  return <div className="relative">
    <button type="button" onClick={clear} disabled={disabled || busy}
      aria-label={busy ? `正在${label}` : label}
      className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-[var(--surface-hover)] disabled:opacity-50"
      title={`清除当前仓库的${lane === 'learn' ? '学习' : '审查'}对话，并取消这条对话进行中及排队的分析；另一条对话和已生成报告仍保留`}>
      <Trash2 className="h-3.5 w-3.5" /><span className={compact ? 'sr-only' : undefined}>{busy ? '正在清除…' : label}</span>
    </button>
    {message && <div role="status" className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-800 shadow-md">
      {message}<button type="button" className="ml-2 underline" onClick={() => setMessage('')}>关闭</button>
    </div>}
  </div>;
}
