import { isTauriRuntime } from '../../utils/tauriRuntime';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';

export type ProcessPerfKind = 'app' | 'webview2' | 'child';
export type ProcessWorkingSetTrimTarget = 'app' | 'webview2' | 'tree';

export type SystemMemorySnapshot = {
  memoryLoadPercent: number;
  totalPhysicalBytes: number;
  availablePhysicalBytes: number;
  totalPageFileBytes: number;
  availablePageFileBytes: number;
};

export type ProcessPerfRow = {
  pid: number;
  ppid: number;
  name: string;
  kind: ProcessPerfKind;
  cpuPercent: number | null;
  privateWorkingSetBytes: number | null;
  workingSetBytes: number | null;
  privateBytes: number | null;
};

export type ProcessPerfTotals = {
  privateWorkingSetBytes: number;
  workingSetBytes: number;
  privateBytes: number;
  cpuPercent: number | null;
  appPrivateWorkingSetBytes: number;
  appWorkingSetBytes: number;
  appPrivateBytes: number;
  appCpuPercent: number | null;
  webview2PrivateWorkingSetBytes: number;
  webview2WorkingSetBytes: number;
  webview2PrivateBytes: number;
  webview2CpuPercent: number | null;
  otherPrivateWorkingSetBytes: number;
  otherWorkingSetBytes: number;
  otherPrivateBytes: number;
  otherCpuPercent: number | null;
};

export type ProcessPerfSnapshot = {
  timestampMs: number;
  sampleIntervalMs: number | null;
  cpuCount: number;
  rootPid: number;
  systemMemory: SystemMemorySnapshot | null;
  totals: ProcessPerfTotals;
  processes: ProcessPerfRow[];
};

export type ProcessPerfTotalsSnapshot = {
  timestampMs: number;
  sampleIntervalMs: number | null;
  cpuCount: number;
  rootPid: number;
  systemMemory: SystemMemorySnapshot | null;
  totals: ProcessPerfTotals;
};

export type ProcessWorkingSetTrimResult = {
  timestampMs: number;
  rootPid: number;
  target: ProcessWorkingSetTrimTarget;
  attemptedPids: number[];
  trimmedPids: number[];
  failedPids: number[];
};

export type ProcessPerfRequestErrorCode =
  | 'runtime-unavailable'
  | 'unsupported'
  | 'invoke-failed';

export class ProcessPerfRequestError extends Error {
  readonly code: ProcessPerfRequestErrorCode;

  constructor(code: ProcessPerfRequestErrorCode, message: string) {
    super(message);
    this.name = 'ProcessPerfRequestError';
    this.code = code;
  }
}

const EMPTY_TOTALS: ProcessPerfTotals = {
  privateWorkingSetBytes: 0,
  workingSetBytes: 0,
  privateBytes: 0,
  cpuPercent: null,
  appPrivateWorkingSetBytes: 0,
  appWorkingSetBytes: 0,
  appPrivateBytes: 0,
  appCpuPercent: null,
  webview2PrivateWorkingSetBytes: 0,
  webview2WorkingSetBytes: 0,
  webview2PrivateBytes: 0,
  webview2CpuPercent: null,
  otherPrivateWorkingSetBytes: 0,
  otherWorkingSetBytes: 0,
  otherPrivateBytes: 0,
  otherCpuPercent: null,
};

const EMPTY_SNAPSHOT: ProcessPerfSnapshot = {
  timestampMs: 0,
  sampleIntervalMs: null,
  cpuCount: 1,
  rootPid: 0,
  systemMemory: null,
  totals: EMPTY_TOTALS,
  processes: [],
};

const EMPTY_TOTALS_SNAPSHOT: ProcessPerfTotalsSnapshot = {
  timestampMs: 0,
  sampleIntervalMs: null,
  cpuCount: 1,
  rootPid: 0,
  systemMemory: null,
  totals: EMPTY_TOTALS,
};

