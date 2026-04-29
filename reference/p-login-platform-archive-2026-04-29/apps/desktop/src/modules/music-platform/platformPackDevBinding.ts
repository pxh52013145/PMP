import type { PlatformInstanceRecord } from '@pixel-matrix/plugin-platform-contracts';

import { readJson, tryWriteJson } from '../storage';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  broadcastSignal,
  setupTauriListenerWithPayload,
} from '../../utils/windowCommunication';
import {
  getPlatformInstance,
  listPlatformInstances,
  removePlatformInstance,
  upsertPlatformInstance,
} from './instanceRegistry';
import {
  listPlatformConnectorDefinitions,
  type PlatformConnectorId,
} from './connectorAuth';
import {
  persistPlatformLoginRegistry,
  readPlatformLoginRegistry,
  removePlatformLoginRegistryEntry,
  upsertPlatformLoginRegistryEntry,
} from './platformLoginRegistry';
import {
  removePlatformRenderSelection,
  setPlatformRenderSelectionMounted,
} from './renderSelectionRegistry';
import {
  registerPlatformPackDevSource,
  removePlatformPackDevRegistration,
} from './platformPackRegistry';
import {
  readPlatformPackDevSourceFromPath,
  type PlatformPackDevSource,
} from './platformPackDevSource';
import { setActiveMusicPlatformInstance } from './activeInstanceRegistry';

export type PlatformPackDevInstanceBindingStatus = 'ready' | 'error';
export type PlatformPackDevInstanceReloadStatus = 'success' | 'error';

export interface PlatformPackDevInstanceReloadHistoryEntry {
  status: PlatformPackDevInstanceReloadStatus;
  revision: number;
  at: number;
  message: string | null;
}

export interface PlatformPackDevInstanceBindingRecord {
  instanceId: string;
  installationId: string;
  connectorId: PlatformConnectorId;
  platformId: string;
  packId: string;
  packVersion: string;
  displayName: string;
  rootDir: string;
  manifestPath: string;
  contractPath: string | null;
  runtimePath: string | null;
  iconPath: string | null;
  sidecarPath: string | null;
  revision: number;
  updatedAt: number;
  status: PlatformPackDevInstanceBindingStatus;
  lastError: string | null;
  reloadHistory: PlatformPackDevInstanceReloadHistoryEntry[];
}

export interface PlatformPackDevInstanceBindResult {
  record: PlatformPackDevInstanceBindingRecord;
  source: PlatformPackDevSource;
}

type PlatformPackDevBindingListener = () => void;

let revision = 0;
let syncDisposer: (() => void) | null = null;
const listeners = new Set<PlatformPackDevBindingListener>();

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function normalizePlatformId(value: unknown): string {
  return normalizeString(value).toLowerCase();
}

function normalizeConnectorId(value: unknown): PlatformConnectorId | null {
  const normalized = normalizeString(value).toLowerCase();
  return normalized.startsWith('connector.platform.')
    ? (normalized as PlatformConnectorId)
    : null;
}

function normalizePositiveRevision(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : 1;
}

function normalizeTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : Date.now();
}

function sanitizeReloadHistoryEntry(
  value: unknown
): PlatformPackDevInstanceReloadHistoryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const item = value as Record<string, unknown>;
  const status = item.status === 'error' ? 'error' : item.status === 'success' ? 'success' : null;
  const revisionValue =
    typeof item.revision === 'number' && Number.isFinite(item.revision)
      ? Math.max(1, Math.floor(item.revision))
      : 0;
  const at = normalizeTimestamp(item.at);
  if (!status || revisionValue < 1) {
    return null;
  }
  return {
    status,
    revision: revisionValue,
    at,
    message: normalizeString(item.message) || null,
  };
}

function normalizeReloadHistory(
  value: unknown
): PlatformPackDevInstanceReloadHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeReloadHistoryEntry(item))
    .filter((item): item is PlatformPackDevInstanceReloadHistoryEntry => Boolean(item))
    .sort((left, right) => right.at - left.at)
    .slice(0, 8);
}

