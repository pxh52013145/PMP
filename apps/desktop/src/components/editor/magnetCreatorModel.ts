import type {
  AnchorType,
  Magnet,
  MagnetChromeConfig,
  MagnetGridFootprint,
  MagnetInsetConfig,
  MagnetInteractions,
  PixelAnchor,
} from '../../types/pixel';
import type { MagnetBounds } from '../../modules/magnets/geometry';

export type InsetSide = keyof MagnetInsetConfig;
export type InsetDraft = Record<InsetSide, string>;

export const INSET_SIDES: InsetSide[] = ['top', 'right', 'bottom', 'left'];
export const PREVIEW_PIXEL_SIZE = 8;
export const PREVIEW_GRID_SIZE = 30;
export const PREVIEW_STAGE_SIZE = 240;
export const PREVIEW_MAX_CONTENT_WIDTH = 230;
export const PREVIEW_MAX_CONTENT_HEIGHT = 250;
export const DEFAULT_MAGNET_INTERACTIONS: MagnetInteractions = {
  draggable: false,
  clickable: true,
};

export interface MagnetAnchorDraftDimensions {
  horizontalPixels: number;
  verticalPixels: number;
  rectWidth: number;
  rectHeight: number;
}

export interface BuildEditorMagnetOptions {
  seedMagnet?: Partial<Magnet>;
  fallbackType?: Magnet['type'];
  fallbackInteractions?: MagnetInteractions;
  id: string;
  name: string;
  anchorType: AnchorType;
  anchors: PixelAnchor[];
  gridFootprint?: MagnetGridFootprint;
  bounds: Magnet['bounds'];
  content: Magnet['content'];
  style: Magnet['style'];
  animation?: Magnet['animation'];
  chromeInset?: MagnetInsetConfig;
  chromeOutset?: MagnetInsetConfig;
  variant?: string | null;
  skinProps?: Record<string, unknown> | null;
}

export function createEmptyInsetDraft(): InsetDraft {
  return {
    top: '',
    right: '',
    bottom: '',
    left: '',
  };
}

export function createInsetDraft(config?: MagnetInsetConfig): InsetDraft {
  const draft = createEmptyInsetDraft();

  INSET_SIDES.forEach((side) => {
    const value = config?.[side];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      draft[side] = String(value);
    }
  });

  return draft;
}

export function parseInsetDraft(draft: InsetDraft): MagnetInsetConfig | undefined {
  const inset: MagnetInsetConfig = {};

  INSET_SIDES.forEach((side) => {
    const raw = draft[side].trim();
    if (!raw) return;

    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return;

    const normalized = Math.max(0, parsed);
    if (normalized > 0) {
      inset[side] = normalized;
    }
  });

  return Object.keys(inset).length > 0 ? inset : undefined;
}

export function buildChromeConfig(
  enabled: boolean | undefined,
  inset: MagnetInsetConfig | undefined,
  outset?: MagnetInsetConfig
): MagnetChromeConfig | undefined {
  if (enabled === undefined && inset === undefined && outset === undefined) return undefined;

  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(inset !== undefined ? { inset } : {}),
    ...(outset !== undefined ? { outset } : {}),
  };
}

export function createPreviewPixelPositions(): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  for (let y = 0; y < PREVIEW_GRID_SIZE; y++) {
    for (let x = 0; x < PREVIEW_GRID_SIZE; x++) {
      positions.set(`${x},${y}`, { x: x * PREVIEW_PIXEL_SIZE, y: y * PREVIEW_PIXEL_SIZE });
    }
  }

  return positions;
}

export const PREVIEW_PIXEL_POSITIONS = createPreviewPixelPositions();

export function getPreviewScaleFromBounds(bounds: MagnetBounds | null): number {
  if (!bounds) return 1;

  const scaleX = PREVIEW_MAX_CONTENT_WIDTH / bounds.width;
  const scaleY = PREVIEW_MAX_CONTENT_HEIGHT / bounds.height;

  return Math.min(scaleX, scaleY, 1);
}

