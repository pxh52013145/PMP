import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import {
  RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN,
  type RuntimeCapsuleManagerService,
} from '../runtime-capsules';
import { AUDIO_ENGINE_SERVICE_TOKEN, DefaultAudioEngineService } from './AudioEngineService';
import { subscribeCloudPlaybackFallbackQueued } from './cloudPlaybackFallbackAdapter';

export function createAudioModule(options: {
  mode?: 'real' | 'noop';
  enableTaskbarMediaControls?: boolean;
} = {}): KernelModule<AppEvents> {
  return {
    id: 'audio',
    activate: ({ services, events }) => {
      const runtimeCapsuleManager = services.getOptional(
        RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN
      ) as RuntimeCapsuleManagerService | null;
      const shellLease =
        options.mode === 'noop'
          ? null
          : runtimeCapsuleManager?.acquireLease({
              capabilityId: 'audio.shell',
              leaseKey: 'audio.shell:audio-engine',
              ownerKind: 'system',
              ownerId: 'audio-engine',
              priority: 'foreground',
              reason: {
                detail: 'audio engine shell registered',
              },
            });
      const service = new DefaultAudioEngineService(events, {
        ...options,
        runtimeCapsuleManager,
      });
      const unregister = services.register(AUDIO_ENGINE_SERVICE_TOKEN, service);
      const unsubscribeFallbackQueued = subscribeCloudPlaybackFallbackQueued((payload) => {
        events.emit('music-library/cloudFallbackQueued', payload);
      });
      return () => {
        unsubscribeFallbackQueued();
        unregister();
        service.destroy();
        if (shellLease) {
          runtimeCapsuleManager?.releaseLease(shellLease.id, {
            kind: 'shutdown',
            sourceId: 'audio-engine',
            detail: 'audio engine shell disposed',
          });
        }
      };
    },
  };
}

