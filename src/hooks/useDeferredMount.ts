import { useEffect, useRef, useState } from 'react';

/** Distance ahead of the viewport at which content is mounted. */
const DEFAULT_ROOT_MARGIN = '900px 0px';

/**
 * Defers mounting a subtree until it scrolls near the viewport, then keeps it
 * mounted for good.
 *
 * A 3000-line diff is ~6000 DOM nodes; building them all up front costs
 * hundreds of milliseconds on the first paint even though only a screenful is
 * ever visible. Content is never unmounted again, so text selection and any
 * in-place AI annotations survive scrolling.
 */
export function useDeferredMount(enabled: boolean): {
  ref: React.RefObject<HTMLDivElement | null>;
  isMounted: boolean;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isMounted, setIsMounted] = useState(!enabled);

  useEffect(() => {
    if (!enabled) {
      setIsMounted(true);
      return;
    }
    if (isMounted) return;

    const element = ref.current;
    // Without IntersectionObserver support, render everything rather than nothing.
    if (!element || typeof IntersectionObserver === 'undefined') {
      setIsMounted(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: DEFAULT_ROOT_MARGIN }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, isMounted]);

  return { ref, isMounted };
}