export function buildPreviewChromeConfig(
  magnet: Pick<Magnet, 'chrome'> | null,
  inset: MagnetInsetConfig | undefined,
  outset?: MagnetInsetConfig
): MagnetChromeConfig | undefined {
  return buildChromeConfig(magnet?.chrome?.enabled, inset, outset);
}

export function buildAnchorsFromOrigin(
  anchorType: AnchorType,
  baseX: number,
  baseY: number,
  dimensions: MagnetAnchorDraftDimensions
): PixelAnchor[] {
  switch (anchorType) {
    case 'single':
      return [{ id: 'anchor', gridX: baseX, gridY: baseY, role: 'anchor' }];
    case 'horizontal':
      return [
        { id: 'left', gridX: baseX, gridY: baseY, role: 'anchor' },
        {
          id: 'right',
          gridX: baseX + dimensions.horizontalPixels - 1,
          gridY: baseY,
          role: 'boundary',
        },
      ];
    case 'vertical':
      return [
        { id: 'top', gridX: baseX, gridY: baseY, role: 'anchor' },
        {
          id: 'bottom',
          gridX: baseX,
          gridY: baseY + dimensions.verticalPixels - 1,
          role: 'boundary',
        },
      ];
    case 'rectangular':
      return [
        { id: 'top-left', gridX: baseX, gridY: baseY, role: 'anchor' },
        {
          id: 'top-right',
          gridX: baseX + dimensions.rectWidth - 1,
          gridY: baseY,
          role: 'boundary',
        },
        {
          id: 'bottom-left',
          gridX: baseX,
          gridY: baseY + dimensions.rectHeight - 1,
          role: 'boundary',
        },
        {
          id: 'bottom-right',
          gridX: baseX + dimensions.rectWidth - 1,
          gridY: baseY + dimensions.rectHeight - 1,
          role: 'boundary',
        },
      ];
    default:
      return [];
  }
}

function normalizeGridDimension(value: unknown, fallback = 1): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.round(value))
    : fallback;
}

export function resolveMagnetAnchorOrigin(
  magnet: Pick<Magnet, 'anchors'>,
  fallback = { x: 10, y: 10 }
): { x: number; y: number } {
  const anchors = Array.isArray(magnet.anchors) ? magnet.anchors : [];
  const anchor = anchors.find((candidate) => candidate.role === 'anchor') ?? anchors[0];
  if (!anchor) return fallback;
  return {
    x: Number.isFinite(anchor.gridX) ? anchor.gridX : fallback.x,
    y: Number.isFinite(anchor.gridY) ? anchor.gridY : fallback.y,
  };
}

export function resolveMagnetAnchorDraftDimensions(
  magnet: Pick<Magnet, 'anchorType' | 'anchors' | 'gridFootprint'>
): MagnetAnchorDraftDimensions {
  const anchors = Array.isArray(magnet.anchors) ? magnet.anchors : [];
  const footprintWidth = normalizeGridDimension(magnet.gridFootprint?.width);
  const footprintHeight = normalizeGridDimension(magnet.gridFootprint?.height);

  let anchorWidth = 1;
  let anchorHeight = 1;
  if (anchors.length > 0) {
    const xs = anchors.map((anchor) => anchor.gridX).filter(Number.isFinite);
    const ys = anchors.map((anchor) => anchor.gridY).filter(Number.isFinite);
    if (xs.length > 0) anchorWidth = Math.max(...xs) - Math.min(...xs) + 1;
    if (ys.length > 0) anchorHeight = Math.max(...ys) - Math.min(...ys) + 1;
  }

  const width = anchors.length > 0 ? normalizeGridDimension(anchorWidth) : footprintWidth;
  const height = anchors.length > 0 ? normalizeGridDimension(anchorHeight) : footprintHeight;

  return {
    horizontalPixels: magnet.anchorType === 'horizontal' ? width : footprintWidth,
    verticalPixels: magnet.anchorType === 'vertical' ? height : footprintHeight,
    rectWidth: magnet.anchorType === 'rectangular' ? width : footprintWidth,
    rectHeight: magnet.anchorType === 'rectangular' ? height : footprintHeight,
  };
}

