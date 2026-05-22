import process from 'node:process';
import {
  createSmokeContext,
  repoRoot,
  runDesktopLint,
  runDesktopTypeCheck,
} from './plugin-smoke-lib.mjs';

const context = createSmokeContext('plugin-platform-smoke');

function main() {
  runDesktopTypeCheck(context);
  runDesktopLint(context);

  context.run('node', ['scripts/runtime-foundation-smoke.mjs', '--skip-type-check']);
  context.run('node', ['scripts/view-surface-smoke.mjs', '--skip-type-check']);
  context.run('node', ['scripts/sidecar-smoke.mjs', '--skip-type-check']);
  context.run('node', ['scripts/shell-surface-smoke.mjs', '--skip-type-check']);

  context.logStep('Completed plugin-platform smoke suite.');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[${context.name}] Failed: ${message}`);
  process.exit(1);
}
