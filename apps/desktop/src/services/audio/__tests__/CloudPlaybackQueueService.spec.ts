import { beforeEach, describe, expect, it } from 'vitest';
import {
  CLOUD_PLAYBACK_QUEUE_AUDIT_MAX_ENTRIES,
  DefaultCloudPlaybackQueueService,
} from '../CloudPlaybackQueueService';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';

describe('CloudPlaybackQueueService', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.MUSIC_LIBRARY_CLOUD_FALLBACK_AUDIT_V1);
  });

  it('records queued entries and computes snapshot stats', () => {
    const service = new DefaultCloudPlaybackQueueService();

    service.recordQueued({
      atMs: 1700002000,
      request: {
        entryId: 'entry-1',
        ownerUid: 'u_1',
        quickFingerprint: 'qf2:abcdef1234567890',
        requestedAtMs: 1700002000,
        reason: 'local-miss',
      },
      dispatch: {
        accepted: true,
        deduped: false,
        queueSize: 1,
      },
    });

    service.recordQueued({
      atMs: 1700002001,
      request: {
        entryId: 'entry-1',
        ownerUid: 'u_1',
        quickFingerprint: 'qf2:abcdef1234567890',
        requestedAtMs: 1700002001,
        reason: 'local-miss',
      },
      dispatch: {
        accepted: true,
        deduped: true,
        queueSize: 1,
      },
    });

    const snapshot = service.getSnapshot();
    expect(snapshot.stats).toMatchObject({
      totalEvents: 2,
      acceptedEvents: 2,
      dedupedEvents: 1,
      rejectedEvents: 0,
      lastQueuedAtMs: 1700002001,
    });
    expect(snapshot.recent).toHaveLength(2);
  });

  it('keeps only latest entries up to max limit', () => {
    const service = new DefaultCloudPlaybackQueueService();
    const total = CLOUD_PLAYBACK_QUEUE_AUDIT_MAX_ENTRIES + 5;

    for (let i = 0; i < total; i += 1) {
      service.recordQueued({
        atMs: 1700003000 + i,
        request: {
          entryId: `entry-${i}`,
          ownerUid: 'u_cap',
          requestedAtMs: 1700003000 + i,
          reason: 'local-miss',
        },
        dispatch: {
          accepted: true,
          deduped: false,
          queueSize: i + 1,
        },
      });
    }

    const snapshot = service.getSnapshot();
    expect(snapshot.recent).toHaveLength(CLOUD_PLAYBACK_QUEUE_AUDIT_MAX_ENTRIES);
    expect(snapshot.recent[0]?.request.entryId).toBe('entry-5');
    expect(snapshot.recent.at(-1)?.request.entryId).toBe(`entry-${total - 1}`);
  });
});

