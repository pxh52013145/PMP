import { listen } from '@tauri-apps/api/event';
import type { AudioSpectrumFrame, AudioSpectrumTap, AudioState } from './types';
import type {
  NativeAudioErrorPayload,
  NativeAudioSpectrumPayload,
  NativeAudioStatePayload,
} from './nativeAudioServiceTypes';
import { getTelemetryLogger } from '../telemetry/TelemetryService';

const telemetry = getTelemetryLogger('audio', 'nativeAudioNativeListeners');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type NativeAudioListenerCleanup = (() => void) | null;

export type NativeAudioListenerHost = {
  [key: string]: unknown;
  state: AudioState;
  stateListener: NativeAudioListenerCleanup;
  errorListener: NativeAudioListenerCleanup;
  spectrumListener: NativeAudioListenerCleanup;
  lastUnderrunEvents: number;
  lastUnderrunFrames: number;
  lastNativeErrorSeq: number;
  lastSchedulerProfile?: 'normal' | 'guarded' | 'critical';
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
  diagnosticTimelineDroppedEvents: number;
  diagnosticTimeline: Array<{
    seq: number;
    timestampMs: number;
    kind: string;
    value: number;
    aux: number;
  }>;
  fallbackClockBaseTimeSec: number;
  fallbackClockStartedAtMs: number | null;
  lastBackendTimeUpdateAtMs: number;
  timeUpdateCallbacks: Set<(time: number) => void>;
  endedCallbacks: Set<() => void>;
  spectrumData: Uint8Array;
  spectrumFrames: Partial<Record<AudioSpectrumTap, AudioSpectrumFrame>>;
  shouldIgnoreBackendCurrentTime(nextTime: number): boolean;
  handleUnderrunSpike(...args: unknown[]): void;
  maybeReleaseUnderrunRecovery(...args: unknown[]): void;
  ensureFallbackTicker(): void;
  applyPlaybackStateSideEffects(...args: unknown[]): void;
  applySharedTimelineStressIfNeeded(...args: unknown[]): void;
  deriveTitleFromPath(path: string): string;
  emitError(...args: unknown[]): void;
  emitRobustnessSnapshot(...args: unknown[]): void;
  evaluateDynamicSrcAutoDegradation(...args: unknown[]): void;
  getEffectiveDynamicSrcTiming(...args: unknown[]): { stressScore: number };
  getTrackPath(track: AudioState['currentTrack'] | null | undefined): string | null;
  handleTrackEnded(): void;
  isSameQueuePaths(...args: unknown[]): boolean;
  normalizeTrackPathForCompare(path: string | null): string;
  recordBufferedAheadSample(...args: unknown[]): void;
  resolveQueueFromPaths(paths: string[]): AudioState['queue'];
  resolveTrackFromPath(path: string): { track: NonNullable<AudioState['currentTrack']>; index: number } | null;
  trackPlaybackStateForMetrics(...args: unknown[]): void;
  updateDynamicSrcLearningFromStress(...args: unknown[]): void;
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

        const hasCurrentTime =
          typeof next.currentTime === 'number' && Number.isFinite(next.currentTime);
        const nextCurrentTime = hasCurrentTime ? next.currentTime : null;
        const shouldApplyCurrentTime =
          typeof nextCurrentTime === 'number' &&
          !this.shouldIgnoreBackendCurrentTime(nextCurrentTime);

        const update: Partial<AudioState> = {};
        if (typeof next.playbackState !== 'undefined') update.playbackState = next.playbackState;
        if (typeof next.volume !== 'undefined') update.volume = next.volume;
        if (typeof next.muted !== 'undefined') update.muted = next.muted;
        if (shouldApplyCurrentTime && typeof nextCurrentTime === 'number') {
          update.currentTime = nextCurrentTime;
        }
        if (typeof next.duration !== 'undefined') {
          const reportedDuration =
            typeof next.duration === 'number' && Number.isFinite(next.duration) ? next.duration : 0;
          const trackDuration = this.state.currentTrack?.duration;
          const hasTrackDuration =
            typeof trackDuration === 'number' && Number.isFinite(trackDuration) && trackDuration > 0;

          if (reportedDuration > 0) {
            update.duration = reportedDuration;
          } else if (hasTrackDuration) {
            update.duration = trackDuration;
          } else {
            update.duration = reportedDuration;
          }
        } else {
          const trackDuration = this.state.currentTrack?.duration;
          const hasTrackDuration =
            typeof trackDuration === 'number' && Number.isFinite(trackDuration) && trackDuration > 0;
          if ((this.state.duration ?? 0) <= 0 && hasTrackDuration) {
            update.duration = trackDuration;
          }
        }
        if (typeof next.bufferedTime !== 'undefined') update.bufferedTime = next.bufferedTime;
        if (typeof next.bufferedAhead !== 'undefined') update.bufferedAhead = next.bufferedAhead;
        if (typeof next.decodeBufferedAhead !== 'undefined') {
          update.decodeBufferedAhead = next.decodeBufferedAhead;
        }
        if (typeof next.outputBufferedAhead !== 'undefined') {
          update.outputBufferedAhead = next.outputBufferedAhead;
        }

        if (typeof next.sampleRate === 'number' && Number.isFinite(next.sampleRate)) {
          this.outputSampleRate = Math.max(0, Math.floor(next.sampleRate));
        }
        if (
          typeof next.sourceSampleRate === 'number' &&
          Number.isFinite(next.sourceSampleRate)
        ) {
          this.sourceSampleRate = Math.max(0, Math.floor(next.sourceSampleRate));
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

        if (typeof next.outputCallbackMetricsValid === 'boolean') {
          this.outputCallbackMetricsValid = next.outputCallbackMetricsValid;
          if (!this.outputCallbackMetricsValid) {
            this.outputCallbackP99Us = 0;
            this.outputWaitTimeoutCount = 0;
            this.outputRenderUnderrunEvents = 0;
            this.outputRenderUnderrunFrames = 0;
            this.outputCallbackIntervalJitterP99Us = 0;
            this.outputCallbackIntervalOverrunCount = 0;
            this.outputCallbackExpectedIntervalUs = 0;
          }
        }

        if (
          this.outputCallbackMetricsValid &&
          typeof next.outputCallbackP99Us === 'number' &&
          Number.isFinite(next.outputCallbackP99Us)
        ) {
          this.outputCallbackP99Us = Math.max(0, Math.floor(next.outputCallbackP99Us));
        }

        if (
          this.outputCallbackMetricsValid &&
          typeof next.outputWaitTimeoutCount === 'number' &&
          Number.isFinite(next.outputWaitTimeoutCount)
        ) {
          this.outputWaitTimeoutCount = Math.max(0, Math.floor(next.outputWaitTimeoutCount));
        }

        if (
          this.outputCallbackMetricsValid &&
          typeof next.outputRenderUnderrunEvents === 'number' &&
          Number.isFinite(next.outputRenderUnderrunEvents)
        ) {
          this.outputRenderUnderrunEvents = Math.max(0, Math.floor(next.outputRenderUnderrunEvents));
        }

        if (
          this.outputCallbackMetricsValid &&
          typeof next.outputRenderUnderrunFrames === 'number' &&
          Number.isFinite(next.outputRenderUnderrunFrames)
        ) {
          this.outputRenderUnderrunFrames = Math.max(0, Math.floor(next.outputRenderUnderrunFrames));
        }

        if (
          this.outputCallbackMetricsValid &&
          typeof next.outputCallbackIntervalJitterP99Us === 'number' &&
          Number.isFinite(next.outputCallbackIntervalJitterP99Us)
        ) {
          this.outputCallbackIntervalJitterP99Us = Math.max(
            0,
            Math.floor(next.outputCallbackIntervalJitterP99Us)
          );
        }

        if (
          this.outputCallbackMetricsValid &&
          typeof next.outputCallbackIntervalOverrunCount === 'number' &&
          Number.isFinite(next.outputCallbackIntervalOverrunCount)
        ) {
          this.outputCallbackIntervalOverrunCount = Math.max(
            0,
            Math.floor(next.outputCallbackIntervalOverrunCount)
          );
        }

        if (
          this.outputCallbackMetricsValid &&
          typeof next.outputCallbackExpectedIntervalUs === 'number' &&
          Number.isFinite(next.outputCallbackExpectedIntervalUs)
        ) {
          this.outputCallbackExpectedIntervalUs = Math.max(
            0,
            Math.floor(next.outputCallbackExpectedIntervalUs)
          );
        }

        if (
          typeof next.transferLowWatermarkSamples === 'number' &&
          Number.isFinite(next.transferLowWatermarkSamples)
        ) {
          this.transferMetricsValid = true;
          this.transferLowWatermarkSamples = Math.max(0, Math.floor(next.transferLowWatermarkSamples));
        } else {
          this.transferMetricsValid = false;
          this.transferLowWatermarkSamples = 0;
          this.transferRenderLowHitCount = 0;
          this.transferDecodeLowHitCount = 0;
          this.transferAdaptationLevel = 0;
          this.transferOscillationStreak = 0;
          this.renderQueuePageLocked = false;
        }

        if (
          typeof next.transferRenderLowHitCount === 'number' &&
          Number.isFinite(next.transferRenderLowHitCount)
        ) {
          this.transferRenderLowHitCount = Math.max(0, Math.floor(next.transferRenderLowHitCount));
        }

        if (
          typeof next.transferDecodeLowHitCount === 'number' &&
          Number.isFinite(next.transferDecodeLowHitCount)
        ) {
          this.transferDecodeLowHitCount = Math.max(0, Math.floor(next.transferDecodeLowHitCount));
        }

        if (
          typeof next.transferAdaptationLevel === 'number' &&
          Number.isFinite(next.transferAdaptationLevel)
        ) {
          this.transferAdaptationLevel = Math.max(0, Math.floor(next.transferAdaptationLevel));
        }

        if (
          typeof next.transferOscillationStreak === 'number' &&
          Number.isFinite(next.transferOscillationStreak)
        ) {
          this.transferOscillationStreak = Math.max(0, Math.floor(next.transferOscillationStreak));
        }

        if (typeof next.renderQueuePageLocked === 'boolean') {
          this.renderQueuePageLocked = next.renderQueuePageLocked;
        }

        if (typeof next.sharedRenderAheadEnabled === 'boolean') {
          this.sharedRenderAheadEnabled = next.sharedRenderAheadEnabled;
          if (!this.sharedRenderAheadEnabled) {
            this.sharedRenderUnderrunEvents = 0;
            this.sharedRenderUnderrunFrames = 0;
            this.sharedRenderLowHitCount = 0;
            this.sharedRenderLowWatermarkSamples = 0;
          }
        }

        if (
          this.sharedRenderAheadEnabled &&
          typeof next.sharedRenderUnderrunEvents === 'number' &&
          Number.isFinite(next.sharedRenderUnderrunEvents)
        ) {
          this.sharedRenderUnderrunEvents = Math.max(0, Math.floor(next.sharedRenderUnderrunEvents));
        }

        if (
          this.sharedRenderAheadEnabled &&
          typeof next.sharedRenderUnderrunFrames === 'number' &&
          Number.isFinite(next.sharedRenderUnderrunFrames)
        ) {
          this.sharedRenderUnderrunFrames = Math.max(0, Math.floor(next.sharedRenderUnderrunFrames));
        }

        if (
          this.sharedRenderAheadEnabled &&
          typeof next.sharedRenderLowHitCount === 'number' &&
          Number.isFinite(next.sharedRenderLowHitCount)
        ) {
          this.sharedRenderLowHitCount = Math.max(0, Math.floor(next.sharedRenderLowHitCount));
        }

        if (
          this.sharedRenderAheadEnabled &&
          typeof next.sharedRenderLowWatermarkSamples === 'number' &&
          Number.isFinite(next.sharedRenderLowWatermarkSamples)
        ) {
          this.sharedRenderLowWatermarkSamples = Math.max(
            0,
            Math.floor(next.sharedRenderLowWatermarkSamples)
          );
        }

        if (typeof next.controlQueueLockFree === 'boolean') {
          this.controlQueueLockFree = next.controlQueueLockFree;
        }

        if (typeof next.controlQueueMode === 'string' && next.controlQueueMode.trim().length > 0) {
          this.controlQueueMode = next.controlQueueMode.trim();
        }

        if (
          typeof next.controlQueueCapacity === 'number' &&
          Number.isFinite(next.controlQueueCapacity)
        ) {
          this.controlQueueCapacity = Math.max(0, Math.floor(next.controlQueueCapacity));
        }

        if (
          typeof next.controlQueueOverwriteEvents === 'number' &&
          Number.isFinite(next.controlQueueOverwriteEvents)
        ) {
          this.controlQueueOverwriteEvents = Math.max(0, Math.floor(next.controlQueueOverwriteEvents));
        }

        if (
          typeof next.controlQueueDropNewestEvents === 'number' &&
          Number.isFinite(next.controlQueueDropNewestEvents)
        ) {
          this.controlQueueDropNewestEvents = Math.max(
            0,
            Math.floor(next.controlQueueDropNewestEvents)
          );
        }

        if (
          typeof next.controlQueueCoalescedOverflowEvents === 'number' &&
          Number.isFinite(next.controlQueueCoalescedOverflowEvents)
        ) {
          this.controlQueueCoalescedOverflowEvents = Math.max(
            0,
            Math.floor(next.controlQueueCoalescedOverflowEvents)
          );
        }

        if (
          typeof next.controlQueueCriticalOverflowEvents === 'number' &&
          Number.isFinite(next.controlQueueCriticalOverflowEvents)
        ) {
          this.controlQueueCriticalOverflowEvents = Math.max(
            0,
            Math.floor(next.controlQueueCriticalOverflowEvents)
          );
        }

        if (
          typeof next.estimatedAudioBufferBytes === 'number' &&
          Number.isFinite(next.estimatedAudioBufferBytes)
        ) {
          this.estimatedAudioBufferBytes = Math.max(0, Math.floor(next.estimatedAudioBufferBytes));
        }

        if (
          typeof next.diagnosticTimelineDroppedEvents === 'number' &&
          Number.isFinite(next.diagnosticTimelineDroppedEvents)
        ) {
          this.diagnosticTimelineDroppedEvents = Math.max(
            0,
            Math.floor(next.diagnosticTimelineDroppedEvents)
          );
        }

        if (Array.isArray(next.diagnosticTimeline)) {
          const normalized = next.diagnosticTimeline
            .map((entry) => {
              const seq =
                typeof entry?.seq === 'number' && Number.isFinite(entry.seq)
                  ? Math.max(0, Math.floor(entry.seq))
                  : null;
              const timestampMs =
                typeof entry?.timestampMs === 'number' && Number.isFinite(entry.timestampMs)
                  ? Math.max(0, Math.floor(entry.timestampMs))
                  : null;
              const kind = typeof entry?.kind === 'string' ? entry.kind.trim() : '';
              const value =
                typeof entry?.value === 'number' && Number.isFinite(entry.value)
                  ? Math.max(0, Math.floor(entry.value))
                  : 0;
              const aux =
                typeof entry?.aux === 'number' && Number.isFinite(entry.aux)
                  ? Math.max(0, Math.floor(entry.aux))
                  : 0;

              if (seq === null || timestampMs === null || !kind) {
                return null;
              }

              return {
                seq,
                timestampMs,
                kind,
                value,
                aux,
              };
            })
            .filter(
              (
                value
              ): value is {
                seq: number;
                timestampMs: number;
                kind: string;
                value: number;
                aux: number;
              } => value !== null
            );

          this.diagnosticTimeline = normalized.slice(-24);
          this.applySharedTimelineStressIfNeeded(this.diagnosticTimeline);
        }

        if (typeof next.bufferedAhead === 'number' && Number.isFinite(next.bufferedAhead)) {
          this.recordBufferedAheadSample(next.bufferedAhead);
        }

        if (Array.isArray(next.queue) && !this.isSameQueuePaths(next.queue)) {
          update.queue = this.resolveQueueFromPaths(next.queue);
        }
        if (typeof next.currentIndex === 'number') {
          update.currentIndex = next.currentIndex;
        }

        if (typeof next.trackPath !== 'undefined') {
          const currentTrackPath = this.state.currentTrack
            ? this.getTrackPath(this.state.currentTrack)
            : null;
          const normalizedCurrentTrackPath =
            this.normalizeTrackPathForCompare(currentTrackPath);
          const normalizedPlaybackState =
            typeof next.playbackState === 'string' ? next.playbackState : null;
          const queueClearedByPayload = Array.isArray(next.queue) && next.queue.length === 0;
          const indexClearedByPayload =
            typeof next.currentIndex === 'number' && next.currentIndex < 0;
          const localQueueEmpty =
            (Array.isArray(update.queue) ? update.queue.length === 0 : this.state.queue.length === 0) ||
            queueClearedByPayload;
          const playbackNotActive =
            normalizedPlaybackState !== 'playing' &&
            normalizedPlaybackState !== 'buffering' &&
            normalizedPlaybackState !== 'loading';

          if (typeof next.trackPath === 'string') {
            const nextTrackPath = next.trackPath.trim();
            if (nextTrackPath.length > 0) {
              const shouldIgnoreStaleTrackPath = localQueueEmpty && playbackNotActive;
              if (shouldIgnoreStaleTrackPath) {
                update.currentTrack = null;
                update.currentIndex = -1;
              } else {
                const normalizedNextTrackPath = this.normalizeTrackPathForCompare(nextTrackPath);
                if (normalizedNextTrackPath !== normalizedCurrentTrackPath) {
                  const resolved = this.resolveTrackFromPath(nextTrackPath);
                  if (resolved) {
                    update.currentTrack = resolved.track;
                  update.currentIndex = resolved.index;
                } else {
                  update.currentTrack = {
                    id: `native-${nextTrackPath}`,
                    title: this.deriveTitleFromPath(nextTrackPath),
                    filePath: nextTrackPath,
                    path: nextTrackPath,
                      originalPath: nextTrackPath,
                    };
                  }
                }
              }
            }
          } else if (next.trackPath === null && currentTrackPath) {
            const shouldClearCurrentTrack =
              next.ended === true ||
              normalizedPlaybackState === 'stopped' ||
              normalizedPlaybackState === 'idle' ||
              queueClearedByPayload ||
              indexClearedByPayload ||
              this.state.queue.length === 0;
            if (shouldClearCurrentTrack) {
              update.currentTrack = null;
              if (indexClearedByPayload) {
                update.currentIndex = -1;
              }
            }
          }
        }

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
        if (!payload?.bins || !Array.isArray(payload.bins)) return;
        const bins = payload.bins;

        const isByteEncodedBins = (() => {
          const probeCount = Math.min(8, bins.length);
          for (let index = 0; index < probeCount; index += 1) {
            const value = bins[index];
            if (typeof value === 'number' && Number.isFinite(value) && value > 1.001) {
              return true;
            }
          }
          return false;
        })();

        const tap =
          payload.tapId === 'pre-dsp' || payload.tap === 'pre-dsp'
            ? 'pre-dsp'
            : payload.tapId === 'post-dsp' || payload.tap === 'post-dsp'
              ? 'post-dsp'
              : null;

        const ensureBuffer = (current: Uint8Array | null | undefined): Uint8Array => {
          if (current && current.length === bins.length) return current;
          return new Uint8Array(bins.length);
        };

        const copyBinsToTarget = (target: Uint8Array) => {
          for (let i = 0; i < bins.length; i += 1) {
            const value = typeof bins[i] === 'number' && Number.isFinite(bins[i]) ? bins[i] : 0;
            if (isByteEncodedBins) {
              target[i] = Math.max(0, Math.min(255, Math.round(value)));
              continue;
            }

            const clamped = Math.max(0, Math.min(1, value));
            target[i] = Math.round(clamped * 255);
          }
        };

        if (!tap) {
          const target = ensureBuffer(this.spectrumData);
          copyBinsToTarget(target);
          this.spectrumData = target;
          return;
        }

        const frameId =
          typeof payload.frameId === 'number' && Number.isFinite(payload.frameId)
            ? payload.frameId
            : 0;
        const timestampMs =
          typeof payload.timestampMs === 'number' && Number.isFinite(payload.timestampMs)
            ? payload.timestampMs
            : Date.now();
        const sampleRate =
          typeof payload.sampleRate === 'number' && Number.isFinite(payload.sampleRate)
            ? payload.sampleRate
            : this.outputSampleRate || this.sourceSampleRate || 0;

        const existingBins = this.spectrumFrames[tap]?.bins;
        const target = ensureBuffer(existingBins);
        copyBinsToTarget(target);

        this.spectrumFrames[tap] = {
          frameId,
          timestampMs,
          tap,
          sampleRate,
          bins: target,
        };

        // Default frequency data drives most visualizers: prefer post-dsp when available.
        if (tap === 'post-dsp' || !this.spectrumData) {
          this.spectrumData = target;
        }
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
