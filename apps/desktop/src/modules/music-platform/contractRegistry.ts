import type {
  PlatformCompatContractFile,
  PlatformCompatRuntimeApi,
} from '@pixel-matrix/plugin-platform-contracts';
import {
  listBuiltinPlatformCompatRegistrations,
  listPlatformConnectorDefinitions,
  subscribePlatformConnectorCompatRegistrations,
  type PlatformConnectorId,
} from './connectorAuth';
import {
  readPlatformLoginRegistry,
  subscribePlatformLoginRegistry,
} from './platformLoginRegistry';
import { ensureBuiltinPlatformPackRegistrationsInitialized } from './platformPackRegistry';

export interface PlatformCompatRegistryRecord {
  platformId: string;
  contract: PlatformCompatContractFile;
  runtime: PlatformCompatRuntimeApi;
  source: string;
  registeredAtMs: number;
  metadata?: Record<string, unknown>;
}

export interface RegisterPlatformCompatContractInput {
  contract: PlatformCompatContractFile;
  runtime: PlatformCompatRuntimeApi;
  source?: string;
  metadata?: Record<string, unknown>;
}

type PlatformCompatRegistryListener = (records: PlatformCompatRegistryRecord[]) => void;

const platformCompatRegistry = new Map<string, PlatformCompatRegistryRecord>();
const platformCompatRegistryListeners = new Set<PlatformCompatRegistryListener>();

let builtinPlatformCompatRegistryInitialized = false;

function normalizePlatformId(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeConnectorId(value: unknown): PlatformConnectorId | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith('connector.platform.')) return null;
  return normalized as PlatformConnectorId;
}

function cloneContract(contract: PlatformCompatContractFile): PlatformCompatContractFile {
  return {
    ...contract,
    platform: { ...contract.platform },
    auth: { ...contract.auth },
    capabilities: { ...contract.capabilities },
    apiBindings: { ...contract.apiBindings },
    extension: contract.extension ? { ...contract.extension } : undefined,
  };
}

function cloneRegistryRecord(record: PlatformCompatRegistryRecord): PlatformCompatRegistryRecord {
  return {
    platformId: record.platformId,
    contract: cloneContract(record.contract),
    runtime: record.runtime,
    source: record.source,
    registeredAtMs: record.registeredAtMs,
    metadata: record.metadata ? { ...record.metadata } : undefined,
  };
}

function sortRegistryRecords(
  left: PlatformCompatRegistryRecord,
  right: PlatformCompatRegistryRecord
): number {
  const displayNameCompare = left.contract.platform.displayName.localeCompare(
    right.contract.platform.displayName,
    'zh-CN'
  );
  if (displayNameCompare !== 0) {
    return displayNameCompare;
  }
  return left.platformId.localeCompare(right.platformId, 'zh-CN');
}

function emitPlatformCompatRegistryChanged(): void {
  const snapshot = Array.from(platformCompatRegistry.values())
    .map(cloneRegistryRecord)
    .sort(sortRegistryRecords);

  for (const listener of platformCompatRegistryListeners) {
    listener(snapshot);
  }
}

function isAutoManagedConnectorAuthRecord(
  record: PlatformCompatRegistryRecord | undefined
): boolean {
  return (
    record?.metadata?.autoCreateDefaultInstance === true &&
    typeof record.metadata?.connectorId === 'string'
  );
}

function readRegisteredConnectorIdsFromStorage(): PlatformConnectorId[] {
  const definitions = listPlatformConnectorDefinitions();
  return readPlatformLoginRegistry(definitions)
    .filter((entry) => entry.enabled !== false)
    .map((entry) => entry.connectorId);
}

export function reconcileBuiltinPlatformCompatRegistrations(
  registeredConnectorIds: string[]
): void {
  const registeredConnectorIdSet = new Set(
    registeredConnectorIds
      .map((connectorId) => normalizeConnectorId(connectorId))
      .filter((connectorId): connectorId is PlatformConnectorId => Boolean(connectorId))
  );

  for (const registration of listBuiltinPlatformCompatRegistrations()) {
    const existing = platformCompatRegistry.get(registration.platformId);
    const shouldRegister = registeredConnectorIdSet.has(registration.connectorId);

    if (shouldRegister) {
      registerPlatformCompatContract({
        contract: registration.contract,
        runtime: registration.runtime,
        source:
          registration.source === 'pack'
            ? 'platform-pack'
            : registration.source === 'runtime'
              ? 'runtime.connector-auth'
              : 'builtin.connector-auth',
        metadata: {
          ...(registration.metadata ?? {}),
          connectorId: registration.connectorId,
          enabled: registration.enabled,
          autoCreateDefaultInstance: true,
          runtimeAdapter:
            typeof registration.metadata?.runtimeAdapter === 'string'
              ? registration.metadata.runtimeAdapter
              : registration.source === 'pack'
                ? 'platformPackRuntime'
                : 'connectorAuth',
        },
      });
      continue;
    }

    if (isAutoManagedConnectorAuthRecord(existing)) {
      unregisterPlatformCompatContract(registration.platformId);
    }
  }
}

