import { useCallback } from 'react';
import type { MouseEvent } from 'react';
import { useT } from '../../../i18n';
import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import {
  type DesktopLyricsOverlaySettings,
  normalizeDesktopLyricsFontSize,
  normalizeDesktopLyricsLyricOffsetMs,
  normalizeDesktopLyricsOpacityPercent,
  normalizeDesktopLyricsPositionOffset,
  normalizeDesktopLyricsRegionHeight,
  normalizeDesktopLyricsRegionWidth,
} from './DesktopLyricsButtonModel';

const telemetry = getTelemetryLogger('windowing', 'desktopLyricsButtonLogic');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface DesktopLyricsButtonLogic {
  toggleDesktopLyrics: (
    settings: DesktopLyricsOverlaySettings,
    setEnabled: (next: boolean) => void,
    setClickThrough: (next: boolean) => void,
    event: MouseEvent<HTMLButtonElement>
  ) => Promise<void>;
  applyOverlaySettings: (settings: DesktopLyricsOverlaySettings) => Promise<void>;
  applyClickThrough: (enabled: boolean) => Promise<void>;
  applyFontSize: (fontSize: number) => Promise<void>;
  applyOpacityPercent: (opacityPercent: number) => Promise<void>;
  applyPositionOffset: (offsetX: number, offsetY: number) => Promise<void>;
  applyRegionSize: (width: number, height: number) => Promise<void>;
  applyLyricOffsetMs: (offsetMs: number) => Promise<void>;
  getButtonTitle: (enabled: boolean) => string;
}

