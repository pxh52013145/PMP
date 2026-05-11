import type {
  VisualizerComponentGeometry,
  VisualizerComponentRotation,
  VisualizerComponentScale,
  VisualizerComponentTransform,
  VisualizerRectangularSize,
  VisualizerCanvasViewState,
  VisualizerViewportInfo,
} from './types';

export interface VisualizerResolvedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  radius: number;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function normalizeScale(value: number | VisualizerComponentScale): { x: number; y: number } {
  if (typeof value === 'number') {
    const safe = Number.isFinite(value) ? Math.max(0.05, value) : 1;
    return { x: safe, y: safe };
  }

  return {
    x: Number.isFinite(value.x) ? Math.max(0.05, value.x) : 1,
    y: Number.isFinite(value.y) ? Math.max(0.05, value.y) : 1,
  };
}

export function normalizeRotation(value: number | VisualizerComponentRotation): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  return Number.isFinite(value.z) ? value.z : 0;
}

function readRectangularSize(size: VisualizerRectangularSize): { width: number; height: number } {
  return {
    width: Number.isFinite(size.width) ? Math.max(1, size.width) : 1,
    height: Number.isFinite(size.height) ? Math.max(1, size.height) : 1,
  };
}

function resolveAdaptiveCircularSize(viewport: VisualizerViewportInfo): { width: number; height: number } {
  const diameter = Math.max(1, Math.min(viewport.width, viewport.height) * 0.98);
  return { width: diameter, height: diameter };
}

function resolveAdaptiveRectangularSize(
  size: VisualizerRectangularSize,
  viewport: VisualizerViewportInfo
): { width: number; height: number } {
  const base = readRectangularSize(size);
  return {
    width: Math.max(1, Math.min(base.width, viewport.width * 0.98)),
    height: Math.max(1, Math.min(base.height, viewport.height * 0.98)),
  };
}

export function resolveComponentBounds(
  transform: VisualizerComponentTransform,
  geometry: VisualizerComponentGeometry,
  viewport: VisualizerViewportInfo,
  viewState: Readonly<VisualizerCanvasViewState> = { panX: 0, panY: 0, zoom: 1 }
): VisualizerResolvedBounds {
  const scale = normalizeScale(transform.scale);
  const zoom = Math.max(0.05, Number.isFinite(viewState.zoom) ? viewState.zoom : 1);
  const positionX = viewport.width / 2 + (Number.isFinite(viewState.panX) ? viewState.panX : 0) + transform.position.x * zoom;
  const positionY = viewport.height / 2 + (Number.isFinite(viewState.panY) ? viewState.panY : 0) + transform.position.y * zoom;

  const baseSize =
    geometry.type === 'circular'
      ? resolveAdaptiveCircularSize(viewport)
      : resolveAdaptiveRectangularSize(geometry.defaultSize as VisualizerRectangularSize, viewport);

  const width = Math.max(1, baseSize.width * scale.x * zoom);
  const height = Math.max(1, baseSize.height * scale.y * zoom);
  const x = positionX - width / 2;
  const y = positionY - height / 2;

  return {
    x,
    y,
    width,
    height,
    centerX: positionX,
    centerY: positionY,
    radius: Math.min(width, height) / 2,
  };
}

export function getTransformOpacity(transform: VisualizerComponentTransform): number {
  return clamp(transform.opacity, 0, 1);
}

export function getTransformRotation(transform: VisualizerComponentTransform): number {
  return normalizeRotation(transform.rotation);
}

export function createViewportInfo(
  width: number,
  height: number,
  devicePixelRatio: number
): VisualizerViewportInfo {
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    devicePixelRatio: Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1,
  };
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  viewport: VisualizerViewportInfo,
  viewState: Readonly<VisualizerCanvasViewState> = { panX: 0, panY: 0, zoom: 1 }
): { x: number; y: number } {
  const zoom = Math.max(0.05, Number.isFinite(viewState.zoom) ? viewState.zoom : 1);
  return {
    x: (screenX - viewport.width / 2 - (Number.isFinite(viewState.panX) ? viewState.panX : 0)) / zoom,
    y: (screenY - viewport.height / 2 - (Number.isFinite(viewState.panY) ? viewState.panY : 0)) / zoom,
  };
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  viewport: VisualizerViewportInfo,
  viewState: Readonly<VisualizerCanvasViewState> = { panX: 0, panY: 0, zoom: 1 }
): { x: number; y: number } {
  const zoom = Math.max(0.05, Number.isFinite(viewState.zoom) ? viewState.zoom : 1);
  return {
    x: viewport.width / 2 + (Number.isFinite(viewState.panX) ? viewState.panX : 0) + worldX * zoom,
    y: viewport.height / 2 + (Number.isFinite(viewState.panY) ? viewState.panY : 0) + worldY * zoom,
  };
}
