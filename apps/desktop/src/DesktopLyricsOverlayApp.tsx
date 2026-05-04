import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow, currentMonitor } from '@tauri-apps/api/window';
import {
  Eye,
  EyeOff,
  Minus,
  MousePointer2,
  Move,
  Plus,
  Type,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from './i18n';
import { getTelemetryLogger } from './services/telemetry/TelemetryService';
import { invokeWithTelemetry } from './services/telemetry/tauriInvokeTelemetry';
import './DesktopLyricsOverlayApp.css';

const OVERLAY_SYNC_EVENT = 'desktop-lyrics-overlay-sync';
const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 56;
const MIN_OPACITY_PERCENT = 0;
const MAX_OPACITY_PERCENT = 100;
const FONT_STEP = 2;
const OPACITY_STEP = 5;
const MIN_REGION_WIDTH = 320;
const MIN_REGION_HEIGHT = 72;
const MAX_REGION_WIDTH = 8192;
const MAX_REGION_HEIGHT = 2160;

type OverlayHandleEdge = 'left' | 'right' | 'top' | 'bottom';

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

interface DesktopLyricsOverlayTextPayload {
  primary: string;
  secondary?: string | null;
  previous?: string | null;
  next?: string | null;
}

interface DesktopLyricsOverlaySyncPayload {
  visible: boolean;
  clickThrough: boolean;
  fontSize: number;
  opacityPercent: number;
  regionWidth: number;
  regionHeight: number;
  text?: DesktopLyricsOverlayTextPayload | null;
}

const DEFAULT_OVERLAY_STATE: DesktopLyricsOverlaySyncPayload = {
  visible: true,
  clickThrough: false,
  fontSize: 26,
  opacityPercent: 92,
  regionWidth: 0,
  regionHeight: 0,
  text: null,
};

const telemetry = getTelemetryLogger('windowing', 'DesktopLyricsOverlayApp');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

  const text = payload?.text;
  const normalizedText =
    text && typeof text.primary === 'string' && text.primary.trim().length > 0
      ? {
          primary: text.primary.trim(),
          secondary: normalizeOptionalText(text.secondary),
          previous: normalizeOptionalText(text.previous),
          next: normalizeOptionalText(text.next),
        }
      : null;

  return {
    visible: payload?.visible ?? fallback.visible,
    clickThrough: payload?.clickThrough ?? fallback.clickThrough,
    fontSize: nextFontSize,
    opacityPercent: nextOpacity,
    regionWidth: nextRegionWidth,
    regionHeight: nextRegionHeight,
    text: normalizedText,
  };
}

