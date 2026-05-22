import process from 'node:process';
import {
  createSmokeContext,
  runCargoTests,
  runDesktopTypeCheck,
  runDesktopVitestTargets,
} from './plugin-smoke-lib.mjs';

const context = createSmokeContext('sidecar-smoke');

const sidecarVitestTargets = [
  'src/magnet-system/plugins/sidecarDemoFixture.test.ts',
  'src/magnet-system/plugins/sidecarCapabilityDemoSmoke.test.ts',
  'src/magnet-system/plugins/runtime/sidecarCommandRuntime.test.ts',
  'src/magnet-system/plugins/runtime/sidecarRuntimeBridgeHostSession.test.ts',
  'src/magnet-system/plugins/runtime/tauriSidecarPortController.test.ts',
  'src/magnet-system/plugins/runtime/runtimeBridgeHostSession.test.ts',
  'src/magnet-system/plugins/runtime/extensionCommandRuntime.test.ts',
];

function main() {
  runDesktopTypeCheck(context);
  runDesktopVitestTargets(context, sidecarVitestTargets);
  runCargoTests(context, 'sidecar_bridge');
  context.logStep('Completed sidecar smoke suite.');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[${context.name}] Failed: ${message}`);
  process.exit(1);
}
