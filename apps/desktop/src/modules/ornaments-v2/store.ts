import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import {
  readDurableText,
  readJson,
  readString,
  writeDurableText,
  writeJson,
} from '../storage';
import {
  broadcastDataUpdate,
  setupConfigSync,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';

const ORNAMENTS_DURABLE_NAMESPACE = 'ornaments' as const;
const ORNAMENTS_DURABLE_ID = 'config-v2';
const telemetry = getTelemetryLogger('ornaments', 'store');

export type OrnamentAnchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export type OrnamentPlane = -1 | 1;

export interface OrnamentItem {
  id: string;
  name?: string;
  enabled: boolean;
  media: {
    path: string;
    mime: string;
    animated: boolean;
    sourceWidth: number;
    sourceHeight: number;
  };
  placement: {
    anchor: OrnamentAnchor;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  };
  layer: {
    plane: OrnamentPlane;
    order: number;
  };
}

export interface OrnamentsConfigV2 {
  version: 2;
  layerOrderVersion: 1;
  items: OrnamentItem[];
  /** Last successful local snapshot write, used to select a durable recovery copy. */
  updatedAt?: number;
}

export type OrnamentsConfigUpdate =
  | OrnamentsConfigV2
  | ((current: OrnamentsConfigV2) => OrnamentsConfigV2);

export function normalizeOrnamentLayerOrder(value: unknown, fallback = 1): number {
  const fallbackOrder = Number.isFinite(fallback) ? Math.trunc(fallback) : 1;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return Math.max(1, fallbackOrder);
  return Math.max(1, Math.trunc(numeric));
}

export function nextOrnamentLayerOrder(
  items: readonly OrnamentItem[],
  plane: OrnamentPlane
): number {
  return (
    items.reduce(
      (max, item) =>
        item.enabled && item.layer.plane === plane
          ? Math.max(max, normalizeOrnamentLayerOrder(item.layer.order))
          : max,
      0
    ) + 1
  );
}

export const EMPTY_ORNAMENTS_CONFIG: OrnamentsConfigV2 = {
  version: 2,
  layerOrderVersion: 1,
  updatedAt: 0,
  items: [],
};

function normalizeItem(value: unknown, index: number): OrnamentItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<OrnamentItem>;
  const media = item.media;
  const placement = item.placement;
  if (!media?.path || !placement) return null;

  const width = Number.isFinite(placement.width) && placement.width > 0 ? placement.width : 160;
  const height = Number.isFinite(placement.height) && placement.height > 0 ? placement.height : 160;
  const plane = item.layer?.plane === -1 ? -1 : 1;
  const order = normalizeOrnamentLayerOrder(item.layer?.order, index + 1);

  return {
    id: item.id || `ornament-${index}`,
    name: item.name,
    enabled: item.enabled !== false,
    media: {
      path: media.path,
      mime: media.mime || 'image/*',
      animated: Boolean(media.animated),
      sourceWidth: Number.isFinite(media.sourceWidth) ? media.sourceWidth : width,
      sourceHeight: Number.isFinite(media.sourceHeight) ? media.sourceHeight : height,
    },
    placement: {
      anchor: placement.anchor || 'center',
      offsetX: Number.isFinite(placement.offsetX) ? placement.offsetX : 0,
      offsetY: Number.isFinite(placement.offsetY) ? placement.offsetY : 0,
      width,
      height,
    },
    layer: { plane, order },
  };
}

export function normalizeOrnamentsConfig(value: unknown): OrnamentsConfigV2 {
  if (!value || typeof value !== 'object') return EMPTY_ORNAMENTS_CONFIG;
  const raw = value as Partial<OrnamentsConfigV2>;
  const items = Array.isArray(raw.items)
    ? raw.items
    : [];
  const normalizedItems = items.map(normalizeItem).filter((item): item is OrnamentItem => Boolean(item));
  const migratedItems = raw.layerOrderVersion === 1
    ? normalizedItems
    : normalizeLegacyLayerOrders(normalizedItems);
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
    ? Math.max(0, Math.trunc(raw.updatedAt))
    : 0;
  return {
    version: 2,
    layerOrderVersion: 1,
    updatedAt,
    items: migratedItems,
  };
}

function normalizeLegacyLayerOrders(items: readonly OrnamentItem[]): OrnamentItem[] {
  const nextOrderByPlane = new Map<OrnamentPlane, number>([
    [-1, 1],
    [1, 1],
  ]);
  const ordered = [...items].sort(
    (a, b) =>
      a.layer.plane - b.layer.plane ||
      normalizeOrnamentLayerOrder(a.layer.order) - normalizeOrnamentLayerOrder(b.layer.order)
  );

  return ordered.map((item) => {
    const order = nextOrderByPlane.get(item.layer.plane) ?? 1;
    nextOrderByPlane.set(item.layer.plane, order + 1);
    return { ...item, layer: { ...item.layer, order } };
  });
}

