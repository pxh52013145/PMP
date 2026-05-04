import { readJson } from '../storage';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  broadcastDataUpdate,
  setupDualListener,
} from '../../utils/windowCommunication';
import { setActiveMusicPlatformInstance } from './activeInstanceRegistry';
import {
  removePlatformRenderSelection,
  setPlatformRenderSelectionMounted,
} from './renderSelectionRegistry';
import {
  readPlatformPackDevSourceFromPath,
  type PlatformPackDevSource,
} from './platformPackDevSource';
import type { PlatformConnectorId } from './connectorAuth';

export type PlatformPackDevInstanceBindingStatus = 'bound' | 'error';
export type PlatformPackDevInstanceReloadStatus = 'success' | 'error';

export interface PlatformPackDevInstanceReloadHistoryEntry {
  at: number;
  revision: number;
  status: PlatformPackDevInstanceReloadStatus;
  message?: string | null;
}

export interface PlatformPackDevInstanceBindingRecord {
  instanceId: string;
  connectorId: PlatformConnectorId;
  installationId: string;
  rootDir: string;
  displayName: string;
  packId: string;
  packVersion?: string;
  platformId?: string;
  manifestPath?: string;
  contractPath: string | null;
  runtimePath: string | null;
  iconPath: string | null;
  sidecarPath: string | null;
  status: PlatformPackDevInstanceBindingStatus;
  revision: number;
  updatedAt: number;
  reloadHistory: PlatformPackDevInstanceReloadHistoryEntry[];
  lastError: string | null;
}

export interface PlatformPackDevInstanceBindResult {
  record: PlatformPackDevInstanceBindingRecord;
  source: PlatformPackDevSource;
}

type PlatformPackDevBindingListener = () => void;

const listeners = new Set<PlatformPackDevBindingListener>();
let revision = 0;
let syncDisposer: (() => void) | null = null;

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
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

function normalizeConnectorId(value: unknown): PlatformConnectorId | null {
  const normalized = normalizeString(value).toLowerCase();
  return normalized.startsWith('connector.platform.')
    ? (normalized as PlatformConnectorId)
    : null;
}

function createStableDevIds(source: PlatformPackDevSource): {
  instanceId: string;
  installationId: string;
} {
  const platformId = normalizeIdSegment(
    source.contract?.platform.platformId ??
      source.manifest?.connector.workspaceKind ??
      source.manifest?.metadata.id ??
      'platform'
  );
  const packId = normalizeIdSegment(source.manifest?.metadata.id ?? platformId);
  const rootHash = hashString(normalizeFsPath(source.rootDir));
  return {
    instanceId: `${platformId}:dev-${rootHash}`,
    installationId: `dev-${packId}-${rootHash}`,
  };
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
    normalizeString(source.contract?.platform.platformId) ||
    normalizeIdSegment(source.manifest?.connector.workspaceKind ?? 'platform')
  );
}

function sanitizeReloadHistoryEntry(
  value: unknown
): PlatformPackDevInstanceReloadHistoryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const item = value as Record<string, unknown>;
  const status = item.status === 'success' || item.status === 'error' ? item.status : null;
  const revisionValue = normalizePositiveRevision(item.revision);
  if (!status) return null;
  return {
    status,
    revision: revisionValue,
    at: normalizeTimestamp(item.at),
    message: normalizeString(item.message) || null,
  };
}

function normalizeReloadHistory(value: unknown): PlatformPackDevInstanceReloadHistoryEntry[] {
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
  if (!entry) return current.map((item) => ({ ...item }));
  return [{ ...entry }, ...current.map((item) => ({ ...item }))].slice(0, 8);
}

