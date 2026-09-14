import { useLayoutEffect, type RefObject } from 'react';
import { readWorkspace, saveReadingPosition } from '../services/workspaceState';

/** Save while scrolling and on backgrounding: mobile browsers may skip unload entirely. */
export function usePersistentDiffScroll(ref: RefObject<HTMLDivElement | null>, repoPath: string, key: string, ready: boolean) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!ready || !element) return;
    const saved = readWorkspace(repoPath).positions[key] ?? { top: 0, left: 0 };
    let last = saved;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let restoring = true;
    const restore = () => { element.scrollTop = saved.top; element.scrollLeft = saved.left; };
    restore();
    const frame = requestAnimationFrame(() => {
      restore();
      restoring = false;
      last = { top: element.scrollTop, left: element.scrollLeft };
    });
    const flush = () => {
      clearTimeout(timer);
      if (!restoring) saveReadingPosition(repoPath, key, last);
    };
    const capture = () => {
      if (restoring || !element.getClientRects().length) return;
      last = { top: element.scrollTop, left: element.scrollLeft };
      clearTimeout(timer);
      timer = setTimeout(flush, 150);
    };
    const saveOnExit = () => { capture(); flush(); };
    const visibility = () => { if (document.visibilityState === 'hidden') saveOnExit(); };
    element.addEventListener('scroll', capture, { passive: true });
    window.addEventListener('pagehide', saveOnExit);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancelAnimationFrame(frame);
      flush();
      element.removeEventListener('scroll', capture);
      window.removeEventListener('pagehide', saveOnExit);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [ref, repoPath, key, ready]);
}
