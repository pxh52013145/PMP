import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { zipSync } from 'fflate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const encoder = new TextEncoder();

function toUtf8Bytes(text) {
  return encoder.encode(text);
}

function sha256Hex(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function parseBuiltinVariants(sourceText) {
  const byRenderer = new Map();
  const re = /register\(\s*'([^']+)'\s*,\s*'([^']+)'/g;
  let match = null;
  while ((match = re.exec(sourceText))) {
    const rendererId = match[1]?.trim() ?? '';
    const variantId = match[2]?.trim() ?? '';
    if (!rendererId || !variantId) continue;
    const variants = byRenderer.get(rendererId) ?? new Set();
    variants.add(variantId);
    byRenderer.set(rendererId, variants);
  }
  return byRenderer;
}

function buildDefaultTheme() {
  return {
    id: 'theme-default',
    name: '默认主题',
    version: '1.0.0',
    shader: {
      id: 'shader-default',
      name: '默认',
      description: '经典的绿色+紫色配色方案',
      colors: {
        primary: { base: '#00ff88', hover: '#00cc6f', active: '#00aa5c' },
        secondary: { base: '#1a1a2e', hover: '#25254a', active: '#16162e', opacity: 0.9 },
        accent: { base: '#ff0088', hover: '#ff3399', active: '#cc0066' },
        detail: { base: '#ffffff', hover: '#e0e0e0', disabled: '#666666' },
      },
      materials: { glow: 0.5 },
    },
    pixel: {
      shape: 'circle',
      size: 1.0,
      opacity: 1.0,
      colors: {
        default: { slot: 'primary', alpha: 0.6 },
        hover: { slot: 'accent', state: 'hover' },
        active: { slot: 'primary', state: 'active' },
        occupied: { slot: 'secondary', alpha: 0.3 },
      },
    },
    background: {
      maximized: { type: 'color', color: '#000000', opacity: 1 },
      windowed: { type: 'color', color: '#000000', opacity: 1 },
    },
    fonts: { primary: 'Inter, sans-serif' },
    componentThemes: {
      'track-info': {
        variant: 'spinning-vinyl',
        dynamicColor: { extractFromCover: true, applyMode: 'full' },
      },
    },
  };
}

function buildDefaultProfileSnapshot(now) {
  const spacesState = {
    version: 1,
    activeSpaceId: 'space1',
    spaces: [
      { id: 'space1', name: '空间1', order: 1, createdAt: now },
      { id: 'space2', name: '空间2', order: 2, createdAt: now },
    ],
  };

  const activeMagnetIds = [
    'drag-handle',
    'btn-minimize',
    'btn-maximize',
    'btn-close',
    'btn-window-pin',
    'btn-matrix-change',
    'btn-editor',
  ];

  const layoutTemplate = {
    version: 1,
    activeMagnetIds,
    anchorsByMagnetId: {},
  };

  const layoutsBySpaceId = {
    space1: layoutTemplate,
    space2: layoutTemplate,
  };

  const configTemplate = {
    version: '1.1.0',
    gridSize: { columns: 27, rows: 20 },
    magnets: {},
    customMagnets: [],
  };

  const configsBySpaceId = {
    space1: configTemplate,
    space2: configTemplate,
  };

  return {
    formatVersion: '1.0',
    app: { configVersion: 1 },
    theme: { source: { kind: 'pmpt', path: 'theme.pmpt' } },
    magnets: {
      spaces: { storageKey: 'pixel-matrix-magnet-spaces-v1', value: spacesState },
      spaceLayout: { storageKey: 'pixel-matrix-magnet-space-layout-v1', value: layoutsBySpaceId },
      spaceConfig: { storageKey: 'pixel-matrix-player-config', value: configsBySpaceId },
    },
  };
}

async function main() {
  const resourceRoot = path.join(repoRoot, 'resource');
  const variantOutDir = path.join(resourceRoot, 'varient(.pmpv)', 'builtin');
  const themeOutDir = path.join(resourceRoot, 'theme(.pmpt)', 'builtin');
  const packOutDir = path.join(resourceRoot, 'Pack(.pmpk)', 'builtin');

  await fs.mkdir(variantOutDir, { recursive: true });
  await fs.mkdir(themeOutDir, { recursive: true });
  await fs.mkdir(packOutDir, { recursive: true });

  const variantsSourcePath = path.join(
    repoRoot,
    'apps',
    'desktop',
    'src',
    'builtin-modules',
    'builtinMagnetRenderersModule.tsx'
  );
  const variantsSourceText = await fs.readFile(variantsSourcePath, 'utf8');
  const variantsByRenderer = parseBuiltinVariants(variantsSourceText);
  if (variantsByRenderer.size === 0) {
    throw new Error(`No builtin variants found in ${variantsSourcePath}`);
  }

  let generatedPmpv = 0;
  for (const [rendererId, variants] of variantsByRenderer.entries()) {
    for (const variantId of variants.values()) {
      const presetId = `${rendererId}-${variantId}`;
      const preset = {
        formatVersion: '1.0',
        type: 'variant-preset',
        metadata: {
          id: presetId,
          name: `${rendererId} / ${variantId}`,
          version: '1.0.0',
          tags: [rendererId, variantId],
        },
        target: { rendererId },
        componentTheme: {
          variant: variantId,
          variantConfig: {},
        },
      };

      const filePath = path.join(variantOutDir, `${presetId}.pmpv`);
      await fs.writeFile(filePath, `${JSON.stringify(preset, null, 2)}\n`, 'utf8');
      generatedPmpv += 1;
    }
  }

  const theme = buildDefaultTheme();
  const themeText = `${JSON.stringify(theme, null, 2)}\n`;
  const themeFilePath = path.join(themeOutDir, 'theme-default.pmpt');
  await fs.writeFile(themeFilePath, themeText, 'utf8');

  const themePackManifest = {
    formatVersion: '1.0',
    type: 'theme-pack',
    metadata: {
      id: 'theme-default',
      name: 'Theme Default',
      version: '1.0.0',
    },
    entry: {
      theme: 'theme.pmpt',
    },
  };

  const themePackFiles = {
    'manifest.json': toUtf8Bytes(JSON.stringify(themePackManifest, null, 2)),
    'theme.pmpt': toUtf8Bytes(themeText),
  };
  const themePackChecksums = {
    formatVersion: '1.0',
    algorithm: 'sha256',
    files: Object.fromEntries(Object.entries(themePackFiles).map(([key, bytes]) => [key, sha256Hex(bytes)])),
  };
  const themePackZippable = {
    ...themePackFiles,
    'checksums.json': toUtf8Bytes(JSON.stringify(themePackChecksums, null, 2)),
  };
  const themePackBytes = zipSync(themePackZippable);
  const themePackPath = path.join(packOutDir, 'theme-default-theme-pack.pmpk');
  await fs.writeFile(themePackPath, themePackBytes);

  const now = Date.now();
  const profilePackManifest = {
    formatVersion: '1.0',
    type: 'profile-pack',
    metadata: {
      id: 'theme-default-profile',
      name: 'Theme Default Profile',
      version: '1.0.0',
    },
    entry: {
      profile: 'profile.json',
    },
  };

  const profilePackProfile = buildDefaultProfileSnapshot(now);

  const profilePackFiles = {
    'manifest.json': toUtf8Bytes(JSON.stringify(profilePackManifest, null, 2)),
    'profile.json': toUtf8Bytes(`${JSON.stringify(profilePackProfile, null, 2)}\n`),
    'theme.pmpt': toUtf8Bytes(themeText),
  };
  const profilePackChecksums = {
    formatVersion: '1.0',
    algorithm: 'sha256',
    files: Object.fromEntries(Object.entries(profilePackFiles).map(([key, bytes]) => [key, sha256Hex(bytes)])),
  };
  const profilePackZippable = {
    ...profilePackFiles,
    'checksums.json': toUtf8Bytes(JSON.stringify(profilePackChecksums, null, 2)),
  };
  const profilePackBytes = zipSync(profilePackZippable);
  const profilePackPath = path.join(packOutDir, 'theme-default-profile-pack.pmpk');
  await fs.writeFile(profilePackPath, profilePackBytes);

  console.log('[community-seed] Done');
  console.log(`- .pmpv: ${generatedPmpv} files -> ${path.relative(repoRoot, variantOutDir)}`);
  console.log(`- .pmpt: ${path.relative(repoRoot, themeFilePath)}`);
  console.log(`- theme-pack: ${path.relative(repoRoot, themePackPath)}`);
  console.log(`- profile-pack: ${path.relative(repoRoot, profilePackPath)}`);
}

main().catch((error) => {
  console.error('[community-seed] Failed:', error);
  process.exitCode = 1;
});

