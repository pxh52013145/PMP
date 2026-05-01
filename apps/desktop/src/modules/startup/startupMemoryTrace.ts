import type { ProcessPerfTotalsSnapshot } from '../debug/processPerf';
import { readJson, readString, writeJson } from '../storage';
import { getGlobalTelemetryService } from '../../services/telemetry/TelemetryService';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { isStartupReady, onStartupIdle } from './startupReady';

export type StartupMemoryCheckpointLabel =
  | 'frontend.main.before-render'
  | 'frontend.root.resolved'
  | 'frontend.root.render-dispatched'
  | 'kernel.modules.activated'
  | 'app.providers.mounted'
  | 'audio.native.constructed'
  | 'builtin-contributions.activated'
  | 'ornaments.overlay.open.requested'
  | 'ornaments.overlay.opened'
  | 'pixel.renderer.created'
  | 'startup.idle.5s'
  | 'startup.idle.15s'
  | string;

export type StartupMemoryRuntimeFlags = {
  nativeAudioConstructed: boolean;
  ornamentsOverlayRequested: boolean;
  ornamentsOverlayOpened: boolean;
  pixelRendererCreated: boolean;
};

export type StartupBackendRuntimeState = {
  musicLibraryServicesInitialized: boolean;
  vstServicesInitialized: boolean;
};

export type StartupMemoryCheckpoint = {
  sessionId: string;
  sequence: number;
  label: StartupMemoryCheckpointLabel;
  atMs: number;
  performanceNowMs: number | null;
  routeHash: string;
  runtimeProfile: string | null;
  activeMagnetCount: number | null;
  activeMagnetIdsCount: number | null;
  isTauri: boolean;
  startupReady: boolean;
  jsHeapUsedBytes: number | null;
  musicLibraryServiceRegistered: boolean | null;
  flags: StartupMemoryRuntimeFlags;
  backend: StartupBackendRuntimeState | null;
  process: ProcessPerfTotalsSnapshot | null;
  fields: Record<string, unknown>;
};

export type StartupMemoryTraceSession = {
  version: 1;
  sessionId: string;
  startedAtMs: number;
  checkpoints: StartupMemoryCheckpoint[];
};

export type StartupMemoryCheckpointOptions = {
  activeMagnetCount?: number | null;
  activeMagnetIdsCount?: number | null;
  fields?: Record<string, unknown>;
};

type StartupMemoryTraceFlag = keyof StartupMemoryRuntimeFlags;

