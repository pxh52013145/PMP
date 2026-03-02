import type {
  AudioDynamicSrcDegradationLabel,
  AudioDynamicSrcDegradationLevel,
  PlaybackState,
} from './types';

export type DynamicSrcAutoDegradationState = {
  level: AudioDynamicSrcDegradationLevel;
  reason: string | null;
};

export type ResolveDynamicSrcAutoDegradationInput = {
  autoEnabled: boolean;
  manualLockActive: boolean;
  playbackState: PlaybackState;
  stressScore: number;
  nowMs: number;
  underrunRecoveryUntilMs: number;
  protectionWindowActive: boolean;
  sharedStressWindowActive: boolean;
  lastUnderrunFrames: number;
  severeUnderrunFramesThreshold: number;
  elevatedScoreThreshold: number;
  criticalScoreThreshold: number;
};

export function toDynamicSrcAutoDegradationLabel(
  level: AudioDynamicSrcDegradationLevel
): AudioDynamicSrcDegradationLabel {
  if (level === 2) return 'l2-protection';
  if (level === 1) return 'l1-balanced';
  return 'l0-fidelity';
}

function isPlaybackActive(playbackState: PlaybackState): boolean {
  return (
    playbackState === 'playing' ||
    playbackState === 'buffering' ||
    playbackState === 'loading'
  );
}

export function resolveDynamicSrcAutoDegradationState(
  input: ResolveDynamicSrcAutoDegradationInput
): DynamicSrcAutoDegradationState {
  if (!input.autoEnabled || input.manualLockActive) {
    return { level: 0, reason: null };
  }

  const playbackActive = isPlaybackActive(input.playbackState);
  const severeUnderrunBurst =
    input.lastUnderrunFrames >= input.severeUnderrunFramesThreshold;

  const shouldEnterL2 =
    input.protectionWindowActive ||
    input.sharedStressWindowActive ||
    severeUnderrunBurst ||
    input.stressScore >= input.criticalScoreThreshold;
  if (shouldEnterL2) {
    if (input.sharedStressWindowActive) {
      return { level: 2, reason: 'shared-stress-window' };
    }
    if (input.protectionWindowActive) {
      return { level: 2, reason: 'protection-window' };
    }
    if (severeUnderrunBurst) {
      return { level: 2, reason: 'underrun-burst' };
    }
    return { level: 2, reason: 'stress-score-critical' };
  }

  const recoveryActive = input.underrunRecoveryUntilMs > input.nowMs;
  const shouldEnterL1 =
    (playbackActive || recoveryActive) &&
    (recoveryActive ||
      input.playbackState === 'buffering' ||
      input.playbackState === 'loading' ||
      input.stressScore >= input.elevatedScoreThreshold);
  if (shouldEnterL1) {
    if (recoveryActive) {
      return { level: 1, reason: 'underrun-recovery' };
    }
    if (input.playbackState === 'buffering' || input.playbackState === 'loading') {
      return { level: 1, reason: 'playback-buffering' };
    }
    return { level: 1, reason: 'stress-score-elevated' };
  }

  return { level: 0, reason: null };
}
