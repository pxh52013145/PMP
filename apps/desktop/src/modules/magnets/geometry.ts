import { MATRIX_CONFIG } from '../../constants/config';
import type { Magnet, MagnetInsetConfig, MagnetStyle } from '../../types/pixel';

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

function resolveHorizontalSpanBounds(leftX: number, rightX: number) {
  const { PIXEL_SIZE } = MATRIX_CONFIG;
  const x = leftX;
  const right = rightX + PIXEL_SIZE;

  return {
    x,
    width: Math.max(1, right - x),
  };
}

function resolveVerticalSpanBounds(topY: number, bottomY: number) {
  const { PIXEL_SIZE } = MATRIX_CONFIG;
  const y = topY;
  const bottom = bottomY + PIXEL_SIZE;

  return {
    y,
    height: Math.max(1, bottom - y),
  };
}

function resolveSingleHorizontalSlotBounds(
  gridX: number,
  gridY: number,
  currentX: number,
  pixelPositions: Map<string, { x: number; y: number }>
) {
  const { COLUMNS, PIXEL_SIZE } = MATRIX_CONFIG;
  const left = currentX;
  const right =
    gridX >= COLUMNS - 1
      ? currentX + PIXEL_SIZE
      : (() => {
          const next = pixelPositions.get(`${gridX + 1},${gridY}`);
          return next?.x ?? currentX + PIXEL_SIZE;
        })();

  return { left, right };
}

function resolveSingleVerticalSlotBounds(
  gridX: number,
  gridY: number,
  currentY: number,
  pixelPositions: Map<string, { x: number; y: number }>
) {
  const { ROWS, PIXEL_SIZE } = MATRIX_CONFIG;
  const top = currentY;
  const bottom =
    gridY >= ROWS - 1
      ? currentY + PIXEL_SIZE
      : (() => {
          const next = pixelPositions.get(`${gridX},${gridY + 1}`);
          return next?.y ?? currentY + PIXEL_SIZE;
        })();

  return { top, bottom };
}

function resolveDockOffset(
  slotStart: number,
  slotEnd: number,
  sizePx: number,
  dock: 'start' | 'center' | 'end'
) {
  if (dock === 'start') return slotStart;
  if (dock === 'end') return slotEnd - sizePx;
  return slotStart + (slotEnd - slotStart - sizePx) / 2;
}

function normalizeInsetValue(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value ?? 0);
}

export function resolveMagnetInsets(config?: MagnetInsetConfig): MagnetInsets {
  return {
    top: normalizeInsetValue(config?.top),
    right: normalizeInsetValue(config?.right),
    bottom: normalizeInsetValue(config?.bottom),
    left: normalizeInsetValue(config?.left),
  };
}

function adjustMagnetBounds(bounds: MagnetBounds, inset: MagnetInsets, outset: MagnetInsets): MagnetBounds {
  return alignMagnetBounds({
    x: bounds.x + inset.left - outset.left,
    y: bounds.y + inset.top - outset.top,
    width: Math.max(1, bounds.width - inset.left - inset.right + outset.left + outset.right),
    height: Math.max(1, bounds.height - inset.top - inset.bottom + outset.top + outset.bottom),
  });
}

export function computeMagnetBounds(
  magnet: Pick<Magnet, 'anchorType' | 'anchors' | 'style' | 'boundsMode' | 'boundsDock' | 'boundsInset' | 'boundsOutset'>,
  pixelPositions: Map<string, { x: number; y: number }>
): MagnetBounds | null {
  const { PIXEL_SIZE } = MATRIX_CONFIG;
  const { anchorType, style } = magnet;
  const anchors = Array.isArray(magnet.anchors) ? magnet.anchors : [];
  const boundsInset = resolveMagnetInsets(magnet.boundsInset);
  const boundsOutset = resolveMagnetInsets(magnet.boundsOutset);
  const applyBoundsAdjustments = (bounds: MagnetBounds) => adjustMagnetBounds(bounds, boundsInset, boundsOutset);

  switch (anchorType) {
    case 'single': {
      if (anchors.length < 1) return null;
      const anchor = anchors[0];
      const pos = pixelPositions.get(`${anchor.gridX},${anchor.gridY}`);
      if (!pos) return null;

      const magnetWidth = parseSize(style.width, 36);
      const magnetHeight = parseSize(style.height, 36);
      const centeredX = pos.x + (PIXEL_SIZE - magnetWidth) / 2;
      const centeredY = pos.y + (PIXEL_SIZE - magnetHeight) / 2;

      if (magnet.boundsMode === 'docked') {
        const horizontalSlot = resolveSingleHorizontalSlotBounds(anchor.gridX, anchor.gridY, pos.x, pixelPositions);
        const verticalSlot = resolveSingleVerticalSlotBounds(anchor.gridX, anchor.gridY, pos.y, pixelPositions);

        return applyBoundsAdjustments({
          x:
            magnet.boundsDock?.x === undefined
              ? centeredX
              : resolveDockOffset(horizontalSlot.left, horizontalSlot.right, magnetWidth, magnet.boundsDock.x),
          y:
            magnet.boundsDock?.y === undefined
              ? centeredY
              : resolveDockOffset(verticalSlot.top, verticalSlot.bottom, magnetHeight, magnet.boundsDock.y),
          width: magnetWidth,
          height: magnetHeight,
        });
      }

      return applyBoundsAdjustments({
        x: centeredX,
        y: centeredY,
        width: magnetWidth,
        height: magnetHeight,
      });
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
      const horizontalSpan = resolveHorizontalSpanBounds(left.x, right.x);

      return applyBoundsAdjustments({
        x: horizontalSpan.x,
        y: left.y + offsetY,
        width: horizontalSpan.width,
        height: magnetHeight,
      });
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
      const verticalSpan = resolveVerticalSpanBounds(top.y, bottom.y);

      return applyBoundsAdjustments({
        x: top.x + offsetX,
        y: verticalSpan.y,
        width: magnetWidth,
        height: verticalSpan.height,
      });
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

      const horizontalSpan = resolveHorizontalSpanBounds(topLeft.x, topRight.x);
      const verticalSpan = resolveVerticalSpanBounds(topLeft.y, bottomLeft.y);

      return applyBoundsAdjustments({
        x: horizontalSpan.x,
        y: verticalSpan.y,
        width: horizontalSpan.width,
        height: verticalSpan.height,
      });
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
  return adjustMagnetBounds(bounds, insets, createZeroInsets());
}

export function outsetMagnetBounds(bounds: MagnetBounds, outsets: MagnetInsets): MagnetBounds {
  return adjustMagnetBounds(bounds, createZeroInsets(), outsets);
}

export function createZeroInsets(): MagnetInsets {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function canShrinkMagnetStyle(style: Pick<MagnetStyle, 'width' | 'height'>): boolean {
  return parseSize(style.width, 36) > 18 || parseSize(style.height, 36) > 18;
}
