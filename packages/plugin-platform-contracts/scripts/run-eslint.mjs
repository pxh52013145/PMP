import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(packageDir, '..', '..');
const desktopNodeModules = path.resolve(repoRoot, 'apps', 'desktop', 'node_modules');
const eslintBin = path.resolve(desktopNodeModules, 'eslint', 'bin', 'eslint.js');

const env = {
  ...process.env,
  NODE_PATH: desktopNodeModules,
};

const result = spawnSync(process.execPath, [eslintBin, ...process.argv.slice(2)], {
  cwd: packageDir,
  env,
  stdio: 'inherit',
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

throw result.error ?? new Error('Failed to run eslint for plugin-platform-contracts');
