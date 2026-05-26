import type { MemoryGovernanceRequest } from '../../contracts/memoryGovernance';
import type { PlaybackState } from './types';

export const TRACK_SWITCH_MEMORY_GOVERNANCE_MIN_BUFFERED_AHEAD_SECONDS = 3;
export const TRACK_SWITCH_MEMORY_GOVERNANCE_MIN_OUTPUT_BUFFERED_AHEAD_SECONDS = 1;
export const TRACK_SWITCH_MEMORY_GOVERNANCE_RETRY_MS = 2_500;
export const TRACK_SWITCH_MEMORY_GOVERNANCE_MAX_DEFER_MS = 45_000;
export const TRACK_SWITCH_MEMORY_GOVERNANCE_REQUEST_DELAYS_MS = [8_000, 30_000] as const;
export const TRACK_SWITCH_MEMORY_GOVERNANCE_MIN_INTERVAL_MS = 10_000;

export type TrackSwitchMemoryGovernanceDecision =
  | {
      kind: 'defer';
      retryMs: number;
      playbackState: PlaybackState;
      bufferedAhead: number;
      outputBufferedAhead: number;
    }
  | {
      kind: 'timeout';
      playbackState: PlaybackState;
      bufferedAhead: number;
      outputBufferedAhead: number;
    }
  | {
      kind: 'request';
      request: Pick<MemoryGovernanceRequest, 'reason'> & {
        delaysMs: readonly number[];
        minIntervalMs: number;
      };
      playbackState: PlaybackState;
      bufferedAhead: number;
      outputBufferedAhead: number;
    };

export function normalizeAudioBufferAhead(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function decideTrackSwitchMemoryGovernance(input: {
  playbackState: PlaybackState;
  bufferedAhead: unknown;
  outputBufferedAhead: unknown;
  elapsedMs: number;
}): TrackSwitchMemoryGovernanceDecision {
  const bufferedAhead = normalizeAudioBufferAhead(input.bufferedAhead);
  const outputBufferedAhead = normalizeAudioBufferAhead(input.outputBufferedAhead);
  const playbackState = input.playbackState;
  const fragilePlaybackWindow =
    playbackState === 'loading' ||
    playbackState === 'buffering' ||
    (playbackState === 'playing' &&
      (bufferedAhead < TRACK_SWITCH_MEMORY_GOVERNANCE_MIN_BUFFERED_AHEAD_SECONDS ||
        outputBufferedAhead < TRACK_SWITCH_MEMORY_GOVERNANCE_MIN_OUTPUT_BUFFERED_AHEAD_SECONDS));

  if (fragilePlaybackWindow) {
    const elapsedMs = Number.isFinite(input.elapsedMs) ? Math.max(0, input.elapsedMs) : 0;
    if (elapsedMs >= TRACK_SWITCH_MEMORY_GOVERNANCE_MAX_DEFER_MS) {
      return {
        kind: 'timeout',
        playbackState,
        bufferedAhead,
        outputBufferedAhead,
      };
    }

    return {
      kind: 'defer',
      retryMs: TRACK_SWITCH_MEMORY_GOVERNANCE_RETRY_MS,
      playbackState,
      bufferedAhead,
      outputBufferedAhead,
    };
  }

  return {
    kind: 'request',
    request: {
      reason: 'playback-active',
      delaysMs: TRACK_SWITCH_MEMORY_GOVERNANCE_REQUEST_DELAYS_MS,
      minIntervalMs: TRACK_SWITCH_MEMORY_GOVERNANCE_MIN_INTERVAL_MS,
    },
    playbackState,
    bufferedAhead,
    outputBufferedAhead,
  };
}
