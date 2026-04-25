import { describe, expect, it } from 'vitest';
import { computeDynamicSrcStressScore, type AudioStabilityScoreMetrics } from './audioStabilityController';

function createMetrics(input: Partial<AudioStabilityScoreMetrics> = {}): AudioStabilityScoreMetrics {
  return {
    playbackState: 'playing',
    underrunRecoveryUntilMs: 0,
    nowMs: 1_000,
    protectionWindowActive: false,
    sharedStressWindowActive: false,
    outputCallbackMetricsValid: false,
    outputWaitTimeoutCount: 0,
    outputRenderUnderrunEvents: 0,
    outputCallbackIntervalOverrunCount: 0,
    outputCallbackIntervalJitterP99Us: 0,
    transferMetricsValid: true,
    transferRenderLowHitCount: 0,
    transferDecodeLowHitCount: 0,
    renderQueuePageLocked: true,
    sharedRenderAheadEnabled: false,
    sharedRenderUnderrunEvents: 0,
    sharedRenderLowHitCount: 0,
    ...input,
  };
}

describe('audioStabilityController', () => {
  it('treats an unlocked render queue as memory-pressure stress', () => {
    const locked = computeDynamicSrcStressScore(createMetrics({ renderQueuePageLocked: true }));
    const unlocked = computeDynamicSrcStressScore(createMetrics({ renderQueuePageLocked: false }));

    expect(unlocked).toBe(locked + 1);
  });

  it('does not penalize render page-lock status when transfer metrics are unavailable', () => {
    const score = computeDynamicSrcStressScore(
      createMetrics({ transferMetricsValid: false, renderQueuePageLocked: false })
    );

    expect(score).toBe(0);
  });
});
