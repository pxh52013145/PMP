import { describe, expect, it } from 'vitest';

import {
  resolveDynamicSrcAutoDegradationState,
  toDynamicSrcAutoDegradationLabel,
  type ResolveDynamicSrcAutoDegradationInput,
} from '../robustnessDegradation';

function buildInput(
  patch?: Partial<ResolveDynamicSrcAutoDegradationInput>
): ResolveDynamicSrcAutoDegradationInput {
  return {
    autoEnabled: true,
    manualLockActive: false,
    playbackState: 'playing',
    stressScore: 0,
    nowMs: 1_000,
    underrunRecoveryUntilMs: 0,
    protectionWindowActive: false,
    sharedStressWindowActive: false,
    lastUnderrunFrames: 0,
    severeUnderrunFramesThreshold: 1024,
    elevatedScoreThreshold: 4,
    criticalScoreThreshold: 8,
    ...patch,
  };
}

describe('robustnessDegradation', () => {
  it('maps degradation levels to stable labels', () => {
    expect(toDynamicSrcAutoDegradationLabel(0)).toBe('l0-fidelity');
    expect(toDynamicSrcAutoDegradationLabel(1)).toBe('l1-balanced');
    expect(toDynamicSrcAutoDegradationLabel(2)).toBe('l2-protection');
  });

  it('returns L0 when auto mode is disabled or manually locked', () => {
    expect(resolveDynamicSrcAutoDegradationState(buildInput({ autoEnabled: false }))).toEqual({
      level: 0,
      reason: null,
    });

    expect(resolveDynamicSrcAutoDegradationState(buildInput({ manualLockActive: true }))).toEqual({
      level: 0,
      reason: null,
    });
  });

  it('enters L1 on elevated stress and underrun recovery', () => {
    expect(resolveDynamicSrcAutoDegradationState(buildInput({ stressScore: 5 }))).toEqual({
      level: 1,
      reason: 'stress-score-elevated',
    });

    expect(
      resolveDynamicSrcAutoDegradationState(
        buildInput({ stressScore: 0, underrunRecoveryUntilMs: 2_000 })
      )
    ).toEqual({
      level: 1,
      reason: 'underrun-recovery',
    });
  });

  it('enters L2 under critical stress and severe underrun bursts', () => {
    expect(resolveDynamicSrcAutoDegradationState(buildInput({ stressScore: 9 }))).toEqual({
      level: 2,
      reason: 'stress-score-critical',
    });

    expect(
      resolveDynamicSrcAutoDegradationState(
        buildInput({
          stressScore: 0,
          lastUnderrunFrames: 2048,
        })
      )
    ).toEqual({
      level: 2,
      reason: 'underrun-burst',
    });
  });

  it('prioritizes shared/protection windows over generic critical stress', () => {
    expect(
      resolveDynamicSrcAutoDegradationState(
        buildInput({
          stressScore: 10,
          protectionWindowActive: true,
          sharedStressWindowActive: true,
        })
      )
    ).toEqual({
      level: 2,
      reason: 'shared-stress-window',
    });

    expect(
      resolveDynamicSrcAutoDegradationState(
        buildInput({
          stressScore: 10,
          protectionWindowActive: true,
          sharedStressWindowActive: false,
        })
      )
    ).toEqual({
      level: 2,
      reason: 'protection-window',
    });
  });
});
