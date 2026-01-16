import type { Magnet, AnchorType, PixelAnchor, MagnetGridFootprint } from '../../types/pixel';
import { BUILTIN_MAGNET_IDS } from '../../constants/magnets';
import { readJson, readString } from '../storage';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  broadcastDataUpdate,
} from '../../utils/windowCommunication';
import { loadMagnetConfig, resolveMagnetConfigStorageKey } from './config';

export type MagnetCatalogState = {
  version: 1;
  magnets: Magnet[];
};

export function createDefaultMagnetCatalogState(): MagnetCatalogState {
  return { version: 1, magnets: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAnchorType(value: unknown): value is AnchorType {
  return value === 'single' || value === 'horizontal' || value === 'vertical' || value === 'rectangular';
}

function sanitizePixelAnchors(value: unknown): PixelAnchor[] {
  if (!Array.isArray(value)) return [];
  const anchors: PixelAnchor[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const gridX = entry.gridX;
    const gridY = entry.gridY;
    const role = entry.role;
    if (typeof gridX !== 'number' || typeof gridY !== 'number') continue;
    if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) continue;
    if (role !== 'anchor' && role !== 'boundary') continue;
    anchors.push({
      id: typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id : 'anchor',
      gridX,
      gridY,
      role,
    });
  }
  return anchors;
}

function sanitizeGridFootprint(value: unknown): MagnetGridFootprint | undefined {
  if (!isRecord(value)) return undefined;
  const width = value.width;
  const height = value.height;
  if (typeof width !== 'number' || typeof height !== 'number') return undefined;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

function sanitizeMagnetLike(value: unknown): Magnet | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.trim().length === 0) return null;

  const id = value.id.trim();
  if (BUILTIN_MAGNET_IDS.has(id)) return null;

  const anchorType: AnchorType = isAnchorType(value.anchorType) ? value.anchorType : 'single';
  const anchors = sanitizePixelAnchors(value.anchors);
  const gridFootprint = sanitizeGridFootprint(value.gridFootprint);

  const interactionsRaw = value.interactions;
  const interactions = isRecord(interactionsRaw)
    ? {
        draggable: interactionsRaw.draggable === true,
        clickable: interactionsRaw.clickable !== false,
      }
    : { draggable: false, clickable: true };

  return {
    id,
    type: typeof value.type === 'string' && value.type.trim().length > 0 ? (value.type as Magnet['type']) : 'custom',
    name: typeof value.name === 'string' && value.name.trim().length > 0 ? value.name : id,
    renderer: typeof value.renderer === 'string' && value.renderer.trim().length > 0 ? value.renderer : undefined,
    previewText: typeof value.previewText === 'string' ? value.previewText : undefined,
    description: typeof value.description === 'string' ? value.description : undefined,
    tags: Array.isArray(value.tags) ? (value.tags.filter((t) => typeof t === 'string') as string[]) : undefined,
    variant: typeof value.variant === 'string' ? value.variant : undefined,
    variantConfig: isRecord(value.variantConfig) ? (value.variantConfig as Record<string, unknown>) : undefined,
    anchorType,
    anchors,
    gridFootprint,
    content: typeof value.content === 'string' ? value.content : '',
    style: isRecord(value.style) ? (value.style as Magnet['style']) : {},
    state: 'idle',
    interactions,
  };
}

export function sanitizeMagnetCatalogState(value: unknown): MagnetCatalogState {
  const fallback = createDefaultMagnetCatalogState();
  if (!isRecord(value)) return fallback;
  if (value.version !== 1) return fallback;

  const magnetsRaw = Array.isArray(value.magnets) ? value.magnets : [];
  const magnets: Magnet[] = [];
  const seen = new Set<string>();

  for (const entry of magnetsRaw) {
    const magnet = sanitizeMagnetLike(entry);
    if (!magnet) continue;
    const id = magnet.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    magnets.push(magnet);
  }

  return { version: 1, magnets };
}

export function readMagnetCatalogState(): MagnetCatalogState {
  return sanitizeMagnetCatalogState(
    readJson<unknown>(STORAGE_KEYS.MAGNET_CATALOG, createDefaultMagnetCatalogState())
  );
}

export function writeMagnetCatalogState(state: MagnetCatalogState): void {
  void broadcastDataUpdate(
    STORAGE_KEYS.MAGNET_CATALOG,
    state,
    TAURI_EVENTS.MAGNET_LIBRARY_UPDATED
  );
}

export function ensureMagnetCatalogState(spaceIds: string[]): {
  state: MagnetCatalogState;
  didCreate: boolean;
} {
  const existingRaw = readString(STORAGE_KEYS.MAGNET_CATALOG);
  if (existingRaw) {
    return { state: readMagnetCatalogState(), didCreate: false };
  }

  const magnets: Magnet[] = [];
  const seen = new Set<string>();

  for (const spaceId of spaceIds) {
    const configKey = resolveMagnetConfigStorageKey(spaceId);
    const config = loadMagnetConfig(configKey);
    for (const magnet of config?.customMagnets ?? []) {
      if (!magnet?.id) continue;
      const id = magnet.id.trim();
      if (!id) continue;
      if (BUILTIN_MAGNET_IDS.has(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      magnets.push({ ...magnet, id });
    }
  }

  const state = sanitizeMagnetCatalogState({ version: 1, magnets });
  writeMagnetCatalogState(state);
  return { state, didCreate: true };
}

export function upsertMagnetCatalogMagnet(magnet: Magnet): MagnetCatalogState {
  const current = readMagnetCatalogState();
  const id = magnet.id.trim();
  if (!id || BUILTIN_MAGNET_IDS.has(id)) return current;

  const nextMagnets = current.magnets.slice();
  const idx = nextMagnets.findIndex((m) => m.id === id);
  if (idx >= 0) {
    nextMagnets[idx] = { ...magnet, id };
  } else {
    nextMagnets.push({ ...magnet, id });
  }

  const next = sanitizeMagnetCatalogState({ version: 1, magnets: nextMagnets });
  writeMagnetCatalogState(next);
  return next;
}

export function removeMagnetCatalogMagnet(magnetId: string): MagnetCatalogState {
  const current = readMagnetCatalogState();
  const id = magnetId.trim();
  if (!id) return current;

  const nextMagnets = current.magnets.filter((m) => m.id !== id);
  if (nextMagnets.length === current.magnets.length) return current;

  const next = sanitizeMagnetCatalogState({ version: 1, magnets: nextMagnets });
  writeMagnetCatalogState(next);
  return next;
}
