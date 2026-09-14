import { useState } from 'react';
import { fillContiguousCommitSelection } from '../utils/commitSelection';

/** Shared endpoint draft for mouse and touch; applying it is the caller's action. */
export function useCommitRangeSelection(commitOrder: string[]) {
  const [active, setActive] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const endpoints = draft.filter((hash) => commitOrder.includes(hash));
  const hashes = fillContiguousCommitSelection(commitOrder, endpoints);
  const reset = () => { setActive(false); setDraft([]); };
  const toggle = () => { setActive(!active); setDraft([]); };
  const pick = (hash: string) => {
    setDraft(endpoints.length === 1 ? endpoints[0] === hash ? [] : [endpoints[0], hash] : [hash]);
  };
  return { active, endpoints, hashes, reset, toggle, pick };
}
