import { invoke } from '@tauri-apps/api/tauri';
import { useCallback } from 'react';
import type { MouseEvent } from 'react';
import { useT } from '../../../i18n';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import {
  type DesktopLyricsOverlaySettings,
  type DesktopLyricsPositionPreset,
  normalizeDesktopLyricsFontSize,
  normalizeDesktopLyricsOpacityPercent,
  normalizeDesktopLyricsPositionPreset,
  normalizeDesktopLyricsPositionOffset,
} from './DesktopLyricsButtonModel';

export interface DesktopLyricsButtonLogic {
  toggleDesktopLyrics: (
    settings: DesktopLyricsOverlaySettings,
    setEnabled: (next: boolean) => void,
    event: MouseEvent<HTMLButtonElement>
  ) => Promise<void>;
  applyOverlaySettings: (settings: DesktopLyricsOverlaySettings) => Promise<void>;
  applyClickThrough: (enabled: boolean) => Promise<void>;
  applyFontSize: (fontSize: number) => Promise<void>;
  applyOpacityPercent: (opacityPercent: number) => Promise<void>;
  applyPositionPreset: (preset: DesktopLyricsPositionPreset) => Promise<void>;
  applyPositionOffset: (offsetX: number, offsetY: number) => Promise<void>;
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

  const applyPositionPreset = useCallback(async (preset: DesktopLyricsPositionPreset) => {
    if (!isTauriRuntime()) return;
    await invoke('desktop_lyrics_set_position_preset', {
      preset: normalizeDesktopLyricsPositionPreset(preset),
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

  const applyOverlaySettings = useCallback(
    async (settings: DesktopLyricsOverlaySettings) => {
      if (!isTauriRuntime()) return;

      await applyClickThrough(settings.clickThrough);
      await applyFontSize(settings.fontSize);
      await applyOpacityPercent(settings.opacityPercent);
      await applyPositionPreset(settings.positionPreset);
      await applyPositionOffset(settings.positionOffsetX, settings.positionOffsetY);
      await invoke('desktop_lyrics_set_visible', { visible: settings.enabled });
    },
    [
      applyClickThrough,
      applyFontSize,
      applyOpacityPercent,
      applyPositionOffset,
      applyPositionPreset,
    ]
  );

  const toggleDesktopLyrics = useCallback(
    async (
      settings: DesktopLyricsOverlaySettings,
      setEnabled: (next: boolean) => void,
      event: MouseEvent<HTMLButtonElement>
    ) => {
      event.preventDefault();
      event.stopPropagation();

      const nextEnabled = !settings.enabled;
      setEnabled(nextEnabled);

      try {
        await applyOverlaySettings({
          ...settings,
          enabled: nextEnabled,
        });
      } catch (error) {
        setEnabled(settings.enabled);
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
    applyPositionPreset,
    applyPositionOffset,
    getButtonTitle,
  };
}
