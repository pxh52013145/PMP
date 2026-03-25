import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import { ensureMagnetCatalogState, readMagnetCatalogState, sanitizeMagnetCatalogState } from '../catalog';
import type { Magnet } from '../../../types/pixel';
import { createCenteredSingleControlLayoutPreset } from '../layoutPresets';

beforeEach(() => {
  localStorage.clear();
});

function createTestMagnet(id: string): Magnet {
  return {
    id,
    type: 'custom',
    name: id,
    anchors: [{ id: 'a', gridX: 1, gridY: 2, role: 'anchor' }],
    anchorType: 'single',
    bounds: createCenteredSingleControlLayoutPreset().bounds,
    content: id,
    style: { width: '36px', height: '36px' },
    state: 'idle',
    interactions: { draggable: false, clickable: false },
  };
}

describe('magnet catalog', () => {
  it('defaults to empty', () => {
    expect(readMagnetCatalogState().magnets).toEqual([]);
  });

  it('sanitizes invalid input and drops builtin ids', () => {
    const state = sanitizeMagnetCatalogState({
      version: 1,
      magnets: [
        { id: 'btn-play-pause', anchors: [{ id: 'a', gridX: 0, gridY: 0, role: 'anchor' }] },
        { id: ' custom-1 ', anchors: [{ id: 'a', gridX: 0, gridY: 0, role: 'anchor' }] },
        { id: 'custom-1', anchors: [{ id: 'a', gridX: 0, gridY: 0, role: 'anchor' }] },
        { id: '', anchors: [{ id: 'a', gridX: 0, gridY: 0, role: 'anchor' }] },
        { id: 'missing-anchors' },
      ],
    });
    expect(state.magnets.map((m) => m.id)).toEqual(['custom-1', 'missing-anchors']);
  });

  it('creates an empty catalog when missing', () => {
    const result = ensureMagnetCatalogState();
    expect(result.didCreate).toBe(true);
    expect(result.state.magnets).toEqual([]);

    const persisted = readMagnetCatalogState();
    expect(persisted.magnets).toEqual([]);
  });

  it('reuses existing catalog', () => {
    localStorage.setItem(
      STORAGE_KEYS.MAGNET_CATALOG,
      JSON.stringify({ version: 1, magnets: [createTestMagnet('custom-1')] })
    );
    const result = ensureMagnetCatalogState();
    expect(result.didCreate).toBe(false);
    expect(result.state.magnets.map((m) => m.id)).toEqual(['custom-1']);
  });
});
