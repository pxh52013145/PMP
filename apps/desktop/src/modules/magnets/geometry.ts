import { MATRIX_CONFIG } from '../../constants/config';
import type { Magnet, MagnetStyle } from '../../types/pixel';

export interface MagnetBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MagnetInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function parseSize(value: string | undefined, fallbackPx: number): number {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallbackPx;
}

function deriveGridStep(distancePx: number, distanceGrid: number): number {
  const { PIXEL_SIZE } = MATRIX_CONFIG;
  if (distanceGrid <= 0) return PIXEL_SIZE;

  const step = distancePx / distanceGrid;
  if (!Number.isFinite(step) || step <= 0) return PIXEL_SIZE;
  return step;
}

function resolveHalfGap(step: number): number {
  const { PIXEL_SIZE } = MATRIX_CONFIG;
  return Math.max(0, step - PIXEL_SIZE) / 2;
}

function resolveHorizontalSpanBounds(leftX: number, rightX: number, leftCol: number, rightCol: number) {
  const { COLUMNS, EDGE_PADDING, PIXEL_SIZE } = MATRIX_CONFIG;
  const stepX = deriveGridStep(rightX - leftX, rightCol - leftCol);
  const halfGap = resolveHalfGap(stepX);
  const x = leftCol <= 0 ? EDGE_PADDING / 2 : leftX - halfGap;
  const right = rightCol >= COLUMNS - 1 ? rightX + PIXEL_SIZE + EDGE_PADDING / 2 : rightX + PIXEL_SIZE + halfGap;

  return {
    x,
    width: Math.max(1, right - x),
  };
}

function resolveVerticalSpanBounds(topY: number, bottomY: number, topRow: number, bottomRow: number) {
  const { ROWS, EDGE_PADDING, PIXEL_SIZE } = MATRIX_CONFIG;
  const stepY = deriveGridStep(bottomY - topY, bottomRow - topRow);
  const halfGap = resolveHalfGap(stepY);
  const y = topRow <= 0 ? EDGE_PADDING / 2 : topY - halfGap;
  const bottom = bottomRow >= ROWS - 1 ? bottomY + PIXEL_SIZE + EDGE_PADDING / 2 : bottomY + PIXEL_SIZE + halfGap;

  return {
    y,
    height: Math.max(1, bottom - y),
  };
}

export function computeMagnetBounds(
  magnet: Pick<Magnet, 'anchorType' | 'anchors' | 'style'>,
  pixelPositions: Map<string, { x: number; y: number }>
): MagnetBounds | null {
  const { PIXEL_SIZE } = MATRIX_CONFIG;
  const { anchorType, style } = magnet;
  const anchors = Array.isArray(magnet.anchors) ? magnet.anchors : [];

  switch (anchorType) {
    case 'single': {
      if (anchors.length < 1) return null;
      const pos = pixelPositions.get(`${anchors[0].gridX},${anchors[0].gridY}`);
      if (!pos) return null;

      const magnetWidth = parseSize(style.width, 36);
      const magnetHeight = parseSize(style.height, 36);
      const offsetX = (PIXEL_SIZE - magnetWidth) / 2;
      const offsetY = (PIXEL_SIZE - magnetHeight) / 2;

      return {
        x: pos.x + offsetX,
        y: pos.y + offsetY,
        width: magnetWidth,
        height: magnetHeight,
      };
    }

    case 'horizontal': {
      if (anchors.length < 2) return null;
      const leftAnchor = anchors[0].gridX <= anchors[1].gridX ? anchors[0] : anchors[1];
      const rightAnchor = leftAnchor === anchors[0] ? anchors[1] : anchors[0];
      const left = pixelPositions.get(`${leftAnchor.gridX},${leftAnchor.gridY}`);
      const right = pixelPositions.get(`${rightAnchor.gridX},${rightAnchor.gridY}`);
      if (!left || !right) return null;

      const magnetHeight = parseSize(style.height, 36);
      const offsetY = (PIXEL_SIZE - magnetHeight) / 2;
      const horizontalSpan = resolveHorizontalSpanBounds(left.x, right.x, leftAnchor.gridX, rightAnchor.gridX);

      return {
        x: horizontalSpan.x,
        y: left.y + offsetY,
        width: horizontalSpan.width,
        height: magnetHeight,
      };
    }

    case 'vertical': {
      if (anchors.length < 2) return null;
      const topAnchor = anchors[0].gridY <= anchors[1].gridY ? anchors[0] : anchors[1];
      const bottomAnchor = topAnchor === anchors[0] ? anchors[1] : anchors[0];
      const top = pixelPositions.get(`${topAnchor.gridX},${topAnchor.gridY}`);
      const bottom = pixelPositions.get(`${bottomAnchor.gridX},${bottomAnchor.gridY}`);
      if (!top || !bottom) return null;

      const magnetWidth = parseSize(style.width, 36);
      const offsetX = (PIXEL_SIZE - magnetWidth) / 2;
      const verticalSpan = resolveVerticalSpanBounds(top.y, bottom.y, topAnchor.gridY, bottomAnchor.gridY);

      return {
        x: top.x + offsetX,
        y: verticalSpan.y,
        width: magnetWidth,
        height: verticalSpan.height,
      };
    }

    case 'rectangular': {
      if (anchors.length < 3) return null;
      const leftCol = Math.min(...anchors.map((anchor) => anchor.gridX));
      const rightCol = Math.max(...anchors.map((anchor) => anchor.gridX));
      const topRow = Math.min(...anchors.map((anchor) => anchor.gridY));
      const bottomRow = Math.max(...anchors.map((anchor) => anchor.gridY));

      const topLeft = pixelPositions.get(`${leftCol},${topRow}`);
      const topRight = pixelPositions.get(`${rightCol},${topRow}`);
      const bottomLeft = pixelPositions.get(`${leftCol},${bottomRow}`);
      if (!topLeft || !topRight || !bottomLeft) return null;

      const horizontalSpan = resolveHorizontalSpanBounds(topLeft.x, topRight.x, leftCol, rightCol);
      const verticalSpan = resolveVerticalSpanBounds(topLeft.y, bottomLeft.y, topRow, bottomRow);

      return {
        x: horizontalSpan.x,
        y: verticalSpan.y,
        width: horizontalSpan.width,
        height: verticalSpan.height,
      };
    }

    default:
      return null;
  }
}

export function alignMagnetBounds(bounds: MagnetBounds): MagnetBounds {
  const left = Math.round(bounds.x);
  const top = Math.round(bounds.y);
  const right = Math.round(bounds.x + bounds.width);
  const bottom = Math.round(bounds.y + bounds.height);

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function insetMagnetBounds(bounds: MagnetBounds, insets: MagnetInsets): MagnetBounds {
  const left = bounds.x + insets.left;
  const top = bounds.y + insets.top;
  const width = Math.max(1, bounds.width - insets.left - insets.right);
  const height = Math.max(1, bounds.height - insets.top - insets.bottom);

  return alignMagnetBounds({
    x: left,
    y: top,
    width,
    height,
  });
}

export function createZeroInsets(): MagnetInsets {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function canShrinkMagnetStyle(style: Pick<MagnetStyle, 'width' | 'height'>): boolean {
  return parseSize(style.width, 36) > 18 || parseSize(style.height, 36) > 18;
}
