#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sourceDir = path.join(repoRoot, 'fixtures', 'platform-pack-dev', 'minimal');
const defaultTargetDir = path.join(repoRoot, '.codex-tmp', 'platform-pack-dev-fixture');

function printUsage() {
  console.log(`Usage:
  node scripts/platform-pack-dev-fixture.mjs prepare [targetDir]
  node scripts/platform-pack-dev-fixture.mjs set-text <text> [targetDir]
  node scripts/platform-pack-dev-fixture.mjs assert-text <text> [targetDir]
  node scripts/platform-pack-dev-fixture.mjs smoke-plan [targetDir]

Default targetDir:
  ${defaultTargetDir}`);
}

function resolveTargetDir(value) {
  return path.resolve(repoRoot, value || defaultTargetDir);
}

function quoteRuntimeText(value) {
  return JSON.stringify(String(value));
}

async function prepare(targetDir) {
  await mkdir(targetDir, { recursive: true });
  await cp(sourceDir, targetDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
  console.log(`Platform pack dev fixture prepared:
${targetDir}`);
}

async function setText(text, targetDir) {
  const runtimePath = path.join(targetDir, 'runtime.js');
  const current = await readFile(runtimePath, 'utf8');
  const markerPattern = /^export const WORKSPACE_VISIBLE_TEXT = .*;\r?$/m;
  if (!markerPattern.test(current)) {
    throw new Error(`Could not find WORKSPACE_VISIBLE_TEXT in ${runtimePath}`);
  }
  const next = current.replace(
    markerPattern,
    `export const WORKSPACE_VISIBLE_TEXT = ${quoteRuntimeText(text)};`
  );
  await writeFile(runtimePath, next, 'utf8');
  console.log(`Updated runtime visible text:
${runtimePath}
${text}`);
}

async function assertText(text, targetDir) {
  const runtimePath = path.join(targetDir, 'runtime.js');
  const current = await readFile(runtimePath, 'utf8');
  const expected = `export const WORKSPACE_VISIBLE_TEXT = ${quoteRuntimeText(text)};`;
  if (!current.includes(expected)) {
    throw new Error(`Expected runtime text was not found in ${runtimePath}: ${text}`);
  }
  console.log(`Runtime visible text verified:
${runtimePath}
${text}`);
}

function printSmokePlan(targetDir) {
  console.log(`Tauri GUI smoke plan:

1. Prepare fixture:
   node scripts/platform-pack-dev-fixture.mjs prepare

2. Launch the Tauri app and open Plugin Development Workspace.

3. Switch to Platform Pack and choose this directory:
   ${targetDir}

4. Bind the dev instance and click Open Workspace.

5. Manual reload smoke:
   node scripts/platform-pack-dev-fixture.mjs set-text "PMP Dev Fixture manual"
   Click Reload Pack and verify the workspace text changes.

6. Watcher smoke:
   Enable Auto reload in the preview panel.
   node scripts/platform-pack-dev-fixture.mjs set-text "PMP Dev Fixture watcher"
   Verify watcher status records a runtime-only change and automatic reload success.

7. Confirmation smoke:
   Edit manifest.json or contract.json.
   Verify watcher status becomes pending / needs confirmation.
   Click Confirm Reload and verify reload history records the result.

Current archive-note fallback:
If the active branch does not include PackWorkspaceMount, complete steps 1, 3, 5 command-side,
then use the preview/reload history state as the repeatable smoke artifact until the platform
workspace chain is restored.`);
}

const [command, first, second] = process.argv.slice(2);

try {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  if (command === 'prepare') {
    await prepare(resolveTargetDir(first));
  } else if (command === 'set-text') {
    if (!first) {
      throw new Error('set-text requires a visible text value');
    }
    await setText(first, resolveTargetDir(second));
  } else if (command === 'assert-text') {
    if (!first) {
      throw new Error('assert-text requires a visible text value');
    }
    await assertText(first, resolveTargetDir(second));
  } else if (command === 'smoke-plan') {
    printSmokePlan(resolveTargetDir(first));
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
