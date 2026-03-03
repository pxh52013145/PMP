import { describe, expect, it } from 'vitest';

import {
  computeDynamicSrcStressScore,
  resolveDynamicSrcDegradationTransition,
} from '../audioStabilityController';

describe('audioStabilityController', () => {
  it('computes stress score from multi-source pressure', () => {
    const score = computeDynamicSrcStressScore({
      playbackState: 'buffering',
      underrunRecoveryUntilMs: 10_000,
      nowMs: 8_000,
      protectionWindowActive: true,
      sharedStressWindowActive: false,
      outputCallbackMetricsValid: true,
      outputWaitTimeoutCount: 2,
      outputRenderUnderrunEvents: 1,
      outputCallbackIntervalOverrunCount: 1,
      outputCallbackIntervalJitterP99Us: 3_000,
      transferMetricsValid: true,
      transferRenderLowHitCount: 1,
      transferDecodeLowHitCount: 1,
      renderQueuePageLocked: true,
      sharedRenderAheadEnabled: true,
      sharedRenderUnderrunEvents: 2,
      sharedRenderLowHitCount: 1,
    });

    expect(score).toBeGreaterThan(0);
    expect(score).toBe(21);
  });

  it('resolves transition action enter-l1 on elevated stress', () => {
    const transition = resolveDynamicSrcDegradationTransition({
      previousState: { level: 0, reason: null },
      autoEnabled: true,
      manualLockActive: false,
      lastUnderrunFrames: 0,
      severeUnderrunFramesThreshold: 4_096,
      elevatedScoreThreshold: 4,
      criticalScoreThreshold: 8,
      metrics: {
        playbackState: 'buffering',
        underrunRecoveryUntilMs: 0,
        nowMs: 12_000,
        protectionWindowActive: false,
        sharedStressWindowActive: false,
        outputCallbackMetricsValid: true,
        outputWaitTimeoutCount: 1,
        outputRenderUnderrunEvents: 1,
        outputCallbackIntervalOverrunCount: 0,
        outputCallbackIntervalJitterP99Us: 0,
        transferMetricsValid: false,
        transferRenderLowHitCount: 0,
        transferDecodeLowHitCount: 0,
        renderQueuePageLocked: false,
        sharedRenderAheadEnabled: false,
        sharedRenderUnderrunEvents: 0,
        sharedRenderLowHitCount: 0,
      },
    });

    expect(transition.changed).toBe(true);
    expect(transition.nextState.level).toBe(1);
    expect(transition.action).toBe('enter-l1');
  });

  it('honors stressScoreOverride for deterministic transition', () => {
    const transition = resolveDynamicSrcDegradationTransition({
      previousState: { level: 1, reason: 'stress-score-elevated' },
      autoEnabled: true,
      manualLockActive: false,
      stressScoreOverride: 0,
      lastUnderrunFrames: 0,
      severeUnderrunFramesThreshold: 4_096,
      elevatedScoreThreshold: 4,
      criticalScoreThreshold: 8,
      metrics: {
        playbackState: 'playing',
        underrunRecoveryUntilMs: 0,
        nowMs: 20_000,
        protectionWindowActive: false,
        sharedStressWindowActive: false,
        outputCallbackMetricsValid: true,
        outputWaitTimeoutCount: 10,
        outputRenderUnderrunEvents: 10,
        outputCallbackIntervalOverrunCount: 10,
        outputCallbackIntervalJitterP99Us: 8_000,
        transferMetricsValid: true,
        transferRenderLowHitCount: 10,
        transferDecodeLowHitCount: 10,
        renderQueuePageLocked: true,
        sharedRenderAheadEnabled: true,
        sharedRenderUnderrunEvents: 10,
        sharedRenderLowHitCount: 10,
      },
    });

    expect(transition.nextState.level).toBe(0);
    expect(transition.action).toBe('recover-l0');
  });
});
