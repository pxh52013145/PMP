import { APP_VERSION, HOST_API_VERSION } from '../../../constants/versions';
import type { CommandsService } from '../../../services/commands';
import type { KeybindingsService } from '../../../services/keybindings';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import {
  buildPmpmRuntimeActivateSnapshot,
  buildPmpmRuntimeHelloSnapshot,
  buildPmpmRuntimeInitSnapshot,
} from '../pmpmRuntimeBridgeSnapshot';
import {
  getInstalledPmpmPlugin,
  getPmpmPluginEffectivePermissions,
  recordPmpmPermissionDenied,
  recordPmpmPluginCrash,
} from '../pmpm';
import { createPluginMountApi, type HostAudioService, type HostNavigation } from '../pluginHostApi';
import { readPmpmPluginConfig, subscribePmpmPluginConfig } from '../pluginConfig';
import { readVerifiedPmpmPluginEntryCode } from '../pmpmRuntime';
import { recordPmpmAuditEvent } from '../pmpmGovernance';
import { createRuntimeBridgeHostSession, type RuntimeBridgePort } from './runtimeBridgeHostSession';
import { bindHostRuntimeEventChannel, RUNTIME_EVENT_NAMES } from './runtimeEventChannel';

import type { RuntimeActivate, RuntimeHello } from '@pixel-matrix/plugin-platform-contracts';

const STARTUP_TIMEOUT_MS = 3_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;

type WorkerEventListener = (event: { data?: unknown; message?: string; error?: unknown }) => void;

type WorkerLike = {
  postMessage: (message: unknown) => void;
  terminate: () => void;
  addEventListener: (type: 'message' | 'error', listener: WorkerEventListener) => void;
  removeEventListener: (type: 'message' | 'error', listener: WorkerEventListener) => void;
};

export interface RunPmpmBridgeWorkerCommandOptions {
  pluginId: string;
  runtimeId: string;
  commandId: string;
  args?: unknown;
  hostLabel?: string;
  audioService: HostAudioService;
  commands?: CommandsService | null;
  navigation: HostNavigation;
  keybindings?: KeybindingsService | null;
  timeoutMs?: number;
}

export interface PmpmBridgeWorkerCommandRuntimeDeps {
  createWorker?: (
    scriptUrl: string,
    options: { type: 'module'; name?: string },
    runtimeHello: RuntimeHello
  ) => WorkerLike;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  now?: () => number;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error);
}

function isTransportMessage(value: unknown): value is { op: string } {
  const record = asObject(value);
  return typeof record?.op === 'string';
}

function buildWorkerPort(worker: WorkerLike): { port: RuntimeBridgePort; dispose: () => void } {
  const listeners = new Set<(message: never) => void>();
  const buffered: unknown[] = [];

  const onMessage: WorkerEventListener = (event) => {
    if (!isTransportMessage(event.data)) return;
    if (listeners.size === 0) {
      buffered.push(event.data);
      return;
    }
    for (const listener of Array.from(listeners)) {
      listener(event.data as never);
    }
  };

  worker.addEventListener('message', onMessage);

  return {
    port: {
      postMessage: (message) => {
        worker.postMessage(message);
      },
      onMessage: (listener) => {
        listeners.add(listener as (message: never) => void);
        if (buffered.length > 0) {
          const pending = buffered.splice(0, buffered.length);
          for (const message of pending) {
            listener(message as never);
          }
        }
        return () => {
          listeners.delete(listener as (message: never) => void);
        };
      },
    },
    dispose: () => {
      worker.removeEventListener('message', onMessage);
      listeners.clear();
      buffered.length = 0;
    },
  };
}

function buildWorkerBootstrapSource(runtimeHello: RuntimeHello): string {
  return `(${pmpmBridgeWorkerBootstrap.toString()})(${JSON.stringify(runtimeHello)}, ${JSON.stringify(RUNTIME_EVENT_NAMES)})`;
}

