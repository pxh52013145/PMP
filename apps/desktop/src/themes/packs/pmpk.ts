import { strFromU8, strToU8, unzip, zip } from 'fflate';
import type { AsyncZippable, Unzipped } from 'fflate';

import { validatePmpmManifest, type PmpmManifest } from '../../magnet-system/plugins/pmpm';
import { validatePmpsManifest, type PmpsManifest } from '../../shader-system/pmps';

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

async function zipAsync(data: AsyncZippable): Promise<Uint8Array> {
  return await new Promise((resolve, reject) => {
    zip(data, (err, zipped) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(zipped);
    });
  });
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

function ensureUint8Array(data: Uint8Array): Uint8Array {
  // Ensure `instanceof Uint8Array` matches the current realm (Vitest/jsdom may involve multiple realms).
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle?.digest) {
    throw new Error('crypto.subtle.digest is not available');
  }

  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export type ThemePackDependency = {
  id: string;
  version?: string;
  bundlePath?: string;
};

export type ThemePackManifestV1 = {
  formatVersion: '1.0';
  type: 'theme-pack';
  metadata: {
    id: string;
    name: string;
    version: string;
    author?: string;
    description?: string;
    tags?: string[];
  };
  entry: {
    theme: string;
  };
  dependencies?: {
    pmpm?: ThemePackDependency[];
    pmps?: ThemePackDependency[];
  };
  requires?: {
    appVersion?: string;
    hostApiVersion?: string;
  };
  recommended?: {
    bindings?: Array<{ magnetId: string; rendererId: string }>;
  };
};

export type ThemePackChecksumsV1 = {
  formatVersion: '1.0';
  algorithm: 'sha256';
  files: Record<string, string>;
};

function validateThemePackChecksumsV1(value: unknown): asserts value is ThemePackChecksumsV1 {
  assertObject(value, 'checksums');
  if (value.formatVersion !== '1.0') {
    throw new Error('checksums.formatVersion must be "1.0"');
  }
  if (value.algorithm !== 'sha256') {
    throw new Error('checksums.algorithm must be "sha256"');
  }
  assertObject(value.files, 'checksums.files');
  for (const [key, digest] of Object.entries(value.files)) {
    if (typeof digest !== 'string' || digest.length < 1) {
      throw new Error(`checksums.files["${key}"] must be a string`);
    }
  }
}

function validateDependency(dep: unknown, index: number, path: string): ThemePackDependency {
  assertObject(dep, `${path}[${index}]`);
  const id = dep.id;
  if (typeof id !== 'string' || id.length < 1 || !isValidId(id)) {
    throw new Error(`${path}[${index}].id must be a valid id`);
  }
  const version = dep.version;
  if (typeof version !== 'undefined' && typeof version !== 'string') {
    throw new Error(`${path}[${index}].version must be a string`);
  }
  const bundlePath = dep.bundlePath;
  if (typeof bundlePath !== 'undefined' && typeof bundlePath !== 'string') {
    throw new Error(`${path}[${index}].bundlePath must be a string`);
  }
  return { id, version, bundlePath };
}

