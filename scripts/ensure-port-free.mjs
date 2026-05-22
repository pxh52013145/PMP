#!/usr/bin/env node

import { execFile } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function printUsage() {
  console.error('Usage: node scripts/ensure-port-free.mjs <port> [--force]');
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parsePort(value) {
  const port = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return port;
}

function canListen(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (error) => {
      resolve(error?.code === 'EADDRNOTAVAIL');
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen({ port, host, exclusive: true });
  });
}

async function isPortFree(port) {
  const ipv4Free = await canListen(port, '127.0.0.1');
  const ipv6Free = await canListen(port, '::1');
  return ipv4Free && ipv6Free;
}

function localAddressUsesPort(localAddress, port) {
  return localAddress.endsWith(`:${port}`);
}

async function findWindowsListeningPids(port) {
  const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'tcp'], {
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  const pids = new Set();

  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (!match) continue;
    if (!localAddressUsesPort(match[1], port)) continue;
    pids.add(Number(match[2]));
  }

  return [...pids].filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function findUnixListeningPids(port) {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      maxBuffer: 1024 * 1024,
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function findListeningPids(port) {
  if (process.platform === 'win32') {
    return findWindowsListeningPids(port);
  }
  return findUnixListeningPids(port);
}

async function describeWindowsProcess(pid) {
  const command = [
    `$process = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
    'if ($process) {',
    '  $process | Select-Object -First 1 ProcessId,Name,CommandLine | ConvertTo-Json -Compress',
    '}',
  ].join('; ');

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { maxBuffer: 1024 * 1024, windowsHide: true }
    );
    const text = stdout.trim();
    if (!text) {
      return { pid, name: '', commandLine: '' };
    }
    const processInfo = JSON.parse(text);
    return {
      pid,
      name: String(processInfo.Name ?? ''),
      commandLine: String(processInfo.CommandLine ?? ''),
    };
  } catch {
    return { pid, name: '', commandLine: '' };
  }
}

async function describeUnixProcess(pid) {
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'comm=', '-o', 'command='], {
      maxBuffer: 1024 * 1024,
    });
    const [name = '', ...commandParts] = stdout.trim().split(/\s+/);
    return {
      pid,
      name,
      commandLine: commandParts.join(' '),
    };
  } catch {
    return { pid, name: '', commandLine: '' };
  }
}

async function describeProcess(pid) {
  if (process.platform === 'win32') {
    return describeWindowsProcess(pid);
  }
  return describeUnixProcess(pid);
}

function looksLikeDevProcess(processInfo) {
  const text = `${processInfo.name} ${processInfo.commandLine}`.toLowerCase();
  return (
    text.includes('pixel-matrix-player') ||
    text.includes('apps\\desktop') ||
    text.includes('apps/desktop') ||
    text.includes('run-vite.mjs')
  );
}

async function terminateProcess(pid) {
  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
}

function formatProcess(processInfo) {
  const name = processInfo.name || 'unknown';
  const commandLine = processInfo.commandLine ? ` ${processInfo.commandLine}` : '';
  return `pid ${processInfo.pid} (${name})${commandLine}`;
}

async function main() {
  const port = parsePort(process.argv[2]);
  const force = process.argv.includes('--force');
  if (port === null) {
    printUsage();
    process.exit(2);
  }

  if (await isPortFree(port)) {
    return;
  }

  const pids = await findListeningPids(port);
  if (pids.length === 0) {
    console.error(`[ensure-port-free] Port ${port} is busy, but no listening process was found.`);
    process.exit(1);
  }

  const processes = await Promise.all(pids.map((pid) => describeProcess(pid)));
  const unsafeProcesses = force ? [] : processes.filter((processInfo) => !looksLikeDevProcess(processInfo));
  if (unsafeProcesses.length > 0) {
    console.error(`[ensure-port-free] Port ${port} is busy, and the owning process does not look like a PMP dev server:`);
    for (const processInfo of unsafeProcesses) {
      console.error(`  - ${formatProcess(processInfo)}`);
    }
    console.error('[ensure-port-free] Stop it manually, or pass --force if you are sure it is safe to terminate.');
    process.exit(1);
  }

  for (const processInfo of processes) {
    console.log(`[ensure-port-free] Stopping stale dev process on port ${port}: ${formatProcess(processInfo)}`);
    await terminateProcess(processInfo.pid);
  }

  await sleep(700);
  if (!(await isPortFree(port))) {
    console.error(`[ensure-port-free] Port ${port} is still busy after stopping the previous process.`);
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  console.error(`[ensure-port-free] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
