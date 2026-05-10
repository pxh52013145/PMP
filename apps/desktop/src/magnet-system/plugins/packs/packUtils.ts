import { unzip } from 'fflate';
import type { Unzipped } from 'fflate';
import type { PmpChecksumsV1 } from '@pixel-matrix/plugin-platform-contracts';

export type PackZipFiles = Record<string, Uint8Array>;

const textEncoder = new TextEncoder();

export function comparePathStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export async function unzipPackAsync(bytes: Uint8Array): Promise<Unzipped> {
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

export function normalizePackPath(path: string): string {
  const normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');

  if (!normalized) {
    throw new Error('path is required');
  }
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`path must be relative: ${path}`);
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`path contains invalid segments: ${path}`);
  }

  return normalized;
}

export function normalizeRelativePath(path: string): string {
  return normalizePackPath(path);
}

export function getPackPathParent(path: string): string {
  const normalized = normalizePackPath(path);
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex > 0 ? normalized.slice(0, slashIndex) : '';
}

export function joinPackPath(root: string, path: string): string {
  const normalizedRoot = root ? normalizePackPath(root) : '';
  const normalizedPath = normalizePackPath(path);
  return normalizedRoot ? normalizePackPath(`${normalizedRoot}/${normalizedPath}`) : normalizedPath;
}

export function splitRelativePath(path: string): string[] {
  return normalizeRelativePath(path).split('/').filter((segment) => segment.length > 0);
}

export function getParentPath(path: string): string {
  const slashIndex = path.lastIndexOf('/');
  return slashIndex > 0 ? path.slice(0, slashIndex) : '';
}

export function findPackEntry(files: PackZipFiles, path: string): Uint8Array | undefined {
  const target = normalizePackPath(path).toLowerCase();
  for (const [key, value] of Object.entries(files)) {
    if (normalizePackPath(key).toLowerCase() === target) return value;
  }
  return undefined;
}

export function assertUniquePackEntryPaths(
  files: PackZipFiles,
  createError: (message: string) => Error = (message) => new Error(message)
): void {
  const seen = new Map<string, string>();
  for (const rawPath of Object.keys(files)) {
    let normalized: string;
    try {
      normalized = normalizePackPath(rawPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw createError(`Invalid zip entry path "${rawPath}": ${message}`);
    }

    const lookupPath = normalized.toLowerCase();
    const existingPath = seen.get(lookupPath);
    if (existingPath) {
      throw createError(`Duplicate zip entry path after normalization: ${existingPath} and ${rawPath}`);
    }
    seen.set(lookupPath, rawPath);
  }
}

export function normalizeChecksumPath(path: string): string {
  return normalizePackPath(path).toLowerCase();
}

export function resolveChecksumKey(files: Record<string, string>, path: string): string | null {
  const target = normalizeChecksumPath(path);
  for (const key of Object.keys(files)) {
    if (normalizeChecksumPath(key) === target) return key;
  }
  return null;
}

export function validateSha256(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.trim())) {
    throw new Error(`${path} must be a sha256 hex digest`);
  }
  return value.trim().toLowerCase();
}

export function normalizeSha256(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle?.digest) {
    throw new Error('crypto.subtle.digest is not available');
  }

  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function validateChecksumsObject(value: unknown): PmpChecksumsV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('checksums must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.formatVersion !== '1.0') {
    throw new Error('checksums.formatVersion must be "1.0"');
  }
  if (record.algorithm !== 'sha256') {
    throw new Error('checksums.algorithm must be "sha256"');
  }
  if (!record.files || typeof record.files !== 'object' || Array.isArray(record.files)) {
    throw new Error('checksums.files must be an object');
  }

  const files: Record<string, string> = {};
  const seenPaths = new Map<string, string>();
  for (const [path, digest] of Object.entries(record.files as Record<string, unknown>)) {
    const normalizedPath = normalizePackPath(path);
    const lookupPath = normalizedPath.toLowerCase();
    const existingPath = seenPaths.get(lookupPath);
    if (existingPath) {
      throw new Error(`checksums.files contains duplicate path entries: ${existingPath} and ${path}`);
    }
    seenPaths.set(lookupPath, path);
    files[normalizedPath] = validateSha256(digest, `checksums.files["${path}"]`);
  }

  return {
    formatVersion: '1.0',
    algorithm: 'sha256',
    files,
  };
}

export async function verifyPackChecksums(
  files: PackZipFiles,
  checksums: PmpChecksumsV1,
  requiredPaths: string[],
  options: {
    createError?: (code: 'CHECKSUMS_INVALID' | 'CHECKSUM_MISMATCH', message: string) => Error;
    checksumFilePath?: string;
  } = {}
): Promise<void> {
  const checksumFilePath = normalizeChecksumPath(options.checksumFilePath ?? 'checksums.json');
  const createError =
    options.createError ?? ((_: 'CHECKSUMS_INVALID' | 'CHECKSUM_MISMATCH', message: string) => new Error(message));

  for (const path of requiredPaths) {
    const key = resolveChecksumKey(checksums.files, path);
    if (!key) {
      throw createError(
        'CHECKSUMS_INVALID',
        `checksums.json missing required file entry: ${normalizePackPath(path)}`
      );
    }
  }

  for (const path of Object.keys(files)) {
    if (normalizeChecksumPath(path) === checksumFilePath) continue;
    const key = resolveChecksumKey(checksums.files, path);
    if (!key) {
      throw createError('CHECKSUMS_INVALID', `checksums.json missing zip file entry: ${normalizePackPath(path)}`);
    }
  }

  for (const [path, expected] of Object.entries(checksums.files)) {
    const bytes = findPackEntry(files, path);
    if (!bytes) {
      throw createError('CHECKSUMS_INVALID', `checksums.json references missing file: ${normalizePackPath(path)}`);
    }
    const computed = await sha256Hex(bytes);
    if (computed !== expected) {
      throw createError('CHECKSUM_MISMATCH', `Integrity check failed (sha256 mismatch): ${normalizePackPath(path)}`);
    }
  }
}

export async function computeInstallSourceTreeDigest(
  files: Array<{ relativePath: string; bytes: Uint8Array }>
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for (const file of [...files].sort((left, right) =>
    comparePathStrings(left.relativePath, right.relativePath)
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

export function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/g, '');
}

export function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
