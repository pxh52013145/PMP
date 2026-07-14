import { describe, expect, it } from 'vitest';
import type { Magnet } from '../../types/pixel';
import {
  buildEditorMagnet,
  buildMagnetGridFootprint,
  hasMagnetConfigChanges,
  normalizeMagnetVariant,
  parseMagnetSkinPropsDraft,
  resolveMagnetAnchorDraftDimensions,
  resolveMagnetAnchorOrigin,
  resolvePreviewAnchorOrigin,
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
  it('resolves empty-anchor magnets from their grid footprint', () => {
    const magnet = createSeedMagnet({
      anchorType: 'rectangular',
      anchors: [],
      gridFootprint: { width: 6, height: 8 },
    });

    expect(resolveMagnetAnchorOrigin(magnet)).toEqual({ x: 10, y: 10 });
    expect(resolveMagnetAnchorDraftDimensions(magnet)).toEqual({
      horizontalPixels: 6,
      verticalPixels: 8,
      rectWidth: 6,
      rectHeight: 8,
    });
  });

  it('derives dimensions without assuming a fixed anchor count', () => {
    const magnet = createSeedMagnet({
      anchorType: 'rectangular',
      anchors: [
        { id: 'start', gridX: 3, gridY: 4, role: 'anchor' },
        { id: 'end', gridX: 7, gridY: 9, role: 'boundary' },
      ],
    });

    expect(resolveMagnetAnchorDraftDimensions(magnet)).toMatchObject({
      rectWidth: 5,
      rectHeight: 6,
    });
  });

  it('builds a footprint from editor anchor dimensions', () => {
    expect(
      buildMagnetGridFootprint('horizontal', {
        horizontalPixels: 5,
        verticalPixels: 2,
        rectWidth: 3,
        rectHeight: 4,
      })
    ).toEqual({ width: 5, height: 1 });
  });

  it('centers large footprints inside the preview grid', () => {
    expect(
      resolvePreviewAnchorOrigin('rectangular', {
        horizontalPixels: 1,
        verticalPixels: 1,
        rectWidth: 27,
        rectHeight: 17,
      })
    ).toEqual({ x: 1, y: 6 });
  });

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