const EMPTY_TRIM_RESULT: ProcessWorkingSetTrimResult = {
  timestampMs: 0,
  rootPid: 0,
  target: 'tree',
  attemptedPids: [],
  trimmedPids: [],
  failedPids: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readKind(value: unknown): ProcessPerfKind {
  if (value === 'app' || value === 'webview2' || value === 'child') return value;
  return 'child';
}

function readTrimTarget(value: unknown): ProcessWorkingSetTrimTarget {
  if (value === 'app' || value === 'webview2' || value === 'tree') return value;
  return 'tree';
}

function ensureSystemMemory(value: unknown): SystemMemorySnapshot | null {
  if (!isRecord(value)) return null;
  return {
    memoryLoadPercent: readNumber(value.memoryLoadPercent, 0),
    totalPhysicalBytes: readNumber(value.totalPhysicalBytes, 0),
    availablePhysicalBytes: readNumber(value.availablePhysicalBytes, 0),
    totalPageFileBytes: readNumber(value.totalPageFileBytes, 0),
    availablePageFileBytes: readNumber(value.availablePageFileBytes, 0),
  };
}

function ensureTotals(value: unknown): ProcessPerfTotals {
  if (!isRecord(value)) return EMPTY_TOTALS;
  const workingSetBytes = readNumber(value.workingSetBytes, 0);
  const appWorkingSetBytes = readNumber(value.appWorkingSetBytes, 0);
  const webview2WorkingSetBytes = readNumber(value.webview2WorkingSetBytes, 0);
  const otherWorkingSetBytes = readNumber(value.otherWorkingSetBytes, 0);
  return {
    privateWorkingSetBytes: readNumber(value.privateWorkingSetBytes, workingSetBytes),
    workingSetBytes,
    privateBytes: readNumber(value.privateBytes, 0),
    cpuPercent: readOptionalNumber(value.cpuPercent),
    appPrivateWorkingSetBytes: readNumber(value.appPrivateWorkingSetBytes, appWorkingSetBytes),
    appWorkingSetBytes,
    appPrivateBytes: readNumber(value.appPrivateBytes, 0),
    appCpuPercent: readOptionalNumber(value.appCpuPercent),
    webview2PrivateWorkingSetBytes: readNumber(
      value.webview2PrivateWorkingSetBytes,
      webview2WorkingSetBytes
    ),
    webview2WorkingSetBytes,
    webview2PrivateBytes: readNumber(value.webview2PrivateBytes, 0),
    webview2CpuPercent: readOptionalNumber(value.webview2CpuPercent),
    otherPrivateWorkingSetBytes: readNumber(
      value.otherPrivateWorkingSetBytes,
      otherWorkingSetBytes
    ),
    otherWorkingSetBytes,
    otherPrivateBytes: readNumber(value.otherPrivateBytes, 0),
    otherCpuPercent: readOptionalNumber(value.otherCpuPercent),
  };
}

function ensureRow(value: unknown): ProcessPerfRow | null {
  if (!isRecord(value)) return null;
  return {
    pid: readNumber(value.pid, 0),
    ppid: readNumber(value.ppid, 0),
    name: readString(value.name, '-'),
    kind: readKind(value.kind),
    cpuPercent: readOptionalNumber(value.cpuPercent),
    privateWorkingSetBytes: readOptionalNumber(
      value.privateWorkingSetBytes ?? value.workingSetBytes
    ),
    workingSetBytes: readOptionalNumber(value.workingSetBytes),
    privateBytes: readOptionalNumber(value.privateBytes),
  };
}

export function ensureProcessPerfSnapshot(value: unknown): ProcessPerfSnapshot {
  if (!isRecord(value)) return EMPTY_SNAPSHOT;
  const processesRaw = Array.isArray(value.processes) ? value.processes : [];
  const processes: ProcessPerfRow[] = [];
  for (const item of processesRaw) {
    const row = ensureRow(item);
    if (row) processes.push(row);
  }

  return {
    timestampMs: readNumber(value.timestampMs, 0),
    sampleIntervalMs: readOptionalNumber(value.sampleIntervalMs),
    cpuCount: readNumber(value.cpuCount, 1),
    rootPid: readNumber(value.rootPid, 0),
    systemMemory: ensureSystemMemory(value.systemMemory),
    totals: ensureTotals(value.totals),
    processes,
  };
}

export function ensureProcessPerfTotalsSnapshot(value: unknown): ProcessPerfTotalsSnapshot {
  if (!isRecord(value)) return EMPTY_TOTALS_SNAPSHOT;
  return {
    timestampMs: readNumber(value.timestampMs, 0),
    sampleIntervalMs: readOptionalNumber(value.sampleIntervalMs),
    cpuCount: readNumber(value.cpuCount, 1),
    rootPid: readNumber(value.rootPid, 0),
    systemMemory: ensureSystemMemory(value.systemMemory),
    totals: ensureTotals(value.totals),
  };
}

export function ensureProcessWorkingSetTrimResult(value: unknown): ProcessWorkingSetTrimResult {
  if (!isRecord(value)) return EMPTY_TRIM_RESULT;
  const attemptedPids = Array.isArray(value.attemptedPids)
    ? value.attemptedPids.map((item) => readNumber(item, 0)).filter((item) => item > 0)
    : [];
  const trimmedPids = Array.isArray(value.trimmedPids)
    ? value.trimmedPids.map((item) => readNumber(item, 0)).filter((item) => item > 0)
    : [];
  const failedPids = Array.isArray(value.failedPids)
    ? value.failedPids.map((item) => readNumber(item, 0)).filter((item) => item > 0)
    : [];

  return {
    timestampMs: readNumber(value.timestampMs, 0),
    rootPid: readNumber(value.rootPid, 0),
    target: readTrimTarget(value.target),
    attemptedPids,
    trimmedPids,
    failedPids,
  };
}

function normalizeProcessPerfError(error: unknown): ProcessPerfRequestError {
  if (error instanceof ProcessPerfRequestError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/only supported on windows/i.test(message)) {
    return new ProcessPerfRequestError('unsupported', message);
  }
  return new ProcessPerfRequestError('invoke-failed', message);
}

async function invokeProcessPerfCommand(
  command: 'debug_get_process_perf_snapshot' | 'debug_get_process_perf_totals',
  event: 'debug.process-perf.snapshot' | 'debug.process-perf.totals'
): Promise<unknown> {
  if (!isTauriRuntime()) {
    throw new ProcessPerfRequestError(
      'runtime-unavailable',
      'Process performance snapshot is only available in Tauri runtime.'
    );
  }

  try {
    return await invokeWithTelemetry<unknown>(command, undefined, {
      moduleId: 'debug',
      component: 'processPerf',
      event,
    });
  } catch (error) {
    throw normalizeProcessPerfError(error);
  }
}

export async function requestProcessPerfSnapshot(): Promise<ProcessPerfSnapshot> {
  const raw = await invokeProcessPerfCommand(
    'debug_get_process_perf_snapshot',
    'debug.process-perf.snapshot'
  );
  return ensureProcessPerfSnapshot(raw);
}

export async function requestProcessPerfTotalsSnapshot(): Promise<ProcessPerfTotalsSnapshot> {
  const raw = await invokeProcessPerfCommand(
    'debug_get_process_perf_totals',
    'debug.process-perf.totals'
  );
  return ensureProcessPerfTotalsSnapshot(raw);
}

export async function getProcessPerfSnapshot(): Promise<ProcessPerfSnapshot | null> {
  try {
    return await requestProcessPerfSnapshot();
  } catch {
    return null;
  }
}

export async function getProcessPerfTotalsSnapshot(): Promise<ProcessPerfTotalsSnapshot | null> {
  try {
    return await requestProcessPerfTotalsSnapshot();
  } catch {
    return null;
  }
}

export async function trimProcessWorkingSet(
  target: ProcessWorkingSetTrimTarget = 'tree'
): Promise<ProcessWorkingSetTrimResult | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invokeWithTelemetry<unknown>('debug_trim_process_working_set', { target }, {
    moduleId: 'debug',
    component: 'processPerf',
    event: 'debug.process-perf.trim-working-set',
    successLevel: 'info',
  }).catch(() => null);
  if (!raw) return null;
  return ensureProcessWorkingSetTrimResult(raw);
}
