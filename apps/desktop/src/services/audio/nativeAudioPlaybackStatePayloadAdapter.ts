import type { AudioState } from './types';
import type { NativeAudioStatePayload } from './nativeAudioServiceTypes';

type NativeAudioPlaybackStateFields = Pick<
  AudioState,
  | 'playbackState'
  | 'volume'
  | 'muted'
  | 'currentTime'
  | 'duration'
  | 'playbackRate'
  | 'bufferedTime'
  | 'bufferedAhead'
  | 'decodeBufferedAhead'
  | 'outputBufferedAhead'
>;

export type NativeAudioPlaybackStatePayloadResolution = {
  update: Partial<NativeAudioPlaybackStateFields>;
  currentTime: number | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function resolvePayloadDuration(
  payload: NativeAudioStatePayload,
  state: AudioState
): number | undefined {
  if (typeof payload.duration !== 'undefined') {
    const reportedDuration = isFiniteNumber(payload.duration) ? payload.duration : 0;
    const trackDuration = state.currentTrack?.duration;
    const hasTrackDuration = isFiniteNumber(trackDuration) && trackDuration > 0;

    if (reportedDuration > 0) return reportedDuration;
    if (hasTrackDuration) return trackDuration;
    return reportedDuration;
  }

  const trackDuration = state.currentTrack?.duration;
  const hasTrackDuration = isFiniteNumber(trackDuration) && trackDuration > 0;
  if ((state.duration ?? 0) <= 0 && hasTrackDuration) {
    return trackDuration;
  }

  return undefined;
}

export function resolveNativeAudioPlaybackStatePayload(input: {
  payload: NativeAudioStatePayload;
  state: AudioState;
}): NativeAudioPlaybackStatePayloadResolution {
  const { payload, state } = input;
  const update: Partial<NativeAudioPlaybackStateFields> = {};

  if (typeof payload.playbackState !== 'undefined') {
    update.playbackState = payload.playbackState;
  }

  if (typeof payload.volume !== 'undefined') {
    update.volume = payload.volume;
  }

  if (typeof payload.muted !== 'undefined') {
    update.muted = payload.muted;
  }

  const currentTime = payload.currentTime;
  const hasCurrentTime = isFiniteNumber(currentTime);
  let nextCurrentTime: number | null = null;
  if (hasCurrentTime) {
    nextCurrentTime = currentTime;
  }

  const duration = resolvePayloadDuration(payload, state);
  if (typeof duration !== 'undefined') {
    update.duration = duration;
  }

  if (typeof payload.playbackRate !== 'undefined') {
    update.playbackRate = isFiniteNumber(payload.playbackRate)
      ? Math.max(0.25, Math.min(4, payload.playbackRate))
      : 1;
  }

  if (typeof payload.bufferedTime !== 'undefined') {
    update.bufferedTime = payload.bufferedTime;
  }

  if (typeof payload.bufferedAhead !== 'undefined') {
    update.bufferedAhead = payload.bufferedAhead;
  }

  if (typeof payload.decodeBufferedAhead !== 'undefined') {
    update.decodeBufferedAhead = payload.decodeBufferedAhead;
  }

  if (typeof payload.outputBufferedAhead !== 'undefined') {
    update.outputBufferedAhead = payload.outputBufferedAhead;
  }

  return {
    update,
    currentTime: nextCurrentTime,
  };
}
