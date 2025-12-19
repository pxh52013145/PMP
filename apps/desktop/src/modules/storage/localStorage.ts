export type StorageWriteMode = 'sync' | 'idle' | 'debounce';

export interface StorageWriteOptions {
  mode?: StorageWriteMode;
  debounceMs?: number;
}

const pendingWrites = new Map<string, string>();
let flushTimeout: number | null = null;
let idleHandle: number | null = null;

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
      console.warn(`[storage] Failed to flush key "${key}"`, error);
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
    console.warn(`[storage] Failed to read key "${key}"`, error);
    return null;
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`[storage] Failed to parse JSON for key "${key}"`, error);
    return fallback;
  }
}

export function writeString(key: string, value: string, options: StorageWriteOptions = {}): void {
  const mode = options.mode ?? 'sync';
  const debounceMs = options.debounceMs ?? 200;

  try {
    if (mode === 'sync') {
      localStorage.setItem(key, value);
      return;
    }

    pendingWrites.set(key, value);
    scheduleFlush(mode, debounceMs);
  } catch (error) {
    console.warn(`[storage] Failed to write key "${key}"`, error);
  }
}

export function tryWriteString(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`[storage] Failed to write key "${key}"`, error);
    return false;
  }
}

export function writeJson<T>(key: string, value: T, options: StorageWriteOptions = {}): void {
  try {
    writeString(key, JSON.stringify(value), options);
  } catch (error) {
    console.warn(`[storage] Failed to serialize JSON for key "${key}"`, error);
  }
}

export function tryWriteJson<T>(key: string, value: T): boolean {
  try {
    return tryWriteString(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[storage] Failed to serialize JSON for key "${key}"`, error);
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn(`[storage] Failed to remove key "${key}"`, error);
  }
}

export function flushStorageWrites(): void {
  flushPendingWrites();
}
