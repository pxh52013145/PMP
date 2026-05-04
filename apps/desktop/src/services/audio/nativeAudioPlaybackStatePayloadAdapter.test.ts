import { describe, expect, it } from 'vitest';
import { resolveNativeAudioPlaybackStatePayload } from './nativeAudioPlaybackStatePayloadAdapter';
import type { AudioState, Track } from './types';

function createTrack(duration: number): Track {
  return {
    id: 'current',
    title: 'Current',
    path: '/music/current.flac',
    filePath: '/music/current.flac',
    originalPath: '/music/current.flac',
    duration,
  };
}

function createState(): AudioState {
  return {
    currentTrack: createTrack(180),
    playbackState: 'paused',
    currentTime: 0,
    duration: 0,
    bufferedTime: 0,
    bufferedAhead: 0,
    volume: 1,
    muted: false,
    playMode: 'sequence',
    queue: [createTrack(180)],
    currentIndex: 0,
    playlists: [],
    currentPlaylist: null,
  };
}

describe('nativeAudioPlaybackStatePayloadAdapter', () => {
  it('resolves playback fields, buffered fields, and duration fallbacks', () => {
    const state = createState();

    const result = resolveNativeAudioPlaybackStatePayload({
      payload: {
        playbackState: 'playing',
        volume: 0.5,
        muted: true,
        currentTime: 45.9,
        duration: 0,
        bufferedTime: 12.5,
        bufferedAhead: 13.5,
        decodeBufferedAhead: 14.5,
        outputBufferedAhead: 15.5,
      },
      state,
    });

    expect(result.currentTime).toBe(45.9);
    expect(result.update).toEqual({
      playbackState: 'playing',
      volume: 0.5,
      muted: true,
      duration: 180,
      bufferedTime: 12.5,
      bufferedAhead: 13.5,
      decodeBufferedAhead: 14.5,
      outputBufferedAhead: 15.5,
    });
  });

  it('keeps the existing duration when the payload omits one and the current state is already valid', () => {
    const state = {
      ...createState(),
      duration: 240,
    };

    const result = resolveNativeAudioPlaybackStatePayload({
      payload: {
        currentTime: 20,
      },
      state,
    });

    expect(result.currentTime).toBe(20);
    expect(result.update).toEqual({});
  });
});
