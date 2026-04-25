import type { DynamicSrcEffectiveTiming } from './dynamicSrcAdaptiveTiming';
import type {
  NativeAudioRobustnessSnapshotSource,
} from './nativeAudioRobustnessSnapshot';
import type { AudioState } from './types';
import type { ProcessWorkingSetTrimEvent } from '../../utils/processWorkingSetTrim';

type DynamicSrcAutoDegradationOptions = {
  nowMs: number;
  stressScore: number;
  triggerActions: boolean;
};

export type NativeAudioRobustnessSnapshotAdapterInput = {
  record: Record<string, unknown>;
  state: AudioState;
  estimatedAudioBufferBytes: number;
  renderQueuePageLockFailureCount: number;
  renderQueuePageLockAttemptedBytes: number;
  renderQueuePageLockSucceededBytes: number;
  renderQueuePageLockFailedBytes: number;
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

  source.state = input.state;
  source.estimatedAudioBufferBytes = input.estimatedAudioBufferBytes;
  source.renderQueuePageLockFailureCount = input.renderQueuePageLockFailureCount;
  source.renderQueuePageLockAttemptedBytes = input.renderQueuePageLockAttemptedBytes;
  source.renderQueuePageLockSucceededBytes = input.renderQueuePageLockSucceededBytes;
  source.renderQueuePageLockFailedBytes = input.renderQueuePageLockFailedBytes;
  source.bufferedAheadRollingWindow = input.bufferedAheadRollingWindow;
  source.bufferedAheadRollingSum = input.bufferedAheadRollingSum;
  source.underrunRecoveryUntilMs = input.underrunRecoveryUntilMs;
  source.dynamicSrcAdaptiveProfile = input.dynamicSrcAdaptiveProfile;
  source.dynamicSrcLearningProfile = input.dynamicSrcLearningProfile;
  source.pruneUnderrunSpikeWindow = input.pruneUnderrunSpikeWindow;
  source.getEffectiveDynamicSrcTiming = input.getEffectiveDynamicSrcTiming;
  source.evaluateDynamicSrcAutoDegradation = input.evaluateDynamicSrcAutoDegradation;
  source.buildDynamicSrcLearningDeviceKey = input.buildDynamicSrcLearningDeviceKey;
  source.getDynamicSrcLearningScale = input.getDynamicSrcLearningScale;
  source.hasActiveProtectionWindow = input.hasActiveProtectionWindow;
  source.hasActiveSharedStressWindow = input.hasActiveSharedStressWindow;
  source.lastWorkingSetTrimEvent = input.lastWorkingSetTrimEvent;

  return source;
}
