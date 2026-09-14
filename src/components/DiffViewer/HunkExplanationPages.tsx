import React, { useLayoutEffect, useRef, type RefObject } from 'react';

interface HunkExplanationPagesProps {
  enabled: boolean;
  index: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  onPageChange: (page: number) => void;
  children: React.ReactNode;
  explanation: React.ReactNode;
}

/** One horizontal pager per hunk; the explanation never adds height above its code. */
export function HunkExplanationPages({ enabled, index, scrollRef, onPageChange, children, explanation }: HunkExplanationPagesProps) {
  const pageRef = useRef(0);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    pageRef.current = 0;
    element.scrollLeft = 0;
    onPageChange(0);
    if (!enabled) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (!element.clientWidth || element.clientWidth === width) return;
      width = element.clientWidth;
      element.scrollLeft = pageRef.current * width;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, scrollRef, onPageChange]);

  return <div ref={scrollRef} className={enabled ? 'hunk-explanation-pages' : undefined}
    aria-label={enabled ? `改动块 ${index} 的代码与释义` : undefined}
    onScroll={(event) => {
      if (!enabled || event.target !== event.currentTarget) return;
      const page = event.currentTarget.scrollLeft >= event.currentTarget.clientWidth / 2 ? 1 : 0;
      pageRef.current = page;
      onPageChange(page);
    }}>
    <div className={enabled ? 'hunk-explanation-track' : undefined}>
      <div className={enabled ? 'hunk-code-page' : undefined}>
        <div className={enabled ? 'hunk-code-content' : undefined}>{children}</div>
      </div>
      {enabled && <section aria-label={`改动块 ${index} 的释义`} className="hunk-explanation-page">{explanation}</section>}
    </div>
  </div>;
}
