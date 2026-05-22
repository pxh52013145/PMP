#!/usr/bin/env node

import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function printUsage() {
  console.error('Usage: node scripts/require-env.mjs <ENV_NAME> [ENV_NAME...]');
}

function isPresent(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function validateAsioSdkRoot(value) {
  const sdkRoot = path.resolve(value);
  let info;
  try {
    info = await stat(sdkRoot);
  } catch {
    throw new Error(`CPAL_ASIO_DIR does not exist: ${sdkRoot}`);
  }

  if (!info.isDirectory()) {
    throw new Error(`CPAL_ASIO_DIR must be a directory: ${sdkRoot}`);
  }

  const headerPath = path.join(sdkRoot, 'common', 'asio.h');
  try {
    await access(headerPath);
  } catch {
    throw new Error(`CPAL_ASIO_DIR must contain common/asio.h: ${headerPath}`);
  }
}

async function validateEnv(name) {
  const value = process.env[name];
  if (!isPresent(value)) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  if (name === 'CPAL_ASIO_DIR') {
    await validateAsioSdkRoot(value);
  }
}

const names = process.argv.slice(2);
if (names.length === 0) {
  printUsage();
  process.exit(2);
}

const errors = [];
for (const name of names) {
  try {
    await validateEnv(name);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

if (errors.length > 0) {
  for (const message of errors) {
    console.error(`[require-env] ${message}`);
  }
  process.exit(1);
}
