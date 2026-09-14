import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

interface MobileDiffJumpProps {
  count: number;
  current: number;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onJump: (index: number) => void;
}

/** Stays reachable while the phone's landscape chrome is hidden. */
export function MobileDiffJump({ count, current, canPrevious, canNext, onPrevious, onNext, onJump }: MobileDiffJumpProps) {
  return <nav aria-label="全文差异跳转" className="mobile-diff-jumps absolute bottom-2 left-2 z-30 flex items-center rounded-full border border-[var(--border-subtle)] bg-white/95 px-1 text-xs text-zinc-700 shadow-sm">
    <button type="button" aria-label="上一处差异" disabled={!canPrevious} onClick={onPrevious} className="flex items-center justify-center rounded-full"><ArrowUp className="h-4 w-4" /></button>
    <select aria-label="跳转到指定差异" value={current || ''} onChange={(event) => onJump(Number(event.target.value))}
      className="h-11 max-w-28 bg-transparent px-1 text-center">
      <option value="" disabled>跳至差异</option>
      {Array.from({ length: count }, (_, index) => <option key={index} value={index + 1}>差异 {index + 1}/{count}</option>)}
    </select>
    <button type="button" aria-label="下一处差异" disabled={!canNext} onClick={onNext} className="flex items-center justify-center rounded-full"><ArrowDown className="h-4 w-4" /></button>
  </nav>;
}
