import type {
  AudioSourcePrepareProfile,
  AudioStabilityActionProfile,
  AudioStabilityProfile,
} from './types';
import type { NativeAudioStatePayload } from './nativeAudioServiceTypes';

export type NativeAudioEngineState = {
  lastSchedulerProfile?: 'normal' | 'guarded' | 'critical';
  stabilityActionProfile?: AudioStabilityActionProfile;
  stabilityProfile?: AudioStabilityProfile;
  sourcePrepareProfile?: AudioSourcePrepareProfile;
  stabilityPrimaryReason?: string | null;
  stabilityReasonCodes?: string[];
  stabilityHintProfile?: AudioStabilityActionProfile;
  stabilityHintPrimaryReason?: string | null;
  stabilityHintReasonCodes?: string[];
  transportMode?: 'robust' | 'transport-exact';
  hqSrcPhaseMode?: 'linear' | 'minimum' | 'intermediate';
  srcMode?: 'source-native' | 'match-output' | 'target-rate';
  srcBackend?: 'rubato' | 'linear-simd';
  srcTargetSampleRate: number | null;
  outputQuantizationMode?: 'round' | 'tpdf';
  hqSrcStopbandDb: number;
  hqSrcActive: boolean;
  hqSrcRatio: number;
  transportExactInt32Container: boolean;
};

function isSchedulerProfile(value: unknown): value is NativeAudioEngineState['lastSchedulerProfile'] {
  return value === 'normal' || value === 'guarded' || value === 'critical';
}

function isStabilityActionProfile(value: unknown): value is AudioStabilityActionProfile {
  return value === 'normal' || value === 'guarded' || value === 'critical';
}

function isStabilityProfile(value: unknown): value is AudioStabilityProfile {
  return (
    value === 'low-latency' ||
    value === 'balanced' ||
    value === 'stable' ||
    value === 'game-safe' ||
    value === 'safe-mode'
  );
}

function isSourcePrepareProfile(value: unknown): value is AudioSourcePrepareProfile {
  return (
    value === 'baseline' ||
    value === 'steady' ||
    value === 'aggressive' ||
    value === 'failsafe'
  );
}

function normalizeReasonCodes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((reason): reason is string => typeof reason === 'string' && reason.length > 0);
}

export function applyNativeAudioEngineStatePayload(
  state: NativeAudioEngineState,
  payload: NativeAudioStatePayload
): void {
  if (isSchedulerProfile(payload.schedulerProfile)) {
    state.lastSchedulerProfile = payload.schedulerProfile;
  }

  if (isStabilityActionProfile(payload.stabilityActionProfile)) {
    state.stabilityActionProfile = payload.stabilityActionProfile;
  }

  if (isStabilityProfile(payload.stabilityProfile)) {
    state.stabilityProfile = payload.stabilityProfile;
  }

  if (isSourcePrepareProfile(payload.sourcePrepareProfile)) {
    state.sourcePrepareProfile = payload.sourcePrepareProfile;
  }

  if (typeof payload.stabilityPrimaryReason === 'string') {
    state.stabilityPrimaryReason = payload.stabilityPrimaryReason;
  } else if (payload.stabilityPrimaryReason === null) {
    state.stabilityPrimaryReason = null;
  }

  const stabilityReasonCodes = normalizeReasonCodes(payload.stabilityReasonCodes);
  if (stabilityReasonCodes) {
    state.stabilityReasonCodes = stabilityReasonCodes;
  }

  if (isStabilityActionProfile(payload.stabilityHintProfile)) {
    state.stabilityHintProfile = payload.stabilityHintProfile;
  } else if (payload.stabilityHintProfile === null) {
    state.stabilityHintProfile = undefined;
  }

  if (typeof payload.stabilityHintPrimaryReason === 'string') {
    state.stabilityHintPrimaryReason = payload.stabilityHintPrimaryReason;
  } else if (payload.stabilityHintPrimaryReason === null) {
    state.stabilityHintPrimaryReason = null;
  }

  const stabilityHintReasonCodes = normalizeReasonCodes(payload.stabilityHintReasonCodes);
  if (stabilityHintReasonCodes) {
    state.stabilityHintReasonCodes = stabilityHintReasonCodes;
  } else if (payload.stabilityHintReasonCodes === null) {
    state.stabilityHintReasonCodes = [];
  }

  if (payload.transportMode === 'robust' || payload.transportMode === 'transport-exact') {
    state.transportMode = payload.transportMode;
  }

  if (
    payload.hqSrcPhaseMode === 'linear' ||
    payload.hqSrcPhaseMode === 'minimum' ||
    payload.hqSrcPhaseMode === 'intermediate'
  ) {
    state.hqSrcPhaseMode = payload.hqSrcPhaseMode;
  }

  if (
    payload.srcMode === 'source-native' ||
    payload.srcMode === 'match-output' ||
    payload.srcMode === 'target-rate'
  ) {
    state.srcMode = payload.srcMode;
  }

  if (payload.srcBackend === 'rubato' || payload.srcBackend === 'linear-simd') {
    state.srcBackend = payload.srcBackend;
  }

  if (
    typeof payload.srcTargetSampleRate === 'number' &&
    Number.isFinite(payload.srcTargetSampleRate) &&
    payload.srcTargetSampleRate > 0
  ) {
    state.srcTargetSampleRate = Math.max(
      8000,
      Math.min(768000, Math.floor(payload.srcTargetSampleRate))
    );
  } else if (payload.srcTargetSampleRate == null) {
    state.srcTargetSampleRate = null;
  }

  if (payload.outputQuantizationMode === 'round' || payload.outputQuantizationMode === 'tpdf') {
    state.outputQuantizationMode = payload.outputQuantizationMode;
  }

  if (typeof payload.hqSrcStopbandDb === 'number' && Number.isFinite(payload.hqSrcStopbandDb)) {
    state.hqSrcStopbandDb = Math.max(0, Math.min(200, Math.floor(payload.hqSrcStopbandDb)));
  }

  if (typeof payload.hqSrcActive === 'boolean') {
    state.hqSrcActive = payload.hqSrcActive;
  }

  if (typeof payload.hqSrcRatio === 'number' && Number.isFinite(payload.hqSrcRatio)) {
    state.hqSrcRatio = payload.hqSrcRatio;
  }

  if (typeof payload.transportExactInt32Container === 'boolean') {
    state.transportExactInt32Container = payload.transportExactInt32Container;
  }
}
