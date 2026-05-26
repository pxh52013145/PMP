import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DESKTOP_LYRICS_OVERLAY_STORAGE_KEYS,
  useDesktopLyricsOverlayFontFamily,
  useDesktopLyricsOverlayT,
  writeDesktopLyricsOverlayJson,
} from './desktopLyricsOverlayRuntime';
import './DesktopLyricsOverlayApp.css';

const OVERLAY_SYNC_EVENT = 'desktop-lyrics-overlay-sync';
const OVERLAY_PROGRESS_EVENT = 'desktop-lyrics-overlay-progress';
const NATIVE_AUDIO_STATE_EVENT = 'native_audio_state';
const DESKTOP_LYRICS_AUDIO_CONTROL_REQUEST_EVENT = 'desktop-lyrics-audio-control-requested';
const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 56;
const MIN_OPACITY_PERCENT = 0;
const MAX_OPACITY_PERCENT = 100;
const FONT_STEP = 2;
const OPACITY_STEP = 5;
const LYRIC_OFFSET_STEP_MS = 100;
const MIN_LYRIC_OFFSET_MS = -5000;
const MAX_LYRIC_OFFSET_MS = 5000;
const MIN_REGION_WIDTH = 320;
const MIN_REGION_HEIGHT = 72;
const MAX_REGION_WIDTH = 8192;
const MAX_REGION_HEIGHT = 2160;
const LYRICS_RENDER_RADIUS = 4;

const DesktopLyricsOverlayControls = React.lazy(() => import('./DesktopLyricsOverlayControls'));

type OverlayHandleEdge = 'left' | 'right' | 'top' | 'bottom';
type AudioControlAction = 'previous' | 'toggle-play-pause' | 'next';

type PositionLike = {
  x: number;
  y: number;
  toLogical?: (scaleFactor: number) => PositionLike;
};

type SizeLike = {
  width: number;
  height: number;
  toLogical?: (scaleFactor: number) => SizeLike;
};

interface OverlayWindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OverlayLayoutPayload {
  [key: string]: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

interface DesktopLyricsLayoutSnapshot {
  offsetX: number;
  offsetY: number;
  regionWidth: number;
  regionHeight: number;
}

interface DesktopLyricsOverlayTextPayload {
  primary: string;
  secondary?: string | null;
  lines?: string[] | null;
  activeIndex?: number | null;
  activeProgressPercent?: number | null;
  activeProgressRemainingMs?: number | null;
}

interface DesktopLyricsOverlaySyncPayload {
  visible: boolean;
  clickThrough: boolean;
  fontSize: number;
  opacityPercent: number;
  regionWidth: number;
  regionHeight: number;
  lyricOffsetMs: number;
  text?: DesktopLyricsOverlayTextPayload | null;
}

interface DesktopLyricsOverlayProgressPayload {
  activeIndex?: number | null;
  activeProgressPercent?: number | null;
  activeProgressRemainingMs?: number | null;
}

interface NativeAudioStatePayload {
  playbackState?: string | null;
  state?: {
    playbackState?: string | null;
  } | null;
}

interface ActiveProgressAnimation {
  activeIndex: number;
  durationMs: number;
  startedAtMs: number;
  lastProgressPercent: number;
}

const DEFAULT_OVERLAY_STATE: DesktopLyricsOverlaySyncPayload = {
  visible: true,
  clickThrough: false,
  fontSize: 26,
  opacityPercent: 92,
  regionWidth: 0,
  regionHeight: 0,
  lyricOffsetMs: 0,
  text: null,
};

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTextLines(value: unknown, primary: string): string[] {
  if (!Array.isArray(value)) {
    return [primary];
  }

  const lines = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return lines.length > 0 ? lines : [primary];
}

function normalizeActiveIndex(value: unknown, lines: string[], primary: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(lines.length - 1, Math.max(0, Math.round(value)));
  }

  const primaryIndex = lines.findIndex((line) => line === primary);
  return primaryIndex >= 0 ? primaryIndex : 0;
}

function normalizeProgressPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeProgressRemainingMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(60_000, Math.max(0, Math.round(value)));
}

function normalizeLyricOffsetMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.round(Math.min(MAX_LYRIC_OFFSET_MS, Math.max(MIN_LYRIC_OFFSET_MS, value)));
}

function normalizePlaybackState(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : 'idle';
}

function resolveNativePlaybackState(payload: NativeAudioStatePayload | null | undefined): string {
  return normalizePlaybackState(payload?.state?.playbackState ?? payload?.playbackState);
}

function toLogicalPosition(position: PositionLike, scaleFactor: number): PositionLike {
  return typeof position.toLogical === 'function'
    ? position.toLogical(scaleFactor)
    : { x: position.x / scaleFactor, y: position.y / scaleFactor };
}

