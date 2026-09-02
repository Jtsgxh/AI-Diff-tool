import React, { useRef } from 'react';

export function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function readPersistedWidth(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  const n = Number(raw);
  return Number.isFinite(n) ? clampWidth(n, min, max) : fallback;
}

interface ResizeGutterProps {
  /** Panel whose width this gutter drives. */
  panelRef: React.RefObject<HTMLElement | null>;
  min: number;
  max: number;
  /** Grow when the pointer moves left (right-edge panels such as the AI dock). */
  invert?: boolean;
  value: number;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
  onReset?: () => void;
  title?: string;
}

/**
 * 4px column-resize handle. Width updates go through React so a later render
 * (AI tokens, etc.) cannot snap the pane back; the neighbouring panels are
 * memoized so a drag does not rebuild the Diff.
 */
export const ResizeGutter = React.memo<ResizeGutterProps>(
  ({ panelRef, min, max, invert = false, value, onChange, onCommit, onReset, title }) => {
    const draggingRef = useRef(false);
    const startXRef = useRef(0);
    const startWRef = useRef(0);
    const valueRef = useRef(value);
    valueRef.current = value;

    return (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(value)}
        aria-valuemin={min}
        aria-valuemax={max}
        title={title ?? '拖动调整栏宽 · 双击恢复默认'}
        onPointerDown={(e) => {
          e.preventDefault();
          draggingRef.current = true;
          startXRef.current = e.clientX;
          startWRef.current =
            panelRef.current?.getBoundingClientRect().width ?? valueRef.current;
          e.currentTarget.setPointerCapture(e.pointerId);
          document.body.classList.add('diff-splitting');
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          const dx = invert ? startXRef.current - e.clientX : e.clientX - startXRef.current;
          onChange(clampWidth(startWRef.current + dx, min, max));
        }}
        onPointerUp={() => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          document.body.classList.remove('diff-splitting');
          onCommit(valueRef.current);
        }}
        onPointerCancel={() => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          document.body.classList.remove('diff-splitting');
          onCommit(valueRef.current);
        }}
        onDoubleClick={onReset}
        className="w-1.5 shrink-0 cursor-col-resize relative z-10 group/gutter bg-black/[0.07] hover:bg-zinc-200 active:bg-zinc-200"
      >
        <div className="absolute inset-y-0 left-1/2 -ml-px w-px bg-black/[0.12] group-hover/gutter:bg-blue-400" />
      </div>
    );
  }
);

ResizeGutter.displayName = 'ResizeGutter';
