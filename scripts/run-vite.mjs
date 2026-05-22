import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function resolveViteExecutable() {
  const binName = process.platform === 'win32' ? 'vite.cmd' : 'vite';
  const localBin = path.resolve(process.cwd(), 'node_modules', '.bin', binName);
  if (exists(localBin)) {
    return localBin;
  }
  return binName;
}

const child = spawn(resolveViteExecutable(), process.argv.slice(2), {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    BROWSERSLIST_IGNORE_OLD_DATA:
      process.env.BROWSERSLIST_IGNORE_OLD_DATA && process.env.BROWSERSLIST_IGNORE_OLD_DATA.trim()
        ? process.env.BROWSERSLIST_IGNORE_OLD_DATA
        : '1',
  },
});

child.on('exit', (code, signal) => {
  if (typeof code === 'number') {
    process.exit(code);
  }
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(1);
});