function ensureBuiltinPlatformCompatRegistryInitialized(): void {
  if (builtinPlatformCompatRegistryInitialized) return;
  builtinPlatformCompatRegistryInitialized = true;

  if (typeof window === 'undefined') return;

  ensureBuiltinPlatformPackRegistrationsInitialized();

  reconcileBuiltinPlatformCompatRegistrations(readRegisteredConnectorIdsFromStorage());

  subscribePlatformConnectorCompatRegistrations(() => {
    reconcileBuiltinPlatformCompatRegistrations(readRegisteredConnectorIdsFromStorage());
  });

  void subscribePlatformLoginRegistry(() => {
    reconcileBuiltinPlatformCompatRegistrations(readRegisteredConnectorIdsFromStorage());
  }).catch(() => {
    // Ignore listener bootstrap failures and keep the registry usable in the current window.
  });
}

export function registerPlatformCompatContract(input: RegisterPlatformCompatContractInput): void {
  const platformId = normalizePlatformId(input.contract.platform.platformId);
  if (!platformId) {
    throw new Error('Platform compat contract requires a non-empty platformId');
  }

  const existing = platformCompatRegistry.get(platformId);
  platformCompatRegistry.set(platformId, {
    platformId,
    contract: cloneContract({
      ...input.contract,
      platform: {
        ...input.contract.platform,
        platformId,
      },
    }),
    runtime: input.runtime,
    source: input.source?.trim() || existing?.source || 'runtime',
    registeredAtMs: existing?.registeredAtMs ?? Date.now(),
    metadata: input.metadata ? { ...input.metadata } : existing?.metadata ? { ...existing.metadata } : undefined,
  });

  emitPlatformCompatRegistryChanged();
}

export function unregisterPlatformCompatContract(platformId: string): boolean {
  const normalizedPlatformId = normalizePlatformId(platformId);
  if (!normalizedPlatformId) return false;
  const deleted = platformCompatRegistry.delete(normalizedPlatformId);
  if (deleted) {
    emitPlatformCompatRegistryChanged();
  }
  return deleted;
}

export function listPlatformCompatRegistryRecords(): PlatformCompatRegistryRecord[] {
  ensureBuiltinPlatformCompatRegistryInitialized();
  return Array.from(platformCompatRegistry.values())
    .map(cloneRegistryRecord)
    .sort(sortRegistryRecords);
}

export function listPlatformCompatContracts(): PlatformCompatContractFile[] {
  return listPlatformCompatRegistryRecords().map((record) => record.contract);
}

export function getPlatformCompatRegistryRecord(
  platformId: string
): PlatformCompatRegistryRecord | null {
  ensureBuiltinPlatformCompatRegistryInitialized();
  const normalizedPlatformId = normalizePlatformId(platformId);
  if (!normalizedPlatformId) return null;
  const record = platformCompatRegistry.get(normalizedPlatformId);
  return record ? cloneRegistryRecord(record) : null;
}

export function getPlatformCompatContract(platformId: string): PlatformCompatContractFile | null {
  return getPlatformCompatRegistryRecord(platformId)?.contract ?? null;
}

export function getPlatformCompatRuntimeApi(platformId: string): PlatformCompatRuntimeApi | null {
  ensureBuiltinPlatformCompatRegistryInitialized();
  const normalizedPlatformId = normalizePlatformId(platformId);
  if (!normalizedPlatformId) return null;
  return platformCompatRegistry.get(normalizedPlatformId)?.runtime ?? null;
}

export function subscribePlatformCompatRegistry(
  listener: PlatformCompatRegistryListener
): () => void {
  ensureBuiltinPlatformCompatRegistryInitialized();
  platformCompatRegistryListeners.add(listener);
  return () => {
    platformCompatRegistryListeners.delete(listener);
  };
}

export const subscribePlatformCompatContracts = subscribePlatformCompatRegistry;
