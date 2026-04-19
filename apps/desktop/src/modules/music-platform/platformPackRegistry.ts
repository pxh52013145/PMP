import type { PlatformCompatRuntimeApi } from '@pixel-matrix/plugin-platform-contracts';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  createPassivePlatformConnectorAdapter,
  createPlatformCompatRuntimeFromConnectorAdapter,
  listPlatformConnectorAdapters,
  registerPlatformCompatRegistrationForConnector,
  registerPlatformConnectorAdapter,
  registerPlatformConnectorRegistryInitializer,
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
  invokePlatformRuntimeBinding,
} from './bindingRuntime';
import {
  type PlatformInstanceAuthBindingProvider,
} from './platformInstanceAuthBinding';
import {
  type PlatformInstanceApiBindingProvider,
} from './platformInstanceApiBinding';
import type { PlatformInstanceAuthAdapter } from './platformInstanceAuthAdapter';
import {
  areInstalledPlatformPackArtifactsPresent,
  createInstalledPlatformPackEntryUrl,
  installPlatformPackToStorage,
  loadInstalledPlatformPackRecords,
  subscribeInstalledPlatformPackRecords,
  type InstalledPlatformPackRecord,
} from './installedPlatformPacks';
import {
  createPlatformPackSidecarHostRuntimeSupport,
} from './platformPackSidecarHostSupport';
import { disposePlatformPackSidecar } from './platformPackSidecarBridge';
import {
  BILIBILI_CONNECTOR_ID,
  NETEASE_CONNECTOR_ID,
} from './platformConnectorModel';

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

export interface PlatformPackHostRuntimeSupport {
  connectorId: PlatformConnectorId;
  authAdapter?: PlatformInstanceAuthAdapter | null;
  authBindingProvider?: PlatformInstanceAuthBindingProvider | null;
  apiBindingProvider?: PlatformInstanceApiBindingProvider | null;
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
}

type PlatformPackRuntimeModuleShape = {
  createConnectorAdapter?: (context: PlatformPackRuntimeContext) => Promise<PlatformConnectorAdapter> | PlatformConnectorAdapter;
  connectorAdapter?: PlatformConnectorAdapter;
  createRuntimeApi?: (context: PlatformPackRuntimeContext) => Promise<PlatformCompatRuntimeApi> | PlatformCompatRuntimeApi;
  runtimeApi?: PlatformCompatRuntimeApi;
  createAuthBindingProvider?: (
    context: PlatformPackRuntimeContext
  ) =>
    | Promise<PlatformInstanceAuthBindingProvider | null | undefined>
    | PlatformInstanceAuthBindingProvider
    | null
    | undefined;
  authBindingProvider?: PlatformInstanceAuthBindingProvider | null;
  createBindingProvider?: (
    context: PlatformPackRuntimeContext
  ) =>
    | Promise<PlatformInstanceApiBindingProvider | null | undefined>
    | PlatformInstanceApiBindingProvider
    | null
    | undefined;
  bindingProvider?: PlatformInstanceApiBindingProvider | null;
};

type PlatformPackRegistryListener = (records: PlatformPackRegistrationRecord[]) => void;

type BuiltinPlatformPackAsset = {
  source: string;
  connectorId: PlatformConnectorId;
  packAssetUrl: string;
};

type LoadedBuiltinPlatformPackAsset = {
  source: string;
  connectorId: PlatformConnectorId;
  pack: ParsedPlatformPack;
};

const platformPackRegistry = new Map<PlatformConnectorId, PlatformPackRegistrationRecord>();
const platformPackHostRuntimeSupportRegistry = new Map<
  PlatformConnectorId,
  PlatformPackHostRuntimeSupport
>();
const platformPackSidecarEntryPathRegistry = new Map<PlatformConnectorId, string>();
const platformPackRegistryListeners = new Set<PlatformPackRegistryListener>();
const builtinPlatformPackAssets: BuiltinPlatformPackAsset[] = [
  {
    source: 'builtin-pack:bilibili',
    connectorId: BILIBILI_CONNECTOR_ID,
    packAssetUrl: '/resource/music-platform/packs/dist/builtin-bilibili.pmpp',
  },
  {
    source: 'builtin-pack:netease',
    connectorId: NETEASE_CONNECTOR_ID,
    packAssetUrl: '/resource/music-platform/packs/dist/builtin-netease.pmpp',
  },
];

