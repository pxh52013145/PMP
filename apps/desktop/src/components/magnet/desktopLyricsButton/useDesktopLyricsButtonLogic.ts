import { invoke } from '@tauri-apps/api/tauri';
import { useCallback } from 'react';
import type { MouseEvent } from 'react';
import { useT } from '../../../i18n';
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
    await invoke('desktop_lyrics_set_click_through', { enabled });
  }, []);

  const applyFontSize = useCallback(async (fontSize: number) => {
    if (!isTauriRuntime()) return;
    await invoke('desktop_lyrics_set_font_size', {
      fontSize: normalizeDesktopLyricsFontSize(fontSize),
    });
  }, []);

  const applyOpacityPercent = useCallback(async (opacityPercent: number) => {
    if (!isTauriRuntime()) return;
    await invoke('desktop_lyrics_set_opacity_percent', {
      opacityPercent: normalizeDesktopLyricsOpacityPercent(opacityPercent),
    });
  }, []);

  const applyPositionOffset = useCallback(async (offsetX: number, offsetY: number) => {
    if (!isTauriRuntime()) return;
    await invoke('desktop_lyrics_set_position_offset', {
      offsetX: normalizeDesktopLyricsPositionOffset(offsetX),
      offsetY: normalizeDesktopLyricsPositionOffset(offsetY),
    });
  }, []);

  const applyRegionSize = useCallback(async (width: number, height: number) => {
    if (!isTauriRuntime()) return;
    await invoke('desktop_lyrics_set_region_size', {
      width: normalizeDesktopLyricsRegionWidth(width),
      height: normalizeDesktopLyricsRegionHeight(height),
    });
  }, []);

  const applyLyricOffsetMs = useCallback(async (offsetMs: number) => {
    if (!isTauriRuntime()) return;
    await invoke('desktop_lyrics_set_lyric_offset_ms', {
      offsetMs: normalizeDesktopLyricsLyricOffsetMs(offsetMs),
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
      await invoke('desktop_lyrics_set_visible', { visible: settings.enabled });
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

      const nextEnabled = !settings.enabled;
      const nextClickThrough = nextEnabled ? false : settings.clickThrough;
      setEnabled(nextEnabled);
      if (settings.clickThrough !== nextClickThrough) {
        setClickThrough(nextClickThrough);
      }

      try {
        await applyOverlaySettings({
          ...settings,
          enabled: nextEnabled,
          clickThrough: nextClickThrough,
        });
      } catch (error) {
        setEnabled(settings.enabled);
        if (settings.clickThrough !== nextClickThrough) {
          setClickThrough(settings.clickThrough);
        }
        console.error('[desktop-lyrics-button] failed to toggle desktop lyrics:', error);
      }
    },
    [applyOverlaySettings]
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
