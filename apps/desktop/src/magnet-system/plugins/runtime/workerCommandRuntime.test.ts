import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeHello } from '@pixel-matrix/plugin-platform-contracts';
import type { PluginMountApi } from '../host-api';
import { runPmpmBridgeWorkerCommand } from './workerCommandRuntime';
import * as pluginConfigModule from '../pluginConfig';
import * as pluginHostApiModule from '../pluginHostApi';
import * as pmpmModule from '../pmpm';
import * as pmpmRuntimeModule from '../pmpmRuntime';

class ScriptedWorker {
  private readonly listeners = {
    message: new Set<(event: { data?: unknown }) => void>(),
    error: new Set<(event: { message?: string; error?: unknown }) => void>(),
  };

  constructor(
    runtimeHello: RuntimeHello,
    private readonly onPostMessage: (message: unknown, worker: ScriptedWorker) => void
  ) {
    queueMicrotask(() => {
      this.emitMessage(runtimeHello);
    });
  }

  postMessage(message: unknown): void {
    this.onPostMessage(message, this);
  }

  terminate(): void {}

  addEventListener(type: 'message' | 'error', listener: (event: { data?: unknown; message?: string; error?: unknown }) => void): void {
    this.listeners[type].add(listener);
  }

  removeEventListener(type: 'message' | 'error', listener: (event: { data?: unknown; message?: string; error?: unknown }) => void): void {
    this.listeners[type].delete(listener);
  }

  emitMessage(data: unknown): void {
    for (const listener of Array.from(this.listeners.message)) {
      listener({ data });
    }
  }
}

function createStubApi(configState: Record<string, unknown>): PluginMountApi {
  return {
    host: {
      getInfo: vi.fn(() => null),
      listPermissions: vi.fn(() => []),
      hasPermission: vi.fn(() => false),
      listCapabilities: vi.fn(async () => [
        { id: 'host.pmp.navigation', version: '1.0.0' },
        { id: 'host.pmp.storage.config', version: '1.0.0' },
      ]),
      invokeCapability: vi.fn(async () => ({ ok: true })),
      openStream: vi.fn(async () => null),
      openSession: vi.fn(async () => null),
      closeSession: vi.fn(async () => undefined),
    },
    audio: {
      getState: vi.fn(() => ({ playbackState: 'paused' })),
      onStateChange: vi.fn(() => () => {}),
      onTimeUpdate: vi.fn(() => () => {}),
      onEnded: vi.fn(() => () => {}),
      onLoadProgress: vi.fn(() => () => {}),
      onError: vi.fn(() => () => {}),
      getCover: vi.fn(async () => null),
      play: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      stop: vi.fn(() => undefined),
      seek: vi.fn(() => undefined),
      setVolume: vi.fn(() => undefined),
      toggleMute: vi.fn(() => undefined),
      playNext: vi.fn(async () => undefined),
      playPrevious: vi.fn(async () => undefined),
      playTrackAtIndex: vi.fn(async () => undefined),
      getPlayMode: vi.fn(() => 'sequence'),
      setPlayMode: vi.fn(() => undefined),
    },
    visualizer: {
      getSpectrum: vi.fn(() => null),
      getSpectrumFrame: vi.fn(() => null),
      onSpectrum: vi.fn(() => () => {}),
      onSpectrumFrame: vi.fn(() => () => {}),
    },
    navigation: {
      navigateTo: vi.fn(() => undefined),
      goBack: vi.fn(() => undefined),
      getSnapshot: vi.fn(() => ({ currentIndex: 1 })),
      onChange: vi.fn(() => () => {}),
    },
    config: {
      get: vi.fn(() => ({ ...configState })),
      onChange: vi.fn(() => () => {}),
      set: vi.fn((next: Record<string, unknown>) => {
        Object.keys(configState).forEach((key) => delete configState[key]);
        Object.assign(configState, next);
      }),
      patch: vi.fn((next: Record<string, unknown>) => {
        Object.assign(configState, next);
      }),
      reset: vi.fn(() => {
        Object.keys(configState).forEach((key) => delete configState[key]);
      }),
    },
    window: {
      open: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    },
  } as unknown as PluginMountApi;
}

