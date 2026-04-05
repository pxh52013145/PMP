import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { zipSync, strToU8 } from '../../../apps/desktop/node_modules/fflate/esm/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, 'manifest.json');

async function main() {
  const manifestText = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);

  if (!manifest || typeof manifest !== 'object') {
    throw new Error('manifest.json must be a JSON object');
  }

  if (typeof manifest.entryPoint !== 'string' || manifest.entryPoint.trim().length === 0) {
    throw new Error('manifest.entryPoint is required');
  }

  const entryPath = path.join(__dirname, manifest.entryPoint);
  const entryText = await fs.readFile(entryPath, 'utf8');

  const bundle = zipSync({
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    [manifest.entryPoint]: strToU8(entryText),
  });

  const version =
    manifest.metadata && typeof manifest.metadata.version === 'string'
      ? manifest.metadata.version
      : '0.0.0';
  const pluginId =
    manifest.metadata && typeof manifest.metadata.id === 'string'
      ? manifest.metadata.id
      : 'plugin';
  const outPath = path.join(__dirname, `${pluginId}-${version}.pmpm`);

  await fs.writeFile(outPath, bundle);
  console.log(`[stream-protocol-demo] Wrote ${path.basename(outPath)}`);
}

main().catch((error) => {
  console.error('[stream-protocol-demo] Failed:', error);
  process.exitCode = 1;
});
