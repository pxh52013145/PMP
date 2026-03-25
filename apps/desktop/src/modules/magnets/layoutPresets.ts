import type {
  Magnet,
  MagnetBoundsReference,
  MagnetBoundsReferenceEdge,
  MagnetBoundsReferenceSource,
  MagnetChromeConfig,
  MagnetInsetConfig,
} from '../../types/pixel';
import { MATRIX_CONFIG } from '../../constants/config';

const DEFAULT_CONTROL_SIZE = 36;

type MagnetLayoutPreset = Pick<Magnet, 'bounds' | 'chrome'>;
type BoundsEdgeKey = 'left' | 'right' | 'top' | 'bottom';

export interface MagnetBoundsOffsetConfig {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface MagnetControlBleedOffsetOptions {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
  width?: number;
  height?: number;
}

export interface SingleControlLayoutPresetOptions {
  width?: number;
  height?: number;
  edgeOffsets?: MagnetBoundsOffsetConfig;
  chromeInset?: MagnetInsetConfig;
  chromeOutset?: MagnetInsetConfig;
}

export interface DockedSingleControlLayoutPresetOptions extends SingleControlLayoutPresetOptions {
  dock?: {
    x?: MagnetBoundsReferenceEdge;
    y?: MagnetBoundsReferenceEdge;
  };
}

export interface PanelLayoutPresetOptions {
  edgeOffsets?: MagnetBoundsOffsetConfig;
  edgeOverrides?: Partial<Record<BoundsEdgeKey, MagnetBoundsReference>>;
  chromeInset?: MagnetInsetConfig;
  chromeOutset?: MagnetInsetConfig;
}

export interface HorizontalBarLayoutPresetOptions extends PanelLayoutPresetOptions {
  height: number;
  dock?: {
    y?: MagnetBoundsReferenceEdge;
  };
}

export interface VerticalBarLayoutPresetOptions extends PanelLayoutPresetOptions {
  width: number;
  dock?: {
    x?: MagnetBoundsReferenceEdge;
  };
}

function hasInsetValues(config?: MagnetInsetConfig): boolean {
  if (!config) return false;
  return ['top', 'right', 'bottom', 'left'].some((side) => {
    const value = config[side as keyof MagnetInsetConfig];
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  });
}

function buildChromeConfig(
  inset?: MagnetInsetConfig,
  outset?: MagnetInsetConfig
): MagnetChromeConfig | undefined {
  const hasInset = hasInsetValues(inset);
  const hasOutset = hasInsetValues(outset);
  if (!hasInset && !hasOutset) return undefined;
  return {
    ...(hasInset ? { inset } : {}),
    ...(hasOutset ? { outset } : {}),
  };
}

function parseStyleSize(value: string | undefined, fallback: number): number {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function applyReferenceOffset(reference: MagnetBoundsReference, offset = 0): MagnetBoundsReference {
  if (offset === 0) return reference;
  return {
    ...reference,
    offset: (reference.offset ?? 0) + offset,
  };
}

function resolveControlBleed(size: number, slotSize = MATRIX_CONFIG.PIXEL_SIZE): number {
  return Math.max(0, (size - slotSize) / 2);
}

export function createControlBleedOffsets(
  options: MagnetControlBleedOffsetOptions = {}
): MagnetBoundsOffsetConfig {
  const horizontalBleed = resolveControlBleed(options.width ?? DEFAULT_CONTROL_SIZE);
  const verticalBleed = resolveControlBleed(options.height ?? DEFAULT_CONTROL_SIZE);

  return {
    ...(options.left ? { left: -horizontalBleed } : {}),
    ...(options.right ? { right: horizontalBleed } : {}),
    ...(options.top ? { top: -verticalBleed } : {}),
    ...(options.bottom ? { bottom: verticalBleed } : {}),
  };
}

export function createControlBleedOutset(
  options: MagnetControlBleedOffsetOptions = {}
): MagnetInsetConfig {
  const horizontalBleed = resolveControlBleed(options.width ?? DEFAULT_CONTROL_SIZE);
  const verticalBleed = resolveControlBleed(options.height ?? DEFAULT_CONTROL_SIZE);

  return {
    ...(options.left ? { left: horizontalBleed } : {}),
    ...(options.right ? { right: horizontalBleed } : {}),
    ...(options.top ? { top: verticalBleed } : {}),
    ...(options.bottom ? { bottom: verticalBleed } : {}),
  };
}

export const DEFAULT_PANEL_CHROME_OUTSET: MagnetInsetConfig | undefined = undefined;

export const DEFAULT_HORIZONTAL_BAR_CHROME_OUTSET: MagnetInsetConfig | undefined = undefined;

export const DEFAULT_VERTICAL_BAR_CHROME_OUTSET: MagnetInsetConfig | undefined = undefined;

export const STANDARD_PANEL_CHROME_INSET = Object.freeze<MagnetInsetConfig>({
  top: 4,
  right: 4,
  bottom: 4,
  left: 4,
});

export const TOP_DOCKED_PANEL_CHROME_INSET = Object.freeze<MagnetInsetConfig>({
  top: 0,
  right: 4,
  bottom: 4,
  left: 4,
});

// 36px toolbar bars should render on the same visual baseline as the drag handle.
export const STANDARD_HORIZONTAL_BAR_CHROME_INSET = Object.freeze<MagnetInsetConfig>({
  top: 4,
  bottom: 4,
});

export function createBoundsReference(
  source: MagnetBoundsReferenceSource,
  edge: MagnetBoundsReferenceEdge,
  options: {
    magnetId?: string;
    offset?: number;
  } = {}
): MagnetBoundsReference {
  return {
    source,
    edge,
    ...(options.magnetId ? { magnetId: options.magnetId } : {}),
    ...(options.offset ? { offset: options.offset } : {}),
  };
}

export function createMagnetEdgeReference(
  magnetId: string,
  edge: MagnetBoundsReferenceEdge,
  offset = 0
): MagnetBoundsReference {
  return createBoundsReference('magnet', edge, { magnetId, offset });
}

export function createFixedAxisBounds(options: {
  source?: MagnetBoundsReferenceSource;
  edge?: MagnetBoundsReferenceEdge;
  magnetId?: string;
  size: number;
}): Magnet['bounds']['horizontal'] {
  const source = options.source ?? 'slot';
  const edge = options.edge ?? 'center';
  const baseOptions = options.magnetId ? { magnetId: options.magnetId } : undefined;

  if (edge === 'start') {
    return {
      start: createBoundsReference(source, 'start', baseOptions),
      end: createBoundsReference(source, 'start', {
        ...baseOptions,
        offset: options.size,
      }),
    };
  }

  if (edge === 'end') {
    return {
      start: createBoundsReference(source, 'end', {
        ...baseOptions,
        offset: -options.size,
      }),
      end: createBoundsReference(source, 'end', baseOptions),
    };
  }

  return {
    start: createBoundsReference(source, 'center', {
      ...baseOptions,
      offset: -options.size / 2,
    }),
    end: createBoundsReference(source, 'center', {
      ...baseOptions,
      offset: options.size / 2,
    }),
  };
}

export function createDefaultBoundsForMagnet(
  anchorType: Magnet['anchorType'],
  style: Pick<Magnet['style'], 'width' | 'height'>
): Magnet['bounds'] {
  if (anchorType === 'single') {
    return createCenteredSingleControlLayoutPreset({
      width: parseStyleSize(style.width, DEFAULT_CONTROL_SIZE),
      height: parseStyleSize(style.height, DEFAULT_CONTROL_SIZE),
    }).bounds;
  }

  if (anchorType === 'horizontal') {
    return createHorizontalBarLayoutPreset({
      height: parseStyleSize(style.height, DEFAULT_CONTROL_SIZE),
    }).bounds;
  }

  if (anchorType === 'vertical') {
    return createVerticalBarLayoutPreset({
      width: parseStyleSize(style.width, DEFAULT_CONTROL_SIZE),
    }).bounds;
  }

  return createPanelLayoutPreset().bounds;
}

function createBoundsSpec(edges: Record<BoundsEdgeKey, MagnetBoundsReference>): Magnet['bounds'] {
  return {
    horizontal: {
      start: edges.left,
      end: edges.right,
    },
    vertical: {
      start: edges.top,
      end: edges.bottom,
    },
  };
}

function applyEdgeOffsets(
  edges: Record<BoundsEdgeKey, MagnetBoundsReference>,
  offsets?: MagnetBoundsOffsetConfig
): Record<BoundsEdgeKey, MagnetBoundsReference> {
  return {
    left: applyReferenceOffset(edges.left, offsets?.left ?? 0),
    right: applyReferenceOffset(edges.right, offsets?.right ?? 0),
    top: applyReferenceOffset(edges.top, offsets?.top ?? 0),
    bottom: applyReferenceOffset(edges.bottom, offsets?.bottom ?? 0),
  };
}

function mergeBoundsOffsets(
  base: MagnetBoundsOffsetConfig | undefined,
  next: MagnetBoundsOffsetConfig | undefined
): MagnetBoundsOffsetConfig | undefined {
  if (!base && !next) return undefined;

  const normalizeOffset = (value: number | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

  const merged = {
    top: normalizeOffset(base?.top) + normalizeOffset(next?.top),
    right: normalizeOffset(base?.right) + normalizeOffset(next?.right),
    bottom: normalizeOffset(base?.bottom) + normalizeOffset(next?.bottom),
    left: normalizeOffset(base?.left) + normalizeOffset(next?.left),
  } satisfies Required<MagnetBoundsOffsetConfig>;

  return merged;
}

function applyEdgeOverrides(
  edges: Record<BoundsEdgeKey, MagnetBoundsReference>,
  overrides?: Partial<Record<BoundsEdgeKey, MagnetBoundsReference>>
): Record<BoundsEdgeKey, MagnetBoundsReference> {
  if (!overrides) return edges;

  return {
    left: overrides.left ?? edges.left,
    right: overrides.right ?? edges.right,
    top: overrides.top ?? edges.top,
    bottom: overrides.bottom ?? edges.bottom,
  };
}

export function createCenteredSingleControlLayoutPreset(
  options: SingleControlLayoutPresetOptions = {}
): MagnetLayoutPreset {
  const width = options.width ?? DEFAULT_CONTROL_SIZE;
  const height = options.height ?? DEFAULT_CONTROL_SIZE;

  const edges = applyEdgeOffsets(
    {
      left: createBoundsReference('span', 'center', { offset: -width / 2 }),
      right: createBoundsReference('span', 'center', { offset: width / 2 }),
      top: createBoundsReference('span', 'center', { offset: -height / 2 }),
      bottom: createBoundsReference('span', 'center', { offset: height / 2 }),
    },
    options.edgeOffsets
  );

  return {
    bounds: createBoundsSpec(edges),
    ...(options.chromeInset || options.chromeOutset
      ? { chrome: buildChromeConfig(options.chromeInset, options.chromeOutset) }
      : {}),
  };
}

export function createDockedSingleControlLayoutPreset(
  options: DockedSingleControlLayoutPresetOptions = {}
): MagnetLayoutPreset {
  const width = options.width ?? DEFAULT_CONTROL_SIZE;
  const height = options.height ?? DEFAULT_CONTROL_SIZE;
  const horizontal =
    options.dock?.x === 'start' || options.dock?.x === 'end'
      ? createFixedAxisBounds({
          source: 'slot',
          edge: options.dock.x,
          size: width,
        })
      : createFixedAxisBounds({
          source: 'span',
          edge: 'center',
          size: width,
        });
  const vertical =
    options.dock?.y === 'start' || options.dock?.y === 'end'
      ? createFixedAxisBounds({
          source: 'slot',
          edge: options.dock.y,
          size: height,
        })
      : createFixedAxisBounds({
          source: 'span',
          edge: 'center',
          size: height,
        });

  const edges = applyEdgeOffsets(
    {
      left: horizontal.start,
      right: horizontal.end,
      top: vertical.start,
      bottom: vertical.end,
    },
    options.edgeOffsets
  );

  return {
    bounds: createBoundsSpec(edges),
    ...(options.chromeInset || options.chromeOutset
      ? { chrome: buildChromeConfig(options.chromeInset, options.chromeOutset) }
      : {}),
  };
}

export function createPanelLayoutPreset(options: PanelLayoutPresetOptions = {}): MagnetLayoutPreset {
  const edgeOffsets = mergeBoundsOffsets(
    createControlBleedOffsets({ top: true, right: true, bottom: true, left: true }),
    options.edgeOffsets
  );
  const defaultEdges = {
    left: createBoundsReference('span', 'start'),
    right: createBoundsReference('span', 'end'),
    top: createBoundsReference('span', 'start'),
    bottom: createBoundsReference('span', 'end'),
  } satisfies Record<BoundsEdgeKey, MagnetBoundsReference>;
  const chromeOutset = options.chromeOutset ?? DEFAULT_PANEL_CHROME_OUTSET;

  return {
    bounds: createBoundsSpec(
      applyEdgeOffsets(applyEdgeOverrides(defaultEdges, options.edgeOverrides), edgeOffsets)
    ),
    ...(options.chromeInset || chromeOutset
      ? { chrome: buildChromeConfig(options.chromeInset, chromeOutset) }
      : {}),
  };
}

export function createHorizontalBarLayoutPreset(
  options: HorizontalBarLayoutPresetOptions
): MagnetLayoutPreset {
  const edgeOffsets = mergeBoundsOffsets(createControlBleedOffsets({ left: true, right: true }), options.edgeOffsets);
  const vertical = createFixedAxisBounds({
    source: 'span',
    edge: options.dock?.y ?? 'center',
    size: options.height,
  });

  const defaultEdges = {
    left: createBoundsReference('span', 'start'),
    right: createBoundsReference('span', 'end'),
    top: vertical.start,
    bottom: vertical.end,
  } satisfies Record<BoundsEdgeKey, MagnetBoundsReference>;
  const chromeOutset = options.chromeOutset ?? DEFAULT_HORIZONTAL_BAR_CHROME_OUTSET;

  return {
    bounds: createBoundsSpec(
      applyEdgeOffsets(applyEdgeOverrides(defaultEdges, options.edgeOverrides), edgeOffsets)
    ),
    ...(options.chromeInset || chromeOutset
      ? { chrome: buildChromeConfig(options.chromeInset, chromeOutset) }
      : {}),
  };
}

export function createVerticalBarLayoutPreset(
  options: VerticalBarLayoutPresetOptions
): MagnetLayoutPreset {
  const edgeOffsets = mergeBoundsOffsets(createControlBleedOffsets({ top: true, bottom: true }), options.edgeOffsets);
  const horizontal = createFixedAxisBounds({
    source: 'span',
    edge: options.dock?.x ?? 'center',
    size: options.width,
  });

  const defaultEdges = {
    left: horizontal.start,
    right: horizontal.end,
    top: createBoundsReference('span', 'start'),
    bottom: createBoundsReference('span', 'end'),
  } satisfies Record<BoundsEdgeKey, MagnetBoundsReference>;
  const chromeOutset = options.chromeOutset ?? DEFAULT_VERTICAL_BAR_CHROME_OUTSET;

  return {
    bounds: createBoundsSpec(
      applyEdgeOffsets(applyEdgeOverrides(defaultEdges, options.edgeOverrides), edgeOffsets)
    ),
    ...(options.chromeInset || chromeOutset
      ? { chrome: buildChromeConfig(options.chromeInset, chromeOutset) }
      : {}),
  };
}
