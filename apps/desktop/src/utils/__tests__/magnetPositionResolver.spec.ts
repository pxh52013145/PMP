import React from 'react';
import { describe, it, expect } from 'vitest';
import { Magnet } from '../../types/pixel';
import { createDefaultBoundsForMagnet } from '../../modules/magnets/layoutPresets';
import { resolveMagnetPositions, detectConflicts } from '../magnetPositionResolver';

const createMagnet = (id: string, gridX: number): Magnet => ({
  id,
  type: 'custom',
  name: id,
  anchors: [
    {
      id: `${id}-anchor`,
      gridX,
      gridY: 0,
      role: 'anchor',
    },
  ],
  anchorType: 'single',
  bounds: createDefaultBoundsForMagnet('single', {}),
  content: id as unknown as React.ReactNode,
  style: {},
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
  },
});

describe('magnetPositionResolver', () => {
  it('detects conflicts between overlapping magnets', () => {
    const magnets = [createMagnet('a', 0), createMagnet('b', 0)];
    const conflicts = detectConflicts(magnets);
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('resolves magnets positions', () => {
    const magnets = [createMagnet('a', 0), createMagnet('b', 1)];
    const resolved = resolveMagnetPositions(magnets);
    expect(resolved).toHaveLength(2);
  });

  it('does not crash when anchors are missing', () => {
    const invalidHorizontal: Magnet = {
      id: 'wide',
      type: 'custom',
      name: 'wide',
      anchorType: 'horizontal',
      anchors: [],
      bounds: createDefaultBoundsForMagnet('horizontal', {}),
      content: 'wide' as unknown as React.ReactNode,
      style: {},
      state: 'idle',
      interactions: { draggable: false, clickable: true },
    };

    expect(() => detectConflicts([invalidHorizontal, createMagnet('a', 0)])).not.toThrow();
    expect(() => resolveMagnetPositions([invalidHorizontal, createMagnet('a', 0)])).not.toThrow();
  });
});
