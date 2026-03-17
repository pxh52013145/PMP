import type { DynamicSrcEffectiveTiming } from './dynamicSrcAdaptiveTiming';
import type {
  NativeAudioRobustnessSnapshotSource,
} from './nativeAudioRobustnessSnapshot';
import type { AudioState } from './types';

type DynamicSrcAutoDegradationOptions = {
  nowMs: number;
  stressScore: number;
  triggerActions: boolean;
};

export type NativeAudioRobustnessSnapshotAdapterInput = {
  record: Record<string, unknown>;
  state: AudioState;
  estimatedAudioBufferBytes: number;
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
};

export function createNativeAudioRobustnessSnapshotSource(
  input: NativeAudioRobustnessSnapshotAdapterInput,
): NativeAudioRobustnessSnapshotSource & Record<string, unknown> {
  const source = Object.create(input.record) as NativeAudioRobustnessSnapshotSource &
    Record<string, unknown>;

  source.state = input.state;
  source.estimatedAudioBufferBytes = input.estimatedAudioBufferBytes;
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

  return source;
}
