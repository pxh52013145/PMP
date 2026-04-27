import { describe, expect, it } from 'vitest';
import {
  buildNativeAudioRobustnessSnapshot,
  type NativeAudioRobustnessSnapshotSource,
} from './nativeAudioRobustnessSnapshot';
import type { DynamicSrcEffectiveTiming } from './dynamicSrcAdaptiveTiming';
import type { AudioRobustnessSnapshot, AudioState } from './types';

type SnapshotSourceForTest = NativeAudioRobustnessSnapshotSource & {
  currentOutputBackendId: AudioRobustnessSnapshot['outputBackendId'];
  availableOutputBackends: AudioRobustnessSnapshot['outputBackends'];
  dynamicSrcHoldUntilMs: number;
  tuningAutoControllerState: {
    criticalOverflowGrowthStreak: number;
    activeProfile: NonNullable<AudioRobustnessSnapshot['tuningAutoActiveProfile']>;
    stableSinceMs: number;
    lastSwitchAtMs: number;
  };
  lastUnderrunEvents: AudioRobustnessSnapshot['underrunEvents'];
  lastUnderrunFrames: AudioRobustnessSnapshot['underrunFrames'];
  underrunSpikeTimestampsMs: number[];
  protectionWindowRefCount: AudioRobustnessSnapshot['protectionRefCount'];
  autoBackendSwitchCount: AudioRobustnessSnapshot['autoSwitchCount'];
  lastAutoBackendSwitchAtMs: AudioRobustnessSnapshot['lastAutoSwitchAtMs'];
  lastAutoBackendSwitchReason: AudioRobustnessSnapshot['lastAutoSwitchReason'];
  bufferedAheadMinSeconds: AudioRobustnessSnapshot['bufferedAheadMinSeconds'];
  rebufferCount: AudioRobustnessSnapshot['rebufferCount'];
  diagnosticTimelineDroppedEvents: NonNullable<AudioRobustnessSnapshot['diagnosticTimelineDroppedEvents']>;
  diagnosticTimeline: NonNullable<AudioRobustnessSnapshot['diagnosticTimeline']>;
  protectionWindowReason: string | null;
  sharedStressReason: string | null;
};

const effectiveTiming: DynamicSrcEffectiveTiming = {
  profile: 'baseline',
  stressScore: 0,
  restoreDebounceMs: 0,
  minSwitchIntervalMs: 0,
  seekHoldMs: 0,
  underrunHoldMs: 0,
  sharedStressHoldMs: 0,
  outputErrorHoldMs: 0,
};

const audioState: AudioState = {
  currentTrack: null,
  playbackState: 'playing',
  currentTime: 0,
  duration: 0,
  bufferedTime: 0,
  bufferedAhead: 0,
  decodeBufferedAhead: 0,
  outputBufferedAhead: 0,
  volume: 1,
  muted: false,
  playMode: 'sequence',
  queue: [],
  currentIndex: -1,
  playlists: [],
  currentPlaylist: null,
};

function createSource(
  diagnosticTimeline: NonNullable<AudioRobustnessSnapshot['diagnosticTimeline']>
): SnapshotSourceForTest {
  return {
    pruneUnderrunSpikeWindow: () => undefined,
    getEffectiveDynamicSrcTiming: () => effectiveTiming,
    evaluateDynamicSrcAutoDegradation: () => undefined,
    buildDynamicSrcLearningDeviceKey: () => 'test-device',
    getDynamicSrcLearningScale: () => 1,
    hasActiveProtectionWindow: () => false,
    hasActiveSharedStressWindow: () => false,
    state: audioState,
    bufferedAheadRollingWindow: [],
    bufferedAheadRollingSum: 0,
    underrunRecoveryUntilMs: 0,
    dynamicSrcAdaptiveProfile: 'baseline',
    dynamicSrcLearningProfile: {},
    lastWorkingSetTrimEvent: null,
    currentOutputBackendId: 'test-backend',
    availableOutputBackends: ['test-backend'],
    dynamicSrcHoldUntilMs: 0,
    tuningAutoControllerState: {
      criticalOverflowGrowthStreak: 0,
      activeProfile: 'robust-shield',
      stableSinceMs: 0,
      lastSwitchAtMs: 0,
    },
    lastUnderrunEvents: 0,
    lastUnderrunFrames: 0,
    underrunSpikeTimestampsMs: [],
    protectionWindowRefCount: 0,
    autoBackendSwitchCount: 0,
    lastAutoBackendSwitchAtMs: null,
    lastAutoBackendSwitchReason: null,
    bufferedAheadMinSeconds: null,
    rebufferCount: 0,
    diagnosticTimelineDroppedEvents: 0,
    diagnosticTimeline,
    protectionWindowReason: null,
    sharedStressReason: null,
  };
}

describe('nativeAudioRobustnessSnapshot', () => {
  it('aggregates VST sidecar deadline and runtime resize diagnostics', () => {
    const snapshot = buildNativeAudioRobustnessSnapshot(
      createSource([
        {
          seq: 1,
          timestampMs: 1_000,
          kind: 'vst.sidecar.process_block_deadline_miss',
          value: 2,
          aux: 512,
        },
        {
          seq: 2,
          timestampMs: 1_100,
          kind: 'vst.sidecar.process_block_deadline_miss',
          value: 1,
          aux: 256,
        },
        {
          seq: 3,
          timestampMs: 1_200,
          kind: 'vst.sidecar.runtime_resize',
          value: 3,
          aux: 4_096,
        },
      ]),
      2_000
    );

    expect(snapshot.vstSidecarProcessBlockDeadlineMissCount).toBe(3);
    expect(snapshot.vstSidecarProcessBlockDeadlineMissFrames).toBe(768);
    expect(snapshot.vstSidecarRuntimeResizeEvents).toBe(3);
    expect(snapshot.vstSidecarRuntimeResizeBytes).toBe(4_096);
  });
});
