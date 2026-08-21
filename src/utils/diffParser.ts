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
  header: string;
  lines: DiffLine[];
  splitRows: SplitDiffRow[];
  oldStart: number;
  newStart: number;
}

export interface ParsedFileDiff {
  header: string;
  hunks: DiffHunk[];
}

export function parseRawDiff(rawDiff: string): ParsedFileDiff {
  const lines = rawDiff.split('\n');
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  const headerLines: string[] = [];

  let oldLine = 0;
  let newLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('@@')) {
      if (currentHunk) {
        currentHunk.splitRows = computeSplitRows(currentHunk.lines);
        hunks.push(currentHunk);
      }

      // Parse @@ -oldStart,oldCount +newStart,newCount @@
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
        header: line,
        lines: [{ type: 'hunk-header', content: line }],
        splitRows: [],
        oldStart,
        newStart,
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
    currentHunk.splitRows = computeSplitRows(currentHunk.lines);
    hunks.push(currentHunk);
  }

  return {
    header: headerLines.join('\n'),
    hunks,
  };
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
