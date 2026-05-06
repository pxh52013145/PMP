import { describe, expect, it } from 'vitest';

import type { Magnet } from '../../types/pixel';
import {
  computeMagnetBounds,
  computeMagnetVisualBounds,
  type MagnetBounds,
  type MagnetBoundsJoinEdges,
} from './geometry';
import { buildAdaptiveMagnetLayout } from './layoutAdaptive';
import parityCases from './magnetGeometryParityCases.json';

type MagnetGridFixture = {
  originX: number;
  originY: number;
  stepX: number;
  stepY: number;
  cols: number;
  rows: number;
};

type MagnetFixture = Pick<Magnet, 'id' | 'anchorType' | 'anchors' | 'bounds' | 'chrome'>;

type GeometryParityCase = {
  name: string;
  grid: MagnetGridFixture;
  magnet: MagnetFixture;
  magnetsById?: Record<string, MagnetFixture>;
  viewport?: { width: number; height: number };
  joinEdges?: MagnetBoundsJoinEdges;
  expectedLayoutBounds: MagnetBounds | null;
  expectedVisualBounds: MagnetBounds | null;
};

type AdaptiveParityCase = {
  name: string;
  grid: MagnetGridFixture;
  magnets: MagnetFixture[];
  viewport: { width: number; height: number };
  expected: ReturnType<typeof buildAdaptiveMagnetLayout>;
};

type GeometryParityFixture = {
  geometryCases: GeometryParityCase[];
  adaptiveCases: AdaptiveParityCase[];
};

function createPixelPositions(grid: MagnetGridFixture) {
  const positions = new Map<string, { x: number; y: number }>();

  for (let gridY = 0; gridY < grid.rows; gridY++) {
    for (let gridX = 0; gridX < grid.cols; gridX++) {
      positions.set(`${gridX},${gridY}`, {
        x: grid.originX + gridX * grid.stepX,
        y: grid.originY + gridY * grid.stepY,
      });
    }
  }

  return positions;
}

function toFullMagnet(magnet: MagnetFixture): Magnet {
  return {
    ...magnet,
    type: 'custom',
    name: magnet.id,
    content: '',
    style: {},
    state: 'idle',
    interactions: {
      draggable: false,
      clickable: false,
    },
  };
}

function toMagnetMap(magnetsById: Record<string, MagnetFixture> | undefined): Record<string, Magnet> | undefined {
  if (!magnetsById) return undefined;
  return Object.fromEntries(Object.entries(magnetsById).map(([id, magnet]) => [id, toFullMagnet(magnet)]));
}

const fixture = parityCases as GeometryParityFixture;

describe('magnet geometry parity', () => {
  it('keeps computeMagnetBounds and computeMagnetVisualBounds aligned with Rust fixtures', () => {
    for (const testCase of fixture.geometryCases) {
      const pixelPositions = createPixelPositions(testCase.grid);
      const magnetsById = toMagnetMap(testCase.magnetsById);
      const layoutBounds = computeMagnetBounds(toFullMagnet(testCase.magnet), pixelPositions, {
        magnetsById,
        viewport: testCase.viewport,
      });
      const visualBounds = computeMagnetVisualBounds(toFullMagnet(testCase.magnet), pixelPositions, {
        magnetsById,
        viewport: testCase.viewport,
        joinEdges: testCase.joinEdges,
      });

      expect(layoutBounds).toEqual(testCase.expectedLayoutBounds);
      expect(visualBounds).toEqual(testCase.expectedVisualBounds);
    }
  });

  it('keeps adaptive layout output aligned with Rust fixtures', () => {
    for (const testCase of fixture.adaptiveCases) {
      const pixelPositions = createPixelPositions(testCase.grid);
      const magnets = testCase.magnets.map((magnet) => toFullMagnet(magnet));
      const result = buildAdaptiveMagnetLayout(magnets, pixelPositions, testCase.viewport);

      expect(result).toEqual(testCase.expected);
    }
  });
});
