import { describe, expect, it } from 'vitest';
import type { AudioState, IAudioService } from '../../services/audio';
import type { AudioSpectrumFrame } from '../../services/audio/types';
import { AudioDataBus } from './AudioDataBus';

function createAudioService(overrides: Partial<IAudioService> = {}): IAudioService {
  const state: AudioState = {
    currentTrack: {
      id: 'track-1',
      title: 'Night Drive',
      artist: 'Pixel Matrix',
      album: 'Neon Roads',
      lyrics: '[00:00.00]Night Drive',
    },
    playbackState: 'playing',
    currentTime: 42,
    duration: 84,
    bufferedTime: 84,
    bufferedAhead: 42,
    volume: 0.7,
    muted: false,
    playMode: 'sequence',
    queue: [],
    currentIndex: 0,
    playlists: [],
    currentPlaylist: null,
  };

  const spectrumFrame: AudioSpectrumFrame = {
    frameId: 7,
    timestampMs: 1000,
    tap: 'post-dsp',
    sampleRate: 44_100,
    bins: new Uint8Array([0, 0, 255, 255, 0, 0, 128, 255]),
  };

  return {
    loadTrack: async () => {},
    play: async () => {},
    pause: () => {},
    stop: () => {},
    seek: () => {},
    setVolume: () => {},
    getVolume: () => state.volume,
    toggleMute: () => {},
    getCurrentTime: () => state.currentTime,
    getDuration: () => state.duration,
    getState: () => state,
    onTimeUpdate: () => () => {},
    onEnded: () => () => {},
    onStateChange: () => () => {},
    onLoadProgress: () => () => {},
    onError: () => () => {},
    addToQueue: () => {},
    addMultipleToQueue: () => {},
    removeFromQueue: () => {},
    clearQueue: () => {},
    getQueue: () => [],
    playTrackAtIndex: async () => {},
    reorderQueue: () => {},
    playPrevious: async () => {},
    playNext: async () => {},
    setPlayMode: () => {},
    getPlayMode: () => state.playMode,
    fastForward: () => {},
    rewind: () => {},
    createPlaylist: () => ({
      id: 'playlist-1',
      name: 'Playlist',
      tracks: [],
      createdAt: 0,
      updatedAt: 0,
    }),
    deletePlaylist: () => {},
    renamePlaylist: () => {},
    getPlaylists: () => [],
    getPlaylist: () => null,
    addTrackToPlaylist: () => {},
    removeTrackFromPlaylist: () => {},
    clearPlaylist: () => {},
    playPlaylist: async () => {},
    addPlaylistToQueue: async () => {},
    destroy: () => {},
    getFrequencyData: () => null,
    getSpectrumFrame: () => spectrumFrame,
    ...overrides,
  } satisfies IAudioService;
}

