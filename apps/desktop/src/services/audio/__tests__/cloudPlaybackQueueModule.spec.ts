import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createKernel, ModuleLoader } from '../../../kernel';
import type { AppEvents } from '../../../contracts/events';
import {
  CLOUD_PLAYBACK_QUEUE_SERVICE_TOKEN,
  clearCloudPlaybackFallbackQueue,
  createAudioModule,
  createCloudPlaybackQueueModule,
  getCloudPlaybackFallbackAdapter,
} from '../index';

describe('cloudPlaybackQueueModule', () => {
  beforeEach(() => {
    clearCloudPlaybackFallbackQueue();
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });

  it('records queued fallback events and emits audit snapshot updates', async () => {
    const kernel = createKernel<AppEvents>();
    const loader = new ModuleLoader<AppEvents>(kernel.services, kernel.events, kernel.contributions);
    const listener = vi.fn();
    const unsubscribe = kernel.events.on('music-library/cloudFallbackAuditUpdated', listener);

    loader.activate([
      createAudioModule({
        mode: 'noop',
        enableTaskbarMediaControls: false,
      }),
      createCloudPlaybackQueueModule(),
    ]);

    try {
      const adapter = getCloudPlaybackFallbackAdapter();
      await adapter.dispatch({
        entryId: 'entry-qm-1',
        ownerUid: 'u_qm',
        quickFingerprint: 'abcdef1234567890',
        requestedAtMs: 1700004000,
        reason: 'local-miss',
      });

      await adapter.dispatch({
        entryId: 'entry-qm-1',
        ownerUid: 'u_qm',
        quickFingerprint: 'qf2:abcdef1234567890',
        requestedAtMs: 1700004001,
        reason: 'local-miss',
      });

      const queueService = kernel.services.get(CLOUD_PLAYBACK_QUEUE_SERVICE_TOKEN);
      const snapshot = queueService.getSnapshot();
      expect(snapshot.stats).toMatchObject({
        totalEvents: 2,
        acceptedEvents: 2,
        dedupedEvents: 1,
      });

      expect(listener).toHaveBeenCalled();
      const [payload, meta] = listener.mock.calls.at(-1) ?? [];
      expect(payload.stats).toMatchObject({
        totalEvents: 2,
        acceptedEvents: 2,
        dedupedEvents: 1,
      });
      expect(meta.source).toBe('cloud-playback-queue');
    } finally {
      loader.deactivateAll();
      unsubscribe();
    }
  });
});
