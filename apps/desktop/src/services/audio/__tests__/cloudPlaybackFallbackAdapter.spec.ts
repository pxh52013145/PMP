import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCloudPlaybackFallbackQueue,
  getCloudPlaybackFallbackAdapter,
  getCloudPlaybackFallbackQueueSnapshot,
  subscribeCloudPlaybackFallbackQueued,
} from '../cloudPlaybackFallbackAdapter';

describe('cloudPlaybackFallbackAdapter', () => {
  beforeEach(() => {
    clearCloudPlaybackFallbackQueue();
  });

  it('normalizes and enqueues valid fallback request', async () => {
    const adapter = getCloudPlaybackFallbackAdapter();

    const result = await adapter.dispatch({
      entryId: '  entry-1  ',
      ownerUid: '  u_1  ',
      cloudContentId: '  cloud_a  ',
      trackId: '  t-1  ',
      quickFingerprint: '  ABCDEF1234567890  ',
      requestedAtMs: 1700000000.9,
      reason: 'local-miss',
    });

    expect(result.accepted).toBe(true);
    expect(result.deduped).toBe(false);
    expect(result.queueSize).toBe(1);

    const queue = getCloudPlaybackFallbackQueueSnapshot();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      entryId: 'entry-1',
      ownerUid: 'u_1',
      cloudContentId: 'cloud_a',
      trackId: 't-1',
      quickFingerprint: 'qf2:abcdef1234567890',
      requestedAtMs: 1700000000,
      reason: 'local-miss',
    });
  });

  it('deduplicates repeated fallback request key', async () => {
    const adapter = getCloudPlaybackFallbackAdapter();

    await adapter.dispatch({
      entryId: 'entry-dup',
      ownerUid: 'u_dup',
      trackId: 'track-dup',
      quickFingerprint: 'qf2:abcdef1234567890',
      requestedAtMs: Date.now(),
      reason: 'local-miss',
    });

    const second = await adapter.dispatch({
      entryId: 'entry-dup',
      ownerUid: 'u_dup',
      trackId: 'track-dup',
      quickFingerprint: 'abcdef1234567890',
      requestedAtMs: Date.now(),
      reason: 'local-miss',
    });

    expect(second.accepted).toBe(true);
    expect(second.deduped).toBe(true);
    expect(second.queueSize).toBe(1);
    expect(getCloudPlaybackFallbackQueueSnapshot()).toHaveLength(1);
  });

  it('rejects invalid request and keeps queue untouched', async () => {
    const adapter = getCloudPlaybackFallbackAdapter();
    const result = await adapter.dispatch({
      entryId: '   ',
      ownerUid: 'u_2',
      requestedAtMs: Date.now(),
      reason: 'local-miss',
    });

    expect(result.accepted).toBe(false);
    expect(result.queueSize).toBe(0);
    expect(getCloudPlaybackFallbackQueueSnapshot()).toHaveLength(0);
  });

  it('emits queued events for accepted dispatch and dedup hit', async () => {
    const adapter = getCloudPlaybackFallbackAdapter();
    const listener = vi.fn();
    const unsubscribe = subscribeCloudPlaybackFallbackQueued(listener);

    try {
      await adapter.dispatch({
        entryId: 'entry-event-1',
        ownerUid: 'u_event',
        trackId: 'track-event',
        quickFingerprint: 'abcdef1234567890',
        requestedAtMs: 1700000001,
        reason: 'local-miss',
      });

      await adapter.dispatch({
        entryId: 'entry-event-1',
        ownerUid: 'u_event',
        trackId: 'track-event',
        quickFingerprint: 'qf2:abcdef1234567890',
        requestedAtMs: 1700000002,
        reason: 'local-miss',
      });

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[0]?.[0]).toMatchObject({
        request: {
          entryId: 'entry-event-1',
          ownerUid: 'u_event',
          quickFingerprint: 'qf2:abcdef1234567890',
        },
        dispatch: {
          accepted: true,
          deduped: false,
          queueSize: 1,
        },
      });
      expect(listener.mock.calls[1]?.[0]).toMatchObject({
        request: {
          entryId: 'entry-event-1',
          ownerUid: 'u_event',
        },
        dispatch: {
          accepted: true,
          deduped: true,
          queueSize: 1,
        },
      });
    } finally {
      unsubscribe();
    }
  });
});
