import type { PlatformCompatRuntimeApi } from '@pixel-matrix/plugin-platform-contracts';
import {
  createPassivePlatformConnectorAdapter,
  createPlatformCompatRuntimeFromConnectorAdapter,
  listPlatformConnectorAdapters,
  registerPlatformCompatRegistrationForConnector,
  registerPlatformConnectorAdapter,
  unregisterPlatformCompatRegistrationForConnector,
  unregisterPlatformConnectorAdapter,
  type BuiltinPlatformCompatRegistration,
  type PlatformConnectorAdapter,
  type PlatformConnectorDefinition,
  type PlatformConnectorId,
  type PlatformConnectorTemplate,
  type PlatformConnectorWorkspaceMode,
} from './connectorAuth';
import {
  parsePlatformPackFromZipBytes,
  type ParsedPlatformPack,
  type PlatformPackConnectorTemplate,
} from './platformPack';
import {
  createPlatformCompatRuntimeFromBindingContract,
  invokePlatformRuntimeBinding,
} from './bindingRuntime';

type JsonRecord = Record<string, unknown>;

export interface PlatformPackRegistrationRecord {
  packId: string;
  packVersion: string;
  connectorId: PlatformConnectorId;
  platformId: string;
  source: string;
  installedAtMs: number;
  definition: PlatformConnectorDefinition;
  compat: BuiltinPlatformCompatRegistration;
}

interface PlatformPackRuntimeContext {
  connectorId: PlatformConnectorId;
  definition: PlatformConnectorDefinition;
  contract: ParsedPlatformPack['contract'];
  pack: ParsedPlatformPack;
  invokeBinding: (
    bindingKey: keyof ParsedPlatformPack['contract']['apiBindings'],
    method: string,
    payload?: Record<string, unknown>
  ) => Promise<{ ok: boolean; data?: unknown; error?: unknown }>;
  createDefaultRuntimeApi: () => PlatformCompatRuntimeApi;
}

type PlatformPackRuntimeModuleShape = {
  createConnectorAdapter?: (context: PlatformPackRuntimeContext) => Promise<PlatformConnectorAdapter> | PlatformConnectorAdapter;
  connectorAdapter?: PlatformConnectorAdapter;
  createRuntimeApi?: (context: PlatformPackRuntimeContext) => Promise<PlatformCompatRuntimeApi> | PlatformCompatRuntimeApi;
  runtimeApi?: PlatformCompatRuntimeApi;
};

type PlatformPackRegistryListener = (records: PlatformPackRegistrationRecord[]) => void;

const platformPackRegistry = new Map<PlatformConnectorId, PlatformPackRegistrationRecord>();
const platformPackRegistryListeners = new Set<PlatformPackRegistryListener>();

function readRuntimeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRuntimeCreateConnectorAdapter(
  value: unknown
): value is NonNullable<PlatformPackRuntimeModuleShape['createConnectorAdapter']> {
  return typeof value === 'function';
}

function isRuntimeCreateRuntimeApi(
  value: unknown
): value is NonNullable<PlatformPackRuntimeModuleShape['createRuntimeApi']> {
  return typeof value === 'function';
}

function isPlatformConnectorAdapter(value: unknown): value is PlatformConnectorAdapter {
  if (!isJsonRecord(value) || !isJsonRecord(value.definition)) return false;
  const definition = value.definition;
  return (
    typeof definition.connectorId === 'string' &&
    typeof definition.workspaceKind === 'string' &&
    typeof definition.workspaceMode === 'string' &&
    typeof value.getAuthSnapshot === 'function' &&
    typeof value.refreshAndEmitAuthSnapshot === 'function'
  );
}

function isPlatformCompatRuntimeApi(value: unknown): value is PlatformCompatRuntimeApi {
  if (!isJsonRecord(value)) return false;
  if (typeof value.auth !== 'undefined' && !isJsonRecord(value.auth)) return false;
  return true;
}

