import React from 'react';
import type { DiffViewMode } from '../../types';
import type { DiffHunk } from '../../utils/diffParser';
import { useDeferredMount } from '../../hooks/useDeferredMount';
import { HunkSplitRows, HunkUnifiedRows } from './HunkRows';

interface FullDiffContextBlockProps {
  hunk: DiffHunk;
  viewMode: DiffViewMode;
  deferMount: boolean;
}

/** Unchanged full-file context, chunked so large files mount near the viewport only. */
export const FullDiffContextBlock = React.memo<FullDiffContextBlockProps>(
  ({ hunk, viewMode, deferMount }) => {
    const { ref, isMounted } = useDeferredMount(deferMount);
    const height = hunk.lines.length * (viewMode === 'split' ? 21 : 20);

    return (
      <div ref={ref}>
        {isMounted ? (
          viewMode === 'split' ? (
            <HunkSplitRows hunk={hunk} showPseudocode={false} />
          ) : (
            <HunkUnifiedRows hunk={hunk} showPseudocode={false} />
          )
        ) : (
          <div style={{ height }} aria-hidden />
        )}
      </div>
    );
  }
);

FullDiffContextBlock.displayName = 'FullDiffContextBlock';
