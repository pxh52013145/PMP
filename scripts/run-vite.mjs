#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';

const child = spawn('vite', process.argv.slice(2), {
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
  console.error(`[run-vite] Failed to start Vite: ${error.message}`);
  process.exit(1);
});

child.on('close', (code, signal) => {
  if (signal) {
    process.exit(signal === 'SIGINT' ? 130 : 143);
  }
  process.exit(code ?? 0);
});