function pmpmBridgeWorkerBootstrap(
  runtimeHello: RuntimeHello,
  runtimeEventNames: Record<string, string>
): void {
  const CORE_CAPABILITY_REGISTRY_ID = 'core.capability-registry';
  const STORAGE_CONFIG_CAPABILITY_ID = 'host.pmp.storage.config';
  const AUDIO_PLAYBACK_CAPABILITY_ID = 'host.pmp.audio-engine.playback';
  const NAVIGATION_CAPABILITY_ID = 'host.pmp.navigation';
  const WINDOW_CAPABILITY_ID = 'host.pmp.shell.window';

  function asObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  function asNonEmptyString(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 0 ? normalized : null;
  }

  function cloneValue<T>(value: T): T {
    try {
      if (typeof globalThis.structuredClone === 'function') {
        return globalThis.structuredClone(value);
      }
    } catch {
      // ignore
    }
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return value;
    }
  }

  function hasPermission(capability: string): boolean {
    if (permissions.has(capability)) return true;
    if (capability.startsWith('net:') && (permissions.has('net:*') || permissions.has('net:all'))) {
      return true;
    }
    for (const granted of permissions) {
      if (!granted.endsWith('*')) continue;
      const prefix = granted.slice(0, -1);
      if (prefix.length > 0 && capability.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  function warnDenied(capability: string, action: string): void {
    emitRuntimeEvent(runtimeEventNames.permissionDenied, { capability, action });
  }

  function baseEnvelope() {
    return {
      bridgeVersion: runtimeHello.bridgeVersion,
      pluginId: runtimeHello.pluginId,
      runtimeId: runtimeHello.runtimeId,
      runtimeInstanceId: runtimeHello.runtimeInstanceId,
    };
  }

  function emitRuntimeEvent(eventName: string, payload?: unknown): void {
    postMessage({
      ...baseEnvelope(),
      op: 'runtime.event',
      eventName,
      payload,
      emittedAt: Date.now(),
    });
  }

  function nextRequestId(prefix: string): string {
    requestSeq += 1;
    return `${prefix}:${runtimeHello.runtimeInstanceId}:${requestSeq}`;
  }

  function sendRequest(message: Record<string, unknown>): Promise<Record<string, unknown>> {
    const requestId = asNonEmptyString(message.requestId);
    if (!requestId) {
      return Promise.reject(new Error('Bridge request is missing requestId'));
    }
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      postMessage(message);
    });
  }

  function trackConfigMutation(promise: Promise<unknown>): void {
    const tracked = promise.finally(() => {
      pendingConfigMutations.delete(tracked);
    });
    pendingConfigMutations.add(tracked);
  }

  async function flushConfigMutations(): Promise<void> {
    while (pendingConfigMutations.size > 0) {
      await Promise.allSettled(Array.from(pendingConfigMutations));
    }
  }

  async function invokeCapabilityEnvelope(
    capabilityId: string,
    method: string,
    payload?: unknown
  ): Promise<Record<string, unknown>> {
    const response = await sendRequest({
      ...baseEnvelope(),
      bridgeVersion: runtimeHello.bridgeVersion,
      protocolVersion: '1.0',
      op: 'capability.invoke.request',
      requestId: nextRequestId('capability'),
      capabilityId,
      method,
      payload,
    });

    if (response.op !== 'capability.invoke.response') {
      throw new Error('Invalid capability.invoke response');
    }
    return response;
  }

  function readCapabilityError(response: Record<string, unknown>, fallback: string): Error {
    const error = asObject(response.error);
    return new Error((typeof error?.message === 'string' && error.message) || fallback);
  }

  async function invokeCapability(
    capabilityId: string,
    method: string,
    payload?: unknown
  ): Promise<unknown> {
    const response = await invokeCapabilityEnvelope(capabilityId, method, payload);
    if (response.ok !== true) {
      throw readCapabilityError(response, `${capabilityId}.${method} failed`);
    }
    return cloneValue(response.data);
  }

  async function refreshAudioState(): Promise<void> {
    if (!hasPermission('api:audio-state')) return;
    try {
      emitAudioState(await invokeCapability(AUDIO_PLAYBACK_CAPABILITY_ID, 'getState'));
    } catch {
      // ignore best-effort refresh failures
    }
  }

  async function refreshNavigationSnapshot(): Promise<void> {
    if (!hasPermission('api:navigation')) return;
    try {
      emitNavigationSnapshot(await invokeCapability(NAVIGATION_CAPABILITY_ID, 'getSnapshot'));
    } catch {
      // ignore best-effort refresh failures
    }
  }

  function readAudioPlayMode(): string | null {
    const state = asObject(audioState);
    return typeof state?.playMode === 'string' ? state.playMode : null;
  }

  function normalizeIntervalMs(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 33;
    }
    return Math.max(16, Math.min(2_000, Math.floor(value)));
  }

  function emitAudioState(nextState: unknown): void {
    audioState = cloneValue(nextState);
    for (const listener of Array.from(audioStateListeners)) {
      try {
        listener(cloneValue(audioState));
      } catch {
        // ignore
      }
    }
  }

  function emitNavigationSnapshot(nextSnapshot: unknown): void {
    navigationSnapshot = cloneValue(nextSnapshot);
    for (const listener of Array.from(navigationListeners)) {
      try {
        listener(cloneValue(navigationSnapshot));
      } catch {
        // ignore
      }
    }
  }

  function emitCommandResult(ok: boolean, error?: unknown): void {
    emitRuntimeEvent(runtimeEventNames.commandResult, {
      ok,
      message: ok ? undefined : error instanceof Error ? error.message : String(error),
    });
  }

  function updateConfigFromResponse(response: Record<string, unknown>): void {
    if (response.ok !== true) return;
    const nextConfig = asObject(response.data);
    if (!nextConfig) return;
    configValue = cloneValue(nextConfig);
    for (const listener of Array.from(configListeners)) {
      try {
        listener(cloneValue(configValue));
      } catch {
        // ignore
      }
    }
  }

  const pending = new Map<string, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  const pendingConfigMutations = new Set<Promise<unknown>>();
  const audioStateListeners = new Set<(state: unknown) => void>();
  const audioTimeListeners = new Set<(time: number) => void>();
  const audioEndedListeners = new Set<() => void>();
  const audioLoadProgressListeners = new Set<(progress: number) => void>();
  const audioErrorListeners = new Set<(message: string) => void>();
  const navigationListeners = new Set<(snapshot: unknown) => void>();
  const configListeners = new Set<(config: Record<string, unknown>) => void>();
  let permissions = new Set<string>();
  let permissionList: string[] = [];
  let runtimeInit: Record<string, unknown> | null = null;
  let runtimeActivate: Record<string, unknown> | null = null;
  let hostInfo: Record<string, unknown> | null = null;
  let audioState: unknown = null;
  let audioSpectrum: unknown = null;
  let audioSpectrumFramePre: unknown = null;
  let audioSpectrumFramePost: unknown = null;
  let navigationSnapshot: unknown = null;
  let configValue: Record<string, unknown> = {};
  let requestSeq = 0;
  let active = false;

  const api = {
    host: {
      getInfo: () => (hasPermission('api:host') ? cloneValue(hostInfo) : null),
      listPermissions: () => (hasPermission('api:host') ? permissionList.slice() : []),
      hasPermission: (capability: unknown) =>
        hasPermission('api:host') ? hasPermission(String(capability ?? '')) : false,
      getRuntimeHelloSnapshot: () => (hasPermission('api:host') ? cloneValue(runtimeHello) : null),
      getRuntimeInitSnapshot: () => (hasPermission('api:host') ? cloneValue(runtimeInit) : null),
      getRuntimeActivateSnapshot: () =>
        hasPermission('api:host') ? cloneValue(runtimeActivate) : null,
      getRuntimeHealthSnapshot: () =>
        hasPermission('api:host')
          ? {
              ...baseEnvelope(),
              op: 'runtime.health.response',
              ready: active,
              status: active ? 'healthy' : 'degraded',
            }
          : null,
      getViewMountRequestSnapshot: () => null,
      getRuntimeRevokeSnapshot: () => null,
      getRuntimeRevokeAckSnapshot: () => null,
      listCapabilities: async () => {
        if (!hasPermission('api:host')) {
          warnDenied('api:host', 'host.listCapabilities()');
          return [];
        }
        const response = await invokeCapabilityEnvelope(CORE_CAPABILITY_REGISTRY_ID, 'list');
        return Array.isArray(response.data) ? cloneValue(response.data) : [];
      },
      invokeCapability: async (capabilityId: string, method: string, payload?: unknown) => {
        if (!hasPermission('api:host')) {
          warnDenied('api:host', `host.invokeCapability(${String(capabilityId)}, ${String(method)})`);
          return null;
        }
        const response = await invokeCapabilityEnvelope(capabilityId, method, payload);
        if (response.ok !== true) {
          const error = asObject(response.error);
          throw new Error((typeof error?.message === 'string' && error.message) || 'Capability failed');
        }
        return cloneValue(response.data);
      },
      openSession: async (capabilityId: string, method: string, payload?: unknown) => {
        if (!hasPermission('api:host')) {
          warnDenied('api:host', `host.openSession(${String(capabilityId)}, ${String(method)})`);
          return null;
        }
        const response = await sendRequest({
          ...baseEnvelope(),
          protocolVersion: '1.0',
          op: 'session.open.request',
          requestId: nextRequestId('session-open'),
          capabilityId,
          method,
          payload,
        });
        if (response.ok !== true) return null;
        return {
          sessionId: response.sessionId,
          providerSessionId: response.providerSessionId,
          metadata: cloneValue(response.metadata),
        };
      },
      closeSession: async (capabilityId: string, sessionId: string, reason?: string) => {
        if (!hasPermission('api:host')) {
          warnDenied('api:host', `host.closeSession(${String(capabilityId)}, ${String(sessionId)})`);
          return;
        }
        await sendRequest({
          ...baseEnvelope(),
          protocolVersion: '1.0',
          op: 'session.close.request',
          requestId: nextRequestId('session-close'),
          capabilityId,
          sessionId,
          reason,
        });
      },
      openStream: async (capabilityId: string, method: string, payload?: unknown) => {
        if (!hasPermission('api:host')) {
          warnDenied('api:host', `host.openStream(${String(capabilityId)}, ${String(method)})`);
          return null;
        }
        const response = await sendRequest({
          ...baseEnvelope(),
          protocolVersion: '1.0',
          op: 'stream.open.request',
          requestId: nextRequestId('stream-open'),
          capabilityId,
          method,
          payload,
        });
        if (response.ok !== true) return null;
        return {
          streamId: response.streamId,
          mode: response.mode,
          transport: response.transport,
          onData: () => () => {},
          onEnd: () => () => {},
          cancel: async (reason?: string) => {
            postMessage({
              ...baseEnvelope(),
              protocolVersion: '1.0',
              op: 'cancel.request',
              requestId: nextRequestId('cancel'),
              streamId: response.streamId,
              reason,
            });
          },
          dispose: async (reason?: string) => {
            postMessage({
              ...baseEnvelope(),
              protocolVersion: '1.0',
              op: 'dispose.request',
              requestId: nextRequestId('dispose'),
              streamId: response.streamId,
              reason,
            });
          },
        };
      },
    },
    audio: {
      getState: () => {
        if (!hasPermission('api:audio-state')) {
          warnDenied('api:audio-state', 'audio.getState()');
          return null;
        }
        return cloneValue(audioState);
      },
      onStateChange: (cb: (state: unknown) => void) => {
        if (!hasPermission('api:audio-state')) {
          warnDenied('api:audio-state', 'audio.onStateChange(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          return () => {};
        }
        audioStateListeners.add(cb);
        return () => {
          audioStateListeners.delete(cb);
        };
      },
      onTimeUpdate: (cb: (time: number) => void) => {
        if (!hasPermission('api:audio-state')) {
          warnDenied('api:audio-state', 'audio.onTimeUpdate(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          return () => {};
        }
        audioTimeListeners.add(cb);
        return () => {
          audioTimeListeners.delete(cb);
        };
      },
      onEnded: (cb: () => void) => {
        if (!hasPermission('api:audio-state')) {
          warnDenied('api:audio-state', 'audio.onEnded(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          return () => {};
        }
        audioEndedListeners.add(cb);
        return () => {
          audioEndedListeners.delete(cb);
        };
      },
      onLoadProgress: (cb: (progress: number) => void) => {
        if (!hasPermission('api:audio-state')) {
          warnDenied('api:audio-state', 'audio.onLoadProgress(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          return () => {};
        }
        audioLoadProgressListeners.add(cb);
        return () => {
          audioLoadProgressListeners.delete(cb);
        };
      },
      onError: (cb: (message: string) => void) => {
        if (!hasPermission('api:audio-state')) {
          warnDenied('api:audio-state', 'audio.onError(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          return () => {};
        }
        audioErrorListeners.add(cb);
        return () => {
          audioErrorListeners.delete(cb);
        };
      },
      getCover: async () => {
        if (!hasPermission('api:audio-cover')) {
          warnDenied('api:audio-cover', 'audio.getCover()');
          return null;
        }
        return (await invokeCapability(AUDIO_PLAYBACK_CAPABILITY_ID, 'getCover')) ?? null;
      },
      play: async () => {
        if (!hasPermission('api:audio-control')) {
          warnDenied('api:audio-control', 'audio.play()');
          return;
        }
        await invokeCapability(AUDIO_PLAYBACK_CAPABILITY_ID, 'play');
        await refreshAudioState();
      },
      pause: async () => {
        if (!hasPermission('api:audio-control')) {
          warnDenied('api:audio-control', 'audio.pause()');
          return;
        }
        await invokeCapability(AUDIO_PLAYBACK_CAPABILITY_ID, 'pause');
        await refreshAudioState();
      },
      stop: () => {
        if (!hasPermission('api:audio-control')) {
          warnDenied('api:audio-control', 'audio.stop()');
          return;
        }
        void invokeCapability(AUDIO_PLAYBACK_CAPABILITY_ID, 'stop').then(() => refreshAudioState());
      },
      seek: (time: number) => {
        if (!hasPermission('api:audio-control')) {
          warnDenied('api:audio-control', 'audio.seek(time)');
          return;
        }
        void invokeCapability(AUDIO_PLAYBACK_CAPABILITY_ID, 'seek', { time }).then(() =>
          refreshAudioState()
        );
      },
      setVolume: (volume: number) => {
        if (!hasPermission('api:audio-control')) {
          warnDenied('api:audio-control', 'audio.setVolume(volume)');
          return;
        }
        void invokeCapability(AUDIO_PLAYBACK_CAPABILITY_ID, 'setVolume', { volume }).then(() =>
          refreshAudioState()
        );
      },
      toggleMute: () => {
        if (!hasPermission('api:audio-control')) {
          warnDenied('api:audio-control', 'audio.toggleMute()');
          return;
        }
        void invokeCapability(AUDIO_PLAYBACK_CAPABILITY_ID, 'toggleMute').then(() =>
          refreshAudioState()
        );
      },
      playNext: async () => {
        if (!hasPermission('api:audio-control')) {
          warnDenied('api:audio-control', 'audio.playNext()');
          return;
        }
        await invokeCapability(AUDIO_PLAYBACK_CAPABILITY_ID, 'playNext');
        await refreshAudioState();
      },
      playPrevious: async () => {
        if (!hasPermission('api:audio-control')) {
          warnDenied('api:audio-control', 'audio.playPrevious()');
          return;
        }
        await invokeCapability(AUDIO_PLAYBACK_CAPABILITY_ID, 'playPrevious');
        await refreshAudioState();
      },
      playTrackAtIndex: async (index: number) => {
        if (!hasPermission('api:audio-control')) {
          warnDenied('api:audio-control', 'audio.playTrackAtIndex(index)');
          return;
        }
        await invokeCapability(AUDIO_PLAYBACK_CAPABILITY_ID, 'playTrackAtIndex', { index });
        await refreshAudioState();
      },
      getPlayMode: () => {
        if (!hasPermission('api:audio-state')) {
          warnDenied('api:audio-state', 'audio.getPlayMode()');
          return null;
        }
        return readAudioPlayMode();
      },
      setPlayMode: (mode: string) => {
        if (!hasPermission('api:audio-control')) {
          warnDenied('api:audio-control', 'audio.setPlayMode(mode)');
          return;
        }
        void invokeCapability(AUDIO_PLAYBACK_CAPABILITY_ID, 'setPlayMode', { mode }).then(() =>
          refreshAudioState()
        );
      },
    },
    visualizer: {
      getSpectrum: () => {
        if (!hasPermission('api:audio-visual')) {
          warnDenied('api:audio-visual', 'visualizer.getSpectrum()');
          return null;
        }
        return cloneValue(audioSpectrum);
      },
      getSpectrumFrame: (options?: { tap?: 'pre-dsp' | 'post-dsp' }) => {
        if (!hasPermission('api:audio-visual')) {
          warnDenied('api:audio-visual', 'visualizer.getSpectrumFrame(options)');
          return null;
        }
        return cloneValue(
          options?.tap === 'pre-dsp' ? audioSpectrumFramePre : audioSpectrumFramePost
        );
      },
      onSpectrum: (cb: (bins: unknown) => void, options?: { intervalMs?: number }) => {
        if (!hasPermission('api:audio-visual')) {
          warnDenied('api:audio-visual', 'visualizer.onSpectrum(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          return () => {};
        }
        const handle = globalThis.setInterval(() => {
          try {
            cb(cloneValue(audioSpectrum));
          } catch {
            // ignore
          }
        }, normalizeIntervalMs(options?.intervalMs));
        return () => {
          globalThis.clearInterval(handle);
        };
      },
      onSpectrumFrame: (
        cb: (frame: unknown) => void,
        options?: { tap?: 'pre-dsp' | 'post-dsp'; intervalMs?: number }
      ) => {
        if (!hasPermission('api:audio-visual')) {
          warnDenied('api:audio-visual', 'visualizer.onSpectrumFrame(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          return () => {};
        }
        const tap = options?.tap === 'pre-dsp' ? 'pre-dsp' : 'post-dsp';
        const handle = globalThis.setInterval(() => {
          try {
            cb(cloneValue(tap === 'pre-dsp' ? audioSpectrumFramePre : audioSpectrumFramePost));
          } catch {
            // ignore
          }
        }, normalizeIntervalMs(options?.intervalMs));
        return () => {
          globalThis.clearInterval(handle);
        };
      },
    },
    navigation: {
      navigateTo: (page: string, params?: Record<string, unknown>) => {
        if (!hasPermission('api:navigation')) {
          warnDenied('api:navigation', `navigation.navigateTo(${String(page)})`);
          return;
        }
        void invokeCapability(NAVIGATION_CAPABILITY_ID, 'navigateTo', { page, params }).then(() =>
          refreshNavigationSnapshot()
        );
      },
      goBack: () => {
        if (!hasPermission('api:navigation')) {
          warnDenied('api:navigation', 'navigation.goBack()');
          return;
        }
        void invokeCapability(NAVIGATION_CAPABILITY_ID, 'goBack').then(() =>
          refreshNavigationSnapshot()
        );
      },
      getSnapshot: () => {
        if (!hasPermission('api:navigation')) {
          warnDenied('api:navigation', 'navigation.getSnapshot()');
          return null;
        }
        return cloneValue(navigationSnapshot);
      },
      onChange: (cb: (snapshot: unknown) => void) => {
        if (!hasPermission('api:navigation')) {
          warnDenied('api:navigation', 'navigation.onChange(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          return () => {};
        }
        navigationListeners.add(cb);
        return () => {
          navigationListeners.delete(cb);
        };
      },
      canGoBack: () => {
        if (!hasPermission('api:navigation')) {
          warnDenied('api:navigation', 'navigation.canGoBack()');
          return false;
        }
        const snapshot = asObject(navigationSnapshot);
        return Boolean(snapshot && typeof snapshot.currentIndex === 'number' && snapshot.currentIndex > 0);
      },
    },
    config: {
      get: () => (hasPermission('storage:local') ? cloneValue(configValue) : {}),
      set: (next: Record<string, unknown>) => {
        if (!hasPermission('storage:local')) {
          warnDenied('storage:local', 'config.set(next)');
          return;
        }
        trackConfigMutation(
          invokeCapabilityEnvelope(STORAGE_CONFIG_CAPABILITY_ID, 'set', { value: asObject(next) ?? {} })
            .then((response) => updateConfigFromResponse(response))
            .catch(() => undefined)
        );
      },
      patch: (next: Record<string, unknown>) => {
        if (!hasPermission('storage:local')) {
          warnDenied('storage:local', 'config.patch(next)');
          return;
        }
        trackConfigMutation(
          invokeCapabilityEnvelope(STORAGE_CONFIG_CAPABILITY_ID, 'patch', { value: asObject(next) ?? {} })
            .then((response) => updateConfigFromResponse(response))
            .catch(() => undefined)
        );
      },
      reset: () => {
        if (!hasPermission('storage:local')) {
          warnDenied('storage:local', 'config.reset()');
          return;
        }
        trackConfigMutation(
          invokeCapabilityEnvelope(STORAGE_CONFIG_CAPABILITY_ID, 'reset')
            .then((response) => updateConfigFromResponse(response))
            .catch(() => undefined)
        );
      },
      onChange: (cb: (config: Record<string, unknown>) => void) => {
        if (!hasPermission('storage:local') || typeof cb !== 'function') {
          return () => {};
        }
        configListeners.add(cb);
        return () => {
          configListeners.delete(cb);
        };
      },
    },
    window: {
      open: async (windowId: string, options?: unknown) => {
        if (!hasPermission('api:window')) {
          warnDenied('api:window', `window.open(${String(windowId)})`);
          return;
        }
        await invokeCapability(WINDOW_CAPABILITY_ID, 'open', { windowId, options });
      },
      close: async (windowId: string) => {
        if (!hasPermission('api:window')) {
          warnDenied('api:window', `window.close(${String(windowId)})`);
          return;
        }
        await invokeCapability(WINDOW_CAPABILITY_ID, 'close', { windowId });
      },
    },
  };

  async function executeCommand(message: RuntimeActivate): Promise<void> {
    const payload = asObject(message.payload) ?? {};
    const entryCode = asNonEmptyString(payload.entryCode);
    const commandId = asNonEmptyString(payload.commandId) ?? asNonEmptyString(payload.surfaceId);

    if (!entryCode || !commandId) {
      throw new Error('runtime.activate payload is incomplete');
    }

    permissionList = Array.isArray(payload.permissions)
      ? payload.permissions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    permissions = new Set(permissionList);
    hostInfo = asObject(payload.hostInfo);
    audioState = cloneValue(payload.initialAudioState ?? null);
    audioSpectrum = cloneValue(payload.initialAudioSpectrum ?? null);
    audioSpectrumFramePre = cloneValue(payload.initialAudioSpectrumFramePre ?? null);
    audioSpectrumFramePost = cloneValue(payload.initialAudioSpectrumFramePost ?? null);
    navigationSnapshot = cloneValue(payload.initialNavigation ?? null);
    configValue = cloneValue(asObject(payload.initialConfig) ?? {});
    active = true;

    const entryUrl = URL.createObjectURL(new Blob([entryCode], { type: 'text/javascript' }));
    try {
      const mod = (await import(/* @vite-ignore */ entryUrl)) as Record<string, unknown>;
      const defaultExport = asObject(mod.default);
      const runCommand =
        (typeof mod.runCommand === 'function' ? mod.runCommand : null) ??
        (typeof defaultExport?.runCommand === 'function' ? defaultExport.runCommand : null);

      if (typeof runCommand !== 'function') {
        throw new Error('Plugin entry must export `runCommand(api, commandId, args?)`');
      }

      await Promise.resolve(runCommand(api, commandId, cloneValue(payload.args)));
      await flushConfigMutations();
      emitCommandResult(true);
    } finally {
      URL.revokeObjectURL(entryUrl);
    }
  }

  addEventListener('message', (event) => {
    const record = asObject(event.data);
    if (!record) return;

    if (record.op === 'runtime.event') {
      const eventName = asNonEmptyString(record.eventName);
      const payload = asObject(record.payload) ?? {};
      if (!eventName) {
        return;
      }

      if (eventName === runtimeEventNames.configChanged) {
        configValue = cloneValue(asObject(payload.config) ?? {});
        for (const listener of Array.from(configListeners)) {
          try {
            listener(cloneValue(configValue));
          } catch {
            // ignore
          }
        }
        return;
      }

      if (eventName === runtimeEventNames.audioState) {
        emitAudioState(payload.state ?? null);
        return;
      }

      if (eventName === runtimeEventNames.audioTime) {
        const time = typeof payload.time === 'number' && Number.isFinite(payload.time) ? payload.time : 0;
        for (const listener of Array.from(audioTimeListeners)) {
          try {
            listener(time);
          } catch {
            // ignore
          }
        }
        return;
      }

      if (eventName === runtimeEventNames.audioEnded) {
        for (const listener of Array.from(audioEndedListeners)) {
          try {
            listener();
          } catch {
            // ignore
          }
        }
        return;
      }

      if (eventName === runtimeEventNames.audioLoadProgress) {
        const progress =
          typeof payload.progress === 'number' && Number.isFinite(payload.progress)
            ? payload.progress
            : 0;
        for (const listener of Array.from(audioLoadProgressListeners)) {
          try {
            listener(progress);
          } catch {
            // ignore
          }
        }
        return;
      }

      if (eventName === runtimeEventNames.audioError) {
        const message =
          typeof payload.message === 'string' ? payload.message : String(payload.message ?? '');
        for (const listener of Array.from(audioErrorListeners)) {
          try {
            listener(message);
          } catch {
            // ignore
          }
        }
        return;
      }

      if (eventName === runtimeEventNames.navigationChanged) {
        emitNavigationSnapshot(payload.snapshot ?? null);
        return;
      }

      if (eventName === runtimeEventNames.visualizerSpectrum) {
        audioSpectrum = cloneValue(payload.spectrum ?? null);
        return;
      }

      if (eventName === runtimeEventNames.visualizerFramePre) {
        audioSpectrumFramePre = cloneValue(payload.frame ?? null);
        return;
      }

      if (eventName === runtimeEventNames.visualizerFramePost) {
        audioSpectrumFramePost = cloneValue(payload.frame ?? null);
        return;
      }

      return;
    }

    const op = asNonEmptyString(record.op);
    if (!op) return;

    if (
      op === 'capability.invoke.response' ||
      op === 'session.open.response' ||
      op === 'session.close.response' ||
      op === 'stream.open.response'
    ) {
      const requestId = asNonEmptyString(record.requestId);
      const pendingEntry = requestId ? pending.get(requestId) : null;
      if (!pendingEntry) return;
      pending.delete(requestId as string);
      pendingEntry.resolve(record);
      return;
    }

    if (op === 'runtime.init') {
      runtimeInit = cloneValue(record);
      postMessage({ ...baseEnvelope(), op: 'runtime.init.ack' });
      return;
    }

    if (op === 'runtime.activate') {
      runtimeActivate = cloneValue(record);
      postMessage({ ...baseEnvelope(), op: 'runtime.activate.ack' });
      void executeCommand(record as unknown as RuntimeActivate).catch((error) => {
        postMessage({
          ...baseEnvelope(),
          op: 'runtime.error',
          fatal: true,
          message: error instanceof Error ? error.message : String(error),
        });
        emitCommandResult(false, error);
      });
      return;
    }

    if (op === 'runtime.health.request') {
      postMessage({
        ...baseEnvelope(),
        op: 'runtime.health.response',
        requestId: record.requestId,
        ready: active,
        status: active ? 'healthy' : 'degraded',
      });
    }
  });

  postMessage(runtimeHello);
}

export async function runPmpmBridgeWorkerCommand(
  options: RunPmpmBridgeWorkerCommandOptions,
  deps: PmpmBridgeWorkerCommandRuntimeDeps = {}
): Promise<void> {
  if (typeof window === 'undefined') {
    throw new Error('Bridge worker command runtime requires a browser runtime');
  }

  const hostLabel = options.hostLabel ?? 'PluginCommandWorker';
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS));
  const now = deps.now ?? (() => Date.now());
  const createObjectUrl = deps.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectUrl = deps.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));

  const runtimeInstanceId = `${options.pluginId}:command:${now()}:${Math.random().toString(16).slice(2)}`;
  const permissions = getPmpmPluginEffectivePermissions(options.pluginId);
  const plugin = getInstalledPmpmPlugin(options.pluginId);
  const entryCode = await readVerifiedPmpmPluginEntryCode(options.pluginId);
  const initialConfig = readPmpmPluginConfig(options.pluginId);

  const api = createPluginMountApi({
    pluginId: options.pluginId,
    hostLabel,
    permissions,
    audioService: options.audioService,
    commands: options.commands,
    navigation: options.navigation,
    keybindings: options.keybindings,
  });

  const runtimeHello = buildPmpmRuntimeHelloSnapshot({
    pluginId: options.pluginId,
    runtimeId: options.runtimeId,
    runtimeInstanceId,
    runtimeKind: 'extension-host',
    carrier: 'dedicated-worker',
    supportsViewMount: false,
  });

  const runtimeInit = buildPmpmRuntimeInitSnapshot({
    pluginId: options.pluginId,
    runtimeId: options.runtimeId,
    runtimeInstanceId,
    permissions,
    manifestPermissions: plugin?.manifest.permissions,
    deniedPermissions: plugin?.deniedPermissions,
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
  });

  const activateBase = buildPmpmRuntimeActivateSnapshot({
    pluginId: options.pluginId,
    runtimeId: options.runtimeId,
    runtimeInstanceId,
    kind: 'command',
    surfaceId: options.commandId,
    commandArgs: options.args,
  });

  const runtimeActivate: RuntimeActivate = {
    ...activateBase,
    payload: {
      ...(asObject(activateBase.payload) ?? {}),
      commandId: options.commandId,
      args: options.args,
      permissions: Array.from(permissions),
      entryCode,
      initialConfig,
      initialAudioState: permissions.has('api:audio-state') ? options.audioService.getState() : null,
      initialAudioSpectrum:
        permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrum === 'function'
          ? api.visualizer.getSpectrum()
          : null,
      initialAudioSpectrumFramePre:
        permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrumFrame === 'function'
          ? api.visualizer.getSpectrumFrame({ tap: 'pre-dsp' })
          : null,
      initialAudioSpectrumFramePost:
        permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrumFrame === 'function'
          ? api.visualizer.getSpectrumFrame({ tap: 'post-dsp' })
          : null,
      initialNavigation:
        permissions.has('api:navigation') && typeof options.navigation.getSnapshot === 'function'
          ? options.navigation.getSnapshot()
          : null,
      hostInfo: permissions.has('api:host')
        ? {
            pluginId: options.pluginId,
            hostLabel,
            hostApiVersion: HOST_API_VERSION,
            appVersion: APP_VERSION,
            runtime: isTauriRuntime() ? 'tauri' : 'web',
          }
        : null,
    },
  };

  const workerSource = buildWorkerBootstrapSource(runtimeHello);
  const workerUrl = createObjectUrl(new Blob([workerSource], { type: 'text/javascript' }));
  const createWorker =
    deps.createWorker ??
    ((scriptUrl: string, workerOptions: { type: 'module'; name?: string }) =>
      new Worker(scriptUrl, workerOptions) as unknown as WorkerLike);
  const worker = createWorker(
    workerUrl,
    { type: 'module', name: `pmpm-bridge:${options.pluginId}:${options.commandId}` },
    runtimeHello
  );

  const { port, dispose: disposePort } = buildWorkerPort(worker);
  let settleCommand!: () => void;
  let failCommand!: (error: Error) => void;
  const commandResult = new Promise<void>((resolve, reject) => {
    settleCommand = resolve;
    failCommand = reject;
  });
  const session = createRuntimeBridgeHostSession({
    pluginId: options.pluginId,
    runtimeId: options.runtimeId,
    runtimeInstanceId,
    runtimeKind: 'extension-host',
    carrier: 'dedicated-worker',
    api,
    permissions,
    port,
    runtimeInit,
    runtimeActivate,
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
    requestTimeoutMs: timeoutMs,
    onRuntimeEvent: (message) => {
      const payload = asObject(message.payload) ?? {};

      if (message.eventName === RUNTIME_EVENT_NAMES.permissionDenied) {
        const capability = typeof payload.capability === 'string' ? payload.capability : '';
        const action = typeof payload.action === 'string' ? payload.action : '';
        if (capability && action) {
          recordPmpmPermissionDenied({
            pluginId: options.pluginId,
            hostLabel,
            capability,
            action,
          });
        }
        return;
      }

      if (message.eventName === RUNTIME_EVENT_NAMES.commandResult) {
        if (payload.ok === true) {
          settleCommand();
          return;
        }
        if (payload.ok === false) {
          failCommand(new Error(typeof payload.message === 'string' ? payload.message : 'Plugin command failed'));
        }
      }
    },
  });

  const onWorkerError: WorkerEventListener = (event) => {
    failCommand(new Error(readErrorMessage(event.error ?? event.message ?? 'Plugin worker error')));
  };

  worker.addEventListener('error', onWorkerError);

  const disposeRuntimeEvents = bindHostRuntimeEventChannel({
    permissions,
    audioService: options.audioService,
    navigation: options.navigation,
    emitRuntimeEvent: (eventName, payload) => session.emitRuntimeEvent(eventName, payload),
    subscribeConfig: permissions.has('storage:local')
      ? (listener) => subscribePmpmPluginConfig(options.pluginId, listener)
      : undefined,
    getSpectrum:
      permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrum === 'function'
        ? () => api.visualizer.getSpectrum()
        : undefined,
    getSpectrumFrame:
      permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrumFrame === 'function'
        ? (eventOptions) => api.visualizer.getSpectrumFrame(eventOptions)
        : undefined,
  });

  let disposeReason = 'runtime-command-finished';
  let crashRecorded = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const markCrash = (error: unknown) => {
    if (crashRecorded) return;
    crashRecorded = true;
    recordPmpmPluginCrash(options.pluginId, error, 'command');
  };

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        disposeReason = 'runtime-unresponsive';
        try {
          recordPmpmAuditEvent({
            type: 'runtime-unresponsive',
            pluginId: options.pluginId,
            surface: 'command',
            timeoutMs,
          });
        } catch {
          // ignore
        }
        reject(new Error(`Plugin command timeout (${timeoutMs}ms)`));
      }, timeoutMs);
    });

    await Promise.race([
      (async () => {
        await session.start();
        await commandResult;
      })(),
      timeoutPromise,
    ]);
  } catch (error) {
    disposeReason = 'runtime-crash';
    markCrash(error);
    throw error;
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
    disposeRuntimeEvents();
    worker.removeEventListener('error', onWorkerError);
    await session.dispose(disposeReason);
    disposePort();
    worker.terminate();
    revokeObjectUrl(workerUrl);
  }
}
