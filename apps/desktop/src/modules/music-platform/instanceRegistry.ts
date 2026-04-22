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
import {
  listPlatformImportedInstanceRecords,
  subscribePlatformImportedInstanceRecords,
  type PlatformImportedInstanceRecord,
} from './platformImportedInstanceRegistry';
import {
  getInstalledPlatformPackRecord,
  subscribeInstalledPlatformPackRecords,
} from './installedPlatformPacks';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import {
  getMusicPlatformDurationMs,
  getMusicPlatformNowMs,
  readMusicPlatformDiagnosticErrorMessage,
  warnOnSlowMusicPlatformOperation,
} from './platformDiagnostics';

type PlatformInstanceRegistryListener = (instances: PlatformInstanceRecord[]) => void;

const platformInstanceRegistry = new Map<string, PlatformInstanceRecord>();
const platformInstanceRegistryListeners = new Set<PlatformInstanceRegistryListener>();
type PlatformInstanceAuthRefreshMode = 'snapshot' | 'refresh';

type PlatformInstanceAuthRefreshEntry = {
  mode: PlatformInstanceAuthRefreshMode;
  promise: Promise<PlatformInstanceRecord | null>;
};

const platformInstanceAuthRefreshRegistry = new Map<
  string,
  PlatformInstanceAuthRefreshEntry
>();
const platformInstanceAuthHydrationScheduled = new Set<string>();
const telemetry = getTelemetryLogger('music-platform', 'instanceRegistry');

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

function serializePlatformInstanceRecord(record: PlatformInstanceRecord): string {
  return JSON.stringify(clonePlatformInstanceRecord(record));
}

