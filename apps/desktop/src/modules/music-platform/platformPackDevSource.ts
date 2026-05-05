import type { PlatformCompatContractFile } from '@pixel-matrix/plugin-platform-contracts';

import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';

export type PlatformPackConnectorTemplate = 'music' | 'video' | 'generic';
export type PlatformPackWorkspaceMode = 'generic-only' | 'dedicated';
export type PlatformPackAuthFlow = 'qr' | 'none';

export interface PlatformPackManifestV1 {
  formatVersion: '1.0';
  type: 'platform-pack';
  metadata: {
    id: string;
    name: string;
    version: string;
    author?: string;
    description?: string;
    tags?: string[];
  };
  connector: {
    connectorId: string;
    displayName?: string;
    labelKey?: string;
    iconKey?: string;
    platformTemplate?: PlatformPackConnectorTemplate;
    workspaceKind: string;
    workspaceMode?: PlatformPackWorkspaceMode;
    authFlow?: PlatformPackAuthFlow;
    enabled?: boolean;
    sortOrder?: number;
    accentColor?: string;
  };
  entry: {
    contract: string;
    runtime: string;
    icon: string;
    sidecar?: string;
  };
}

export type PlatformPackDevDiagnosticSeverity = 'info' | 'warn' | 'error';
export type PlatformPackDevSourceStatus = 'ready' | 'degraded' | 'error';

export interface PlatformPackDevSourceDiagnostic {
  severity: PlatformPackDevDiagnosticSeverity;
  code: string;
  message: string;
}

export interface NativePlatformPackDevSourcePayload {
  rootDir: string;
  manifestPath: string;
  manifestRaw?: string | null;
  manifest?: PlatformPackManifestV1 | null;
  manifestModifiedAtMs?: number | null;
  contractPath?: string | null;
  contractRaw?: string | null;
  contract?: PlatformCompatContractFile | null;
  contractModifiedAtMs?: number | null;
  runtimePath?: string | null;
  runtimeRaw?: string | null;
  runtimeExists?: boolean | null;
  runtimeModifiedAtMs?: number | null;
  iconPath?: string | null;
  iconRawBase64?: string | null;
  iconExists?: boolean | null;
  iconModifiedAtMs?: number | null;
  sidecarPath?: string | null;
  sidecarExists?: boolean | null;
  sidecarModifiedAtMs?: number | null;
  diagnostics?: PlatformPackDevSourceDiagnostic[];
}

export interface PlatformPackDevSource {
  rootDir: string;
  manifestPath: string;
  manifestRaw: string | null;
  manifest: PlatformPackManifestV1 | null;
  manifestModifiedAtMs: number | null;
  contractPath: string | null;
  contractRaw: string | null;
  contract: PlatformCompatContractFile | null;
  contractModifiedAtMs: number | null;
  runtimePath: string | null;
  runtimeRaw: string | null;
  runtimeExists: boolean;
  runtimeModifiedAtMs: number | null;
  iconPath: string | null;
  iconRawBase64: string | null;
  iconExists: boolean;
  iconModifiedAtMs: number | null;
  sidecarPath: string | null;
  sidecarExists: boolean | null;
  sidecarModifiedAtMs: number | null;
  status: PlatformPackDevSourceStatus;
  diagnostics: PlatformPackDevSourceDiagnostic[];
}

export interface PlatformPackFileFingerprint {
  path: string | null;
  exists: boolean | null;
  content: string | null;
  modifiedAtMs: number | null;
}

export interface PlatformPackDevSourceSnapshot {
  rootDir: string;
  manifest: PlatformPackFileFingerprint;
  contract: PlatformPackFileFingerprint;
  runtime: PlatformPackFileFingerprint;
  icon: PlatformPackFileFingerprint;
  sidecar: PlatformPackFileFingerprint;
}

type PlatformPackDevSourceFileKey = 'manifest' | 'contract' | 'runtime' | 'icon' | 'sidecar';