function createAudioServiceHarness() {
  let onStateChangeListener: ((state: unknown) => void) | null = null;
  let onTimeUpdateListener: ((time: number) => void) | null = null;
  let onEndedListener: (() => void) | null = null;
  let onLoadProgressListener: ((progress: number) => void) | null = null;
  let onErrorListener: ((error: unknown) => void) | null = null;

  return {
    service: {
      getState: vi.fn(() => ({ playbackState: 'paused' })),
      onStateChange: vi.fn((cb: (state: unknown) => void) => {
        onStateChangeListener = cb;
        return () => {
          if (onStateChangeListener === cb) onStateChangeListener = null;
        };
      }),
      onTimeUpdate: vi.fn((cb: (time: number) => void) => {
        onTimeUpdateListener = cb;
        return () => {
          if (onTimeUpdateListener === cb) onTimeUpdateListener = null;
        };
      }),
      onEnded: vi.fn((cb: () => void) => {
        onEndedListener = cb;
        return () => {
          if (onEndedListener === cb) onEndedListener = null;
        };
      }),
      onLoadProgress: vi.fn((cb: (progress: number) => void) => {
        onLoadProgressListener = cb;
        return () => {
          if (onLoadProgressListener === cb) onLoadProgressListener = null;
        };
      }),
      onError: vi.fn((cb: (error: unknown) => void) => {
        onErrorListener = cb;
        return () => {
          if (onErrorListener === cb) onErrorListener = null;
        };
      }),
      play: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      stop: vi.fn(() => undefined),
      seek: vi.fn(() => undefined),
      setVolume: vi.fn(() => undefined),
      toggleMute: vi.fn(() => undefined),
      playNext: vi.fn(async () => undefined),
      playPrevious: vi.fn(async () => undefined),
      playTrackAtIndex: vi.fn(async () => undefined),
      getPlayMode: vi.fn(() => 'sequence'),
      setPlayMode: vi.fn(() => undefined),
    },
    emitState: (state: unknown) => onStateChangeListener?.(state),
    emitTime: (time: number) => onTimeUpdateListener?.(time),
    emitEnded: () => onEndedListener?.(),
    emitLoadProgress: (progress: number) => onLoadProgressListener?.(progress),
    emitError: (error: unknown) => onErrorListener?.(error),
  };
}

