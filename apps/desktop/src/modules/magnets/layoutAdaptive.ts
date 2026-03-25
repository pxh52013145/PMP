import type { Magnet } from '../../types/pixel';
import { alignMagnetBounds, computeMagnetBounds, type MagnetBounds } from './geometry';

const MIN_VISUAL_GAP_PX = 0;
const ITERATION_LIMIT = 4;
// Layout bounds are aligned to integers, so allow 0px overlap to avoid magnets "covering" 1px borders.
const CONFLICT_OVERLAP_DEADZONE_PX = 0;
// Edge comparisons still keep a small tolerance for float→int rounding, but joins must never bridge a visible gap.
const EDGE_TOLERANCE_PX = 1;

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
  layoutBoundsByMagnetId: Record<string, MagnetBounds>;
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

function toMagnetBoundsMap(magnets: Magnet[]) {
  return Object.fromEntries(magnets.map((magnet) => [magnet.id, magnet])) as Record<string, Magnet>;
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

function collectHorizontallyAlignedBounds(options: {
  referenceId: string;
  referenceBounds: MagnetBounds;
  boundsByMagnetId: Record<string, MagnetBounds>;
  magnetsById: Record<string, Magnet>;
}): MagnetBounds[] {
  const referenceMagnet = options.magnetsById[options.referenceId];
  if (!referenceMagnet || referenceMagnet.anchorType !== 'rectangular') {
    return [options.referenceBounds];
  }

  const targetX = options.referenceBounds.x;
  const targetWidth = options.referenceBounds.width;
  const group: MagnetBounds[] = [];
  for (const [magnetId, bounds] of Object.entries(options.boundsByMagnetId)) {
    const magnet = options.magnetsById[magnetId];
    if (!magnet || magnet.anchorType !== referenceMagnet.anchorType) continue;
    if (Math.abs(bounds.x - targetX) > EDGE_TOLERANCE_PX) continue;
    if (Math.abs(bounds.width - targetWidth) > EDGE_TOLERANCE_PX) continue;
    group.push(bounds);
  }

  return group.length > 0 ? group : [options.referenceBounds];
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
  leftBounds: MagnetBounds[],
  rightBounds: MagnetBounds[],
  viewportWidth: number,
  deficitPx: number
): number {
  const availableLeft = leftBounds.reduce((min, bounds) => Math.min(min, Math.max(0, bounds.x)), Number.POSITIVE_INFINITY);
  const availableRight = rightBounds.reduce(
    (min, bounds) => Math.min(min, Math.max(0, viewportWidth - (bounds.x + bounds.width))),
    Number.POSITIVE_INFINITY
  );
  const desiredLeft = Math.ceil(deficitPx / 2);
  const desiredRight = Math.floor(deficitPx / 2);
  let shiftLeft = Math.min(desiredLeft, availableLeft);
  let shiftRight = Math.min(desiredRight, availableRight);
  let resolved = shiftLeft + shiftRight;

  if (resolved < deficitPx) {
    const extraRight = Math.min(deficitPx - resolved, Math.max(0, availableRight - shiftRight));
    resolved += extraRight;
    shiftRight += extraRight;
  }

  if (resolved < deficitPx) {
    const extraLeft = Math.min(deficitPx - resolved, Math.max(0, availableLeft - shiftLeft));
    resolved += extraLeft;
    shiftLeft += extraLeft;
  }

  if (shiftLeft > 0) {
    for (const bounds of leftBounds) {
      bounds.x -= shiftLeft;
    }
  }

  if (shiftRight > 0) {
    for (const bounds of rightBounds) {
      bounds.x += shiftRight;
    }
  }

  return resolved;
}

function detectPairConflict(
  firstId: string,
  secondId: string,
  firstBounds: MagnetBounds,
  secondBounds: MagnetBounds
): MagnetAdaptiveConflict | null {
  const rawXOverlap = getOverlap(firstBounds.x, firstBounds.width, secondBounds.x, secondBounds.width);
  const rawYOverlap = getOverlap(firstBounds.y, firstBounds.height, secondBounds.y, secondBounds.height);
  const xOverlap = rawXOverlap > CONFLICT_OVERLAP_DEADZONE_PX ? rawXOverlap : 0;
  const yOverlap = rawYOverlap > CONFLICT_OVERLAP_DEADZONE_PX ? rawYOverlap : 0;
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
  const joinsByMagnetId = Object.fromEntries(entries.map(([magnetId]) => [magnetId, createEmptyJoinEdges()])) as Record<
    string,
    MagnetJoinEdges
  >;

  type Segment = [start: number, end: number];
  type SegmentMap = Record<keyof MagnetJoinEdges, Segment[]>;

  const segmentsByMagnetId = Object.fromEntries(
    entries.map(([magnetId]) => [
      magnetId,
      {
        left: [],
        right: [],
        top: [],
        bottom: [],
      } satisfies SegmentMap,
    ])
  ) as Record<string, SegmentMap>;

  const pushSegment = (segments: Segment[], start: number, end: number) => {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (end - start <= 0) return;
    segments.push([start, end]);
  };

  const mergeSegments = (segments: Segment[]): Segment[] => {
    if (segments.length === 0) return [];
    const sorted = segments
      .slice()
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: Segment[] = [[sorted[0][0], sorted[0][1]]];
    for (let index = 1; index < sorted.length; index++) {
      const [start, end] = sorted[index];
      const last = merged[merged.length - 1];
      if (start <= last[1]) {
        last[1] = Math.max(last[1], end);
      } else {
        merged.push([start, end]);
      }
    }
    return merged;
  };

  const coverageOfSegments = (segments: Segment[]): number => {
    return mergeSegments(segments).reduce((sum, [start, end]) => sum + (end - start), 0);
  };

  const isFullyCovered = (segments: Segment[], length: number): boolean => {
    if (segments.length === 0) return false;
    return coverageOfSegments(segments) >= Math.max(0, length);
  };

  for (let index = 0; index < entries.length; index++) {
    const [firstId, firstBounds] = entries[index];
    for (let nextIndex = index + 1; nextIndex < entries.length; nextIndex++) {
      const [secondId, secondBounds] = entries[nextIndex];

      const xOverlap = getOverlap(firstBounds.x, firstBounds.width, secondBounds.x, secondBounds.width);
      const yOverlap = getOverlap(firstBounds.y, firstBounds.height, secondBounds.y, secondBounds.height);

      if (yOverlap > 0) {
        const deltaRight = firstBounds.x + firstBounds.width - secondBounds.x;
        const deltaLeft = secondBounds.x + secondBounds.width - firstBounds.x;
        const firstRightToSecondLeft = deltaRight >= 0 && deltaRight <= EDGE_TOLERANCE_PX;
        const secondRightToFirstLeft = deltaLeft >= 0 && deltaLeft <= EDGE_TOLERANCE_PX;

        if (firstRightToSecondLeft) {
          const start = Math.max(firstBounds.y, secondBounds.y);
          const end = Math.min(firstBounds.y + firstBounds.height, secondBounds.y + secondBounds.height);
          pushSegment(segmentsByMagnetId[firstId].right, start, end);
          pushSegment(segmentsByMagnetId[secondId].left, start, end);
        }

        if (secondRightToFirstLeft) {
          const start = Math.max(firstBounds.y, secondBounds.y);
          const end = Math.min(firstBounds.y + firstBounds.height, secondBounds.y + secondBounds.height);
          pushSegment(segmentsByMagnetId[secondId].right, start, end);
          pushSegment(segmentsByMagnetId[firstId].left, start, end);
        }
      }

      if (xOverlap > 0) {
        const deltaBottom = firstBounds.y + firstBounds.height - secondBounds.y;
        const deltaTop = secondBounds.y + secondBounds.height - firstBounds.y;
        const firstBottomToSecondTop = deltaBottom >= 0 && deltaBottom <= EDGE_TOLERANCE_PX;
        const secondBottomToFirstTop = deltaTop >= 0 && deltaTop <= EDGE_TOLERANCE_PX;

        if (firstBottomToSecondTop) {
          const start = Math.max(firstBounds.x, secondBounds.x);
          const end = Math.min(firstBounds.x + firstBounds.width, secondBounds.x + secondBounds.width);
          pushSegment(segmentsByMagnetId[firstId].bottom, start, end);
          pushSegment(segmentsByMagnetId[secondId].top, start, end);
        }

        if (secondBottomToFirstTop) {
          const start = Math.max(firstBounds.x, secondBounds.x);
          const end = Math.min(firstBounds.x + firstBounds.width, secondBounds.x + secondBounds.width);
          pushSegment(segmentsByMagnetId[secondId].bottom, start, end);
          pushSegment(segmentsByMagnetId[firstId].top, start, end);
        }
      }
    }
  }

  for (const [magnetId, bounds] of entries) {
    const segments = segmentsByMagnetId[magnetId];
    if (!segments) continue;

    joinsByMagnetId[magnetId].left = isFullyCovered(segments.left, bounds.height);
    joinsByMagnetId[magnetId].right = isFullyCovered(segments.right, bounds.height);
    joinsByMagnetId[magnetId].top = isFullyCovered(segments.top, bounds.width);
    joinsByMagnetId[magnetId].bottom = isFullyCovered(segments.bottom, bounds.width);
  }

  return joinsByMagnetId;
}

export function buildAdaptiveMagnetLayout(
  magnets: Magnet[],
  pixelPositions: Map<string, { x: number; y: number }>,
  viewport: { width: number; height: number }
): MagnetAdaptiveLayoutResult {
  const magnetsById = toMagnetBoundsMap(magnets);
  const rawBoundsEntries = magnets
    .map((magnet) => {
      const bounds = computeMagnetBounds(magnet, pixelPositions, {
        magnetsById,
        viewport,
      });
      return bounds ? ([magnet.id, alignMagnetBounds(bounds)] as const) : null;
    })
    .filter((entry): entry is readonly [string, MagnetBounds] => entry !== null);

  const layoutBoundsByMagnetId = Object.fromEntries(
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
        const firstBounds = layoutBoundsByMagnetId[firstId];
        const secondBounds = layoutBoundsByMagnetId[secondId];
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
          const [leftId, rightId] = firstBounds.x <= secondBounds.x ? [firstId, secondId] : [secondId, firstId];
          const leftBounds = layoutBoundsByMagnetId[leftId];
          const rightBounds = layoutBoundsByMagnetId[rightId];
          const resolvedPx = shiftHorizontally(
            collectHorizontallyAlignedBounds({
              referenceId: leftId,
              referenceBounds: leftBounds,
              boundsByMagnetId: layoutBoundsByMagnetId,
              magnetsById,
            }),
            collectHorizontallyAlignedBounds({
              referenceId: rightId,
              referenceBounds: rightBounds,
              boundsByMagnetId: layoutBoundsByMagnetId,
              magnetsById,
            }),
            viewport.width,
            conflict.deficitPx
          );
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
      const conflict = detectPairConflict(firstId, secondId, layoutBoundsByMagnetId[firstId], layoutBoundsByMagnetId[secondId]);
      if (conflict) unresolvedConflicts.push(conflict);
    }
  }

  const outOfBoundsIds = Object.entries(layoutBoundsByMagnetId)
    .filter(([, bounds]) => bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > viewport.width || bounds.y + bounds.height > viewport.height)
    .map(([magnetId]) => magnetId);

  let mode: MagnetAdaptiveLayoutMode = 'normal';
  if (unresolvedConflicts.length > 0 || outOfBoundsIds.length > 0) {
    mode = 'constrained';
  } else if (maxAdjustmentPx > 0) {
    mode = 'compact';
  }

  const alignedLayoutBoundsByMagnetId = Object.fromEntries(
    Object.entries(layoutBoundsByMagnetId).map(([magnetId, bounds]) => [magnetId, alignMagnetBounds(bounds)])
  ) as Record<string, MagnetBounds>;

  return {
    mode,
    layoutBoundsByMagnetId: alignedLayoutBoundsByMagnetId,
    joinsByMagnetId: detectMagnetJoins(alignedLayoutBoundsByMagnetId),
    diagnostics: {
      maxAdjustmentPx,
      outOfBoundsIds,
      conflicts,
      unresolvedConflicts,
    },
  };
}
