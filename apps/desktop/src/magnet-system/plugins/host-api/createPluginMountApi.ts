import { APP_VERSION, HOST_API_VERSION } from '../../../constants/versions';
import type { NavigationPageType, NavigationParamsFor } from '../../../contracts/navigation';
import { parseNavigationParams } from '../../../contracts/navigationParams';
import type { PluginSurfaceSourceKind } from '../../../contracts/pluginSurfaceSource';
import type { PlayMode, Track } from '../../../services/audio';
import type { AudioSpectrumTap } from '../../../services/audio/types';
import { musicLibraryService } from '../../../services/audio/MusicLibraryService';
import type { CommandsService } from '../../../services/commands';
import { flushStorageWrites } from '../../../modules/storage';
import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../../../services/telemetry/tauriInvokeTelemetry';
import { getDynamicColorsForImageUrl } from '../../../utils/dynamicColors';
import { closePluginWindow, openPluginWindow } from '../../../utils/pluginWindows';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import { broadcastSignal, TAURI_EVENTS } from '../../../utils/windowCommunication';
import {
  patchPmpmPluginConfig,
  readPmpmPluginConfig,
  subscribePmpmPluginConfig,
  clearPmpmPluginConfig,
  writePmpmPluginConfig,
  type PmpmPluginConfig,
} from '../pluginConfig';
import { recordPmpmPermissionDenied } from '../pmpmGovernance';
import type { KeybindingsService } from '../../../services/keybindings';
import {
  getPluginHostCapability,
  invokePluginHostCapability,
  listPluginHostCapabilities,
} from './capabilities';
import { hasPermission, PLUGIN_PERMISSIONS } from './permissions';
import type {
  HostAudioService,
  HostNavigation,
  PluginCoverSnapshot,
  PluginHostAudioInputAdapterBridge,
  PluginHostSessionOpenResult,
  PluginHostStreamDataEnvelope,
  PluginHostStreamEndEnvelope,
  PluginHostStreamHandle,
  PluginHostTrayApi,
  PluginMountApi,
  PluginNavigationSnapshot,
} from './types';

type PageWithoutParams = {
  [K in NavigationPageType]: NavigationParamsFor<K> extends undefined ? K : never;
}[NavigationPageType];

type PageWithParams = Exclude<NavigationPageType, PageWithoutParams>;

const PAGES_REQUIRING_PARAMS = new Set<NavigationPageType>([
  'track',
  'album',
  'artist',
  'plugin-page',
  'plugin-visualizer',
]);

const PLAY_MODES = new Set<string>(['sequence', 'loop', 'single-loop', 'shuffle']);
const HOST_CAPABILITY_INVOKE_TIMEOUT_MS = 6000;
const HOST_CAPABILITY_PAYLOAD_MAX_BYTES = 256 * 1024;
const HOST_STREAM_INTERVAL_MIN_MS = 16;
const HOST_STREAM_INTERVAL_MAX_MS = 2_000;
const telemetry = getTelemetryLogger('pmpm-host-api', 'createPluginMountApi');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function asJsonSerializedSize(value: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('Capability payload must be JSON-serializable');
  }
  if (typeof serialized !== 'string') return 0;
  return new TextEncoder().encode(serialized).byteLength;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = globalThis.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== null) {
      globalThis.clearTimeout(timeoutHandle);
    }
  }
}

function normalizeHostSessionOpenResult(value: unknown): PluginHostSessionOpenResult {
  const payload = asObject(value);
  const sessionId = asNonEmptyString(payload?.sessionId);
  if (!sessionId) {
    throw new Error('Host session open result must include sessionId');
  }

  const providerSessionId = asNonEmptyString(payload?.providerSessionId) ?? undefined;

  let metadata: unknown = undefined;
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'metadata')) {
    metadata = payload.metadata;
  } else if (payload) {
    const rest = { ...payload };
    delete rest.sessionId;
    delete rest.providerSessionId;
    metadata = Object.keys(rest).length > 0 ? rest : undefined;
  }

  return {
    sessionId,
    providerSessionId,
    metadata,
  };
}

function normalizeHostStreamIntervalMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 33;
  }

  return Math.max(
    HOST_STREAM_INTERVAL_MIN_MS,
    Math.min(HOST_STREAM_INTERVAL_MAX_MS, Math.floor(value))
  );
}

function normalizeSpectrumTap(value: unknown): AudioSpectrumTap {
  return value === 'pre-dsp' ? 'pre-dsp' : 'post-dsp';
}

function safeQueueLength(audioService: HostAudioService): number {
  const getQueue = audioService.getQueue;
  if (typeof getQueue !== 'function') return 0;

  try {
    const queue = getQueue.call(audioService);
    return Array.isArray(queue) ? queue.length : 0;
  } catch {
    return 0;
  }
}

type MainWindowHandle = {
  label: string;
  isVisible: () => Promise<boolean>;
  show: () => Promise<void>;
  hide: () => Promise<void>;
  setFocus: () => Promise<void>;
};

async function resolveMainWindowHandle(): Promise<MainWindowHandle | null> {
  if (!isTauriRuntime()) return null;

  const { getAll } = await import('@tauri-apps/api/window');
  return (getAll().find((window) => window.label === 'main') as MainWindowHandle | undefined) ?? null;
}

