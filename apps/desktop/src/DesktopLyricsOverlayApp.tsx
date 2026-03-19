import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { appWindow } from '@tauri-apps/api/window';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

interface DesktopLyricsOverlayTextPayload {
  primary: string;
  secondary?: string | null;
}

interface DesktopLyricsOverlaySyncPayload {
  visible: boolean;
  clickThrough: boolean;
  fontSize: number;
  opacityPercent: number;
  text?: DesktopLyricsOverlayTextPayload | null;
}

const DEFAULT_OVERLAY_STATE: DesktopLyricsOverlaySyncPayload = {
  visible: true,
  clickThrough: false,
  fontSize: 26,
  opacityPercent: 92,
  text: null,
};

const telemetry = getTelemetryLogger('windowing', 'DesktopLyricsOverlayApp');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeState(
  payload: Partial<DesktopLyricsOverlaySyncPayload> | null | undefined,
  fallback: DesktopLyricsOverlaySyncPayload
): DesktopLyricsOverlaySyncPayload {
  const nextFontSizeRaw = payload?.fontSize;
  const nextOpacityRaw = payload?.opacityPercent;

  const nextFontSize =
    typeof nextFontSizeRaw === 'number' && Number.isFinite(nextFontSizeRaw)
      ? Math.round(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, nextFontSizeRaw)))
      : fallback.fontSize;

  const nextOpacity =
    typeof nextOpacityRaw === 'number' && Number.isFinite(nextOpacityRaw)
      ? Math.round(Math.min(MAX_OPACITY_PERCENT, Math.max(MIN_OPACITY_PERCENT, nextOpacityRaw)))
      : fallback.opacityPercent;

  const text = payload?.text;
  const normalizedText =
    text && typeof text.primary === 'string' && text.primary.trim().length > 0
      ? {
          primary: text.primary,
          secondary: typeof text.secondary === 'string' ? text.secondary : null,
        }
      : null;

  return {
    visible: payload?.visible ?? fallback.visible,
    clickThrough: payload?.clickThrough ?? fallback.clickThrough,
    fontSize: nextFontSize,
    opacityPercent: nextOpacity,
    text: normalizedText,
  };
}

export function DesktopLyricsOverlayApp() {
  const t = useT();
  const [state, setState] = useState<DesktopLyricsOverlaySyncPayload>(DEFAULT_OVERLAY_STATE);

  useEffect(() => {
    document.documentElement.classList.add('desktop-lyrics-overlay-page');
    document.body.classList.add('desktop-lyrics-overlay-page');

    return () => {
      document.documentElement.classList.remove('desktop-lyrics-overlay-page');
      document.body.classList.remove('desktop-lyrics-overlay-page');
    };
  }, []);

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

  const handleStartDragging = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    void appWindow.startDragging().catch(() => {
      // noop
    });
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
  }, [state.fontSize]);

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

  const rootStyle = useMemo<React.CSSProperties>(
    () => ({
      ['--desktop-lyrics-font-size' as string]: `${state.fontSize}px`,
      ['--desktop-lyrics-bg-alpha' as string]: `${state.opacityPercent / 100}`,
    }),
    [state.fontSize, state.opacityPercent]
  );

  const primaryText = state.text?.primary?.trim() || t('pages.track.lyrics.placeholder');
  const secondaryText = state.text?.secondary?.trim();

  return (
    <div className="desktop-lyrics-overlay" style={rootStyle} onMouseDown={handleStartDragging}>
      <div className="desktop-lyrics-overlay__background" aria-hidden="true" />

      <div className="desktop-lyrics-overlay__toolbar" onMouseDown={handleStartDragging}>
        <button
          type="button"
          title={
            state.clickThrough
              ? t('magnet.desktopLyricsButton.contextMenu.clickThrough.disable')
              : t('magnet.desktopLyricsButton.contextMenu.clickThrough.enable')
          }
          onClick={() => void toggleClickThrough()}
        >
          CT
        </button>
        <button
          type="button"
          title={t('magnet.desktopLyricsButton.contextMenu.fontSize.small')}
          onClick={() => void adjustFontSize(-FONT_STEP)}
        >
          A-
        </button>
        <button
          type="button"
          title={t('magnet.desktopLyricsButton.contextMenu.fontSize.large')}
          onClick={() => void adjustFontSize(FONT_STEP)}
        >
          A+
        </button>
        <button
          type="button"
          title={t('magnet.desktopLyricsButton.contextMenu.opacity.p60')}
          onClick={() => void adjustOpacity(-OPACITY_STEP)}
        >
          O-
        </button>
        <button
          type="button"
          title={t('magnet.desktopLyricsButton.contextMenu.opacity.p100')}
          onClick={() => void adjustOpacity(OPACITY_STEP)}
        >
          O+
        </button>
        <button type="button" title={t('magnet.desktopLyricsButton.title.disable')} onClick={() => void closeOverlay()}>
          X
        </button>
      </div>

      <div className="desktop-lyrics-overlay__content" aria-live="polite">
        <p className="desktop-lyrics-overlay__primary">{primaryText}</p>
        {secondaryText ? <p className="desktop-lyrics-overlay__secondary">{secondaryText}</p> : null}
      </div>
    </div>
  );
}

