import { describe, expect, it } from 'vitest';
import type { Magnet } from '../../types/pixel';
import {
  buildEditorMagnet,
  hasMagnetConfigChanges,
  normalizeMagnetVariant,
  parseMagnetSkinPropsDraft,
} from './magnetCreatorModel';

const baseBounds: Magnet['bounds'] = {
  horizontal: {
    start: { source: 'slot', edge: 'start' },
    end: { source: 'slot', edge: 'end' },
  },
  vertical: {
    start: { source: 'slot', edge: 'start' },
    end: { source: 'slot', edge: 'end' },
  },
};

function createSeedMagnet(overrides: Partial<Magnet> = {}): Magnet {
  return {
    id: 'demo',
    type: 'custom',
    name: 'Demo',
    renderer: 'demo-renderer',
    variant: 'compact',
    skinProps: { density: 'compact' },
    anchors: [{ id: 'anchor', gridX: 0, gridY: 0, role: 'anchor' }],
    anchorType: 'single',
    bounds: baseBounds,
    content: '',
    style: {},
    state: 'idle',
    interactions: { draggable: false, clickable: true },
    ...overrides,
  };
}

describe('magnet creator model appearance fields', () => {
  it('normalizes and clears renderer variants', () => {
    expect(normalizeMagnetVariant('  neon ')).toBe('neon');
    expect(normalizeMagnetVariant('   ')).toBeNull();
    expect(normalizeMagnetVariant(null)).toBeNull();
  });

  it('parses skinProps JSON as an object and treats an empty object as cleared', () => {
    expect(parseMagnetSkinPropsDraft('{"showLabel":true}')).toEqual({ showLabel: true });
    expect(parseMagnetSkinPropsDraft('{}')).toBeNull();
    expect(() => parseMagnetSkinPropsDraft('[]')).toThrow('skinProps-must-be-object');
  });

  it('writes and clears variant and skinProps through buildEditorMagnet', () => {
    const seedMagnet = createSeedMagnet();

    const updated = buildEditorMagnet({
      seedMagnet,
      id: seedMagnet.id,
      name: seedMagnet.name,
      anchorType: seedMagnet.anchorType,
      anchors: seedMagnet.anchors,
      bounds: seedMagnet.bounds,
      content: seedMagnet.content,
      style: seedMagnet.style,
      variant: '  neon ',
      skinProps: { glow: true },
    });

    expect(updated.variant).toBe('neon');
    expect(updated.skinProps).toEqual({ glow: true });

    const cleared = buildEditorMagnet({
      seedMagnet: updated,
      id: updated.id,
      name: updated.name,
      anchorType: updated.anchorType,
      anchors: updated.anchors,
      bounds: updated.bounds,
      content: updated.content,
      style: updated.style,
      variant: null,
      skinProps: null,
    });

    expect(cleared.variant).toBeUndefined();
    expect(cleared.skinProps).toBeUndefined();
  });

  it('counts variant and skinProps as edit history changes', () => {
    const previous = createSeedMagnet();
    const next = { ...previous, variant: 'neon' };

    expect(hasMagnetConfigChanges(previous, next)).toBe(true);
  });
});
