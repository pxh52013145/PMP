import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  AudioDynamicSrcAdaptiveProfile,
  AudioDynamicSrcDegradationLevel,
  AudioDynamicSrcAutoSettingsPatch,
  AudioDynamicSrcAutoSettings,
  AudioEnginePolicyPatch,
  AudioProtectionWindowOptions,
  AudioRobustnessSnapshot,
  AudioTuningAutoSettings,
  AudioTuningAutoSettingsPatch,
  AudioTuningProfileId,
  AudioSpectrumFrame,
  AudioSpectrumTap,
  AudioState,
  IAudioService,
  PlayMode,
  Playlist,
  PlaylistCreateOptions,
  Track,
  PlaybackState,
} from './types';
import {
  broadcastDataUpdate,
  setupDualListener,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  getTrackPathForIdentity,
  normalizeTrackIdentityForCompare as normalizeTrackIdentityForCompareUtil,
  normalizeTrackPathForCompare as normalizeTrackPathForCompareUtil,
  prependTrackWithDedup,
} from './trackIdentity';
import {
  BILIBILI_PLATFORM_CONNECTOR_ID,
  resolvePlatformPlaybackIdentity,
} from './platformPlaybackResolver';
import {
  resolveDynamicSrcAutoDegradationState,
  toDynamicSrcAutoDegradationLabel,
} from './robustnessDegradation';
import {
  getDynamicSrcAdaptiveScale,
  resolveDynamicSrcAdaptiveProfile,
  resolveDynamicSrcEffectiveTiming,
} from './dynamicSrcAdaptiveTiming';
import {
  isSameStreamingBufferSettings,
  resolveStreamingBufferPolicyTarget,
  type StreamingBufferSettings,
} from './streamingBufferPolicy';
import {
  createAudioTuningControllerState,
  resolveAudioTuningProfilePayload,
  resolveAudioTuningTransition,
} from './audioTuningProfiles';
import {
  deleteNativeLibraryPlaylist,
  markNativeLibraryUserEntryPlayed,
  queryNativeLibraryTracks,
  listNativeLibraryPlaylistItems,
  listNativeLibraryPlaylists,
  prepareNativeBilibiliCachedPlayback,
  replaceNativeLibraryPlaylistItems,
  touchNativeLibraryPlaylistOpened,
  upsertNativeLibraryUserEntry,
  upsertNativeLibraryPlaylist,
  type NativeLibraryPlaylistItemRecord,
} from '../../modules/music-library';
import { readString } from '../../modules/storage';
import {
  getAudioPerformanceTelemetrySnapshot,
  recordRecentPlaylistWriteFlushed,
  recordRecentPlaylistWriteScheduled,
} from './audioPerformanceTelemetry';
import {
  applyRecentSmartPlaylistSnapshotToState,
  compactTrackForRecentPlaylist,
  mergeRecentSmartPlaylistTracks,
  toPlaylistItemUpserts,
  type RecentSmartPlaylistWriteEntry,
} from './recentSmartPlaylist';

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

type RuntimeControlSettings = {
  dynamicGainEnabled: boolean;
  volumeDebounceEnabled: boolean;
};

