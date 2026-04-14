import type { PlatformRenderSelectionRecord } from '@pixel-matrix/plugin-platform-contracts';
import { listPlatformInstances, subscribePlatformInstances } from './instanceRegistry';

type PlatformRenderSelectionRegistryListener = (
  selections: PlatformRenderSelectionRecord[]
) => void;

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

function sortPlatformRenderSelections(
  left: PlatformRenderSelectionRecord,
  right: PlatformRenderSelectionRecord
): number {
  if ((left.order ?? Number.MAX_SAFE_INTEGER) !== (right.order ?? Number.MAX_SAFE_INTEGER)) {
    return (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER);
  }
  return left.instanceId.localeCompare(right.instanceId, 'zh-CN');
}

function emitPlatformRenderSelectionsChanged(): void {
  const snapshot = Array.from(platformRenderSelectionRegistry.values())
    .map(clonePlatformRenderSelectionRecord)
    .sort(sortPlatformRenderSelections);

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
        mounted: true,
        mountedAtMs: Date.now(),
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

  const changed = reconcilePlatformRenderSelections();
  if (changed) {
    emitPlatformRenderSelectionsChanged();
  }

  subscribePlatformInstances(() => {
    const nextChanged = reconcilePlatformRenderSelections();
    if (nextChanged) {
      emitPlatformRenderSelectionsChanged();
    }
  });
}

export function listPlatformRenderSelections(): PlatformRenderSelectionRecord[] {
  initializePlatformRenderSelectionRegistry();
  return Array.from(platformRenderSelectionRegistry.values())
    .map(clonePlatformRenderSelectionRecord)
    .sort(sortPlatformRenderSelections);
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

  platformRenderSelectionRegistry.set(normalizedInstanceId, {
    ...clonePlatformRenderSelectionRecord(record),
    instanceId: normalizedInstanceId,
  });
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
  const currentOrder = existing?.order ?? listPlatformRenderSelections().length;

  platformRenderSelectionRegistry.set(normalizedInstanceId, {
    instanceId: normalizedInstanceId,
    mounted,
    mountedAtMs: mounted ? Date.now() : undefined,
    order: currentOrder,
    metadata: existing?.metadata ? { ...existing.metadata } : undefined,
  });

  emitPlatformRenderSelectionsChanged();
}

export function removePlatformRenderSelection(instanceId: string): boolean {
  initializePlatformRenderSelectionRegistry();
  const normalizedInstanceId = normalizeInstanceId(instanceId);
  if (!normalizedInstanceId) return false;
  const deleted = platformRenderSelectionRegistry.delete(normalizedInstanceId);
  if (deleted) {
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
