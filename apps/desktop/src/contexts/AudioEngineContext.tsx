import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { IAudioService, NativeAudioService, WebAudioService } from '../services/audio';
import { readString, writeString } from '../modules/storage';
import { STORAGE_KEYS } from '../utils/windowCommunication';
import { isTauriRuntime } from '../utils/tauriRuntime';
import { NoopAudioService } from '../services/audio/NoopAudioService';

export type AudioEngineType = 'web' | 'native';

interface AudioEngineContextValue {
  audioService: IAudioService;
  engineType: AudioEngineType;
  isNativeAvailable: boolean;
  setEngineType: (next: AudioEngineType) => void;
}

const AudioEngineContext = createContext<AudioEngineContextValue | undefined>(undefined);

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

function persistEngineType(type: AudioEngineType) {
  if (typeof window === 'undefined') return;
  writeString(STORAGE_KEYS.AUDIO_ENGINE, type);
}

function createServiceForEngine(engine: AudioEngineType): IAudioService {
  if (engine === 'native') {
    return new NativeAudioService();
  }
  return new WebAudioService();
}

export function AudioEngineProvider({
  children,
  mode = 'real',
}: {
  children: ReactNode;
  mode?: 'real' | 'noop';
}) {
  const initialEngine = useMemo(() => (mode === 'real' ? readStoredEngineType() : 'web'), [mode]);
  const serviceRef = useRef<IAudioService | null>(null);
  const didEnforceStartupDefaultRef = useRef(false);
  if (!serviceRef.current) {
    serviceRef.current =
      mode === 'real' ? createServiceForEngine(initialEngine) : new NoopAudioService();
  }

  const [engineType, setEngineTypeState] = useState<AudioEngineType>(initialEngine);

  const setEngineType = useCallback(
    (next: AudioEngineType) => {
      if (mode !== 'real') {
        setEngineTypeState(next);
        return;
      }
      if (next === engineType) return;

      if (next === 'native' && !isTauriRuntime()) {
        console.info('[AudioEngine] Native audio engine is under development.');
        return;
      }

      const previousService = serviceRef.current;
      const previousState = previousService?.getState();

      previousService?.destroy();

      const nextService = createServiceForEngine(next);
      serviceRef.current = nextService;

      if (previousState) {
        try {
          nextService.setVolume(previousState.volume);
        } catch {}

        try {
          if (nextService.getState().muted !== previousState.muted) {
            nextService.toggleMute();
          }
        } catch {}

        try {
          nextService.setPlayMode(previousState.playMode);
        } catch {}

        try {
          if (previousState.queue.length > 0) {
            nextService.addMultipleToQueue(previousState.queue);
          }
        } catch {}
      }

      persistEngineType(next);
      setEngineTypeState(next);
    },
    [engineType, mode]
  );

  useEffect(() => {
    if (mode !== 'real') return;
    if (didEnforceStartupDefaultRef.current) return;
    didEnforceStartupDefaultRef.current = true;

    if (!isTauriRuntime()) return;
    if (engineType !== 'web') return;

    // If anything picked WebAudio during early boot (e.g. due to a runtime-detection race),
    // force the Desktop startup default back to Native. Users can still manually switch to WebAudio.
    setEngineType('native');
  }, [engineType, mode, setEngineType]);

  useEffect(() => {
    if (mode !== 'real') return;
    const service = serviceRef.current;
    if (!service) return;

    const unsubscribe = service.onError((error) => {
      if (engineType !== 'native') return;

      const maybeCoded = error as Error & { code?: string };
      const code = maybeCoded?.code;
      const messageText = error?.message ?? String(error);

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
      setEngineType('web');
      void import('@tauri-apps/api/dialog')
        .then(({ message }) =>
          message(`Native audio error: ${messageText}\n\nFalling back to WebAudio.`, {
            title: 'Audio Engine',
            type: 'warning',
          })
        )
        .catch(() => {});
    });

    return () => {
      unsubscribe();
    };
  }, [engineType, mode, setEngineType]);

  useEffect(() => {
    return () => {
      serviceRef.current?.destroy();
    };
  }, []);

  useEffect(() => {
    if (mode !== 'real') return;
    if (!isTauriRuntime()) return;

    let unlisten: null | (() => void) = null;
    let disposed = false;

    type Payload = { action?: string };

    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<Payload>('taskbar-media-control', (event) => {
          const action = event.payload?.action;
          if (!action) return;

          const service = serviceRef.current;
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
                const maybePromise = (service as any).pause?.();
                if (maybePromise && typeof maybePromise.then === 'function') {
                  void maybePromise.catch((err: unknown) => {
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

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [mode]);

  return (
    <AudioEngineContext.Provider
      value={{
        audioService: serviceRef.current,
        engineType,
        isNativeAvailable: mode === 'real' ? isTauriRuntime() : false,
        setEngineType,
      }}
    >
      {children}
    </AudioEngineContext.Provider>
  );
}

export function useAudioService(): IAudioService {
  const context = useContext(AudioEngineContext);
  if (!context) {
    throw new Error('useAudioService must be used within an AudioEngineProvider');
  }
  return context.audioService;
}

export function useAudioEngine() {
  const context = useContext(AudioEngineContext);
  if (!context) {
    throw new Error('useAudioEngine must be used within an AudioEngineProvider');
  }
  return {
    engineType: context.engineType,
    isNativeAvailable: context.isNativeAvailable,
    setEngineType: context.setEngineType,
  };
}
