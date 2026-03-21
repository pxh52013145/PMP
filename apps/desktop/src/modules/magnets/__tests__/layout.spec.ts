import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import { REQUIRED_MAGNET_IDS } from '../../../constants/magnets';
import {
  ensureMagnetSpaceLayout,
  resolveMagnetLayoutStorageKey,
  sanitizeMagnetSpaceLayout,
} from '../index';

beforeEach(() => {
  localStorage.clear();
});

describe('magnet layout key', () => {
  it('uses the primary key for space1/empty', () => {
    expect(resolveMagnetLayoutStorageKey(undefined)).toBe(STORAGE_KEYS.MAGNET_SPACE_LAYOUT);
    expect(resolveMagnetLayoutStorageKey(null)).toBe(STORAGE_KEYS.MAGNET_SPACE_LAYOUT);
    expect(resolveMagnetLayoutStorageKey('')).toBe(STORAGE_KEYS.MAGNET_SPACE_LAYOUT);
    expect(resolveMagnetLayoutStorageKey('space1')).toBe(STORAGE_KEYS.MAGNET_SPACE_LAYOUT);
    expect(resolveMagnetLayoutStorageKey(' space1 ')).toBe(STORAGE_KEYS.MAGNET_SPACE_LAYOUT);
  });

  it('namespaces non-primary spaces', () => {
    expect(resolveMagnetLayoutStorageKey('space2')).toBe(`${STORAGE_KEYS.MAGNET_SPACE_LAYOUT}:space2`);
    expect(resolveMagnetLayoutStorageKey(' space3 ')).toBe(`${STORAGE_KEYS.MAGNET_SPACE_LAYOUT}:space3`);
  });
});

describe('magnet space layout sanitize', () => {
  it('falls back and ensures required magnets', () => {
    const layout = sanitizeMagnetSpaceLayout({ version: 1, activeMagnetIds: ['btn-debug'], anchorsByMagnetId: {} });
    for (const id of REQUIRED_MAGNET_IDS) {
      expect(layout.activeMagnetIds).toContain(id);
    }
    expect(layout.activeMagnetIds).toContain('btn-debug');
  });

  it('drops invalid anchors', () => {
    const layout = sanitizeMagnetSpaceLayout({
      version: 1,
      activeMagnetIds: [],
      anchorsByMagnetId: {
        'btn-debug': [
          { id: 'a', gridX: 1, gridY: 2, role: 'anchor' },
          { id: '', gridX: 0, gridY: 0, role: 'anchor' },
          { id: 'b', gridX: 'x', gridY: 0, role: 'anchor' },
        ],
      },
    });
    expect(layout.anchorsByMagnetId['btn-debug']).toEqual([{ id: 'a', gridX: 1, gridY: 2, role: 'anchor' }]);
  });
});

describe('ensureMagnetSpaceLayout', () => {
  it('bootstraps a default layout when missing', () => {
    const result = ensureMagnetSpaceLayout('space2');
    expect(result.didCreate).toBe(true);
    expect(result.storageKey).toBe(`${STORAGE_KEYS.MAGNET_SPACE_LAYOUT}:space2`);
    expect(result.layout.activeMagnetIds).toEqual(
      expect.arrayContaining([...REQUIRED_MAGNET_IDS, 'platform-magnet', 'btn-platform-login'])
    );
  });

  it('bootstraps space1 using the system defaults', () => {
    const result = ensureMagnetSpaceLayout('space1');
    expect(result.didCreate).toBe(true);
    expect(result.storageKey).toBe(STORAGE_KEYS.MAGNET_SPACE_LAYOUT);
    expect(result.layout.activeMagnetIds).toContain('btn-debug');
    expect(result.layout.activeMagnetIds).toContain('audio-visualizer');
    expect(result.layout.anchorsByMagnetId['btn-matrix-change']).toEqual([
      { id: 'left', gridX: 2, gridY: 19, role: 'anchor' },
      { id: 'right', gridX: 4, gridY: 19, role: 'boundary' },
    ]);
    expect(result.layout.anchorsByMagnetId['progress-bar']).toEqual([
      { id: 'left', gridX: 6, gridY: 18, role: 'anchor' },
      { id: 'right', gridX: 26, gridY: 18, role: 'boundary' },
    ]);
  });

  it('reuses stored layout when present', () => {
    const key = resolveMagnetLayoutStorageKey('space2');
    localStorage.setItem(key, JSON.stringify({ version: 1, activeMagnetIds: ['btn-debug'], anchorsByMagnetId: {} }));
    const result = ensureMagnetSpaceLayout('space2');
    expect(result.didCreate).toBe(false);
    expect(result.layout.activeMagnetIds).toContain('btn-debug');
    expect(result.layout.activeMagnetIds).not.toContain('platform-magnet');
    expect(result.layout.activeMagnetIds).not.toContain('btn-platform-login');
  });
});
