import { emit } from '@tauri-apps/api/event';
import { readJson, readString, removeKey, writeJson } from '../../modules/storage';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { TAURI_EVENTS, broadcastDataUpdate } from '../../utils/windowCommunication';

export type PmpmPluginConfig = Record<string, unknown>;
export type PmpmPluginConfigSyncState = {
  revision: number;
  updatedAt: number | null;
  present: boolean;
};

const CONFIG_PREFIX = 'pixel-matrix-pmpm-plugin-config:';
const CONFIG_SYNC_STATE_PREFIX = 'pixel-matrix-pmpm-plugin-config-sync:';
const telemetry = getTelemetryLogger('pmpm', 'pluginConfig');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const listenersByPluginId = new Map<string, Set<(config: PmpmPluginConfig) => void>>();
const syncDisposersByPluginId = new Map<string, () => void>();

function notify(pluginId: string, config: PmpmPluginConfig): void {
  const listeners = listenersByPluginId.get(pluginId);
  if (!listeners || listeners.size === 0) return;

  for (const listener of Array.from(listeners)) {
    try {
      listener(config);
    } catch (error) {
      telemetry.warn('plugin_config.listener.failed', {
        message: readErrorMessage(error),
        fields: {
          pluginId,
        },
      });
    }
  }
}

export function getPmpmPluginConfigKey(pluginId: string): string {
  return `${CONFIG_PREFIX}${pluginId}`;
}

function getPmpmPluginConfigSyncStateKey(pluginId: string): string {
  return `${CONFIG_SYNC_STATE_PREFIX}${pluginId}`;
}

export function readPmpmPluginConfig(pluginId: string): PmpmPluginConfig {
  return readJson<PmpmPluginConfig>(getPmpmPluginConfigKey(pluginId), {});
}

export function readPmpmPluginConfigSyncState(pluginId: string): PmpmPluginConfigSyncState {
  const fallbackPresent = readString(getPmpmPluginConfigKey(pluginId)) !== null;
  const fallback: PmpmPluginConfigSyncState = {
    revision: 0,
    updatedAt: null,
    present: fallbackPresent,
  };

  const parsed = readJson<unknown>(getPmpmPluginConfigSyncStateKey(pluginId), fallback);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fallback;
  }

  const record = parsed as Record<string, unknown>;
  const revision =
    typeof record.revision === 'number' && Number.isFinite(record.revision) && record.revision >= 0
      ? Math.floor(record.revision)
      : fallback.revision;
  const updatedAt =
    typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
      ? Math.floor(record.updatedAt)
      : fallback.updatedAt;
  const present = typeof record.present === 'boolean' ? record.present : fallback.present;

  return {
    revision,
    updatedAt,
    present,
  };
}

function writePmpmPluginConfigSyncState(pluginId: string, present: boolean): PmpmPluginConfigSyncState {
  const previous = readPmpmPluginConfigSyncState(pluginId);
  const next: PmpmPluginConfigSyncState = {
    revision: previous.revision + 1,
    updatedAt: Date.now(),
    present,
  };
  writeJson(getPmpmPluginConfigSyncStateKey(pluginId), next, { mode: 'sync' });
  return next;
}

function ensureCrossWindowSync(pluginId: string): void {
  if (typeof window === 'undefined') return;
  if (syncDisposersByPluginId.has(pluginId)) return;

  const key = getPmpmPluginConfigKey(pluginId);

  const onStorage = (e: StorageEvent) => {
    if (e.key !== key) return;
    notify(pluginId, readPmpmPluginConfig(pluginId));
  };

  window.addEventListener('storage', onStorage);

  let disposed = false;
  let unlistenTauri: null | (() => void) = null;

  void import('../../utils/windowCommunication')
    .then(({ setupTauriListenerWithPayload }) =>
      setupTauriListenerWithPayload<{ key?: string }>(TAURI_EVENTS.PMPM_PLUGIN_CONFIG_UPDATED, (p) => {
        if (!p?.key || p.key !== key) return;
        notify(pluginId, readPmpmPluginConfig(pluginId));
      })
    )
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenTauri = unlisten;
    })
    .catch(() => {
      // ignore (web runtime or tauri listener not available)
    });

  syncDisposersByPluginId.set(pluginId, () => {
    disposed = true;
    window.removeEventListener('storage', onStorage);
    try {
      unlistenTauri?.();
    } catch {
      // ignore
    }
  });
}

function teardownCrossWindowSync(pluginId: string): void {
  const dispose = syncDisposersByPluginId.get(pluginId);
  if (!dispose) return;
  dispose();
  syncDisposersByPluginId.delete(pluginId);
}

export function writePmpmPluginConfig(pluginId: string, config: PmpmPluginConfig): void {
  const key = getPmpmPluginConfigKey(pluginId);
  writePmpmPluginConfigSyncState(pluginId, true);
  void broadcastDataUpdate(key, config, TAURI_EVENTS.PMPM_PLUGIN_CONFIG_UPDATED);
  notify(pluginId, config);
}

export function patchPmpmPluginConfig(
  pluginId: string,
  patch: Record<string, unknown>
): PmpmPluginConfig {
  const next = { ...readPmpmPluginConfig(pluginId), ...patch };
  writePmpmPluginConfig(pluginId, next);
  return next;
}

export function clearPmpmPluginConfig(pluginId: string): void {
  const key = getPmpmPluginConfigKey(pluginId);
  writePmpmPluginConfigSyncState(pluginId, false);
  removeKey(key);
  // Fan out to other windows (storage event will cover browsers; Tauri windows also get an event).
  void emit(TAURI_EVENTS.PMPM_PLUGIN_CONFIG_UPDATED, { timestamp: Date.now(), key }).catch(() => {});
  notify(pluginId, {});
}

export function subscribePmpmPluginConfig(
  pluginId: string,
  listener: (config: PmpmPluginConfig) => void
): () => void {
  let listeners = listenersByPluginId.get(pluginId);
  if (!listeners) {
    listeners = new Set();
    listenersByPluginId.set(pluginId, listeners);
  }

  listeners.add(listener);
  ensureCrossWindowSync(pluginId);

  return () => {
    const current = listenersByPluginId.get(pluginId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listenersByPluginId.delete(pluginId);
      teardownCrossWindowSync(pluginId);
    }
  };
}
