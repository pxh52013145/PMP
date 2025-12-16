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

export type AudioEngineType = 'web' | 'native';

interface AudioEngineContextValue {
  audioService: IAudioService;
  engineType: AudioEngineType;
  isNativeAvailable: boolean;
  setEngineType: (next: AudioEngineType) => void;
}

const AUDIO_ENGINE_STORAGE_KEY = 'pixel-matrix-audio-engine';
const NATIVE_ENGINE_AVAILABLE = true;

const AudioEngineContext = createContext<AudioEngineContextValue | undefined>(undefined);

function readStoredEngineType(): AudioEngineType {
  if (typeof window === 'undefined') {
    return 'web';
  }
  const stored = localStorage.getItem(AUDIO_ENGINE_STORAGE_KEY);
  if (stored === 'native' && NATIVE_ENGINE_AVAILABLE) {
    return 'native';
  }
  return 'web';
}

function persistEngineType(type: AudioEngineType) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(AUDIO_ENGINE_STORAGE_KEY, type);
}

function createServiceForEngine(engine: AudioEngineType): IAudioService {
  if (engine === 'native') {
    return new NativeAudioService();
  }
  return new WebAudioService();
}

export function AudioEngineProvider({ children }: { children: ReactNode }) {
  const initialEngine = useMemo(() => readStoredEngineType(), []);
  const serviceRef = useRef<IAudioService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createServiceForEngine(initialEngine);
  }

  const [engineType, setEngineTypeState] = useState<AudioEngineType>(initialEngine);

  const setEngineType = useCallback(
    (next: AudioEngineType) => {
      if (next === engineType) return;

      if (next === 'native' && !NATIVE_ENGINE_AVAILABLE) {
        console.info('[AudioEngine] Native audio engine is under development.');
        return;
      }

      serviceRef.current?.destroy();
      serviceRef.current = createServiceForEngine(next);
      persistEngineType(next);
      setEngineTypeState(next);
    },
    [engineType]
  );

  useEffect(() => {
    const service = serviceRef.current;
    if (!service) return;

    const unsubscribe = service.onError((error) => {
      if (engineType !== 'native') return;
      console.warn('[AudioEngine] Native audio error, falling back to WebAudio:', error);
      setEngineType('web');
      void import('@tauri-apps/api/dialog')
        .then(({ message }) =>
          message(
            `Native audio error: ${error?.message ?? String(error)}\n\nFalling back to WebAudio.`,
            { title: 'Audio Engine', type: 'warning' }
          )
        )
        .catch(() => {});
    });

    return () => {
      unsubscribe();
    };
  }, [engineType, setEngineType]);

  useEffect(() => {
    return () => {
      serviceRef.current?.destroy();
    };
  }, []);

  return (
    <AudioEngineContext.Provider
      value={{
        audioService: serviceRef.current,
        engineType,
        isNativeAvailable: NATIVE_ENGINE_AVAILABLE,
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
