import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPlatformPackArchiveBytes,
  readPlatformPackManifest,
} from './package-platform-pack.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopCwd = path.join(repoRoot, 'apps', 'desktop');
const srcTauriCwd = path.join(desktopCwd, 'src-tauri');
const cargoManifestPath = path.join(srcTauriCwd, 'Cargo.toml');
const isWindows = process.platform === 'win32';
const hostBinaryExt = isWindows ? '.exe' : '';
const cli = parseCliArgs(process.argv.slice(2));
const buildProfile = resolveBuildProfile(cli.forwardedArgs);
const checkOnly = cli.check;
const jsonOutput = cli.json;
const BUILTIN_PACK_INDEX_FILE_NAME = 'builtin-pack-index.json';

const packTargets = [
  {
    packSourceDir: path.join(
      repoRoot,
      'resource',
      'music-platform',
      'packs',
      'builtin',
      'bilibili'
    ),
    binName: 'pmp-platform-bilibili-sidecar',
    publishedFileName: 'pmp-platform-bilibili-sidecar.exe',
    binaryOutputDirs: [
      path.join(repoRoot, 'resource', 'music-platform', 'packs', 'builtin', 'bilibili', 'bin'),
    ],
    packOutputDirs: [
      path.join(repoRoot, 'resource', 'music-platform', 'packs', 'dist'),
      path.join(desktopCwd, 'public', 'resource', 'music-platform', 'packs', 'dist'),
    ],
    source: 'builtin-pack:bilibili',
  },
  {
    packSourceDir: path.join(
      repoRoot,
      'resource',
      'music-platform',
      'packs',
      'builtin',
      'netease'
    ),
    binName: 'pmp-platform-netease-sidecar',
    publishedFileName: 'pmp-platform-netease-sidecar.exe',
    binaryOutputDirs: [
      path.join(repoRoot, 'resource', 'music-platform', 'packs', 'builtin', 'netease', 'bin'),
    ],
    packOutputDirs: [
      path.join(repoRoot, 'resource', 'music-platform', 'packs', 'dist'),
      path.join(desktopCwd, 'public', 'resource', 'music-platform', 'packs', 'dist'),
    ],
    source: 'builtin-pack:netease',
  },
];

const cargoInputPaths = [
  cargoManifestPath,
  path.join(srcTauriCwd, 'Cargo.lock'),
  path.join(srcTauriCwd, 'build.rs'),
  path.join(srcTauriCwd, 'src'),
  path.join(srcTauriCwd, 'crates'),
];

function parseExplicitBuildProfile(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'debug' || normalized === 'release' ? normalized : null;
}

function isTruthyEnvFlag(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function resolveBuildProfile(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--profile') {
      continue;
    }
    return parseExplicitBuildProfile(argv[index + 1]) ?? 'release';
  }

  const envProfile = parseExplicitBuildProfile(process.env.PMP_PLATFORM_PACK_PROFILE);
  if (envProfile) {
    return envProfile;
  }

  return isTruthyEnvFlag(process.env.TAURI_DEBUG) ? 'debug' : 'release';
}

function parseCliArgs(argv) {
  const forwardedArgs = [];
  let check = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--check') {
      check = true;
      continue;
    }
    if (current === '--json') {
      json = true;
      continue;
    }
    forwardedArgs.push(current);
  }

  return {
    check,
    json,
    forwardedArgs,
  };
}

function logInfo(message) {
  if (!jsonOutput) {
    console.log(message);
  }
}

