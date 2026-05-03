import { getTelemetryLogger } from '../telemetry/TelemetryService';
import { invokeWithTelemetry } from '../telemetry/tauriInvokeTelemetry';
import type { Track } from './types';

function approxJsonBytes(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return null;
  }
}

function readTelemetryErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export interface NativeAudioQueueMirrorOptions {
  isDisposed: () => boolean;
  isRuntime: () => boolean;
  getQueue: () => Track[];
  getCurrentIndex: () => number;
  getTrackPath: (track: Track) => string | null;
  buildTelemetryFields: (
    queue: Track[],
    currentIndex: number,
    extra?: Record<string, unknown>
  ) => Record<string, unknown>;
}

export interface NativeAudioQueueMirrorSnapshot {
  dirty: boolean;
  mirroredIndex: number;
  pendingIndex: number | null;
  indexSyncScheduled: boolean;
}

export class NativeAudioQueueMirror {
  private readonly telemetry = getTelemetryLogger('audio', 'NativeAudioQueueMirror');

  private mirroredQueueRef: Track[] | null = null;
  private mirroredIndex = -1;
  private pendingIndex: number | null = null;
  private indexSyncScheduled = false;
  private dirty = false;

  constructor(private readonly options: NativeAudioQueueMirrorOptions) {}

  collectSnapshot(): NativeAudioQueueMirrorSnapshot {
    return {
      dirty: this.dirty,
      mirroredIndex: this.mirroredIndex,
      pendingIndex: this.pendingIndex,
      indexSyncScheduled: this.indexSyncScheduled,
    };
  }

  isDirty(): boolean {
    return this.dirty;
  }

  reset(): void {
    this.mirroredQueueRef = null;
    this.mirroredIndex = -1;
    this.pendingIndex = null;
    this.indexSyncScheduled = false;
    this.dirty = false;
  }

  clearPendingIndexSync(): void {
    this.pendingIndex = null;
    this.indexSyncScheduled = false;
  }

  buildEntryPaths(queue: Track[]): string[] | null {
    const queuePaths: string[] = [];
    for (const track of queue) {
      const trackPath =
        this.options.getTrackPath(track) ??
        (typeof track.id === 'string' && track.id.trim().length > 0
          ? `queue://track-id/${encodeURIComponent(track.id.trim())}`
          : null);
      if (!trackPath) {
        return null;
      }
      queuePaths.push(trackPath);
    }
    return queuePaths;
  }

