import type { CSSProperties } from 'react';

import type { MagnetBounds } from '../../modules/magnets/geometry';
import type { ResolvedThemeMotionScene } from '../../themes/motion';
import { buildThemePresenceAnimationStyle, getThemeMotionTotalMs } from '../../themes/surfaceMotion';
import type { ThemeMotionChannelSpec } from '../../themes/types/theme';

export type MagnetSceneId = 'appBoot' | 'spaceSwitch';
export type MagnetScenePhase = 'enter' | 'exit';

export interface MagnetSceneAnimation {
  sceneId: MagnetSceneId;
  phase: MagnetScenePhase;
  channel: 'enter' | 'exit';
  spec: ThemeMotionChannelSpec;
  style?: CSSProperties;
  totalMs: number;
}

type MagnetSceneStaggerBy = NonNullable<ResolvedThemeMotionScene['stagger']>['by'];

type MagnetSceneOrderItem = {
  id: string;
  index: number;
  centerX: number;
  centerY: number;
  distanceToCenter: number;
};

function parseMilliseconds(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }

  if (typeof value !== 'string') {
    return 0;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return 0;
  }

  if (normalized.endsWith('ms')) {
    const numeric = Number.parseFloat(normalized.slice(0, -2));
    return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  }

  if (normalized.endsWith('s')) {
    const numeric = Number.parseFloat(normalized.slice(0, -1));
    return Number.isFinite(numeric) ? Math.max(0, numeric * 1000) : 0;
  }

  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function formatMilliseconds(value: number): string {
  return `${Math.max(0, Math.round(value))}ms`;
}