function sanitizeRecord(value: unknown): PlatformPackDevInstanceBindingRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const item = value as Record<string, unknown>;
  const instanceId = normalizeString(item.instanceId);
  const connectorId = normalizeConnectorId(item.connectorId);
  const installationId = normalizeString(item.installationId);
  const rootDir = normalizeString(item.rootDir);
  const packId = normalizeString(item.packId);
  if (!instanceId || !connectorId || !installationId || !rootDir || !packId) {
    return null;
  }

  return {
    instanceId,
    connectorId,
    installationId,
    rootDir,
    displayName: normalizeString(item.displayName) || packId,
    packId,
    packVersion: normalizeString(item.packVersion) || undefined,
    platformId: normalizeString(item.platformId) || undefined,
    manifestPath: normalizeString(item.manifestPath) || undefined,
    contractPath: normalizeString(item.contractPath) || null,
    runtimePath: normalizeString(item.runtimePath) || null,
    iconPath: normalizeString(item.iconPath) || null,
    sidecarPath: normalizeString(item.sidecarPath) || null,
    status: item.status === 'error' ? 'error' : 'bound',
    revision: normalizePositiveRevision(item.revision),
    updatedAt: normalizeTimestamp(item.updatedAt),
    reloadHistory: normalizeReloadHistory(item.reloadHistory),
    lastError: normalizeString(item.lastError) || null,
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

function emitRevision(): void {
  revision += 1;
  listeners.forEach((listener) => listener());
}

async function ensureSync(): Promise<void> {
  if (syncDisposer || typeof window === 'undefined') return;
  syncDisposer = await setupDualListener(
    [STORAGE_KEYS.PLATFORM_PACK_DEV_BINDINGS_V1],
    [TAURI_EVENTS.PLATFORM_PACK_DEV_BINDINGS_UPDATED],
    emitRevision
  );
}

function saveRecords(records: PlatformPackDevInstanceBindingRecord[]): void {
  const next = records
    .map((record) => cloneRecord(record))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  void broadcastDataUpdate(
    STORAGE_KEYS.PLATFORM_PACK_DEV_BINDINGS_V1,
    next,
    TAURI_EVENTS.PLATFORM_PACK_DEV_BINDINGS_UPDATED
  );
  emitRevision();
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

function assertReadySource(source: PlatformPackDevSource): void {
  if (source.status === 'ready') return;
  const diagnostic =
    source.diagnostics.find((item) => item.severity === 'error') ??
    source.diagnostics[0] ??
    null;
  throw new Error(diagnostic?.message ?? 'Platform pack dev source is not ready');
}

function buildRecordFromSource(
  source: PlatformPackDevSource,
  options: {
    existing?: PlatformPackDevInstanceBindingRecord | null;
    revision?: number;
    reloadHistoryEntry?: PlatformPackDevInstanceReloadHistoryEntry | null;
  } = {}
): PlatformPackDevInstanceBindingRecord {
  assertReadySource(source);
  if (!source.manifest || !source.contract) {
    throw new Error('Platform pack dev source requires a valid manifest and contract');
  }
  const connectorId = normalizeConnectorId(source.manifest.connector.connectorId);
  if (!connectorId) {
    throw new Error('Platform pack dev source requires a valid connector id');
  }

  const existing =
    options.existing ??
    listPlatformPackDevInstanceBindings().find((record) => record.connectorId === connectorId) ??
    null;
  const stableIds = existing ?? createStableDevIds(source);
  const revisionValue =
    typeof options.revision === 'number' && Number.isFinite(options.revision)
      ? Math.max(1, Math.floor(options.revision))
      : (existing?.revision ?? 0) + 1;
  return {
    instanceId: stableIds.instanceId,
    connectorId,
    installationId: stableIds.installationId,
    rootDir: normalizeFsPath(source.rootDir),
    displayName: readDisplayName(source),
    packId: source.manifest.metadata.id,
    packVersion: source.manifest.metadata.version,
    platformId: readPlatformId(source),
    manifestPath: normalizeFsPath(source.manifestPath),
    contractPath: source.contractPath ? normalizeFsPath(source.contractPath) : null,
    runtimePath: source.runtimePath ? normalizeFsPath(source.runtimePath) : null,
    iconPath: source.iconPath ? normalizeFsPath(source.iconPath) : null,
    sidecarPath: source.sidecarPath ? normalizeFsPath(source.sidecarPath) : null,
    status: 'bound',
    revision: revisionValue,
    updatedAt: Date.now(),
    reloadHistory: appendReloadHistory(
      existing?.reloadHistory ?? [],
      options.reloadHistoryEntry ?? null
    ),
    lastError: null,
  };
}

export function getPlatformPackDevInstanceBindingsRevision(): number {
  return revision;
}

export function subscribePlatformPackDevInstanceBindings(
  listener: PlatformPackDevBindingListener
): () => void {
  listeners.add(listener);
  void ensureSync();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      syncDisposer?.();
      syncDisposer = null;
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
    .map((record) => cloneRecord(record));
}

export function getPlatformPackDevInstanceBinding(
  instanceId?: string
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
  source?: PlatformPackDevSource | null
): PlatformPackDevInstanceBindingRecord | null {
  const connectorId = normalizeConnectorId(source?.manifest?.connector.connectorId);
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
  const record = buildRecordFromSource(source, {
    revision: options.revision,
    reloadHistoryEntry: options.reloadHistoryEntry,
  });
  upsertRecord(record);
  setPlatformRenderSelectionMounted(record.instanceId, true);
  if (options.activate !== false) {
    void setActiveMusicPlatformInstance({
      instanceId: record.instanceId,
      connectorId: record.connectorId,
    });
  }
  return {
    record: cloneRecord(record),
    source,
  };
}

export function recordPlatformPackDevInstanceReloadFailure(
  recordOrInstanceId: PlatformPackDevInstanceBindingRecord | string,
  error: unknown,
  options: {
    revision?: number;
  } = {}
): PlatformPackDevInstanceBindingRecord | null {
  const record =
    typeof recordOrInstanceId === 'string'
      ? getPlatformPackDevInstanceBinding(recordOrInstanceId)
      : recordOrInstanceId;
  if (!record) return null;
  const message = readErrorMessage(error).slice(0, 2000);
  const revisionValue =
    typeof options.revision === 'number' && Number.isFinite(options.revision)
      ? Math.max(1, Math.floor(options.revision))
      : record.revision + 1;
  const nextRecord: PlatformPackDevInstanceBindingRecord = {
    ...record,
    status: 'error',
    lastError: message,
    updatedAt: Date.now(),
    reloadHistory: appendReloadHistory(record.reloadHistory, {
      status: 'error',
      revision: revisionValue,
      at: Date.now(),
      message,
    }),
  };
  upsertRecord(nextRecord);
  return cloneRecord(nextRecord);
}

export async function reloadPlatformPackDevInstanceBinding(
  record: PlatformPackDevInstanceBindingRecord
): Promise<PlatformPackDevInstanceBindResult> {
  const nextRevision = record.revision + 1;
  try {
    const source = await readPlatformPackDevSourceFromPath(record.rootDir);
    const nextRecord = buildRecordFromSource(source, {
      existing: record,
      revision: nextRevision,
      reloadHistoryEntry: {
        status: 'success',
        revision: nextRevision,
        at: Date.now(),
        message: null,
      },
    });
    upsertRecord(nextRecord);
    setPlatformRenderSelectionMounted(nextRecord.instanceId, true);
    void setActiveMusicPlatformInstance({
      instanceId: nextRecord.instanceId,
      connectorId: nextRecord.connectorId,
    });
    return {
      record: cloneRecord(nextRecord),
      source,
    };
  } catch (error) {
    recordPlatformPackDevInstanceReloadFailure(record, error, {
      revision: nextRevision,
    });
    throw error;
  }
}

export async function detachPlatformPackDevInstanceBinding(
  instanceId?: string
): Promise<boolean> {
  const record = getPlatformPackDevInstanceBinding(instanceId);
  if (!record) return false;
  removePlatformRenderSelection(record.instanceId);
  saveRecords(
    listPlatformPackDevInstanceBindings().filter(
      (item) => item.instanceId !== record.instanceId
    )
  );
  return true;
}