async function readMainWindowVisibleState(): Promise<boolean | null> {
  const mainWindow = await resolveMainWindowHandle();
  if (!mainWindow) return null;

  try {
    return await mainWindow.isVisible();
  } catch {
    return null;
  }
}

export function createPluginMountApi({
  pluginId,
  hostLabel,
  sourceKind = 'pmpm',
  permissions,
  audioService,
  navigation,
  keybindings,
  commands,
  trayApi: trayApiOverride,
}: {
  pluginId: string;
  hostLabel: string;
  sourceKind?: PluginSurfaceSourceKind;
  permissions: Set<string>;
  audioService: HostAudioService;
  navigation: HostNavigation;
  keybindings?: KeybindingsService | null;
  commands?: CommandsService | null;
  trayApi?: PluginHostTrayApi | null;
}): PluginMountApi {
  const allowHost = hasPermission(permissions, PLUGIN_PERMISSIONS.host);
  const allowAudioState = hasPermission(permissions, PLUGIN_PERMISSIONS.audioState);
  const allowAudioControl = hasPermission(permissions, PLUGIN_PERMISSIONS.audioControl);
  const allowAudioVisual = hasPermission(permissions, PLUGIN_PERMISSIONS.audioVisual);
  const allowAudioCover = hasPermission(permissions, PLUGIN_PERMISSIONS.audioCover);
  const allowNavigation = hasPermission(permissions, PLUGIN_PERMISSIONS.navigation);
  const allowPluginConfig = hasPermission(permissions, PLUGIN_PERMISSIONS.configLocal);
  const allowWindows = hasPermission(permissions, PLUGIN_PERMISSIONS.window);

  const warnApiIssue = (
    event: string,
    message: string,
    fields: Record<string, unknown> | null = null
  ) => {
    telemetry.warn(event, {
      message,
      fields: {
        pluginId,
        hostLabel,
        ...(fields ?? {}),
      },
    });
  };

  const warnDenied = (capability: string, action: string) => {
    warnApiIssue(
      'plugin.permission.denied',
      `[${hostLabel}] Permission denied (${capability}): ${pluginId} -> ${action}`,
      {
        capability,
        action,
      }
    );
    try {
      recordPmpmPermissionDenied({ pluginId, hostLabel, capability, action });
    } catch {
      // ignore
    }
  };

  const aiControlBridge = {
    searchTracks: async (query: string, limit: number): Promise<Track[]> => {
      const normalizedQuery = typeof query === 'string' ? query.trim() : '';
      if (!normalizedQuery) return [];

      const safeLimit =
        typeof limit === 'number' && Number.isFinite(limit)
          ? Math.max(1, Math.min(200, Math.floor(limit)))
          : 25;

      return await musicLibraryService.searchTracks(normalizedQuery, safeLimit);
    },
    enqueueTracks: (
      tracks: Track[],
      options?: { replaceQueue?: boolean }
    ): { previousQueueSize: number; nextQueueSize: number } => {
      const normalizedTracks = Array.isArray(tracks) ? tracks.filter((track) => Boolean(track)) : [];
      const previousQueueSize = safeQueueLength(audioService);

      if (options?.replaceQueue) {
        audioService.clearQueue?.();
      }

      if (normalizedTracks.length > 0) {
        if (typeof audioService.addMultipleToQueue === 'function') {
          audioService.addMultipleToQueue(normalizedTracks);
        } else if (typeof audioService.addToQueue === 'function') {
          for (const track of normalizedTracks) {
            audioService.addToQueue(track);
          }
        } else {
          throw new Error('Host audio service does not support queue mutation');
        }
      }

      const fallbackNext = (options?.replaceQueue ? 0 : previousQueueSize) + normalizedTracks.length;
      const nextQueueSize = Math.max(fallbackNext, safeQueueLength(audioService));

      return {
        previousQueueSize,
        nextQueueSize,
      };
    },
    playQueueIndex: async (index: number): Promise<void> => {
      if (typeof audioService.playTrackAtIndex !== 'function') {
        throw new Error('Host audio service does not support queue playback by index');
      }

      const safeIndex =
        typeof index === 'number' && Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;

      await audioService.playTrackAtIndex(safeIndex);
    },
  };

  const audioInputAdapterBridge: PluginHostAudioInputAdapterBridge | undefined =
    typeof audioService.listAudioInputs === 'function'
      ? {
          listInputs: async () => {
            try {
              const ids = await Promise.resolve(audioService.listAudioInputs?.());
              if (!Array.isArray(ids)) return [];
              return ids
                .map((id) => (typeof id === 'string' ? id.trim() : ''))
                .filter((id) => id.length > 0);
            } catch {
              return [];
            }
          },
          selectInput:
            typeof audioService.selectAudioInput === 'function'
              ? async (inputId: string | null) => {
                  return await Promise.resolve(audioService.selectAudioInput?.(inputId));
                }
              : undefined,
        }
      : undefined;

  let coverCache: { key: string; value: PluginCoverSnapshot | null } | null = null;
  let coverInflight: { key: string; promise: Promise<PluginCoverSnapshot | null> } | null = null;
  let hostStreamCounter = 0;

  const getCover = async (): Promise<PluginCoverSnapshot | null> => {
    if (!allowAudioCover) {
      warnDenied('api:audio-cover', 'audio.getCover()');
      return null;
    }

    const track = resolveCurrentTrack(audioService.getState());
    if (!track) return null;

    const cacheKey = buildTrackKey(track);
    if (!cacheKey) return null;

    if (coverCache?.key === cacheKey) {
      return coverCache.value;
    }
    if (coverInflight?.key === cacheKey) {
      return await coverInflight.promise;
    }

    const promise = (async (): Promise<PluginCoverSnapshot | null> => {
      const coverUrl = await resolveCoverDataUrl(track);
      if (!coverUrl) return null;

      const colors = await getDynamicColorsForImageUrl(coverUrl, cacheKey);
      return { url: coverUrl, colors };
    })();

    coverInflight = { key: cacheKey, promise };

    try {
      const value = await promise;
      coverCache = { key: cacheKey, value };
      return value;
    } finally {
      if (coverInflight?.key === cacheKey) {
        coverInflight = null;
      }
    }
  };

  const windowApi = {
    open: async (windowId: string, options?: { title?: string; width?: number; height?: number; x?: number; y?: number }) => {
      if (!allowWindows) {
        warnDenied('api:window', `window.open(${windowId})`);
        return;
      }
      if (typeof windowId !== 'string' || !/^[a-z0-9-]{1,48}$/.test(windowId)) {
        warnApiIssue(
          'window.invalid_id',
          `[${hostLabel}] Invalid windowId "${String(windowId)}" (plugin=${pluginId})`,
          { windowId: String(windowId) }
        );
        return;
      }

      await openPluginWindow({
        sourceKind,
        pluginId,
        windowId,
        title: options?.title,
        width: options?.width,
        height: options?.height,
        x: options?.x,
        y: options?.y,
      });
    },
    close: async (windowId: string) => {
      if (!allowWindows) {
        warnDenied('api:window', `window.close(${windowId})`);
        return;
      }
      if (typeof windowId !== 'string' || !/^[a-z0-9-]{1,48}$/.test(windowId)) {
        warnApiIssue(
          'window.invalid_id',
          `[${hostLabel}] Invalid windowId "${String(windowId)}" (plugin=${pluginId})`,
          { windowId: String(windowId) }
        );
        return;
      }
      await closePluginWindow(pluginId, windowId, sourceKind);
    },
  };

  const trayApi: PluginHostTrayApi =
    trayApiOverride ?? {
      supported: isTauriRuntime(),
      getMainWindowVisible: async () => {
        return await readMainWindowVisibleState();
      },
      activateItem: async (itemId: string) => {
        if (!isTauriRuntime()) {
          throw new Error('System tray is not available');
        }

        const normalizedItemId = typeof itemId === 'string' ? itemId.trim() : '';
        if (!normalizedItemId) {
          throw new Error('Tray item id is required');
        }

        if (normalizedItemId === 'quit') {
          flushStorageWrites();
          await invokeWithTelemetry('app_request_exit', undefined, {
            moduleId: 'windowing',
            component: 'trayApi',
            event: 'window.main.request-exit',
            successLevel: 'info',
          });
          return;
        }

        const mainWindow = await resolveMainWindowHandle();
        if (!mainWindow) {
          throw new Error('Main window not found');
        }

        if (normalizedItemId === 'show') {
          await mainWindow.show();
          await mainWindow.setFocus().catch(() => {});
          await broadcastSignal(TAURI_EVENTS.MAIN_WINDOW_SHOWN);
          return;
        }

        if (normalizedItemId === 'hide') {
          flushStorageWrites();
          await mainWindow.hide();
          await broadcastSignal(TAURI_EVENTS.MAIN_WINDOW_HIDDEN);
          return;
        }

        if (normalizedItemId === 'toggle-main-window') {
          const visible = await mainWindow.isVisible().catch(() => false);
          if (visible) {
            flushStorageWrites();
            await mainWindow.hide();
            await broadcastSignal(TAURI_EVENTS.MAIN_WINDOW_HIDDEN);
            return;
          }

          await mainWindow.show();
          await mainWindow.setFocus().catch(() => {});
          await broadcastSignal(TAURI_EVENTS.MAIN_WINDOW_SHOWN);
          return;
        }

        throw new Error(`Unknown tray item: ${normalizedItemId}`);
      },
    };

  const getNavigationSnapshot = (): PluginNavigationSnapshot | null => {
    if (!allowNavigation) {
      warnDenied('api:navigation', 'navigation.getSnapshot()');
      return null;
    }

    const getSnapshot = navigation.getSnapshot;
    if (typeof getSnapshot !== 'function') return null;

    try {
      const snap = getSnapshot();
      return snap && typeof snap === 'object'
        ? snap
        : null;
    } catch (error) {
      warnApiIssue(
        'navigation.snapshot_failed',
        `[${hostLabel}] navigation.getSnapshot() failed (plugin=${pluginId})`,
        { errorMessage: readErrorMessage(error) }
      );
      return null;
    }
  };

  const configApi = {
    get: () => {
      if (!allowPluginConfig) {
        warnDenied('storage:local', 'config.get()');
        return {};
      }
      return readPmpmPluginConfig(pluginId, sourceKind);
    },
    set: (next: Record<string, unknown>) => {
      if (!allowPluginConfig) {
        warnDenied('storage:local', 'config.set(next)');
        return;
      }
      writePmpmPluginConfig(pluginId, next as PmpmPluginConfig, sourceKind);
    },
    patch: (next: Record<string, unknown>) => {
      if (!allowPluginConfig) {
        warnDenied('storage:local', 'config.patch(next)');
        return;
      }
      patchPmpmPluginConfig(pluginId, next, sourceKind);
    },
    reset: () => {
      if (!allowPluginConfig) {
        warnDenied('storage:local', 'config.reset()');
        return;
      }
      clearPmpmPluginConfig(pluginId, sourceKind);
    },
    onChange: (cb: (config: Record<string, unknown>) => void) => {
      if (!allowPluginConfig) {
        warnDenied('storage:local', 'config.onChange(cb)');
        return () => {};
      }
      if (typeof cb !== 'function') {
        warnApiIssue(
          'config.on_change.invalid_callback',
          `[${hostLabel}] Invalid config.onChange callback (plugin=${pluginId})`
        );
        return () => {};
      }
      return subscribePmpmPluginConfig(pluginId, cb, sourceKind);
    },
  };

  const buildHostCapabilityContext = () => ({
    pluginId,
    hostLabel,
    permissions,
    aiControl: aiControlBridge,
    audioInputAdapter: audioInputAdapterBridge,
    audioService,
    commands: commands ?? undefined,
    getCover,
    keybindings: keybindings ?? undefined,
    navigation,
    configApi,
    sourceKind,
    trayApi,
    windowApi,
  });

  const invokeHostCapabilityInternal = async (
    capabilityId: string,
    method: string,
    payload?: unknown
  ): Promise<unknown> => {
    if (!allowHost) {
      warnDenied('api:host', `host.invokeCapability(${String(capabilityId)}, ${String(method)})`);
      return null;
    }

    const normalizedCapabilityId =
      typeof capabilityId === 'string' ? capabilityId.trim() : '';
    const normalizedMethod = typeof method === 'string' ? method.trim() : '';

    if (!normalizedCapabilityId || !normalizedMethod) {
      throw new Error('host.invokeCapability requires capabilityId and method');
    }

    if (!/^[a-z][a-z0-9_.-]{0,63}$/i.test(normalizedMethod)) {
      throw new Error(`Invalid host capability method: ${normalizedMethod}`);
    }

    const payloadSize = asJsonSerializedSize(payload);
    if (payloadSize > HOST_CAPABILITY_PAYLOAD_MAX_BYTES) {
      throw new Error(
        `Capability payload too large (${payloadSize} bytes > ${HOST_CAPABILITY_PAYLOAD_MAX_BYTES})`
      );
    }

    const capability = getPluginHostCapability(normalizedCapabilityId);
    if (!capability) {
      throw new Error(`Unknown host capability: ${normalizedCapabilityId}`);
    }

    if (capability.permission && !hasPermission(permissions, capability.permission)) {
      warnDenied(
        capability.permission,
        `host.invokeCapability(${normalizedCapabilityId}, ${normalizedMethod})`
      );
      throw new Error(`Permission denied: ${capability.permission}`);
    }

    if (!hasPermission(permissions, PLUGIN_PERMISSIONS.hostCapabilityInvoke)) {
      warnDenied(
        PLUGIN_PERMISSIONS.hostCapabilityInvoke,
        `host.invokeCapability(${normalizedCapabilityId}, ${normalizedMethod})`
      );
      throw new Error(`Permission denied: ${PLUGIN_PERMISSIONS.hostCapabilityInvoke}`);
    }

    return await withTimeout(
      invokePluginHostCapability(normalizedCapabilityId, {
        method: normalizedMethod,
        payload,
        context: buildHostCapabilityContext(),
      }),
      HOST_CAPABILITY_INVOKE_TIMEOUT_MS,
      `Host capability invocation timed out: ${normalizedCapabilityId}.${normalizedMethod}`
    );
  };

  const openHostSessionInternal = async (
    capabilityId: string,
    method: string,
    payload?: unknown
  ): Promise<PluginHostSessionOpenResult | null> => {
    const response = await invokeHostCapabilityInternal(capabilityId, method, payload);
    if (response === null) return null;

    const result = asObject(response);
    if (!result || result.ok !== true) {
      const errorPayload = asObject(result?.error);
      const message = asNonEmptyString(errorPayload?.message) ?? 'Host session open failed';
      throw new Error(message);
    }

    return normalizeHostSessionOpenResult(result.data);
  };

  const closeHostSessionInternal = async (
    capabilityId: string,
    sessionId: string,
    reason?: string
  ): Promise<void> => {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
      throw new Error('host.closeSession requires sessionId');
    }

    const payload =
      typeof reason === 'string' && reason.trim().length > 0
        ? { sessionId: normalizedSessionId, reason: reason.trim() }
        : { sessionId: normalizedSessionId };

    const response = await invokeHostCapabilityInternal(capabilityId, 'closeSession', payload);
    if (response === null) return;

    const result = asObject(response);
    if (!result || result.ok !== true) {
      const errorPayload = asObject(result?.error);
      const message = asNonEmptyString(errorPayload?.message) ?? 'Host session close failed';
      throw new Error(message);
    }
  };

  const openHostStreamInternal = async (
    capabilityId: string,
    method: string,
    payload?: unknown
  ): Promise<PluginHostStreamHandle | null> => {
    const normalizedCapabilityId = typeof capabilityId === 'string' ? capabilityId.trim() : '';
    const normalizedMethod = typeof method === 'string' ? method.trim() : '';

    if (!normalizedCapabilityId || !normalizedMethod) {
      throw new Error('host.openStream requires capabilityId and method');
    }

    if (!/^[a-z][a-z0-9_.-]{0,63}$/i.test(normalizedMethod)) {
      throw new Error(`Invalid host stream method: ${normalizedMethod}`);
    }

    const payloadSize = asJsonSerializedSize(payload);
    if (payloadSize > HOST_CAPABILITY_PAYLOAD_MAX_BYTES) {
      throw new Error(
        `Capability payload too large (${payloadSize} bytes > ${HOST_CAPABILITY_PAYLOAD_MAX_BYTES})`
      );
    }

    const capability = getPluginHostCapability(normalizedCapabilityId);
    if (!capability) {
      throw new Error(`Unknown host capability: ${normalizedCapabilityId}`);
    }

    if (capability.permission && !hasPermission(permissions, capability.permission)) {
      warnDenied(
        capability.permission,
        `host.openStream(${normalizedCapabilityId}, ${normalizedMethod})`
      );
      throw new Error(`Permission denied: ${capability.permission}`);
    }

    if (!hasPermission(permissions, PLUGIN_PERMISSIONS.hostCapabilityInvoke)) {
      warnDenied(
        PLUGIN_PERMISSIONS.hostCapabilityInvoke,
        `host.openStream(${normalizedCapabilityId}, ${normalizedMethod})`
      );
      throw new Error(`Permission denied: ${PLUGIN_PERMISSIONS.hostCapabilityInvoke}`);
    }

    if (normalizedCapabilityId !== 'host.pmp.audio-engine.analysis') {
      throw new Error(`Host stream capability is not available: ${normalizedCapabilityId}`);
    }

    if (normalizedMethod !== 'openSpectrumFrameStream') {
      throw new Error(
        `Unsupported host stream method: ${normalizedCapabilityId}.${normalizedMethod}`
      );
    }

    if (typeof audioService.getSpectrumFrame !== 'function') {
      throw new Error('Audio spectrum frame stream is not available');
    }

    const payloadRecord = asObject(payload);
    const tap = normalizeSpectrumTap(payloadRecord?.tap);
    const intervalMs = normalizeHostStreamIntervalMs(payloadRecord?.intervalMs);
    const streamId = `audio-analysis-stream-${++hostStreamCounter}`;

    let sequence = 0;
    let ended = false;
    let timer: ReturnType<typeof globalThis.setInterval> | null = null;
    let endEnvelope: PluginHostStreamEndEnvelope | undefined;

    const dataListeners = new Set<
      (payload: unknown, envelope: PluginHostStreamDataEnvelope) => void
    >();
    const endListeners = new Set<
      (reason?: string, envelope?: PluginHostStreamEndEnvelope) => void
    >();

    const clearTimer = () => {
      if (timer === null) return;
      globalThis.clearInterval(timer);
      timer = null;
    };

    const emitEnd = (reason?: string) => {
      if (ended) return;
      ended = true;
      clearTimer();
      endEnvelope = {
        protocolVersion: '1.0',
        capabilityId: normalizedCapabilityId,
        streamId,
        reason,
      };

      for (const listener of Array.from(endListeners)) {
        try {
          listener(reason, endEnvelope);
        } catch {
          // ignore listener failures
        }
      }
    };

    timer = globalThis.setInterval(() => {
      if (ended) return;

      const envelope: PluginHostStreamDataEnvelope = {
        protocolVersion: '1.0',
        capabilityId: normalizedCapabilityId,
        streamId,
        sequence,
        payload: audioService.getSpectrumFrame?.(tap) ?? null,
      };
      sequence += 1;

      for (const listener of Array.from(dataListeners)) {
        try {
          listener(envelope.payload, envelope);
        } catch {
          // ignore listener failures
        }
      }
    }, intervalMs);

    return {
      streamId,
      mode: 'push',
      transport: 'inline-json',
      onData: (cb) => {
        if (typeof cb !== 'function') return () => {};
        if (ended) return () => {};
        dataListeners.add(cb);
        return () => dataListeners.delete(cb);
      },
      onEnd: (cb) => {
        if (typeof cb !== 'function') return () => {};
        if (ended) {
          try {
            cb(endEnvelope?.reason, endEnvelope);
          } catch {
            // ignore listener failures
          }
          return () => {};
        }
        endListeners.add(cb);
        return () => endListeners.delete(cb);
      },
      cancel: async (reason) => {
        emitEnd(asNonEmptyString(reason) ?? 'cancelled');
      },
      dispose: async (reason) => {
        emitEnd(asNonEmptyString(reason) ?? 'disposed');
      },
    };
  };

  return {
    host: {
      getInfo: () => {
        if (!allowHost) {
          warnDenied('api:host', 'host.getInfo()');
          return null;
        }
        return {
          pluginId,
          hostLabel,
          hostApiVersion: HOST_API_VERSION,
          appVersion: APP_VERSION,
          runtime: isTauriRuntime() ? 'tauri' : 'web',
        };
      },
      listPermissions: () => {
        if (!allowHost) {
          warnDenied('api:host', 'host.listPermissions()');
          return [];
        }
        return Array.from(permissions);
      },
      hasPermission: (capability) => {
        if (!allowHost) {
          warnDenied('api:host', `host.hasPermission(${String(capability)})`);
          return false;
        }
        return hasPermission(permissions, String(capability ?? ''));
      },
      listCapabilities: async () => {
        if (!allowHost) {
          warnDenied('api:host', 'host.listCapabilities()');
          return [];
        }

        return listPluginHostCapabilities().filter(
          (capability) =>
            !capability.permission || hasPermission(permissions, capability.permission)
        );
      },
      invokeCapability: async (capabilityId, method, payload) => {
        return await invokeHostCapabilityInternal(capabilityId, method, payload);
      },
      openStream: async (capabilityId, method, payload) => {
        if (!allowHost) {
          warnDenied('api:host', `host.openStream(${String(capabilityId)}, ${String(method)})`);
          return null;
        }
        return await openHostStreamInternal(capabilityId, method, payload);
      },
      openSession: async (capabilityId, method, payload) => {
        if (!allowHost) {
          warnDenied('api:host', `host.openSession(${String(capabilityId)}, ${String(method)})`);
          return null;
        }
        return await openHostSessionInternal(capabilityId, method, payload);
      },
      closeSession: async (capabilityId, sessionId, reason) => {
        if (!allowHost) {
          warnDenied(
            'api:host',
            `host.closeSession(${String(capabilityId)}, ${String(sessionId)})`
          );
          return;
        }
        await closeHostSessionInternal(capabilityId, sessionId, reason);
      },
    },
    audio: {
      getState: () => {
        if (!allowAudioState) {
          warnDenied('api:audio-state', 'audio.getState()');
          return null;
        }
        return audioService.getState();
      },
      onStateChange: (cb) => {
        if (!allowAudioState) {
          warnDenied('api:audio-state', 'audio.onStateChange(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          warnApiIssue(
            'audio.on_state_change.invalid_callback',
            `[${hostLabel}] Invalid onStateChange callback (plugin=${pluginId})`
          );
          return () => {};
        }
        return audioService.onStateChange((state) => cb(state));
      },
      onTimeUpdate: (cb) => {
        if (!allowAudioState) {
          warnDenied('api:audio-state', 'audio.onTimeUpdate(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          warnApiIssue(
            'audio.on_time_update.invalid_callback',
            `[${hostLabel}] Invalid onTimeUpdate callback (plugin=${pluginId})`
          );
          return () => {};
        }
        return audioService.onTimeUpdate(cb);
      },
      onEnded: (cb) => {
        if (!allowAudioState) {
          warnDenied('api:audio-state', 'audio.onEnded(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          warnApiIssue(
            'audio.on_ended.invalid_callback',
            `[${hostLabel}] Invalid onEnded callback (plugin=${pluginId})`
          );
          return () => {};
        }
        return audioService.onEnded(cb);
      },
      onLoadProgress: (cb) => {
        if (!allowAudioState) {
          warnDenied('api:audio-state', 'audio.onLoadProgress(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          warnApiIssue(
            'audio.on_load_progress.invalid_callback',
            `[${hostLabel}] Invalid onLoadProgress callback (plugin=${pluginId})`
          );
          return () => {};
        }
        if (typeof audioService.onLoadProgress !== 'function') return () => {};
        return audioService.onLoadProgress((value) => {
          try {
            cb(typeof value === 'number' && Number.isFinite(value) ? value : 0);
          } catch {
            // ignore
          }
        });
      },
      onError: (cb) => {
        if (!allowAudioState) {
          warnDenied('api:audio-state', 'audio.onError(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          warnApiIssue(
            'audio.on_error.invalid_callback',
            `[${hostLabel}] Invalid onError callback (plugin=${pluginId})`
          );
          return () => {};
        }
        if (typeof audioService.onError !== 'function') return () => {};
        return audioService.onError((error) => {
          try {
            cb(error instanceof Error ? error.message : String(error));
          } catch {
            // ignore
          }
        });
      },
      getCover,
      play: async () => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', 'audio.play()');
          return;
        }
        await audioService.play();
      },
      pause: () => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', 'audio.pause()');
          return;
        }
        return audioService.pause();
      },
      stop: () => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', 'audio.stop()');
          return;
        }
        audioService.stop();
      },
      seek: (time) => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', `audio.seek(${time})`);
          return;
        }
        if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
          warnApiIssue(
            'audio.seek.invalid_argument',
            `[${hostLabel}] Invalid seek(${String(time)}) (plugin=${pluginId})`,
            { time: String(time) }
          );
          return;
        }
        audioService.seek(time);
      },
      setVolume: (volume) => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', `audio.setVolume(${volume})`);
          return;
        }
        if (typeof volume !== 'number' || !Number.isFinite(volume)) {
          warnApiIssue(
            'audio.set_volume.invalid_argument',
            `[${hostLabel}] Invalid setVolume(${String(volume)}) (plugin=${pluginId})`,
            { volume: String(volume) }
          );
          return;
        }
        audioService.setVolume(volume);
      },
      toggleMute: () => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', 'audio.toggleMute()');
          return;
        }
        audioService.toggleMute();
      },
      playNext: async () => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', 'audio.playNext()');
          return;
        }
        const fn = audioService.playNext;
        if (typeof fn !== 'function') return;
        await fn.call(audioService);
      },
      playPrevious: async () => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', 'audio.playPrevious()');
          return;
        }
        const fn = audioService.playPrevious;
        if (typeof fn !== 'function') return;
        await fn.call(audioService);
      },
      playTrackAtIndex: async (index) => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', `audio.playTrackAtIndex(${String(index)})`);
          return;
        }
        const int = typeof index === 'number' && Number.isFinite(index) ? Math.floor(index) : -1;
        if (int < 0) {
          warnApiIssue(
            'audio.play_track_at_index.invalid_argument',
            `[${hostLabel}] Invalid playTrackAtIndex(${String(index)}) (plugin=${pluginId})`,
            { index: String(index) }
          );
          return;
        }
        const fn = audioService.playTrackAtIndex;
        if (typeof fn !== 'function') return;
        await fn.call(audioService, int);
      },
      getPlayMode: () => {
        if (!allowAudioState) {
          warnDenied('api:audio-state', 'audio.getPlayMode()');
          return null;
        }
        const fn = audioService.getPlayMode;
        if (typeof fn !== 'function') return null;
        try {
          const mode = fn.call(audioService);
          return typeof mode === 'string' ? mode : null;
        } catch {
          return null;
        }
      },
      setPlayMode: (mode) => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', `audio.setPlayMode(${String(mode)})`);
          return;
        }
        const normalized = typeof mode === 'string' ? mode.trim() : '';
        if (!PLAY_MODES.has(normalized)) {
          warnApiIssue(
            'audio.play_mode.invalid_argument',
            `[${hostLabel}] Invalid play mode "${String(mode)}" (plugin=${pluginId})`,
            { mode: String(mode) }
          );
          return;
        }
        const fn = audioService.setPlayMode;
        if (typeof fn !== 'function') return;
        try {
          fn.call(audioService, normalized as PlayMode);
        } catch {
          // ignore
        }
      },
    },
    visualizer: {
      getSpectrum: () => {
        if (!allowAudioVisual) {
          warnDenied('api:audio-visual', 'visualizer.getSpectrum()');
          return null;
        }
        return audioService.getFrequencyData?.() ?? null;
      },
      getSpectrumFrame: (options) => {
        if (!allowAudioVisual) {
          warnDenied('api:audio-visual', 'visualizer.getSpectrumFrame(options)');
          return null;
        }
        const tap = options?.tap === 'pre-dsp' ? 'pre-dsp' : 'post-dsp';
        return audioService.getSpectrumFrame?.(tap) ?? null;
      },
      onSpectrum: (cb, options) => {
        if (!allowAudioVisual) {
          warnDenied('api:audio-visual', 'visualizer.onSpectrum(cb)');
          return () => {};
        }

        if (typeof cb !== 'function') {
          warnApiIssue(
            'visualizer.on_spectrum.invalid_callback',
            `[${hostLabel}] Invalid onSpectrum callback (plugin=${pluginId})`
          );
          return () => {};
        }

        const intervalMs =
          typeof options?.intervalMs === 'number' && Number.isFinite(options.intervalMs)
            ? Math.max(16, Math.min(2000, Math.floor(options.intervalMs)))
            : 33;

        const handle = window.setInterval(() => {
          try {
            cb(audioService.getFrequencyData?.() ?? null);
          } catch (error) {
            warnApiIssue(
              'visualizer.on_spectrum.callback_failed',
              `[${hostLabel}] visualizer.onSpectrum callback failed (plugin=${pluginId})`,
              { errorMessage: readErrorMessage(error) }
            );
          }
        }, intervalMs);

        return () => {
          window.clearInterval(handle);
        };
      },
      onSpectrumFrame: (cb, options) => {
        if (!allowAudioVisual) {
          warnDenied('api:audio-visual', 'visualizer.onSpectrumFrame(cb)');
          return () => {};
        }

        if (typeof cb !== 'function') {
          warnApiIssue(
            'visualizer.on_spectrum_frame.invalid_callback',
            `[${hostLabel}] Invalid onSpectrumFrame callback (plugin=${pluginId})`
          );
          return () => {};
        }

        const intervalMs =
          typeof options?.intervalMs === 'number' && Number.isFinite(options.intervalMs)
            ? Math.max(16, Math.min(2000, Math.floor(options.intervalMs)))
            : 33;
        const tap = options?.tap === 'pre-dsp' ? 'pre-dsp' : 'post-dsp';

        const handle = window.setInterval(() => {
          try {
            cb(audioService.getSpectrumFrame?.(tap) ?? null);
          } catch (error) {
            warnApiIssue(
              'visualizer.on_spectrum_frame.callback_failed',
              `[${hostLabel}] visualizer.onSpectrumFrame callback failed (plugin=${pluginId})`,
              { tap, errorMessage: readErrorMessage(error) }
            );
          }
        }, intervalMs);

        return () => {
          window.clearInterval(handle);
        };
      },
    },
    navigation: {
      navigateTo: (page, params) => {
        if (!allowNavigation) {
          warnDenied('api:navigation', `navigation.navigateTo(${page})`);
          return;
        }
        if (params === undefined) {
          if (PAGES_REQUIRING_PARAMS.has(page)) {
            warnApiIssue(
              'navigation.navigate_to.missing_params',
              `[${hostLabel}] navigateTo(${page}) requires params; ignoring request.`,
              { page }
            );
            return;
          }
          navigation.navigateTo(page as PageWithoutParams);
          return;
        }

        if (!PAGES_REQUIRING_PARAMS.has(page)) {
          warnApiIssue(
            'navigation.navigate_to.ignores_params',
            `[${hostLabel}] navigateTo(${page}) ignores params; navigating without params.`,
            { page }
          );
          navigation.navigateTo(page as PageWithoutParams);
          return;
        }

        const validated = parseNavigationParams(page, params);
        if (!validated) {
          warnApiIssue(
            'navigation.navigate_to.invalid_params',
            `[${hostLabel}] navigateTo(${page}) params invalid; ignoring request.`,
            { page }
          );
          return;
        }

        const nextParams =
          page === 'plugin-page' || page === 'plugin-visualizer'
            ? ({ ...validated, sourceKind } as Record<string, unknown>)
            : (validated as Record<string, unknown>);

        navigation.navigateTo(page as PageWithParams, nextParams);
      },
      goBack: () => {
        if (!allowNavigation) {
          warnDenied('api:navigation', 'navigation.goBack()');
          return;
        }
        navigation.goBack();
      },
      getSnapshot: getNavigationSnapshot,
      onChange: (cb) => {
        if (!allowNavigation) {
          warnDenied('api:navigation', 'navigation.onChange(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          warnApiIssue(
            'navigation.on_change.invalid_callback',
            `[${hostLabel}] Invalid navigation.onChange callback (plugin=${pluginId})`
          );
          return () => {};
        }

        const subscribe = navigation.subscribe;
        if (typeof subscribe !== 'function') return () => {};

        return subscribe((snapshot) => {
          try {
            cb(snapshot);
          } catch (error) {
            warnApiIssue(
              'navigation.on_change.callback_failed',
              `[${hostLabel}] navigation.onChange callback failed (plugin=${pluginId})`,
              { errorMessage: readErrorMessage(error) }
            );
          }
        });
      },
      canGoBack: () => {
        const snap = getNavigationSnapshot();
        return Boolean(snap && typeof snap.currentIndex === 'number' && snap.currentIndex > 0);
      },
    },
    config: configApi,
    window: windowApi,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
}

