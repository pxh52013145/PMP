import { strFromU8, unzip } from 'fflate';
import type { Unzipped } from 'fflate';
import { invokeWithTelemetry } from '../services/telemetry/tauriInvokeTelemetry';
import {
  readDurableText,
  readJson,
  readString,
  removeDurableText,
  tryWriteJson,
  writeDurableText,
  writeJson,
  writeString,
} from '../modules/storage';
import { isTauriRuntime } from '../utils/tauriRuntime';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastSignal } from '../utils/windowCommunication';

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

export type PmpsEntryPoint = 'auto' | 'main' | 'shadertoy';

export type PmpsUniformType = 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'color';

export type PmpsUniformDefinition = {
  name: string;
  type: PmpsUniformType;
  default: number | boolean | string | number[];
  min?: number;
  max?: number;
  step?: number;
  group?: string;
};

export type PmpsManifest = {
  formatVersion: '2.0';
  type: 'shader-pack';
  metadata: {
    id: string;
    name: string;
    version: string;
    author?: string;
    description?: string;
    license?: string;
    tags?: string[];
  };
  entry: {
    fragment: string;
    entryPoint?: PmpsEntryPoint;
  };
  uniforms?: PmpsUniformDefinition[];
  channels?: Record<string, string>;
  render?: {
    fpsLimit?: number;
    resolutionScale?: number;
  };
};

export type InstalledPmpsShaderPack = {
  manifest: PmpsManifest;
  fragmentCode?: string;
  installedAt: number;
  source: 'pmps' | 'glsl';
  packageSha256?: string;
  manifestSha256?: string;
  fragmentSha256?: string;
};

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

async function sha256HexIfAvailable(data: Uint8Array): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle?.digest) return undefined;
  try {
    const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(data));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return undefined;
  }
}

export type ResolvedPmpsShaderPack = InstalledPmpsShaderPack & { fragmentCode: string };

export async function readPmpsFragmentCode(shaderId: string): Promise<string | null> {
  return readDurableText('pmps-fragment', shaderId);
}

async function persistPmpsFragmentCode(shaderId: string, fragmentCode: string): Promise<boolean> {
  const ok = await writeDurableText('pmps-fragment', shaderId, fragmentCode);
  if (!ok) return false;
  const readBack = await readDurableText('pmps-fragment', shaderId);
  return readBack === fragmentCode;
}

async function removePmpsFragmentCode(shaderId: string): Promise<void> {
  await removeDurableText('pmps-fragment', shaderId);
}

const PMPS_DURABLE_MIGRATION_V1_BACKUP_ID = 'pmps-shaders-v1';

type PmpsDurableMigrationStatus = 'running' | 'done' | 'partial' | 'failed' | 'rolled-back';

type PmpsDurableMigrationFailureStage = 'backup' | 'persist' | 'save';

export type PmpsDurableMigrationFailure = {
  shaderId: string;
  stage: PmpsDurableMigrationFailureStage;
  message: string;
};

export type PmpsDurableMigrationReport = {
  version: 1;
  startedAt: number;
  finishedAt: number;
  status: PmpsDurableMigrationStatus;
  candidates: number;
  migrated: number;
  failed: number;
  backup: { existed: boolean; created: boolean };
  failures: PmpsDurableMigrationFailure[];
};

function persistPmpsMigrationReport(report: PmpsDurableMigrationReport): void {
  writeJson(STORAGE_KEYS.PMPS_DURABLE_MIGRATION_V1_REPORT, report, { mode: 'sync' });
}

async function ensurePmpsMigrationBackup(raw: string): Promise<
  | { ok: true; existed: boolean; created: boolean }
  | { ok: false; message: string }
> {
  const existing = await readDurableText('migration-backup', PMPS_DURABLE_MIGRATION_V1_BACKUP_ID);
  if (typeof existing === 'string') {
    return { ok: true, existed: true, created: false };
  }

  const written = await writeDurableText('migration-backup', PMPS_DURABLE_MIGRATION_V1_BACKUP_ID, raw);
  if (!written) {
    return { ok: false, message: 'writeDurableText failed' };
  }

  const readBack = await readDurableText('migration-backup', PMPS_DURABLE_MIGRATION_V1_BACKUP_ID);
  if (readBack !== raw) {
    return { ok: false, message: 'backup readback mismatch' };
  }

  return { ok: true, existed: false, created: true };
}

