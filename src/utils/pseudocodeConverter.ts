/**
 * Maps a streamed model response onto deleted (-) and added (+) diff lines.
 *
 * The viewer replaces each changed line in order. If we keep only the first
 * fenced block, or drop blank `-`/`+` rows, later hunk lines stay as original
 * code and it looks like "only a sliver of the block was translated".
 */

const DEL_PREFIX = /^(?:[-−－]|\[-\]|🔴|\[删除\])\s*/;
const ADD_PREFIX = /^(?:[+＋]|\[\+\]|🟢|\[新增\])\s*/;
const NUMBERING = /^\d+[\.\)、]\s+/;
const FENCE_LANG = /^(?:diff|patch)$/i;

export interface ParsedPseudocode {
  dels: string[];
  adds: string[];
}

export function isParsedPseudocodeUseful(parsed: ParsedPseudocode): boolean {
  return parsed.dels.length > 0 || parsed.adds.length > 0;
}

/** True when every changed line in the hunk has a corresponding AI line. */
export function coversHunk(
  parsed: ParsedPseudocode,
  deletions: number,
  additions: number
): boolean {
  const delsOk = deletions === 0 || parsed.dels.length >= deletions;
  const addsOk = additions === 0 || parsed.adds.length >= additions;
  return delsOk && addsOk;
}

export function parseAiPseudocodeLines(aiText: string): ParsedPseudocode {
  const whole = parsePrefixedLines(aiText);
  // If the model wrapped several fences, also score each one and keep the
  // richest parse — first-fence-only used to throw away the rest of the hunk.
  let best = whole;
  for (const body of extractAllFences(aiText)) {
    const candidate = parsePrefixedLines(body);
    if (countLines(candidate) > countLines(best)) best = candidate;
  }
  return best;
}

function countLines(parsed: ParsedPseudocode): number {
  return parsed.dels.length + parsed.adds.length;
}

function parsePrefixedLines(text: string): ParsedPseudocode {
  const dels: string[] = [];
  const adds: string[] = [];

  for (const raw of text.split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('```') || line === '---' || line === '+++' || FENCE_LANG.test(line)) {
      continue;
    }

    line = line.replace(NUMBERING, '');

    if (DEL_PREFIX.test(line)) {
      dels.push(toPseudoComment(line.replace(DEL_PREFIX, '')));
      continue;
    }
    if (ADD_PREFIX.test(line)) {
      adds.push(toPseudoComment(line.replace(ADD_PREFIX, '')));
    }
  }

  return { dels, adds };
}

function extractAllFences(text: string): string[] {
  const bodies: string[] = [];
  const re = /```(?:diff|patch)?\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[1]) bodies.push(match[1]);
  }
  return bodies;
}

function toPseudoComment(rest: string): string {
  const clean = rest.replace(/^\d+[\.\)、:：]\s*/, '').replace(/^\/\/\s*/, '').replace(/^#\s*/, '').trim();
  // Keep an empty slot so a blank `-`/`+` row does not shift later lines.
  return clean ? `// ${clean}` : '// …';
}
