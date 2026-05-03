import { describe, expect, it } from 'vitest';
import {
  NativeAudioDynamicSrcPolicyController,
  resolveNativeAudioDynamicSrcSettingsPatch,
} from './nativeAudioDynamicSrcPolicyController';
import type { AudioDynamicSrcAutoSettings } from './types';
import type { AudioStabilityScoreMetrics } from './audioStabilityController';
import type { NativeAudioSrcPolicy } from './nativeAudioServiceTypes';

const DEFAULT_SETTINGS: AudioDynamicSrcAutoSettings = {
  enabled: true,
  adaptiveEnabled: true,
  learningEnabled: true,
  restoreDebounceMs: 4_000,
  minSwitchIntervalMs: 600,
  seekHoldMs: 2_000,
  underrunHoldMs: 12_000,
  sharedStressHoldMs: 8_000,
  outputErrorHoldMs: 10_000,
};

const QUALITY_POLICY: NativeAudioSrcPolicy = {
  srcMode: 'match-output',
  srcBackend: 'rubato',
  srcTargetSampleRate: null,
};

const LATENCY_POLICY: NativeAudioSrcPolicy = {
  srcMode: 'match-output',
  srcBackend: 'linear-simd',
  srcTargetSampleRate: null,
};

function createMetrics(input: Partial<AudioStabilityScoreMetrics> = {}): AudioStabilityScoreMetrics {
  return {
    playbackState: 'playing',
    underrunRecoveryUntilMs: 0,
    nowMs: 1_000,
    protectionWindowActive: false,
    sharedStressWindowActive: false,
    outputCallbackMetricsValid: true,
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

function createController(options?: {
  setTimeoutFn?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  return new NativeAudioDynamicSrcPolicyController({
    defaults: DEFAULT_SETTINGS,
    thresholds: {
      elevatedScoreThreshold: 4,
      criticalScoreThreshold: 8,
      severeUnderrunFramesThreshold: 1024,
      degradationL2HoldFloorMs: 4_000,
    },
    setTimeoutFn: options?.setTimeoutFn,
    clearTimeoutFn: options?.clearTimeoutFn,
  });
}

describe('NativeAudioDynamicSrcPolicyController', () => {
  it('normalizes settings patches with the same realtime bounds as storage settings', () => {
    expect(
      resolveNativeAudioDynamicSrcSettingsPatch({
        current: DEFAULT_SETTINGS,
        patch: {
          enabled: false,
          minSwitchIntervalMs: 1,
          restoreDebounceMs: 100_000,
          underrunHoldMs: 1,
        },
      })
    ).toMatchObject({
      enabled: false,
      minSwitchIntervalMs: 100,
      restoreDebounceMs: 30_000,
      underrunHoldMs: 2_000,
    });
  });

  it('defers seek latency policy while seek work is pending', () => {
    const controller = createController();
    const effectiveTiming = controller.getEffectiveTiming({
      stressScore: 0,
      learningScale: 1,
    });

    expect(
      controller.withHold({
        reason: 'seek',
        holdMs: 2_000,
        nowMs: 1_000,
        effectiveTiming,
        hasPendingSeekWork: true,
      })
    ).toEqual({
      ensureLatencyReason: null,
      deferredLatencyReason: 'seek',
    });

    expect(
      controller.flushDeferredLatencyPolicy({
        trigger: 'settled',
        hasPendingSeekWork: true,
      })
    ).toBeNull();
    expect(
      controller.flushDeferredLatencyPolicy({
        trigger: 'settled',
        hasPendingSeekWork: false,
      })
    ).toBe('seek:settled');
  });

  it('keeps restore scheduling gated by hold and playback pressure', () => {
    const controller = createController();
    const effectiveTiming = controller.getEffectiveTiming({
      stressScore: 0,
      learningScale: 1,
    });
    controller.withHold({
      reason: 'underrun-spike',
      holdMs: 2_000,
      nowMs: 1_000,
      effectiveTiming,
      hasPendingSeekWork: false,
    });

    expect(
      controller.getRestoreReadiness({
        nowMs: 2_000,
        underrunRecoveryUntilMs: 0,
        protectionWindowActive: false,
        sharedStressWindowActive: false,
        playbackState: 'playing',
      })
    ).toEqual({ action: 'schedule' });

    expect(
      controller.getRestoreReadiness({
        nowMs: 4_000,
        underrunRecoveryUntilMs: 0,
        protectionWindowActive: false,
        sharedStressWindowActive: false,
        playbackState: 'loading',
      })
    ).toEqual({ action: 'schedule' });

    expect(
      controller.getRestoreReadiness({
        nowMs: 4_000,
        underrunRecoveryUntilMs: 0,
        protectionWindowActive: false,
        sharedStressWindowActive: false,
        playbackState: 'playing',
      })
    ).toEqual({ action: 'restore' });
  });

  it('preserves policy apply throttling and pending dedupe in the controller', () => {
    const controller = createController();

    const firstPlan = controller.planPolicyApply({
      currentPolicy: QUALITY_POLICY,
      targetPolicy: LATENCY_POLICY,
      nowMs: 1_000,
      minSwitchIntervalMs: 600,
      profile: 'latency',
    });
    expect(firstPlan).toEqual({ action: 'apply', nowMs: 1_000 });
    controller.beginPolicyApply(LATENCY_POLICY, 1_000);

    expect(
      controller.planPolicyApply({
        currentPolicy: QUALITY_POLICY,
        targetPolicy: LATENCY_POLICY,
        nowMs: 1_100,
        minSwitchIntervalMs: 600,
        profile: 'latency',
      })
    ).toEqual({ action: 'skip-pending' });

    controller.finishPolicyApply(LATENCY_POLICY);
    expect(
      controller.planPolicyApply({
        currentPolicy: QUALITY_POLICY,
        targetPolicy: LATENCY_POLICY,
        nowMs: 1_200,
        minSwitchIntervalMs: 600,
        profile: 'latency',
      })
    ).toEqual({ action: 'defer', delayMs: 400 });
  });

  it('returns auto degradation actions without applying native policy itself', () => {
    const controller = createController();

    expect(
      controller.evaluateAutoDegradation({
        nowMs: 1_000,
        triggerActions: true,
        stressScore: 4,
        lastUnderrunFrames: 0,
        metrics: createMetrics(),
      })
    ).toMatchObject({
      kind: 'ensure-latency',
      reason: 'auto-degradation:l1:stress-score-elevated',
    });

    expect(
      controller.evaluateAutoDegradation({
        nowMs: 2_000,
        triggerActions: true,
        lastUnderrunFrames: 2048,
        metrics: createMetrics({ outputRenderUnderrunEvents: 4 }),
        effectiveTiming: controller.getEffectiveTiming({
          stressScore: 9,
          learningScale: 1,
        }),
      })
    ).toMatchObject({
      kind: 'hold',
      reason: 'auto-degradation:l2:underrun-burst',
    });
  });
});
