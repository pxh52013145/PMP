import type {
  PlatformApiResult,
  PlatformCompatAvailability,
  PlatformCompatRuntimeApi,
  PlatformCompatRuntimeAuthState,
  PlatformInstanceAuthState,
  PlatformInstanceRecord,
} from '@pixel-matrix/plugin-platform-contracts';
import {
  getPlatformCompatRegistryRecord,
  getPlatformCompatRuntimeApi,
  listPlatformCompatRegistryRecords,
  subscribePlatformCompatRegistry,
  type PlatformCompatRegistryRecord,
} from './contractRegistry';

type PlatformInstanceRegistryListener = (instances: PlatformInstanceRecord[]) => void;

const platformInstanceRegistry = new Map<string, PlatformInstanceRecord>();
const platformInstanceRegistryListeners = new Set<PlatformInstanceRegistryListener>();
const platformInstanceAuthRefreshRegistry = new Map<
  string,
  Promise<PlatformInstanceRecord | null>
>();
const platformInstanceAuthHydrationScheduled = new Set<string>();

let platformInstanceRegistryInitialized = false;

type IdleSchedulerWindow = Window & {
  requestIdleCallback?: (
    callback: (deadline: { didTimeout: boolean; timeRemaining(): number }) => void,
    options?: { timeout?: number }
  ) => number;
};

function normalizeInstanceId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRuntimeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function toBuiltinPlatformInstanceId(platformId: string): string {
  return `${platformId}:builtin`;
}

function clonePlatformInstanceRecord(record: PlatformInstanceRecord): PlatformInstanceRecord {
  return {
    instanceId: record.instanceId,
    platformId: record.platformId,
    instanceLabel: record.instanceLabel,
    displayName: record.displayName,
    staticIcon: record.staticIcon,
    account: { ...record.account },
    auth: { ...record.auth },
    capabilities: { ...record.capabilities },
    registrations: {
      navigationIds: record.registrations.navigationIds.slice(),
      settingsIds: record.registrations.settingsIds.slice(),
      pageIds: record.registrations.pageIds.slice(),
    },
    availability: record.availability,
    availabilityMessage: record.availabilityMessage,
    metadata: record.metadata ? { ...record.metadata } : undefined,
  };
}

function sortPlatformInstances(left: PlatformInstanceRecord, right: PlatformInstanceRecord): number {
  const displayNameCompare = left.displayName.localeCompare(right.displayName, 'zh-CN');
  if (displayNameCompare !== 0) {
    return displayNameCompare;
  }
  return left.instanceId.localeCompare(right.instanceId, 'zh-CN');
}

function emitPlatformInstancesChanged(): void {
  const snapshot = Array.from(platformInstanceRegistry.values())
    .map(clonePlatformInstanceRecord)
    .sort(sortPlatformInstances);

  for (const listener of platformInstanceRegistryListeners) {
    listener(snapshot);
  }
}

function schedulePlatformInstanceAuthHydration(task: () => void): void {
  if (typeof window === 'undefined') {
    task();
    return;
  }

  const run = () => {
    const idleWindow = window as IdleSchedulerWindow;
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleWindow.requestIdleCallback(() => task(), { timeout: 1500 });
      return;
    }

    window.setTimeout(task, 0);
  };

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run);
    });
    return;
  }

  run();
}

function mapRuntimeAuthStateToInstanceAuthState(
  authState: PlatformCompatRuntimeAuthState
): PlatformInstanceAuthState {
  if (authState === 'authorized') return 'authorized';
  if (authState === 'pending') return 'authorizing';
  if (authState === 'expired') return 'expired';
  if (authState === 'error') return 'error';
  return 'empty';
}

function buildDefaultPlatformInstanceRecord(
  registryRecord: PlatformCompatRegistryRecord
): PlatformInstanceRecord {
  const enabled = registryRecord.metadata?.enabled !== false;
  return {
    instanceId: toBuiltinPlatformInstanceId(registryRecord.platformId),
    platformId: registryRecord.platformId,
    instanceLabel: registryRecord.contract.platform.displayName,
    displayName: registryRecord.contract.platform.displayName,
    staticIcon: registryRecord.contract.platform.staticIcon,
    account: {},
    auth: {
      status: 'empty',
    },
    capabilities: { ...registryRecord.contract.capabilities },
    registrations: {
      navigationIds: [],
      settingsIds: [],
      pageIds: [],
    },
    availability: enabled ? 'available' : 'unavailable',
    availabilityMessage: enabled ? undefined : 'platform runtime is disabled',
    metadata: {
      autoManaged: true,
      source: registryRecord.source,
      connectorId:
        typeof registryRecord.metadata?.connectorId === 'string'
          ? registryRecord.metadata.connectorId
          : undefined,
    },
  };
}

function shouldAutoCreateDefaultInstance(record: PlatformCompatRegistryRecord): boolean {
  return record.metadata?.autoCreateDefaultInstance === true;
}