  syncAppended(nextQueue: Track[], appendedTracks: Track[]): void {
    if (this.options.isDisposed()) return;
    if (!this.options.isRuntime()) return;
    if (this.dirty) return;

    const currentIndex = this.options.getCurrentIndex();
    const appendedPaths = this.buildEntryPaths(appendedTracks);
    if (!appendedPaths) {
      this.markDirty('append-missing-identity', {
        addedCount: appendedTracks.length,
      });
      return;
    }

    void invokeWithTelemetry(
      'native_audio_append_queue',
      { queue: appendedPaths },
      {
        moduleId: 'audio',
        component: 'NativeAudioQueueMirror',
        event: 'audio.queue.append',
      }
    )
      .then(() => {
        this.markMutationSynced(nextQueue, currentIndex);
        this.telemetry.info('audio.queue.sync.flush', {
          fields: this.options.buildTelemetryFields(nextQueue, currentIndex, {
            mode: 'append',
            addedCount: appendedTracks.length,
            queuePathCount: appendedPaths.length,
            queuePathApproxBytes: approxJsonBytes(appendedPaths),
          }),
        });
      })
      .catch((error) => {
        this.telemetry.warn('audio.queue.sync.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            phase: 'append',
            addedCount: appendedTracks.length,
          },
        });
        this.markDirty('append-command-failed', {
          addedCount: appendedTracks.length,
        });
      });
  }

  markMutationSynced(queue: Track[], currentIndex: number): void {
    this.mirroredQueueRef = queue;
    this.mirroredIndex = currentIndex;
    if (this.options.getQueue() === queue && this.options.getCurrentIndex() !== currentIndex) {
      this.scheduleIndexSync(this.options.getCurrentIndex());
    }
  }

  syncRemoved(
    previousQueue: Track[],
    nextQueue: Track[],
    removedIndex: number,
    currentIndex: number
  ): void {
    if (this.options.isDisposed()) return;
    if (!this.canUseAtomicMutation(previousQueue)) {
      this.markDirty('remove-preconditions-missing', {
        removedIndex,
      });
      return;
    }

    void invokeWithTelemetry(
      'native_audio_remove_queue_item',
      { index: removedIndex },
      {
        moduleId: 'audio',
        component: 'NativeAudioQueueMirror',
        event: 'audio.queue.remove-native',
      }
    )
      .then(() => {
        this.markMutationSynced(nextQueue, currentIndex);
        this.telemetry.info('audio.queue.sync.flush', {
          fields: this.options.buildTelemetryFields(nextQueue, currentIndex, {
            mode: 'remove',
            removedIndex,
          }),
        });
      })
      .catch((error) => {
        this.telemetry.warn('audio.queue.sync.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            phase: 'remove',
            removedIndex,
          },
        });
        this.markDirty('remove-command-failed', {
          removedIndex,
        });
      });
  }

  syncMoved(
    previousQueue: Track[],
    nextQueue: Track[],
    fromIndex: number,
    toIndex: number,
    currentIndex: number
  ): void {
    if (this.options.isDisposed()) return;
    if (!this.canUseAtomicMutation(previousQueue)) {
      this.markDirty('move-preconditions-missing', {
        fromIndex,
        toIndex,
      });
      return;
    }

    void invokeWithTelemetry(
      'native_audio_move_queue_item',
      { fromIndex, toIndex },
      {
        moduleId: 'audio',
        component: 'NativeAudioQueueMirror',
        event: 'audio.queue.move-native',
      }
    )
      .then(() => {
        this.markMutationSynced(nextQueue, currentIndex);
        this.telemetry.info('audio.queue.sync.flush', {
          fields: this.options.buildTelemetryFields(nextQueue, currentIndex, {
            mode: 'move',
            fromIndex,
            toIndex,
          }),
        });
      })
      .catch((error) => {
        this.telemetry.warn('audio.queue.sync.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            phase: 'move',
            fromIndex,
            toIndex,
          },
        });
        this.markDirty('move-command-failed', {
          fromIndex,
          toIndex,
        });
      });
  }

  async replaceItemPath(index: number, path: string): Promise<boolean> {
    if (!this.options.isRuntime()) return false;
    if (this.dirty || !this.buildEntryPaths(this.options.getQueue())) {
      return false;
    }

    try {
      await invokeWithTelemetry(
        'native_audio_replace_queue_item_path',
        { index, path },
        {
          moduleId: 'audio',
          component: 'NativeAudioQueueMirror',
          event: 'audio.queue.patch-item-path',
        }
      );
      this.markMutationSynced(this.options.getQueue(), this.options.getCurrentIndex());
      return true;
    } catch (error) {
      this.telemetry.warn('audio.queue.sync.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          phase: 'replace-item-path',
          index,
        },
      });
      this.markDirty('replace-item-path-command-failed', {
        index,
      });
      return false;
    }
  }

  canUseQueueIndexTransport(queue: Track[], index: number): boolean {
    if (!this.options.isRuntime()) return false;
    if (index < 0 || index >= queue.length) return false;
    if (this.dirty) return false;
    return this.buildEntryPaths(queue) !== null;
  }

  scheduleIndexSync(currentIndex: number): void {
    if (this.options.isDisposed() || !this.options.isRuntime() || this.dirty) return;
    if (
      this.mirroredQueueRef === this.options.getQueue() &&
      this.mirroredIndex === currentIndex
    ) {
      return;
    }

    this.pendingIndex = currentIndex;
    if (this.indexSyncScheduled) return;
    this.indexSyncScheduled = true;

    const flush = () => {
      this.indexSyncScheduled = false;
      const nextIndex = this.pendingIndex;
      this.pendingIndex = null;
      if (nextIndex == null) return;
      void this.syncIndex(nextIndex);
    };

    if (typeof queueMicrotask === 'function') {
      queueMicrotask(flush);
      return;
    }

    void Promise.resolve().then(flush);
  }

  private canUseAtomicMutation(queue: Track[]): boolean {
    return this.options.isRuntime() && !this.dirty && this.buildEntryPaths(queue) !== null;
  }

  private markDirty(reason: string, fields?: Record<string, unknown>): void {
    if (this.dirty) return;
    this.dirty = true;
    this.mirroredQueueRef = null;
    this.mirroredIndex = -1;
    this.pendingIndex = null;
    this.indexSyncScheduled = false;
    this.telemetry.warn('audio.queue.native-mirror.dirty', {
      fields: {
        reason,
        ...fields,
      },
    });
  }

  private async syncIndex(currentIndex: number): Promise<void> {
    if (this.options.isDisposed() || !this.options.isRuntime() || this.dirty) return;
    if (
      this.mirroredQueueRef === this.options.getQueue() &&
      this.mirroredIndex === currentIndex
    ) {
      return;
    }

    const queue = this.options.getQueue();
    const fields = this.options.buildTelemetryFields(queue, currentIndex, {
      mode: 'index-only',
    });
    try {
      await invokeWithTelemetry(
        'native_audio_sync_queue_index',
        { currentIndex },
        {
          moduleId: 'audio',
          component: 'NativeAudioQueueMirror',
          event: 'audio.queue.sync.index',
        }
      );
      this.mirroredQueueRef = queue;
      this.mirroredIndex = currentIndex;
      this.telemetry.info('audio.queue.sync.flush', { fields });
    } catch (error) {
      this.telemetry.warn('audio.queue.sync.failed', {
        message: readTelemetryErrorMessage(error),
        fields,
      });
      this.markDirty('index-command-failed', {
        currentIndex,
      });
    }
  }
}