function appendReloadHistory(
  current: PlatformPackDevInstanceReloadHistoryEntry[],
  entry?: PlatformPackDevInstanceReloadHistoryEntry | null
): PlatformPackDevInstanceReloadHistoryEntry[] {
  if (!entry) {
    return current.map((item) => ({ ...item }));
  }
  return [{ ...entry }, ...current.map((item) => ({ ...item }))].slice(0, 8);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function normalizeIdSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'pack'
  );
}

function createStableDevIds(source: PlatformPackDevSource): {
  instanceId: string;
  installationId: string;
} {
  const platformId =
    normalizePlatformId(source.contract?.platform.platformId) ||
    normalizeIdSegment(source.manifest?.metadata.id ?? 'platform');
  const packId = normalizeIdSegment(source.manifest?.metadata.id ?? platformId);
  const rootHash = hashString(normalizeFsPath(source.rootDir));
  return {
    instanceId: `${platformId}:dev-${rootHash}`,
    installationId: `dev-${packId}-${rootHash}`,
  };
}

function buildSourceLabel(input: {
  packId: string;
  connectorId: string;
  rootDir: string;
  revision: number;
}): string {
  return [
    'platform-pack-dev',
    normalizeIdSegment(input.packId),
    input.connectorId,
    hashString(normalizeFsPath(input.rootDir)),
    `r${input.revision}`,
  ].join(':');
}

function readDisplayName(source: PlatformPackDevSource): string {
  return (
    normalizeString(source.manifest?.connector.displayName) ||
    normalizeString(source.contract?.platform.displayName) ||
    normalizeString(source.manifest?.metadata.name) ||
    normalizeString(source.manifest?.metadata.id) ||
    source.rootDir
  );
}

function readPlatformId(source: PlatformPackDevSource): string {
  return (
    normalizePlatformId(source.contract?.platform.platformId) ||
    normalizeIdSegment(source.manifest?.metadata.id ?? 'platform')
  );
}

function createDevInstanceRecord(
  source: PlatformPackDevSource,
  record: PlatformPackDevInstanceBindingRecord
): PlatformInstanceRecord {
  const existing = getPlatformInstance(record.instanceId);
  const contract = source.contract;
  const authStatus =
    existing?.auth.status && existing.auth.status !== 'empty'
      ? existing.auth.status
      : contract?.auth.loginMode === 'none'
        ? 'authorized'
        : 'empty';

  return {
    instanceId: record.instanceId,
    platformId: record.platformId,
    instanceLabel: record.displayName,
    displayName: record.displayName,
    staticIcon:
      normalizeString(contract?.platform.staticIcon) ||
      existing?.staticIcon ||
      normalizeIdSegment(record.platformId),
    account: existing?.account ? { ...existing.account } : {},
    auth: {
      ...(existing?.auth ?? {}),
      status: authStatus,
    },
    capabilities: {
      playlists: contract?.capabilities.playlists === true,
      favorites: contract?.capabilities.favorites === true,
      dailyRecommendations: contract?.capabilities.dailyRecommendations === true,
      search: contract?.capabilities.search === true,
      quality: contract?.capabilities.quality === true,
      navigation: contract?.capabilities.navigation === true,
      settings: contract?.capabilities.settings === true,
      pages: contract?.capabilities.pages === true,
    },
    registrations: existing?.registrations
      ? {
          navigationIds: existing.registrations.navigationIds.slice(),
          settingsIds: existing.registrations.settingsIds.slice(),
          pageIds: existing.registrations.pageIds.slice(),
        }
      : {
          navigationIds: [],
          settingsIds: [],
          pageIds: [],
        },
    availability: 'available',
    availabilityMessage: undefined,
    metadata: {
      ...(existing?.metadata ?? {}),
      autoManaged: false,
      devPlatformPack: true,
      source: 'platform-pack-dev',
      sourceType: 'dev',
      connectorId: record.connectorId,
      installationId: record.installationId,
      packId: record.packId,
      packVersion: record.packVersion,
      projectRoot: record.rootDir,
      manifestPath: record.manifestPath,
      runtimePath: record.runtimePath,
      revision: record.revision,
      updatedAt: record.updatedAt,
    },
  };
}

