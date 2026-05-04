import { listen } from '@tauri-apps/api/event';
import type {
  AudioSourcePrepareProfile,
  AudioSpectrumFrame,
  AudioSpectrumTap,
  AudioStabilityActionProfile,
  AudioStabilityProfile,
  AudioState,
} from './types';
import type {
  NativeAudioErrorPayload,
  NativeAudioSpectrumPayload,
  NativeAudioStatePayload,
} from './nativeAudioServiceTypes';
import {
  normalizeNativeAudioDiagnosticTimeline,
  type NativeAudioDiagnosticTimelineEntry,
} from './nativeAudioDiagnosticTimelineAdapter';
import { resolveNativeAudioPlaybackStatePayload } from './nativeAudioPlaybackStatePayloadAdapter';
import { resolveNativeAudioQueueStatePayload } from './nativeAudioQueueStatePayloadAdapter';
import { applyNativeAudioRuntimeMetricsPayload } from './nativeAudioRuntimeMetricsAdapter';
import { applyNativeAudioSpectrumPayload } from './nativeAudioSpectrumPayloadAdapter';
import { getTelemetryLogger } from '../telemetry/TelemetryService';

const telemetry = getTelemetryLogger('audio', 'nativeAudioNativeListeners');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type NativeAudioListenerCleanup = (() => void) | null;

type DynamicSrcAutoDegradationOptions = {
  nowMs?: number;
  stressScore?: number;
  triggerActions: boolean;
};

export type NativeAudioListenerHost = {
  state: AudioState;
  stateListener: NativeAudioListenerCleanup;
  errorListener: NativeAudioListenerCleanup;
  spectrumListener: NativeAudioListenerCleanup;
  lastUnderrunEvents: number;
  lastUnderrunFrames: number;
  lastNativeErrorSeq: number;
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
  outputSampleRate: number;
  sourceSampleRate: number;
  hqSrcStopbandDb: number;
  hqSrcActive: boolean;
  hqSrcRatio: number;
  transportExactInt32Container: boolean;
  outputCallbackMetricsValid: boolean;
  outputCallbackP99Us: number;
  outputWaitTimeoutCount: number;
  outputRenderUnderrunEvents: number;
  outputRenderUnderrunFrames: number;
  outputCallbackIntervalJitterP99Us: number;
  outputCallbackIntervalOverrunCount: number;
  outputCallbackExpectedIntervalUs: number;
  transferLowWatermarkSamples: number;
  transferRenderLowHitCount: number;
  transferDecodeLowHitCount: number;
  transferAdaptationLevel: number;
  transferOscillationStreak: number;
  renderQueuePageLocked: boolean;
  renderQueuePageLockFailureCount: number;
  renderQueuePageLockAttemptedBytes: number;
  renderQueuePageLockSucceededBytes: number;
  renderQueuePageLockFailedBytes: number;
  transferMetricsValid: boolean;
  sharedRenderAheadEnabled: boolean;
  sharedRenderUnderrunEvents: number;
  sharedRenderUnderrunFrames: number;
  sharedRenderLowHitCount: number;
  sharedRenderLowWatermarkSamples: number;
  controlQueueLockFree: boolean;
  controlQueueMode: string;
  controlQueueCapacity: number;
  controlQueueOverwriteEvents: number;
  controlQueueDropNewestEvents: number;
  controlQueueCoalescedOverflowEvents: number;
  controlQueueCriticalOverflowEvents: number;
  estimatedAudioBufferBytes: number;
  memoryPoolF32GrowthEvents: number;
  memoryPoolF32GrowthBytes: number;
  memoryPoolF32PrewarmHits: number;
  realtimeMemoryLockAttemptedBytes: number;
  realtimeMemoryLockSucceededBytes: number;
  realtimeMemoryLockFailedBytes: number;
  realtimeMemoryLockSkippedBytes: number;
  realtimeMemoryLockFailureCount: number;
  realtimeMemoryLockSkippedCount: number;
  realtimeMemoryLockedRoleMask: number;
  realtimeMemoryFailedRoleMask: number;
  realtimeMemorySkippedRoleMask: number;
  realtimeMemoryPressureEvents: number;
  diagnosticTimelineDroppedEvents: number;
  diagnosticTimeline: NativeAudioDiagnosticTimelineEntry[];
  fallbackClockBaseTimeSec: number;
  fallbackClockStartedAtMs: number | null;
  lastBackendTimeUpdateAtMs: number;
  timeUpdateCallbacks: Set<(time: number) => void>;
  endedCallbacks: Set<() => void>;
  spectrumData: Uint8Array | null;
  spectrumFrames: Partial<Record<AudioSpectrumTap, AudioSpectrumFrame>>;
  shouldIgnoreBackendCurrentTime(nextTime: number): boolean;
  handleUnderrunSpike(nextUnderrunEvents: number, nextUnderrunFrames?: number): void;
  handleRenderQueuePageLockStatus(
    locked: boolean,
    playbackState?: NativeAudioStatePayload['playbackState']
  ): void;
  maybeReleaseUnderrunRecovery(playbackState: AudioState['playbackState']): void;
  ensureFallbackTicker(): void;
  applyPlaybackStateSideEffects(playbackState: AudioState['playbackState']): void;
  applySharedTimelineStressIfNeeded(timeline: NativeAudioDiagnosticTimelineEntry[]): void;
  deriveTitleFromPath(path: string): string;
  emitError(error: Error): void;
  emitRobustnessSnapshot(force?: boolean): void;
  evaluateDynamicSrcAutoDegradation(options: DynamicSrcAutoDegradationOptions): void;
  getEffectiveDynamicSrcTiming(nowMs?: number): { stressScore: number };
  getTrackPath(track: AudioState['currentTrack'] | null | undefined): string | null;
  handleTrackEnded(): void;
  isSameQueuePaths(queuePaths: string[]): boolean;
  normalizeTrackPathForCompare(path: string | null): string;
  recordBufferedAheadSample(value: number): void;
  resolveQueueFromPaths(paths: string[]): AudioState['queue'];
  resolveTrackFromPath(path: string): { track: NonNullable<AudioState['currentTrack']>; index: number } | null;
  trackPlaybackStateForMetrics(nextPlaybackState: AudioState['playbackState']): void;
  updateDynamicSrcLearningFromStress(stressScore: number, nowMs?: number): void;
  updateState(partial: Partial<AudioState>, options?: { emitStateChange?: boolean }): AudioState;
};

