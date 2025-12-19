import { MATRIX_CONFIG } from '../constants/config';

export interface PixelGridLayout {
  width: number;
  height: number;
  spacingX: number;
  spacingY: number;
  stepX: number;
  stepY: number;
}

export function computePixelGridLayout(width: number, height: number): PixelGridLayout {
  const { COLUMNS, ROWS, PIXEL_SIZE, EDGE_PADDING } = MATRIX_CONFIG;

  const availableWidth = width - EDGE_PADDING * 2;
  const availableHeight = height - EDGE_PADDING * 2;

  const spacingX = Math.max(0, (availableWidth - COLUMNS * PIXEL_SIZE) / (COLUMNS - 1));
  const spacingY = Math.max(0, (availableHeight - ROWS * PIXEL_SIZE) / (ROWS - 1));

  return {
    width,
    height,
    spacingX,
    spacingY,
    stepX: PIXEL_SIZE + spacingX,
    stepY: PIXEL_SIZE + spacingY,
  };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value | 0));
}

export function nearestPixelGridFromPoint(
  x: number,
  y: number,
  layout: Pick<PixelGridLayout, 'stepX' | 'stepY'>
): { gridX: number; gridY: number } {
  const { COLUMNS, ROWS, EDGE_PADDING } = MATRIX_CONFIG;

  const col = Math.round((x - EDGE_PADDING) / layout.stepX);
  const row = Math.round((y - EDGE_PADDING) / layout.stepY);

  return {
    gridX: clampInt(col, 0, COLUMNS - 1),
    gridY: clampInt(row, 0, ROWS - 1),
  };
}

export function hitTestPixelGridFromPoint(
  x: number,
  y: number,
  layout: Pick<PixelGridLayout, 'stepX' | 'stepY'>
): { gridX: number; gridY: number } | null {
  const { COLUMNS, ROWS, PIXEL_SIZE, EDGE_PADDING } = MATRIX_CONFIG;

  const col = Math.round((x - EDGE_PADDING) / layout.stepX);
  const row = Math.round((y - EDGE_PADDING) / layout.stepY);

  if (col < 0 || col >= COLUMNS || row < 0 || row >= ROWS) return null;

  const pixelX = EDGE_PADDING + col * layout.stepX;
  const pixelY = EDGE_PADDING + row * layout.stepY;

  if (x < pixelX || x > pixelX + PIXEL_SIZE) return null;
  if (y < pixelY || y > pixelY + PIXEL_SIZE) return null;

  return { gridX: col, gridY: row };
}

