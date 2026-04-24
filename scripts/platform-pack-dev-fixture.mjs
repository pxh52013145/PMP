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
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
