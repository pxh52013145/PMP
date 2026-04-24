import { strFromU8, unzip } from 'fflate';
import type { Unzipped } from 'fflate';
import type { PlatformCompatContractFile } from '@pixel-matrix/plugin-platform-contracts';
import {
  parsePlatformCompatContractFromJson,
  readContractString,
  validatePlatformCompatContract,
} from './platformCompatContractSchema';

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

export interface ParsedPlatformPack {
  manifest: PlatformPackManifestV1;
  contractPath: string;
  contract: PlatformCompatContractFile;
  workspace: PlatformCompatContractFile['workspace'] | null;
  runtimePath: string;
  runtimeCode: string;
  runtimeImportUrl?: string;
  iconPath: string;
  iconBytes: Uint8Array;
  iconAssetUrl: string;
  iconMimeType: string;
  sidecarPath?: string;
  files: Array<{
    relativePath: string;
    bytes: Uint8Array;
  }>;
}

async function unzipAsync(bytes: Uint8Array): Promise<Unzipped> {
  return await new Promise((resolve, reject) => {
    unzip(bytes, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    });
  });
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function normalizePackRelativePath(path: string, label = 'path'): string {
  const normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`${label} must be relative`);
  }

  const segments = normalized.split('/');
  if (
    segments.some(
      (segment) => segment.length < 1 || segment === '.' || segment === '..'
    )
  ) {
    throw new Error(`${label} contains invalid segments`);
  }

  return normalized;
}

function findZipEntry(
  files: Record<string, Uint8Array>,
  filename: string,
  rootPrefix = ''
): { relativePath: string; bytes: Uint8Array } | null {
  const target = normalizePackRelativePath(filename, 'platform pack entry').toLowerCase();
  const normalizedRootPrefix = rootPrefix
    ? `${normalizePackRelativePath(
        rootPrefix.replace(/\/+$/, ''),
        'platform pack root prefix'
      ).toLowerCase()}/`
    : '';

  for (const [key, value] of Object.entries(files)) {
    let normalized: string;
    try {
      normalized = normalizePackRelativePath(key, `platform pack archive entry (${key})`);
    } catch {
      continue;
    }

    const candidate = normalized.toLowerCase();
    if (
      (normalizedRootPrefix
        ? candidate === `${normalizedRootPrefix}${target}`
        : candidate === target || candidate.endsWith(`/${target}`))
    ) {
      return {
        relativePath: normalized,
        bytes: value,
      };
    }
  }

  return null;
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  const next = readContractString(value);
  return next.length > 0 ? next : undefined;
}

function toSafeManifestId(value: unknown, path: string): string {
  const id = readContractString(value);
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`${path} must match /^[a-z0-9-]+$/`);
  }
  return id;
}

function toNonEmptyString(value: unknown, path: string): string {
  const next = readContractString(value);
  if (!next) {
    throw new Error(`${path} is required`);
  }
  return next;
}

function toConnectorId(value: unknown, path: string): string {
  const connectorId = toNonEmptyString(value, path).toLowerCase();
  if (!connectorId.startsWith('connector.platform.')) {
    throw new Error(`${path} must start with connector.platform.`);
  }
  return connectorId;
}

function toPlatformTemplate(
  value: unknown,
  path: string
): PlatformPackConnectorTemplate | undefined {
  if (typeof value === 'undefined') return undefined;
  const normalized = readContractString(value);
  if (normalized === 'music' || normalized === 'video' || normalized === 'generic') {
    return normalized;
  }
  throw new Error(`${path} must be "music" | "video" | "generic"`);
}

function toWorkspaceMode(value: unknown, path: string): PlatformPackWorkspaceMode | undefined {
  if (typeof value === 'undefined') return undefined;
  const normalized = readContractString(value);
  if (normalized === 'generic-only' || normalized === 'dedicated') {
    return normalized;
  }
  throw new Error(`${path} must be "generic-only" | "dedicated"`);
}

function toAuthFlow(value: unknown, path: string): PlatformPackAuthFlow | undefined {
  if (typeof value === 'undefined') return undefined;
  const normalized = readContractString(value);
  if (normalized === 'qr' || normalized === 'none') {
    return normalized;
  }
  throw new Error(`${path} must be "qr" | "none"`);
}

