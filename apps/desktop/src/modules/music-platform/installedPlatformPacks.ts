import type { PlatformCompatContractFile } from '@pixel-matrix/plugin-platform-contracts';

import { readJson } from '../storage';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  broadcastDataUpdate,
  setupDualListener,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../utils/windowCommunication';
import type {
  ParsedPlatformPack,
  PlatformPackManifestV1,
} from './platformPack';
import {
  normalizePlatformConnectorId,
  type PlatformConnectorId,
} from './platformConnectorModel';

export type InstalledPlatformPackSourceType = 'builtin' | 'external';

export interface InstalledPlatformPackRecord {
  installationId: string;
  packId: string;
  packVersion: string;
  packageDigest?: string;
  connectorId: PlatformConnectorId;
  platformId: string;
  sourceType: InstalledPlatformPackSourceType;
  source?: string;
  installedAtMs: number;
  manifest: PlatformPackManifestV1;
  contract: PlatformCompatContractFile;
  artifactRootPath: string;
  manifestPath: string;
  contractPath: string;
  runtimePath: string;
  iconPath: string;
  sidecarPath?: string;
}

const textEncoder = new TextEncoder();

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createSimpleId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeIdSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'pack';
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function createLegacyInstallationId(input: {
  connectorId: PlatformConnectorId;
  packId: string;
  packVersion: string;
  packageDigest?: string;
  artifactRootPath: string;
}): string {
  const seed = [
    input.connectorId,
    input.packId,
    input.packVersion,
    input.packageDigest ?? '',
    input.artifactRootPath,
  ].join('|');
  return `legacy-${normalizeIdSegment(input.packId)}-${hashString(seed)}`;
}