const PLATFORM_PACK_DEV_SOURCE_FILE_KEYS = [
  'manifest',
  'contract',
  'runtime',
  'icon',
  'sidecar',
] as const satisfies readonly PlatformPackDevSourceFileKey[];

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRawString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJsonText(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${label} contains invalid JSON: ${readErrorMessage(error)}`);
  }
}

function pushDiagnostic(
  diagnostics: PlatformPackDevSourceDiagnostic[],
  diagnostic: PlatformPackDevSourceDiagnostic
): void {
  if (diagnostics.some((entry) => entry.code === diagnostic.code)) return;
  diagnostics.push(diagnostic);
}

function readStatus(diagnostics: PlatformPackDevSourceDiagnostic[]): PlatformPackDevSourceStatus {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return 'error';
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'warn')) return 'degraded';
  return 'ready';
}

function toRelativePath(value: unknown, label: string): string {
  const normalized = normalizeString(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`${label} must be relative`);
  }
  if (normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} contains invalid segments`);
  }
  return normalized;
}

function validateManifest(manifest: unknown): PlatformPackManifestV1 {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('manifest.json must be an object');
  }
  const value = manifest as Record<string, unknown>;
  if (value.formatVersion !== '1.0') {
    throw new Error('manifest.formatVersion must be "1.0"');
  }
  if (value.type !== 'platform-pack') {
    throw new Error('manifest.type must be "platform-pack"');
  }

  const metadata = value.metadata as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('manifest.metadata must be an object');
  }
  const connector = value.connector as Record<string, unknown> | undefined;
  if (!connector || typeof connector !== 'object' || Array.isArray(connector)) {
    throw new Error('manifest.connector must be an object');
  }
  const entry = value.entry as Record<string, unknown> | undefined;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('manifest.entry must be an object');
  }

  const connectorId = normalizeString(connector.connectorId).toLowerCase();
  if (!connectorId.startsWith('connector.platform.')) {
    throw new Error('manifest.connector.connectorId must start with connector.platform.');
  }

  const normalized: PlatformPackManifestV1 = {
    formatVersion: '1.0',
    type: 'platform-pack',
    metadata: {
      id: normalizeString(metadata.id),
      name: normalizeString(metadata.name),
      version: normalizeString(metadata.version),
      author: normalizeString(metadata.author) || undefined,
      description: normalizeString(metadata.description) || undefined,
      tags: Array.isArray(metadata.tags)
        ? metadata.tags.map((item) => normalizeString(item)).filter(Boolean)
        : undefined,
    },
    connector: {
      connectorId,
      displayName: normalizeString(connector.displayName) || undefined,
      labelKey: normalizeString(connector.labelKey) || undefined,
      iconKey: normalizeString(connector.iconKey) || undefined,
      platformTemplate:
        normalizeString(connector.platformTemplate) === 'music' ||
        normalizeString(connector.platformTemplate) === 'video' ||
        normalizeString(connector.platformTemplate) === 'generic'
          ? (normalizeString(connector.platformTemplate) as PlatformPackConnectorTemplate)
          : undefined,
      workspaceKind: normalizeString(connector.workspaceKind),
      workspaceMode:
        normalizeString(connector.workspaceMode) === 'generic-only' ||
        normalizeString(connector.workspaceMode) === 'dedicated'
          ? (normalizeString(connector.workspaceMode) as PlatformPackWorkspaceMode)
          : undefined,
      authFlow:
        normalizeString(connector.authFlow) === 'qr' || normalizeString(connector.authFlow) === 'none'
          ? (normalizeString(connector.authFlow) as PlatformPackAuthFlow)
          : undefined,
      enabled:
        typeof connector.enabled === 'boolean' ? connector.enabled : undefined,
      sortOrder:
        typeof connector.sortOrder === 'number' && Number.isFinite(connector.sortOrder)
          ? connector.sortOrder
          : undefined,
      accentColor: normalizeString(connector.accentColor) || undefined,
    },
    entry: {
      contract: toRelativePath(entry.contract, 'manifest.entry.contract'),
      runtime: toRelativePath(entry.runtime, 'manifest.entry.runtime'),
      icon: toRelativePath(entry.icon, 'manifest.entry.icon'),
      sidecar:
        typeof entry.sidecar === 'undefined'
          ? undefined
          : toRelativePath(entry.sidecar, 'manifest.entry.sidecar'),
    },
  };

  if (!normalized.metadata.id) {
    throw new Error('manifest.metadata.id is required');
  }
  if (!normalized.metadata.name) {
    throw new Error('manifest.metadata.name is required');
  }
  if (!normalized.metadata.version) {
    throw new Error('manifest.metadata.version is required');
  }
  if (!normalized.connector.workspaceKind) {
    throw new Error('manifest.connector.workspaceKind is required');
  }

  return normalized;
}

