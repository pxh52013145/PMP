import { readJson, writeJson } from '../../modules/storage';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

export type PmpmSandboxListener = () => void;

const sandboxListeners = new Set<PmpmSandboxListener>();
let sandboxRevision = 0;
let syncDisposer: (() => void) | null = null;
const telemetry = getTelemetryLogger('pmpm', 'pmpmSandboxConfig');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notifySandboxListeners(): void {
  sandboxRevision += 1;
  for (const listener of Array.from(sandboxListeners)) {
    try {
      listener();
    } catch (error) {
      telemetry.warn('sandbox.listener.failed', {
        message: readErrorMessage(error),
      });
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
  return Boolean(readJson(STORAGE_KEYS.PMPM_SANDBOX_RUNTIME_ENABLED, true));
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