export function createPlatformPackInstallationId(packId: string): string {
  return createSimpleId(`pack-install-${normalizeIdSegment(packId)}`);
}

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function normalizeRelativeArtifactPath(value: string, label: string): string {
  const normalized = value
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
  if (!workspace) {
    return undefined;
  }

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

function cloneInstalledPlatformPackRecord(
  record: InstalledPlatformPackRecord
): InstalledPlatformPackRecord {
  return {
    ...record,
    manifest: cloneManifest(record.manifest),
    contract: cloneContract(record.contract),
  };
}

function sanitizeInstalledPlatformPackRecord(
  value: unknown
): InstalledPlatformPackRecord | null {
  if (!isRecord(value)) return null;

  const installationId = normalizeString(value.installationId);
  const connectorId = normalizePlatformConnectorId(value.connectorId);
  const packId = normalizeString(value.packId);
  const packVersion = normalizeString(value.packVersion);
  const platformId = normalizeString(value.platformId).toLowerCase();
  const artifactRootPath = normalizeFsPath(normalizeString(value.artifactRootPath));
  const manifestPath = normalizeFsPath(normalizeString(value.manifestPath));
  const contractPath = normalizeFsPath(normalizeString(value.contractPath));
  const runtimePath = normalizeFsPath(normalizeString(value.runtimePath));
  const iconPath = normalizeFsPath(normalizeString(value.iconPath));
  const sidecarPath = normalizeFsPath(normalizeString(value.sidecarPath));
  const manifest = value.manifest as PlatformPackManifestV1 | undefined;
  const contract = value.contract as PlatformCompatContractFile | undefined;

  if (
    !connectorId ||
    !packId ||
    !packVersion ||
    !platformId ||
    !artifactRootPath ||
    !manifestPath ||
    !contractPath ||
    !runtimePath ||
    !iconPath ||
    !manifest ||
    !contract
  ) {
    return null;
  }

  const sourceType =
    value.sourceType === 'builtin' || value.sourceType === 'external'
      ? value.sourceType
      : 'external';

  const installedAtMs =
    typeof value.installedAtMs === 'number' && Number.isFinite(value.installedAtMs)
      ? Math.max(0, Math.floor(value.installedAtMs))
      : Date.now();
  const packageDigest = normalizeString(value.packageDigest) || undefined;

  return {
    installationId:
      installationId ||
      createLegacyInstallationId({
        connectorId,
        packId,
        packVersion,
        packageDigest,
        artifactRootPath,
      }),
    packId,
    packVersion,
    packageDigest,
    connectorId,
    platformId,
    sourceType,
    source: normalizeString(value.source) || undefined,
    installedAtMs,
    manifest: cloneManifest(manifest),
    contract: cloneContract(contract),
    artifactRootPath,
    manifestPath,
    contractPath,
    runtimePath,
    iconPath,
    sidecarPath: sidecarPath || undefined,
  };
}

function sortInstalledPlatformPackRecords(
  left: InstalledPlatformPackRecord,
  right: InstalledPlatformPackRecord
): number {
  const sortOrderDiff =
    (left.manifest.connector.sortOrder ?? 1000) -
    (right.manifest.connector.sortOrder ?? 1000);
  if (sortOrderDiff !== 0) return sortOrderDiff;
  const connectorDiff = left.connectorId.localeCompare(right.connectorId, 'zh-CN');
  if (connectorDiff !== 0) return connectorDiff;
  const installedAtDiff = left.installedAtMs - right.installedAtMs;
  if (installedAtDiff !== 0) return installedAtDiff;
  return left.installationId.localeCompare(right.installationId, 'zh-CN');
}

function saveInstalledPlatformPackRecords(records: InstalledPlatformPackRecord[]): void {
  void broadcastDataUpdate(
    STORAGE_KEYS.PLATFORM_PACKS_V1,
    records.map(cloneInstalledPlatformPackRecord),
    TAURI_EVENTS.PLATFORM_PACKS_UPDATED
  );
}

function upsertInstalledPlatformPackRecord(record: InstalledPlatformPackRecord): void {
  const records = loadInstalledPlatformPackRecords();
  const next = records.filter((item) => item.installationId !== record.installationId);
  next.push(cloneInstalledPlatformPackRecord(record));
  saveInstalledPlatformPackRecords(next);
}

async function sha256Hex(data: Uint8Array): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle?.digest) {
    return undefined;
  }

  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function computeTreeDigest(
  files: Array<{ relativePath: string; bytes: Uint8Array }>
): Promise<string | undefined> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for (const file of [...files].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, 'en')
  )) {
    const header = textEncoder.encode(`${file.relativePath}\u0000`);
    const footer = new Uint8Array([0]);
    chunks.push(header, file.bytes, footer);
    totalLength += header.byteLength + file.bytes.byteLength + footer.byteLength;
  }

  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return await sha256Hex(merged);
}

async function resolvePlatformPackFilesForInstall(
  pack: ParsedPlatformPack,
  options: {
    sourceType: InstalledPlatformPackSourceType;
  }
): Promise<Array<{ relativePath: string; bytes: Uint8Array }>> {
  const files = pack.files.map((file) => ({
    relativePath: normalizeRelativeArtifactPath(
      file.relativePath,
      `platform pack file (${file.relativePath})`
    ),
    bytes: file.bytes,
  }));

  if (!pack.sidecarPath) {
    return files;
  }

  const normalizedSidecarPath = normalizeRelativeArtifactPath(
    pack.sidecarPath,
    `platform pack sidecar (${pack.sidecarPath})`
  );
  if (files.some((file) => file.relativePath === normalizedSidecarPath)) {
    return files;
  }

  void options;
  throw new Error(`Invalid platform pack: missing sidecar artifact (${normalizedSidecarPath})`);
}

function buildInstallRootRelativePath(
  pack: ParsedPlatformPack,
  installationId: string
): string {
  return `pmp-durable/music-platform-packs/${pack.manifest.metadata.id}/${installationId}`;
}

