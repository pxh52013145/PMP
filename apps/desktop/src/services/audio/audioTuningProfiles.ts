import type {
  AudioDynamicSrcAutoSettingsPatch,
  AudioEnginePolicyPatch,
  AudioRobustnessSnapshot,
  AudioTuningProfileId,
} from './types';
import { normalizeStreamingBufferSettings, type StreamingBufferSettings } from './streamingBufferPolicy';

type AudioOutputBackendClass = 'exclusive' | 'shared-raw' | 'shared' | 'fallback';

type AudioTuningTransitionSnapshot = Pick<
  AudioRobustnessSnapshot,
  | 'schedulerProfile'
  | 'dynamicSrcStressScore'
  | 'underrunEventsWindow'
  | 'outputWaitTimeoutCount'
  | 'outputRenderUnderrunEvents'
  | 'controlQueueOverwriteEvents'
  | 'controlQueueDropNewestEvents'
  | 'controlQueueCoalescedOverflowEvents'
  | 'controlQueueCriticalOverflowEvents'
>;

export type AudioTuningProfilePayload = {
  profileId: AudioTuningProfileId;
  outputBackendClass: AudioOutputBackendClass;
  streamingBuffer: StreamingBufferSettings;
  streamingBufferStoragePayload: StreamingBufferSettings & {
    userSetDecodeMode: boolean;
  };
  enginePolicy: AudioEnginePolicyPatch;
  dynamicSrcSettings: AudioDynamicSrcAutoSettingsPatch;
};

export type ResolveAudioTuningProfilePayloadInput = {
  profileId: AudioTuningProfileId;
  outputBackendId?: string | null;
};

export type AudioTuningControllerState = {
  activeProfile: AudioTuningProfileId;
  lastSwitchAtMs: number | null;
  stableSinceMs: number | null;
  lastOutputWaitTimeoutCount: number;
  lastOutputRenderUnderrunEvents: number;
  lastControlQueueOverflowEvents: number;
  lastControlQueueCriticalOverflowEvents: number;
  criticalOverflowGrowthStreak: number;
};

export type AudioTuningTransitionThresholds = {
  elevatedStressScore: number;
  criticalStressScore: number;
  criticalUnderrunEventsWindow: number;
  criticalOverflowGrowthTicks: number;
  stableWindowMs: number;
  minSwitchIntervalMs: number;
  postSwitchObserveWindowMs: number;
};

export type ResolveAudioTuningTransitionInput = {
  nowMs: number;
  snapshot: AudioTuningTransitionSnapshot;
  state: AudioTuningControllerState;
  thresholds?: Partial<AudioTuningTransitionThresholds>;
};

export type AudioTuningTransitionDecision = {
  changed: boolean;
  nextProfile: AudioTuningProfileId;
  reason:
    | 'hold-current'
    | 'critical-pressure'
    | 'critical-overflow-growth'
    | 'guarded-pressure'
    | 'queue-overflow-pressure'
    | 'post-critical-recovery'
    | 'stable-window'
    | 'cooldown-hold'
    | 'observe-window-hold';
  state: AudioTuningControllerState;
};

type StreamingTuple = {
  startOrSeekSeconds: number;
  crossfadeSeconds: number;
  interactiveProfile: StreamingBufferSettings['interactiveProfile'];
};

type ProfileDefinition = {
  streamingByBackend: Record<AudioOutputBackendClass, StreamingTuple>;
  enginePolicy: AudioEnginePolicyPatch;
  dynamicSrcSettings: AudioDynamicSrcAutoSettingsPatch;
};

const PROFILE_PROTECTION_RANK: Record<AudioTuningProfileId, number> = {
  'extreme-ll': 0,
  'll-guarded': 1,
  'robust-shield': 2,
};

const DEFAULT_THRESHOLDS: AudioTuningTransitionThresholds = {
  elevatedStressScore: 4,
  criticalStressScore: 8,
  criticalUnderrunEventsWindow: 2,
  criticalOverflowGrowthTicks: 2,
  stableWindowMs: 30_000,
  minSwitchIntervalMs: 10_000,
  postSwitchObserveWindowMs: 15_000,
};

