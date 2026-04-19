import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPlatformPackArchiveBytes,
} from './package-platform-pack.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopCwd = path.join(repoRoot, 'apps', 'desktop');
const srcTauriCwd = path.join(desktopCwd, 'src-tauri');
const cargoManifestPath = path.join(srcTauriCwd, 'Cargo.toml');
const isWindows = process.platform === 'win32';
const hostBinaryExt = isWindows ? '.exe' : '';
const buildProfile = process.env.TAURI_DEBUG ? 'debug' : 'release';

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
  },
];

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

async function main() {
  const cargo = findCargoExecutable();
  if (!cargo) {
    console.error('[prepare-music-platform-packs] `cargo` is required to build builtin music platform sidecars.');
    console.error('[prepare-music-platform-packs] Install Rust (rustup) and ensure `cargo --version` works in this terminal.');
    process.exit(1);
  }

  const cargoArgs = ['build', '--manifest-path', cargoManifestPath];
  if (buildProfile === 'release') {
    cargoArgs.push('--release');
  }
  for (const target of packTargets) {
    cargoArgs.push('--bin', target.binName);
  }

  console.log(
    `[prepare-music-platform-packs] building builtin music platform sidecars (${buildProfile})`
  );
  run(cargo, cargoArgs);

  for (const target of packTargets) {
    const builtBinaryPath = path.join(
      srcTauriCwd,
      'target',
      buildProfile,
      `${target.binName}${hostBinaryExt}`
    );
    if (!fs.existsSync(builtBinaryPath)) {
      console.error(
        `[prepare-music-platform-packs] expected built sidecar missing: ${builtBinaryPath}`
      );
      process.exit(1);
    }

    for (const outputDir of target.binaryOutputDirs) {
      const destinationPath = path.join(outputDir, target.publishedFileName);
      copyPublishedBinary(builtBinaryPath, destinationPath);
      console.log(
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
  if (fs.existsSync(deprecatedPublicBuiltinDir)) {
    fs.rmSync(deprecatedPublicBuiltinDir, {
      recursive: true,
      force: true,
    });
  }

  for (const target of packTargets) {
    const archive = await buildPlatformPackArchiveBytes(target.packSourceDir);
    const publishedPackFileName = `${archive.manifest.metadata.id}.pmpp`;

    for (const outputDir of target.packOutputDirs) {
      const destinationPath = path.join(outputDir, publishedPackFileName);
      writePackArchive(archive.bytes, destinationPath);
      console.log(
        `[prepare-music-platform-packs] packed ${path.relative(
          repoRoot,
          target.packSourceDir
        )} -> ${path.relative(repoRoot, destinationPath)}`
      );
    }
  }
}

main().catch((error) => {
  console.error('[prepare-music-platform-packs] Failed:', error);
  process.exitCode = 1;
});
