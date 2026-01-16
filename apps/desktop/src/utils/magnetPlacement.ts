import type { Magnet, PixelAnchor } from '../types/pixel';
import { MATRIX_CONFIG } from '../constants/config';
import { getMagnetOccupiedPixels } from './magnetEditor';

export type MagnetPlacementCandidate = {
  id: string;
  anchors: PixelAnchor[];
  footprintKeys: string[];
  score: number;
};

function clampPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.round(n));
}

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

function scorePosition(
  x: number,
  y: number,
  original: { x: number; y: number },
  footprintSize?: { width: number; height: number }
): number {
  const { COLUMNS, ROWS } = MATRIX_CONFIG;
  const distance = Math.abs(x - original.x) + Math.abs(y - original.y);

  const width = footprintSize?.width ?? 1;
  const height = footprintSize?.height ?? 1;
  const right = x + width - 1;
  const bottom = y + height - 1;

  let edgeBonus = 0;
  if (right >= COLUMNS - 3) edgeBonus += 2;
  if (bottom >= ROWS - 3) edgeBonus += 1;
  if (y <= 2) edgeBonus += 1;

  return distance - edgeBonus;
}

export function getOccupiedPixelKeys(magnets: Magnet[]): Set<string> {
  const occupied = new Set<string>();
  for (const magnet of magnets) {
    for (const pixel of getMagnetOccupiedPixels(magnet)) {
      occupied.add(keyOf(pixel.x, pixel.y));
    }
  }
  return occupied;
}

export function magnetHasPlacementConflict(magnet: Magnet, occupiedPixelKeys: Set<string>): boolean {
  return getMagnetOccupiedPixels(magnet).some((pixel) => occupiedPixelKeys.has(keyOf(pixel.x, pixel.y)));
}

function isRectangleFree(
  occupied: Set<string>,
  topLeft: { x: number; y: number },
  size: { width: number; height: number }
): boolean {
  for (let dx = 0; dx < size.width; dx++) {
    for (let dy = 0; dy < size.height; dy++) {
      if (occupied.has(keyOf(topLeft.x + dx, topLeft.y + dy))) return false;
    }
  }
  return true;
}

function buildFootprintKeysForRectangle(topLeft: { x: number; y: number }, size: { width: number; height: number }): string[] {
  const keys: string[] = [];
  for (let dx = 0; dx < size.width; dx++) {
    for (let dy = 0; dy < size.height; dy++) {
      keys.push(keyOf(topLeft.x + dx, topLeft.y + dy));
    }
  }
  return keys;
}

export function buildMagnetPlacementCandidates(
  magnet: Magnet,
  occupiedPixelKeys: Set<string>,
  options: { maxCandidates?: number } = {}
): MagnetPlacementCandidate[] {
  const maxCandidates = options.maxCandidates ?? 24;
  const { COLUMNS, ROWS } = MATRIX_CONFIG;

  const shape = getFootprintShape(magnet);
  if (!shape) return [];

  const anchors = Array.isArray(magnet.anchors) ? magnet.anchors : [];
  const originalX = anchors.length > 0 ? Math.min(...anchors.map((a) => a.gridX)) : 0;
  const originalY = anchors.length > 0 ? Math.min(...anchors.map((a) => a.gridY)) : 0;
  const original = { x: originalX, y: originalY };

  const { width, height } = shape;
  const allCandidates: MagnetPlacementCandidate[] = [];

  for (let y = 0; y <= ROWS - height; y++) {
    for (let x = 0; x <= COLUMNS - width; x++) {
      if (!isRectangleFree(occupiedPixelKeys, { x, y }, { width, height })) continue;
      const candidateAnchors = shape.offsets.map(({ anchor, dx, dy }) => ({
        ...anchor,
        gridX: x + dx,
        gridY: y + dy,
      }));
      allCandidates.push({
        id: keyOf(x, y),
        anchors: candidateAnchors,
        footprintKeys: buildFootprintKeysForRectangle({ x, y }, { width, height }),
        score: scorePosition(x, y, original, { width, height }),
      });
    }
  }

  allCandidates.sort((a, b) => a.score - b.score);

  const accepted: MagnetPlacementCandidate[] = [];
  const acceptedPixels = new Set<string>();
  for (const candidate of allCandidates) {
    const overlaps = candidate.footprintKeys.some((key) => acceptedPixels.has(key));
    if (overlaps) continue;
    accepted.push(candidate);
    candidate.footprintKeys.forEach((key) => acceptedPixels.add(key));
    if (accepted.length >= maxCandidates) break;
  }
  return accepted;
}

