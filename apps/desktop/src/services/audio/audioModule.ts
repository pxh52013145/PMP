import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { AUDIO_ENGINE_SERVICE_TOKEN, DefaultAudioEngineService } from './AudioEngineService';

export function createAudioModule(options: {
  mode?: 'real' | 'noop';
  enableTaskbarMediaControls?: boolean;
} = {}): KernelModule<AppEvents> {
  return {
    id: 'audio',
    activate: ({ services, events }) => {
      const service = new DefaultAudioEngineService(events, options);
      const unregister = services.register(AUDIO_ENGINE_SERVICE_TOKEN, service);
      return () => {
        unregister();
        service.destroy();
      };
    },
  };
}

