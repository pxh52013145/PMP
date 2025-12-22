import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { AUDIO_ENGINE_SERVICE_TOKEN, type IAudioService } from '../services/audio';
import { useKernel } from './KernelContext';

export type AudioEngineType = 'web' | 'native';

interface AudioEngineContextValue {
  audioService: IAudioService;
  engineType: AudioEngineType;
  isNativeAvailable: boolean;
  setEngineType: (next: AudioEngineType) => void;
}

const AudioEngineContext = createContext<AudioEngineContextValue | undefined>(undefined);

export function AudioEngineProvider({
  children,
}: {
  children: ReactNode;
}) {
  const kernel = useKernel();
  const audioEngine = kernel.services.get(AUDIO_ENGINE_SERVICE_TOKEN);
  const [snapshot, setSnapshot] = useState(() => audioEngine.getSnapshot());

  const setEngineType = useCallback(
    (next: AudioEngineType) => {
      audioEngine.setEngineType(next);
    },
    [audioEngine]
  );

  useEffect(() => {
    setSnapshot(audioEngine.getSnapshot());
    return kernel.events.on('audio/engineChanged', () => {
      setSnapshot(audioEngine.getSnapshot());
    });
  }, [audioEngine, kernel.events]);

  return (
    <AudioEngineContext.Provider
      value={{
        audioService: snapshot.audioService,
        engineType: snapshot.engineType,
        isNativeAvailable: snapshot.isNativeAvailable,
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