function applyPlatformAuthSuccessToRecord(
  currentRecord: PlatformInstanceRecord,
  data: {
    authState: PlatformCompatRuntimeAuthState;
    accountId?: string;
    accountName?: string;
    updatedAtMs?: number;
    expiresAtMs?: number;
    availability?: PlatformCompatAvailability;
    availabilityMessage?: string;
  }
): PlatformInstanceRecord {
  return {
    ...currentRecord,
    account: {
      accountId: data.accountId,
      accountName: data.accountName,
    },
    auth: {
      ...currentRecord.auth,
      status: mapRuntimeAuthStateToInstanceAuthState(data.authState),
      cookieUpdatedAtMs: data.updatedAtMs ?? currentRecord.auth.cookieUpdatedAtMs,
    },
    availability: data.availability ?? currentRecord.availability,
    availabilityMessage: data.availabilityMessage,
    metadata: {
      ...currentRecord.metadata,
      authExpiresAtMs: data.expiresAtMs,
    },
  };
}

function applyPlatformAuthErrorToRecord(
  currentRecord: PlatformInstanceRecord,
  result: Extract<PlatformApiResult<unknown>, { ok: false }>
): PlatformInstanceRecord {
  return {
    ...currentRecord,
    auth: {
      ...currentRecord.auth,
      status: result.error.code === 'AUTH_REQUIRED' ? 'empty' : 'error',
    },
    availability: 'unavailable',
    availabilityMessage: result.error.message,
  };
}

function reconcileAutoManagedPlatformInstances(): boolean {
  const registryRecords = listPlatformCompatRegistryRecords();
  const autoManagedPlatformIds = new Set<string>();
  let changed = false;

  for (const registryRecord of registryRecords) {
    if (!shouldAutoCreateDefaultInstance(registryRecord)) continue;
    autoManagedPlatformIds.add(registryRecord.platformId);

    const instanceId = toBuiltinPlatformInstanceId(registryRecord.platformId);
    const existing = platformInstanceRegistry.get(instanceId);
    if (!existing) {
      platformInstanceRegistry.set(instanceId, buildDefaultPlatformInstanceRecord(registryRecord));
      changed = true;
      continue;
    }

    const nextRecord: PlatformInstanceRecord = {
      ...existing,
      platformId: registryRecord.platformId,
      instanceLabel: existing.instanceLabel || registryRecord.contract.platform.displayName,
      displayName: registryRecord.contract.platform.displayName,
      staticIcon: registryRecord.contract.platform.staticIcon,
      capabilities: { ...registryRecord.contract.capabilities },
      metadata: {
        ...existing.metadata,
        autoManaged: true,
        source: registryRecord.source,
        connectorId:
          typeof registryRecord.metadata?.connectorId === 'string'
            ? registryRecord.metadata.connectorId
            : existing.metadata?.connectorId,
      },
    };

    platformInstanceRegistry.set(instanceId, nextRecord);
    changed = true;
  }

  for (const [instanceId, record] of platformInstanceRegistry.entries()) {
    if (record.metadata?.autoManaged !== true) continue;
    if (autoManagedPlatformIds.has(record.platformId)) continue;
    platformInstanceRegistry.delete(instanceId);
    platformInstanceAuthHydrationScheduled.delete(instanceId);
    changed = true;
  }

  return changed;
}

function scheduleAutoManagedPlatformInstanceAuthRefresh(
  instanceId: string,
  runtimeOverride?: PlatformCompatRuntimeApi | null
): void {
  const normalizedInstanceId = normalizeInstanceId(instanceId);
  if (!normalizedInstanceId) return;
  if (platformInstanceAuthHydrationScheduled.has(normalizedInstanceId)) return;
  if (platformInstanceAuthRefreshRegistry.has(normalizedInstanceId)) return;

  platformInstanceAuthHydrationScheduled.add(normalizedInstanceId);
  schedulePlatformInstanceAuthHydration(() => {
    void refreshPlatformInstanceAuthState(normalizedInstanceId, runtimeOverride).finally(() => {
      platformInstanceAuthHydrationScheduled.delete(normalizedInstanceId);
    });
  });
}

function scheduleAutoManagedPlatformInstanceAuthRefreshes(): void {
  for (const record of listPlatformCompatRegistryRecords()) {
    if (!shouldAutoCreateDefaultInstance(record)) continue;
    scheduleAutoManagedPlatformInstanceAuthRefresh(
      toBuiltinPlatformInstanceId(record.platformId),
      record.runtime
    );
  }
}