export function validateThemePackManifestV1(manifest: unknown): asserts manifest is ThemePackManifestV1 {
  assertObject(manifest, 'manifest');

  if (manifest.formatVersion !== '1.0') {
    throw new Error('manifest.formatVersion must be "1.0"');
  }
  if (manifest.type !== 'theme-pack') {
    throw new Error('manifest.type must be "theme-pack"');
  }

  assertObject(manifest.metadata, 'manifest.metadata');
  const id = manifest.metadata.id;
  if (typeof id !== 'string' || id.length < 1 || !isValidId(id)) {
    throw new Error('manifest.metadata.id must be a valid id');
  }
  if (typeof manifest.metadata.name !== 'string' || manifest.metadata.name.length < 1) {
    throw new Error('manifest.metadata.name is required');
  }
  if (typeof manifest.metadata.version !== 'string' || manifest.metadata.version.length < 1) {
    throw new Error('manifest.metadata.version is required');
  }
  if (typeof manifest.metadata.tags !== 'undefined' && !Array.isArray(manifest.metadata.tags)) {
    throw new Error('manifest.metadata.tags must be an array');
  }

  assertObject(manifest.entry, 'manifest.entry');
  if (typeof manifest.entry.theme !== 'string' || manifest.entry.theme.length < 1) {
    throw new Error('manifest.entry.theme is required');
  }

  if (typeof manifest.dependencies !== 'undefined') {
    assertObject(manifest.dependencies, 'manifest.dependencies');
    if (typeof manifest.dependencies.pmpm !== 'undefined') {
      if (!Array.isArray(manifest.dependencies.pmpm)) {
        throw new Error('manifest.dependencies.pmpm must be an array');
      }
      manifest.dependencies.pmpm = manifest.dependencies.pmpm.map((dep, index) =>
        validateDependency(dep, index, 'manifest.dependencies.pmpm')
      );
    }
    if (typeof manifest.dependencies.pmps !== 'undefined') {
      if (!Array.isArray(manifest.dependencies.pmps)) {
        throw new Error('manifest.dependencies.pmps must be an array');
      }
      manifest.dependencies.pmps = manifest.dependencies.pmps.map((dep, index) =>
        validateDependency(dep, index, 'manifest.dependencies.pmps')
      );
    }
  }

  if (typeof manifest.requires !== 'undefined') {
    assertObject(manifest.requires, 'manifest.requires');
    const { appVersion, hostApiVersion } = manifest.requires;
    if (typeof appVersion !== 'undefined' && typeof appVersion !== 'string') {
      throw new Error('manifest.requires.appVersion must be a string');
    }
    if (typeof hostApiVersion !== 'undefined' && typeof hostApiVersion !== 'string') {
      throw new Error('manifest.requires.hostApiVersion must be a string');
    }
  }

  if (typeof manifest.recommended !== 'undefined') {
    assertObject(manifest.recommended, 'manifest.recommended');
    if (typeof manifest.recommended.bindings !== 'undefined') {
      if (!Array.isArray(manifest.recommended.bindings)) {
        throw new Error('manifest.recommended.bindings must be an array');
      }
      for (let i = 0; i < manifest.recommended.bindings.length; i += 1) {
        const binding = manifest.recommended.bindings[i];
        assertObject(binding, `manifest.recommended.bindings[${i}]`);
        if (typeof binding.magnetId !== 'string' || binding.magnetId.length < 1) {
          throw new Error(`manifest.recommended.bindings[${i}].magnetId is required`);
        }
        if (typeof binding.rendererId !== 'string' || binding.rendererId.length < 1) {
          throw new Error(`manifest.recommended.bindings[${i}].rendererId is required`);
        }
      }
    }
  }
}

export type ParsedThemePackDependency = {
  kind: 'pmpm' | 'pmps';
  id: string;
  version?: string;
  bundlePath?: string;
  bundled: boolean;
  bundleBytes?: Uint8Array;
  bundleMeta?: {
    id: string;
    version: string;
    name: string;
    permissions?: string[];
  };
  bundleMetaError?: string;
};

export type ParsedThemePack = {
  manifest: ThemePackManifestV1;
  entryThemePath: string;
  entryThemeBytes?: Uint8Array;
  entryThemeText?: string;
  checksums?: ThemePackChecksumsV1;
  dependencies: ParsedThemePackDependency[];
};

function normalizeChecksumPath(path: string): string {
  return normalizeZipPath(path).replace(/\\/g, '/');
}

function resolveChecksumKey(files: Record<string, string>, path: string): string | null {
  const target = normalizeChecksumPath(path).toLowerCase();
  for (const key of Object.keys(files)) {
    if (normalizeChecksumPath(key).toLowerCase() === target) return key;
  }
  return null;
}

