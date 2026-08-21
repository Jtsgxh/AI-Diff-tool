import type { DiffHunk } from '../../utils/diffParser';
import type { DiffViewMode } from '../../types';

/** Rendered height of one code row (`text-xs leading-5`). */
const ROW_HEIGHT_PX = 20;
/** Split rows carry a 1px bottom hairline. */
const SPLIT_ROW_HEIGHT_PX = 21;
/** The `@@ ... @@` capsule: py-1 around a 16px line, plus 1px borders. */
const HUNK_HEADER_HEIGHT_PX = 26;

/**
 * Above this many rendered rows a file is laid out with deferred mounting.
 * Small diffs stay eagerly rendered: the placeholder swap is only worth its
 * cost when the DOM would otherwise be large.
 */
export const DEFERRED_MOUNT_ROW_THRESHOLD = 400;

/** Approximate height of a hunk, used to size the placeholder before mount. */
export function estimateHunkHeight(hunk: DiffHunk, viewMode: DiffViewMode): number {
  return viewMode === 'split'
    ? HUNK_HEADER_HEIGHT_PX + hunk.splitRows.length * SPLIT_ROW_HEIGHT_PX
    : hunk.lines.length * ROW_HEIGHT_PX;
}

export function totalRenderedRows(hunks: DiffHunk[], viewMode: DiffViewMode): number {
  return hunks.reduce(
    (sum, hunk) => sum + (viewMode === 'split' ? hunk.splitRows.length : hunk.lines.length),
    0
  );
}
