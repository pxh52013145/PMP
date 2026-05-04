import { listen } from '@tauri-apps/api/event';
import type { AudioState } from './types';
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
import {
  applyNativeAudioEngineStatePayload,
  type NativeAudioEngineState,
} from './nativeAudioEngineStatePayloadAdapter';
import {
  applyNativeAudioRuntimeMetricsPayload,
  type NativeAudioRuntimeMetricsState,
} from './nativeAudioRuntimeMetricsAdapter';
import {
  applyNativeAudioSpectrumPayload,
  type NativeAudioSpectrumPayloadState,
} from './nativeAudioSpectrumPayloadAdapter';
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

export type NativeAudioListenerHost = NativeAudioEngineState &
  NativeAudioRuntimeMetricsState &
  NativeAudioSpectrumPayloadState & {
  state: AudioState;
  stateListener: NativeAudioListenerCleanup;
  errorListener: NativeAudioListenerCleanup;
  spectrumListener: NativeAudioListenerCleanup;
  lastUnderrunEvents: number;
  lastUnderrunFrames: number;
  lastNativeErrorSeq: number;
  diagnosticTimeline: NativeAudioDiagnosticTimelineEntry[];
  fallbackClockBaseTimeSec: number;
  fallbackClockStartedAtMs: number | null;
  lastBackendTimeUpdateAtMs: number;
  timeUpdateCallbacks: Set<(time: number) => void>;
  endedCallbacks: Set<() => void>;
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

        applyNativeAudioEngineStatePayload(this, next);

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
