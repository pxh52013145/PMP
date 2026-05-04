import { describe, expect, it } from 'vitest';
import {
  applyNativeAudioRuntimeMetricsPayload,
  type NativeAudioRuntimeMetricsState,
} from './nativeAudioRuntimeMetricsAdapter';
import type { NativeAudioStatePayload } from './nativeAudioServiceTypes';

function createState(): NativeAudioRuntimeMetricsState {
  return {
    outputSampleRate: 0,
    sourceSampleRate: 0,
    outputCallbackMetricsValid: false,
    outputCallbackP99Us: 11,
    outputWaitTimeoutCount: 22,
    outputRenderUnderrunEvents: 33,
    outputRenderUnderrunFrames: 44,
    outputCallbackIntervalJitterP99Us: 55,
    outputCallbackIntervalOverrunCount: 66,
    outputCallbackExpectedIntervalUs: 77,
    transferLowWatermarkSamples: 0,
    transferRenderLowHitCount: 88,
    transferDecodeLowHitCount: 99,
    transferAdaptationLevel: 111,
    transferOscillationStreak: 222,
    renderQueuePageLocked: true,
    renderQueuePageLockFailureCount: 333,
    renderQueuePageLockAttemptedBytes: 444,
    renderQueuePageLockSucceededBytes: 555,
    renderQueuePageLockFailedBytes: 666,
    transferMetricsValid: true,
    sharedRenderAheadEnabled: true,
    sharedRenderUnderrunEvents: 777,
    sharedRenderUnderrunFrames: 888,
    sharedRenderLowHitCount: 999,
    sharedRenderLowWatermarkSamples: 1010,
    controlQueueLockFree: false,
    controlQueueMode: 'unknown',
    controlQueueCapacity: 0,
    controlQueueOverwriteEvents: 0,
    controlQueueDropNewestEvents: 0,
    controlQueueCoalescedOverflowEvents: 0,
    controlQueueCriticalOverflowEvents: 0,
    estimatedAudioBufferBytes: 0,
    memoryPoolF32GrowthEvents: 0,
    memoryPoolF32GrowthBytes: 0,
    memoryPoolF32PrewarmHits: 0,
    realtimeMemoryLockAttemptedBytes: 0,
    realtimeMemoryLockSucceededBytes: 0,
    realtimeMemoryLockFailedBytes: 0,
    realtimeMemoryLockSkippedBytes: 0,
    realtimeMemoryLockFailureCount: 0,
    realtimeMemoryLockSkippedCount: 0,
    realtimeMemoryLockedRoleMask: 0,
    realtimeMemoryFailedRoleMask: 0,
    realtimeMemorySkippedRoleMask: 0,
    realtimeMemoryPressureEvents: 0,
    diagnosticTimelineDroppedEvents: 0,
  };
}

