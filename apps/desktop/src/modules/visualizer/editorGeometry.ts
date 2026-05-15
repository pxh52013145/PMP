import {
  getTransformRotation,
  normalizeScale,
  resolveComponentBaseSize,
  resolveComponentBounds,
  type VisualizerResolvedBounds,
} from './CoordinateSystem';
import type {
  VisualizerCanvasViewState,
  VisualizerComponent,
  VisualizerComponentTransform,
  VisualizerViewportInfo,
} from './types';

export type VisualizerEditHandleKind = 'scale';

export interface VisualizerEditableEntry {
  id: string;
  component: Pick<VisualizerComponent, 'manifest'>;
  transform: VisualizerComponentTransform;
}

export interface VisualizerEditLabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  text: string;
}

export interface VisualizerEditHandleRect {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  kind: VisualizerEditHandleKind;
}

export interface VisualizerEditMetrics {
  bounds: VisualizerResolvedBounds;
  label: VisualizerEditLabelRect;
  scaleHandle: VisualizerEditHandleRect;
}

interface VisualizerEditClusterRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type VisualizerEditFocusShape =
  | {
      type: 'annulus';
      centerX: number;
      centerY: number;
      radius: number;
      innerRadius: number;
      outerRadius: number;
      rotation: number;
      bodyHitEnabled: boolean;
    }
  | {
      type: 'circle';
      centerX: number;
      centerY: number;
      radius: number;
      rotation: number;
      bodyHitEnabled: boolean;
    }
  | {
      type: 'diamond';
      centerX: number;
      centerY: number;
      radius: number;
      thickness: number;
      rotation: number;
      bodyHitEnabled: boolean;
    }
  | {
      type: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      centerX: number;
      centerY: number;
      radius: number;
      rotation: number;
      bodyHitEnabled: boolean;
    };

type VisualizerEditFocusProfile =
  | {
      type: 'annulus';
      radiusRatio: number;
      thicknessRatio: number;
      minRadius?: number;
      minThickness?: number;
      maxThickness?: number;
      bodyHitEnabled?: boolean;
    }
  | {
      type: 'circle';
      radiusRatio: number;
      minRadius?: number;
      bodyHitEnabled?: boolean;
    }
  | {
      type: 'diamond';
      radiusRatio: number;
      thicknessRatio: number;
      minThickness?: number;
      bodyHitEnabled?: boolean;
    };

const EDIT_LABEL_ANGLES: Record<string, number> = {
  phase: -Math.PI / 4,
  freq: -Math.PI / 2,
  chords: Math.PI / 2,
  progress: 0,
  particles: Math.PI / 4,
  morse: (Math.PI * 3) / 4,
  center: (-Math.PI * 3) / 4,
  hud: 0,
  '@pmp/orbital/phase-scope': -Math.PI / 4,
  '@pmp/orbital/frequency-ring': -Math.PI / 2,
  '@pmp/orbital/chord-wheel': Math.PI / 2,
  '@pmp/orbital/progress-orbit': 0,
  '@pmp/orbital/particle-flow': Math.PI / 4,
  '@pmp/orbital/morse-telemetry': (Math.PI * 3) / 4,
  '@pmp/orbital/center-console': (-Math.PI * 3) / 4,
  '@pmp/orbital/track-header': -Math.PI / 6,
};

