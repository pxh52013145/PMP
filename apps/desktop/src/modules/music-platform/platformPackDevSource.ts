import type { PlatformCompatContractFile } from '@pixel-matrix/plugin-platform-contracts';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  parsePlatformCompatContractFromJson,
  validatePlatformCompatContract,
} from './platformCompatContractSchema';
import {
  type PlatformPackManifestV1,
  type ParsedPlatformPack,
  validatePlatformPackManifestV1,
} from './platformPack';

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
  contractPath?: string | null;
  contractRaw?: string | null;
  runtimePath?: string | null;
  runtimeRaw?: string | null;
  runtimeExists?: boolean | null;
  iconPath?: string | null;
  iconRawBase64?: string | null;
  iconExists?: boolean | null;
  sidecarPath?: string | null;
  sidecarExists?: boolean | null;
  diagnostics?: PlatformPackDevSourceDiagnostic[];
}

export interface PlatformPackDevSource {
  rootDir: string;
  manifestPath: string;
  manifest: PlatformPackManifestV1 | null;
  contractPath: string | null;
  contract: PlatformCompatContractFile | null;
  runtimePath: string | null;
  runtimeRaw: string | null;
  runtimeExists: boolean;
  iconPath: string | null;
  iconRawBase64: string | null;
  iconExists: boolean;
  sidecarPath: string | null;
  sidecarExists: boolean | null;
  status: PlatformPackDevSourceStatus;
  diagnostics: PlatformPackDevSourceDiagnostic[];
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNativeDiagnostics(
  diagnostics: NativePlatformPackDevSourcePayload['diagnostics']
): PlatformPackDevSourceDiagnostic[] {
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.flatMap((diagnostic): PlatformPackDevSourceDiagnostic[] => {
    const severity = diagnostic?.severity;
    const code = normalizeString(diagnostic?.code);
    const message = normalizeString(diagnostic?.message);
    if (
      (severity !== 'info' && severity !== 'warn' && severity !== 'error') ||
      !code ||
      !message
    ) {
      return [];
    }
    return [{ severity, code, message }];
  });
}

function pushDiagnostic(
  diagnostics: PlatformPackDevSourceDiagnostic[],
  diagnostic: PlatformPackDevSourceDiagnostic
): void {
  if (diagnostics.some((entry) => entry.code === diagnostic.code)) return;
  diagnostics.push(diagnostic);
}

function parseJsonText(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${label} contains invalid JSON: ${readErrorMessage(error)}`);
  }
}

function readStatus(
  diagnostics: PlatformPackDevSourceDiagnostic[]
): PlatformPackDevSourceStatus {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return 'error';
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'warn')) return 'degraded';
  return 'ready';
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

function decodeBase64(value: string): Uint8Array {
  const normalized = normalizeString(value);
  if (!normalized) return new Uint8Array();
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseManifest(
  payload: NativePlatformPackDevSourcePayload,
  diagnostics: PlatformPackDevSourceDiagnostic[]
): PlatformPackManifestV1 | null {
  const raw = normalizeString(payload.manifestRaw);
  if (!raw) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'manifest.missing',
      message: 'Platform pack manifest.json was not found or could not be read.',
    });
    return null;
  }

  let manifest: unknown;
  try {
    manifest = parseJsonText(raw, 'manifest.json');
  } catch (error) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'manifest.invalid-json',
      message: readErrorMessage(error),
    });
    return null;
  }

  try {
    validatePlatformPackManifestV1(manifest);
    return manifest;
  } catch (error) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'manifest.invalid',
      message: readErrorMessage(error),
    });
    return null;
  }
}

function parseContract(
  manifest: PlatformPackManifestV1 | null,
  payload: NativePlatformPackDevSourcePayload,
  diagnostics: PlatformPackDevSourceDiagnostic[]
): PlatformCompatContractFile | null {
  const raw = normalizeString(payload.contractRaw);
  if (!manifest || !raw) return null;

  const sourceLabel = `platform-pack-dev:${manifest.metadata.id}:${manifest.entry.contract}`;
  let contractJson: unknown;
  try {
    contractJson = parseJsonText(raw, 'contract.json');
  } catch (error) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'contract.invalid-json',
      message: readErrorMessage(error),
    });
    return null;
  }

  try {
    const contract = parsePlatformCompatContractFromJson(contractJson, sourceLabel);
    validatePlatformCompatContract(contract, sourceLabel, {
      connectorId: manifest.connector.connectorId,
      workspaceKind: manifest.connector.workspaceKind,
      workspaceMode: manifest.connector.workspaceMode ?? 'dedicated',
    });
    return contract;
  } catch (error) {
    const message = readErrorMessage(error);
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: message.includes('connectorId mismatch')
        ? 'contract.connector-mismatch'
        : 'contract.invalid',
      message,
    });
    return null;
  }
}

function addArtifactDiagnostics(
  manifest: PlatformPackManifestV1 | null,
  payload: NativePlatformPackDevSourcePayload,
  diagnostics: PlatformPackDevSourceDiagnostic[]
): void {
  if (!manifest) return;

  if (!normalizeString(payload.contractRaw)) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'contract.entry.missing',
      message: `Contract entry is missing: ${manifest.entry.contract}`,
    });
  }
  if (!payload.runtimeExists) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'runtime.entry.missing',
      message: `Runtime entry is missing: ${manifest.entry.runtime}`,
    });
  } else if (!normalizeString(payload.runtimeRaw)) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'runtime.entry.empty',
      message: `Runtime entry is empty or could not be read: ${manifest.entry.runtime}`,
    });
  }
  if (!payload.iconExists) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'icon.entry.missing',
      message: `Icon entry is missing: ${manifest.entry.icon}`,
    });
  } else if (!guessIconMimeType(payload.iconPath)) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'icon.entry.unsupported',
      message: `Icon entry has an unsupported file type: ${manifest.entry.icon}`,
    });
  }
  if (manifest.entry.sidecar && payload.sidecarExists === false) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'sidecar.entry.missing',
      message: `Sidecar entry is missing: ${manifest.entry.sidecar}`,
    });
  }
}

export function parsePlatformPackDevSourcePayload(
  payload: NativePlatformPackDevSourcePayload
): PlatformPackDevSource {
  const diagnostics = normalizeNativeDiagnostics(payload.diagnostics);
  const manifest = parseManifest(payload, diagnostics);
  const contract = parseContract(manifest, payload, diagnostics);
  addArtifactDiagnostics(manifest, payload, diagnostics);

  return {
    rootDir: normalizeString(payload.rootDir),
    manifestPath: normalizeString(payload.manifestPath),
    manifest,
    contractPath: normalizeString(payload.contractPath) || null,
    contract,
    runtimePath: normalizeString(payload.runtimePath) || null,
    runtimeRaw: normalizeString(payload.runtimeRaw) || null,
    runtimeExists: payload.runtimeExists === true,
    iconPath: normalizeString(payload.iconPath) || null,
    iconRawBase64: normalizeString(payload.iconRawBase64) || null,
    iconExists: payload.iconExists === true,
    sidecarPath: normalizeString(payload.sidecarPath) || null,
    sidecarExists:
      typeof payload.sidecarExists === 'boolean' ? payload.sidecarExists : null,
    status: readStatus(diagnostics),
    diagnostics,
  };
}

function cloneManifest(manifest: PlatformPackManifestV1): PlatformPackManifestV1 {
  return {
    ...manifest,
    metadata: {
      ...manifest.metadata,
      tags: Array.isArray(manifest.metadata.tags)
        ? manifest.metadata.tags.slice()
        : undefined,
    },
    connector: {
      ...manifest.connector,
    },
    entry: {
      ...manifest.entry,
    },
  };
}

function cloneWorkspaceDescriptor(
  workspace: PlatformCompatContractFile['workspace'] | undefined
): PlatformCompatContractFile['workspace'] | undefined {
  if (!workspace) return undefined;
  return {
    ownership: workspace.ownership,
    requiredRuntimeCarrier: workspace.requiredRuntimeCarrier,
    root: workspace.root ? { ...workspace.root } : undefined,
    shellSlots: workspace.shellSlots?.map((slot) => ({ ...slot })),
    capabilityFamilies: workspace.capabilityFamilies
      ? {
          required: workspace.capabilityFamilies.required?.slice(),
          optional: workspace.capabilityFamilies.optional?.slice(),
        }
      : undefined,
    context: workspace.context
      ? {
          scope: workspace.context.scope,
          fields: workspace.context.fields.slice(),
        }
      : undefined,
  };
}

function cloneContract(contract: PlatformCompatContractFile): PlatformCompatContractFile {
  return {
    ...contract,
    platform: { ...contract.platform },
    auth: { ...contract.auth },
    capabilities: { ...contract.capabilities },
    apiBindings: { ...contract.apiBindings },
    workspace: cloneWorkspaceDescriptor(contract.workspace),
    extension: contract.extension ? { ...contract.extension } : undefined,
  };
}

export function createParsedPlatformPackFromDevSource(
  source: PlatformPackDevSource
): ParsedPlatformPack {
  const blockingDiagnostic = source.diagnostics.find(
    (diagnostic) => diagnostic.severity === 'error'
  );
  if (blockingDiagnostic) {
    throw new Error(blockingDiagnostic.message);
  }
  if (!source.manifest || !source.contract) {
    throw new Error('Platform pack dev source requires a valid manifest and contract');
  }
  if (!source.runtimePath || !source.runtimeRaw?.trim()) {
    throw new Error('Platform pack dev source requires a readable runtime entry');
  }
  if (!source.iconPath || !source.iconRawBase64) {
    throw new Error('Platform pack dev source requires a readable icon entry');
  }

  const iconMimeType = guessIconMimeType(source.iconPath);
  if (!iconMimeType) {
    throw new Error(`Platform pack icon entry has an unsupported file type: ${source.iconPath}`);
  }
  const iconBytes = decodeBase64(source.iconRawBase64);

  return {
    manifest: cloneManifest(source.manifest),
    contractPath: source.manifest.entry.contract,
    contract: cloneContract(source.contract),
    workspace: cloneWorkspaceDescriptor(source.contract.workspace) ?? null,
    runtimePath: source.runtimePath,
    runtimeCode: source.runtimeRaw,
    iconPath: source.iconPath,
    iconBytes,
    iconAssetUrl: `data:${iconMimeType};base64,${source.iconRawBase64}`,
    iconMimeType,
    sidecarPath: source.sidecarPath ?? undefined,
    files: [],
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