export function buildMagnetGridFootprint(
  anchorType: AnchorType,
  dimensions: MagnetAnchorDraftDimensions
): MagnetGridFootprint {
  switch (anchorType) {
    case 'horizontal':
      return { width: normalizeGridDimension(dimensions.horizontalPixels), height: 1 };
    case 'vertical':
      return { width: 1, height: normalizeGridDimension(dimensions.verticalPixels) };
    case 'rectangular':
      return {
        width: normalizeGridDimension(dimensions.rectWidth),
        height: normalizeGridDimension(dimensions.rectHeight),
      };
    case 'single':
    default:
      return { width: 1, height: 1 };
  }
}

export function resolvePreviewAnchorOrigin(
  anchorType: AnchorType,
  dimensions: MagnetAnchorDraftDimensions
): { x: number; y: number } {
  const footprint = buildMagnetGridFootprint(anchorType, dimensions);
  return {
    x: Math.max(0, Math.floor((PREVIEW_GRID_SIZE - footprint.width) / 2)),
    y: Math.max(0, Math.floor((PREVIEW_GRID_SIZE - footprint.height) / 2)),
  };
}

export function buildEditorMagnet({
  seedMagnet,
  fallbackType = 'custom',
  fallbackInteractions = DEFAULT_MAGNET_INTERACTIONS,
  id,
  name,
  anchorType,
  anchors,
  gridFootprint,
  bounds,
  content,
  style,
  animation,
  chromeInset,
  chromeOutset,
  variant,
  skinProps,
}: BuildEditorMagnetOptions): Magnet {
  const magnet: Magnet = {
    ...(seedMagnet ?? {}),
    id,
    type: seedMagnet?.type ?? fallbackType,
    name,
    anchorType,
    anchors,
    ...(gridFootprint ? { gridFootprint } : {}),
    bounds,
    content,
    style,
    animation,
    chrome: buildChromeConfig(seedMagnet?.chrome?.enabled, chromeInset, chromeOutset),
    state: 'idle',
    interactions: seedMagnet?.interactions ?? fallbackInteractions,
  };

  if (variant !== undefined) {
    const normalizedVariant = normalizeMagnetVariant(variant);
    if (normalizedVariant) {
      magnet.variant = normalizedVariant;
    } else {
      delete magnet.variant;
    }
  }

  if (skinProps !== undefined) {
    if (skinProps && Object.keys(skinProps).length > 0) {
      magnet.skinProps = skinProps;
    } else {
      delete magnet.skinProps;
    }
  }

  return magnet;
}

export function normalizeMagnetVariant(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function parseMagnetSkinPropsDraft(value: string): Record<string, unknown> | null {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('skinProps-must-be-object');
  }

  const skinProps = parsed as Record<string, unknown>;
  return Object.keys(skinProps).length > 0 ? skinProps : null;
}

function toComparableMagnetConfig(magnet: Magnet) {
  return {
    id: magnet.id,
    type: magnet.type,
    name: magnet.name,
    renderer: magnet.renderer ?? null,
    variant: magnet.variant ?? null,
    skinProps: magnet.skinProps ?? null,
    anchorType: magnet.anchorType,
    anchors: magnet.anchors,
    bounds: magnet.bounds,
    style: magnet.style,
    animation: magnet.animation ?? null,
    chrome: magnet.chrome ?? null,
    content: magnet.content,
  };
}

export function hasMagnetConfigChanges(
  previous: Magnet | null | undefined,
  next: Magnet
): boolean {
  if (!previous) return true;
  return JSON.stringify(toComparableMagnetConfig(previous)) !== JSON.stringify(toComparableMagnetConfig(next));
}
