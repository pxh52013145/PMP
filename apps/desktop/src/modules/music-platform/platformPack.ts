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
  };
}

export interface ParsedPlatformPack {
  manifest: PlatformPackManifestV1;
  contractPath: string;
  contract: PlatformCompatContractFile;
  runtimePath: string;
  runtimeCode: string;
  iconPath: string;
  iconBytes: Uint8Array;
  iconDataUrl: string;
  iconMimeType: string;
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

function normalizeZipPath(path: string): string {
  return path.replace(/^\.?\//, '').replace(/\\/g, '/');
}

function findZipEntry(files: Record<string, Uint8Array>, filename: string): Uint8Array | undefined {
  const direct = files[filename];
  if (typeof direct !== 'undefined') return direct;

  const target = normalizeZipPath(filename).toLowerCase();
  for (const [key, value] of Object.entries(files)) {
    const normalized = normalizeZipPath(key).toLowerCase();
    if (normalized === target || normalized.endsWith(`/${target}`)) {
      return value;
    }
  }

  return undefined;
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

function validatePlatformPackManifestV1(manifest: unknown): asserts manifest is PlatformPackManifestV1 {
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
  manifest.entry.contract = toNonEmptyString(manifest.entry.contract, 'manifest.entry.contract');
  manifest.entry.runtime = toNonEmptyString(manifest.entry.runtime, 'manifest.entry.runtime');
  manifest.entry.icon = toNonEmptyString(manifest.entry.icon, 'manifest.entry.icon');
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

  const manifestBytes = findZipEntry(files, 'manifest.json');
  if (!manifestBytes) {
    throw new Error('Invalid platform pack: missing manifest.json');
  }

  const manifestRaw = strFromU8(manifestBytes);
  const manifestUnknown = JSON.parse(manifestRaw) as unknown;
  validatePlatformPackManifestV1(manifestUnknown);

  const contractPath = manifestUnknown.entry.contract;
  const contractBytes = findZipEntry(files, contractPath);
  if (!contractBytes) {
    throw new Error(`Invalid platform pack: missing contract entry (${normalizeZipPath(contractPath)})`);
  }

  const contractUnknown = JSON.parse(strFromU8(contractBytes)) as unknown;
  const contract = parsePlatformCompatContractFromJson(
    contractUnknown,
    `platform-pack:${manifestUnknown.metadata.id}:${normalizeZipPath(contractPath)}`
  );
  validatePlatformCompatContract(
    contract,
    `platform-pack:${manifestUnknown.metadata.id}:${normalizeZipPath(contractPath)}`,
    {
      connectorId: manifestUnknown.connector.connectorId,
      workspaceKind: manifestUnknown.connector.workspaceKind,
      workspaceMode: manifestUnknown.connector.workspaceMode ?? 'dedicated',
    }
  );

  const runtimePath = manifestUnknown.entry.runtime;
  const runtimeBytes = findZipEntry(files, runtimePath);
  if (!runtimeBytes) {
    throw new Error(`Invalid platform pack: missing runtime entry (${normalizeZipPath(runtimePath)})`);
  }
  const runtimeCode = strFromU8(runtimeBytes);
  if (!runtimeCode.trim()) {
    throw new Error(`Invalid platform pack: runtime entry is empty (${normalizeZipPath(runtimePath)})`);
  }

  const iconPath = manifestUnknown.entry.icon;
  const iconBytes = findZipEntry(files, iconPath);
  if (!iconBytes) {
    throw new Error(`Invalid platform pack: missing icon entry (${normalizeZipPath(iconPath)})`);
  }
  const iconMimeType = guessIconMimeType(iconPath);
  if (!iconMimeType) {
    throw new Error(
      `Invalid platform pack: unsupported icon type (${normalizeZipPath(iconPath)}), expected .svg/.png/.jpg/.jpeg/.webp/.gif/.ico`
    );
  }
  const iconDataUrl = toDataUrl(iconBytes, iconMimeType);

  return {
    manifest: manifestUnknown,
    contractPath: normalizeZipPath(contractPath),
    contract,
    runtimePath: normalizeZipPath(runtimePath),
    runtimeCode,
    iconPath: normalizeZipPath(iconPath),
    iconBytes,
    iconDataUrl,
    iconMimeType,
  };
}
