import { readJson } from '../storage';
import {
  broadcastDataUpdate,
  setupDualListener,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../utils/windowCommunication';
import {
  loadInstalledPlatformPackRecords,
  subscribeInstalledPlatformPackRecords,
  type InstalledPlatformPackRecord,
} from './installedPlatformPacks';
import {
  normalizePlatformConnectorId,
  type PlatformConnectorId,
} from './platformConnectorModel';

export interface PlatformImportedInstanceRecord {
  instanceId: string;
  installationId: string;
  connectorId: PlatformConnectorId;
  platformId: string;
  instanceLabel: string;
  displayName: string;
  createdAtMs: number;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createSimpleId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeIdSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'platform'
  );
}

export function createPlatformImportedInstanceId(platformId: string): string {
  return createSimpleId(`${normalizeIdSegment(platformId)}:imported`);
}

function clonePlatformImportedInstanceRecord(
  record: PlatformImportedInstanceRecord
): PlatformImportedInstanceRecord {
  return { ...record };
}

function sanitizePlatformImportedInstanceRecord(
  value: unknown
): PlatformImportedInstanceRecord | null {
  if (!isRecord(value)) return null;

  const instanceId = normalizeString(value.instanceId);
  const installationId = normalizeString(value.installationId);
  const connectorId = normalizePlatformConnectorId(value.connectorId);
  const platformId = normalizeString(value.platformId).toLowerCase();
  const instanceLabel = normalizeString(value.instanceLabel);
  const displayName = normalizeString(value.displayName);
  const createdAtMs =
    typeof value.createdAtMs === 'number' && Number.isFinite(value.createdAtMs)
      ? Math.max(0, Math.floor(value.createdAtMs))
      : Date.now();

  if (
    !instanceId ||
    !installationId ||
    !connectorId ||
    !platformId ||
    !instanceLabel ||
    !displayName
  ) {
    return null;
  }

  return {
    instanceId,
    installationId,
    connectorId,
    platformId,
    instanceLabel,
    displayName,
    createdAtMs,
  };
}

function sortPlatformImportedInstanceRecords(
  left: PlatformImportedInstanceRecord,
  right: PlatformImportedInstanceRecord
): number {
  const createdAtDiff = left.createdAtMs - right.createdAtMs;
  if (createdAtDiff !== 0) return createdAtDiff;
  const displayNameDiff = left.displayName.localeCompare(right.displayName, 'zh-CN');
  if (displayNameDiff !== 0) return displayNameDiff;
  return left.instanceId.localeCompare(right.instanceId, 'zh-CN');
}

function resolveImportedInstanceBaseName(record: InstalledPlatformPackRecord): string {
  return (
    normalizeString(record.manifest.connector.displayName) ||
    normalizeString(record.contract.platform.displayName) ||
    normalizeString(record.platformId) ||
    record.connectorId.replace(/^connector\.platform\./i, '') ||
    record.connectorId
  );
}

function buildImportedInstanceDisplayName(
  record: InstalledPlatformPackRecord,
  ordinal: number
): string {
  const baseName = resolveImportedInstanceBaseName(record);
  return ordinal > 1 ? `${baseName} #${ordinal}` : baseName;
}

function readStoredPlatformImportedInstanceRecords(): PlatformImportedInstanceRecord[] {
  if (typeof window === 'undefined') return [];
  const raw = readJson<unknown>(STORAGE_KEYS.PLATFORM_IMPORTED_INSTANCES_V1, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => sanitizePlatformImportedInstanceRecord(item))
    .filter((record): record is PlatformImportedInstanceRecord => Boolean(record))
    .sort(sortPlatformImportedInstanceRecords)
    .map(clonePlatformImportedInstanceRecord);
}

function savePlatformImportedInstanceRecords(
  records: PlatformImportedInstanceRecord[]
): void {
  void broadcastDataUpdate(
    STORAGE_KEYS.PLATFORM_IMPORTED_INSTANCES_V1,
    records.map(clonePlatformImportedInstanceRecord),
    TAURI_EVENTS.PLATFORM_IMPORTED_INSTANCES_UPDATED
  );
}

function serializePlatformImportedInstanceRecords(
  records: PlatformImportedInstanceRecord[]
): string {
  return JSON.stringify(
    records.map((record) => ({
      instanceId: record.instanceId,
      installationId: record.installationId,
      connectorId: record.connectorId,
      platformId: record.platformId,
      instanceLabel: record.instanceLabel,
      displayName: record.displayName,
      createdAtMs: record.createdAtMs,
    }))
  );
}

