import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import { migrateBackgroundStorageToManagedMedia, __testOnly__ } from '../backgroundMediaMigration';

const fsMocks = vi.hoisted(() => ({
  BaseDirectory: { AppData: 'AppData' as const },
  createDir: vi.fn(),
  copyFile: vi.fn(),
  exists: vi.fn(),
  writeFile: vi.fn(),
  readTextFile: vi.fn(),
}));

const pathMocks = vi.hoisted(() => ({
  appDataDir: vi.fn(),
  join: vi.fn(),
}));

const tauriMocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn(),
}));

vi.mock('@tauri-apps/api/fs', () => fsMocks);
vi.mock('@tauri-apps/api/path', () => pathMocks);
vi.mock('@tauri-apps/api/tauri', () => tauriMocks);

describe('background media migration', () => {
  beforeEach(() => {
    localStorage.clear();
    fsMocks.createDir.mockReset();
    fsMocks.copyFile.mockReset();
    fsMocks.exists.mockReset();
    fsMocks.writeFile.mockReset();
    fsMocks.readTextFile.mockReset();
    pathMocks.appDataDir.mockReset();
    pathMocks.join.mockReset();
    tauriMocks.convertFileSrc.mockReset();
  });

  it('extracts local paths from asset URLs', () => {
    expect(__testOnly__.extractLocalPathFromBackgroundUrl('asset://localhost/C:/Users/a/b.gif')).toBe('C:/Users/a/b.gif');
    expect(__testOnly__.extractLocalPathFromBackgroundUrl('tauri://localhost/C:/Users/a/b.gif')).toBe('C:/Users/a/b.gif');
    expect(__testOnly__.extractLocalPathFromBackgroundUrl('tauri://localhost/asset?path=C%3A%5CUsers%5Ca%5Cb.gif')).toBe(
      'C:\\Users\\a\\b.gif'
    );
  });

  it('migrates external asset URLs into AppData/background-media', async () => {
    const desktopGifUrl = 'asset://localhost/C:/Users/31625/Desktop/a.gif';
    localStorage.setItem(
      STORAGE_KEYS.BACKGROUND_SETTINGS,
      JSON.stringify({
        maximized: { type: 'image', image: { url: desktopGifUrl, fit: 'cover', position: 'center center', repeat: 'no-repeat' } },
        windowed: { type: 'color', color: '#000' },
      })
    );

    fsMocks.exists.mockResolvedValue(true);
    pathMocks.appDataDir.mockResolvedValue('C:\\AppData\\com.pixelmatrix.player');
    pathMocks.join.mockImplementation(async (...parts: string[]) => parts.join('\\'));
    tauriMocks.convertFileSrc.mockImplementation((path: string) => `asset://localhost/${path.replace(/\\/g, '/')}`);

    const result = await migrateBackgroundStorageToManagedMedia();
    expect(result.migratedSettings).toBe(true);
    expect(result.migratedCount).toBe(1);
    expect(fsMocks.copyFile).toHaveBeenCalledWith('C:/Users/31625/Desktop/a.gif', expect.stringContaining('background-media/background-'), {
      dir: fsMocks.BaseDirectory.AppData,
    });

    const stored = localStorage.getItem(STORAGE_KEYS.BACKGROUND_SETTINGS) || '';
    expect(stored.replace(/\\\\/g, '/')).toContain('background-media/background-');
    expect(stored).not.toContain('/Desktop/');
    expect(fsMocks.writeFile).toHaveBeenCalled();
  });
});
