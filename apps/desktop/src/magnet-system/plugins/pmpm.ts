import React from 'react';
import { unzip, strFromU8 } from 'fflate';
import type { Unzipped } from 'fflate';
import {
  type InstalledPmpmPluginRecord,
  normalizePmpmEntryPoint,
  type PmpmPluginCrashSurface,
  validatePmpmManifest,
} from '@pixel-matrix/plugin-platform-contracts';
import type { Magnet } from '../../types/pixel';
import { createDefaultBoundsForMagnet } from '../../modules/magnets/layoutPresets';
import type { MagnetRendererDefinition } from '../registry';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { PluginMagnetHost } from './PluginMagnetHost';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { BUILTIN_MAGNET_IDS } from '../../constants/magnets';
import {
  readDurableText,
  readJson,
  readString,
  removeDurableText,
  tryWriteJson,
  writeDurableText,
  writeJson,
  writeString,
} from '../../modules/storage';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastSignal } from '../../utils/windowCommunication';
import { recordPmpmAuditEvent } from './pmpmGovernance';
import {
  parsePmpmPackageSignatureFileV1,
  verifyPmpmPackageSignatureV1,
  type PmpmVerifiedSignature,
} from './pmpmSignature';
import {
  listEffectiveCapabilityIdsFromInstalledPmpmPlugin,
  listPmpmPermissionCapabilityBindings,
  projectInstalledPmpmPluginToExtensionRecord,
  projectPmpmManifestToExtensionManifest,
  type InstalledPmpmExtensionRecord,
  type PmpmPermissionCapabilityBinding,
} from './pmpmProjection';

export { recordPmpmPermissionDenied } from './pmpmGovernance';
export {
  type PmpmManifest,
  type PmpmManifestContributionBuckets,
  type PmpmPluginCrashSurface,
  validatePmpmManifest,
} from '@pixel-matrix/plugin-platform-contracts';
export {
  listEffectiveCapabilityIdsFromInstalledPmpmPlugin,
  listPmpmPermissionCapabilityBindings,
  projectInstalledPmpmPluginToExtensionRecord,
  projectPmpmManifestToExtensionManifest,
};
export type { InstalledPmpmExtensionRecord, PmpmPermissionCapabilityBinding };

const telemetry = getTelemetryLogger('pmpm', 'pmpm');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export type InstalledPmpmPlugin = InstalledPmpmPluginRecord<PmpmVerifiedSignature>;
type InstalledPmpmResolvedArtifact = NonNullable<InstalledPmpmPlugin['resolvedArtifacts']>[number];
type ParsedPmpmPluginArchive = {
  plugin: InstalledPmpmPlugin;
  files: Unzipped;
};

type PluginStoreListener = () => void;

let pluginStoreRevision = 0;
const pluginStoreListeners = new Set<PluginStoreListener>();
let pluginStoreSyncDisposer: null | (() => void) = null;

function notifyPluginStoreChanged(): void {
  pluginStoreRevision += 1;
  for (const listener of Array.from(pluginStoreListeners)) {
    try {
      listener();
    } catch (error) {
      telemetry.warn('plugin_store.listener.failed', {
        message: readErrorMessage(error),
      });
    }
  }
}

function ensurePluginStoreCrossWindowSync(): void {
  if (typeof window === 'undefined') return;
  if (pluginStoreSyncDisposer) return;

  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEYS.PMPM_PLUGINS) return;
    notifyPluginStoreChanged();
  };

  window.addEventListener('storage', onStorage);

  let disposed = false;
  let unlistenTauri: null | (() => void) = null;

  void import('../../utils/windowCommunication')
    .then(({ setupTauriListenerWithPayload }) =>
      setupTauriListenerWithPayload<{ key?: string }>(TAURI_EVENTS.PMPM_PLUGINS_UPDATED, (payload) => {
        if (payload?.key && payload.key !== STORAGE_KEYS.PMPM_PLUGINS) return;
        notifyPluginStoreChanged();
      })
    )
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenTauri = unlisten;
    })
    .catch(() => {
      // ignore (web runtime or tauri listener not available)
    });

  pluginStoreSyncDisposer = () => {
    disposed = true;
    window.removeEventListener('storage', onStorage);
    try {
      unlistenTauri?.();
    } catch {
      // ignore
    }
    pluginStoreSyncDisposer = null;
  };
}

export function getPmpmPluginsRevision(): number {
  return pluginStoreRevision;
}

