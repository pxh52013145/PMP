import { MATRIX_CONFIG } from '../../constants/config';
import type {
  Magnet,
  MagnetBoundsAxis,
  MagnetBoundsReference,
  MagnetInsetConfig,
  MagnetStyle,
} from '../../types/pixel';

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

export interface ComputeMagnetBoundsOptions {
  magnetsById?: Record<string, Pick<Magnet, 'id' | 'anchorType' | 'anchors' | 'bounds' | 'chrome'>>;
  viewport?: {
    width: number;
    height: number;
  };
  joinEdges?: MagnetBoundsJoinEdges;
  cache?: Map<string, MagnetBounds | null>;
  resolvingIds?: Set<string>;
}

export interface MagnetBoundsJoinEdges {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

interface AxisRange {
  start: number;
  end: number;
}

type AxisName = 'horizontal' | 'vertical';

function parseSize(value: string | undefined, fallbackPx: number): number {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallbackPx;
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

export function collapseMagnetInsetsForJoinEdges(
  insets: MagnetInsets,
  joinEdges?: MagnetBoundsJoinEdges
): MagnetInsets {
  return {
    top: joinEdges?.top ? 0 : insets.top,
    right: joinEdges?.right ? 0 : insets.right,
    bottom: joinEdges?.bottom ? 0 : insets.bottom,
    left: joinEdges?.left ? 0 : insets.left,
  };
}

function resolveEdgeValue(range: AxisRange, edge: MagnetBoundsReference['edge']): number {
  if (edge === 'start') return range.start;
  if (edge === 'end') return range.end;
  return range.start + (range.end - range.start) / 2;
}

function resolveAnchorSpan(magnet: Pick<Magnet, 'anchors'>) {
  const anchors = Array.isArray(magnet.anchors) ? magnet.anchors : [];
  if (anchors.length < 1) return null;

  return {
    leftCol: Math.min(...anchors.map((anchor) => anchor.gridX)),
    rightCol: Math.max(...anchors.map((anchor) => anchor.gridX)),
    topRow: Math.min(...anchors.map((anchor) => anchor.gridY)),
    bottomRow: Math.max(...anchors.map((anchor) => anchor.gridY)),
  };
}

function resolveAnchorBandRange(
  axis: AxisName,
  gridX: number,
  gridY: number,
  pixelPositions: Map<string, { x: number; y: number }>
): AxisRange | null {
  const current = pixelPositions.get(`${gridX},${gridY}`);
  if (!current) return null;

  if (axis === 'horizontal') {
    const next =
      gridX >= MATRIX_CONFIG.COLUMNS - 1 ? undefined : pixelPositions.get(`${gridX + 1},${gridY}`);

    return {
      start: current.x,
      end: next?.x ?? current.x + MATRIX_CONFIG.PIXEL_SIZE,
    };
  }

  const next =
    gridY >= MATRIX_CONFIG.ROWS - 1 ? undefined : pixelPositions.get(`${gridX},${gridY + 1}`);

  return {
    start: current.y,
    end: next?.y ?? current.y + MATRIX_CONFIG.PIXEL_SIZE,
  };
}

function resolveSlotRange(
  axis: AxisName,
  magnet: Pick<Magnet, 'anchors'>,
  pixelPositions: Map<string, { x: number; y: number }>
): AxisRange | null {
  const anchor = magnet.anchors[0];
  if (!anchor) return null;

  return resolveAnchorBandRange(axis, anchor.gridX, anchor.gridY, pixelPositions);
}

function resolveBandRange(
  axis: AxisName,
  magnet: Pick<Magnet, 'anchors'>,
  pixelPositions: Map<string, { x: number; y: number }>
): AxisRange | null {
  const span = resolveAnchorSpan(magnet);
  if (!span) return null;

  if (axis === 'horizontal') {
    const start = resolveAnchorBandRange(axis, span.leftCol, span.topRow, pixelPositions)?.start;
    const end = resolveAnchorBandRange(axis, span.rightCol, span.topRow, pixelPositions)?.end;
    if (start === undefined || end === undefined) return null;
    return { start, end };
  }

  const start = resolveAnchorBandRange(axis, span.leftCol, span.topRow, pixelPositions)?.start;
  const end = resolveAnchorBandRange(axis, span.leftCol, span.bottomRow, pixelPositions)?.end;
  if (start === undefined || end === undefined) return null;
  return { start, end };
}

function resolveSpanRange(
  axis: AxisName,
  magnet: Pick<Magnet, 'anchors'>,
  pixelPositions: Map<string, { x: number; y: number }>
): AxisRange | null {
  const span = resolveAnchorSpan(magnet);
  if (!span) return null;

  if (axis === 'horizontal') {
    const left = pixelPositions.get(`${span.leftCol},${span.topRow}`);
    const right = pixelPositions.get(`${span.rightCol},${span.topRow}`);
    if (!left || !right) return null;

    return {
      start: left.x,
      end: right.x + MATRIX_CONFIG.PIXEL_SIZE,
    };
  }

  const top = pixelPositions.get(`${span.leftCol},${span.topRow}`);
  const bottom = pixelPositions.get(`${span.leftCol},${span.bottomRow}`);
  if (!top || !bottom) return null;

  return {
    start: top.y,
    end: bottom.y + MATRIX_CONFIG.PIXEL_SIZE,
  };
}

function resolveViewportRange(
  axis: AxisName,
  viewport: ComputeMagnetBoundsOptions['viewport']
): AxisRange | null {
  if (!viewport) return null;

  return axis === 'horizontal'
    ? { start: 0, end: viewport.width }
    : { start: 0, end: viewport.height };
}

function resolveRangeBySource(
  axis: AxisName,
  reference: MagnetBoundsReference,
  magnet: Pick<Magnet, 'anchors'>,
  pixelPositions: Map<string, { x: number; y: number }>,
  options: ComputeMagnetBoundsOptions
): AxisRange | null {
  if (reference.source === 'slot') {
    return resolveSlotRange(axis, magnet, pixelPositions);
  }

  if (reference.source === 'span') {
    return resolveSpanRange(axis, magnet, pixelPositions);
  }

  if (reference.source === 'band') {
    return resolveBandRange(axis, magnet, pixelPositions);
  }

  if (reference.source === 'viewport') {
    return resolveViewportRange(axis, options.viewport);
  }

  if (reference.source !== 'magnet' || !reference.magnetId) {
    return null;
  }

  const referencedBounds = resolveReferencedStructuralBounds(reference.magnetId, pixelPositions, options);
  if (!referencedBounds) return null;

  return axis === 'horizontal'
    ? { start: referencedBounds.x, end: referencedBounds.x + referencedBounds.width }
    : { start: referencedBounds.y, end: referencedBounds.y + referencedBounds.height };
}

function resolveReferenceValue(
  axis: AxisName,
  reference: MagnetBoundsReference,
  magnet: Pick<Magnet, 'anchors'>,
  pixelPositions: Map<string, { x: number; y: number }>,
  options: ComputeMagnetBoundsOptions
): number | null {
  const range = resolveRangeBySource(axis, reference, magnet, pixelPositions, options);
  if (!range) return null;

  return resolveEdgeValue(range, reference.edge) + (reference.offset ?? 0);
}

function resolveAxisSpan(
  axis: AxisName,
  bounds: MagnetBoundsAxis,
  magnet: Pick<Magnet, 'anchors'>,
  pixelPositions: Map<string, { x: number; y: number }>,
  options: ComputeMagnetBoundsOptions
): AxisRange | null {
  const start = resolveReferenceValue(axis, bounds.start, magnet, pixelPositions, options);
  const end = resolveReferenceValue(axis, bounds.end, magnet, pixelPositions, options);
  if (start === null || end === null) return null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  return { start, end };
}

function createBoundsFromAxisRanges(horizontal: AxisRange | null, vertical: AxisRange | null): MagnetBounds | null {
  if (!horizontal || !vertical) {
    return null;
  }

  return {
    x: horizontal.start,
    y: vertical.start,
    width: horizontal.end - horizontal.start,
    height: vertical.end - vertical.start,
  };
}

function hasInsetValues(insets: MagnetInsets): boolean {
  return insets.top > 0 || insets.right > 0 || insets.bottom > 0 || insets.left > 0;
}

function computeMagnetBoundsInternal(
  magnet: Pick<Magnet, 'id' | 'anchorType' | 'anchors' | 'bounds' | 'chrome'>,
  pixelPositions: Map<string, { x: number; y: number }>,
  options: ComputeMagnetBoundsOptions
): MagnetBounds | null {
  if (magnet.id && options.cache?.has(magnet.id)) {
    return options.cache.get(magnet.id) ?? null;
  }

  const resolvingIds = options.resolvingIds;
  if (magnet.id && resolvingIds?.has(magnet.id)) {
    return null;
  }

  if (magnet.id) {
    resolvingIds?.add(magnet.id);
  }

  const horizontal = resolveAxisSpan('horizontal', magnet.bounds.horizontal, magnet, pixelPositions, options);
  const vertical = resolveAxisSpan('vertical', magnet.bounds.vertical, magnet, pixelPositions, options);
  const bounds = createBoundsFromAxisRanges(horizontal, vertical);

  if (magnet.id) {
    resolvingIds?.delete(magnet.id);
    options.cache?.set(magnet.id, bounds);
  }

  return bounds;
}

function resolveReferencedStructuralBounds(
  magnetId: string,
  pixelPositions: Map<string, { x: number; y: number }>,
  options: ComputeMagnetBoundsOptions
): MagnetBounds | null {
  if (options.cache?.has(magnetId)) {
    return options.cache.get(magnetId) ?? null;
  }

  const referencedMagnet = options.magnetsById?.[magnetId];
  if (!referencedMagnet) {
    return null;
  }

  return computeMagnetBoundsInternal(referencedMagnet, pixelPositions, options);
}

export function computeMagnetBounds(
  magnet: Pick<Magnet, 'id' | 'anchorType' | 'anchors' | 'bounds' | 'chrome'>,
  pixelPositions: Map<string, { x: number; y: number }>,
  options: ComputeMagnetBoundsOptions = {}
): MagnetBounds | null {
  return computeMagnetBoundsInternal(magnet, pixelPositions, {
    ...options,
    cache: options.cache ?? new Map<string, MagnetBounds | null>(),
    resolvingIds: options.resolvingIds ?? new Set<string>(),
  });
}

// Visual bounds are derived from the already-resolved layout bounds so chrome insets
// and outsets never feed back into anchor resolution, joins, or collision logic.
export function computeMagnetVisualBounds(
  magnet: Pick<Magnet, 'id' | 'anchorType' | 'anchors' | 'bounds' | 'chrome'>,
  pixelPositions: Map<string, { x: number; y: number }>,
  options: ComputeMagnetBoundsOptions = {}
): MagnetBounds | null {
  const layoutBounds = computeMagnetBounds(magnet, pixelPositions, options);
  return computeChromeBoundsFromLayoutBounds(layoutBounds, magnet.chrome, {
    joinEdges: options.joinEdges,
  });
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

function adjustMagnetBounds(bounds: MagnetBounds, inset: MagnetInsets, outset: MagnetInsets): MagnetBounds {
  return alignMagnetBounds({
    x: bounds.x + inset.left - outset.left,
    y: bounds.y + inset.top - outset.top,
    width: Math.max(1, bounds.width - inset.left - inset.right + outset.left + outset.right),
    height: Math.max(1, bounds.height - inset.top - inset.bottom + outset.top + outset.bottom),
  });
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

export function applyChromeToMagnetBounds(
  bounds: MagnetBounds | null,
  chrome?: Pick<NonNullable<Magnet['chrome']>, 'inset' | 'outset'>
): MagnetBounds | null {
  return computeChromeBoundsFromLayoutBounds(bounds, chrome);
}

export function computeContentBoundsFromLayoutBounds(
  bounds: MagnetBounds | null,
  chrome?: Pick<NonNullable<Magnet['chrome']>, 'inset' | 'outset'>
): MagnetBounds | null {
  if (!bounds) {
    return null;
  }

  const inset = resolveMagnetInsets(chrome?.inset);
  if (!hasInsetValues(inset)) {
    return bounds;
  }

  return adjustMagnetBounds(bounds, inset, createZeroInsets());
}

export function computeChromeBoundsFromLayoutBounds(
  bounds: MagnetBounds | null,
  chrome?: Pick<NonNullable<Magnet['chrome']>, 'inset' | 'outset'>,
  options: {
    joinEdges?: MagnetBoundsJoinEdges;
  } = {}
): MagnetBounds | null {
  if (!bounds) {
    return null;
  }

  const outset = collapseMagnetInsetsForJoinEdges(resolveMagnetInsets(chrome?.outset), options.joinEdges);

  if (!hasInsetValues(outset)) {
    return bounds;
  }

  return adjustMagnetBounds(bounds, createZeroInsets(), outset);
}

export function expandMagnetBoundsWithChromeOutset(
  bounds: MagnetBounds | null,
  outsetConfig?: MagnetInsetConfig
): MagnetBounds | null {
  if (!bounds) {
    return null;
  }

  const outsets = resolveMagnetInsets(outsetConfig);
  return hasInsetValues(outsets) ? outsetMagnetBounds(bounds, outsets) : bounds;
}

export function canShrinkMagnetStyle(style: Pick<MagnetStyle, 'width' | 'height'>): boolean {
  return parseSize(style.width, 36) > 18 || parseSize(style.height, 36) > 18;
}