const MAX_CHECKPOINTS = 80;
const sessionId = `startup-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const startedAtMs = Date.now();
const checkpoints: StartupMemoryCheckpoint[] = [];
const emittedCheckpointSequences = new Set<number>();
let checkpointSequence = 0;
const runtimeFlags: StartupMemoryRuntimeFlags = {
  nativeAudioConstructed: false,
  ornamentsOverlayRequested: false,
  ornamentsOverlayOpened: false,
  pixelRendererCreated: false,
};

declare global {
  // Exposed only when startup memory tracing is explicitly enabled.
  // eslint-disable-next-line no-var
  var __pmpStartupMemoryTrace: StartupMemoryTraceSession | undefined;
}

function readBooleanLike(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function readUrlFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(window.location.href);
    if (readBooleanLike(url.searchParams.get('pmpStartupMemoryTrace'))) return true;
    const hashParams = new URLSearchParams(url.hash.split('?')[1] ?? '');
    return readBooleanLike(hashParams.get('pmpStartupMemoryTrace'));
  } catch {
    return false;
  }
}

function readImportMetaFlag(): boolean {
  return import.meta.env.VITE_PMP_STARTUP_MEMORY_TRACE === '1';
}

export function isStartupMemoryTraceEnabled(): boolean {
  if (readImportMetaFlag()) return true;
  if (readUrlFlag()) return true;
  return readBooleanLike(readString(STORAGE_KEYS.STARTUP_MEMORY_TRACE_ENABLED));
}

export function setStartupMemoryTraceFlag(flag: StartupMemoryTraceFlag, value = true): void {
  runtimeFlags[flag] = value;
}

function readPerformanceNowMs(): number | null {
  try {
    return typeof performance !== 'undefined' ? performance.now() : null;
  } catch {
    return null;
  }
}

function readJsHeapUsedBytes(): number | null {
  try {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
    const value = memory?.usedJSHeapSize;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function readRouteHash(): string {
  if (typeof window === 'undefined') return '';
  return window.location.hash;
}

function readRuntimeProfile(): string | null {
  return readJson<string | null>(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE, null);
}

async function collectProcessTotals(): Promise<ProcessPerfTotalsSnapshot | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { requestProcessPerfTotalsSnapshot } = await import('../debug/processPerf');
    return await requestProcessPerfTotalsSnapshot();
  } catch {
    return null;
  }
}

async function collectBackendRuntimeState(): Promise<StartupBackendRuntimeState | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { invokeWithTelemetry } = await import('../../services/telemetry/tauriInvokeTelemetry');
    return await invokeWithTelemetry<StartupBackendRuntimeState>(
      'debug_get_startup_runtime_state',
      undefined,
      {
        moduleId: 'performance',
        component: 'startupMemoryTrace',
        event: 'performance.startup.runtime-state',
      }
    );
  } catch {
    return null;
  }
}

async function readMusicLibraryRegistered(): Promise<boolean | null> {
  try {
    const { getRegisteredMusicLibraryService } = await import(
      '../../services/audio/MusicLibraryServiceRegistry'
    );
    return getRegisteredMusicLibraryService() !== null;
  } catch {
    return null;
  }
}

function getSession(): StartupMemoryTraceSession {
  return {
    version: 1,
    sessionId,
    startedAtMs,
    checkpoints: checkpoints.map((checkpoint) => ({ ...checkpoint })),
  };
}

function exposeAndPersistSession(): void {
  const session = getSession();
  globalThis.__pmpStartupMemoryTrace = session;
  writeJson(STORAGE_KEYS.STARTUP_MEMORY_TRACE_V1, session, {
    mode: 'idle',
    debounceMs: 500,
  });
}

function emitCheckpointTelemetry(checkpoint: StartupMemoryCheckpoint): void {
  const service = getGlobalTelemetryService();
  if (!service) return;
  if (emittedCheckpointSequences.has(checkpoint.sequence)) return;
  emittedCheckpointSequences.add(checkpoint.sequence);

  service.getLogger('performance', 'startupMemoryTrace').metric(
    'performance.startup.memory.checkpoint',
    {
      sessionId: checkpoint.sessionId,
      sequence: checkpoint.sequence,
      label: checkpoint.label,
      atMs: checkpoint.atMs,
      performanceNowMs: checkpoint.performanceNowMs,
      routeHash: checkpoint.routeHash,
      runtimeProfile: checkpoint.runtimeProfile,
      activeMagnetCount: checkpoint.activeMagnetCount,
      activeMagnetIdsCount: checkpoint.activeMagnetIdsCount,
      isTauri: checkpoint.isTauri,
      startupReady: checkpoint.startupReady,
      jsHeapUsedBytes: checkpoint.jsHeapUsedBytes,
      musicLibraryServiceRegistered: checkpoint.musicLibraryServiceRegistered,
      backend: checkpoint.backend,
      flags: checkpoint.flags,
      process: checkpoint.process,
      ...checkpoint.fields,
    },
    { level: 'info' }
  );
}

export function flushStartupMemoryTraceTelemetry(): void {
  if (!isStartupMemoryTraceEnabled()) return;
  for (const checkpoint of checkpoints) {
    emitCheckpointTelemetry(checkpoint);
  }
}

export async function captureStartupMemoryCheckpoint(
  label: StartupMemoryCheckpointLabel,
  options: StartupMemoryCheckpointOptions = {}
): Promise<StartupMemoryCheckpoint | null> {
  if (!isStartupMemoryTraceEnabled()) return null;

  const [process, backend, musicLibraryServiceRegistered] = await Promise.all([
    collectProcessTotals(),
    collectBackendRuntimeState(),
    readMusicLibraryRegistered(),
  ]);

  const checkpoint: StartupMemoryCheckpoint = {
    sessionId,
    sequence: ++checkpointSequence,
    label,
    atMs: Date.now(),
    performanceNowMs: readPerformanceNowMs(),
    routeHash: readRouteHash(),
    runtimeProfile: readRuntimeProfile(),
    activeMagnetCount: options.activeMagnetCount ?? null,
    activeMagnetIdsCount: options.activeMagnetIdsCount ?? null,
    isTauri: isTauriRuntime(),
    startupReady: isStartupReady(),
    jsHeapUsedBytes: readJsHeapUsedBytes(),
    musicLibraryServiceRegistered,
    flags: { ...runtimeFlags },
    backend,
    process,
    fields: options.fields ? { ...options.fields } : {},
  };

  checkpoints.push(checkpoint);
  if (checkpoints.length > MAX_CHECKPOINTS) {
    checkpoints.splice(0, checkpoints.length - MAX_CHECKPOINTS);
  }

  exposeAndPersistSession();
  emitCheckpointTelemetry(checkpoint);
  return checkpoint;
}

export function recordStartupMemoryCheckpoint(
  label: StartupMemoryCheckpointLabel,
  options: StartupMemoryCheckpointOptions = {}
): void {
  if (!isStartupMemoryTraceEnabled()) return;
  void captureStartupMemoryCheckpoint(label, options);
}

export function scheduleStartupMemoryIdleCheckpoints(): () => void {
  if (!isStartupMemoryTraceEnabled()) return () => {};

  const cleanupIdle5s = onStartupIdle(
    () => recordStartupMemoryCheckpoint('startup.idle.5s'),
    { delayMs: 5_000, timeoutMs: 2_500 }
  );
  const cleanupIdle15s = onStartupIdle(
    () => recordStartupMemoryCheckpoint('startup.idle.15s'),
    { delayMs: 15_000, timeoutMs: 3_000 }
  );

  return () => {
    cleanupIdle5s();
    cleanupIdle15s();
  };
}

export function readPersistedStartupMemoryTrace(): StartupMemoryTraceSession | null {
  return readJson<StartupMemoryTraceSession | null>(STORAGE_KEYS.STARTUP_MEMORY_TRACE_V1, null);
}

export function resetStartupMemoryTraceForTests(): void {
  checkpoints.splice(0, checkpoints.length);
  emittedCheckpointSequences.clear();
  checkpointSequence = 0;
  runtimeFlags.nativeAudioConstructed = false;
  runtimeFlags.ornamentsOverlayRequested = false;
  runtimeFlags.ornamentsOverlayOpened = false;
  runtimeFlags.pixelRendererCreated = false;
  globalThis.__pmpStartupMemoryTrace = undefined;
}