export function subscribePmpmPlugins(listener: PluginStoreListener): () => void {
  pluginStoreListeners.add(listener);
  ensurePluginStoreCrossWindowSync();

  return () => {
    pluginStoreListeners.delete(listener);
    if (pluginStoreListeners.size === 0) {
      pluginStoreSyncDisposer?.();
    }
  };
}

export function getPmpmPluginEffectivePermissions(pluginId: string): Set<string> {
  const plugin = getInstalledPmpmPlugin(pluginId);
  if (!plugin || plugin.enabled === false) return new Set();

  const declared = plugin.manifest.permissions ?? [];
  const denied = new Set(
    Array.isArray(plugin.deniedPermissions)
      ? plugin.deniedPermissions.filter((perm) => typeof perm === 'string' && perm.length > 0)
      : []
  );

  return new Set(declared.filter((perm) => !denied.has(perm)));
}

export function getPmpmPluginEffectiveCapabilityIds(pluginId: string): string[] {
  const plugin = getInstalledPmpmPlugin(pluginId);
  if (!plugin || plugin.enabled === false) return [];
  return listEffectiveCapabilityIdsFromInstalledPmpmPlugin(plugin);
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(data));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function readPmpmPluginEntryCode(pluginId: string): Promise<string | null> {
  return readDurableText('pmpm-entry', pluginId);
}

async function persistPmpmPluginEntryCode(pluginId: string, entryCode: string): Promise<boolean> {
  const ok = await writeDurableText('pmpm-entry', pluginId, entryCode);
  if (!ok) return false;
  const readBack = await readDurableText('pmpm-entry', pluginId);
  return readBack === entryCode;
}

async function removePmpmPluginEntryCode(pluginId: string): Promise<void> {
  await removeDurableText('pmpm-entry', pluginId);
}