export function DesktopLyricsOverlayApp() {
  const t = useT();
  const [state, setState] = useState<DesktopLyricsOverlaySyncPayload>(DEFAULT_OVERLAY_STATE);
  const [isHovered, setIsHovered] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
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
      resizeCleanupRef.current?.();
      document.documentElement.classList.remove('desktop-lyrics-overlay-page');
      document.body.classList.remove('desktop-lyrics-overlay-page');
    };
  }, [applyLivePanelMetrics, state.fontSize, state.regionHeight, state.regionWidth]);

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
    let unlisten: UnlistenFn | null = null;

    const bind = async () => {
      unlisten = await listen<DesktopLyricsOverlaySyncPayload>(OVERLAY_SYNC_EVENT, (event) => {
        setState((previous) => normalizeState(event.payload, previous));
      });

      try {
        const snapshot = await invokeWithTelemetry<DesktopLyricsOverlaySyncPayload>(
          'desktop_lyrics_overlay_get_snapshot',
          undefined,
          {
            moduleId: 'windowing',
            component: 'DesktopLyricsOverlayApp',
            event: 'desktop-lyrics.overlay.snapshot.read',
          }
        );
        if (!disposed) {
          setState((previous) => normalizeState(snapshot, previous));
        }
      } catch (error) {
        telemetry.warn('desktop-lyrics.overlay.snapshot.read.failed', {
          message: getErrorMessage(error),
        });
      }
    };

    void bind();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const toggleClickThrough = useCallback(async () => {
    const next = !state.clickThrough;
    setState((previous) => ({ ...previous, clickThrough: next }));
    try {
      await invokeWithTelemetry('desktop_lyrics_set_click_through', { enabled: next }, {
        moduleId: 'windowing',
        component: 'DesktopLyricsOverlayApp',
        event: 'desktop-lyrics.overlay.click-through.set',
      });
    } catch (error) {
      setState((previous) => ({ ...previous, clickThrough: state.clickThrough }));
      telemetry.error('desktop-lyrics.overlay.click-through.set.failed', {
        message: getErrorMessage(error),
        fields: { enabled: next },
      });
    }
  }, [state.clickThrough]);

  const adjustFontSize = useCallback(async (delta: number) => {
    const next = Math.round(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, state.fontSize + delta)));
    setState((previous) => ({ ...previous, fontSize: next }));
    applyLivePanelMetrics(liveLayoutRef.current.width, liveLayoutRef.current.height, next);
    try {
      await invokeWithTelemetry('desktop_lyrics_set_font_size', { fontSize: next }, {
        moduleId: 'windowing',
        component: 'DesktopLyricsOverlayApp',
        event: 'desktop-lyrics.overlay.font-size.set',
      });
    } catch (error) {
      telemetry.error('desktop-lyrics.overlay.font-size.set.failed', {
        message: getErrorMessage(error),
        fields: { fontSize: next },
      });
    }
  }, [applyLivePanelMetrics, state.fontSize]);

  const adjustOpacity = useCallback(
    async (delta: number) => {
      const next = Math.round(
        Math.min(MAX_OPACITY_PERCENT, Math.max(MIN_OPACITY_PERCENT, state.opacityPercent + delta))
      );
      setState((previous) => ({ ...previous, opacityPercent: next }));
      try {
        await invokeWithTelemetry('desktop_lyrics_set_opacity_percent', { opacityPercent: next }, {
          moduleId: 'windowing',
          component: 'DesktopLyricsOverlayApp',
          event: 'desktop-lyrics.overlay.opacity.set',
        });
      } catch (error) {
        telemetry.error('desktop-lyrics.overlay.opacity.set.failed', {
          message: getErrorMessage(error),
          fields: { opacityPercent: next },
        });
      }
    },
    [state.opacityPercent]
  );

  const closeOverlay = useCallback(async () => {
    try {
      await invokeWithTelemetry('desktop_lyrics_set_visible', { visible: false }, {
        moduleId: 'windowing',
        component: 'DesktopLyricsOverlayApp',
        event: 'desktop-lyrics.overlay.visible.set',
      });
    } catch (error) {
      telemetry.error('desktop-lyrics.overlay.visible.set.failed', {
        message: getErrorMessage(error),
        fields: { visible: false },
      });
    }
  }, []);

  const startLayoutGesture = useCallback(
    (event: React.PointerEvent<HTMLElement>, edge: OverlayHandleEdge | null) => {
      if (event.button !== 0 || state.clickThrough) return;

      const target = event.target as HTMLElement;
      if (
        !edge &&
        (target.closest('button') ||
          target.closest('.desktop-lyrics-overlay__toolbar') ||
          target.closest('.desktop-lyrics-overlay__resize-handle'))
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      resizeCleanupRef.current?.();
      setIsHovered(true);
      gestureActiveRef.current = true;

      const pointerTarget = event.currentTarget;
      const pointerId = event.pointerId;
      try {
        pointerTarget.setPointerCapture?.(pointerId);
      } catch {
        // Pointer capture is best-effort; window-level listeners keep the gesture alive.
      }
      const startScreenX = event.screenX;
      const startScreenY = event.screenY;

      if (edge) {
        setIsResizing(true);
      } else {
        setIsMoving(true);
      }

      let disposed = false;
      let frame = 0;
      let startRect: OverlayWindowRect | null = null;
      let nextRect: OverlayWindowRect | null = null;
      let startFontSize = liveLayoutRef.current.fontSize || state.fontSize;
      let nextFontSize = startFontSize;
      let limits = { maxWidth: MAX_REGION_WIDTH, maxHeight: MAX_REGION_HEIGHT };
      let previewInFlight = false;
      let queuedPreview: OverlayLayoutPayload | null = null;
      let previewIdleResolve: (() => void) | null = null;
      let previewErrorLogged = false;

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
          .catch((error) => {
            if (previewErrorLogged) return;
            previewErrorLogged = true;
            telemetry.warn('desktop-lyrics.overlay.layout.preview.failed', {
              message: getErrorMessage(error),
            });
          })
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

        if (!edge) {
          next.x = Math.round(startRect.x + deltaX);
          next.y = Math.round(startRect.y + deltaY);
          scheduleLayout(next, fontSize);
          return;
        }

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
        setIsMoving(false);
        setIsResizing(false);

        const finalRect = nextRect ?? startRect;
        if (!finalRect) return;

        const finalLayout = toLayoutPayload(finalRect);
        const finalFontSize = Math.round(
          Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, nextFontSize))
        );

        setState((previous) => ({
          ...previous,
          fontSize: finalFontSize,
          regionWidth: finalLayout.width,
          regionHeight: finalLayout.height,
        }));

        queuedPreview = null;
        void (async () => {
          await waitForPreviewIdle();

          if (finalFontSize !== state.fontSize) {
            await invokeWithTelemetry('desktop_lyrics_set_font_size', { fontSize: finalFontSize }, {
              moduleId: 'windowing',
              component: 'DesktopLyricsOverlayApp',
              event: 'desktop-lyrics.overlay.font-size.set',
            }).catch((error) => {
              telemetry.error('desktop-lyrics.overlay.font-size.set.failed', {
                message: getErrorMessage(error),
                fields: { fontSize: finalFontSize },
              });
            });
          }

          await invokeWithTelemetry('desktop_lyrics_set_layout', finalLayout, {
            moduleId: 'windowing',
            component: 'DesktopLyricsOverlayApp',
            event: edge
              ? 'desktop-lyrics.overlay.layout.resize'
              : 'desktop-lyrics.overlay.layout.move',
          }).catch((error) => {
            telemetry.error('desktop-lyrics.overlay.layout.set.failed', {
              message: getErrorMessage(error),
              fields: finalLayout,
            });
          });
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
          startFontSize = liveLayoutRef.current.fontSize || state.fontSize;
          nextFontSize = startFontSize;
          applyLivePanelMetrics(startRect.width, startRect.height, startFontSize);
        })
        .catch((error) => {
          telemetry.warn('desktop-lyrics.overlay.layout.read.failed', {
            message: getErrorMessage(error),
          });
          cleanup();
        });
    },
    [applyLivePanelMetrics, state.clickThrough, state.fontSize]
  );

  const handlePanelPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      startLayoutGesture(event, null);
    },
    [startLayoutGesture]
  );

  const handleHandlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, edge: OverlayHandleEdge) => {
      startLayoutGesture(event, edge);
    },
    [startLayoutGesture]
  );

  const rootStyle = useMemo<React.CSSProperties>(
    () => ({
      ['--desktop-lyrics-bg-alpha' as string]: `${state.opacityPercent / 100}`,
    }),
    [state.opacityPercent]
  );

  const primaryText = state.text?.primary?.trim() || t('pages.track.lyrics.placeholder');
  const secondaryText = state.text?.secondary?.trim();
  const previousText = state.text?.previous?.trim();
  const nextText = state.text?.next?.trim();
  const showChrome = (isHovered || isMoving || isResizing) && !state.clickThrough;
  const clickThroughTitle = state.clickThrough
    ? t('magnet.desktopLyricsButton.contextMenu.clickThrough.disable')
    : t('magnet.desktopLyricsButton.contextMenu.clickThrough.enable');
  const smallerFontTitle = t('magnet.desktopLyricsButton.contextMenu.fontSize.small');
  const largerFontTitle = t('magnet.desktopLyricsButton.contextMenu.fontSize.large');
  const lowerOpacityTitle = t('magnet.desktopLyricsButton.contextMenu.opacity.p60');
  const higherOpacityTitle = t('magnet.desktopLyricsButton.contextMenu.opacity.p100');
  const closeTitle = t('magnet.desktopLyricsButton.title.disable');

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
        onPointerDown={handlePanelPointerDown}
      >
        <div className="desktop-lyrics-overlay__background" aria-hidden="true" />

        <div
          className="desktop-lyrics-overlay__toolbar"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="desktop-lyrics-overlay__drag-hint" aria-hidden="true">
            <Move size={14} />
          </span>
          <button
            type="button"
            className={state.clickThrough ? 'is-active' : ''}
            title={clickThroughTitle}
            aria-label={clickThroughTitle}
            onClick={() => void toggleClickThrough()}
          >
            <MousePointer2 size={14} />
          </button>
          <button
            type="button"
            title={smallerFontTitle}
            aria-label={smallerFontTitle}
            onClick={() => void adjustFontSize(-FONT_STEP)}
          >
            <Type size={14} />
            <Minus size={10} />
          </button>
          <button
            type="button"
            title={largerFontTitle}
            aria-label={largerFontTitle}
            onClick={() => void adjustFontSize(FONT_STEP)}
          >
            <Type size={14} />
            <Plus size={10} />
          </button>
          <button
            type="button"
            title={lowerOpacityTitle}
            aria-label={lowerOpacityTitle}
            onClick={() => void adjustOpacity(-OPACITY_STEP)}
          >
            <EyeOff size={14} />
          </button>
          <button
            type="button"
            title={higherOpacityTitle}
            aria-label={higherOpacityTitle}
            onClick={() => void adjustOpacity(OPACITY_STEP)}
          >
            <Eye size={14} />
          </button>
          <button type="button" title={closeTitle} aria-label={closeTitle} onClick={() => void closeOverlay()}>
            <X size={14} />
          </button>
        </div>

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
          <div className="desktop-lyrics-overlay__line-stack">
            {previousText ? (
              <p className="desktop-lyrics-overlay__context desktop-lyrics-overlay__context--previous">
                {previousText}
              </p>
            ) : null}
            <p className="desktop-lyrics-overlay__primary">{primaryText}</p>
            {secondaryText ? <p className="desktop-lyrics-overlay__secondary">{secondaryText}</p> : null}
            {nextText ? (
              <p className="desktop-lyrics-overlay__context desktop-lyrics-overlay__context--next">
                {nextText}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