function sanitizeRecord(value: unknown): PlatformPackDevInstanceBindingRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const item = value as Record<string, unknown>;
  const instanceId = normalizeString(item.instanceId);
  const installationId = normalizeString(item.installationId);
  const connectorId = normalizeConnectorId(item.connectorId);
  const platformId = normalizePlatformId(item.platformId);
  const packId = normalizeString(item.packId);
  const packVersion = normalizeString(item.packVersion);
  const displayName = normalizeString(item.displayName);
  const rootDir = normalizeFsPath(normalizeString(item.rootDir));
  const manifestPath = normalizeFsPath(normalizeString(item.manifestPath));

  if (
    !instanceId ||
    !installationId ||
    !connectorId ||
    !platformId ||
    !packId ||
    !packVersion ||
    !displayName ||
    !rootDir ||
    !manifestPath
  ) {
    return null;
  }

  return {
    instanceId,
    installationId,
    connectorId,
    platformId,
    packId,
    packVersion,
    displayName,
    rootDir,
    manifestPath,
    contractPath: normalizeFsPath(normalizeString(item.contractPath)) || null,
    runtimePath: normalizeFsPath(normalizeString(item.runtimePath)) || null,
    iconPath: normalizeFsPath(normalizeString(item.iconPath)) || null,
    sidecarPath: normalizeFsPath(normalizeString(item.sidecarPath)) || null,
    revision: normalizePositiveRevision(item.revision),
    updatedAt: normalizeTimestamp(item.updatedAt),
    status: item.status === 'error' ? 'error' : 'ready',
    lastError: normalizeString(item.lastError) || null,
    reloadHistory: normalizeReloadHistory(item.reloadHistory),
  };
}

function cloneRecord(
  record: PlatformPackDevInstanceBindingRecord
): PlatformPackDevInstanceBindingRecord {
  return {
    ...record,
    reloadHistory: record.reloadHistory.map((entry) => ({ ...entry })),
  };
}

function notifyListeners(): void {
  revision += 1;
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

function ensureSync(): void {
  if (typeof window === 'undefined' || syncDisposer) return;

  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return;
    if (event.key !== STORAGE_KEYS.PLATFORM_PACK_DEV_BINDINGS_V1) return;
    notifyListeners();
  };

  window.addEventListener('storage', onStorage);

  let disposed = false;
  let unlistenTauri: (() => void) | null = null;
  void setupTauriListenerWithPayload<{ key?: string }>(
    TAURI_EVENTS.PLATFORM_PACK_DEV_BINDINGS_UPDATED,
    (payload) => {
      if (payload?.key && payload.key !== STORAGE_KEYS.PLATFORM_PACK_DEV_BINDINGS_V1) {
        return;
      }
      notifyListeners();
    }
  )
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenTauri = unlisten;
    })
    .catch(() => {
      // Keep local-window subscriptions usable even when Tauri events are unavailable.
    });

  syncDisposer = () => {
    disposed = true;
    window.removeEventListener('storage', onStorage);
    try {
      unlistenTauri?.();
    } catch {
      // ignore best-effort listener cleanup
    }
    syncDisposer = null;
  };
}

function saveRecords(records: PlatformPackDevInstanceBindingRecord[]): void {
  if (typeof window === 'undefined') return;
  const sorted = records
    .slice()
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(cloneRecord);
  if (!tryWriteJson(STORAGE_KEYS.PLATFORM_PACK_DEV_BINDINGS_V1, sorted)) {
    throw new Error('Failed to persist platform pack development bindings');
  }
  notifyListeners();
  void broadcastSignal(TAURI_EVENTS.PLATFORM_PACK_DEV_BINDINGS_UPDATED);
}