const EDIT_FOCUS_PROFILES: Record<string, VisualizerEditFocusProfile> = {
  freq: {
    type: 'annulus',
    radiusRatio: 0.43,
    thicknessRatio: 0.075,
    minThickness: 34,
    maxThickness: 76,
  },
  morse: {
    type: 'annulus',
    radiusRatio: 0.46,
    thicknessRatio: 0.065,
    minThickness: 30,
    maxThickness: 72,
  },
  progress: {
    type: 'annulus',
    radiusRatio: 0.28,
    thicknessRatio: 0.07,
    minThickness: 28,
    maxThickness: 62,
  },
  particles: {
    type: 'annulus',
    radiusRatio: 0.28,
    thicknessRatio: 0.1,
    minThickness: 34,
    maxThickness: 86,
    bodyHitEnabled: false,
  },
  chords: {
    type: 'annulus',
    radiusRatio: 0.21,
    thicknessRatio: 0.07,
    minRadius: 60,
    minThickness: 26,
    maxThickness: 58,
  },
  center: {
    type: 'circle',
    radiusRatio: 0.17,
    minRadius: 48,
  },
  phase: {
    type: 'diamond',
    radiusRatio: 0.36,
    thicknessRatio: 0.085,
    minThickness: 34,
  },
  '@pmp/orbital/frequency-ring': {
    type: 'annulus',
    radiusRatio: 0.43,
    thicknessRatio: 0.075,
    minThickness: 34,
    maxThickness: 76,
  },
  '@pmp/orbital/morse-telemetry': {
    type: 'annulus',
    radiusRatio: 0.46,
    thicknessRatio: 0.065,
    minThickness: 30,
    maxThickness: 72,
  },
  '@pmp/orbital/progress-orbit': {
    type: 'annulus',
    radiusRatio: 0.28,
    thicknessRatio: 0.07,
    minThickness: 28,
    maxThickness: 62,
  },
  '@pmp/orbital/particle-flow': {
    type: 'annulus',
    radiusRatio: 0.28,
    thicknessRatio: 0.1,
    minThickness: 34,
    maxThickness: 86,
    bodyHitEnabled: false,
  },
  '@pmp/orbital/chord-wheel': {
    type: 'annulus',
    radiusRatio: 0.21,
    thicknessRatio: 0.07,
    minRadius: 60,
    minThickness: 26,
    maxThickness: 58,
  },
  '@pmp/orbital/center-console': {
    type: 'circle',
    radiusRatio: 0.17,
    minRadius: 48,
  },
  '@pmp/orbital/phase-scope': {
    type: 'diamond',
    radiusRatio: 0.36,
    thicknessRatio: 0.085,
    minThickness: 34,
  },
};

export const VISUALIZER_EDIT_LABEL_HEIGHT = 24;
export const VISUALIZER_EDIT_HANDLE_SIZE = 13;
export const VISUALIZER_EDIT_HANDLE_GAP = 8;
export const VISUALIZER_EDIT_LABEL_FONT =
  '600 11px "Cascadia Mono", "SFMono-Regular", Consolas, monospace';

