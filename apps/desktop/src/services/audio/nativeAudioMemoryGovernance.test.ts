import { describe, expect, it } from 'vitest';
import {
  TRACK_SWITCH_MEMORY_GOVERNANCE_MAX_DEFER_MS,
  TRACK_SWITCH_MEMORY_GOVERNANCE_MIN_INTERVAL_MS,
  TRACK_SWITCH_MEMORY_GOVERNANCE_REQUEST_DELAYS_MS,
  TRACK_SWITCH_MEMORY_GOVERNANCE_RETRY_MS,
  decideTrackSwitchMemoryGovernance,
} from './nativeAudioMemoryGovernance';

describe('decideTrackSwitchMemoryGovernance', () => {
  it('defers while playback is still loading', () => {
    const decision = decideTrackSwitchMemoryGovernance({
      playbackState: 'loading',
      bufferedAhead: 10,
      outputBufferedAhead: 10,
      elapsedMs: 1_000,
    });

    expect(decision).toMatchObject({
      kind: 'defer',
      retryMs: TRACK_SWITCH_MEMORY_GOVERNANCE_RETRY_MS,
    });
  });

  it('defers playing tracks until both decode and output buffers are stable', () => {
    const decision = decideTrackSwitchMemoryGovernance({
      playbackState: 'playing',
      bufferedAhead: 2.5,
      outputBufferedAhead: 2,
      elapsedMs: 1_000,
    });

    expect(decision.kind).toBe('defer');
  });

  it('times out instead of fighting fragile playback forever', () => {
    const decision = decideTrackSwitchMemoryGovernance({
      playbackState: 'buffering',
      bufferedAhead: 0,
      outputBufferedAhead: 0,
      elapsedMs: TRACK_SWITCH_MEMORY_GOVERNANCE_MAX_DEFER_MS,
    });

    expect(decision.kind).toBe('timeout');
  });

  it('requests delayed playback governance once playback is settled', () => {
    const decision = decideTrackSwitchMemoryGovernance({
      playbackState: 'playing',
      bufferedAhead: 4,
      outputBufferedAhead: 1.5,
      elapsedMs: 1_000,
    });

    expect(decision).toEqual({
      kind: 'request',
      request: {
        reason: 'playback-active',
        delaysMs: TRACK_SWITCH_MEMORY_GOVERNANCE_REQUEST_DELAYS_MS,
        minIntervalMs: TRACK_SWITCH_MEMORY_GOVERNANCE_MIN_INTERVAL_MS,
      },
      playbackState: 'playing',
      bufferedAhead: 4,
      outputBufferedAhead: 1.5,
    });
  });
});
