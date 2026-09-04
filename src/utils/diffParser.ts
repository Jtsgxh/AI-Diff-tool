export interface DiffLine {
  type: 'add' | 'delete' | 'normal' | 'hunk-header';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface SplitDiffRow {
  left?: {
    lineNumber: number;
    content: string;
    type: 'delete' | 'normal';
  };
  right?: {
    lineNumber: number;
    content: string;
    type: 'add' | 'normal';
  };
}

export interface DiffHunk {
  id: string;
  index: number;
  header: string;
  lines: DiffLine[];
  splitRows: SplitDiffRow[];
  oldStart: number;
  newStart: number;
  additions: number;
  deletions: number;
  /**
   * The hunk re-serialized as a unified diff. Precomputed here because the
   * viewer needs it for every hunk on every render (AI payloads, cache keys);
   * rebuilding it per render turned an O(lines) join into a per-frame cost.
   */
  text: string;
}

export interface ParsedFileDiff {
  header: string;
  hunks: DiffHunk[];
}

export type ExpandedDiffBlock =
  | { type: 'context'; hunk: DiffHunk }
  | { type: 'change'; hunk: DiffHunk };

const FULL_CONTEXT_CHUNK_LINES = 250;

export function parseRawDiff(rawDiff: string): ParsedFileDiff {
  const lines = rawDiff.split('\n');
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  const headerLines: string[] = [];

  let oldLine = 0;
  let newLine = 0;
  let hunkCount = 0;

  const finalizeHunk = (hunk: DiffHunk) => {
    hunk.splitRows = computeSplitRows(hunk.lines);

    let adds = 0;
    let dels = 0;
    const serialized: string[] = [];

    for (const l of hunk.lines) {
      if (l.type === 'add') {
        adds++;
        serialized.push(`+${l.content}`);
      } else if (l.type === 'delete') {
        dels++;
        serialized.push(`-${l.content}`);
      } else {
        // Context lines and the `@@` header both render with a leading space,
        // matching the unified-diff text the AI endpoints have always received.
        serialized.push(` ${l.content}`);
      }
    }

    hunk.additions = adds;
    hunk.deletions = dels;
    hunk.text = serialized.join('\n');
    hunks.push(hunk);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('@@')) {
      if (currentHunk) {
        finalizeHunk(currentHunk);
      }

      hunkCount++;
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      let oldStart = 1;
      let newStart = 1;
      if (match) {
        oldStart = parseInt(match[1], 10);
        newStart = parseInt(match[2], 10);
      }

      oldLine = oldStart;
      newLine = newStart;

      currentHunk = {
        id: `hunk-${hunkCount}-${oldStart}-${newStart}`,
        index: hunkCount,
        header: line,
        lines: [{ type: 'hunk-header', content: line }],
        splitRows: [],
        oldStart,
        newStart,
        additions: 0,
        deletions: 0,
        text: '',
      };
      continue;
    }

    if (!currentHunk) {
      headerLines.push(line);
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentHunk.lines.push({
        type: 'add',
        newLineNumber: newLine++,
        content: line.slice(1),
      });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      currentHunk.lines.push({
        type: 'delete',
        oldLineNumber: oldLine++,
        content: line.slice(1),
      });
    } else if (line.startsWith(' ') || line === '') {
      currentHunk.lines.push({
        type: 'normal',
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
        content: line.startsWith(' ') ? line.slice(1) : line,
      });
    }
  }

  if (currentHunk) {
    finalizeHunk(currentHunk);
  }

  return {
    header: headerLines.join('\n'),
    hunks,
  };
}

/** Only the `+`/`-` rows. Context and the `@@` header confuse line-for-line translation. */
export function serializeChangedLines(hunk: DiffHunk): string {
  const rows: string[] = [];
  for (const line of hunk.lines) {
    if (line.type === 'add') rows.push(`+${line.content}`);
    else if (line.type === 'delete') rows.push(`-${line.content}`);
  }
  return rows.join('\n');
}

/**
 * Inserts every omitted unchanged line around the original hunks. Change hunks
 * stay untouched, so their selection, AI actions and add/delete highlighting
 * keep the exact same semantics in full-file mode.
 */