function createNavigationHarness() {
  let onChangeListener: ((snapshot: unknown) => void) | null = null;

  return {
    navigation: {
      navigateTo: vi.fn(() => undefined),
      goBack: vi.fn(() => undefined),
      getSnapshot: vi.fn(() => ({ currentIndex: 1 })),
      subscribe: vi.fn((cb: (snapshot: unknown) => void) => {
        onChangeListener = cb;
        return () => {
          if (onChangeListener === cb) onChangeListener = null;
        };
      }),
    },
    emitChange: (snapshot: unknown) => onChangeListener?.(snapshot),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bridge worker command runtime', () => {
  it('runs a command through the bridge worker and round-trips config mutation', async () => {
    const configState: Record<string, unknown> = { count: 0 };
    const api = createStubApi(configState);

    vi.spyOn(pluginHostApiModule, 'createPluginMountApi').mockReturnValue(api);
    vi.spyOn(pluginConfigModule, 'readPmpmPluginConfig').mockReturnValue({ ...configState });
    vi.spyOn(pluginConfigModule, 'subscribePmpmPluginConfig').mockReturnValue(() => {});
    vi.spyOn(pmpmRuntimeModule, 'readVerifiedPmpmPluginEntryCode').mockResolvedValue(
      'export async function runCommand() {}'
    );
    vi.spyOn(pmpmModule, 'getPmpmPluginEffectivePermissions').mockReturnValue(
      new Set(['api:host', 'storage:local'])
    );
    vi.spyOn(pmpmModule, 'getInstalledPmpmPlugin').mockReturnValue({
      manifest: { permissions: ['api:host', 'storage:local'] },
      deniedPermissions: [],
    } as never);
    const crashSpy = vi.spyOn(pmpmModule, 'recordPmpmPluginCrash').mockImplementation(() => {});

    await runPmpmBridgeWorkerCommand(
      {
        pluginId: 'worker-plugin',
        runtimeId: 'worker.main',
        commandId: 'increment',
        audioService: api.audio as never,
        navigation: api.navigation as never,
      },
      {
        createObjectUrl: () => 'blob:test-worker',
        revokeObjectUrl: () => {},
        createWorker: (_scriptUrl, _options, runtimeHello) =>
          new ScriptedWorker(runtimeHello, (message, worker) => {
            const envelope = message as Record<string, unknown>;

            if (envelope.op === 'runtime.init') {
              worker.emitMessage({
                bridgeVersion: runtimeHello.bridgeVersion,
                op: 'runtime.init.ack',
                pluginId: runtimeHello.pluginId,
                runtimeId: runtimeHello.runtimeId,
                runtimeInstanceId: runtimeHello.runtimeInstanceId,
              });
              return;
            }

            if (envelope.op === 'runtime.activate') {
              worker.emitMessage({
                bridgeVersion: runtimeHello.bridgeVersion,
                op: 'runtime.activate.ack',
                pluginId: runtimeHello.pluginId,
                runtimeId: runtimeHello.runtimeId,
                runtimeInstanceId: runtimeHello.runtimeInstanceId,
              });
              queueMicrotask(() => {
                worker.emitMessage({
                  protocolVersion: '1.0',
                  op: 'capability.invoke.request',
                  requestId: 'cfg-patch-1',
                  capabilityId: 'host.pmp.storage.config',
                  method: 'patch',
                  payload: {
                    value: {
                      count: 1,
                      lastCommand: 'increment',
                    },
                  },
                });
              });
              return;
            }

            if (envelope.op === 'capability.invoke.response' && envelope.requestId === 'cfg-patch-1') {
              worker.emitMessage({
                type: 'pmpm.runtime.command.result',
                ok: true,
              });
            }
          }),
      }
    );

    expect(api.config.patch).toHaveBeenCalledWith({
      count: 1,
      lastCommand: 'increment',
    });
    expect(configState).toEqual({
      count: 1,
      lastCommand: 'increment',
    });
    expect(crashSpy).not.toHaveBeenCalled();
  });

  it('exposes audio/navigation/window parity through bridge protocol dispatch', async () => {
    const api = createStubApi({ count: 0 });

    vi.spyOn(pluginHostApiModule, 'createPluginMountApi').mockReturnValue(api);
    vi.spyOn(pluginConfigModule, 'readPmpmPluginConfig').mockReturnValue({ count: 0 });
    vi.spyOn(pluginConfigModule, 'subscribePmpmPluginConfig').mockReturnValue(() => {});
    vi.spyOn(pmpmRuntimeModule, 'readVerifiedPmpmPluginEntryCode').mockResolvedValue(
      'export async function runCommand() {}'
    );
    vi.spyOn(pmpmModule, 'getPmpmPluginEffectivePermissions').mockReturnValue(
      new Set(['api:audio-control', 'api:audio-state', 'api:navigation', 'api:window'])
    );
    vi.spyOn(pmpmModule, 'getInstalledPmpmPlugin').mockReturnValue({
      manifest: { permissions: ['api:audio-control', 'api:audio-state', 'api:navigation', 'api:window'] },
      deniedPermissions: [],
    } as never);

    await runPmpmBridgeWorkerCommand(
      {
        pluginId: 'worker-plugin',
        runtimeId: 'worker.main',
        commandId: 'parity-check',
        audioService: api.audio as never,
        navigation: api.navigation as never,
      },
      {
        createObjectUrl: () => 'blob:test-worker',
        revokeObjectUrl: () => {},
        createWorker: (_scriptUrl, _options, runtimeHello) =>
          new ScriptedWorker(runtimeHello, (message, worker) => {
            const envelope = message as Record<string, unknown>;

            if (envelope.op === 'runtime.init') {
              worker.emitMessage({
                bridgeVersion: runtimeHello.bridgeVersion,
                op: 'runtime.init.ack',
                pluginId: runtimeHello.pluginId,
                runtimeId: runtimeHello.runtimeId,
                runtimeInstanceId: runtimeHello.runtimeInstanceId,
              });
              return;
            }

            if (envelope.op === 'runtime.activate') {
              expect(envelope.payload).toMatchObject({
                initialAudioState: { playbackState: 'paused' },
                initialNavigation: { currentIndex: 1 },
              });

              worker.emitMessage({
                bridgeVersion: runtimeHello.bridgeVersion,
                op: 'runtime.activate.ack',
                pluginId: runtimeHello.pluginId,
                runtimeId: runtimeHello.runtimeId,
                runtimeInstanceId: runtimeHello.runtimeInstanceId,
              });

              queueMicrotask(() => {
                worker.emitMessage({
                  protocolVersion: '1.0',
                  op: 'capability.invoke.request',
                  requestId: 'audio-play-1',
                  capabilityId: 'host.pmp.audio-engine.playback',
                  method: 'play',
                });
              });
              return;
            }

            if (envelope.op === 'capability.invoke.response' && envelope.requestId === 'audio-play-1') {
              worker.emitMessage({
                protocolVersion: '1.0',
                op: 'capability.invoke.request',
                requestId: 'nav-1',
                capabilityId: 'host.pmp.navigation',
                method: 'navigateTo',
                payload: { page: 'home' },
              });
              return;
            }

            if (envelope.op === 'capability.invoke.response' && envelope.requestId === 'nav-1') {
              worker.emitMessage({
                protocolVersion: '1.0',
                op: 'capability.invoke.request',
                requestId: 'window-1',
                capabilityId: 'host.pmp.shell.window',
                method: 'open',
                payload: { windowId: 'demo-window' },
              });
              return;
            }

            if (envelope.op === 'capability.invoke.response' && envelope.requestId === 'window-1') {
              worker.emitMessage({
                type: 'pmpm.runtime.command.result',
                ok: true,
              });
            }
          }),
      }
    );

    expect(api.audio.play).toHaveBeenCalledTimes(1);
    expect(api.navigation.navigateTo).toHaveBeenCalledWith('home', undefined);
    expect(api.window.open).toHaveBeenCalledWith('demo-window', undefined);
  });

  it('forwards audio/navigation events and visualizer snapshots into the worker carrier', async () => {
    const api = createStubApi({ count: 0 });
    const audioHarness = createAudioServiceHarness();
    const navigationHarness = createNavigationHarness();
    const seenCustomMessages = new Set<string>();
    const getSpectrumMock = vi.fn(() => Uint8Array.from([1, 2, 3]));
    const getSpectrumFrameMock = vi.fn(
      (options?: { tap?: 'pre-dsp' | 'post-dsp' }) => ({
        tap: options?.tap === 'pre-dsp' ? 'pre-dsp' : 'post-dsp',
        sampleRate: 48_000,
        bins: Uint8Array.from(options?.tap === 'pre-dsp' ? [4, 5, 6] : [7, 8, 9]),
      })
    );

    api.visualizer.getSpectrum = getSpectrumMock as never;
    api.visualizer.getSpectrumFrame = getSpectrumFrameMock as never;

    vi.spyOn(pluginHostApiModule, 'createPluginMountApi').mockReturnValue(api);
    vi.spyOn(pluginConfigModule, 'readPmpmPluginConfig').mockReturnValue({ count: 0 });
    vi.spyOn(pluginConfigModule, 'subscribePmpmPluginConfig').mockReturnValue(() => {});
    vi.spyOn(pmpmRuntimeModule, 'readVerifiedPmpmPluginEntryCode').mockResolvedValue(
      'export async function runCommand() {}'
    );
    vi.spyOn(pmpmModule, 'getPmpmPluginEffectivePermissions').mockReturnValue(
      new Set(['api:audio-state', 'api:audio-visual', 'api:navigation'])
    );
    vi.spyOn(pmpmModule, 'getInstalledPmpmPlugin').mockReturnValue({
      manifest: { permissions: ['api:audio-state', 'api:audio-visual', 'api:navigation'] },
      deniedPermissions: [],
    } as never);

    await runPmpmBridgeWorkerCommand(
      {
        pluginId: 'worker-plugin',
        runtimeId: 'worker.main',
        commandId: 'event-parity',
        audioService: audioHarness.service as never,
        navigation: navigationHarness.navigation as never,
        timeoutMs: 2_000,
      },
      {
        createObjectUrl: () => 'blob:test-worker',
        revokeObjectUrl: () => {},
        createWorker: (_scriptUrl, _options, runtimeHello) =>
          new ScriptedWorker(runtimeHello, (message, worker) => {
            const envelope = message as Record<string, unknown>;

            if (typeof envelope.type === 'string' && envelope.type.startsWith('pmpm.runtime.')) {
              seenCustomMessages.add(envelope.type);
              if (
                seenCustomMessages.has('pmpm.runtime.audio.state') &&
                seenCustomMessages.has('pmpm.runtime.audio.time') &&
                seenCustomMessages.has('pmpm.runtime.audio.load-progress') &&
                seenCustomMessages.has('pmpm.runtime.audio.error') &&
                seenCustomMessages.has('pmpm.runtime.audio.ended') &&
                seenCustomMessages.has('pmpm.runtime.navigation.changed') &&
                seenCustomMessages.has('pmpm.runtime.visualizer.spectrum') &&
                seenCustomMessages.has('pmpm.runtime.visualizer.frame.pre') &&
                seenCustomMessages.has('pmpm.runtime.visualizer.frame.post')
              ) {
                worker.emitMessage({
                  type: 'pmpm.runtime.command.result',
                  ok: true,
                });
              }
              return;
            }

            if (envelope.op === 'runtime.init') {
              worker.emitMessage({
                bridgeVersion: runtimeHello.bridgeVersion,
                op: 'runtime.init.ack',
                pluginId: runtimeHello.pluginId,
                runtimeId: runtimeHello.runtimeId,
                runtimeInstanceId: runtimeHello.runtimeInstanceId,
              });
              return;
            }

            if (envelope.op === 'runtime.activate') {
              expect(envelope.payload).toMatchObject({
                initialAudioState: { playbackState: 'paused' },
                initialNavigation: { currentIndex: 1 },
              });
              expect((envelope.payload as Record<string, unknown>).initialAudioSpectrum).toBeInstanceOf(
                Uint8Array
              );

              worker.emitMessage({
                bridgeVersion: runtimeHello.bridgeVersion,
                op: 'runtime.activate.ack',
                pluginId: runtimeHello.pluginId,
                runtimeId: runtimeHello.runtimeId,
                runtimeInstanceId: runtimeHello.runtimeInstanceId,
              });

              queueMicrotask(() => {
                audioHarness.emitState({ playbackState: 'playing' });
                audioHarness.emitTime(12.5);
                audioHarness.emitLoadProgress(0.42);
                audioHarness.emitError('decoder failed');
                audioHarness.emitEnded();
                navigationHarness.emitChange({ currentIndex: 2 });
              });
            }
          }),
      }
    );

    expect(Array.from(seenCustomMessages)).toEqual(
      expect.arrayContaining([
        'pmpm.runtime.audio.state',
        'pmpm.runtime.audio.time',
        'pmpm.runtime.audio.load-progress',
        'pmpm.runtime.audio.error',
        'pmpm.runtime.audio.ended',
        'pmpm.runtime.navigation.changed',
        'pmpm.runtime.visualizer.spectrum',
        'pmpm.runtime.visualizer.frame.pre',
        'pmpm.runtime.visualizer.frame.post',
      ])
    );
  });

  it('records a crash when the worker reports failure', async () => {
    const api = createStubApi({ count: 0 });

    vi.spyOn(pluginHostApiModule, 'createPluginMountApi').mockReturnValue(api);
    vi.spyOn(pluginConfigModule, 'readPmpmPluginConfig').mockReturnValue({ count: 0 });
    vi.spyOn(pluginConfigModule, 'subscribePmpmPluginConfig').mockReturnValue(() => {});
    vi.spyOn(pmpmRuntimeModule, 'readVerifiedPmpmPluginEntryCode').mockResolvedValue(
      'export async function runCommand() {}'
    );
    vi.spyOn(pmpmModule, 'getPmpmPluginEffectivePermissions').mockReturnValue(new Set());
    vi.spyOn(pmpmModule, 'getInstalledPmpmPlugin').mockReturnValue({
      manifest: { permissions: [] },
      deniedPermissions: [],
    } as never);
    const crashSpy = vi.spyOn(pmpmModule, 'recordPmpmPluginCrash').mockImplementation(() => {});

    await expect(
      runPmpmBridgeWorkerCommand(
        {
          pluginId: 'worker-plugin',
          runtimeId: 'worker.main',
          commandId: 'increment',
          audioService: api.audio as never,
          navigation: api.navigation as never,
        },
        {
          createObjectUrl: () => 'blob:test-worker',
          revokeObjectUrl: () => {},
          createWorker: (_scriptUrl, _options, runtimeHello) =>
            new ScriptedWorker(runtimeHello, (message, worker) => {
              const envelope = message as Record<string, unknown>;

              if (envelope.op === 'runtime.init') {
                worker.emitMessage({
                  bridgeVersion: runtimeHello.bridgeVersion,
                  op: 'runtime.init.ack',
                  pluginId: runtimeHello.pluginId,
                  runtimeId: runtimeHello.runtimeId,
                  runtimeInstanceId: runtimeHello.runtimeInstanceId,
                });
                return;
              }

              if (envelope.op === 'runtime.activate') {
                worker.emitMessage({
                  bridgeVersion: runtimeHello.bridgeVersion,
                  op: 'runtime.activate.ack',
                  pluginId: runtimeHello.pluginId,
                  runtimeId: runtimeHello.runtimeId,
                  runtimeInstanceId: runtimeHello.runtimeInstanceId,
                });
                worker.emitMessage({
                  type: 'pmpm.runtime.command.result',
                  ok: false,
                  message: 'boom',
                });
              }
            }),
        }
      )
    ).rejects.toThrow('boom');

    expect(crashSpy).toHaveBeenCalledWith('worker-plugin', expect.any(Error), 'command');
  });
});
