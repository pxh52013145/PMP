import process from 'node:process';
import {
  createSmokeContext,
  runDesktopTypeCheck,
  runDesktopVitestTargets,
} from './plugin-smoke-lib.mjs';

const context = createSmokeContext('view-surface-smoke');

const viewSurfaceVitestTargets = [
  'src/magnet-system/plugins/activationEvents.test.ts',
  'src/magnet-system/plugins/pluginRuntimeResolver.test.ts',
  'src/magnet-system/plugins/viewSurfaceDemoFixture.test.ts',
  'src/magnet-system/plugins/startupWorkerDemoFixture.test.ts',
  'src/magnet-system/plugins/runtime/extensionStartupRuntime.test.ts',
  'src/magnet-system/plugins/runtime/extensionCommandRuntime.test.ts',
  'src/builtin-modules/builtinNavigationCapabilityBridge.test.ts',
];

function main() {
  runDesktopTypeCheck(context);
  runDesktopVitestTargets(context, viewSurfaceVitestTargets);
  context.logStep('Completed view-surface smoke suite.');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[${context.name}] Failed: ${message}`);
  process.exit(1);
}