function toLogicalSize(size: SizeLike, scaleFactor: number): SizeLike {
  return typeof size.toLogical === 'function'
    ? size.toLogical(scaleFactor)
    : { width: size.width / scaleFactor, height: size.height / scaleFactor };
}

function clampRegionWidth(width: number, maxWidth = MAX_REGION_WIDTH): number {
  return Math.round(Math.min(MAX_REGION_WIDTH, maxWidth, Math.max(MIN_REGION_WIDTH, width)));
}

function clampRegionHeight(height: number, maxHeight = MAX_REGION_HEIGHT): number {
  return Math.round(Math.min(MAX_REGION_HEIGHT, maxHeight, Math.max(MIN_REGION_HEIGHT, height)));
}

function toLayoutPayload(rect: OverlayWindowRect): OverlayLayoutPayload {
  return {
    offsetX: Math.round(rect.x),
    offsetY: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

async function readOverlayWindowRect(): Promise<OverlayWindowRect> {
  const { appWindow } = await import('@tauri-apps/api/window');
  const [scaleFactor, position, size] = await Promise.all([
    appWindow.scaleFactor(),
    appWindow.outerPosition(),
    appWindow.innerSize(),
  ]);
  const logicalPosition = toLogicalPosition(position, scaleFactor);
  const logicalSize = toLogicalSize(size, scaleFactor);

  return {
    x: Math.round(logicalPosition.x),
    y: Math.round(logicalPosition.y),
    width: clampRegionWidth(logicalSize.width),
    height: clampRegionHeight(logicalSize.height),
  };
}

async function readRegionLimits(): Promise<{ maxWidth: number; maxHeight: number }> {
  try {
    const { currentMonitor } = await import('@tauri-apps/api/window');
    const monitor = await currentMonitor();
    if (!monitor) {
      return { maxWidth: MAX_REGION_WIDTH, maxHeight: MAX_REGION_HEIGHT };
    }

    const maxWidth = Math.round(monitor.size.width / monitor.scaleFactor);
    const maxHeight = Math.round(monitor.size.height / monitor.scaleFactor);
    return {
      maxWidth: Math.min(MAX_REGION_WIDTH, Math.max(MIN_REGION_WIDTH, maxWidth)),
      maxHeight: Math.min(MAX_REGION_HEIGHT, Math.max(MIN_REGION_HEIGHT, maxHeight)),
    };
  } catch {
    return { maxWidth: MAX_REGION_WIDTH, maxHeight: MAX_REGION_HEIGHT };
  }
}

function normalizeState(
  payload: Partial<DesktopLyricsOverlaySyncPayload> | null | undefined,
  fallback: DesktopLyricsOverlaySyncPayload
): DesktopLyricsOverlaySyncPayload {
  const nextFontSizeRaw = payload?.fontSize;
  const nextOpacityRaw = payload?.opacityPercent;
  const nextRegionWidthRaw = payload?.regionWidth;
  const nextRegionHeightRaw = payload?.regionHeight;
  const nextLyricOffsetRaw = payload?.lyricOffsetMs;

  const nextFontSize =
    typeof nextFontSizeRaw === 'number' && Number.isFinite(nextFontSizeRaw)
      ? Math.round(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, nextFontSizeRaw)))
      : fallback.fontSize;

  const nextOpacity =
    typeof nextOpacityRaw === 'number' && Number.isFinite(nextOpacityRaw)
      ? Math.round(Math.min(MAX_OPACITY_PERCENT, Math.max(MIN_OPACITY_PERCENT, nextOpacityRaw)))
      : fallback.opacityPercent;

  const nextRegionWidth =
    typeof nextRegionWidthRaw === 'number' && Number.isFinite(nextRegionWidthRaw)
      ? Math.round(Math.min(MAX_REGION_WIDTH, Math.max(0, nextRegionWidthRaw)))
      : fallback.regionWidth;

  const nextRegionHeight =
    typeof nextRegionHeightRaw === 'number' && Number.isFinite(nextRegionHeightRaw)
      ? Math.round(Math.min(MAX_REGION_HEIGHT, Math.max(0, nextRegionHeightRaw)))
      : fallback.regionHeight;

  const nextLyricOffset = normalizeLyricOffsetMs(
    typeof nextLyricOffsetRaw === 'number' ? nextLyricOffsetRaw : fallback.lyricOffsetMs
  );

  const text = payload?.text;
  const normalizedText =
    text && typeof text.primary === 'string' && text.primary.trim().length > 0
      ? (() => {
          const primary = text.primary.trim();
          const lines = normalizeTextLines(text.lines, primary);
          return {
            primary,
            secondary: normalizeOptionalText(text.secondary),
            lines,
            activeIndex: normalizeActiveIndex(text.activeIndex, lines, primary),
            activeProgressPercent: normalizeProgressPercent(text.activeProgressPercent),
            activeProgressRemainingMs: normalizeProgressRemainingMs(
              text.activeProgressRemainingMs
            ),
          };
        })()
      : null;

  return {
    visible: payload?.visible ?? fallback.visible,
    clickThrough: payload?.clickThrough ?? fallback.clickThrough,
    fontSize: nextFontSize,
    opacityPercent: nextOpacity,
    regionWidth: nextRegionWidth,
    regionHeight: nextRegionHeight,
    lyricOffsetMs: nextLyricOffset,
    text: normalizedText,
  };
}

