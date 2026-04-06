import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { packagePmpmPlugin } from '../_tools/package-pmpm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const result = await packagePmpmPlugin(__dirname);
  console.log(`[stream-protocol-demo] Wrote ${path.basename(result.outPath)}`);
}

main().catch((error) => {
  console.error('[stream-protocol-demo] Failed:', error);
  process.exitCode = 1;
});
