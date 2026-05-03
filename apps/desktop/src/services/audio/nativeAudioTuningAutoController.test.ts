import { describe, expect, it, vi } from 'vitest';
import {
  NativeAudioTuningAutoController,
  resolveNativeAudioTuningAutoSettingsPatch,
} from './nativeAudioTuningAutoController';
import type { AudioRobustnessSnapshot, AudioTuningAutoSettings } from './types';

const DEFAULT_SETTINGS: AudioTuningAutoSettings = {
  enabled: true,
  tickIntervalMs: 1_500,
  stableWindowMs: 30_000,
  minSwitchIntervalMs: 10_000,
  postSwitchObserveWindowMs: 15_000,
  elevatedStressScore: 4,
  criticalStressScore: 8,
  criticalUnderrunEventsWindow: 2,
  criticalOverflowGrowthTicks: 2,
};

function createSnapshot(input: Partial<AudioRobustnessSnapshot> = {}): AudioRobustnessSnapshot {
  return {
    outputBackendId: 'wasapi',
    outputBackends: ['wasapi'],
    underrunEvents: 0,
    underrunFrames: 0,
    underrunEventsWindow: 0,
    underrunRecoveryActive: false,
    protectionWindowActive: false,
    protectionRefCount: 0,
    protectionReason: null,
    autoSwitchCount: 0,
    lastAutoSwitchAtMs: null,
    lastAutoSwitchReason: null,
    bufferedAheadSeconds: 4,
    decodeBufferedAheadSeconds: 4,
    outputBufferedAheadSeconds: 2,
    bufferedAheadMinSeconds: 2,
    bufferedAheadAvgSeconds: 3,
    rebufferCount: 0,
    schedulerProfile: 'normal',
    dynamicSrcStressScore: 0,
    outputWaitTimeoutCount: 0,
    outputRenderUnderrunEvents: 0,
    outputCallbackIntervalOverrunCount: 0,
    transferRenderLowHitCount: 0,
    transferDecodeLowHitCount: 0,
    sharedRenderLowHitCount: 0,
    controlQueueOverwriteEvents: 0,
    controlQueueDropNewestEvents: 0,
    controlQueueCoalescedOverflowEvents: 0,
    controlQueueCriticalOverflowEvents: 0,
    ...input,
  };
}

function createController(options?: {
  disposed?: boolean;
  onTick?: () => void;
  setIntervalFn?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void;
}) {
  return new NativeAudioTuningAutoController({
    initialSettings: DEFAULT_SETTINGS,
    isDisposed: () => options?.disposed ?? false,
    onTick: options?.onTick ?? vi.fn(),
    setIntervalFn: options?.setIntervalFn,
    clearIntervalFn: options?.clearIntervalFn,
  });
}

describe('NativeAudioTuningAutoController', () => {
  it('normalizes settings patches without allowing critical thresholds below elevated', () => {
    expect(
      resolveNativeAudioTuningAutoSettingsPatch({
        current: DEFAULT_SETTINGS,
        patch: {
          tickIntervalMs: 1,
          elevatedStressScore: 10,
          criticalStressScore: 3,
          criticalOverflowGrowthTicks: 99,
        },
      })
    ).toMatchObject({
      tickIntervalMs: 500,
      elevatedStressScore: 10,
      criticalStressScore: 10,
      criticalOverflowGrowthTicks: 8,
    });
  });

  it('owns transition state and blocks overlapping auto applies', () => {
    const controller = createController();
    const decision = controller.evaluateTick({
      nowMs: 10_000,
      snapshot: createSnapshot({ dynamicSrcStressScore: 9 }),
    });

    expect(decision).toMatchObject({
      changed: true,
      nextProfile: 'robust-shield',
      reason: 'critical-pressure',
    });
    expect(controller.beginApply()).toBe(true);
    expect(controller.beginApply()).toBe(false);
    expect(
      controller.evaluateTick({
        nowMs: 11_000,
        snapshot: createSnapshot({ dynamicSrcStressScore: 9 }),
      })
    ).toBeNull();

    controller.markAutoApplied('critical-pressure', 12_000);
    controller.finishApply();

    expect(controller.collectSnapshot()).toMatchObject({
      applyInFlight: false,
      lastReason: 'auto:critical-pressure',
      lastAppliedAtMs: 12_000,
      state: expect.objectContaining({
        activeProfile: 'robust-shield',
      }),
    });
  });

  it('restarts the timer only when enabled and not disposed', () => {
    const intervals: Array<{ handler: () => void; timeoutMs: number }> = [];
    const cleared: unknown[] = [];
    const onTick = vi.fn();
    const controller = createController({
      onTick,
      setIntervalFn: (handler, timeoutMs) => {
        intervals.push({ handler, timeoutMs });
        return { timer: intervals.length } as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalFn: (timer) => {
        cleared.push(timer);
      },
    });

    controller.applySettings({ ...DEFAULT_SETTINGS, tickIntervalMs: 2_000 });
    expect(intervals).toEqual([{ handler: expect.any(Function), timeoutMs: 2_000 }]);

    intervals[0]?.handler();
    expect(onTick).toHaveBeenCalledTimes(1);

    controller.applySettings({ ...DEFAULT_SETTINGS, enabled: false });
    expect(cleared).toHaveLength(1);
    expect(intervals).toHaveLength(1);
  });
});
