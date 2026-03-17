import { invoke } from '@tauri-apps/api/tauri';
import { isTauriRuntime } from '../../utils/tauriRuntime';

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
  workingSetBytes: number | null;
  privateBytes: number | null;
};

export type ProcessPerfTotals = {
  workingSetBytes: number;
  privateBytes: number;
  cpuPercent: number | null;
  appWorkingSetBytes: number;
  appPrivateBytes: number;
  appCpuPercent: number | null;
  webview2WorkingSetBytes: number;
  webview2PrivateBytes: number;
  webview2CpuPercent: number | null;
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

const EMPTY_TOTALS: ProcessPerfTotals = {
  workingSetBytes: 0,
  privateBytes: 0,
  cpuPercent: null,
  appWorkingSetBytes: 0,
  appPrivateBytes: 0,
  appCpuPercent: null,
  webview2WorkingSetBytes: 0,
  webview2PrivateBytes: 0,
  webview2CpuPercent: null,
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
  return {
    workingSetBytes: readNumber(value.workingSetBytes, 0),
    privateBytes: readNumber(value.privateBytes, 0),
    cpuPercent: readOptionalNumber(value.cpuPercent),
    appWorkingSetBytes: readNumber(value.appWorkingSetBytes, 0),
    appPrivateBytes: readNumber(value.appPrivateBytes, 0),
    appCpuPercent: readOptionalNumber(value.appCpuPercent),
    webview2WorkingSetBytes: readNumber(value.webview2WorkingSetBytes, 0),
    webview2PrivateBytes: readNumber(value.webview2PrivateBytes, 0),
    webview2CpuPercent: readOptionalNumber(value.webview2CpuPercent),
    otherWorkingSetBytes: readNumber(value.otherWorkingSetBytes, 0),
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

export async function getProcessPerfSnapshot(): Promise<ProcessPerfSnapshot | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('debug_get_process_perf_snapshot').catch(() => null);
  if (!raw) return null;
  return ensureProcessPerfSnapshot(raw);
}

export async function getProcessPerfTotalsSnapshot(): Promise<ProcessPerfTotalsSnapshot | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('debug_get_process_perf_totals').catch(() => null);
  if (!raw) return null;
  return ensureProcessPerfTotalsSnapshot(raw);
}

export async function trimProcessWorkingSet(
  target: ProcessWorkingSetTrimTarget = 'tree'
): Promise<ProcessWorkingSetTrimResult | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('debug_trim_process_working_set', { target }).catch(() => null);
  if (!raw) return null;
  return ensureProcessWorkingSetTrimResult(raw);
}