function saveInstalledPmpsShaderPacks(packs: InstalledPmpsShaderPack[]): boolean {
  if (typeof window === 'undefined') return false;
  const ok = tryWriteJson(STORAGE_KEYS.PMPS_SHADERS, packs);
  if (!ok) return false;
  void broadcastSignal(TAURI_EVENTS.PMPS_SHADERS_UPDATED);
  return true;
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error(`${path} must be an object`);
  }
}

function normalizeZipPath(path: string): string {
  return path.replace(/^\.?\//, '');
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

function isValidId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id);
}

function validateUniform(uniform: unknown, index: number): void {
  assertObject(uniform, `manifest.uniforms[${index}]`);
  const name = uniform.name;
  if (typeof name !== 'string' || name.length < 1) {
    throw new Error(`manifest.uniforms[${index}].name is required`);
  }

  const type = uniform.type;
  const allowed: PmpsUniformType[] = ['float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'color'];
  if (typeof type !== 'string' || !allowed.includes(type as PmpsUniformType)) {
    throw new Error(`manifest.uniforms[${index}].type must be one of ${allowed.join(', ')}`);
  }

  if (!('default' in uniform)) {
    throw new Error(`manifest.uniforms[${index}].default is required`);
  }
}

export function validatePmpsManifest(manifest: unknown): asserts manifest is PmpsManifest {
  assertObject(manifest, 'manifest');

  if (manifest.formatVersion !== '2.0') {
    throw new Error('manifest.formatVersion must be "2.0"');
  }
  if (manifest.type !== 'shader-pack') {
    throw new Error('manifest.type must be "shader-pack"');
  }

  assertObject(manifest.metadata, 'manifest.metadata');
  const id = manifest.metadata.id;
  if (typeof id !== 'string' || id.length < 3) throw new Error('manifest.metadata.id is required');
  if (!isValidId(id)) throw new Error('manifest.metadata.id must match /^[a-z0-9-]+$/');
  const name = manifest.metadata.name;
  if (typeof name !== 'string' || name.length < 1) throw new Error('manifest.metadata.name is required');
  const version = manifest.metadata.version;
  if (typeof version !== 'string' || version.length < 1) {
    throw new Error('manifest.metadata.version is required');
  }

  assertObject(manifest.entry, 'manifest.entry');
  const fragment = manifest.entry.fragment;
  if (typeof fragment !== 'string' || fragment.length < 1) {
    throw new Error('manifest.entry.fragment is required');
  }
  const entryPoint = manifest.entry.entryPoint;
  if (typeof entryPoint !== 'undefined') {
    const allowed: PmpsEntryPoint[] = ['auto', 'main', 'shadertoy'];
    if (typeof entryPoint !== 'string' || !allowed.includes(entryPoint as PmpsEntryPoint)) {
      throw new Error(`manifest.entry.entryPoint must be one of ${allowed.join(', ')}`);
    }
  }

  if (typeof manifest.uniforms !== 'undefined') {
    if (!Array.isArray(manifest.uniforms)) throw new Error('manifest.uniforms must be an array');
    manifest.uniforms.forEach((u, index) => validateUniform(u, index));
  }

  if (typeof manifest.channels !== 'undefined') {
    assertObject(manifest.channels, 'manifest.channels');
    for (const [key, value] of Object.entries(manifest.channels)) {
      if (typeof value !== 'string' || value.length < 1) {
        throw new Error(`manifest.channels.${key} must be a non-empty string`);
      }
    }
  }

  if (typeof manifest.render !== 'undefined') {
    assertObject(manifest.render, 'manifest.render');
    const fpsLimit = manifest.render.fpsLimit;
    if (typeof fpsLimit !== 'undefined') {
      if (typeof fpsLimit !== 'number' || !Number.isFinite(fpsLimit) || fpsLimit <= 0) {
        throw new Error('manifest.render.fpsLimit must be a positive number');
      }
    }
    const resolutionScale = manifest.render.resolutionScale;
    if (typeof resolutionScale !== 'undefined') {
      if (
        typeof resolutionScale !== 'number' ||
        !Number.isFinite(resolutionScale) ||
        resolutionScale <= 0
      ) {
        throw new Error('manifest.render.resolutionScale must be a positive number');
      }
    }
  }
}

type NativePmpsPackParseResult = {
  manifest: unknown;
  fragmentText: string;
  packageSha256?: string;
  manifestSha256?: string;
  fragmentSha256?: string;
};

async function tryParsePmpsShaderPackWithNative(
  bytes: Uint8Array
): Promise<Omit<InstalledPmpsShaderPack, 'installedAt'> | null> {
  if (!isTauriRuntime()) return null;

  try {
    const result = await invokeWithTelemetry<NativePmpsPackParseResult>(
      'pack_parse_pmps_pack_bytes',
      { bytes: Array.from(bytes) },
      {
        moduleId: 'shader-system',
        component: 'pmps',
        event: 'shader-system.pmps.parse-native',
        failureLevel: 'debug',
      }
    );

    validatePmpsManifest(result.manifest);
    if (typeof result.fragmentText !== 'string') {
      throw new Error('Native PMPS parser returned invalid fragmentText');
    }

    return {
      manifest: result.manifest,
      fragmentCode: result.fragmentText,
      source: 'pmps',
      packageSha256: result.packageSha256,
      manifestSha256: result.manifestSha256,
      fragmentSha256: result.fragmentSha256,
    };
  } catch {
    return null;
  }
}

export async function parsePmpsShaderPackFromZipBytes(
  bytes: Uint8Array
): Promise<Omit<InstalledPmpsShaderPack, 'installedAt'>> {
  const nativeParsed = await tryParsePmpsShaderPackWithNative(bytes);
  if (nativeParsed) return nativeParsed;

  const files = await unzipAsync(bytes);

  const manifestBytes = findZipEntry(files, 'manifest.json');
  if (!manifestBytes) {
    throw new Error('Invalid .pmps: missing manifest.json');
  }

  const manifestRaw = strFromU8(manifestBytes);
  const manifestUnknown = JSON.parse(manifestRaw) as unknown;
  validatePmpsManifest(manifestUnknown);

  const fragmentKey = normalizeZipPath(manifestUnknown.entry.fragment);
  const fragmentBytes = findZipEntry(files, fragmentKey) ?? findZipEntry(files, manifestUnknown.entry.fragment);
  if (!fragmentBytes) {
    throw new Error(`Invalid .pmps: missing fragment "${manifestUnknown.entry.fragment}"`);
  }

  const fragmentCode = strFromU8(fragmentBytes);

  const [packageSha256, manifestSha256, fragmentSha256] = await Promise.all([
    sha256HexIfAvailable(bytes),
    sha256HexIfAvailable(manifestBytes),
    sha256HexIfAvailable(fragmentBytes),
  ]);

  return {
    manifest: manifestUnknown,
    fragmentCode,
    source: 'pmps',
    packageSha256,
    manifestSha256,
    fragmentSha256,
  };
}

function filenameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

function slugify(value: string): string {
  const lowered = value.trim().toLowerCase();
  const replaced = lowered.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return replaced.length > 0 ? replaced : 'shader';
}

export async function createPmpsShaderPackFromGlslSource(
  options: { filename: string; fragmentCode: string }
): Promise<Omit<InstalledPmpsShaderPack, 'installedAt'>> {
  const base = options.filename.replace(/\.(glsl|frag)$/i, '');
  const baseSlug = slugify(base);
  const fragmentBytes = new TextEncoder().encode(options.fragmentCode);
  const fragmentSha256 = await sha256HexIfAvailable(fragmentBytes);
  const idSuffix = fragmentSha256?.slice(0, 8) ?? Math.random().toString(16).slice(2, 10);
  const id = `shader-${baseSlug}-${idSuffix}`;

  const manifest: PmpsManifest = {
    formatVersion: '2.0',
    type: 'shader-pack',
    metadata: {
      id,
      name: base,
      version: '0.1.0',
    },
    entry: {
      fragment: 'fragment.glsl',
      entryPoint: 'auto',
    },
  };

  return {
    manifest,
    fragmentCode: options.fragmentCode,
    source: 'glsl',
    fragmentSha256,
  };
}

export async function parsePmpsShaderPackFromFilePath(
  filePath: string
): Promise<InstalledPmpsShaderPack> {
  const extension = filenameFromPath(filePath).split('.').pop()?.toLowerCase();
  if (extension === 'glsl' || extension === 'frag') {
    const { readTextFile } = await import('@tauri-apps/api/fs');
    const fragmentCode = await readTextFile(filePath);
    const pack = await createPmpsShaderPackFromGlslSource({
      filename: filenameFromPath(filePath),
      fragmentCode,
    });
    return { ...pack, installedAt: Date.now() };
  }

  const { readBinaryFile } = await import('@tauri-apps/api/fs');
  const bytes = await readBinaryFile(filePath);
  const pack = await parsePmpsShaderPackFromZipBytes(new Uint8Array(bytes));
  return { ...pack, installedAt: Date.now() };
}

export async function parsePmpsShaderPackFromFile(file: File): Promise<InstalledPmpsShaderPack> {
  const filename = file.name || 'shader.pmps';
  const extension = filename.split('.').pop()?.toLowerCase();

  if (extension === 'glsl' || extension === 'frag') {
    const fragmentCode = await file.text();
    const pack = await createPmpsShaderPackFromGlslSource({ filename, fragmentCode });
    return { ...pack, installedAt: Date.now() };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const pack = await parsePmpsShaderPackFromZipBytes(bytes);
  return { ...pack, installedAt: Date.now() };
}

export function loadInstalledPmpsShaderPacks(): InstalledPmpsShaderPack[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = readJson<unknown>(STORAGE_KEYS.PMPS_SHADERS, []);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean) as InstalledPmpsShaderPack[];
  } catch {
    return [];
  }
}

