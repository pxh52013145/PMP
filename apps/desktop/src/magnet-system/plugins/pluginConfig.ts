import { emit } from '@tauri-apps/api/event';
import { readJson, readString, removeKey, writeJson } from '../../modules/storage';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import type { PluginSurfaceSourceKind } from '../../contracts/pluginSurfaceSource';
import { TAURI_EVENTS, broadcastDataUpdate } from '../../utils/windowCommunication';

export type ExtensionConfig = Record<string, unknown>;
export type ExtensionConfigSyncState = {
  revision: number;
  updatedAt: number | null;
  present: boolean;
};

const CONFIG_PREFIX_BY_SOURCE_KIND: Record<PluginSurfaceSourceKind, string> = {
  extv2: 'pixel-matrix-extv2-plugin-config:',
};
const CONFIG_SYNC_STATE_PREFIX_BY_SOURCE_KIND: Record<PluginSurfaceSourceKind, string> = {
  extv2: 'pixel-matrix-extv2-plugin-config-sync:',
};
const telemetry = getTelemetryLogger('extensions', 'pluginConfig');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const listenersByPluginId = new Map<string, Set<(config: ExtensionConfig) => void>>();
const syncDisposersByPluginId = new Map<string, () => void>();

function notify(pluginId: string, config: ExtensionConfig): void {
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

export function getExtensionConfigKey(
  pluginId: string,
  sourceKind: PluginSurfaceSourceKind = 'extv2'
): string {
  return `${CONFIG_PREFIX_BY_SOURCE_KIND[sourceKind]}${pluginId}`;
}

function getExtensionConfigSyncStateKey(
  pluginId: string,
  sourceKind: PluginSurfaceSourceKind = 'extv2'
): string {
  return `${CONFIG_SYNC_STATE_PREFIX_BY_SOURCE_KIND[sourceKind]}${pluginId}`;
}

export function readExtensionConfig(
  pluginId: string,
  sourceKind: PluginSurfaceSourceKind = 'extv2'
): ExtensionConfig {
  return readJson<ExtensionConfig>(getExtensionConfigKey(pluginId, sourceKind), {});
}

export function readExtensionConfigSyncState(
  pluginId: string,
  sourceKind: PluginSurfaceSourceKind = 'extv2'
): ExtensionConfigSyncState {
  const fallbackPresent = readString(getExtensionConfigKey(pluginId, sourceKind)) !== null;
  const fallback: ExtensionConfigSyncState = {
    revision: 0,
    updatedAt: null,
    present: fallbackPresent,
  };

  const parsed = readJson<unknown>(getExtensionConfigSyncStateKey(pluginId, sourceKind), fallback);
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

function writeExtensionConfigSyncState(
  pluginId: string,
  present: boolean,
  sourceKind: PluginSurfaceSourceKind = 'extv2'
): ExtensionConfigSyncState {
  const previous = readExtensionConfigSyncState(pluginId, sourceKind);
  const next: ExtensionConfigSyncState = {
    revision: previous.revision + 1,
    updatedAt: Date.now(),
    present,
  };
  writeJson(getExtensionConfigSyncStateKey(pluginId, sourceKind), next, { mode: 'sync' });
  return next;
}

function ensureCrossWindowSync(
  pluginId: string,
  sourceKind: PluginSurfaceSourceKind = 'extv2'
): void {
  if (typeof window === 'undefined') return;
  const syncId = `${sourceKind}:${pluginId}`;
  if (syncDisposersByPluginId.has(syncId)) return;

  const key = getExtensionConfigKey(pluginId, sourceKind);

  const onStorage = (e: StorageEvent) => {
    if (e.key !== key) return;
    notify(syncId, readExtensionConfig(pluginId, sourceKind));
  };

  window.addEventListener('storage', onStorage);

  let disposed = false;
  const tauriUnlisteners: Array<() => void> = [];

  void import('../../utils/windowCommunication')
    .then(async ({ setupTauriListenerWithPayload }) => {
      const unlisten = await setupTauriListenerWithPayload<{ key?: string }>(
        TAURI_EVENTS.EXTENSIONS_CONFIG_UPDATED,
        (p) => {
          if (!p?.key || p.key !== key) return;
          notify(syncId, readExtensionConfig(pluginId, sourceKind));
        }
      );

      if (disposed) {
        unlisten();
        return;
      }
      tauriUnlisteners.push(unlisten);
    })
    .catch(() => {
      // ignore (web runtime or tauri listener not available)
    });

  syncDisposersByPluginId.set(syncId, () => {
    disposed = true;
    window.removeEventListener('storage', onStorage);
    for (const unlisten of tauriUnlisteners) {
      try {
        unlisten();
      } catch {
        // ignore
      }
    }
  });
}

function teardownCrossWindowSync(
  pluginId: string,
  sourceKind: PluginSurfaceSourceKind = 'extv2'
): void {
  const syncId = `${sourceKind}:${pluginId}`;
  const dispose = syncDisposersByPluginId.get(syncId);
  if (!dispose) return;
  dispose();
  syncDisposersByPluginId.delete(syncId);
}

export function writeExtensionConfig(
  pluginId: string,
  config: ExtensionConfig,
  sourceKind: PluginSurfaceSourceKind = 'extv2'
): void {
  const key = getExtensionConfigKey(pluginId, sourceKind);
  writeExtensionConfigSyncState(pluginId, true, sourceKind);
  void broadcastDataUpdate(key, config, TAURI_EVENTS.EXTENSIONS_CONFIG_UPDATED);
  notify(`${sourceKind}:${pluginId}`, config);
}

export function patchExtensionConfig(
  pluginId: string,
  patch: Record<string, unknown>,
  sourceKind: PluginSurfaceSourceKind = 'extv2'
): ExtensionConfig {
  const next = { ...readExtensionConfig(pluginId, sourceKind), ...patch };
  writeExtensionConfig(pluginId, next, sourceKind);
  return next;
}

export function clearExtensionConfig(
  pluginId: string,
  sourceKind: PluginSurfaceSourceKind = 'extv2'
): void {
  const key = getExtensionConfigKey(pluginId, sourceKind);
  writeExtensionConfigSyncState(pluginId, false, sourceKind);
  removeKey(key);
  // Fan out to other windows (storage event will cover browsers; Tauri windows also get an event).
  void emit(TAURI_EVENTS.EXTENSIONS_CONFIG_UPDATED, { timestamp: Date.now(), key }).catch(() => {});
  notify(`${sourceKind}:${pluginId}`, {});
}

export function subscribeExtensionConfig(
  pluginId: string,
  listener: (config: ExtensionConfig) => void,
  sourceKind: PluginSurfaceSourceKind = 'extv2'
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
