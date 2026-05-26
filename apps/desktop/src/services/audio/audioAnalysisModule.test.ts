import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContributionRegistry, EventBus, ServiceRegistry } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { AUDIO_ANALYSIS_SERVICE_TOKEN } from './audioAnalysisService';
import {
  collectAudioAnalysisPreheatTargets,
  createAudioAnalysisModule,
  shouldSkipAudioAnalysisPreheat,
} from './audioAnalysisModule';
import type { AudioState, Track } from './types';

const { requestPeakRmsMock, tauriRuntimeMock } = vi.hoisted(() => ({
  requestPeakRmsMock: vi.fn(),
  tauriRuntimeMock: vi.fn(() => false),
}));

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: tauriRuntimeMock,
}));

vi.mock('./audioAnalysisService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./audioAnalysisService')>();

  class MockAudioAnalysisService extends actual.DefaultAudioAnalysisService {
    requestPeakRms = requestPeakRmsMock;
  }

  return {
    ...actual,
    DefaultAudioAnalysisService: MockAudioAnalysisService,
  };
});

function createTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Night Drive',
    filePath: 'D:\\Music\\night-drive.flac',
    duration: 240,
    fileSize: 12_000_000,
    mtimeMs: 1_700_000_000_000,
    ...overrides,
  };
}

function createAudioState(track: Track | null): AudioState {
  return {
    currentTrack: track,
    playbackState: 'playing',
    currentTime: 0,
    duration: track?.duration ?? 0,
    bufferedTime: 0,
    bufferedAhead: 0,
    volume: 1,
    muted: false,
    playMode: 'sequence',
    queue: track ? [track] : [],
    currentIndex: 0,
    playlists: [],
    currentPlaylist: null,
  };
}

describe('createAudioAnalysisModule', () => {
  beforeEach(() => {
    tauriRuntimeMock.mockReset();
    tauriRuntimeMock.mockReturnValue(false);
    requestPeakRmsMock.mockReset();
    requestPeakRmsMock.mockResolvedValue(null);
  });

  it('registers and disposes the audio analysis service independently', () => {
    const services = new ServiceRegistry();
    const events = new EventBus<AppEvents>().withSource('test');
    const contributions = new ContributionRegistry();
    const module = createAudioAnalysisModule();

    const dispose = module.activate({
      services,
      events,
      contributions,
    });

    expect(services.getOptional(AUDIO_ANALYSIS_SERVICE_TOKEN)).not.toBeNull();
    expect(() => events.emit('audio/stateChanged', createAudioState(createTrack()))).not.toThrow();

    dispose?.();
    expect(services.getOptional(AUDIO_ANALYSIS_SERVICE_TOKEN)).toBeNull();
  });

  it('collects the current track before the next-track preheat target', () => {
    const current = createTrack({ id: 'current', filePath: 'D:\\Music\\current.flac' });
    const next = createTrack({ id: 'next', filePath: 'D:\\Music\\next.flac' });
    const later = createTrack({ id: 'later', filePath: 'D:\\Music\\later.flac' });

    const targets = collectAudioAnalysisPreheatTargets({
      ...createAudioState(current),
      queue: [current, next, later],
      currentIndex: 0,
    });

    expect(targets.map((target) => ({
      id: target.track.id,
      priority: target.priority,
      reason: target.reason,
    }))).toEqual([
      { id: 'current', priority: 'current', reason: 'current-track' },
      { id: 'next', priority: 'next', reason: 'queue-next' },
    ]);
  });

  it('keeps auxiliary-window modules registered without preheating tracks', () => {
    tauriRuntimeMock.mockReturnValue(true);
    const services = new ServiceRegistry();
    const events = new EventBus<AppEvents>().withSource('test');
    const contributions = new ContributionRegistry();
    const module = createAudioAnalysisModule({ enablePreheat: false });

    const dispose = module.activate({
      services,
      events,
      contributions,
    });

    expect(services.getOptional(AUDIO_ANALYSIS_SERVICE_TOKEN)).not.toBeNull();
    events.emit('audio/stateChanged', createAudioState(createTrack()));

    expect(requestPeakRmsMock).not.toHaveBeenCalled();
    dispose?.();
  });

  it('skips automatic preheat for high-sample-rate tracks', () => {
    tauriRuntimeMock.mockReturnValue(true);
    const services = new ServiceRegistry();
    const events = new EventBus<AppEvents>().withSource('test');
    const contributions = new ContributionRegistry();
    const module = createAudioAnalysisModule();
    const highRateTrack = createTrack({ sampleRate: 192_000 });

    const dispose = module.activate({
      services,
      events,
      contributions,
    });

    events.emit('audio/stateChanged', createAudioState(highRateTrack));

    expect(shouldSkipAudioAnalysisPreheat(highRateTrack)).toBe(true);
    expect(requestPeakRmsMock).not.toHaveBeenCalled();
    dispose?.();
  });

  it('allows next-track preheat to upgrade when the same track becomes current', () => {
    tauriRuntimeMock.mockReturnValue(true);
    const services = new ServiceRegistry();
    const events = new EventBus<AppEvents>().withSource('test');
    const contributions = new ContributionRegistry();
    const module = createAudioAnalysisModule();
    const current = createTrack({ id: 'current', filePath: 'D:\\Music\\current.flac' });
    const next = createTrack({ id: 'next', filePath: 'D:\\Music\\next.flac' });

    const dispose = module.activate({
      services,
      events,
      contributions,
    });

    events.emit('audio/stateChanged', {
      ...createAudioState(current),
      queue: [current, next],
      currentIndex: 0,
    });
    events.emit('audio/stateChanged', {
      ...createAudioState(next),
      queue: [current, next],
      currentIndex: 1,
    });

    expect(requestPeakRmsMock).toHaveBeenCalledWith(next, {
      priority: 'next',
      reason: 'queue-next',
    });
    expect(requestPeakRmsMock).toHaveBeenCalledWith(next, {
      priority: 'current',
      reason: 'current-track',
    });

    dispose?.();
  });
});