function stampConfig(config: OrnamentsConfigV2): OrnamentsConfigV2 {
  const normalized = normalizeOrnamentsConfig(config);
  const previousTimestamp = normalized.updatedAt ?? 0;
  return {
    ...normalized,
    updatedAt: Math.max(Date.now(), previousTimestamp + 1),
  };
}

function parseConfigRaw(raw: string | null): OrnamentsConfigV2 | null {
  if (!raw) return null;
  try {
    return normalizeOrnamentsConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

let ornamentWriteQueue: Promise<OrnamentsConfigV2> = Promise.resolve(EMPTY_ORNAMENTS_CONFIG);
let ornamentsHydrationPromise: Promise<OrnamentsConfigV2> | null = null;
let durableBackupTimer: number | null = null;
let pendingDurableBackup: OrnamentsConfigV2 | null = null;
let durableBackupQueue: Promise<void> = Promise.resolve();

function writeDurableBackup(config: OrnamentsConfigV2): Promise<void> {
  durableBackupQueue = durableBackupQueue.then(async () => {
    const written = await writeDurableText(
      ORNAMENTS_DURABLE_NAMESPACE,
      ORNAMENTS_DURABLE_ID,
      JSON.stringify(config)
    );
    if (!written) {
      telemetry.warn('ornaments.storage.durable-backup.failed');
    }
  }).catch((error) => {
    telemetry.warn('ornaments.storage.durable-backup.failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  });
  return durableBackupQueue;
}

function scheduleDurableBackup(config: OrnamentsConfigV2): void {
  pendingDurableBackup = config;
  if (durableBackupTimer !== null || typeof window === 'undefined') return;

  durableBackupTimer = window.setTimeout(() => {
    durableBackupTimer = null;
    const snapshot = pendingDurableBackup;
    pendingDurableBackup = null;
    if (!snapshot) return;

    void writeDurableBackup(snapshot);
  }, 250);
}

function hasStructuralItemChange(
  previous: OrnamentsConfigV2,
  next: OrnamentsConfigV2
): boolean {
  if (previous.items.length !== next.items.length) return true;
  const previousById = new Map(previous.items.map((item) => [item.id, item]));
  return next.items.some((item) => {
    const old = previousById.get(item.id);
    return !old || old.media.path !== item.media.path;
  });
}

async function persistStampedConfig(
  config: OrnamentsConfigV2,
  previous: OrnamentsConfigV2 = EMPTY_ORNAMENTS_CONFIG
): Promise<OrnamentsConfigV2> {
  const stamped = stampConfig(config);
  await broadcastDataUpdate(
    STORAGE_KEYS.ORNAMENTS_V2,
    stamped,
    TAURI_EVENTS.ORNAMENTS_UPDATED
  );
  if (hasStructuralItemChange(previous, stamped)) {
    if (durableBackupTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(durableBackupTimer);
      durableBackupTimer = null;
    }
    pendingDurableBackup = null;
    await writeDurableBackup(stamped);
  } else {
    scheduleDurableBackup(stamped);
  }
  return stamped;
}

export function readOrnamentsConfig(): OrnamentsConfigV2 {
  return normalizeOrnamentsConfig(readJson(STORAGE_KEYS.ORNAMENTS_V2, EMPTY_ORNAMENTS_CONFIG));
}

export function writeOrnamentsConfig(config: OrnamentsConfigV2): void {
  const stamped = stampConfig(config);
  writeJson(STORAGE_KEYS.ORNAMENTS_V2, stamped, { mode: 'sync' });
  void writeDurableBackup(stamped);
}

/**
 * Persist an update against the latest storage snapshot.
 *
 * The editor and the main window can write at the same time. Callers must
 * provide a functional update so a stale React render cannot replace a newer
 * item that was added by another window.
 */
export function updateOrnamentsConfig(
  update: (current: OrnamentsConfigV2) => OrnamentsConfigV2
): Promise<OrnamentsConfigV2> {
  const operation = ornamentWriteQueue.then(async () => {
    const current = readOrnamentsConfig();
    return persistStampedConfig(update(current), current);
  });
  ornamentWriteQueue = operation.catch(() => readOrnamentsConfig());
  return operation;
}

export async function persistOrnamentsConfig(config: OrnamentsConfigV2): Promise<void> {
  await updateOrnamentsConfig(() => config);
}

/**
 * Restore a missing or older local snapshot from the AppData durable copy.
 * Existing local snapshots remain authoritative unless the durable copy has a
 * newer write timestamp.
 */
export function hydrateOrnamentsConfig(): Promise<OrnamentsConfigV2> {
  if (ornamentsHydrationPromise) return ornamentsHydrationPromise;

  ornamentsHydrationPromise = (async () => {
    const localRaw = readString(STORAGE_KEYS.ORNAMENTS_V2);
    const local = parseConfigRaw(localRaw) ?? EMPTY_ORNAMENTS_CONFIG;
    const durableRaw = await readDurableText(ORNAMENTS_DURABLE_NAMESPACE, ORNAMENTS_DURABLE_ID);
    const durable = parseConfigRaw(durableRaw);
    // A write may complete while the durable read is in flight. Re-read the
    // local snapshot before deciding whether recovery is necessary so startup
    // hydration cannot replace a freshly added ornament with an older backup.
    const latestLocalRaw = readString(STORAGE_KEYS.ORNAMENTS_V2);
    const latestLocal = parseConfigRaw(latestLocalRaw) ?? local;

    const localIsMissingOrInvalid = latestLocalRaw !== null && parseConfigRaw(latestLocalRaw) === null
      ? true
      : latestLocalRaw === null;
    const durableIsNewer = Boolean(
      durable &&
      (durable.updatedAt ?? 0) > (latestLocal.updatedAt ?? 0)
    );

    if (durable && (localIsMissingOrInvalid || durableIsNewer)) {
      return updateOrnamentsConfig((current) => {
        const currentIsEmptyUnstamped =
          (current.updatedAt ?? 0) === 0 && current.items.length === 0;
        return (currentIsEmptyUnstamped || (durable.updatedAt ?? 0) > (current.updatedAt ?? 0))
          ? durable
          : current;
      });
    }

    if (latestLocalRaw !== null) {
      scheduleDurableBackup(latestLocal);
    }
    return latestLocal;
  })().finally(() => {
    ornamentsHydrationPromise = null;
  });

  return ornamentsHydrationPromise;
}

export function ornamentMediaUrl(item: OrnamentItem): string {
  return isTauriRuntime() ? convertFileSrc(item.media.path) : item.media.path;
}

export function createOrnamentItem(input: {
  path: string;
  mime: string;
  sourceWidth: number;
  sourceHeight: number;
  name?: string;
  order: number;
}): OrnamentItem {
  const maxEdge = 180;
  const scale = Math.min(1, maxEdge / Math.max(input.sourceWidth, input.sourceHeight, 1));
  const width = Math.max(32, Math.round(input.sourceWidth * scale));
  const height = Math.max(32, Math.round(input.sourceHeight * scale));
  return {
    id: `ornament-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    enabled: true,
    media: {
      path: input.path,
      mime: input.mime,
      animated: /gif|webp/i.test(input.mime) || /\.(gif|webp)$/i.test(input.path),
      sourceWidth: input.sourceWidth,
      sourceHeight: input.sourceHeight,
    },
    placement: {
      anchor: 'center',
      offsetX: 0,
      offsetY: 0,
      width,
      height,
    },
    layer: {
      plane: 1,
      order: normalizeOrnamentLayerOrder(input.order),
    },
  };
}

export function useOrnamentsConfig(): [
  OrnamentsConfigV2,
  (next: OrnamentsConfigUpdate) => Promise<OrnamentsConfigV2>
] {
  const [config, setConfig] = useState(readOrnamentsConfig);
  const configRef = useRef(config);
  const mountedRef = useRef(true);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    let disposed = false;
    const cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.ORNAMENTS_V2],
      [TAURI_EVENTS.ORNAMENTS_UPDATED],
      () => {
        if (disposed) return;
        const next = readOrnamentsConfig();
        configRef.current = next;
        setConfig(next);
      }
    );
    void hydrateOrnamentsConfig().then((next) => {
      if (disposed) return;
      configRef.current = next;
      setConfig(next);
    });
    return () => {
      disposed = true;
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const updateConfig = useCallback(async (next: OrnamentsConfigUpdate) => {
    const update = typeof next === 'function'
      ? next as (current: OrnamentsConfigV2) => OrnamentsConfigV2
      : () => next;
    const optimistic = normalizeOrnamentsConfig(update(configRef.current));
    configRef.current = optimistic;
    setConfig(optimistic);

    const persisted = await updateOrnamentsConfig(update);
    if (mountedRef.current) {
      configRef.current = persisted;
      setConfig(persisted);
    }
    return persisted;
  }, []);

  return [config, updateConfig];
}