let builtinPlatformPackRegistrationsInitialized = false;
let builtinPlatformPackLoadPromise: Promise<LoadedBuiltinPlatformPackAsset[]> | null = null;
let installedPlatformPackSyncStarted = false;
let installedPlatformPackRefreshPromise: Promise<void> | null = null;
let builtinPlatformPackBootScheduled = false;
let builtinPlatformPackBackgroundReconcileScheduled = false;
let builtinPlatformPackBootPromise: Promise<void> | null = null;
let platformPackRegistryBootstrapRegistered = false;

function ensurePlatformPackRegistryBootstrapRegistered(): void {
  if (platformPackRegistryBootstrapRegistered) {
    return;
  }
  if (typeof registerPlatformConnectorRegistryInitializer !== 'function') {
    return;
  }
  platformPackRegistryBootstrapRegistered = true;
  registerPlatformConnectorRegistryInitializer(
    ensureBuiltinPlatformPackRegistrationsInitialized
  );
}

ensurePlatformPackRegistryBootstrapRegistered();

type IdleSchedulerWindow = Window & {
  requestIdleCallback?: (
    callback: (deadline: { didTimeout: boolean; timeRemaining(): number }) => void,
    options?: { timeout?: number }
  ) => number;
};

function readRuntimeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

function isRuntimeCreateAuthBindingProvider(
  value: unknown
): value is NonNullable<PlatformPackRuntimeModuleShape['createAuthBindingProvider']> {
  return typeof value === 'function';
}

function isRuntimeCreateBindingProvider(
  value: unknown
): value is NonNullable<PlatformPackRuntimeModuleShape['createBindingProvider']> {
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

function isPlatformInstanceAuthBindingProvider(
  value: unknown
): value is PlatformInstanceAuthBindingProvider {
  if (!isJsonRecord(value)) return false;
  return (
    typeof value.connectorId === 'string' &&
    typeof value.getSnapshot === 'function'
  );
}

function isPlatformInstanceApiBindingProvider(
  value: unknown
): value is PlatformInstanceApiBindingProvider {
  if (!isJsonRecord(value)) return false;
  return typeof value.connectorId === 'string';
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

function guessIconMimeTypeFromPath(path: string): string {
  const normalized = path.trim().toLowerCase();
  if (normalized.endsWith('.svg')) return 'image/svg+xml';
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  if (typeof btoa !== 'function') {
    throw new Error('btoa is not available in current runtime');
  }
  return btoa(binary);
}

function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${toBase64(bytes)}`;
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

function scheduleAfterFirstPaint(task: () => void): void {
  if (typeof window === 'undefined') {
    task();
    return;
  }

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      window.setTimeout(task, 0);
    });
    return;
  }

  window.setTimeout(task, 0);
}

function scheduleWhenBrowserIdle(task: () => void, delayMs = 0): void {
  if (typeof window === 'undefined') {
    task();
    return;
  }

  const start = () => {
    const idleWindow = window as IdleSchedulerWindow;
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleWindow.requestIdleCallback(() => task(), { timeout: 1500 });
      return;
    }
    scheduleAfterFirstPaint(task);
  };

  if (delayMs > 0) {
    window.setTimeout(start, delayMs);
    return;
  }

  start();
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

function resolveAssetUrl(assetUrl: string): string {
  const normalized = normalizeString(assetUrl);
  if (!normalized) {
    throw new Error('Platform pack asset URL is required');
  }
  if (normalized.startsWith('/') && typeof window !== 'undefined') {
    return new URL(normalized, window.location.href).toString();
  }
  return normalized;
}

async function fetchPlatformPackAssetBytes(assetUrl: string): Promise<Uint8Array> {
  const response = await fetch(resolveAssetUrl(assetUrl)).catch(() => null);
  if (!response?.ok) {
    throw new Error(`Failed to fetch platform pack asset (${assetUrl})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1) {
    throw new Error(`Platform pack asset is empty (${assetUrl})`);
  }
  return bytes;
}

