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

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
  return left.connectorId.localeCompare(right.connectorId, 'zh-CN');
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
  const next = records.filter((item) => item.connectorId !== record.connectorId);
  next.push(cloneInstalledPlatformPackRecord(record));
  saveInstalledPlatformPackRecords(next);
}

async function sha256Hex(data: Uint8Array): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle?.digest) {
    return undefined;
  }

  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
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
    const header = new TextEncoder().encode(`${file.relativePath}\u0000`);
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
  packageDigest: string | undefined
): string {
  const versionOrDigest = packageDigest || normalizeString(pack.manifest.metadata.version) || 'current';
  return `pmp-durable/music-platform-packs/${pack.manifest.metadata.id}/${versionOrDigest}`;
}

async function persistInstalledPlatformPackArtifacts(
  pack: ParsedPlatformPack,
  filesToPersist: Array<{ relativePath: string; bytes: Uint8Array }>
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
  const packageDigest = await computeTreeDigest(filesToPersist);
  const rootRelative = buildInstallRootRelativePath(pack, packageDigest);

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
    packageDigest,
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
  const existing =
    loadInstalledPlatformPackRecords().find(
      (record) => record.connectorId === pack.manifest.connector.connectorId
    ) ?? null;

  const filesToPersist = await resolvePlatformPackFilesForInstall(pack, {
    sourceType: options.sourceType,
  });
  const packageDigest = await computeTreeDigest(filesToPersist);
  if (
    existing &&
    existing.packId === pack.manifest.metadata.id &&
    existing.packVersion === pack.manifest.metadata.version &&
    existing.platformId === pack.contract.platform.platformId &&
    existing.packageDigest === packageDigest &&
    (await areInstalledPlatformPackArtifactsPresent(existing))
  ) {
    return cloneInstalledPlatformPackRecord(existing);
  }

  const persisted = await persistInstalledPlatformPackArtifacts(pack, filesToPersist);
  const record: InstalledPlatformPackRecord = {
    packId: pack.manifest.metadata.id,
    packVersion: pack.manifest.metadata.version,
    packageDigest: persisted.packageDigest,
    connectorId: pack.manifest.connector.connectorId as PlatformConnectorId,
    platformId: pack.contract.platform.platformId,
    sourceType: options.sourceType,
    source: normalizeString(options.source) || undefined,
    installedAtMs: existing?.installedAtMs ?? Date.now(),
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

  const byConnectorId = new Map<PlatformConnectorId, InstalledPlatformPackRecord>();
  for (const item of raw) {
    const record = sanitizeInstalledPlatformPackRecord(item);
    if (!record) continue;
    byConnectorId.set(record.connectorId, record);
  }

  return Array.from(byConnectorId.values())
    .map(cloneInstalledPlatformPackRecord)
    .sort(sortInstalledPlatformPackRecords);
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
