#!/usr/bin/env node

import { access, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

function isTruthy(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

async function validateAsioSdk() {
  const sdkRootValue = process.env.CPAL_ASIO_DIR;
  if (!sdkRootValue || sdkRootValue.trim().length === 0) {
    throw new Error('PMPM_ENABLE_ASIO requires CPAL_ASIO_DIR to point at a Steinberg ASIO SDK root.');
  }

  const sdkRoot = path.resolve(sdkRootValue);
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

async function main() {
  const enableAsio =
    isTruthy(process.env.PMPM_ENABLE_ASIO) ||
    isTruthy(process.env.PMPM_ASIO_WATCH) ||
    (process.env.PMPM_ENABLE_ASIO?.trim().toLowerCase() === 'auto' && !!process.env.CPAL_ASIO_DIR);
  const watchAsio = isTruthy(process.env.PMPM_ASIO_WATCH);

  const tauriArgs = ['dev'];
  if (enableAsio) {
    await validateAsioSdk();
    tauriArgs.push('--config', 'src-tauri/tauri.dev.conf.json', '--features', 'asio-sdk');
    if (!watchAsio) {
      tauriArgs.push('--no-watch');
    }
  }
  tauriArgs.push(...process.argv.slice(2));

  console.log(`[dev-tauri] Starting Tauri dev${enableAsio ? ' with asio-sdk' : ''}.`);

  const child = spawn('tauri', tauriArgs, {
    cwd: process.cwd(),
    env: process.env,
    shell: true,
    stdio: 'inherit',
  });

  let forwardingSignal = false;

  function forwardSignal(signal) {
    if (forwardingSignal) return;
    forwardingSignal = true;
    if (!child.killed) {
      child.kill(signal);
    }
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => forwardSignal(signal));
  }

  child.on('error', (error) => {
    console.error(`[dev-tauri] Failed to start Tauri: ${error.message}`);
    process.exit(1);
  });

  child.on('close', (code, signal) => {
    if (signal) {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
    process.exit(code ?? 0);
  });
}

try {
  await main();
} catch (error) {
  console.error(`[dev-tauri] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
