import { readJson } from '../../modules/storage';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { broadcastDataUpdate, setupStorageListener, STORAGE_KEYS } from '../../utils/windowCommunication';
import { recordPmpmAuditEvent } from './pmpmGovernance';
import { clearPmpmPluginRuntimeCache } from './pmpmRuntime';

export type PmpmRuntimeRestartRequest = {
  pluginId: string;
  at: number;
  reason?: string;
};

export type PmpmRuntimeRestartListener = () => void;

const listeners = new Set<PmpmRuntimeRestartListener>();
let revision = 0;
let syncDisposer: (() => void) | null = null;
const telemetry = getTelemetryLogger('pmpm', 'pmpmRuntimeSupervisor');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notifyListeners(): void {
  revision += 1;
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch (error) {
      telemetry.warn('runtime_restart.listener.failed', {
        message: readErrorMessage(error),
      });
    }
  }
}

function ensureSync(): void {
  if (syncDisposer) return;
  if (typeof window === 'undefined') return;

  syncDisposer = setupStorageListener([STORAGE_KEYS.PMPM_RUNTIME_RESTART_V1], () => {
    notifyListeners();
  });
}

export function getPmpmRuntimeRestartRevision(): number {
  return revision;
}

export function subscribePmpmRuntimeRestart(listener: PmpmRuntimeRestartListener): () => void {
  listeners.add(listener);
  ensureSync();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      syncDisposer?.();
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function readPmpmRuntimeRestartRequest(): PmpmRuntimeRestartRequest | null {
  const data = readJson<unknown>(STORAGE_KEYS.PMPM_RUNTIME_RESTART_V1, null);
  if (!isRecord(data)) return null;

  const pluginId = typeof data.pluginId === 'string' ? data.pluginId : null;
  const at = typeof data.at === 'number' && Number.isFinite(data.at) ? data.at : null;
  const reason = typeof data.reason === 'string' ? data.reason : undefined;

  if (!pluginId || !at) return null;
  return { pluginId, at, reason };
}

export function requestPmpmPluginRuntimeRestart(
  pluginId: string,
  options: { reason?: string } = {}
): void {
  if (typeof window === 'undefined') return;
  if (!pluginId) return;

  const now = Date.now();

  clearPmpmPluginRuntimeCache(pluginId);

  void broadcastDataUpdate(STORAGE_KEYS.PMPM_RUNTIME_RESTART_V1, {
    pluginId,
    at: now,
    reason: options.reason,
  });

  try {
    recordPmpmAuditEvent({ type: 'runtime-restart', pluginId, reason: options.reason });
  } catch {
    // ignore
  }

  notifyListeners();
}
