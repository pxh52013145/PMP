import type {
  AudioEnginePolicyPatch,
  AudioRobustnessSnapshot,
  AudioState,
  PlaybackState,
} from './types';

export type StateListener = (state: AudioState) => void;

export type NativeAudioStatePayload = {
  playbackState?: PlaybackState;
  volume?: number;
  muted?: boolean;
  trackPath?: string | null;
  currentTime?: number;
  duration?: number;
  bufferedTime?: number;
  bufferedAhead?: number;
  decodeBufferedAhead?: number;
  outputBufferedAhead?: number;
  sampleRate?: number;
  sourceSampleRate?: number;
  underrunEvents?: number;
  underrunFrames?: number;
  schedulerProfile?: 'normal' | 'guarded' | 'critical';
  transportMode?: 'robust' | 'transport-exact';
  hqSrcPhaseMode?: 'linear' | 'minimum' | 'intermediate';
  srcMode?: 'source-native' | 'match-output' | 'target-rate';
  srcBackend?: 'rubato' | 'linear-simd';
  srcTargetSampleRate?: number | null;
  outputQuantizationMode?: 'round' | 'tpdf';
  hqSrcStopbandDb?: number;
  hqSrcActive?: boolean;
  hqSrcRatio?: number;
  transportExactInt32Container?: boolean;
  outputCallbackMetricsValid?: boolean;
  outputCallbackP99Us?: number;
  outputWaitTimeoutCount?: number;
  outputRenderUnderrunEvents?: number;
  outputRenderUnderrunFrames?: number;
  outputCallbackIntervalJitterP99Us?: number;
  outputCallbackIntervalOverrunCount?: number;
  outputCallbackExpectedIntervalUs?: number;
  transferLowWatermarkSamples?: number;
  transferRenderLowHitCount?: number;
  transferDecodeLowHitCount?: number;
  transferAdaptationLevel?: number;
  transferOscillationStreak?: number;
  renderQueuePageLocked?: boolean;
  sharedRenderAheadEnabled?: boolean;
  sharedRenderUnderrunEvents?: number;
  sharedRenderUnderrunFrames?: number;
  sharedRenderLowHitCount?: number;
  sharedRenderLowWatermarkSamples?: number;
  controlQueueLockFree?: boolean;
  controlQueueMode?: string;
  controlQueueCapacity?: number;
  controlQueueOverwriteEvents?: number;
  controlQueueDropNewestEvents?: number;
  controlQueueCoalescedOverflowEvents?: number;
  controlQueueCriticalOverflowEvents?: number;
  retirePendingTasks?: number;
  retireEnqueuedTotal?: number;
  retireExecutedTotal?: number;
  retireInlineFallbackTotal?: number;
  retirePanicTotal?: number;
  diagnosticTimelineDroppedEvents?: number;
  diagnosticTimeline?: Array<{
    seq?: number;
    timestampMs?: number;
    kind?: string;
    value?: number;
    aux?: number;
  }>;
  queue?: string[];
  currentIndex?: number;
  ended?: boolean;
};

export type NativeAudioEnginePolicyPayload = {
  transportMode?: 'robust' | 'transport-exact';
  hqSrcEnabled?: boolean;
  hqSrcPhaseMode?: 'linear' | 'minimum' | 'intermediate';
  srcMode?: 'source-native' | 'match-output' | 'target-rate';
  srcBackend?: 'rubato' | 'linear-simd';
  srcTargetSampleRate?: number | null;
  outputQuantizationMode?: 'round' | 'tpdf';
  hqSrcStopbandDb?: number;
  transportExactInt32Container?: boolean;
};

export type NativeAudioEnginePolicyPatch = AudioEnginePolicyPatch;

export type NativeAudioSrcPolicy = {
  srcMode: 'source-native' | 'match-output' | 'target-rate';
  srcBackend: 'rubato' | 'linear-simd';
  srcTargetSampleRate: number | null;
};

export type NativeAudioSpectrumPayload = {
  bins: number[];
  frameId?: number;
  timestampMs?: number;
  tap?: 'pre-dsp' | 'post-dsp';
  tapId?: 'pre-dsp' | 'post-dsp';
  sampleRate?: number;
};

export type NativeAudioErrorPayload = {
  seq?: number;
  code?: string;
  message?: string;
};

export type NativeAudioComponentsStatePayload = {
  outputBackendId?: string | null;
  preferredInputId?: string | null;
  activeInputId?: string | null;
};

export type ReplayGainMode = 'track' | 'album';

export type ReplayGainSettings = {
  enabled: boolean;
  mode: ReplayGainMode;
  preampDb: number;
};

export type RuntimeControlSettings = {
  dynamicGainEnabled: boolean;
  volumeDebounceEnabled: boolean;
};

export function parseLegacyRuntimeControlFromReplayGain(
  raw: string | null,
): RuntimeControlSettings | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    const hasDynamicGain =
      typeof record.dynamicGainEnabled === 'boolean' ||
      typeof record.dynamicFallbackEnabled === 'boolean';
    const hasDebounce = typeof record.volumeDebounceEnabled === 'boolean';
    if (!hasDynamicGain && !hasDebounce) return null;

    const dynamicGainEnabled =
      typeof record.dynamicGainEnabled === 'boolean'
        ? record.dynamicGainEnabled
        : typeof record.dynamicFallbackEnabled === 'boolean'
          ? record.dynamicFallbackEnabled
          : false;

    return {
      dynamicGainEnabled,
      volumeDebounceEnabled: hasDebounce ? (record.volumeDebounceEnabled as boolean) : true,
    };
  } catch {
    return null;
  }
}

export type CrossfadeSettings = {
  enabled: boolean;
  durationMs: number;
};

export type DynamicSrcLearningRecord = {
  stressIndex: number;
  updatedAtMs: number;
};

export type DynamicSrcLearningMap = Record<string, DynamicSrcLearningRecord>;

export type RobustnessListener = (snapshot: AudioRobustnessSnapshot) => void;