function reconcilePlatformImportedInstanceRecords(
  records: PlatformImportedInstanceRecord[],
  installedRecords: InstalledPlatformPackRecord[]
): PlatformImportedInstanceRecord[] {
  const existingByInstallationId = new Map(
    records.map((record) => [record.installationId, record] as const)
  );
  const connectorOrdinals = new Map<string, number>();
  const next: PlatformImportedInstanceRecord[] = [];

  const externalRecords = installedRecords
    .filter((record) => record.sourceType === 'external')
    .sort((left, right) => {
      const installedAtDiff = left.installedAtMs - right.installedAtMs;
      if (installedAtDiff !== 0) return installedAtDiff;
      return left.installationId.localeCompare(right.installationId, 'zh-CN');
    });

  for (const installedRecord of externalRecords) {
    const existing = existingByInstallationId.get(installedRecord.installationId) ?? null;
    const nextOrdinal = (connectorOrdinals.get(installedRecord.connectorId) ?? 0) + 1;
    connectorOrdinals.set(installedRecord.connectorId, nextOrdinal);

    const displayName =
      normalizeString(existing?.displayName) ||
      buildImportedInstanceDisplayName(installedRecord, nextOrdinal);
    const instanceLabel =
      normalizeString(existing?.instanceLabel) || displayName;

    next.push({
      instanceId:
        normalizeString(existing?.instanceId) ||
        createPlatformImportedInstanceId(installedRecord.platformId),
      installationId: installedRecord.installationId,
      connectorId: installedRecord.connectorId,
      platformId: installedRecord.platformId,
      instanceLabel,
      displayName,
      createdAtMs:
        typeof existing?.createdAtMs === 'number' && Number.isFinite(existing.createdAtMs)
          ? existing.createdAtMs
          : installedRecord.installedAtMs,
    });
  }

  return next
    .sort(sortPlatformImportedInstanceRecords)
    .map(clonePlatformImportedInstanceRecord);
}

let platformImportedInstanceRegistryInitialized = false;

async function reconcilePersistedPlatformImportedInstances(): Promise<
  PlatformImportedInstanceRecord[]
> {
  const current = readStoredPlatformImportedInstanceRecords();
  const next = reconcilePlatformImportedInstanceRecords(
    current,
    loadInstalledPlatformPackRecords()
  );
  if (
    serializePlatformImportedInstanceRecords(current) !==
    serializePlatformImportedInstanceRecords(next)
  ) {
    savePlatformImportedInstanceRecords(next);
  }
  return next;
}

function ensurePlatformImportedInstanceRegistryInitialized(): void {
  if (platformImportedInstanceRegistryInitialized || typeof window === 'undefined') {
    return;
  }
  platformImportedInstanceRegistryInitialized = true;

  void reconcilePersistedPlatformImportedInstances();
  void subscribeInstalledPlatformPackRecords(() => {
    void reconcilePersistedPlatformImportedInstances();
  }).catch(() => {
    platformImportedInstanceRegistryInitialized = false;
  });
}

export async function ensurePlatformImportedInstanceForInstallation(
  installedRecord: InstalledPlatformPackRecord
): Promise<PlatformImportedInstanceRecord | null> {
  if (installedRecord.sourceType !== 'external') {
    return null;
  }
  ensurePlatformImportedInstanceRegistryInitialized();
  const next = await reconcilePersistedPlatformImportedInstances();
  const record =
    next.find((item) => item.installationId === installedRecord.installationId) ?? null;
  return record ? clonePlatformImportedInstanceRecord(record) : null;
}

export function listPlatformImportedInstanceRecords(): PlatformImportedInstanceRecord[] {
  ensurePlatformImportedInstanceRegistryInitialized();
  return readStoredPlatformImportedInstanceRecords();
}

export function getPlatformImportedInstanceRecord(
  instanceId: string
): PlatformImportedInstanceRecord | null {
  ensurePlatformImportedInstanceRegistryInitialized();
  const normalizedInstanceId = normalizeString(instanceId);
  if (!normalizedInstanceId) {
    return null;
  }
  return (
    readStoredPlatformImportedInstanceRecords().find(
      (record) => record.instanceId === normalizedInstanceId
    ) ?? null
  );
}

export function getPlatformImportedInstanceRecordByInstallationId(
  installationId: string
): PlatformImportedInstanceRecord | null {
  ensurePlatformImportedInstanceRegistryInitialized();
  const normalizedInstallationId = normalizeString(installationId);
  if (!normalizedInstallationId) {
    return null;
  }
  return (
    readStoredPlatformImportedInstanceRecords().find(
      (record) => record.installationId === normalizedInstallationId
    ) ?? null
  );
}

export async function subscribePlatformImportedInstanceRecords(
  listener: () => void
): Promise<() => void> {
  ensurePlatformImportedInstanceRegistryInitialized();
  return await setupDualListener(
    [STORAGE_KEYS.PLATFORM_IMPORTED_INSTANCES_V1],
    [TAURI_EVENTS.PLATFORM_IMPORTED_INSTANCES_UPDATED],
    listener
  );
}
