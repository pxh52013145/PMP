import { emit } from '@tauri-apps/api/event';
import { readJson, readString, removeKey, writeJson } from '../../modules/storage';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import type { PluginSurfaceSourceKind } from '../../contracts/pluginSurfaceSource';
import { TAURI_EVENTS, broadcastDataUpdate } from '../../utils/windowCommunication';

export type PmpmPluginConfig = Record<string, unknown>;
export type PmpmPluginConfigSyncState = {
  revision: number;
  updatedAt: number | null;
  present: boolean;
};

const CONFIG_PREFIX_BY_SOURCE_KIND: Record<PluginSurfaceSourceKind, string> = {
  pmpm: 'pixel-matrix-pmpm-plugin-config:',
  extv2: 'pixel-matrix-extv2-plugin-config:',
};
const CONFIG_SYNC_STATE_PREFIX_BY_SOURCE_KIND: Record<PluginSurfaceSourceKind, string> = {
  pmpm: 'pixel-matrix-pmpm-plugin-config-sync:',
  extv2: 'pixel-matrix-extv2-plugin-config-sync:',
};
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

export function getPmpmPluginConfigKey(
  pluginId: string,
  sourceKind: PluginSurfaceSourceKind = 'pmpm'
): string {
  return `${CONFIG_PREFIX_BY_SOURCE_KIND[sourceKind]}${pluginId}`;
}

function getPmpmPluginConfigSyncStateKey(
  pluginId: string,
  sourceKind: PluginSurfaceSourceKind = 'pmpm'
): string {
  return `${CONFIG_SYNC_STATE_PREFIX_BY_SOURCE_KIND[sourceKind]}${pluginId}`;
}

export function readPmpmPluginConfig(
  pluginId: string,
  sourceKind: PluginSurfaceSourceKind = 'pmpm'
): PmpmPluginConfig {
  return readJson<PmpmPluginConfig>(getPmpmPluginConfigKey(pluginId, sourceKind), {});
}

export function readPmpmPluginConfigSyncState(
  pluginId: string,
  sourceKind: PluginSurfaceSourceKind = 'pmpm'
): PmpmPluginConfigSyncState {
  const fallbackPresent = readString(getPmpmPluginConfigKey(pluginId, sourceKind)) !== null;
  const fallback: PmpmPluginConfigSyncState = {
    revision: 0,
    updatedAt: null,
    present: fallbackPresent,
  };

  const parsed = readJson<unknown>(getPmpmPluginConfigSyncStateKey(pluginId, sourceKind), fallback);
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

function writePmpmPluginConfigSyncState(
  pluginId: string,
  present: boolean,
  sourceKind: PluginSurfaceSourceKind = 'pmpm'
): PmpmPluginConfigSyncState {
  const previous = readPmpmPluginConfigSyncState(pluginId, sourceKind);
  const next: PmpmPluginConfigSyncState = {
    revision: previous.revision + 1,
    updatedAt: Date.now(),
    present,
  };
  writeJson(getPmpmPluginConfigSyncStateKey(pluginId, sourceKind), next, { mode: 'sync' });
  return next;
}

function ensureCrossWindowSync(
  pluginId: string,
  sourceKind: PluginSurfaceSourceKind = 'pmpm'
): void {
  if (typeof window === 'undefined') return;
  const syncId = `${sourceKind}:${pluginId}`;
  if (syncDisposersByPluginId.has(syncId)) return;

  const key = getPmpmPluginConfigKey(pluginId, sourceKind);

  const onStorage = (e: StorageEvent) => {
    if (e.key !== key) return;
    notify(syncId, readPmpmPluginConfig(pluginId, sourceKind));
  };

  window.addEventListener('storage', onStorage);

  let disposed = false;
  let unlistenTauri: null | (() => void) = null;

  void import('../../utils/windowCommunication')
    .then(({ setupTauriListenerWithPayload }) =>
      setupTauriListenerWithPayload<{ key?: string }>(TAURI_EVENTS.PMPM_PLUGIN_CONFIG_UPDATED, (p) => {
        if (!p?.key || p.key !== key) return;
        notify(syncId, readPmpmPluginConfig(pluginId, sourceKind));
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

  syncDisposersByPluginId.set(syncId, () => {
    disposed = true;
    window.removeEventListener('storage', onStorage);
    try {
      unlistenTauri?.();
    } catch {
      // ignore
    }
  });
}

function teardownCrossWindowSync(
  pluginId: string,
  sourceKind: PluginSurfaceSourceKind = 'pmpm'
): void {
  const syncId = `${sourceKind}:${pluginId}`;
  const dispose = syncDisposersByPluginId.get(syncId);
  if (!dispose) return;
  dispose();
  syncDisposersByPluginId.delete(syncId);
}

export function writePmpmPluginConfig(
  pluginId: string,
  config: PmpmPluginConfig,
  sourceKind: PluginSurfaceSourceKind = 'pmpm'
): void {
  const key = getPmpmPluginConfigKey(pluginId, sourceKind);
  writePmpmPluginConfigSyncState(pluginId, true, sourceKind);
  void broadcastDataUpdate(key, config, TAURI_EVENTS.PMPM_PLUGIN_CONFIG_UPDATED);
  notify(`${sourceKind}:${pluginId}`, config);
}

export function patchPmpmPluginConfig(
  pluginId: string,
  patch: Record<string, unknown>,
  sourceKind: PluginSurfaceSourceKind = 'pmpm'
): PmpmPluginConfig {
  const next = { ...readPmpmPluginConfig(pluginId, sourceKind), ...patch };
  writePmpmPluginConfig(pluginId, next, sourceKind);
  return next;
}

export function clearPmpmPluginConfig(
  pluginId: string,
  sourceKind: PluginSurfaceSourceKind = 'pmpm'
): void {
  const key = getPmpmPluginConfigKey(pluginId, sourceKind);
  writePmpmPluginConfigSyncState(pluginId, false, sourceKind);
  removeKey(key);
  // Fan out to other windows (storage event will cover browsers; Tauri windows also get an event).
  void emit(TAURI_EVENTS.PMPM_PLUGIN_CONFIG_UPDATED, { timestamp: Date.now(), key }).catch(() => {});
  notify(`${sourceKind}:${pluginId}`, {});
}

export function subscribePmpmPluginConfig(
  pluginId: string,
  listener: (config: PmpmPluginConfig) => void,
  sourceKind: PluginSurfaceSourceKind = 'pmpm'
): () => void {
  const syncId = `${sourceKind}:${pluginId}`;
  let listeners = listenersByPluginId.get(syncId);
  if (!listeners) {
    listeners = new Set();
    listenersByPluginId.set(syncId, listeners);
  }

  listeners.add(listener);
  ensureCrossWindowSync(pluginId, sourceKind);

  return () => {
    const current = listenersByPluginId.get(syncId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listenersByPluginId.delete(syncId);
      teardownCrossWindowSync(pluginId, sourceKind);
    }
  };
}
