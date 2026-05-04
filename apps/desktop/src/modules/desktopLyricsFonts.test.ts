import { describe, expect, it } from 'vitest';

import {
  createDesktopLyricsFontConfig,
  DESKTOP_LYRICS_DEFAULT_FONT_STACK,
  formatDesktopLyricsFontStack,
  normalizeDesktopLyricsFontConfig,
} from './desktopLyricsFonts';

describe('desktopLyricsFonts', () => {
  it('formats the default stack when no custom font family is present', () => {
    expect(formatDesktopLyricsFontStack(null)).toBe(DESKTOP_LYRICS_DEFAULT_FONT_STACK);
    expect(formatDesktopLyricsFontStack('')).toBe(DESKTOP_LYRICS_DEFAULT_FONT_STACK);
  });

  it('keeps a custom family at the front of the stack', () => {
    expect(formatDesktopLyricsFontStack('PMPDesktopLyrics_test')).toContain('"PMPDesktopLyrics_test"');
  });

  it('creates configs with a readable display name', () => {
    const config = createDesktopLyricsFontConfig({
      path: '/tmp/fonts/current-font',
      fileName: 'SourceHanSansSC-Regular.otf',
      displayName: 'Source Han Sans SC',
      sourceBytes: 1024,
    });

    expect(config.displayName).toBe('Source Han Sans SC');
    expect(config.label).toBe('SourceHanSansSC-Regular');
    expect(config.family).toContain('PMPDesktopLyrics_');
    expect(config.sourceBytes).toBe(1024);
  });

  it('normalizes persisted configs and backfills the display name', () => {
    const config = normalizeDesktopLyricsFontConfig({
      id: 'font-id',
      family: 'PMPDesktopLyrics_font-id',
      label: 'Font File Label',
      fileName: 'FontFile.ttf',
      path: '/tmp/fonts/current-font',
      importedAt: 1710000000000,
    });

    expect(config?.displayName).toBe('Font File Label');
    expect(config?.family).toBe('PMPDesktopLyrics_font-id');
  });
});