function canRun(cmd, args = ['--version']) {
  try {
    const result = spawnSync(cmd, args, {
      stdio: 'ignore',
      env: process.env,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function findCargoExecutable() {
  if (process.env.CARGO && fs.existsSync(process.env.CARGO)) {
    return process.env.CARGO;
  }

  if (canRun('cargo')) {
    return 'cargo';
  }

  if (!isWindows) {
    return null;
  }

  const userProfile = process.env.USERPROFILE ?? '';
  if (!userProfile) {
    return null;
  }

  const candidate = path.join(userProfile, '.cargo', 'bin', 'cargo.exe');
  return fs.existsSync(candidate) ? candidate : null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function statMtimeMs(targetPath) {
  try {
    return fs.statSync(targetPath).mtimeMs;
  } catch {
    return 0;
  }
}

function latestMtimeMs(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return 0;
  }

  const stats = fs.statSync(targetPath);
  let latest = stats.mtimeMs;
  if (!stats.isDirectory()) {
    return latest;
  }

  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    latest = Math.max(latest, latestMtimeMs(path.join(targetPath, entry.name)));
  }

  return latest;
}

function normalizeRelativeFsPath(value) {
  return value.replace(/\\/g, '/');
}

function latestRelevantFileMtimeMs(
  targetPath,
  rootPath = targetPath,
  excludedRelativePaths = new Set()
) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return 0;
  }

  const stats = fs.statSync(targetPath);
  if (stats.isFile()) {
    const relativePath = normalizeRelativeFsPath(path.relative(rootPath, targetPath));
    if (excludedRelativePaths.has(relativePath)) {
      return 0;
    }
    return stats.mtimeMs;
  }

  if (!stats.isDirectory()) {
    return 0;
  }

  let latest = 0;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    latest = Math.max(
      latest,
      latestRelevantFileMtimeMs(
        path.join(targetPath, entry.name),
        rootPath,
        excludedRelativePaths
      )
    );
  }

  return latest;
}

function latestMtimeMsForPaths(paths) {
  let latest = 0;
  for (const targetPath of paths) {
    latest = Math.max(latest, latestMtimeMs(targetPath));
  }
  return latest;
}

function areOutputsFresh(outputPaths, inputLatestMs) {
  return (
    outputPaths.length > 0 &&
    outputPaths.every(
      (outputPath) => fs.existsSync(outputPath) && statMtimeMs(outputPath) >= inputLatestMs
    )
  );
}

