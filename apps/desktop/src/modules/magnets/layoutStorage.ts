import { DEFAULT_ACTIVE_MAGNET_IDS, REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import { readJson, writeJson } from '../storage';
import {
  resolveMagnetLayoutStorageKey,
  sanitizeMagnetSpaceLayout,
  type MagnetSpaceLayout,
} from './layout';
import { getSystemAnchorsForActiveMagnets } from './systemLayouts';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';

const SPACE2_DEFAULT_ACTIVE_MAGNET_IDS = new Set<string>([
  ...REQUIRED_MAGNET_IDS,
  'platform-magnet',
  'btn-platform-login',
]);
const SPACE3_DEFAULT_ACTIVE_MAGNET_IDS = new Set<string>([
  ...REQUIRED_MAGNET_IDS,
  'plugin-development-workspace',
]);
const telemetry = getTelemetryLogger('magnets', 'layoutStorage');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
          telemetry.warn('layout.after_save.failed', {
            message: readErrorMessage(error),
            fields: {
              mode: 'scheduled',
            },
          });
        });
      }
    } catch (error) {
      telemetry.warn('layout.save_scheduled.failed', {
        message: readErrorMessage(error),
        fields: {
          storageKey: args.storageKey ?? resolveMagnetLayoutStorageKey('space1'),
        },
      });
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
        telemetry.warn('layout.after_save.failed', {
          message: readErrorMessage(error),
          fields: {
            mode: 'flush',
          },
        });
      });
    }
  } catch (error) {
    telemetry.warn('layout.save_flush.failed', {
      message: readErrorMessage(error),
      fields: {
        storageKey: args.storageKey ?? resolveMagnetLayoutStorageKey('space1'),
      },
    });
  }
}

export function createDefaultMagnetSpaceLayout(
  spaceId: string,
  defaultActiveMagnetIds: ReadonlySet<string> = DEFAULT_ACTIVE_MAGNET_IDS
): MagnetSpaceLayout {
  const normalized = spaceId.trim();
  const seed =
    normalized === 'space1'
      ? defaultActiveMagnetIds
      : normalized === 'space2'
        ? SPACE2_DEFAULT_ACTIVE_MAGNET_IDS
        : normalized === 'space3'
          ? SPACE3_DEFAULT_ACTIVE_MAGNET_IDS
        : REQUIRED_MAGNET_IDS;
  const active = new Set<string>();
  for (const id of seed) active.add(id);
  for (const id of REQUIRED_MAGNET_IDS) active.add(id);
  return {
    version: 1,
    activeMagnetIds: [...active],
    anchorsByMagnetId: getSystemAnchorsForActiveMagnets(normalized, active),
  };
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
    const normalized = spaceId.trim();
    const active = new Set(existing.activeMagnetIds);
    let changed = false;

    const systemAnchors = getSystemAnchorsForActiveMagnets(normalized, active);
    if (Object.keys(systemAnchors).length === 0) {
      return { layout: existing, storageKey, didCreate: false };
    }

    const nextAnchorsByMagnetId: MagnetSpaceLayout['anchorsByMagnetId'] = { ...existing.anchorsByMagnetId };
    for (const [magnetId, anchors] of Object.entries(systemAnchors)) {
      if (Array.isArray(nextAnchorsByMagnetId[magnetId]) && nextAnchorsByMagnetId[magnetId]!.length > 0) continue;
      nextAnchorsByMagnetId[magnetId] = anchors;
      changed = true;
    }
    if (!changed) return { layout: existing, storageKey, didCreate: false };

    const nextLayout: MagnetSpaceLayout = {
      ...existing,
      activeMagnetIds: [...active],
      anchorsByMagnetId: nextAnchorsByMagnetId,
    };
    saveMagnetSpaceLayout(nextLayout, storageKey);
    return { layout: nextLayout, storageKey, didCreate: false };
  }

  const createdLayout = createDefaultMagnetSpaceLayout(spaceId, defaultActiveMagnetIds);

  saveMagnetSpaceLayout(createdLayout, storageKey);
  return { layout: createdLayout, storageKey, didCreate: true };
}
