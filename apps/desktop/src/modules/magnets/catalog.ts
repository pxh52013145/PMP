import type { Magnet } from '../../types/pixel';
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

function isMagnetLike(value: unknown): value is Magnet {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.trim().length === 0) return false;
  const anchors = value.anchors;
  if (!Array.isArray(anchors) || anchors.length === 0) return false;
  return true;
}

export function sanitizeMagnetCatalogState(value: unknown): MagnetCatalogState {
  const fallback = createDefaultMagnetCatalogState();
  if (!isRecord(value)) return fallback;
  if (value.version !== 1) return fallback;

  const magnetsRaw = Array.isArray(value.magnets) ? value.magnets : [];
  const magnets: Magnet[] = [];
  const seen = new Set<string>();

  for (const entry of magnetsRaw) {
    if (!isMagnetLike(entry)) continue;
    const id = entry.id.trim();
    if (BUILTIN_MAGNET_IDS.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    magnets.push({ ...(entry as Magnet), id });
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

