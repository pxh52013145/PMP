import { describe, it, expect, beforeEach } from 'vitest';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import { collectReferencedBackgroundMedia } from '../mediaCleanup';

describe('background media cleanup', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('collects referenced managed media from settings and history', () => {
    localStorage.setItem(
      STORAGE_KEYS.BACKGROUND_SETTINGS,
      JSON.stringify({
        maximized: {
          type: 'image',
          image: { url: 'tauri://localhost/C:/AppData/background-media/background-1.png' },
        },
        windowed: {
          type: 'video',
          video: { url: 'asset://localhost/C:/AppData/background-media/background-2.mp4?foo=1' },
        },
      })
    );

    localStorage.setItem(
      STORAGE_KEYS.BACKGROUND_HISTORY,
      JSON.stringify([
        {
          id: 'h1',
          timestamp: Date.now(),
          config: {
            type: 'image',
            image: { url: 'background-media/background-3.png' },
          },
        },
      ])
    );

    const referenced = collectReferencedBackgroundMedia();
    expect(referenced.has('background-media/background-1.png')).toBe(true);
    expect(referenced.has('background-media/background-2.mp4')).toBe(true);
    expect(referenced.has('background-media/background-3.png')).toBe(true);
  });

  it('supports query-param embedded paths (path=...)', () => {
    const encodedPath = encodeURIComponent('C:\\AppData\\background-media\\background-4.webp');

    localStorage.setItem(
      STORAGE_KEYS.BACKGROUND_SETTINGS,
      JSON.stringify({
        maximized: {
          type: 'image',
          image: { url: `tauri://localhost/asset?path=${encodedPath}` },
        },
        windowed: { type: 'color', color: '#000' },
      })
    );

    const referenced = collectReferencedBackgroundMedia();
    expect(referenced.has('background-media/background-4.webp')).toBe(true);
  });

  it('ignores non-managed URLs', () => {
    localStorage.setItem(
      STORAGE_KEYS.BACKGROUND_SETTINGS,
      JSON.stringify({
        maximized: { type: 'image', image: { url: 'https://example.com/a.png' } },
        windowed: { type: 'image', image: { url: 'data:image/png;base64,AAAA' } },
      })
    );

    const referenced = collectReferencedBackgroundMedia();
    expect(Array.from(referenced)).toEqual([]);
  });
});