export function expandDiffWithFullContext(
  hunks: DiffHunk[],
  content: string,
  sourceSide: 'old' | 'new'
): ExpandedDiffBlock[] {
  const sourceLines = splitFileContent(content);
  const blocks: ExpandedDiffBlock[] = [];
  let oldCursor = 1;
  let newCursor = 1;

  const appendContext = (oldStart: number, newStart: number, count: number) => {
    if (count <= 0) return;
    const sourceStart = sourceSide === 'old' ? oldStart : newStart;
    if (sourceStart < 1 || sourceStart + count - 1 > sourceLines.length) {
      throw new Error('完整文件内容与当前 Diff 行号不一致，请刷新仓库后重试');
    }

    for (let offset = 0; offset < count; offset += FULL_CONTEXT_CHUNK_LINES) {
      const chunkCount = Math.min(FULL_CONTEXT_CHUNK_LINES, count - offset);
      const lines: DiffLine[] = [];
      const splitRows: SplitDiffRow[] = [];

      for (let index = 0; index < chunkCount; index++) {
        const oldLineNumber = oldStart + offset + index;
        const newLineNumber = newStart + offset + index;
        const contentLine = sourceLines[sourceStart + offset + index - 1];
        lines.push({
          type: 'normal',
          oldLineNumber,
          newLineNumber,
          content: contentLine,
        });
        splitRows.push({
          left: { lineNumber: oldLineNumber, content: contentLine, type: 'normal' },
          right: { lineNumber: newLineNumber, content: contentLine, type: 'normal' },
        });
      }

      const chunkOldStart = oldStart + offset;
      const chunkNewStart = newStart + offset;
      blocks.push({
        type: 'context',
        hunk: {
          id: `full-context-${chunkOldStart}-${chunkNewStart}`,
          index: 0,
          header: '',
          lines,
          splitRows,
          oldStart: chunkOldStart,
          newStart: chunkNewStart,
          additions: 0,
          deletions: 0,
          text: '',
        },
      });
    }
  };

  for (const hunk of hunks) {
    const oldGap = hunk.oldStart - oldCursor;
    const newGap = hunk.newStart - newCursor;
    const sourceGap = sourceSide === 'old' ? oldGap : newGap;
    if (sourceGap < 0 || (sourceGap > 0 && oldGap !== newGap)) {
      throw new Error('当前 Diff 的改动块无法与完整文件对齐，请刷新仓库后重试');
    }

    appendContext(oldCursor, newCursor, sourceGap);
    blocks.push({ type: 'change', hunk });

    oldCursor = hunk.oldStart;
    newCursor = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.type === 'delete') oldCursor++;
      else if (line.type === 'add') newCursor++;
      else if (line.type === 'normal') {
        oldCursor++;
        newCursor++;
      }
    }
  }

  const sourceCursor = sourceSide === 'old' ? oldCursor : newCursor;
  const trailingCount = sourceLines.length - sourceCursor + 1;
  if (trailingCount < 0) {
    throw new Error('完整文件内容比当前 Diff 记录的行数更短，请刷新仓库后重试');
  }
  appendContext(oldCursor, newCursor, trailingCount);
  return blocks;
}

function splitFileContent(content: string): string[] {
  if (content === '') return [];
  const lines = content.split(/\r\n|\r|\n/);
  if (/\r\n$|\r$|\n$/.test(content)) lines.pop();
  return lines;
}

function computeSplitRows(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let deleteBuffer: DiffLine[] = [];
  let addBuffer: DiffLine[] = [];

  const flushBuffers = () => {
    const maxLen = Math.max(deleteBuffer.length, addBuffer.length);
    for (let i = 0; i < maxLen; i++) {
      const del = deleteBuffer[i];
      const add = addBuffer[i];
      rows.push({
        left: del
          ? {
              lineNumber: del.oldLineNumber!,
              content: del.content,
              type: 'delete',
            }
          : undefined,
        right: add
          ? {
              lineNumber: add.newLineNumber!,
              content: add.content,
              type: 'add',
            }
          : undefined,
      });
    }
    deleteBuffer = [];
    addBuffer = [];
  };

  for (const line of lines) {
    if (line.type === 'hunk-header') continue;

    if (line.type === 'delete') {
      deleteBuffer.push(line);
    } else if (line.type === 'add') {
      addBuffer.push(line);
    } else {
      flushBuffers();
      rows.push({
        left: {
          lineNumber: line.oldLineNumber!,
          content: line.content,
          type: 'normal',
        },
        right: {
          lineNumber: line.newLineNumber!,
          content: line.content,
          type: 'normal',
        },
      });
    }
  }

  flushBuffers();
  return rows;
}
