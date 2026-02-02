/**
 * Magnet position conflict detection and best-effort resolution.
 *
 * Rules:
 * - Keep this module resilient to malformed/legacy anchors (never throw during startup).
 * - Centralize pixel-occupancy computation in `magnetEditor.getMagnetOccupiedPixels`.
 */

import { Magnet } from '../types/pixel';
import { MATRIX_CONFIG } from '../constants/config';
import { getMagnetOccupiedPixels } from './magnetEditor';

type GridPoint = { x: number; y: number };

function manhattanDistance(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function collectEmptyPositions(
  occupiedPixels: Set<string>,
  gridWidth: number = MATRIX_CONFIG.COLUMNS,
  gridHeight: number = MATRIX_CONFIG.ROWS
): GridPoint[] {
  const empty: GridPoint[] = [];
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      if (!occupiedPixels.has(`${x},${y}`)) empty.push({ x, y });
    }
  }
  return empty;
}

function isRectangleFree(
  x: number,
  y: number,
  width: number,
  height: number,
  occupiedPixels: Set<string>,
  gridWidth: number,
  gridHeight: number
): boolean {
  if (width <= 0 || height <= 0) return false;
  if (x < 0 || y < 0) return false;
  if (x + width > gridWidth || y + height > gridHeight) return false;

  for (let px = x; px < x + width; px++) {
    for (let py = y; py < y + height; py++) {
      if (occupiedPixels.has(`${px},${py}`)) return false;
    }
  }
  return true;
}

function findBestEmptyPosition(
  original: GridPoint,
  occupiedPixels: Set<string>,
  gridWidth: number = MATRIX_CONFIG.COLUMNS,
  gridHeight: number = MATRIX_CONFIG.ROWS
): GridPoint | null {
  const key = `${original.x},${original.y}`;
  if (!occupiedPixels.has(key)) return original;

  const empties = collectEmptyPositions(occupiedPixels, gridWidth, gridHeight);
  if (empties.length === 0) return null;

  // Prefer closest by Manhattan distance; ties prefer bottom-right (x desc, y desc) for stability.
  empties.sort((a, b) => {
    const distA = manhattanDistance(original, a);
    const distB = manhattanDistance(original, b);
    if (distA !== distB) return distA - distB;
    if (a.x !== b.x) return b.x - a.x;
    return b.y - a.y;
  });

  return empties[0] ?? null;
}

function findBestEmptyRectangle(
  originalTopLeft: GridPoint,
  width: number,
  height: number,
  occupiedPixels: Set<string>,
  gridWidth: number = MATRIX_CONFIG.COLUMNS,
  gridHeight: number = MATRIX_CONFIG.ROWS
): GridPoint | null {
  if (width <= 0 || height <= 0) return null;

  const candidates: Array<GridPoint & { distance: number }> = [];
  for (let y = 0; y <= gridHeight - height; y++) {
    for (let x = 0; x <= gridWidth - width; x++) {
      if (!isRectangleFree(x, y, width, height, occupiedPixels, gridWidth, gridHeight)) continue;
      candidates.push({ x, y, distance: manhattanDistance(originalTopLeft, { x, y }) });
    }
  }

  if (candidates.length === 0) return null;

  // Prefer closest; ties prefer bottom-right (x desc, y desc).
  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.x !== b.x) return b.x - a.x;
    return b.y - a.y;
  });

  const best = candidates[0];
  return best ? { x: best.x, y: best.y } : null;
}