export function useDesktopLyricsButtonLogic(): DesktopLyricsButtonLogic {
  const t = useT();

  const applyClickThrough = useCallback(async (enabled: boolean) => {
    if (!isTauriRuntime()) return;
    await invokeWithTelemetry('desktop_lyrics_set_click_through', { enabled }, {
      moduleId: 'windowing',
      component: 'desktopLyricsButtonLogic',
      event: 'desktop-lyrics.button.click-through.set',
    });
  }, []);

  const applyFontSize = useCallback(async (fontSize: number) => {
    if (!isTauriRuntime()) return;
    await invokeWithTelemetry('desktop_lyrics_set_font_size', {
      fontSize: normalizeDesktopLyricsFontSize(fontSize),
    }, {
      moduleId: 'windowing',
      component: 'desktopLyricsButtonLogic',
      event: 'desktop-lyrics.button.font-size.set',
    });
  }, []);

  const applyOpacityPercent = useCallback(async (opacityPercent: number) => {
    if (!isTauriRuntime()) return;
    await invokeWithTelemetry('desktop_lyrics_set_opacity_percent', {
      opacityPercent: normalizeDesktopLyricsOpacityPercent(opacityPercent),
    }, {
      moduleId: 'windowing',
      component: 'desktopLyricsButtonLogic',
      event: 'desktop-lyrics.button.opacity.set',
    });
  }, []);

  const applyPositionOffset = useCallback(async (offsetX: number, offsetY: number) => {
    if (!isTauriRuntime()) return;
    await invokeWithTelemetry('desktop_lyrics_set_position_offset', {
      offsetX: normalizeDesktopLyricsPositionOffset(offsetX),
      offsetY: normalizeDesktopLyricsPositionOffset(offsetY),
    }, {
      moduleId: 'windowing',
      component: 'desktopLyricsButtonLogic',
      event: 'desktop-lyrics.button.position-offset.set',
    });
  }, []);

  const applyRegionSize = useCallback(async (width: number, height: number) => {
    if (!isTauriRuntime()) return;
    await invokeWithTelemetry('desktop_lyrics_set_region_size', {
      width: normalizeDesktopLyricsRegionWidth(width),
      height: normalizeDesktopLyricsRegionHeight(height),
    }, {
      moduleId: 'windowing',
      component: 'desktopLyricsButtonLogic',
      event: 'desktop-lyrics.button.region-size.set',
    });
  }, []);

  const applyLyricOffsetMs = useCallback(async (offsetMs: number) => {
    if (!isTauriRuntime()) return;
    await invokeWithTelemetry('desktop_lyrics_set_lyric_offset_ms', {
      offsetMs: normalizeDesktopLyricsLyricOffsetMs(offsetMs),
    }, {
      moduleId: 'windowing',
      component: 'desktopLyricsButtonLogic',
      event: 'desktop-lyrics.button.lyric-offset.set',
    });
  }, []);

  const applyOverlaySettings = useCallback(
    async (settings: DesktopLyricsOverlaySettings) => {
      if (!isTauriRuntime()) return;

      await applyClickThrough(settings.clickThrough);
      await applyFontSize(settings.fontSize);
      await applyOpacityPercent(settings.opacityPercent);
      await applyPositionOffset(settings.positionOffsetX, settings.positionOffsetY);
      await applyRegionSize(settings.regionWidth, settings.regionHeight);
      await applyLyricOffsetMs(settings.lyricOffsetMs);
      await invokeWithTelemetry('desktop_lyrics_set_visible', { visible: settings.enabled }, {
        moduleId: 'windowing',
        component: 'desktopLyricsButtonLogic',
        event: 'desktop-lyrics.button.visible.set',
      });
    },
    [
      applyClickThrough,
      applyFontSize,
      applyLyricOffsetMs,
      applyOpacityPercent,
      applyPositionOffset,
      applyRegionSize,
    ]
  );

  const toggleDesktopLyrics = useCallback(
    async (
      settings: DesktopLyricsOverlaySettings,
      setEnabled: (next: boolean) => void,
      setClickThrough: (next: boolean) => void,
      event: MouseEvent<HTMLButtonElement>
    ) => {
      event.preventDefault();
      event.stopPropagation();

      try {
        if (!isTauriRuntime()) {
          const fallbackEnabled = !settings.enabled;
          const fallbackClickThrough = fallbackEnabled ? false : settings.clickThrough;
          setEnabled(fallbackEnabled);
          if (settings.clickThrough !== fallbackClickThrough) {
            setClickThrough(fallbackClickThrough);
          }
          return;
        }

        const nextEnabled = await invokeWithTelemetry<boolean>('desktop_lyrics_toggle_visible', undefined, {
          moduleId: 'windowing',
          component: 'desktopLyricsButtonLogic',
          event: 'desktop-lyrics.button.visible.toggle',
        });
        const nextClickThrough = nextEnabled ? false : settings.clickThrough;

        setEnabled(nextEnabled);
        if (settings.clickThrough !== nextClickThrough) {
          setClickThrough(nextClickThrough);
        }

        if (nextEnabled) {
          await applyClickThrough(nextClickThrough);
          await applyFontSize(settings.fontSize);
          await applyOpacityPercent(settings.opacityPercent);
          await applyPositionOffset(settings.positionOffsetX, settings.positionOffsetY);
          await applyRegionSize(settings.regionWidth, settings.regionHeight);
          await applyLyricOffsetMs(settings.lyricOffsetMs);
        }
      } catch (error) {
        setEnabled(settings.enabled);
        setClickThrough(settings.clickThrough);
        telemetry.error('desktop-lyrics.button.visible.toggle.failed', {
          message: getErrorMessage(error),
          fields: {
            enabled: settings.enabled,
            clickThrough: settings.clickThrough,
          },
        });
      }
    },
    [
      applyClickThrough,
      applyFontSize,
      applyLyricOffsetMs,
      applyOpacityPercent,
      applyPositionOffset,
      applyRegionSize,
    ]
  );

  const getButtonTitle = useCallback(
    (enabled: boolean) =>
      enabled
        ? t('magnet.desktopLyricsButton.title.disable')
        : t('magnet.desktopLyricsButton.title.enable'),
    [t]
  );

  return {
    toggleDesktopLyrics,
    applyOverlaySettings,
    applyClickThrough,
    applyFontSize,
    applyOpacityPercent,
    applyPositionOffset,
    applyRegionSize,
    applyLyricOffsetMs,
    getButtonTitle,
  };
}