export async function migrateInstalledPmpsShaderPacksToDurableStorage(options: { force?: boolean } = {}): Promise<{
  migrated: number;
  failed: number;
  skipped?: boolean;
}> {
  const packs = loadInstalledPmpsShaderPacks();
  if (packs.length === 0) return { migrated: 0, failed: 0 };

  const candidates = packs.filter((pack) => {
    const fragmentCode = pack.fragmentCode;
    return typeof fragmentCode === 'string' && fragmentCode.length > 0;
  });

  const migrationFlag = readString(STORAGE_KEYS.PMPS_DURABLE_MIGRATION_V1);
  if (!options.force && migrationFlag === 'rolled-back') {
    return { migrated: 0, failed: 0, skipped: true };
  }
  if (!options.force && migrationFlag === 'done' && candidates.length === 0) {
    return { migrated: 0, failed: 0, skipped: true };
  }

  const startedAt = Date.now();
  writeString(STORAGE_KEYS.PMPS_DURABLE_MIGRATION_V1, 'running');

  let migrated = 0;
  let failed = 0;
  let changed = false;
  const failures: PmpsDurableMigrationFailure[] = [];
  let backupInfo: PmpsDurableMigrationReport['backup'] = { existed: false, created: false };

  const next = packs.map((pack) => ({ ...pack }));

  if (candidates.length > 0) {
    const raw = readString(STORAGE_KEYS.PMPS_SHADERS) ?? JSON.stringify(packs);
    const backup = await ensurePmpsMigrationBackup(raw);
    if (!backup.ok) {
      const report: PmpsDurableMigrationReport = {
        version: 1,
        startedAt,
        finishedAt: Date.now(),
        status: 'failed',
        candidates: candidates.length,
        migrated: 0,
        failed: candidates.length,
        backup: backupInfo,
        failures: [{ shaderId: '*', stage: 'backup', message: backup.message }],
      };
      persistPmpsMigrationReport(report);
      writeString(STORAGE_KEYS.PMPS_DURABLE_MIGRATION_V1, 'failed');
      return { migrated: 0, failed: candidates.length };
    }
    backupInfo = { existed: backup.existed, created: backup.created };
  }

  for (let i = 0; i < next.length; i += 1) {
    const pack = next[i];
    const shaderId = pack.manifest.metadata.id;
    const fragmentCode = pack.fragmentCode;
    if (typeof fragmentCode !== 'string' || fragmentCode.length === 0) continue;

    const ok = await persistPmpsFragmentCode(shaderId, fragmentCode);
    if (!ok) {
      failed += 1;
      failures.push({ shaderId, stage: 'persist', message: 'persist durable fragment failed' });
      continue;
    }

    delete pack.fragmentCode;
    migrated += 1;
    changed = true;
  }

  if (changed) {
    const ok = saveInstalledPmpsShaderPacks(next);
    if (!ok) {
      failures.push({ shaderId: '*', stage: 'save', message: 'failed to persist localStorage index' });
      failed = Math.max(failed, 1);
    }
  }

  const finishedAt = Date.now();
  const status: PmpsDurableMigrationStatus =
    failures.some((item) => item.stage === 'backup' || item.stage === 'save')
      ? 'failed'
      : failed === 0
        ? 'done'
        : 'partial';

  writeString(STORAGE_KEYS.PMPS_DURABLE_MIGRATION_V1, status);

  persistPmpsMigrationReport({
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

export function getInstalledPmpsShaderPack(id: string): InstalledPmpsShaderPack | null {
  const packs = loadInstalledPmpsShaderPacks();
  return packs.find((p) => p.manifest.metadata.id === id) ?? null;
}

export async function resolveInstalledPmpsShaderPack(id: string): Promise<ResolvedPmpsShaderPack | null> {
  const pack = getInstalledPmpsShaderPack(id);
  if (!pack) return null;

  const existing = pack.fragmentCode;
  if (typeof existing === 'string' && existing.length > 0) {
    return pack as ResolvedPmpsShaderPack;
  }

  const fragmentCode = await readPmpsFragmentCode(id);
  if (!fragmentCode) return null;
  return { ...pack, fragmentCode };
}

export function upsertInstalledPmpsShaderPack(pack: InstalledPmpsShaderPack): void {
  const packs = loadInstalledPmpsShaderPacks();
  const existingIndex = packs.findIndex((p) => p.manifest.metadata.id === pack.manifest.metadata.id);
  if (existingIndex >= 0) {
    packs.splice(existingIndex, 1, pack);
  } else {
    packs.push(pack);
  }
  saveInstalledPmpsShaderPacks(packs);
}

export function uninstallPmpsShaderPack(id: string): void {
  const packs = loadInstalledPmpsShaderPacks();
  saveInstalledPmpsShaderPacks(packs.filter((p) => p.manifest.metadata.id !== id));
  void removePmpsFragmentCode(id);
}

function isShaderPackList(value: unknown): value is InstalledPmpsShaderPack[] {
  return Array.isArray(value);
}

export async function rollbackPmpsDurableMigrationV1(options: {
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

  const backupRaw = await readDurableText('migration-backup', PMPS_DURABLE_MIGRATION_V1_BACKUP_ID);
  const preferBackup =
    options.strategy === 'backup' || (options.strategy !== 'rehydrate' && typeof backupRaw === 'string');

  if (preferBackup && typeof backupRaw === 'string') {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(backupRaw) as unknown;
    } catch {
      parsed = null;
    }

    if (isShaderPackList(parsed)) {
      const ok = saveInstalledPmpsShaderPacks(parsed);
      if (!ok) return { restored: 0, missing: 0, usedBackup: true, ok: false };

      writeString(STORAGE_KEYS.PMPS_DURABLE_MIGRATION_V1, 'rolled-back');
      return { restored: parsed.length, missing: 0, usedBackup: true, ok: true };
    }
  }

  const installed = loadInstalledPmpsShaderPacks();
  if (installed.length === 0) {
    writeString(STORAGE_KEYS.PMPS_DURABLE_MIGRATION_V1, 'rolled-back');
    return { restored: 0, missing: 0, usedBackup: false, ok: true };
  }

  let restored = 0;
  let missing = 0;

  const next = installed.map((pack) => ({ ...pack }));

  for (let i = 0; i < next.length; i += 1) {
    const pack = next[i];
    const shaderId = pack.manifest.metadata.id;
    if (typeof pack.fragmentCode === 'string' && pack.fragmentCode.length > 0) continue;
    const fragmentCode = await readPmpsFragmentCode(shaderId);
    if (!fragmentCode) {
      missing += 1;
      continue;
    }
    pack.fragmentCode = fragmentCode;
    restored += 1;
  }

  const ok = saveInstalledPmpsShaderPacks(next);
  if (!ok) return { restored: 0, missing, usedBackup: false, ok: false };

  if (options.removeDurableEntries) {
    for (const pack of next) {
      const shaderId = pack.manifest.metadata.id;
      await removePmpsFragmentCode(shaderId);
    }
  }

  writeString(STORAGE_KEYS.PMPS_DURABLE_MIGRATION_V1, 'rolled-back');
  return { restored, missing, usedBackup: false, ok: true };
}

export async function installPmpsShaderPackFromZipBytes(
  bytes: Uint8Array,
  options: { overwrite?: boolean } = {}
): Promise<InstalledPmpsShaderPack> {
  const parsed = await parsePmpsShaderPackFromZipBytes(bytes);
  const pack: InstalledPmpsShaderPack = { ...parsed, installedAt: Date.now() };
  const exists = Boolean(getInstalledPmpsShaderPack(pack.manifest.metadata.id));
  if (exists && options.overwrite === false) {
    throw new Error(`Shader "${pack.manifest.metadata.id}" is already installed`);
  }

  const fragmentCode = pack.fragmentCode;
  const stored =
    typeof fragmentCode === 'string' && fragmentCode.length > 0
      ? await persistPmpsFragmentCode(pack.manifest.metadata.id, fragmentCode)
      : false;

  const persisted = stored ? { ...pack, fragmentCode: undefined } : pack;
  upsertInstalledPmpsShaderPack(persisted);
  return persisted;
}

export async function installPmpsShaderPackFromFilePath(
  filePath: string,
  options: { overwrite?: boolean } = {}
): Promise<InstalledPmpsShaderPack> {
  const pack = await parsePmpsShaderPackFromFilePath(filePath);
  const exists = Boolean(getInstalledPmpsShaderPack(pack.manifest.metadata.id));
  if (exists && options.overwrite === false) {
    throw new Error(`Shader "${pack.manifest.metadata.id}" is already installed`);
  }

  const fragmentCode = pack.fragmentCode;
  const stored =
    typeof fragmentCode === 'string' && fragmentCode.length > 0
      ? await persistPmpsFragmentCode(pack.manifest.metadata.id, fragmentCode)
      : false;

  const persisted = stored ? { ...pack, fragmentCode: undefined } : pack;
  upsertInstalledPmpsShaderPack(persisted);
  return persisted;
}

export async function installPmpsShaderPackFromFile(
  file: File,
  options: { overwrite?: boolean } = {}
): Promise<InstalledPmpsShaderPack> {
  const pack = await parsePmpsShaderPackFromFile(file);
  const exists = Boolean(getInstalledPmpsShaderPack(pack.manifest.metadata.id));
  if (exists && options.overwrite === false) {
    throw new Error(`Shader "${pack.manifest.metadata.id}" is already installed`);
  }

  const fragmentCode = pack.fragmentCode;
  const stored =
    typeof fragmentCode === 'string' && fragmentCode.length > 0
      ? await persistPmpsFragmentCode(pack.manifest.metadata.id, fragmentCode)
      : false;

  const persisted = stored ? { ...pack, fragmentCode: undefined } : pack;
  upsertInstalledPmpsShaderPack(persisted);
  return persisted;
}
