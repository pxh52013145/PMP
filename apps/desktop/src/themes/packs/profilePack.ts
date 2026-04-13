import { strFromU8, strToU8, unzip, zip } from 'fflate';
import type { AsyncZippable, Unzipped } from 'fflate';

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
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
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

function ensureUint8Array(data: Uint8Array): Uint8Array {
  // Ensure `instanceof Uint8Array` matches the current realm (multiple JS realms can exist).
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

export type ProfilePackDependency = {
  id: string;
  version?: string;
  bundlePath?: string;
};

export type ProfilePackManifestV1 = {
  formatVersion: '1.0';
  type: 'profile-pack';
  metadata: {
    id: string;
    name: string;
    version: string;
    author?: string;
    description?: string;
    tags?: string[];
  };
  entry: {
    profile: string;
  };
  dependencies?: {
    pmps?: ProfilePackDependency[];
  };
};

export type ProfilePackChecksumsV1 = {
  formatVersion: '1.0';
  algorithm: 'sha256';
  files: Record<string, string>;
};

export type ProfileSourceV1 = {
  kind: 'pmpt';
  path: string;
};

export type ProfilePackProfileV1 = {
  formatVersion: '1.0';
  app?: { configVersion?: number };
  theme?: { source?: ProfileSourceV1 };
  magnets?: {
    spaces?: { storageKey?: string; value: unknown };
    spaceLayout?: { storageKey?: string; value: Record<string, unknown> };
    spaceConfig?: { storageKey?: string; value: Record<string, unknown> };
  };
};

function validateProfilePackChecksumsV1(value: unknown): asserts value is ProfilePackChecksumsV1 {
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

function validateDependency(dep: unknown, index: number, path: string): ProfilePackDependency {
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

export function validateProfilePackManifestV1(manifest: unknown): asserts manifest is ProfilePackManifestV1 {
  assertObject(manifest, 'manifest');

  if (manifest.formatVersion !== '1.0') {
    throw new Error('manifest.formatVersion must be "1.0"');
  }
  if (manifest.type !== 'profile-pack') {
    throw new Error('manifest.type must be "profile-pack"');
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
  if (typeof manifest.entry.profile !== 'string' || manifest.entry.profile.length < 1) {
    throw new Error('manifest.entry.profile is required');
  }

  if (typeof manifest.dependencies !== 'undefined') {
    assertObject(manifest.dependencies, 'manifest.dependencies');
    if (typeof manifest.dependencies.pmps !== 'undefined') {
      if (!Array.isArray(manifest.dependencies.pmps)) {
        throw new Error('manifest.dependencies.pmps must be an array');
      }
      manifest.dependencies.pmps = manifest.dependencies.pmps.map((dep, index) =>
        validateDependency(dep, index, 'manifest.dependencies.pmps')
      );
    }
  }
}

function validateProfilePackProfileV1(value: unknown): asserts value is ProfilePackProfileV1 {
  assertObject(value, 'profile');
  if (value.formatVersion !== '1.0') {
    throw new Error('profile.formatVersion must be "1.0"');
  }
}

async function verifyChecksums(
  zipFiles: Record<string, Uint8Array>,
  checksums: ProfilePackChecksumsV1,
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

export type ParsedProfilePack = {
  manifest: ProfilePackManifestV1;
  entryProfilePath: string;
  entryProfileBytes?: Uint8Array;
  entryProfileText?: string;
  profile?: ProfilePackProfileV1;
  themeEntry?: { path: string; bytes?: Uint8Array; text?: string };
  checksums?: ProfilePackChecksumsV1;
};

export async function parseProfilePackFromZipBytes(bytes: Uint8Array): Promise<ParsedProfilePack> {
  const files = await unzipAsync(bytes);

  const manifestBytes = findZipEntry(files, 'manifest.json');
  if (!manifestBytes) {
    const entries = Object.keys(files).slice(0, 20).join(', ');
    throw new Error(`Invalid profile pack: missing manifest.json (entries: ${entries || '(none)'})`);
  }

  const manifestRaw = strFromU8(manifestBytes);
  const manifestUnknown = JSON.parse(manifestRaw) as unknown;
  validateProfilePackManifestV1(manifestUnknown);

  const entryProfilePath = manifestUnknown.entry.profile;
  const profileBytes = findZipEntry(files, entryProfilePath);
  const profileText = profileBytes ? strFromU8(profileBytes) : undefined;
  const profileUnknown = profileText ? (JSON.parse(profileText) as unknown) : null;

  let profile: ProfilePackProfileV1 | undefined;
  if (profileUnknown) {
    validateProfilePackProfileV1(profileUnknown);
    profile = profileUnknown;
  }

  let checksums: ProfilePackChecksumsV1 | undefined;
  const checksumsBytes = findZipEntry(files, 'checksums.json');
  if (checksumsBytes) {
    const checksumsUnknown = JSON.parse(strFromU8(checksumsBytes)) as unknown;
    validateProfilePackChecksumsV1(checksumsUnknown);
    checksums = checksumsUnknown;
    await verifyChecksums(files, checksums, ['manifest.json', entryProfilePath]);
  }

  const themePath = profile?.theme?.source?.path;
  const normalizedThemePath = typeof themePath === 'string' ? themePath.trim() : '';
  const themeBytes = normalizedThemePath ? findZipEntry(files, normalizedThemePath) : undefined;
  const themeText = themeBytes ? strFromU8(themeBytes) : undefined;

  return {
    manifest: manifestUnknown,
    entryProfilePath,
    entryProfileBytes: profileBytes,
    entryProfileText: profileText,
    profile,
    themeEntry: normalizedThemePath ? { path: normalizedThemePath, bytes: themeBytes, text: themeText } : undefined,
    checksums,
  };
}

export async function createProfilePackZipBytes(options: {
  manifest: ProfilePackManifestV1;
  profile: ProfilePackProfileV1;
  profilePath?: string;
  themePath?: string;
  themeText?: string;
  checksums?: { enabled: boolean };
}): Promise<Uint8Array> {
  validateProfilePackManifestV1(options.manifest);
  validateProfilePackProfileV1(options.profile);

  const profilePath = normalizeChecksumPath(options.profilePath ?? options.manifest.entry.profile);
  const themePath = normalizeChecksumPath(options.themePath ?? options.profile.theme?.source?.path ?? 'theme.pmpt');
  const checksumsEnabled = options.checksums?.enabled ?? true;

  const zippable: AsyncZippable = {};
  zippable['manifest.json'] = ensureUint8Array(strToU8(JSON.stringify(options.manifest, null, 2)));
  zippable[profilePath] = ensureUint8Array(strToU8(JSON.stringify(options.profile, null, 2)));

  if (options.themeText) {
    zippable[themePath] = ensureUint8Array(strToU8(options.themeText));
  }

  if (checksumsEnabled) {
    const checksumTargets = ['manifest.json', profilePath, ...(options.themeText ? [themePath] : [])];
    const files: Record<string, string> = {};
    for (const path of checksumTargets) {
      const bytes = zippable[path];
      if (!(bytes instanceof Uint8Array)) {
        throw new Error(`Cannot checksum missing file: ${path}`);
      }
      files[path] = await sha256Hex(bytes);
    }
    const checksums: ProfilePackChecksumsV1 = {
      formatVersion: '1.0',
      algorithm: 'sha256',
      files,
    };
    zippable['checksums.json'] = ensureUint8Array(strToU8(JSON.stringify(checksums, null, 2)));
  }

  return await zipAsync(zippable);
}