const PROFILE_DEFINITIONS: Record<AudioTuningProfileId, ProfileDefinition> = {
  'extreme-ll': {
    streamingByBackend: {
      exclusive: {
        startOrSeekSeconds: 0.24,
        crossfadeSeconds: 0.9,
        interactiveProfile: 'fast',
      },
      'shared-raw': {
        startOrSeekSeconds: 0.3,
        crossfadeSeconds: 0.95,
        interactiveProfile: 'fast',
      },
      shared: {
        startOrSeekSeconds: 0.36,
        crossfadeSeconds: 1,
        interactiveProfile: 'fast',
      },
      fallback: {
        startOrSeekSeconds: 0.42,
        crossfadeSeconds: 1.05,
        interactiveProfile: 'fast',
      },
    },
    enginePolicy: {
      transportMode: 'robust',
      srcMode: 'match-output',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: null,
    },
    dynamicSrcSettings: {
      enabled: true,
      adaptiveEnabled: true,
      learningEnabled: true,
      restoreDebounceMs: 2800,
      minSwitchIntervalMs: 400,
      seekHoldMs: 1600,
      underrunHoldMs: 9000,
      sharedStressHoldMs: 6500,
      outputErrorHoldMs: 8000,
    },
  },
  'll-guarded': {
    streamingByBackend: {
      exclusive: {
        startOrSeekSeconds: 0.34,
        crossfadeSeconds: 1.1,
        interactiveProfile: 'balanced',
      },
      'shared-raw': {
        startOrSeekSeconds: 0.42,
        crossfadeSeconds: 1.15,
        interactiveProfile: 'balanced',
      },
      shared: {
        startOrSeekSeconds: 0.5,
        crossfadeSeconds: 1.2,
        interactiveProfile: 'balanced',
      },
      fallback: {
        startOrSeekSeconds: 0.62,
        crossfadeSeconds: 1.35,
        interactiveProfile: 'balanced',
      },
    },
    enginePolicy: {
      transportMode: 'robust',
      srcMode: 'match-output',
      srcBackend: 'rubato',
      srcTargetSampleRate: null,
    },
    dynamicSrcSettings: {
      enabled: true,
      adaptiveEnabled: true,
      learningEnabled: true,
      restoreDebounceMs: 4000,
      minSwitchIntervalMs: 600,
      seekHoldMs: 2000,
      underrunHoldMs: 12_000,
      sharedStressHoldMs: 8000,
      outputErrorHoldMs: 10_000,
    },
  },
  'robust-shield': {
    streamingByBackend: {
      exclusive: {
        startOrSeekSeconds: 0.8,
        crossfadeSeconds: 1.6,
        interactiveProfile: 'stable',
      },
      'shared-raw': {
        startOrSeekSeconds: 0.9,
        crossfadeSeconds: 1.7,
        interactiveProfile: 'stable',
      },
      shared: {
        startOrSeekSeconds: 1.05,
        crossfadeSeconds: 1.8,
        interactiveProfile: 'stable',
      },
      fallback: {
        startOrSeekSeconds: 1.2,
        crossfadeSeconds: 1.95,
        interactiveProfile: 'stable',
      },
    },
    enginePolicy: {
      transportMode: 'robust',
      srcMode: 'match-output',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: null,
    },
    dynamicSrcSettings: {
      enabled: true,
      adaptiveEnabled: true,
      learningEnabled: true,
      restoreDebounceMs: 6500,
      minSwitchIntervalMs: 900,
      seekHoldMs: 2600,
      underrunHoldMs: 22_000,
      sharedStressHoldMs: 14_000,
      outputErrorHoldMs: 16_000,
    },
  },
};

function clampMs(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value;
}

function buildDynamicSrcSettings(
  settings: AudioDynamicSrcAutoSettingsPatch
): AudioDynamicSrcAutoSettingsPatch {
  return {
    enabled: settings.enabled !== false,
    adaptiveEnabled: settings.adaptiveEnabled !== false,
    learningEnabled: settings.learningEnabled !== false,
    restoreDebounceMs: clampMs(settings.restoreDebounceMs, 4000, 500, 30_000),
    minSwitchIntervalMs: clampMs(settings.minSwitchIntervalMs, 600, 100, 10_000),
    seekHoldMs: clampMs(settings.seekHoldMs, 2000, 500, 20_000),
    underrunHoldMs: clampMs(settings.underrunHoldMs, 12_000, 2_000, 120_000),
    sharedStressHoldMs: clampMs(settings.sharedStressHoldMs, 8000, 1000, 90_000),
    outputErrorHoldMs: clampMs(settings.outputErrorHoldMs, 10_000, 1000, 120_000),
  };
}

