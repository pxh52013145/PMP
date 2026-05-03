import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeAudioQueueMirror } from './nativeAudioQueueMirror';
import type { Track } from './types';

const { invokeWithTelemetryMock } = vi.hoisted(() => ({
  invokeWithTelemetryMock: vi.fn(),
}));

vi.mock('../telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../telemetry/tauriInvokeTelemetry', () => ({
  invokeWithTelemetry: invokeWithTelemetryMock,
}));

const TRACK_A: Track = {
  id: 'track-a',
  title: 'Track A',
  path: 'C:\\music\\a.flac',
  duration: 10,
};

const TRACK_B: Track = {
  id: 'track-b',
  title: 'Track B',
  duration: 20,
};

const TRACK_C: Track = {
  id: 'track-c',
  title: 'Track C',
  duration: 30,
};

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

function createMirror(options?: {
  runtime?: boolean;
  disposed?: boolean;
  queue?: Track[];
  currentIndex?: number;
}) {
  let queue = options?.queue ?? [];
  let currentIndex = options?.currentIndex ?? -1;
  let runtime = options?.runtime ?? true;
  let disposed = options?.disposed ?? false;

  const mirror = new NativeAudioQueueMirror({
    isDisposed: () => disposed,
    isRuntime: () => runtime,
    getQueue: () => queue,
    getCurrentIndex: () => currentIndex,
    getTrackPath: (track) => (typeof track.path === 'string' ? track.path : null),
    buildTelemetryFields: (nextQueue, index, extra) => ({
      queueLength: nextQueue.length,
      currentIndex: index,
      ...extra,
    }),
  });

  return {
    mirror,
    setQueue: (nextQueue: Track[]) => {
      queue = nextQueue;
    },
    setCurrentIndex: (nextIndex: number) => {
      currentIndex = nextIndex;
    },
    setRuntime: (nextRuntime: boolean) => {
      runtime = nextRuntime;
    },
    setDisposed: (nextDisposed: boolean) => {
      disposed = nextDisposed;
    },
  };
}

describe('NativeAudioQueueMirror', () => {
  beforeEach(() => {
    invokeWithTelemetryMock.mockReset();
    invokeWithTelemetryMock.mockResolvedValue(undefined);
  });

  it('builds queue entry paths with stable id fallback', () => {
    const { mirror } = createMirror();

    expect(mirror.buildEntryPaths([TRACK_A, TRACK_B])).toEqual([
      'C:\\music\\a.flac',
      'queue://track-id/track-b',
    ]);
    expect(mirror.buildEntryPaths([{ title: 'No identity', duration: 1 } as Track])).toBeNull();
  });

  it('syncs appended queue entries to native transport', async () => {
    const queue = [TRACK_A];
    const { mirror, setQueue } = createMirror({ queue, currentIndex: 0 });
    const nextQueue = [TRACK_A, TRACK_B];

    mirror.syncAppended(nextQueue, [TRACK_B]);
    await flushMicrotasks();
    setQueue(nextQueue);

    expect(invokeWithTelemetryMock).toHaveBeenCalledWith(
      'native_audio_append_queue',
      { queue: ['queue://track-id/track-b'] },
      expect.objectContaining({
        event: 'audio.queue.append',
      })
    );
    expect(mirror.collectSnapshot()).toMatchObject({
      dirty: false,
      mirroredIndex: 0,
    });
  });

  it('marks mirror dirty when appended tracks have no native identity', () => {
    const { mirror } = createMirror({ queue: [TRACK_A], currentIndex: 0 });

    mirror.syncAppended([TRACK_A, { title: 'No identity', duration: 1 } as Track], [
      { title: 'No identity', duration: 1 } as Track,
    ]);

    expect(invokeWithTelemetryMock).not.toHaveBeenCalled();
    expect(mirror.collectSnapshot()).toMatchObject({
      dirty: true,
      mirroredIndex: -1,
    });
  });

  it('coalesces queued index syncs to the latest index', async () => {
    const queue = [TRACK_A, TRACK_B, TRACK_C];
    const { mirror, setCurrentIndex } = createMirror({ queue, currentIndex: 0 });
    mirror.markMutationSynced(queue, 0);

    setCurrentIndex(1);
    mirror.scheduleIndexSync(1);
    setCurrentIndex(2);
    mirror.scheduleIndexSync(2);
    await flushMicrotasks();

    expect(invokeWithTelemetryMock).toHaveBeenCalledTimes(1);
    expect(invokeWithTelemetryMock).toHaveBeenCalledWith(
      'native_audio_sync_queue_index',
      { currentIndex: 2 },
      expect.objectContaining({
        event: 'audio.queue.sync.index',
      })
    );
  });

  it('marks mirror dirty when replacing a native queue item path fails', async () => {
    invokeWithTelemetryMock.mockRejectedValueOnce(new Error('backend unavailable'));
    const queue = [TRACK_A];
    const { mirror } = createMirror({ queue, currentIndex: 0 });

    await expect(mirror.replaceItemPath(0, 'C:\\music\\patched.flac')).resolves.toBe(false);

    expect(mirror.collectSnapshot()).toMatchObject({
      dirty: true,
      mirroredIndex: -1,
    });
  });
});
