import type { PlatformRenderSelectionRecord } from '@pixel-matrix/plugin-platform-contracts';
import { readJson } from '../storage';
import {
  broadcastDataUpdate,
  setupDualListener,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../utils/windowCommunication';
import { listPlatformInstances, subscribePlatformInstances } from './instanceRegistry';

type PlatformRenderSelectionRegistryListener = (
  selections: PlatformRenderSelectionRecord[]
) => void;

export interface PlatformRenderSelectionPersistenceInspection {
  initialized: boolean;
  live: PlatformRenderSelectionRecord[];
  persisted: PlatformRenderSelectionRecord[];
}

const platformRenderSelectionRegistry = new Map<string, PlatformRenderSelectionRecord>();
const platformRenderSelectionRegistryListeners = new Set<PlatformRenderSelectionRegistryListener>();

let platformRenderSelectionRegistryInitialized = false;

function normalizeInstanceId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clonePlatformRenderSelectionRecord(
  record: PlatformRenderSelectionRecord
): PlatformRenderSelectionRecord {
  return {
    instanceId: record.instanceId,
    mounted: record.mounted,
    mountedAtMs: record.mountedAtMs,
    order: record.order,
    metadata: record.metadata ? { ...record.metadata } : undefined,
  };
}

function arePlatformRenderSelectionRecordsEqual(
  left: PlatformRenderSelectionRecord | null | undefined,
  right: PlatformRenderSelectionRecord | null | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.instanceId === right.instanceId &&
    left.mounted === right.mounted &&
    left.mountedAtMs === right.mountedAtMs &&
    left.order === right.order &&
    JSON.stringify(left.metadata ?? null) === JSON.stringify(right.metadata ?? null)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizePlatformRenderSelectionRecord(
  value: unknown
): PlatformRenderSelectionRecord | null {
  if (!isRecord(value)) return null;

  const instanceId = normalizeInstanceId(value.instanceId);
  if (!instanceId) {
    return null;
  }

  const mounted = value.mounted === true;
  const mountedAtMs =
    typeof value.mountedAtMs === 'number' && Number.isFinite(value.mountedAtMs)
      ? Math.max(0, Math.floor(value.mountedAtMs))
      : undefined;
  const order =
    typeof value.order === 'number' && Number.isFinite(value.order)
      ? Math.max(0, Math.floor(value.order))
      : undefined;
  const metadata = isRecord(value.metadata) ? { ...value.metadata } : undefined;

  return {
    instanceId,
    mounted,
    mountedAtMs,
    order,
    metadata,
  };
}

function sortPlatformRenderSelections(
  left: PlatformRenderSelectionRecord,
  right: PlatformRenderSelectionRecord
): number {
  if ((left.order ?? Number.MAX_SAFE_INTEGER) !== (right.order ?? Number.MAX_SAFE_INTEGER)) {
    return (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER);
  }
  return left.instanceId.localeCompare(right.instanceId, 'zh-CN');
}

function serializePlatformRenderSelections(
  records: PlatformRenderSelectionRecord[]
): string {
  return JSON.stringify(
    records
      .slice()
      .sort(sortPlatformRenderSelections)
      .map((record) => ({
        instanceId: record.instanceId,
        mounted: record.mounted,
        mountedAtMs: record.mountedAtMs,
        order: record.order,
        metadata: record.metadata ? { ...record.metadata } : undefined,
      }))
  );
}

function readStoredPlatformRenderSelections(): PlatformRenderSelectionRecord[] {
  if (typeof window === 'undefined') return [];
  const raw = readJson<unknown>(STORAGE_KEYS.PLATFORM_RENDER_SELECTIONS_V1, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => sanitizePlatformRenderSelectionRecord(item))
    .filter((record): record is PlatformRenderSelectionRecord => Boolean(record))
    .sort(sortPlatformRenderSelections)
    .map(clonePlatformRenderSelectionRecord);
}

function snapshotPlatformRenderSelections(): PlatformRenderSelectionRecord[] {
  return Array.from(platformRenderSelectionRegistry.values())
    .map(clonePlatformRenderSelectionRecord)
    .sort(sortPlatformRenderSelections);
}

function savePlatformRenderSelections(records: PlatformRenderSelectionRecord[]): void {
  void broadcastDataUpdate(
    STORAGE_KEYS.PLATFORM_RENDER_SELECTIONS_V1,
    records.map(clonePlatformRenderSelectionRecord),
    TAURI_EVENTS.PLATFORM_RENDER_SELECTIONS_UPDATED
  );
}

function replacePlatformRenderSelections(
  records: PlatformRenderSelectionRecord[]
): boolean {
  const currentSerialized = serializePlatformRenderSelections(
    snapshotPlatformRenderSelections()
  );
  platformRenderSelectionRegistry.clear();
  for (const record of records) {
    platformRenderSelectionRegistry.set(record.instanceId, clonePlatformRenderSelectionRecord(record));
  }
  const nextSerialized = serializePlatformRenderSelections(snapshotPlatformRenderSelections());
  return currentSerialized !== nextSerialized;
}

function emitPlatformRenderSelectionsChanged(): void {
  const snapshot = snapshotPlatformRenderSelections();

  for (const listener of platformRenderSelectionRegistryListeners) {
    listener(snapshot);
  }
}

function reconcilePlatformRenderSelections(): boolean {
  const instances = listPlatformInstances();
  const seenInstanceIds = new Set<string>();
  let changed = false;

  instances.forEach((instance, index) => {
    seenInstanceIds.add(instance.instanceId);
    const existing = platformRenderSelectionRegistry.get(instance.instanceId);
    if (!existing) {
      platformRenderSelectionRegistry.set(instance.instanceId, {
        instanceId: instance.instanceId,
        mounted: false,
        mountedAtMs: undefined,
        order: index,
      });
      changed = true;
      return;
    }

    const nextOrder = existing.order ?? index;
    if (existing.order !== nextOrder) {
      platformRenderSelectionRegistry.set(instance.instanceId, {
        ...existing,
        order: nextOrder,
      });
      changed = true;
    }
  });

  for (const instanceId of Array.from(platformRenderSelectionRegistry.keys())) {
    if (seenInstanceIds.has(instanceId)) continue;
    platformRenderSelectionRegistry.delete(instanceId);
    changed = true;
  }

  return changed;
}

function initializePlatformRenderSelectionRegistry(): void {
  if (platformRenderSelectionRegistryInitialized) return;
  platformRenderSelectionRegistryInitialized = true;

  replacePlatformRenderSelections(readStoredPlatformRenderSelections());
  const changed = reconcilePlatformRenderSelections();
  if (changed) {
    savePlatformRenderSelections(snapshotPlatformRenderSelections());
    emitPlatformRenderSelectionsChanged();
  }

  subscribePlatformInstances(() => {
    const nextChanged = reconcilePlatformRenderSelections();
    if (nextChanged) {
      savePlatformRenderSelections(snapshotPlatformRenderSelections());
      emitPlatformRenderSelectionsChanged();
    }
  });

  void setupDualListener(
    [STORAGE_KEYS.PLATFORM_RENDER_SELECTIONS_V1],
    [TAURI_EVENTS.PLATFORM_RENDER_SELECTIONS_UPDATED],
    () => {
      const currentSerialized = serializePlatformRenderSelections(
        snapshotPlatformRenderSelections()
      );
      replacePlatformRenderSelections(readStoredPlatformRenderSelections());
      const reconciled = reconcilePlatformRenderSelections();
      const nextSnapshot = snapshotPlatformRenderSelections();
      const nextSerialized = serializePlatformRenderSelections(nextSnapshot);

      if (reconciled) {
        savePlatformRenderSelections(nextSnapshot);
      }
      if (currentSerialized !== nextSerialized) {
        emitPlatformRenderSelectionsChanged();
      }
    }
  ).catch(() => {
    platformRenderSelectionRegistryInitialized = false;
  });
}

export function listPlatformRenderSelections(): PlatformRenderSelectionRecord[] {
  initializePlatformRenderSelectionRegistry();
  return snapshotPlatformRenderSelections();
}

export function inspectPlatformRenderSelectionPersistence(): PlatformRenderSelectionPersistenceInspection {
  return {
    initialized: platformRenderSelectionRegistryInitialized,
    live: platformRenderSelectionRegistryInitialized ? snapshotPlatformRenderSelections() : [],
    persisted: readStoredPlatformRenderSelections(),
  };
}

export function getPlatformRenderSelection(
  instanceId: string
): PlatformRenderSelectionRecord | null {
  initializePlatformRenderSelectionRegistry();
  const normalizedInstanceId = normalizeInstanceId(instanceId);
  if (!normalizedInstanceId) return null;
  const record = platformRenderSelectionRegistry.get(normalizedInstanceId);
  return record ? clonePlatformRenderSelectionRecord(record) : null;
}

export function upsertPlatformRenderSelection(record: PlatformRenderSelectionRecord): void {
  initializePlatformRenderSelectionRegistry();
  const normalizedInstanceId = normalizeInstanceId(record.instanceId);
  if (!normalizedInstanceId) {
    throw new Error('Platform render selection requires a non-empty instanceId');
  }

  const nextRecord = {
    ...clonePlatformRenderSelectionRecord(record),
    instanceId: normalizedInstanceId,
  };
  const existing = platformRenderSelectionRegistry.get(normalizedInstanceId);
  if (arePlatformRenderSelectionRecordsEqual(existing, nextRecord)) {
    return;
  }

  platformRenderSelectionRegistry.set(normalizedInstanceId, nextRecord);
  savePlatformRenderSelections(snapshotPlatformRenderSelections());
  emitPlatformRenderSelectionsChanged();
}

export function setPlatformRenderSelectionMounted(
  instanceId: string,
  mounted: boolean
): void {
  initializePlatformRenderSelectionRegistry();
  const normalizedInstanceId = normalizeInstanceId(instanceId);
  if (!normalizedInstanceId) return;

  const existing = platformRenderSelectionRegistry.get(normalizedInstanceId);
  const currentOrder = existing?.order ?? snapshotPlatformRenderSelections().length;
  const nextRecord: PlatformRenderSelectionRecord = {
    instanceId: normalizedInstanceId,
    mounted,
    mountedAtMs: mounted ? Date.now() : undefined,
    order: currentOrder,
    metadata: existing?.metadata ? { ...existing.metadata } : undefined,
  };
  if (
    existing &&
    existing.mounted === nextRecord.mounted &&
    existing.order === nextRecord.order &&
    JSON.stringify(existing.metadata ?? null) === JSON.stringify(nextRecord.metadata ?? null)
  ) {
    return;
  }

  platformRenderSelectionRegistry.set(normalizedInstanceId, nextRecord);

  savePlatformRenderSelections(snapshotPlatformRenderSelections());
  emitPlatformRenderSelectionsChanged();
}

export function removePlatformRenderSelection(instanceId: string): boolean {
  initializePlatformRenderSelectionRegistry();
  const normalizedInstanceId = normalizeInstanceId(instanceId);
  if (!normalizedInstanceId) return false;
  const deleted = platformRenderSelectionRegistry.delete(normalizedInstanceId);
  if (deleted) {
    savePlatformRenderSelections(snapshotPlatformRenderSelections());
    emitPlatformRenderSelectionsChanged();
  }
  return deleted;
}

export function subscribePlatformRenderSelections(
  listener: PlatformRenderSelectionRegistryListener
): () => void {
  initializePlatformRenderSelectionRegistry();
  platformRenderSelectionRegistryListeners.add(listener);
  return () => {
    platformRenderSelectionRegistryListeners.delete(listener);
  };
}