async function verifyThemePackChecksums(
  zipFiles: Record<string, Uint8Array>,
  checksums: ThemePackChecksumsV1,
  requiredPaths: string[]
): Promise<void> {
  for (const path of requiredPaths) {
    const key = resolveChecksumKey(checksums.files, path);
    if (!key) {
      throw new Error(`checksums.json missing required file entry: ${normalizeChecksumPath(path)}`);
    }
  }

  for (const [path, expected] of Object.entries(checksums.files)) {
    const bytes = findZipEntry(zipFiles, path);
    if (!bytes) {
      throw new Error(`checksums.json references missing file: ${normalizeChecksumPath(path)}`);
    }
    const computed = await sha256Hex(bytes);
    if (computed !== expected) {
      throw new Error(
        `Integrity check failed (sha256 mismatch): ${normalizeChecksumPath(path)} (expected ${expected}, got ${computed})`
      );
    }
  }
}

export async function parseThemePackFromZipBytes(bytes: Uint8Array): Promise<ParsedThemePack> {
  const files = await unzipAsync(bytes);

  const manifestBytes = findZipEntry(files, 'manifest.json');
  if (!manifestBytes) {
    throw new Error('Invalid .pmpk: missing manifest.json');
  }

  const manifestRaw = strFromU8(manifestBytes);
  const manifestUnknown = JSON.parse(manifestRaw) as unknown;
  validateThemePackManifestV1(manifestUnknown);

  const entryThemePath = manifestUnknown.entry.theme;
  const themeBytes = findZipEntry(files, entryThemePath);
  const themeText = themeBytes ? strFromU8(themeBytes) : undefined;

  let checksums: ThemePackChecksumsV1 | undefined;
  const checksumsBytes = findZipEntry(files, 'checksums.json');
  if (checksumsBytes) {
    const checksumsUnknown = JSON.parse(strFromU8(checksumsBytes)) as unknown;
    validateThemePackChecksumsV1(checksumsUnknown);
    checksums = checksumsUnknown;
    await verifyThemePackChecksums(files, checksums, ['manifest.json', entryThemePath]);
  }

  const dependencies: ParsedThemePackDependency[] = [];

  const pmpmDeps = manifestUnknown.dependencies?.pmpm ?? [];
  for (const dep of pmpmDeps) {
    const bundlePath = dep.bundlePath;
    const bundleBytes = bundlePath ? findZipEntry(files, bundlePath) : undefined;
    let bundleMeta: ParsedThemePackDependency['bundleMeta'];
    let bundleMetaError: string | undefined;
    if (bundleBytes) {
      try {
        const meta = await readPmpmMetaFromZipBytes(bundleBytes);
        bundleMeta = meta;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bundleMetaError = message;
      }
    }
    dependencies.push({
      kind: 'pmpm',
      id: dep.id,
      version: dep.version,
      bundlePath,
      bundled: typeof bundleBytes !== 'undefined',
      bundleBytes,
      bundleMeta,
      bundleMetaError,
    });
  }

  const pmpsDeps = manifestUnknown.dependencies?.pmps ?? [];
  for (const dep of pmpsDeps) {
    const bundlePath = dep.bundlePath;
    const bundleBytes = bundlePath ? findZipEntry(files, bundlePath) : undefined;
    let bundleMeta: ParsedThemePackDependency['bundleMeta'];
    let bundleMetaError: string | undefined;
    if (bundleBytes) {
      try {
        const meta = await readPmpsMetaFromZipBytes(bundleBytes);
        bundleMeta = meta;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bundleMetaError = message;
      }
    }
    dependencies.push({
      kind: 'pmps',
      id: dep.id,
      version: dep.version,
      bundlePath,
      bundled: typeof bundleBytes !== 'undefined',
      bundleBytes,
      bundleMeta,
      bundleMetaError,
    });
  }

  return {
    manifest: manifestUnknown,
    entryThemePath,
    entryThemeBytes: themeBytes,
    entryThemeText: themeText,
    checksums,
    dependencies,
  };
}

