import { describe, expect, it } from 'vitest';
import { MATRIX_CONFIG } from '../../../constants/config';
import type { Magnet } from '../../../types/pixel';
import { alignMagnetBounds, computeMagnetBounds } from '../geometry';
import { BACK_BUTTON_MAGNET } from '../../../data/builtin/backButtonMagnet';
import { PROCESS_PERF_MONITOR_MAGNET } from '../../../data/builtin/processPerfMonitorMagnet';
import { SYSTEM_SPACE1_DEFAULT_ANCHORS_BY_MAGNET_ID } from '../systemLayouts';

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

function createRectangularMagnet(
  id: string,
  leftCol: number,
  topRow: number,
  rightCol: number,
  bottomRow: number,
  layout?: Pick<Magnet, 'boundsInset' | 'boundsOutset'>
): Magnet {
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
    ...(layout ?? {}),
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

function createDockedSingleMagnet(id: string, gridX: number, gridY: number): Magnet {
  return {
    id,
    type: 'navigation',
    name: id,
    anchorType: 'single',
    anchors: [{ id: 'anchor', gridX, gridY, role: 'anchor' }],
    boundsMode: 'docked',
    boundsDock: { x: 'start', y: 'end' },
    content: id,
    style: {
      width: '36px',
      height: '36px',
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

function createLeftDockedSingleMagnet(id: string, gridX: number, gridY: number): Magnet {
  return {
    ...createDockedSingleMagnet(id, gridX, gridY),
    boundsDock: { x: 'start' },
  };
}

describe('computeMagnetBounds', () => {
  it('touches adjacent rectangular magnets at minimum spacing', () => {
    const positions = createPixelPositions(MATRIX_CONFIG.PIXEL_SIZE, MATRIX_CONFIG.PIXEL_SIZE);
    const perf = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('process-perf-monitor', 0, 0, 5, 7), positions)!
    );
    const nav = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('navigation-page', 6, 1, 26, 17), positions)!
    );

    expect(perf.x).toBe(MATRIX_CONFIG.EDGE_PADDING);
    expect(perf.x + perf.width).toBe(nav.x);
  });

  it('preserves a breathing gap between adjacent rectangular magnets when the matrix has extra spacing', () => {
    const positions = createPixelPositions(35.1538461538, 32);
    const perf = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('process-perf-monitor', 0, 0, 5, 7), positions)!
    );
    const nav = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('navigation-page', 6, 1, 26, 17), positions)!
    );

    expect(perf.x).toBe(MATRIX_CONFIG.EDGE_PADDING);
    expect(nav.x - (perf.x + perf.width)).toBeGreaterThan(0);
  });

  it('applies bounds inset to rectangular magnets as real inward shell spacing', () => {
    const positions = createPixelPositions(MATRIX_CONFIG.PIXEL_SIZE, MATRIX_CONFIG.PIXEL_SIZE);
    const insetPanel = alignMagnetBounds(
      computeMagnetBounds(
        createRectangularMagnet('process-perf-monitor', 0, 0, 5, 7, { boundsInset: { top: 8 } }),
        positions
      )!
    );

    expect(insetPanel.y).toBe(MATRIX_CONFIG.EDGE_PADDING + 8);
    expect(insetPanel.height).toBe(144 - 8);
  });

  it('applies bounds outset to rectangular magnets as real outward shell expansion', () => {
    const positions = createPixelPositions(MATRIX_CONFIG.PIXEL_SIZE, MATRIX_CONFIG.PIXEL_SIZE);
    const outsetPanel = alignMagnetBounds(
      computeMagnetBounds(
        createRectangularMagnet('process-perf-monitor', 0, 0, 5, 7, { boundsOutset: { top: 9 } }),
        positions
      )!
    );

    expect(outsetPanel.y).toBe(MATRIX_CONFIG.EDGE_PADDING - 9);
    expect(outsetPanel.height).toBe(144 + 9);
  });

  it('keeps docked single magnets aligned to the slot seam even when the grid has extra spacing', () => {
    const positions = createPixelPositions(35.1538461538, 32);
    const back = alignMagnetBounds(computeMagnetBounds(createDockedSingleMagnet('btn-back', 6, 0), positions)!);
    const nav = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('navigation-page', 6, 1, 26, 17), positions)!
    );

    expect(back.x).toBe(nav.x);
    expect(back.y + back.height).toBe(nav.y);
    expect(back.width).toBe(36);
    expect(back.height).toBe(36);
  });

  it('lets docked singles keep seam alignment on one axis while preserving centered placement on the other axis', () => {
    const positions = createPixelPositions(35.1538461538, 32);
    const back = alignMagnetBounds(computeMagnetBounds(createLeftDockedSingleMagnet('btn-back', 6, 0), positions)!);
    const nav = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('navigation-page', 6, 1, 26, 17), positions)!
    );

    expect(back.x).toBe(nav.x);
    expect(back.y + back.height).toBeLessThan(nav.y);
    expect(nav.y - (back.y + back.height)).toBeGreaterThan(0);
  });

  it('aligns the builtin perf panel outer top border with the back button outer top border', () => {
    const positions = createPixelPositions(MATRIX_CONFIG.PIXEL_SIZE, MATRIX_CONFIG.PIXEL_SIZE);
    const perf = alignMagnetBounds(
      computeMagnetBounds(
        {
          ...PROCESS_PERF_MONITOR_MAGNET,
          anchors: SYSTEM_SPACE1_DEFAULT_ANCHORS_BY_MAGNET_ID['process-perf-monitor'],
        },
        positions
      )!
    );
    const back = alignMagnetBounds(
      computeMagnetBounds(
        {
          ...BACK_BUTTON_MAGNET,
          anchors: SYSTEM_SPACE1_DEFAULT_ANCHORS_BY_MAGNET_ID['btn-back'],
        },
        positions
      )!
    );

    expect(perf.x).toBe(MATRIX_CONFIG.EDGE_PADDING);
    expect(perf.y).toBe(back.y);
    expect(back.y).toBe(MATRIX_CONFIG.EDGE_PADDING - 9);
  });
});
