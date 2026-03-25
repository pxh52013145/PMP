import { describe, expect, it } from 'vitest';
import type { MagnetConfig } from '../config';
import { applyMagnetConfig } from '../config';
import { createDefaultMagnetLibrary } from '../defaultLibrary';
import { SYSTEM_SPACE1_DEFAULT_ANCHORS_BY_MAGNET_ID } from '../systemLayouts';
import { createBoundsReference, createFixedAxisBounds } from '../layoutPresets';

describe('builtin bounds migration', () => {
  it('migrates horizontal bar thickness axis from slot to span without clobbering the other axis', () => {
    const defaultLibrary = createDefaultMagnetLibrary();
    const defaultDragHandle = defaultLibrary.find((magnet) => magnet.id === 'drag-handle');
    expect(defaultDragHandle).toBeTruthy();
    if (!defaultDragHandle) return;

    const size = Math.abs(defaultDragHandle.bounds.vertical.start.offset ?? 0) + Math.abs(defaultDragHandle.bounds.vertical.end.offset ?? 0);

    const persistedBounds = {
      horizontal: {
        start: { source: 'viewport', edge: 'start' as const },
        end: { source: 'viewport', edge: 'end' as const },
      },
      vertical: {
        start: { source: 'slot', edge: 'center' as const, offset: -size / 2 },
        end: { source: 'slot', edge: 'center' as const, offset: size / 2 },
      },
    } as const;

    const config: MagnetConfig = {
      version: '1.3.0',
      gridSize: { columns: 27, rows: 20 },
      magnets: {
        'drag-handle': {
          anchors: SYSTEM_SPACE1_DEFAULT_ANCHORS_BY_MAGNET_ID['drag-handle'],
          isActive: true,
          bounds: persistedBounds,
        },
      },
      customMagnets: [],
    };

    const applied = applyMagnetConfig(config, defaultLibrary);
    const migrated = applied.magnetLibrary.find((magnet) => magnet.id === 'drag-handle');
    expect(migrated).toBeTruthy();
    if (!migrated) return;

    expect(migrated.bounds.horizontal).toEqual(persistedBounds.horizontal);
    expect(migrated.bounds.vertical).toEqual(defaultDragHandle.bounds.vertical);
  });

  it('migrates minor legacy drag-handle thickness drift (e.g. 38px) back to the default thickness axis', () => {
    const defaultLibrary = createDefaultMagnetLibrary();
    const defaultDragHandle = defaultLibrary.find((magnet) => magnet.id === 'drag-handle');
    expect(defaultDragHandle).toBeTruthy();
    if (!defaultDragHandle) return;

    const persistedBounds = {
      horizontal: {
        start: createBoundsReference('span', 'start'),
        end: createBoundsReference('span', 'end'),
      },
      vertical: {
        start: { source: 'slot', edge: 'center' as const, offset: -18 },
        end: { source: 'slot', edge: 'center' as const, offset: 20 },
      },
    } as const;

    const config: MagnetConfig = {
      version: '1.3.0',
      gridSize: { columns: 27, rows: 20 },
      magnets: {
        'drag-handle': {
          anchors: SYSTEM_SPACE1_DEFAULT_ANCHORS_BY_MAGNET_ID['drag-handle'],
          isActive: true,
          bounds: persistedBounds,
        },
      },
      customMagnets: [],
    };

    const applied = applyMagnetConfig(config, defaultLibrary);
    const migrated = applied.magnetLibrary.find((magnet) => magnet.id === 'drag-handle');
    expect(migrated).toBeTruthy();
    if (!migrated) return;

    expect(migrated.bounds.horizontal).toEqual(persistedBounds.horizontal);
    expect(migrated.bounds.vertical).toEqual(defaultDragHandle.bounds.vertical);
  });

  it('migrates legacy 40px drag-handle bounds to the current default', () => {
    const defaultLibrary = createDefaultMagnetLibrary();
    const defaultDragHandle = defaultLibrary.find((magnet) => magnet.id === 'drag-handle');
    expect(defaultDragHandle).toBeTruthy();
    if (!defaultDragHandle) return;

    const persistedBounds = {
      horizontal: {
        start: createBoundsReference('span', 'start'),
        end: createBoundsReference('span', 'end'),
      },
      vertical: createFixedAxisBounds({ source: 'slot', size: 40 }),
    } as const;

    const config: MagnetConfig = {
      version: '1.3.0',
      gridSize: { columns: 27, rows: 20 },
      magnets: {
        'drag-handle': {
          anchors: SYSTEM_SPACE1_DEFAULT_ANCHORS_BY_MAGNET_ID['drag-handle'],
          isActive: true,
          bounds: persistedBounds,
        },
      },
      customMagnets: [],
    };

    const applied = applyMagnetConfig(config, defaultLibrary);
    const migrated = applied.magnetLibrary.find((magnet) => magnet.id === 'drag-handle');
    expect(migrated).toBeTruthy();
    if (!migrated) return;

    expect(migrated.bounds).toEqual(defaultDragHandle.bounds);
  });

  it('migrates legacy span-based horizontal bar bounds (missing end-cap bleed) to the current default', () => {
    const defaultLibrary = createDefaultMagnetLibrary();
    const defaultDragHandle = defaultLibrary.find((magnet) => magnet.id === 'drag-handle');
    expect(defaultDragHandle).toBeTruthy();
    if (!defaultDragHandle) return;

    const persistedBounds = {
      horizontal: {
        start: createBoundsReference('span', 'start'),
        end: createBoundsReference('span', 'end'),
      },
      vertical: createFixedAxisBounds({ source: 'span', size: 36 }),
    } as const;

    const config: MagnetConfig = {
      version: '1.3.0',
      gridSize: { columns: 27, rows: 20 },
      magnets: {
        'drag-handle': {
          anchors: SYSTEM_SPACE1_DEFAULT_ANCHORS_BY_MAGNET_ID['drag-handle'],
          isActive: true,
          bounds: persistedBounds,
        },
      },
      customMagnets: [],
    };

    const applied = applyMagnetConfig(config, defaultLibrary);
    const migrated = applied.magnetLibrary.find((magnet) => magnet.id === 'drag-handle');
    expect(migrated).toBeTruthy();
    if (!migrated) return;

    expect(migrated.bounds).toEqual(defaultDragHandle.bounds);
  });
});
