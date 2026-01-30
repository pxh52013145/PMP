import type {
  OrnamentAnchor,
  OrnamentItem,
  OrnamentLayer,
  OrnamentsConfig,
} from '../../types/ornaments';

const ORNAMENT_ANCHORS: readonly OrnamentAnchor[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
];

const ORNAMENT_LAYERS: readonly OrnamentLayer[] = ['background', 'foreground'];

export const DEFAULT_ORNAMENTS_CONFIG: OrnamentsConfig = { version: 1, items: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const next = clampNumber(value, fallback, min, max);
  return Math.round(next);
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function isOrnamentAnchor(value: unknown): value is OrnamentAnchor {
  return typeof value === 'string' && (ORNAMENT_ANCHORS as readonly string[]).includes(value);
}

function isOrnamentLayer(value: unknown): value is OrnamentLayer {
  return typeof value === 'string' && (ORNAMENT_LAYERS as readonly string[]).includes(value);
}

export function createOrnamentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `orn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeOrnamentItem(value: unknown): OrnamentItem | null {
  if (!isRecord(value)) return null;

  const media = value.media;
  if (!isRecord(media)) return null;
  if (media.type !== 'image') return null;
  const url = normalizeString(media.url, '').trim();
  if (!url) return null;

  const transform = value.transform;
  if (!isRecord(transform)) return null;

  const id = normalizeString(value.id, createOrnamentId()).trim() || createOrnamentId();
  const name = normalizeString(value.name, '').trim();
  const enabled = typeof value.enabled === 'boolean' ? value.enabled : true;

  const anchor: OrnamentAnchor = isOrnamentAnchor(transform.anchor)
    ? transform.anchor
    : 'bottom-left';

  return {
    id,
    name,
    enabled,
    media: { type: 'image', url },
    transform: {
      anchor,
      offsetX: clampInt(transform.offsetX, 0, -2000, 2000),
      offsetY: clampInt(transform.offsetY, 0, -2000, 2000),
      width: clampInt(transform.width, 160, 16, 2400),
      height: clampInt(transform.height, 160, 16, 2400),
      opacity: clampNumber(transform.opacity, 1, 0, 1),
      layer: isOrnamentLayer(transform.layer) ? transform.layer : 'foreground',
    },
  };
}

export function normalizeOrnamentsConfig(value: unknown): OrnamentsConfig {
  if (!isRecord(value)) return DEFAULT_ORNAMENTS_CONFIG;
  if (value.version !== 1) return DEFAULT_ORNAMENTS_CONFIG;

  const rawItems = Array.isArray(value.items) ? value.items : [];
  const items = rawItems.map(normalizeOrnamentItem).filter(Boolean) as OrnamentItem[];

  return { version: 1, items };
}

export function getOrnamentAnchors(): readonly OrnamentAnchor[] {
  return ORNAMENT_ANCHORS;
}

export function getOrnamentLayers(): readonly OrnamentLayer[] {
  return ORNAMENT_LAYERS;
}
