import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';

export type StorageWriteMode = 'sync' | 'idle' | 'debounce';

export interface StorageWriteOptions {
  mode?: StorageWriteMode;
  debounceMs?: number;
}

export const PMP_STORAGE_CHANGE_EVENT = 'pmp-storage-change';

export type PmpStorageChangeDetail = {
  key: string;
  value: string | null;
};

function emitStorageChange(key: string, value: string | null): void {
  try {
    window.dispatchEvent(
      new CustomEvent<PmpStorageChangeDetail>(PMP_STORAGE_CHANGE_EVENT, {
        detail: { key, value },
      })
    );
  } catch {
    // ignore: best-effort notification only
  }
}

const pendingWrites = new Map<string, string>();
let flushTimeout: number | null = null;
let idleHandle: number | null = null;
const telemetry = getTelemetryLogger('storage', 'localStorage');

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (pendingWrites.size > 0) {
      flushPendingWrites();
    }
    if (flushTimeout !== null) {
      window.clearTimeout(flushTimeout);
      flushTimeout = null;
    }
    if (idleHandle !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(idleHandle);
      idleHandle = null;
    }
  });
}

function flushPendingWrites(): void {
  flushTimeout = null;
  if (idleHandle !== null && typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(idleHandle);
    idleHandle = null;
  }

  for (const [key, value] of pendingWrites.entries()) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      telemetry.warn('storage.local.flush.failed', {
        message: error instanceof Error ? error.message : String(error),
        fields: { key },
      });
    }
  }
  pendingWrites.clear();
}

function scheduleFlush(mode: StorageWriteMode, debounceMs: number): void {
  if (mode === 'idle' && typeof requestIdleCallback === 'function') {
    if (idleHandle !== null) return;
    idleHandle = requestIdleCallback(() => flushPendingWrites(), { timeout: debounceMs });
    return;
  }

  if (flushTimeout !== null) return;
  flushTimeout = window.setTimeout(() => flushPendingWrites(), debounceMs);
}

export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    telemetry.warn('storage.local.read.failed', {
      message: error instanceof Error ? error.message : String(error),
      fields: { key },
    });
    return null;
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    telemetry.warn('storage.local.json-parse.failed', {
      message: error instanceof Error ? error.message : String(error),
      fields: { key },
    });
    return fallback;
  }
}

export function writeString(key: string, value: string, options: StorageWriteOptions = {}): void {
  const mode = options.mode ?? 'sync';
  const debounceMs = options.debounceMs ?? 200;

  try {
    if (mode === 'sync') {
      localStorage.setItem(key, value);
      emitStorageChange(key, value);
      return;
    }

    pendingWrites.set(key, value);
    scheduleFlush(mode, debounceMs);
    emitStorageChange(key, value);
  } catch (error) {
    telemetry.warn('storage.local.write.failed', {
      message: error instanceof Error ? error.message : String(error),
      fields: { key, mode },
    });
  }
}

export function tryWriteString(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    emitStorageChange(key, value);
    return true;
  } catch (error) {
    telemetry.warn('storage.local.write.failed', {
      message: error instanceof Error ? error.message : String(error),
      fields: { key, mode: 'sync' },
    });
    return false;
  }
}

export function writeJson<T>(key: string, value: T, options: StorageWriteOptions = {}): void {
  try {
    writeString(key, JSON.stringify(value), options);
  } catch (error) {
    telemetry.warn('storage.local.json-serialize.failed', {
      message: error instanceof Error ? error.message : String(error),
      fields: { key },
    });
  }
}

export function tryWriteJson<T>(key: string, value: T): boolean {
  try {
    return tryWriteString(key, JSON.stringify(value));
  } catch (error) {
    telemetry.warn('storage.local.json-serialize.failed', {
      message: error instanceof Error ? error.message : String(error),
      fields: { key },
    });
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
    emitStorageChange(key, null);
  } catch (error) {
    telemetry.warn('storage.local.remove.failed', {
      message: error instanceof Error ? error.message : String(error),
      fields: { key },
    });
  }
}

export function flushStorageWrites(): void {
  flushPendingWrites();
}
