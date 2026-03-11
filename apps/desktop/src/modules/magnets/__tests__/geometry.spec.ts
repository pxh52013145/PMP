import { describe, expect, it } from 'vitest';
import { MATRIX_CONFIG } from '../../../constants/config';
import type { Magnet } from '../../../types/pixel';
import { alignMagnetBounds, computeMagnetBounds } from '../geometry';

function createPixelPositions(stepX: number, stepY: number) {
  const positions = new Map<string, { x: number; y: number }>();
  for (let row = 0; row < MATRIX_CONFIG.ROWS; row++) {
    for (let col = 0; col < MATRIX_CONFIG.COLUMNS; col++) {
      positions.set(`${col},${row}`, {
        x: MATRIX_CONFIG.EDGE_PADDING + col * stepX,
        y: MATRIX_CONFIG.EDGE_PADDING + row * stepY,
      });
    }
  }
  return positions;
}

function createRectangularMagnet(id: string, leftCol: number, topRow: number, rightCol: number, bottomRow: number): Magnet {
  return {
    id,
    type: 'custom',
    name: id,
    anchorType: 'rectangular',
    anchors: [
      { id: 'top-left', gridX: leftCol, gridY: topRow, role: 'anchor' },
      { id: 'top-right', gridX: rightCol, gridY: topRow, role: 'boundary' },
      { id: 'bottom-left', gridX: leftCol, gridY: bottomRow, role: 'boundary' },
      { id: 'bottom-right', gridX: rightCol, gridY: bottomRow, role: 'boundary' },
    ],
    content: '',
    style: {
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '2.7px',
    },
    state: 'idle',
    interactions: {
      draggable: false,
      clickable: false,
    },
  };
}

describe('computeMagnetBounds', () => {
  it('uses shared seam boundaries for adjacent rectangular magnets at minimum spacing', () => {
    const positions = createPixelPositions(MATRIX_CONFIG.PIXEL_SIZE, MATRIX_CONFIG.PIXEL_SIZE);
    const perf = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('process-perf-monitor', 0, 0, 5, 7), positions)!
    );
    const nav = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('navigation-page', 6, 1, 26, 17), positions)!
    );

    expect(perf.x).toBe(MATRIX_CONFIG.EDGE_PADDING / 2);
    expect(perf.x + perf.width).toBe(nav.x);
  });

  it('keeps shared seams stable when the matrix has extra spacing', () => {
    const positions = createPixelPositions(35.1538461538, 32);
    const perf = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('process-perf-monitor', 0, 0, 5, 7), positions)!
    );
    const nav = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('navigation-page', 6, 1, 26, 17), positions)!
    );

    expect(perf.x).toBe(MATRIX_CONFIG.EDGE_PADDING / 2);
    expect(perf.x + perf.width).toBe(nav.x);
  });
});