describe('AudioDataBus', () => {
  it('samples audio analysis from the spectrum frame and caches the result', () => {
    const bus = new AudioDataBus(createAudioService());
    const snapshot = bus.sample(1_000);

    expect(snapshot.timestamp).toBe(1_000);
    expect(snapshot.track).toEqual({
      title: 'Night Drive',
      artist: 'Pixel Matrix',
      album: 'Neon Roads',
      lyrics: '[00:00.00]Night Drive',
    });
    expect(snapshot.playback).toMatchObject({
      currentTime: 42,
      duration: 84,
      progress: 0.5,
      isPlaying: true,
      sampleRate: 44_100,
      playbackState: 'playing',
    });
    expect(snapshot.frequency).toEqual(new Uint8Array([0, 0, 255, 255, 0, 0, 128, 255]));
    expect(snapshot.timeDomain.length).toBe(128);
    expect(snapshot.timeDomain.some((value) => value !== 128)).toBe(true);
    expect(snapshot.analysis.energy).toBeCloseTo(0.4377, 3);
    expect(snapshot.analysis.smoothedEnergy).toBeCloseTo(0.4377, 3);
    expect(snapshot.analysis.bass).toBeCloseTo(0.5, 3);
    expect(snapshot.analysis.mid).toBeCloseTo(0.6667, 3);
    expect(snapshot.analysis.treble).toBeCloseTo(0.3755, 3);
    expect(snapshot.analysis.peakBin).toBe(2);
    expect(snapshot.analysis.peakValue).toBeCloseTo(1, 5);
    expect(snapshot.analysis.beatStrength).toBeGreaterThan(0);
    expect(snapshot.analysis.beatStrength).toBeLessThanOrEqual(1);
    expect(snapshot.analysis.beatPhase).toBeGreaterThanOrEqual(0);
    expect(snapshot.analysis.beatPhase).toBeLessThan(1);
    expect(bus.getSnapshot()).toBe(snapshot);
  });

  it('notifies listeners when a new snapshot is sampled', () => {
    const bus = new AudioDataBus(createAudioService());
    const received: number[] = [];

    const unsubscribe = bus.subscribe((snapshot) => {
      received.push(snapshot.timestamp);
    });

    bus.sample(250);
    unsubscribe();
    bus.sample(500);

    expect(received).toEqual([250]);
  });

  it('prefers time-domain samples from the native spectrum frame', () => {
    const nativeTimeDomain = new Uint8Array([0, 64, 128, 192, 255]);
    const bus = new AudioDataBus(createAudioService({
      getSpectrumFrame: () => ({
        frameId: 8,
        timestampMs: 1_200,
        tap: 'post-dsp',
        sampleRate: 48_000,
        bins: new Uint8Array([0, 255, 0, 255]),
        timeDomain: nativeTimeDomain,
      }),
    }));

    const snapshot = bus.sample(1_200);

    expect(snapshot.timeDomain).toEqual(nativeTimeDomain);
    expect(snapshot.timeDomain).toBe(nativeTimeDomain);
  });

  it('smooths spectrum changes with fast attack and slower release', () => {
    let bins = new Uint8Array([0, 0, 0, 0]);
    const bus = new AudioDataBus(createAudioService({
      getSpectrumFrame: () => ({
        frameId: 9,
        timestampMs: 1_000,
        tap: 'post-dsp',
        sampleRate: 44_100,
        bins,
      }),
    }));

    expect(bus.sample(1_000).frequency).toEqual(new Uint8Array([0, 0, 0, 0]));

    bins = new Uint8Array([255, 0, 0, 0]);
    const rising = bus.sample(1_016.67).frequency[0] ?? 0;
    expect(rising).toBeGreaterThan(170);
    expect(rising).toBeLessThan(255);

    bins = new Uint8Array([0, 0, 0, 0]);
    const falling = bus.sample(1_033.34).frequency[0] ?? 0;
    expect(falling).toBeLessThan(rising);
    expect(falling).toBeGreaterThan(100);
  });

  it('advances playback time between low-frequency service updates', () => {
    const bus = new AudioDataBus(createAudioService());

    const first = bus.sample(1_000);
    const second = bus.sample(1_250);
    const third = bus.sample(1_500);

    expect(first.playback.currentTime).toBeCloseTo(42, 5);
    expect(second.playback.currentTime).toBeCloseTo(42.25, 5);
    expect(third.playback.currentTime).toBeCloseTo(42.5, 5);
  });

  it('does not snap back when stale service time arrives on the next frame', () => {
    let serviceTime = 42;
    const bus = new AudioDataBus(createAudioService({
      getCurrentTime: () => serviceTime,
    }));

    expect(bus.sample(1_000).playback.currentTime).toBeCloseTo(42, 5);
    expect(bus.sample(1_250).playback.currentTime).toBeCloseTo(42.25, 5);

    serviceTime = 42.25;
    expect(bus.sample(1_266).playback.currentTime).toBeCloseTo(42.266, 5);
  });

  it('soft-corrects moderate positive drift without snapping the clock', () => {
    let serviceTime = 42;
    const bus = new AudioDataBus(createAudioService({
      getCurrentTime: () => serviceTime,
    }));

    expect(bus.sample(1_000).playback.currentTime).toBeCloseTo(42, 5);
    expect(bus.sample(1_250).playback.currentTime).toBeCloseTo(42.25, 5);

    serviceTime = 42.7;
    expect(bus.sample(1_500).playback.currentTime).toBeCloseTo(42.55, 5);
  });
});
