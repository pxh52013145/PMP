import { useEffect, useRef, useState } from 'react';
import type { BackgroundRenderPolicy, RenderMode } from '../contracts/performance';

export const DEFAULT_PAUSE_GRACE_MS = 1200;

export type AdaptiveRenderModeOptions = {
  isWindowVisible: boolean;
  isDocumentVisible: boolean;
  isWindowFocused: boolean;
  isWindowMinimized?: boolean;
  isPageFrozen?: boolean;
  backgroundRenderPolicy: BackgroundRenderPolicy;
  pauseGraceMs?: number;
};

function normalizeBoolean(value: boolean | undefined): boolean {
  return value === true;
}

function getDesiredRenderMode({
  isWindowVisible,
  isDocumentVisible,
  isWindowFocused,
  isWindowMinimized,
  isPageFrozen,
  backgroundRenderPolicy,
}: AdaptiveRenderModeOptions): RenderMode {
  const minimized = normalizeBoolean(isWindowMinimized);
  const frozen = normalizeBoolean(isPageFrozen);

  if (!isWindowVisible || !isDocumentVisible || minimized || frozen) return 'pause';
  if (isWindowFocused) return 'full';

  if (backgroundRenderPolicy === 'pause') {
    return 'throttle';
  }

  return backgroundRenderPolicy;
}

export function useAdaptiveRenderMode(options: AdaptiveRenderModeOptions): RenderMode {
  const {
    isWindowVisible,
    isDocumentVisible,
    isWindowFocused,
    isWindowMinimized,
    isPageFrozen,
    backgroundRenderPolicy,
    pauseGraceMs = DEFAULT_PAUSE_GRACE_MS,
  } = options;

  const latestRef = useRef(options);
  latestRef.current = options;

  const timerRef = useRef<number | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>(() => getDesiredRenderMode(options));

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const desired = getDesiredRenderMode({
      isWindowVisible,
      isDocumentVisible,
      isWindowFocused,
      isWindowMinimized,
      isPageFrozen,
      backgroundRenderPolicy,
      pauseGraceMs,
    });
    if (desired === 'throttle' && backgroundRenderPolicy === 'pause') {
      setRenderMode((current) => (current === 'pause' ? 'pause' : desired));
    } else {
      setRenderMode(desired);
    }

    if (desired !== 'throttle') return;
    if (backgroundRenderPolicy !== 'pause') return;

    // Grace period: avoid thrashing for short focus losses (alt-tab, child windows, drag, etc.).
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const latest = latestRef.current;

      const minimized = normalizeBoolean(latest.isWindowMinimized);
      const frozen = normalizeBoolean(latest.isPageFrozen);
      const shouldPauseImmediately =
        !latest.isWindowVisible || !latest.isDocumentVisible || minimized || frozen;
      if (shouldPauseImmediately) {
        setRenderMode('pause');
        return;
      }

      if (!latest.isWindowFocused && latest.backgroundRenderPolicy === 'pause') {
        setRenderMode('pause');
      }
    }, Math.max(0, pauseGraceMs));

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [
    backgroundRenderPolicy,
    isDocumentVisible,
    isPageFrozen,
    isWindowFocused,
    isWindowMinimized,
    isWindowVisible,
    pauseGraceMs,
  ]);

  return renderMode;
}
