import type { PixelAnchor } from '../../types/pixel';
import { DEFAULT_ACTIVE_MAGNET_IDS, REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import { readJson, writeJson } from '../storage';
import { loadMagnetConfig, resolveMagnetConfigStorageKey } from './config';
import {
  resolveMagnetLayoutStorageKey,
  sanitizeMagnetSpaceLayout,
  type MagnetSpaceLayout,
} from './layout';

export function loadMagnetSpaceLayout(storageKey: string): MagnetSpaceLayout | null {
  const raw = readJson<unknown | null>(storageKey, null);
  if (raw === null) return null;
  return sanitizeMagnetSpaceLayout(raw);
}

export function saveMagnetSpaceLayout(layout: MagnetSpaceLayout, storageKey: string): void {
  writeJson(storageKey, layout);
}

export interface ScheduleSaveMagnetSpaceLayoutOptions {
  debounceMs?: number;
  afterSave?: () => void | Promise<void>;
  storageKey?: string;
}

let scheduledSaveTimeout: number | null = null;
let scheduledArgs:
  | {
      layout: MagnetSpaceLayout;
      storageKey?: string;
    }
  | null = null;
let scheduledAfterSave: null | (() => void | Promise<void>) = null;

export function scheduleSaveMagnetSpaceLayout(
  layout: MagnetSpaceLayout,
  options: ScheduleSaveMagnetSpaceLayoutOptions = {}
): void {
  const debounceMs = options.debounceMs ?? 300;
  const storageKey = options.storageKey;

  scheduledArgs = { layout, storageKey };
  scheduledAfterSave = options.afterSave ?? null;

  if (scheduledSaveTimeout !== null) {
    window.clearTimeout(scheduledSaveTimeout);
  }

  scheduledSaveTimeout = window.setTimeout(() => {
    scheduledSaveTimeout = null;
    const args = scheduledArgs;
    scheduledArgs = null;
    const afterSave = scheduledAfterSave;
    scheduledAfterSave = null;
    if (!args) return;
    try {
      saveMagnetSpaceLayout(args.layout, args.storageKey ?? resolveMagnetLayoutStorageKey('space1'));
      if (afterSave) {
        Promise.resolve(afterSave()).catch((error) => {
          console.warn('[magnets] afterSave (layout) callback failed', error);
        });
      }
    } catch (error) {
      console.warn('[magnets] Failed to save layout (scheduled)', error);
    }
  }, debounceMs);
}

export function cancelScheduledMagnetSpaceLayoutSave(): void {
  if (scheduledSaveTimeout !== null) {
    window.clearTimeout(scheduledSaveTimeout);
    scheduledSaveTimeout = null;
  }
  scheduledArgs = null;
  scheduledAfterSave = null;
}

export function flushScheduledMagnetSpaceLayoutSave(): void {
  if (scheduledSaveTimeout !== null) {
    window.clearTimeout(scheduledSaveTimeout);
    scheduledSaveTimeout = null;
  }

  const args = scheduledArgs;
  scheduledArgs = null;
  const afterSave = scheduledAfterSave;
  scheduledAfterSave = null;

  if (!args) return;

  try {
    saveMagnetSpaceLayout(args.layout, args.storageKey ?? resolveMagnetLayoutStorageKey('space1'));
    if (afterSave) {
      Promise.resolve(afterSave()).catch((error) => {
        console.warn('[magnets] afterSave (layout) callback failed', error);
      });
    }
  } catch (error) {
    console.warn('[magnets] Failed to save layout (flush)', error);
  }
}

export function createDefaultMagnetSpaceLayout(
  spaceId: string,
  defaultActiveMagnetIds: ReadonlySet<string> = DEFAULT_ACTIVE_MAGNET_IDS
): MagnetSpaceLayout {
  const normalized = spaceId.trim();
  const seed = normalized === 'space1' ? defaultActiveMagnetIds : REQUIRED_MAGNET_IDS;
  const active = new Set<string>();
  for (const id of seed) active.add(id);
  for (const id of REQUIRED_MAGNET_IDS) active.add(id);
  return { version: 1, activeMagnetIds: [...active], anchorsByMagnetId: {} };
}

function deriveAnchorsByMagnetId(magnets: Record<string, unknown>): Record<string, PixelAnchor[]> {
  const result: Record<string, PixelAnchor[]> = {};
  for (const [magnetId, raw] of Object.entries(magnets)) {
    if (!raw || typeof raw !== 'object') continue;
    const anchors = (raw as { anchors?: unknown }).anchors;
    if (!Array.isArray(anchors) || anchors.length === 0) continue;
    result[magnetId] = anchors as PixelAnchor[];
  }
  return result;
}

function deriveActiveMagnetIds(
  magnets: Record<string, unknown>,
  spaceId: string,
  defaultActiveMagnetIds: ReadonlySet<string>
): string[] {
  const active = new Set<string>();
  for (const [magnetId, raw] of Object.entries(magnets)) {
    if (!raw || typeof raw !== 'object') continue;
    if ((raw as { isActive?: unknown }).isActive === true) active.add(magnetId);
  }

  // Keep "space2+" strictly empty: do not auto-enable newly added default magnets unless explicitly saved.
  const normalized = spaceId.trim();
  if (normalized === 'space1') {
    for (const id of defaultActiveMagnetIds) {
      if (!(id in magnets)) active.add(id);
    }
  }

  for (const id of REQUIRED_MAGNET_IDS) active.add(id);
  return [...active];
}

export function deriveMagnetSpaceLayoutFromLegacyConfig(
  spaceId: string,
  legacyConfig: { magnets: Record<string, unknown> },
  options: { defaultActiveMagnetIds: ReadonlySet<string> }
): MagnetSpaceLayout {
  return sanitizeMagnetSpaceLayout({
    version: 1,
    activeMagnetIds: deriveActiveMagnetIds(legacyConfig.magnets, spaceId, options.defaultActiveMagnetIds),
    anchorsByMagnetId: deriveAnchorsByMagnetId(legacyConfig.magnets),
  });
}

export function ensureMagnetSpaceLayout(
  spaceId: string,
  options: { defaultActiveMagnetIds?: ReadonlySet<string> } = {}
): {
  layout: MagnetSpaceLayout;
  storageKey: string;
  didCreate: boolean;
} {
  const defaultActiveMagnetIds = options.defaultActiveMagnetIds ?? DEFAULT_ACTIVE_MAGNET_IDS;
  const storageKey = resolveMagnetLayoutStorageKey(spaceId);
  const existing = loadMagnetSpaceLayout(storageKey);
  if (existing) {
    return { layout: existing, storageKey, didCreate: false };
  }

  const configKey = resolveMagnetConfigStorageKey(spaceId);
  const legacyConfig = loadMagnetConfig(configKey);

  const createdLayout = legacyConfig
    ? deriveMagnetSpaceLayoutFromLegacyConfig(spaceId, legacyConfig, { defaultActiveMagnetIds })
    : createDefaultMagnetSpaceLayout(spaceId, defaultActiveMagnetIds);

  saveMagnetSpaceLayout(createdLayout, storageKey);
  return { layout: createdLayout, storageKey, didCreate: true };
}