function hasContractBinding(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateRuntimeApiCoverage(
  runtime: PlatformCompatRuntimeApi,
  contract: ParsedPlatformPack['contract'],
  runtimePath: string
): void {
  const requiredBuckets: Array<keyof PlatformCompatRuntimeApi> = [];
  const apiBindings = contract.apiBindings;

  if (hasContractBinding(apiBindings.auth)) requiredBuckets.push('auth');
  if (hasContractBinding(apiBindings.library)) requiredBuckets.push('library');
  if (hasContractBinding(apiBindings.recommendations)) requiredBuckets.push('recommendations');
  if (hasContractBinding(apiBindings.search)) requiredBuckets.push('search');
  if (hasContractBinding(apiBindings.quality)) requiredBuckets.push('quality');
  if (hasContractBinding(apiBindings.navigation)) requiredBuckets.push('navigation');
  if (hasContractBinding(apiBindings.settings)) requiredBuckets.push('settings');
  if (hasContractBinding(apiBindings.pages)) requiredBuckets.push('pages');

  for (const bucket of requiredBuckets) {
    const value = runtime[bucket];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(
        `Platform pack runtime is missing API bucket "${bucket}" required by contract bindings (${runtimePath})`
      );
    }
  }
}

function normalizePackConnectorId(value: unknown): PlatformConnectorId {
  if (typeof value !== 'string') {
    throw new Error('Platform pack connectorId must be a string');
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith('connector.platform.')) {
    throw new Error('Platform pack connectorId must start with connector.platform.');
  }
  return normalized as PlatformConnectorId;
}

function normalizeWorkspaceMode(
  value: unknown,
  fallback: PlatformConnectorWorkspaceMode
): PlatformConnectorWorkspaceMode {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'dedicated' || normalized === 'generic-only') {
    return normalized;
  }
  return fallback;
}

function normalizeTemplate(
  template: PlatformPackConnectorTemplate | undefined,
  workspaceKind: string
): PlatformConnectorTemplate {
  if (template === 'music' || template === 'video' || template === 'generic') {
    return template;
  }
  const normalizedWorkspaceKind = workspaceKind.trim().toLowerCase();
  if (!normalizedWorkspaceKind || normalizedWorkspaceKind === 'generic') return 'generic';
  if (normalizedWorkspaceKind === 'bilibili') return 'video';
  return 'music';
}

function normalizeAuthFlow(
  flow: 'qr' | 'none' | undefined,
  loginMode: ParsedPlatformPack['contract']['auth']['loginMode']
): 'qr' | 'none' {
  if (flow === 'qr' || flow === 'none') {
    return flow;
  }
  return loginMode === 'qr' || loginMode === 'cookie+qr' ? 'qr' : 'none';
}

function buildDefaultLabelKey(connectorId: PlatformConnectorId): string {
  const suffix = connectorId.replace('connector.platform.', '');
  return `magnet.platform-login.platform.${suffix}`;
}

function buildDefinitionFromPack(pack: ParsedPlatformPack): PlatformConnectorDefinition {
  const connectorId = normalizePackConnectorId(pack.manifest.connector.connectorId);
  const contract = pack.contract;
  const connector = pack.manifest.connector;
  const platformIdSuffix = contract.platform.platformId || connectorId.replace('connector.platform.', '');
  return {
    connectorId,
    displayName: connector.displayName || contract.platform.displayName || platformIdSuffix,
    labelKey: connector.labelKey || buildDefaultLabelKey(connectorId),
    iconKey: connector.iconKey || contract.platform.staticIcon || platformIdSuffix,
    iconAssetUrl: pack.iconDataUrl,
    accentColor: connector.accentColor,
    platformTemplate: normalizeTemplate(connector.platformTemplate, connector.workspaceKind),
    enabled: connector.enabled !== false,
    authFlow: normalizeAuthFlow(connector.authFlow, contract.auth.loginMode),
    workspaceKind: connector.workspaceKind,
    workspaceMode: normalizeWorkspaceMode(
      connector.workspaceMode,
      normalizeWorkspaceMode(contract.extension?.workspaceMode, 'dedicated')
    ),
    sortOrder:
      typeof connector.sortOrder === 'number' && Number.isFinite(connector.sortOrder)
        ? connector.sortOrder
        : 1000,
    source: 'pack',
    sourceId: `platform-pack:${pack.manifest.metadata.id}@${pack.manifest.metadata.version}`,
  };
}