function normalizeArchiveFilePath(value: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');

  if (!normalized) {
    throw new Error('Package file path is empty');
  }

  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`Package file path must be relative: ${value}`);
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Package file path contains invalid segments: ${value}`);
  }

  return normalized;
}

function buildPmpmSidecarArtifactRootRelativePath(
  pluginId: string,
  packageDigest: string | undefined
): string {
  const digest = typeof packageDigest === 'string' && packageDigest.trim().length > 0 ? packageDigest.trim() : 'current';
  return `pmp-durable/pmpm-artifacts/${pluginId}/${digest}`;
}

function buildPmpmSidecarArtifactRelativePath(
  pluginId: string,
  entryPoint: string,
  packageDigest: string | undefined
): string {
  const normalizedEntry = normalizePmpmEntryPoint(entryPoint);
  return `${buildPmpmSidecarArtifactRootRelativePath(pluginId, packageDigest)}/${normalizedEntry}`;
}

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function trimPathSegments(value: string, count: number): string | null {
  let next = normalizeFsPath(value);
  for (let i = 0; i < count; i += 1) {
    const lastSlash = next.lastIndexOf('/');
    if (lastSlash < 0) return null;
    next = next.slice(0, lastSlash);
  }
  return next.length > 0 ? next : null;
}

function collectResolvedArtifactCleanupTargets(
  plugin: Pick<InstalledPmpmPlugin, 'manifest' | 'resolvedArtifacts'>
): Array<{ kind: 'dir' | 'file'; path: string }> {
  const projected = projectPmpmManifestToExtensionManifest(plugin.manifest);
  const runtimeById = new Map(projected.runtimes.map((runtime) => [runtime.runtimeId, runtime] as const));
  const seen = new Set<string>();
  const targets: Array<{ kind: 'dir' | 'file'; path: string }> = [];

  for (const artifact of plugin.resolvedArtifacts ?? []) {
    if (typeof artifact?.path !== 'string' || artifact.path.length === 0) continue;
    const runtime = runtimeById.get(artifact.runtimeId);
    if (runtime?.kind === 'sidecar') {
      const entrySegments = normalizePmpmEntryPoint(runtime.entry).split('/').filter((segment) => segment.length > 0);
      const root = trimPathSegments(artifact.path, entrySegments.length);
      if (!root) continue;
      const key = `dir:${root}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ kind: 'dir', path: root });
      continue;
    }

    const filePath = normalizeFsPath(artifact.path);
    const key = `file:${filePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ kind: 'file', path: filePath });
  }

  return targets;
}

async function persistPmpmPluginResolvedArtifacts(
  plugin: InstalledPmpmPlugin,
  files: Unzipped
): Promise<InstalledPmpmPlugin['resolvedArtifacts'] | undefined> {
  const projected = projectPmpmManifestToExtensionManifest(plugin.manifest);
  const runtime = projected.runtimes[0];
  if (!runtime || runtime.kind !== 'sidecar') {
    return undefined;
  }

  if (!isTauriRuntime()) {
    throw new Error('Installing PMPM sidecar plugins requires the Tauri desktop runtime');
  }

  const relativeRoot = buildPmpmSidecarArtifactRootRelativePath(
    plugin.manifest.metadata.id,
    plugin.packageSha256 ?? plugin.entrySha256
  );
  const relativePath = buildPmpmSidecarArtifactRelativePath(
    plugin.manifest.metadata.id,
    runtime.entry,
    plugin.packageSha256 ?? plugin.entrySha256
  );

  const [fs, pathApi] = await Promise.all([
    import('@tauri-apps/api/fs'),
    import('@tauri-apps/api/path'),
  ]);

  await fs.createDir(relativeRoot, {
    dir: fs.BaseDirectory.AppData,
    recursive: true,
  });

  for (const [archivePath, contents] of Object.entries(files)) {
    const normalizedArchivePath = normalizeArchiveFilePath(archivePath);
    const relativeFilePath = `${relativeRoot}/${normalizedArchivePath}`;
    const relativeDir = relativeFilePath.slice(0, Math.max(0, relativeFilePath.lastIndexOf('/')));

    if (relativeDir.length > 0) {
      await fs.createDir(relativeDir, {
        dir: fs.BaseDirectory.AppData,
        recursive: true,
      });
    }

    await fs.writeBinaryFile(
      {
        path: relativeFilePath,
        contents,
      },
      { dir: fs.BaseDirectory.AppData }
    );
  }

  const absolutePath = await pathApi.join(
    await pathApi.appDataDir(),
    ...relativePath.split('/').filter((segment) => segment.length > 0)
  );

  const artifact: InstalledPmpmResolvedArtifact = {
    runtimeId: runtime.runtimeId,
    path: absolutePath,
    sha256: plugin.entrySha256,
  };

  return [artifact];
}

async function removePmpmPluginResolvedArtifacts(
  plugin: Pick<InstalledPmpmPlugin, 'manifest' | 'resolvedArtifacts'> | null | undefined,
  keepTargets: ReadonlySet<string> = new Set()
): Promise<void> {
  if (!plugin?.resolvedArtifacts || plugin.resolvedArtifacts.length === 0 || !isTauriRuntime()) {
    return;
  }

  try {
    const fs = await import('@tauri-apps/api/fs');
    for (const target of collectResolvedArtifactCleanupTargets(plugin)) {
      const normalizedTargetPath = normalizeFsPath(target.path);
      if (keepTargets.has(normalizedTargetPath)) continue;
      try {
        if (target.kind === 'dir') {
          await fs.removeDir(target.path, { recursive: true });
        } else {
          await fs.removeFile(target.path);
        }
      } catch {
        // best-effort cleanup
      }
    }
  } catch {
    // ignore cleanup errors
  }
}

const PMPM_DURABLE_MIGRATION_V1_BACKUP_ID = 'pmpm-plugins-v1';

type PmpmDurableMigrationStatus = 'running' | 'done' | 'partial' | 'failed' | 'rolled-back';

type PmpmDurableMigrationFailureStage = 'backup' | 'persist' | 'save';

export type PmpmDurableMigrationFailure = {
  pluginId: string;
  stage: PmpmDurableMigrationFailureStage;
  message: string;
};

export type PmpmDurableMigrationReport = {
  version: 1;
  startedAt: number;
  finishedAt: number;
  status: PmpmDurableMigrationStatus;
  candidates: number;
  migrated: number;
  failed: number;
  backup: { existed: boolean; created: boolean };
  failures: PmpmDurableMigrationFailure[];
};

function persistPmpmMigrationReport(report: PmpmDurableMigrationReport): void {
  writeJson(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1_REPORT, report, { mode: 'sync' });
}

async function ensurePmpmMigrationBackup(raw: string): Promise<
  | { ok: true; existed: boolean; created: boolean }
  | { ok: false; message: string }
> {
  const existing = await readDurableText('migration-backup', PMPM_DURABLE_MIGRATION_V1_BACKUP_ID);
  if (typeof existing === 'string') {
    return { ok: true, existed: true, created: false };
  }

  const written = await writeDurableText('migration-backup', PMPM_DURABLE_MIGRATION_V1_BACKUP_ID, raw);
  if (!written) {
    return { ok: false, message: 'writeDurableText failed' };
  }

  const readBack = await readDurableText('migration-backup', PMPM_DURABLE_MIGRATION_V1_BACKUP_ID);
  if (readBack !== raw) {
    return { ok: false, message: 'backup readback mismatch' };
  }

  return { ok: true, existed: false, created: true };
}

function saveInstalledPmpmPlugins(plugins: InstalledPmpmPlugin[]): boolean {
  if (typeof window === 'undefined') return false;

  const ok = tryWriteJson(STORAGE_KEYS.PMPM_PLUGINS, plugins);
  if (!ok) return false;

  notifyPluginStoreChanged();
  void broadcastSignal(TAURI_EVENTS.PMPM_PLUGINS_UPDATED);
  return true;
}

export async function migrateInstalledPmpmPluginsToDurableStorage(options: {
  force?: boolean;
} = {}): Promise<{
  migrated: number;
  failed: number;
  skipped?: boolean;
}> {
  const plugins = loadInstalledPmpmPlugins();
  if (plugins.length === 0) return { migrated: 0, failed: 0 };

  const candidates = plugins.filter((plugin) => {
    const entryCode = plugin.entryCode;
    return typeof entryCode === 'string' && entryCode.length > 0;
  });

  const migrationFlag = readString(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1);
  if (!options.force && migrationFlag === 'rolled-back') {
    return { migrated: 0, failed: 0, skipped: true };
  }
  if (!options.force && migrationFlag === 'done' && candidates.length === 0) {
    return { migrated: 0, failed: 0, skipped: true };
  }

  const startedAt = Date.now();
  writeString(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, 'running');

  let migrated = 0;
  let failed = 0;
  let changed = false;
  const failures: PmpmDurableMigrationFailure[] = [];
  let backupInfo: PmpmDurableMigrationReport['backup'] = { existed: false, created: false };

  const next = plugins.map((plugin) => ({ ...plugin }));

  if (candidates.length > 0) {
    const raw = readString(STORAGE_KEYS.PMPM_PLUGINS) ?? JSON.stringify(plugins);
    const backup = await ensurePmpmMigrationBackup(raw);
    if (!backup.ok) {
      const report: PmpmDurableMigrationReport = {
        version: 1,
        startedAt,
        finishedAt: Date.now(),
        status: 'failed',
        candidates: candidates.length,
        migrated: 0,
        failed: candidates.length,
        backup: backupInfo,
        failures: [{ pluginId: '*', stage: 'backup', message: backup.message }],
      };
      persistPmpmMigrationReport(report);
      writeString(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, 'failed');
      return { migrated: 0, failed: candidates.length };
    }
    backupInfo = { existed: backup.existed, created: backup.created };
  }

  for (let i = 0; i < next.length; i += 1) {
    const plugin = next[i];
    const pluginId = plugin.manifest.metadata.id;
    const entryCode = plugin.entryCode;
    if (typeof entryCode !== 'string' || entryCode.length === 0) continue;

    const ok = await persistPmpmPluginEntryCode(pluginId, entryCode);
    if (!ok) {
      failed += 1;
      failures.push({ pluginId, stage: 'persist', message: 'persist durable entry failed' });
      continue;
    }

    delete plugin.entryCode;
    migrated += 1;
    changed = true;
  }

  if (changed) {
    const ok = saveInstalledPmpmPlugins(next);
    if (!ok) {
      failures.push({ pluginId: '*', stage: 'save', message: 'failed to persist localStorage index' });
      failed = Math.max(failed, 1);
    }
  }

  const finishedAt = Date.now();
  const status: PmpmDurableMigrationStatus =
    failures.some((item) => item.stage === 'backup' || item.stage === 'save')
      ? 'failed'
      : failed === 0
        ? 'done'
        : 'partial';

  writeString(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, status);

  persistPmpmMigrationReport({
    version: 1,
    startedAt,
    finishedAt,
    status,
    candidates: candidates.length,
    migrated,
    failed,
    backup: backupInfo,
    failures,
  });

  return { migrated, failed };
}

export function loadInstalledPmpmPlugins(): InstalledPmpmPlugin[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = readJson<unknown>(STORAGE_KEYS.PMPM_PLUGINS, []);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean) as InstalledPmpmPlugin[];
  } catch {
    return [];
  }
}

export function loadInstalledPmpmExtensionRecords(): InstalledPmpmExtensionRecord[] {
  return loadInstalledPmpmPlugins().map((plugin) => projectInstalledPmpmPluginToExtensionRecord(plugin));
}

export function getInstalledPmpmPlugin(id: string): InstalledPmpmPlugin | null {
  const plugins = loadInstalledPmpmPlugins();
  return plugins.find((plugin) => plugin.manifest.metadata.id === id) ?? null;
}

export function getInstalledPmpmExtensionRecord(id: string): InstalledPmpmExtensionRecord | null {
  const plugin = getInstalledPmpmPlugin(id);
  return plugin ? projectInstalledPmpmPluginToExtensionRecord(plugin) : null;
}

export function upsertInstalledPmpmPlugin(plugin: InstalledPmpmPlugin): void {
  const plugins = loadInstalledPmpmPlugins();
  const existingIndex = plugins.findIndex((p) => p.manifest.metadata.id === plugin.manifest.metadata.id);
  if (existingIndex >= 0) {
    plugins.splice(existingIndex, 1, plugin);
  } else {
    plugins.push(plugin);
  }
  saveInstalledPmpmPlugins(plugins);
}

async function parsePmpmPluginArchive(packageBytes: Uint8Array): Promise<ParsedPmpmPluginArchive> {
  const files = await unzipAsync(packageBytes);

  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) {
    throw new Error('Invalid .pmpm: missing manifest.json');
  }

  const manifestRaw = strFromU8(manifestBytes);
  const manifestUnknown = JSON.parse(manifestRaw) as unknown;
  validatePmpmManifest(manifestUnknown, { reservedIds: BUILTIN_MAGNET_IDS });

  const entryKey = normalizePmpmEntryPoint(manifestUnknown.entryPoint);
  const entryBytes = files[entryKey] ?? files[manifestUnknown.entryPoint];
  if (!entryBytes) {
    throw new Error(`Invalid .pmpm: missing entryPoint "${manifestUnknown.entryPoint}"`);
  }

  const [packageSha256, manifestSha256, entrySha256] = await Promise.all([
    sha256Hex(packageBytes),
    sha256Hex(manifestBytes),
    sha256Hex(entryBytes),
  ]);

  const allowUnsigned = Boolean(readJson(STORAGE_KEYS.PMPM_ALLOW_UNSIGNED_PLUGINS, true));
  const signatureBytes = files['signature.json'] ?? null;
  const signature: PmpmVerifiedSignature | undefined = signatureBytes
    ? await verifyPmpmPackageSignatureV1({
        signature: parsePmpmPackageSignatureFileV1(signatureBytes),
        manifestSha256,
        entrySha256,
      })
    : undefined;

  if (!signature && !allowUnsigned) {
    throw new Error('Unsigned .pmpm is not allowed (signature.json missing).');
  }

  return {
    plugin: {
      manifest: manifestUnknown,
      entryCode: strFromU8(entryBytes),
      installedAt: Date.now(),
      packageSha256,
      manifestSha256,
      entrySha256,
      signature,
    },
    files,
  };
}

export async function parsePmpmPluginFromZipBytes(packageBytes: Uint8Array): Promise<InstalledPmpmPlugin> {
  const parsed = await parsePmpmPluginArchive(packageBytes);
  return parsed.plugin;
}

export async function parsePmpmPluginFromFilePath(filePath: string): Promise<InstalledPmpmPlugin> {
  const { readBinaryFile } = await import('@tauri-apps/api/fs');
  const bytes = await readBinaryFile(filePath);
  return await parsePmpmPluginFromZipBytes(new Uint8Array(bytes));
}

export async function installPmpmPluginFromZipBytes(
  packageBytes: Uint8Array,
  options: { defaultEnabled?: boolean } = {}
): Promise<InstalledPmpmPlugin> {
  const parsed = await parsePmpmPluginArchive(packageBytes);
  const plugin = parsed.plugin;
  const existing = getInstalledPmpmPlugin(plugin.manifest.metadata.id);

  const merged: InstalledPmpmPlugin = existing
    ? {
        ...plugin,
        enabled: existing.enabled,
        disabledReason: existing.disabledReason,
        deniedPermissions: existing.deniedPermissions,
        lastError: existing.lastError,
        lastErrorAt: existing.lastErrorAt,
      }
    : options.defaultEnabled === false
      ? { ...plugin, enabled: false, disabledReason: 'manual' }
      : plugin;

  const projected = projectPmpmManifestToExtensionManifest(merged.manifest);
  const primaryRuntime = projected.runtimes[0];
  const shouldPersistEntryCode = primaryRuntime?.kind !== 'sidecar';
  const entryCode = merged.entryCode;
  const stored =
    shouldPersistEntryCode && typeof entryCode === 'string' && entryCode.length > 0
      ? await persistPmpmPluginEntryCode(plugin.manifest.metadata.id, entryCode)
      : false;
  const resolvedArtifacts = await persistPmpmPluginResolvedArtifacts(merged, parsed.files);
  const persisted = {
    ...merged,
    resolvedArtifacts,
    entryCode: shouldPersistEntryCode ? (stored ? undefined : merged.entryCode) : undefined,
  };
  upsertInstalledPmpmPlugin(persisted);
  if (!shouldPersistEntryCode) {
    await removePmpmPluginEntryCode(plugin.manifest.metadata.id);
  }
  await removePmpmPluginResolvedArtifacts(
    existing,
    new Set(collectResolvedArtifactCleanupTargets(persisted).map((target) => normalizeFsPath(target.path)))
  );
  return persisted;
}

export async function installPmpmPluginFromFilePath(filePath: string): Promise<InstalledPmpmPlugin> {
  const { readBinaryFile } = await import('@tauri-apps/api/fs');
  const bytes = await readBinaryFile(filePath);
  return await installPmpmPluginFromZipBytes(new Uint8Array(bytes));
}

export function uninstallPmpmPlugin(id: string): void {
  const plugins = loadInstalledPmpmPlugins();
  const existing = plugins.find((plugin) => plugin.manifest.metadata.id === id) ?? null;
  saveInstalledPmpmPlugins(plugins.filter((plugin) => plugin.manifest.metadata.id !== id));
  void removePmpmPluginEntryCode(id);
  void removePmpmPluginResolvedArtifacts(existing);
}

export function supportsPmpmPluginMagnetSurface(
  plugin: Pick<InstalledPmpmPlugin, 'manifest'>
): boolean {
  const projected = projectPmpmManifestToExtensionManifest(plugin.manifest);
  return projected.runtimes.some(
    (runtime) => runtime.kind === 'extension-host' || runtime.kind === 'webview'
  );
}

function isPluginList(value: unknown): value is InstalledPmpmPlugin[] {
  return Array.isArray(value);
}

export async function rollbackPmpmDurableMigrationV1(options: {
  strategy?: 'backup' | 'rehydrate';
  removeDurableEntries?: boolean;
} = {}): Promise<{
  restored: number;
  missing: number;
  usedBackup: boolean;
  ok: boolean;
}> {
  if (typeof window === 'undefined') {
    return { restored: 0, missing: 0, usedBackup: false, ok: false };
  }

  const backupRaw = await readDurableText('migration-backup', PMPM_DURABLE_MIGRATION_V1_BACKUP_ID);
  const preferBackup =
    options.strategy === 'backup' || (options.strategy !== 'rehydrate' && typeof backupRaw === 'string');

  if (preferBackup && typeof backupRaw === 'string') {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(backupRaw) as unknown;
    } catch {
      parsed = null;
    }

    if (isPluginList(parsed)) {
      const ok = saveInstalledPmpmPlugins(parsed);
      if (!ok) return { restored: 0, missing: 0, usedBackup: true, ok: false };

      writeString(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, 'rolled-back');
      return { restored: parsed.length, missing: 0, usedBackup: true, ok: true };
    }
  }

  const installed = loadInstalledPmpmPlugins();
  if (installed.length === 0) {
    writeString(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, 'rolled-back');
    return { restored: 0, missing: 0, usedBackup: false, ok: true };
  }

  let restored = 0;
  let missing = 0;

  const next = installed.map((plugin) => ({ ...plugin }));

  for (let i = 0; i < next.length; i += 1) {
    const plugin = next[i];
    const pluginId = plugin.manifest.metadata.id;
    if (typeof plugin.entryCode === 'string' && plugin.entryCode.length > 0) continue;
    const entryCode = await readPmpmPluginEntryCode(pluginId);
    if (!entryCode) {
      missing += 1;
      continue;
    }
    plugin.entryCode = entryCode;
    restored += 1;
  }

  const ok = saveInstalledPmpmPlugins(next);
  if (!ok) return { restored: 0, missing, usedBackup: false, ok: false };

  if (options.removeDurableEntries) {
    for (const plugin of next) {
      const pluginId = plugin.manifest.metadata.id;
      await removePmpmPluginEntryCode(pluginId);
    }
  }

  writeString(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, 'rolled-back');
  return { restored, missing, usedBackup: false, ok: true };
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function disablePmpmPluginByPolicy(pluginId: string, message: string): void {
  const plugins = loadInstalledPmpmPlugins();
  const index = plugins.findIndex((plugin) => plugin.manifest.metadata.id === pluginId);
  if (index < 0) return;

  const now = Date.now();
  const details = String(message).slice(0, 2000);
  const lastError = `[policy] ${details}`;

  plugins[index] = {
    ...plugins[index],
    enabled: false,
    disabledReason: 'policy',
    lastError,
    lastErrorAt: now,
  };

  saveInstalledPmpmPlugins(plugins);
  try {
    recordPmpmAuditEvent({ type: 'disabled', pluginId, reason: details });
  } catch {
    // ignore
  }
}

export function quarantinePmpmPlugin(
  pluginId: string,
  options: {
    message: string;
    surface?: PmpmPluginCrashSurface;
    timeoutMs?: number;
  }
): void {
  const plugins = loadInstalledPmpmPlugins();
  const index = plugins.findIndex((plugin) => plugin.manifest.metadata.id === pluginId);
  if (index < 0) return;

  const existing = plugins[index];
  if (existing.enabled === false && existing.disabledReason === 'policy') {
    return;
  }

  const now = Date.now();
  const message = formatErrorMessage(options.message).slice(0, 2000);

  plugins[index] = {
    ...existing,
    enabled: false,
    disabledReason: 'quarantine',
    lastError: `[quarantine] ${message}`,
    lastErrorAt: now,
  };

  saveInstalledPmpmPlugins(plugins);
  try {
    if (typeof options.timeoutMs === 'number') {
      recordPmpmAuditEvent({
        type: 'runtime-unresponsive',
        pluginId,
        surface: options.surface ?? 'command',
        timeoutMs: options.timeoutMs,
      });
    }
    recordPmpmAuditEvent({
      type: 'quarantined',
      pluginId,
      surface: options.surface ?? 'command',
      message,
      timeoutMs: options.timeoutMs,
    });
  } catch {
    // ignore
  }
}

export function clearPmpmPluginQuarantine(pluginId: string, reason = 'manual'): void {
  const plugins = loadInstalledPmpmPlugins();
  const index = plugins.findIndex((plugin) => plugin.manifest.metadata.id === pluginId);
  if (index < 0) return;

  const existing = plugins[index];
  if (existing.disabledReason !== 'quarantine') return;

  plugins[index] = {
    ...existing,
    enabled: false,
    disabledReason: 'manual',
  };

  saveInstalledPmpmPlugins(plugins);
  try {
    recordPmpmAuditEvent({
      type: 'quarantine-cleared',
      pluginId,
      reason,
    });
  } catch {
    // ignore
  }
}

export function recordPmpmPluginCrash(
  pluginId: string,
  error: unknown,
  surface: PmpmPluginCrashSurface
): void {
  const plugins = loadInstalledPmpmPlugins();
  const index = plugins.findIndex((plugin) => plugin.manifest.metadata.id === pluginId);
  if (index < 0) return;

  const existing = plugins[index];
  if (
    existing.enabled === false &&
    (existing.disabledReason === 'policy' || existing.disabledReason === 'quarantine')
  ) {
    return;
  }

  const now = Date.now();
  const message = formatErrorMessage(error).slice(0, 2000);
  const lastError = `[${surface}] ${message}`;

  plugins[index] = {
    ...existing,
    enabled: false,
    disabledReason: 'crash',
    lastError,
    lastErrorAt: now,
  };

  saveInstalledPmpmPlugins(plugins);
  try {
    recordPmpmAuditEvent({ type: 'crash', pluginId, surface, message });
  } catch {
    // ignore
  }
}

export function setPmpmPluginEnabled(pluginId: string, enabled: boolean): void {
  const plugins = loadInstalledPmpmPlugins();
  const index = plugins.findIndex((plugin) => plugin.manifest.metadata.id === pluginId);
  if (index < 0) return;

  const prev = plugins[index];
  const nextEnabled = Boolean(enabled);
  const prevEnabled = prev.enabled ?? true;
  if (nextEnabled && prev.disabledReason === 'quarantine') return;

  if (prevEnabled === nextEnabled) return;

  plugins[index] = nextEnabled
    ? { ...prev, enabled: true, disabledReason: undefined }
    : { ...prev, enabled: false, disabledReason: 'manual' };

  saveInstalledPmpmPlugins(plugins);
  try {
    recordPmpmAuditEvent({
      type: nextEnabled ? 'enabled' : 'disabled',
      pluginId,
      reason: nextEnabled ? undefined : 'manual',
    });
  } catch {
    // ignore
  }
}

function normalizePermissionList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.add(trimmed);
  }
  return Array.from(out).sort();
}

function isSameStringList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function setPmpmPluginDeniedPermissions(pluginId: string, denied: string[]): void {
  const plugins = loadInstalledPmpmPlugins();
  const index = plugins.findIndex((plugin) => plugin.manifest.metadata.id === pluginId);
  if (index < 0) return;

  const prev = plugins[index];
  const nextDenied = normalizePermissionList(denied);
  const prevDenied = normalizePermissionList(prev.deniedPermissions);

  if (isSameStringList(prevDenied, nextDenied)) return;

  plugins[index] = {
    ...prev,
    deniedPermissions: nextDenied.length > 0 ? nextDenied : undefined,
  };

  saveInstalledPmpmPlugins(plugins);
  try {
    recordPmpmAuditEvent({ type: 'permissions-updated', pluginId, deniedPermissions: nextDenied });
  } catch {
    // ignore
  }
}

function buildFootprintFromManifest(plugin: InstalledPmpmPlugin): Pick<Magnet, 'anchorType' | 'gridFootprint'> {
  const anchor = plugin.manifest.magnet?.defaultAnchor;
  const coords = anchor?.coordinates?.filter(Boolean) ?? [];

  if (coords.length >= 2) {
    const [a, b] = coords;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);

    const width = Math.max(1, maxX - minX + 1);
    const height = Math.max(1, maxY - minY + 1);

    if (minY === maxY) {
      return { anchorType: 'horizontal', gridFootprint: { width, height: 1 } };
    }

    if (minX === maxX) {
      return { anchorType: 'vertical', gridFootprint: { width: 1, height } };
    }

    return { anchorType: 'rectangular', gridFootprint: { width, height } };
  }

  return { anchorType: 'single', gridFootprint: { width: 1, height: 1 } };
}

export function createMagnetTemplateFromPlugin(plugin: InstalledPmpmPlugin): Magnet {
  const { id, name, description, tags } = plugin.manifest.metadata;
  const { anchorType, gridFootprint } = buildFootprintFromManifest(plugin);

  const style: Magnet['style'] = {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '2.7px',
    padding: '8px',
    ...(plugin.manifest.magnet?.defaultStyle ?? {}),
  };

  return {
    id,
    type: 'custom',
    name,
    renderer: id,
    previewText: name,
    description,
    tags,
    anchorType,
    anchors: [],
    gridFootprint,
    content: '',
    style,
    bounds: createDefaultBoundsForMagnet(anchorType, {
      width: style.width,
      height: style.height,
    }),
    state: 'idle',
    interactions: {
      draggable: true,
      clickable: true,
    },
  };
}

export function getPluginRendererDefinition(id: string): MagnetRendererDefinition | null {
  const plugin = getInstalledPmpmPlugin(id);
  if (!plugin || !supportsPmpmPluginMagnetSurface(plugin)) return null;

  const enabled = plugin.enabled ?? true;

  return {
    id,
    source: 'plugin',
    description: plugin.manifest.metadata.description,
    group: 'plugin',
    tags: plugin.manifest.metadata.tags,
    metadata: {
      pluginVersion: plugin.manifest.metadata.version,
      permissions: plugin.manifest.permissions ?? [],
      enabled,
    },
    render: () =>
      enabled
        ? React.createElement(PluginMagnetHost, { pluginId: id })
        : React.createElement(DisabledPluginMagnet, { pluginId: id }),
    preview: plugin.manifest.metadata.name,
  };
}

function DisabledPluginMagnet({ pluginId }: { pluginId: string }) {
  const plugin = getInstalledPmpmPlugin(pluginId);
  const name = plugin?.manifest.metadata.name ?? pluginId;
  const reason = plugin?.disabledReason;
  const lastError = plugin?.lastError;

  return React.createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 6,
        padding: 10,
        boxSizing: 'border-box',
        color: 'rgba(255,255,255,0.78)',
      },
    },
    React.createElement('div', { style: { fontWeight: 700 } }, name || pluginId),
    React.createElement(
      'div',
      { style: { fontSize: 12, opacity: 0.75 } },
      reason === 'crash' ? 'Plugin disabled (crashed)' : 'Plugin disabled'
    ),
    lastError
      ? React.createElement('div', { style: { fontSize: 11, opacity: 0.7, whiteSpace: 'pre-wrap' } }, lastError)
      : null
  );
}