export function validatePlatformPackManifestV1(manifest: unknown): asserts manifest is PlatformPackManifestV1 {
  assertObject(manifest, 'manifest');
  if (manifest.formatVersion !== '1.0') {
    throw new Error('manifest.formatVersion must be "1.0"');
  }
  if (manifest.type !== 'platform-pack') {
    throw new Error('manifest.type must be "platform-pack"');
  }

  assertObject(manifest.metadata, 'manifest.metadata');
  manifest.metadata.id = toSafeManifestId(manifest.metadata.id, 'manifest.metadata.id');
  manifest.metadata.name = toNonEmptyString(manifest.metadata.name, 'manifest.metadata.name');
  manifest.metadata.version = toNonEmptyString(manifest.metadata.version, 'manifest.metadata.version');

  if (typeof manifest.metadata.author !== 'undefined') {
    manifest.metadata.author = toNonEmptyString(manifest.metadata.author, 'manifest.metadata.author');
  }
  if (typeof manifest.metadata.description !== 'undefined') {
    manifest.metadata.description = toNonEmptyString(
      manifest.metadata.description,
      'manifest.metadata.description'
    );
  }
  if (typeof manifest.metadata.tags !== 'undefined') {
    if (!Array.isArray(manifest.metadata.tags)) {
      throw new Error('manifest.metadata.tags must be an array');
    }
    manifest.metadata.tags = manifest.metadata.tags
      .map((item, index) => toNonEmptyString(item, `manifest.metadata.tags[${index}]`))
      .filter((item) => item.length > 0);
  }

  assertObject(manifest.connector, 'manifest.connector');
  manifest.connector.connectorId = toConnectorId(
    manifest.connector.connectorId,
    'manifest.connector.connectorId'
  );
  manifest.connector.workspaceKind = toNonEmptyString(
    manifest.connector.workspaceKind,
    'manifest.connector.workspaceKind'
  );
  manifest.connector.displayName = readOptionalTrimmedString(manifest.connector.displayName);
  manifest.connector.labelKey = readOptionalTrimmedString(manifest.connector.labelKey);
  manifest.connector.iconKey = readOptionalTrimmedString(manifest.connector.iconKey);
  manifest.connector.platformTemplate = toPlatformTemplate(
    manifest.connector.platformTemplate,
    'manifest.connector.platformTemplate'
  );
  manifest.connector.workspaceMode = toWorkspaceMode(
    manifest.connector.workspaceMode,
    'manifest.connector.workspaceMode'
  );
  manifest.connector.authFlow = toAuthFlow(
    manifest.connector.authFlow,
    'manifest.connector.authFlow'
  );
  manifest.connector.accentColor = readOptionalTrimmedString(manifest.connector.accentColor);

  if (typeof manifest.connector.enabled !== 'undefined' && typeof manifest.connector.enabled !== 'boolean') {
    throw new Error('manifest.connector.enabled must be a boolean');
  }
  if (typeof manifest.connector.sortOrder !== 'undefined') {
    if (
      typeof manifest.connector.sortOrder !== 'number' ||
      !Number.isFinite(manifest.connector.sortOrder)
    ) {
      throw new Error('manifest.connector.sortOrder must be a finite number');
    }
  }

  assertObject(manifest.entry, 'manifest.entry');
  manifest.entry.contract = normalizePackRelativePath(
    toNonEmptyString(manifest.entry.contract, 'manifest.entry.contract'),
    'manifest.entry.contract'
  );
  manifest.entry.runtime = normalizePackRelativePath(
    toNonEmptyString(manifest.entry.runtime, 'manifest.entry.runtime'),
    'manifest.entry.runtime'
  );
  manifest.entry.icon = normalizePackRelativePath(
    toNonEmptyString(manifest.entry.icon, 'manifest.entry.icon'),
    'manifest.entry.icon'
  );
  if (typeof manifest.entry.sidecar !== 'undefined') {
    manifest.entry.sidecar = normalizePackRelativePath(
      toNonEmptyString(manifest.entry.sidecar, 'manifest.entry.sidecar'),
      'manifest.entry.sidecar'
    );
  }
}

function guessIconMimeType(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const normalized = path.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.endsWith('.svg')) return 'image/svg+xml';
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.ico')) return 'image/x-icon';
  return undefined;
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

