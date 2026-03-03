import { describe, expect, it, vi } from 'vitest';

import { NativeAudioQueueSyncController } from '../nativeAudioQueueSyncController';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('nativeAudioQueueSyncController', () => {
  it('syncs full queue by default', async () => {
    const controller = new NativeAudioQueueSyncController<string>();
    const syncIndex = vi.fn(async () => {});
    const syncQueue = vi.fn(async () => {});

    controller.enqueue(['a', 'b'], 0);
    controller.scheduleFlush({
      isDisposed: () => false,
      syncIndex,
      syncQueue,
    });

    await flushMicrotasks();

    expect(syncQueue).toHaveBeenCalledTimes(1);
    expect(syncQueue).toHaveBeenCalledWith(['a', 'b'], 0);
    expect(syncIndex).not.toHaveBeenCalled();
  });

  it('uses index-only fast path on same queue reference', async () => {
    const controller = new NativeAudioQueueSyncController<string>();
    const syncIndex = vi.fn(async () => {});
    const syncQueue = vi.fn(async () => {});
    const queue = ['a', 'b'];

    controller.enqueue(queue, 0);
    controller.scheduleFlush({
      isDisposed: () => false,
      syncIndex,
      syncQueue,
    });
    await flushMicrotasks();

    controller.enqueue(queue, 1, { indexOnly: true });
    controller.scheduleFlush({
      isDisposed: () => false,
      syncIndex,
      syncQueue,
    });
    await flushMicrotasks();

    expect(syncQueue).toHaveBeenCalledTimes(1);
    expect(syncIndex).toHaveBeenCalledTimes(1);
    expect(syncIndex).toHaveBeenCalledWith(1);
  });

  it('drops index-only noop updates when index unchanged', async () => {
    const controller = new NativeAudioQueueSyncController<string>();
    const syncIndex = vi.fn(async () => {});
    const syncQueue = vi.fn(async () => {});
    const queue = ['a', 'b'];

    controller.enqueue(queue, 0);
    controller.scheduleFlush({
      isDisposed: () => false,
      syncIndex,
      syncQueue,
    });
    await flushMicrotasks();

    controller.enqueue(queue, 0, { indexOnly: true });
    controller.scheduleFlush({
      isDisposed: () => false,
      syncIndex,
      syncQueue,
    });
    await flushMicrotasks();

    expect(syncQueue).toHaveBeenCalledTimes(1);
    expect(syncIndex).not.toHaveBeenCalled();
  });

  it('merges pending requests and keeps stronger full-sync requirement', async () => {
    const controller = new NativeAudioQueueSyncController<string>();
    const syncIndex = vi.fn(async () => {});
    const syncQueue = vi.fn(async () => {});

    controller.enqueue(['a'], 0, { indexOnly: true });
    controller.enqueue(['a', 'b'], 1, { indexOnly: false });
    controller.scheduleFlush({
      isDisposed: () => false,
      syncIndex,
      syncQueue,
    });

    await flushMicrotasks();

    expect(syncQueue).toHaveBeenCalledTimes(1);
    expect(syncQueue).toHaveBeenCalledWith(['a', 'b'], 1);
    expect(syncIndex).not.toHaveBeenCalled();
  });

  it('resets all internal state', async () => {
    const controller = new NativeAudioQueueSyncController<string>();
    const syncIndex = vi.fn(async () => {});
    const syncQueue = vi.fn(async () => {});

    controller.enqueue(['a'], 0);
    controller.reset();
    controller.scheduleFlush({
      isDisposed: () => false,
      syncIndex,
      syncQueue,
    });

    await flushMicrotasks();

    expect(syncQueue).not.toHaveBeenCalled();
    expect(syncIndex).not.toHaveBeenCalled();
  });
});
