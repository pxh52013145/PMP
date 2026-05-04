import { describe, expect, it, vi } from 'vitest';
import { NativeAudioDynamicSrcLearningController } from './nativeAudioDynamicSrcLearningController';
import { NativeAudioDynamicSrcPolicyController } from './nativeAudioDynamicSrcPolicyController';
import {
  NativeAudioDynamicSrcRuntimeCoordinator,
  type NativeAudioDynamicSrcRuntimeState,
} from './nativeAudioDynamicSrcRuntimeCoordinator';
import type { AudioDynamicSrcAutoSettings } from './types';

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

type TimerEntry = {
  handler: () => void;
  timeoutMs: number;
};

function createRuntimeState(
  input: Partial<NativeAudioDynamicSrcRuntimeState> = {}
): NativeAudioDynamicSrcRuntimeState {
  return {
    playbackState: 'playing',
    underrunRecoveryUntilMs: 0,
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
    lastUnderrunFrames: 0,
    outputBackendId: 'wasapi',
    outputDeviceId: 'default-device',
    outputDeviceName: 'Speakers',
    ...input,
  };
}

function createPolicyController(options?: {
  timers?: TimerEntry[];
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
}): NativeAudioDynamicSrcPolicyController {
  return new NativeAudioDynamicSrcPolicyController({
    defaults: DEFAULT_SETTINGS,
    thresholds: {
      elevatedScoreThreshold: 4,
      criticalScoreThreshold: 8,
      severeUnderrunFramesThreshold: 1024,
      degradationL2HoldFloorMs: 4_000,
    },
    setTimeoutFn: options?.timers
      ? (handler, timeoutMs) => {
          const token = { timer: options.timers?.length ?? 0 } as unknown as ReturnType<
            typeof setTimeout
          >;
          options.timers?.push({ handler, timeoutMs });
          return token;
        }
      : undefined,
    clearTimeoutFn: options?.clearTimeoutFn,
  });
}

function createCoordinator(input?: {
  state?: Partial<NativeAudioDynamicSrcRuntimeState>;
  pendingSeek?: boolean;
  protectionActive?: boolean;
  sharedStressActive?: boolean;
}) {
  const timers: TimerEntry[] = [];
  let runtimeState = createRuntimeState(input?.state);
  let pendingSeek = input?.pendingSeek ?? false;
  let protectionActive = input?.protectionActive ?? false;
  let sharedStressActive = input?.sharedStressActive ?? false;
  const clearTimeoutFn = vi.fn();
  const persistProfile = vi.fn();
  const ensureLatencySrcPolicy = vi.fn();
  const restoreQualitySrcPolicy = vi.fn(async () => true);
  const policyController = createPolicyController({ timers, clearTimeoutFn });
  const learningController = new NativeAudioDynamicSrcLearningController({
    maxItems: 64,
    persistMinIntervalMs: 0,
    updateMinIntervalMs: 0,
    minDelta: 0.0005,
    persistProfile,
  });
  const coordinator = new NativeAudioDynamicSrcRuntimeCoordinator({
    policyController,
    learningController,
    host: {
      getRuntimeState: () => runtimeState,
      hasActiveProtectionWindow: () => protectionActive,
      hasActiveSharedStressWindow: () => sharedStressActive,
      hasPendingSeekWork: () => pendingSeek,
      ensureLatencySrcPolicy,
      restoreQualitySrcPolicy,
    },
  });

  return {
    clearTimeoutFn,
    coordinator,
    ensureLatencySrcPolicy,
    learningController,
    persistProfile,
    policyController,
    restoreQualitySrcPolicy,
    setPendingSeek: (next: boolean) => {
      pendingSeek = next;
    },
    setRuntimeState: (next: Partial<NativeAudioDynamicSrcRuntimeState>) => {
      runtimeState = createRuntimeState({ ...runtimeState, ...next });
    },
    setProtectionActive: (next: boolean) => {
      protectionActive = next;
    },
    setSharedStressActive: (next: boolean) => {
      sharedStressActive = next;
    },
    timers,
  };
}