function adjustMagnetPosition(
  magnet: Magnet,
  occupiedPixels: Set<string>,
  gridWidth: number = MATRIX_CONFIG.COLUMNS,
  gridHeight: number = MATRIX_CONFIG.ROWS
): Magnet {
  const anchors = Array.isArray(magnet.anchors) ? magnet.anchors : [];

  if (magnet.anchorType === 'single') {
    const anchor = anchors[0];
    if (!anchor) return magnet;
    const newPos = findBestEmptyPosition({ x: anchor.gridX, y: anchor.gridY }, occupiedPixels, gridWidth, gridHeight);
    if (!newPos) return magnet;
    if (newPos.x === anchor.gridX && newPos.y === anchor.gridY) return magnet;
    return { ...magnet, anchors: [{ ...anchor, gridX: newPos.x, gridY: newPos.y }] };
  }

  if (magnet.anchorType === 'rectangular') {
    if (anchors.length === 0) return magnet;
    const xs = anchors.map((a) => a.gridX);
    const ys = anchors.map((a) => a.gridY);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const rectW = maxX - minX + 1;
    const rectH = maxY - minY + 1;

    const newTopLeft = findBestEmptyRectangle(
      { x: minX, y: minY },
      rectW,
      rectH,
      occupiedPixels,
      gridWidth,
      gridHeight
    );
    if (!newTopLeft) return magnet;
    if (newTopLeft.x === minX && newTopLeft.y === minY) return magnet;

    const offsetX = newTopLeft.x - minX;
    const offsetY = newTopLeft.y - minY;
    return {
      ...magnet,
      anchors: anchors.map((a) => ({ ...a, gridX: a.gridX + offsetX, gridY: a.gridY + offsetY })),
    };
  }

  // horizontal/vertical: keep conservative (no auto adjust).
  return magnet;
}

function getMagnetArea(magnet: Magnet): number {
  return getMagnetOccupiedPixels(magnet).length;
}

function getAnchorTypePriority(anchorType: Magnet['anchorType']): number {
  switch (anchorType) {
    case 'rectangular':
      return 0;
    case 'horizontal':
    case 'vertical':
      return 1;
    case 'single':
      return 2;
    default:
      return 3;
  }
}

/**
 * Resolve magnet position conflicts (best-effort).
 *
 * Strategy:
 * - Sort by type priority and area (larger first).
 * - Place without overlap when possible.
 * - If a magnet still conflicts after adjustment, skip it (do not crash startup).
 * - Finally restore the original input order for the resolved subset.
 */
export function resolveMagnetPositions(magnets: Magnet[]): Magnet[] {
  const sorted = [...magnets].sort((a, b) => {
    const priorityDiff = getAnchorTypePriority(a.anchorType) - getAnchorTypePriority(b.anchorType);
    if (priorityDiff !== 0) return priorityDiff;
    return getMagnetArea(b) - getMagnetArea(a);
  });

  const occupied = new Set<string>();
  const resolved: Magnet[] = [];

  for (const magnet of sorted) {
    const pixels = getMagnetOccupiedPixels(magnet);
    const hasConflict = pixels.some((p) => occupied.has(`${p.x},${p.y}`));

    let finalMagnet = magnet;
    if (hasConflict) {
      finalMagnet = adjustMagnetPosition(magnet, occupied);
      const adjustedPixels = getMagnetOccupiedPixels(finalMagnet);
      const stillConflicts = adjustedPixels.some((p) => occupied.has(`${p.x},${p.y}`));
      if (stillConflicts) continue;
    }

    const finalPixels = getMagnetOccupiedPixels(finalMagnet);
    finalPixels.forEach((p) => occupied.add(`${p.x},${p.y}`));
    resolved.push(finalMagnet);
  }

  const indexById = new Map(magnets.map((m, idx) => [m.id, idx] as const));
  return resolved.sort((a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0));
}

/**
 * Detect all conflicting magnet pairs.
 */
export function detectConflicts(
  magnets: Magnet[]
): Array<{ magnet1: string; magnet2: string; conflictPixels: Array<{ x: number; y: number }> }> {
  const conflicts: Array<{ magnet1: string; magnet2: string; conflictPixels: GridPoint[] }> = [];

  for (let i = 0; i < magnets.length; i++) {
    for (let j = i + 1; j < magnets.length; j++) {
      const m1 = magnets[i];
      const m2 = magnets[j];

      const pixels1 = getMagnetOccupiedPixels(m1);
      const pixels2 = getMagnetOccupiedPixels(m2);

      const conflictPixels = pixels1.filter((p1) => pixels2.some((p2) => p1.x === p2.x && p1.y === p2.y));
      if (conflictPixels.length === 0) continue;

      conflicts.push({
        magnet1: m1.name || m1.id,
        magnet2: m2.name || m2.id,
        conflictPixels,
      });
    }
  }

  return conflicts;
}

