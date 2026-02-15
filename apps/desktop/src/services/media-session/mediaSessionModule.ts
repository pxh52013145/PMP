import type { AppEvents } from '../../contracts/events';
import type { KernelModule } from '../../kernel';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { AUDIO_ENGINE_SERVICE_TOKEN, type AudioState, type Track } from '../audio';
import { KEYBINDINGS_SERVICE_TOKEN } from '../keybindings';

type MediaSessionActionHandler = Parameters<MediaSession['setActionHandler']>[1];

type WebAudioContext = AudioContext | (AudioContext & { state?: string });

function isMediaSessionAvailable(): boolean {
  if (typeof navigator === 'undefined') return false;
  return typeof navigator.mediaSession !== 'undefined';
}

function isMediaMetadataAvailable(): boolean {
  return typeof MediaMetadata !== 'undefined';
}

function isMainWindowHash(): boolean {
  if (typeof window === 'undefined') return true;
  const hash = window.location.hash ?? '';
  return (
    !hash.startsWith('#/editor/') && !hash.startsWith('#/plugin-window/') && !hash.startsWith('#/vst-manager')
  );
}

function toMediaSessionPlaybackState(state: AudioState): MediaSessionPlaybackState {
  const hasSession = Boolean(state.currentTrack) || (Array.isArray(state.queue) && state.queue.length > 0);
  if (!hasSession) return 'none';

  if (state.playbackState === 'playing') return 'playing';
  if (state.playbackState === 'buffering') return 'paused';
  if (state.playbackState === 'paused') return 'paused';
  if (state.playbackState === 'loading') return 'paused';
  if (state.playbackState === 'stopped') return 'paused';
  if (state.playbackState === 'idle') return 'paused';
  if (state.playbackState === 'error') return 'paused';
  return 'paused';
}

function buildMediaMetadata(track: Track | null): MediaMetadata | null {
  if (!track) return null;
  if (!isMediaMetadataAvailable()) return null;

  const title = track.title ?? '';
  const artist = track.artist ?? track.albumArtist ?? '';
  const album = track.album ?? '';
  const artworkSrc = typeof track.coverUrl === 'string' ? track.coverUrl : '';
  const artwork = artworkSrc ? [{ src: artworkSrc, sizes: '512x512' }] : undefined;

  try {
    return new MediaMetadata({ title, artist, album, artwork });
  } catch {
    return null;
  }
}

function resolveDisplayTrack(state: AudioState): Track | null {
  if (state.currentTrack) return state.currentTrack;
  if (!Array.isArray(state.queue) || state.queue.length === 0) return null;
  const index =
    typeof state.currentIndex === 'number' && state.currentIndex >= 0 && state.currentIndex < state.queue.length
      ? state.currentIndex
      : 0;
  return state.queue[index] ?? null;
}

function safeSetActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler): void {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Some platforms throw for unsupported actions.
  }
}

function safeSetPlaybackState(state: MediaSessionPlaybackState): void {
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    // ignore
  }
}

function safeSetMetadata(metadata: MediaMetadata | null): void {
  try {
    navigator.mediaSession.metadata = metadata;
  } catch {
    // ignore
  }
}

function safeSetPositionState(payload: MediaPositionState): void {
  try {
    if (typeof navigator.mediaSession.setPositionState !== 'function') return;
    navigator.mediaSession.setPositionState(payload);
  } catch {
    // ignore
  }
}

function getAudioContextConstructor():
  | (new (contextOptions?: AudioContextOptions) => WebAudioContext)
  | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown }).AudioContext;
  if (typeof ctor === 'function') return ctor as new (contextOptions?: AudioContextOptions) => WebAudioContext;
  const webkit = (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
  if (typeof webkit === 'function') return webkit as new (contextOptions?: AudioContextOptions) => WebAudioContext;
  return null;
}

class SilentWebAudioKeepalive {
  private ctx: WebAudioContext | null = null;
  private source: OscillatorNode | ConstantSourceNode | null = null;
  private gain: GainNode | null = null;