describe('NativeAudioDynamicSrcRuntimeCoordinator', () => {
  it('updates learning from stress using the current output identity', () => {
    const context = createCoordinator({
      state: {
        outputBackendId: 'exclusive',
        outputDeviceId: 'device-a',
        outputDeviceName: 'Named Device',
      },
    });

    context.coordinator.updateDynamicSrcLearningFromStress(8, 2_000);

    expect(context.coordinator.buildDynamicSrcLearningDeviceKey()).toBe('exclusive::device-a');
    expect(context.learningController.getProfile()).toEqual({
      'exclusive::device-a': { stressIndex: 0.8, updatedAtMs: 2_000 },
    });
    expect(context.persistProfile).toHaveBeenCalledWith({
      'exclusive::device-a': { stressIndex: 0.8, updatedAtMs: 2_000 },
    });
  });

  it('applies latency on hold and restores quality after the scheduled stable window', async () => {
    let nowMs = 1_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    try {
      const context = createCoordinator();
      context.policyController.profile = 'latency';

      context.coordinator.withDynamicSrcHold('underrun-spike', 2_000);

      expect(context.ensureLatencySrcPolicy).toHaveBeenCalledWith('underrun-spike');
      expect(context.timers).toHaveLength(1);
      expect(context.timers[0]?.timeoutMs).toBe(4_000);

      nowMs = 6_000;
      context.timers[0]?.handler();
      await Promise.resolve();

      expect(context.restoreQualitySrcPolicy).toHaveBeenCalledWith('stable-window');
    } finally {
      dateNow.mockRestore();
    }
  });

  it('holds output-error recovery without seek deferral and schedules restore after the hold', () => {
    const nowMs = 1_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    try {
      const context = createCoordinator();
      const effectiveTiming = context.coordinator.getEffectiveDynamicSrcTiming(nowMs);

      context.coordinator.withDynamicSrcHold(
        'output-error:NATIVE_AUDIO_OUTPUT_ERROR',
        effectiveTiming.outputErrorHoldMs
      );

      expect(context.ensureLatencySrcPolicy).toHaveBeenCalledWith(
        'output-error:NATIVE_AUDIO_OUTPUT_ERROR'
      );
      expect(context.policyController.deferredLatency).toBeNull();
      expect(context.policyController.holdUntil).toBe(11_000);
      expect(context.timers).toHaveLength(1);
      expect(context.timers[0]?.timeoutMs).toBe(10_000);
    } finally {
      dateNow.mockRestore();
    }
  });

  it('flushes deferred seek latency only after pending seek work settles', () => {
    let nowMs = 1_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    try {
      const context = createCoordinator({ pendingSeek: true });

      context.coordinator.withDynamicSrcHold('seek', 2_000);
      expect(context.ensureLatencySrcPolicy).not.toHaveBeenCalled();

      context.coordinator.flushDeferredLatencySrcPolicy('seek-settled');
      expect(context.ensureLatencySrcPolicy).not.toHaveBeenCalled();

      nowMs = 1_500;
      context.setPendingSeek(false);
      context.coordinator.flushDeferredLatencySrcPolicy('seek-settled');

      expect(context.ensureLatencySrcPolicy).toHaveBeenCalledWith('seek:seek-settled');
    } finally {
      dateNow.mockRestore();
    }
  });

  it('reschedules restore while runtime pressure gates quality restoration', async () => {
    const scenarios = [
      { name: 'buffering', state: { playbackState: 'buffering' as const } },
      { name: 'loading', state: { playbackState: 'loading' as const } },
      { name: 'protection', protectionActive: true },
      { name: 'shared-stress', sharedStressActive: true },
    ];

    for (const scenario of scenarios) {
      const context = createCoordinator(scenario);
      context.policyController.profile = 'latency';

      await context.coordinator.maybeRestoreQualitySrc(scenario.name);

      expect(context.restoreQualitySrcPolicy).not.toHaveBeenCalled();
      expect(context.timers).toHaveLength(1);
    }

    const stableContext = createCoordinator();
    stableContext.policyController.profile = 'latency';

    await stableContext.coordinator.maybeRestoreQualitySrc('stable-window');

    expect(stableContext.restoreQualitySrcPolicy).toHaveBeenCalledWith('stable-window');
    expect(stableContext.timers).toHaveLength(0);
  });
});
