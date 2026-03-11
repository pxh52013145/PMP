import { describe, expect, it } from 'vitest';
import type { Magnet } from '../../../types/pixel';
import { buildAdaptiveMagnetLayout } from '../layoutAdaptive';

function createPixelPositions(stepX: number, stepY: number) {
  const positions = new Map<string, { x: number; y: number }>();
  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 27; col++) {
      positions.set(`${col},${row}`, {
        x: 20 + col * stepX,
        y: 20 + row * stepY,
      });
    }
  }
  return positions;
}

function createSingleMagnet(id: string, gridX: number, gridY: number): Magnet {
  return {
    id,
    type: 'window-control',
    name: id,
    anchorType: 'single',
    anchors: [{ id: 'anchor', gridX, gridY, role: 'anchor' }],
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

function createNavigationPageMagnet(): Magnet {
  return {
    id: 'navigation-page',
    type: 'navigation',
    name: 'navigation-page',
    anchorType: 'rectangular',
    anchors: [
      { id: 'top-left', gridX: 6, gridY: 1, role: 'anchor' },
      { id: 'top-right', gridX: 26, gridY: 1, role: 'boundary' },
      { id: 'bottom-left', gridX: 6, gridY: 17, role: 'boundary' },
      { id: 'bottom-right', gridX: 26, gridY: 17, role: 'boundary' },
    ],
    content: '',
    style: {
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
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
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '2.7px',
    },
    state: 'idle',
    interactions: {
      draggable: false,
      clickable: false,
    },
  };
}

describe('buildAdaptiveMagnetLayout', () => {
  it('keeps isolated magnets in normal mode', () => {
    const result = buildAdaptiveMagnetLayout(
      [createSingleMagnet('btn-a', 0, 0), createSingleMagnet('btn-b', 26, 19)],
      createPixelPositions(32, 32),
      { width: 1000, height: 800 }
    );

    expect(result.mode).toBe('normal');
    expect(result.diagnostics.conflicts).toHaveLength(0);
  });

  it('detects compressed top-row collisions and repositions without shrinking bounds', () => {
    const result = buildAdaptiveMagnetLayout(
      [createSingleMagnet('btn-minimize', 22, 0), createNavigationPageMagnet()],
      createPixelPositions(18, 18),
      { width: 526, height: 400 }
    );

    expect(result.mode).toBe('compact');
    expect(result.diagnostics.conflicts.some((conflict) => conflict.axis === 'vertical')).toBe(true);

    const buttonBounds = result.boundsByMagnetId['btn-minimize'];
    const pageBounds = result.boundsByMagnetId['navigation-page'];
    expect(buttonBounds).toBeTruthy();
    expect(pageBounds).toBeTruthy();
    expect(buttonBounds.height).toBe(36);
    expect(pageBounds.height).toBe(306);

    const buttonBottom = buttonBounds.y + buttonBounds.height;
    const pageTop = pageBounds.y;
    expect(pageTop - buttonBottom).toBeGreaterThanOrEqual(0);
  });

  it('keeps adjacent left dock rectangles aligned without compact drift', () => {
    const result = buildAdaptiveMagnetLayout(
      [
        createRectangularMagnet('process-perf-monitor', 0, 0, 5, 7),
        createRectangularMagnet('audio-visualizer', 0, 9, 5, 14),
        createRectangularMagnet('track-info', 0, 15, 5, 18),
        createNavigationPageMagnet(),
      ],
      createPixelPositions(18, 18),
      { width: 526, height: 400 }
    );

    expect(result.mode).toBe('normal');

    const perfBounds = result.boundsByMagnetId['process-perf-monitor'];
    const visualizerBounds = result.boundsByMagnetId['audio-visualizer'];
    const trackInfoBounds = result.boundsByMagnetId['track-info'];
    const pageBounds = result.boundsByMagnetId['navigation-page'];

    expect(perfBounds.x).toBe(visualizerBounds.x);
    expect(visualizerBounds.x).toBe(trackInfoBounds.x);
    expect(perfBounds.x + perfBounds.width).toBe(pageBounds.x);
    expect(visualizerBounds.x + visualizerBounds.width).toBe(pageBounds.x);
    expect(trackInfoBounds.x + trackInfoBounds.width).toBe(pageBounds.x);

    expect(result.joinsByMagnetId['process-perf-monitor'].right).toBe(true);
    expect(result.joinsByMagnetId['audio-visualizer'].right).toBe(true);
    expect(result.joinsByMagnetId['track-info'].right).toBe(true);
    expect(result.joinsByMagnetId['navigation-page'].left).toBe(true);
  });
});
