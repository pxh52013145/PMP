import { readJson } from '../../modules/storage';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { broadcastDataUpdate, setupStorageListener, STORAGE_KEYS } from '../../utils/windowCommunication';
import { recordInstalledExtensionAuditEvent } from './extensionsGovernance';

export type HostExtensionRuntimeKind = 'extv2';

export type HostExtensionRuntimeRestartRequest = {
  kind: HostExtensionRuntimeKind;
  pluginId: string;
  at: number;
  reason?: string;
};

export type HostExtensionRuntimeRestartListener = () => void;

const telemetry = getTelemetryLogger('plugins', 'hostExtensionRuntimeSupervisor');
const listeners = new Set<HostExtensionRuntimeRestartListener>();

let revision = 0;
let syncDisposer: (() => void) | null = null;

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function notifyListeners(): void {
  revision += 1;
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch (error) {
      telemetry.warn('plugin.governance.restart-listener.failed', {
        message: readErrorMessage(error),
      });
    }
  }
}

function ensureSync(): void {
  if (syncDisposer || typeof window === 'undefined') return;

  const disposeStorageSync = setupStorageListener(
    [STORAGE_KEYS.EXTENSIONS_V2_RUNTIME_RESTART_V1],
    () => {
      notifyListeners();
    }
  );

  syncDisposer = () => {
    disposeStorageSync();
    syncDisposer = null;
  };
}

export function getHostExtensionRuntimeRestartRevision(): number {
  return revision;
}

export function subscribeHostExtensionRuntimeRestart(
  listener: HostExtensionRuntimeRestartListener
): () => void {
  listeners.add(listener);
  ensureSync();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      syncDisposer?.();
    }
  };
}

export function readHostExtensionRuntimeRestartRequest(): HostExtensionRuntimeRestartRequest | null {
  const data = readJson<unknown>(STORAGE_KEYS.EXTENSIONS_V2_RUNTIME_RESTART_V1, null);
  if (!isRecord(data)) return null;

  const pluginId = typeof data.pluginId === 'string' ? data.pluginId : null;
  const at = typeof data.at === 'number' && Number.isFinite(data.at) ? data.at : null;
  const reason = typeof data.reason === 'string' ? data.reason : undefined;

  if (!pluginId || !at) return null;
  return { kind: 'extv2', pluginId, at, reason };
}

export function requestHostExtensionRuntimeRestart(
  pluginId: string,
  options: { reason?: string } = {}
): void {
  if (typeof window === 'undefined' || !pluginId) return;

  const now = Date.now();

  telemetry.info('plugin.governance.runtime-restart.requested', {
    fields: {
      kind: 'extv2',
      pluginId,
      reason: options.reason ?? null,
      requestedAtMs: now,
    },
  });

  void broadcastDataUpdate(STORAGE_KEYS.EXTENSIONS_V2_RUNTIME_RESTART_V1, {
    pluginId,
    at: now,
    reason: options.reason,
  });

  try {
    recordInstalledExtensionAuditEvent({
      type: 'runtime-restart',
      pluginId,
      reason: options.reason,
    });
  } catch {
    // ignore
  }

  notifyListeners();
}

export function requestInstalledExtensionRuntimeRestart(
  pluginId: string,
  options: { reason?: string } = {}
): void {
  requestHostExtensionRuntimeRestart(pluginId, options);
}
