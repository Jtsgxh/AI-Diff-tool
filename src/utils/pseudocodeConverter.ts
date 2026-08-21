/**
 * AI-Driven Diff Pseudocode Line Parser (AI 大模型 Diff 伪代码解析器)
 * Parses streaming AI responses and maps them strictly to deleted (-) & added (+) diff lines.
 */

export function parseAiPseudocodeLines(aiText: string): { dels: string[]; adds: string[] } {
  const lines = aiText.split('\n');
  const dels: string[] = [];
  const adds: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('```')) continue;

    // Match `- // ...`, `- ...`, `[-] ...`, `🔴 ...`, `[删除] ...`
    if (/^(-\s*|\[-\]\s*|🔴\s*|\[删除\]\s*)/.test(trimmed)) {
      const clean = trimmed
        .replace(/^(-\s*|\[-\]\s*|🔴\s*|\[删除\]\s*)/, '')
        .replace(/^\/\/\s*/, '')
        .trim();
      if (clean) dels.push(`// ${clean}`);
    }
    // Match `+ // ...`, `+ ...`, `[+] ...`, `🟢 ...`, `[新增] ...`
    else if (/^(\+\s*|\[\+\]\s*|🟢\s*|\[新增\]\s*)/.test(trimmed)) {
      const clean = trimmed
        .replace(/^(\+\s*|\[\+\]\s*|🟢\s*|\[新增\]\s*)/, '')
        .replace(/^\/\/\s*/, '')
        .trim();
      if (clean) adds.push(`// ${clean}`);
    }
  }

  return { dels, adds };
}
