import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { storage } from '../constants/storage';

const MIN_PCT = 20;
const MAX_PCT = 80;

function clampPct(value: number): number {
  return Math.min(MAX_PCT, Math.max(MIN_PCT, value));
}

/**
 * Drag-to-resize a vertical split. `pct` is the left pane's share of the
 * container width; the value is persisted so the next session starts where
 * the last drag ended.
 */
export function useResizableSplit(storageKey: string, defaultPct = 50) {
  const [pct, setPct] = useState(() => {
    const stored = Number(storage.get(storageKey));
    return Number.isFinite(stored) ? clampPct(stored) : defaultPct;
  });
  const pctRef = useRef(pct);
  pctRef.current = pct;
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const persist = useCallback(
    (value: number) => {
      storage.set(storageKey, String(Math.round(value)));
    },
    [storageKey]
  );

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add('diff-splitting');
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    setPct(clampPct(((e.clientX - rect.left) / rect.width) * 100));
  }, []);

  const onPointerUp = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.classList.remove('diff-splitting');
    persist(pctRef.current);
  }, [persist]);

  const reset = useCallback(() => {
    setPct(defaultPct);
    persist(defaultPct);
  }, [defaultPct, persist]);

  useEffect(
    () => () => {
      document.body.classList.remove('diff-splitting');
    },
    []
  );

  return { pct, containerRef, onPointerDown, onPointerMove, onPointerUp, reset };
}