export function resolveOutputBackendClass(outputBackendId: string | null | undefined): AudioOutputBackendClass {
  if (!outputBackendId) return 'fallback';
  if (outputBackendId.includes('exclusive')) return 'exclusive';
  if (outputBackendId.includes('shared-raw')) return 'shared-raw';
  if (outputBackendId.includes('wasapi')) return 'shared';
  return 'fallback';
}

export function resolveAudioTuningProfilePayload(
  input: ResolveAudioTuningProfilePayloadInput
): AudioTuningProfilePayload {
  const outputBackendClass = resolveOutputBackendClass(input.outputBackendId ?? null);
  const profile = PROFILE_DEFINITIONS[input.profileId];
  const streamingTuple = profile.streamingByBackend[outputBackendClass];
  const streamingBuffer = normalizeStreamingBufferSettings({
    startOrSeekSeconds: streamingTuple.startOrSeekSeconds,
    crossfadeSeconds: streamingTuple.crossfadeSeconds,
    decodeMode: 'streaming',
    interactiveProfile: streamingTuple.interactiveProfile,
  });

  return {
    profileId: input.profileId,
    outputBackendClass,
    streamingBuffer,
    streamingBufferStoragePayload: {
      ...streamingBuffer,
      userSetDecodeMode: true,
    },
    enginePolicy: {
      ...profile.enginePolicy,
    },
    dynamicSrcSettings: buildDynamicSrcSettings(profile.dynamicSrcSettings),
  };
}

export function createAudioTuningControllerState(
  activeProfile: AudioTuningProfileId = 'll-guarded'
): AudioTuningControllerState {
  return {
    activeProfile,
    lastSwitchAtMs: null,
    stableSinceMs: null,
    lastOutputWaitTimeoutCount: 0,
    lastOutputRenderUnderrunEvents: 0,
    lastControlQueueOverflowEvents: 0,
    lastControlQueueCriticalOverflowEvents: 0,
    criticalOverflowGrowthStreak: 0,
  };
}