export async function readPmpmMetaFromZipBytes(bytes: Uint8Array): Promise<{
  id: string;
  version: string;
  name: string;
  permissions?: string[];
}> {
  const files = await unzipAsync(bytes);
  const manifestBytes = findZipEntry(files, 'manifest.json');
  if (!manifestBytes) {
    throw new Error('Invalid bundled .pmpm: missing manifest.json');
  }
  const manifestRaw = strFromU8(manifestBytes);
  const manifestUnknown = JSON.parse(manifestRaw) as unknown;
  validatePmpmManifest(manifestUnknown);
  const manifest = manifestUnknown as PmpmManifest;
  return {
    id: manifest.metadata.id,
    version: manifest.metadata.version,
    name: manifest.metadata.name,
    permissions: manifest.permissions,
  };
}

export async function readPmpsMetaFromZipBytes(bytes: Uint8Array): Promise<{
  id: string;
  version: string;
  name: string;
}> {
  const files = await unzipAsync(bytes);
  const manifestBytes = findZipEntry(files, 'manifest.json');
  if (!manifestBytes) {
    throw new Error('Invalid bundled .pmps: missing manifest.json');
  }
  const manifestRaw = strFromU8(manifestBytes);
  const manifestUnknown = JSON.parse(manifestRaw) as unknown;
  validatePmpsManifest(manifestUnknown);
  const manifest = manifestUnknown as PmpsManifest;
  return {
    id: manifest.metadata.id,
    version: manifest.metadata.version,
    name: manifest.metadata.name,
  };
}

export async function createThemePackZipBytes(options: {
  manifest: ThemePackManifestV1;
  themeText: string;
  bundles?: Record<string, Uint8Array>;
  checksums?: { enabled: boolean };
}): Promise<Uint8Array> {
  const { manifest, themeText } = options;
  validateThemePackManifestV1(manifest);

  const manifestText = JSON.stringify(manifest, null, 2);
  const entryThemePath = manifest.entry.theme;
  const normalizedEntryThemePath = normalizeChecksumPath(entryThemePath);

  const zippable: AsyncZippable = {
    'manifest.json': ensureUint8Array(strToU8(manifestText)),
    [normalizedEntryThemePath]: ensureUint8Array(strToU8(themeText)),
  };

  const bundles = options.bundles ?? {};

  const deps = manifest.dependencies;
  const bundlePaths: string[] = [];
  const addBundlePath = (path: string | undefined) => {
    if (!path) return;
    bundlePaths.push(normalizeChecksumPath(path));
  };

  for (const dep of deps?.pmpm ?? []) addBundlePath(dep.bundlePath);
  for (const dep of deps?.pmps ?? []) addBundlePath(dep.bundlePath);

  for (const path of bundlePaths) {
    const bytes = bundles[path];
    if (!bytes) {
      throw new Error(`Missing bundled bytes for ${path}`);
    }
    zippable[path] = ensureUint8Array(bytes);
  }

  const checksumsEnabled = options.checksums?.enabled ?? true;
  if (checksumsEnabled) {
    const files: Record<string, string> = {};
    const checksumTargets = ['manifest.json', normalizedEntryThemePath, ...bundlePaths];
    for (const path of checksumTargets) {
      const bytes = zippable[path];
      if (!(bytes instanceof Uint8Array)) {
        throw new Error(`Cannot checksum missing file: ${path}`);
      }
      files[path] = await sha256Hex(bytes);
    }
    const checksums: ThemePackChecksumsV1 = {
      formatVersion: '1.0',
      algorithm: 'sha256',
      files,
    };
    zippable['checksums.json'] = ensureUint8Array(strToU8(JSON.stringify(checksums, null, 2)));
  }

  return await zipAsync(zippable);
}
