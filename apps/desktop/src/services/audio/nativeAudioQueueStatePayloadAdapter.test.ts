import { describe, expect, it, vi } from 'vitest';
import { resolveNativeAudioQueueStatePayload } from './nativeAudioQueueStatePayloadAdapter';
import type { AudioState, Track } from './types';

function createTrack(id: string, title: string, path: string): Track {
  return {
    id,
    title,
    path,
    filePath: path,
    originalPath: path,
  };
}

function createState(): AudioState {
  return {
    currentTrack: createTrack('current', 'Current', '/music/current.flac'),
    playbackState: 'playing',
    currentTime: 0,
    duration: 0,
    bufferedTime: 0,
    bufferedAhead: 0,
    volume: 1,
    muted: false,
    playMode: 'sequence',
    queue: [createTrack('current', 'Current', '/music/current.flac')],
    currentIndex: 0,
    playlists: [],
    currentPlaylist: null,
  };
}

describe('nativeAudioQueueStatePayloadAdapter', () => {
  it('resolves existing queue entries and current index updates', () => {
    const state = createState();
    const resolveQueueFromPaths = vi.fn((paths: string[]) =>
      paths.map((path, index) => createTrack(`next-${index}`, `Next ${index}`, path))
    );
    const resolved = resolveNativeAudioQueueStatePayload({
      payload: {
        queue: ['/music/next.flac'],
        currentIndex: 2,
      },
      state,
      resolver: {
        deriveTitleFromPath: (path) => path.split('/').at(-1) ?? 'Unknown Track',
        getTrackPath: (track) => track?.filePath ?? track?.path ?? null,
        isSameQueuePaths: () => false,
        normalizeTrackPathForCompare: (path) => (path ?? '').trim().toLowerCase(),
        resolveQueueFromPaths,
        resolveTrackFromPath: () => null,
      },
    });

    expect(resolveQueueFromPaths).toHaveBeenCalledWith(['/music/next.flac']);
    expect(resolved.queue).toEqual([
      createTrack('next-0', 'Next 0', '/music/next.flac'),
    ]);
    expect(resolved.currentIndex).toBe(2);
  });

  it('reuses a matching track from the current queue when trackPath changes', () => {
    const existing = createTrack('existing', 'Existing', '/music/existing.flac');
    const state = {
      ...createState(),
      currentTrack: existing,
      queue: [existing],
      currentIndex: 0,
    };

    const resolved = resolveNativeAudioQueueStatePayload({
      payload: {
        trackPath: '/music/existing.flac',
        playbackState: 'playing',
      },
      state,
      resolver: {
        deriveTitleFromPath: (path) => path.split('/').at(-1) ?? 'Unknown Track',
        getTrackPath: (track) => track?.filePath ?? track?.path ?? null,
        isSameQueuePaths: () => true,
        normalizeTrackPathForCompare: (path) => (path ?? '').trim().toLowerCase(),
        resolveQueueFromPaths: () => [],
        resolveTrackFromPath: (path) =>
          path === '/music/existing.flac'
            ? {
                track: existing,
                index: 0,
              }
            : null,
      },
    });

    expect(resolved).toEqual({});
  });

  it('creates a fallback native track when no queue entry resolves', () => {
    const state = createState();
    const resolved = resolveNativeAudioQueueStatePayload({
      payload: {
        trackPath: '/music/new-track.flac',
        playbackState: 'playing',
      },
      state,
      resolver: {
        deriveTitleFromPath: (path) => path.split('/').at(-1) ?? 'Unknown Track',
        getTrackPath: (track) => track?.filePath ?? track?.path ?? null,
        isSameQueuePaths: () => true,
        normalizeTrackPathForCompare: (path) => (path ?? '').trim().toLowerCase(),
        resolveQueueFromPaths: () => [],
        resolveTrackFromPath: () => null,
      },
    });

    expect(resolved.currentTrack).toEqual({
      id: 'native-/music/new-track.flac',
      title: 'new-track.flac',
      filePath: '/music/new-track.flac',
      path: '/music/new-track.flac',
      originalPath: '/music/new-track.flac',
    });
  });

  it('clears stale trackPath updates when playback is inactive and the queue is empty', () => {
    const state = {
      ...createState(),
      currentTrack: null,
      queue: [],
      currentIndex: -1,
      playbackState: 'stopped',
    } satisfies AudioState;

    const resolved = resolveNativeAudioQueueStatePayload({
      payload: {
        trackPath: '/music/stale.flac',
        playbackState: 'stopped',
        queue: [],
        currentIndex: -1,
      },
      state,
      resolver: {
        deriveTitleFromPath: (path) => path.split('/').at(-1) ?? 'Unknown Track',
        getTrackPath: (track) => track?.filePath ?? track?.path ?? null,
        isSameQueuePaths: () => true,
        normalizeTrackPathForCompare: (path) => (path ?? '').trim().toLowerCase(),
        resolveQueueFromPaths: () => [],
        resolveTrackFromPath: () => null,
      },
    });

    expect(resolved).toEqual({
      currentTrack: null,
      currentIndex: -1,
    });
  });

  it('clears current track on ended or stopped null track payloads', () => {
    const state = createState();
    const resolved = resolveNativeAudioQueueStatePayload({
      payload: {
        trackPath: null,
        playbackState: 'stopped',
        ended: true,
        currentIndex: -1,
      },
      state,
      resolver: {
        deriveTitleFromPath: (path) => path.split('/').at(-1) ?? 'Unknown Track',
        getTrackPath: (track) => track?.filePath ?? track?.path ?? null,
        isSameQueuePaths: () => true,
        normalizeTrackPathForCompare: (path) => (path ?? '').trim().toLowerCase(),
        resolveQueueFromPaths: () => [],
        resolveTrackFromPath: () => null,
      },
    });

    expect(resolved).toEqual({
      currentTrack: null,
      currentIndex: -1,
    });
  });
});
