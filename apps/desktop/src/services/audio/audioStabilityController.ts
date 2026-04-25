import type { PlaybackState } from './types';
import {
  resolveDynamicSrcAutoDegradationState,
  type DynamicSrcAutoDegradationState,
} from './robustnessDegradation';

export type AudioStabilityScoreMetrics = {
  playbackState: PlaybackState;
  underrunRecoveryUntilMs: number;
  nowMs: number;
  protectionWindowActive: boolean;
  sharedStressWindowActive: boolean;
  outputCallbackMetricsValid: boolean;
  outputWaitTimeoutCount: number;
  outputRenderUnderrunEvents: number;
  outputCallbackIntervalOverrunCount: number;
  outputCallbackIntervalJitterP99Us: number;
  transferMetricsValid: boolean;
  transferRenderLowHitCount: number;
  transferDecodeLowHitCount: number;
  renderQueuePageLocked: boolean;
  sharedRenderAheadEnabled: boolean;
  sharedRenderUnderrunEvents: number;
  sharedRenderLowHitCount: number;
};

export type ResolveDynamicSrcDegradationTransitionInput = {
  previousState: DynamicSrcAutoDegradationState;
  autoEnabled: boolean;
  manualLockActive: boolean;
  stressScoreOverride?: number;
  lastUnderrunFrames: number;
  severeUnderrunFramesThreshold: number;
  elevatedScoreThreshold: number;
  criticalScoreThreshold: number;
  metrics: AudioStabilityScoreMetrics;
};

export type DynamicSrcDegradationTransitionAction =
  | 'none'
  | 'enter-l1'
  | 'enter-l2'
  | 'recover-l0';

export type DynamicSrcDegradationTransition = {
  stressScore: number;
  nextState: DynamicSrcAutoDegradationState;
  changed: boolean;
  action: DynamicSrcDegradationTransitionAction;
};

const clampCount = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export function computeDynamicSrcStressScore(input: AudioStabilityScoreMetrics): number {
  let score = 0;

  if (input.playbackState === 'buffering') {
    score += 3;
  } else if (input.playbackState === 'loading') {
    score += 2;
  }

  if (input.underrunRecoveryUntilMs > input.nowMs) {
    score += 4;
  }

  if (input.protectionWindowActive) {
    score += 3;
  }

  if (input.sharedStressWindowActive) {
    score += 4;
  }

  if (input.outputCallbackMetricsValid) {
    if (input.outputWaitTimeoutCount > 0) {
      score += Math.min(3, clampCount(input.outputWaitTimeoutCount));
    }
    if (input.outputRenderUnderrunEvents > 0) {
      score += Math.min(3, clampCount(input.outputRenderUnderrunEvents));
    }
    if (input.outputCallbackIntervalOverrunCount > 0) {
      score += Math.min(2, clampCount(input.outputCallbackIntervalOverrunCount));
    }
    if (input.outputCallbackIntervalJitterP99Us >= 2500) {
      score += 1;
    }
  }

  if (input.transferMetricsValid) {
    if (input.transferRenderLowHitCount > 0) {
      score += 1;
    }
    if (input.transferDecodeLowHitCount > 0) {
      score += 1;
    }
    if (!input.renderQueuePageLocked) {
      score += 1;
    }
  }

  if (input.sharedRenderAheadEnabled) {
    if (input.sharedRenderUnderrunEvents > 0) {
      score += Math.min(3, clampCount(input.sharedRenderUnderrunEvents));
    }
    if (input.sharedRenderLowHitCount > 0) {
      score += 1;
    }
  }

  return Math.max(0, Math.floor(score));
}

export function resolveDynamicSrcDegradationTransition(
  input: ResolveDynamicSrcDegradationTransitionInput
): DynamicSrcDegradationTransition {
  const stressScore =
    typeof input.stressScoreOverride === 'number' && Number.isFinite(input.stressScoreOverride)
      ? Math.max(0, Math.floor(input.stressScoreOverride))
      : computeDynamicSrcStressScore(input.metrics);
  const nextState = resolveDynamicSrcAutoDegradationState({
    autoEnabled: input.autoEnabled,
    manualLockActive: input.manualLockActive,
    playbackState: input.metrics.playbackState,
    stressScore,
    nowMs: input.metrics.nowMs,
    underrunRecoveryUntilMs: input.metrics.underrunRecoveryUntilMs,
    protectionWindowActive: input.metrics.protectionWindowActive,
    sharedStressWindowActive: input.metrics.sharedStressWindowActive,
    lastUnderrunFrames: input.lastUnderrunFrames,
    severeUnderrunFramesThreshold: input.severeUnderrunFramesThreshold,
    elevatedScoreThreshold: input.elevatedScoreThreshold,
    criticalScoreThreshold: input.criticalScoreThreshold,
  });

  const changed =
    input.previousState.level !== nextState.level || input.previousState.reason !== nextState.reason;

  let action: DynamicSrcDegradationTransitionAction = 'none';
  if (nextState.level === 2 && input.previousState.level < 2) {
    action = 'enter-l2';
  } else if (nextState.level === 1 && input.previousState.level < 1) {
    action = 'enter-l1';
  } else if (nextState.level === 0 && input.previousState.level > 0) {
    action = 'recover-l0';
  }

  return {
    stressScore,
    nextState,
    changed,
    action,
  };
}