async function persistInstalledPlatformPackArtifacts(
  pack: ParsedPlatformPack,
  filesToPersist: Array<{ relativePath: string; bytes: Uint8Array }>,
  installationId: string,
  packageDigest?: string
): Promise<{
  packageDigest?: string;
  artifactRootPath: string;
  manifestPath: string;
  contractPath: string;
  runtimePath: string;
  iconPath: string;
  sidecarPath?: string;
}> {
  if (!isTauriRuntime()) {
    throw new Error('Installing platform packs requires the Tauri desktop runtime');
  }

  const [fs, pathApi] = await Promise.all([
    import('@tauri-apps/api/fs'),
    import('@tauri-apps/api/path'),
  ]);
  const resolvedPackageDigest = packageDigest ?? (await computeTreeDigest(filesToPersist));
  const rootRelative = buildInstallRootRelativePath(pack, installationId);

  await fs.createDir(rootRelative, {
    dir: fs.BaseDirectory.AppData,
    recursive: true,
  });

  for (const file of filesToPersist) {
    const relativePath = normalizeRelativeArtifactPath(
      file.relativePath,
      `platform pack file (${file.relativePath})`
    );
    const artifactRelativePath = `${rootRelative}/${relativePath}`;
    const dirPath = artifactRelativePath.slice(
      0,
      Math.max(0, artifactRelativePath.lastIndexOf('/'))
    );
    if (dirPath.length > 0) {
      await fs.createDir(dirPath, {
        dir: fs.BaseDirectory.AppData,
        recursive: true,
      });
    }
    await fs.writeBinaryFile(
      {
        path: artifactRelativePath,
        contents: file.bytes,
      },
      { dir: fs.BaseDirectory.AppData }
    );
  }

  const appDataDir = await pathApi.appDataDir();
  const joinArtifactPath = async (relativePath: string) =>
    await pathApi.join(
      appDataDir,
      ...`${rootRelative}/${relativePath}`.split('/').filter((segment) => segment.length > 0)
    );

  return {
    packageDigest: resolvedPackageDigest,
    artifactRootPath: await pathApi.join(
      appDataDir,
      ...rootRelative.split('/').filter((segment) => segment.length > 0)
    ),
    manifestPath: await joinArtifactPath('manifest.json'),
    contractPath: await joinArtifactPath(pack.contractPath),
    runtimePath: await joinArtifactPath(pack.runtimePath),
    iconPath: await joinArtifactPath(pack.iconPath),
    sidecarPath: pack.sidecarPath ? await joinArtifactPath(pack.sidecarPath) : undefined,
  };
}

export async function createInstalledPlatformPackEntryUrl(
  entryPath: string
): Promise<string> {
  const normalizedPath = normalizeFsPath(entryPath);
  const isWindowsAbsolutePath = /^[a-zA-Z]:\//.test(normalizedPath);
  const isUrlLike = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalizedPath);

  if (isUrlLike && !isWindowsAbsolutePath) {
    return normalizedPath;
  }

  if (isTauriRuntime()) {
    const tauriApi = await import('@tauri-apps/api/tauri');
    if (typeof tauriApi.convertFileSrc === 'function') {
      return tauriApi.convertFileSrc(entryPath);
    }
  }

  throw new Error('Installed platform pack entry URL is not configured');
}

export async function areInstalledPlatformPackArtifactsPresent(
  record: InstalledPlatformPackRecord
): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }

  const fs = await import('@tauri-apps/api/fs');
  const checks = await Promise.all(
    [
      record.manifestPath,
      record.contractPath,
      record.runtimePath,
      record.iconPath,
      record.sidecarPath,
    ]
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
      .map(async (path) => await fs.exists(path).catch(() => false))
  );
  return checks.every(Boolean);
}

