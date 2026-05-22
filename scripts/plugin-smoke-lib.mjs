import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, '..');
export const desktopDir = path.join(repoRoot, 'apps', 'desktop');
export const cargoManifestPath = path.join(desktopDir, 'src-tauri', 'Cargo.toml');

export function createSmokeContext(name, argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const context = {
    name,
    args,
    shouldSkipTypeCheck: args.has('--skip-type-check'),
    shouldSkipLint: args.has('--skip-lint'),
    shouldSkipNative: args.has('--skip-native'),
  };

  return {
    ...context,
    logStep(message) {
      console.log(`\n[${name}] ${message}`);
    },
    run(command, commandArgs, options = {}) {
      const printable = [command, ...commandArgs].join(' ');
      this.logStep(`Running: ${printable}`);
      const result = spawnSync(command, commandArgs, {
        cwd: options.cwd ?? repoRoot,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: process.env,
      });

      if (result.status !== 0) {
        const code = result.status ?? 1;
        throw new Error(`Command failed with exit code ${code}: ${printable}`);
      }
    },
  };
}

export function runDesktopTypeCheck(context) {
  if (context.shouldSkipTypeCheck) {
    context.logStep('Skipping desktop type-check because --skip-type-check was provided.');
    return;
  }
  context.run('pnpm', ['--dir', desktopDir, 'type-check']);
}

export function runDesktopLint(context) {
  if (context.shouldSkipLint) {
    context.logStep('Skipping desktop lint because --skip-lint was provided.');
    return;
  }
  context.run('pnpm', ['--dir', desktopDir, 'lint']);
}

export function runDesktopVitestTargets(context, targets) {
  context.run('pnpm', ['--dir', desktopDir, 'exec', 'vitest', 'run', '--run', ...targets]);
}

export function runCargoTests(context, filter, extraArgs = ['--nocapture']) {
  context.run('cargo', ['test', '--manifest-path', cargoManifestPath, filter, '--', ...extraArgs]);
}
