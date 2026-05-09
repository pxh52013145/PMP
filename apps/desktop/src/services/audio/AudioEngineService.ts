import type { ScopedEventBus } from '../../kernel';
import { createServiceToken } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { getTelemetryLogger } from '../telemetry/TelemetryService';
import { invokeWithTelemetry } from '../telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import type { RuntimeCapsuleManagerService } from '../runtime-capsules';
import { LazyAudioTransportService } from './LazyAudioTransportService';
import { NativeAudioService } from './NativeAudioService';
import { NoopAudioService } from './NoopAudioService';
import type { AudioRobustnessSnapshot, IAudioService, PlaybackState } from './types';
import {
  recordStartupMemoryCheckpoint,
  setStartupMemoryTraceFlag,
} from '../../modules/startup/startupMemoryTrace';

export type AudioEngineType = 'native';

export type AudioEngineSnapshot = {
  audioService: IAudioService;
  engineType: AudioEngineType;
  isNativeAvailable: boolean;
};

export interface AudioEngineService {
  getSnapshot(): AudioEngineSnapshot;
  setEngineType(next: AudioEngineType): void;
  destroy(): void;
}

export const AUDIO_ENGINE_SERVICE_TOKEN = createServiceToken<AudioEngineService>('service.audio-engine');

type AudioEngineMode = 'real' | 'noop';

function isTimeUpdateListenerAvailable(service: IAudioService): service is IAudioService & {
  onTimeUpdate: (cb: (time: number) => void) => () => void;
} {
  return typeof service.onTimeUpdate === 'function';
}

function isEndedListenerAvailable(service: IAudioService): service is IAudioService & {
  onEnded: (cb: () => void) => () => void;
} {
  return typeof service.onEnded === 'function';
}

function isErrorListenerAvailable(service: IAudioService): service is IAudioService & {
  onError: (cb: (error: Error) => void) => () => void;
} {
  return typeof service.onError === 'function';
}

function isRobustnessListenerAvailable(service: IAudioService): service is IAudioService & {
  onRobustnessSnapshot: (cb: (snapshot: AudioRobustnessSnapshot) => void) => () => void;
} {
  return typeof service.onRobustnessSnapshot === 'function';
}

function readTelemetryErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function shouldTaskbarShowPauseIcon(playbackState: PlaybackState): boolean {
  return (
    playbackState === 'playing' ||
    playbackState === 'buffering' ||
    playbackState === 'loading'
  );
}

export class DefaultAudioEngineService implements AudioEngineService {
  private readonly telemetry = getTelemetryLogger('audio', 'AudioEngineService');
  private readonly mode: AudioEngineMode;
  private readonly taskbarMediaControlsEnabled: boolean;
  private engineType: AudioEngineType;
  private isNativeAvailable: boolean;
  private audioService: IAudioService;
  private unlistenTaskbarControls: null | (() => void) = null;
  private taskbarPlaybackIconShowsPause: boolean | null = null;

  private unsubscribeStateChange: null | (() => void) = null;
  private unsubscribeTimeUpdate: null | (() => void) = null;
  private unsubscribeEnded: null | (() => void) = null;
  private unsubscribeError: null | (() => void) = null;
  private unsubscribeRobustness: null | (() => void) = null;

  constructor(
    private readonly events: ScopedEventBus<AppEvents>,
    options: {
      mode?: AudioEngineMode;
      enableTaskbarMediaControls?: boolean;
      runtimeCapsuleManager?: RuntimeCapsuleManagerService | null;
    } = {}
  ) {
    this.mode = options.mode ?? 'real';
    this.taskbarMediaControlsEnabled = options.enableTaskbarMediaControls !== false;
    this.isNativeAvailable = this.mode === 'real' ? isTauriRuntime() : false;
    this.engineType = 'native';
    this.audioService = (() => {
      if (this.mode !== 'real') return new NoopAudioService();
      if (!this.isNativeAvailable) return new NoopAudioService();
      return new LazyAudioTransportService({
        runtimeCapsuleManager: options.runtimeCapsuleManager,
        createTransport: () => new NativeAudioService(),
        onTransportCreated: () => {
          setStartupMemoryTraceFlag('nativeAudioConstructed');
          recordStartupMemoryCheckpoint('audio.native.constructed');
          this.events.emit('audio/engineChanged', {
            engineType: this.engineType,
            isNativeAvailable: this.isNativeAvailable,
          });
        },
      });
    })();

    this.attachServiceListeners();
    if (this.taskbarMediaControlsEnabled) {
      this.setupTaskbarMediaControls();
    }

    this.events.emit('audio/engineChanged', {
      engineType: this.engineType,
      isNativeAvailable: this.isNativeAvailable,
    });
  }

