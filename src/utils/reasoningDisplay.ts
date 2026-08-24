export interface ReasoningDisplay {
  text: string;
  hiddenExplorationBlocks: number;
}

const EXPLORATION_BLOCK_MARKER = /【探查结果 #\d+\s*\(/g;

/**
 * Synthesis models sometimes copy the raw exploration bundle into their
 * reasoning channel. That source payload already has a dedicated tool trail;
 * rendering it again turns the thinking panel into an unreadable code dump.
 */
export function formatReasoningForDisplay(reasoning: string): ReasoningDisplay {
  const matches = reasoning.match(EXPLORATION_BLOCK_MARKER);
  if (!matches?.length) {
    return { text: reasoning, hiddenExplorationBlocks: 0 };
  }

  const firstBlock = reasoning.search(EXPLORATION_BLOCK_MARKER);
  const usefulPrefix = firstBlock > 0 ? reasoning.slice(0, firstBlock).trimEnd() : '';
  const notice = `〔已隐藏模型复述的 ${matches.length} 段原始工具结果；源码证据请在“Codex 自主代码库探查轨迹”中按需展开。〕`;
  return {
    text: usefulPrefix ? `${usefulPrefix}\n\n${notice}` : notice,
    hiddenExplorationBlocks: matches.length,
  };
}
