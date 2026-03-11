import type { Magnet } from '../../types/pixel';
import { alignMagnetBounds, computeMagnetBounds, type MagnetBounds } from './geometry';

const MIN_VISUAL_GAP_PX = 0;
const ITERATION_LIMIT = 4;

export type MagnetAdaptiveLayoutMode = 'normal' | 'compact' | 'constrained';

export interface MagnetAdaptiveConflict {
  magnetA: string;
  magnetB: string;
  axis: 'horizontal' | 'vertical';
  deficitPx: number;
}

export interface MagnetJoinEdges {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

export interface MagnetAdaptiveLayoutResult {
  mode: MagnetAdaptiveLayoutMode;
  boundsByMagnetId: Record<string, MagnetBounds>;
  joinsByMagnetId: Record<string, MagnetJoinEdges>;
  diagnostics: {
    maxAdjustmentPx: number;
    outOfBoundsIds: string[];
    conflicts: MagnetAdaptiveConflict[];
    unresolvedConflicts: MagnetAdaptiveConflict[];
  };
}

function cloneBounds(bounds: MagnetBounds): MagnetBounds {
  return { ...bounds };
}

function createEmptyJoinEdges(): MagnetJoinEdges {
  return {
    left: false,
    right: false,
    top: false,
    bottom: false,
  };
}

function getHorizontalGap(first: MagnetBounds, second: MagnetBounds): number {
  return Math.max(0, Math.max(second.x - (first.x + first.width), first.x - (second.x + second.width)));
}

function getVerticalGap(first: MagnetBounds, second: MagnetBounds): number {
  return Math.max(0, Math.max(second.y - (first.y + first.height), first.y - (second.y + second.height)));
}

function getOverlap(firstStart: number, firstSize: number, secondStart: number, secondSize: number): number {
  return Math.min(firstStart + firstSize, secondStart + secondSize) - Math.max(firstStart, secondStart);
}

function shiftVertically(
  topBounds: MagnetBounds,
  bottomBounds: MagnetBounds,
  viewportHeight: number,
  deficitPx: number
): number {
  const availableUp = Math.max(0, topBounds.y);
  const availableDown = Math.max(0, viewportHeight - (bottomBounds.y + bottomBounds.height));
  const desiredUp = Math.ceil(deficitPx / 2);
  const desiredDown = Math.floor(deficitPx / 2);
  const appliedUp = Math.min(desiredUp, availableUp);
  const appliedDown = Math.min(desiredDown, availableDown);
  let resolved = appliedUp + appliedDown;

  if (resolved < deficitPx) {
    const extraDown = Math.min(deficitPx - resolved, Math.max(0, availableDown - appliedDown));
    resolved += extraDown;
    bottomBounds.y += extraDown;
  }

  if (resolved < deficitPx) {
    const extraUp = Math.min(deficitPx - resolved, Math.max(0, availableUp - appliedUp));
    resolved += extraUp;
    topBounds.y -= extraUp;
  }

  topBounds.y -= appliedUp;
  bottomBounds.y += appliedDown;
  return resolved;
}

function shiftHorizontally(
  leftBounds: MagnetBounds,
  rightBounds: MagnetBounds,
  viewportWidth: number,
  deficitPx: number
): number {
  const availableLeft = Math.max(0, leftBounds.x);
  const availableRight = Math.max(0, viewportWidth - (rightBounds.x + rightBounds.width));
  const desiredLeft = Math.ceil(deficitPx / 2);
  const desiredRight = Math.floor(deficitPx / 2);
  const appliedLeft = Math.min(desiredLeft, availableLeft);
  const appliedRight = Math.min(desiredRight, availableRight);
  let resolved = appliedLeft + appliedRight;

  if (resolved < deficitPx) {
    const extraRight = Math.min(deficitPx - resolved, Math.max(0, availableRight - appliedRight));
    resolved += extraRight;
    rightBounds.x += extraRight;
  }

  if (resolved < deficitPx) {
    const extraLeft = Math.min(deficitPx - resolved, Math.max(0, availableLeft - appliedLeft));
    resolved += extraLeft;
    leftBounds.x -= extraLeft;
  }

  leftBounds.x -= appliedLeft;
  rightBounds.x += appliedRight;
  return resolved;
}

function detectPairConflict(
  firstId: string,
  secondId: string,
  firstBounds: MagnetBounds,
  secondBounds: MagnetBounds
): MagnetAdaptiveConflict | null {
  const xOverlap = getOverlap(firstBounds.x, firstBounds.width, secondBounds.x, secondBounds.width);
  const yOverlap = getOverlap(firstBounds.y, firstBounds.height, secondBounds.y, secondBounds.height);
  const xGap = getHorizontalGap(firstBounds, secondBounds);
  const yGap = getVerticalGap(firstBounds, secondBounds);

  if (xOverlap > 0 && yOverlap > 0) {
    if (xOverlap <= yOverlap) {
      return { magnetA: firstId, magnetB: secondId, axis: 'horizontal', deficitPx: Math.ceil(xOverlap + MIN_VISUAL_GAP_PX) };
    }

    return { magnetA: firstId, magnetB: secondId, axis: 'vertical', deficitPx: Math.ceil(yOverlap + MIN_VISUAL_GAP_PX) };
  }

  if (xOverlap > 0 && yGap < MIN_VISUAL_GAP_PX) {
    return { magnetA: firstId, magnetB: secondId, axis: 'vertical', deficitPx: Math.ceil(MIN_VISUAL_GAP_PX - yGap) };
  }

  if (yOverlap > 0 && xGap < MIN_VISUAL_GAP_PX) {
    return { magnetA: firstId, magnetB: secondId, axis: 'horizontal', deficitPx: Math.ceil(MIN_VISUAL_GAP_PX - xGap) };
  }

  return null;
}

function detectMagnetJoins(boundsByMagnetId: Record<string, MagnetBounds>): Record<string, MagnetJoinEdges> {
  const entries = Object.entries(boundsByMagnetId);
  const joinsByMagnetId = Object.fromEntries(
    entries.map(([magnetId]) => [magnetId, createEmptyJoinEdges()])
  ) as Record<string, MagnetJoinEdges>;

  const EDGE_TOLERANCE_PX = 1;

  for (let index = 0; index < entries.length; index++) {
    const [firstId, firstBounds] = entries[index];
    for (let nextIndex = index + 1; nextIndex < entries.length; nextIndex++) {
      const [secondId, secondBounds] = entries[nextIndex];

      const xOverlap = getOverlap(firstBounds.x, firstBounds.width, secondBounds.x, secondBounds.width);
      const yOverlap = getOverlap(firstBounds.y, firstBounds.height, secondBounds.y, secondBounds.height);

      if (yOverlap > 0) {
        const firstRightToSecondLeft = Math.abs(firstBounds.x + firstBounds.width - secondBounds.x) <= EDGE_TOLERANCE_PX;
        const secondRightToFirstLeft = Math.abs(secondBounds.x + secondBounds.width - firstBounds.x) <= EDGE_TOLERANCE_PX;

        if (firstRightToSecondLeft) {
          joinsByMagnetId[firstId].right = true;
          joinsByMagnetId[secondId].left = true;
        }

        if (secondRightToFirstLeft) {
          joinsByMagnetId[secondId].right = true;
          joinsByMagnetId[firstId].left = true;
        }
      }

      if (xOverlap > 0) {
        const firstBottomToSecondTop = Math.abs(firstBounds.y + firstBounds.height - secondBounds.y) <= EDGE_TOLERANCE_PX;
        const secondBottomToFirstTop = Math.abs(secondBounds.y + secondBounds.height - firstBounds.y) <= EDGE_TOLERANCE_PX;

        if (firstBottomToSecondTop) {
          joinsByMagnetId[firstId].bottom = true;
          joinsByMagnetId[secondId].top = true;
        }

        if (secondBottomToFirstTop) {
          joinsByMagnetId[secondId].bottom = true;
          joinsByMagnetId[firstId].top = true;
        }
      }
    }
  }

  return joinsByMagnetId;
}

export function buildAdaptiveMagnetLayout(
  magnets: Magnet[],
  pixelPositions: Map<string, { x: number; y: number }>,
  viewport: { width: number; height: number }
): MagnetAdaptiveLayoutResult {
  const rawBoundsEntries = magnets
    .map((magnet) => {
      const bounds = computeMagnetBounds(magnet, pixelPositions);
      return bounds ? ([magnet.id, alignMagnetBounds(bounds)] as const) : null;
    })
    .filter((entry): entry is readonly [string, MagnetBounds] => entry !== null);

  const boundsByMagnetId = Object.fromEntries(
    rawBoundsEntries.map(([magnetId, bounds]) => [magnetId, cloneBounds(bounds)])
  ) as Record<string, MagnetBounds>;

  const conflicts: MagnetAdaptiveConflict[] = [];
  let maxAdjustmentPx = 0;

  for (let iteration = 0; iteration < ITERATION_LIMIT; iteration++) {
    let movedInIteration = false;

    for (let index = 0; index < rawBoundsEntries.length; index++) {
      const [firstId] = rawBoundsEntries[index];
      for (let nextIndex = index + 1; nextIndex < rawBoundsEntries.length; nextIndex++) {
        const [secondId] = rawBoundsEntries[nextIndex];
        const firstBounds = boundsByMagnetId[firstId];
        const secondBounds = boundsByMagnetId[secondId];
        const conflict = detectPairConflict(firstId, secondId, firstBounds, secondBounds);
        if (!conflict) continue;

        conflicts.push(conflict);

        if (conflict.axis === 'vertical') {
          const [topBounds, bottomBounds] =
            firstBounds.y <= secondBounds.y ? [firstBounds, secondBounds] : [secondBounds, firstBounds];
          const resolvedPx = shiftVertically(topBounds, bottomBounds, viewport.height, conflict.deficitPx);
          maxAdjustmentPx = Math.max(maxAdjustmentPx, resolvedPx);
          movedInIteration ||= resolvedPx > 0;
        } else {
          const [leftBounds, rightBounds] =
            firstBounds.x <= secondBounds.x ? [firstBounds, secondBounds] : [secondBounds, firstBounds];
          const resolvedPx = shiftHorizontally(leftBounds, rightBounds, viewport.width, conflict.deficitPx);
          maxAdjustmentPx = Math.max(maxAdjustmentPx, resolvedPx);
          movedInIteration ||= resolvedPx > 0;
        }
      }
    }

    if (!movedInIteration) break;
  }

  const unresolvedConflicts: MagnetAdaptiveConflict[] = [];
  for (let index = 0; index < rawBoundsEntries.length; index++) {
    const [firstId] = rawBoundsEntries[index];
    for (let nextIndex = index + 1; nextIndex < rawBoundsEntries.length; nextIndex++) {
      const [secondId] = rawBoundsEntries[nextIndex];
      const conflict = detectPairConflict(firstId, secondId, boundsByMagnetId[firstId], boundsByMagnetId[secondId]);
      if (conflict) unresolvedConflicts.push(conflict);
    }
  }

  const outOfBoundsIds = Object.entries(boundsByMagnetId)
    .filter(([, bounds]) => bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > viewport.width || bounds.y + bounds.height > viewport.height)
    .map(([magnetId]) => magnetId);

  let mode: MagnetAdaptiveLayoutMode = 'normal';
  if (unresolvedConflicts.length > 0 || outOfBoundsIds.length > 0) {
    mode = 'constrained';
  } else if (maxAdjustmentPx > 0) {
    mode = 'compact';
  }

  const alignedBoundsByMagnetId = Object.fromEntries(
    Object.entries(boundsByMagnetId).map(([magnetId, bounds]) => [magnetId, alignMagnetBounds(bounds)])
  ) as Record<string, MagnetBounds>;

  return {
    mode,
    boundsByMagnetId: alignedBoundsByMagnetId,
    joinsByMagnetId: detectMagnetJoins(alignedBoundsByMagnetId),
    diagnostics: {
      maxAdjustmentPx,
      outOfBoundsIds,
      conflicts,
      unresolvedConflicts,
    },
  };
}