  getSnapshot(): AudioEngineSnapshot {
    return {
      audioService: this.audioService,
      engineType: this.engineType,
      isNativeAvailable: this.isNativeAvailable,
    };
  }

  setEngineType(next: AudioEngineType): void {
    void next;
  }

  destroy(): void {
    this.detachServiceListeners();
    try {
      this.audioService.destroy();
    } catch (err) {
      void err;
    }
    try {
      this.unlistenTaskbarControls?.();
    } catch {
      // ignore
    } finally {
      this.unlistenTaskbarControls = null;
    }
  }

  private detachServiceListeners(): void {
    try {
      this.unsubscribeStateChange?.();
    } catch {
      // ignore
    } finally {
      this.unsubscribeStateChange = null;
    }

    try {
      this.unsubscribeTimeUpdate?.();
    } catch {
      // ignore
    } finally {
      this.unsubscribeTimeUpdate = null;
    }

    try {
      this.unsubscribeEnded?.();
    } catch {
      // ignore
    } finally {
      this.unsubscribeEnded = null;
    }

    try {
      this.unsubscribeError?.();
    } catch {
      // ignore
    } finally {
      this.unsubscribeError = null;
    }

    try {
      this.unsubscribeRobustness?.();
    } catch {
      // ignore
    } finally {
      this.unsubscribeRobustness = null;
    }
  }

  private attachServiceListeners(): void {
    this.detachServiceListeners();

    this.unsubscribeStateChange = this.audioService.onStateChange((state) => {
      this.events.emit('audio/stateChanged', state);
      this.syncTaskbarPlaybackIcon(state.playbackState);
    });

    if (isTimeUpdateListenerAvailable(this.audioService)) {
      this.unsubscribeTimeUpdate = this.audioService.onTimeUpdate((time) => {
        this.events.emit('audio/timeUpdated', { time });
      });
    }

    if (isEndedListenerAvailable(this.audioService)) {
      this.unsubscribeEnded = this.audioService.onEnded(() => {
        this.events.emit('audio/ended', null);
      });
    }

    if (isErrorListenerAvailable(this.audioService)) {
      this.unsubscribeError = this.audioService.onError((error) => {
        const maybeCoded = error as Error & { code?: string };
        const code = maybeCoded?.code;
        const messageText = error?.message ?? String(error);

        this.events.emit('audio/error', {
          message: messageText,
          code,
          engineType: this.engineType,
        });

        if (this.mode !== 'real') return;

        const isNoTrackLoaded =
          messageText.includes('No track loaded') &&
          (code === 'NATIVE_AUDIO_PLAY_FAILED' ||
            code === 'NATIVE_AUDIO_PAUSE_FAILED' ||
            code === 'NATIVE_AUDIO_SEEK_FAILED');
        if (isNoTrackLoaded) {
          this.telemetry.warn('audio.engine.native-transient', {
            message: readTelemetryErrorMessage(error),
            fields: {
              code: code ?? null,
            },
          });
          return;
        }

        const isTrackPathIssue =
          code === 'NATIVE_TRACK_PATH_MISSING' ||
          code === 'NATIVE_TRACK_PATH_NOT_ABSOLUTE' ||
          messageText.includes('Track path is missing') ||
          messageText.includes('Failed to open file') ||
          messageText.includes('requires an absolute file path');

        if (isTrackPathIssue) {
          this.telemetry.warn('audio.engine.track-path.failed', {
            message: readTelemetryErrorMessage(error),
            fields: {
              code: code ?? null,
            },
          });
          void import('@tauri-apps/api/dialog')
            .then(({ message }) =>
              message(
                `Native audio cannot play this track.\n\nReason: ${messageText}\n\nFix: re-add the track via the Music Library folder scan (Tauri dialog) so it has an absolute file path.`,
                { title: 'Audio Engine', type: 'warning' }
              )
            )
            .catch((dialogError) => {
              this.telemetry.warn('audio.engine.dialog.track-warning.failed', {
                message: readTelemetryErrorMessage(dialogError),
              });
            });
          return;
        }

        this.telemetry.warn('audio.engine.native-error', {
          message: readTelemetryErrorMessage(error),
          fields: {
            code: code ?? null,
          },
        });
        void import('@tauri-apps/api/dialog')
          .then(({ message }) =>
            message(`Native audio error: ${messageText}`, {
              title: 'Audio Engine',
              type: 'warning',
            })
          )
          .catch((dialogError) => {
            this.telemetry.warn('audio.engine.dialog.warning.failed', {
              message: readTelemetryErrorMessage(dialogError),
            });
          });
      });
    }

    if (isRobustnessListenerAvailable(this.audioService)) {
      this.unsubscribeRobustness = this.audioService.onRobustnessSnapshot((snapshot) => {
        this.events.emit('audio/robustnessUpdated', snapshot);
      });
    }
  }

