/** Coalesces interaction updates and stops requesting frames once layout is idle. */
export function createGraphFrameScheduler(
  draw: () => boolean,
  request: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancel: (id: number) => void = cancelAnimationFrame
) {
  let pending: number | null = null;
  let disposed = false;
  const invalidate = () => {
    if (disposed || pending !== null) return;
    pending = request(() => {
      pending = null;
      if (!disposed && draw()) invalidate();
    });
  };
  const pause = () => {
    if (pending !== null) cancel(pending);
    pending = null;
  };
  return {
    invalidate,
    pause,
    dispose() {
      disposed = true;
      pause();
    },
  };
}
