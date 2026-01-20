import { describe, it, expect, beforeEach, vi } from 'vitest';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import { collectReferencedBackgroundMedia, gcOrphanBackgroundMedia } from '../mediaCleanup';

const fsMocks = vi.hoisted(() => ({
  BaseDirectory: { AppData: 'AppData' as const },
  readDir: vi.fn(),
  removeFile: vi.fn(),
}));

vi.mock('@tauri-apps/api/fs', () => fsMocks);

describe('background media cleanup', () => {
  beforeEach(() => {
    localStorage.clear();
    fsMocks.readDir.mockReset();
    fsMocks.removeFile.mockReset();
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

  it('supports Windows convertFileSrc URLs (https://asset.localhost/...)', () => {
    const encodedPath = encodeURIComponent('C:\\AppData\\background-media\\background-5.png');

    localStorage.setItem(
      STORAGE_KEYS.BACKGROUND_SETTINGS,
      JSON.stringify({
        maximized: {
          type: 'image',
          image: { url: `https://asset.localhost/${encodedPath}` },
        },
        windowed: { type: 'color', color: '#000' },
      })
    );

    const referenced = collectReferencedBackgroundMedia();
    expect(referenced.has('background-media/background-5.png')).toBe(true);
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

  it('gc never deletes when background storage is not ready', async () => {
    fsMocks.readDir.mockResolvedValue([
      { path: 'C:/AppData/background-media/background-1.png' },
      { path: 'C:/AppData/background-media/background-2.png' },
    ]);

    const result = await gcOrphanBackgroundMedia();
    expect(result).toEqual({ scanned: 2, removed: 0 });
    expect(fsMocks.removeFile).not.toHaveBeenCalled();
  });

  it('gc does not delete before history snapshot restore completes', async () => {
    localStorage.setItem(
      STORAGE_KEYS.BACKGROUND_SETTINGS,
      JSON.stringify({
        maximized: {
          type: 'image',
          image: { url: 'background-media/background-keep.png' },
        },
        windowed: { type: 'color', color: '#000' },
      })
    );

    fsMocks.readDir.mockResolvedValue([
      { path: 'C:/AppData/background-media/background-keep.png' },
      { path: 'C:/AppData/background-media/background-orphan.png' },
    ]);

    const result = await gcOrphanBackgroundMedia();
    expect(result).toEqual({ scanned: 2, removed: 0 });
    expect(fsMocks.removeFile).not.toHaveBeenCalled();
  });

  it('gc deletes unreferenced files once storage is ready', async () => {
    localStorage.setItem(
      STORAGE_KEYS.BACKGROUND_SETTINGS,
      JSON.stringify({
        maximized: {
          type: 'image',
          image: { url: 'background-media/background-keep.png' },
        },
        windowed: { type: 'color', color: '#000' },
      })
    );
    localStorage.setItem(STORAGE_KEYS.BACKGROUND_HISTORY, JSON.stringify([]));

    fsMocks.readDir.mockResolvedValue([
      { path: 'C:/AppData/background-media/background-keep.png' },
      { path: 'C:/AppData/background-media/background-orphan.png' },
    ]);

    const result = await gcOrphanBackgroundMedia();
    expect(result).toEqual({ scanned: 2, removed: 1 });
    expect(fsMocks.removeFile).toHaveBeenCalledTimes(1);
    expect(fsMocks.removeFile).toHaveBeenCalledWith('background-media/background-orphan.png', {
      dir: fsMocks.BaseDirectory.AppData,
    });
  });
});