function arePlatformInstanceRecordsEqual(
  left: PlatformInstanceRecord | null | undefined,
  right: PlatformInstanceRecord | null | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return serializePlatformInstanceRecord(left) === serializePlatformInstanceRecord(right);
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

function createCompatRegistryRecordMap(): Map<string, PlatformCompatRegistryRecord> {
  return new Map(
    listPlatformCompatRegistryRecords().map((record) => [record.platformId, record] as const)
  );
}

function buildImportedPlatformInstanceRecord(
  importedRecord: PlatformImportedInstanceRecord,
  options: {
    installedRecord: NonNullable<ReturnType<typeof getInstalledPlatformPackRecord>>;
    compatRegistryRecord: PlatformCompatRegistryRecord | null;
    existingRecord?: PlatformInstanceRecord | null;
  }
): PlatformInstanceRecord {
  const displayName =
    importedRecord.displayName ||
    importedRecord.instanceLabel ||
    options.installedRecord.manifest.connector.displayName ||
    options.installedRecord.contract.platform.displayName ||
    importedRecord.platformId;
  const staticIcon =
    options.installedRecord.contract.platform.staticIcon ||
    options.existingRecord?.staticIcon ||
    '';

  return {
    instanceId: importedRecord.instanceId,
    platformId: importedRecord.platformId,
    instanceLabel: importedRecord.instanceLabel,
    displayName,
    staticIcon,
    account: options.existingRecord?.account
      ? { ...options.existingRecord.account }
      : {},
    auth: options.existingRecord?.auth
      ? { ...options.existingRecord.auth }
      : {
          status: 'empty',
        },
    capabilities: {
      ...(options.compatRegistryRecord?.contract.capabilities ??
        options.installedRecord.contract.capabilities),
    },
    registrations: options.existingRecord?.registrations
      ? {
          navigationIds: options.existingRecord.registrations.navigationIds.slice(),
          settingsIds: options.existingRecord.registrations.settingsIds.slice(),
          pageIds: options.existingRecord.registrations.pageIds.slice(),
        }
      : {
          navigationIds: [],
          settingsIds: [],
          pageIds: [],
        },
    availability: options.existingRecord?.availability ?? 'available',
    availabilityMessage: options.existingRecord?.availabilityMessage,
    metadata: {
      ...options.existingRecord?.metadata,
      autoManaged: false,
      imported: true,
      installationId: importedRecord.installationId,
      connectorId: importedRecord.connectorId,
      source: options.installedRecord.source,
      sourceType: options.installedRecord.sourceType,
      packId: options.installedRecord.packId,
      packVersion: options.installedRecord.packVersion,
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

    if (!arePlatformInstanceRecordsEqual(existing, nextRecord)) {
      platformInstanceRegistry.set(instanceId, nextRecord);
      changed = true;
    }
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

function reconcileImportedPlatformInstances(): boolean {
  const importedRecords = listPlatformImportedInstanceRecords();
  const compatRecordsByPlatformId = createCompatRegistryRecordMap();
  const importedInstanceIds = new Set<string>();
  let changed = false;

  for (const importedRecord of importedRecords) {
    importedInstanceIds.add(importedRecord.instanceId);
    const installedRecord = getInstalledPlatformPackRecord(importedRecord.installationId);
    if (!installedRecord) {
      const deleted = platformInstanceRegistry.delete(importedRecord.instanceId);
      if (deleted) {
        platformInstanceAuthHydrationScheduled.delete(importedRecord.instanceId);
        changed = true;
      }
      continue;
    }

    const compatRegistryRecord =
      compatRecordsByPlatformId.get(importedRecord.platformId) ?? null;
    const existingRecord = platformInstanceRegistry.get(importedRecord.instanceId) ?? null;
    const nextRecord = buildImportedPlatformInstanceRecord(importedRecord, {
      installedRecord,
      compatRegistryRecord,
      existingRecord,
    });
    if (!arePlatformInstanceRecordsEqual(existingRecord, nextRecord)) {
      platformInstanceRegistry.set(importedRecord.instanceId, nextRecord);
      changed = true;
    }
  }

  for (const [instanceId, record] of platformInstanceRegistry.entries()) {
    if (record.metadata?.imported !== true) continue;
    if (importedInstanceIds.has(instanceId)) continue;
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
    void refreshPlatformInstanceAuthState(
      normalizedInstanceId,
      runtimeOverride,
      'snapshot'
    ).finally(() => {
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

function scheduleImportedPlatformInstanceAuthRefreshes(): void {
  for (const instance of platformInstanceRegistry.values()) {
    if (instance.metadata?.imported !== true) continue;
    const runtime = getPlatformCompatRuntimeApi(instance.platformId);
    if (!runtime) continue;
    scheduleAutoManagedPlatformInstanceAuthRefresh(instance.instanceId, runtime);
  }
}

async function refreshPlatformInstanceAuthState(
  instanceId: string,
  runtimeOverride?: PlatformCompatRuntimeApi | null,
  mode: PlatformInstanceAuthRefreshMode = 'snapshot'
): Promise<PlatformInstanceRecord | null> {
  const normalizedInstanceId = normalizeInstanceId(instanceId);
  if (!normalizedInstanceId) return null;

  const existingRefresh = platformInstanceAuthRefreshRegistry.get(normalizedInstanceId);
  if (existingRefresh) {
    if (mode === 'refresh' && existingRefresh.mode === 'snapshot') {
      const waitStartedAtMs = getMusicPlatformNowMs();
      await existingRefresh.promise.catch(() => null);
      warnOnSlowMusicPlatformOperation({
        logger: telemetry,
        event: 'music-platform.instance-auth.refresh.waited-on-snapshot.slow',
        startedAtMs: waitStartedAtMs,
        fields: {
          instanceId: normalizedInstanceId,
          requestedMode: mode,
          pendingMode: existingRefresh.mode,
        },
      });
    } else {
      return await existingRefresh.promise;
    }
  }

  const refreshPromise = (async () => {
    const startedAtMs = getMusicPlatformNowMs();
    const currentRecord = platformInstanceRegistry.get(normalizedInstanceId);
    if (!currentRecord) return null;

    const runtime = runtimeOverride ?? getPlatformCompatRuntimeApi(currentRecord.platformId);
    const readerMethod =
      mode === 'refresh'
        ? typeof runtime?.auth?.refreshSnapshot === 'function'
          ? 'refreshSnapshot'
          : typeof runtime?.auth?.getSnapshot === 'function'
            ? 'getSnapshot'
            : 'none'
        : typeof runtime?.auth?.getSnapshot === 'function'
          ? 'getSnapshot'
          : typeof runtime?.auth?.refreshSnapshot === 'function'
            ? 'refreshSnapshot'
            : 'none';
    const readAuthSnapshot =
      readerMethod === 'refreshSnapshot'
        ? runtime?.auth?.refreshSnapshot
        : readerMethod === 'getSnapshot'
          ? runtime?.auth?.getSnapshot
          : undefined;
    const diagnosticFields = {
      instanceId: normalizedInstanceId,
      platformId: currentRecord.platformId,
      connectorId:
        typeof currentRecord.metadata?.connectorId === 'string'
          ? currentRecord.metadata.connectorId
          : null,
      mode,
      readerMethod,
      hasRuntimeOverride: Boolean(runtimeOverride),
    };
    if (!readAuthSnapshot) {
      return clonePlatformInstanceRecord(currentRecord);
    }

    let nextRecord: PlatformInstanceRecord;
    try {
      const result = await readAuthSnapshot({ instanceId: normalizedInstanceId });
      if (!result.ok && result.error.code === 'RUNTIME_RELOADING') {
        warnOnSlowMusicPlatformOperation({
          logger: telemetry,
          event: 'music-platform.instance-auth.read.slow',
          startedAtMs,
          fields: {
            ...diagnosticFields,
            outcome: 'runtime-reloading',
          },
        });
        return clonePlatformInstanceRecord(currentRecord);
      }
      if (!result.ok && result.error.code !== 'AUTH_REQUIRED') {
        telemetry.warn('music-platform.instance-auth.read.degraded', {
          message: result.error.message,
          fields: {
            ...diagnosticFields,
            durationMs: getMusicPlatformDurationMs(startedAtMs),
            errorCode: result.error.code,
          },
        });
      }
      nextRecord = result.ok
        ? applyPlatformAuthSuccessToRecord(currentRecord, result.data)
        : applyPlatformAuthErrorToRecord(currentRecord, result);
    } catch (error) {
      telemetry.warn('music-platform.instance-auth.read.failed', {
        message: readMusicPlatformDiagnosticErrorMessage(error),
        fields: {
          ...diagnosticFields,
          durationMs: getMusicPlatformDurationMs(startedAtMs),
        },
      });
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

    warnOnSlowMusicPlatformOperation({
      logger: telemetry,
      event: 'music-platform.instance-auth.read.slow',
      startedAtMs,
      fields: {
        ...diagnosticFields,
        authStatus: nextRecord.auth.status,
        availability: nextRecord.availability ?? null,
      },
    });
    platformInstanceRegistry.set(normalizedInstanceId, nextRecord);
    emitPlatformInstancesChanged();
    return clonePlatformInstanceRecord(nextRecord);
  })();

  const trackedRefreshPromise = refreshPromise.finally(() => {
    const pending = platformInstanceAuthRefreshRegistry.get(normalizedInstanceId);
    if (pending?.promise === trackedRefreshPromise) {
      platformInstanceAuthRefreshRegistry.delete(normalizedInstanceId);
    }
  });

  platformInstanceAuthRefreshRegistry.set(normalizedInstanceId, {
    mode,
    promise: trackedRefreshPromise,
  });
  return await trackedRefreshPromise;
}

function initializePlatformInstanceRegistry(): void {
  if (platformInstanceRegistryInitialized) return;
  platformInstanceRegistryInitialized = true;

  const changed =
    reconcileAutoManagedPlatformInstances() || reconcileImportedPlatformInstances();
  if (changed) {
    emitPlatformInstancesChanged();
  }
  scheduleAutoManagedPlatformInstanceAuthRefreshes();
  scheduleImportedPlatformInstanceAuthRefreshes();

  subscribePlatformCompatRegistry((records) => {
    void records;
    const nextChanged =
      reconcileAutoManagedPlatformInstances() || reconcileImportedPlatformInstances();
    if (nextChanged) {
      emitPlatformInstancesChanged();
    }
    scheduleAutoManagedPlatformInstanceAuthRefreshes();
    scheduleImportedPlatformInstanceAuthRefreshes();
  });

  void subscribePlatformImportedInstanceRecords(() => {
    const nextChanged = reconcileImportedPlatformInstances();
    if (nextChanged) {
      emitPlatformInstancesChanged();
    }
    scheduleImportedPlatformInstanceAuthRefreshes();
  }).catch(() => {
    // Keep the registry usable in the current window even if imported instance sync fails.
  });

  void subscribeInstalledPlatformPackRecords(() => {
    const nextChanged = reconcileImportedPlatformInstances();
    if (nextChanged) {
      emitPlatformInstancesChanged();
    }
  }).catch(() => {
    // Keep the registry usable in the current window even if install record sync fails.
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
  return refreshPlatformInstanceAuthState(
    normalizedInstanceId,
    registryRecord?.runtime ?? null,
    'refresh'
  );
}
