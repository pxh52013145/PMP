import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import { persistBackgroundSnapshots, restoreBackgroundSnapshots } from '../backgroundSnapshot';

const fsMocks = vi.hoisted(() => ({
  BaseDirectory: { AppData: 'AppData' as const },
  writeFile: vi.fn(),
  readTextFile: vi.fn(),
  createDir: vi.fn(),
  copyFile: vi.fn(),
  exists: vi.fn(),
  writeBinaryFile: vi.fn(),
}));

vi.mock('@tauri-apps/api/fs', () => fsMocks);

describe('background snapshot', () => {
  beforeEach(() => {
    localStorage.clear();
    fsMocks.writeFile.mockReset();
    fsMocks.readTextFile.mockReset();
  });

  it('persists settings snapshot to AppData', async () => {
    await persistBackgroundSnapshots({
      storageKey: STORAGE_KEYS.BACKGROUND_SETTINGS,
      json: JSON.stringify({ maximized: { type: 'color', color: '#000' }, windowed: { type: 'color', color: '#111' } }),
    });

    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      { path: 'pixel-matrix-background-settings.snapshot.json', contents: expect.any(String) },
      { dir: fsMocks.BaseDirectory.AppData }
    );
  });

  it('persists history snapshot to AppData', async () => {
    await persistBackgroundSnapshots({
      storageKey: STORAGE_KEYS.BACKGROUND_HISTORY,
      json: JSON.stringify([{ id: 'h1', timestamp: Date.now(), config: { type: 'color', color: '#000' } }]),
    });

    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      { path: 'pixel-matrix-background-history.snapshot.json', contents: expect.any(String) },
      { dir: fsMocks.BaseDirectory.AppData }
    );
  });

  it('restores missing localStorage keys from snapshots', async () => {
    fsMocks.readTextFile.mockImplementation(async (path: string) => {
      if (path === 'pixel-matrix-background-settings.snapshot.json') {
        return JSON.stringify({ maximized: { type: 'color', color: '#123' }, windowed: { type: 'color', color: '#456' } });
      }
      if (path === 'pixel-matrix-background-history.snapshot.json') {
        return JSON.stringify([{ id: 'h2', timestamp: 123, config: { type: 'color', color: '#999' } }]);
      }
      throw new Error('not found');
    });

    const restored = await restoreBackgroundSnapshots();
    expect(restored).toEqual({ restoredSettings: true, restoredHistory: true });
    expect(localStorage.getItem(STORAGE_KEYS.BACKGROUND_SETTINGS)).toContain('#123');
    expect(localStorage.getItem(STORAGE_KEYS.BACKGROUND_HISTORY)).toContain('h2');
  });

  it('does not overwrite existing localStorage values', async () => {
    localStorage.setItem(STORAGE_KEYS.BACKGROUND_SETTINGS, JSON.stringify({ maximized: { type: 'color', color: '#000' } }));
    localStorage.setItem(STORAGE_KEYS.BACKGROUND_HISTORY, JSON.stringify([]));

    const restored = await restoreBackgroundSnapshots();
    expect(restored).toEqual({ restoredSettings: false, restoredHistory: false });
    expect(fsMocks.readTextFile).not.toHaveBeenCalled();
  });
});