function ensureAdapterShape(
  adapter: PlatformConnectorAdapter,
  definition: PlatformConnectorDefinition
): PlatformConnectorAdapter {
  return {
    ...adapter,
    definition: {
      ...adapter.definition,
      ...definition,
      connectorId: definition.connectorId,
      workspaceKind: definition.workspaceKind,
      workspaceMode: definition.workspaceMode,
    },
    getAuthSnapshot: adapter.getAuthSnapshot,
    refreshAndEmitAuthSnapshot: adapter.refreshAndEmitAuthSnapshot,
    beginQrLogin: adapter.beginQrLogin,
    pollQrLogin: adapter.pollQrLogin,
    logout: adapter.logout,
    clearAuthCookies: adapter.clearAuthCookies,
  };
}

function resolveRuntimeModuleShape(value: unknown): PlatformPackRuntimeModuleShape | null {
  if (!isJsonRecord(value)) return null;

  const createConnectorAdapter = isRuntimeCreateConnectorAdapter(value.createConnectorAdapter)
    ? value.createConnectorAdapter
    : undefined;
  const connectorAdapter = isPlatformConnectorAdapter(value.connectorAdapter)
    ? value.connectorAdapter
    : undefined;
  const createRuntimeApi = isRuntimeCreateRuntimeApi(value.createRuntimeApi)
    ? value.createRuntimeApi
    : undefined;
  const runtimeApi = isPlatformCompatRuntimeApi(value.runtimeApi) ? value.runtimeApi : undefined;

  if (!createConnectorAdapter && !connectorAdapter && !createRuntimeApi && !runtimeApi) {
    return null;
  }

  return {
    createConnectorAdapter,
    connectorAdapter,
    createRuntimeApi,
    runtimeApi,
  };
}

