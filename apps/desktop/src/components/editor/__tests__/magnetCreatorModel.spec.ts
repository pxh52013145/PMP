import { describe, expect, it } from 'vitest';
import type { Magnet } from '../../../types/pixel';
import {
  buildAnchorsFromOrigin,
  buildEditorMagnet,
  getPreviewScaleFromBounds,
  hasMagnetConfigChanges,
} from '../magnetCreatorModel';

const dimensions = {
  horizontalPixels: 5,
  verticalPixels: 3,
  rectWidth: 4,
  rectHeight: 2,
};

function createSeedMagnet(): Magnet {
  return {
    id: 'seed',
    type: 'navigation',
    name: 'Seed Magnet',
    anchorType: 'single',
    anchors: [{ id: 'anchor', gridX: 1, gridY: 2, role: 'anchor' }],
    boundsOutset: { top: 9 },
    boundsAlign: { topToMagnetId: 'btn-back' },
    content: 'Seed',
    style: { width: '36px', height: '36px' },
    chrome: { enabled: true },
    state: 'idle',
    interactions: {
      draggable: true,
      clickable: false,
    },
  };
}

describe('magnetCreatorModel', () => {
  it('builds anchors from origin for rectangular magnets', () => {
    expect(buildAnchorsFromOrigin('rectangular', 2, 3, dimensions)).toEqual([
      { id: 'top-left', gridX: 2, gridY: 3, role: 'anchor' },
      { id: 'top-right', gridX: 5, gridY: 3, role: 'boundary' },
      { id: 'bottom-left', gridX: 2, gridY: 4, role: 'boundary' },
      { id: 'bottom-right', gridX: 5, gridY: 4, role: 'boundary' },
    ]);
  });

  it('builds editor magnets from shared defaults and strips single-only bounds on panels', () => {
    const magnet = buildEditorMagnet({
      seedMagnet: createSeedMagnet(),
      id: 'panel',
      name: 'Panel',
      anchorType: 'rectangular',
      anchors: buildAnchorsFromOrigin('rectangular', 2, 3, dimensions),
      boundsMode: 'docked',
      boundsDock: { x: 'start', y: 'end' },
      boundsInset: { top: 1 },
      boundsOutset: { top: 4 },
      content: 'Panel content',
      style: { width: '72px', height: '36px' },
      chromeInset: { top: 2 },
    });

    expect(magnet.type).toBe('navigation');
    expect(magnet.boundsMode).toBeUndefined();
    expect(magnet.boundsDock).toBeUndefined();
    expect(magnet.boundsOutset).toEqual({ top: 4 });
    expect(magnet.boundsAlign).toEqual({ topToMagnetId: 'btn-back' });
    expect(magnet.chrome).toEqual({ enabled: true, inset: { top: 2 } });
    expect(magnet.interactions).toEqual({ draggable: true, clickable: false });
  });

  it('detects config changes using the shared comparable model', () => {
    const previous = buildEditorMagnet({
      seedMagnet: createSeedMagnet(),
      id: 'seed',
      name: 'Seed Magnet',
      anchorType: 'single',
      anchors: [{ id: 'anchor', gridX: 1, gridY: 2, role: 'anchor' }],
      boundsMode: 'centered',
      content: 'Seed',
      style: { width: '36px', height: '36px' },
    });

    const next = buildEditorMagnet({
      seedMagnet: createSeedMagnet(),
      id: 'seed',
      name: 'Seed Magnet',
      anchorType: 'single',
      anchors: [{ id: 'anchor', gridX: 1, gridY: 2, role: 'anchor' }],
      boundsMode: 'centered',
      content: 'Seed',
      style: { width: '36px', height: '36px' },
      chromeInset: { left: 1 },
    });

    expect(hasMagnetConfigChanges(previous, previous)).toBe(false);
    expect(hasMagnetConfigChanges(previous, next)).toBe(true);
  });

  it('computes preview scale from bounds', () => {
    expect(getPreviewScaleFromBounds(null)).toBe(1);
    expect(
      getPreviewScaleFromBounds({
        x: 0,
        y: 0,
        width: 460,
        height: 500,
      })
    ).toBeLessThan(1);
  });
});
