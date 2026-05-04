import type { NativeAudioStatePayload } from './nativeAudioServiceTypes';
import type { AudioState, Track } from './types';

export type NativeAudioQueueStatePayloadResolver = {
  deriveTitleFromPath(path: string): string;
  getTrackPath(track: AudioState['currentTrack'] | null | undefined): string | null;
  isSameQueuePaths(paths: string[]): boolean;
  normalizeTrackPathForCompare(path: string | null): string;
  resolveQueueFromPaths(paths: string[]): AudioState['queue'];
  resolveTrackFromPath(path: string): { track: NonNullable<AudioState['currentTrack']>; index: number } | null;
};

export function resolveNativeAudioQueueStatePayload(input: {
  payload: NativeAudioStatePayload;
  state: AudioState;
  resolver: NativeAudioQueueStatePayloadResolver;
}): Partial<AudioState> {
  const { payload, resolver, state } = input;
  const update: Partial<AudioState> = {};

  if (Array.isArray(payload.queue) && !resolver.isSameQueuePaths(payload.queue)) {
    update.queue = resolver.resolveQueueFromPaths(payload.queue);
  }

  if (typeof payload.currentIndex === 'number') {
    update.currentIndex = payload.currentIndex;
  }

  if (typeof payload.trackPath === 'undefined') {
    return update;
  }

  const currentTrackPath = state.currentTrack ? resolver.getTrackPath(state.currentTrack) : null;
  const normalizedCurrentTrackPath = resolver.normalizeTrackPathForCompare(currentTrackPath);
  const normalizedPlaybackState =
    typeof payload.playbackState === 'string' ? payload.playbackState : null;
  const queueClearedByPayload = Array.isArray(payload.queue) && payload.queue.length === 0;
  const indexClearedByPayload =
    typeof payload.currentIndex === 'number' && payload.currentIndex < 0;
  const localQueueEmpty =
    (Array.isArray(update.queue) ? update.queue.length === 0 : state.queue.length === 0) ||
    queueClearedByPayload;
  const playbackNotActive =
    normalizedPlaybackState !== 'playing' &&
    normalizedPlaybackState !== 'buffering' &&
    normalizedPlaybackState !== 'loading';

  if (typeof payload.trackPath === 'string') {
    const nextTrackPath = payload.trackPath.trim();
    if (nextTrackPath.length <= 0) {
      return update;
    }

    const shouldIgnoreStaleTrackPath = localQueueEmpty && playbackNotActive;
    if (shouldIgnoreStaleTrackPath) {
      update.currentTrack = null;
      update.currentIndex = -1;
      return update;
    }

    const normalizedNextTrackPath = resolver.normalizeTrackPathForCompare(nextTrackPath);
    if (normalizedNextTrackPath === normalizedCurrentTrackPath) {
      return update;
    }

    const resolved = resolver.resolveTrackFromPath(nextTrackPath);
    if (resolved) {
      update.currentTrack = resolved.track;
      update.currentIndex = resolved.index;
      return update;
    }

    update.currentTrack = createNativeTrackFromPath(nextTrackPath, resolver);
    return update;
  }

  if (payload.trackPath === null && currentTrackPath) {
    const shouldClearCurrentTrack =
      payload.ended === true ||
      normalizedPlaybackState === 'stopped' ||
      normalizedPlaybackState === 'idle' ||
      queueClearedByPayload ||
      indexClearedByPayload ||
      state.queue.length === 0;

    if (shouldClearCurrentTrack) {
      update.currentTrack = null;
      if (indexClearedByPayload) {
        update.currentIndex = -1;
      }
    }
  }

  return update;
}

function createNativeTrackFromPath(
  path: string,
  resolver: Pick<NativeAudioQueueStatePayloadResolver, 'deriveTitleFromPath'>
): Track {
  return {
    id: `native-${path}`,
    title: resolver.deriveTitleFromPath(path),
    filePath: path,
    path,
    originalPath: path,
  };
}