function isUnlockWindowRoute(): boolean {
  return window.location.hash.includes('/unlock');
}

function DesktopLyricsUnlockDot() {
  const t = useDesktopLyricsOverlayT();
  const [isUnlocking, setIsUnlocking] = useState(false);
  const title = t('magnet.desktopLyricsButton.contextMenu.clickThrough.disable');

  useEffect(() => {
    document.documentElement.classList.add('desktop-lyrics-unlock-page');
    document.body.classList.add('desktop-lyrics-unlock-page');

    return () => {
      document.documentElement.classList.remove('desktop-lyrics-unlock-page');
      document.body.classList.remove('desktop-lyrics-unlock-page');
    };
  }, []);

  const unlockClickThrough = useCallback(async () => {
    if (isUnlocking) return;
    setIsUnlocking(true);

    try {
      await invoke('desktop_lyrics_set_click_through', { enabled: false });
      writeDesktopLyricsOverlayJson(
        DESKTOP_LYRICS_OVERLAY_STORAGE_KEYS.DESKTOP_LYRICS_CLICK_THROUGH,
        false
      );
    } catch {
      setIsUnlocking(false);
    }
  }, [isUnlocking]);

  return (
    <button
      type="button"
      className={`desktop-lyrics-unlock-dot${isUnlocking ? ' is-unlocking' : ''}`}
      title={title}
      aria-label={title}
      onClick={() => void unlockClickThrough()}
    >
      <span aria-hidden="true" />
    </button>
  );
}

export function DesktopLyricsOverlayApp() {
  return isUnlockWindowRoute() ? <DesktopLyricsUnlockDot /> : <DesktopLyricsOverlayPanel />;
}