export async function installPlatformPackToStorage(
  pack: ParsedPlatformPack,
  options: {
    sourceType: InstalledPlatformPackSourceType;
    source?: string;
  }
): Promise<InstalledPlatformPackRecord> {
  const filesToPersist = await resolvePlatformPackFilesForInstall(pack, {
    sourceType: options.sourceType,
  });
  const packageDigest = await computeTreeDigest(filesToPersist);
  const existing =
    options.sourceType === 'builtin'
      ? loadInstalledPlatformPackRecords().find(
          (record) =>
            record.sourceType === 'builtin' &&
            record.connectorId === pack.manifest.connector.connectorId &&
            record.packId === pack.manifest.metadata.id &&
            record.packVersion === pack.manifest.metadata.version &&
            record.platformId === pack.contract.platform.platformId &&
            record.packageDigest === packageDigest
        ) ?? null
      : null;
  if (
    existing &&
    (await areInstalledPlatformPackArtifactsPresent(existing))
  ) {
    const normalizedSource = normalizeString(options.source) || undefined;
    const metadataAlreadyCurrent =
      existing.sourceType === options.sourceType &&
      normalizeString(existing.source) === normalizeString(normalizedSource);
    if (!metadataAlreadyCurrent) {
      const nextRecord: InstalledPlatformPackRecord = {
        ...cloneInstalledPlatformPackRecord(existing),
        sourceType: options.sourceType,
        source: normalizedSource,
      };
      upsertInstalledPlatformPackRecord(nextRecord);
      return cloneInstalledPlatformPackRecord(nextRecord);
    }
    return cloneInstalledPlatformPackRecord(existing);
  }

  const installationId = createPlatformPackInstallationId(pack.manifest.metadata.id);
  const persisted = await persistInstalledPlatformPackArtifacts(
    pack,
    filesToPersist,
    installationId,
    packageDigest
  );
  const record: InstalledPlatformPackRecord = {
    installationId,
    packId: pack.manifest.metadata.id,
    packVersion: pack.manifest.metadata.version,
    packageDigest: persisted.packageDigest,
    connectorId: pack.manifest.connector.connectorId as PlatformConnectorId,
    platformId: pack.contract.platform.platformId,
    sourceType: options.sourceType,
    source: normalizeString(options.source) || undefined,
    installedAtMs: Date.now(),
    manifest: cloneManifest(pack.manifest),
    contract: cloneContract(pack.contract),
    artifactRootPath: normalizeFsPath(persisted.artifactRootPath),
    manifestPath: normalizeFsPath(persisted.manifestPath),
    contractPath: normalizeFsPath(persisted.contractPath),
    runtimePath: normalizeFsPath(persisted.runtimePath),
    iconPath: normalizeFsPath(persisted.iconPath),
    sidecarPath: persisted.sidecarPath ? normalizeFsPath(persisted.sidecarPath) : undefined,
  };

  upsertInstalledPlatformPackRecord(record);
  return cloneInstalledPlatformPackRecord(record);
}

export function loadInstalledPlatformPackRecords(): InstalledPlatformPackRecord[] {
  if (typeof window === 'undefined') return [];
  const raw = readJson<unknown>(STORAGE_KEYS.PLATFORM_PACKS_V1, []);
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => sanitizeInstalledPlatformPackRecord(item))
    .filter((record): record is InstalledPlatformPackRecord => Boolean(record))
    .map(cloneInstalledPlatformPackRecord)
    .sort(sortInstalledPlatformPackRecords);
}

export function getInstalledPlatformPackRecord(
  installationId: string
): InstalledPlatformPackRecord | null {
  const normalizedInstallationId = normalizeString(installationId);
  if (!normalizedInstallationId) {
    return null;
  }
  return (
    loadInstalledPlatformPackRecords().find(
      (record) => record.installationId === normalizedInstallationId
    ) ?? null
  );
}

export function listInstalledPlatformPackRecordsForConnector(
  connectorId: string
): InstalledPlatformPackRecord[] {
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) {
    return [];
  }
  return loadInstalledPlatformPackRecords().filter(
    (record) => record.connectorId === normalizedConnectorId
  );
}

export async function subscribeInstalledPlatformPackRecords(
  listener: () => void
): Promise<() => void> {
  return await setupDualListener(
    [STORAGE_KEYS.PLATFORM_PACKS_V1],
    [TAURI_EVENTS.PLATFORM_PACKS_UPDATED],
    listener
  );
}
