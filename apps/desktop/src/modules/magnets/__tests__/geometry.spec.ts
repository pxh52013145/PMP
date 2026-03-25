import { describe, expect, it } from 'vitest';
import { MATRIX_CONFIG } from '../../../constants/config';
import type { Magnet } from '../../../types/pixel';
import { alignMagnetBounds, computeChromeBoundsFromLayoutBounds, computeContentBoundsFromLayoutBounds, computeMagnetBounds } from '../geometry';
import { BACK_BUTTON_MAGNET } from '../../../data/builtin/backButtonMagnet';
import { DRAG_HANDLE_MAGNET } from '../../../data/builtin/dragHandleMagnet';
import { PROCESS_PERF_MONITOR_MAGNET } from '../../../data/builtin/processPerfMonitorMagnet';
import { SYSTEM_SPACE1_DEFAULT_ANCHORS_BY_MAGNET_ID } from '../systemLayouts';
import {
  createDockedSingleControlLayoutPreset,
  createPanelLayoutPreset,
} from '../layoutPresets';

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
  bottomRow: number
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
    bounds: createPanelLayoutPreset().bounds,
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
  const preset = createDockedSingleControlLayoutPreset({ dock: { x: 'start', y: 'end' } });
  return {
    id,
    type: 'navigation',
    name: id,
    anchorType: 'single',
    anchors: [{ id: 'anchor', gridX, gridY, role: 'anchor' }],
    bounds: preset.bounds,
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
  const preset = createDockedSingleControlLayoutPreset({ dock: { x: 'start' } });
  return {
    ...createDockedSingleMagnet(id, gridX, gridY),
    bounds: preset.bounds,
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

    expect(perf.x).toBe(MATRIX_CONFIG.EDGE_PADDING - 9);
    expect(perf.x + perf.width - MATRIX_CONFIG.PIXEL_SIZE).toBe(nav.x);
  });

  it('preserves a breathing gap between adjacent rectangular magnets when the matrix has extra spacing', () => {
    const positions = createPixelPositions(40, 32);
    const perf = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('process-perf-monitor', 0, 0, 5, 7), positions)!
    );
    const nav = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('navigation-page', 6, 1, 26, 17), positions)!
    );

    expect(perf.x).toBe(MATRIX_CONFIG.EDGE_PADDING - 9);
    expect(nav.x - (perf.x + perf.width)).toBeGreaterThan(0);
  });

  it('applies chrome inset to content bounds without shrinking the chrome bounds', () => {
    const positions = createPixelPositions(MATRIX_CONFIG.PIXEL_SIZE, MATRIX_CONFIG.PIXEL_SIZE);
    const layout = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('process-perf-monitor', 0, 0, 5, 7), positions)!
    );
    const insetContent = alignMagnetBounds(computeContentBoundsFromLayoutBounds(layout, { inset: { top: 8 } })!);
    const chromeBounds = alignMagnetBounds(computeChromeBoundsFromLayoutBounds(layout, { inset: { top: 8 } })!);

    expect(insetContent.y).toBe(layout.y + 8);
    expect(insetContent.height).toBe(layout.height - 8);
    expect(chromeBounds).toEqual(layout);
  });

  it('applies chrome outset to layout bounds for visual bounds', () => {
    const positions = createPixelPositions(MATRIX_CONFIG.PIXEL_SIZE, MATRIX_CONFIG.PIXEL_SIZE);
    const layout = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('process-perf-monitor', 0, 0, 5, 7), positions)!
    );
    const outsetPanel = alignMagnetBounds(
      computeChromeBoundsFromLayoutBounds(layout, { outset: { top: 9 } })!
    );

    expect(outsetPanel.y).toBe(layout.y - 9);
    expect(outsetPanel.height).toBe(layout.height + 9);
  });

  it('keeps docked single magnets aligned to the slot seam even when the grid has extra spacing', () => {
    const positions = createPixelPositions(35.1538461538, 32);
    const back = alignMagnetBounds(computeMagnetBounds(createDockedSingleMagnet('btn-back', 6, 0), positions)!);
    const nav = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('navigation-page', 6, 1, 26, 17), positions)!
    );

    expect(back.x).toBe(nav.x + 9);
    expect(back.y + back.height).toBe(nav.y + 9);
    expect(back.width).toBe(36);
    expect(back.height).toBe(36);
  });

  it('lets docked singles keep seam alignment on one axis while preserving centered placement on the other axis', () => {
    const positions = createPixelPositions(35.1538461538, 40);
    const back = alignMagnetBounds(computeMagnetBounds(createLeftDockedSingleMagnet('btn-back', 6, 0), positions)!);
    const nav = alignMagnetBounds(
      computeMagnetBounds(createRectangularMagnet('navigation-page', 6, 1, 26, 17), positions)!
    );

    expect(back.x).toBe(nav.x + 9);
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

    expect(perf.x).toBe(MATRIX_CONFIG.EDGE_PADDING - 9);
    expect(perf.y).toBe(back.y);
    expect(back.y).toBe(MATRIX_CONFIG.EDGE_PADDING - 9);
  });

  it('aligns the drag handle shell vertical bounds with the back button shell', () => {
    const positions = createPixelPositions(MATRIX_CONFIG.PIXEL_SIZE, MATRIX_CONFIG.PIXEL_SIZE);
    const drag = alignMagnetBounds(
      computeMagnetBounds(
        {
          ...DRAG_HANDLE_MAGNET,
          anchors: SYSTEM_SPACE1_DEFAULT_ANCHORS_BY_MAGNET_ID['drag-handle'],
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

    expect(drag.y).toBe(back.y);
    expect(drag.height).toBe(back.height);
  });
});
