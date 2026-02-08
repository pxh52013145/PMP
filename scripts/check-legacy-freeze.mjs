#!/usr/bin/env node

import { execSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const stagedOnly = args.has('--staged');
const legacyRoot = 'apps/desktop';

const run = (command) =>
  execSync(command, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  }).trim();

const collectChanged = () => {
  const command = stagedOnly
    ? `git diff --cached --name-only -- ${legacyRoot}`
    : `git status --porcelain --untracked-files=all -- ${legacyRoot}`;

  const output = run(command);
  if (!output) return [];

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
};

try {
  run('git rev-parse --is-inside-work-tree');
} catch {
  console.error('[legacy-freeze] Not inside a Git repository.');
  process.exit(1);
}

const changed = collectChanged();
if (changed.length === 0) {
  console.log('[legacy-freeze] OK: no legacy changes detected.');
  process.exit(0);
}

if (process.env.ALLOW_LEGACY_EDIT === '1') {
  console.warn('[legacy-freeze] Warning: bypassed by ALLOW_LEGACY_EDIT=1');
  process.exit(0);
}

console.error('[legacy-freeze] Blocked: legacy is frozen; do not modify apps/desktop.');
console.error(`[legacy-freeze] Changed entries: ${changed.length}`);
for (const line of changed.slice(0, 30)) {
  console.error(`  - ${line}`);
}
if (changed.length > 30) {
  console.error(`  ... and ${changed.length - 30} more`);
}
console.error('[legacy-freeze] If emergency fix is required, set ALLOW_LEGACY_EDIT=1 explicitly.');
process.exit(1);

