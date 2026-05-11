import {
  normalizeScale,
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

const EDIT_LABEL_ANGLES: Record<string, number> = {
  '@pmp/orbital/phase-scope': -Math.PI / 4,
  '@pmp/orbital/frequency-ring': -Math.PI / 2,
  '@pmp/orbital/chord-wheel': Math.PI / 2,
  '@pmp/orbital/progress-orbit': 0,
  '@pmp/orbital/particle-flow': Math.PI / 4,
  '@pmp/orbital/morse-telemetry': (Math.PI * 3) / 4,
  '@pmp/orbital/center-console': (-Math.PI * 3) / 4,
  '@pmp/orbital/track-header': -Math.PI / 6,
};

export const VISUALIZER_EDIT_LABEL_HEIGHT = 24;
export const VISUALIZER_EDIT_HANDLE_SIZE = 13;
export const VISUALIZER_EDIT_HANDLE_GAP = 8;
export const VISUALIZER_EDIT_LABEL_FONT =
  '600 11px "Cascadia Mono", "SFMono-Regular", Consolas, monospace';

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
  return Math.max(88, Math.min(220, measured + 18));
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

export function containsVisualizerEditRect(
  rect: Pick<VisualizerEditLabelRect | VisualizerEditHandleRect, 'x' | 'y' | 'width' | 'height'>,
  x: number,
  y: number
): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}
