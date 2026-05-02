import { describe, expect, it } from 'vitest';

import type { Magnet, PixelAnchor } from '../../types/pixel';
import {
  createCenteredSingleControlLayoutPreset,
  createPanelLayoutPreset,
} from './layoutPresets';
import { buildAdaptiveMagnetLayout } from './layoutAdaptive';

function createPixelPositions(options: { stepX: number; stepY: number; cols?: number; rows?: number }) {
  const cols = options.cols ?? 6;
  const rows = options.rows ?? 6;
  const positions = new Map<string, { x: number; y: number }>();

  for (let gridY = 0; gridY < rows; gridY++) {
    for (let gridX = 0; gridX < cols; gridX++) {
      positions.set(`${gridX},${gridY}`, {
        x: 20 + gridX * options.stepX,
        y: 20 + gridY * options.stepY,
      });
    }
  }

  return positions;
}

function rectAnchors(leftCol: number, rightCol: number, topRow: number, bottomRow: number): PixelAnchor[] {
  return [
    { id: 'top-left', gridX: leftCol, gridY: topRow, role: 'anchor' },
    { id: 'top-right', gridX: rightCol, gridY: topRow, role: 'boundary' },
    { id: 'bottom-left', gridX: leftCol, gridY: bottomRow, role: 'boundary' },
    { id: 'bottom-right', gridX: rightCol, gridY: bottomRow, role: 'boundary' },
  ];
}

function createRectMagnet(id: string, anchors: PixelAnchor[]): Magnet {
  return {
    id,
    type: 'custom',
    name: id,
    anchorType: 'rectangular',
    anchors,
    gridFootprint: { width: 2, height: 2 },
    ...createPanelLayoutPreset(),
    content: '',
    style: {},
    state: 'idle',
    interactions: {
      draggable: false,
      clickable: false,
    },
  };
}

function createSingleMagnet(id: string, gridX: number, gridY: number): Magnet {
  return {
    id,
    type: 'custom',
    name: id,
    anchorType: 'single',
    anchors: [{ id: 'anchor', gridX, gridY, role: 'anchor' }],
    gridFootprint: { width: 1, height: 1 },
    ...createCenteredSingleControlLayoutPreset(),
    content: '',
    style: {},
    state: 'idle',
    interactions: {
      draggable: false,
      clickable: false,
    },
  };
}

function horizontalGap(left: { x: number; width: number }, right: { x: number }) {
  return right.x - (left.x + left.width);
}

function verticalGap(top: { y: number; height: number }, bottom: { y: number }) {
  return bottom.y - (top.y + top.height);
}

describe('buildAdaptiveMagnetLayout seam snapping', () => {
  it('closes horizontal visual seams between adjacent rectangular magnets', () => {
    const left = createRectMagnet('left-panel', rectAnchors(0, 1, 0, 1));
    const right = createRectMagnet('right-panel', rectAnchors(2, 3, 0, 1));
    const layout = buildAdaptiveMagnetLayout(
      [left, right],
      createPixelPositions({ stepX: 38, stepY: 38 }),
      { width: 320, height: 220 }
    );

    expect(horizontalGap(layout.layoutBoundsByMagnetId['left-panel'], layout.layoutBoundsByMagnetId['right-panel'])).toBe(0);
    expect(layout.joinsByMagnetId['left-panel'].right).toBe(true);
    expect(layout.joinsByMagnetId['right-panel'].left).toBe(true);
  });

  it('closes vertical visual seams between adjacent rectangular magnets', () => {
    const top = createRectMagnet('top-panel', rectAnchors(0, 1, 0, 1));
    const bottom = createRectMagnet('bottom-panel', rectAnchors(0, 1, 2, 3));
    const layout = buildAdaptiveMagnetLayout(
      [top, bottom],
      createPixelPositions({ stepX: 38, stepY: 38 }),
      { width: 320, height: 320 }
    );

    expect(verticalGap(layout.layoutBoundsByMagnetId['top-panel'], layout.layoutBoundsByMagnetId['bottom-panel'])).toBe(0);
    expect(layout.joinsByMagnetId['top-panel'].bottom).toBe(true);
    expect(layout.joinsByMagnetId['bottom-panel'].top).toBe(true);
  });

  it('keeps matrix gutters between rectangular magnets when the gap is intentional', () => {
    const left = createRectMagnet('left-panel', rectAnchors(0, 1, 0, 1));
    const right = createRectMagnet('right-panel', rectAnchors(2, 3, 0, 1));
    const layout = buildAdaptiveMagnetLayout(
      [left, right],
      createPixelPositions({ stepX: 50, stepY: 50 }),
      { width: 320, height: 220 }
    );

    expect(horizontalGap(layout.layoutBoundsByMagnetId['left-panel'], layout.layoutBoundsByMagnetId['right-panel'])).toBeGreaterThan(4);
    expect(layout.joinsByMagnetId['left-panel'].right).toBe(false);
    expect(layout.joinsByMagnetId['right-panel'].left).toBe(false);
  });

  it('keeps intentional gaps between non-adjacent single-control magnets', () => {
    const first = createSingleMagnet('first-control', 0, 0);
    const second = createSingleMagnet('second-control', 2, 0);
    const layout = buildAdaptiveMagnetLayout(
      [first, second],
      createPixelPositions({ stepX: 22, stepY: 22 }),
      { width: 220, height: 120 }
    );

    expect(horizontalGap(layout.layoutBoundsByMagnetId['first-control'], layout.layoutBoundsByMagnetId['second-control'])).toBeGreaterThan(0);
    expect(layout.joinsByMagnetId['first-control'].right).toBe(false);
    expect(layout.joinsByMagnetId['second-control'].left).toBe(false);
  });
});
