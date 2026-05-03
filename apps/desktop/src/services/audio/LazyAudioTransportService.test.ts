import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeCapsuleManifest } from '../../contracts/runtimeCapsule';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { DefaultRuntimeCapsuleManagerService } from '../runtime-capsules/RuntimeCapsuleManagerService';
import { LazyAudioTransportService } from './LazyAudioTransportService';
import { NoopAudioService } from './NoopAudioService';
import type { Track } from './types';

const TEST_TRACK: Track = {
  id: 'track-1',
  title: 'Track 1',
  artist: 'Artist',
  duration: 12,
  path: 'memory://track-1',
};

const AUDIO_SHELL_CAPSULE: RuntimeCapsuleManifest = {
  id: 'audio.shell',
  kind: 'audio',
  memoryTier: 'light',
  startup: 'core',
  backgroundPolicy: 'while-active',
  warmRetentionMs: 30_000,
  hibernateAfterMs: 120_000,
  provides: ['audio.shell'],
};

const AUDIO_TRANSPORT_CAPSULE: RuntimeCapsuleManifest = {
  id: 'audio.transport',
  kind: 'audio',
  memoryTier: 'medium',
  startup: 'first-use',
  backgroundPolicy: 'realtime-critical',
  warmRetentionMs: 60_000,
  hibernateAfterMs: 300_000,
  dependencies: ['audio.shell'],
  provides: ['audio.transport'],
};

describe('LazyAudioTransportService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps state reads and shell queue mutations off the transport', () => {
    const createTransport = vi.fn(() => new NoopAudioService());
    const service = new LazyAudioTransportService({ createTransport });

    expect(createTransport).not.toHaveBeenCalled();
    expect(service.getState().playbackState).toBe('idle');
    service.addToQueue(TEST_TRACK);

    expect(createTransport).not.toHaveBeenCalled();
    expect(service.getQueue()).toHaveLength(1);

    service.destroy();
  });

  it('creates transport on first playback operation and preserves queued tracks', async () => {
    const createTransport = vi.fn(() => new NoopAudioService());
    const service = new LazyAudioTransportService({ createTransport });

    service.addToQueue(TEST_TRACK);
    await service.playTrackAtIndex(0);

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(service.isTransportActive()).toBe(true);
    expect(service.getState()).toMatchObject({
      currentTrack: expect.objectContaining({ id: TEST_TRACK.id }),
      playbackState: 'playing',
      currentIndex: 0,
    });

    service.destroy();
  });

  it('keeps playlist persistence and query operations in the shell until playback', async () => {
    const createTransport = vi.fn(() => new NoopAudioService());
    const service = new LazyAudioTransportService({ createTransport });

    const playlist = service.createPlaylist('Shell Playlist');
    service.addTrackToPlaylist(playlist.id, TEST_TRACK);
    const page = await service.queryPlaylistTracksPage(playlist.id, { limit: 10, offset: 0 });
    await service.addPlaylistToQueue(playlist.id);

    expect(createTransport).not.toHaveBeenCalled();
    expect(service.getPlaylist(playlist.id)).toMatchObject({
      id: playlist.id,
      trackCount: 1,
    });
    expect(page).toMatchObject({
      total: 1,
      items: [{ playlistIndex: 0, track: expect.objectContaining({ id: TEST_TRACK.id }) }],
    });
    expect(service.getQueue()).toHaveLength(1);

    service.destroy();
  });

  it('keeps advanced settings reads and writes in the shell when transport is inactive', async () => {
    const createTransport = vi.fn(() => new NoopAudioService());
    const service = new LazyAudioTransportService({ createTransport });

    await service.setDynamicSrcAutoSettings({ enabled: false, seekHoldMs: 1234 });
    await service.setAudioTuningAutoSettings({ enabled: false, stableWindowMs: 6000 });
    await service.setEnginePolicy({ stabilityProfile: 'stable', transportMode: 'robust' });

    expect(createTransport).not.toHaveBeenCalled();
    expect(service.getDynamicSrcAutoSettings()).toMatchObject({
      enabled: false,
      seekHoldMs: 1234,
    });
    expect(service.getAudioTuningAutoSettings()).toMatchObject({
      enabled: false,
      stableWindowMs: 6000,
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.NATIVE_AUDIO_ENGINE_POLICY) ?? '{}')).toMatchObject({
      stabilityProfile: 'stable',
      transportMode: 'robust',
    });
    expect(service.getRobustnessSnapshot()).toMatchObject({
      outputBackendId: null,
      outputBackends: [],
    });
    expect(createTransport).not.toHaveBeenCalled();

    service.destroy();
  });

  it('acquires keyed runtime capsule leases for transport playback', async () => {
    const runtimeCapsules = new DefaultRuntimeCapsuleManagerService(() => 1000);
    runtimeCapsules.registerCapsules([AUDIO_SHELL_CAPSULE, AUDIO_TRANSPORT_CAPSULE]);
    const createTransport = vi.fn(() => new NoopAudioService());
    const service = new LazyAudioTransportService({
      createTransport,
      runtimeCapsuleManager: runtimeCapsules,
    });

    service.addToQueue(TEST_TRACK);
    await service.playTrackAtIndex(0);

    const activeSnapshot = runtimeCapsules.collectSnapshot();
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(
      activeSnapshot.capsules.find((capsule) => capsule.manifest.id === 'audio.transport')
    ).toMatchObject({
      state: 'active',
      activeLeases: [expect.objectContaining({ key: 'audio.transport:audio-engine' })],
    });

    service.destroy();

    const releasedSnapshot = runtimeCapsules.collectSnapshot();
    expect(releasedSnapshot.activeLeaseCount).toBe(0);
    runtimeCapsules.dispose();
  });
});
