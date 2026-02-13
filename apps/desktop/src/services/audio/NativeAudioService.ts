import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  AudioDynamicSrcAdaptiveProfile,
  AudioDynamicSrcAutoSettingsPatch,
  AudioDynamicSrcAutoSettings,
  AudioEnginePolicyPatch,
  AudioProtectionWindowOptions,
  AudioRobustnessSnapshot,
  AudioSpectrumFrame,
  AudioSpectrumTap,
  AudioState,
  IAudioService,
  PlayMode,
  Playlist,
  Track,
  PlaybackState,
} from './types';
import {
  broadcastDataUpdate,
  setupDualListener,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../utils/windowCommunication';
import { readString } from '../../modules/storage';

type StateListener = (state: AudioState) => void;

type NativeAudioStatePayload = {
  playbackState?: PlaybackState;
  volume?: number;
  muted?: boolean;
  trackPath?: string | null;
  currentTime?: number;
  duration?: number;
  bufferedTime?: number;
  bufferedAhead?: number;
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
  renderQueuePageLocked?: boolean;
  sharedRenderAheadEnabled?: boolean;
  sharedRenderUnderrunEvents?: number;
  sharedRenderUnderrunFrames?: number;
  sharedRenderLowHitCount?: number;
  sharedRenderLowWatermarkSamples?: number;
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

type NativeAudioEnginePolicyPayload = {
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

type NativeAudioEnginePolicyPatch = AudioEnginePolicyPatch;

type NativeAudioSrcPolicy = {
  srcMode: 'source-native' | 'match-output' | 'target-rate';
  srcBackend: 'rubato' | 'linear-simd';
  srcTargetSampleRate: number | null;
};

type NativeAudioSpectrumPayload = {
  bins: number[];
  frameId?: number;
  timestampMs?: number;
  tap?: 'pre-dsp' | 'post-dsp';
  tapId?: 'pre-dsp' | 'post-dsp';
  sampleRate?: number;
};

type NativeAudioErrorPayload = {
  seq?: number;
  code?: string;
  message?: string;
};

type NativeAudioComponentsStatePayload = {
  outputBackendId?: string | null;
  preferredInputId?: string | null;
  activeInputId?: string | null;
};

type ReplayGainMode = 'track' | 'album';

type ReplayGainSettings = {
  enabled: boolean;
  mode: ReplayGainMode;
  preampDb: number;
};

type CrossfadeSettings = {
  enabled: boolean;
  durationMs: number;
};

type StreamingBufferSettings = {
  startOrSeekSeconds: number | null;
  crossfadeSeconds: number | null;
  decodeMode: 'streaming' | 'full-track';
};

type DynamicSrcLearningRecord = {
  stressIndex: number;
  updatedAtMs: number;
};

type DynamicSrcLearningMap = Record<string, DynamicSrcLearningRecord>;

type RobustnessListener = (snapshot: AudioRobustnessSnapshot) => void;

/**
 * NativeAudioService
 *
 * Skeleton implementation that mirrors the Web audio interface while delegating
 * transport commands to the Tauri backend. Real decoding / playback will be
 * implemented step-by-step; for now we optimistically update state to keep the
 * UI responsive.
 */
export class NativeAudioService implements IAudioService {
  private state: AudioState;
  private timeUpdateCallbacks: Set<(time: number) => void> = new Set();
  private endedCallbacks: Set<() => void> = new Set();
  private stateChangeCallbacks: Set<StateListener> = new Set();
  private loadProgressCallbacks: Set<(progress: number) => void> = new Set();
  private errorCallbacks: Set<(error: Error) => void> = new Set();
  private robustnessCallbacks: Set<RobustnessListener> = new Set();
  private stateListener?: UnlistenFn;
  private spectrumListener?: UnlistenFn;
  private errorListener?: UnlistenFn;
  private dynamicSrcSettingsListenerCleanup: (() => void) | null = null;
  private dynamicSrcSettingsListenerInitPromise: Promise<void> | null = null;
  private spectrumData: Uint8Array | null = null;
  private spectrumFrames: Partial<Record<AudioSpectrumTap, AudioSpectrumFrame>> = {};
  private restoredOutputBackend = false;
  private restoredOutputDevice = false;
  private restoredInputId = false;
  private restoredStreamingBufferSettings = false;
  private restoredVstEnabled = false;
  private restoredDspGraph = false;
  private restoredDspChain = false;
  private restoredDspChainApplied = false;
  private restoredGainDb = false;
  private visibilityListenerAttached = false;
  private visibilityListenerCleanup: (() => void) | null = null;
  private lastNativeErrorSeq = 0;
  private fallbackTicker: number | null = null;
  private fallbackClockStartedAtMs: number | null = null;
  private fallbackClockBaseTimeSec: number = 0;
  private lastBackendTimeUpdateAtMs: number = 0;
  private lastUnderrunEvents: number = 0;
  private lastUnderrunFrames: number = 0;
  private underrunRecoveryUntilMs: number = 0;
  private underrunSpikeTimestampsMs: number[] = [];
  private pendingSeekTime: number | null = null;
  private pendingSeekTimer: number | null = null;
  private pendingSeekTarget: number | null = null;
  private pendingSeekDirection: 'forward' | 'backward' | null = null;
  private pendingSeekSettleUntilMs = 0;
  private seekInvokeInFlight = false;
  private desiredPlayIndex: number | null = null;
  private playIndexQueue: Promise<void> = Promise.resolve();
  private bufferedAheadRollingWindow: number[] = [];
  private bufferedAheadRollingSum: number = 0;
  private bufferedAheadMinSeconds: number | null = null;
  private rebufferCount = 0;
  private lastPlaybackStateForMetrics: PlaybackState = 'idle';
  private storedStreamingBufferSettings: StreamingBufferSettings = {
    startOrSeekSeconds: null,
    crossfadeSeconds: null,
    decodeMode: 'streaming',
  };
  private lastAppliedStreamingBufferSettings: StreamingBufferSettings | null = null;
  private protectionWindowRefCount = 0;
  private protectionWindowReason: string | null = null;
  private protectionWindowUntilMs = 0;
  private protectionWindowTimer: ReturnType<typeof setTimeout> | null = null;
  private availableOutputBackends: string[] = [];
  private currentOutputBackendId: string | null = null;
  private backendSwitchInFlight = false;
  private autoBackendSwitchCount = 0;
  private lastAutoBackendSwitchAtMs: number | null = null;
  private lastAutoBackendSwitchReason: string | null = null;
  private lastEmittedRobustnessSignature: string | null = null;
  private robustnessEmissionInProgress = false;
  private robustnessEmissionPendingForce = false;
  private lastSchedulerProfile: 'normal' | 'guarded' | 'critical' = 'normal';
  private transportMode: 'robust' | 'transport-exact' = 'robust';
  private hqSrcPhaseMode: 'linear' | 'minimum' | 'intermediate' = 'linear';
  private srcMode: 'source-native' | 'match-output' | 'target-rate' = 'match-output';
  private srcBackend: 'rubato' | 'linear-simd' = 'rubato';
  private srcTargetSampleRate: number | null = null;
  private outputQuantizationMode: 'round' | 'tpdf' = 'round';
  private dynamicSrcAutoEnabled = true;
  private dynamicSrcProfile: 'quality' | 'latency' = 'quality';
  private dynamicSrcLastSwitchAtMs: number | null = null;
  private dynamicSrcLastSwitchReason: string | null = null;
  private dynamicSrcHoldUntilMs = 0;
  private dynamicSrcRestoreTimer: ReturnType<typeof setTimeout> | null = null;
  private dynamicSrcLastApplyAtMs: number | null = null;
  private dynamicSrcManualLockActive = false;
  private dynamicSrcQualityPolicy: NativeAudioSrcPolicy = {
    srcMode: 'match-output',
    srcBackend: 'rubato',
    srcTargetSampleRate: null,
  };
  private hqSrcStopbandDb: number = 140;
  private hqSrcActive = false;
  private hqSrcRatio = 1;
  private sourceSampleRate = 0;
  private outputSampleRate = 0;
  private transportExactInt32Container = true;
  private outputCallbackMetricsValid = false;
  private outputCallbackP99Us = 0;
  private outputWaitTimeoutCount = 0;
  private outputRenderUnderrunEvents = 0;
  private outputRenderUnderrunFrames = 0;
  private outputCallbackIntervalJitterP99Us = 0;
  private outputCallbackIntervalOverrunCount = 0;
  private outputCallbackExpectedIntervalUs = 0;
  private transferLowWatermarkSamples = 0;
  private transferRenderLowHitCount = 0;
  private transferDecodeLowHitCount = 0;
  private renderQueuePageLocked = false;
  private transferMetricsValid = false;
  private sharedRenderAheadEnabled = false;
  private sharedRenderUnderrunEvents = 0;
  private sharedRenderUnderrunFrames = 0;
  private sharedRenderLowHitCount = 0;
  private sharedRenderLowWatermarkSamples = 0;
  private diagnosticTimelineDroppedEvents = 0;
  private diagnosticTimeline: Array<{
    seq: number;
    timestampMs: number;
    kind: string;
    value: number;
    aux: number;
  }> = [];
  private diagnosticTimelineLastSeq = 0;
  private sharedStressUntilMs = 0;
  private sharedStressReason: string | null = null;
  private sharedStressEscalationCount = 0;

  private static readonly SEEK_COALESCE_MS = 24;
  private static readonly SEEK_STALE_GUARD_WINDOW_MS = 1_500;
  private static readonly SEEK_STALE_GUARD_TOLERANCE_SECONDS = 0.45;
  private static readonly UNDERRUN_RECOVERY_WINDOW_MS = 20_000;
  private static readonly AUTO_BACKEND_UNDERRUN_WINDOW_MS = 15_000;
  private static readonly AUTO_BACKEND_UNDERRUN_TRIGGER_COUNT = 3;
  private static readonly AUTO_BACKEND_UNDERRUN_FRAME_SPIKE_TRIGGER = 1024;
  private static readonly AUTO_BACKEND_SWITCH_COOLDOWN_MS = 45_000;
  private static readonly PROTECTION_WINDOW_DEFAULT_MS = 20_000;
  private static readonly PROTECTION_WINDOW_MAX_MS = 120_000;
  private static readonly ROBUSTNESS_BUFFER_WINDOW_SIZE = 48;
  private static readonly SHARED_TIMELINE_STRESS_WINDOW_MS = 12_000;
  private static readonly SHARED_TIMELINE_LOW_WATERMARK_TRIGGER = 4;
  private static readonly SHARED_TIMELINE_UNDERRUN_TRIGGER = 1;
  private static readonly DYNAMIC_SRC_RESTORE_DEBOUNCE_MS = 4_000;
  private static readonly DYNAMIC_SRC_MIN_SWITCH_INTERVAL_MS = 600;
  private static readonly DYNAMIC_SRC_SEEK_HOLD_MS = 2_000;
  private static readonly DYNAMIC_SRC_UNDERRUN_HOLD_MS = 12_000;
  private static readonly DYNAMIC_SRC_SHARED_STRESS_HOLD_MS = 8_000;
  private static readonly DYNAMIC_SRC_OUTPUT_ERROR_HOLD_MS = 10_000;
  private static readonly DYNAMIC_SRC_LEARNING_MAX_ITEMS = 64;
  private static readonly DYNAMIC_SRC_LEARNING_PERSIST_MIN_INTERVAL_MS = 2_000;
  private static readonly DYNAMIC_SRC_LEARNING_MIN_DELTA = 0.0005;
  private static readonly DYNAMIC_SRC_LEARNING_UPDATE_MIN_INTERVAL_MS = 250;
  private static readonly DYNAMIC_SRC_ADAPTIVE_SCORE_ELEVATED = 4;
  private static readonly DYNAMIC_SRC_ADAPTIVE_SCORE_CRITICAL = 8;

  private dynamicSrcRestoreDebounceMs = NativeAudioService.DYNAMIC_SRC_RESTORE_DEBOUNCE_MS;
  private dynamicSrcMinSwitchIntervalMs = NativeAudioService.DYNAMIC_SRC_MIN_SWITCH_INTERVAL_MS;
  private dynamicSrcSeekHoldMs = NativeAudioService.DYNAMIC_SRC_SEEK_HOLD_MS;
  private dynamicSrcUnderrunHoldMs = NativeAudioService.DYNAMIC_SRC_UNDERRUN_HOLD_MS;
  private dynamicSrcSharedStressHoldMs = NativeAudioService.DYNAMIC_SRC_SHARED_STRESS_HOLD_MS;
  private dynamicSrcOutputErrorHoldMs = NativeAudioService.DYNAMIC_SRC_OUTPUT_ERROR_HOLD_MS;
  private dynamicSrcAdaptiveEnabled = true;
  private dynamicSrcAdaptiveProfile: AudioDynamicSrcAdaptiveProfile = 'baseline';
  private dynamicSrcLearningEnabled = true;
  private dynamicSrcLearningProfile: DynamicSrcLearningMap = {};
  private dynamicSrcLearningPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private dynamicSrcLearningLastPersistAtMs = 0;
  private dynamicSrcLearningLastPersistedSignature: string | null = null;
  private dynamicSrcLearningLastUpdateAtMs = 0;

  private fireAndForgetCommand(cmd: string, payload?: Record<string, unknown>): void {
    void this.invokeCommand(cmd, payload).catch(() => {});
  }

  private isSharedOutputBackend(backendId: string | null | undefined): backendId is string {
    return (
      backendId === 'wasapi' ||
      backendId === 'wasapi-shared-raw' ||
      backendId === 'rodio-cpal'
    );
  }

  private clearPendingSeek(): void {
    this.pendingSeekTime = null;
    if (this.pendingSeekTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.pendingSeekTimer);
    }
    this.pendingSeekTimer = null;
    this.clearPendingSeekGuard();
  }

  private markPendingSeekGuard(target: number): void {
    if (!isFinite(target)) return;
    this.pendingSeekDirection = target >= this.state.currentTime ? 'forward' : 'backward';
    this.pendingSeekTarget = target;
    this.pendingSeekSettleUntilMs = Date.now() + NativeAudioService.SEEK_STALE_GUARD_WINDOW_MS;
  }

  private clearPendingSeekGuard(): void {
    this.pendingSeekTarget = null;
    this.pendingSeekDirection = null;
    this.pendingSeekSettleUntilMs = 0;
  }

  private shouldIgnoreBackendCurrentTime(nextTime: number): boolean {
    if (!isFinite(nextTime)) return false;
    if (typeof this.pendingSeekTarget !== 'number') return false;

    const target = this.pendingSeekTarget;
    const tolerance = NativeAudioService.SEEK_STALE_GUARD_TOLERANCE_SECONDS;
    const direction = this.pendingSeekDirection;
    const waitingForSeekCommit =
      this.seekInvokeInFlight || typeof this.pendingSeekTime === 'number';

    if (Math.abs(nextTime - target) <= tolerance) {
      this.clearPendingSeekGuard();
      return false;
    }

    if (direction === 'forward' && nextTime > target + tolerance) {
      this.clearPendingSeekGuard();
      return false;
    }

    if (direction === 'backward' && nextTime < target - tolerance) {
      this.clearPendingSeekGuard();
      return false;
    }

    if (waitingForSeekCommit) {
      return true;
    }

    if (Date.now() <= this.pendingSeekSettleUntilMs) {
      if (direction === 'forward') {
        return nextTime < target - tolerance;
      }
      if (direction === 'backward') {
        return nextTime > target + tolerance;
      }
    }

    this.clearPendingSeekGuard();
    return false;
  }

  private flushPendingSeekCommand(): void {
    if (this.seekInvokeInFlight) return;

    const target = this.pendingSeekTime;
    this.pendingSeekTime = null;
    if (typeof target !== 'number' || !isFinite(target)) return;

    this.seekInvokeInFlight = true;
    void this.invokeCommand('native_audio_seek', { time: target })
      .catch(() => {
        // invokeCommand already emits structured error.
      })
      .finally(() => {
        this.seekInvokeInFlight = false;
        if (typeof this.pendingSeekTime !== 'number') return;

        if (typeof window !== 'undefined') {
          if (this.pendingSeekTimer !== null) {
            window.clearTimeout(this.pendingSeekTimer);
          }
          this.pendingSeekTimer = window.setTimeout(() => {
            this.pendingSeekTimer = null;
            this.flushPendingSeekCommand();
          }, 0);
          return;
        }

        this.flushPendingSeekCommand();
      });
  }

  private scheduleSeekFlush(): void {
    if (this.pendingSeekTimer !== null) return;
    const scheduled =
      typeof window !== 'undefined'
        ? window.setTimeout(() => {
            this.pendingSeekTimer = null;
            this.flushPendingSeekCommand();
          }, NativeAudioService.SEEK_COALESCE_MS)
        : null;

    // Non-browser (tests) fallback: flush immediately.
    if (scheduled === null) {
      this.flushPendingSeekCommand();
      return;
    }

    this.pendingSeekTimer = scheduled;
  }

  private isProbablyAbsolutePath(value: string): boolean {
    if (!value) return false;
    if (/^[a-zA-Z]:[\\/]/.test(value)) return true; // Windows drive
    if (value.startsWith('\\\\')) return true; // UNC path
    if (value.startsWith('/')) return true; // unix
    return false;
  }

  constructor() {
    this.state = {
      currentTrack: null,
      playbackState: 'idle',
      currentTime: 0,
      duration: 0,
      bufferedTime: 0,
      bufferedAhead: 0,
      volume: 0.7,
      muted: false,
      playMode: 'sequence',
      queue: [],
      currentIndex: -1,
      playlists: [],
      currentPlaylist: null,
    };

    this.setupNativeListeners();
    void this.refreshOutputBackendInventory().finally(() => {
      this.emitRobustnessSnapshot(true);
    });
    void this.restoreFromStorage().catch(() => {});
  }

  private async restoreFromStorage(): Promise<void> {
    await this.restoreOutputBackendFromStorage();
    await this.restoreOutputDeviceFromStorage();
    await this.restoreAudioInputFromStorage();
    await this.restoreStreamingBufferSettingsFromStorage();
    await this.restoreDynamicSrcAutoSettingsFromStorage();
    await this.restoreVstEnabledFromStorage();

    const restoredGraph = await this.restoreDspGraphFromBackend();
    if (!restoredGraph) {
      await this.restoreDspChainFromStorage();
    }

    await this.restoreGainDbFromStorage();
  }

  private readStreamingBufferSettings(): StreamingBufferSettings {
    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS);
      if (!raw) return { startOrSeekSeconds: null, crossfadeSeconds: null, decodeMode: 'streaming' };
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return { startOrSeekSeconds: null, crossfadeSeconds: null, decodeMode: 'streaming' };
      }
      const record = parsed as Record<string, unknown>;

      const startRaw = record.startOrSeekSeconds;
      const crossfadeRaw = record.crossfadeSeconds;
      const decodeModeRaw = record.decodeMode;

      const start =
        startRaw === null
          ? null
          : typeof startRaw === 'number' && isFinite(startRaw)
            ? Math.max(0, Math.min(4, startRaw))
            : null;
      const crossfade =
        crossfadeRaw === null
          ? null
          : typeof crossfadeRaw === 'number' && isFinite(crossfadeRaw)
            ? Math.max(0, Math.min(3, crossfadeRaw))
            : null;

      const decodeMode =
        decodeModeRaw === 'full-track' || decodeModeRaw === 'streaming'
          ? decodeModeRaw
          : 'streaming';

      return { startOrSeekSeconds: start, crossfadeSeconds: crossfade, decodeMode };
    } catch {
      return { startOrSeekSeconds: null, crossfadeSeconds: null, decodeMode: 'streaming' };
    }
  }

  private async restoreStreamingBufferSettingsFromStorage(): Promise<void> {
    if (this.restoredStreamingBufferSettings) return;
    this.restoredStreamingBufferSettings = true;

    try {
      const settings = this.readStreamingBufferSettings();
      this.storedStreamingBufferSettings = settings;
      this.attachVisibilityAwareStreamingBufferPolicy();
      this.applyStreamingBufferPolicy();
    } catch {
      // ignore
    }
  }

  private attachVisibilityAwareStreamingBufferPolicy(): void {
    if (this.visibilityListenerAttached) return;
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    this.visibilityListenerAttached = true;

    const sync = () => {
      this.applyStreamingBufferPolicy();
    };

    document.addEventListener('visibilitychange', sync);
    this.visibilityListenerCleanup = () => {
      document.removeEventListener('visibilitychange', sync);
    };
    sync();
  }

  private async restoreVstEnabledFromStorage(): Promise<void> {
    if (this.restoredVstEnabled) return;
    this.restoredVstEnabled = true;

    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_VST_ENABLED);
      const enabled = raw ? (JSON.parse(raw) as unknown) : false;
      const resolved = typeof enabled === 'boolean' ? enabled : false;
      await invoke('native_audio_vst_set_enabled', { enabled: resolved }).catch(() => {});
    } catch {
      // ignore
    }
  }

  private async restoreDspGraphFromBackend(): Promise<boolean> {
    if (this.restoredDspGraph) return false;
    this.restoredDspGraph = true;

    try {
      const graph = await invoke<unknown>('native_audio_get_dsp_graph').catch(() => null);
      if (!graph || typeof graph !== 'object') return false;
      const record = graph as Record<string, unknown>;
      const nodes = record.nodes;
      if (!Array.isArray(nodes) || nodes.length === 0) return false;

      await invoke('native_audio_set_dsp_graph', { graph: record });
      this.restoredDspChainApplied = true;
      return true;
    } catch {
      return false;
    }
  }

  private readCrossfadeSettings(): CrossfadeSettings {
    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS);
      if (!raw) {
        return { enabled: false, durationMs: 1200 };
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return { enabled: false, durationMs: 1200 };
      }
      const record = parsed as Record<string, unknown>;

      const enabled = typeof record.enabled === 'boolean' ? record.enabled : false;
      const durationMs = typeof record.durationMs === 'number' ? record.durationMs : 1200;

      return {
        enabled,
        durationMs: isFinite(durationMs) ? Math.max(0, Math.min(30_000, durationMs)) : 0,
      };
    } catch {
      return { enabled: false, durationMs: 1200 };
    }
  }

  private readReplayGainSettings(): ReplayGainSettings {
    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS);
      if (!raw) {
        return { enabled: true, mode: 'track', preampDb: 0 };
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return { enabled: true, mode: 'track', preampDb: 0 };
      }
      const record = parsed as Record<string, unknown>;

      const enabled = typeof record.enabled === 'boolean' ? record.enabled : true;
      const modeRaw = typeof record.mode === 'string' ? record.mode : 'track';
      const mode: ReplayGainMode = modeRaw === 'album' ? 'album' : 'track';
      const preampDb = typeof record.preampDb === 'number' ? record.preampDb : 0;

      return { enabled, mode, preampDb };
    } catch {
      return { enabled: true, mode: 'track', preampDb: 0 };
    }
  }

  private async applyReplayGainForTrack(track: Track): Promise<void> {
    const settings = this.readReplayGainSettings();
    if (!settings.enabled) {
      await this.invokeCommand('native_audio_set_replay_gain', { db: null });
      return;
    }

    const base =
      settings.mode === 'album' ? track.replayGainAlbumGainDb : track.replayGainTrackGainDb;
    if (typeof base !== 'number' || !isFinite(base)) {
      await this.invokeCommand('native_audio_set_replay_gain', { db: null });
      return;
    }

    const effective = base + (typeof settings.preampDb === 'number' ? settings.preampDb : 0);
    const clamped = Math.max(-30, Math.min(30, effective));
    await this.invokeCommand('native_audio_set_replay_gain', { db: clamped });
  }

  private sanitizeBackendId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private parseComponentsStatePayload(payload: unknown): NativeAudioComponentsStatePayload {
    if (!payload || typeof payload !== 'object') {
      return { outputBackendId: null, preferredInputId: null, activeInputId: null };
    }

    const record = payload as Record<string, unknown>;
    return {
      outputBackendId: this.sanitizeBackendId(record.outputBackendId),
      preferredInputId: this.sanitizeBackendId(record.preferredInputId),
      activeInputId: this.sanitizeBackendId(record.activeInputId),
    };
  }

  private normalizeOutputBackends(payload: unknown): string[] {
    if (!Array.isArray(payload)) return [];
    const unique = new Set<string>();
    for (const candidate of payload) {
      const backendId = this.sanitizeBackendId(candidate);
      if (!backendId) continue;
      unique.add(backendId);
    }
    return Array.from(unique);
  }

  private async refreshOutputBackendInventory(): Promise<void> {
    try {
      const backendsPayload = await invoke<unknown>('native_audio_list_output_backends');
      const backends = this.normalizeOutputBackends(backendsPayload);
      if (backends.length > 0) {
        this.availableOutputBackends = backends;
      }
    } catch {
      // best-effort
    }

    try {
      const componentsPayload = await invoke<unknown>('native_audio_get_audio_components_state');
      const components = this.parseComponentsStatePayload(componentsPayload);
      const backendId = this.sanitizeBackendId(components.outputBackendId);
      if (backendId) {
        this.currentOutputBackendId = backendId;
        if (!this.availableOutputBackends.includes(backendId)) {
          this.availableOutputBackends = [...this.availableOutputBackends, backendId];
        }
      }
    } catch {
      // best-effort
    }

    try {
      const policyPayload = await invoke<unknown>('native_audio_get_engine_policy');
      this.applyEnginePolicyPayload(policyPayload);
      if (this.dynamicSrcProfile !== 'latency') {
        this.captureCurrentQualitySrcPolicy();
      }
    } catch {
      // best-effort
    }
  }

  private normalizeSrcPolicyFromPatch(
    patch: NativeAudioEnginePolicyPatch,
    fallback?: NativeAudioSrcPolicy
  ): NativeAudioSrcPolicy {
    const baseline: NativeAudioSrcPolicy = fallback ?? {
      srcMode: this.srcMode,
      srcBackend: this.srcBackend,
      srcTargetSampleRate: this.srcTargetSampleRate,
    };

    const normalized: NativeAudioSrcPolicy = {
      srcMode: baseline.srcMode,
      srcBackend: baseline.srcBackend,
      srcTargetSampleRate: baseline.srcTargetSampleRate,
    };

    if (
      patch.srcMode === 'source-native' ||
      patch.srcMode === 'match-output' ||
      patch.srcMode === 'target-rate'
    ) {
      normalized.srcMode = patch.srcMode;
    }

    if (patch.srcBackend === 'rubato' || patch.srcBackend === 'linear-simd') {
      normalized.srcBackend = patch.srcBackend;
    }

    if (
      typeof patch.srcTargetSampleRate === 'number' &&
      Number.isFinite(patch.srcTargetSampleRate) &&
      patch.srcTargetSampleRate > 0
    ) {
      normalized.srcTargetSampleRate = Math.max(
        8000,
        Math.min(768000, Math.floor(patch.srcTargetSampleRate))
      );
    } else if (patch.srcTargetSampleRate === null) {
      normalized.srcTargetSampleRate = null;
    }

    if (normalized.srcMode !== 'target-rate') {
      normalized.srcTargetSampleRate = null;
    }

    return normalized;
  }

  private captureCurrentQualitySrcPolicy(): void {
    this.dynamicSrcQualityPolicy = {
      srcMode: this.srcMode,
      srcBackend: this.srcBackend,
      srcTargetSampleRate: this.srcMode === 'target-rate' ? this.srcTargetSampleRate : null,
    };
  }

  private getLatencySrcPolicy(): NativeAudioSrcPolicy {
    return {
      srcMode: 'match-output',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: null,
    };
  }

  private getDynamicSrcStressScore(nowMs: number = Date.now()): number {
    let score = 0;

    if (this.state.playbackState === 'buffering') {
      score += 3;
    } else if (this.state.playbackState === 'loading') {
      score += 2;
    }

    if (this.underrunRecoveryUntilMs > nowMs) {
      score += 4;
    }

    if (this.hasActiveProtectionWindow(nowMs)) {
      score += 3;
    }

    if (this.hasActiveSharedStressWindow(nowMs)) {
      score += 4;
    }

    if (this.outputCallbackMetricsValid) {
      if (this.outputWaitTimeoutCount > 0) {
        score += Math.min(3, this.outputWaitTimeoutCount);
      }
      if (this.outputRenderUnderrunEvents > 0) {
        score += Math.min(3, this.outputRenderUnderrunEvents);
      }
      if (this.outputCallbackIntervalOverrunCount > 0) {
        score += Math.min(2, this.outputCallbackIntervalOverrunCount);
      }
      if (this.outputCallbackIntervalJitterP99Us >= 2500) {
        score += 1;
      }
    }

    if (this.transferMetricsValid) {
      if (this.transferRenderLowHitCount > 0) {
        score += 1;
      }
      if (this.transferDecodeLowHitCount > 0) {
        score += 1;
      }
      if (this.renderQueuePageLocked) {
        score += 1;
      }
    }

    if (this.sharedRenderAheadEnabled) {
      if (this.sharedRenderUnderrunEvents > 0) {
        score += Math.min(3, this.sharedRenderUnderrunEvents);
      }
      if (this.sharedRenderLowHitCount > 0) {
        score += 1;
      }
    }

    return Math.max(0, Math.floor(score));
  }

  private buildDynamicSrcLearningDeviceKey(): string {
    const backend = this.currentOutputBackendId ?? 'unknown-backend';
    const persistedOutputDevice = (() => {
      try {
        const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_DEVICE);
        if (!raw) return '';
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object') {
          const record = parsed as Record<string, unknown>;
          if (typeof record.id === 'string' && record.id.trim().length > 0) {
            return record.id.trim();
          }
          if (typeof record.name === 'string' && record.name.trim().length > 0) {
            return record.name.trim();
          }
        }
        if (typeof parsed === 'string' && parsed.trim().length > 0) {
          return parsed.trim();
        }
      } catch {
        // ignore
      }
      return '';
    })();

    return `${backend}::${persistedOutputDevice || 'default-device'}`;
  }

  private parseDynamicSrcLearningProfile(raw: string | null): DynamicSrcLearningMap {
    if (!raw) return {};

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return {};

      const input = parsed as Record<string, unknown>;
      const entries: Array<[string, DynamicSrcLearningRecord]> = [];
      for (const [key, value] of Object.entries(input)) {
        if (typeof key !== 'string' || key.trim().length === 0) continue;
        if (!value || typeof value !== 'object') continue;

        const record = value as Record<string, unknown>;
        const stressIndexRaw = record.stressIndex;
        const updatedAtRaw = record.updatedAtMs;
        if (typeof stressIndexRaw !== 'number' || !Number.isFinite(stressIndexRaw)) continue;
        const normalizedStress = Math.max(0, Math.min(12, stressIndexRaw));
        const updatedAtMs =
          typeof updatedAtRaw === 'number' && Number.isFinite(updatedAtRaw)
            ? Math.max(0, Math.floor(updatedAtRaw))
            : 0;

        entries.push([
          key,
          {
            stressIndex: normalizedStress,
            updatedAtMs,
          },
        ]);
      }

      entries.sort((a, b) => (b[1].updatedAtMs || 0) - (a[1].updatedAtMs || 0));
      return Object.fromEntries(entries.slice(0, NativeAudioService.DYNAMIC_SRC_LEARNING_MAX_ITEMS));
    } catch {
      return {};
    }
  }

  private clearDynamicSrcLearningPersistTimer(): void {
    if (this.dynamicSrcLearningPersistTimer === null) return;
    clearTimeout(this.dynamicSrcLearningPersistTimer);
    this.dynamicSrcLearningPersistTimer = null;
  }

  private normalizeDynamicSrcLearningProfileForPersistence(): DynamicSrcLearningMap {
    const trimmedEntries = Object.entries(this.dynamicSrcLearningProfile)
      .sort((a, b) => (b[1].updatedAtMs || 0) - (a[1].updatedAtMs || 0))
      .slice(0, NativeAudioService.DYNAMIC_SRC_LEARNING_MAX_ITEMS);
    this.dynamicSrcLearningProfile = Object.fromEntries(trimmedEntries);
    return this.dynamicSrcLearningProfile;
  }

  private persistDynamicSrcLearningProfile(nowMs: number = Date.now()): void {
    if (!this.dynamicSrcLearningEnabled) return;

    const normalizedProfile = this.normalizeDynamicSrcLearningProfileForPersistence();
    const signature = JSON.stringify(normalizedProfile);
    if (signature === this.dynamicSrcLearningLastPersistedSignature) {
      this.dynamicSrcLearningLastPersistAtMs = nowMs;
      return;
    }

    this.dynamicSrcLearningLastPersistAtMs = nowMs;
    this.dynamicSrcLearningLastPersistedSignature = signature;

    void broadcastDataUpdate(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE, normalizedProfile).catch(
      () => {}
    );
  }

  private scheduleDynamicSrcLearningPersist(nowMs: number = Date.now()): void {
    if (!this.dynamicSrcLearningEnabled) return;

    const minIntervalMs = NativeAudioService.DYNAMIC_SRC_LEARNING_PERSIST_MIN_INTERVAL_MS;
    const elapsedMs = nowMs - this.dynamicSrcLearningLastPersistAtMs;
    if (elapsedMs >= minIntervalMs) {
      this.clearDynamicSrcLearningPersistTimer();
      this.persistDynamicSrcLearningProfile(nowMs);
      return;
    }

    if (this.dynamicSrcLearningPersistTimer !== null) return;

    const delayMs = Math.max(0, minIntervalMs - elapsedMs);
    this.dynamicSrcLearningPersistTimer = setTimeout(() => {
      this.dynamicSrcLearningPersistTimer = null;
      this.persistDynamicSrcLearningProfile(Date.now());
    }, delayMs);
  }

  private updateDynamicSrcLearningFromStress(stressScore: number, nowMs: number = Date.now()): void {
    if (!this.dynamicSrcLearningEnabled) return;
    if (!Number.isFinite(stressScore)) return;

    if (
      this.dynamicSrcLearningLastUpdateAtMs > 0 &&
      nowMs - this.dynamicSrcLearningLastUpdateAtMs <
        NativeAudioService.DYNAMIC_SRC_LEARNING_UPDATE_MIN_INTERVAL_MS
    ) {
      return;
    }
    this.dynamicSrcLearningLastUpdateAtMs = nowMs;

    const deviceKey = this.buildDynamicSrcLearningDeviceKey();
    const previous = this.dynamicSrcLearningProfile[deviceKey]?.stressIndex ?? 0;
    const normalizedStress = Math.max(0, Math.min(12, stressScore));
    const blended = previous * 0.9 + normalizedStress * 0.1;
    const nextStressIndex = Math.max(0, Math.min(12, blended));
    if (Math.abs(nextStressIndex - previous) < NativeAudioService.DYNAMIC_SRC_LEARNING_MIN_DELTA) {
      return;
    }

    this.dynamicSrcLearningProfile[deviceKey] = {
      stressIndex: nextStressIndex,
      updatedAtMs: nowMs,
    };

    this.scheduleDynamicSrcLearningPersist(nowMs);
  }

  private getDynamicSrcLearningScale(): number {
    if (!this.dynamicSrcLearningEnabled) return 1;

    const deviceKey = this.buildDynamicSrcLearningDeviceKey();
    const stressIndex = this.dynamicSrcLearningProfile[deviceKey]?.stressIndex ?? 0;
    if (stressIndex <= 0) return 1;

    return 1 + Math.min(0.5, stressIndex / 30);
  }

  private resolveDynamicSrcAdaptiveProfile(
    nowMs: number = Date.now()
  ): AudioDynamicSrcAdaptiveProfile {
    if (!this.dynamicSrcAdaptiveEnabled) {
      return 'baseline';
    }

    const score = this.getDynamicSrcStressScore(nowMs);
    if (score >= NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_CRITICAL) {
      return 'critical';
    }
    if (score >= NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_ELEVATED) {
      return 'elevated';
    }
    return 'baseline';
  }

  private getDynamicSrcAdaptiveScale(profile: AudioDynamicSrcAdaptiveProfile): number {
    if (profile === 'critical') return 1.8;
    if (profile === 'elevated') return 1.35;
    return 1;
  }

  private getEffectiveDynamicSrcTiming(nowMs: number = Date.now()): {
    profile: AudioDynamicSrcAdaptiveProfile;
    stressScore: number;
    restoreDebounceMs: number;
    minSwitchIntervalMs: number;
    seekHoldMs: number;
    underrunHoldMs: number;
    sharedStressHoldMs: number;
    outputErrorHoldMs: number;
  } {
    const profile = this.resolveDynamicSrcAdaptiveProfile(nowMs);
    const stressScore = this.getDynamicSrcStressScore(nowMs);
    const scale = this.getDynamicSrcAdaptiveScale(profile) * this.getDynamicSrcLearningScale();
    const scaleMs = (
      value: number,
      options: { min: number; max: number; inverse?: boolean }
    ): number => {
      const raw = options.inverse ? value / scale : value * scale;
      return Math.max(options.min, Math.min(options.max, Math.floor(raw)));
    };

    return {
      profile,
      stressScore,
      restoreDebounceMs: scaleMs(this.dynamicSrcRestoreDebounceMs, { min: 500, max: 30_000 }),
      minSwitchIntervalMs: scaleMs(this.dynamicSrcMinSwitchIntervalMs, {
        min: 100,
        max: 10_000,
        inverse: true,
      }),
      seekHoldMs: scaleMs(this.dynamicSrcSeekHoldMs, { min: 500, max: 20_000 }),
      underrunHoldMs: scaleMs(this.dynamicSrcUnderrunHoldMs, { min: 2_000, max: 120_000 }),
      sharedStressHoldMs: scaleMs(this.dynamicSrcSharedStressHoldMs, { min: 1_000, max: 90_000 }),
      outputErrorHoldMs: scaleMs(this.dynamicSrcOutputErrorHoldMs, { min: 1_000, max: 120_000 }),
    };
  }

  private isSameSrcPolicy(left: NativeAudioSrcPolicy, right: NativeAudioSrcPolicy): boolean {
    return (
      left.srcMode === right.srcMode &&
      left.srcBackend === right.srcBackend &&
      left.srcTargetSampleRate === right.srcTargetSampleRate
    );
  }

  private clearDynamicSrcRestoreTimer(): void {
    if (this.dynamicSrcRestoreTimer === null) return;
    clearTimeout(this.dynamicSrcRestoreTimer);
    this.dynamicSrcRestoreTimer = null;
  }

  private scheduleDynamicSrcRestoreEvaluation(): void {
    this.clearDynamicSrcRestoreTimer();
    const nowMs = Date.now();
    const effective = this.getEffectiveDynamicSrcTiming(nowMs);
    const holdRemaining = Math.max(0, this.dynamicSrcHoldUntilMs - nowMs);
    const delayMs = Math.max(effective.restoreDebounceMs, holdRemaining);

    this.dynamicSrcRestoreTimer = setTimeout(() => {
      this.dynamicSrcRestoreTimer = null;
      void this.maybeRestoreQualitySrc('stable-window');
    }, delayMs);
  }

  private withDynamicSrcHold(reason: string, holdMs: number): void {
    const nowMs = Date.now();
    const effective = this.getEffectiveDynamicSrcTiming(nowMs);
    const safeHoldMs = Math.max(1000, Math.floor(holdMs));
    const adaptiveHoldMs = Math.max(1000, Math.floor(safeHoldMs * this.getDynamicSrcAdaptiveScale(effective.profile)));
    this.dynamicSrcHoldUntilMs = Math.max(this.dynamicSrcHoldUntilMs, nowMs + safeHoldMs);
    this.dynamicSrcHoldUntilMs = Math.max(this.dynamicSrcHoldUntilMs, nowMs + adaptiveHoldMs);
    this.dynamicSrcLastSwitchReason = reason;
    this.dynamicSrcAdaptiveProfile = effective.profile;
    void this.ensureLatencySrcPolicy(reason);
    this.scheduleDynamicSrcRestoreEvaluation();
  }

  private canApplyDynamicSrcNow(nowMs: number): boolean {
    const effective = this.getEffectiveDynamicSrcTiming(nowMs);
    if (this.dynamicSrcLastApplyAtMs === null) return true;
    return (
      nowMs - this.dynamicSrcLastApplyAtMs >=
      effective.minSwitchIntervalMs
    );
  }

  private async applySrcPolicyIfNeeded(
    target: NativeAudioSrcPolicy,
    reason: string,
    profile: 'quality' | 'latency'
  ): Promise<boolean> {
    const current: NativeAudioSrcPolicy = {
      srcMode: this.srcMode,
      srcBackend: this.srcBackend,
      srcTargetSampleRate: this.srcMode === 'target-rate' ? this.srcTargetSampleRate : null,
    };

    if (this.isSameSrcPolicy(current, target)) {
      this.dynamicSrcProfile = profile;
      return false;
    }

    const nowMs = Date.now();
    if (!this.canApplyDynamicSrcNow(nowMs)) {
      this.scheduleDynamicSrcRestoreEvaluation();
      return false;
    }

    try {
      await this.setEnginePolicyInternal(target, { fromDynamicAuto: true });
      this.dynamicSrcProfile = profile;
      this.dynamicSrcLastSwitchAtMs = nowMs;
      this.dynamicSrcLastSwitchReason = reason;
      this.dynamicSrcLastApplyAtMs = nowMs;
      this.emitRobustnessSnapshot(true);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureLatencySrcPolicy(reason: string): Promise<void> {
    if (!this.dynamicSrcAutoEnabled) return;
    if (this.dynamicSrcManualLockActive) return;
    await this.applySrcPolicyIfNeeded(this.getLatencySrcPolicy(), reason, 'latency');
  }

  private async maybeRestoreQualitySrc(reason: string): Promise<void> {
    if (!this.dynamicSrcAutoEnabled) return;
    if (this.dynamicSrcManualLockActive) return;

    const nowMs = Date.now();
    if (nowMs < this.dynamicSrcHoldUntilMs) {
      this.scheduleDynamicSrcRestoreEvaluation();
      return;
    }
    if (this.underrunRecoveryUntilMs > nowMs) {
      this.scheduleDynamicSrcRestoreEvaluation();
      return;
    }
    if (this.hasActiveProtectionWindow(nowMs) || this.hasActiveSharedStressWindow(nowMs)) {
      this.scheduleDynamicSrcRestoreEvaluation();
      return;
    }
    if (this.state.playbackState === 'buffering' || this.state.playbackState === 'loading') {
      this.scheduleDynamicSrcRestoreEvaluation();
      return;
    }

    const restored = await this.applySrcPolicyIfNeeded(
      this.dynamicSrcQualityPolicy,
      reason,
      'quality'
    );
    if (!restored && this.dynamicSrcProfile !== 'quality') {
      this.scheduleDynamicSrcRestoreEvaluation();
    }
  }

  private readDynamicSrcAutoSettings(): AudioDynamicSrcAutoSettings {
    const clampMs = (value: unknown, fallback: number, min: number, max: number): number => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
      return Math.max(min, Math.min(max, Math.floor(value)));
    };

    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS);
      if (!raw) {
        return {
          enabled: true,
          adaptiveEnabled: this.dynamicSrcAdaptiveEnabled,
          learningEnabled: this.dynamicSrcLearningEnabled,
          restoreDebounceMs: this.dynamicSrcRestoreDebounceMs,
          minSwitchIntervalMs: this.dynamicSrcMinSwitchIntervalMs,
          seekHoldMs: this.dynamicSrcSeekHoldMs,
          underrunHoldMs: this.dynamicSrcUnderrunHoldMs,
          sharedStressHoldMs: this.dynamicSrcSharedStressHoldMs,
          outputErrorHoldMs: this.dynamicSrcOutputErrorHoldMs,
        };
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return {
          enabled: true,
          adaptiveEnabled: this.dynamicSrcAdaptiveEnabled,
          learningEnabled: this.dynamicSrcLearningEnabled,
          restoreDebounceMs: this.dynamicSrcRestoreDebounceMs,
          minSwitchIntervalMs: this.dynamicSrcMinSwitchIntervalMs,
          seekHoldMs: this.dynamicSrcSeekHoldMs,
          underrunHoldMs: this.dynamicSrcUnderrunHoldMs,
          sharedStressHoldMs: this.dynamicSrcSharedStressHoldMs,
          outputErrorHoldMs: this.dynamicSrcOutputErrorHoldMs,
        };
      }
      const record = parsed as Record<string, unknown>;
      return {
        enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
        adaptiveEnabled:
          typeof record.adaptiveEnabled === 'boolean'
            ? record.adaptiveEnabled
            : this.dynamicSrcAdaptiveEnabled,
        learningEnabled:
          typeof record.learningEnabled === 'boolean'
            ? record.learningEnabled
            : this.dynamicSrcLearningEnabled,
        restoreDebounceMs: clampMs(record.restoreDebounceMs, this.dynamicSrcRestoreDebounceMs, 500, 30_000),
        minSwitchIntervalMs: clampMs(
          record.minSwitchIntervalMs,
          this.dynamicSrcMinSwitchIntervalMs,
          100,
          10_000
        ),
        seekHoldMs: clampMs(record.seekHoldMs, this.dynamicSrcSeekHoldMs, 500, 20_000),
        underrunHoldMs: clampMs(record.underrunHoldMs, this.dynamicSrcUnderrunHoldMs, 2_000, 120_000),
        sharedStressHoldMs: clampMs(
          record.sharedStressHoldMs,
          this.dynamicSrcSharedStressHoldMs,
          1_000,
          90_000
        ),
        outputErrorHoldMs: clampMs(
          record.outputErrorHoldMs,
          this.dynamicSrcOutputErrorHoldMs,
          1_000,
          120_000
        ),
      };
    } catch {
      return {
        enabled: true,
        adaptiveEnabled: this.dynamicSrcAdaptiveEnabled,
        learningEnabled: this.dynamicSrcLearningEnabled,
        restoreDebounceMs: this.dynamicSrcRestoreDebounceMs,
        minSwitchIntervalMs: this.dynamicSrcMinSwitchIntervalMs,
        seekHoldMs: this.dynamicSrcSeekHoldMs,
        underrunHoldMs: this.dynamicSrcUnderrunHoldMs,
        sharedStressHoldMs: this.dynamicSrcSharedStressHoldMs,
        outputErrorHoldMs: this.dynamicSrcOutputErrorHoldMs,
      };
    }
  }

  private async restoreDynamicSrcAutoSettingsFromStorage(): Promise<void> {
    this.dynamicSrcLearningProfile = this.parseDynamicSrcLearningProfile(
      readString(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE)
    );
    this.dynamicSrcLearningLastPersistedSignature = JSON.stringify(
      this.normalizeDynamicSrcLearningProfileForPersistence()
    );
    this.dynamicSrcLearningLastPersistAtMs = 0;

    const persisted = this.readDynamicSrcAutoSettings();
    this.dynamicSrcAutoEnabled = persisted.enabled;
    this.dynamicSrcAdaptiveEnabled = persisted.adaptiveEnabled;
    this.dynamicSrcLearningEnabled = persisted.learningEnabled;
    this.dynamicSrcRestoreDebounceMs = persisted.restoreDebounceMs;
    this.dynamicSrcMinSwitchIntervalMs = persisted.minSwitchIntervalMs;
    this.dynamicSrcSeekHoldMs = persisted.seekHoldMs;
    this.dynamicSrcUnderrunHoldMs = persisted.underrunHoldMs;
    this.dynamicSrcSharedStressHoldMs = persisted.sharedStressHoldMs;
    this.dynamicSrcOutputErrorHoldMs = persisted.outputErrorHoldMs;
    this.dynamicSrcAdaptiveProfile = this.resolveDynamicSrcAdaptiveProfile();
    this.emitRobustnessSnapshot(true);

    if (this.dynamicSrcSettingsListenerCleanup) return;
    if (this.dynamicSrcSettingsListenerInitPromise) {
      await this.dynamicSrcSettingsListenerInitPromise;
      return;
    }

    const applyPersistedDynamicSrcSettings = () => {
      const next = this.readDynamicSrcAutoSettings();
      const changed =
        next.enabled !== this.dynamicSrcAutoEnabled ||
        next.adaptiveEnabled !== this.dynamicSrcAdaptiveEnabled ||
        next.learningEnabled !== this.dynamicSrcLearningEnabled;
      this.dynamicSrcAutoEnabled = next.enabled;
      this.dynamicSrcAdaptiveEnabled = next.adaptiveEnabled;
      this.dynamicSrcLearningEnabled = next.learningEnabled;
      if (!this.dynamicSrcLearningEnabled) {
        this.clearDynamicSrcLearningPersistTimer();
      }
      this.dynamicSrcRestoreDebounceMs = next.restoreDebounceMs;
      this.dynamicSrcMinSwitchIntervalMs = next.minSwitchIntervalMs;
      this.dynamicSrcSeekHoldMs = next.seekHoldMs;
      this.dynamicSrcUnderrunHoldMs = next.underrunHoldMs;
      this.dynamicSrcSharedStressHoldMs = next.sharedStressHoldMs;
      this.dynamicSrcOutputErrorHoldMs = next.outputErrorHoldMs;
      if (!this.dynamicSrcAutoEnabled) {
        this.dynamicSrcProfile = 'quality';
        this.dynamicSrcAdaptiveProfile = 'baseline';
        this.dynamicSrcHoldUntilMs = 0;
        this.clearDynamicSrcRestoreTimer();
      } else {
        this.dynamicSrcAdaptiveProfile = this.resolveDynamicSrcAdaptiveProfile();
        this.scheduleDynamicSrcRestoreEvaluation();
      }
      if (changed) {
        this.emitRobustnessSnapshot(true);
      }
    };

    this.dynamicSrcSettingsListenerInitPromise = (async () => {
      if (this.dynamicSrcSettingsListenerCleanup) return;

      const settingsCleanup = await setupDualListener(
        [STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS],
        [],
        applyPersistedDynamicSrcSettings
      );

      const learningCleanup = await setupDualListener(
        [STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE],
        [],
        () => {
          const nextProfile = this.parseDynamicSrcLearningProfile(
            readString(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE)
          );
          const nextSignature = JSON.stringify(nextProfile);
          if (nextSignature === this.dynamicSrcLearningLastPersistedSignature) {
            return;
          }
          this.dynamicSrcLearningProfile = nextProfile;
          this.dynamicSrcLearningLastPersistedSignature = nextSignature;
          this.dynamicSrcLearningLastPersistAtMs = Date.now();
          this.emitRobustnessSnapshot(true);
        }
      );

      this.dynamicSrcSettingsListenerCleanup = () => {
        settingsCleanup();
        learningCleanup();
      };
    })().finally(() => {
      this.dynamicSrcSettingsListenerInitPromise = null;
    });

    await this.dynamicSrcSettingsListenerInitPromise;
  }

  private applyEnginePolicyPayload(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const policy = payload as NativeAudioEnginePolicyPayload;

    if (policy.transportMode === 'robust' || policy.transportMode === 'transport-exact') {
      this.transportMode = policy.transportMode;
    }

    if (
      policy.hqSrcPhaseMode === 'linear' ||
      policy.hqSrcPhaseMode === 'minimum' ||
      policy.hqSrcPhaseMode === 'intermediate'
    ) {
      this.hqSrcPhaseMode = policy.hqSrcPhaseMode;
    }

    if (
      policy.srcMode === 'source-native' ||
      policy.srcMode === 'match-output' ||
      policy.srcMode === 'target-rate'
    ) {
      this.srcMode = policy.srcMode;
    }

    if (policy.srcBackend === 'rubato' || policy.srcBackend === 'linear-simd') {
      this.srcBackend = policy.srcBackend;
    }

    if (
      typeof policy.srcTargetSampleRate === 'number' &&
      Number.isFinite(policy.srcTargetSampleRate) &&
      policy.srcTargetSampleRate > 0
    ) {
      this.srcTargetSampleRate = Math.max(8000, Math.min(768000, Math.floor(policy.srcTargetSampleRate)));
    } else if (policy.srcTargetSampleRate == null) {
      this.srcTargetSampleRate = null;
    }

    if (policy.outputQuantizationMode === 'round' || policy.outputQuantizationMode === 'tpdf') {
      this.outputQuantizationMode = policy.outputQuantizationMode;
    }

    if (!this.dynamicSrcAutoEnabled || this.dynamicSrcManualLockActive) {
      this.captureCurrentQualitySrcPolicy();
    }

    if (typeof policy.hqSrcStopbandDb === 'number' && Number.isFinite(policy.hqSrcStopbandDb)) {
      this.hqSrcStopbandDb = Math.max(0, Math.min(200, Math.floor(policy.hqSrcStopbandDb)));
    }

    if (typeof policy.transportExactInt32Container === 'boolean') {
      this.transportExactInt32Container = policy.transportExactInt32Container;
    }

    if (!policy.hqSrcEnabled) {
      this.hqSrcActive = false;
      this.hqSrcRatio = 1;
    }
  }

  private async setEnginePolicyInternal(
    patch: NativeAudioEnginePolicyPatch,
    options?: { fromDynamicAuto?: boolean }
  ): Promise<void> {
    const normalized: NativeAudioEnginePolicyPatch = {};
    if (patch.transportMode === 'robust' || patch.transportMode === 'transport-exact') {
      normalized.transportMode = patch.transportMode;
    }
    if (typeof patch.hqSrcEnabled === 'boolean') {
      normalized.hqSrcEnabled = patch.hqSrcEnabled;
    }
    if (
      patch.hqSrcPhaseMode === 'linear' ||
      patch.hqSrcPhaseMode === 'minimum' ||
      patch.hqSrcPhaseMode === 'intermediate'
    ) {
      normalized.hqSrcPhaseMode = patch.hqSrcPhaseMode;
    }
    if (
      patch.srcMode === 'source-native' ||
      patch.srcMode === 'match-output' ||
      patch.srcMode === 'target-rate'
    ) {
      normalized.srcMode = patch.srcMode;
    }
    if (patch.srcBackend === 'rubato' || patch.srcBackend === 'linear-simd') {
      normalized.srcBackend = patch.srcBackend;
    }
    if (
      typeof patch.srcTargetSampleRate === 'number' &&
      Number.isFinite(patch.srcTargetSampleRate) &&
      patch.srcTargetSampleRate > 0
    ) {
      normalized.srcTargetSampleRate = Math.max(
        8000,
        Math.min(768000, Math.floor(patch.srcTargetSampleRate))
      );
    } else if (patch.srcTargetSampleRate === null) {
      normalized.srcTargetSampleRate = null;
    }
    if (patch.outputQuantizationMode === 'round' || patch.outputQuantizationMode === 'tpdf') {
      normalized.outputQuantizationMode = patch.outputQuantizationMode;
    }

    const hasExplicitSrcPatch =
      typeof normalized.srcMode !== 'undefined' ||
      typeof normalized.srcBackend !== 'undefined' ||
      'srcTargetSampleRate' in normalized;

    if (hasExplicitSrcPatch && !options?.fromDynamicAuto) {
      const requestedSrcPolicy = this.normalizeSrcPolicyFromPatch(normalized);
      this.dynamicSrcManualLockActive = true;
      this.dynamicSrcQualityPolicy = requestedSrcPolicy;
      this.dynamicSrcProfile = 'quality';
      this.dynamicSrcHoldUntilMs = 0;
      this.clearDynamicSrcRestoreTimer();
    }

    const response = await invoke<unknown>(
      'native_audio_set_engine_policy',
      normalized as Record<string, unknown>
    );
    this.applyEnginePolicyPayload(response);
    this.emitRobustnessSnapshot(true);
  }

  async setEnginePolicy(patch: NativeAudioEnginePolicyPatch): Promise<void> {
    await this.setEnginePolicyInternal(patch);
  }

  getDynamicSrcAutoSettings(): AudioDynamicSrcAutoSettings {
    return {
      enabled: this.dynamicSrcAutoEnabled,
      adaptiveEnabled: this.dynamicSrcAdaptiveEnabled,
      learningEnabled: this.dynamicSrcLearningEnabled,
      restoreDebounceMs: this.dynamicSrcRestoreDebounceMs,
      minSwitchIntervalMs: this.dynamicSrcMinSwitchIntervalMs,
      seekHoldMs: this.dynamicSrcSeekHoldMs,
      underrunHoldMs: this.dynamicSrcUnderrunHoldMs,
      sharedStressHoldMs: this.dynamicSrcSharedStressHoldMs,
      outputErrorHoldMs: this.dynamicSrcOutputErrorHoldMs,
    };
  }

  async setDynamicSrcAutoSettings(settings: AudioDynamicSrcAutoSettingsPatch): Promise<void> {
    const clampMs = (value: unknown, fallback: number, min: number, max: number): number => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
      return Math.max(min, Math.min(max, Math.floor(value)));
    };

    const enabled =
      typeof settings.enabled === 'boolean' ? settings.enabled : this.dynamicSrcAutoEnabled;
    const adaptiveEnabled =
      typeof settings.adaptiveEnabled === 'boolean'
        ? settings.adaptiveEnabled
        : this.dynamicSrcAdaptiveEnabled;
    const learningEnabled =
      typeof settings.learningEnabled === 'boolean'
        ? settings.learningEnabled
        : this.dynamicSrcLearningEnabled;
    const nextSettings: AudioDynamicSrcAutoSettings = {
      enabled,
      adaptiveEnabled,
      learningEnabled,
      restoreDebounceMs: clampMs(
        settings.restoreDebounceMs,
        this.dynamicSrcRestoreDebounceMs,
        500,
        30_000
      ),
      minSwitchIntervalMs: clampMs(
        settings.minSwitchIntervalMs,
        this.dynamicSrcMinSwitchIntervalMs,
        100,
        10_000
      ),
      seekHoldMs: clampMs(settings.seekHoldMs, this.dynamicSrcSeekHoldMs, 500, 20_000),
      underrunHoldMs: clampMs(settings.underrunHoldMs, this.dynamicSrcUnderrunHoldMs, 2_000, 120_000),
      sharedStressHoldMs: clampMs(
        settings.sharedStressHoldMs,
        this.dynamicSrcSharedStressHoldMs,
        1_000,
        90_000
      ),
      outputErrorHoldMs: clampMs(
        settings.outputErrorHoldMs,
        this.dynamicSrcOutputErrorHoldMs,
        1_000,
        120_000
      ),
    };

    if (!enabled && this.dynamicSrcProfile === 'latency') {
      await this.applySrcPolicyIfNeeded(this.dynamicSrcQualityPolicy, 'dynamic-src-disabled', 'quality');
    }

    await broadcastDataUpdate(
      STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS,
      nextSettings,
      TAURI_EVENTS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS_UPDATED
    );

    this.dynamicSrcAutoEnabled = nextSettings.enabled;
    this.dynamicSrcAdaptiveEnabled = nextSettings.adaptiveEnabled;
    this.dynamicSrcLearningEnabled = nextSettings.learningEnabled;
    if (!this.dynamicSrcLearningEnabled) {
      this.clearDynamicSrcLearningPersistTimer();
    }
    this.dynamicSrcRestoreDebounceMs = nextSettings.restoreDebounceMs;
    this.dynamicSrcMinSwitchIntervalMs = nextSettings.minSwitchIntervalMs;
    this.dynamicSrcSeekHoldMs = nextSettings.seekHoldMs;
    this.dynamicSrcUnderrunHoldMs = nextSettings.underrunHoldMs;
    this.dynamicSrcSharedStressHoldMs = nextSettings.sharedStressHoldMs;
    this.dynamicSrcOutputErrorHoldMs = nextSettings.outputErrorHoldMs;

    if (!nextSettings.enabled) {
      this.dynamicSrcProfile = 'quality';
      this.dynamicSrcAdaptiveProfile = 'baseline';
      this.dynamicSrcHoldUntilMs = 0;
      this.clearDynamicSrcRestoreTimer();
      this.emitRobustnessSnapshot(true);
      return;
    }

    this.dynamicSrcManualLockActive = false;
    this.captureCurrentQualitySrcPolicy();
    this.dynamicSrcProfile = 'quality';
    this.dynamicSrcAdaptiveProfile = this.resolveDynamicSrcAdaptiveProfile();
    this.dynamicSrcLastSwitchReason = 'dynamic-src-enabled';
    this.scheduleDynamicSrcRestoreEvaluation();
    this.emitRobustnessSnapshot(true);
  }

  private getAutoBackendChain(): string[] {
    const backends = [...this.availableOutputBackends];
    if (
      this.isSharedOutputBackend(this.currentOutputBackendId) &&
      !backends.includes(this.currentOutputBackendId)
    ) {
      backends.unshift(this.currentOutputBackendId);
    }

    const unique = Array.from(
      new Set(backends.filter((value) => value.length > 0 && this.isSharedOutputBackend(value)))
    );
    if (unique.length <= 1) return unique;

    const platform =
      typeof navigator !== 'undefined'
        ? `${(navigator as Navigator & { platform?: string }).platform ?? ''} ${navigator.userAgent ?? ''}`
        : '';
    const isWindows = /win/i.test(platform);
    if (!isWindows) return unique;

    const preferredOrder = ['wasapi-shared-raw', 'wasapi', 'rodio-cpal'];
    const ordered: string[] = [];
    for (const preferred of preferredOrder) {
      if (unique.includes(preferred)) ordered.push(preferred);
    }
    for (const backend of unique) {
      if (!ordered.includes(backend)) ordered.push(backend);
    }
    return ordered;
  }

  private pruneUnderrunSpikeWindow(nowMs: number): void {
    this.underrunSpikeTimestampsMs = this.underrunSpikeTimestampsMs.filter(
      (timestamp) => nowMs - timestamp <= NativeAudioService.AUTO_BACKEND_UNDERRUN_WINDOW_MS
    );
  }

  private shouldAutoSwitchNow(reason: string, nowMs: number): boolean {
    if (this.backendSwitchInFlight) return false;

    if (
      this.lastAutoBackendSwitchAtMs !== null &&
      nowMs - this.lastAutoBackendSwitchAtMs < NativeAudioService.AUTO_BACKEND_SWITCH_COOLDOWN_MS
    ) {
      return false;
    }

    if (reason.startsWith('underrun')) {
      if (this.lastUnderrunFrames >= NativeAudioService.AUTO_BACKEND_UNDERRUN_FRAME_SPIKE_TRIGGER) {
        return true;
      }
      this.pruneUnderrunSpikeWindow(nowMs);
      return (
        this.underrunSpikeTimestampsMs.length >= NativeAudioService.AUTO_BACKEND_UNDERRUN_TRIGGER_COUNT
      );
    }

    return true;
  }

  private handleOutputBackendSwitchFailure(reason: string): void {
    const effective = this.getEffectiveDynamicSrcTiming();
    this.withDynamicSrcHold(
      `output-backend-switch-failed:${reason}`,
      effective.outputErrorHoldMs
    );
  }

  private maybeAutoSwitchOutputBackend(reason: string, options?: { force?: boolean }): void {
    const nowMs = Date.now();
    if (!options?.force && !this.shouldAutoSwitchNow(reason, nowMs)) {
      return;
    }

    void this.tryAutoSwitchOutputBackend(reason);
  }

  private async tryAutoSwitchOutputBackend(reason: string): Promise<void> {
    if (this.backendSwitchInFlight) return;

    if (!this.isSharedOutputBackend(this.currentOutputBackendId)) {
      return;
    }

    const nowMs = Date.now();
    if (
      this.lastAutoBackendSwitchAtMs !== null &&
      nowMs - this.lastAutoBackendSwitchAtMs < NativeAudioService.AUTO_BACKEND_SWITCH_COOLDOWN_MS
    ) {
      return;
    }

    this.backendSwitchInFlight = true;

    try {
      await this.refreshOutputBackendInventory();

      const chain = this.getAutoBackendChain();
      if (chain.length <= 1) return;

      const current = this.currentOutputBackendId;
      if (!this.isSharedOutputBackend(current)) return;
      const currentIndex = current ? chain.indexOf(current) : -1;
      const targetBackend =
        currentIndex >= 0 ? chain[(currentIndex + 1) % chain.length] ?? null : chain[0] ?? null;
      if (!targetBackend) return;
      if (targetBackend === current) return;

      const switched = await this.selectOutputBackendInternal(targetBackend, {
        persist: true,
        clearDevice: true,
      });
      if (!switched) {
        this.handleOutputBackendSwitchFailure(reason);
        return;
      }

      this.autoBackendSwitchCount += 1;
      this.lastAutoBackendSwitchAtMs = Date.now();
      this.lastAutoBackendSwitchReason = reason;
      this.emitRobustnessSnapshot(true);
    } finally {
      this.backendSwitchInFlight = false;
    }
  }

  private async selectOutputBackendInternal(
    backendId: string | null,
    options?: { persist?: boolean; clearDevice?: boolean }
  ): Promise<boolean> {
    try {
      const previousBackendId = this.currentOutputBackendId;
      const payload = await invoke<unknown>('native_audio_select_output_backend', {
        backendId,
      });
      const parsed = this.parseComponentsStatePayload(payload);
      const resolvedBackendId = this.sanitizeBackendId(parsed.outputBackendId) ?? backendId;
      if (!resolvedBackendId) {
        this.handleOutputBackendSwitchFailure('resolved-backend-empty');
        return false;
      }
      this.currentOutputBackendId = resolvedBackendId;
      if (resolvedBackendId !== previousBackendId) {
        this.resetUnderrunTracking();
        this.scheduleDynamicSrcRestoreEvaluation();
      } else {
        this.handleOutputBackendSwitchFailure('resolved-backend-unchanged');
        return false;
      }

      if (resolvedBackendId && !this.availableOutputBackends.includes(resolvedBackendId)) {
        this.availableOutputBackends = [...this.availableOutputBackends, resolvedBackendId];
      }

      if (options?.persist !== false) {
        await broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_BACKEND,
          resolvedBackendId,
          TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_BACKEND_UPDATED
        );

        if (options?.clearDevice !== false) {
          await broadcastDataUpdate(
            STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_DEVICE,
            null,
            TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_DEVICE_UPDATED
          );
        }
      }

      return true;
    } catch (error) {
      console.warn('[NativeAudio] Failed to select output backend:', error);
      this.handleOutputBackendSwitchFailure('select-output-backend-error');
      return false;
    }
  }

  private normalizeStreamingBufferSettings(settings: StreamingBufferSettings): StreamingBufferSettings {
    const normalize = (value: number | null, min: number, max: number): number | null => {
      if (typeof value !== 'number' || !isFinite(value)) return null;
      return Math.max(min, Math.min(max, value));
    };

    return {
      startOrSeekSeconds: normalize(settings.startOrSeekSeconds, 0, 4),
      crossfadeSeconds: normalize(settings.crossfadeSeconds, 0, 3),
      decodeMode: settings.decodeMode === 'full-track' ? 'full-track' : 'streaming',
    };
  }

  private buildBackgroundStreamingBufferSettings(base: StreamingBufferSettings): StreamingBufferSettings {
    return {
      startOrSeekSeconds:
        typeof base.startOrSeekSeconds === 'number'
          ? Math.min(3.2, Math.max(1.2, base.startOrSeekSeconds))
          : 2.4,
      crossfadeSeconds:
        typeof base.crossfadeSeconds === 'number'
          ? Math.min(1.8, Math.max(0.4, base.crossfadeSeconds))
          : 1.0,
      decodeMode: base.decodeMode,
    };
  }

  private buildRecoveryStreamingBufferSettings(base: StreamingBufferSettings): StreamingBufferSettings {
    const background = this.buildBackgroundStreamingBufferSettings(base);
    return {
      startOrSeekSeconds: Math.min(4, Math.max(background.startOrSeekSeconds ?? 2.4, 3.2)),
      crossfadeSeconds: Math.min(3, Math.max(background.crossfadeSeconds ?? 1.0, 1.4)),
      decodeMode: background.decodeMode,
    };
  }

  private buildProtectionStreamingBufferSettings(base: StreamingBufferSettings): StreamingBufferSettings {
    const recovery = this.buildRecoveryStreamingBufferSettings(base);
    return {
      startOrSeekSeconds: Math.min(4, Math.max(recovery.startOrSeekSeconds ?? 3.2, 3.8)),
      crossfadeSeconds: Math.min(3, Math.max(recovery.crossfadeSeconds ?? 1.4, 1.8)),
      decodeMode: recovery.decodeMode,
    };
  }

  private hasActiveProtectionWindow(nowMs: number = Date.now()): boolean {
    if (this.protectionWindowRefCount > 0) return true;
    return this.protectionWindowUntilMs > nowMs;
  }

  private hasActiveSharedStressWindow(nowMs: number = Date.now()): boolean {
    return this.sharedStressUntilMs > nowMs;
  }

  private applySharedTimelineStressIfNeeded(
    timeline: Array<{ seq: number; timestampMs: number; kind: string; value: number; aux: number }>
  ): void {
    if (!this.currentOutputBackendId || this.currentOutputBackendId === 'wasapi-exclusive') {
      return;
    }

    const newEvents = timeline.filter((event) => event.seq > this.diagnosticTimelineLastSeq);
    if (newEvents.length === 0) {
      return;
    }

    const latestSeq = newEvents.reduce((max, event) => Math.max(max, event.seq), this.diagnosticTimelineLastSeq);
    this.diagnosticTimelineLastSeq = latestSeq;

    const nowMs = Date.now();
    const recent = newEvents.filter(
      (event) =>
        Number.isFinite(event.timestampMs) &&
        event.timestampMs > 0 &&
        nowMs - event.timestampMs <= NativeAudioService.SHARED_TIMELINE_STRESS_WINDOW_MS
    );

    if (recent.length === 0) {
      return;
    }

    let lowWatermarkEvents = 0;
    let underrunEvents = 0;

    for (const event of recent) {
      if (
        event.kind === 'shared.transfer.render_low_watermark' ||
        event.kind === 'shared.transfer.decode_low_watermark' ||
        event.kind === 'shared.render_ahead.low_watermark'
      ) {
        lowWatermarkEvents += 1;
      }
      if (
        event.kind === 'shared.output.render_underrun' ||
        event.kind === 'shared.render_ahead.underrun'
      ) {
        underrunEvents += 1;
      }
    }

    const shouldEscalate =
      underrunEvents >= NativeAudioService.SHARED_TIMELINE_UNDERRUN_TRIGGER ||
      lowWatermarkEvents >= NativeAudioService.SHARED_TIMELINE_LOW_WATERMARK_TRIGGER;

    if (!shouldEscalate) {
      return;
    }

    this.sharedStressEscalationCount += 1;
    const extensionMs = Math.min(60_000, 12_000 + this.sharedStressEscalationCount * 4_000);
    this.sharedStressUntilMs = Math.max(this.sharedStressUntilMs, nowMs + extensionMs);
    this.sharedStressReason =
      underrunEvents > 0
        ? 'shared-underrun'
        : 'shared-low-watermark-pressure';

    this.applyStreamingBufferPolicy(true);
    const effective = this.getEffectiveDynamicSrcTiming(nowMs);
    this.withDynamicSrcHold(
      this.sharedStressReason,
      effective.sharedStressHoldMs
    );
  }

  private getStreamingBufferPolicyTarget(nowMs: number = Date.now()): StreamingBufferSettings {
    let target = this.normalizeStreamingBufferSettings(this.storedStreamingBufferSettings);

    if (typeof document !== 'undefined' && document.hidden) {
      target = this.buildBackgroundStreamingBufferSettings(target);
    }

    if (this.underrunRecoveryUntilMs > nowMs) {
      target = this.buildRecoveryStreamingBufferSettings(target);
    }

    if (this.hasActiveProtectionWindow(nowMs)) {
      target = this.buildProtectionStreamingBufferSettings(target);
    }

    if (this.hasActiveSharedStressWindow(nowMs)) {
      target = {
        startOrSeekSeconds: Math.min(4, Math.max(target.startOrSeekSeconds ?? 2.4, 3.6)),
        crossfadeSeconds: Math.min(3, Math.max(target.crossfadeSeconds ?? 1.0, 1.9)),
        decodeMode: target.decodeMode,
      };
    }

    return this.normalizeStreamingBufferSettings(target);
  }

  private isSameStreamingBufferSettings(
    left: StreamingBufferSettings | null,
    right: StreamingBufferSettings | null
  ): boolean {
    if (!left || !right) return false;
    return (
      left.startOrSeekSeconds === right.startOrSeekSeconds &&
      left.crossfadeSeconds === right.crossfadeSeconds &&
      left.decodeMode === right.decodeMode
    );
  }

  private applyStreamingBufferPolicy(force: boolean = false): void {
    const nowMs = Date.now();

    if (this.protectionWindowRefCount === 0 && this.protectionWindowUntilMs > 0 && nowMs >= this.protectionWindowUntilMs) {
      this.protectionWindowUntilMs = 0;
      this.protectionWindowReason = null;
    }

    if (this.sharedStressUntilMs > 0 && nowMs >= this.sharedStressUntilMs) {
      this.sharedStressUntilMs = 0;
      this.sharedStressReason = null;
      this.sharedStressEscalationCount = 0;
    }

    const target = this.getStreamingBufferPolicyTarget(nowMs);
    if (!force && this.isSameStreamingBufferSettings(this.lastAppliedStreamingBufferSettings, target)) {
      return;
    }

    this.lastAppliedStreamingBufferSettings = target;
    void invoke('native_audio_set_streaming_buffer_settings', target).catch(() => {});
  }

  private recordBufferedAheadSample(value: number): void {
    if (!Number.isFinite(value)) return;
    const normalized = Math.max(0, Math.min(600, value));
    this.bufferedAheadRollingWindow.push(normalized);
    this.bufferedAheadRollingSum += normalized;

    if (this.bufferedAheadRollingWindow.length > NativeAudioService.ROBUSTNESS_BUFFER_WINDOW_SIZE) {
      const removed = this.bufferedAheadRollingWindow.shift();
      if (typeof removed === 'number') {
        this.bufferedAheadRollingSum -= removed;
      }
    }

    if (this.bufferedAheadMinSeconds === null) {
      this.bufferedAheadMinSeconds = normalized;
    } else {
      this.bufferedAheadMinSeconds = Math.min(this.bufferedAheadMinSeconds, normalized);
    }
  }

  private trackPlaybackStateForMetrics(nextPlaybackState: PlaybackState): void {
    if (this.lastPlaybackStateForMetrics === 'playing' && nextPlaybackState === 'buffering') {
      this.rebufferCount += 1;
    }
    this.lastPlaybackStateForMetrics = nextPlaybackState;
  }

  private handleUnderrunSpike(nextUnderrunEvents: number, nextUnderrunFrames?: number): void {
    const nowMs = Date.now();
    this.lastUnderrunEvents = Math.max(0, Math.floor(nextUnderrunEvents));
    if (typeof nextUnderrunFrames === 'number' && Number.isFinite(nextUnderrunFrames)) {
      this.lastUnderrunFrames = Math.max(0, Math.floor(nextUnderrunFrames));
    }

    this.underrunSpikeTimestampsMs.push(nowMs);
    this.pruneUnderrunSpikeWindow(nowMs);
    this.underrunRecoveryUntilMs = nowMs + NativeAudioService.UNDERRUN_RECOVERY_WINDOW_MS;
    this.applyStreamingBufferPolicy(true);
    const effective = this.getEffectiveDynamicSrcTiming(nowMs);
    this.withDynamicSrcHold('underrun-spike', effective.underrunHoldMs);
    this.maybeAutoSwitchOutputBackend('underrun-spike');
  }

  private resetUnderrunTracking(): void {
    this.lastUnderrunEvents = 0;
    this.lastUnderrunFrames = 0;
    this.underrunSpikeTimestampsMs = [];
    this.underrunRecoveryUntilMs = 0;
    this.sharedStressUntilMs = 0;
    this.sharedStressReason = null;
    this.sharedStressEscalationCount = 0;
    this.dynamicSrcHoldUntilMs = 0;
    this.clearDynamicSrcRestoreTimer();
    this.applyStreamingBufferPolicy(true);
    this.scheduleDynamicSrcRestoreEvaluation();
  }

  private maybeReleaseUnderrunRecovery(playbackState: PlaybackState): void {
    if (this.underrunRecoveryUntilMs <= 0) return;
    const nowMs = Date.now();
    if (nowMs < this.underrunRecoveryUntilMs) return;
    if (playbackState === 'buffering') return;

    this.underrunRecoveryUntilMs = 0;
    this.applyStreamingBufferPolicy(true);
    this.scheduleDynamicSrcRestoreEvaluation();

    if (this.sharedStressUntilMs > 0 && nowMs >= this.sharedStressUntilMs) {
      this.sharedStressUntilMs = 0;
      this.sharedStressReason = null;
      this.sharedStressEscalationCount = 0;
      this.applyStreamingBufferPolicy(true);
      this.scheduleDynamicSrcRestoreEvaluation();
    }

    this.scheduleDynamicSrcRestoreEvaluation();
  }

  private clearProtectionWindowTimer(): void {
    if (this.protectionWindowTimer === null) return;
    clearTimeout(this.protectionWindowTimer);
    this.protectionWindowTimer = null;
  }

  private scheduleProtectionWindowExpiry(): void {
    this.clearProtectionWindowTimer();
    if (this.protectionWindowRefCount > 0) return;

    const nowMs = Date.now();
    if (this.protectionWindowUntilMs <= nowMs) {
      this.protectionWindowUntilMs = 0;
      this.protectionWindowReason = null;
      this.applyStreamingBufferPolicy(true);
      this.emitRobustnessSnapshot(true);
      return;
    }

    const delayMs = Math.max(0, this.protectionWindowUntilMs - nowMs);
    this.protectionWindowTimer = setTimeout(() => {
      this.protectionWindowTimer = null;
      if (this.protectionWindowRefCount > 0) return;
      this.protectionWindowUntilMs = 0;
      this.protectionWindowReason = null;
      this.applyStreamingBufferPolicy(true);
      this.emitRobustnessSnapshot(true);
    }, delayMs);
  }

  private buildRobustnessSnapshot(nowMs: number = Date.now()): AudioRobustnessSnapshot {
    this.pruneUnderrunSpikeWindow(nowMs);
    const effectiveDynamicSrc = this.getEffectiveDynamicSrcTiming(nowMs);
    this.dynamicSrcAdaptiveProfile = effectiveDynamicSrc.profile;
    const learningDeviceKey = this.buildDynamicSrcLearningDeviceKey();
    const learningStressIndex = this.dynamicSrcLearningProfile[learningDeviceKey]?.stressIndex ?? 0;
    const learningScale = this.getDynamicSrcLearningScale();

    const bufferedAheadNow =
      typeof this.state.bufferedAhead === 'number' && Number.isFinite(this.state.bufferedAhead)
        ? Math.max(0, this.state.bufferedAhead)
        : 0;
    const bufferedAheadAvg =
      this.bufferedAheadRollingWindow.length > 0
        ? this.bufferedAheadRollingSum / this.bufferedAheadRollingWindow.length
        : null;
    const recoveryActive = this.underrunRecoveryUntilMs > nowMs;
    const protectionActive = this.hasActiveProtectionWindow(nowMs);

    return {
      outputBackendId: this.currentOutputBackendId,
      outputBackends: [...this.availableOutputBackends],
      schedulerProfile: this.lastSchedulerProfile,
      transportMode: this.transportMode,
      hqSrcPhaseMode: this.hqSrcPhaseMode,
      srcMode: this.srcMode,
      srcBackend: this.srcBackend,
      srcTargetSampleRate: this.srcTargetSampleRate,
      outputQuantizationMode: this.outputQuantizationMode,
      dynamicSrcAutoEnabled: this.dynamicSrcAutoEnabled,
      dynamicSrcProfile: this.dynamicSrcProfile,
      dynamicSrcLastSwitchAtMs: this.dynamicSrcLastSwitchAtMs,
      dynamicSrcLastSwitchReason: this.dynamicSrcLastSwitchReason,
      dynamicSrcHoldUntilMs: Math.max(0, this.dynamicSrcHoldUntilMs - nowMs),
      dynamicSrcManualLockActive: this.dynamicSrcManualLockActive,
      dynamicSrcAdaptiveEnabled: this.dynamicSrcAdaptiveEnabled,
      dynamicSrcAdaptiveProfile: this.dynamicSrcAdaptiveProfile,
      dynamicSrcStressScore: effectiveDynamicSrc.stressScore,
      dynamicSrcLearningEnabled: this.dynamicSrcLearningEnabled,
      dynamicSrcLearningDeviceKey: learningDeviceKey,
      dynamicSrcLearningStressIndex: Number(learningStressIndex.toFixed(4)),
      dynamicSrcLearningScale: Number(learningScale.toFixed(4)),
      dynamicSrcRestoreDebounceMs: this.dynamicSrcRestoreDebounceMs,
      dynamicSrcMinSwitchIntervalMs: this.dynamicSrcMinSwitchIntervalMs,
      dynamicSrcSeekHoldMs: this.dynamicSrcSeekHoldMs,
      dynamicSrcUnderrunHoldMs: this.dynamicSrcUnderrunHoldMs,
      dynamicSrcSharedStressHoldMs: this.dynamicSrcSharedStressHoldMs,
      dynamicSrcOutputErrorHoldMs: this.dynamicSrcOutputErrorHoldMs,
      dynamicSrcEffectiveRestoreDebounceMs: effectiveDynamicSrc.restoreDebounceMs,
      dynamicSrcEffectiveMinSwitchIntervalMs: effectiveDynamicSrc.minSwitchIntervalMs,
      dynamicSrcEffectiveSeekHoldMs: effectiveDynamicSrc.seekHoldMs,
      dynamicSrcEffectiveUnderrunHoldMs: effectiveDynamicSrc.underrunHoldMs,
      dynamicSrcEffectiveSharedStressHoldMs: effectiveDynamicSrc.sharedStressHoldMs,
      dynamicSrcEffectiveOutputErrorHoldMs: effectiveDynamicSrc.outputErrorHoldMs,
      hqSrcStopbandDb: this.hqSrcStopbandDb,
      hqSrcActive: this.hqSrcActive,
      hqSrcRatio: this.hqSrcRatio,
      sourceSampleRate: this.sourceSampleRate,
      outputSampleRate: this.outputSampleRate,
      transportExactInt32Container: this.transportExactInt32Container,
      outputCallbackMetricsValid: this.outputCallbackMetricsValid,
      underrunEvents: this.lastUnderrunEvents,
      underrunFrames: this.lastUnderrunFrames,
      underrunEventsWindow: this.underrunSpikeTimestampsMs.length,
      underrunRecoveryActive: recoveryActive,
      protectionWindowActive: protectionActive,
      protectionRefCount: this.protectionWindowRefCount,
      autoSwitchCount: this.autoBackendSwitchCount,
      lastAutoSwitchAtMs: this.lastAutoBackendSwitchAtMs,
      lastAutoSwitchReason: this.lastAutoBackendSwitchReason,
      bufferedAheadSeconds: bufferedAheadNow,
      bufferedAheadMinSeconds: this.bufferedAheadMinSeconds,
      bufferedAheadAvgSeconds: bufferedAheadAvg,
      rebufferCount: this.rebufferCount,
      outputCallbackP99Us: this.outputCallbackP99Us,
      outputWaitTimeoutCount: this.outputWaitTimeoutCount,
      outputRenderUnderrunEvents: this.outputRenderUnderrunEvents,
      outputRenderUnderrunFrames: this.outputRenderUnderrunFrames,
      outputCallbackIntervalJitterP99Us: this.outputCallbackIntervalJitterP99Us,
      outputCallbackIntervalOverrunCount: this.outputCallbackIntervalOverrunCount,
      outputCallbackExpectedIntervalUs: this.outputCallbackExpectedIntervalUs,
      transferLowWatermarkSamples: this.transferLowWatermarkSamples,
      transferRenderLowHitCount: this.transferRenderLowHitCount,
      transferDecodeLowHitCount: this.transferDecodeLowHitCount,
      renderQueuePageLocked: this.renderQueuePageLocked,
      transferMetricsValid: this.transferMetricsValid,
      sharedRenderAheadEnabled: this.sharedRenderAheadEnabled,
      sharedRenderUnderrunEvents: this.sharedRenderUnderrunEvents,
      sharedRenderUnderrunFrames: this.sharedRenderUnderrunFrames,
      sharedRenderLowHitCount: this.sharedRenderLowHitCount,
      sharedRenderLowWatermarkSamples: this.sharedRenderLowWatermarkSamples,
      diagnosticTimelineDroppedEvents: this.diagnosticTimelineDroppedEvents,
      diagnosticTimeline: [...this.diagnosticTimeline],
      protectionReason:
        protectionActive
          ? this.protectionWindowReason ?? this.sharedStressReason
          : this.hasActiveSharedStressWindow(nowMs)
            ? this.sharedStressReason
            : null,
    };
  }

  private emitRobustnessSnapshot(force: boolean = false): void {
    if (this.robustnessCallbacks.size === 0) return;

    if (this.robustnessEmissionInProgress) {
      this.robustnessEmissionPendingForce = this.robustnessEmissionPendingForce || force;
      return;
    }

    this.robustnessEmissionInProgress = true;

    const snapshot = this.buildRobustnessSnapshot();
    const signature = JSON.stringify(snapshot);
    try {
      if (!force && signature === this.lastEmittedRobustnessSignature) {
        return;
      }
      this.lastEmittedRobustnessSignature = signature;
      this.robustnessCallbacks.forEach((callback) => {
        try {
          callback(snapshot);
        } catch (error) {
          console.warn('[NativeAudio] Robustness listener callback failed:', error);
        }
      });
    } finally {
      this.robustnessEmissionInProgress = false;
    }

    if (this.robustnessEmissionPendingForce) {
      const nextForce = this.robustnessEmissionPendingForce;
      this.robustnessEmissionPendingForce = false;
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(() => this.emitRobustnessSnapshot(nextForce));
      } else {
        void Promise.resolve().then(() => this.emitRobustnessSnapshot(nextForce));
      }
    }
  }

  // ===== Helpers =====
  private updateState(partial: Partial<AudioState>, options?: { emitStateChange?: boolean }) {
    const nextState: AudioState = { ...this.state };
    let changed = false;

    for (const [rawKey, value] of Object.entries(partial)) {
      const key = rawKey as keyof AudioState;
      if (typeof value === 'undefined') continue;
      if (nextState[key] === value) continue;
      (nextState as unknown as Record<string, unknown>)[key as string] = value;
      changed = true;
    }

    if (!changed) return this.state;

    this.state = nextState;
    if (options?.emitStateChange !== false) {
      this.stateChangeCallbacks.forEach((cb) => cb(this.state));
    }
    return this.state;
  }

  private ensureFallbackTicker() {
    if (typeof window === 'undefined') return;
    if (this.fallbackTicker !== null) return;

    this.fallbackTicker = window.setInterval(() => {
      if (this.state.playbackState !== 'playing') return;

      const now = performance.now();
      if (now - this.lastBackendTimeUpdateAtMs < 700) return;

      if (this.fallbackClockStartedAtMs === null) {
        this.fallbackClockBaseTimeSec = this.state.currentTime;
        this.fallbackClockStartedAtMs = now;
      }

      const predicted =
        this.fallbackClockBaseTimeSec + (now - this.fallbackClockStartedAtMs) / 1000;
      const clamped =
        this.state.duration > 0 ? Math.min(predicted, this.state.duration) : predicted;

      if (!isFinite(clamped)) return;
      if (Math.abs(clamped - this.state.currentTime) < 0.05) return;

      const nextState = this.updateState({ currentTime: clamped });
      this.timeUpdateCallbacks.forEach((cb) => cb(nextState.currentTime));
    }, 250);
  }

  private stopFallbackTicker() {
    if (this.fallbackTicker === null) return;
    window.clearInterval(this.fallbackTicker);
    this.fallbackTicker = null;
  }

  private getTrackPath(track: Track): string | null {
    return track.filePath ?? track.path ?? track.originalPath ?? null;
  }

  private buildQueuePaths(queue: Track[]): string[] {
    return queue.map((track) => this.getTrackPath(track)).filter(Boolean) as string[];
  }

  private syncQueueToNative(queue: Track[] = this.state.queue, currentIndex = this.state.currentIndex): void {
    void invoke('native_audio_sync_queue', {
      queue: this.buildQueuePaths(queue),
      currentIndex,
    }).catch((error) => {
      console.warn('[NativeAudio] Failed to sync queue state:', error);
    });
  }

  private resolveQueueFromPaths(queuePaths: string[]): Track[] {
    const pathToTrack = new Map<string, Track>();
    for (const track of this.state.queue) {
      const path = this.getTrackPath(track);
      if (!path) continue;
      if (!pathToTrack.has(path)) {
        pathToTrack.set(path, track);
      }
    }

    return queuePaths.map((trackPath) => {
      const existing = pathToTrack.get(trackPath);
      if (existing) return existing;

      return {
        id: `native-${trackPath}`,
        title: this.deriveTitleFromPath(trackPath),
        filePath: trackPath,
        path: trackPath,
        originalPath: trackPath,
      };
    });
  }

  private isSameQueuePaths(queuePaths: string[]): boolean {
    const queue = this.state.queue;
    if (queuePaths.length !== queue.length) return false;

    for (let index = 0; index < queuePaths.length; index += 1) {
      if (this.getTrackPath(queue[index]) !== queuePaths[index]) {
        return false;
      }
    }

    return true;
  }

  private emitError(error: Error) {
    this.updateState({ playbackState: 'error' });
    this.errorCallbacks.forEach((cb) => cb(error));

    const coded = error as Error & { code?: string };
    const code = typeof coded.code === 'string' ? coded.code : '';
    if (code === 'NATIVE_AUDIO_OUTPUT_ERROR' || code === 'NATIVE_AUDIO_REBUILD_SINK_FAILED') {
      const effective = this.getEffectiveDynamicSrcTiming();
      this.maybeAutoSwitchOutputBackend(`output-error:${code}`);
      this.withDynamicSrcHold(
        `output-error:${code}`,
        effective.outputErrorHoldMs
      );
    }

    this.emitRobustnessSnapshot(true);
  }

  private async setupNativeListeners() {
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
        if (typeof next.duration !== 'undefined') update.duration = next.duration;
        if (typeof next.bufferedTime !== 'undefined') update.bufferedTime = next.bufferedTime;
        if (typeof next.bufferedAhead !== 'undefined') update.bufferedAhead = next.bufferedAhead;

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

          if (next.trackPath && next.trackPath !== currentTrackPath) {
            const resolved = this.resolveTrackFromPath(next.trackPath);
            if (resolved) {
              update.currentTrack = resolved.track;
              update.currentIndex = resolved.index;
            } else {
              update.currentTrack = {
                id: `native-${next.trackPath}`,
                title: this.deriveTitleFromPath(next.trackPath),
                filePath: next.trackPath,
                path: next.trackPath,
                originalPath: next.trackPath,
              };
            }
          } else if (!next.trackPath && currentTrackPath) {
            update.currentTrack = null;
          }
        }

        const transientOnlyStateUpdate =
          Object.keys(update).length > 0 &&
          Object.keys(update).every(
            (key) => key === 'currentTime' || key === 'bufferedTime' || key === 'bufferedAhead'
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
          this.timeUpdateCallbacks.forEach((cb) => cb(nextCurrentTime));
        }
        if (next.ended) {
          this.endedCallbacks.forEach((cb) => cb());
          void this.handleTrackEnded();
        }

        if (merged.playbackState === 'playing' || merged.playbackState === 'buffering') {
          const nowMs = Date.now();
          const stressScore = this.getEffectiveDynamicSrcTiming(nowMs).stressScore;
          this.updateDynamicSrcLearningFromStress(stressScore, nowMs);
        }

        this.maybeReleaseUnderrunRecovery(merged.playbackState);
        this.emitRobustnessSnapshot();
      });

      this.spectrumListener = await listen('native_audio_spectrum', (event) => {
        const payload = event.payload as NativeAudioSpectrumPayload;
        if (!payload?.bins || !Array.isArray(payload.bins)) return;
        const bins = payload.bins;

        if (!this.spectrumData || this.spectrumData.length !== bins.length) {
          this.spectrumData = new Uint8Array(bins.length);
        }
        const next = this.spectrumData;

        for (let i = 0; i < bins.length; i++) {
          const value = typeof bins[i] === 'number' ? bins[i] : 0;
          const clamped = Math.max(0, Math.min(1, value));
          next[i] = Math.round(clamped * 255);
        }

        const tap =
          payload.tapId === 'pre-dsp' || payload.tap === 'pre-dsp'
            ? 'pre-dsp'
            : payload.tapId === 'post-dsp' || payload.tap === 'post-dsp'
              ? 'post-dsp'
              : null;
        if (!tap) return;

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

        this.spectrumFrames[tap] = {
          frameId,
          timestampMs,
          tap,
          sampleRate,
          bins: new Uint8Array(next),
        };
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
      console.warn('[NativeAudio] Failed to register state listener:', error);
    }
  }

  private restoreOutputBackendFromStorage() {
    if (this.restoredOutputBackend) return;
    this.restoredOutputBackend = true;

    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_BACKEND);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      const backendId = this.sanitizeBackendId(parsed);
      if (!backendId) return;

      this.currentOutputBackendId = backendId;
      return this.selectOutputBackendInternal(backendId, { persist: false, clearDevice: false })
        .then(() => {})
        .catch(() => {});
    } catch {
      // ignore
    }
  }

  private restoreOutputDeviceFromStorage() {
    if (this.restoredOutputDevice) return;
    this.restoredOutputDevice = true;

    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_DEVICE);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;

      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        const deviceId = typeof record.id === 'string' && record.id.length > 0 ? record.id : null;
        const deviceName = typeof record.name === 'string' && record.name.length > 0 ? record.name : null;
        if (deviceId || deviceName) {
          return invoke('native_audio_select_device', { deviceId, deviceName })
            .then(() => {})
            .catch(() => {});
        }
        return;
      }

      const deviceName = typeof parsed === 'string' ? parsed : null;
      if (!deviceName) return;
      return invoke('native_audio_select_device', { deviceId: null, deviceName })
        .then(() => {})
        .catch(() => {});
    } catch {
      // ignore
    }
  }

  private restoreAudioInputFromStorage() {
    if (this.restoredInputId) return;
    this.restoredInputId = true;

    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_INPUT_ID);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      const inputId = typeof parsed === 'string' ? parsed : null;
      if (!inputId) return;

      return invoke('native_audio_select_audio_input', { inputId })
        .then(() => {})
        .catch(() => {});
    } catch {
      // ignore
    }
  }

  private restoreGainDbFromStorage() {
    if (this.restoredGainDb) return;
    this.restoredGainDb = true;
    if (this.restoredDspChainApplied) return;

    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_GAIN_DB);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      const db = typeof parsed === 'number' ? parsed : null;
      if (db === null) return;
      return invoke('native_audio_set_gain', { db })
        .then(() => {})
        .catch(() => {});
    } catch {
      // ignore
    }
  }

  private restoreDspChainFromStorage() {
    if (this.restoredDspChain) return;
    this.restoredDspChain = true;

    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_DSP_CHAIN);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      return invoke('native_audio_set_dsp_chain', { chain: parsed })
        .then(() => {
          this.restoredDspChainApplied = true;
        })
        .catch(() => {});
    } catch {
      // ignore
    }
  }

  private deriveTitleFromPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const segments = normalized.split('/');
    return segments[segments.length - 1] || 'Unknown Track';
  }

  enterProtectionWindow(options?: AudioProtectionWindowOptions): () => void {
    const nowMs = Date.now();
    const durationMsRaw =
      typeof options?.durationMs === 'number' && isFinite(options.durationMs)
        ? Math.max(1_000, Math.min(NativeAudioService.PROTECTION_WINDOW_MAX_MS, options.durationMs))
        : NativeAudioService.PROTECTION_WINDOW_DEFAULT_MS;
    const reasonRaw = typeof options?.reason === 'string' ? options.reason.trim() : '';
    const reason = reasonRaw.length > 0 ? reasonRaw : 'general';

    this.protectionWindowRefCount += 1;
    this.protectionWindowReason = reason;
    this.protectionWindowUntilMs = Math.max(this.protectionWindowUntilMs, nowMs + durationMsRaw);
    this.applyStreamingBufferPolicy(true);
    this.withDynamicSrcHold(`protection-window:${reason}`, durationMsRaw);
    this.emitRobustnessSnapshot(true);

    let released = false;
    return () => {
      if (released) return;
      released = true;

      this.protectionWindowRefCount = Math.max(0, this.protectionWindowRefCount - 1);
      if (this.protectionWindowRefCount === 0) {
        this.scheduleProtectionWindowExpiry();
      }

      this.applyStreamingBufferPolicy(true);
      this.scheduleDynamicSrcRestoreEvaluation();
      this.emitRobustnessSnapshot(true);
    };
  }

  getRobustnessSnapshot(): AudioRobustnessSnapshot {
    return this.buildRobustnessSnapshot();
  }

  onRobustnessSnapshot(callback: (snapshot: AudioRobustnessSnapshot) => void): () => void {
    this.robustnessCallbacks.add(callback);
    callback(this.buildRobustnessSnapshot());
    return () => {
      this.robustnessCallbacks.delete(callback);
    };
  }

  private resolveTrackFromPath(trackPath: string): { track: Track; index: number } | null {
    const index = this.state.queue.findIndex((track) => {
      const candidates = [track.filePath, track.path, track.originalPath].filter(Boolean) as string[];
      return candidates.includes(trackPath);
    });
    if (index === -1) return null;
    return { track: this.state.queue[index], index };
  }

  private async handleTrackEnded(): Promise<void> {
    const { playMode, queue, currentIndex } = this.state;
    if (!queue.length) return;

    switch (playMode) {
      case 'single-loop': {
        const index =
          currentIndex >= 0 && currentIndex < queue.length
            ? currentIndex
            : Math.max(0, queue.findIndex((track) => track.id === this.state.currentTrack?.id));
        await this.playTrackAtIndex(index);
        return;
      }
      case 'loop': {
        if (currentIndex < queue.length - 1) {
          await this.playNext();
        } else {
          await this.playTrackAtIndex(0);
        }
        return;
      }
      case 'sequence': {
        if (currentIndex < queue.length - 1) {
          await this.playNext();
        } else {
          this.stop();
        }
        return;
      }
      case 'shuffle': {
        if (queue.length > 1) {
          await this.playNext();
        } else {
          this.stop();
        }
      }
    }
  }

  private applyPlaybackStateSideEffects(playbackState: PlaybackState) {
    if (playbackState === 'playing' || playbackState === 'paused' || playbackState === 'idle') {
      this.scheduleDynamicSrcRestoreEvaluation();
    }
  }

  private async invokeCommand<T = void>(cmd: string, payload?: Record<string, unknown>): Promise<T> {
    try {
      return await invoke<T>(cmd, payload);
    } catch (error) {
      const message = error instanceof Error ? error : new Error(String(error));
      this.emitError(message);
      throw message;
    }
  }

  // ===== 闂傚倸鍊搁崐椋庣矆娴ｉ潻鑰块梺顒€绉甸幆鐐哄箹濞ｎ剙濡奸柛灞诲妼闇夐柣妯烘▕閸庡繑淇婇锛ｎ亪濡撮幒鎴僵闁挎繂鎳嶆竟鏇熶繆閵堝洤啸闁稿鍋熼弫顕€鎮㈡俊鎾虫喘瀵濡烽敂鎯у箞?=====
  private async loadTrackInternal(track: Track): Promise<boolean> {
    this.clearPendingSeek();
    if (!track) return false;

    const trackPath = this.getTrackPath(track);
    if (!trackPath || !this.isProbablyAbsolutePath(trackPath)) {
      const error = new Error(
        'Native audio requires an absolute file path. This track has no filePath (likely added via File System Access API).'
      ) as Error & { code?: string };
      error.code = !trackPath ? 'NATIVE_TRACK_PATH_MISSING' : 'NATIVE_TRACK_PATH_NOT_ABSOLUTE';
      this.emitError(error);
      return false;
    }

    let queue = this.state.queue;
    let index = queue.findIndex((entry) => this.getTrackPath(entry) === trackPath);
    if (index === -1) {
      queue = [...queue, track];
      index = queue.length - 1;
    }

    const nextState = this.updateState({
      currentTrack: track,
      queue,
      currentIndex: index,
      playbackState: 'loading',
      duration: track.duration ?? 0,
      currentTime: 0,
      bufferedTime: 0,
      bufferedAhead: 0,
    });
    this.timeUpdateCallbacks.forEach((cb) => cb(nextState.currentTime));

    this.syncQueueToNative(queue, index);

    try {
      await this.applyReplayGainForTrack(track);
      await this.invokeCommand('native_audio_load', { path: trackPath });
    } catch {
      // invokeCommand already emits error; report failure to callers so they can avoid follow-up commands.
      return false;
    }

    this.updateState({
      playbackState: 'paused',
      currentTime: 0,
    });
    return true;
  }

  async loadTrack(track: Track): Promise<void> {
    try {
      await this.loadTrackInternal(track);
    } catch {
      // loadTrackInternal avoids rejections; keep this as a final guard for UI call sites.
    }
  }

  async play(): Promise<void> {
    try {
      if (!this.state.currentTrack) {
        const queue = this.state.queue;
        if (queue.length === 0) return;

        const currentIndex = this.state.currentIndex;
        const targetIndex = currentIndex >= 0 && currentIndex < queue.length ? currentIndex : 0;
        await this.playTrackAtIndex(targetIndex);
        return;
      }
      await this.invokeCommand('native_audio_play');
    } catch {
      // invokeCommand already emits error; swallow to avoid unhandled rejections in UI call sites.
    }
  }

  async pause(): Promise<void> {
    try {
      await this.invokeCommand('native_audio_pause');
      const nextState = this.updateState({ playbackState: 'paused' });
      this.fallbackClockBaseTimeSec = nextState.currentTime;
      this.fallbackClockStartedAtMs = null;
      this.applyPlaybackStateSideEffects(nextState.playbackState);
    } catch {
      // invokeCommand already emits error; swallow to avoid unhandled rejections in UI call sites.
    }
  }

  stop(): void {
    this.clearPendingSeek();
    this.fireAndForgetCommand('native_audio_stop');
    this.updateState({ playbackState: 'stopped', currentTime: 0 });
    this.fallbackClockBaseTimeSec = 0;
    this.fallbackClockStartedAtMs = null;
    this.timeUpdateCallbacks.forEach((cb) => cb(0));
  }

  seek(time: number): void {
    const duration = this.state.duration || time;
    const clamped = Math.max(0, Math.min(time, duration));
    this.markPendingSeekGuard(clamped);
    this.pendingSeekTime = clamped;
    const effective = this.getEffectiveDynamicSrcTiming();
    this.withDynamicSrcHold('seek', effective.seekHoldMs);
    this.scheduleSeekFlush();
    const nextState = this.updateState({ currentTime: clamped });
    this.fallbackClockBaseTimeSec = clamped;
    this.fallbackClockStartedAtMs = nextState.playbackState === 'playing' ? performance.now() : null;
    if (nextState.playbackState === 'playing') {
      this.ensureFallbackTicker();
    }
    this.timeUpdateCallbacks.forEach((cb) => cb(clamped));
  }

  // ===== 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸劍閺呮繈鏌曟径娑橆洭缂佺姵鍎抽埞鎴︽偐閸欏鎮欓梻鍌氬亞閸ㄨ京鎹㈠☉姗嗗晠妞ゆ棁宕甸惄搴ｇ磽娴ｅ搫孝缁剧虎鍙冮獮澶岀矙濞嗘儳鎮戞繝銏ｆ硾閿曘儱危?=====
  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.fireAndForgetCommand('native_audio_set_volume', { volume: clamped });
    this.updateState({ volume: clamped, muted: clamped === 0 ? true : this.state.muted });
  }

  getVolume(): number {
    return this.state.volume;
  }

  toggleMute(): void {
    const muted = !this.state.muted;
    this.fireAndForgetCommand('native_audio_set_mute', { muted });
    this.updateState({ muted });
  }

  // ===== 闂傚倸鍊搁崐鐑芥嚄閸撲礁鍨濇い鏍亹閳ь剨绠撳畷濂稿Ψ閵夛附袣闂備礁鎼粙渚€宕㈡總鍛婂€块柛顭戝亖娴滄粓鏌熸潏鍓хɑ缁绢厼鐖奸弻娑㈠棘鐠恒剱褔鏌″畝瀣М妤犵偞鐟╁畷鐔碱敇閻欏懐鍚归梻?=====
  getCurrentTime(): number {
    return this.state.currentTime;
  }

  getDuration(): number {
    return this.state.duration;
  }

  getState(): AudioState {
    return this.state;
  }

  // ===== 婵犵數濮烽弫鎼佸磻濞戙垺鍋ら柕濞у啫鐏婇悗鍏夊亾闁告洖鐏氶弲鐐烘⒑閸涘﹥澶勯柛瀣у亾闂佸搫顑呴柊锝夊蓟閺囷紕鐤€閻庯綆浜栭崑鎾诲冀椤撶偟锛熼柟鍏肩暘閸斿秹鎮″▎鎾村€垫繛鎴炵懐閻掔晫绱掗悩宕囧⒌闁?=====
  onTimeUpdate(callback: (time: number) => void): () => void {
    this.timeUpdateCallbacks.add(callback);
    return () => this.timeUpdateCallbacks.delete(callback);
  }

  onEnded(callback: () => void): () => void {
    this.endedCallbacks.add(callback);
    return () => this.endedCallbacks.delete(callback);
  }

  onStateChange(callback: StateListener): () => void {
    this.stateChangeCallbacks.add(callback);
    callback(this.state);
    return () => this.stateChangeCallbacks.delete(callback);
  }

  onLoadProgress(callback: (progress: number) => void): () => void {
    this.loadProgressCallbacks.add(callback);
    return () => this.loadProgressCallbacks.delete(callback);
  }

  onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }

  // ===== 闂傚倸鍊搁崐椋庣矆娴ｉ潻鑰块梺顒€绉甸幆鐐哄箹濞ｎ剙濡奸柛灞诲妼闇夐柣妯烘▕閸庡繑淇婇锛ｎ亪濡撮幒鎴僵闁挎繂鎳嶆竟鏇熺節濞堝灝鏋涢柨鏇樺€濇俊鍫曞箹娴ｅ摜鐣洪梺闈涚箳婵兘寮崇€ｎ喗鐓欐繛鍫濈仢閺嬫瑧绱?=====
  addToQueue(track: Track): void {
    if (!track) return;
    const queue = [...this.state.queue, track];
    this.updateState({ queue });
    this.syncQueueToNative(queue, this.state.currentIndex);
  }

  addMultipleToQueue(tracks: Track[]): void {
    if (!tracks.length) return;
    const queue = [...this.state.queue, ...tracks];
    this.updateState({ queue });
    this.syncQueueToNative(queue, this.state.currentIndex);
  }

  removeFromQueue(index: number): void {
    const queue = [...this.state.queue];
    queue.splice(index, 1);
    const currentIndex =
      this.state.currentIndex >= queue.length ? queue.length - 1 : this.state.currentIndex;
    this.updateState({ queue, currentIndex });
    this.syncQueueToNative(queue, currentIndex);
  }

  clearQueue(): void {
    this.clearPendingSeek();
    this.updateState({
      queue: [],
      currentIndex: -1,
      currentTrack: null,
      playbackState: 'stopped',
      currentTime: 0,
    });
    this.syncQueueToNative([], -1);
    this.fireAndForgetCommand('native_audio_stop');
    this.timeUpdateCallbacks.forEach((cb) => cb(0));
  }

  getQueue(): Track[] {
    return this.state.queue;
  }

  async playTrackAtIndex(index: number): Promise<void> {
    if (index < 0 || index >= this.state.queue.length) return;
    this.clearPendingSeek();
    this.desiredPlayIndex = index;

    const run = async () => {
      const targetIndex = this.desiredPlayIndex;
      if (typeof targetIndex !== 'number') return;
      this.desiredPlayIndex = null;
      await this.playTrackAtIndexOnce(targetIndex);
    };

    this.playIndexQueue = this.playIndexQueue.then(run, run);
    try {
      await this.playIndexQueue;
    } catch {
      // invokeCommand already emits error; swallow to avoid unhandled rejections in UI call sites.
    }
  }

  private async playTrackAtIndexOnce(index: number): Promise<void> {
    try {
      if (index < 0 || index >= this.state.queue.length) return;
      const wasPlaying = this.state.playbackState === 'playing';
      const previousIndex = this.state.currentIndex;
      const track = this.state.queue[index];
      this.updateState({ currentIndex: index });
      this.syncQueueToNative(this.state.queue, index);

      const crossfade = this.readCrossfadeSettings();
      const shouldCrossfade =
        wasPlaying && crossfade.enabled && crossfade.durationMs > 0 && index !== previousIndex;

      if (shouldCrossfade) {
        const trackPath = this.getTrackPath(track);
        if (!trackPath || !this.isProbablyAbsolutePath(trackPath)) {
          const error = new Error(
            'Native audio requires an absolute file path. This track has no filePath (likely added via File System Access API).'
          ) as Error & { code?: string };
          error.code = !trackPath ? 'NATIVE_TRACK_PATH_MISSING' : 'NATIVE_TRACK_PATH_NOT_ABSOLUTE';
          this.emitError(error);
          return;
        }

        const nextState = this.updateState({
          currentTrack: track,
          playbackState: 'loading',
          duration: track.duration ?? 0,
          currentTime: 0,
          bufferedTime: 0,
          bufferedAhead: 0,
        });
        this.timeUpdateCallbacks.forEach((cb) => cb(nextState.currentTime));

        await this.applyReplayGainForTrack(track);
        await this.invokeCommand('native_audio_crossfade_to', {
          path: trackPath,
          durationMs: crossfade.durationMs,
        });
        return;
      }

      const loaded = await this.loadTrackInternal(track);
      if (!loaded) return;
      await this.play();
    } catch {
      // invokeCommand already emits error; swallow to avoid breaking the coalescing queue.
    }
  }

  reorderQueue(fromIndex: number, toIndex: number): void {
    const queue = [...this.state.queue];
    if (
      fromIndex < 0 ||
      fromIndex >= queue.length ||
      toIndex < 0 ||
      toIndex >= queue.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const [moved] = queue.splice(fromIndex, 1);
    queue.splice(toIndex, 0, moved);

    let currentIndex = this.state.currentIndex;
    if (currentIndex === fromIndex) {
      currentIndex = toIndex;
    } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
      currentIndex--;
    } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
      currentIndex++;
    }

    this.updateState({ queue, currentIndex });
    this.syncQueueToNative(queue, currentIndex);
  }

  async playPrevious(): Promise<void> {
    const { playMode, queue, currentIndex } = this.state;
    if (!queue.length) return;

    if (playMode === 'shuffle') {
      const randomIndex = Math.floor(Math.random() * queue.length);
      await this.playTrackAtIndex(randomIndex);
      return;
    }

    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = playMode === 'loop' ? queue.length - 1 : 0;
    }
    await this.playTrackAtIndex(prevIndex);
  }

  async playNext(): Promise<void> {
    const { playMode, queue, currentIndex } = this.state;
    if (!queue.length) return;

    if (playMode === 'shuffle') {
      const randomIndex = Math.floor(Math.random() * queue.length);
      await this.playTrackAtIndex(randomIndex);
      return;
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex < queue.length) {
      await this.playTrackAtIndex(nextIndex);
      return;
    }
    if (playMode === 'loop') {
      await this.playTrackAtIndex(0);
      return;
    }
  }

  // ===== 闂傚倸鍊搁崐椋庣矆娴ｉ潻鑰块梺顒€绉甸幆鐐哄箹濞ｎ剙濡奸柛灞诲妼闇夐柣妯烘▕閸庡繑淇婇锛ｎ亪婀侀梺鎸庣箓閻楀棝鍩€椤戣法鐭欓柟顔哄灲閹剝鎯旈敐鍕闂佽姘﹂～澶娒洪弽顬℃椽濡搁埞搴撳亾?=====
  setPlayMode(mode: PlayMode): void {
    this.updateState({ playMode: mode });
  }

  getPlayMode(): PlayMode {
    return this.state.playMode;
  }

  fastForward(seconds: number): void {
    const nextTime = Math.min(this.state.currentTime + seconds, this.state.duration);
    this.seek(nextTime);
  }

  rewind(seconds: number): void {
    const nextTime = Math.max(this.state.currentTime - seconds, 0);
    this.seek(nextTime);
  }

  // ===== 闂傚倸鍊搁崐椋庣矆娴ｉ潻鑰块梺顒€绉甸幆鐐哄箹濞ｎ剙濡奸柛灞诲妼闇夐柣妯烘▕閸庡繑淇婇锛ｎ亪濡撮幒鎴僵闁挎繂鎳嶆竟鏇㈡煟鎼淬値娼愭繛鍙夛耿閹虫繈骞戦幇顔荤胺闂傚倷绀侀幉鈥趁哄澶婃濞撴埃鍋撶€规洘鍨块獮妯兼嫚閼碱剦妲版俊鐐€曠换鎰涢弮鍌滅當濠㈣埖鍔栭埛鎴︽煙缁嬫寧鎹ｉ柍钘夘樀閹顫濋悡搴＄睄閻?=====
  createPlaylist(name: string, description?: string): Playlist {
    const playlist: Playlist = {
      id: `playlist-${Date.now()}`,
      name,
      description,
      tracks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      trackCount: 0,
      totalDuration: 0,
    };

    const playlists = [...this.state.playlists, playlist];
    this.updateState({ playlists });
    return playlist;
  }

  deletePlaylist(playlistId: string): void {
    const playlists = this.state.playlists.filter((pl) => pl.id !== playlistId);
    const currentPlaylist =
      this.state.currentPlaylist?.id === playlistId ? null : this.state.currentPlaylist;
    this.updateState({ playlists, currentPlaylist });
  }

  renamePlaylist(playlistId: string, newName: string): void {
    const playlists = this.state.playlists.map((pl) =>
      pl.id === playlistId ? { ...pl, name: newName, updatedAt: Date.now() } : pl
    );
    this.updateState({ playlists });
  }

  getPlaylists(): Playlist[] {
    return this.state.playlists;
  }

  getPlaylist(playlistId: string): Playlist | null {
    return this.state.playlists.find((pl) => pl.id === playlistId) ?? null;
  }

  addTrackToPlaylist(playlistId: string, track: Track): void {
    const playlists = this.state.playlists.map((pl) => {
      if (pl.id !== playlistId) return pl;
      const tracks = [...pl.tracks, track];
      return {
        ...pl,
        tracks,
        trackCount: tracks.length,
        totalDuration: (pl.totalDuration ?? 0) + (track.duration ?? 0),
        updatedAt: Date.now(),
      };
    });
    this.updateState({ playlists });
  }

  removeTrackFromPlaylist(playlistId: string, trackIndex: number): void {
    const playlists = this.state.playlists.map((pl) => {
      if (pl.id !== playlistId) return pl;
      const tracks = [...pl.tracks];
      const [removed] = tracks.splice(trackIndex, 1);
      return {
        ...pl,
        tracks,
        trackCount: tracks.length,
        totalDuration: (pl.totalDuration ?? 0) - (removed?.duration ?? 0),
        updatedAt: Date.now(),
      };
    });
    this.updateState({ playlists });
  }

  clearPlaylist(playlistId: string): void {
    const playlists = this.state.playlists.map((pl) =>
      pl.id === playlistId
        ? { ...pl, tracks: [], trackCount: 0, totalDuration: 0, updatedAt: Date.now() }
        : pl
    );
    this.updateState({ playlists });
  }

  async playPlaylist(playlistId: string): Promise<void> {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist || playlist.tracks.length === 0) return;
    this.clearQueue();
    this.addMultipleToQueue(playlist.tracks);
    await this.playTrackAtIndex(0);
    this.updateState({ currentPlaylist: playlist });
  }

  addPlaylistToQueue(playlistId: string): void {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) return;
    this.addMultipleToQueue(playlist.tracks);
  }

  // ===== 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸劍閺呮繈鏌曟径娑橆洭缂佺姵鍎抽埞鎴︽偐閸欏鍋嶉梺閫炲苯澧柛濠傜仢閻ｉ攱绺界粙鍨祮闂佺粯鍔楅弫鎼佸储椤掍椒绻嗛柣鎰典簻閳ь剚鐗犻幃褍螖閸愨晛搴婇悗骞垮劚閹峰鎮炴禒瀣厵闁绘垶锕╁▓鏇㈡煟?(placeholder) =====
  getFrequencyData(): Uint8Array | null {
    return this.spectrumData;
  }

  getSpectrumFrame(tap: AudioSpectrumTap = 'post-dsp'): AudioSpectrumFrame | null {
    return this.spectrumFrames[tap] ?? null;
  }

  // ===== 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈缁犱即鏌熼梻瀵割槮缂佺姷濞€閺岀喖鎮ч崼鐔哄嚒缂?=====
  destroy(): void {
    this.stop();
    this.stopFallbackTicker();
    this.clearProtectionWindowTimer();
    this.clearDynamicSrcRestoreTimer();
    this.clearDynamicSrcLearningPersistTimer();
    this.protectionWindowUntilMs = 0;
    this.protectionWindowRefCount = 0;
    this.protectionWindowReason = null;
    this.dynamicSrcHoldUntilMs = 0;
    this.dynamicSrcSettingsListenerCleanup?.();
    this.dynamicSrcSettingsListenerCleanup = null;
    this.dynamicSrcSettingsListenerInitPromise = null;
    this.timeUpdateCallbacks.clear();
    this.endedCallbacks.clear();
    this.stateChangeCallbacks.clear();
    this.loadProgressCallbacks.clear();
    this.errorCallbacks.clear();
    this.robustnessCallbacks.clear();
    this.robustnessEmissionPendingForce = false;
    this.robustnessEmissionInProgress = false;
    this.visibilityListenerCleanup?.();
    this.visibilityListenerCleanup = null;
    this.visibilityListenerAttached = false;
    if (this.stateListener) {
      this.stateListener();
      this.stateListener = undefined;
    }
    if (this.spectrumListener) {
      this.spectrumListener();
      this.spectrumListener = undefined;
    }
    if (this.errorListener) {
      this.errorListener();
      this.errorListener = undefined;
    }
    this.spectrumData = null;
    this.spectrumFrames = {};
  }
}
