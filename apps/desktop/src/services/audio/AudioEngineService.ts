import type { ScopedEventBus } from '../../kernel';
import { createServiceToken } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { readString, writeString } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { NativeAudioService } from './NativeAudioService';
import { NoopAudioService } from './NoopAudioService';
import type { AudioState, IAudioService, PlayMode } from './types';
import { WebAudioService } from './WebAudioService';

export type AudioEngineType = 'web' | 'native';

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

function readStoredEngineType(): AudioEngineType {
  if (typeof window === 'undefined') {
    return 'web';
  }

  const nativeAvailable = isTauriRuntime();
  const stored = readString(STORAGE_KEYS.AUDIO_ENGINE);
  // Desktop policy: always default to Native when available.
  // WebAudio is kept as a compatibility/debug mode but should never be the startup default on Desktop.
  if (stored === 'web' && nativeAvailable) {
    writeString(STORAGE_KEYS.AUDIO_ENGINE, 'native');
    return 'native';
  }
  if (stored === 'web') return 'web';
  if (stored === 'native' && nativeAvailable) {
    return 'native';
  }

  // Desktop default: prefer Native when available, keep WebAudio as compatibility/debug mode.
  return nativeAvailable ? 'native' : 'web';
}

function persistEngineType(type: AudioEngineType): void {
  if (typeof window === 'undefined') return;
  writeString(STORAGE_KEYS.AUDIO_ENGINE, type);
}

function createServiceForEngine(engine: AudioEngineType): IAudioService {
  if (engine === 'native') {
    return new NativeAudioService();
  }
  return new WebAudioService();
}

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

function safeGetState(service: IAudioService): AudioState | null {
  try {
    return service.getState();
  } catch {
    return null;
  }
}

function tryApplyPreviousState(service: IAudioService, previousState: AudioState): void {
  try {
    service.setVolume(previousState.volume);
  } catch (err) {
    void err;
  }

  try {
    const nextMuted = safeGetState(service)?.muted;
    if (typeof nextMuted === 'boolean' && nextMuted !== previousState.muted) {
      service.toggleMute();
    }
  } catch (err) {
    void err;
  }

  try {
    service.setPlayMode(previousState.playMode as PlayMode);
  } catch (err) {
    void err;
  }

  try {
    if (previousState.queue.length > 0) {
      service.addMultipleToQueue(previousState.queue);
    }
  } catch (err) {
    void err;
  }
}

export class DefaultAudioEngineService implements AudioEngineService {
  private readonly mode: AudioEngineMode;
  private engineType: AudioEngineType;
  private isNativeAvailable: boolean;
  private audioService: IAudioService;
  private unlistenTaskbarControls: null | (() => void) = null;

  private unsubscribeStateChange: null | (() => void) = null;
  private unsubscribeTimeUpdate: null | (() => void) = null;
  private unsubscribeEnded: null | (() => void) = null;
  private unsubscribeError: null | (() => void) = null;

