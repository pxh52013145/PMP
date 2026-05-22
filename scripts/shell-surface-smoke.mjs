import process from 'node:process';
import {
  createSmokeContext,
  runCargoTests,
  runDesktopTypeCheck,
  runDesktopVitestTargets,
} from './plugin-smoke-lib.mjs';

const shellSurfaceVitestTargets = [
  'src/magnet-system/plugins/shellSurfaceDemoSmoke.test.ts',
  'src/magnet-system/plugins/shellSurfaceManager.test.ts',
  'src/magnet-system/plugins/shellSurfaceGovernanceIntegration.test.ts',
  'src/utils/pluginShellSurfaces.test.ts',
  'src/PluginShellSurfaceApp.test.tsx',
];

const context = createSmokeContext('shell-surface-smoke');

function main() {
  runDesktopTypeCheck(context);
  runDesktopVitestTargets(context, shellSurfaceVitestTargets);
  runCargoTests(context, 'plugin_shell_surface');

  if (process.platform === 'win32' && !context.shouldSkipNative) {
    runCargoTests(
      context,
      'native_tauri_shell_surface_smoke_covers_focus_dismiss_destroy_and_cleanup_timeline',
      ['--ignored', '--nocapture']
    );
  } else {
    context.logStep(
      context.shouldSkipNative
        ? 'Skipping native Tauri shell-surface smoke because --skip-native was provided.'
        : 'Skipping native Tauri shell-surface smoke because this host is not Windows.'
    );
  }

  context.logStep('Completed shell-surface smoke suite.');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[${context.name}] Failed: ${message}`);
  process.exit(1);
}
