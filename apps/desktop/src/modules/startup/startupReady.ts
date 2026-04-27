export const STARTUP_READY_EVENT = 'pmp:startup-ready';

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
