import { describe, expect, it } from 'vitest';
import { BUILTIN_MAGNET_ID_LIST, REQUIRED_MAGNET_IDS } from '../../../constants/magnets';
import { MATRIX_CONFIG } from '../../../constants/config';
import type { PixelAnchor } from '../../../types/pixel';
import { createDefaultMagnetLibrary } from '../defaultLibrary';
import { createDefaultMagnetSpaceLayout } from '../layoutStorage';

function assertAnchorsInGridRange(anchors: PixelAnchor[] | undefined): void {
  expect(Array.isArray(anchors)).toBe(true);
  expect((anchors ?? []).length).toBeGreaterThan(0);
  for (const anchor of anchors ?? []) {
    expect(anchor.role === 'anchor' || anchor.role === 'boundary').toBe(true);
    expect(anchor.gridX).toBeGreaterThanOrEqual(0);
    expect(anchor.gridY).toBeGreaterThanOrEqual(0);
    expect(anchor.gridX).toBeLessThan(MATRIX_CONFIG.COLUMNS);
    expect(anchor.gridY).toBeLessThan(MATRIX_CONFIG.ROWS);
  }
}

describe('builtin magnet compliance', () => {
  it('default library and builtin id list stay in sync', () => {
    const defaultLibrary = createDefaultMagnetLibrary();
    const libraryIds = defaultLibrary.map((item) => item.id);
    const libraryIdSet = new Set(libraryIds);
    const builtinIdSet = new Set<string>(BUILTIN_MAGNET_ID_LIST);

    expect(libraryIds.length).toBe(libraryIdSet.size);

    const missingInLibrary = [...builtinIdSet].filter((id) => !libraryIdSet.has(id));
    const unknownInLibrary = [...libraryIdSet].filter((id) => !builtinIdSet.has(id));

    expect(missingInLibrary).toEqual([]);
    expect(unknownInLibrary).toEqual([]);
  });

  it('space1 layout keeps required magnets active and anchored', () => {
    const layout = createDefaultMagnetSpaceLayout('space1');
    const active = new Set(layout.activeMagnetIds);

    for (const id of REQUIRED_MAGNET_IDS) {
      expect(active.has(id)).toBe(true);
      assertAnchorsInGridRange(layout.anchorsByMagnetId[id]);
    }
  });

  it('space2 layout includes platform magnets with valid anchors', () => {
    const layout = createDefaultMagnetSpaceLayout('space2');
    const active = new Set(layout.activeMagnetIds);

    expect(active.has('platform-magnet')).toBe(true);
    expect(active.has('btn-platform-login')).toBe(true);

    assertAnchorsInGridRange(layout.anchorsByMagnetId['platform-magnet']);
    assertAnchorsInGridRange(layout.anchorsByMagnetId['btn-platform-login']);
  });
});
