import { describe, expect, it } from 'vitest';
import type { Magnet } from '../../../types/pixel';
import { computePixelGridLayout } from '../../../utils/pixelGrid';
import { buildAdaptiveMagnetLayout } from '../layoutAdaptive';
import {
  createCenteredSingleControlLayoutPreset,
  createDockedSingleControlLayoutPreset,
  createMagnetEdgeReference,
  createPanelLayoutPreset,
} from '../layoutPresets';

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

function createPixelPositionsForViewport(viewport: { width: number; height: number }) {
  const layout = computePixelGridLayout(viewport.width, viewport.height);
  return createPixelPositions(layout.stepX, layout.stepY);
}

function createSingleMagnet(id: string, gridX: number, gridY: number): Magnet {
  return {
    id,
    type: 'window-control',
    name: id,
    anchorType: 'single',
    anchors: [{ id: 'anchor', gridX, gridY, role: 'anchor' }],
    bounds: createCenteredSingleControlLayoutPreset().bounds,
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
    ...createSingleMagnet(id, gridX, gridY),
    type: 'navigation',
    bounds: createDockedSingleControlLayoutPreset({ dock: { x: 'start' } }).bounds,
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
    bounds: createPanelLayoutPreset().bounds,
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

function createRectangularMagnet(
  id: string,
  leftCol: number,
  topRow: number,
  rightCol: number,
  bottomRow: number,
  overrides: Partial<Magnet> = {}
): Magnet {
  return {
    id,
    type: overrides.type ?? 'custom',
    name: overrides.name ?? id,
    anchorType: 'rectangular',
    anchors: overrides.anchors ?? [
      { id: 'top-left', gridX: leftCol, gridY: topRow, role: 'anchor' },
      { id: 'top-right', gridX: rightCol, gridY: topRow, role: 'boundary' },
      { id: 'bottom-left', gridX: leftCol, gridY: bottomRow, role: 'boundary' },
      { id: 'bottom-right', gridX: rightCol, gridY: bottomRow, role: 'boundary' },
    ],
    bounds: overrides.bounds ?? createPanelLayoutPreset().bounds,
    chrome: overrides.chrome,
    content: overrides.content ?? '',
    style: overrides.style ?? {
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '2.7px',
    },
    state: overrides.state ?? 'idle',
    interactions: overrides.interactions ?? {
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

    const buttonBounds = result.layoutBoundsByMagnetId['btn-minimize'];
    const pageBounds = result.layoutBoundsByMagnetId['navigation-page'];
    expect(buttonBounds).toBeTruthy();
    expect(pageBounds).toBeTruthy();
    expect(buttonBounds.height).toBe(36);
    expect(pageBounds.height).toBe(324);

    const buttonBottom = buttonBounds.y + buttonBounds.height;
    const pageTop = pageBounds.y;
    expect(pageTop - buttonBottom).toBeGreaterThanOrEqual(0);
  });

  it('preserves free gaps between left panels and the navigation page when the viewport is roomy', () => {
    const viewport = { width: 1200, height: 900 };
    const result = buildAdaptiveMagnetLayout(
      [
        createRectangularMagnet('process-perf-monitor', 0, 0, 5, 7),
        createRectangularMagnet('audio-visualizer', 0, 9, 5, 14),
        createRectangularMagnet('track-info', 0, 15, 5, 18),
        createNavigationPageMagnet(),
      ],
      createPixelPositionsForViewport(viewport),
      viewport
    );

    expect(result.mode).toBe('normal');

    const perfBounds = result.layoutBoundsByMagnetId['process-perf-monitor'];
    const visualizerBounds = result.layoutBoundsByMagnetId['audio-visualizer'];
    const trackInfoBounds = result.layoutBoundsByMagnetId['track-info'];
    const pageBounds = result.layoutBoundsByMagnetId['navigation-page'];

    expect(pageBounds.x - (perfBounds.x + perfBounds.width)).toBeGreaterThan(0);
    expect(pageBounds.x - (visualizerBounds.x + visualizerBounds.width)).toBeGreaterThan(0);
    expect(pageBounds.x - (trackInfoBounds.x + trackInfoBounds.width)).toBeGreaterThan(0);

    expect(result.joinsByMagnetId['process-perf-monitor'].right).toBe(false);
    expect(result.joinsByMagnetId['audio-visualizer'].right).toBe(false);
    expect(result.joinsByMagnetId['track-info'].right).toBe(false);
    expect(result.joinsByMagnetId['navigation-page'].left).toBe(false);
  });

  it('repositions adjacent left panels against the navigation page seam at minimum spacing', () => {
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

    expect(result.mode).toBe('compact');

    const perfBounds = result.layoutBoundsByMagnetId['process-perf-monitor'];
    const visualizerBounds = result.layoutBoundsByMagnetId['audio-visualizer'];
    const trackInfoBounds = result.layoutBoundsByMagnetId['track-info'];
    const pageBounds = result.layoutBoundsByMagnetId['navigation-page'];

    expect(perfBounds.x).toBe(visualizerBounds.x);
    expect(visualizerBounds.x).toBe(trackInfoBounds.x);
    expect(perfBounds.x + perfBounds.width).toBe(pageBounds.x);
    expect(visualizerBounds.x + visualizerBounds.width).toBe(pageBounds.x);
    expect(trackInfoBounds.x + trackInfoBounds.width).toBe(pageBounds.x);

    expect(result.joinsByMagnetId['process-perf-monitor'].right).toBe(false);
    expect(result.joinsByMagnetId['audio-visualizer'].right).toBe(true);
    expect(result.joinsByMagnetId['track-info'].right).toBe(false);
    expect(result.joinsByMagnetId['navigation-page'].left).toBe(true);
  });

  it('lets the perf panel dynamically follow the back button top baseline via magnet edge reference', () => {
    const dockedBack = createLeftDockedSingleMagnet('btn-back', 6, 0);
    const perf = createRectangularMagnet('process-perf-monitor', 0, 0, 5, 7, {
      bounds: createPanelLayoutPreset({
        edgeOverrides: {
          top: createMagnetEdgeReference('btn-back', 'start', 9),
        },
      }).bounds,
    });

    const viewport = { width: 1000, height: 800 };
    const result = buildAdaptiveMagnetLayout(
      [perf, dockedBack, createNavigationPageMagnet()],
      createPixelPositionsForViewport(viewport),
      viewport
    );

    const perfBounds = result.layoutBoundsByMagnetId['process-perf-monitor'];
    const backBounds = result.layoutBoundsByMagnetId['btn-back'];

    expect(result.mode).toBe('normal');
    expect(perfBounds.y).toBe(backBounds.y);
  });

  it('keeps the back button aligned to the navigation left seam without sticking to the page below in a roomy layout', () => {
    const viewport = { width: 1000, height: 800 };
    const result = buildAdaptiveMagnetLayout(
      [createLeftDockedSingleMagnet('btn-back', 6, 0), createNavigationPageMagnet()],
      createPixelPositionsForViewport(viewport),
      viewport
    );

    expect(result.mode).toBe('normal');

    const backBounds = result.layoutBoundsByMagnetId['btn-back'];
    const pageBounds = result.layoutBoundsByMagnetId['navigation-page'];

    expect(backBounds.x).toBe(pageBounds.x + 9);
    expect(backBounds.y + backBounds.height).toBeLessThan(pageBounds.y);
    expect(result.joinsByMagnetId['btn-back'].bottom).toBe(false);
    expect(result.joinsByMagnetId['navigation-page'].top).toBe(false);
  });
});
