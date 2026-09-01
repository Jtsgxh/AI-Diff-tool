/**
 * Expands selected hashes to their smallest contiguous interval in the
 * repository's displayed commit order. Unknown hashes are ignored.
 */
export function fillContiguousCommitSelection(
  orderedHashes: readonly string[],
  selectedHashes: Iterable<string>
): string[] {
  const selected = new Set(selectedHashes);
  let first = -1;
  let last = -1;

  orderedHashes.forEach((hash, index) => {
    if (!selected.has(hash)) return;
    if (first === -1) first = index;
    last = index;
  });

  return first === -1 ? [] : orderedHashes.slice(first, last + 1);
}
