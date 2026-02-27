export const DESKTOP_LYRICS_POSITION_PRESET_LIST = [
  'bottom-center',
  'bottom-left',
  'bottom-right',
  'top-center',
] as const;

export type DesktopLyricsPositionPreset =
  (typeof DESKTOP_LYRICS_POSITION_PRESET_LIST)[number];

export interface DesktopLyricsOverlaySettings {
  enabled: boolean;
  clickThrough: boolean;
  fontSize: number;
  opacityPercent: number;
  positionPreset: DesktopLyricsPositionPreset;
  positionOffsetX: number;
  positionOffsetY: number;
  regionWidth: number;
  regionHeight: number;
  lyricOffsetMs: number;
}

export const DESKTOP_LYRICS_DEFAULT_SETTINGS: DesktopLyricsOverlaySettings = {
  enabled: false,
  clickThrough: false,
  fontSize: 26,
  opacityPercent: 92,
  positionPreset: 'bottom-center',
  positionOffsetX: 0,
  positionOffsetY: 0,
  regionWidth: 0,
  regionHeight: 0,
  lyricOffsetMs: 0,
};

export const DESKTOP_LYRICS_MIN_FONT_SIZE = 16;
export const DESKTOP_LYRICS_MAX_FONT_SIZE = 56;
export const DESKTOP_LYRICS_MIN_OPACITY_PERCENT = 35;
export const DESKTOP_LYRICS_MAX_OPACITY_PERCENT = 100;
export const DESKTOP_LYRICS_MAX_POSITION_OFFSET = 16384;
export const DESKTOP_LYRICS_MIN_REGION_WIDTH = 320;
export const DESKTOP_LYRICS_MAX_REGION_WIDTH = 8192;
export const DESKTOP_LYRICS_MIN_REGION_HEIGHT = 72;
export const DESKTOP_LYRICS_MAX_REGION_HEIGHT = 2160;
export const DESKTOP_LYRICS_MIN_LYRIC_OFFSET_MS = -5000;
export const DESKTOP_LYRICS_MAX_LYRIC_OFFSET_MS = 5000;

export function isDesktopLyricsPositionPreset(
  value: unknown
): value is DesktopLyricsPositionPreset {
  return (
    typeof value === 'string' &&
    (DESKTOP_LYRICS_POSITION_PRESET_LIST as readonly string[]).includes(value)
  );
}

export function normalizeDesktopLyricsPositionPreset(
  value: unknown
): DesktopLyricsPositionPreset {
  if (isDesktopLyricsPositionPreset(value)) {
    return value;
  }
  return DESKTOP_LYRICS_DEFAULT_SETTINGS.positionPreset;
}

export function normalizeDesktopLyricsFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DESKTOP_LYRICS_DEFAULT_SETTINGS.fontSize;
  }

  return Math.round(
    Math.min(DESKTOP_LYRICS_MAX_FONT_SIZE, Math.max(DESKTOP_LYRICS_MIN_FONT_SIZE, value))
  );
}

export function normalizeDesktopLyricsOpacityPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DESKTOP_LYRICS_DEFAULT_SETTINGS.opacityPercent;
  }

  return Math.round(
    Math.min(
      DESKTOP_LYRICS_MAX_OPACITY_PERCENT,
      Math.max(DESKTOP_LYRICS_MIN_OPACITY_PERCENT, value)
    )
  );
}

export function normalizeDesktopLyricsPositionOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.round(
    Math.min(DESKTOP_LYRICS_MAX_POSITION_OFFSET, Math.max(-DESKTOP_LYRICS_MAX_POSITION_OFFSET, value))
  );
}

export function normalizeDesktopLyricsRegionWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DESKTOP_LYRICS_DEFAULT_SETTINGS.regionWidth;
  }

  if (value <= 0) {
    return DESKTOP_LYRICS_DEFAULT_SETTINGS.regionWidth;
  }

  return Math.round(
    Math.min(DESKTOP_LYRICS_MAX_REGION_WIDTH, Math.max(DESKTOP_LYRICS_MIN_REGION_WIDTH, value))
  );
}

export function normalizeDesktopLyricsRegionHeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DESKTOP_LYRICS_DEFAULT_SETTINGS.regionHeight;
  }

  if (value <= 0) {
    return DESKTOP_LYRICS_DEFAULT_SETTINGS.regionHeight;
  }

  return Math.round(
    Math.min(
      DESKTOP_LYRICS_MAX_REGION_HEIGHT,
      Math.max(DESKTOP_LYRICS_MIN_REGION_HEIGHT, value)
    )
  );
}

export function normalizeDesktopLyricsLyricOffsetMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DESKTOP_LYRICS_DEFAULT_SETTINGS.lyricOffsetMs;
  }

  return Math.round(
    Math.min(
      DESKTOP_LYRICS_MAX_LYRIC_OFFSET_MS,
      Math.max(DESKTOP_LYRICS_MIN_LYRIC_OFFSET_MS, value)
    )
  );
}
