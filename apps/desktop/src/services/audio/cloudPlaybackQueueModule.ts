import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import {
  CLOUD_PLAYBACK_QUEUE_SERVICE_TOKEN,
  DefaultCloudPlaybackQueueService,
} from './CloudPlaybackQueueService';

export function createCloudPlaybackQueueModule(): KernelModule<AppEvents> {
  return {
    id: 'cloud-playback-queue',
    activate: ({ services, events }) => {
      const service = new DefaultCloudPlaybackQueueService();
      const unregister = services.register(CLOUD_PLAYBACK_QUEUE_SERVICE_TOKEN, service);

      events.emit('music-library/cloudFallbackAuditUpdated', service.getSnapshot());

      const unsubscribeQueued = events.on('music-library/cloudFallbackQueued', (payload) => {
        const nextSnapshot = service.recordQueued({
          atMs: Date.now(),
          request: payload.request,
          dispatch: payload.dispatch,
        });
        events.emit('music-library/cloudFallbackAuditUpdated', nextSnapshot);
      });

      return () => {
        unsubscribeQueued();
        unregister();
      };
    },
  };
}

