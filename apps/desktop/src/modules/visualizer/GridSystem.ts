import type { VisualizerViewportInfo } from './types';
import { clamp } from './CoordinateSystem';

export interface VisualizerGridOptions {
  minorStep?: number;
  majorEvery?: number;
  color?: string;
  majorColor?: string;
  axisColor?: string;
  opacity?: number;
  panX?: number;
  panY?: number;
  zoom?: number;
}

function drawLine(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function drawVisualizerGrid(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  viewport: VisualizerViewportInfo,
  options: VisualizerGridOptions = {}
): void {
  const zoom = Math.max(0.05, options.zoom ?? 1);
  const minorStep = Math.max(2, (options.minorStep ?? 40) * zoom);
  const majorEvery = Math.max(2, Math.round(options.majorEvery ?? 4));
  const opacity = clamp(options.opacity ?? 1, 0, 1);
  const width = viewport.width;
  const height = viewport.height;
  const offsetX = typeof options.panX === 'number' && Number.isFinite(options.panX) ? options.panX : 0;
  const offsetY = typeof options.panY === 'number' && Number.isFinite(options.panY) ? options.panY : 0;
  const originX = width / 2 + offsetX;
  const originY = height / 2 + offsetY;
  const previousAlpha = ctx.globalAlpha;
  const minorColor = options.color ?? 'rgba(255, 255, 255, 0.03)';
  const majorColor = options.majorColor ?? minorColor;

  ctx.save();
  ctx.globalAlpha = previousAlpha * opacity;
  ctx.lineWidth = 1;
  ctx.strokeStyle = minorColor;

  const snappedStartX = ((originX % minorStep) + minorStep) % minorStep;
  const snappedStartY = ((originY % minorStep) + minorStep) % minorStep;

  for (let x = snappedStartX; x <= width; x += minorStep) {
    const isMajor = Math.round((x - originX) / minorStep) % majorEvery === 0;
    ctx.strokeStyle = isMajor ? majorColor : minorColor;
    drawLine(ctx, x + 0.5, 0, x + 0.5, height);
  }

  for (let y = snappedStartY; y <= height; y += minorStep) {
    const isMajor = Math.round((y - originY) / minorStep) % majorEvery === 0;
    ctx.strokeStyle = isMajor ? majorColor : minorColor;
    drawLine(ctx, 0, y + 0.5, width, y + 0.5);
  }

  if (options.axisColor) {
    ctx.strokeStyle = options.axisColor;
    drawLine(ctx, originX + 0.5, 0, originX + 0.5, height);
    drawLine(ctx, 0, originY + 0.5, width, originY + 0.5);
  }
  ctx.restore();
}
