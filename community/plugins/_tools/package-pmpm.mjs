import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { zipSync, strToU8 } from '../../../apps/desktop/node_modules/fflate/esm/index.mjs';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePackagePath(value, label) {
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');

  if (!normalized) {
    throw new Error(`${label} is required`);
  }

  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`${label} must be a relative package path`);
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`${label} must not contain empty, "." or ".." segments`);
  }

  return normalized;
}

async function collectDirectoryEntries(rootDir, relativeDir) {
  const absoluteDir = path.join(rootDir, relativeDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = normalizePackagePath(path.posix.join(relativeDir, entry.name), 'package file');
    if (entry.isDirectory()) {
      files.push(...(await collectDirectoryEntries(rootDir, relativePath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

export async function packagePmpmPlugin(pluginDir, options = {}) {
  const normalizedDir = typeof pluginDir === 'string' && pluginDir.trim().length > 0 ? pluginDir : null;
  if (!normalizedDir) {
    throw new Error('packagePmpmPlugin(pluginDir) requires a directory path');
  }

  const manifestPath = path.join(normalizedDir, 'manifest.json');
  const manifestText = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);

  if (!isObject(manifest)) {
    throw new Error('manifest.json must be a JSON object');
  }

  const entryPoint =
    typeof manifest.entryPoint === 'string' && manifest.entryPoint.trim().length > 0
      ? normalizePackagePath(manifest.entryPoint, 'manifest.entryPoint')
      : null;
  if (!entryPoint) {
    throw new Error('manifest.entryPoint is required');
  }

  const entryPath = path.join(normalizedDir, entryPoint);
  await fs.access(entryPath);

  const packageEntries = {
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  };

  const entryRoot = path.posix.dirname(entryPoint);
  const runtimeFiles =
    entryRoot === '.'
      ? [entryPoint]
      : await collectDirectoryEntries(normalizedDir, normalizePackagePath(entryRoot, 'entry root'));

  for (const relativePath of runtimeFiles) {
    const absolutePath = path.join(normalizedDir, relativePath);
    packageEntries[relativePath] = await fs.readFile(absolutePath);
  }

  const signaturePath = path.join(normalizedDir, 'signature.json');
  try {
    packageEntries['signature.json'] = await fs.readFile(signaturePath);
  } catch {
    // optional
  }

  const bundle = zipSync(packageEntries);

  const pluginId =
    isObject(manifest.metadata) && typeof manifest.metadata.id === 'string'
      ? manifest.metadata.id
      : 'plugin';
  const version =
    isObject(manifest.metadata) && typeof manifest.metadata.version === 'string'
      ? manifest.metadata.version
      : '0.0.0';

  const outDir =
    typeof options.outDir === 'string' && options.outDir.trim().length > 0
      ? options.outDir.trim()
      : normalizedDir;
  const outPath = path.join(outDir, `${pluginId}-${version}.pmpm`);

  await fs.writeFile(outPath, bundle);

  return {
    pluginId,
    version,
    entryPoint,
    outPath,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dirArg = argv[0];
  const pluginDir = dirArg ? path.resolve(process.cwd(), dirArg) : process.cwd();

  const result = await packagePmpmPlugin(pluginDir);
  console.log(`[pmpm-pack] Wrote ${path.basename(result.outPath)}`);
}

const invokedScriptHref =
  typeof process.argv[1] === 'string' && process.argv[1].length > 0
    ? pathToFileURL(process.argv[1]).href
    : null;
const isDirectRun = invokedScriptHref === import.meta.url;
if (isDirectRun) {
  main().catch((error) => {
    console.error('[pmpm-pack] Failed:', error);
    process.exitCode = 1;
  });
}