export async function parsePlatformPackFromZipBytes(bytes: Uint8Array): Promise<ParsedPlatformPack> {
  const files = await unzipAsync(bytes);

  const manifestEntry = findZipEntry(files, 'manifest.json');
  if (!manifestEntry) {
    throw new Error('Invalid platform pack: missing manifest.json');
  }
  const manifestRootPrefix =
    manifestEntry.relativePath === 'manifest.json'
      ? ''
      : manifestEntry.relativePath.slice(
          0,
          Math.max(0, manifestEntry.relativePath.lastIndexOf('/')) + 1
        );

  const manifestRaw = strFromU8(manifestEntry.bytes);
  const manifestUnknown = JSON.parse(manifestRaw) as unknown;
  validatePlatformPackManifestV1(manifestUnknown);

  const contractPath = manifestUnknown.entry.contract;
  const contractEntry = findZipEntry(files, contractPath, manifestRootPrefix);
  if (!contractEntry) {
    throw new Error(`Invalid platform pack: missing contract entry (${contractPath})`);
  }

  const contractUnknown = JSON.parse(strFromU8(contractEntry.bytes)) as unknown;
  const contract = parsePlatformCompatContractFromJson(
    contractUnknown,
    `platform-pack:${manifestUnknown.metadata.id}:${contractPath}`
  );
  validatePlatformCompatContract(
    contract,
    `platform-pack:${manifestUnknown.metadata.id}:${contractPath}`,
    {
      connectorId: manifestUnknown.connector.connectorId,
      workspaceKind: manifestUnknown.connector.workspaceKind,
      workspaceMode: manifestUnknown.connector.workspaceMode ?? 'dedicated',
    }
  );

  const runtimePath = manifestUnknown.entry.runtime;
  const runtimeEntry = findZipEntry(files, runtimePath, manifestRootPrefix);
  if (!runtimeEntry) {
    throw new Error(`Invalid platform pack: missing runtime entry (${runtimePath})`);
  }
  const runtimeCode = strFromU8(runtimeEntry.bytes);
  if (!runtimeCode.trim()) {
    throw new Error(`Invalid platform pack: runtime entry is empty (${runtimePath})`);
  }

  const iconPath = manifestUnknown.entry.icon;
  const iconEntry = findZipEntry(files, iconPath, manifestRootPrefix);
  if (!iconEntry) {
    throw new Error(`Invalid platform pack: missing icon entry (${iconPath})`);
  }
  const iconMimeType = guessIconMimeType(iconPath);
  if (!iconMimeType) {
    throw new Error(
      `Invalid platform pack: unsupported icon type (${iconPath}), expected .svg/.png/.jpg/.jpeg/.webp/.gif/.ico`
    );
  }
  const iconAssetUrl = toDataUrl(iconEntry.bytes, iconMimeType);
  const sidecarPath = manifestUnknown.entry.sidecar;
  if (typeof sidecarPath !== 'undefined') {
    const sidecarEntry = findZipEntry(files, sidecarPath, manifestRootPrefix);
    if (!sidecarEntry) {
      throw new Error(`Invalid platform pack: missing sidecar entry (${sidecarPath})`);
    }
  }
  const archiveFiles = Object.entries(files)
    .flatMap(([relativePath, fileBytes]) => {
      let normalizedPath: string;
      try {
        normalizedPath = normalizePackRelativePath(
          relativePath,
          `platform pack archive entry (${relativePath})`
        );
      } catch {
        return [];
      }

      if (manifestRootPrefix && !normalizedPath.startsWith(manifestRootPrefix)) {
        return [];
      }

      const trimmedPath = manifestRootPrefix
        ? normalizedPath.startsWith(manifestRootPrefix)
          ? normalizedPath.slice(manifestRootPrefix.length)
          : normalizedPath
        : normalizedPath;
      if (!trimmedPath) {
        return [];
      }

      return [
        {
          relativePath: normalizePackRelativePath(
            trimmedPath,
            `platform pack archive entry (${relativePath})`
          ),
          bytes: fileBytes,
        },
      ];
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));

  return {
    manifest: manifestUnknown,
    contractPath,
    contract,
    workspace: contract.workspace ?? null,
    runtimePath,
    runtimeCode,
    iconPath,
    iconBytes: iconEntry.bytes,
    iconAssetUrl,
    iconMimeType,
    sidecarPath,
    files: archiveFiles,
  };
}
