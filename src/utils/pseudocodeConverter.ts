/**
 * Maps a streamed model response onto deleted (-) and added (+) diff lines.
 *
 * Models rarely follow the prompt perfectly: they wrap a ```diff fence, number
 * the lines, or label 删除/新增 instead of using +/- prefixes. Empty output
 * used to look like "the feature is broken" because the viewer fell back to
 * the original code with no error.
 */

const DEL_PREFIX = /^(?:[-−－]|\[-\]|🔴|\[删除\])\s*/;
const ADD_PREFIX = /^(?:[+＋]|\[\+\]|🟢|\[新增\])\s*/;
const NUMBERING = /^\d+[\.\)、]\s+/;
const FENCE = /```(?:diff|patch)?\s*\n([\s\S]*?)```/i;
const LABELED_DEL = /^(?:删除|旧逻辑|改动前|before)\s*[:：]\s*(.+)$/i;
const LABELED_ADD = /^(?:新增|新逻辑|改动后|after)\s*[:：]\s*(.+)$/i;

export interface ParsedPseudocode {
  dels: string[];
  adds: string[];
}

export function isParsedPseudocodeUseful(parsed: ParsedPseudocode): boolean {
  return parsed.dels.length > 0 || parsed.adds.length > 0;
}

export function parseAiPseudocodeLines(aiText: string): ParsedPseudocode {
  const body = extractDiffBody(aiText);
  const dels: string[] = [];
  const adds: string[] = [];

  for (const raw of body.split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('```') || line === '---' || line === '+++') continue;

    // "1. - foo" / "- - foo" after a markdown list wrapper.
    line = line.replace(NUMBERING, '');

    if (DEL_PREFIX.test(line)) {
      const clean = stripCommentMarks(line.replace(DEL_PREFIX, ''));
      if (clean) dels.push(`// ${clean}`);
      continue;
    }
    if (ADD_PREFIX.test(line)) {
      const clean = stripCommentMarks(line.replace(ADD_PREFIX, ''));
      if (clean) adds.push(`// ${clean}`);
      continue;
    }

    const labeledDel = line.match(LABELED_DEL);
    if (labeledDel?.[1]) {
      dels.push(`// ${stripCommentMarks(labeledDel[1])}`);
      continue;
    }
    const labeledAdd = line.match(LABELED_ADD);
    if (labeledAdd?.[1]) {
      adds.push(`// ${stripCommentMarks(labeledAdd[1])}`);
    }
  }

  return { dels, adds };
}

/** Prefer the first fenced diff block when the model wraps its answer. */
function extractDiffBody(text: string): string {
  const fence = text.match(FENCE);
  return fence?.[1] ?? text;
}

function stripCommentMarks(text: string): string {
  return text.replace(/^\/\/\s*/, '').replace(/^#\s*/, '').trim();
}
