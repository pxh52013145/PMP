export const STARTUP_READY_EVENT = 'pmp:startup-ready';

export type StartupIdleOptions = {
  delayMs?: number;
  timeoutMs?: number;
};

function getRootElement(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  return document.documentElement;
}

export function isStartupReady(): boolean {
  return getRootElement()?.dataset.pmpStartupReady === 'true';
}

export function markStartupReady(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const root = getRootElement();
  if (!root || root.dataset.pmpStartupReady === 'true') {
    return;
  }

  root.dataset.pmpStartupReady = 'true';
  window.dispatchEvent(new Event(STARTUP_READY_EVENT));
}

export function onStartupReady(task: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  if (isStartupReady()) {
    task();
    return () => {};
  }

  const handleReady = () => {
    task();
  };

  window.addEventListener(STARTUP_READY_EVENT, handleReady, { once: true });
  return () => {
    window.removeEventListener(STARTUP_READY_EVENT, handleReady);
  };
}

export function onStartupIdle(task: () => void, options: StartupIdleOptions = {}): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const delayMs = Math.max(0, Math.floor(options.delayMs ?? 0));
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? 1_500));
  let disposed = false;
  let delayTimer: number | null = null;
  let idleHandle: number | null = null;
  let fallbackTimer: number | null = null;

  const clearScheduledWork = () => {
    if (delayTimer !== null) {
      window.clearTimeout(delayTimer);
      delayTimer = null;
    }
    if (idleHandle !== null) {
      const cancelIdleCallback = (
        window as unknown as {
          cancelIdleCallback?: (handle: number) => void;
        }
      ).cancelIdleCallback;
      cancelIdleCallback?.(idleHandle);
      idleHandle = null;
    }
    if (fallbackTimer !== null) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  };

  const runTask = () => {
    if (disposed) return;
    clearScheduledWork();
    task();
  };

  const scheduleIdle = () => {
    if (disposed) return;

    const requestIdleCallback = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
      }
    ).requestIdleCallback;

    if (requestIdleCallback) {
      idleHandle = requestIdleCallback(runTask, { timeout: timeoutMs });
      return;
    }

    fallbackTimer = window.setTimeout(runTask, Math.min(timeoutMs, 800));
  };

  const cleanupStartupReady = onStartupReady(() => {
    if (delayMs > 0) {
      delayTimer = window.setTimeout(scheduleIdle, delayMs);
      return;
    }
    scheduleIdle();
  });

  return () => {
    disposed = true;
    cleanupStartupReady();
    clearScheduledWork();
  };
}
