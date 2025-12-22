import { strFromU8, unzipSync } from 'fflate';
import { readJson } from '../modules/storage';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate } from '../utils/windowCommunication';

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
  fragmentCode: string;
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

export async function parsePmpsShaderPackFromZipBytes(
  bytes: Uint8Array
): Promise<Omit<InstalledPmpsShaderPack, 'installedAt'>> {
  const files = unzipSync(bytes);

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

function saveInstalledPmpsShaderPacks(packs: InstalledPmpsShaderPack[]): void {
  if (typeof window === 'undefined') return;
  void broadcastDataUpdate(STORAGE_KEYS.PMPS_SHADERS, packs, TAURI_EVENTS.PMPS_SHADERS_UPDATED);
}

export function getInstalledPmpsShaderPack(id: string): InstalledPmpsShaderPack | null {
  const packs = loadInstalledPmpsShaderPacks();
  return packs.find((p) => p.manifest.metadata.id === id) ?? null;
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
  upsertInstalledPmpsShaderPack(pack);
  return pack;
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
  upsertInstalledPmpsShaderPack(pack);
  return pack;
}
