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
  it('uses legacy key for space1/empty', () => {
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
    expect(result.layout.activeMagnetIds).toEqual([...REQUIRED_MAGNET_IDS]);
  });

  it('migrates active + anchors from legacy config (space2 keeps strict blank)', () => {
    const legacyConfig = {
      version: '1.1.0',
      gridSize: { columns: 10, rows: 10 },
      magnets: {
        'btn-debug': {
          anchors: [{ id: 'a', gridX: 1, gridY: 2, role: 'anchor' }],
          isActive: true,
        },
      },
      customMagnets: [],
    };
    localStorage.setItem(`${STORAGE_KEYS.CONFIG}:space2`, JSON.stringify(legacyConfig));

    const result = ensureMagnetSpaceLayout('space2');
    expect(result.didCreate).toBe(true);
    expect(result.layout.activeMagnetIds).toContain('btn-debug');
    expect(result.layout.activeMagnetIds).not.toContain('btn-play-pause');
    expect(result.layout.anchorsByMagnetId['btn-debug']).toEqual([{ id: 'a', gridX: 1, gridY: 2, role: 'anchor' }]);
  });

  it('migrates legacy config and backfills default-active magnets for space1', () => {
    const legacyConfig = {
      version: '1.1.0',
      gridSize: { columns: 10, rows: 10 },
      magnets: {
        'btn-debug': {
          anchors: [{ id: 'a', gridX: 1, gridY: 2, role: 'anchor' }],
          isActive: false,
        },
      },
      customMagnets: [],
    };
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(legacyConfig));

    const result = ensureMagnetSpaceLayout('space1');
    expect(result.didCreate).toBe(true);
    expect(result.layout.activeMagnetIds).toContain('btn-play-pause');
    expect(result.layout.activeMagnetIds).not.toContain('btn-debug');
  });

  it('reuses stored layout when present', () => {
    const key = resolveMagnetLayoutStorageKey('space2');
    localStorage.setItem(key, JSON.stringify({ version: 1, activeMagnetIds: ['btn-debug'], anchorsByMagnetId: {} }));
    const result = ensureMagnetSpaceLayout('space2');
    expect(result.didCreate).toBe(false);
    expect(result.layout.activeMagnetIds).toContain('btn-debug');
  });
});