function resolveCurrentTrack(state: unknown): Track | null {
  if (!isRecord(state)) return null;
  const current = state.currentTrack;
  if (!isRecord(current)) return null;

  const id = readNonEmptyString(current.id) ?? readNonEmptyString(current.filePath) ?? readNonEmptyString(current.path);
  if (!id) return null;

  const title = readNonEmptyString(current.title) ?? id;

  const track: Track = {
    id,
    title,
  };

  const filePath = readNonEmptyString(current.filePath);
  if (filePath) track.filePath = filePath;

  const path = readNonEmptyString(current.path);
  if (path) track.path = path;

  const originalPath = readNonEmptyString(current.originalPath);
  if (originalPath) track.originalPath = originalPath;

  const coverKey = readNonEmptyString(current.coverKey);
  if (coverKey) track.coverKey = coverKey;

  const coverUrl = readNonEmptyString(current.coverUrl);
  if (coverUrl) track.coverUrl = coverUrl;

  const artist = readNonEmptyString(current.artist);
  if (artist) track.artist = artist;

  const album = readNonEmptyString(current.album);
  if (album) track.album = album;

  return track;
}

function buildTrackKey(track: Track): string | null {
  return (
    readNonEmptyString(track.coverKey) ||
    readNonEmptyString(track.id) ||
    readNonEmptyString(track.filePath) ||
    readNonEmptyString(track.path) ||
    readNonEmptyString(track.originalPath) ||
    readNonEmptyString(track.title) ||
    null
  );
}

async function blobUrlToDataUrl(blobUrl: string): Promise<string | null> {
  try {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function resolveCoverDataUrl(track: Track): Promise<string | null> {
  const existing = readNonEmptyString(track.coverUrl);
  if (existing) {
    const lower = existing.toLowerCase();
    if (lower.startsWith('data:')) return existing;
    if (lower.startsWith('http:') || lower.startsWith('https:')) return existing;
    if (lower.startsWith('blob:')) return await blobUrlToDataUrl(existing);
  }

  const resolved = await musicLibraryService.getCoverUrlForTrack(track);
  const url = readNonEmptyString(resolved);
  if (!url) return null;

  const lower = url.toLowerCase();
  if (lower.startsWith('data:')) return url;
  if (lower.startsWith('http:') || lower.startsWith('https:')) return url;
  if (lower.startsWith('blob:')) return await blobUrlToDataUrl(url);

  return null;
}