function DesktopLyricsOverlayPanel() {
  const t = useDesktopLyricsOverlayT();
  const desktopLyricsFontFamily = useDesktopLyricsOverlayFontFamily();
  const [state, setState] = useState<DesktopLyricsOverlaySyncPayload>(DEFAULT_OVERLAY_STATE);
  const [isHovered, setIsHovered] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [shouldRenderControls, setShouldRenderControls] = useState(false);
  const [playbackState, setPlaybackState] = useState('idle');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lineStackRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<DesktopLyricsOverlaySyncPayload>(DEFAULT_OVERLAY_STATE);
  const progressFrameRef = useRef<number | null>(null);
  const progressAnimationRef = useRef<ActiveProgressAnimation | null>(null);
  const activeLineKeyRef = useRef<string | null>(null);
  const liveLayoutRef = useRef({
    width: 0,
    height: 0,
    fontSize: DEFAULT_OVERLAY_STATE.fontSize,
  });
  const gestureActiveRef = useRef(false);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  const applyLivePanelMetrics = useCallback((width: number, height: number, fontSize: number) => {
    const nextWidth = clampRegionWidth(width);
    const nextHeight = clampRegionHeight(height);
    const nextFontSize = Math.round(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSize)));

    liveLayoutRef.current = {
      width: nextWidth,
      height: nextHeight,
      fontSize: nextFontSize,
    };

    const panel = panelRef.current;
    if (!panel) return;
    panel.style.setProperty('--desktop-lyrics-panel-width', `${nextWidth}px`);
    panel.style.setProperty('--desktop-lyrics-panel-height', `${nextHeight}px`);
    panel.style.setProperty('--desktop-lyrics-font-size', `${nextFontSize}px`);
  }, []);

  const setRenderedActiveProgress = useCallback((progressPercent: number) => {
    const lineStack = lineStackRef.current;
    if (!lineStack) return;

    lineStack.style.setProperty(
      '--desktop-lyrics-active-progress',
      `${normalizeProgressPercent(progressPercent)}%`
    );
  }, []);

  const stopActiveProgressAnimation = useCallback(() => {
    if (progressFrameRef.current !== null) {
      window.cancelAnimationFrame(progressFrameRef.current);
      progressFrameRef.current = null;
    }
    progressAnimationRef.current = null;
  }, []);

  const stepActiveProgressAnimation = useCallback(() => {
    const animation = progressAnimationRef.current;
    if (!animation) return;

    const elapsedMs = performance.now() - animation.startedAtMs;
    const nextProgress = Math.min(100, Math.max(0, (elapsedMs / animation.durationMs) * 100));
    animation.lastProgressPercent = nextProgress;
    setRenderedActiveProgress(nextProgress);

    if (nextProgress >= 100) {
      progressAnimationRef.current = null;
      progressFrameRef.current = null;
      return;
    }

    progressFrameRef.current = window.requestAnimationFrame(stepActiveProgressAnimation);
  }, [setRenderedActiveProgress]);

  const applyActiveProgress = useCallback((
    progressPercent: unknown,
    remainingMs: unknown,
    options: { activeIndex: number; force?: boolean }
  ) => {
    const progress = normalizeProgressPercent(progressPercent);
    const remaining = normalizeProgressRemainingMs(remainingMs);
    const activeIndex = Math.max(0, Math.round(options.activeIndex));
    const existing = progressAnimationRef.current;

    if (
      !options.force &&
      existing &&
      existing.activeIndex === activeIndex &&
      Math.abs(existing.lastProgressPercent - progress) <= 8
    ) {
      return;
    }

    stopActiveProgressAnimation();
    setRenderedActiveProgress(progress);

    if (remaining <= 80 || progress >= 100) {
      return;
    }

    const remainingRatio = Math.max(0.01, (100 - progress) / 100);
    const durationMs = Math.min(120_000, Math.max(remaining, remaining / remainingRatio));
    const elapsedMs = Math.max(0, durationMs - remaining);

    progressAnimationRef.current = {
      activeIndex,
      durationMs,
      startedAtMs: performance.now() - elapsedMs,
      lastProgressPercent: progress,
    };
    progressFrameRef.current = window.requestAnimationFrame(stepActiveProgressAnimation);
  }, [setRenderedActiveProgress, stepActiveProgressAnimation, stopActiveProgressAnimation]);

  const activeText = state.text;

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useLayoutEffect(() => {
    const activeIndex =
      typeof activeText?.activeIndex === 'number' && Number.isFinite(activeText.activeIndex)
        ? Math.max(0, Math.round(activeText.activeIndex))
        : 0;
    const activeLineKey = activeText
      ? `${activeIndex}:${activeText.primary}:${activeText.lines?.length ?? 0}`
      : 'placeholder';

    if (activeLineKeyRef.current === activeLineKey) {
      return;
    }

    activeLineKeyRef.current = activeLineKey;
    applyActiveProgress(activeText?.activeProgressPercent ?? 0, activeText?.activeProgressRemainingMs ?? 0, {
      activeIndex,
      force: true,
    });
  }, [activeText, applyActiveProgress]);

  useEffect(() => {
    document.documentElement.classList.add('desktop-lyrics-overlay-page');
    document.body.classList.add('desktop-lyrics-overlay-page');
    applyLivePanelMetrics(
      state.regionWidth > 0
        ? state.regionWidth
        : Math.max(MIN_REGION_WIDTH, window.innerWidth || MIN_REGION_WIDTH),
      state.regionHeight > 0
        ? state.regionHeight
        : Math.max(MIN_REGION_HEIGHT, window.innerHeight || MIN_REGION_HEIGHT),
      state.fontSize
    );

    return () => {
      stopActiveProgressAnimation();
      resizeCleanupRef.current?.();
      document.documentElement.classList.remove('desktop-lyrics-overlay-page');
      document.body.classList.remove('desktop-lyrics-overlay-page');
    };
  }, [
    applyLivePanelMetrics,
    state.fontSize,
    state.regionHeight,
    state.regionWidth,
    stopActiveProgressAnimation,
  ]);

  useEffect(() => {
    if (gestureActiveRef.current) return;
    applyLivePanelMetrics(
      state.regionWidth > 0
        ? state.regionWidth
        : liveLayoutRef.current.width || Math.max(MIN_REGION_WIDTH, window.innerWidth || MIN_REGION_WIDTH),
      state.regionHeight > 0
        ? state.regionHeight
        : liveLayoutRef.current.height || Math.max(MIN_REGION_HEIGHT, window.innerHeight || MIN_REGION_HEIGHT),
      state.fontSize
    );
  }, [applyLivePanelMetrics, state.fontSize, state.regionHeight, state.regionWidth]);

  useEffect(() => {
    let disposed = false;
    let unlistenSync: UnlistenFn | null = null;
    let unlistenProgress: UnlistenFn | null = null;

    const bind = async () => {
      unlistenSync = await listen<DesktopLyricsOverlaySyncPayload>(OVERLAY_SYNC_EVENT, (event) => {
        setState((previous) => normalizeState(event.payload, previous));
      });

      unlistenProgress = await listen<DesktopLyricsOverlayProgressPayload>(
        OVERLAY_PROGRESS_EVENT,
        (event) => {
          const current = stateRef.current;
          const currentText = current.text;
          if (!currentText) return;

          const nextProgress = normalizeProgressPercent(event.payload?.activeProgressPercent);
          const nextRemaining = normalizeProgressRemainingMs(
            event.payload?.activeProgressRemainingMs
          );
          const payloadActiveIndex =
            typeof event.payload?.activeIndex === 'number' && Number.isFinite(event.payload.activeIndex)
              ? Math.round(event.payload.activeIndex)
              : null;
          const currentActiveIndex =
            typeof currentText.activeIndex === 'number' && Number.isFinite(currentText.activeIndex)
              ? Math.round(currentText.activeIndex)
              : 0;

          if (payloadActiveIndex !== null && payloadActiveIndex !== currentActiveIndex) {
            return;
          }

          stateRef.current = {
            ...current,
            text: {
              ...currentText,
              activeProgressPercent: nextProgress,
              activeProgressRemainingMs: nextRemaining,
            },
          };
          applyActiveProgress(nextProgress, nextRemaining, {
            activeIndex: currentActiveIndex,
            force: false,
          });
        }
      );

      try {
        const snapshot = await invoke<DesktopLyricsOverlaySyncPayload>(
          'desktop_lyrics_overlay_get_snapshot'
        );
        if (!disposed) {
          setState((previous) => normalizeState(snapshot, previous));
        }
      } catch {
        // Snapshot is best-effort; the sync listener will hydrate the overlay shortly after.
      }
    };

    void bind();

    return () => {
      disposed = true;
      if (unlistenSync) {
        unlistenSync();
      }
      if (unlistenProgress) {
        unlistenProgress();
      }
    };
  }, [applyActiveProgress]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    const bind = async () => {
      unlisten = await listen<NativeAudioStatePayload>(NATIVE_AUDIO_STATE_EVENT, (event) => {
        setPlaybackState(resolveNativePlaybackState(event.payload));
      });

      if (disposed && unlisten) {
        unlisten();
      }
    };

    void bind().catch(() => {});

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  const sendAudioControlRequest = useCallback(async (action: AudioControlAction) => {
    try {
      await emit(DESKTOP_LYRICS_AUDIO_CONTROL_REQUEST_EVENT, { action });
    } catch {
      // best-effort control event
    }
  }, []);

  const toggleClickThrough = useCallback(async () => {
    const next = !state.clickThrough;
    setState((previous) => ({ ...previous, clickThrough: next }));
    try {
      await invoke('desktop_lyrics_set_click_through', { enabled: next });
    } catch {
      setState((previous) => ({ ...previous, clickThrough: state.clickThrough }));
    }
  }, [state.clickThrough]);

  const adjustFontSize = useCallback(async (delta: number) => {
    const next = Math.round(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, state.fontSize + delta)));
    setState((previous) => ({ ...previous, fontSize: next }));
    applyLivePanelMetrics(liveLayoutRef.current.width, liveLayoutRef.current.height, next);
    try {
      await invoke('desktop_lyrics_set_font_size', { fontSize: next });
    } catch {
      // Runtime state will be refreshed by the backend sync event if this fails.
    }
  }, [applyLivePanelMetrics, state.fontSize]);

  const adjustOpacity = useCallback(
    async (delta: number) => {
      const next = Math.round(
        Math.min(MAX_OPACITY_PERCENT, Math.max(MIN_OPACITY_PERCENT, state.opacityPercent + delta))
      );
      setState((previous) => ({ ...previous, opacityPercent: next }));
      try {
        await invoke('desktop_lyrics_set_opacity_percent', { opacityPercent: next });
      } catch {
        // Runtime state will be refreshed by the backend sync event if this fails.
      }
    },
    [state.opacityPercent]
  );

  const setLyricOffset = useCallback(
    async (nextOffsetMs: number) => {
      const next = normalizeLyricOffsetMs(nextOffsetMs);
      const previous = stateRef.current.lyricOffsetMs;

      stateRef.current = { ...stateRef.current, lyricOffsetMs: next };
      setState((current) => ({ ...current, lyricOffsetMs: next }));
      try {
        await invoke('desktop_lyrics_set_lyric_offset_ms', { offsetMs: next });
        writeDesktopLyricsOverlayJson(
          DESKTOP_LYRICS_OVERLAY_STORAGE_KEYS.DESKTOP_LYRICS_LYRIC_OFFSET_MS,
          next
        );
      } catch {
        stateRef.current = { ...stateRef.current, lyricOffsetMs: previous };
        setState((current) => ({ ...current, lyricOffsetMs: previous }));
      }
    },
    []
  );

  const adjustLyricOffset = useCallback(
    async (deltaMs: number) => {
      await setLyricOffset(stateRef.current.lyricOffsetMs + deltaMs);
    },
    [setLyricOffset]
  );

  const closeOverlay = useCallback(async () => {
    try {
      await invoke('desktop_lyrics_set_visible', { visible: false });
      writeDesktopLyricsOverlayJson(
        DESKTOP_LYRICS_OVERLAY_STORAGE_KEYS.DESKTOP_LYRICS_ENABLED,
        false
      );
    } catch {
      // best-effort close request
    }
  }, []);

  const commitCurrentWindowLayout = useCallback(
    (delayMs: number) => {
      window.setTimeout(() => {
        void (async () => {
          try {
            const layout = await invoke<DesktopLyricsLayoutSnapshot>(
              'desktop_lyrics_commit_current_layout'
            );

            const nextWidth = clampRegionWidth(layout.regionWidth);
            const nextHeight = clampRegionHeight(layout.regionHeight);
            const currentFontSize = stateRef.current.fontSize;
            applyLivePanelMetrics(nextWidth, nextHeight, currentFontSize);
            stateRef.current = {
              ...stateRef.current,
              regionWidth: nextWidth,
              regionHeight: nextHeight,
            };
            setState((previous) => ({
              ...previous,
              regionWidth: nextWidth,
              regionHeight: nextHeight,
            }));
          } catch {
            // Layout commit is best-effort; backend state remains authoritative.
          }
        })();
      }, delayMs);
    },
    [applyLivePanelMetrics]
  );

  const startMoveGesture = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0 || stateRef.current.clickThrough) return;

      const target = event.target as HTMLElement;
      if (
        (target.closest('button') ||
          target.closest('.desktop-lyrics-overlay__toolbar') ||
          target.closest('.desktop-lyrics-overlay__resize-handle'))
      ) {
        return;
      }

      event.preventDefault();
      setIsHovered(true);
      gestureActiveRef.current = true;
      setIsMoving(true);
      void import('@tauri-apps/api/window')
        .then(({ appWindow }) => appWindow.startDragging())
        .catch(() => {});
      commitCurrentWindowLayout(120);
      commitCurrentWindowLayout(600);
      commitCurrentWindowLayout(1400);
      commitCurrentWindowLayout(3000);

      let finished = false;
      const finishMove = () => {
        if (finished) return;
        finished = true;
        gestureActiveRef.current = false;
        setIsMoving(false);
        commitCurrentWindowLayout(0);
        window.clearTimeout(fallbackFinishTimer);
        window.removeEventListener('mouseup', finishMove);
        window.removeEventListener('blur', finishMove);
      };
      const fallbackFinishTimer = window.setTimeout(finishMove, 4200);

      window.addEventListener('mouseup', finishMove, { once: true });
      window.addEventListener('blur', finishMove, { once: true });
    },
    [commitCurrentWindowLayout]
  );

  const startResizeGesture = useCallback(
    (event: React.PointerEvent<HTMLElement>, edge: OverlayHandleEdge) => {
      if (event.button !== 0 || stateRef.current.clickThrough) return;

      event.preventDefault();
      event.stopPropagation();

      resizeCleanupRef.current?.();
      setIsHovered(true);
      gestureActiveRef.current = true;
      setIsResizing(true);

      const pointerTarget = event.currentTarget;
      const pointerId = event.pointerId;
      try {
        pointerTarget.setPointerCapture?.(pointerId);
      } catch {
        // Pointer capture is best-effort; window-level listeners keep the gesture alive.
      }

      const startScreenX = event.screenX;
      const startScreenY = event.screenY;
      const previousState = stateRef.current;
      let disposed = false;
      let frame = 0;
      let startRect: OverlayWindowRect | null = null;
      let nextRect: OverlayWindowRect | null = null;
      let startFontSize = liveLayoutRef.current.fontSize || previousState.fontSize;
      let nextFontSize = startFontSize;
      let limits = { maxWidth: MAX_REGION_WIDTH, maxHeight: MAX_REGION_HEIGHT };
      let previewInFlight = false;
      let queuedPreview: OverlayLayoutPayload | null = null;
      let previewIdleResolve: (() => void) | null = null;

      const resolvePreviewIdle = () => {
        if (!previewInFlight && !queuedPreview && previewIdleResolve) {
          previewIdleResolve();
          previewIdleResolve = null;
        }
      };

      const pumpPreview = () => {
        if (previewInFlight || !queuedPreview) return;
        const payload = queuedPreview;
        queuedPreview = null;
        previewInFlight = true;
        void invoke('desktop_lyrics_preview_layout', payload)
          .catch(() => {})
          .finally(() => {
            previewInFlight = false;
            if (queuedPreview) {
              pumpPreview();
              return;
            }
            resolvePreviewIdle();
          });
      };

      const waitForPreviewIdle = () => {
        if (!previewInFlight && !queuedPreview) {
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          previewIdleResolve = resolve;
        });
      };

      const scheduleLayout = (rect: OverlayWindowRect, fontSize: number) => {
        nextRect = rect;
        nextFontSize = fontSize;
        if (frame !== 0) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          if (!nextRect) return;
          applyLivePanelMetrics(nextRect.width, nextRect.height, nextFontSize);
          queuedPreview = toLayoutPayload(nextRect);
          pumpPreview();
        });
      };

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (!startRect) return;

        const deltaX = moveEvent.screenX - startScreenX;
        const deltaY = moveEvent.screenY - startScreenY;
        const next = { ...startRect };
        let fontSize = startFontSize;

        if (edge === 'right') {
          next.width = clampRegionWidth(startRect.width + deltaX, limits.maxWidth);
        } else if (edge === 'left') {
          next.width = clampRegionWidth(startRect.width - deltaX, limits.maxWidth);
          next.x = Math.round(startRect.x + startRect.width - next.width);
        } else if (edge === 'bottom') {
          next.height = clampRegionHeight(startRect.height + deltaY, limits.maxHeight);
        } else {
          next.height = clampRegionHeight(startRect.height - deltaY, limits.maxHeight);
          next.y = Math.round(startRect.y + startRect.height - next.height);
        }

        if (edge === 'left' || edge === 'right') {
          const scale = startRect.width > 0 ? next.width / startRect.width : 1;
          fontSize = Math.round(
            Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, startFontSize * scale))
          );
        }

        scheduleLayout(next, fontSize);
      };

      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        if (frame !== 0) {
          window.cancelAnimationFrame(frame);
          frame = 0;
          if (nextRect) {
            applyLivePanelMetrics(nextRect.width, nextRect.height, nextFontSize);
          }
        }

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', cleanup);
        window.removeEventListener('pointercancel', cleanup);
        try {
          pointerTarget.releasePointerCapture?.(pointerId);
        } catch {
          // noop
        }
        resizeCleanupRef.current = null;
        gestureActiveRef.current = false;
        setIsResizing(false);

        const finalRect = nextRect ?? startRect;
        if (!finalRect) return;

        const finalLayout = toLayoutPayload(finalRect);
        const finalFontSize = Math.round(
          Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, nextFontSize))
        );

        stateRef.current = {
          ...stateRef.current,
          fontSize: finalFontSize,
          regionWidth: finalLayout.width,
          regionHeight: finalLayout.height,
        };
        setState((previous) => ({
          ...previous,
          fontSize: finalFontSize,
          regionWidth: finalLayout.width,
          regionHeight: finalLayout.height,
        }));

        queuedPreview = null;
        void (async () => {
          await waitForPreviewIdle();

          if (finalFontSize !== previousState.fontSize) {
            await invoke('desktop_lyrics_set_font_size', { fontSize: finalFontSize }).catch(
              () => {}
            );
            writeDesktopLyricsOverlayJson(
              DESKTOP_LYRICS_OVERLAY_STORAGE_KEYS.DESKTOP_LYRICS_FONT_SIZE,
              finalFontSize
            );
          }

          await invoke('desktop_lyrics_set_layout', finalLayout).catch(() => {});
        })();
      };

      resizeCleanupRef.current = cleanup;
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', cleanup);
      window.addEventListener('pointercancel', cleanup);

      void Promise.all([readOverlayWindowRect(), readRegionLimits()])
        .then(([rect, nextLimits]) => {
          if (disposed) return;
          limits = nextLimits;
          startRect = {
            ...rect,
            width: clampRegionWidth(rect.width, limits.maxWidth),
            height: clampRegionHeight(rect.height, limits.maxHeight),
          };
          nextRect = startRect;
          startFontSize = liveLayoutRef.current.fontSize || previousState.fontSize;
          nextFontSize = startFontSize;
          applyLivePanelMetrics(startRect.width, startRect.height, startFontSize);
        })
        .catch(() => {
          cleanup();
        });
    },
    [applyLivePanelMetrics]
  );

  const handlePanelMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      startMoveGesture(event);
    },
    [startMoveGesture]
  );

  const handleHandlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, edge: OverlayHandleEdge) => {
      startResizeGesture(event, edge);
    },
    [startResizeGesture]
  );

  const rootStyle = useMemo<React.CSSProperties>(
    () => ({
      ['--desktop-lyrics-bg-alpha' as string]: `${state.opacityPercent / 100}`,
      ['--desktop-lyrics-font-family' as string]: desktopLyricsFontFamily,
    }),
    [desktopLyricsFontFamily, state.opacityPercent]
  );

  const primaryText = state.text?.primary?.trim() || t('pages.track.lyrics.placeholder');
  const secondaryText = state.text?.secondary?.trim();
  const lyricLines = state.text?.lines?.length ? state.text.lines : [primaryText];
  const activeIndex =
    typeof state.text?.activeIndex === 'number'
      ? Math.min(lyricLines.length - 1, Math.max(0, state.text.activeIndex))
      : 0;
  const visibleLineStart = Math.max(0, activeIndex - LYRICS_RENDER_RADIUS);
  const visibleLyricLines = lyricLines.slice(
    visibleLineStart,
    Math.min(lyricLines.length, activeIndex + LYRICS_RENDER_RADIUS + 1)
  );
  const visibleActiveIndex = activeIndex - visibleLineStart;
  const lineStackStyle = useMemo<React.CSSProperties>(
    () => {
      const rowStep = state.fontSize * 2.45;
      return {
        ['--desktop-lyrics-row-step' as string]: `${rowStep}px`,
        ['--desktop-lyrics-stack-offset' as string]: `${-visibleActiveIndex * rowStep}px`,
        ['--desktop-lyrics-secondary-top' as string]: `${(visibleActiveIndex + 0.72) * rowStep}px`,
      };
    },
    [state.fontSize, visibleActiveIndex]
  );
  const showChrome = (isHovered || isMoving || isResizing) && !state.clickThrough;
  const isPlaying = playbackState === 'playing' || playbackState === 'buffering';

  useEffect(() => {
    if (showChrome) {
      setShouldRenderControls(true);
    }
  }, [showChrome]);

  return (
    <div
      className={`desktop-lyrics-overlay${showChrome ? ' is-interactive' : ''}${isMoving ? ' is-moving' : ''}${isResizing ? ' is-resizing' : ''}${state.clickThrough ? ' is-click-through' : ''}`}
      style={rootStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        ref={panelRef}
        className="desktop-lyrics-overlay__panel"
        onMouseDown={handlePanelMouseDown}
      >
        <div className="desktop-lyrics-overlay__background" aria-hidden="true" />

        {shouldRenderControls ? (
          <React.Suspense fallback={null}>
            <DesktopLyricsOverlayControls
              isPlaying={isPlaying}
              clickThrough={state.clickThrough}
              lyricOffsetMs={state.lyricOffsetMs}
              onAudioControl={sendAudioControlRequest}
              onToggleClickThrough={toggleClickThrough}
              onDecreaseFontSize={() => void adjustFontSize(-FONT_STEP)}
              onIncreaseFontSize={() => void adjustFontSize(FONT_STEP)}
              onDecreaseOpacity={() => void adjustOpacity(-OPACITY_STEP)}
              onIncreaseOpacity={() => void adjustOpacity(OPACITY_STEP)}
              onSlowLyrics={() => void adjustLyricOffset(-LYRIC_OFFSET_STEP_MS)}
              onResetLyricOffset={() => void setLyricOffset(0)}
              onFastLyrics={() => void adjustLyricOffset(LYRIC_OFFSET_STEP_MS)}
              onClose={closeOverlay}
            />
          </React.Suspense>
        ) : null}

        {(['left', 'right', 'top', 'bottom'] as const).map((edge) => (
          <div
            key={edge}
            className={`desktop-lyrics-overlay__resize-handle desktop-lyrics-overlay__resize-handle--${edge}`}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => handleHandlePointerDown(event, edge)}
          >
            <span aria-hidden="true" />
          </div>
        ))}

        <div className="desktop-lyrics-overlay__content" aria-live="polite">
          <div ref={lineStackRef} className="desktop-lyrics-overlay__line-stack" style={lineStackStyle}>
            {visibleLyricLines.map((line, index) => {
              const absoluteIndex = visibleLineStart + index;
              const distance = Math.min(6, Math.abs(absoluteIndex - activeIndex));
              const lineClassName = [
                'desktop-lyrics-overlay__lyric-line',
                absoluteIndex < activeIndex ? 'is-past' : '',
                absoluteIndex === activeIndex ? 'is-active' : '',
                absoluteIndex > activeIndex ? 'is-future' : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <p
                  key={`${absoluteIndex}-${line}`}
                  className={lineClassName}
                  style={{
                    ['--desktop-lyrics-line-opacity' as string]: Math.max(0.16, 1 - distance * 0.11),
                  }}
                >
                  {absoluteIndex === activeIndex ? (
                    <span className="desktop-lyrics-overlay__lyric-current">
                      <span className="desktop-lyrics-overlay__lyric-base">{line}</span>
                      <span className="desktop-lyrics-overlay__lyric-fill" aria-hidden="true">
                        {line}
                      </span>
                    </span>
                  ) : (
                    <span>{line}</span>
                  )}
                </p>
              );
            })}
            {secondaryText ? <p className="desktop-lyrics-overlay__secondary">{secondaryText}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

