import type { DynamicSrcEffectiveTiming } from './dynamicSrcAdaptiveTiming';
import {
  buildNativeAudioRobustnessSnapshot,
  type NativeAudioRobustnessSnapshotSource,
} from './nativeAudioRobustnessSnapshot';
import type { AudioRobustnessSnapshot, AudioState } from './types';
import type { ProcessWorkingSetTrimEvent } from '../../utils/processWorkingSetTrim';

type DynamicSrcAutoDegradationOptions = {
  nowMs: number;
  stressScore: number;
  triggerActions: boolean;
};

export type NativeAudioRobustnessSnapshotAdapterInput = {
  record: Record<string, unknown>;
  state: AudioState;
  stabilityActionProfile?: AudioRobustnessSnapshot['stabilityActionProfile'];
  sourcePrepareProfile?: AudioRobustnessSnapshot['sourcePrepareProfile'];
  stabilityPrimaryReason?: AudioRobustnessSnapshot['stabilityPrimaryReason'];
  stabilityReasonCodes?: AudioRobustnessSnapshot['stabilityReasonCodes'];
  stabilityHintProfile?: AudioRobustnessSnapshot['stabilityHintProfile'];
  stabilityHintPrimaryReason?: AudioRobustnessSnapshot['stabilityHintPrimaryReason'];
  stabilityHintReasonCodes?: AudioRobustnessSnapshot['stabilityHintReasonCodes'];
  estimatedAudioBufferBytes: number;
  renderQueuePageLockFailureCount: number;
  renderQueuePageLockAttemptedBytes: number;
  renderQueuePageLockSucceededBytes: number;
  renderQueuePageLockFailedBytes: number;
  memoryPoolF32GrowthEvents: number;
  memoryPoolF32GrowthBytes: number;
  memoryPoolF32PrewarmHits: number;
  realtimeMemoryLockAttemptedBytes: number;
  realtimeMemoryLockSucceededBytes: number;
  realtimeMemoryLockFailedBytes: number;
  realtimeMemoryLockSkippedBytes: number;
  realtimeMemoryLockFailureCount: number;
  realtimeMemoryLockSkippedCount: number;
  realtimeMemoryLockedRoleMask: number;
  realtimeMemoryFailedRoleMask: number;
  realtimeMemorySkippedRoleMask: number;
  realtimeMemoryPressureEvents: number;
  bufferedAheadRollingWindow: number[];
  bufferedAheadRollingSum: number;
  underrunRecoveryUntilMs: number;
  dynamicSrcAdaptiveProfile: DynamicSrcEffectiveTiming['profile'];
  dynamicSrcLearningProfile: Record<string, { stressIndex: number } | undefined>;
  pruneUnderrunSpikeWindow(nowMs: number): void;
  getEffectiveDynamicSrcTiming(nowMs: number): DynamicSrcEffectiveTiming;
  evaluateDynamicSrcAutoDegradation(options: DynamicSrcAutoDegradationOptions): void;
  buildDynamicSrcLearningDeviceKey(): string;
  getDynamicSrcLearningScale(): number;
  hasActiveProtectionWindow(nowMs: number): boolean;
  hasActiveSharedStressWindow(nowMs: number): boolean;
  lastWorkingSetTrimEvent: ProcessWorkingSetTrimEvent | null;
};

export function createNativeAudioRobustnessSnapshotSource(
  input: NativeAudioRobustnessSnapshotAdapterInput,
): NativeAudioRobustnessSnapshotSource & Record<string, unknown> {
  const source = Object.create(input.record) as NativeAudioRobustnessSnapshotSource &
    Record<string, unknown>;

  const overlay: Record<string, unknown> = {
    state: input.state,
    stabilityActionProfile: input.stabilityActionProfile,
    sourcePrepareProfile: input.sourcePrepareProfile,
    stabilityPrimaryReason: input.stabilityPrimaryReason,
    stabilityReasonCodes: input.stabilityReasonCodes,
    stabilityHintProfile: input.stabilityHintProfile,
    stabilityHintPrimaryReason: input.stabilityHintPrimaryReason,
    stabilityHintReasonCodes: input.stabilityHintReasonCodes,
    estimatedAudioBufferBytes: input.estimatedAudioBufferBytes,
    renderQueuePageLockFailureCount: input.renderQueuePageLockFailureCount,
    renderQueuePageLockAttemptedBytes: input.renderQueuePageLockAttemptedBytes,
    renderQueuePageLockSucceededBytes: input.renderQueuePageLockSucceededBytes,
    renderQueuePageLockFailedBytes: input.renderQueuePageLockFailedBytes,
    memoryPoolF32GrowthEvents: input.memoryPoolF32GrowthEvents,
    memoryPoolF32GrowthBytes: input.memoryPoolF32GrowthBytes,
    memoryPoolF32PrewarmHits: input.memoryPoolF32PrewarmHits,
    realtimeMemoryLockAttemptedBytes: input.realtimeMemoryLockAttemptedBytes,
    realtimeMemoryLockSucceededBytes: input.realtimeMemoryLockSucceededBytes,
    realtimeMemoryLockFailedBytes: input.realtimeMemoryLockFailedBytes,
    realtimeMemoryLockSkippedBytes: input.realtimeMemoryLockSkippedBytes,
    realtimeMemoryLockFailureCount: input.realtimeMemoryLockFailureCount,
    realtimeMemoryLockSkippedCount: input.realtimeMemoryLockSkippedCount,
    realtimeMemoryLockedRoleMask: input.realtimeMemoryLockedRoleMask,
    realtimeMemoryFailedRoleMask: input.realtimeMemoryFailedRoleMask,
    realtimeMemorySkippedRoleMask: input.realtimeMemorySkippedRoleMask,
    realtimeMemoryPressureEvents: input.realtimeMemoryPressureEvents,
    bufferedAheadRollingWindow: input.bufferedAheadRollingWindow,
    bufferedAheadRollingSum: input.bufferedAheadRollingSum,
    underrunRecoveryUntilMs: input.underrunRecoveryUntilMs,
    dynamicSrcAdaptiveProfile: input.dynamicSrcAdaptiveProfile,
    dynamicSrcLearningProfile: input.dynamicSrcLearningProfile,
    pruneUnderrunSpikeWindow: input.pruneUnderrunSpikeWindow,
    getEffectiveDynamicSrcTiming: input.getEffectiveDynamicSrcTiming,
    evaluateDynamicSrcAutoDegradation: input.evaluateDynamicSrcAutoDegradation,
    buildDynamicSrcLearningDeviceKey: input.buildDynamicSrcLearningDeviceKey,
    getDynamicSrcLearningScale: input.getDynamicSrcLearningScale,
    hasActiveProtectionWindow: input.hasActiveProtectionWindow,
    hasActiveSharedStressWindow: input.hasActiveSharedStressWindow,
    lastWorkingSetTrimEvent: input.lastWorkingSetTrimEvent,
  };

  for (const [key, value] of Object.entries(overlay)) {
    Object.defineProperty(source, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return source;
}

export function buildNativeAudioRobustnessSnapshotFromAdapterInput(
  input: NativeAudioRobustnessSnapshotAdapterInput,
  nowMs: number
): AudioRobustnessSnapshot {
  return buildNativeAudioRobustnessSnapshot(
    createNativeAudioRobustnessSnapshotSource(input),
    nowMs
  );
}
