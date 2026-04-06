import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { packagePmpmPlugin } from '../_tools/package-pmpm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

packagePmpmPlugin(__dirname)
  .then((result) => {
    console.log(`[hello-magnet-demo] Wrote ${path.basename(result.outPath)}`);
  })
  .catch((error) => {
    console.error('[hello-magnet-demo] Failed:', error);
    process.exitCode = 1;
  });

