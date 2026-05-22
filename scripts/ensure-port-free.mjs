import { spawnSync } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';

function usage(exitCode = 0) {
  // eslint-disable-next-line no-console
  console.log('Usage: node scripts/ensure-port-free.mjs <port>');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const portRaw = argv[2];
  if (!portRaw) usage(1);
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${portRaw}`);
  }
  return { port };
}

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', status: res.status ?? 0 };
}

function uniqNumbers(values) {
  return [...new Set(values.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))];
}

function getListeningPidsWindows(port) {
  const ps = [
    '-NoProfile',
    '-Command',
    [
      '$ErrorActionPreference="SilentlyContinue";',
      `Get-NetTCPConnection -LocalPort ${port} -State Listen |`,
      'Select-Object -ExpandProperty OwningProcess -Unique',
    ].join(' '),
  ];
  const res = run('powershell.exe', ps);
  const pids = uniqNumbers(res.stdout.split(/\s+/g).filter(Boolean));
  return pids;
}

function getCommandLineWindows(pid) {
  const ps = [
    '-NoProfile',
    '-Command',
    [
      '$ErrorActionPreference="SilentlyContinue";',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine)`,
    ].join(' '),
  ];
  const res = run('powershell.exe', ps);
  return (res.stdout || '').trim();
}

function killWindows(pid) {
  const res = run('taskkill', ['/PID', String(pid), '/T', '/F']);
  return res.status === 0;
}

function getListeningPidsPosix(port) {
  // Prefer lsof; it is the most reliable for this use case.
  const res = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  if (res.status === 0) {
    return uniqNumbers(res.stdout.split(/\s+/g).filter(Boolean));
  }
  return [];
}

function getCommandLinePosix(pid) {
  const res = run('ps', ['-p', String(pid), '-o', 'command=']);
  return (res.stdout || '').trim();
}

function killPosix(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function formatProc(pid, cmdline) {
  const cmd = cmdline ? cmdline.replace(/\s+/g, ' ').slice(0, 240) : '<unknown>';
  return `PID ${pid}: ${cmd}`;
}

async function main() {
  const { port } = parseArgs(process.argv);
  const repoRoot = findRepoRoot(process.cwd());
  const repoRootNorm = repoRoot.toLowerCase();

  const pids =
    process.platform === 'win32' ? getListeningPidsWindows(port) : getListeningPidsPosix(port);

  if (pids.length === 0) return;

  const processes = pids.map((pid) => {
    const cmdline =
      process.platform === 'win32' ? getCommandLineWindows(pid) : getCommandLinePosix(pid);
    return { pid, cmdline };
  });

  const safeToKill = processes.every(({ cmdline }) => {
    const cl = (cmdline || '').toLowerCase();
    return cl.includes('vite') && cl.includes(repoRootNorm);
  });

  if (!safeToKill) {
    // eslint-disable-next-line no-console
    console.error(
      [
        `Port ${port} is already in use.`,
        ...processes.map(({ pid, cmdline }) => `  ${formatProc(pid, cmdline)}`),
        '',
        'Close the process above, then retry.',
      ].join('\n'),
    );
    process.exit(1);
  }

  const killed = processes.map(({ pid }) => {
    const ok = process.platform === 'win32' ? killWindows(pid) : killPosix(pid);
    return { pid, ok };
  });

  const failed = killed.filter((x) => !x.ok).map((x) => x.pid);
  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`Failed to stop processes on port ${port}: ${failed.join(', ')}`);
    process.exit(1);
  }
}

await main();
