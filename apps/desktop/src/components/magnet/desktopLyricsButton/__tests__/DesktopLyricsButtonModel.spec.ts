import { describe, expect, it } from 'vitest';
import {
  DESKTOP_LYRICS_DEFAULT_SETTINGS,
  normalizeDesktopLyricsLyricOffsetMs,
  normalizeDesktopLyricsRegionHeight,
  normalizeDesktopLyricsRegionWidth,
} from '../DesktopLyricsButtonModel';

describe('DesktopLyricsButtonModel', () => {
  it('keeps default lyric offset as zero', () => {
    expect(DESKTOP_LYRICS_DEFAULT_SETTINGS.lyricOffsetMs).toBe(0);
  });

  it('normalizes lyric offset into supported range', () => {
    expect(normalizeDesktopLyricsLyricOffsetMs(-9_999)).toBe(-5000);
    expect(normalizeDesktopLyricsLyricOffsetMs(-250)).toBe(-250);
    expect(normalizeDesktopLyricsLyricOffsetMs(0)).toBe(0);
    expect(normalizeDesktopLyricsLyricOffsetMs(375)).toBe(375);
    expect(normalizeDesktopLyricsLyricOffsetMs(9_999)).toBe(5000);
  });

  it('falls back to default for invalid lyric offset values', () => {
    expect(normalizeDesktopLyricsLyricOffsetMs(Number.NaN)).toBe(0);
    expect(normalizeDesktopLyricsLyricOffsetMs(undefined)).toBe(0);
    expect(normalizeDesktopLyricsLyricOffsetMs('120')).toBe(0);
  });

  it('normalizes region size and supports auto mode', () => {
    expect(normalizeDesktopLyricsRegionWidth(0)).toBe(0);
    expect(normalizeDesktopLyricsRegionHeight(0)).toBe(0);
    expect(normalizeDesktopLyricsRegionWidth(1)).toBe(320);
    expect(normalizeDesktopLyricsRegionHeight(1)).toBe(72);
    expect(normalizeDesktopLyricsRegionWidth(99999)).toBe(8192);
    expect(normalizeDesktopLyricsRegionHeight(99999)).toBe(2160);
  });

  it('falls back to region defaults for invalid size values', () => {
    expect(normalizeDesktopLyricsRegionWidth(Number.NaN)).toBe(
      DESKTOP_LYRICS_DEFAULT_SETTINGS.regionWidth
    );
    expect(normalizeDesktopLyricsRegionHeight(undefined)).toBe(
      DESKTOP_LYRICS_DEFAULT_SETTINGS.regionHeight
    );
  });
});