  constructor(
    private readonly events: ScopedEventBus<AppEvents>,
    options: {
      mode?: AudioEngineMode;
      enableTaskbarMediaControls?: boolean;
    } = {}
  ) {
    this.mode = options.mode ?? 'real';
    this.isNativeAvailable = this.mode === 'real' ? isTauriRuntime() : false;
    this.engineType = this.mode === 'real' ? readStoredEngineType() : 'web';
    this.audioService =
      this.mode === 'real' ? createServiceForEngine(this.engineType) : new NoopAudioService();

    this.attachServiceListeners();
    if (options.enableTaskbarMediaControls !== false) {
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
    if (this.mode !== 'real') {
      this.engineType = next;
      this.events.emit('audio/engineChanged', {
        engineType: this.engineType,
        isNativeAvailable: this.isNativeAvailable,
      });
      return;
    }

    if (next === this.engineType) return;

    if (next === 'native' && !isTauriRuntime()) {
      console.info('[AudioEngine] Native audio engine is under development.');
      return;
    }

    const previousService = this.audioService;
    const previousState = safeGetState(previousService);

    this.detachServiceListeners();
    try {
      previousService.destroy();
    } catch (err) {
      void err;
    }

    const nextService = createServiceForEngine(next);
    this.audioService = nextService;
    this.engineType = next;
    this.isNativeAvailable = isTauriRuntime();

    if (previousState) {
      tryApplyPreviousState(nextService, previousState);
    }

    persistEngineType(next);
    this.attachServiceListeners();

    this.events.emit('audio/engineChanged', {
      engineType: this.engineType,
      isNativeAvailable: this.isNativeAvailable,
    });
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
  }

  private attachServiceListeners(): void {
    this.detachServiceListeners();

    this.unsubscribeStateChange = this.audioService.onStateChange((state) => {
      this.events.emit('audio/stateChanged', state);
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
        if (this.engineType !== 'native') return;

        const isTrackPathIssue =
          code === 'NATIVE_TRACK_PATH_MISSING' ||
          code === 'NATIVE_TRACK_PATH_NOT_ABSOLUTE' ||
          messageText.includes('Track path is missing') ||
          messageText.includes('Failed to open file') ||
          messageText.includes('requires an absolute file path');

        if (isTrackPathIssue) {
          console.warn('[AudioEngine] Native audio track error (no fallback):', error);
          void import('@tauri-apps/api/dialog')
            .then(({ message }) =>
              message(
                `Native audio cannot play this track.\n\nReason: ${messageText}\n\nFix: re-add the track via the Music Library folder scan (Tauri dialog) so it has an absolute file path.`,
                { title: 'Audio Engine', type: 'warning' }
              )
            )
            .catch(() => {});
          return;
        }

        console.warn('[AudioEngine] Native audio error, falling back to WebAudio:', error);
        this.setEngineType('web');
        void import('@tauri-apps/api/dialog')
          .then(({ message }) =>
            message(`Native audio error: ${messageText}\n\nFalling back to WebAudio.`, {
              title: 'Audio Engine',
              type: 'warning',
            })
          )
          .catch(() => {});
      });
    }
  }

  private setupTaskbarMediaControls(): void {
    if (this.mode !== 'real') return;
    if (!isTauriRuntime()) return;

    let unlisten: null | (() => void) = null;
    let disposed = false;

    type Payload = { action?: string };

    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<Payload>('taskbar-media-control', (event) => {
          const action = event.payload?.action;
          if (!action) return;

          const service = this.audioService;
          if (!service) return;

          if (action === 'previous') {
            void service.playPrevious().catch((err) => {
              console.error('[Taskbar] playPrevious failed:', err);
            });
            return;
          }
          if (action === 'next') {
            void service.playNext().catch((err) => {
              console.error('[Taskbar] playNext failed:', err);
            });
            return;
          }
          if (action === 'playPause') {
            const state = service.getState();
            if (state.playbackState === 'playing') {
              try {
                const maybePause = (service as unknown as { pause?: () => unknown }).pause;
                const maybePromise = maybePause?.();
                const thenable = maybePromise as { then?: unknown; catch?: unknown } | undefined;
                if (
                  thenable &&
                  typeof thenable.then === 'function' &&
                  typeof thenable.catch === 'function'
                ) {
                  void (thenable.catch as (cb: (err: unknown) => void) => unknown)((err: unknown) => {
                    console.error('[Taskbar] pause failed:', err);
                  });
                }
              } catch (err) {
                console.error('[Taskbar] pause failed:', err);
              }
              return;
            }

            if (!state.currentTrack && state.queue.length > 0) {
              const index = state.currentIndex >= 0 ? state.currentIndex : 0;
              void service.playTrackAtIndex(index).catch((err) => {
                console.error('[Taskbar] playTrackAtIndex failed:', err);
              });
              return;
            }

            void service.play().catch((err) => {
              console.error('[Taskbar] play failed:', err);
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
        console.warn('[Taskbar] Failed to register taskbar media controls listener:', err);
      });

    this.unlistenTaskbarControls = () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }
}