function parseLegacyRuntimeControlFromReplayGain(raw: string | null): RuntimeControlSettings | null {
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

type CrossfadeSettings = {
  enabled: boolean;
  durationMs: number;
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
  private tuningAutoSettingsListenerCleanup: (() => void) | null = null;
  private tuningAutoSettingsListenerInitPromise: Promise<void> | null = null;
  private spectrumData: Uint8Array | null = null;
  private spectrumFrames: Partial<Record<AudioSpectrumTap, AudioSpectrumFrame>> = {};
  private spectrumEnabled = false;
  private spectrumEnablePending = false;
  private spectrumDisableTimer: number | null = null;
  private lastSpectrumTouchAtMs = 0;
  private lastPlaybackActiveAtMs = 0;
  private readonly spectrumIdleTimeoutMs = 2500;
  private readonly spectrumPlaybackGraceMs = 4000;
  private restoredOutputBackend = false;
  private restoredOutputDevice = false;
  private restoredInputId = false;
  private restoredStreamingBufferSettings = false;
  private restoredEnginePolicy = false;
  private restoredVstEnabled = false;
  private restoredDspGraph = false;
  private restoredDspChain = false;
  private restoredDspChainApplied = false;
  private restoredGainDb = false;
  private visibilityListenerAttached = false;
  private visibilityListenerCleanup: (() => void) | null = null;
  private recentSmartPlaylistWriteQueue: Promise<void> = Promise.resolve();
  private recentSmartPlaylistWriteBuffer: RecentSmartPlaylistWriteEntry[] = [];
  private recentSmartPlaylistWriteTimer: number | null = null;
  private builtinSmartPlaylistsReady = false;
  private builtinSmartPlaylistsInitPromise: Promise<void> | null = null;
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
  private pendingSeekSeq: number | null = null;
  private pendingSeekTimer: number | null = null;
  private pendingVolume: number | null = null;
  private pendingVolumeTimer: number | null = null;
  private lastVolumeDispatchAtMs = 0;
  private pendingSeekTarget: number | null = null;
  private pendingSeekDirection: 'forward' | 'backward' | null = null;
  private pendingSeekSettleUntilMs = 0;
  private activeSeekInvokeCount = 0;
  private seekCommandSeqCounter = Math.max(1, Date.now());
  private lastSeekDispatchAtMs = 0;
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
    // Default to streaming for low memory usage + fast click-to-play startup.
    // Full-track decoding can still be enabled via settings for seek/scrub-heavy workflows.
    decodeMode: 'streaming',
    interactiveProfile: 'balanced',
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
  private dynamicSrcAutoDegradationLevel: AudioDynamicSrcDegradationLevel = 0;
  private dynamicSrcAutoDegradationReason: string | null = null;
  private dynamicSrcAutoDegradationLastChangedAtMs: number | null = null;
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
  private dynamicSrcPendingPolicy: NativeAudioSrcPolicy | null = null;
  private dynamicSrcDeferredLatencyReason: string | null = null;
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
  private transferAdaptationLevel = 0;
  private transferOscillationStreak = 0;
  private renderQueuePageLocked = false;
  private transferMetricsValid = false;
  private sharedRenderAheadEnabled = false;
  private sharedRenderUnderrunEvents = 0;
  private sharedRenderUnderrunFrames = 0;
  private sharedRenderLowHitCount = 0;
  private sharedRenderLowWatermarkSamples = 0;
  private controlQueueLockFree = false;
  private controlQueueMode = 'unknown';
  private controlQueueCapacity = 0;
  private controlQueueOverwriteEvents = 0;
  private controlQueueDropNewestEvents = 0;
  private controlQueueCoalescedOverflowEvents = 0;
  private controlQueueCriticalOverflowEvents = 0;
  private diagnosticTimelineDroppedEvents = 0;
  private diagnosticTimeline: Array<{
    seq: number;
    timestampMs: number;
    kind: string;
    value: number;
    aux: number;
  }> = [];
  private diagnosticTimelineLastSeq = 0;
  private diagnosticTimelineIgnoreBeforeMs = 0;
  private sharedStressUntilMs = 0;
  private sharedStressReason: string | null = null;
  private sharedStressEscalationCount = 0;

  private static readonly SEEK_COALESCE_MS = 12;
  private static readonly SEEK_DISPATCH_MIN_INTERVAL_MS = 20;
  private static readonly SEEK_MAX_PARALLEL_INVOCATIONS = 3;
  private static readonly SEEK_STALE_GUARD_WINDOW_MS = 8_000;
  private static readonly SEEK_STALE_GUARD_TOLERANCE_SECONDS = 0.45;
  private static readonly VOLUME_COALESCE_MS = 24;
  private static readonly VOLUME_DISPATCH_MIN_INTERVAL_MS = 16;
  private static readonly UNDERRUN_RECOVERY_WINDOW_MS = 20_000;
  private static readonly AUTO_BACKEND_UNDERRUN_WINDOW_MS = 15_000;
  private static readonly AUTO_BACKEND_UNDERRUN_TRIGGER_COUNT = 3;
  private static readonly AUTO_BACKEND_UNDERRUN_FRAME_SPIKE_TRIGGER = 1024;
  private static readonly AUTO_BACKEND_SWITCH_COOLDOWN_MS = 45_000;
  private static readonly PROTECTION_WINDOW_DEFAULT_MS = 20_000;
  private static readonly PROTECTION_WINDOW_MAX_MS = 120_000;
  private static readonly ROBUSTNESS_BUFFER_WINDOW_SIZE = 48;
  private static readonly SHARED_TIMELINE_STRESS_WINDOW_MS = 12_000;
  private static readonly SHARED_TIMELINE_LOW_WATERMARK_TRIGGER = 20;
  private static readonly SHARED_TIMELINE_UNDERRUN_TRIGGER = 1;
  private static readonly SHARED_TIMELINE_STRESS_RESET_GRACE_MS = 1_500;
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
  private static readonly DYNAMIC_SRC_DEGRADATION_L2_HOLD_FLOOR_MS = 4_000;
  private static readonly TUNING_AUTO_ENABLED_DEFAULT = false;
  private static readonly TUNING_AUTO_TICK_INTERVAL_MS = 1_500;
  private static readonly TUNING_AUTO_STABLE_WINDOW_MS = 30_000;
  private static readonly TUNING_AUTO_MIN_SWITCH_INTERVAL_MS = 10_000;
  private static readonly TUNING_AUTO_POST_SWITCH_OBSERVE_WINDOW_MS = 15_000;
  private static readonly TUNING_AUTO_ELEVATED_STRESS_SCORE = 4;
  private static readonly TUNING_AUTO_CRITICAL_STRESS_SCORE = 8;
  private static readonly TUNING_AUTO_CRITICAL_UNDERRUN_EVENTS_WINDOW = 2;
  private static readonly TUNING_AUTO_CRITICAL_OVERFLOW_GROWTH_TICKS = 2;
  private static readonly PLAYLIST_OWNER_UID = 'local:default';
  private static readonly PLAYLIST_KIND_MANUAL = 'manual' as const;
  private static readonly PLAYLIST_KIND_SMART = 'smart' as const;
  private static readonly PLAYLIST_KIND_PLATFORM = 'platform' as const;
  private static readonly PLAYLIST_QUERY_LIMIT = 200;
  private static readonly SMART_PLAYLIST_RECENT_ID = 'smart-recently-played';
  private static readonly SMART_PLAYLIST_RECENT_NAME = 'Recently Played';
  private static readonly SMART_PLAYLIST_RECENT_LIMIT = 1000;
  private static readonly RECENT_SMART_PLAYLIST_WRITE_DEBOUNCE_MS = 500;
  private static readonly RECENT_SMART_PLAYLIST_MAX_BUFFERED_EVENTS = 64;

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
  private tuningAutoEnabled = NativeAudioService.TUNING_AUTO_ENABLED_DEFAULT;
  private tuningAutoTickIntervalMs = NativeAudioService.TUNING_AUTO_TICK_INTERVAL_MS;
  private tuningAutoStableWindowMs = NativeAudioService.TUNING_AUTO_STABLE_WINDOW_MS;
  private tuningAutoMinSwitchIntervalMs = NativeAudioService.TUNING_AUTO_MIN_SWITCH_INTERVAL_MS;
  private tuningAutoPostSwitchObserveWindowMs =
    NativeAudioService.TUNING_AUTO_POST_SWITCH_OBSERVE_WINDOW_MS;
  private tuningAutoElevatedStressScore = NativeAudioService.TUNING_AUTO_ELEVATED_STRESS_SCORE;
  private tuningAutoCriticalStressScore = NativeAudioService.TUNING_AUTO_CRITICAL_STRESS_SCORE;
  private tuningAutoCriticalUnderrunEventsWindow =
    NativeAudioService.TUNING_AUTO_CRITICAL_UNDERRUN_EVENTS_WINDOW;
  private tuningAutoCriticalOverflowGrowthTicks =
    NativeAudioService.TUNING_AUTO_CRITICAL_OVERFLOW_GROWTH_TICKS;
  private tuningAutoControllerState = createAudioTuningControllerState('ll-guarded');
  private tuningAutoTimer: ReturnType<typeof setInterval> | null = null;
  private tuningAutoApplyInFlight = false;
  private tuningAutoLastReason: string | null = null;
  private tuningAutoLastAppliedAtMs: number | null = null;

  private logBestEffortError(context: string, error: unknown): void {
    console.warn(`[NativeAudio] ${context} failed:`, error);
  }

  private fireAndForgetCommand(cmd: string, payload?: Record<string, unknown>): void {
    void this.invokeCommand(cmd, payload).catch((error) => {
      this.logBestEffortError(`best-effort command ${cmd}`, error);
    });
  }

  private markPlatformTrackPlayedBestEffort(track: Track, playedAtMs: number): void {
    if (!isTauriRuntime()) return;

    const identity = resolvePlatformPlaybackIdentity(track);
    if (!identity) return;

    const { sourceLocator, sourceKey, entryId } = identity;
    const title = typeof track.title === 'string' ? track.title.trim() : '';
    const artist = typeof track.artist === 'string' ? track.artist.trim() : '';

    void upsertNativeLibraryUserEntry({
      id: entryId,
      ownerUid: NativeAudioService.PLAYLIST_OWNER_UID,
      quickFingerprint: track.quickFingerprint,
      cloudContentId: sourceLocator || sourceKey,
      displayTitle: title || undefined,
      displayArtist: artist || undefined,
      inCloud: true,
      isMissing: false,
      createdAtMs: playedAtMs,
      updatedAtMs: playedAtMs,
    })
      .then((entry) => {
        if (!entry) return false;
        return markNativeLibraryUserEntryPlayed(entry.id, { playedAtMs });
      })
      .catch((error) => {
        console.warn('[NativeAudioService] failed to mark platform entry played:', error);
      });
  }

  private async resolveTrackForNativePlayback(track: Track): Promise<Track> {
    if (!isTauriRuntime()) return track;

    const identity = resolvePlatformPlaybackIdentity(track);
    if (!identity || identity.connectorId !== BILIBILI_PLATFORM_CONNECTOR_ID || !identity.sourceLocator) {
      return track;
    }

    const sourceLocator = identity.sourceLocator;

    try {
      const prepared = await prepareNativeBilibiliCachedPlayback(sourceLocator);
      const cachePath = typeof prepared?.cachePath === 'string' ? prepared.cachePath.trim() : '';
      if (!cachePath || !this.isProbablyAbsolutePath(cachePath)) {
        return track;
      }

      return {
        ...track,
        filePath: cachePath,
        path: cachePath,
        originalPath: sourceLocator,
        duration:
          typeof track.duration === 'number' && Number.isFinite(track.duration)
            ? track.duration
            : prepared?.durationSeconds,
        comment:
          typeof track.comment === 'string' && track.comment.trim().length > 0
            ? track.comment
            : sourceLocator,
      };
    } catch {
      return track;
    }
  }

  private markTrackPlayedBestEffort(track: Track): void {
    const playedAtMs = Date.now();
    this.enqueueRecentSmartPlaylistTrackBestEffort(track, playedAtMs);
    this.markPlatformTrackPlayedBestEffort(track, playedAtMs);

    const trackId = typeof track?.id === 'string' ? track.id.trim() : '';
    if (!trackId || trackId.startsWith('bilibili:')) return;

    void this.invokeCommand<boolean>('music_library_db_mark_track_played', {
      trackId,
      playedAtMs,
    })
      .catch(() => {
        // Best-effort: track playback must not be blocked by analytics/persistence failures.
      });
  }

  private parseTrackFromPlaylistPayload(
    payloadJson?: string,
    fallback?: {
      id?: string;
      title?: string;
      artist?: string;
      album?: string;
      duration?: number;
    }
  ): Track | null {
    let record: Record<string, unknown> | null = null;
    if (typeof payloadJson === 'string' && payloadJson.trim().length > 0) {
      try {
        const parsed = JSON.parse(payloadJson) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          record = parsed as Record<string, unknown>;
        }
      } catch {
        record = null;
      }
    }

    const asString = (value: unknown): string | undefined => {
      return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
    };
    const asNumber = (value: unknown): number | undefined => {
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    };

    const id = asString(record?.id) ?? fallback?.id?.trim();
    const title = asString(record?.title) ?? fallback?.title?.trim();
    if (!id || !title) return null;

    const track: Track = {
      id,
      title,
      artist: asString(record?.artist) ?? fallback?.artist,
      album: asString(record?.album) ?? fallback?.album,
      albumArtist: asString(record?.albumArtist),
      duration: asNumber(record?.duration) ?? fallback?.duration,
      path: asString(record?.path),
      filePath: asString(record?.filePath),
      originalPath: asString(record?.originalPath),
      libraryPathId: asString(record?.libraryPathId),
      mtimeMs: asNumber(record?.mtimeMs),
      quickFingerprint: asString(record?.quickFingerprint),
      coverKey: asString(record?.coverKey),
      coverUrl: asString(record?.coverUrl),
      year: asNumber(record?.year),
      genre: asString(record?.genre),
      trackNumber: asNumber(record?.trackNumber),
      discNumber: asNumber(record?.discNumber),
      composer: asString(record?.composer),
      bitrate: asNumber(record?.bitrate),
      sampleRate: asNumber(record?.sampleRate),
      replayGainTrackGainDb: asNumber(record?.replayGainTrackGainDb),
      replayGainAlbumGainDb: asNumber(record?.replayGainAlbumGainDb),
      format: asString(record?.format),
      codecName: asString(record?.codecName),
      fileSize: asNumber(record?.fileSize),
      dateAdded: asNumber(record?.dateAdded),
      lastPlayed: asNumber(record?.lastPlayed),
      playCount: asNumber(record?.playCount),
      rating: asNumber(record?.rating),
      favorite:
        typeof record?.favorite === 'boolean' ? (record.favorite as boolean) : undefined,
      tags: Array.isArray(record?.tags)
        ? (record.tags as unknown[])
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map((value) => value.trim())
        : undefined,
      lyrics: asString(record?.lyrics),
      comment: asString(record?.comment),
      mimeType: asString(record?.mimeType),
    };

    return track;
  }

  private parseTracksFromPlaylistItems(
    playlistId: string,
    items: NativeLibraryPlaylistItemRecord[]
  ): Track[] {
    const tracks: Track[] = [];
    for (const item of items) {
      const fallbackId = item.localTrackId || item.entryId || `${playlistId}::${item.position}`;
      const track = this.parseTrackFromPlaylistPayload(item.trackPayloadJson, {
        id: fallbackId,
        title: item.snapshotTitle,
        artist: item.snapshotArtist,
        album: item.snapshotAlbum,
        duration: item.snapshotDurationSeconds,
      });
      if (!track) continue;
      tracks.push(track);
    }
    return tracks;
  }

  private clearRecentSmartPlaylistWriteTimer(): void {
    if (this.recentSmartPlaylistWriteTimer === null) return;
    if (typeof window === 'undefined') {
      this.recentSmartPlaylistWriteTimer = null;
      return;
    }
    window.clearTimeout(this.recentSmartPlaylistWriteTimer);
    this.recentSmartPlaylistWriteTimer = null;
  }

  private scheduleRecentSmartPlaylistWriteFlush(): void {
    if (typeof window === 'undefined') {
      this.flushRecentSmartPlaylistWriteBufferBestEffort();
      return;
    }
    this.clearRecentSmartPlaylistWriteTimer();
    this.recentSmartPlaylistWriteTimer = window.setTimeout(() => {
      this.recentSmartPlaylistWriteTimer = null;
      this.flushRecentSmartPlaylistWriteBufferBestEffort();
    }, NativeAudioService.RECENT_SMART_PLAYLIST_WRITE_DEBOUNCE_MS);
  }

  private flushRecentSmartPlaylistWriteBufferBestEffort(): void {
    if (!isTauriRuntime()) {
      this.recentSmartPlaylistWriteBuffer = [];
      return;
    }

    if (this.recentSmartPlaylistWriteBuffer.length === 0) return;
    const bufferedEntries = this.recentSmartPlaylistWriteBuffer.splice(0);

    this.recentSmartPlaylistWriteQueue = this.recentSmartPlaylistWriteQueue
      .then(async () => {
        await this.flushRecentSmartPlaylistWriteBatch(bufferedEntries);
      })
      .catch((error) => {
        console.warn('[NativeAudioService] failed to update recent smart playlist:', error);
      })
      .finally(() => {
        if (
          this.recentSmartPlaylistWriteBuffer.length > 0 &&
          this.recentSmartPlaylistWriteTimer === null
        ) {
          this.scheduleRecentSmartPlaylistWriteFlush();
        }
      });
  }

  private async flushRecentSmartPlaylistWriteBatch(
    bufferedEntries: RecentSmartPlaylistWriteEntry[]
  ): Promise<void> {
    if (bufferedEntries.length === 0) return;

    await this.ensureBuiltinSmartPlaylistsInLibraryDb();

    const existingTracksFromState =
      this.state.playlists.find((item) => item.id === NativeAudioService.SMART_PLAYLIST_RECENT_ID)
        ?.tracks ?? [];
    const existingTracks =
      existingTracksFromState.length > 0
        ? existingTracksFromState
        : this.parseTracksFromPlaylistItems(
            NativeAudioService.SMART_PLAYLIST_RECENT_ID,
            await listNativeLibraryPlaylistItems(NativeAudioService.SMART_PLAYLIST_RECENT_ID)
          );

    const { tracks: mergedTracks, latestPlayedAtMs } = mergeRecentSmartPlaylistTracks({
      existingTracks,
      bufferedEntries,
      limit: NativeAudioService.SMART_PLAYLIST_RECENT_LIMIT,
    });

    const updatedAtMs = latestPlayedAtMs > 0 ? latestPlayedAtMs : Date.now();
    const nextRecentSnapshot = applyRecentSmartPlaylistSnapshotToState({
      playlists: this.state.playlists,
      currentPlaylist: this.state.currentPlaylist,
      tracks: mergedTracks,
      updatedAtMs,
      recentPlaylistId: NativeAudioService.SMART_PLAYLIST_RECENT_ID,
      recentPlaylistName: NativeAudioService.SMART_PLAYLIST_RECENT_NAME,
      recentPlaylistLimit: NativeAudioService.SMART_PLAYLIST_RECENT_LIMIT,
    });
    this.updateState(nextRecentSnapshot);

    const payloadPlaylist: Playlist = {
      id: NativeAudioService.SMART_PLAYLIST_RECENT_ID,
      name: NativeAudioService.SMART_PLAYLIST_RECENT_NAME,
      tracks: mergedTracks,
      kind: NativeAudioService.PLAYLIST_KIND_SMART,
      readonly: true,
      createdAt: updatedAtMs,
      updatedAt: updatedAtMs,
      trackCount: mergedTracks.length,
      totalDuration: mergedTracks.reduce((sum, item) => sum + (item.duration ?? 0), 0),
    };

    const playlistItems = toPlaylistItemUpserts(payloadPlaylist);
    await replaceNativeLibraryPlaylistItems(
      NativeAudioService.SMART_PLAYLIST_RECENT_ID,
      playlistItems
    );

    const payloadBytes = playlistItems.reduce((total, item) => {
      const jsonLength = typeof item.trackPayloadJson === 'string' ? item.trackPayloadJson.length : 0;
      return total + jsonLength;
    }, 0);
    recordRecentPlaylistWriteFlushed({
      eventCount: bufferedEntries.length,
      trackCount: mergedTracks.length,
      payloadBytes,
    });
  }

  private enqueueRecentSmartPlaylistTrackBestEffort(track: Track, playedAtMs: number): void {
    if (!isTauriRuntime()) return;
    if (!track || typeof track !== 'object') return;

    const recentTrack = compactTrackForRecentPlaylist({
      ...track,
      lastPlayed: playedAtMs,
      playCount:
        typeof track.playCount === 'number' && Number.isFinite(track.playCount)
          ? Math.max(1, Math.floor(track.playCount) + 1)
          : 1,
    });

    this.recentSmartPlaylistWriteBuffer.push({
      track: recentTrack,
      playedAtMs,
    });
    recordRecentPlaylistWriteScheduled();

    if (
      this.recentSmartPlaylistWriteBuffer.length >=
      NativeAudioService.RECENT_SMART_PLAYLIST_MAX_BUFFERED_EVENTS
    ) {
      this.clearRecentSmartPlaylistWriteTimer();
      this.flushRecentSmartPlaylistWriteBufferBestEffort();
      return;
    }

    this.scheduleRecentSmartPlaylistWriteFlush();
  }

  private isReadonlyPlaylist(playlist: Playlist | null | undefined): boolean {
    if (!playlist) return false;
    if (playlist.readonly === true) return true;
    return playlist.kind === NativeAudioService.PLAYLIST_KIND_SMART;
  }

  private persistPlaylistToLibraryDbBestEffort(playlist: Playlist): void {
    if (!isTauriRuntime()) return;

    const playlistId = String(playlist.id || '').trim();
    const playlistName = String(playlist.name || '').trim();
    if (!playlistId || !playlistName) return;

    const kind =
      playlist.kind === NativeAudioService.PLAYLIST_KIND_SMART
        ? NativeAudioService.PLAYLIST_KIND_SMART
        : playlist.kind === NativeAudioService.PLAYLIST_KIND_PLATFORM
          ? NativeAudioService.PLAYLIST_KIND_PLATFORM
          : NativeAudioService.PLAYLIST_KIND_MANUAL;

    if (kind === NativeAudioService.PLAYLIST_KIND_SMART) {
      return;
    }

    const now = Date.now();
    void upsertNativeLibraryPlaylist({
      id: playlistId,
      ownerUid: NativeAudioService.PLAYLIST_OWNER_UID,
      name: playlistName,
      description: typeof playlist.description === 'string' ? playlist.description.trim() : undefined,
      coverUrl: typeof playlist.coverUrl === 'string' ? playlist.coverUrl.trim() : undefined,
      kind,
      sourceConnectorId: playlist.sourceConnectorId,
      sourcePlaylistId: playlist.sourcePlaylistId,
      smartRuleJson: playlist.smartRuleJson,
      isReadonly: playlist.readonly === true,
      createdAtMs:
        typeof playlist.createdAt === 'number' && Number.isFinite(playlist.createdAt)
          ? Math.max(0, Math.floor(playlist.createdAt))
          : now,
      updatedAtMs:
        typeof playlist.updatedAt === 'number' && Number.isFinite(playlist.updatedAt)
          ? Math.max(0, Math.floor(playlist.updatedAt))
          : now,
    })
      .then((saved) => {
        if (!saved) return;
        return replaceNativeLibraryPlaylistItems(saved.id, toPlaylistItemUpserts(playlist));
      })
      .catch((error) => {
        console.warn('[NativeAudioService] failed to persist playlist:', playlistId, error);
      });
  }

  private deletePlaylistFromLibraryDbBestEffort(playlistId: string): void {
    if (!isTauriRuntime()) return;
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return;

    void deleteNativeLibraryPlaylist(normalizedPlaylistId).catch((error) => {
      console.warn('[NativeAudioService] failed to delete playlist from library db:', error);
    });
  }

  private touchPlaylistOpenedBestEffort(playlistId: string): void {
    if (!isTauriRuntime()) return;
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return;

    void touchNativeLibraryPlaylistOpened(normalizedPlaylistId, {
      openedAtMs: Date.now(),
    }).catch((error) => {
      console.warn('[NativeAudioService] failed to touch playlist opened timestamp:', error);
    });
  }

  private resolveRecentSmartPlaylistLimit(ruleJson?: string): number {
    const defaultLimit = NativeAudioService.SMART_PLAYLIST_RECENT_LIMIT;
    if (typeof ruleJson !== 'string' || ruleJson.trim().length === 0) return defaultLimit;
    try {
      const parsed = JSON.parse(ruleJson) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultLimit;
      const record = parsed as Record<string, unknown>;
      if (record.type !== 'recently_played') return defaultLimit;
      const limit = record.limit;
      if (typeof limit !== 'number' || !Number.isFinite(limit)) return defaultLimit;
      return Math.max(1, Math.min(5000, Math.floor(limit)));
    } catch {
      return defaultLimit;
    }
  }

  private mapNativeTrackRecordToTrack(record: {
    id: string;
    filePath: string;
    quickFingerprint?: string;
    title?: string;
    artist?: string;
    album?: string;
    genre?: string;
    durationSeconds?: number;
    sampleRate?: number;
    fileSize?: number;
    mtimeMs?: number;
    playCount: number;
    lastPlayedAtMs?: number;
  }): Track {
    const fileName = record.filePath.split(/[/\\]/).pop();
    const fallbackTitle = (fileName && fileName.trim()) || record.id;

    return {
      id: record.id,
      title: (record.title && record.title.trim()) || fallbackTitle,
      artist: record.artist,
      album: record.album,
      duration: record.durationSeconds,
      filePath: record.filePath,
      path: record.filePath,
      quickFingerprint: record.quickFingerprint,
      genre: record.genre,
      sampleRate: record.sampleRate,
      fileSize: record.fileSize,
      mtimeMs: record.mtimeMs,
      playCount: record.playCount,
      lastPlayed: record.lastPlayedAtMs,
    };
  }

  private async buildRecentSmartPlaylistTracks(limit: number): Promise<Track[]> {
    const rows = await queryNativeLibraryTracks({
      limit: Math.max(1, Math.min(2000, limit * 3)),
      includeMissing: false,
      visibleOnly: true,
      filters: [{ field: 'playCount', operator: 'gte', value: '1' }],
      sort: [
        { field: 'lastPlayedAtMs', order: 'desc' },
        { field: 'updatedAtMs', order: 'desc' },
      ],
    });

    const tracks: Track[] = [];
    const seenTrackIds = new Set<string>();
    for (const row of rows) {
      if (!row.id || seenTrackIds.has(row.id)) continue;
      if (typeof row.lastPlayedAtMs !== 'number' || !Number.isFinite(row.lastPlayedAtMs)) continue;
      tracks.push(this.mapNativeTrackRecordToTrack(row));
      seenTrackIds.add(row.id);
      if (tracks.length >= limit) break;
    }

    return tracks;
  }

  private async ensureBuiltinSmartPlaylistsInLibraryDb(): Promise<void> {
    if (this.builtinSmartPlaylistsReady) return;
    if (this.builtinSmartPlaylistsInitPromise) {
      await this.builtinSmartPlaylistsInitPromise;
      return;
    }

    this.builtinSmartPlaylistsInitPromise = (async () => {
      const records = await listNativeLibraryPlaylists({
        ownerUid: NativeAudioService.PLAYLIST_OWNER_UID,
        kind: NativeAudioService.PLAYLIST_KIND_SMART,
        limit: NativeAudioService.PLAYLIST_QUERY_LIMIT,
      });

      const recentRecord =
        records.find((item) => item.id === NativeAudioService.SMART_PLAYLIST_RECENT_ID) ?? null;
      const now = Date.now();

      await upsertNativeLibraryPlaylist({
        id: NativeAudioService.SMART_PLAYLIST_RECENT_ID,
        ownerUid: NativeAudioService.PLAYLIST_OWNER_UID,
        name: NativeAudioService.SMART_PLAYLIST_RECENT_NAME,
        kind: NativeAudioService.PLAYLIST_KIND_SMART,
        smartRuleJson: JSON.stringify({
          type: 'recently_played',
          limit: NativeAudioService.SMART_PLAYLIST_RECENT_LIMIT,
        }),
        isReadonly: true,
        createdAtMs: recentRecord?.createdAtMs ?? now,
        updatedAtMs: now,
        lastOpenedAtMs: recentRecord?.lastOpenedAtMs,
      });

      this.builtinSmartPlaylistsReady = true;
    })();

    try {
      await this.builtinSmartPlaylistsInitPromise;
    } finally {
      this.builtinSmartPlaylistsInitPromise = null;
    }
  }

  private async restorePlaylistsFromLibraryDb(): Promise<void> {
    if (!isTauriRuntime()) return;

    try {
      await this.ensureBuiltinSmartPlaylistsInLibraryDb();
      const records = await listNativeLibraryPlaylists({
        ownerUid: NativeAudioService.PLAYLIST_OWNER_UID,
        limit: NativeAudioService.PLAYLIST_QUERY_LIMIT,
      });
      if (records.length === 0) return;

      const playlists: Playlist[] = [];
      for (const record of records) {
        let tracks: Track[] = [];
        if (record.kind === NativeAudioService.PLAYLIST_KIND_SMART) {
          const limit = this.resolveRecentSmartPlaylistLimit(record.smartRuleJson);
          const items = await listNativeLibraryPlaylistItems(record.id);
          tracks = this.parseTracksFromPlaylistItems(record.id, items).slice(0, limit);
          if (tracks.length === 0 && record.id === NativeAudioService.SMART_PLAYLIST_RECENT_ID) {
            tracks = await this.buildRecentSmartPlaylistTracks(limit);
            if (tracks.length > 0) {
              const now = Date.now();
              const snapshotPlaylist: Playlist = {
                id: record.id,
                name: record.name,
                description: record.description,
                tracks,
                kind: NativeAudioService.PLAYLIST_KIND_SMART,
                readonly: true,
                smartRuleJson: record.smartRuleJson,
                createdAt: record.createdAtMs,
                updatedAt: Math.max(record.updatedAtMs, now),
                trackCount: tracks.length,
                totalDuration: tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
              };
              void replaceNativeLibraryPlaylistItems(
                record.id,
                toPlaylistItemUpserts(snapshotPlaylist)
              ).catch((error) => {
                console.warn(
                  '[NativeAudioService] failed to backfill recent smart playlist items:',
                  error
                );
              });
            }
          }
        } else {
          const items = await listNativeLibraryPlaylistItems(record.id);
          tracks = this.parseTracksFromPlaylistItems(record.id, items);
        }

        const totalDuration = tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0);
        playlists.push({
          id: record.id,
          name: record.name,
          description: record.description,
          coverUrl: record.coverUrl,
          tracks,
          kind: record.kind,
          readonly: record.isReadonly,
          sourceConnectorId: record.sourceConnectorId,
          sourcePlaylistId: record.sourcePlaylistId,
          smartRuleJson: record.smartRuleJson,
          createdAt: record.createdAtMs,
          updatedAt: record.updatedAtMs,
          trackCount: tracks.length,
          totalDuration,
        });
      }

      const nextCurrentPlaylistId = this.state.currentPlaylist?.id;
      const currentPlaylist = nextCurrentPlaylistId
        ? playlists.find((item) => item.id === nextCurrentPlaylistId) ?? null
        : null;
      this.updateState({ playlists, currentPlaylist });
    } catch (error) {
      console.warn('[NativeAudioService] failed to restore playlists from library db:', error);
    }
  }

  private notifyLatestSeekSequence(seekSeq: number | null): void {
    if (typeof seekSeq !== 'number' || !Number.isFinite(seekSeq)) return;

    const normalizedSeekSeq = Math.max(1, Math.floor(seekSeq));
    void invoke('native_audio_mark_seek_seq', { seekSeq: normalizedSeekSeq }).catch(() => {
      // Best-effort fast-path: seek command itself still carries seekSeq for correctness.
    });
  }

  private isSharedOutputBackend(backendId: string | null | undefined): backendId is string {
    return (
      backendId === 'wasapi' ||
      backendId === 'wasapi-shared-raw' ||
      backendId === 'rodio-cpal'
    );
  }

  private hasPinnedOutputBackendChoice(): boolean {
    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_BACKEND);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'string') return false;
      return parsed.trim().length > 0;
    } catch {
      return false;
    }
  }

  private clearPendingSeek(): void {
    this.pendingSeekTime = null;
    this.pendingSeekSeq = null;
    this.dynamicSrcDeferredLatencyReason = null;
    if (this.pendingSeekTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.pendingSeekTimer);
    }
    this.pendingSeekTimer = null;
    this.clearPendingSeekGuard();
  }

  private hasPendingSeekWork(): boolean {
    return this.activeSeekInvokeCount > 0 || typeof this.pendingSeekTime === 'number';
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
      this.activeSeekInvokeCount > 0 || typeof this.pendingSeekTime === 'number';

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
    const target = this.pendingSeekTime;
    const seekSeq = this.pendingSeekSeq;
    if (typeof target !== 'number' || !isFinite(target)) return;

    if (
      this.activeSeekInvokeCount >=
      NativeAudioService.SEEK_MAX_PARALLEL_INVOCATIONS
    ) {
      this.scheduleSeekFlush(8);
      return;
    }

    const nowMs = Date.now();
    const elapsedSinceLastDispatch = nowMs - this.lastSeekDispatchAtMs;
    const remainingThrottleMs =
      NativeAudioService.SEEK_DISPATCH_MIN_INTERVAL_MS - elapsedSinceLastDispatch;
    if (remainingThrottleMs > 0) {
      this.scheduleSeekFlush(remainingThrottleMs);
      return;
    }

    this.pendingSeekTime = null;
    this.pendingSeekSeq = null;
    this.lastSeekDispatchAtMs = nowMs;

    this.activeSeekInvokeCount += 1;
    const payload: Record<string, unknown> = { time: target };
    if (typeof seekSeq === 'number' && Number.isFinite(seekSeq)) {
      payload.seekSeq = Math.max(1, Math.floor(seekSeq));
    }

    void this.invokeCommand('native_audio_seek', payload)
      .catch(() => {
        const hasQueuedSeek = typeof this.pendingSeekTime === 'number';
        const isSameGuardTarget =
          typeof this.pendingSeekTarget === 'number' &&
          Math.abs(this.pendingSeekTarget - target) <=
            NativeAudioService.SEEK_STALE_GUARD_TOLERANCE_SECONDS;
        if (!hasQueuedSeek && isSameGuardTarget) {
          this.clearPendingSeekGuard();
        }
        // invokeCommand already emits structured error.
      })
      .finally(() => {
        this.activeSeekInvokeCount = Math.max(0, this.activeSeekInvokeCount - 1);
        if (typeof this.pendingSeekTime === 'number') {
          this.scheduleSeekFlush(0);
          return;
        }

        this.flushDeferredLatencySrcPolicy('seek-settled');
      });
  }

  private scheduleSeekFlush(delayMs: number = NativeAudioService.SEEK_COALESCE_MS): void {
    if (typeof window === 'undefined') {
      this.flushPendingSeekCommand();
      return;
    }

    if (this.pendingSeekTimer !== null) {
      window.clearTimeout(this.pendingSeekTimer);
    }

    const safeDelayMs = Number.isFinite(delayMs)
      ? Math.max(0, Math.floor(delayMs))
      : NativeAudioService.SEEK_COALESCE_MS;

    this.pendingSeekTimer = window.setTimeout(() => {
      this.pendingSeekTimer = null;
      this.flushPendingSeekCommand();
    }, safeDelayMs);
  }

  private clearPendingVolume(): void {
    this.pendingVolume = null;
    if (this.pendingVolumeTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.pendingVolumeTimer);
    }
    this.pendingVolumeTimer = null;
  }

  private flushPendingVolumeCommand(): void {
    const volume = this.pendingVolume;
    if (typeof volume !== 'number' || !Number.isFinite(volume)) {
      return;
    }

    const nowMs = Date.now();
    const elapsedSinceLastDispatch = nowMs - this.lastVolumeDispatchAtMs;
    const remainingThrottleMs =
      NativeAudioService.VOLUME_DISPATCH_MIN_INTERVAL_MS - elapsedSinceLastDispatch;
    if (remainingThrottleMs > 0) {
      this.scheduleVolumeFlush(remainingThrottleMs);
      return;
    }

    this.pendingVolume = null;
    this.lastVolumeDispatchAtMs = nowMs;
    this.fireAndForgetCommand('native_audio_set_volume', { volume });
  }

  private scheduleVolumeFlush(delayMs: number = NativeAudioService.VOLUME_COALESCE_MS): void {
    if (typeof window === 'undefined') {
      this.flushPendingVolumeCommand();
      return;
    }

    if (this.pendingVolumeTimer !== null) {
      window.clearTimeout(this.pendingVolumeTimer);
    }

    const safeDelayMs = Number.isFinite(delayMs)
      ? Math.max(0, Math.floor(delayMs))
      : NativeAudioService.VOLUME_COALESCE_MS;

    this.pendingVolumeTimer = window.setTimeout(() => {
      this.pendingVolumeTimer = null;
      this.flushPendingVolumeCommand();
    }, safeDelayMs);
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
      decodeBufferedAhead: 0,
      outputBufferedAhead: 0,
      volume: 0.7,
      muted: false,
      playMode: 'sequence',
      queue: [],
      currentIndex: -1,
      playlists: [],
      currentPlaylist: null,
    };

    this.setupNativeListeners();
    void this.restoreFromStorage()
      .catch((error) => {
        this.logBestEffortError('restoreFromStorage', error);
      })
      .finally(() => {
        void this.refreshOutputBackendInventory().finally(() => {
          this.emitRobustnessSnapshot(true);
        });
      });
  }

  private async restoreFromStorage(): Promise<void> {
    await this.restoreOutputBackendFromStorage();
    await this.restoreOutputDeviceFromStorage();
    await this.restoreAudioInputFromStorage();
    await this.restoreStreamingBufferSettingsFromStorage();
    await this.restoreEnginePolicyFromStorage();
    await this.restoreDynamicSrcAutoSettingsFromStorage();
    await this.restoreTuningAutoSettingsFromStorage();
    await this.restoreVstEnabledFromStorage();

    const restoredGraph = await this.restoreDspGraphFromBackend();
    if (!restoredGraph) {
      await this.restoreDspChainFromStorage();
    }

    await this.restoreGainDbFromStorage();
    await this.restorePlaylistsFromLibraryDb();
  }

  private readStreamingBufferSettings(): {
    settings: StreamingBufferSettings;
    migratedLegacyFullTrack: boolean;
  } {
    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS);
      if (!raw) {
        return {
          settings: {
            startOrSeekSeconds: null,
            crossfadeSeconds: null,
            decodeMode: 'streaming',
            interactiveProfile: 'balanced',
          },
          migratedLegacyFullTrack: false,
        };
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return {
          settings: {
            startOrSeekSeconds: null,
            crossfadeSeconds: null,
            decodeMode: 'streaming',
            interactiveProfile: 'balanced',
          },
          migratedLegacyFullTrack: false,
        };
      }
      const record = parsed as Record<string, unknown>;

      const startRaw = record.startOrSeekSeconds;
      const crossfadeRaw = record.crossfadeSeconds;
      const decodeModeRaw = record.decodeMode;
      const interactiveProfileRaw = record.interactiveProfile;
      const userSetDecodeMode = record.userSetDecodeMode === true;

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

      const isDecodeMode = (
        value: unknown
      ): value is StreamingBufferSettings['decodeMode'] =>
        value === 'full-track' || value === 'streaming';

      const isInteractiveProfile = (
        value: unknown
      ): value is StreamingBufferSettings['interactiveProfile'] =>
        value === 'fast' || value === 'balanced' || value === 'stable';

      let decodeMode: StreamingBufferSettings['decodeMode'] = isDecodeMode(decodeModeRaw)
        ? decodeModeRaw
        : 'streaming';
      const interactiveProfile: StreamingBufferSettings['interactiveProfile'] =
        isInteractiveProfile(interactiveProfileRaw) ? interactiveProfileRaw : 'balanced';

      let migratedLegacyFullTrack = false;
      if (decodeMode === 'full-track' && !userSetDecodeMode) {
        // Older builds defaulted to full-track. Migrate to streaming for instant click-to-play and
        // much lower memory usage unless the user explicitly opted into full-track.
        decodeMode = 'streaming';
        migratedLegacyFullTrack = true;
      }

      return {
        settings: {
          startOrSeekSeconds: start,
          crossfadeSeconds: crossfade,
          decodeMode,
          interactiveProfile,
        },
        migratedLegacyFullTrack,
      };
    } catch {
      return {
        settings: {
          startOrSeekSeconds: null,
          crossfadeSeconds: null,
          decodeMode: 'streaming',
          interactiveProfile: 'balanced',
        },
        migratedLegacyFullTrack: false,
      };
    }
  }

  private async restoreStreamingBufferSettingsFromStorage(): Promise<void> {
    if (this.restoredStreamingBufferSettings) return;
    this.restoredStreamingBufferSettings = true;

    try {
      const { settings, migratedLegacyFullTrack } = this.readStreamingBufferSettings();
      this.storedStreamingBufferSettings = settings;
      this.attachVisibilityAwareStreamingBufferPolicy();
      this.applyStreamingBufferPolicy();

      if (migratedLegacyFullTrack) {
        void broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS,
          {
            ...settings,
            userSetDecodeMode: false,
            migratedAtMs: Date.now(),
          },
          TAURI_EVENTS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS_UPDATED
        );
      }
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

  private readPersistedEnginePolicy(): NativeAudioEnginePolicyPatch | null {
    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_ENGINE_POLICY);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return null;

      const record = parsed as Record<string, unknown>;
      const patch: NativeAudioEnginePolicyPatch = {};

      if (record.transportMode === 'robust' || record.transportMode === 'transport-exact') {
        patch.transportMode = record.transportMode;
      }

      if (
        record.hqSrcPhaseMode === 'linear' ||
        record.hqSrcPhaseMode === 'minimum' ||
        record.hqSrcPhaseMode === 'intermediate'
      ) {
        patch.hqSrcPhaseMode = record.hqSrcPhaseMode;
      }

      if (
        record.srcMode === 'source-native' ||
        record.srcMode === 'match-output' ||
        record.srcMode === 'target-rate'
      ) {
        patch.srcMode = record.srcMode;
      }

      if (record.srcBackend === 'rubato' || record.srcBackend === 'linear-simd') {
        patch.srcBackend = record.srcBackend;
      }

      if (
        typeof record.srcTargetSampleRate === 'number' &&
        Number.isFinite(record.srcTargetSampleRate) &&
        record.srcTargetSampleRate > 0
      ) {
        patch.srcTargetSampleRate = Math.max(
          8_000,
          Math.min(768_000, Math.floor(record.srcTargetSampleRate))
        );
      } else if (record.srcTargetSampleRate === null) {
        patch.srcTargetSampleRate = null;
      }

      if (record.outputQuantizationMode === 'round' || record.outputQuantizationMode === 'tpdf') {
        patch.outputQuantizationMode = record.outputQuantizationMode;
      }

      if (Object.keys(patch).length === 0) return null;
      return patch;
    } catch {
      return null;
    }
  }

  private buildPersistedEnginePolicyPayload(): NativeAudioEnginePolicyPatch {
    return {
      transportMode: this.transportMode,
      hqSrcPhaseMode: this.hqSrcPhaseMode,
      srcMode: this.srcMode,
      srcBackend: this.srcBackend,
      srcTargetSampleRate: this.srcMode === 'target-rate' ? this.srcTargetSampleRate : null,
      outputQuantizationMode: this.outputQuantizationMode,
    };
  }

  private async persistEnginePolicyToStorage(): Promise<void> {
    await broadcastDataUpdate(
      STORAGE_KEYS.NATIVE_AUDIO_ENGINE_POLICY,
      this.buildPersistedEnginePolicyPayload(),
      TAURI_EVENTS.NATIVE_AUDIO_ENGINE_POLICY_UPDATED
    );
  }

  private async restoreEnginePolicyFromStorage(): Promise<void> {
    if (this.restoredEnginePolicy) return;
    this.restoredEnginePolicy = true;

    const persisted = this.readPersistedEnginePolicy();
    if (!persisted) return;

    try {
      await this.setEnginePolicyInternal(persisted);
    } catch (error) {
      this.logBestEffortError('restore engine policy', error);
    }
  }

  private async restoreVstEnabledFromStorage(): Promise<void> {
    if (this.restoredVstEnabled) return;
    this.restoredVstEnabled = true;

    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_VST_ENABLED);
      const enabled = raw ? (JSON.parse(raw) as unknown) : false;
      const resolved = typeof enabled === 'boolean' ? enabled : false;
      await invoke('native_audio_vst_set_enabled', { enabled: resolved }).catch((error) => {
        this.logBestEffortError('restore vst enabled', error);
      });
    } catch (error) {
      this.logBestEffortError('parse vst enabled from storage', error);
    }
  }

  private async restoreDspGraphFromBackend(): Promise<boolean> {
    if (this.restoredDspGraph) return false;
    this.restoredDspGraph = true;

    try {
      const graph = await invoke<unknown>('native_audio_get_dsp_graph').catch((error) => {
        this.logBestEffortError('restore dsp graph from backend', error);
        return null;
      });
      if (!graph || typeof graph !== 'object') return false;
      const record = graph as Record<string, unknown>;
      const nodes = record.nodes;
      if (!Array.isArray(nodes) || nodes.length === 0) return false;

      await invoke('native_audio_set_dsp_graph', { graph: record });
      this.restoredDspChainApplied = true;
      return true;
    } catch (error) {
      this.logBestEffortError('apply restored dsp graph from backend', error);
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

  private readRuntimeControlSettings(): RuntimeControlSettings {
    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS);
      if (!raw) {
        return (
          parseLegacyRuntimeControlFromReplayGain(
            readString(STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS)
          ) ?? {
            dynamicGainEnabled: false,
            volumeDebounceEnabled: true,
          }
        );
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return (
          parseLegacyRuntimeControlFromReplayGain(
            readString(STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS)
          ) ?? {
            dynamicGainEnabled: false,
            volumeDebounceEnabled: true,
          }
        );
      }

      const record = parsed as Record<string, unknown>;
      const dynamicGainEnabled =
        typeof record.dynamicGainEnabled === 'boolean'
          ? record.dynamicGainEnabled
          : typeof record.dynamicFallbackEnabled === 'boolean'
            ? record.dynamicFallbackEnabled
            : false;
      const volumeDebounceEnabled =
        typeof record.volumeDebounceEnabled === 'boolean' ? record.volumeDebounceEnabled : true;

      return { dynamicGainEnabled, volumeDebounceEnabled };
    } catch {
      return (
        parseLegacyRuntimeControlFromReplayGain(readString(STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS)) ?? {
          dynamicGainEnabled: false,
          volumeDebounceEnabled: true,
        }
      );
    }
  }

  private computeReplayGainDbForTrack(track: Track): number {
    const settings = this.readReplayGainSettings();
    if (!settings.enabled) return 0;

    const base =
      settings.mode === 'album' ? track.replayGainAlbumGainDb : track.replayGainTrackGainDb;
    if (typeof base !== 'number' || !isFinite(base)) {
      return 0;
    }

    const effective = base + (typeof settings.preampDb === 'number' ? settings.preampDb : 0);
    return Math.max(-30, Math.min(30, effective));
  }

  private async applyReplayGainForTrack(track: Track): Promise<void> {
    const db = this.computeReplayGainDbForTrack(track);
    await this.invokeCommand('native_audio_set_replay_gain', { db });
  }

  private async applyRuntimeControlSettingsToBackend(): Promise<void> {
    const runtimeControl = this.readRuntimeControlSettings();
    await this.invokeCommand('native_audio_set_dynamic_gain_enabled', {
      enabled: runtimeControl.dynamicGainEnabled,
    });
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

  private evaluateDynamicSrcAutoDegradation(options?: {
    nowMs?: number;
    triggerActions?: boolean;
    stressScore?: number;
  }): void {
    const nowMs = options?.nowMs ?? Date.now();
    const stressScore = options?.stressScore ?? this.getDynamicSrcStressScore(nowMs);
    const nextState = resolveDynamicSrcAutoDegradationState({
      autoEnabled: this.dynamicSrcAutoEnabled,
      manualLockActive: this.dynamicSrcManualLockActive,
      playbackState: this.state.playbackState,
      stressScore,
      nowMs,
      underrunRecoveryUntilMs: this.underrunRecoveryUntilMs,
      protectionWindowActive: this.hasActiveProtectionWindow(nowMs),
      sharedStressWindowActive: this.hasActiveSharedStressWindow(nowMs),
      lastUnderrunFrames: this.lastUnderrunFrames,
      severeUnderrunFramesThreshold: NativeAudioService.AUTO_BACKEND_UNDERRUN_FRAME_SPIKE_TRIGGER,
      elevatedScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_ELEVATED,
      criticalScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_CRITICAL,
    });
    const levelChanged = this.dynamicSrcAutoDegradationLevel !== nextState.level;
    const reasonChanged = this.dynamicSrcAutoDegradationReason !== nextState.reason;
    if (!levelChanged && !reasonChanged) {
      return;
    }

    const previousLevel = this.dynamicSrcAutoDegradationLevel;
    this.dynamicSrcAutoDegradationLevel = nextState.level;
    this.dynamicSrcAutoDegradationReason = nextState.reason;
    this.dynamicSrcAutoDegradationLastChangedAtMs = nowMs;

    if (!options?.triggerActions) {
      return;
    }

    if (nextState.level === 1 && previousLevel < 1) {
      void this.ensureLatencySrcPolicy(`auto-degradation:l1:${nextState.reason ?? 'stress'}`);
      return;
    }

    if (nextState.level === 2 && previousLevel < 2) {
      const effective = this.getEffectiveDynamicSrcTiming(nowMs);
      const holdMs = Math.max(
        NativeAudioService.DYNAMIC_SRC_DEGRADATION_L2_HOLD_FLOOR_MS,
        effective.underrunHoldMs,
        effective.sharedStressHoldMs
      );
      this.withDynamicSrcHold(`auto-degradation:l2:${nextState.reason ?? 'stress'}`, holdMs);
      return;
    }

    if (nextState.level === 0 && previousLevel > 0) {
      this.scheduleDynamicSrcRestoreEvaluation();
    }
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
    const stressScore = this.getDynamicSrcStressScore(nowMs);
    return resolveDynamicSrcEffectiveTiming({
      adaptiveEnabled: this.dynamicSrcAdaptiveEnabled,
      stressScore,
      learningScale: this.getDynamicSrcLearningScale(),
      elevatedScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_ELEVATED,
      criticalScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_CRITICAL,
      base: {
        restoreDebounceMs: this.dynamicSrcRestoreDebounceMs,
        minSwitchIntervalMs: this.dynamicSrcMinSwitchIntervalMs,
        seekHoldMs: this.dynamicSrcSeekHoldMs,
        underrunHoldMs: this.dynamicSrcUnderrunHoldMs,
        sharedStressHoldMs: this.dynamicSrcSharedStressHoldMs,
        outputErrorHoldMs: this.dynamicSrcOutputErrorHoldMs,
      },
    });
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
    const adaptiveHoldMs = Math.max(
      1000,
      Math.floor(safeHoldMs * getDynamicSrcAdaptiveScale(effective.profile))
    );
    this.dynamicSrcHoldUntilMs = Math.max(this.dynamicSrcHoldUntilMs, nowMs + safeHoldMs);
    this.dynamicSrcHoldUntilMs = Math.max(this.dynamicSrcHoldUntilMs, nowMs + adaptiveHoldMs);
    this.dynamicSrcLastSwitchReason = reason;
    this.dynamicSrcAdaptiveProfile = effective.profile;
    if (reason === 'seek' && this.hasPendingSeekWork()) {
      this.dynamicSrcDeferredLatencyReason = reason;
    } else {
      this.dynamicSrcDeferredLatencyReason = null;
      void this.ensureLatencySrcPolicy(reason);
    }
    this.scheduleDynamicSrcRestoreEvaluation();
  }

  private flushDeferredLatencySrcPolicy(trigger: string): void {
    const deferredReason = this.dynamicSrcDeferredLatencyReason;
    if (!deferredReason) return;
    if (this.hasPendingSeekWork()) return;

    this.dynamicSrcDeferredLatencyReason = null;
    void this.ensureLatencySrcPolicy(`${deferredReason}:${trigger}`);
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

    if (
      this.dynamicSrcPendingPolicy &&
      this.isSameSrcPolicy(this.dynamicSrcPendingPolicy, target)
    ) {
      this.dynamicSrcProfile = profile;
      return false;
    }

    const nowMs = Date.now();
    if (!this.canApplyDynamicSrcNow(nowMs)) {
      this.scheduleDynamicSrcRestoreEvaluation();
      return false;
    }

    this.dynamicSrcPendingPolicy = { ...target };
    this.dynamicSrcLastApplyAtMs = nowMs;

    try {
      await this.setEnginePolicyInternal(target, { fromDynamicAuto: true });
      this.dynamicSrcProfile = profile;
      this.dynamicSrcLastSwitchAtMs = nowMs;
      this.dynamicSrcLastSwitchReason = reason;
      this.emitRobustnessSnapshot(true);
      return true;
    } catch {
      return false;
    } finally {
      if (
        this.dynamicSrcPendingPolicy &&
        this.isSameSrcPolicy(this.dynamicSrcPendingPolicy, target)
      ) {
        this.dynamicSrcPendingPolicy = null;
      }
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
    this.dynamicSrcAdaptiveProfile = resolveDynamicSrcAdaptiveProfile({
      adaptiveEnabled: this.dynamicSrcAdaptiveEnabled,
      stressScore: this.getDynamicSrcStressScore(),
      elevatedScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_ELEVATED,
      criticalScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_CRITICAL,
    });
    this.evaluateDynamicSrcAutoDegradation({ triggerActions: false });
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
        this.dynamicSrcAdaptiveProfile = resolveDynamicSrcAdaptiveProfile({
          adaptiveEnabled: this.dynamicSrcAdaptiveEnabled,
          stressScore: this.getDynamicSrcStressScore(),
          elevatedScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_ELEVATED,
          criticalScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_CRITICAL,
        });
        this.scheduleDynamicSrcRestoreEvaluation();
      }
      this.evaluateDynamicSrcAutoDegradation({ triggerActions: false });
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

  private readTuningAutoSettings(): AudioTuningAutoSettings {
    const clampMs = (value: unknown, fallback: number, min: number, max: number): number => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
      return Math.max(min, Math.min(max, Math.floor(value)));
    };
    const clampCount = (value: unknown, fallback: number, min: number, max: number): number => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
      return Math.max(min, Math.min(max, Math.floor(value)));
    };

    const defaults: AudioTuningAutoSettings = {
      enabled: this.tuningAutoEnabled,
      tickIntervalMs: this.tuningAutoTickIntervalMs,
      stableWindowMs: this.tuningAutoStableWindowMs,
      minSwitchIntervalMs: this.tuningAutoMinSwitchIntervalMs,
      postSwitchObserveWindowMs: this.tuningAutoPostSwitchObserveWindowMs,
      elevatedStressScore: this.tuningAutoElevatedStressScore,
      criticalStressScore: this.tuningAutoCriticalStressScore,
      criticalUnderrunEventsWindow: this.tuningAutoCriticalUnderrunEventsWindow,
      criticalOverflowGrowthTicks: this.tuningAutoCriticalOverflowGrowthTicks,
    };

    try {
      const raw = readString(STORAGE_KEYS.NATIVE_AUDIO_TUNING_AUTO_SETTINGS);
      if (!raw) return defaults;

      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return defaults;

      const record = parsed as Record<string, unknown>;
      const elevatedStressScore = clampCount(
        record.elevatedStressScore,
        defaults.elevatedStressScore,
        1,
        20
      );
      const criticalStressScore = clampCount(
        record.criticalStressScore,
        defaults.criticalStressScore,
        elevatedStressScore,
        30
      );

      return {
        enabled: typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled,
        tickIntervalMs: clampMs(record.tickIntervalMs, defaults.tickIntervalMs, 500, 10_000),
        stableWindowMs: clampMs(record.stableWindowMs, defaults.stableWindowMs, 5_000, 120_000),
        minSwitchIntervalMs: clampMs(
          record.minSwitchIntervalMs,
          defaults.minSwitchIntervalMs,
          1_000,
          120_000
        ),
        postSwitchObserveWindowMs: clampMs(
          record.postSwitchObserveWindowMs,
          defaults.postSwitchObserveWindowMs,
          1_000,
          120_000
        ),
        elevatedStressScore,
        criticalStressScore,
        criticalUnderrunEventsWindow: clampCount(
          record.criticalUnderrunEventsWindow,
          defaults.criticalUnderrunEventsWindow,
          1,
          12
        ),
        criticalOverflowGrowthTicks: clampCount(
          record.criticalOverflowGrowthTicks,
          defaults.criticalOverflowGrowthTicks,
          1,
          8
        ),
      };
    } catch {
      return defaults;
    }
  }

  private applyTuningAutoSettingsState(settings: AudioTuningAutoSettings): void {
    this.tuningAutoEnabled = settings.enabled;
    this.tuningAutoTickIntervalMs = settings.tickIntervalMs;
    this.tuningAutoStableWindowMs = settings.stableWindowMs;
    this.tuningAutoMinSwitchIntervalMs = settings.minSwitchIntervalMs;
    this.tuningAutoPostSwitchObserveWindowMs = settings.postSwitchObserveWindowMs;
    this.tuningAutoElevatedStressScore = settings.elevatedStressScore;
    this.tuningAutoCriticalStressScore = Math.max(
      this.tuningAutoElevatedStressScore,
      settings.criticalStressScore
    );
    this.tuningAutoCriticalUnderrunEventsWindow = settings.criticalUnderrunEventsWindow;
    this.tuningAutoCriticalOverflowGrowthTicks = settings.criticalOverflowGrowthTicks;
    this.restartTuningAutoLoop();
  }

  private clearTuningAutoLoop(): void {
    if (this.tuningAutoTimer === null) return;
    clearInterval(this.tuningAutoTimer);
    this.tuningAutoTimer = null;
  }

  private restartTuningAutoLoop(): void {
    this.clearTuningAutoLoop();
    if (!this.tuningAutoEnabled || this.disposed) return;

    this.tuningAutoTimer = setInterval(() => {
      void this.tickTuningAutoController();
    }, this.tuningAutoTickIntervalMs);
  }

  private async tickTuningAutoController(): Promise<void> {
    if (!this.tuningAutoEnabled || this.disposed) return;
    if (this.tuningAutoApplyInFlight) return;

    const nowMs = Date.now();
    const snapshot = this.buildRobustnessSnapshot(nowMs);
    const decision = resolveAudioTuningTransition({
      nowMs,
      snapshot,
      state: this.tuningAutoControllerState,
      thresholds: {
        elevatedStressScore: this.tuningAutoElevatedStressScore,
        criticalStressScore: this.tuningAutoCriticalStressScore,
        criticalUnderrunEventsWindow: this.tuningAutoCriticalUnderrunEventsWindow,
        criticalOverflowGrowthTicks: this.tuningAutoCriticalOverflowGrowthTicks,
        stableWindowMs: this.tuningAutoStableWindowMs,
        minSwitchIntervalMs: this.tuningAutoMinSwitchIntervalMs,
        postSwitchObserveWindowMs: this.tuningAutoPostSwitchObserveWindowMs,
      },
    });

    this.tuningAutoControllerState = decision.state;
    this.tuningAutoLastReason = decision.reason;
    if (!decision.changed) return;

    this.tuningAutoApplyInFlight = true;
    try {
      await this.applyTuningProfile(decision.nextProfile);
      this.tuningAutoLastReason = `auto:${decision.reason}`;
      this.tuningAutoLastAppliedAtMs = Date.now();
    } catch (error) {
      console.warn('[NativeAudioService] auto tuning profile apply failed:', error);
    } finally {
      this.tuningAutoApplyInFlight = false;
      this.emitRobustnessSnapshot(true);
    }
  }

  getAudioTuningAutoSettings(): AudioTuningAutoSettings {
    return {
      enabled: this.tuningAutoEnabled,
      tickIntervalMs: this.tuningAutoTickIntervalMs,
      stableWindowMs: this.tuningAutoStableWindowMs,
      minSwitchIntervalMs: this.tuningAutoMinSwitchIntervalMs,
      postSwitchObserveWindowMs: this.tuningAutoPostSwitchObserveWindowMs,
      elevatedStressScore: this.tuningAutoElevatedStressScore,
      criticalStressScore: this.tuningAutoCriticalStressScore,
      criticalUnderrunEventsWindow: this.tuningAutoCriticalUnderrunEventsWindow,
      criticalOverflowGrowthTicks: this.tuningAutoCriticalOverflowGrowthTicks,
    };
  }

  async setAudioTuningAutoSettings(settingsPatch: AudioTuningAutoSettingsPatch): Promise<void> {
    const current = this.getAudioTuningAutoSettings();

    const clampMs = (value: unknown, fallback: number, min: number, max: number): number => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
      return Math.max(min, Math.min(max, Math.floor(value)));
    };
    const clampCount = (value: unknown, fallback: number, min: number, max: number): number => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
      return Math.max(min, Math.min(max, Math.floor(value)));
    };

    const nextElevatedStressScore = clampCount(
      settingsPatch.elevatedStressScore,
      current.elevatedStressScore,
      1,
      20
    );

    const nextSettings: AudioTuningAutoSettings = {
      enabled: typeof settingsPatch.enabled === 'boolean' ? settingsPatch.enabled : current.enabled,
      tickIntervalMs: clampMs(settingsPatch.tickIntervalMs, current.tickIntervalMs, 500, 10_000),
      stableWindowMs: clampMs(settingsPatch.stableWindowMs, current.stableWindowMs, 5_000, 120_000),
      minSwitchIntervalMs: clampMs(
        settingsPatch.minSwitchIntervalMs,
        current.minSwitchIntervalMs,
        1_000,
        120_000
      ),
      postSwitchObserveWindowMs: clampMs(
        settingsPatch.postSwitchObserveWindowMs,
        current.postSwitchObserveWindowMs,
        1_000,
        120_000
      ),
      elevatedStressScore: nextElevatedStressScore,
      criticalStressScore: clampCount(
        settingsPatch.criticalStressScore,
        current.criticalStressScore,
        nextElevatedStressScore,
        30
      ),
      criticalUnderrunEventsWindow: clampCount(
        settingsPatch.criticalUnderrunEventsWindow,
        current.criticalUnderrunEventsWindow,
        1,
        12
      ),
      criticalOverflowGrowthTicks: clampCount(
        settingsPatch.criticalOverflowGrowthTicks,
        current.criticalOverflowGrowthTicks,
        1,
        8
      ),
    };

    await broadcastDataUpdate(
      STORAGE_KEYS.NATIVE_AUDIO_TUNING_AUTO_SETTINGS,
      nextSettings,
      TAURI_EVENTS.NATIVE_AUDIO_TUNING_AUTO_SETTINGS_UPDATED
    );

    this.applyTuningAutoSettingsState(nextSettings);
    this.emitRobustnessSnapshot(true);
  }

  private async restoreTuningAutoSettingsFromStorage(): Promise<void> {
    const persisted = this.readTuningAutoSettings();
    this.applyTuningAutoSettingsState(persisted);

    if (this.tuningAutoSettingsListenerCleanup) {
      this.emitRobustnessSnapshot(true);
      return;
    }
    if (this.tuningAutoSettingsListenerInitPromise) {
      await this.tuningAutoSettingsListenerInitPromise;
      this.emitRobustnessSnapshot(true);
      return;
    }

    const applyPersistedSettings = () => {
      const nextSettings = this.readTuningAutoSettings();
      this.applyTuningAutoSettingsState(nextSettings);
      this.emitRobustnessSnapshot(true);
    };

    this.tuningAutoSettingsListenerInitPromise = (async () => {
      if (this.tuningAutoSettingsListenerCleanup) return;

      const cleanup = await setupDualListener(
        [STORAGE_KEYS.NATIVE_AUDIO_TUNING_AUTO_SETTINGS],
        [TAURI_EVENTS.NATIVE_AUDIO_TUNING_AUTO_SETTINGS_UPDATED],
        applyPersistedSettings
      );

      this.tuningAutoSettingsListenerCleanup = cleanup;
    })().finally(() => {
      this.tuningAutoSettingsListenerInitPromise = null;
    });

    await this.tuningAutoSettingsListenerInitPromise;
    this.emitRobustnessSnapshot(true);
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
    await this.persistEnginePolicyToStorage();
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
      this.evaluateDynamicSrcAutoDegradation({ triggerActions: false });
      this.emitRobustnessSnapshot(true);
      return;
    }

    this.dynamicSrcManualLockActive = false;
    this.captureCurrentQualitySrcPolicy();
    this.dynamicSrcProfile = 'quality';
    this.dynamicSrcAdaptiveProfile = resolveDynamicSrcAdaptiveProfile({
      adaptiveEnabled: this.dynamicSrcAdaptiveEnabled,
      stressScore: this.getDynamicSrcStressScore(),
      elevatedScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_ELEVATED,
      criticalScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_CRITICAL,
    });
    this.dynamicSrcLastSwitchReason = 'dynamic-src-enabled';
    this.scheduleDynamicSrcRestoreEvaluation();
    this.evaluateDynamicSrcAutoDegradation({ triggerActions: false });
    this.emitRobustnessSnapshot(true);
  }

  async applyTuningProfile(profileId: AudioTuningProfileId): Promise<void> {
    const nowMs = Date.now();
    const payload = resolveAudioTuningProfilePayload({
      profileId,
      outputBackendId: this.currentOutputBackendId,
    });

    await this.setEnginePolicyInternal(payload.enginePolicy, { fromDynamicAuto: true });
    await this.persistEnginePolicyToStorage();
    await this.setDynamicSrcAutoSettings(payload.dynamicSrcSettings);

    this.storedStreamingBufferSettings = payload.streamingBuffer;
    this.applyStreamingBufferPolicy(true);

    await broadcastDataUpdate(
      STORAGE_KEYS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS,
      payload.streamingBufferStoragePayload,
      TAURI_EVENTS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS_UPDATED
    );

    this.tuningAutoControllerState = {
      ...this.tuningAutoControllerState,
      activeProfile: profileId,
      lastSwitchAtMs: nowMs,
    };
    this.tuningAutoLastReason = `manual:${profileId}`;
    this.tuningAutoLastAppliedAtMs = nowMs;

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

    if (this.hasPinnedOutputBackendChoice()) {
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
    if (
      this.diagnosticTimelineIgnoreBeforeMs > 0 &&
      nowMs >= this.diagnosticTimelineIgnoreBeforeMs
    ) {
      this.diagnosticTimelineIgnoreBeforeMs = 0;
    }

    if (this.diagnosticTimelineIgnoreBeforeMs > nowMs) {
      return;
    }

    const timelineFloorMs = Math.max(
      nowMs - NativeAudioService.SHARED_TIMELINE_STRESS_WINDOW_MS,
      this.diagnosticTimelineIgnoreBeforeMs
    );
    const recent = newEvents.filter(
      (event) =>
        Number.isFinite(event.timestampMs) &&
        event.timestampMs > 0 &&
        event.timestampMs >= timelineFloorMs
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
    this.evaluateDynamicSrcAutoDegradation({
      nowMs,
      stressScore: effective.stressScore,
      triggerActions: true,
    });
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

    const target = resolveStreamingBufferPolicyTarget({
      storedSettings: this.storedStreamingBufferSettings,
      documentHidden: typeof document !== 'undefined' && document.hidden,
      underrunRecoveryActive: this.underrunRecoveryUntilMs > nowMs,
      protectionWindowActive: this.hasActiveProtectionWindow(nowMs),
      sharedStressWindowActive: this.hasActiveSharedStressWindow(nowMs),
    });
    if (!force && isSameStreamingBufferSettings(this.lastAppliedStreamingBufferSettings, target)) {
      return;
    }

    this.lastAppliedStreamingBufferSettings = target;
    void invoke('native_audio_set_streaming_buffer_settings', target).catch((error) => {
      this.logBestEffortError('apply streaming buffer policy', error);
    });
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
    this.evaluateDynamicSrcAutoDegradation({
      nowMs,
      stressScore: effective.stressScore,
      triggerActions: true,
    });
  }

  private resetSharedTimelineStressTracking(nowMs: number = Date.now()): void {
    this.sharedStressUntilMs = 0;
    this.sharedStressReason = null;
    this.sharedStressEscalationCount = 0;
    this.diagnosticTimelineIgnoreBeforeMs =
      nowMs + NativeAudioService.SHARED_TIMELINE_STRESS_RESET_GRACE_MS;
    this.applyStreamingBufferPolicy(true);
    this.scheduleDynamicSrcRestoreEvaluation();
  }

  private resetUnderrunTracking(): void {
    this.lastUnderrunEvents = 0;
    this.lastUnderrunFrames = 0;
    this.underrunSpikeTimestampsMs = [];
    this.underrunRecoveryUntilMs = 0;
    this.dynamicSrcHoldUntilMs = 0;
    this.clearDynamicSrcRestoreTimer();
    this.resetSharedTimelineStressTracking();
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
    this.evaluateDynamicSrcAutoDegradation({ nowMs, triggerActions: true });
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
    this.evaluateDynamicSrcAutoDegradation({
      nowMs,
      stressScore: effectiveDynamicSrc.stressScore,
      triggerActions: false,
    });
    const learningDeviceKey = this.buildDynamicSrcLearningDeviceKey();
    const learningStressIndex = this.dynamicSrcLearningProfile[learningDeviceKey]?.stressIndex ?? 0;
    const learningScale = this.getDynamicSrcLearningScale();
    const audioPerfTelemetry = getAudioPerformanceTelemetrySnapshot();

    const bufferedAheadNow =
      typeof this.state.bufferedAhead === 'number' && Number.isFinite(this.state.bufferedAhead)
        ? Math.max(0, this.state.bufferedAhead)
        : 0;
    const decodeBufferedAheadNow =
      typeof this.state.decodeBufferedAhead === 'number' &&
      Number.isFinite(this.state.decodeBufferedAhead)
        ? Math.max(0, this.state.decodeBufferedAhead)
        : 0;
    const outputBufferedAheadNow =
      typeof this.state.outputBufferedAhead === 'number' &&
      Number.isFinite(this.state.outputBufferedAhead)
        ? Math.max(0, this.state.outputBufferedAhead)
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
      dynamicSrcAutoDegradationLevel: this.dynamicSrcAutoDegradationLevel,
      dynamicSrcAutoDegradationLabel: toDynamicSrcAutoDegradationLabel(
        this.dynamicSrcAutoDegradationLevel
      ),
      dynamicSrcAutoDegradationReason: this.dynamicSrcAutoDegradationReason,
      dynamicSrcAutoDegradationLastChangedAtMs: this.dynamicSrcAutoDegradationLastChangedAtMs,
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
      tuningAutoEnabled: this.tuningAutoEnabled,
      tuningAutoTickIntervalMs: this.tuningAutoTickIntervalMs,
      tuningAutoStableWindowMs: this.tuningAutoStableWindowMs,
      tuningAutoMinSwitchIntervalMs: this.tuningAutoMinSwitchIntervalMs,
      tuningAutoPostSwitchObserveWindowMs: this.tuningAutoPostSwitchObserveWindowMs,
      tuningAutoElevatedStressScore: this.tuningAutoElevatedStressScore,
      tuningAutoCriticalStressScore: this.tuningAutoCriticalStressScore,
      tuningAutoCriticalUnderrunEventsWindow: this.tuningAutoCriticalUnderrunEventsWindow,
      tuningAutoCriticalOverflowGrowthTicks: this.tuningAutoCriticalOverflowGrowthTicks,
      tuningAutoCriticalOverflowGrowthStreak:
        this.tuningAutoControllerState.criticalOverflowGrowthStreak,
      tuningAutoActiveProfile: this.tuningAutoControllerState.activeProfile,
      tuningAutoLastReason: this.tuningAutoLastReason,
      tuningAutoLastAppliedAtMs: this.tuningAutoLastAppliedAtMs,
      tuningAutoStableSinceMs: this.tuningAutoControllerState.stableSinceMs,
      tuningAutoLastSwitchAtMs: this.tuningAutoControllerState.lastSwitchAtMs,
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
      decodeBufferedAheadSeconds: decodeBufferedAheadNow,
      outputBufferedAheadSeconds: outputBufferedAheadNow,
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
      transferAdaptationLevel: this.transferAdaptationLevel,
      transferOscillationStreak: this.transferOscillationStreak,
      renderQueuePageLocked: this.renderQueuePageLocked,
      transferMetricsValid: this.transferMetricsValid,
      sharedRenderAheadEnabled: this.sharedRenderAheadEnabled,
      sharedRenderUnderrunEvents: this.sharedRenderUnderrunEvents,
      sharedRenderUnderrunFrames: this.sharedRenderUnderrunFrames,
      sharedRenderLowHitCount: this.sharedRenderLowHitCount,
      sharedRenderLowWatermarkSamples: this.sharedRenderLowWatermarkSamples,
      controlQueueLockFree: this.controlQueueLockFree,
      controlQueueMode: this.controlQueueMode,
      controlQueueCapacity: this.controlQueueCapacity,
      controlQueueOverwriteEvents: this.controlQueueOverwriteEvents,
      controlQueueDropNewestEvents: this.controlQueueDropNewestEvents,
      controlQueueCoalescedOverflowEvents: this.controlQueueCoalescedOverflowEvents,
      controlQueueCriticalOverflowEvents: this.controlQueueCriticalOverflowEvents,
      diagnosticTimelineDroppedEvents: this.diagnosticTimelineDroppedEvents,
      diagnosticTimeline: [...this.diagnosticTimeline],
      recentPlaylistWriteScheduledCount: audioPerfTelemetry.recentPlaylistWriteScheduledCount,
      recentPlaylistWriteFlushCount: audioPerfTelemetry.recentPlaylistWriteFlushCount,
      recentPlaylistWriteEventCount: audioPerfTelemetry.recentPlaylistWriteEventCount,
      recentPlaylistWriteTrackCount: audioPerfTelemetry.recentPlaylistWriteTrackCount,
      recentPlaylistWritePayloadBytesTotal: audioPerfTelemetry.recentPlaylistWritePayloadBytesTotal,
      recentPlaylistWritePayloadBytesLast: audioPerfTelemetry.recentPlaylistWritePayloadBytesLast,
      coverResolveRequestCount: audioPerfTelemetry.coverResolveRequestCount,
      coverResolveCacheHitCount: audioPerfTelemetry.coverResolveCacheHitCount,
      coverResolveCacheMissCount: audioPerfTelemetry.coverResolveCacheMissCount,
      coverResolveHitRate: audioPerfTelemetry.coverResolveHitRate,
      coverBlobReleaseCount: audioPerfTelemetry.coverBlobReleaseCount,
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
    if (options?.emitStateChange === false) {
      const target = this.state as unknown as Record<string, unknown>;

      for (const [rawKey, value] of Object.entries(partial)) {
        const key = rawKey as keyof AudioState;
        if (typeof value === 'undefined') continue;
        if (target[key as string] === value) continue;
        target[key as string] = value;
      }

      return this.state;
    }

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
    this.stateChangeCallbacks.forEach((cb) => cb(this.state));
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
    return getTrackPathForIdentity(track);
  }

  private normalizeTrackPathForCompare(path: string | null | undefined): string {
    return normalizeTrackPathForCompareUtil(path);
  }

  private findQueueIndexByPath(queue: Track[], trackPath: string): number {
    const normalizedTrackPath = this.normalizeTrackPathForCompare(trackPath);
    if (!normalizedTrackPath) return -1;

    return queue.findIndex((track) => {
      const candidatePath = this.getTrackPath(track);
      return this.normalizeTrackPathForCompare(candidatePath) === normalizedTrackPath;
    });
  }

  private normalizeTrackIdentityForCompare(track: Track | null | undefined): string {
    return normalizeTrackIdentityForCompareUtil(track);
  }

  private findQueueIndexByTrackIdentity(queue: Track[], track: Track): number {
    const normalizedTargetIdentity = this.normalizeTrackIdentityForCompare(track);
    if (!normalizedTargetIdentity) return -1;

    return queue.findIndex(
      (candidateTrack) =>
        this.normalizeTrackIdentityForCompare(candidateTrack) === normalizedTargetIdentity
    );
  }

  private resolveAbsoluteTrackPathOrEmitError(track: Track): string | null {
    const trackPath = this.getTrackPath(track);
    if (trackPath && this.isProbablyAbsolutePath(trackPath)) {
      return trackPath;
    }

    const error = new Error(
      'Native audio requires an absolute file path. This track has no filePath (likely added via File System Access API).'
    ) as Error & { code?: string };
    error.code = !trackPath ? 'NATIVE_TRACK_PATH_MISSING' : 'NATIVE_TRACK_PATH_NOT_ABSOLUTE';
    this.emitError(error);
    return null;
  }

  private ensureTrackInQueue(track: Track, trackPath: string): { queue: Track[]; index: number } {
    let queue = this.state.queue;
    let index = this.findQueueIndexByPath(queue, trackPath);

    if (index === -1) {
      index = this.findQueueIndexByTrackIdentity(queue, track);
    }

    if (index === -1) {
      queue = [...queue, track];
      index = queue.length - 1;
    } else if (queue[index] !== track) {
      queue = [...queue];
      queue[index] = track;
    }

    return { queue, index };
  }

  private applyTrackLoadingState(track: Track, queue: Track[], index: number): void {
    this.resetSharedTimelineStressTracking();
    const nextState = this.updateState({
      currentTrack: track,
      queue,
      currentIndex: index,
      playbackState: 'loading',
      duration: track.duration ?? 0,
      currentTime: 0,
      bufferedTime: 0,
      bufferedAhead: 0,
      decodeBufferedAhead: 0,
      outputBufferedAhead: 0,
    });
    this.timeUpdateCallbacks.forEach((cb) => cb(nextState.currentTime));
  }

  private buildQueuePaths(queue: Track[]): string[] {
    return queue.map((track) => this.getTrackPath(track)).filter(Boolean) as string[];
  }

  private disposed = false;
  private pendingQueueSync: { queue: Track[]; currentIndex: number; indexOnly: boolean } | null =
    null;
  private queueSyncScheduled = false;
  private lastSyncedQueueRef: Track[] | null = null;
  private lastSyncedQueueIndex = -1;

  private scheduleQueueSyncFlush(): void {
    if (this.disposed) {
      this.pendingQueueSync = null;
      return;
    }
    if (this.queueSyncScheduled) return;
    this.queueSyncScheduled = true;

    const flush = () => {
      this.queueSyncScheduled = false;
      if (this.disposed) {
        this.pendingQueueSync = null;
        return;
      }
      const pending = this.pendingQueueSync;
      this.pendingQueueSync = null;
      if (!pending) return;

      const canUseIndexOnlySync =
        pending.indexOnly &&
        this.lastSyncedQueueRef === pending.queue &&
        pending.currentIndex !== this.lastSyncedQueueIndex;

      if (
        pending.indexOnly &&
        this.lastSyncedQueueRef === pending.queue &&
        pending.currentIndex === this.lastSyncedQueueIndex
      ) {
        return;
      }

      if (canUseIndexOnlySync) {
        void invoke('native_audio_sync_queue_index', {
          currentIndex: pending.currentIndex,
        })
          .then(() => {
            this.lastSyncedQueueIndex = pending.currentIndex;
          })
          .catch((error) => {
            console.warn('[NativeAudio] Failed to sync queue index state:', error);
          });
        return;
      }

      void invoke('native_audio_sync_queue', {
        queue: this.buildQueuePaths(pending.queue),
        currentIndex: pending.currentIndex,
      })
        .then(() => {
          this.lastSyncedQueueRef = pending.queue;
          this.lastSyncedQueueIndex = pending.currentIndex;
        })
        .catch((error) => {
          console.warn('[NativeAudio] Failed to sync queue state:', error);
        });
    };

    if (typeof queueMicrotask === 'function') {
      queueMicrotask(flush);
      return;
    }

    void Promise.resolve().then(flush);
  }

  private syncQueueToNative(
    queue: Track[] = this.state.queue,
    currentIndex = this.state.currentIndex,
    options?: { indexOnly?: boolean }
  ): void {
    if (this.disposed) return;
    const requestIndexOnly = options?.indexOnly === true;
    const previousPending = this.pendingQueueSync;
    const mergedIndexOnly = requestIndexOnly && !(previousPending && !previousPending.indexOnly);
    this.pendingQueueSync = { queue, currentIndex, indexOnly: mergedIndexOnly };
    this.scheduleQueueSyncFlush();
  }

  private resolveQueueFromPaths(queuePaths: string[]): Track[] {
    const pathToTrack = new Map<string, Track>();
    for (const track of this.state.queue) {
      const path = this.getTrackPath(track);
      if (!path) continue;
      const normalizedPath = this.normalizeTrackPathForCompare(path);
      if (!normalizedPath) continue;
      if (!pathToTrack.has(normalizedPath)) {
        pathToTrack.set(normalizedPath, track);
      }
    }

    return queuePaths.map((trackPath) => {
      const existing = pathToTrack.get(this.normalizeTrackPathForCompare(trackPath));
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
      if (
        this.normalizeTrackPathForCompare(this.getTrackPath(queue[index])) !==
        this.normalizeTrackPathForCompare(queuePaths[index])
      ) {
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
      this.evaluateDynamicSrcAutoDegradation({
        triggerActions: true,
        stressScore: effective.stressScore,
      });
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
        .catch((error) => {
          this.logBestEffortError('restore output backend', error);
        });
    } catch (error) {
      this.logBestEffortError('parse output backend from storage', error);
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
            .catch((error) => {
              this.logBestEffortError('restore output device', error);
            });
        }
        return;
      }

      const deviceName = typeof parsed === 'string' ? parsed : null;
      if (!deviceName) return;
      return invoke('native_audio_select_device', { deviceId: null, deviceName })
        .then(() => {})
        .catch((error) => {
          this.logBestEffortError('restore output device by name', error);
        });
    } catch (error) {
      this.logBestEffortError('parse output device from storage', error);
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
        .catch((error) => {
          this.logBestEffortError('restore audio input', error);
        });
    } catch (error) {
      this.logBestEffortError('parse audio input from storage', error);
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
        .catch((error) => {
          this.logBestEffortError('restore gain db', error);
        });
    } catch (error) {
      this.logBestEffortError('parse gain db from storage', error);
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
        .catch((error) => {
          this.logBestEffortError('restore dsp chain', error);
        });
    } catch (error) {
      this.logBestEffortError('parse dsp chain from storage', error);
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
    const index = this.findQueueIndexByPath(this.state.queue, trackPath);
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
    if (playbackState === 'playing' || playbackState === 'buffering') {
      this.lastPlaybackActiveAtMs = Date.now();
    }

    if (playbackState === 'playing' || playbackState === 'paused' || playbackState === 'idle') {
      this.scheduleDynamicSrcRestoreEvaluation();
    }

    if (playbackState === 'stopped' || playbackState === 'idle' || playbackState === 'error') {
      this.lastSpectrumTouchAtMs = 0;
      this.maybeDisableSpectrum();
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

    const resolvedTrack = await this.resolveTrackForNativePlayback(track);

    const trackPath = this.resolveAbsoluteTrackPathOrEmitError(resolvedTrack);
    if (!trackPath) return false;

    const { queue, index } = this.ensureTrackInQueue(resolvedTrack, trackPath);
    this.applyTrackLoadingState(resolvedTrack, queue, index);

    try {
      await this.applyRuntimeControlSettingsToBackend();
      await this.applyReplayGainForTrack(resolvedTrack);
      await this.invokeCommand('native_audio_load', { path: trackPath });
    } catch {
      // invokeCommand already emits error; report failure to callers so they can avoid follow-up commands.
      return false;
    }

    this.syncQueueToNative(queue, index, { indexOnly: queue === this.state.queue });

    this.updateState({
      playbackState: 'paused',
      currentTime: 0,
    });
    return true;
  }

  private async loadAndPlayTrackInternal(track: Track): Promise<boolean> {
    this.clearPendingSeek();
    if (!track) return false;

    const resolvedTrack = await this.resolveTrackForNativePlayback(track);

    const trackPath = this.resolveAbsoluteTrackPathOrEmitError(resolvedTrack);
    if (!trackPath) return false;

    const { queue, index } = this.ensureTrackInQueue(resolvedTrack, trackPath);
    this.applyTrackLoadingState(resolvedTrack, queue, index);

    const replayGainDb = this.computeReplayGainDbForTrack(resolvedTrack);

    try {
      await this.applyRuntimeControlSettingsToBackend();
      await this.invokeCommand('native_audio_load_and_play', { path: trackPath, replayGainDb });
    } catch {
      // invokeCommand already emits error; report failure to callers so they can avoid follow-up commands.
      return false;
    }

    this.syncQueueToNative(queue, index, { indexOnly: queue === this.state.queue });

    this.markTrackPlayedBestEffort(resolvedTrack);

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
    this.seekCommandSeqCounter = this.seekCommandSeqCounter + 1;
    this.pendingSeekSeq = this.seekCommandSeqCounter;
    this.notifyLatestSeekSequence(this.pendingSeekSeq);
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
    const runtimeControlSettings = this.readRuntimeControlSettings();
    if (runtimeControlSettings.volumeDebounceEnabled) {
      this.pendingVolume = clamped;
      this.scheduleVolumeFlush();
    } else {
      this.clearPendingVolume();
      this.lastVolumeDispatchAtMs = Date.now();
      this.fireAndForgetCommand('native_audio_set_volume', { volume: clamped });
    }
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
    if (index < 0 || index >= this.state.queue.length) {
      return;
    }

    const queue = [...this.state.queue];
    queue.splice(index, 1);

    let currentIndex = this.state.currentIndex;
    if (queue.length === 0) {
      this.clearQueue();
      return;
    }

    if (currentIndex === index) {
      currentIndex = Math.min(index, queue.length - 1);
    } else if (currentIndex > index) {
      currentIndex -= 1;
    }

    if (currentIndex >= queue.length) {
      currentIndex = queue.length - 1;
    }

    const previousTrack = this.state.currentTrack;
    const previousTrackPath = previousTrack ? this.normalizeTrackPathForCompare(this.getTrackPath(previousTrack)) : '';
    const trackAtCurrentIndex = queue[currentIndex] ?? null;
    const trackAtCurrentIndexPath = trackAtCurrentIndex
      ? this.normalizeTrackPathForCompare(this.getTrackPath(trackAtCurrentIndex))
      : '';

    const currentTrack =
      previousTrackPath && previousTrackPath === trackAtCurrentIndexPath
        ? previousTrack
        : currentIndex >= 0
          ? trackAtCurrentIndex
          : null;

    this.updateState({ queue, currentIndex, currentTrack });
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

  async listAudioInputs(): Promise<string[]> {
    if (!isTauriRuntime()) return [];

    try {
      const payload = await invoke<unknown>('native_audio_list_audio_inputs');
      return this.normalizeOutputBackends(payload);
    } catch (error) {
      console.warn('[NativeAudio] Failed to list audio inputs:', error);
      return [];
    }
  }

  async selectAudioInput(inputId: string | null): Promise<boolean> {
    if (!isTauriRuntime()) return false;

    const normalizedInputId = this.sanitizeBackendId(inputId);

    try {
      const payload = await invoke<unknown>('native_audio_select_audio_input', {
        inputId: normalizedInputId,
      });
      const parsed = this.parseComponentsStatePayload(payload);
      const persistedInputId = this.sanitizeBackendId(parsed.preferredInputId) ?? normalizedInputId;

      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_INPUT_ID,
        persistedInputId,
        TAURI_EVENTS.NATIVE_AUDIO_INPUT_ID_UPDATED
      );

      return true;
    } catch (error) {
      console.warn('[NativeAudio] Failed to select audio input:', error);
      return false;
    }
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
      const originalTrack = this.state.queue[index];
      const track = await this.resolveTrackForNativePlayback(originalTrack);
      if (track !== originalTrack) {
        const nextQueue = [...this.state.queue];
        nextQueue[index] = track;
        this.updateState({ queue: nextQueue });
      }
      this.resetSharedTimelineStressTracking();
      this.updateState({ currentIndex: index });
      this.syncQueueToNative(this.state.queue, index, { indexOnly: true });

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
          decodeBufferedAhead: 0,
          outputBufferedAhead: 0,
        });
        this.timeUpdateCallbacks.forEach((cb) => cb(nextState.currentTime));

        await this.applyReplayGainForTrack(track);
        await this.invokeCommand('native_audio_crossfade_to', {
          path: trackPath,
          durationMs: crossfade.durationMs,
        });
        this.markTrackPlayedBestEffort(track);
        return;
      }

      const loaded = await this.loadAndPlayTrackInternal(track);
      if (!loaded) return;
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
  createPlaylist(name: string, description?: string, options?: PlaylistCreateOptions): Playlist {
    const kind =
      options?.kind === NativeAudioService.PLAYLIST_KIND_SMART
        ? NativeAudioService.PLAYLIST_KIND_SMART
        : options?.kind === NativeAudioService.PLAYLIST_KIND_PLATFORM
          ? NativeAudioService.PLAYLIST_KIND_PLATFORM
          : NativeAudioService.PLAYLIST_KIND_MANUAL;

    const now = Date.now();
    const playlist: Playlist = {
      id: `playlist-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description,
      tracks: [],
      kind,
      readonly: options?.readonly === true || kind === NativeAudioService.PLAYLIST_KIND_SMART,
      sourceConnectorId: options?.sourceConnectorId,
      sourcePlaylistId: options?.sourcePlaylistId,
      smartRuleJson: options?.smartRuleJson,
      createdAt: now,
      updatedAt: now,
      trackCount: 0,
      totalDuration: 0,
    };

    const playlists = [...this.state.playlists, playlist];
    this.updateState({ playlists });
    this.persistPlaylistToLibraryDbBestEffort(playlist);
    return playlist;
  }

  deletePlaylist(playlistId: string): void {
    const targetPlaylist = this.getPlaylist(playlistId);
    if (this.isReadonlyPlaylist(targetPlaylist)) return;

    const playlists = this.state.playlists.filter((pl) => pl.id !== playlistId);
    const currentPlaylist =
      this.state.currentPlaylist?.id === playlistId ? null : this.state.currentPlaylist;
    this.updateState({ playlists, currentPlaylist });
    this.deletePlaylistFromLibraryDbBestEffort(playlistId);
  }

  renamePlaylist(playlistId: string, newName: string): void {
    const targetPlaylist = this.getPlaylist(playlistId);
    if (this.isReadonlyPlaylist(targetPlaylist)) return;

    const playlists = this.state.playlists.map((pl) =>
      pl.id === playlistId ? { ...pl, name: newName, updatedAt: Date.now() } : pl
    );
    this.updateState({ playlists });
    const updatedPlaylist = playlists.find((pl) => pl.id === playlistId);
    if (updatedPlaylist) {
      this.persistPlaylistToLibraryDbBestEffort(updatedPlaylist);
    }
  }

  getPlaylists(): Playlist[] {
    return this.state.playlists;
  }

  getPlaylist(playlistId: string): Playlist | null {
    return this.state.playlists.find((pl) => pl.id === playlistId) ?? null;
  }

  addTrackToPlaylist(playlistId: string, track: Track): void {
    const targetPlaylist = this.getPlaylist(playlistId);
    if (this.isReadonlyPlaylist(targetPlaylist)) return;

    const playlists = this.state.playlists.map((pl) => {
      if (pl.id !== playlistId) return pl;
      const tracks = prependTrackWithDedup(pl.tracks, track);
      return {
        ...pl,
        tracks,
        trackCount: tracks.length,
        totalDuration: tracks.reduce((sum, item) => sum + (item.duration ?? 0), 0),
        updatedAt: Date.now(),
      };
    });
    this.updateState({ playlists });
    const updatedPlaylist = playlists.find((pl) => pl.id === playlistId);
    if (updatedPlaylist) {
      this.persistPlaylistToLibraryDbBestEffort(updatedPlaylist);
    }
  }

  removeTrackFromPlaylist(playlistId: string, trackIndex: number): void {
    const targetPlaylist = this.getPlaylist(playlistId);
    if (this.isReadonlyPlaylist(targetPlaylist)) return;

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
    const updatedPlaylist = playlists.find((pl) => pl.id === playlistId);
    if (updatedPlaylist) {
      this.persistPlaylistToLibraryDbBestEffort(updatedPlaylist);
    }
  }

  clearPlaylist(playlistId: string): void {
    const targetPlaylist = this.getPlaylist(playlistId);
    if (this.isReadonlyPlaylist(targetPlaylist)) return;

    const playlists = this.state.playlists.map((pl) =>
      pl.id === playlistId
        ? { ...pl, tracks: [], trackCount: 0, totalDuration: 0, updatedAt: Date.now() }
        : pl
    );
    this.updateState({ playlists });
    const updatedPlaylist = playlists.find((pl) => pl.id === playlistId);
    if (updatedPlaylist) {
      this.persistPlaylistToLibraryDbBestEffort(updatedPlaylist);
    }
  }

  async playPlaylist(playlistId: string): Promise<void> {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist || playlist.tracks.length === 0) return;
    this.clearQueue();
    this.addMultipleToQueue(playlist.tracks);
    await this.playTrackAtIndex(0);
    this.updateState({ currentPlaylist: playlist });
    this.touchPlaylistOpenedBestEffort(playlistId);
  }

  addPlaylistToQueue(playlistId: string): void {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) return;
    this.addMultipleToQueue(playlist.tracks);
  }

  private touchSpectrumUsage(): void {
    if (this.disposed) return;

    const nowMs = Date.now();
    const playbackState = this.state.playbackState;
    const playbackActive = playbackState === 'playing' || playbackState === 'buffering';
    const withinPlaybackGrace = nowMs - this.lastPlaybackActiveAtMs <= this.spectrumPlaybackGraceMs;

    if (!playbackActive && !withinPlaybackGrace) {
      this.lastSpectrumTouchAtMs = 0;
      this.maybeDisableSpectrum();
      return;
    }

    this.lastSpectrumTouchAtMs = nowMs;
    this.ensureSpectrumEnabled();
    this.scheduleSpectrumDisable();
  }

  private ensureSpectrumEnabled(): void {
    if (this.spectrumEnabled || this.spectrumEnablePending) return;
    this.spectrumEnablePending = true;
    void this.setSpectrumEnabled(true).finally(() => {
      this.spectrumEnablePending = false;
    });
  }

  private scheduleSpectrumDisable(): void {
    if (typeof window === 'undefined') return;
    if (this.spectrumDisableTimer !== null) return;
    const timeout = Math.max(500, this.spectrumIdleTimeoutMs + 100);
    this.spectrumDisableTimer = window.setTimeout(() => {
      this.spectrumDisableTimer = null;
      this.maybeDisableSpectrum();
    }, timeout);
  }

  private maybeDisableSpectrum(): void {
    if (this.disposed) return;
    const idleMs = Date.now() - this.lastSpectrumTouchAtMs;
    if (idleMs < this.spectrumIdleTimeoutMs) {
      this.scheduleSpectrumDisable();
      return;
    }
    if (!this.spectrumEnabled) return;
    void this.setSpectrumEnabled(false);
  }

  private async setSpectrumEnabled(enabled: boolean): Promise<void> {
    if (this.spectrumEnabled === enabled) return;
    this.spectrumEnabled = enabled;
    try {
      await invoke('native_audio_set_spectrum_enabled', { enabled });
    } catch (error) {
      console.warn('[audio] Failed to set spectrum enabled', error);
    }
    if (!enabled) {
      this.spectrumData = null;
      this.spectrumFrames = {};
    }
  }

  // ===== 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸劍閺呮繈鏌曟径娑橆洭缂佺姵鍎抽埞鎴︽偐閸欏鍋嶉梺閫炲苯澧柛濠傜仢閻ｉ攱绺界粙鍨祮闂佺粯鍔楅弫鎼佸储椤掍椒绻嗛柣鎰典簻閳ь剚鐗犻幃褍螖閸愨晛搴婇悗骞垮劚閹峰鎮炴禒瀣厵闁绘垶锕╁▓鏇㈡煟?(placeholder) =====
  getFrequencyData(): Uint8Array | null {
    this.touchSpectrumUsage();
    return this.spectrumData;
  }

  getSpectrumFrame(tap: AudioSpectrumTap = 'post-dsp'): AudioSpectrumFrame | null {
    this.touchSpectrumUsage();
    return this.spectrumFrames[tap] ?? null;
  }

  // ===== 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈缁犱即鏌熼梻瀵割槮缂佺姷濞€閺岀喖鎮ч崼鐔哄嚒缂?=====
  destroy(): void {
    this.disposed = true;
    this.pendingQueueSync = null;
    this.queueSyncScheduled = false;
    this.lastSyncedQueueRef = null;
    this.lastSyncedQueueIndex = -1;
    this.diagnosticTimelineIgnoreBeforeMs = 0;

    this.stop();
    this.clearRecentSmartPlaylistWriteTimer();
    this.flushRecentSmartPlaylistWriteBufferBestEffort();
    this.clearPendingVolume();
    this.stopFallbackTicker();
    this.clearProtectionWindowTimer();
    this.clearDynamicSrcRestoreTimer();
    this.clearDynamicSrcLearningPersistTimer();
    this.protectionWindowUntilMs = 0;
    this.protectionWindowRefCount = 0;
    this.protectionWindowReason = null;
    this.dynamicSrcHoldUntilMs = 0;
    this.dynamicSrcAutoDegradationLevel = 0;
    this.dynamicSrcAutoDegradationReason = null;
    this.dynamicSrcAutoDegradationLastChangedAtMs = null;
    this.dynamicSrcSettingsListenerCleanup?.();
    this.dynamicSrcSettingsListenerCleanup = null;
    this.dynamicSrcSettingsListenerInitPromise = null;
    this.tuningAutoSettingsListenerCleanup?.();
    this.tuningAutoSettingsListenerCleanup = null;
    this.tuningAutoSettingsListenerInitPromise = null;
    this.clearTuningAutoLoop();
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
    if (this.spectrumDisableTimer !== null) {
      window.clearTimeout(this.spectrumDisableTimer);
      this.spectrumDisableTimer = null;
    }
    if (this.spectrumEnabled) {
      void this.setSpectrumEnabled(false);
    }
    this.spectrumData = null;
    this.spectrumFrames = {};
  }
}
