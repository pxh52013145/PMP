import process from 'node:process';
import {
  createSmokeContext,
  runDesktopTypeCheck,
  runDesktopVitestTargets,
} from './plugin-smoke-lib.mjs';

const context = createSmokeContext('runtime-foundation-smoke');

const runtimeFoundationVitestTargets = [
  'src/magnet-system/plugins/runtime/runtimeProtocolTracer.test.ts',
  'src/magnet-system/plugins/runtime/runtimeProtocolProfiler.test.ts',
  'src/magnet-system/plugins/hostPmpCapabilities.test.ts',
  'src/magnet-system/plugins/pmpmCompatCapabilityTransport.test.ts',
  'src/magnet-system/plugins/pmpmCompatContracts.test.ts',
  'src/magnet-system/plugins/pmpmProjection.test.ts',
  'src/magnet-system/plugins/pmpmRuntimeBridgeSnapshot.test.ts',
  'src/magnet-system/plugins/extensions.test.ts',
  'src/magnet-system/plugins/installedExtensionHostFileActivation.test.ts',
];

function main() {
  runDesktopTypeCheck(context);
  runDesktopVitestTargets(context, runtimeFoundationVitestTargets);
  context.logStep('Completed runtime foundation smoke suite.');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[${context.name}] Failed: ${message}`);
  process.exit(1);
}