  private syncTaskbarPlaybackIcon(
    playbackState: PlaybackState,
    options: { force?: boolean } = {}
  ): void {
    if (!this.taskbarMediaControlsEnabled) return;
    if (this.mode !== 'real') return;
    if (!isTauriRuntime()) return;

    const showPause = shouldTaskbarShowPauseIcon(playbackState);
    if (!options.force && this.taskbarPlaybackIconShowsPause === showPause) {
      return;
    }
    this.taskbarPlaybackIconShowsPause = showPause;

    void invokeWithTelemetry(
      'taskbar_thumbbar_sync_playback_state',
      { playbackState },
      {
        moduleId: 'windowing',
        component: 'AudioEngineService',
        event: 'window.taskbar.thumbbar.playback-icon.sync',
        successLevel: 'debug',
        failureLevel: 'warn',
        slowThresholdMs: 60,
      }
    ).catch(() => {
      this.taskbarPlaybackIconShowsPause = null;
    });
  }

  private setupTaskbarMediaControls(): void {
    if (this.mode !== 'real') return;
    if (!isTauriRuntime()) return;

    let unlisten: null | (() => void) = null;
    let disposed = false;
    let lastAction: string | null = null;
    let lastActionAtMs = 0;

    type Payload = { action?: string };

    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<Payload>('taskbar-media-control', (event) => {
          const action = event.payload?.action;
          if (!action) return;

          const now = Date.now();
          if (lastAction === action && now - lastActionAtMs < 200) {
            return;
          }
          lastAction = action;
          lastActionAtMs = now;

          const service = this.audioService;
          if (!service) return;

          if (action === 'previous') {
            void service.playPrevious().catch((err) => {
              this.telemetry.error('audio.taskbar.previous.failed', {
                message: readTelemetryErrorMessage(err),
              });
            });
            return;
          }
          if (action === 'next') {
            void service.playNext().catch((err) => {
              this.telemetry.error('audio.taskbar.next.failed', {
                message: readTelemetryErrorMessage(err),
              });
            });
            return;
          }
          if (action === 'stop') {
            try {
              this.syncTaskbarPlaybackIcon('stopped', { force: true });
              service.stop();
            } catch (err) {
              this.syncTaskbarPlaybackIcon(service.getState().playbackState, { force: true });
              this.telemetry.error('audio.taskbar.stop.failed', {
                message: readTelemetryErrorMessage(err),
              });
            }
            return;
          }
          if (action === 'playPause') {
            const state = service.getState();
            if (
              state.playbackState === 'playing' ||
              state.playbackState === 'buffering' ||
              state.playbackState === 'loading'
            ) {
              this.syncTaskbarPlaybackIcon('paused', { force: true });
              try {
                // Do not extract the method, otherwise `this` is lost for class-based services.
                const maybePromise = (service as unknown as { pause?: () => unknown }).pause?.call(
                  service
                );
                const thenable = maybePromise as { then?: unknown; catch?: unknown } | undefined;
                if (
                  thenable &&
                  typeof thenable.then === 'function' &&
                  typeof thenable.catch === 'function'
                ) {
                  void (thenable.catch as (cb: (err: unknown) => void) => unknown)((err: unknown) => {
                    this.syncTaskbarPlaybackIcon(service.getState().playbackState, { force: true });
                    this.telemetry.error('audio.taskbar.pause.failed', {
                      message: readTelemetryErrorMessage(err),
                    });
                  });
                }
              } catch (err) {
                this.syncTaskbarPlaybackIcon(service.getState().playbackState, { force: true });
                this.telemetry.error('audio.taskbar.pause.failed', {
                  message: readTelemetryErrorMessage(err),
                });
              }
              return;
            }

            if (!state.currentTrack && state.queue.length > 0) {
              const index = state.currentIndex >= 0 ? state.currentIndex : 0;
              this.syncTaskbarPlaybackIcon('loading', { force: true });
              void service.playTrackAtIndex(index).catch((err) => {
                this.syncTaskbarPlaybackIcon(service.getState().playbackState, { force: true });
                this.telemetry.error('audio.taskbar.play-track-index.failed', {
                  message: readTelemetryErrorMessage(err),
                  fields: {
                    index,
                  },
                });
              });
              return;
            }

            if (state.currentTrack) {
              this.syncTaskbarPlaybackIcon('loading', { force: true });
            }
            void service.play().catch((err) => {
              this.syncTaskbarPlaybackIcon(service.getState().playbackState, { force: true });
              this.telemetry.error('audio.taskbar.play.failed', {
                message: readTelemetryErrorMessage(err),
              });
            });
          }
        })
      )
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch((err) => {
        this.telemetry.warn('audio.taskbar.listener.failed', {
          message: readTelemetryErrorMessage(err),
        });
      });

    this.unlistenTaskbarControls = () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }
}