function getFootprintShape(
  magnet: Magnet
): null | {
  width: number;
  height: number;
  offsets: Array<{ anchor: PixelAnchor; dx: number; dy: number }>;
} {
  const anchors = Array.isArray(magnet.anchors) ? magnet.anchors : [];

  if (anchors.length === 0) {
    const fallback = magnet.gridFootprint ?? { width: 1, height: 1 };
    const width = clampPositiveInt(fallback.width, 1);
    const height = clampPositiveInt(fallback.height, 1);

    if (magnet.anchorType === 'horizontal') {
      const w = width;
      const left: PixelAnchor = { id: 'left', gridX: 0, gridY: 0, role: 'anchor' };
      const right: PixelAnchor = { id: 'right', gridX: w - 1, gridY: 0, role: 'boundary' };
      return { width: w, height: 1, offsets: [{ anchor: left, dx: 0, dy: 0 }, { anchor: right, dx: w - 1, dy: 0 }] };
    }

    if (magnet.anchorType === 'vertical') {
      const h = height;
      const top: PixelAnchor = { id: 'top', gridX: 0, gridY: 0, role: 'anchor' };
      const bottom: PixelAnchor = { id: 'bottom', gridX: 0, gridY: h - 1, role: 'boundary' };
      return { width: 1, height: h, offsets: [{ anchor: top, dx: 0, dy: 0 }, { anchor: bottom, dx: 0, dy: h - 1 }] };
    }

    if (magnet.anchorType === 'rectangular') {
      const w = width;
      const h = height;
      const topLeft: PixelAnchor = { id: 'top-left', gridX: 0, gridY: 0, role: 'anchor' };
      const topRight: PixelAnchor = { id: 'top-right', gridX: w - 1, gridY: 0, role: 'boundary' };
      const bottomLeft: PixelAnchor = { id: 'bottom-left', gridX: 0, gridY: h - 1, role: 'boundary' };
      const bottomRight: PixelAnchor = { id: 'bottom-right', gridX: w - 1, gridY: h - 1, role: 'boundary' };
      return {
        width: w,
        height: h,
        offsets: [
          { anchor: topLeft, dx: 0, dy: 0 },
          { anchor: topRight, dx: w - 1, dy: 0 },
          { anchor: bottomLeft, dx: 0, dy: h - 1 },
          { anchor: bottomRight, dx: w - 1, dy: h - 1 },
        ],
      };
    }

    const anchor: PixelAnchor = { id: 'anchor', gridX: 0, gridY: 0, role: 'anchor' };
    return { width: 1, height: 1, offsets: [{ anchor, dx: 0, dy: 0 }] };
  }

  const minX = Math.min(...anchors.map((a) => a.gridX));
  const maxX = Math.max(...anchors.map((a) => a.gridX));
  const minY = Math.min(...anchors.map((a) => a.gridY));
  const maxY = Math.max(...anchors.map((a) => a.gridY));

  if (magnet.anchorType === 'single') {
    return { width: 1, height: 1, offsets: [{ anchor: anchors[0], dx: 0, dy: 0 }] };
  }

  if (magnet.anchorType === 'horizontal') {
    const width = Math.max(1, maxX - minX + 1);
    return {
      width,
      height: 1,
      offsets: anchors.map((anchor) => ({ anchor, dx: anchor.gridX - minX, dy: 0 })),
    };
  }

  if (magnet.anchorType === 'vertical') {
    const height = Math.max(1, maxY - minY + 1);
    return {
      width: 1,
      height,
      offsets: anchors.map((anchor) => ({ anchor, dx: 0, dy: anchor.gridY - minY })),
    };
  }

  if (magnet.anchorType === 'rectangular') {
    const width = Math.max(1, maxX - minX + 1);
    const height = Math.max(1, maxY - minY + 1);
    return {
      width,
      height,
      offsets: anchors.map((anchor) => ({ anchor, dx: anchor.gridX - minX, dy: anchor.gridY - minY })),
    };
  }

  return null;
}

export function findFirstMagnetPlacementCandidate(
  magnet: Magnet,
  occupiedPixelKeys: Set<string>
): MagnetPlacementCandidate | null {
  const shape = getFootprintShape(magnet);
  if (!shape) return null;

  const { COLUMNS, ROWS } = MATRIX_CONFIG;
  const width = shape.width;
  const height = shape.height;

  for (let y = 0; y <= ROWS - height; y++) {
    for (let x = 0; x <= COLUMNS - width; x++) {
      if (!isRectangleFree(occupiedPixelKeys, { x, y }, { width, height })) continue;
      const anchors = shape.offsets.map(({ anchor, dx, dy }) => ({ ...anchor, gridX: x + dx, gridY: y + dy }));
      return {
        id: keyOf(x, y),
        anchors,
        footprintKeys: buildFootprintKeysForRectangle({ x, y }, { width, height }),
        score: 0,
      };
    }
  }

  return null;
}
