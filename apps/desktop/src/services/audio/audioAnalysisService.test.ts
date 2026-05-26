import { describe, expect, it, vi } from 'vitest';
import {
  AUDIO_ANALYSIS_DEFAULT_SEGMENT_COUNT,
  AUDIO_ANALYSIS_VERSION,
  DefaultAudioAnalysisService,
  audioAnalysisPriorityRank,
  classifyAudioAnalysisFailure,
  resolveAudioAnalysisTrackIdentity,
} from './audioAnalysisService';
import type { Track } from './types';

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: () => false,
}));

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

describe('DefaultAudioAnalysisService', () => {
  it('returns null for remote tracks without scheduling analysis', async () => {
    const service = new DefaultAudioAnalysisService();

    await expect(service.requestPeakRms(createTrack({
      filePath: undefined,
      path: 'https://example.test/track.flac',
    }))).resolves.toBeNull();

    service.destroy();
  });

  it('exposes stable analysis defaults', () => {
    expect(AUDIO_ANALYSIS_VERSION).toBe(1);
    expect(AUDIO_ANALYSIS_DEFAULT_SEGMENT_COUNT).toBe(1440);
  });

  it('resolves local file identity using PMP track metadata', () => {
    const identity = resolveAudioAnalysisTrackIdentity(createTrack(), 1024);

    expect(identity).toMatchObject({
      trackId: 'track-1',
      sourcePath: 'D:\\Music\\night-drive.flac',
      normalizedPath: 'd:/music/night-drive.flac',
      fileSize: 12_000_000,
      mtimeMs: 1_700_000_000_000,
      duration: 240,
      segmentCount: 1024,
      version: AUDIO_ANALYSIS_VERSION,
    });
    expect(identity?.key).toContain('1024');
  });

  it('rejects non-local track identity', () => {
    expect(resolveAudioAnalysisTrackIdentity(createTrack({
      filePath: undefined,
      path: 'https://example.test/track.flac',
    }))).toBeNull();
  });

  it('ranks current-track analysis ahead of queued background analysis', () => {
    const items = [
      { key: 'background', priority: 'background' as const, requestedAt: 1 },
      { key: 'next', priority: 'next' as const, requestedAt: 2 },
      { key: 'current', priority: 'current' as const, requestedAt: 3 },
    ];

    const sorted = items.sort((left, right) => {
      const rankDelta =
        audioAnalysisPriorityRank(right.priority) - audioAnalysisPriorityRank(left.priority);
      if (rankDelta !== 0) return rankDelta;
      return left.requestedAt - right.requestedAt;
    });

    expect(sorted.map((item) => item.key)).toEqual(['current', 'next', 'background']);
  });

  it('classifies analysis probe misses as expected non-playback failures', () => {
    expect(
      classifyAudioAnalysisFailure(
        'AUDIO_ANALYSIS_PROBE_FAILED: Failed to probe audio file for analysis: end of stream'
      )
    ).toMatchObject({
      code: 'AUDIO_ANALYSIS_PROBE_FAILED',
      expectedMiss: true,
      reason: 'probe-failed',
    });

    expect(classifyAudioAnalysisFailure(new Error('AUDIO_ANALYSIS_NO_SAMPLES'))).toMatchObject({
      code: 'AUDIO_ANALYSIS_NO_SAMPLES',
      expectedMiss: true,
      reason: 'no-samples',
    });

    expect(classifyAudioAnalysisFailure(new Error('backend unavailable'))).toMatchObject({
      code: null,
      expectedMiss: false,
      reason: 'unexpected',
    });
  });
});
