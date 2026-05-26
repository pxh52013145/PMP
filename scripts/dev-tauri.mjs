import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';

const DEV_RESTART_EXIT_CODE = 86;
const DEV_RESTART_SIGNAL_PATH = path.join(os.tmpdir(), `pmp-tauri-dev-restart-${process.pid}.signal`);

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (exists(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', status: res.status ?? 0 };
}

function isWindowsPidRunning(pid) {
  const ps = [
    '-NoProfile',
    '-Command',
    [
      '$ErrorActionPreference="SilentlyContinue";',
      `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue) -ne $null`,
    ].join(' '),
  ];
  const res = run('powershell.exe', ps);
  const raw = (res.stdout || '').trim().toLowerCase();
  return raw === 'true';
}

function sleepWindowsMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  run('powershell.exe', ['-NoProfile', '-Command', `Start-Sleep -Milliseconds ${Math.floor(ms)}`]);
}

function removeFileIfExists(p) {
  try {
    fs.rmSync(p, { force: true });
  } catch {
    // ignore
  }
}

function consumeDevRestartSignal() {
  if (!exists(DEV_RESTART_SIGNAL_PATH)) return false;
  removeFileIfExists(DEV_RESTART_SIGNAL_PATH);
  return true;
}

function killWindows(pid, options = {}) {
  const waitMs = Number.isFinite(options.waitMs) ? options.waitMs : 1500;

  // Try a graceful close first (WM_CLOSE for GUI apps). This is best-effort.
  run('taskkill', ['/PID', String(pid), '/T']);

  const deadline = Date.now() + Math.max(0, waitMs);
  while (Date.now() < deadline) {
    if (!isWindowsPidRunning(pid)) return true;
    sleepWindowsMs(120);
  }

  // Force kill as a fallback (e.g. hung process).
  const res = run('taskkill', ['/PID', String(pid), '/T', '/F']);
  return res.status === 0 || !isWindowsPidRunning(pid);
}

function getWindowsProcessesByName(names) {
  const ps = [
    '-NoProfile',
    '-Command',
    [
      '$ErrorActionPreference="SilentlyContinue";',
      `$names=@(${names.map((n) => `"${n.replace(/\"/g, '\\"')}"`).join(',')});`,
      'Get-CimInstance Win32_Process |',
      'Where-Object { $names -contains $_.Name } |',
      'Select-Object ProcessId,Name,ExecutablePath,CommandLine |',
      'ConvertTo-Json -Compress',
    ].join(' '),
  ];
  const res = run('powershell.exe', ps);
  const raw = (res.stdout || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .map((item) => ({
        pid: Number(item.ProcessId),
        name: String(item.Name ?? ''),
        executablePath: item.ExecutablePath ? String(item.ExecutablePath) : null,
        commandLine: item.CommandLine ? String(item.CommandLine) : null,
      }))
      .filter((p) => Number.isInteger(p.pid) && p.pid > 0);
  } catch {
    return [];
  }
}

