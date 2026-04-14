import { readJson } from '../../../modules/storage';
import type { PlatformConnectorDefinition, PlatformConnectorId } from '../../../modules/music-platform';
import { broadcastDataUpdate, setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../../../utils/windowCommunication';

export interface PlatformLoginRegistryEntry {
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

function createEntry(connectorId: PlatformConnectorId, enabled: boolean, addedAtMs: number): PlatformLoginRegistryEntry {
  return {
    connectorId,
    enabled,
    addedAtMs,
  };
}

export function createDefaultPlatformLoginRegistry(
  definitions: PlatformConnectorDefinition[],
  preferredConnectorId?: PlatformConnectorId | null
): PlatformLoginRegistryEntry[] {
  const enabledDefinitions = definitions.filter(
    (definition) => definition.enabled && definition.authFlow === 'qr'
  );
  const orderedDefinitions = enabledDefinitions.slice().sort((left, right) => {
    if (preferredConnectorId) {
      if (left.connectorId === preferredConnectorId) return -1;
      if (right.connectorId === preferredConnectorId) return 1;
    }
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }
    return left.displayName.localeCompare(right.displayName, 'zh-CN');
  });

  const baseTimestamp = Date.now();
  return orderedDefinitions.map((definition, index) =>
    createEntry(definition.connectorId, true, baseTimestamp + index)
  );
}

export function sanitizePlatformLoginRegistry(
  value: unknown,
  definitions: PlatformConnectorDefinition[],
  preferredConnectorId?: PlatformConnectorId | null
): PlatformLoginRegistryEntry[] {
  const definitionMap = buildDefinitionMap(definitions);
  const fallback = createDefaultPlatformLoginRegistry(definitions, preferredConnectorId);
  if (!Array.isArray(value)) return fallback;

  const next: PlatformLoginRegistryEntry[] = [];
  const seen = new Set<PlatformConnectorId>();

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as {
      connectorId?: unknown;
      enabled?: unknown;
      addedAtMs?: unknown;
    };

    if (!isPlatformConnectorId(candidate.connectorId)) continue;
    if (!definitionMap.has(candidate.connectorId)) continue;
    if (seen.has(candidate.connectorId)) continue;

    next.push(
      createEntry(
        candidate.connectorId,
        candidate.enabled !== false,
        typeof candidate.addedAtMs === 'number' && Number.isFinite(candidate.addedAtMs)
          ? candidate.addedAtMs
          : Date.now()
      )
    );
    seen.add(candidate.connectorId);
  }

  return next;
}

export function readPlatformLoginRegistry(
  definitions: PlatformConnectorDefinition[],
  preferredConnectorId?: PlatformConnectorId | null
): PlatformLoginRegistryEntry[] {
  const raw = readJson<unknown>(STORAGE_KEYS.PLATFORM_LOGIN_REGISTRY_V1, null);
  return sanitizePlatformLoginRegistry(raw, definitions, preferredConnectorId);
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
  connectorId: PlatformConnectorId,
  enabled: boolean
): PlatformLoginRegistryEntry[] {
  const index = entries.findIndex((entry) => entry.connectorId === connectorId);
  if (index < 0) {
    return [...entries, createEntry(connectorId, enabled, Date.now())];
  }

  const next = entries.slice();
  next[index] = {
    ...next[index],
    enabled,
  };
  return next;
}

export function setPlatformLoginRegistryEntryEnabled(
  entries: PlatformLoginRegistryEntry[],
  connectorId: PlatformConnectorId,
  enabled: boolean
): PlatformLoginRegistryEntry[] {
  return entries.map((entry) =>
    entry.connectorId === connectorId
      ? {
          ...entry,
          enabled,
        }
      : entry
  );
}

export function removePlatformLoginRegistryEntry(
  entries: PlatformLoginRegistryEntry[],
  connectorId: PlatformConnectorId
): PlatformLoginRegistryEntry[] {
  return entries.filter((entry) => entry.connectorId !== connectorId);
}