  async setActive(active: boolean): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (!active) {
      if (!this.ctx) return false;
      try {
        if (typeof this.ctx.suspend === 'function') await this.ctx.suspend();
      } catch {
        // ignore
      }
      return true;
    }

    if (!this.ctx) {
      const AudioContextCtor = getAudioContextConstructor();
      if (!AudioContextCtor) return false;
      try {
        const ctx = new AudioContextCtor();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(ctx.destination);

        const source: OscillatorNode | ConstantSourceNode = (() => {
          const maybeCreateConstantSource = (ctx as unknown as { createConstantSource?: () => ConstantSourceNode })
            .createConstantSource;
          if (typeof maybeCreateConstantSource === 'function') {
            const s = maybeCreateConstantSource.call(ctx);
            s.offset.value = 0;
            return s;
          }

          const osc = ctx.createOscillator();
          osc.frequency.value = 440;
          return osc;
        })();

        source.connect(gain);
        source.start();

        this.ctx = ctx;
        this.gain = gain;
        this.source = source;
      } catch {
        // Unable to create a WebAudio context (or blocked by policy).
        this.ctx = null;
        this.gain = null;
        this.source = null;
        return false;
      }
    }

    try {
      if (typeof this.ctx.resume === 'function') await this.ctx.resume();
    } catch {
      // ignore
    }

    return (this.ctx.state ?? 'running') === 'running';
  }

  destroy(): void {
    try {
      this.source?.stop();
    } catch {
      // ignore
    } finally {
      this.source = null;
    }

    try {
      this.gain?.disconnect();
    } catch {
      // ignore
    } finally {
      this.gain = null;
    }

    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      try {
        void ctx.close();
      } catch {
        // ignore
      }
    }
  }
}

