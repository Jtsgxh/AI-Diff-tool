import { inferContextWindowTokens, totalContextChars } from '../../shared/types';
import type { AIProviderConfig } from '../types';

const MIN_DRAFT_CHARS = 1_000;
const MAX_DRAFT_CHARS = 50_000;
const DRAFT_CONTEXT_FRACTION = 0.05;

export function appendReviewContinuation(base: string, continuation: string): string {
  if (!continuation) return base;
  if (!base) return continuation;
  const separator = base.endsWith('\n') || continuation.startsWith('\n') ? '' : '\n\n';
  return `${base}${separator}${continuation}`;
}

export function buildReviewContinuationPrompt(
  report: string,
  config: AIProviderConfig
): string {
  const contextChars = totalContextChars(inferContextWindowTokens(config));
  const draftLimit = Math.min(
    MAX_DRAFT_CHARS,
    Math.max(MIN_DRAFT_CHARS, Math.round(contextChars * DRAFT_CONTEXT_FRACTION))
  );
  const trimmed = report.trimEnd();
  const draft = trimmed.length <= draftLimit
    ? trimmed
    : `…（仅保留中断前最后 ${draftLimit.toLocaleString()} 个字符）…\n${trimmed.slice(-draftLimit)}`;

  return `上一次代码审查因连接或超时异常中断。下面是中断前已经输出的报告内容：

【中断前报告】
${draft}

【继续要求】
从上面报告停止的位置继续完成同一份审查报告。只输出尚未完成的后续正文，不要重复已有段落，不要重新输出报告标题，也不要解释这是一次续写。必要时可以重新调用代码工具核实尚未完成的部分。`;
}