function resolveBoundsCenter(bounds: MagnetBounds | undefined, fallbackIndex: number): { x: number; y: number } {
  if (!bounds) {
    return { x: fallbackIndex, y: fallbackIndex };
  }

  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function compareNumbers(first: number, second: number): number {
  return first === second ? 0 : first < second ? -1 : 1;
}

function compareByIndex(first: MagnetSceneOrderItem, second: MagnetSceneOrderItem): number {
  return compareNumbers(first.index, second.index);
}

function compareByGrid(first: MagnetSceneOrderItem, second: MagnetSceneOrderItem): number {
  return (
    compareNumbers(first.centerY, second.centerY) ||
    compareNumbers(first.centerX, second.centerX) ||
    compareByIndex(first, second)
  );
}

function compareByAxis(
  first: MagnetSceneOrderItem,
  second: MagnetSceneOrderItem,
  axis: 'x' | 'y'
): number {
  return axis === 'x'
    ? compareNumbers(first.centerX, second.centerX) ||
        compareNumbers(first.centerY, second.centerY) ||
        compareByIndex(first, second)
    : compareNumbers(first.centerY, second.centerY) ||
        compareNumbers(first.centerX, second.centerX) ||
        compareByIndex(first, second);
}

function compareByDistance(first: MagnetSceneOrderItem, second: MagnetSceneOrderItem): number {
  return compareNumbers(first.distanceToCenter, second.distanceToCenter) || compareByGrid(first, second);
}

function compareFromCenter(
  first: MagnetSceneOrderItem,
  second: MagnetSceneOrderItem,
  by: MagnetSceneStaggerBy,
  midpoint: number,
  centerX: number,
  centerY: number
): number {
  if (by === 'index') {
    return compareNumbers(Math.abs(first.index - midpoint), Math.abs(second.index - midpoint)) || compareByIndex(first, second);
  }

  if (by === 'x') {
    return (
      compareNumbers(Math.abs(first.centerX - centerX), Math.abs(second.centerX - centerX)) ||
      compareByAxis(first, second, 'x')
    );
  }

  if (by === 'y') {
    return (
      compareNumbers(Math.abs(first.centerY - centerY), Math.abs(second.centerY - centerY)) ||
      compareByAxis(first, second, 'y')
    );
  }

  return compareByDistance(first, second);
}

export function orderMagnetSceneIds(
  ids: string[],
  boundsByMagnetId: Record<string, MagnetBounds | undefined>,
  stagger: ResolvedThemeMotionScene['stagger']
): string[] {
  if (ids.length <= 1) {
    return [...ids];
  }

  const centers = ids.map((id, index) => {
    const center = resolveBoundsCenter(boundsByMagnetId[id], index);
    return {
      id,
      index,
      centerX: center.x,
      centerY: center.y,
      distanceToCenter: 0,
    };
  });

  const centerX = centers.reduce((sum, entry) => sum + entry.centerX, 0) / Math.max(1, centers.length);
  const centerY = centers.reduce((sum, entry) => sum + entry.centerY, 0) / Math.max(1, centers.length);
  const midpoint = (centers.length - 1) / 2;

  const items = centers.map<MagnetSceneOrderItem>((entry) => ({
    ...entry,
    distanceToCenter: Math.hypot(entry.centerX - centerX, entry.centerY - centerY),
  }));

  const by = stagger?.by ?? 'index';
  const from = stagger?.from ?? 'start';

  items.sort((first, second) => {
    const base =
      from === 'center'
        ? compareFromCenter(first, second, by, midpoint, centerX, centerY)
        : by === 'x'
          ? compareByAxis(first, second, 'x')
          : by === 'y'
            ? compareByAxis(first, second, 'y')
            : by === 'distance'
              ? compareByDistance(first, second)
              : by === 'grid'
                ? compareByGrid(first, second)
                : compareByIndex(first, second);

    return from === 'end' ? -base : base;
  });

  return items.map((item) => item.id);
}

function offsetMotionDelay(spec: ThemeMotionChannelSpec, delayOffsetMs: number): ThemeMotionChannelSpec {
  const baseDelayMs = parseMilliseconds(spec.delay);
  const totalDelayMs = baseDelayMs + Math.max(0, delayOffsetMs);

  return {
    ...spec,
    delay: totalDelayMs > 0 ? formatMilliseconds(totalDelayMs) : spec.delay,
  };
}

export function buildMagnetSceneAnimations(options: {
  sceneId: MagnetSceneId;
  phase: MagnetScenePhase;
  spec?: ThemeMotionChannelSpec;
  ids: string[];
  boundsByMagnetId: Record<string, MagnetBounds | undefined>;
  stagger?: ResolvedThemeMotionScene['stagger'];
}): {
  animationsById: Record<string, MagnetSceneAnimation>;
  maxTotalMs: number;
} {
  const { sceneId, phase, spec, ids, boundsByMagnetId, stagger } = options;
  if (!spec || ids.length === 0) {
    return {
      animationsById: {},
      maxTotalMs: 0,
    };
  }

  const orderedIds = orderMagnetSceneIds(ids, boundsByMagnetId, stagger);
  const stepMs = parseMilliseconds(stagger?.step);
  const animationsById: Record<string, MagnetSceneAnimation> = {};
  let maxTotalMs = 0;

  orderedIds.forEach((id, orderIndex) => {
    const delayedSpec = stepMs > 0 ? offsetMotionDelay(spec, stepMs * orderIndex) : { ...spec };
    const totalMs = getThemeMotionTotalMs(delayedSpec);
    animationsById[id] = {
      sceneId,
      phase,
      channel: phase,
      spec: delayedSpec,
      style: buildThemePresenceAnimationStyle(delayedSpec, phase),
      totalMs,
    };
    maxTotalMs = Math.max(maxTotalMs, totalMs);
  });

  return {
    animationsById,
    maxTotalMs,
  };
}

export function buildMagnetSceneLayoutChannels(options: {
  spec?: ThemeMotionChannelSpec;
  ids: string[];
  boundsByMagnetId: Record<string, MagnetBounds | undefined>;
  stagger?: ResolvedThemeMotionScene['stagger'];
}): {
  channelsById: Record<string, ThemeMotionChannelSpec>;
  maxTotalMs: number;
} {
  const { spec, ids, boundsByMagnetId, stagger } = options;
  if (!spec || ids.length === 0) {
    return {
      channelsById: {},
      maxTotalMs: 0,
    };
  }

  const orderedIds = orderMagnetSceneIds(ids, boundsByMagnetId, stagger);
  const stepMs = parseMilliseconds(stagger?.step);
  const channelsById: Record<string, ThemeMotionChannelSpec> = {};
  let maxTotalMs = 0;

  orderedIds.forEach((id, orderIndex) => {
    const delayedSpec = stepMs > 0 ? offsetMotionDelay(spec, stepMs * orderIndex) : { ...spec };
    channelsById[id] = delayedSpec;
    maxTotalMs = Math.max(maxTotalMs, getThemeMotionTotalMs(delayedSpec));
  });

  return {
    channelsById,
    maxTotalMs,
  };
}
