export type QueueSyncRequest<T> = {
  queue: T[];
  currentIndex: number;
  indexOnly: boolean;
};

type QueueSyncCallbacks<T> = {
  isDisposed: () => boolean;
  syncIndex: (currentIndex: number) => Promise<void>;
  syncQueue: (queue: T[], currentIndex: number) => Promise<void>;
  onIndexSyncError?: (error: unknown) => void;
  onQueueSyncError?: (error: unknown) => void;
};

export class NativeAudioQueueSyncController<T> {
  private pendingRequest: QueueSyncRequest<T> | null = null;
  private syncScheduled = false;
  private lastSyncedQueueRef: T[] | null = null;
  private lastSyncedQueueIndex = -1;

  enqueue(queue: T[], currentIndex: number, options?: { indexOnly?: boolean }): void {
    const requestIndexOnly = options?.indexOnly === true;
    const previousPending = this.pendingRequest;
    const mergedIndexOnly =
      requestIndexOnly && !(previousPending && !previousPending.indexOnly);

    this.pendingRequest = {
      queue,
      currentIndex,
      indexOnly: mergedIndexOnly,
    };
  }

  reset(): void {
    this.pendingRequest = null;
    this.syncScheduled = false;
    this.lastSyncedQueueRef = null;
    this.lastSyncedQueueIndex = -1;
  }

  scheduleFlush(callbacks: QueueSyncCallbacks<T>): void {
    if (callbacks.isDisposed()) {
      this.pendingRequest = null;
      return;
    }

    if (this.syncScheduled) return;
    this.syncScheduled = true;

    const flush = () => {
      this.syncScheduled = false;
      void this.flushNow(callbacks);
    };

    if (typeof queueMicrotask === 'function') {
      queueMicrotask(flush);
      return;
    }

    void Promise.resolve().then(flush);
  }

  private async flushNow(callbacks: QueueSyncCallbacks<T>): Promise<void> {
    if (callbacks.isDisposed()) {
      this.pendingRequest = null;
      return;
    }

    const pending = this.pendingRequest;
    this.pendingRequest = null;
    if (!pending) return;

    const canUseIndexOnlySync =
      pending.indexOnly &&
      this.lastSyncedQueueRef === pending.queue &&
      pending.currentIndex !== this.lastSyncedQueueIndex;

    if (
      pending.indexOnly &&
      this.lastSyncedQueueRef === pending.queue &&
      pending.currentIndex === this.lastSyncedQueueIndex
    ) {
      return;
    }

    if (canUseIndexOnlySync) {
      try {
        await callbacks.syncIndex(pending.currentIndex);
        this.lastSyncedQueueIndex = pending.currentIndex;
      } catch (error) {
        callbacks.onIndexSyncError?.(error);
      }
      return;
    }

    try {
      await callbacks.syncQueue(pending.queue, pending.currentIndex);
      this.lastSyncedQueueRef = pending.queue;
      this.lastSyncedQueueIndex = pending.currentIndex;
    } catch (error) {
      callbacks.onQueueSyncError?.(error);
    }
  }
}