function upsertRecord(record: PlatformPackDevInstanceBindingRecord): void {
  const records = listPlatformPackDevInstanceBindings().filter(
    (item) =>
      item.instanceId !== record.instanceId &&
      item.installationId !== record.installationId &&
      item.connectorId !== record.connectorId
  );
  records.push(cloneRecord(record));
  saveRecords(records);
}

function setRecordError(
  record: PlatformPackDevInstanceBindingRecord,
  error: unknown,
  options: {
    reloadRevision?: number;
  } = {}
): PlatformPackDevInstanceBindingRecord {
  const message = readErrorMessage(error).slice(0, 2000);
  const nextRecord: PlatformPackDevInstanceBindingRecord = {
    ...record,
    status: 'error',
    lastError: message,
    updatedAt: Date.now(),
    reloadHistory:
      typeof options.reloadRevision === 'number' && Number.isFinite(options.reloadRevision)
        ? appendReloadHistory(record.reloadHistory, {
            status: 'error',
            revision: Math.max(1, Math.floor(options.reloadRevision)),
            at: Date.now(),
            message,
          })
        : record.reloadHistory.map((entry) => ({ ...entry })),
  };
  upsertRecord(nextRecord);
  return nextRecord;
}

async function syncLoginRegistryEntry(
  record: PlatformPackDevInstanceBindingRecord,
  enabled: boolean
): Promise<void> {
  const definitions = listPlatformConnectorDefinitions();
  const instances = listPlatformInstances();
  const current = readPlatformLoginRegistry(definitions, record.connectorId, instances);
  const next = enabled
    ? upsertPlatformLoginRegistryEntry(
        current,
        {
          instanceId: record.instanceId,
          connectorId: record.connectorId,
        },
        true
      )
    : removePlatformLoginRegistryEntry(current, record.instanceId);
  await persistPlatformLoginRegistry(next);
}

function assertReadySource(source: PlatformPackDevSource): void {
  if (source.status === 'ready') return;
  const diagnostic =
    source.diagnostics.find((item) => item.severity === 'error') ??
    source.diagnostics[0] ??
    null;
  throw new Error(diagnostic?.message ?? 'Platform pack dev source is not ready');
}

export function getPlatformPackDevInstanceBindingsRevision(): number {
  return revision;
}

export function subscribePlatformPackDevInstanceBindings(
  listener: PlatformPackDevBindingListener
): () => void {
  listeners.add(listener);
  ensureSync();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      syncDisposer?.();
    }
  };
}

export function listPlatformPackDevInstanceBindings(): PlatformPackDevInstanceBindingRecord[] {
  if (typeof window === 'undefined') return [];
  const raw = readJson<unknown>(STORAGE_KEYS.PLATFORM_PACK_DEV_BINDINGS_V1, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => sanitizeRecord(item))
    .filter((item): item is PlatformPackDevInstanceBindingRecord => Boolean(item))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(cloneRecord);
}

export function getPlatformPackDevInstanceBinding(
  instanceId: string
): PlatformPackDevInstanceBindingRecord | null {
  const normalizedInstanceId = normalizeString(instanceId);
  if (!normalizedInstanceId) return null;
  return (
    listPlatformPackDevInstanceBindings().find(
      (record) => record.instanceId === normalizedInstanceId
    ) ?? null
  );
}

export function resolvePlatformPackDevInstanceBindingForSource(
  source: PlatformPackDevSource
): PlatformPackDevInstanceBindingRecord | null {
  const connectorId = normalizeConnectorId(source.manifest?.connector.connectorId);
  if (!connectorId) return null;
  return (
    listPlatformPackDevInstanceBindings().find(
      (record) => record.connectorId === connectorId
    ) ?? null
  );
}