async function loadBuiltinPlatformPackAssets(): Promise<LoadedBuiltinPlatformPackAsset[]> {
  if (builtinPlatformPackLoadPromise) {
    return await builtinPlatformPackLoadPromise;
  }

  builtinPlatformPackLoadPromise = Promise.all(
    builtinPlatformPackAssets.map(async (asset) => {
      const bytes = await fetchPlatformPackAssetBytes(asset.packAssetUrl);
      const pack = await parsePlatformPackFromZipBytes(bytes);
      const packConnectorId = normalizePackConnectorId(pack.manifest.connector.connectorId);
      if (packConnectorId !== asset.connectorId) {
        throw new Error(
          `Builtin platform pack connector mismatch (${asset.packAssetUrl} -> ${packConnectorId})`
        );
      }
      return {
        source: asset.source,
        connectorId: asset.connectorId,
        pack,
      };
    })
  );

  try {
    return await builtinPlatformPackLoadPromise;
  } catch (error) {
    builtinPlatformPackLoadPromise = null;
    throw error;
  }
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
    iconAssetUrl: pack.iconAssetUrl,
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
  const createAuthBindingProvider = isRuntimeCreateAuthBindingProvider(
    value.createAuthBindingProvider
  )
    ? value.createAuthBindingProvider
    : undefined;
  const authBindingProvider = isPlatformInstanceAuthBindingProvider(value.authBindingProvider)
    ? value.authBindingProvider
    : undefined;
  const createBindingProvider = isRuntimeCreateBindingProvider(value.createBindingProvider)
    ? value.createBindingProvider
    : undefined;
  const bindingProvider = isPlatformInstanceApiBindingProvider(value.bindingProvider)
    ? value.bindingProvider
    : undefined;

  if (
    !createConnectorAdapter &&
    !connectorAdapter &&
    !createRuntimeApi &&
    !runtimeApi &&
    !createAuthBindingProvider &&
    !authBindingProvider &&
    !createBindingProvider &&
    !bindingProvider
  ) {
    return null;
  }

  return {
    createConnectorAdapter,
    connectorAdapter,
    createRuntimeApi,
    runtimeApi,
    createAuthBindingProvider,
    authBindingProvider,
    createBindingProvider,
    bindingProvider,
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

async function importRuntimeModuleFromUrl(url: string): Promise<Record<string, unknown>> {
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

async function resolveRuntimeModule(pack: ParsedPlatformPack): Promise<PlatformPackRuntimeModuleShape> {
  let moduleRecord: Record<string, unknown>;
  if (pack.runtimeImportUrl) {
    try {
      moduleRecord = await importRuntimeModuleFromUrl(pack.runtimeImportUrl);
    } catch (urlImportError) {
      try {
        moduleRecord = await importRuntimeModuleFromCode(pack.runtimeCode);
      } catch (codeImportError) {
        throw new Error(
          `Failed to import installed platform pack runtime from URL (${pack.runtimeImportUrl}) and inline code (${pack.runtimePath}): ${readRuntimeErrorMessage(
            urlImportError
          )}; fallback: ${readRuntimeErrorMessage(codeImportError)}`
        );
      }
    }
  } else {
    moduleRecord = await importRuntimeModuleFromCode(pack.runtimeCode);
  }

  const direct = resolveRuntimeModuleShape(moduleRecord);
  if (direct) return direct;
  const fromDefault = resolveRuntimeModuleShape(moduleRecord.default);
  if (fromDefault) return fromDefault;
  throw new Error(
    `Platform pack runtime entry must export at least one of createConnectorAdapter/connectorAdapter/createRuntimeApi/runtimeApi/createAuthBindingProvider/authBindingProvider/createBindingProvider/bindingProvider (${pack.runtimePath})`
  );
}

async function resolveAdapterAndRuntime(
  pack: ParsedPlatformPack,
  definition: PlatformConnectorDefinition
): Promise<{
  adapter: PlatformConnectorAdapter;
  runtime: PlatformCompatRuntimeApi;
  authBindingProvider: PlatformInstanceAuthBindingProvider | null;
  bindingProvider: PlatformInstanceApiBindingProvider | null;
}> {
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
  const authBindingProvider = runtimeModule?.createAuthBindingProvider
    ? (await runtimeModule.createAuthBindingProvider(runtimeContext)) ?? null
    : runtimeModule?.authBindingProvider ?? null;
  const bindingProvider = runtimeModule?.createBindingProvider
    ? (await runtimeModule.createBindingProvider(runtimeContext)) ?? null
    : runtimeModule?.bindingProvider ?? null;

  return {
    adapter: normalizedAdapter,
    runtime,
    authBindingProvider,
    bindingProvider,
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

function buildCompatRegistration(
  pack: ParsedPlatformPack,
  definition: PlatformConnectorDefinition,
  runtime: PlatformCompatRuntimeApi,
  runtimeAdapter: string
): BuiltinPlatformCompatRegistration {
  return {
    platformId: pack.contract.platform.platformId,
    connectorId: definition.connectorId,
    enabled: definition.enabled,
    contract: pack.contract,
    runtime,
    source: 'pack',
    metadata: {
      runtimeAdapter,
      connectorId: definition.connectorId,
      platformPackId: pack.manifest.metadata.id,
      platformPackVersion: pack.manifest.metadata.version,
    },
  };
}

function cloneHostRuntimeSupport(
  support: PlatformPackHostRuntimeSupport
): PlatformPackHostRuntimeSupport {
  return {
    connectorId: support.connectorId,
    authAdapter: support.authAdapter ?? null,
    authBindingProvider: support.authBindingProvider ?? null,
    apiBindingProvider: support.apiBindingProvider ?? null,
  };
}

function buildInstalledPackSource(record: InstalledPlatformPackRecord): string {
  return (
    normalizeString(record.source) ||
    (record.sourceType === 'builtin'
      ? `builtin-pack:${record.packId}`
      : `installed-pack:${record.packId}`)
  );
}

async function buildParsedPlatformPackFromInstalledRecord(
  record: InstalledPlatformPackRecord
): Promise<ParsedPlatformPack> {
  const fs = await import('@tauri-apps/api/fs');
  const runtimeCode = await fs.readTextFile(record.runtimePath);
  const runtimeImportUrl = await createInstalledPlatformPackEntryUrl(record.runtimePath);
  const iconBytes = await fs.readBinaryFile(record.iconPath).catch(() => new Uint8Array());
  const iconMimeType = guessIconMimeTypeFromPath(record.iconPath);
  const iconAssetUrl =
    iconBytes.byteLength > 0
      ? toDataUrl(iconBytes, iconMimeType)
      : await createInstalledPlatformPackEntryUrl(record.iconPath);

  return {
    manifest: {
      ...record.manifest,
      metadata: {
        ...record.manifest.metadata,
        tags: Array.isArray(record.manifest.metadata.tags)
          ? record.manifest.metadata.tags.slice()
          : undefined,
      },
      connector: {
        ...record.manifest.connector,
      },
      entry: {
        ...record.manifest.entry,
      },
    },
    contractPath: record.manifest.entry.contract,
    contract: {
      ...record.contract,
      platform: { ...record.contract.platform },
      auth: { ...record.contract.auth },
      capabilities: { ...record.contract.capabilities },
      apiBindings: { ...record.contract.apiBindings },
      extension: record.contract.extension ? { ...record.contract.extension } : undefined,
    },
    runtimePath: record.runtimePath,
    runtimeCode,
    runtimeImportUrl,
    iconPath: record.iconPath,
    iconBytes,
    iconAssetUrl,
    iconMimeType,
    sidecarPath: record.sidecarPath,
    files: [],
  };
}

async function registerInstalledPlatformPackRecord(
  record: InstalledPlatformPackRecord
): Promise<PlatformPackRegistrationRecord | null> {
  if (!(await areInstalledPlatformPackArtifactsPresent(record))) {
    removePlatformPackRegistration(record.connectorId);
    return null;
  }

  const pack = await buildParsedPlatformPackFromInstalledRecord(record);
  const hostRuntimeSupport = createPlatformPackSidecarHostRuntimeSupport(record);
  return await installParsedPlatformPack(pack, {
    source: buildInstalledPackSource(record),
    hostRuntimeSupport,
    installedAtMs: record.installedAtMs,
  });
}

async function refreshInstalledPlatformPackRegistrationsFromStore(): Promise<void> {
  if (!isTauriRuntime()) return;

  if (installedPlatformPackRefreshPromise) {
    await installedPlatformPackRefreshPromise;
    return;
  }

  installedPlatformPackRefreshPromise = (async () => {
    const records = loadInstalledPlatformPackRecords();
    const desiredConnectorIds = new Set(records.map((record) => record.connectorId));

    for (const connectorId of Array.from(platformPackRegistry.keys())) {
      if (!desiredConnectorIds.has(connectorId)) {
        removePlatformPackRegistration(connectorId);
      }
    }

    for (const record of records) {
      try {
        await registerInstalledPlatformPackRecord(record);
      } catch {
        removePlatformPackRegistration(record.connectorId);
      }
    }
  })();

  try {
    await installedPlatformPackRefreshPromise;
  } finally {
    installedPlatformPackRefreshPromise = null;
  }
}

function ensureInstalledPlatformPackStoreSync(): void {
  if (installedPlatformPackSyncStarted || !isTauriRuntime() || typeof window === 'undefined') {
    return;
  }
  installedPlatformPackSyncStarted = true;

  void subscribeInstalledPlatformPackRecords(() => {
    void refreshInstalledPlatformPackRegistrationsFromStore();
  }).catch(() => {
    installedPlatformPackSyncStarted = false;
  });
}

function upsertPlatformPackRecord(
  pack: ParsedPlatformPack,
  definition: PlatformConnectorDefinition,
  compatRegistration: BuiltinPlatformCompatRegistration,
  source: string | undefined,
  installedAtMs?: number
): PlatformPackRegistrationRecord {
  const existing = platformPackRegistry.get(definition.connectorId) ?? null;
  const record: PlatformPackRegistrationRecord = {
    packId: pack.manifest.metadata.id,
    packVersion: pack.manifest.metadata.version,
    connectorId: definition.connectorId,
    platformId: pack.contract.platform.platformId,
    source: source?.trim() || existing?.source || 'runtime',
    installedAtMs:
      (typeof installedAtMs === 'number' && Number.isFinite(installedAtMs)
        ? installedAtMs
        : undefined) ??
      existing?.installedAtMs ??
      Date.now(),
    definition,
    compat: compatRegistration,
  };

  platformPackRegistry.set(record.connectorId, cloneRecord(record));
  emitRegistryChanged();
  return cloneRecord(record);
}

function registerPlatformPackRuntimeArtifacts(
  pack: ParsedPlatformPack,
  definition: PlatformConnectorDefinition,
  adapter: PlatformConnectorAdapter,
  runtime: PlatformCompatRuntimeApi,
  authBindingProvider: PlatformInstanceAuthBindingProvider | null,
  bindingProvider: PlatformInstanceApiBindingProvider | null,
  hostRuntimeSupport: PlatformPackHostRuntimeSupport | null,
  options: {
    source?: string;
    runtimeAdapter: string;
    installedAtMs?: number;
  }
): PlatformPackRegistrationRecord {
  const previousSidecarEntryPath =
    platformPackSidecarEntryPathRegistry.get(definition.connectorId) ?? '';
  const nextSidecarEntryPath = normalizeString(pack.sidecarPath);
  if (previousSidecarEntryPath && previousSidecarEntryPath !== nextSidecarEntryPath) {
    void disposePlatformPackSidecar(
      definition.connectorId,
      previousSidecarEntryPath,
      'platform-pack-reload'
    );
  }
  if (nextSidecarEntryPath) {
    platformPackSidecarEntryPathRegistry.set(definition.connectorId, nextSidecarEntryPath);
  } else {
    platformPackSidecarEntryPathRegistry.delete(definition.connectorId);
  }

  const nextHostRuntimeSupport: PlatformPackHostRuntimeSupport = {
    connectorId: definition.connectorId,
    authAdapter: hostRuntimeSupport?.authAdapter ?? null,
    authBindingProvider:
      authBindingProvider ??
      hostRuntimeSupport?.authBindingProvider ??
      null,
    apiBindingProvider:
      bindingProvider ??
      hostRuntimeSupport?.apiBindingProvider ??
      null,
  };
  platformPackHostRuntimeSupportRegistry.set(
    definition.connectorId,
    cloneHostRuntimeSupport(nextHostRuntimeSupport)
  );

  registerPlatformConnectorAdapter(adapter);
  const compatRegistration = buildCompatRegistration(
    pack,
    definition,
    runtime,
    options.runtimeAdapter
  );
  registerPlatformCompatRegistrationForConnector(compatRegistration);
  return upsertPlatformPackRecord(
    pack,
    definition,
    compatRegistration,
    options.source,
    options.installedAtMs
  );
}

async function installParsedPlatformPack(
  pack: ParsedPlatformPack,
  options: {
    source?: string;
    hostRuntimeSupport?: PlatformPackHostRuntimeSupport | null;
    installedAtMs?: number;
  } = {}
): Promise<PlatformPackRegistrationRecord> {
  const definition = buildDefinitionFromPack(pack);
  const { adapter, runtime, authBindingProvider, bindingProvider } =
    await resolveAdapterAndRuntime(pack, definition);
  return registerPlatformPackRuntimeArtifacts(
    pack,
    definition,
    adapter,
    runtime,
    authBindingProvider,
    bindingProvider,
    options.hostRuntimeSupport ?? null,
    {
      source: options.source,
      runtimeAdapter: 'platformPackRuntime',
      installedAtMs: options.installedAtMs,
    }
  );
}

async function bootstrapBuiltinPlatformPacksFromAssets(): Promise<void> {
  const assets = await loadBuiltinPlatformPackAssets();
  for (const asset of assets) {
    if (platformPackRegistry.has(asset.connectorId)) continue;
    await installParsedPlatformPack(asset.pack, {
      source: asset.source,
    });
  }
}

async function ensureBuiltinPlatformPacksInstalledInStore(): Promise<void> {
  const assets = await loadBuiltinPlatformPackAssets();
  for (const asset of assets) {
    const storedRecord = await installPlatformPackToStorage(asset.pack, {
      sourceType: 'builtin',
      source: asset.source,
    });
    await registerInstalledPlatformPackRecord(storedRecord);
  }
}

async function reconcileBuiltinPlatformPacksInBackground(): Promise<void> {
  await ensureBuiltinPlatformPacksInstalledInStore();
}

async function runBuiltinPlatformPackBootSequence(): Promise<void> {
  try {
    await refreshInstalledPlatformPackRegistrationsFromStore();
  } catch {
    // Ignore store bootstrap failures and keep builtin pack recovery in the background path.
  } finally {
    ensureInstalledPlatformPackStoreSync();
  }

  if (platformPackRegistry.size < 1) {
    try {
      await reconcileBuiltinPlatformPacksInBackground();
    } catch {
      // Keep the registry best-effort during early startup.
    }
    return;
  }

  scheduleBuiltinPlatformPackBackgroundReconcile(false);
}

function scheduleBuiltinPlatformPackBackgroundReconcile(immediate = false): void {
  if (builtinPlatformPackBackgroundReconcileScheduled) {
    return;
  }
  builtinPlatformPackBackgroundReconcileScheduled = true;

  const run = () => {
    void reconcileBuiltinPlatformPacksInBackground().finally(() => {
      builtinPlatformPackBackgroundReconcileScheduled = false;
    });
  };

  if (immediate) {
    scheduleAfterFirstPaint(run);
    return;
  }

  scheduleWhenBrowserIdle(run, 5000);
}

function scheduleBuiltinPlatformPackBootInTauriRuntime(): void {
  if (builtinPlatformPackBootScheduled) {
    return;
  }
  builtinPlatformPackBootScheduled = true;
  builtinPlatformPackBootPromise = new Promise((resolve) => {
    scheduleAfterFirstPaint(() => {
      void runBuiltinPlatformPackBootSequence().finally(resolve);
    });
  });
}

export function ensureBuiltinPlatformPackRegistrationsInitialized(): void {
  ensurePlatformPackRegistryBootstrapRegistered();
  if (builtinPlatformPackRegistrationsInitialized) return;
  builtinPlatformPackRegistrationsInitialized = true;

  if (typeof window === 'undefined') return;

  if (!isTauriRuntime()) {
    void bootstrapBuiltinPlatformPacksFromAssets().catch(() => {
      // Keep the registry usable even if builtin pack assets are unavailable in this runtime.
    });
    return;
  }

  scheduleBuiltinPlatformPackBootInTauriRuntime();
}

export async function awaitBuiltinPlatformPackRegistrationsReady(): Promise<void> {
  ensureBuiltinPlatformPackRegistrationsInitialized();
  await (builtinPlatformPackBootPromise ?? Promise.resolve());
}

export async function installPlatformPackFromZipBytes(
  bytes: Uint8Array,
  options: { source?: string } = {}
): Promise<PlatformPackRegistrationRecord> {
  const pack = await parsePlatformPackFromZipBytes(bytes);
  if (!isTauriRuntime()) {
    return await installParsedPlatformPack(pack, options);
  }

  const storedRecord = await installPlatformPackToStorage(pack, {
    sourceType: 'external',
    source: options.source,
  });
  const registration = await registerInstalledPlatformPackRecord(storedRecord);
  if (!registration) {
    throw new Error(
      `Failed to register installed platform pack (${storedRecord.connectorId})`
    );
  }
  return registration;
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
  ensureBuiltinPlatformPackRegistrationsInitialized();
  return Array.from(platformPackRegistry.values()).map(cloneRecord);
}

export function resolvePlatformPackHostRuntimeSupport(
  connectorId: string
): PlatformPackHostRuntimeSupport | null {
  ensureBuiltinPlatformPackRegistrationsInitialized();
  let normalizedConnectorId: PlatformConnectorId;
  try {
    normalizedConnectorId = normalizePackConnectorId(connectorId);
  } catch {
    return null;
  }
  const support = platformPackHostRuntimeSupportRegistry.get(normalizedConnectorId);
  return support ? cloneHostRuntimeSupport(support) : null;
}

export function listPlatformPackHostRuntimeSupports(): PlatformPackHostRuntimeSupport[] {
  ensureBuiltinPlatformPackRegistrationsInitialized();
  return Array.from(platformPackHostRuntimeSupportRegistry.values()).map(
    cloneHostRuntimeSupport
  );
}

export function resolvePlatformPackAuthAdapter(
  connectorId: string
): PlatformInstanceAuthAdapter | null {
  return resolvePlatformPackHostRuntimeSupport(connectorId)?.authAdapter ?? null;
}

export function listPlatformPackAuthAdapters(): PlatformInstanceAuthAdapter[] {
  const supports = listPlatformPackHostRuntimeSupports();
  return supports
    .map((support) => support.authAdapter ?? null)
    .filter((adapter): adapter is PlatformInstanceAuthAdapter => Boolean(adapter));
}

export function resolvePlatformPackInstanceAuthBindingProvider(
  connectorId: string
): PlatformInstanceAuthBindingProvider | null {
  return resolvePlatformPackHostRuntimeSupport(connectorId)?.authBindingProvider ?? null;
}

export function listPlatformPackInstanceAuthBindingProviders(): PlatformInstanceAuthBindingProvider[] {
  const supports = listPlatformPackHostRuntimeSupports();
  return supports
    .map((support) => support.authBindingProvider ?? null)
    .filter(
      (provider): provider is PlatformInstanceAuthBindingProvider => Boolean(provider)
    );
}

export function resolvePlatformPackInstanceApiBindingProvider(
  connectorId: string
): PlatformInstanceApiBindingProvider | null {
  return resolvePlatformPackHostRuntimeSupport(connectorId)?.apiBindingProvider ?? null;
}

export function listPlatformPackInstanceApiBindingProviders(): PlatformInstanceApiBindingProvider[] {
  const supports = listPlatformPackHostRuntimeSupports();
  return supports
    .map((support) => support.apiBindingProvider ?? null)
    .filter(
      (provider): provider is PlatformInstanceApiBindingProvider => Boolean(provider)
    );
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
  platformPackHostRuntimeSupportRegistry.delete(normalizedConnectorId);
  const sidecarEntryPath =
    platformPackSidecarEntryPathRegistry.get(normalizedConnectorId) ?? '';
  platformPackSidecarEntryPathRegistry.delete(normalizedConnectorId);
  if (sidecarEntryPath) {
    void disposePlatformPackSidecar(
      normalizedConnectorId,
      sidecarEntryPath,
      'platform-pack-unregister'
    );
  }
  unregisterPlatformCompatRegistrationForConnector(normalizedConnectorId);
  unregisterPlatformConnectorAdapter(normalizedConnectorId);
  emitRegistryChanged();
  return true;
}

export function subscribePlatformPackRegistrations(
  listener: PlatformPackRegistryListener
): () => void {
  ensureBuiltinPlatformPackRegistrationsInitialized();
  platformPackRegistryListeners.add(listener);
  return () => {
    platformPackRegistryListeners.delete(listener);
  };
}
