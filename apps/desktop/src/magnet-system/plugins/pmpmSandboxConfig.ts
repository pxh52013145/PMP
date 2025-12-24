import { readJson, writeJson } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

export type PmpmSandboxListener = () => void;

const sandboxListeners = new Set<PmpmSandboxListener>();
let sandboxRevision = 0;
let syncDisposer: (() => void) | null = null;

function notifySandboxListeners(): void {
  sandboxRevision += 1;
  for (const listener of Array.from(sandboxListeners)) {
    try {
      listener();
    } catch (error) {
      console.warn('[pmpm-sandbox] listener failed', error);
    }
  }
}

function ensureSandboxSync(): void {
  if (syncDisposer) return;

  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return;
    if (event.key !== STORAGE_KEYS.PMPM_SANDBOX_RUNTIME_ENABLED) return;
    notifySandboxListeners();
  };

  window.addEventListener('storage', onStorage);
  syncDisposer = () => {
    window.removeEventListener('storage', onStorage);
    syncDisposer = null;
  };
}

export function getPmpmSandboxRuntimeEnabled(): boolean {
  return Boolean(readJson(STORAGE_KEYS.PMPM_SANDBOX_RUNTIME_ENABLED, false));
}

export function setPmpmSandboxRuntimeEnabled(enabled: boolean): void {
  writeJson(STORAGE_KEYS.PMPM_SANDBOX_RUNTIME_ENABLED, Boolean(enabled));
  notifySandboxListeners();
}

export function getPmpmSandboxRevision(): number {
  return sandboxRevision;
}

export function subscribePmpmSandbox(listener: PmpmSandboxListener): () => void {
  sandboxListeners.add(listener);
  ensureSandboxSync();
  return () => {
    sandboxListeners.delete(listener);
    if (sandboxListeners.size === 0) {
      syncDisposer?.();
    }
  };
}

