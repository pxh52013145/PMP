import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import {
  CLOUD_PLAYBACK_QUEUE_SERVICE_TOKEN,
  DefaultCloudPlaybackQueueService,
} from './CloudPlaybackQueueService';
import { upsertNativeLibraryFallbackTask } from '../../modules/music-library';
import { getTelemetryLogger } from '../telemetry/TelemetryService';
import { isTauriRuntime } from '../../utils/tauriRuntime';

const telemetry = getTelemetryLogger('audio', 'cloudPlaybackQueueModule');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

        if (!payload.dispatch.accepted || !isTauriRuntime()) {
          return;
        }

        void upsertNativeLibraryFallbackTask({
          ownerUid: payload.request.ownerUid,
          entryId: payload.request.entryId,
          cloudContentId: payload.request.cloudContentId,
          trackId: payload.request.trackId,
          quickFingerprint: payload.request.quickFingerprint,
          reason: payload.request.reason,
          requestedAtMs: payload.request.requestedAtMs,
        }).catch((error) => {
          telemetry.warn('cloud_playback_queue.persist_fallback_task.failed', {
            message: readErrorMessage(error),
            fields: {
              ownerUid: payload.request.ownerUid,
              entryId: payload.request.entryId,
              trackId: payload.request.trackId ?? null,
            },
          });
        });
      });

      return () => {
        unsubscribeQueued();
        unregister();
      };
    },
  };
}
