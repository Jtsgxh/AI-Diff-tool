import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Native disclosure with action-menu dismissal; content stays mounted when closed. */
export function ActionMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !detailsRef.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      detailsRef.current?.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('click', outside, true);
    document.addEventListener('focusin', outside, true);
    document.addEventListener('scroll', outside, true);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('click', outside, true);
      document.removeEventListener('focusin', outside, true);
      document.removeEventListener('scroll', outside, true);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  return <details ref={detailsRef} className="relative" open={open}>
    <summary aria-label={label} onClick={(event) => { event.preventDefault(); setOpen((value) => !value); }} className="flex cursor-pointer list-none items-center px-2">更多</summary>
    <div className="absolute right-0 z-40 mt-1 flex w-56 flex-col rounded-lg border border-[var(--border-subtle)] bg-white p-2 shadow-xl"
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('button, a')) close();
      }}
      onChange={(event) => { if (event.target instanceof HTMLSelectElement) close(); }}
    >{children}</div>
  </details>;
}
