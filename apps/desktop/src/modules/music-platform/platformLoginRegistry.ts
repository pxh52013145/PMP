import { readJson } from '../storage';
import type { PlatformInstanceRecord } from '@pixel-matrix/plugin-platform-contracts';
import type { PlatformConnectorDefinition, PlatformConnectorId } from './connectorAuth';
import {
  broadcastDataUpdate,
  setupDualListener,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../utils/windowCommunication';
import { listPlatformImportedInstanceRecords } from './platformImportedInstanceRegistry';

export interface PlatformLoginRegistryEntry {
  instanceId: string;
  connectorId: PlatformConnectorId;
  enabled: boolean;
  addedAtMs: number;
}

function isPlatformConnectorId(value: unknown): value is PlatformConnectorId {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('connector.platform.');
}

function buildDefinitionMap(
  definitions: PlatformConnectorDefinition[]
): Map<PlatformConnectorId, PlatformConnectorDefinition> {
  return new Map(definitions.map((definition) => [definition.connectorId, definition]));
}

function createEntry(
  instanceId: string,
  connectorId: PlatformConnectorId,
  enabled: boolean,
  addedAtMs: number
): PlatformLoginRegistryEntry {
  return {
    instanceId,
    connectorId,
    enabled,
    addedAtMs,
  };
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlatformInstanceRecordArray(
  value: PlatformInstanceRecord[] | undefined
): value is PlatformInstanceRecord[] {
  return Array.isArray(value);
}

function createPlatformInstanceMap(
  instances: PlatformInstanceRecord[] | undefined
): Map<string, PlatformInstanceRecord> {
  if (!isPlatformInstanceRecordArray(instances)) {
    return new Map();
  }
  return new Map(instances.map((instance) => [instance.instanceId, instance] as const));
}

function createImportedInstanceIdSet(): Set<string> {
  return new Set(
    listPlatformImportedInstanceRecords().map((record) => record.instanceId)
  );
}

function pickPreferredInstanceIdForConnector(
  connectorId: PlatformConnectorId,
  instances: PlatformInstanceRecord[] | undefined
): string {
  if (!isPlatformInstanceRecordArray(instances)) {
    return '';
  }

  const candidates = instances.filter(
    (instance) => instance.metadata?.connectorId === connectorId
  );
  if (candidates.length < 1) {
    return '';
  }

  return candidates
    .slice()
    .sort((left, right) => {
      const leftBuiltin = left.instanceId.endsWith(':builtin') ? 1 : 0;
      const rightBuiltin = right.instanceId.endsWith(':builtin') ? 1 : 0;
      if (leftBuiltin !== rightBuiltin) {
        return rightBuiltin - leftBuiltin;
      }
      const updatedDiff =
        (right.auth.cookieUpdatedAtMs ?? 0) - (left.auth.cookieUpdatedAtMs ?? 0);
      if (updatedDiff !== 0) {
        return updatedDiff;
      }
      return left.instanceId.localeCompare(right.instanceId, 'zh-CN');
    })[0]?.instanceId;
}

function createLegacyRegistryInstancePlaceholder(
  connectorId: PlatformConnectorId
): string {
  return `legacy:${connectorId}`;
}

export function createDefaultPlatformLoginRegistry(
  definitions: PlatformConnectorDefinition[],
  preferredConnectorId?: PlatformConnectorId | null,
  instances?: PlatformInstanceRecord[]
): PlatformLoginRegistryEntry[] {
  void definitions;
  void preferredConnectorId;
  void instances;
  return [];
}

export function sanitizePlatformLoginRegistry(
  value: unknown,
  definitions: PlatformConnectorDefinition[],
  preferredConnectorId?: PlatformConnectorId | null,
  instances?: PlatformInstanceRecord[]
): PlatformLoginRegistryEntry[] {
  const definitionMap = buildDefinitionMap(definitions);
  const instanceMap = createPlatformInstanceMap(instances);
  const importedInstanceIds = createImportedInstanceIdSet();
  const fallback = createDefaultPlatformLoginRegistry(
    definitions,
    preferredConnectorId,
    instances
  );
  if (!Array.isArray(value)) return fallback;

  const next: PlatformLoginRegistryEntry[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as {
      instanceId?: unknown;
      connectorId?: unknown;
      enabled?: unknown;
      addedAtMs?: unknown;
    };

    if (!isPlatformConnectorId(candidate.connectorId)) continue;
    if (!definitionMap.has(candidate.connectorId)) continue;
    const candidateInstanceId = normalizeString(candidate.instanceId);
    const preferredInstanceId = pickPreferredInstanceIdForConnector(
      candidate.connectorId,
      instances
    );
    const candidateIsLegacyPlaceholder = candidateInstanceId.startsWith('legacy:');
    const instanceId =
      instanceMap.has(candidateInstanceId) ||
      !candidateIsLegacyPlaceholder
        ? candidateInstanceId || preferredInstanceId
        : preferredInstanceId;
    const hasResolvedInstance =
      Boolean(instanceId) &&
      (!isPlatformInstanceRecordArray(instances) ||
        instanceMap.has(instanceId) ||
        importedInstanceIds.has(instanceId));
    if (!hasResolvedInstance) {
      if (isPlatformInstanceRecordArray(instances)) {
        continue;
      }
    }
    const persistedInstanceId =
      instanceId || createLegacyRegistryInstancePlaceholder(candidate.connectorId);
    if (seen.has(persistedInstanceId)) continue;

    next.push(
      createEntry(
        persistedInstanceId,
        candidate.connectorId,
        candidate.enabled !== false,
        typeof candidate.addedAtMs === 'number' && Number.isFinite(candidate.addedAtMs)
          ? candidate.addedAtMs
          : Date.now()
      )
    );
    seen.add(persistedInstanceId);
  }

  return next;
}

export function readPlatformLoginRegistry(
  definitions: PlatformConnectorDefinition[],
  preferredConnectorId?: PlatformConnectorId | null,
  instances?: PlatformInstanceRecord[]
): PlatformLoginRegistryEntry[] {
  const raw = readJson<unknown>(STORAGE_KEYS.PLATFORM_LOGIN_REGISTRY_V1, null);
  return sanitizePlatformLoginRegistry(raw, definitions, preferredConnectorId, instances);
}

export async function persistPlatformLoginRegistry(
  entries: PlatformLoginRegistryEntry[]
): Promise<void> {
  await broadcastDataUpdate(
    STORAGE_KEYS.PLATFORM_LOGIN_REGISTRY_V1,
    entries,
    TAURI_EVENTS.PLATFORM_LOGIN_REGISTRY_UPDATED
  );
}

export async function subscribePlatformLoginRegistry(
  listener: () => void
): Promise<() => void> {
  return setupDualListener(
    [STORAGE_KEYS.PLATFORM_LOGIN_REGISTRY_V1],
    [TAURI_EVENTS.PLATFORM_LOGIN_REGISTRY_UPDATED],
    listener
  );
}

export function upsertPlatformLoginRegistryEntry(
  entries: PlatformLoginRegistryEntry[],
  entry: Pick<PlatformLoginRegistryEntry, 'instanceId' | 'connectorId'>,
  enabled: boolean
): PlatformLoginRegistryEntry[] {
  const normalizedInstanceId = normalizeString(entry.instanceId);
  if (!normalizedInstanceId) {
    return entries.slice();
  }

  const index = entries.findIndex((item) => item.instanceId === normalizedInstanceId);
  if (index < 0) {
    return [...entries, createEntry(normalizedInstanceId, entry.connectorId, enabled, Date.now())];
  }

  const next = entries.slice();
  next[index] = {
    ...next[index],
    connectorId: entry.connectorId,
    enabled,
  };
  return next;
}

export function setPlatformLoginRegistryEntryEnabled(
  entries: PlatformLoginRegistryEntry[],
  instanceId: string,
  enabled: boolean
): PlatformLoginRegistryEntry[] {
  return entries.map((entry) =>
    entry.instanceId === instanceId
      ? {
          ...entry,
          enabled,
        }
      : entry
  );
}

export function removePlatformLoginRegistryEntry(
  entries: PlatformLoginRegistryEntry[],
  instanceId: string
): PlatformLoginRegistryEntry[] {
  return entries.filter((entry) => entry.instanceId !== instanceId);
}