export async function bindPlatformPackDevInstance(
  source: PlatformPackDevSource,
  options: {
    revision?: number;
    activate?: boolean;
    reloadHistoryEntry?: PlatformPackDevInstanceReloadHistoryEntry | null;
  } = {}
): Promise<PlatformPackDevInstanceBindResult> {
  assertReadySource(source);
  if (!source.manifest || !source.contract) {
    throw new Error('Platform pack dev source requires a valid manifest and contract');
  }

  const connectorId = normalizeConnectorId(source.manifest.connector.connectorId);
  if (!connectorId) {
    throw new Error('Platform pack dev source requires a valid connector id');
  }

  const existing = resolvePlatformPackDevInstanceBindingForSource(source);
  const stableIds = existing ?? createStableDevIds(source);
  const now = Date.now();
  const revisionValue =
    typeof options.revision === 'number' && Number.isFinite(options.revision)
      ? Math.max(1, Math.floor(options.revision))
      : (existing?.revision ?? 0) + 1;
  const packId = source.manifest.metadata.id;
  const record: PlatformPackDevInstanceBindingRecord = {
    instanceId: stableIds.instanceId,
    installationId: stableIds.installationId,
    connectorId,
    platformId: readPlatformId(source),
    packId,
    packVersion: source.manifest.metadata.version,
    displayName: readDisplayName(source),
    rootDir: normalizeFsPath(source.rootDir),
    manifestPath: normalizeFsPath(source.manifestPath),
    contractPath: source.contractPath ? normalizeFsPath(source.contractPath) : null,
    runtimePath: source.runtimePath ? normalizeFsPath(source.runtimePath) : null,
    iconPath: source.iconPath ? normalizeFsPath(source.iconPath) : null,
    sidecarPath: source.sidecarPath ? normalizeFsPath(source.sidecarPath) : null,
    revision: revisionValue,
    updatedAt: now,
    status: 'ready',
    lastError: null,
    reloadHistory: appendReloadHistory(
      existing?.reloadHistory ?? [],
      options.reloadHistoryEntry ?? null
    ),
  };

  for (const previous of listPlatformPackDevInstanceBindings()) {
    if (
      previous.connectorId === connectorId &&
      previous.installationId !== record.installationId
    ) {
      removePlatformPackDevRegistration(previous.installationId);
      removePlatformInstance(previous.instanceId);
      removePlatformRenderSelection(previous.instanceId);
    }
  }

  await registerPlatformPackDevSource(source, {
    installationId: record.installationId,
    source: buildSourceLabel({
      packId: record.packId,
      connectorId: record.connectorId,
      rootDir: record.rootDir,
      revision: record.revision,
    }),
    installedAtMs: now,
  });
  upsertPlatformInstance(createDevInstanceRecord(source, record));
  await syncLoginRegistryEntry(record, true);
  setPlatformRenderSelectionMounted(record.instanceId, true);
  if (options.activate !== false) {
    void setActiveMusicPlatformInstance({
      instanceId: record.instanceId,
      connectorId: record.connectorId,
    });
  }
  upsertRecord(record);

  return {
    record: cloneRecord(record),
    source,
  };
}

export async function reloadPlatformPackDevInstanceBinding(
  record: PlatformPackDevInstanceBindingRecord
): Promise<PlatformPackDevInstanceBindResult> {
  const nextRevision = record.revision + 1;
  try {
    const source = await readPlatformPackDevSourceFromPath(record.rootDir);
    return await bindPlatformPackDevInstance(source, {
      revision: nextRevision,
      activate: true,
      reloadHistoryEntry: {
        status: 'success',
        revision: nextRevision,
        at: Date.now(),
        message: null,
      },
    });
  } catch (error) {
    setRecordError(record, error, { reloadRevision: nextRevision });
    throw error;
  }
}

export async function detachPlatformPackDevInstanceBinding(
  instanceId: string
): Promise<boolean> {
  const record = getPlatformPackDevInstanceBinding(instanceId);
  if (!record) return false;

  removePlatformPackDevRegistration(record.installationId);
  removePlatformInstance(record.instanceId);
  removePlatformRenderSelection(record.instanceId);
  await syncLoginRegistryEntry(record, false);
  saveRecords(
    listPlatformPackDevInstanceBindings().filter(
      (item) => item.instanceId !== record.instanceId
    )
  );
  return true;
}