describe('nativeAudioRuntimeMetricsAdapter', () => {
  it('normalizes numeric runtime metrics and reports render queue lock status', () => {
    const state = createState();
    const payload: NativeAudioStatePayload = {
      sampleRate: 48_000.9,
      sourceSampleRate: 44_100.4,
      outputCallbackMetricsValid: true,
      outputCallbackP99Us: 101.9,
      outputWaitTimeoutCount: 5.2,
      outputRenderUnderrunEvents: 6.8,
      outputRenderUnderrunFrames: 7.1,
      outputCallbackIntervalJitterP99Us: 8.4,
      outputCallbackIntervalOverrunCount: 9.6,
      outputCallbackExpectedIntervalUs: 10.1,
      transferLowWatermarkSamples: 11.9,
      transferRenderLowHitCount: 12.2,
      transferDecodeLowHitCount: 13.3,
      transferAdaptationLevel: 14.4,
      transferOscillationStreak: 15.5,
      renderQueuePageLocked: true,
      renderQueuePageLockFailureCount: 16.6,
      renderQueuePageLockAttemptedBytes: 17.7,
      renderQueuePageLockSucceededBytes: 18.8,
      renderQueuePageLockFailedBytes: 19.9,
      sharedRenderAheadEnabled: true,
      sharedRenderUnderrunEvents: 20.1,
      sharedRenderUnderrunFrames: 21.2,
      sharedRenderLowHitCount: 22.3,
      sharedRenderLowWatermarkSamples: 23.4,
      controlQueueLockFree: true,
      controlQueueMode: '  coalesced  ',
      controlQueueCapacity: 24.8,
      controlQueueOverwriteEvents: 25.9,
      controlQueueDropNewestEvents: 26.1,
      controlQueueCoalescedOverflowEvents: 27.2,
      controlQueueCriticalOverflowEvents: 28.3,
      estimatedAudioBufferBytes: 29.4,
      memoryPoolF32GrowthEvents: 30.5,
      memoryPoolF32GrowthBytes: 31.6,
      memoryPoolF32PrewarmHits: 32.7,
      realtimeMemoryLockAttemptedBytes: 33.8,
      realtimeMemoryLockSucceededBytes: 34.9,
      realtimeMemoryLockFailedBytes: 35.1,
      realtimeMemoryLockSkippedBytes: 36.2,
      realtimeMemoryLockFailureCount: 37.3,
      realtimeMemoryLockSkippedCount: 38.4,
      realtimeMemoryLockedRoleMask: 39.5,
      realtimeMemoryFailedRoleMask: 40.6,
      realtimeMemorySkippedRoleMask: 41.7,
      realtimeMemoryPressureEvents: 42.8,
      diagnosticTimelineDroppedEvents: 43.9,
    };

    const result = applyNativeAudioRuntimeMetricsPayload(state, payload);

    expect(state.outputSampleRate).toBe(48000);
    expect(state.sourceSampleRate).toBe(44100);
    expect(state.outputCallbackMetricsValid).toBe(true);
    expect(state.outputCallbackP99Us).toBe(101);
    expect(state.outputWaitTimeoutCount).toBe(5);
    expect(state.outputRenderUnderrunEvents).toBe(6);
    expect(state.outputRenderUnderrunFrames).toBe(7);
    expect(state.outputCallbackIntervalJitterP99Us).toBe(8);
    expect(state.outputCallbackIntervalOverrunCount).toBe(9);
    expect(state.outputCallbackExpectedIntervalUs).toBe(10);
    expect(state.transferMetricsValid).toBe(true);
    expect(state.transferLowWatermarkSamples).toBe(11);
    expect(state.transferRenderLowHitCount).toBe(12);
    expect(state.transferDecodeLowHitCount).toBe(13);
    expect(state.transferAdaptationLevel).toBe(14);
    expect(state.transferOscillationStreak).toBe(15);
    expect(state.renderQueuePageLocked).toBe(true);
    expect(result.renderQueuePageLockStatus).toEqual({
      locked: true,
      playbackState: undefined,
    });
    expect(state.renderQueuePageLockFailureCount).toBe(16);
    expect(state.renderQueuePageLockAttemptedBytes).toBe(17);
    expect(state.renderQueuePageLockSucceededBytes).toBe(18);
    expect(state.renderQueuePageLockFailedBytes).toBe(19);
    expect(state.sharedRenderAheadEnabled).toBe(true);
    expect(state.sharedRenderUnderrunEvents).toBe(20);
    expect(state.sharedRenderUnderrunFrames).toBe(21);
    expect(state.sharedRenderLowHitCount).toBe(22);
    expect(state.sharedRenderLowWatermarkSamples).toBe(23);
    expect(state.controlQueueLockFree).toBe(true);
    expect(state.controlQueueMode).toBe('coalesced');
    expect(state.controlQueueCapacity).toBe(24);
    expect(state.controlQueueOverwriteEvents).toBe(25);
    expect(state.controlQueueDropNewestEvents).toBe(26);
    expect(state.controlQueueCoalescedOverflowEvents).toBe(27);
    expect(state.controlQueueCriticalOverflowEvents).toBe(28);
    expect(state.estimatedAudioBufferBytes).toBe(29);
    expect(state.memoryPoolF32GrowthEvents).toBe(30);
    expect(state.memoryPoolF32GrowthBytes).toBe(31);
    expect(state.memoryPoolF32PrewarmHits).toBe(32);
    expect(state.realtimeMemoryLockAttemptedBytes).toBe(33);
    expect(state.realtimeMemoryLockSucceededBytes).toBe(34);
    expect(state.realtimeMemoryLockFailedBytes).toBe(35);
    expect(state.realtimeMemoryLockSkippedBytes).toBe(36);
    expect(state.realtimeMemoryLockFailureCount).toBe(37);
    expect(state.realtimeMemoryLockSkippedCount).toBe(38);
    expect(state.realtimeMemoryLockedRoleMask).toBe(39);
    expect(state.realtimeMemoryFailedRoleMask).toBe(40);
    expect(state.realtimeMemorySkippedRoleMask).toBe(41);
    expect(state.realtimeMemoryPressureEvents).toBe(42);
    expect(state.diagnosticTimelineDroppedEvents).toBe(43);
  });

  it('resets output and transfer metrics when their validity gates drop out', () => {
    const state = createState();

    applyNativeAudioRuntimeMetricsPayload(state, {
      outputCallbackMetricsValid: false,
      transferLowWatermarkSamples: undefined,
      sharedRenderAheadEnabled: false,
    });

    expect(state.outputCallbackMetricsValid).toBe(false);
    expect(state.outputCallbackP99Us).toBe(0);
    expect(state.outputWaitTimeoutCount).toBe(0);
    expect(state.outputRenderUnderrunEvents).toBe(0);
    expect(state.outputRenderUnderrunFrames).toBe(0);
    expect(state.outputCallbackIntervalJitterP99Us).toBe(0);
    expect(state.outputCallbackIntervalOverrunCount).toBe(0);
    expect(state.outputCallbackExpectedIntervalUs).toBe(0);
    expect(state.transferMetricsValid).toBe(false);
    expect(state.transferLowWatermarkSamples).toBe(0);
    expect(state.transferRenderLowHitCount).toBe(0);
    expect(state.transferDecodeLowHitCount).toBe(0);
    expect(state.transferAdaptationLevel).toBe(0);
    expect(state.transferOscillationStreak).toBe(0);
    expect(state.renderQueuePageLocked).toBe(false);
    expect(state.renderQueuePageLockFailureCount).toBe(0);
    expect(state.renderQueuePageLockAttemptedBytes).toBe(0);
    expect(state.renderQueuePageLockSucceededBytes).toBe(0);
    expect(state.renderQueuePageLockFailedBytes).toBe(0);
    expect(state.sharedRenderAheadEnabled).toBe(false);
    expect(state.sharedRenderUnderrunEvents).toBe(0);
    expect(state.sharedRenderUnderrunFrames).toBe(0);
    expect(state.sharedRenderLowHitCount).toBe(0);
    expect(state.sharedRenderLowWatermarkSamples).toBe(0);
  });
});
