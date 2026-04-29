import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRequire = createRequire(path.join(scriptDir, '..', 'apps', 'desktop', 'package.json'));
const { zipSync } = desktopRequire('fflate');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePackRelativePath(value, label) {
  const normalized = normalizeString(value)
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

function ensurePlatformPackManifest(manifest, manifestPath) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Invalid platform pack manifest: ${manifestPath}`);
  }
  if (manifest.formatVersion !== '1.0') {
    throw new Error(`platform pack manifest.formatVersion must be "1.0" (${manifestPath})`);
  }
  if (manifest.type !== 'platform-pack') {
    throw new Error(`platform pack manifest.type must be "platform-pack" (${manifestPath})`);
  }

  const metadata = manifest.metadata;
  const connector = manifest.connector;
  const entry = manifest.entry;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`platform pack metadata is required (${manifestPath})`);
  }
  if (!connector || typeof connector !== 'object' || Array.isArray(connector)) {
    throw new Error(`platform pack connector is required (${manifestPath})`);
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`platform pack entry is required (${manifestPath})`);
  }

  const metadataId = normalizeString(metadata.id);
  const metadataVersion = normalizeString(metadata.version);
  const connectorId = normalizeString(connector.connectorId).toLowerCase();
  if (!metadataId) {
    throw new Error(`platform pack metadata.id is required (${manifestPath})`);
  }
  if (!metadataVersion) {
    throw new Error(`platform pack metadata.version is required (${manifestPath})`);
  }
  if (!connectorId.startsWith('connector.platform.')) {
    throw new Error(
      `platform pack connector.connectorId must start with connector.platform. (${manifestPath})`
    );
  }

  return {
    ...manifest,
    metadata: {
      ...metadata,
      id: metadataId,
      version: metadataVersion,
    },
    connector: {
      ...connector,
      connectorId,
    },
    entry: {
      ...entry,
      contract: normalizePackRelativePath(entry.contract, 'manifest.entry.contract'),
      runtime: normalizePackRelativePath(entry.runtime, 'manifest.entry.runtime'),
      icon: normalizePackRelativePath(entry.icon, 'manifest.entry.icon'),
      sidecar:
        typeof entry.sidecar === 'undefined'
          ? undefined
          : normalizePackRelativePath(entry.sidecar, 'manifest.entry.sidecar'),
    },
  };
}

async function listPlatformPackFiles(rootDir, currentDir = rootDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listPlatformPackFiles(rootDir, absolutePath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const relativePath = normalizePackRelativePath(
      path.relative(rootDir, absolutePath),
      `platform pack file (${absolutePath})`
    );
    files.push({
      relativePath,
      bytes: new Uint8Array(await fs.readFile(absolutePath)),
    });
  }

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
}

export async function readPlatformPackManifest(sourceDir) {
  const manifestPath = path.join(sourceDir, 'manifest.json');
  const manifestRaw = await fs.readFile(manifestPath, 'utf8');
  return ensurePlatformPackManifest(JSON.parse(manifestRaw), manifestPath);
}

export async function buildPlatformPackArchiveBytes(sourceDir) {
  const manifest = await readPlatformPackManifest(sourceDir);
  const files = await listPlatformPackFiles(sourceDir);
  const filesByPath = new Map(files.map((file) => [file.relativePath, file.bytes]));

  for (const requiredPath of [
    'manifest.json',
    manifest.entry.contract,
    manifest.entry.runtime,
    manifest.entry.icon,
    manifest.entry.sidecar,
  ].filter(Boolean)) {
    if (!filesByPath.has(requiredPath)) {
      throw new Error(
        `platform pack is missing required artifact "${requiredPath}" (${sourceDir})`
      );
    }
  }

  const archive = Object.fromEntries(
    files.map((file) => [file.relativePath, file.bytes])
  );

  return {
    manifest,
    files,
    bytes: zipSync(archive),
  };
}

export async function packagePlatformPackDirectory({ sourceDir, outputFile }) {
  const archive = await buildPlatformPackArchiveBytes(sourceDir);
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, archive.bytes);
  return {
    ...archive,
    outputFile,
  };
}

function parseCliArgs(argv) {
  const args = {
    sourceDir: '',
    outputFile: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--source') {
      args.sourceDir = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (current === '--output') {
      args.outputFile = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
  }

  if (!args.sourceDir) {
    throw new Error('Usage: node scripts/package-platform-pack.mjs --source <pack-dir> [--output <file.pmpp>]');
  }

  return args;
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const sourceDir = path.resolve(cli.sourceDir);
  const archive = await buildPlatformPackArchiveBytes(sourceDir);
  const outputFile = cli.outputFile
    ? path.resolve(cli.outputFile)
    : path.join(path.dirname(sourceDir), `${archive.manifest.metadata.id}.pmpp`);

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, archive.bytes);

  console.log('[package-platform-pack] packaged platform pack');
  console.log(`- id: ${archive.manifest.metadata.id}`);
  console.log(`- connectorId: ${archive.manifest.connector.connectorId}`);
  console.log(`- output: ${outputFile}`);
  console.log(`- files: ${archive.files.length}`);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[package-platform-pack] Failed:', error);
    process.exitCode = 1;
  });
}