export async function setupNativeListenersImpl(
  this: NativeAudioListenerHost,
): Promise<void> {
    try {
      this.stateListener = await listen('native_audio_state', (event) => {
        const payload = event.payload as NativeAudioStatePayload | { state?: NativeAudioStatePayload };
        const next =
          payload && 'state' in payload ? (payload.state as NativeAudioStatePayload) : (payload as NativeAudioStatePayload);
        if (!next) return;

        const playbackStateResolution = resolveNativeAudioPlaybackStatePayload({
          payload: next,
          state: this.state,
        });
        const { update, currentTime: nextCurrentTime } = playbackStateResolution;
        const shouldApplyCurrentTime =
          typeof nextCurrentTime === 'number' &&
          !this.shouldIgnoreBackendCurrentTime(nextCurrentTime);
        if (shouldApplyCurrentTime && typeof nextCurrentTime === 'number') {
          update.currentTime = nextCurrentTime;
        }

        if (typeof next.underrunEvents === 'number' && Number.isFinite(next.underrunEvents)) {
          const normalizedUnderrunEvents = Math.max(0, Math.floor(next.underrunEvents));
          if (normalizedUnderrunEvents < this.lastUnderrunEvents) {
            this.lastUnderrunEvents = normalizedUnderrunEvents;
          } else if (normalizedUnderrunEvents > this.lastUnderrunEvents) {
            this.handleUnderrunSpike(normalizedUnderrunEvents, next.underrunFrames);
          }
        }

        if (typeof next.underrunFrames === 'number' && Number.isFinite(next.underrunFrames)) {
          this.lastUnderrunFrames = Math.max(0, Math.floor(next.underrunFrames));
        }

        if (
          next.schedulerProfile === 'normal' ||
          next.schedulerProfile === 'guarded' ||
          next.schedulerProfile === 'critical'
        ) {
          this.lastSchedulerProfile = next.schedulerProfile;
        }

        if (
          next.stabilityActionProfile === 'normal' ||
          next.stabilityActionProfile === 'guarded' ||
          next.stabilityActionProfile === 'critical'
        ) {
          this.stabilityActionProfile = next.stabilityActionProfile;
        }

        if (
          next.stabilityProfile === 'low-latency' ||
          next.stabilityProfile === 'balanced' ||
          next.stabilityProfile === 'stable' ||
          next.stabilityProfile === 'game-safe' ||
          next.stabilityProfile === 'safe-mode'
        ) {
          this.stabilityProfile = next.stabilityProfile;
        }

        if (
          next.sourcePrepareProfile === 'baseline' ||
          next.sourcePrepareProfile === 'steady' ||
          next.sourcePrepareProfile === 'aggressive' ||
          next.sourcePrepareProfile === 'failsafe'
        ) {
          this.sourcePrepareProfile = next.sourcePrepareProfile;
        }

        if (typeof next.stabilityPrimaryReason === 'string') {
          this.stabilityPrimaryReason = next.stabilityPrimaryReason;
        } else if (next.stabilityPrimaryReason === null) {
          this.stabilityPrimaryReason = null;
        }

        if (Array.isArray(next.stabilityReasonCodes)) {
          this.stabilityReasonCodes = next.stabilityReasonCodes.filter(
            (reason): reason is string => typeof reason === 'string' && reason.length > 0
          );
        }

        if (
          next.stabilityHintProfile === 'normal' ||
          next.stabilityHintProfile === 'guarded' ||
          next.stabilityHintProfile === 'critical'
        ) {
          this.stabilityHintProfile = next.stabilityHintProfile;
        } else if (next.stabilityHintProfile === null) {
          this.stabilityHintProfile = undefined;
        }

        if (typeof next.stabilityHintPrimaryReason === 'string') {
          this.stabilityHintPrimaryReason = next.stabilityHintPrimaryReason;
        } else if (next.stabilityHintPrimaryReason === null) {
          this.stabilityHintPrimaryReason = null;
        }

        if (Array.isArray(next.stabilityHintReasonCodes)) {
          this.stabilityHintReasonCodes = next.stabilityHintReasonCodes.filter(
            (reason): reason is string => typeof reason === 'string' && reason.length > 0
          );
        } else if (next.stabilityHintReasonCodes === null) {
          this.stabilityHintReasonCodes = [];
        }

        if (next.transportMode === 'robust' || next.transportMode === 'transport-exact') {
          this.transportMode = next.transportMode;
        }

        if (
          next.hqSrcPhaseMode === 'linear' ||
          next.hqSrcPhaseMode === 'minimum' ||
          next.hqSrcPhaseMode === 'intermediate'
        ) {
          this.hqSrcPhaseMode = next.hqSrcPhaseMode;
        }

        if (
          next.srcMode === 'source-native' ||
          next.srcMode === 'match-output' ||
          next.srcMode === 'target-rate'
        ) {
          this.srcMode = next.srcMode;
        }

        if (next.srcBackend === 'rubato' || next.srcBackend === 'linear-simd') {
          this.srcBackend = next.srcBackend;
        }

        if (
          typeof next.srcTargetSampleRate === 'number' &&
          Number.isFinite(next.srcTargetSampleRate) &&
          next.srcTargetSampleRate > 0
        ) {
          this.srcTargetSampleRate = Math.max(8000, Math.min(768000, Math.floor(next.srcTargetSampleRate)));
        } else if (next.srcTargetSampleRate == null) {
          this.srcTargetSampleRate = null;
        }

        if (next.outputQuantizationMode === 'round' || next.outputQuantizationMode === 'tpdf') {
          this.outputQuantizationMode = next.outputQuantizationMode;
        }

        if (typeof next.hqSrcStopbandDb === 'number' && Number.isFinite(next.hqSrcStopbandDb)) {
          this.hqSrcStopbandDb = Math.max(0, Math.min(200, Math.floor(next.hqSrcStopbandDb)));
        }

        if (typeof next.hqSrcActive === 'boolean') {
          this.hqSrcActive = next.hqSrcActive;
        }

        if (typeof next.hqSrcRatio === 'number' && Number.isFinite(next.hqSrcRatio)) {
          this.hqSrcRatio = next.hqSrcRatio;
        }

        if (typeof next.transportExactInt32Container === 'boolean') {
          this.transportExactInt32Container = next.transportExactInt32Container;
        }

        const runtimeMetricsResult = applyNativeAudioRuntimeMetricsPayload(this, next);
        if (runtimeMetricsResult.renderQueuePageLockStatus) {
          this.handleRenderQueuePageLockStatus(
            runtimeMetricsResult.renderQueuePageLockStatus.locked,
            runtimeMetricsResult.renderQueuePageLockStatus.playbackState
          );
        }

        if (Array.isArray(next.diagnosticTimeline)) {
          this.diagnosticTimeline =
            normalizeNativeAudioDiagnosticTimeline(next.diagnosticTimeline) ?? [];
          this.applySharedTimelineStressIfNeeded(this.diagnosticTimeline);
        }

        if (typeof next.bufferedAhead === 'number' && Number.isFinite(next.bufferedAhead)) {
          this.recordBufferedAheadSample(next.bufferedAhead);
        }

        Object.assign(
          update,
          resolveNativeAudioQueueStatePayload({
            payload: next,
            state: this.state,
            resolver: this,
          })
        );

        const transientOnlyStateUpdate =
          Object.keys(update).length > 0 &&
          Object.keys(update).every(
            (key) =>
              key === 'currentTime' ||
              key === 'bufferedTime' ||
              key === 'bufferedAhead' ||
              key === 'decodeBufferedAhead' ||
              key === 'outputBufferedAhead'
          );

        const merged = this.updateState(update, { emitStateChange: !transientOnlyStateUpdate });
        if (typeof next.playbackState !== 'undefined') {
          this.trackPlaybackStateForMetrics(merged.playbackState);
          this.applyPlaybackStateSideEffects(merged.playbackState);
        }
        if (shouldApplyCurrentTime && typeof nextCurrentTime === 'number') {
          this.lastBackendTimeUpdateAtMs = performance.now();
          if (merged.playbackState === 'playing') {
            this.fallbackClockBaseTimeSec = nextCurrentTime;
            this.fallbackClockStartedAtMs = this.lastBackendTimeUpdateAtMs;
            this.ensureFallbackTicker();
          } else {
            this.fallbackClockBaseTimeSec = nextCurrentTime;
            this.fallbackClockStartedAtMs = null;
          }
          this.timeUpdateCallbacks.forEach((cb: (time: number) => void) => cb(nextCurrentTime));
        }
        if (next.ended) {
          this.endedCallbacks.forEach((cb: () => void) => cb());
          void this.handleTrackEnded();
        }

        if (merged.playbackState === 'playing' || merged.playbackState === 'buffering') {
          const nowMs = Date.now();
          const stressScore = this.getEffectiveDynamicSrcTiming(nowMs).stressScore;
          this.updateDynamicSrcLearningFromStress(stressScore, nowMs);
        }

        this.maybeReleaseUnderrunRecovery(merged.playbackState);
        this.evaluateDynamicSrcAutoDegradation({ triggerActions: true });
        this.emitRobustnessSnapshot();
      });

      this.spectrumListener = await listen('native_audio_spectrum', (event) => {
        const payload = event.payload as NativeAudioSpectrumPayload;
        applyNativeAudioSpectrumPayload(this, payload);
      });

      this.errorListener = await listen('native_audio_error', (event) => {
        const payload = event.payload as NativeAudioErrorPayload;
        const seq = typeof payload?.seq === 'number' ? payload.seq : 0;
        if (seq > 0 && seq <= this.lastNativeErrorSeq) return;
        if (seq > 0) this.lastNativeErrorSeq = seq;

        const code = typeof payload?.code === 'string' && payload.code.length > 0 ? payload.code : 'NATIVE_AUDIO_ERROR';
        const message =
          typeof payload?.message === 'string' && payload.message.length > 0
            ? payload.message
            : 'Native audio error';

        const error = new Error(message) as Error & { code?: string };
        error.code = code;
        this.emitError(error);
      });
    } catch (error) {
      telemetry.warn('native_audio.register_state_listener.failed', {
        message: readErrorMessage(error),
      });
    }
  
}