function validateContract(contract: unknown): PlatformCompatContractFile {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new Error('contract.json must be an object');
  }
  const value = contract as Record<string, unknown>;
  if (value.contractVersion !== '1.0') {
    throw new Error('contract.contractVersion must be "1.0"');
  }
  const platform = value.platform as Record<string, unknown> | undefined;
  const auth = value.auth as Record<string, unknown> | undefined;
  const capabilities = value.capabilities as Record<string, unknown> | undefined;
  const apiBindings = value.apiBindings as Record<string, unknown> | undefined;
  if (!platform || typeof platform !== 'object' || Array.isArray(platform)) {
    throw new Error('contract.platform must be an object');
  }
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
    throw new Error('contract.auth must be an object');
  }
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    throw new Error('contract.capabilities must be an object');
  }
  if (!apiBindings || typeof apiBindings !== 'object' || Array.isArray(apiBindings)) {
    throw new Error('contract.apiBindings must be an object');
  }

  const connectorId = normalizeString(value.extension && (value.extension as Record<string, unknown>).connectorId).toLowerCase();

  return {
    contractVersion: '1.0',
    platform: {
      platformId: normalizeString(platform.platformId),
      displayName: normalizeString(platform.displayName),
      staticIcon: normalizeString(platform.staticIcon),
      vendor: normalizeString(platform.vendor) || undefined,
      supportsMultiInstance:
        typeof platform.supportsMultiInstance === 'boolean' ? platform.supportsMultiInstance : false,
    },
    auth: {
      loginMode:
        normalizeString(auth.loginMode) === 'none' ||
        normalizeString(auth.loginMode) === 'cookie' ||
        normalizeString(auth.loginMode) === 'qr' ||
        normalizeString(auth.loginMode) === 'cookie+qr'
          ? (normalizeString(auth.loginMode) as PlatformCompatContractFile['auth']['loginMode'])
          : 'none',
      requiresCookie: auth.requiresCookie === true,
      requiresAccountId: auth.requiresAccountId === true,
      supportsRefresh: auth.supportsRefresh === true,
    },
    capabilities: {
      playlists: capabilities.playlists === true,
      favorites: capabilities.favorites === true,
      dailyRecommendations: capabilities.dailyRecommendations === true,
      search: capabilities.search === true,
      quality: capabilities.quality === true,
      navigation: capabilities.navigation === true,
      settings: capabilities.settings === true,
      pages: capabilities.pages === true,
    },
    apiBindings: {
      auth: normalizeString(apiBindings.auth),
      library: normalizeString(apiBindings.library) || undefined,
      recommendations: normalizeString(apiBindings.recommendations) || undefined,
      search: normalizeString(apiBindings.search) || undefined,
      quality: normalizeString(apiBindings.quality) || undefined,
      navigation: normalizeString(apiBindings.navigation) || undefined,
      settings: normalizeString(apiBindings.settings) || undefined,
      pages: normalizeString(apiBindings.pages) || undefined,
    },
    workspace: value.workspace as PlatformCompatContractFile['workspace'] | undefined,
    extension:
      connectorId || value.extension
        ? {
            ...(value.extension as Record<string, unknown> | undefined),
          }
        : undefined,
  };
}

function guessIconMimeType(path: string | null | undefined): string | null {
  const normalized = normalizeString(path).toLowerCase();
  if (normalized.endsWith('.svg')) return 'image/svg+xml';
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.ico')) return 'image/x-icon';
  return null;
}

function normalizeNativeDiagnostics(
  diagnostics: NativePlatformPackDevSourcePayload['diagnostics']
): PlatformPackDevSourceDiagnostic[] {
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.flatMap((diagnostic): PlatformPackDevSourceDiagnostic[] => {
    const severity = diagnostic?.severity;
    const code = normalizeString(diagnostic?.code);
    const message = normalizeString(diagnostic?.message);
    if ((severity !== 'info' && severity !== 'warn' && severity !== 'error') || !code || !message) {
      return [];
    }
    return [{ severity, code, message }];
  });
}

function readNativeObject<T>(value: unknown): T | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
}

function readOptionalTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parsePlatformPackDevSourcePayload(
  payload: NativePlatformPackDevSourcePayload
): PlatformPackDevSource {
  const diagnostics = normalizeNativeDiagnostics(payload.diagnostics);
  const manifestRaw = readRawString(payload.manifestRaw);
  const contractRaw = readRawString(payload.contractRaw);
  const runtimeRaw = readRawString(payload.runtimeRaw);
  const iconRawBase64 = readRawString(payload.iconRawBase64);
  const manifestPath = normalizeString(payload.manifestPath);
  const contractPath = normalizeString(payload.contractPath) || null;
  const runtimePath = normalizeString(payload.runtimePath) || null;
  const iconPath = normalizeString(payload.iconPath) || null;
  const sidecarPath = normalizeString(payload.sidecarPath) || null;
  const nativeManifest = readNativeObject<PlatformPackManifestV1>(payload.manifest);
  const manifest =
    nativeManifest ??
    (manifestRaw
      ? (() => {
          try {
            return validateManifest(parseJsonText(manifestRaw, 'manifest.json'));
          } catch (error) {
            pushDiagnostic(diagnostics, {
              severity: 'error',
              code: 'manifest.invalid',
              message: readErrorMessage(error),
            });
            return null;
          }
        })()
      : (() => {
          pushDiagnostic(diagnostics, {
            severity: 'error',
            code: 'manifest.missing',
            message: 'Platform pack manifest.json was not found or could not be read.',
          });
          return null;
        })());

  const nativeContract = manifest
    ? readNativeObject<PlatformCompatContractFile>(payload.contract)
    : null;
  const contract =
    manifest && nativeContract
      ? nativeContract
      : manifest && contractRaw
        ? (() => {
            try {
              const parsed = validateContract(parseJsonText(contractRaw, 'contract.json'));
              const manifestConnectorId = manifest.connector.connectorId.toLowerCase();
              const extensionConnectorId = normalizeString(
                parsed.extension && (parsed.extension as Record<string, unknown>).connectorId
              ).toLowerCase();
              if (extensionConnectorId && extensionConnectorId !== manifestConnectorId) {
                throw new Error(
                  `contract.extension.connectorId must match manifest.connector.connectorId (${manifestConnectorId})`
                );
              }
              return parsed;
            } catch (error) {
              pushDiagnostic(diagnostics, {
                severity: 'error',
                code: 'contract.invalid',
                message: readErrorMessage(error),
              });
              return null;
            }
          })()
        : null;

  if (manifest && !contractRaw) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'contract.missing',
      message: `Contract entry is missing: ${manifest.entry.contract}`,
    });
  }
  if (manifest && !runtimePath) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'runtime.entry.missing',
      message: `Runtime entry is missing: ${manifest.entry.runtime}`,
    });
  } else if (manifest && runtimeRaw !== null && runtimeRaw.trim() === '') {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'runtime.entry.empty',
      message: `Runtime entry is empty or could not be read: ${manifest.entry.runtime}`,
    });
  }
  if (manifest && !iconPath) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'icon.entry.missing',
      message: `Icon entry is missing: ${manifest.entry.icon}`,
    });
  } else if (manifest && iconPath && !guessIconMimeType(iconPath)) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'icon.entry.unsupported',
      message: `Icon entry has an unsupported file type: ${manifest.entry.icon}`,
    });
  }
  if (manifest && manifest.entry.sidecar && payload.sidecarExists === false) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'sidecar.entry.missing',
      message: `Sidecar entry is missing: ${manifest.entry.sidecar}`,
    });
  }

  return {
    rootDir: normalizeString(payload.rootDir),
    manifestPath,
    manifestRaw,
    manifest,
    manifestModifiedAtMs: readOptionalTimestamp(payload.manifestModifiedAtMs),
    contractPath,
    contractRaw,
    contract,
    contractModifiedAtMs: readOptionalTimestamp(payload.contractModifiedAtMs),
    runtimePath,
    runtimeRaw,
    runtimeExists: payload.runtimeExists === true,
    runtimeModifiedAtMs: readOptionalTimestamp(payload.runtimeModifiedAtMs),
    iconPath,
    iconRawBase64,
    iconExists: payload.iconExists === true,
    iconModifiedAtMs: readOptionalTimestamp(payload.iconModifiedAtMs),
    sidecarPath,
    sidecarExists:
      typeof payload.sidecarExists === 'boolean' ? payload.sidecarExists : null,
    sidecarModifiedAtMs: readOptionalTimestamp(payload.sidecarModifiedAtMs),
    status: readStatus(diagnostics),
    diagnostics,
  };
}

