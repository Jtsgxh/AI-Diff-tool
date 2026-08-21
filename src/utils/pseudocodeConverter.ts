/**
 * AI-Driven Diff Pseudocode Line Parser (AI 大模型 Diff 伪代码解析器)
 * Parses streaming AI responses and maps them strictly to deleted (-) & added (+) diff lines.
 * No mechanical heuristic or regex fallback is used.
 */

export function parseAiPseudocodeLines(aiText: string): { dels: string[]; adds: string[] } {
  const lines = aiText.split('\n');
  const dels: string[] = [];
  const adds: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('```')) continue;

    if (trimmed.startsWith('-')) {
      const clean = trimmed.replace(/^-[\s]*/, '').replace(/^\/\/\s*/, '').trim();
      if (clean) dels.push(`// ${clean}`);
    } else if (trimmed.startsWith('+')) {
      const clean = trimmed.replace(/^\+[\s]*/, '').replace(/^\/\/\s*/, '').trim();
      if (clean) adds.push(`// ${clean}`);
    }
  }

  return { dels, adds };
}
