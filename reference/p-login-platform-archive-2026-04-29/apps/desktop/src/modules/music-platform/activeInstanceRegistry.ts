import { readJson } from '../storage';
import {
  broadcastDataUpdate,
  setupDualListener,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../utils/windowCommunication';
import { listPlatformInstances, subscribePlatformInstances } from './instanceRegistry';
import {
  listPlatformImportedInstanceRecords,
  subscribePlatformImportedInstanceRecords,
} from './platformImportedInstanceRegistry';

export interface MusicPlatformActiveInstanceState {
  currentInstanceId: string | null;
  connectorInstanceIds: Record<string, string>;
}

type MusicPlatformActiveInstanceListener = (
  state: MusicPlatformActiveInstanceState
) => void;

type KnownInstanceMaps = {
  connectorByInstanceId: Map<string, string>;
  validInstanceIds: Set<string>;
};

const DEFAULT_ACTIVE_INSTANCE_STATE: MusicPlatformActiveInstanceState = {
  currentInstanceId: null,
  connectorInstanceIds: {},
};

const activeInstanceListeners = new Set<MusicPlatformActiveInstanceListener>();
let activeInstanceState = cloneActiveInstanceState(DEFAULT_ACTIVE_INSTANCE_STATE);
let activeInstanceRegistryInitialized = false;

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneActiveInstanceState(
  state: MusicPlatformActiveInstanceState
): MusicPlatformActiveInstanceState {
  return {
    currentInstanceId: state.currentInstanceId ?? null,
    connectorInstanceIds: { ...state.connectorInstanceIds },
  };
}

function normalizeConnectorId(value: unknown): string {
  const connectorId = normalizeString(value);
  return connectorId.startsWith('connector.platform.') ? connectorId : '';
}

function createKnownInstanceMaps(): KnownInstanceMaps {
  const connectorByInstanceId = new Map<string, string>();
  const validInstanceIds = new Set<string>();

  for (const instance of listPlatformInstances()) {
    const instanceId = normalizeString(instance.instanceId);
    if (!instanceId) continue;
    validInstanceIds.add(instanceId);
    const connectorId = normalizeConnectorId(instance.metadata?.connectorId);
    if (connectorId) {
      connectorByInstanceId.set(instanceId, connectorId);
    }
  }

  for (const record of listPlatformImportedInstanceRecords()) {
    const instanceId = normalizeString(record.instanceId);
    if (!instanceId) continue;
    validInstanceIds.add(instanceId);
    const connectorId = normalizeConnectorId(record.connectorId);
    if (connectorId) {
      connectorByInstanceId.set(instanceId, connectorId);
    }
  }

  return {
    connectorByInstanceId,
    validInstanceIds,
  };
}

function sanitizeActiveInstanceState(
  value: unknown,
  known = createKnownInstanceMaps()
): MusicPlatformActiveInstanceState {
  if (!isRecord(value)) {
    return cloneActiveInstanceState(DEFAULT_ACTIVE_INSTANCE_STATE);
  }

  const connectorInstanceIds: Record<string, string> = {};
  const rawConnectorInstanceIds = isRecord(value.connectorInstanceIds)
    ? value.connectorInstanceIds
    : {};
  for (const [rawConnectorId, rawInstanceId] of Object.entries(rawConnectorInstanceIds)) {
    const connectorId = normalizeConnectorId(rawConnectorId);
    const instanceId = normalizeString(rawInstanceId);
    if (!connectorId || !instanceId) continue;
    const resolvedConnectorId = known.connectorByInstanceId.get(instanceId);
    if (resolvedConnectorId && resolvedConnectorId !== connectorId) {
      continue;
    }
    if (!known.validInstanceIds.has(instanceId)) {
      continue;
    }
    connectorInstanceIds[connectorId] = instanceId;
  }

  const currentInstanceId = normalizeString(value.currentInstanceId);
  return {
    currentInstanceId:
      currentInstanceId && known.validInstanceIds.has(currentInstanceId)
        ? currentInstanceId
        : null,
    connectorInstanceIds,
  };
}

function serializeActiveInstanceState(state: MusicPlatformActiveInstanceState): string {
  const connectorEntries = Object.entries(state.connectorInstanceIds).sort(([left], [right]) =>
    left.localeCompare(right, 'zh-CN')
  );
  return JSON.stringify({
    currentInstanceId: state.currentInstanceId ?? null,
    connectorInstanceIds: Object.fromEntries(connectorEntries),
  });
}

function emitActiveInstanceStateChanged(): void {
  const snapshot = cloneActiveInstanceState(activeInstanceState);
  for (const listener of activeInstanceListeners) {
    listener(snapshot);
  }
}

function readStoredActiveInstanceState(): MusicPlatformActiveInstanceState {
  if (typeof window === 'undefined') {
    return cloneActiveInstanceState(DEFAULT_ACTIVE_INSTANCE_STATE);
  }
  return sanitizeActiveInstanceState(
    readJson<unknown>(STORAGE_KEYS.MUSIC_PLATFORM_ACTIVE_INSTANCE_V1, DEFAULT_ACTIVE_INSTANCE_STATE)
  );
}

function replaceActiveInstanceState(nextState: MusicPlatformActiveInstanceState): boolean {
  const currentSerialized = serializeActiveInstanceState(activeInstanceState);
  activeInstanceState = cloneActiveInstanceState(nextState);
  return currentSerialized !== serializeActiveInstanceState(activeInstanceState);
}

function saveActiveInstanceState(state: MusicPlatformActiveInstanceState): void {
  void broadcastDataUpdate(
    STORAGE_KEYS.MUSIC_PLATFORM_ACTIVE_INSTANCE_V1,
    cloneActiveInstanceState(state),
    TAURI_EVENTS.MUSIC_PLATFORM_ACTIVE_INSTANCE_UPDATED
  );
}

function reconcileActiveInstanceState(): boolean {
  return replaceActiveInstanceState(sanitizeActiveInstanceState(activeInstanceState));
}

function initializeMusicPlatformActiveInstanceRegistry(): void {
  if (activeInstanceRegistryInitialized) return;
  activeInstanceRegistryInitialized = true;

  replaceActiveInstanceState(readStoredActiveInstanceState());
  if (reconcileActiveInstanceState()) {
    saveActiveInstanceState(activeInstanceState);
    emitActiveInstanceStateChanged();
  }

  subscribePlatformInstances(() => {
    if (!reconcileActiveInstanceState()) {
      return;
    }
    saveActiveInstanceState(activeInstanceState);
    emitActiveInstanceStateChanged();
  });

  void subscribePlatformImportedInstanceRecords(() => {
    if (!reconcileActiveInstanceState()) {
      return;
    }
    saveActiveInstanceState(activeInstanceState);
    emitActiveInstanceStateChanged();
  }).catch(() => {
    // Keep local selection working even if imported-instance sync is unavailable.
  });

  void setupDualListener(
    [STORAGE_KEYS.MUSIC_PLATFORM_ACTIVE_INSTANCE_V1],
    [TAURI_EVENTS.MUSIC_PLATFORM_ACTIVE_INSTANCE_UPDATED],
    () => {
      const currentSerialized = serializeActiveInstanceState(activeInstanceState);
      replaceActiveInstanceState(readStoredActiveInstanceState());
      const reconciled = reconcileActiveInstanceState();
      const nextSerialized = serializeActiveInstanceState(activeInstanceState);
      if (reconciled) {
        saveActiveInstanceState(activeInstanceState);
      }
      if (currentSerialized !== nextSerialized) {
        emitActiveInstanceStateChanged();
      }
    }
  ).catch(() => {
    activeInstanceRegistryInitialized = false;
  });
}

function resolveConnectorIdForInstance(
  instanceId: string,
  connectorId?: string | null
): string | null {
  const normalizedInstanceId = normalizeString(instanceId);
  if (!normalizedInstanceId) {
    return normalizeConnectorId(connectorId) || null;
  }

  const known = createKnownInstanceMaps();
  return (
    known.connectorByInstanceId.get(normalizedInstanceId) ??
    normalizeConnectorId(connectorId) ??
    null
  );
}

export function getMusicPlatformActiveInstanceState(): MusicPlatformActiveInstanceState {
  initializeMusicPlatformActiveInstanceRegistry();
  return cloneActiveInstanceState(activeInstanceState);
}

export function getActiveMusicPlatformInstanceId(options?: {
  connectorId?: string | null;
}): string | null {
  initializeMusicPlatformActiveInstanceRegistry();

  const connectorId = normalizeConnectorId(options?.connectorId);
  if (!connectorId) {
    return activeInstanceState.currentInstanceId ?? null;
  }

  const connectorInstanceId = activeInstanceState.connectorInstanceIds[connectorId] ?? null;
  if (connectorInstanceId) {
    return connectorInstanceId;
  }

  const currentInstanceId = activeInstanceState.currentInstanceId;
  if (!currentInstanceId) {
    return null;
  }

  const known = createKnownInstanceMaps();
  return known.connectorByInstanceId.get(currentInstanceId) === connectorId
    ? currentInstanceId
    : null;
}

export async function setActiveMusicPlatformInstance(input: {
  instanceId?: string | null;
  connectorId?: string | null;
}): Promise<void> {
  initializeMusicPlatformActiveInstanceRegistry();

  const instanceId = normalizeString(input.instanceId);
  if (!instanceId) {
    return;
  }

  const connectorId = resolveConnectorIdForInstance(instanceId, input.connectorId);
  const nextState: MusicPlatformActiveInstanceState = {
    currentInstanceId: instanceId,
    connectorInstanceIds: connectorId
      ? {
          ...activeInstanceState.connectorInstanceIds,
          [connectorId]: instanceId,
        }
      : { ...activeInstanceState.connectorInstanceIds },
  };

  if (!replaceActiveInstanceState(nextState)) {
    return;
  }

  emitActiveInstanceStateChanged();
  await broadcastDataUpdate(
    STORAGE_KEYS.MUSIC_PLATFORM_ACTIVE_INSTANCE_V1,
    cloneActiveInstanceState(activeInstanceState),
    TAURI_EVENTS.MUSIC_PLATFORM_ACTIVE_INSTANCE_UPDATED
  );
}

export function subscribeMusicPlatformActiveInstanceState(
  listener: MusicPlatformActiveInstanceListener
): () => void {
  initializeMusicPlatformActiveInstanceRegistry();
  activeInstanceListeners.add(listener);
  return () => {
    activeInstanceListeners.delete(listener);
  };
}