export function createPlatformPackDevSourceSnapshot(
  source: PlatformPackDevSource
): PlatformPackDevSourceSnapshot {
  return {
    rootDir: source.rootDir,
    manifest: {
      path: source.manifestPath,
      exists: source.manifestRaw !== null,
      content: source.manifestRaw,
      modifiedAtMs: source.manifestModifiedAtMs,
    },
    contract: {
      path: source.contractPath,
      exists: source.contractRaw !== null,
      content: source.contractRaw,
      modifiedAtMs: source.contractModifiedAtMs,
    },
    runtime: {
      path: source.runtimePath,
      exists: source.runtimeExists,
      content: source.runtimeRaw,
      modifiedAtMs: source.runtimeModifiedAtMs,
    },
    icon: {
      path: source.iconPath,
      exists: source.iconExists,
      content: source.iconRawBase64,
      modifiedAtMs: source.iconModifiedAtMs,
    },
    sidecar: {
      path: source.sidecarPath,
      exists: source.sidecarExists,
      content: null,
      modifiedAtMs: source.sidecarModifiedAtMs,
    },
  };
}

export function inspectPlatformPackDevSourceChanges(
  previous: PlatformPackDevSourceSnapshot | null,
  current: PlatformPackDevSourceSnapshot
): {
  changedFiles: Array<'manifest' | 'contract' | 'runtime' | 'icon' | 'sidecar'>;
  changeKind: 'initial' | 'runtime-only' | 'manifest-contract' | 'asset' | 'sidecar' | 'mixed' | 'none';
  requiresConfirmation: boolean;
  canAutoReload: boolean;
  changeKey: string;
} {
  if (!previous) {
    const changedFiles: PlatformPackDevSourceFileKey[] =
      PLATFORM_PACK_DEV_SOURCE_FILE_KEYS.filter((key) =>
        Boolean(current[key].content || current[key].exists !== null)
      );
    return {
      changedFiles,
      changeKind: 'initial',
      requiresConfirmation: false,
      canAutoReload: false,
      changeKey: JSON.stringify(current),
    };
  }

  const changedFiles: Array<'manifest' | 'contract' | 'runtime' | 'icon' | 'sidecar'> = [];
  for (const key of PLATFORM_PACK_DEV_SOURCE_FILE_KEYS) {
    const next = current[key];
    const prev = previous[key];
    if (
      next.path !== prev.path ||
      next.exists !== prev.exists ||
      next.content !== prev.content ||
      next.modifiedAtMs !== prev.modifiedAtMs
    ) {
      changedFiles.push(key);
    }
  }

  const changeKind =
    changedFiles.length === 0
      ? 'none'
      : changedFiles.length === 1 && changedFiles[0] === 'runtime'
        ? 'runtime-only'
        : changedFiles.some((key) => key === 'manifest' || key === 'contract')
          ? 'manifest-contract'
          : changedFiles.length === 1 && changedFiles[0] === 'sidecar'
            ? 'sidecar'
            : changedFiles.length === 1 && changedFiles[0] === 'icon'
              ? 'asset'
              : 'mixed';

  return {
    changedFiles,
    changeKind,
    requiresConfirmation: changeKind === 'manifest-contract' || changeKind === 'sidecar',
    canAutoReload: changeKind === 'runtime-only',
    changeKey: JSON.stringify({
      manifest: current.manifest,
      contract: current.contract,
      runtime: current.runtime,
      icon: current.icon,
      sidecar: current.sidecar,
    }),
  };
}

export async function readPlatformPackDevSourceFromPath(
  filePath: string
): Promise<PlatformPackDevSource> {
  if (!isTauriRuntime()) {
    throw new Error('Reading platform pack development sources requires the Tauri desktop runtime');
  }

  const payload = await invokeWithTelemetry<NativePlatformPackDevSourcePayload>(
    'plugin_read_platform_pack_dev_source',
    { filePath },
    {
      moduleId: 'music-platform',
      component: 'platformPackDevSource',
      event: 'music-platform.pack.dev_source.read',
    }
  );
  return parsePlatformPackDevSourcePayload(payload);
}
