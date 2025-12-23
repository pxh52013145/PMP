import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import { migrateBackgroundStorageToManagedMedia, __testOnly__ } from '../backgroundMediaMigration';

const fsMocks = vi.hoisted(() => ({
  BaseDirectory: { AppData: 'AppData' as const },
  writeFile: vi.fn(),
  readTextFile: vi.fn(),
}));

const tauriMocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/fs', () => fsMocks);
vi.mock('@tauri-apps/api/tauri', () => tauriMocks);

describe('background media migration', () => {
  beforeEach(() => {
    localStorage.clear();
    fsMocks.writeFile.mockReset();
    fsMocks.readTextFile.mockReset();
    tauriMocks.convertFileSrc.mockReset();
    tauriMocks.invoke.mockReset();
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

    tauriMocks.invoke.mockResolvedValue('C:\\AppData\\com.pixelmatrix.player\\background-media\\background-1.gif');
    tauriMocks.convertFileSrc.mockImplementation((path: string) => `asset://localhost/${path.replace(/\\/g, '/')}`);

    const result = await migrateBackgroundStorageToManagedMedia();
    expect(result.migratedSettings).toBe(true);
    expect(result.migratedCount).toBe(1);
    expect(tauriMocks.invoke).toHaveBeenCalledWith('background_import_media', {
      sourcePath: 'C:/Users/31625/Desktop/a.gif',
      kind: 'image',
    });

    const stored = localStorage.getItem(STORAGE_KEYS.BACKGROUND_SETTINGS) || '';
    expect(stored.replace(/\\\\/g, '/')).toContain('background-media/background-');
    expect(stored).not.toContain('/Desktop/');
    expect(fsMocks.writeFile).toHaveBeenCalled();
  });
});