function ensureNoStaleTauriApp() {
  if (process.platform !== 'win32') return;

  const repoRoot = findRepoRoot(process.cwd());
  const repoRootNorm = repoRoot.toLowerCase();
  const debugDir = path.resolve(process.cwd(), 'src-tauri', 'target', 'debug');
  const debugDirNorm = debugDir.toLowerCase();

  const processes = getWindowsProcessesByName([
    'Pixel Matrix Player.exe',
    'pixel-matrix-player.exe',
  ]);

  const devProcs = processes.filter((p) => {
    const exec = (p.executablePath || '').toLowerCase();
    const cmd = (p.commandLine || '').toLowerCase();
    return (exec && exec.startsWith(debugDirNorm)) || (cmd && cmd.includes(debugDirNorm));
  });

  if (devProcs.length === 0) return;

  const safeToKill = devProcs.every((p) => {
    const exec = (p.executablePath || '').toLowerCase();
    const cmd = (p.commandLine || '').toLowerCase();
    const inDebugDir = (exec && exec.startsWith(debugDirNorm)) || (cmd && cmd.includes(debugDirNorm));
    const inRepo = (exec && exec.includes(repoRootNorm)) || (cmd && cmd.includes(repoRootNorm));
    return inDebugDir && inRepo;
  });

  if (!safeToKill) {
    // eslint-disable-next-line no-console
    console.error(
      [
        '[dev] Detected a running Pixel Matrix Player process that would block rebuild.',
        ...devProcs.map(
          (p) => `  PID ${p.pid}: ${p.executablePath || p.commandLine || p.name || '<unknown>'}`,
        ),
        '',
        'Quit it from the system tray (Menu -> Quit) or stop the process, then retry.',
      ].join('\n'),
    );
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.warn(
    [
      '[dev] Closing stale dev app instance to avoid Windows file-lock errors.',
      ...devProcs.map(
        (p) => `  PID ${p.pid}: ${p.executablePath || p.commandLine || p.name || '<unknown>'}`,
      ),
    ].join('\n'),
  );

  const killed = devProcs.map((p) => ({ pid: p.pid, ok: killWindows(p.pid, { waitMs: 4_500 }) }));
  const failed = killed.filter((x) => !x.ok).map((x) => x.pid);
  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[dev] Failed to stop stale dev app process(es): ${failed.join(', ')}`);
    process.exit(1);
  }
}

function resolveAsioSdkRoot() {
  const raw = process.env.CPAL_ASIO_DIR;
  if (!raw) return null;
  const resolved = path.resolve(raw);
  if (!exists(resolved)) {
    // eslint-disable-next-line no-console
    console.error(`[env] CPAL_ASIO_DIR does not exist: ${resolved}`);
    return { ok: false, resolved };
  }
  const header = path.join(resolved, 'common', 'asio.h');
  if (!exists(header)) {
    // eslint-disable-next-line no-console
    console.error(
      `[env] CPAL_ASIO_DIR does not look like ASIO SDK root (missing common/asio.h): ${resolved}`,
    );
    return { ok: false, resolved };
  }
  return { ok: true, resolved };
}

function shouldEnableAsio() {
  if (process.platform !== 'win32') return false;

  const enabled =
    process.env.PMPM_ENABLE_ASIO === '1' ||
    process.env.PMPM_ENABLE_ASIO === 'true' ||
    process.env.PMPM_ENABLE_ASIO === 'yes';
  const force =
    process.env.PMPM_FORCE_ASIO === '1' ||
    process.env.PMPM_FORCE_ASIO === 'true' ||
    process.env.PMPM_FORCE_ASIO === 'yes';

  // Default `pnpm dev` should NOT enable ASIO automatically. Use:
  // - `pnpm --filter @pixel-matrix/desktop dev:asio`
  // - or `PMPM_ENABLE_ASIO=1 pnpm dev` (requires CPAL_ASIO_DIR)
  if (!enabled && !force) return false;

  const sdkRoot = resolveAsioSdkRoot();
  if (!sdkRoot) {
    // eslint-disable-next-line no-console
    console.error('[env] ASIO requested but CPAL_ASIO_DIR is missing.');
    process.exit(1);
  }

  if (sdkRoot.ok) return true;

  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const args = ['dev', ...extraArgs];

if (process.platform === 'win32') {
  const alreadyHasConfig = args.includes('--config') || args.includes('-c');
  if (!alreadyHasConfig) {
    const configPath = path.resolve(process.cwd(), 'src-tauri', 'tauri.dev.conf.json');
    if (exists(configPath)) {
      args.splice(1, 0, '--config', configPath);
    }
  }
}

if (shouldEnableAsio()) {
  // eslint-disable-next-line no-console
  console.log('[dev] ASIO enabled (feature: asio-sdk)');
  args.splice(1, 0, '--features', 'asio-sdk');

  const wantsWatch =
    process.env.PMPM_ASIO_WATCH === '1' ||
    process.env.PMPM_ASIO_WATCH === 'true' ||
    process.env.PMPM_ASIO_WATCH === 'yes';
  const alreadyNoWatch = args.includes('--no-watch');
  if (!wantsWatch && !alreadyNoWatch) {
    // eslint-disable-next-line no-console
    console.log('[dev] ASIO dev uses --no-watch (set PMPM_ASIO_WATCH=1 to enable watcher).');
    args.splice(1, 0, '--no-watch');
  }
}

function resolveTauriCommand() {
  const binName = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';
  const local = path.resolve(process.cwd(), 'node_modules', '.bin', binName);
  if (exists(local)) return local;
  return 'tauri';
}

function normalizeExitCode(code) {
  if (!Number.isInteger(code)) return null;
  if (code < 0) {
    return (0x1_0000_0000 + code) >>> 0;
  }
  return code >>> 0;
}

function spawnTauriDev(command, commandArgs) {
  const env = {
    ...process.env,
    PMP_TAURI_DEV_RESTART_EXIT_CODE: String(DEV_RESTART_EXIT_CODE),
    PMP_TAURI_DEV_RESTART_SIGNAL: DEV_RESTART_SIGNAL_PATH,
    RUST_BACKTRACE: process.env.RUST_BACKTRACE || '1',
  };
  return spawn(command, commandArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });
}

ensureNoStaleTauriApp();
removeFileIfExists(DEV_RESTART_SIGNAL_PATH);

const command = resolveTauriCommand();
let child = null;

let shuttingDown = false;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;

  // eslint-disable-next-line no-console
  console.warn(`[dev] Stopping tauri dev (${reason})...`);

  if (process.platform === 'win32') {
    if (child?.pid) {
      killWindows(child.pid);
    }
    ensureNoStaleTauriApp();
    process.exit(0);
  }

  try {
    child.kill('SIGINT');
  } catch {
    // ignore
  }
  process.exit(0);
}

function startTauriDev() {
  child = spawnTauriDev(command, args);

  child.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(`[dev] Failed to spawn tauri (${command}): ${err?.message ?? String(err)}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    const normalized = normalizeExitCode(code);
    const restartSignal = consumeDevRestartSignal();

    if (!shuttingDown && (normalized === DEV_RESTART_EXIT_CODE || restartSignal)) {
      // eslint-disable-next-line no-console
      console.warn('[dev] Restart requested by app; restarting tauri dev...');
      ensureNoStaleTauriApp();
      startTauriDev();
      return;
    }

    if (normalized !== null && normalized >= 0x80000000) {
      // eslint-disable-next-line no-console
      console.error(
        `[dev] tauri dev exited with Windows crash code 0x${normalized
          .toString(16)
          .toUpperCase()} (no fallback enabled).`,
      );
    }

    process.exit(code ?? 1);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startTauriDev();