async function importRuntimeModuleFromCode(code: string): Promise<Record<string, unknown>> {
  const moduleUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    return (await import(/* @vite-ignore */ moduleUrl)) as Record<string, unknown>;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

async function resolveRuntimeModule(pack: ParsedPlatformPack): Promise<PlatformPackRuntimeModuleShape> {
  const moduleRecord = await importRuntimeModuleFromCode(pack.runtimeCode);

  const direct = resolveRuntimeModuleShape(moduleRecord);
  if (direct) return direct;
  const fromDefault = resolveRuntimeModuleShape(moduleRecord.default);
  if (fromDefault) return fromDefault;
  throw new Error(
    `Platform pack runtime entry must export at least one of createConnectorAdapter/connectorAdapter/createRuntimeApi/runtimeApi (${pack.runtimePath})`
  );
}

async function resolveAdapterAndRuntime(
  pack: ParsedPlatformPack,
  definition: PlatformConnectorDefinition
): Promise<{ adapter: PlatformConnectorAdapter; runtime: PlatformCompatRuntimeApi }> {
  const runtimeModule = await resolveRuntimeModule(pack);
  const runtimeContext: PlatformPackRuntimeContext = {
    connectorId: definition.connectorId,
    definition,
    contract: pack.contract,
    pack,
    invokeBinding: (bindingKey, method, payload = {}) => {
      const bindingId = pack.contract.apiBindings[bindingKey];
      if (typeof bindingId !== 'string' || bindingId.trim().length < 1) {
        return Promise.resolve({
          ok: false,
          error: {
            code: 'UNSUPPORTED_CAPABILITY',
            message: `Platform pack binding "${String(bindingKey)}" is not configured`,
          },
        });
      }

      return invokePlatformRuntimeBinding({
        bindingId,
        connectorId: definition.connectorId,
        displayName: definition.displayName,
        method,
        payload,
      });
    },
    createDefaultRuntimeApi: () =>
      createPlatformCompatRuntimeFromBindingContract(definition, pack.contract),
  };

  const existingAdapter =
    listPlatformConnectorAdapters().find((item) => item.definition.connectorId === definition.connectorId) ??
    null;
  const passiveAdapter = createPassivePlatformConnectorAdapter(definition);
  const runtimeModuleAdapter = runtimeModule?.createConnectorAdapter
    ? await runtimeModule.createConnectorAdapter(runtimeContext)
    : runtimeModule?.connectorAdapter;
  const normalizedAdapter = runtimeModuleAdapter
    ? ensureAdapterShape(runtimeModuleAdapter, definition)
    : existingAdapter
      ? ensureAdapterShape(existingAdapter, definition)
      : passiveAdapter;

  const runtimeFromModule = runtimeModule?.createRuntimeApi
    ? await runtimeModule.createRuntimeApi(runtimeContext)
    : runtimeModule?.runtimeApi;
  const runtime =
    runtimeFromModule ?? createPlatformCompatRuntimeFromConnectorAdapter(definition, normalizedAdapter);
  validateRuntimeApiCoverage(runtime, pack.contract, pack.runtimePath);

  return {
    adapter: normalizedAdapter,
    runtime,
  };
}

function cloneRecord(record: PlatformPackRegistrationRecord): PlatformPackRegistrationRecord {
  return {
    ...record,
    definition: { ...record.definition },
    compat: {
      ...record.compat,
      contract: {
        ...record.compat.contract,
        platform: { ...record.compat.contract.platform },
        auth: { ...record.compat.contract.auth },
        capabilities: { ...record.compat.contract.capabilities },
        apiBindings: { ...record.compat.contract.apiBindings },
        extension: record.compat.contract.extension ? { ...record.compat.contract.extension } : undefined,
      },
      metadata: record.compat.metadata ? { ...record.compat.metadata } : undefined,
    },
  };
}

function emitRegistryChanged(): void {
  const snapshot = Array.from(platformPackRegistry.values())
    .map(cloneRecord)
    .sort((left, right) => left.definition.sortOrder - right.definition.sortOrder);

  for (const listener of platformPackRegistryListeners) {
    listener(snapshot);
  }
}

export async function installPlatformPackFromZipBytes(
  bytes: Uint8Array,
  options: { source?: string } = {}
): Promise<PlatformPackRegistrationRecord> {
  const pack = await parsePlatformPackFromZipBytes(bytes);
  const definition = buildDefinitionFromPack(pack);
  const { adapter, runtime } = await resolveAdapterAndRuntime(pack, definition);

  registerPlatformConnectorAdapter(adapter);
  const compatRegistration: BuiltinPlatformCompatRegistration = {
    platformId: pack.contract.platform.platformId,
    connectorId: definition.connectorId,
    enabled: definition.enabled,
    contract: pack.contract,
    runtime,
    source: 'pack',
    metadata: {
      runtimeAdapter: 'platformPackRuntime',
      connectorId: definition.connectorId,
      platformPackId: pack.manifest.metadata.id,
      platformPackVersion: pack.manifest.metadata.version,
    },
  };
  registerPlatformCompatRegistrationForConnector(compatRegistration);

  const record: PlatformPackRegistrationRecord = {
    packId: pack.manifest.metadata.id,
    packVersion: pack.manifest.metadata.version,
    connectorId: definition.connectorId,
    platformId: pack.contract.platform.platformId,
    source: options.source?.trim() || 'runtime',
    installedAtMs: Date.now(),
    definition,
    compat: compatRegistration,
  };

  platformPackRegistry.set(record.connectorId, cloneRecord(record));
  emitRegistryChanged();
  return cloneRecord(record);
}

export async function installPlatformPackFromFile(file: File): Promise<PlatformPackRegistrationRecord> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return await installPlatformPackFromZipBytes(bytes, {
      source: `file:${file.name}`,
    });
  } catch (error) {
    throw new Error(
      `Failed to install platform pack (${file.name}): ${readRuntimeErrorMessage(error)}`
    );
  }
}

export function listPlatformPackRegistrations(): PlatformPackRegistrationRecord[] {
  return Array.from(platformPackRegistry.values()).map(cloneRecord);
}

export function removePlatformPackRegistration(connectorId: string): boolean {
  let normalizedConnectorId: PlatformConnectorId;
  try {
    normalizedConnectorId = normalizePackConnectorId(connectorId);
  } catch {
    return false;
  }
  const existing = platformPackRegistry.get(normalizedConnectorId);
  if (!existing) return false;
  platformPackRegistry.delete(normalizedConnectorId);
  unregisterPlatformCompatRegistrationForConnector(normalizedConnectorId);
  unregisterPlatformConnectorAdapter(normalizedConnectorId);
  emitRegistryChanged();
  return true;
}

export function subscribePlatformPackRegistrations(
  listener: PlatformPackRegistryListener
): () => void {
  platformPackRegistryListeners.add(listener);
  return () => {
    platformPackRegistryListeners.delete(listener);
  };
}