function computePackTreeDigest(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'))) {
    hash.update(file.relativePath, 'utf8');
    hash.update('\0', 'utf8');
    hash.update(Buffer.from(file.bytes));
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function copyPublishedBinary(sourcePath, destinationPath) {
  ensureDir(path.dirname(destinationPath));
  fs.copyFileSync(sourcePath, destinationPath);
  if (!isWindows) {
    fs.chmodSync(destinationPath, 0o755);
  }
}

function writePackArchive(bytes, destinationPath) {
  ensureDir(path.dirname(destinationPath));
  fs.writeFileSync(destinationPath, bytes);
}

function writeBuiltinPackIndex(entries, destinationPath) {
  ensureDir(path.dirname(destinationPath));
  fs.writeFileSync(
    destinationPath,
    JSON.stringify(
      {
        schemaVersion: '1.0',
        generatedBy: 'prepare-music-platform-packs',
        buildProfile,
        packCount: entries.length,
        packs: entries,
      },
      null,
      2
    )
  );
}

function buildPreparationSummary(input) {
  const connectorSummaries = input.packTargetsNeedingRefresh.map((entry) => ({
    connectorId: entry.manifest.connector.connectorId,
    packId: entry.manifest.metadata.id,
    packVersion: entry.manifest.metadata.version,
    source: entry.target.source,
    packNeedsRefresh: entry.packNeedsRefresh,
    binaryNeedsRefresh: entry.binaryNeedsRefresh,
    publishedPackFileName: entry.publishedPackFileName,
  }));

  return {
    checkOnly,
    buildProfile,
    cargoBuildRequired: input.needsCargoBuild,
    cargoBuildExecuted: input.needsCargoBuild && !checkOnly,
    indexNeedsRefresh: input.indexNeedsRefresh,
    expectedBuiltinCount: connectorSummaries.length,
    connectors: connectorSummaries,
  };
}

function emitPreparationSummary(summary) {
  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  logInfo(
    `[prepare-music-platform-packs] summary: profile=${summary.buildProfile} checkOnly=${summary.checkOnly} cargoBuildRequired=${summary.cargoBuildRequired} indexNeedsRefresh=${summary.indexNeedsRefresh}`
  );
  for (const connector of summary.connectors) {
    logInfo(
      `[prepare-music-platform-packs] connector=${connector.connectorId} pack=${connector.packId}@${connector.packVersion} binaryNeedsRefresh=${connector.binaryNeedsRefresh} packNeedsRefresh=${connector.packNeedsRefresh}`
    );
  }
}

async function main() {
  const cargo = findCargoExecutable();
  if (!cargo) {
    console.error('[prepare-music-platform-packs] `cargo` is required to build builtin music platform sidecars.');
    console.error('[prepare-music-platform-packs] Install Rust (rustup) and ensure `cargo --version` works in this terminal.');
    process.exit(1);
  }

  const cargoSourcesLatestMs = latestMtimeMsForPaths(cargoInputPaths);
  const builtBinaryPaths = new Map(
    packTargets.map((target) => [
      target.binName,
      path.join(srcTauriCwd, 'target', buildProfile, `${target.binName}${hostBinaryExt}`),
    ])
  );

  const needsCargoBuild = packTargets.some((target) => {
    const builtBinaryPath = builtBinaryPaths.get(target.binName);
    return !builtBinaryPath || !areOutputsFresh([builtBinaryPath], cargoSourcesLatestMs);
  });

  const binaryNeedsRefreshByConnectorId = new Map();
  for (const target of packTargets) {
    const binaryNeedsRefresh = target.binaryOutputDirs.some((outputDir) => {
      const destinationPath = path.join(outputDir, target.publishedFileName);
      return !areOutputsFresh([destinationPath], cargoSourcesLatestMs);
    });
    binaryNeedsRefreshByConnectorId.set(target.source, binaryNeedsRefresh);
  }

  if (!checkOnly && needsCargoBuild) {
    const cargoArgs = ['build', '--manifest-path', cargoManifestPath];
    if (buildProfile === 'release') {
      cargoArgs.push('--release');
    }
    for (const target of packTargets) {
      cargoArgs.push('--bin', target.binName);
    }

    logInfo(
      `[prepare-music-platform-packs] building builtin music platform sidecars (${buildProfile})`
    );
    run(cargo, cargoArgs);
  }

  if (!checkOnly) {
    if (!needsCargoBuild) {
      logInfo(
        `[prepare-music-platform-packs] builtin music platform sidecars are up to date (${buildProfile})`
      );
    }
  }

  for (const target of packTargets) {
    const builtBinaryPath = builtBinaryPaths.get(target.binName);
    if (!checkOnly && !fs.existsSync(builtBinaryPath)) {
      console.error(
        `[prepare-music-platform-packs] expected built sidecar missing: ${builtBinaryPath}`
      );
      process.exit(1);
    }

    if (checkOnly) {
      continue;
    }

    for (const outputDir of target.binaryOutputDirs) {
      const destinationPath = path.join(outputDir, target.publishedFileName);
      if (areOutputsFresh([destinationPath], cargoSourcesLatestMs)) {
        continue;
      }
      copyPublishedBinary(builtBinaryPath, destinationPath);
      logInfo(
        `[prepare-music-platform-packs] copied ${path.relative(
          repoRoot,
          builtBinaryPath
        )} -> ${path.relative(repoRoot, destinationPath)}`
      );
    }
  }

  const deprecatedPublicBuiltinDir = path.join(
    desktopCwd,
    'public',
    'resource',
    'music-platform',
    'packs',
    'builtin'
  );
  if (!checkOnly && fs.existsSync(deprecatedPublicBuiltinDir)) {
    fs.rmSync(deprecatedPublicBuiltinDir, {
      recursive: true,
      force: true,
    });
  }

  const packTargetsWithManifest = [];
  const sourceLatestMsByConnectorId = new Map();
  for (const target of packTargets) {
    const manifest = await readPlatformPackManifest(target.packSourceDir);
    const excludedRelativePaths = new Set(
      manifest.entry.sidecar ? [normalizeRelativeFsPath(manifest.entry.sidecar)] : []
    );
    const packSourceLatestMs = Math.max(
      cargoSourcesLatestMs,
      latestRelevantFileMtimeMs(
        target.packSourceDir,
        target.packSourceDir,
        excludedRelativePaths
      )
    );
    packTargetsWithManifest.push({
      target,
      manifest,
      publishedPackFileName: `${manifest.metadata.id}.pmpp`,
      packSourceLatestMs,
      binaryNeedsRefresh: Boolean(binaryNeedsRefreshByConnectorId.get(target.source)),
    });
    sourceLatestMsByConnectorId.set(manifest.connector.connectorId, packSourceLatestMs);
  }

  const indexOutputDirs = Array.from(
    new Set(packTargets.flatMap((target) => target.packOutputDirs))
  );
  const indexLatestRequiredMs = Math.max(
    0,
    ...Array.from(sourceLatestMsByConnectorId.values())
  );
  const indexOutputPaths = indexOutputDirs.map((outputDir) =>
    path.join(outputDir, BUILTIN_PACK_INDEX_FILE_NAME)
  );
  const indexNeedsRefresh = !areOutputsFresh(indexOutputPaths, indexLatestRequiredMs);

  const packTargetsNeedingRefresh = packTargetsWithManifest.map((entry) => {
    const packOutputPaths = entry.target.packOutputDirs.map((outputDir) =>
      path.join(outputDir, entry.publishedPackFileName)
    );
    const packNeedsRefresh =
      indexNeedsRefresh || !areOutputsFresh(packOutputPaths, entry.packSourceLatestMs);

    return {
      ...entry,
      packNeedsRefresh,
    };
  });

  const preparationSummary = buildPreparationSummary({
    needsCargoBuild,
    indexNeedsRefresh,
    packTargetsNeedingRefresh,
  });

  if (checkOnly) {
    emitPreparationSummary(preparationSummary);
    if (
      needsCargoBuild ||
      indexNeedsRefresh ||
      packTargetsNeedingRefresh.some(
        (entry) => entry.packNeedsRefresh || entry.binaryNeedsRefresh
      )
    ) {
      process.exitCode = 1;
    }
    return;
  }

  if (
    packTargetsNeedingRefresh.length > 0 &&
    packTargetsNeedingRefresh.every((entry) => entry.packNeedsRefresh === false) &&
    !indexNeedsRefresh
  ) {
    logInfo('[prepare-music-platform-packs] builtin platform pack archives are up to date');
    emitPreparationSummary(preparationSummary);
    return;
  }

  const packArchives = [];
  for (const entry of packTargetsNeedingRefresh) {
    const archive = await buildPlatformPackArchiveBytes(entry.target.packSourceDir);
    packArchives.push({
      ...entry,
      archive,
    });

    if (!entry.packNeedsRefresh) {
      continue;
    }

    for (const outputDir of entry.target.packOutputDirs) {
      const destinationPath = path.join(outputDir, entry.publishedPackFileName);
      writePackArchive(archive.bytes, destinationPath);
      logInfo(
        `[prepare-music-platform-packs] packed ${path.relative(
          repoRoot,
          entry.target.packSourceDir
        )} -> ${path.relative(repoRoot, destinationPath)}`
      );
    }
  }

  const indexEntries = packArchives.map(({ target, archive, publishedPackFileName }) => ({
    source: target.source,
    connectorId: archive.manifest.connector.connectorId,
    packId: archive.manifest.metadata.id,
    packVersion: archive.manifest.metadata.version,
    packageDigest: computePackTreeDigest(archive.files),
    packAssetUrl: `/resource/music-platform/packs/dist/${publishedPackFileName}`,
    archiveByteLength: archive.bytes.byteLength,
    contractPath: archive.manifest.entry.contract,
    runtimePath: archive.manifest.entry.runtime,
    iconPath: archive.manifest.entry.icon,
    sidecarPath: archive.manifest.entry.sidecar ?? null,
  }));

  for (const outputPath of indexOutputPaths) {
    writeBuiltinPackIndex(indexEntries, outputPath);
    logInfo(
      `[prepare-music-platform-packs] wrote ${path.relative(repoRoot, outputPath)}`
    );
  }

  emitPreparationSummary(preparationSummary);
}

main().catch((error) => {
  console.error('[prepare-music-platform-packs] Failed:', error);
  process.exitCode = 1;
});
