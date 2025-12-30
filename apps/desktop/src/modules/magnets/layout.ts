import type { PixelAnchor } from '../../types/pixel';
import { REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

export type MagnetSpaceLayoutV1 = {
  version: 1;
  activeMagnetIds: string[];
  anchorsByMagnetId: Record<string, PixelAnchor[]>;
};

export type MagnetSpaceLayout = MagnetSpaceLayoutV1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const normalized = entry.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function sanitizePixelAnchor(value: unknown): PixelAnchor | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!id) return null;
  const gridX = typeof value.gridX === 'number' && Number.isFinite(value.gridX) ? value.gridX : NaN;
  const gridY = typeof value.gridY === 'number' && Number.isFinite(value.gridY) ? value.gridY : NaN;
  if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) return null;
  const role = value.role === 'anchor' || value.role === 'boundary' ? value.role : null;
  if (!role) return null;
  return { id, gridX, gridY, role };
}

function sanitizePixelAnchors(value: unknown): PixelAnchor[] {
  if (!Array.isArray(value)) return [];
  const result: PixelAnchor[] = [];
  for (const entry of value) {
    const anchor = sanitizePixelAnchor(entry);
    if (!anchor) continue;
    result.push(anchor);
  }
  return result;
}

function sanitizeAnchorsByMagnetId(value: unknown): Record<string, PixelAnchor[]> {
  if (!isRecord(value)) return {};
  const result: Record<string, PixelAnchor[]> = {};
  for (const [key, raw] of Object.entries(value)) {
    const id = key.trim();
    if (!id) continue;
    const anchors = sanitizePixelAnchors(raw);
    if (anchors.length === 0) continue;
    result[id] = anchors;
  }
  return result;
}

export function sanitizeMagnetSpaceLayout(value: unknown): MagnetSpaceLayout {
  const fallback: MagnetSpaceLayout = {
    version: 1,
    activeMagnetIds: [...REQUIRED_MAGNET_IDS],
    anchorsByMagnetId: {},
  };

  if (!isRecord(value)) return fallback;
  if (value.version !== 1) return fallback;

  const active = sanitizeStringArray(value.activeMagnetIds);
  const ensuredActive = new Set(active);
  for (const id of REQUIRED_MAGNET_IDS) ensuredActive.add(id);

  return {
    version: 1,
    activeMagnetIds: [...ensuredActive],
    anchorsByMagnetId: sanitizeAnchorsByMagnetId(value.anchorsByMagnetId),
  };
}

export function resolveMagnetLayoutStorageKey(activeSpaceId: string | null | undefined): string {
  const normalized = typeof activeSpaceId === 'string' ? activeSpaceId.trim() : '';
  if (!normalized || normalized === 'space1') return STORAGE_KEYS.MAGNET_SPACE_LAYOUT;
  return `${STORAGE_KEYS.MAGNET_SPACE_LAYOUT}:${normalized}`;
}