function clampFinite(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function translateEditMetrics(metrics: VisualizerEditMetrics, dx: number, dy: number): VisualizerEditMetrics {
  const label: VisualizerEditLabelRect = {
    ...metrics.label,
    x: metrics.label.x + dx,
    y: metrics.label.y + dy,
    centerX: metrics.label.centerX + dx,
    centerY: metrics.label.centerY + dy,
  };

  return {
    ...metrics,
    label,
    scaleHandle: {
      ...metrics.scaleHandle,
      x: label.x + label.width + VISUALIZER_EDIT_HANDLE_GAP,
      y: label.centerY - VISUALIZER_EDIT_HANDLE_SIZE / 2,
      centerX: label.x + label.width + VISUALIZER_EDIT_HANDLE_GAP + VISUALIZER_EDIT_HANDLE_SIZE / 2,
      centerY: label.centerY,
    },
  };
}

function getEditClusterRect(metrics: VisualizerEditMetrics, padding = 6): VisualizerEditClusterRect {
  const right = metrics.scaleHandle.x + metrics.scaleHandle.width;
  const bottom = Math.max(metrics.label.y + metrics.label.height, metrics.scaleHandle.y + metrics.scaleHandle.height);
  const x = metrics.label.x - padding;
  const y = Math.min(metrics.label.y, metrics.scaleHandle.y) - padding;
  return {
    x,
    y,
    width: right - x + padding,
    height: bottom - y + padding,
  };
}

function editRectsOverlap(left: VisualizerEditClusterRect, right: VisualizerEditClusterRect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function resolveAvoidanceVector(metrics: VisualizerEditMetrics): { x: number; y: number } {
  const dx = metrics.label.centerX - metrics.bounds.centerX;
  const dy = metrics.label.centerY - metrics.bounds.centerY;
  const length = Math.hypot(dx, dy);
  if (length > 0.001) {
    return {
      x: dx / length,
      y: dy / length,
    };
  }
  return { x: 0, y: -1 };
}

function avoidEditClusterOverlap(
  metrics: VisualizerEditMetrics,
  occupiedRects: VisualizerEditClusterRect[]
): VisualizerEditMetrics {
  const vector = resolveAvoidanceVector(metrics);
  const step = VISUALIZER_EDIT_LABEL_HEIGHT + 10;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const pushedMetrics = translateEditMetrics(metrics, vector.x * step * attempt, vector.y * step * attempt);
    const cluster = getEditClusterRect(pushedMetrics);
    if (!occupiedRects.some((rect) => editRectsOverlap(cluster, rect))) {
      return pushedMetrics;
    }
  }

  const baseAngle = Math.atan2(vector.y, vector.x);
  for (let ring = 1; ring <= 4; ring += 1) {
    for (let index = 0; index < 8; index += 1) {
      const angle = baseAngle + (Math.PI / 4) * index;
      const pushedMetrics = translateEditMetrics(
        metrics,
        Math.cos(angle) * step * (ring + 4),
        Math.sin(angle) * step * (ring + 4)
      );
      const cluster = getEditClusterRect(pushedMetrics);
      if (!occupiedRects.some((rect) => editRectsOverlap(cluster, rect))) {
        return pushedMetrics;
      }
    }
  }

  return translateEditMetrics(metrics, vector.x * step * 16, vector.y * step * 16);
}

export function getVisualizerUniformScale(transform: VisualizerComponentTransform): number {
  const scale = normalizeScale(transform.scale);
  return Math.max(0.05, (scale.x + scale.y) / 2);
}

function measureLabelWidth(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string
): number {
  ctx.save();
  ctx.font = VISUALIZER_EDIT_LABEL_FONT;
  const measured = Math.ceil(ctx.measureText(text).width);
  ctx.restore();
  return Math.max(88, Math.min(260, measured + 18));
}

function resolveLabelCenter(
  entry: VisualizerEditableEntry,
  bounds: VisualizerResolvedBounds,
  _labelWidth: number
): { x: number; y: number } {
  if (entry.component.manifest.geometry.type === 'rectangular') {
    return {
      x: bounds.centerX,
      y: bounds.y - VISUALIZER_EDIT_LABEL_HEIGHT / 2 - 12,
    };
  }

  const angle = EDIT_LABEL_ANGLES[entry.component.manifest.id] ?? -Math.PI / 4;
  const anchorRadius = bounds.radius + 18;
  return {
    x: bounds.centerX + Math.cos(angle) * anchorRadius,
    y: bounds.centerY + Math.sin(angle) * anchorRadius,
  };
}

export function getVisualizerEditMetrics(
  entry: VisualizerEditableEntry,
  viewport: VisualizerViewportInfo,
  viewState: Readonly<VisualizerCanvasViewState>,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
): VisualizerEditMetrics {
  const bounds = resolveComponentBounds(entry.transform, entry.component.manifest.geometry, viewport, viewState);
  const scale = Math.round(getVisualizerUniformScale(entry.transform) * 100);
  const text = `${entry.component.manifest.metadata.name}  Z:${entry.transform.zIndex}  ${scale}%`;
  const labelWidth = measureLabelWidth(ctx, text);
  const labelCenter = resolveLabelCenter(entry, bounds, labelWidth);
  const label: VisualizerEditLabelRect = {
    x: labelCenter.x - labelWidth / 2,
    y: labelCenter.y - VISUALIZER_EDIT_LABEL_HEIGHT / 2,
    width: labelWidth,
    height: VISUALIZER_EDIT_LABEL_HEIGHT,
    centerX: labelCenter.x,
    centerY: labelCenter.y,
    text,
  };
  const scaleHandle: VisualizerEditHandleRect = {
    x: label.x + label.width + VISUALIZER_EDIT_HANDLE_GAP,
    y: label.centerY - VISUALIZER_EDIT_HANDLE_SIZE / 2,
    width: VISUALIZER_EDIT_HANDLE_SIZE,
    height: VISUALIZER_EDIT_HANDLE_SIZE,
    centerX: label.x + label.width + VISUALIZER_EDIT_HANDLE_GAP + VISUALIZER_EDIT_HANDLE_SIZE / 2,
    centerY: label.centerY,
    kind: 'scale',
  };

  return {
    bounds,
    label,
    scaleHandle,
  };
}

export function getVisualizerEditMetricsById(
  entries: readonly VisualizerEditableEntry[],
  viewport: VisualizerViewportInfo,
  viewState: Readonly<VisualizerCanvasViewState>,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
): Map<string, VisualizerEditMetrics> {
  const sortedEntries = [...entries].sort((left, right) => {
    const zIndexDelta = right.transform.zIndex - left.transform.zIndex;
    return zIndexDelta !== 0 ? zIndexDelta : left.id.localeCompare(right.id);
  });
  const occupiedRects: VisualizerEditClusterRect[] = [];
  const metricsById = new Map<string, VisualizerEditMetrics>();

  for (const entry of sortedEntries) {
    if (!entry.transform.visible) continue;
    const metrics = avoidEditClusterOverlap(
      getVisualizerEditMetrics(entry, viewport, viewState, ctx),
      occupiedRects
    );
    occupiedRects.push(getEditClusterRect(metrics));
    metricsById.set(entry.id, metrics);
  }

  return metricsById;
}

export function getVisualizerEditFocusShape(
  entry: VisualizerEditableEntry,
  viewport: VisualizerViewportInfo,
  viewState: Readonly<VisualizerCanvasViewState>
): VisualizerEditFocusShape {
  const bounds = resolveComponentBounds(entry.transform, entry.component.manifest.geometry, viewport, viewState);
  const rotation = getTransformRotation(entry.transform);
  const profile = EDIT_FOCUS_PROFILES[entry.component.manifest.id];
  const baseSize = resolveComponentBaseSize(entry.component.manifest.geometry);
  const screenMin = Math.max(1, Math.min(bounds.width, bounds.height));
  const baseMin = Math.max(1, Math.min(baseSize.width, baseSize.height));
  const screenScale = screenMin / baseMin;
  const bodyHitEnabled = profile?.bodyHitEnabled !== false;

  if (profile?.type === 'annulus') {
    const radius = Math.max(screenMin * profile.radiusRatio, (profile.minRadius ?? 0) * screenScale);
    const rawThickness = Math.max(screenMin * profile.thicknessRatio, (profile.minThickness ?? 0) * screenScale);
    const maxThickness = (profile.maxThickness ?? Number.POSITIVE_INFINITY) * screenScale;
    const thickness = clampFinite(rawThickness, 8, Math.max(8, maxThickness));
    return {
      type: 'annulus',
      centerX: bounds.centerX,
      centerY: bounds.centerY,
      radius,
      innerRadius: Math.max(0, radius - thickness / 2),
      outerRadius: Math.max(radius + thickness / 2, radius + 1),
      rotation,
      bodyHitEnabled,
    };
  }

  if (profile?.type === 'circle') {
    return {
      type: 'circle',
      centerX: bounds.centerX,
      centerY: bounds.centerY,
      radius: Math.max(screenMin * profile.radiusRatio, (profile.minRadius ?? 0) * screenScale),
      rotation,
      bodyHitEnabled,
    };
  }

  if (profile?.type === 'diamond') {
    const radius = screenMin * profile.radiusRatio;
    return {
      type: 'diamond',
      centerX: bounds.centerX,
      centerY: bounds.centerY,
      radius,
      thickness: Math.max(screenMin * profile.thicknessRatio, (profile.minThickness ?? 0) * screenScale),
      rotation,
      bodyHitEnabled,
    };
  }

  if (entry.component.manifest.geometry.type === 'circular') {
    return {
      type: 'circle',
      centerX: bounds.centerX,
      centerY: bounds.centerY,
      radius: bounds.radius,
      rotation,
      bodyHitEnabled: true,
    };
  }

  return {
    type: 'rect',
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    centerX: bounds.centerX,
    centerY: bounds.centerY,
    radius: Math.min(14, Math.max(4, Math.min(bounds.width, bounds.height) * 0.08)),
    rotation,
    bodyHitEnabled: true,
  };
}

export function containsVisualizerEditRect(
  rect: Pick<VisualizerEditLabelRect | VisualizerEditHandleRect, 'x' | 'y' | 'width' | 'height'>,
  x: number,
  y: number
): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function containsVisualizerEditFocusShape(
  shape: VisualizerEditFocusShape,
  x: number,
  y: number
): boolean {
  if (!shape.bodyHitEnabled) return false;

  const dx = x - shape.centerX;
  const dy = y - shape.centerY;
  const rotation = Number.isFinite(shape.rotation) ? shape.rotation : 0;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  if (shape.type === 'annulus') {
    const distance = Math.hypot(localX, localY);
    return distance >= shape.innerRadius && distance <= shape.outerRadius;
  }

  if (shape.type === 'circle') {
    return Math.hypot(localX, localY) <= shape.radius;
  }

  if (shape.type === 'diamond') {
    const distanceToEdge = Math.abs(localX) + Math.abs(localY);
    const halfThickness = Math.max(8, shape.thickness) / 2;
    return distanceToEdge <= shape.radius + halfThickness;
  }

  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  return Math.abs(localX) <= halfWidth && Math.abs(localY) <= halfHeight;
}