export function resolveAudioTuningTransition(
  input: ResolveAudioTuningTransitionInput
): AudioTuningTransitionDecision {
  const nowMs = Math.max(0, Math.floor(input.nowMs));
  const thresholds: AudioTuningTransitionThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(input.thresholds ?? {}),
  };

  const schedulerProfile = input.snapshot.schedulerProfile ?? 'normal';
  const stressScore = toFiniteNumber(input.snapshot.dynamicSrcStressScore, 0);
  const underrunEventsWindow = clampCount(input.snapshot.underrunEventsWindow);

  const outputWaitTimeoutCount = clampCount(
    input.snapshot.outputWaitTimeoutCount ?? input.state.lastOutputWaitTimeoutCount
  );
  const outputRenderUnderrunEvents = clampCount(
    input.snapshot.outputRenderUnderrunEvents ?? input.state.lastOutputRenderUnderrunEvents
  );

  const outputWaitTimeoutDelta = Math.max(
    0,
    outputWaitTimeoutCount - input.state.lastOutputWaitTimeoutCount
  );
  const outputRenderUnderrunDelta = Math.max(
    0,
    outputRenderUnderrunEvents - input.state.lastOutputRenderUnderrunEvents
  );

  const controlQueueOverwriteEvents = clampCount(input.snapshot.controlQueueOverwriteEvents);
  const controlQueueDropNewestEvents = clampCount(input.snapshot.controlQueueDropNewestEvents);
  const controlQueueCoalescedOverflowEvents = clampCount(
    input.snapshot.controlQueueCoalescedOverflowEvents
  );
  const controlQueueCriticalOverflowEvents = clampCount(
    input.snapshot.controlQueueCriticalOverflowEvents ??
      input.state.lastControlQueueCriticalOverflowEvents
  );
  const controlQueueOverflowEvents =
    controlQueueOverwriteEvents +
    controlQueueDropNewestEvents +
    controlQueueCoalescedOverflowEvents +
    controlQueueCriticalOverflowEvents;
  const controlQueueOverflowDelta = Math.max(
    0,
    controlQueueOverflowEvents - input.state.lastControlQueueOverflowEvents
  );
  const controlQueueCriticalOverflowDelta = Math.max(
    0,
    controlQueueCriticalOverflowEvents - input.state.lastControlQueueCriticalOverflowEvents
  );
  const criticalOverflowGrowthStreak =
    controlQueueCriticalOverflowDelta > 0 ? input.state.criticalOverflowGrowthStreak + 1 : 0;
  const criticalOverflowPressure =
    criticalOverflowGrowthStreak >= Math.max(1, thresholds.criticalOverflowGrowthTicks);

  const isCritical =
    schedulerProfile === 'critical' ||
    stressScore >= thresholds.criticalStressScore ||
    underrunEventsWindow >= thresholds.criticalUnderrunEventsWindow ||
    criticalOverflowPressure;

  const isGuarded =
    !isCritical &&
    (schedulerProfile === 'guarded' ||
      stressScore >= thresholds.elevatedStressScore ||
      outputWaitTimeoutDelta > 0 ||
      outputRenderUnderrunDelta > 0 ||
      controlQueueOverflowDelta > 0);

  const isStable =
    schedulerProfile === 'normal' &&
    stressScore < thresholds.elevatedStressScore &&
    underrunEventsWindow === 0 &&
    outputWaitTimeoutDelta === 0 &&
    outputRenderUnderrunDelta === 0 &&
    controlQueueOverflowDelta === 0;

  const stableSinceMs = isStable ? (input.state.stableSinceMs ?? nowMs) : null;
  const stableDurationMs = stableSinceMs === null ? 0 : Math.max(0, nowMs - stableSinceMs);

  let desiredProfile = input.state.activeProfile;
  let reason: AudioTuningTransitionDecision['reason'] = 'hold-current';

  if (isCritical) {
    desiredProfile = 'robust-shield';
    reason = criticalOverflowPressure ? 'critical-overflow-growth' : 'critical-pressure';
  } else if (isGuarded) {
    desiredProfile = 'll-guarded';
    reason = controlQueueOverflowDelta > 0 ? 'queue-overflow-pressure' : 'guarded-pressure';
  } else if (input.state.activeProfile === 'robust-shield') {
    desiredProfile = 'll-guarded';
    reason = 'post-critical-recovery';
  }

  if (
    desiredProfile !== 'robust-shield' &&
    stableDurationMs >= thresholds.stableWindowMs &&
    input.state.activeProfile !== 'extreme-ll'
  ) {
    desiredProfile = 'extreme-ll';
    reason = 'stable-window';
  }

  const elapsedSinceSwitchMs =
    input.state.lastSwitchAtMs === null ? Number.POSITIVE_INFINITY : nowMs - input.state.lastSwitchAtMs;
  const currentRank = PROFILE_PROTECTION_RANK[input.state.activeProfile];
  const desiredRank = PROFILE_PROTECTION_RANK[desiredProfile];
  const isEscalation = desiredRank > currentRank;

  const cooldownPassed = isEscalation || elapsedSinceSwitchMs >= thresholds.minSwitchIntervalMs;
  const observePassed = isEscalation || elapsedSinceSwitchMs >= thresholds.postSwitchObserveWindowMs;

  let nextProfile = desiredProfile;
  if (desiredProfile !== input.state.activeProfile && !cooldownPassed) {
    nextProfile = input.state.activeProfile;
    reason = 'cooldown-hold';
  } else if (desiredProfile !== input.state.activeProfile && !observePassed) {
    nextProfile = input.state.activeProfile;
    reason = 'observe-window-hold';
  }

  const changed = nextProfile !== input.state.activeProfile;

  return {
    changed,
    nextProfile,
    reason,
    state: {
      activeProfile: nextProfile,
      lastSwitchAtMs: changed ? nowMs : input.state.lastSwitchAtMs,
      stableSinceMs,
      lastOutputWaitTimeoutCount: outputWaitTimeoutCount,
      lastOutputRenderUnderrunEvents: outputRenderUnderrunEvents,
      lastControlQueueOverflowEvents: controlQueueOverflowEvents,
      lastControlQueueCriticalOverflowEvents: controlQueueCriticalOverflowEvents,
      criticalOverflowGrowthStreak,
    },
  };
}
