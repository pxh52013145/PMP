import { invoke } from '@tauri-apps/api/tauri';
import { isTauriRuntime } from '../../utils/tauriRuntime';

export type ProcessPerfKind = 'app' | 'webview2' | 'child';

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

export async function getProcessPerfSnapshot(): Promise<ProcessPerfSnapshot | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('debug_get_process_perf_snapshot').catch(() => null);
  if (!raw) return null;
  return ensureProcessPerfSnapshot(raw);
}

