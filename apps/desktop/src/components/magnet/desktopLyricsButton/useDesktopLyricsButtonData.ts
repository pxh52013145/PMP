import { useCallback } from 'react';
import { usePersistentSetting } from '../../../modules/storage';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import {
  DESKTOP_LYRICS_DEFAULT_SETTINGS,
  type DesktopLyricsPositionPreset,
  normalizeDesktopLyricsFontSize,
  normalizeDesktopLyricsOpacityPercent,
  normalizeDesktopLyricsPositionPreset,
  normalizeDesktopLyricsPositionOffset,
} from './DesktopLyricsButtonModel';

export interface DesktopLyricsButtonData {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  clickThrough: boolean;
  setClickThrough: (next: boolean) => void;
  fontSize: number;
  setFontSize: (next: number) => void;
  opacityPercent: number;
  setOpacityPercent: (next: number) => void;
  positionPreset: DesktopLyricsPositionPreset;
  setPositionPreset: (next: DesktopLyricsPositionPreset) => void;
  positionOffsetX: number;
  setPositionOffsetX: (next: number) => void;
  positionOffsetY: number;
  setPositionOffsetY: (next: number) => void;
}

export function useDesktopLyricsButtonData(): DesktopLyricsButtonData {
  const [enabledRaw, setEnabledRaw] = usePersistentSetting<boolean>(
    STORAGE_KEYS.DESKTOP_LYRICS_ENABLED,
    DESKTOP_LYRICS_DEFAULT_SETTINGS.enabled,
    {
      format: 'json',
      listenStorageEvents: true,
    }
  );
  const [clickThroughRaw, setClickThroughRaw] = usePersistentSetting<boolean>(
    STORAGE_KEYS.DESKTOP_LYRICS_CLICK_THROUGH,
    DESKTOP_LYRICS_DEFAULT_SETTINGS.clickThrough,
    {
      format: 'json',
      listenStorageEvents: true,
    }
  );
  const [fontSizeRaw, setFontSizeRaw] = usePersistentSetting<number>(
    STORAGE_KEYS.DESKTOP_LYRICS_FONT_SIZE,
    DESKTOP_LYRICS_DEFAULT_SETTINGS.fontSize,
    {
      format: 'json',
      listenStorageEvents: true,
    }
  );
  const [positionPresetRaw, setPositionPresetRaw] = usePersistentSetting<string>(
    STORAGE_KEYS.DESKTOP_LYRICS_POSITION_PRESET,
    DESKTOP_LYRICS_DEFAULT_SETTINGS.positionPreset,
    {
      format: 'json',
      listenStorageEvents: true,
    }
  );
  const [opacityPercentRaw, setOpacityPercentRaw] = usePersistentSetting<number>(
    STORAGE_KEYS.DESKTOP_LYRICS_OPACITY_PERCENT,
    DESKTOP_LYRICS_DEFAULT_SETTINGS.opacityPercent,
    {
      format: 'json',
      listenStorageEvents: true,
    }
  );
  const [positionOffsetXRaw, setPositionOffsetXRaw] = usePersistentSetting<number>(
    STORAGE_KEYS.DESKTOP_LYRICS_POSITION_OFFSET_X,
    DESKTOP_LYRICS_DEFAULT_SETTINGS.positionOffsetX,
    {
      format: 'json',
      listenStorageEvents: true,
    }
  );
  const [positionOffsetYRaw, setPositionOffsetYRaw] = usePersistentSetting<number>(
    STORAGE_KEYS.DESKTOP_LYRICS_POSITION_OFFSET_Y,
    DESKTOP_LYRICS_DEFAULT_SETTINGS.positionOffsetY,
    {
      format: 'json',
      listenStorageEvents: true,
    }
  );

  const enabled = enabledRaw === true;
  const clickThrough = clickThroughRaw !== false;
  const fontSize = normalizeDesktopLyricsFontSize(fontSizeRaw);
  const opacityPercent = normalizeDesktopLyricsOpacityPercent(opacityPercentRaw);
  const positionPreset = normalizeDesktopLyricsPositionPreset(positionPresetRaw);
  const positionOffsetX = normalizeDesktopLyricsPositionOffset(positionOffsetXRaw);
  const positionOffsetY = normalizeDesktopLyricsPositionOffset(positionOffsetYRaw);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledRaw(next === true);
  }, [setEnabledRaw]);

  const setClickThrough = useCallback((next: boolean) => {
    setClickThroughRaw(next === true);
  }, [setClickThroughRaw]);

  const setFontSize = useCallback((next: number) => {
    setFontSizeRaw(normalizeDesktopLyricsFontSize(next));
  }, [setFontSizeRaw]);

  const setOpacityPercent = useCallback((next: number) => {
    setOpacityPercentRaw(normalizeDesktopLyricsOpacityPercent(next));
  }, [setOpacityPercentRaw]);

  const setPositionPreset = useCallback((next: DesktopLyricsPositionPreset) => {
    setPositionPresetRaw(normalizeDesktopLyricsPositionPreset(next));
  }, [setPositionPresetRaw]);

  const setPositionOffsetX = useCallback((next: number) => {
    setPositionOffsetXRaw(normalizeDesktopLyricsPositionOffset(next));
  }, [setPositionOffsetXRaw]);

  const setPositionOffsetY = useCallback((next: number) => {
    setPositionOffsetYRaw(normalizeDesktopLyricsPositionOffset(next));
  }, [setPositionOffsetYRaw]);

  return {
    enabled,
    setEnabled,
    clickThrough,
    setClickThrough,
    fontSize,
    setFontSize,
    opacityPercent,
    setOpacityPercent,
    positionPreset,
    setPositionPreset,
    positionOffsetX,
    setPositionOffsetX,
    positionOffsetY,
    setPositionOffsetY,
  };
}
