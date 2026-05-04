import { DEFAULT_ACTIVE_MAGNET_IDS, REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import { readJson, writeJson } from '../storage';
import {
  resolveMagnetLayoutStorageKey,
  sanitizeMagnetSpaceLayout,
  type MagnetSpaceLayout,
} from './layout';
import {
  getSystemAnchorsForActiveMagnets,
  MUSIC_TAG_WORKBENCH_DEFAULT_ANCHORS,
} from './systemLayouts';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import {
  createInitialMagnetSpaceTemplateLayout,
  getInitialMagnetSpaceTemplateLayoutForSpace,
} from './spaceTemplates';

const telemetry = getTelemetryLogger('magnets', 'layoutStorage');

const MUSIC_TAG_WORKBENCH_LEGACY_ANCHOR_SETS = [
  [
    { id: 'top-left', gridX: 0, gridY: 1, role: 'anchor' },
    { id: 'top-right', gridX: 9, gridY: 1, role: 'boundary' },
    { id: 'bottom-left', gridX: 0, gridY: 7, role: 'boundary' },
    { id: 'bottom-right', gridX: 9, gridY: 7, role: 'boundary' },
  ],
  [
    { id: 'top-left', gridX: 0, gridY: 1, role: 'anchor' },
    { id: 'top-right', gridX: 5, gridY: 1, role: 'boundary' },
    { id: 'bottom-left', gridX: 0, gridY: 7, role: 'boundary' },
    { id: 'bottom-right', gridX: 5, gridY: 7, role: 'boundary' },
  ],
] as const;

const MUSIC_TAG_WORKBENCH_NAVIGATION_PAGE_COMPANION_ANCHORS = [
  { id: 'top-left', gridX: 6, gridY: 1, role: 'anchor' },
  { id: 'top-right', gridX: 26, gridY: 1, role: 'boundary' },
  { id: 'bottom-left', gridX: 6, gridY: 17, role: 'boundary' },
  { id: 'bottom-right', gridX: 26, gridY: 17, role: 'boundary' },
] as const;

function hasSameAnchors(
  left: MagnetSpaceLayout['anchorsByMagnetId'][string] | undefined,
  right: readonly {
    id: string;
    gridX: number;
    gridY: number;
    role: 'anchor' | 'boundary';
  }[]
): boolean {
  if (!Array.isArray(left) || left.length !== right.length) return false;
  return left.every((anchor, index) => {
    const expected = right[index];
    return (
      anchor.id === expected.id &&
      anchor.gridX === expected.gridX &&
      anchor.gridY === expected.gridY &&
      anchor.role === expected.role
    );
  });
}

function hasAnySameAnchors(
  left: MagnetSpaceLayout['anchorsByMagnetId'][string] | undefined,
  candidates: readonly (readonly {
    id: string;
    gridX: number;
    gridY: number;
    role: 'anchor' | 'boundary';
  }[])[]
): boolean {
  return candidates.some((candidate) => hasSameAnchors(left, candidate));
}

function cloneAnchors(
  anchors: MagnetSpaceLayout['anchorsByMagnetId'][string]
): MagnetSpaceLayout['anchorsByMagnetId'][string] {
  return anchors.map((anchor) => ({ ...anchor }));
}

function shouldUpgradeLegacyMusicTagWorkbenchLayout(
  active: ReadonlySet<string>,
  anchorsByMagnetId: MagnetSpaceLayout['anchorsByMagnetId']
): boolean {
  if (!active.has('music-tag-workbench')) return false;
  return (
    hasAnySameAnchors(
      anchorsByMagnetId['music-tag-workbench'],
      MUSIC_TAG_WORKBENCH_LEGACY_ANCHOR_SETS
    ) ||
    hasSameAnchors(
      anchorsByMagnetId['navigation-page'],
      MUSIC_TAG_WORKBENCH_NAVIGATION_PAGE_COMPANION_ANCHORS
    )
  );
}

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
  const seed = normalized === 'space1' ? defaultActiveMagnetIds : REQUIRED_MAGNET_IDS;
  const active = new Set<string>();
  for (const id of seed) active.add(id);
  for (const id of REQUIRED_MAGNET_IDS) active.add(id);
  return {
    version: 1,
    activeMagnetIds: [...active],
    anchorsByMagnetId: getSystemAnchorsForActiveMagnets(normalized, active),
  };
}

export function createInitialMagnetSpaceLayout(
  spaceId: string,
  defaultActiveMagnetIds: ReadonlySet<string> = DEFAULT_ACTIVE_MAGNET_IDS
): MagnetSpaceLayout {
  return (
    getInitialMagnetSpaceTemplateLayoutForSpace(spaceId, defaultActiveMagnetIds) ??
    createDefaultMagnetSpaceLayout(spaceId, defaultActiveMagnetIds)
  );
}

export function ensureMagnetSpaceLayout(
  spaceId: string,
  options: { defaultActiveMagnetIds?: ReadonlySet<string>; seedTemplateId?: string } = {}
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
    const nextAnchorsByMagnetId: MagnetSpaceLayout['anchorsByMagnetId'] = { ...existing.anchorsByMagnetId };
    const shouldUpgradeMusicTagWorkbench = shouldUpgradeLegacyMusicTagWorkbenchLayout(
      active,
      nextAnchorsByMagnetId
    );

    if (shouldUpgradeMusicTagWorkbench) {
      if (active.delete('btn-back')) changed = true;
      if (active.delete('navigation-page')) changed = true;
      delete nextAnchorsByMagnetId['btn-back'];
      delete nextAnchorsByMagnetId['navigation-page'];
      nextAnchorsByMagnetId['music-tag-workbench'] = cloneAnchors(
        MUSIC_TAG_WORKBENCH_DEFAULT_ANCHORS
      );
      changed = true;
    }

    const systemAnchors = getSystemAnchorsForActiveMagnets(normalized, active);
    if (Object.keys(systemAnchors).length === 0) {
      return { layout: existing, storageKey, didCreate: false };
    }

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

  const createdLayout =
    createInitialMagnetSpaceTemplateLayout(options.seedTemplateId, defaultActiveMagnetIds) ??
    createDefaultMagnetSpaceLayout(spaceId, defaultActiveMagnetIds);

  saveMagnetSpaceLayout(createdLayout, storageKey);
  return { layout: createdLayout, storageKey, didCreate: true };
}
