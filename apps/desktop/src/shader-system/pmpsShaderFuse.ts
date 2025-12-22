import type { ShaderRuntimeError, ShaderRuntimeErrorStage } from './webgl2Runtime';
import { readJson } from '../modules/storage';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate } from '../utils/windowCommunication';

export type PmpsShaderFuseRecord = {
  errorCount: number;
  firstErrorAt: number;
  lastErrorAt: number;
  lastStage?: ShaderRuntimeErrorStage;
  lastMessage?: string;
  disabledUntil?: number;
};

export type PmpsShaderFuseStore = Record<string, PmpsShaderFuseRecord>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function fuseKey(magnetId: string, shaderId: string): string {
  return `${magnetId}:${shaderId}`;
}

export function loadPmpsShaderFuseStore(): PmpsShaderFuseStore {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = readJson<unknown>(STORAGE_KEYS.PMPS_SHADER_FUSE, {});
    if (!isRecord(parsed)) return {};
    return parsed as PmpsShaderFuseStore;
  } catch {
    return {};
  }
}

function savePmpsShaderFuseStore(store: PmpsShaderFuseStore): void {
  if (typeof window === 'undefined') return;
  void broadcastDataUpdate(STORAGE_KEYS.PMPS_SHADER_FUSE, store, TAURI_EVENTS.PMPS_SHADER_FUSE_UPDATED);
}

export function getPmpsShaderFuseRecord(magnetId: string, shaderId: string): PmpsShaderFuseRecord | null {
  const store = loadPmpsShaderFuseStore();
  const record = store[fuseKey(magnetId, shaderId)];
  return record ?? null;
}

export function isPmpsShaderFused(magnetId: string, shaderId: string, nowMs: number = Date.now()): boolean {
  const record = getPmpsShaderFuseRecord(magnetId, shaderId);
  return Boolean(record?.disabledUntil && record.disabledUntil > nowMs);
}

export function clearPmpsShaderFuse(magnetId: string, shaderId: string): void {
  const store = loadPmpsShaderFuseStore();
  const key = fuseKey(magnetId, shaderId);
  if (!(key in store)) return;
  delete store[key];
  savePmpsShaderFuseStore(store);
}

export function recordPmpsShaderError(
  magnetId: string,
  shaderId: string,
  error: ShaderRuntimeError
): PmpsShaderFuseRecord {
  const now = Date.now();
  const windowMs = 60_000;
  const threshold = 3;
  const disableMsRuntime = 5 * 60_000;
  const disableMsCompile = 60 * 60_000;

  const store = loadPmpsShaderFuseStore();
  const key = fuseKey(magnetId, shaderId);
  const existing = store[key] ?? {
    errorCount: 0,
    firstErrorAt: now,
    lastErrorAt: now,
  };

  if (error.stage === 'context') {
    const next: PmpsShaderFuseRecord = {
      ...existing,
      lastErrorAt: now,
      lastStage: error.stage,
      lastMessage: error.message?.slice(0, 300),
    };
    store[key] = next;
    savePmpsShaderFuseStore(store);
    return next;
  }

  const withinWindow = now - existing.firstErrorAt <= windowMs;
  const next: PmpsShaderFuseRecord = withinWindow
    ? { ...existing }
    : { ...existing, errorCount: 0, firstErrorAt: now };

  next.errorCount = (next.errorCount ?? 0) + 1;
  next.lastErrorAt = now;
  next.lastStage = error.stage;
  next.lastMessage = error.message?.slice(0, 300);

  if (error.stage === 'compile' || error.stage === 'link') {
    next.disabledUntil = now + disableMsCompile;
  } else if (next.errorCount >= threshold) {
    next.disabledUntil = now + disableMsRuntime;
  }

  store[key] = next;
  savePmpsShaderFuseStore(store);
  return next;
}