export function createMediaSessionModule(options: { enabled?: boolean } = {}): KernelModule<AppEvents> {
  return {
    id: 'media-session',
    activate: ({ services, events }) => {
      const enabled = options.enabled !== false;
      if (!enabled) return () => {};
      if (!isMainWindowHash()) return () => {};

      // Desktop/Tauri (Windows/WebView2): rely on the native SMTC integration for media keys / OS controls.
      // WebView2 mediaSession + WebAudio keepalive has shown significant memory overhead during playback.
      if (isTauriRuntime() && typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)) {
        return () => {};
      }

      if (!isMediaSessionAvailable()) return () => {};

      const audioEngine = services.getOptional(AUDIO_ENGINE_SERVICE_TOKEN);
      if (!audioEngine) return () => {};
      const audioService = audioEngine.getSnapshot().audioService;

      const keybindings = services.getOptional(KEYBINDINGS_SERVICE_TOKEN);
      keybindings?.setContext('mediaSession.enabled', false);

      const keepalive = new SilentWebAudioKeepalive();
      let keepaliveActivated = false;

      let lastState: AudioState = audioService.getState();
      let lastTime = lastState.currentTime ?? 0;
      let lastPositionUpdatedAtMs = 0;
      let positionUpdateTimer: number | null = null;

      const applyPositionState = (force: boolean) => {
        if (typeof window === 'undefined') return;
        const duration = lastState.duration ?? 0;
        if (!Number.isFinite(duration) || duration <= 0) return;
        const position = Math.max(0, Math.min(lastTime, duration));
        const playbackRate = lastState.playbackState === 'playing' ? 1 : 0;

        const now = Date.now();
        const minIntervalMs = 600;
        if (!force && now - lastPositionUpdatedAtMs < minIntervalMs) {
          if (positionUpdateTimer !== null) return;
          const delay = Math.max(0, minIntervalMs - (now - lastPositionUpdatedAtMs));
          positionUpdateTimer = window.setTimeout(() => {
            positionUpdateTimer = null;
            applyPositionState(true);
          }, delay);
          return;
        }

        lastPositionUpdatedAtMs = now;
        safeSetPositionState({ duration, position, playbackRate });
      };

      const syncFromState = (state: AudioState, { forcePosition }: { forcePosition: boolean }) => {
        lastState = state;
        lastTime = state.currentTime ?? lastTime;

        safeSetPlaybackState(toMediaSessionPlaybackState(state));
        safeSetMetadata(buildMediaMetadata(resolveDisplayTrack(state)));
        applyPositionState(forcePosition);

        const shouldKeepalive = state.playbackState === 'playing';
        void keepalive
          .setActive(shouldKeepalive)
          .then((active) => {
            if (active && !keepaliveActivated) {
              keepaliveActivated = true;
              keybindings?.setContext('mediaSession.enabled', true);
            }
          })
          .catch(() => {});
      };

      const ensurePlay = async () => {
        const state = audioService.getState();
        if (state.playbackState === 'playing') return;

        if (!state.currentTrack && state.queue.length > 0) {
          const index =
            typeof state.currentIndex === 'number' && state.currentIndex >= 0 && state.currentIndex < state.queue.length
              ? state.currentIndex
              : 0;
          await audioService.playTrackAtIndex(index);
          return;
        }

        await audioService.play();
      };

      const ensurePause = () => {
        const state = audioService.getState();
        if (state.playbackState !== 'playing') return;
        audioService.pause();
      };

      safeSetActionHandler('play', () => {
        void ensurePlay().catch((err) => console.warn('[media-session] play failed', err));
      });

      safeSetActionHandler('pause', () => {
        try {
          ensurePause();
        } catch (err) {
          console.warn('[media-session] pause failed', err);
        }
      });

      safeSetActionHandler('stop', () => {
        try {
          audioService.stop();
        } catch (err) {
          console.warn('[media-session] stop failed', err);
        }
      });

      safeSetActionHandler('previoustrack', () => {
        void audioService.playPrevious().catch((err) => console.warn('[media-session] previous failed', err));
      });

      safeSetActionHandler('nexttrack', () => {
        void audioService.playNext().catch((err) => console.warn('[media-session] next failed', err));
      });

      safeSetActionHandler('seekbackward', (details) => {
        const offset = typeof details.seekOffset === 'number' && Number.isFinite(details.seekOffset) ? details.seekOffset : 10;
        try {
          audioService.rewind(offset);
        } catch (err) {
          console.warn('[media-session] seekbackward failed', err);
        }
      });

      safeSetActionHandler('seekforward', (details) => {
        const offset = typeof details.seekOffset === 'number' && Number.isFinite(details.seekOffset) ? details.seekOffset : 10;
        try {
          audioService.fastForward(offset);
        } catch (err) {
          console.warn('[media-session] seekforward failed', err);
        }
      });

      safeSetActionHandler('seekto', (details) => {
        if (typeof details.seekTime !== 'number' || !Number.isFinite(details.seekTime)) return;
        try {
          audioService.seek(details.seekTime);
        } catch (err) {
          console.warn('[media-session] seekto failed', err);
        }
      });

      syncFromState(lastState, { forcePosition: true });

      const unsubscribes = [
        events.on('audio/stateChanged', (payload) => {
          syncFromState(payload, { forcePosition: true });
        }),
        events.on('audio/timeUpdated', (payload) => {
          lastTime = payload.time;
          applyPositionState(false);
        }),
      ];

      return () => {
        for (const unsub of unsubscribes) {
          try {
            unsub();
          } catch {
            // ignore
          }
        }

        if (positionUpdateTimer !== null && typeof window !== 'undefined') {
          window.clearTimeout(positionUpdateTimer);
          positionUpdateTimer = null;
        }

        keepalive.destroy();
        keybindings?.setContext('mediaSession.enabled', false);

        safeSetMetadata(null);
        safeSetPlaybackState('none');

        safeSetActionHandler('play', null);
        safeSetActionHandler('pause', null);
        safeSetActionHandler('stop', null);
        safeSetActionHandler('previoustrack', null);
        safeSetActionHandler('nexttrack', null);
        safeSetActionHandler('seekbackward', null);
        safeSetActionHandler('seekforward', null);
        safeSetActionHandler('seekto', null);
      };
    },
  };
}
