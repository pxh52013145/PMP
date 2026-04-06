import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { zipSync, strToU8 } from '../../../apps/desktop/node_modules/fflate/esm/index.mjs';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
      ? manifest.entryPoint.trim()
      : null;
  if (!entryPoint) {
    throw new Error('manifest.entryPoint is required');
  }

  const entryPath = path.join(normalizedDir, entryPoint);
  const entryText = await fs.readFile(entryPath, 'utf8');

  const bundle = zipSync({
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    [entryPoint]: strToU8(entryText),
  });

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

const isDirectRun = pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
  main().catch((error) => {
    console.error('[pmpm-pack] Failed:', error);
    process.exitCode = 1;
  });
}