async function refreshPlatformInstanceAuthState(
  instanceId: string,
  runtimeOverride?: PlatformCompatRuntimeApi | null
): Promise<PlatformInstanceRecord | null> {
  const normalizedInstanceId = normalizeInstanceId(instanceId);
  if (!normalizedInstanceId) return null;

  const existingRefresh = platformInstanceAuthRefreshRegistry.get(normalizedInstanceId);
  if (existingRefresh) {
    return await existingRefresh;
  }

  const refreshPromise = (async () => {
    const currentRecord = platformInstanceRegistry.get(normalizedInstanceId);
    if (!currentRecord) return null;

    const runtime = runtimeOverride ?? getPlatformCompatRuntimeApi(currentRecord.platformId);
    const readAuthSnapshot = runtime?.auth?.refreshSnapshot ?? runtime?.auth?.getSnapshot;
    if (!readAuthSnapshot) {
      return clonePlatformInstanceRecord(currentRecord);
    }

    let nextRecord: PlatformInstanceRecord;
    try {
      const result = await readAuthSnapshot({ instanceId: normalizedInstanceId });
      if (!result.ok && result.error.code === 'RUNTIME_RELOADING') {
        return clonePlatformInstanceRecord(currentRecord);
      }
      nextRecord = result.ok
        ? applyPlatformAuthSuccessToRecord(currentRecord, result.data)
        : applyPlatformAuthErrorToRecord(currentRecord, result);
    } catch (error) {
      nextRecord = {
        ...currentRecord,
        auth: {
          ...currentRecord.auth,
          status: 'error',
        },
        availability: 'unavailable',
        availabilityMessage: readRuntimeErrorMessage(error),
      };
    }

    platformInstanceRegistry.set(normalizedInstanceId, nextRecord);
    emitPlatformInstancesChanged();
    return clonePlatformInstanceRecord(nextRecord);
  })();

  const trackedRefreshPromise = refreshPromise.finally(() => {
    const pending = platformInstanceAuthRefreshRegistry.get(normalizedInstanceId);
    if (pending === trackedRefreshPromise) {
      platformInstanceAuthRefreshRegistry.delete(normalizedInstanceId);
    }
  });

  platformInstanceAuthRefreshRegistry.set(normalizedInstanceId, trackedRefreshPromise);
  return await trackedRefreshPromise;
}

function initializePlatformInstanceRegistry(): void {
  if (platformInstanceRegistryInitialized) return;
  platformInstanceRegistryInitialized = true;

  const changed = reconcileAutoManagedPlatformInstances();
  if (changed) {
    emitPlatformInstancesChanged();
  }
  scheduleAutoManagedPlatformInstanceAuthRefreshes();

  subscribePlatformCompatRegistry((records) => {
    void records;
    const nextChanged = reconcileAutoManagedPlatformInstances();
    if (nextChanged) {
      emitPlatformInstancesChanged();
    }
    scheduleAutoManagedPlatformInstanceAuthRefreshes();
  });
}

export function listPlatformInstances(): PlatformInstanceRecord[] {
  initializePlatformInstanceRegistry();
  return Array.from(platformInstanceRegistry.values())
    .map(clonePlatformInstanceRecord)
    .sort(sortPlatformInstances);
}

export function getPlatformInstance(instanceId: string): PlatformInstanceRecord | null {
  initializePlatformInstanceRegistry();
  const normalizedInstanceId = normalizeInstanceId(instanceId);
  if (!normalizedInstanceId) return null;
  const record = platformInstanceRegistry.get(normalizedInstanceId);
  return record ? clonePlatformInstanceRecord(record) : null;
}

export function upsertPlatformInstance(record: PlatformInstanceRecord): void {
  initializePlatformInstanceRegistry();
  const normalizedInstanceId = normalizeInstanceId(record.instanceId);
  if (!normalizedInstanceId) {
    throw new Error('Platform instance record requires a non-empty instanceId');
  }

  platformInstanceRegistry.set(normalizedInstanceId, clonePlatformInstanceRecord(record));
  emitPlatformInstancesChanged();
}

export function removePlatformInstance(instanceId: string): boolean {
  initializePlatformInstanceRegistry();
  const normalizedInstanceId = normalizeInstanceId(instanceId);
  if (!normalizedInstanceId) return false;
  const deleted = platformInstanceRegistry.delete(normalizedInstanceId);
  if (deleted) {
    emitPlatformInstancesChanged();
  }
  return deleted;
}

export function subscribePlatformInstances(
  listener: PlatformInstanceRegistryListener
): () => void {
  initializePlatformInstanceRegistry();
  platformInstanceRegistryListeners.add(listener);
  return () => {
    platformInstanceRegistryListeners.delete(listener);
  };
}

export async function refreshPlatformInstance(instanceId: string): Promise<PlatformInstanceRecord | null> {
  initializePlatformInstanceRegistry();
  const normalizedInstanceId = normalizeInstanceId(instanceId);
  if (!normalizedInstanceId) return null;
  const record = platformInstanceRegistry.get(normalizedInstanceId);
  if (!record) return null;

  const registryRecord = getPlatformCompatRegistryRecord(record.platformId);
  return refreshPlatformInstanceAuthState(normalizedInstanceId, registryRecord?.runtime ?? null);
}
