import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { setupNativeListenersImpl } from './nativeAudioNativeListeners';
import { restoreDynamicSrcAutoSettingsFromStorageImpl } from './nativeAudioDynamicSrcAutoSettings';
import {
  AudioDynamicSrcAdaptiveProfile,
  AudioDynamicSrcDegradationLevel,
  AudioDynamicSrcAutoSettingsPatch,
  AudioDynamicSrcAutoSettings,
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
  PlaylistTrackPageResult,
  PlaylistTrackSortDirection,
  PlaylistTrackSortField,
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
  resolvePlatformPlaybackIdentity,
} from './platformPlaybackResolver';
import {
  computeDynamicSrcStressScore,
  resolveDynamicSrcDegradationTransition,
} from './audioStabilityController';
import {
  evaluateAutoOutputSwitch,
  isSharedOutputBackendId,
  pruneUnderrunSpikeTimestamps,
  resolveAutoOutputBackendChain,
  resolveNextAutoOutputBackend,
} from './audioOutputFailoverController';
import {
  SeekCommandCoalescer,
  VolumeCommandCoalescer,
} from './audioCommandCoalescers';
import { DynamicSrcPolicyExecutor } from './dynamicSrcPolicyExecutor';
import {
  getDynamicSrcAdaptiveScale,
  resolveDynamicSrcAdaptiveProfile,
  resolveDynamicSrcEffectiveTiming,
} from './dynamicSrcAdaptiveTiming';
import {
  isSameStreamingBufferSettings,
  resolveStoredStreamingBufferSettings,
  resolveStreamingBufferPolicyTarget,
  type StreamingBufferSettings,
} from './streamingBufferPolicy';
import {
  createAudioTuningControllerState,
  resolveAudioTuningProfilePayload,
  resolveAudioTuningTransition,
} from './audioTuningProfiles';
import {
  resolveStoredDynamicSrcAutoSettings,
  resolveStoredTuningAutoSettings,
} from './nativeAudioAutoSettingsStorage';
import {
  persistAudioPlaybackMuted,
  persistAudioPlaybackPlayMode,
  persistAudioPlaybackVolume,
  readPersistedAudioPlaybackPreferences,
  setupAudioPlaybackPreferencesListener,
  type AudioPlaybackPreferences,
} from './audioPlaybackPreferences';
import {
  clearNativeLibraryPlaylistItems,
  deleteNativeLibraryPlaylist,
  markNativeLibraryUserEntryPlayed,
  listNativeLibraryPlaylistItems,
  listNativeLibraryPlaylists,
  prependNativeLibraryPlaylistItem,
  queryNativeLibraryPlaylistTracksPage,
  queryNativeLibraryTracks,
  replaceNativeLibraryPlaylistItems,
  removeNativeLibraryPlaylistItemAt,
  touchNativeLibraryPlaylistOpened,
  upsertNativeLibraryUserEntry,
  upsertNativeLibraryPlaylist,
  type NativeLibraryPlaylistItemRecord,
  type NativeLibraryPlaylistRecord,
} from '../../modules/music-library';
import { preparePlatformPlayback } from '../../modules/music-platform/platformFacade';
import { resolvePlaylistTrackIndexes } from '../../modules/playlists/runtimeProjection';
import { readString, removeKey } from '../../modules/storage';
import {
  cancelScheduledProcessWorkingSetTrim,
  getLastProcessWorkingSetTrimEvent,
  scheduleProcessWorkingSetTrim,
} from '../../utils/processWorkingSetTrim';
import {
  recordRecentPlaylistWriteFlushed,
  recordRecentPlaylistWriteScheduled,
} from './audioPerformanceTelemetry';
import { buildNativeAudioRobustnessSnapshot } from './nativeAudioRobustnessSnapshot';
import { NativeAudioRobustnessController } from './nativeAudioRobustnessController';
import { createNativeAudioRobustnessSnapshotSource } from './nativeAudioRobustnessSnapshotAdapter';
import {
  clearPendingSeekGuardImpl,
  clearPendingSeekImpl,
  clearPendingVolumeImpl,
  flushPendingSeekCommandImpl,
  flushPendingVolumeCommandImpl,
  hasPendingSeekWorkImpl,
  markPendingSeekGuardImpl,
  scheduleSeekFlushImpl,
  scheduleVolumeFlushImpl,
  seekImpl,
  setVolumeImpl,
  shouldIgnoreBackendCurrentTimeImpl,
  type NativeAudioTransportFacadeContext,
} from './nativeAudioTransportFacade';
import {
  applyRecentSmartPlaylistSnapshotToState,
  compactTrackForRecentPlaylist,
  mergeRecentSmartPlaylistTracks,
  serializeTrackForPlaylist,
  toPlaylistItemUpserts,
  type RecentSmartPlaylistWriteEntry,
} from './recentSmartPlaylist';
import {
  compactTrackForPlaylistState,
  compactTrackForQueueState,
  compactTrackForState,
} from './trackStateProjection';
import { musicLibraryService, type CoverSizeHint } from './MusicLibraryService';
import {
  parseLegacyRuntimeControlFromReplayGain,
  type CrossfadeSettings,
  type DynamicSrcLearningMap,
  type DynamicSrcLearningRecord,
  type NativeAudioComponentsStatePayload,
  type NativeAudioEnginePolicyPatch,
  type NativeAudioEnginePolicyPayload,
  type NativeAudioSrcPolicy,
  type ReplayGainMode,
  type ReplayGainSettings,
  type RuntimeControlSettings,
  type StateListener,
} from './nativeAudioServiceTypes';
import { getTelemetryLogger } from '../telemetry/TelemetryService';
import { captureTelemetryScenarioSnapshot } from '../telemetry/scenarioSnapshots';
import { invokeWithTelemetry } from '../telemetry/tauriInvokeTelemetry';

function approxJsonBytes(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return null;
  }
}

function readTelemetryErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

const PLAYLIST_QUEUE_PAGE_SIZE = 120;

function buildContiguousPlaylistIndexRanges(
  indexes: readonly number[]
): Array<{ offset: number; limit: number }> {
  if (indexes.length === 0) {
    return [];
  }

  const ranges: Array<{ offset: number; limit: number }> = [];
  let start = indexes[0] ?? 0;
  let previous = start;

  for (let index = 1; index < indexes.length; index += 1) {
    const current = indexes[index] ?? previous;
    if (current === previous + 1) {
      previous = current;
      continue;
    }

    ranges.push({
      offset: start,
      limit: previous - start + 1,
    });
    start = current;
    previous = current;
  }

  ranges.push({
    offset: start,
    limit: previous - start + 1,
  });
  return ranges;
}

function buildTrackTelemetryFields(track: Track | null | undefined): Record<string, unknown> {
  if (!track) {
    return {
      trackId: null,
      trackTitle: null,
      trackPathPresent: false,
    };
  }

  return {
    trackId: typeof track.id === 'string' ? track.id : null,
    trackTitle: typeof track.title === 'string' ? track.title : null,
    trackPathPresent: Boolean(track.filePath || track.path),
  };
}

/**
 * NativeAudioService
 *
 * Skeleton implementation that mirrors the Web audio interface while delegating
 * transport commands to the Tauri backend. Real decoding / playback will be
 * implemented step-by-step; for now we optimistically update state to keep the
 * UI responsive.
 */
export class NativeAudioService implements IAudioService {
  private static readonly LEGACY_OUTPUT_DEVICE_STORAGE_KEY =
    'pixel-matrix-native-audio-output-device';

  private readonly telemetry = getTelemetryLogger('audio', 'NativeAudioService');
  private state: AudioState;
  private timeUpdateCallbacks: Set<(time: number) => void> = new Set();
  private endedCallbacks: Set<() => void> = new Set();
  private stateChangeCallbacks: Set<StateListener> = new Set();
  private loadProgressCallbacks: Set<(progress: number) => void> = new Set();
  private errorCallbacks: Set<(error: Error) => void> = new Set();
  private readonly robustnessController = new NativeAudioRobustnessController({
    minIntervalMs: NativeAudioService.ROBUSTNESS_EMISSION_MIN_INTERVAL_MS,
    forceBurstWindowMs: NativeAudioService.ROBUSTNESS_FORCE_BURST_WINDOW_MS,
    forceBurstLimit: NativeAudioService.ROBUSTNESS_FORCE_BURST_LIMIT,
    buildSnapshot: () => this.buildRobustnessSnapshot(),
    onListenerError: (error) => {
      this.telemetry.warn('audio.robustness.listener.failed', {
        message: readTelemetryErrorMessage(error),
      });
    },
  });
  private stateListener?: UnlistenFn;
  private spectrumListener?: UnlistenFn;
  private errorListener?: UnlistenFn;
  private runtimeComponentsListeners: UnlistenFn[] = [];
  private dynamicSrcSettingsListenerCleanup: (() => void) | null = null;
  private dynamicSrcSettingsListenerInitPromise: Promise<void> | null = null;
  private tuningAutoSettingsListenerCleanup: (() => void) | null = null;
  private tuningAutoSettingsListenerInitPromise: Promise<void> | null = null;
  private playbackPreferencesListenerCleanup: (() => void) | null = null;
  private playbackPreferencesListenerInitPromise: Promise<void> | null = null;
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
  private playlistHydrationPromises = new Map<string, Promise<Playlist | null>>();
  private lastNativeErrorSeq = 0;
  private fallbackTicker: number | null = null;
  private fallbackClockStartedAtMs: number | null = null;
  private fallbackClockBaseTimeSec: number = 0;
  private lastBackendTimeUpdateAtMs: number = 0;
  private lastUnderrunEvents: number = 0;
  private lastUnderrunFrames: number = 0;
  private underrunRecoveryUntilMs: number = 0;
  private underrunSpikeTimestampsMs: number[] = [];
  private readonly seekCommandCoalescer = new SeekCommandCoalescer({
    coalesceMs: NativeAudioService.SEEK_COALESCE_MS,
    minDispatchIntervalMs: NativeAudioService.SEEK_DISPATCH_MIN_INTERVAL_MS,
    maxParallelInvocations: NativeAudioService.SEEK_MAX_PARALLEL_INVOCATIONS,
    staleGuardWindowMs: NativeAudioService.SEEK_STALE_GUARD_WINDOW_MS,
    staleGuardToleranceSeconds: NativeAudioService.SEEK_STALE_GUARD_TOLERANCE_SECONDS,
  });
  private readonly volumeCommandCoalescer = new VolumeCommandCoalescer({
    coalesceMs: NativeAudioService.VOLUME_COALESCE_MS,
    minDispatchIntervalMs: NativeAudioService.VOLUME_DISPATCH_MIN_INTERVAL_MS,
  });
  private readonly transportFacadeContext: NativeAudioTransportFacadeContext =
    this.createTransportFacadeContext();
  private seekCommandSeqCounter = Math.max(1, Date.now());
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
  private trackSwitchWorkingSetTrimRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private renderQueuePageLockProtectionUntilMs = 0;
  private availableOutputBackends: string[] = [];
  private currentOutputBackendId: string | null = null;
  private currentOutputDeviceId: string | null = null;
  private currentOutputDeviceName: string | null = null;
  private backendSwitchInFlight = false;
  private autoBackendSwitchCount = 0;
  private lastAutoBackendSwitchAtMs: number | null = null;
  private lastAutoBackendSwitchReason: string | null = null;
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
  private readonly dynamicSrcPolicyExecutor = new DynamicSrcPolicyExecutor();
  private dynamicSrcManualLockActive = false;
  private dynamicSrcQualityPolicy: NativeAudioSrcPolicy = {
    srcMode: 'match-output',
    srcBackend: 'rubato',
    srcTargetSampleRate: null,
  };
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
  private renderQueuePageLockFailureCount = 0;
  private renderQueuePageLockAttemptedBytes = 0;
  private renderQueuePageLockSucceededBytes = 0;
  private renderQueuePageLockFailedBytes = 0;
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
  private estimatedAudioBufferBytes = 0;
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
  private static readonly TRACK_SWITCH_TRIM_MIN_BUFFERED_AHEAD_SECONDS = 3;
  private static readonly TRACK_SWITCH_TRIM_MIN_OUTPUT_BUFFERED_AHEAD_SECONDS = 1;
  private static readonly TRACK_SWITCH_TRIM_RETRY_MS = 2_500;
  private static readonly TRACK_SWITCH_TRIM_MAX_DEFER_MS = 45_000;
  private static readonly RENDER_QUEUE_PAGE_LOCK_PROTECTION_MS = 18_000;
  private static readonly RENDER_QUEUE_PAGE_LOCK_PROTECTION_DEBOUNCE_MS = 12_000;
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
  private static readonly ROBUSTNESS_EMISSION_MIN_INTERVAL_MS = 120;
  private static readonly ROBUSTNESS_FORCE_BURST_WINDOW_MS = 300;
  private static readonly ROBUSTNESS_FORCE_BURST_LIMIT = 3;
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

  private buildQueueTelemetryFields(
    queue: Track[],
    currentIndex: number,
    extra?: Record<string, unknown>
  ): Record<string, unknown> {
    const queuePaths = this.buildQueuePaths(queue);
    return {
      queueLength: queue.length,
      currentIndex,
      queuePathCount: queuePaths.length,
      queuePathApproxBytes: approxJsonBytes(queuePaths),
      ...extra,
    };
  }

  private logBestEffortError(context: string, error: unknown): void {
    this.telemetry.warn('audio.best-effort.failed', {
      message: readTelemetryErrorMessage(error),
      fields: { context },
    });
  }

  private fireAndForgetCommand(cmd: string, payload?: Record<string, unknown>): void {
    void this.invokeCommand(cmd, payload).catch((error) => {
      this.logBestEffortError(`best-effort command ${cmd}`, error);
    });
  }

  private markPlatformTrackPlayedBestEffort(
    track: Track,
    playedAtMs: number,
    identity = resolvePlatformPlaybackIdentity(track)
  ): void {
    if (!isTauriRuntime()) return;

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
        this.telemetry.warn('audio.platform-entry.played-mark.failed', {
          message: readTelemetryErrorMessage(error),
          fields: buildTrackTelemetryFields(track),
        });
      });
  }

  private async resolveTrackForNativePlayback(track: Track): Promise<Track> {
    if (!isTauriRuntime()) return track;

    const identity = resolvePlatformPlaybackIdentity(track);
    if (!identity?.sourceLocator) {
      return track;
    }

    const sourceLocator = identity.sourceLocator;

    try {
      const preparedResult = await preparePlatformPlayback({
        connectorId: identity.connectorId,
        sourceLocator,
      });
      const prepared = preparedResult?.prepared;
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
    const platformIdentity = resolvePlatformPlaybackIdentity(track);
    this.enqueueRecentSmartPlaylistTrackBestEffort(track, playedAtMs);
    this.markPlatformTrackPlayedBestEffort(track, playedAtMs, platformIdentity);

    const trackId = typeof track?.id === 'string' ? track.id.trim() : '';
    if (!trackId || platformIdentity) return;

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

    return compactTrackForPlaylistState(track);
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

  private sanitizePlaylistCoverUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    if (!normalized) return undefined;

    const lower = normalized.toLowerCase();
    if (
      lower.startsWith('http://') ||
      lower.startsWith('https://') ||
      lower.startsWith('pmp://cover/') ||
      lower.startsWith('pmp://localhost/cover/')
    ) {
      return normalized;
    }

    return undefined;
  }

  private isAssetLocalhostHttpUrl(value: string | null | undefined): boolean {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) return false;

    try {
      const parsed = new URL(normalized);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      return parsed.hostname.toLowerCase() === 'asset.localhost';
    } catch {
      return false;
    }
  }

  private isPlaylistCoverResolutionAbsolutePath(value: string | null | undefined): boolean {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) return false;
    if (normalized.startsWith('/') || normalized.startsWith('\\\\')) return true;
    return /^[A-Za-z]:[\\/]/.test(normalized);
  }

  private canRenderPmpPlaylistCoverDirectly(): boolean {
    if (typeof window === 'undefined') return true;
    const protocol = String(window.location?.protocol || '').toLowerCase();
    return protocol !== 'http:' && protocol !== 'https:';
  }

  private async loadPlaylistCoverPreviewTracks(
    playlist: Playlist,
    limit: number
  ): Promise<Track[]> {
    const playlistId = String(playlist.id || '').trim();
    if (!playlistId) return [];

    const normalizedLimit = Math.max(1, Math.min(8, Math.floor(limit)));
    let tracks = this.parseTracksFromPlaylistItems(
      playlistId,
      await listNativeLibraryPlaylistItems(playlistId, { limit: normalizedLimit })
    ).slice(0, normalizedLimit);

    if (
      tracks.length === 0 &&
      playlist.kind === NativeAudioService.PLAYLIST_KIND_SMART &&
      playlistId === NativeAudioService.SMART_PLAYLIST_RECENT_ID
    ) {
      tracks = (await this.buildRecentSmartPlaylistTracks(normalizedLimit)).slice(
        0,
        normalizedLimit
      );
    }

    return tracks;
  }

  async resolvePlaylistCoverPreview(
    playlistId: string,
    options?: { coverSizeHint?: CoverSizeHint; preferCompactPreview?: boolean }
  ): Promise<string | undefined> {
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return undefined;

    const playlist = this.getPlaylist(normalizedPlaylistId);
    if (!playlist) return undefined;

    const explicitPlaylistCover = this.sanitizePlaylistCoverUrl(playlist.coverUrl);
    const preferCompactPreview = options?.preferCompactPreview === true;
    const explicitPlaylistCoverLower =
      typeof explicitPlaylistCover === 'string' ? explicitPlaylistCover.toLowerCase() : '';
    const isManagedPmpPlaylistCover =
      explicitPlaylistCoverLower.startsWith('pmp://cover/') ||
      explicitPlaylistCoverLower.startsWith('pmp://localhost/cover/');
    const isAssetLocalhostPlaylistCover =
      this.isAssetLocalhostHttpUrl(explicitPlaylistCover);
    if (
      explicitPlaylistCover &&
      !preferCompactPreview &&
      !isManagedPmpPlaylistCover &&
      !isAssetLocalhostPlaylistCover
    ) {
      return explicitPlaylistCover;
    }

    const scanLimit = 5;
    const trackCandidates =
      playlist.tracksHydrated !== false && playlist.tracks.length > 0
        ? playlist.tracks.slice(0, scanLimit)
        : await this.loadPlaylistCoverPreviewTracks(playlist, scanLimit);

    for (const candidate of trackCandidates) {
      const embeddedCoverUrl =
        typeof candidate.coverUrl === 'string' ? candidate.coverUrl.trim() : '';
      const shouldIgnoreEmbeddedTrackCover =
        this.isPlaylistCoverResolutionAbsolutePath(candidate.filePath || candidate.path) ||
        embeddedCoverUrl.toLowerCase().startsWith('pmp://cover/') ||
        embeddedCoverUrl.toLowerCase().startsWith('pmp://localhost/cover/');
      const resolutionCandidate = shouldIgnoreEmbeddedTrackCover
        ? { ...candidate, coverUrl: undefined }
        : candidate;

      try {
        const resolvedUrl = await musicLibraryService.getCoverUrlForTrack(resolutionCandidate, {
          coverSizeHint: options?.coverSizeHint ?? 'small',
          bypassRuntimePolicy: true,
        });
        const normalizedResolvedUrl =
          typeof resolvedUrl === 'string' ? resolvedUrl.trim() : '';
        if (normalizedResolvedUrl) {
          return normalizedResolvedUrl;
        }
      } catch {
        // best-effort preview resolution
      }

      if (embeddedCoverUrl && !shouldIgnoreEmbeddedTrackCover) {
        return embeddedCoverUrl;
      }
    }

    if (
      explicitPlaylistCover &&
      (this.canRenderPmpPlaylistCoverDirectly() ||
        !isManagedPmpPlaylistCover)
    ) {
      return explicitPlaylistCover;
    }

    return undefined;
  }

  private createPlaylistSummaryFromRecord(record: {
    id: string;
    name: string;
    description?: string;
    coverUrl?: string;
    kind?: Playlist['kind'];
    isReadonly?: boolean;
    sourceConnectorId?: string;
    sourcePlaylistId?: string;
    smartRuleJson?: string;
    createdAtMs?: number;
    updatedAtMs?: number;
    trackCount?: number;
    totalDuration?: number;
  }): Playlist {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      coverUrl: this.sanitizePlaylistCoverUrl(record.coverUrl),
      tracks: [],
      kind: record.kind,
      readonly: record.isReadonly,
      sourceConnectorId: record.sourceConnectorId,
      sourcePlaylistId: record.sourcePlaylistId,
      smartRuleJson: record.smartRuleJson,
      createdAt: record.createdAtMs ?? Date.now(),
      updatedAt: record.updatedAtMs ?? Date.now(),
      trackCount:
        typeof record.trackCount === 'number' && Number.isFinite(record.trackCount)
          ? Math.max(0, Math.floor(record.trackCount))
          : 0,
      totalDuration:
        typeof record.totalDuration === 'number' && Number.isFinite(record.totalDuration)
          ? Math.max(0, record.totalDuration)
          : 0,
      tracksHydrated: false,
    };
  }

  private createHydratedPlaylist(
    playlist: Playlist,
    tracks: Track[],
    options?: { trackCount?: number; totalDuration?: number }
  ): Playlist {
    const computedTotalDuration = tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0);
    return {
      ...playlist,
      tracks,
      trackCount:
        typeof options?.trackCount === 'number' && Number.isFinite(options.trackCount)
          ? Math.max(0, Math.floor(options.trackCount))
          : tracks.length,
      totalDuration:
        typeof options?.totalDuration === 'number' && Number.isFinite(options.totalDuration)
          ? Math.max(0, options.totalDuration)
          : computedTotalDuration,
      tracksHydrated: true,
    };
  }

  private createPlaylistSummaryReference(playlist: Playlist | null | undefined): Playlist | null {
    if (!playlist) return null;

    return {
      ...playlist,
      tracks: [],
      trackCount:
        typeof playlist.trackCount === 'number' && Number.isFinite(playlist.trackCount)
          ? Math.max(0, Math.floor(playlist.trackCount))
          : playlist.tracks.length,
      totalDuration:
        typeof playlist.totalDuration === 'number' && Number.isFinite(playlist.totalDuration)
          ? Math.max(0, playlist.totalDuration)
          : playlist.tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
      tracksHydrated: false,
    };
  }

  private syncCurrentPlaylistReference(playlists: Playlist[]): Playlist | null {
    const currentPlaylistId = this.state.currentPlaylist?.id;
    if (!currentPlaylistId) return null;
    return this.createPlaylistSummaryReference(
      playlists.find((playlist) => playlist.id === currentPlaylistId) ?? null
    );
  }

  private async loadPlaylistTracksFromLibraryDb(playlist: Playlist): Promise<Track[]> {
    const playlistId = String(playlist.id || '').trim();
    if (!playlistId) return [];

    if (playlist.kind === NativeAudioService.PLAYLIST_KIND_SMART) {
      const limit = this.resolveRecentSmartPlaylistLimit(playlist.smartRuleJson);
      let tracks = this.parseTracksFromPlaylistItems(
        playlistId,
        await listNativeLibraryPlaylistItems(playlistId, { limit })
      ).slice(0, limit);

      if (
        tracks.length === 0 &&
        playlistId === NativeAudioService.SMART_PLAYLIST_RECENT_ID
      ) {
        tracks = await this.buildRecentSmartPlaylistTracks(limit);
        if (tracks.length > 0) {
          const now = Date.now();
          const snapshotPlaylist: Playlist = {
            id: playlistId,
            name: playlist.name,
            description: playlist.description,
            tracks,
            kind: NativeAudioService.PLAYLIST_KIND_SMART,
            readonly: true,
            smartRuleJson: playlist.smartRuleJson,
            createdAt: playlist.createdAt,
            updatedAt: Math.max(playlist.updatedAt, now),
            trackCount: tracks.length,
            totalDuration: tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
            tracksHydrated: true,
          };
          void replaceNativeLibraryPlaylistItems(
            playlistId,
            toPlaylistItemUpserts(snapshotPlaylist)
          ).catch((error) => {
            this.telemetry.warn('audio.recent-playlist.backfill.failed', {
              message: readTelemetryErrorMessage(error),
              fields: {
                playlistId,
                trackCount: tracks.length,
              },
            });
          });
        }
      }

      return tracks;
    }

    return this.parseTracksFromPlaylistItems(
      playlistId,
      await listNativeLibraryPlaylistItems(playlistId)
    );
  }

  private async resolvePlaylistForQueuePlayback(playlistId: string): Promise<Playlist | null> {
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return null;

    const playlist = this.getPlaylist(normalizedPlaylistId);
    if (!playlist) return null;
    if (playlist.tracksHydrated !== false) {
      return playlist;
    }

    try {
      const tracks = await this.loadPlaylistTracksFromLibraryDb(playlist);
      const latestPlaylist = this.getPlaylist(normalizedPlaylistId) ?? playlist;
      return this.createHydratedPlaylist(latestPlaylist, tracks, {
        trackCount:
          typeof latestPlaylist.trackCount === 'number' && latestPlaylist.trackCount > 0
            ? latestPlaylist.trackCount
            : tracks.length,
        totalDuration:
          typeof latestPlaylist.totalDuration === 'number' && latestPlaylist.totalDuration > 0
            ? latestPlaylist.totalDuration
            : undefined,
      });
    } catch (error) {
      this.telemetry.warn('audio.playlist.queue-resolve.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          playlistId: normalizedPlaylistId,
        },
      });
      return playlist;
    }
  }

  private async loadPlaylistTracksForQueuePlayback(
    playlistId: string
  ): Promise<{ playlist: Playlist; tracks: Track[] } | null> {
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return null;

    const playlist = this.getPlaylist(normalizedPlaylistId);
    if (!playlist) return null;
    if (playlist.tracksHydrated !== false) {
      return {
        playlist,
        tracks: playlist.tracks,
      };
    }

    if (!isTauriRuntime()) {
      const resolvedPlaylist = await this.resolvePlaylistForQueuePlayback(normalizedPlaylistId);
      if (!resolvedPlaylist) return null;
      return {
        playlist: resolvedPlaylist,
        tracks: resolvedPlaylist.tracks,
      };
    }

    const tracks: Track[] = [];
    let offset = 0;
    let total =
      typeof playlist.trackCount === 'number' && Number.isFinite(playlist.trackCount)
        ? Math.max(0, Math.floor(playlist.trackCount))
        : 0;

    while (offset === 0 || offset < total) {
      const page = await this.queryPlaylistTracksPage(normalizedPlaylistId, {
        sortField: 'default',
        sortDirection: 'asc',
        limit: PLAYLIST_QUEUE_PAGE_SIZE,
        offset,
      });
      const items = page?.items ?? [];
      if (typeof page?.total === 'number' && Number.isFinite(page.total)) {
        total = Math.max(0, Math.floor(page.total));
      }
      if (items.length === 0) {
        break;
      }
      tracks.push(...items.map((item) => item.track));
      offset += items.length;
      if (items.length < PLAYLIST_QUEUE_PAGE_SIZE) {
        break;
      }
    }

    return {
      playlist,
      tracks,
    };
  }

  private async loadPlaylistTrackSelectionForQueue(
    playlistId: string,
    trackIndexes: readonly number[]
  ): Promise<{ playlist: Playlist; normalizedIndexes: number[]; tracks: Track[] } | null> {
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return null;

    const playlist = this.getPlaylist(normalizedPlaylistId);
    if (!playlist) return null;

    const normalizedIndexes = this.normalizePlaylistTrackIndexes(playlist, trackIndexes);
    if (normalizedIndexes.length === 0) {
      return {
        playlist,
        normalizedIndexes,
        tracks: [],
      };
    }

    if (playlist.tracksHydrated !== false) {
      return {
        playlist,
        normalizedIndexes,
        tracks: normalizedIndexes
          .map((index) => playlist.tracks[index])
          .filter((track): track is Track => Boolean(track)),
      };
    }

    if (!isTauriRuntime()) {
      const resolvedPlaylist = await this.resolvePlaylistForQueuePlayback(normalizedPlaylistId);
      if (!resolvedPlaylist) return null;
      return {
        playlist: resolvedPlaylist,
        normalizedIndexes,
        tracks: normalizedIndexes
          .map((index) => resolvedPlaylist.tracks[index])
          .filter((track): track is Track => Boolean(track)),
      };
    }

    const selectedTrackMap = new Map<number, Track>();
    for (const range of buildContiguousPlaylistIndexRanges(normalizedIndexes)) {
      let rangeOffset = range.offset;
      let remaining = range.limit;
      while (remaining > 0) {
        const pageLimit = Math.min(PLAYLIST_QUEUE_PAGE_SIZE, remaining);
        const page = await this.queryPlaylistTracksPage(normalizedPlaylistId, {
          sortField: 'default',
          sortDirection: 'asc',
          limit: pageLimit,
          offset: rangeOffset,
        });
        const items = page?.items ?? [];
        if (items.length === 0) {
          break;
        }
        for (const item of items) {
          selectedTrackMap.set(item.playlistIndex, item.track);
        }
        rangeOffset += items.length;
        remaining -= items.length;
        if (items.length < pageLimit) {
          break;
        }
      }
    }

    return {
      playlist,
      normalizedIndexes,
      tracks: normalizedIndexes
        .map((index) => selectedTrackMap.get(index))
        .filter((track): track is Track => Boolean(track)),
    };
  }

  private buildPersistablePlaylistFromTracks(
    playlist: Playlist,
    tracks: Track[],
    updatedAtMs: number = Date.now()
  ): Playlist {
    return {
      ...playlist,
      tracks,
      trackCount: tracks.length,
      totalDuration: tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
      updatedAt: updatedAtMs,
      tracksHydrated: true,
    };
  }

  private replacePlaylistState(playlist: Playlist): void {
    const playlists = this.state.playlists.map((item) =>
      item.id === playlist.id ? playlist : item
    );
    const currentPlaylist =
      this.state.currentPlaylist?.id === playlist.id
        ? this.createPlaylistSummaryReference(playlist)
        : this.syncCurrentPlaylistReference(playlists);
    this.updateState({ playlists, currentPlaylist });
  }

  private replacePlaylistStateWithSummary(playlist: Playlist): void {
    const summaryPlaylist = this.createPlaylistSummaryReference(playlist) ?? playlist;
    this.replacePlaylistState(summaryPlaylist);
  }

  private createPlaylistFromNativeRecord(
    record: NativeLibraryPlaylistRecord,
    options?: {
      tracks?: Track[];
      tracksHydrated?: boolean;
    }
  ): Playlist {
    const summaryPlaylist = this.createPlaylistSummaryFromRecord({
      id: record.id,
      name: record.name,
      description: record.description,
      coverUrl: record.coverUrl,
      kind: record.kind,
      isReadonly: record.isReadonly,
      sourceConnectorId: record.sourceConnectorId,
      sourcePlaylistId: record.sourcePlaylistId,
      smartRuleJson: record.smartRuleJson,
      createdAtMs: record.createdAtMs,
      updatedAtMs: record.updatedAtMs,
      trackCount: record.trackCount,
      totalDuration: record.totalDuration,
    });
    const tracksHydrated = options?.tracksHydrated === true;
    return {
      ...summaryPlaylist,
      tracks: tracksHydrated ? [...(options?.tracks ?? [])] : [],
      tracksHydrated,
    };
  }

  private replacePlaylistStateWithNativeSummaryRecord(record: NativeLibraryPlaylistRecord): void {
    this.replacePlaylistState(this.createPlaylistFromNativeRecord(record));
  }

  private replaceHydratedPlaylistStateWithNativeRecord(
    record: NativeLibraryPlaylistRecord,
    tracks: Track[]
  ): void {
    this.replacePlaylistState(
      this.createPlaylistFromNativeRecord(record, {
        tracks,
        tracksHydrated: true,
      })
    );
  }

  private queryPlaylistTrackPageFromTracks(
    tracks: Track[],
    options?: {
      searchQuery?: string;
      sortField?: PlaylistTrackSortField;
      sortDirection?: PlaylistTrackSortDirection;
      limit?: number;
      offset?: number;
    }
  ): PlaylistTrackPageResult {
    const indexes = resolvePlaylistTrackIndexes({
      tracks,
      searchQuery: options?.searchQuery ?? '',
      sortField: options?.sortField ?? 'default',
      sortDirection: options?.sortDirection ?? 'asc',
    });
    const limit =
      typeof options?.limit === 'number' && Number.isFinite(options.limit)
        ? Math.max(1, Math.min(2000, Math.floor(options.limit)))
        : indexes.length;
    const offset =
      typeof options?.offset === 'number' && Number.isFinite(options.offset)
        ? Math.max(0, Math.floor(options.offset))
        : 0;
    const pagedIndexes = indexes.slice(offset, offset + limit);

    return {
      total: indexes.length,
      items: pagedIndexes
        .map((playlistIndex) => {
          const track = tracks[playlistIndex];
          if (!track) return null;
          return {
            playlistIndex,
            track,
          };
        })
        .filter(
          (
            item
          ): item is {
            playlistIndex: number;
            track: Track;
          } => item != null
        ),
    };
  }

  private normalizePlaylistTrackIndexes(
    playlist: Playlist,
    trackIndexes: readonly number[]
  ): number[] {
    const total =
      typeof playlist.trackCount === 'number' && Number.isFinite(playlist.trackCount)
        ? Math.max(playlist.tracks.length, Math.floor(playlist.trackCount))
        : playlist.tracks.length;
    if (total === 0 || trackIndexes.length === 0) {
      return [];
    }

    const normalized: number[] = [];
    const seen = new Set<number>();
    for (const index of trackIndexes) {
      if (!Number.isInteger(index)) continue;
      if (index < 0 || index >= total) continue;
      if (seen.has(index)) continue;
      seen.add(index);
      normalized.push(index);
    }
    return normalized;
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
        this.telemetry.warn('audio.recent-playlist.flush.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            bufferedEntryCount: bufferedEntries.length,
          },
        });
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

  private upsertPlaylistMetadataToLibraryDbBestEffort(playlist: Playlist): void {
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
      coverUrl: this.sanitizePlaylistCoverUrl(playlist.coverUrl),
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
      .catch((error) => {
        this.telemetry.warn('audio.playlist.metadata-upsert.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            playlistId,
          },
        });
      });
  }

  private deletePlaylistFromLibraryDbBestEffort(playlistId: string): void {
    if (!isTauriRuntime()) return;
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return;

    void deleteNativeLibraryPlaylist(normalizedPlaylistId).catch((error) => {
      this.telemetry.warn('audio.playlist.delete.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          playlistId: normalizedPlaylistId,
        },
      });
    });
  }

  private touchPlaylistOpenedBestEffort(playlistId: string): void {
    if (!isTauriRuntime()) return;
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return;

    void touchNativeLibraryPlaylistOpened(normalizedPlaylistId, {
      openedAtMs: Date.now(),
    }).catch((error) => {
      this.telemetry.warn('audio.playlist.touch-opened.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          playlistId: normalizedPlaylistId,
        },
      });
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

      const playlists = records.map((record) =>
        this.createPlaylistSummaryFromRecord({
          id: record.id,
          name: record.name,
          description: record.description,
          coverUrl: record.coverUrl,
          kind: record.kind,
          isReadonly: record.isReadonly,
          sourceConnectorId: record.sourceConnectorId,
          sourcePlaylistId: record.sourcePlaylistId,
          smartRuleJson: record.smartRuleJson,
          createdAtMs: record.createdAtMs,
          updatedAtMs: record.updatedAtMs,
          trackCount: record.trackCount,
          totalDuration: record.totalDuration,
        })
      );

      const nextCurrentPlaylistId = this.state.currentPlaylist?.id;
      const currentPlaylist = nextCurrentPlaylistId
        ? this.createPlaylistSummaryReference(
            playlists.find((item) => item.id === nextCurrentPlaylistId) ?? null
          )
        : null;
      this.updateState({ playlists, currentPlaylist });
    } catch (error) {
      this.telemetry.warn('audio.playlists.restore.failed', {
        message: readTelemetryErrorMessage(error),
      });
    }
  }

  private notifyLatestSeekSequence(seekSeq: number | null): void {
    if (typeof seekSeq !== 'number' || !Number.isFinite(seekSeq)) return;

    const normalizedSeekSeq = Math.max(1, Math.floor(seekSeq));
    void invokeWithTelemetry('native_audio_mark_seek_seq', { seekSeq: normalizedSeekSeq }, {
      moduleId: 'audio',
      component: 'NativeAudioService',
      event: 'audio.seek-seq.mark',
      failureLevel: 'warn',
      successLevel: 'trace',
    }).catch(() => {
      // Best-effort fast-path: seek command itself still carries seekSeq for correctness.
    });
  }

  private isSharedOutputBackend(backendId: string | null | undefined): backendId is string {
    return isSharedOutputBackendId(backendId);
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

  private createTransportFacadeContext(): NativeAudioTransportFacadeContext {
    const context = {
      seekCoalesceMs: NativeAudioService.SEEK_COALESCE_MS,
      volumeCoalesceMs: NativeAudioService.VOLUME_COALESCE_MS,
      timeUpdateCallbacks: this.timeUpdateCallbacks,
      seekCommandCoalescer: this.seekCommandCoalescer,
      volumeCommandCoalescer: this.volumeCommandCoalescer,
      invokeCommand: (command, payload) => this.invokeCommand(command, payload),
      fireAndForgetCommand: (command, payload) => this.fireAndForgetCommand(command, payload),
      flushDeferredLatencySrcPolicy: (trigger) => this.flushDeferredLatencySrcPolicy(trigger),
      getEffectiveDynamicSrcTiming: (nowMs) => this.getEffectiveDynamicSrcTiming(nowMs),
      withDynamicSrcHold: (reason, holdMs) => this.withDynamicSrcHold(reason, holdMs),
      updateState: (partial) => this.updateState(partial),
      ensureFallbackTicker: () => this.ensureFallbackTicker(),
      readRuntimeControlSettings: () => this.readRuntimeControlSettings(),
      notifyLatestSeekSequence: (seekSeq) => this.notifyLatestSeekSequence(seekSeq),
    } as Omit<
      NativeAudioTransportFacadeContext,
      | 'seekCommandSeqCounter'
      | 'dynamicSrcDeferredLatencyReason'
      | 'state'
      | 'fallbackClockBaseTimeSec'
      | 'fallbackClockStartedAtMs'
    >;

    return Object.defineProperties(context, {
      seekCommandSeqCounter: {
        enumerable: true,
        configurable: true,
        get: () => this.seekCommandSeqCounter,
        set: (value: number) => {
          this.seekCommandSeqCounter = value;
        },
      },
      dynamicSrcDeferredLatencyReason: {
        enumerable: true,
        configurable: true,
        get: () => this.dynamicSrcDeferredLatencyReason,
        set: (value: string | null) => {
          this.dynamicSrcDeferredLatencyReason = value;
        },
      },
      state: {
        enumerable: true,
        configurable: true,
        get: () => this.state,
      },
      fallbackClockBaseTimeSec: {
        enumerable: true,
        configurable: true,
        get: () => this.fallbackClockBaseTimeSec,
        set: (value: number) => {
          this.fallbackClockBaseTimeSec = value;
        },
      },
      fallbackClockStartedAtMs: {
        enumerable: true,
        configurable: true,
        get: () => this.fallbackClockStartedAtMs,
        set: (value: number | null) => {
          this.fallbackClockStartedAtMs = value;
        },
      },
    }) as NativeAudioTransportFacadeContext;
  }

  private clearPendingSeek(): void {
    clearPendingSeekImpl(this.transportFacadeContext);
  }

  private hasPendingSeekWork(): boolean {
    return hasPendingSeekWorkImpl(this.transportFacadeContext);
  }

  private markPendingSeekGuard(target: number): void {
    markPendingSeekGuardImpl(this.transportFacadeContext, target);
  }

  private clearPendingSeekGuard(): void {
    clearPendingSeekGuardImpl(this.transportFacadeContext);
  }

  private shouldIgnoreBackendCurrentTime(nextTime: number): boolean {
    return shouldIgnoreBackendCurrentTimeImpl(this.transportFacadeContext, nextTime);
  }

  private flushPendingSeekCommand(): void {
    flushPendingSeekCommandImpl(this.transportFacadeContext);
  }

  private scheduleSeekFlush(delayMs: number = NativeAudioService.SEEK_COALESCE_MS): void {
    scheduleSeekFlushImpl(this.transportFacadeContext, delayMs);
  }

  private clearPendingVolume(): void {
    clearPendingVolumeImpl(this.transportFacadeContext);
  }

  private flushPendingVolumeCommand(): void {
    flushPendingVolumeCommandImpl(this.transportFacadeContext);
  }

  private scheduleVolumeFlush(delayMs: number = NativeAudioService.VOLUME_COALESCE_MS): void {
    scheduleVolumeFlushImpl(this.transportFacadeContext, delayMs);
  }

  private isProbablyAbsolutePath(value: string): boolean {
    if (!value) return false;
    if (/^[a-zA-Z]:[\\/]/.test(value)) return true; // Windows drive
    if (value.startsWith('\\\\')) return true; // UNC path
    if (value.startsWith('/')) return true; // unix
    return false;
  }

  private retainTypeScriptBaselineState(): void {
    void this.dynamicSrcSettingsListenerInitPromise;
    void this.lastNativeErrorSeq;
    void this.lastUnderrunEvents;
    void this.protectionWindowReason;
    void this.lastAutoBackendSwitchReason;
    void this.lastSchedulerProfile;
    void this.dynamicSrcAutoDegradationLastChangedAtMs;
    void this.dynamicSrcLastSwitchAtMs;
    void this.dynamicSrcLastSwitchReason;
    void this.hqSrcStopbandDb;
    void this.hqSrcActive;
    void this.hqSrcRatio;
    void this.sourceSampleRate;
    void this.outputSampleRate;
    void this.transportExactInt32Container;
    void this.outputCallbackP99Us;
    void this.outputRenderUnderrunFrames;
    void this.outputCallbackExpectedIntervalUs;
    void this.transferLowWatermarkSamples;
    void this.transferAdaptationLevel;
    void this.transferOscillationStreak;
    void this.sharedRenderUnderrunFrames;
    void this.sharedRenderLowWatermarkSamples;
    void this.controlQueueLockFree;
    void this.controlQueueMode;
    void this.controlQueueCapacity;
    void this.controlQueueOverwriteEvents;
    void this.controlQueueDropNewestEvents;
    void this.controlQueueCoalescedOverflowEvents;
    void this.controlQueueCriticalOverflowEvents;
    void this.diagnosticTimelineDroppedEvents;
    void this.diagnosticTimeline;
    void this.tuningAutoLastReason;
    void this.tuningAutoLastAppliedAtMs;
    void this.markPendingSeekGuard;
    void this.clearPendingSeekGuard;
    void this.shouldIgnoreBackendCurrentTime;
    void this.flushPendingSeekCommand;
    void this.scheduleSeekFlush;
    void this.flushPendingVolumeCommand;
    void this.scheduleVolumeFlush;
    void this.parseDynamicSrcLearningProfile;
    void this.updateDynamicSrcLearningFromStress;
    void this.readDynamicSrcAutoSettings;
    void this.applySharedTimelineStressIfNeeded;
    void this.recordBufferedAheadSample;
    void this.trackPlaybackStateForMetrics;
    void this.handleUnderrunSpike;
    void this.maybeReleaseUnderrunRecovery;
    void this.resolveQueueFromPaths;
    void this.isSameQueuePaths;
    void this.resolveTrackFromPath;
    void this.handleTrackEnded;
  }

  constructor() {
    this.retainTypeScriptBaselineState();
    const playbackPreferences = readPersistedAudioPlaybackPreferences();
    this.state = {
      currentTrack: null,
      playbackState: 'idle',
      currentTime: 0,
      duration: 0,
      bufferedTime: 0,
      bufferedAhead: 0,
      decodeBufferedAhead: 0,
      outputBufferedAhead: 0,
      volume: playbackPreferences.volume,
      muted: playbackPreferences.muted,
      playMode: playbackPreferences.playMode,
      queue: [],
      currentIndex: -1,
      playlists: [],
      currentPlaylist: null,
    };

    this.setupNativeListeners();
    void this.setupRuntimeAudioComponentsListeners();
    void this.restoreFromStorage()
      .catch((error) => {
        this.logBestEffortError('restoreFromStorage', error);
      })
      .finally(() => {
        void this.refreshOutputBackendInventory().finally(() => {
          this.emitRobustnessSnapshot();
        });
      });
  }

  private async restoreFromStorage(): Promise<void> {
    this.clearLegacyOutputDevicePersistence();
    await this.restoreOutputBackendFromStorage();
    await this.restoreAudioInputFromStorage();
    await this.restorePlaybackPreferencesFromStorage();
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

  private applyPlaybackPreferences(
    preferences: AudioPlaybackPreferences,
    options?: {
      emitStateChange?: boolean;
      syncBackend?: boolean;
      forceBackendSync?: boolean;
    }
  ): void {
    const volumeChanged = this.state.volume !== preferences.volume;
    const mutedChanged = this.state.muted !== preferences.muted;
    const playModeChanged = this.state.playMode !== preferences.playMode;

    if (volumeChanged || mutedChanged || playModeChanged) {
      this.updateState(
        {
          volume: preferences.volume,
          muted: preferences.muted,
          playMode: preferences.playMode,
        },
        { emitStateChange: options?.emitStateChange }
      );
    }

    if (options?.syncBackend !== true) return;

    if (options.forceBackendSync || volumeChanged) {
      this.fireAndForgetCommand('native_audio_set_volume', { volume: preferences.volume });
    }

    if (options.forceBackendSync || mutedChanged) {
      this.fireAndForgetCommand('native_audio_set_mute', { muted: preferences.muted });
    }
  }

  private async restorePlaybackPreferencesFromStorage(): Promise<void> {
    this.applyPlaybackPreferences(readPersistedAudioPlaybackPreferences(), {
      emitStateChange: false,
      syncBackend: true,
      forceBackendSync: true,
    });

    if (this.playbackPreferencesListenerCleanup) {
      return;
    }
    if (this.playbackPreferencesListenerInitPromise) {
      await this.playbackPreferencesListenerInitPromise;
      return;
    }

    const applyPersistedPreferences = () => {
      this.applyPlaybackPreferences(readPersistedAudioPlaybackPreferences(), {
        syncBackend: true,
      });
    };

    this.playbackPreferencesListenerInitPromise = (async () => {
      if (this.playbackPreferencesListenerCleanup) return;

      const cleanup = await setupAudioPlaybackPreferencesListener(applyPersistedPreferences);
      this.playbackPreferencesListenerCleanup = cleanup;
    })().finally(() => {
      this.playbackPreferencesListenerInitPromise = null;
    });

    await this.playbackPreferencesListenerInitPromise;
  }

  private readStreamingBufferSettings(): {
    settings: StreamingBufferSettings;
    migratedLegacyFullTrack: boolean;
  } {
    return resolveStoredStreamingBufferSettings(
      readString(STORAGE_KEYS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS)
    );
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
      await invokeWithTelemetry('native_audio_vst_set_enabled', { enabled: resolved }, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.vst.enabled.restore',
        failureLevel: 'warn',
      }).catch((error) => {
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
      const graph = await invokeWithTelemetry<unknown>('native_audio_get_dsp_graph', undefined, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.dsp-graph.read',
        failureLevel: 'warn',
      }).catch((error) => {
        this.logBestEffortError('restore dsp graph from backend', error);
        return null;
      });
      if (!graph || typeof graph !== 'object') return false;
      const record = graph as Record<string, unknown>;
      const nodes = record.nodes;
      if (!Array.isArray(nodes) || nodes.length === 0) return false;

      await invokeWithTelemetry('native_audio_set_dsp_graph', { graph: record }, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.dsp-graph.restore',
        failureLevel: 'warn',
      });
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

  private clearLegacyOutputDevicePersistence(): void {
    removeKey(NativeAudioService.LEGACY_OUTPUT_DEVICE_STORAGE_KEY);
  }

  private sanitizeNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private sanitizeBackendId(value: unknown): string | null {
    return this.sanitizeNonEmptyString(value);
  }

  private applyRuntimeAudioComponentsState(components: NativeAudioComponentsStatePayload): void {
    this.currentOutputBackendId = this.sanitizeBackendId(components.outputBackendId);
    this.currentOutputDeviceId = this.sanitizeNonEmptyString(components.outputDeviceId);
    this.currentOutputDeviceName = this.sanitizeNonEmptyString(components.outputDevice);
  }

  private parseComponentsStatePayload(payload: unknown): NativeAudioComponentsStatePayload {
    if (!payload || typeof payload !== 'object') {
      return {
        outputBackendId: null,
        outputDeviceId: null,
        outputDevice: null,
        preferredInputId: null,
        activeInputId: null,
      };
    }

    const record = payload as Record<string, unknown>;
    return {
      outputBackendId: this.sanitizeBackendId(record.outputBackendId),
      outputDeviceId: this.sanitizeNonEmptyString(record.outputDeviceId),
      outputDevice: this.sanitizeNonEmptyString(record.outputDevice),
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
      const backendsPayload = await invokeWithTelemetry<unknown>('native_audio_list_output_backends', undefined, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.output-backends.list',
        failureLevel: 'warn',
      });
      const backends = this.normalizeOutputBackends(backendsPayload);
      if (backends.length > 0) {
        this.availableOutputBackends = backends;
      }
    } catch {
      // best-effort
    }

    try {
      const componentsPayload = await invokeWithTelemetry<unknown>(
        'native_audio_get_audio_components_state',
        undefined,
        {
          moduleId: 'audio',
          component: 'NativeAudioService',
          event: 'audio.components-state.read',
          failureLevel: 'warn',
        }
      );
      const components = this.parseComponentsStatePayload(componentsPayload);
      this.applyRuntimeAudioComponentsState(components);
      const backendId = this.sanitizeBackendId(components.outputBackendId);
      if (backendId) {
        if (!this.availableOutputBackends.includes(backendId)) {
          this.availableOutputBackends = [...this.availableOutputBackends, backendId];
        }
      }
    } catch {
      // best-effort
    }

    try {
      const policyPayload = await invokeWithTelemetry<unknown>('native_audio_get_engine_policy', undefined, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.engine-policy.read',
        failureLevel: 'warn',
      });
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
      srcBackend: 'rubato',
      srcTargetSampleRate: null,
    };
  }

  private buildDynamicSrcStabilityMetrics(nowMs: number = Date.now()) {
    return {
      playbackState: this.state.playbackState,
      underrunRecoveryUntilMs: this.underrunRecoveryUntilMs,
      nowMs,
      protectionWindowActive: this.hasActiveProtectionWindow(nowMs),
      sharedStressWindowActive: this.hasActiveSharedStressWindow(nowMs),
      outputCallbackMetricsValid: this.outputCallbackMetricsValid,
      outputWaitTimeoutCount: this.outputWaitTimeoutCount,
      outputRenderUnderrunEvents: this.outputRenderUnderrunEvents,
      outputCallbackIntervalOverrunCount: this.outputCallbackIntervalOverrunCount,
      outputCallbackIntervalJitterP99Us: this.outputCallbackIntervalJitterP99Us,
      transferMetricsValid: this.transferMetricsValid,
      transferRenderLowHitCount: this.transferRenderLowHitCount,
      transferDecodeLowHitCount: this.transferDecodeLowHitCount,
      renderQueuePageLocked: this.renderQueuePageLocked,
      sharedRenderAheadEnabled: this.sharedRenderAheadEnabled,
      sharedRenderUnderrunEvents: this.sharedRenderUnderrunEvents,
      sharedRenderLowHitCount: this.sharedRenderLowHitCount,
    };
  }

  private getDynamicSrcStressScore(nowMs: number = Date.now()): number {
    return computeDynamicSrcStressScore(this.buildDynamicSrcStabilityMetrics(nowMs));
  }

  private buildDynamicSrcLearningDeviceKey(): string {
    const backend = this.currentOutputBackendId ?? 'unknown-backend';
    const device = this.currentOutputDeviceId ?? this.currentOutputDeviceName ?? 'default-device';
    return `${backend}::${device}`;
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
    const transition = resolveDynamicSrcDegradationTransition({
      previousState: {
        level: this.dynamicSrcAutoDegradationLevel,
        reason: this.dynamicSrcAutoDegradationReason,
      },
      autoEnabled: this.dynamicSrcAutoEnabled,
      manualLockActive: this.dynamicSrcManualLockActive,
      stressScoreOverride: options?.stressScore,
      lastUnderrunFrames: this.lastUnderrunFrames,
      severeUnderrunFramesThreshold: NativeAudioService.AUTO_BACKEND_UNDERRUN_FRAME_SPIKE_TRIGGER,
      elevatedScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_ELEVATED,
      criticalScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_CRITICAL,
      metrics: this.buildDynamicSrcStabilityMetrics(nowMs),
    });

    const nextState = transition.nextState;

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

  private clearDynamicSrcRestoreTimer(): void {
    if (this.dynamicSrcRestoreTimer === null) return;
    clearTimeout(this.dynamicSrcRestoreTimer);
    this.dynamicSrcRestoreTimer = null;
  }

  private scheduleDynamicSrcRestoreEvaluation(minDelayMs: number = 0): void {
    this.clearDynamicSrcRestoreTimer();
    const nowMs = Date.now();
    const effective = this.getEffectiveDynamicSrcTiming(nowMs);
    const holdRemaining = Math.max(0, this.dynamicSrcHoldUntilMs - nowMs);
    const sanitizedMinDelayMs = Math.max(0, Math.floor(minDelayMs));
    const delayMs = Math.max(effective.restoreDebounceMs, holdRemaining, sanitizedMinDelayMs);

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

    const nowMs = Date.now();
    const effective = this.getEffectiveDynamicSrcTiming(nowMs);
    const plan = this.dynamicSrcPolicyExecutor.plan({
      currentPolicy: current,
      targetPolicy: target,
      nowMs,
      minSwitchIntervalMs: effective.minSwitchIntervalMs,
    });

    if (plan.action === 'skip-current' || plan.action === 'skip-pending') {
      this.dynamicSrcProfile = profile;
      return false;
    }

    if (plan.action === 'defer') {
      this.scheduleDynamicSrcRestoreEvaluation(plan.delayMs);
      return false;
    }

    const applyNowMs = plan.nowMs;
    this.dynamicSrcPolicyExecutor.beginApply(target, applyNowMs);

    try {
      await this.setEnginePolicyInternal(target, { fromDynamicAuto: true });
      this.dynamicSrcProfile = profile;
      this.dynamicSrcLastSwitchAtMs = applyNowMs;
      this.dynamicSrcLastSwitchReason = reason;
      this.emitRobustnessSnapshot(true);
      return true;
    } catch {
      return false;
    } finally {
      this.dynamicSrcPolicyExecutor.finishApply(target);
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
    return resolveStoredDynamicSrcAutoSettings({
      raw: readString(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS),
      defaults: {
        enabled: true,
        adaptiveEnabled: this.dynamicSrcAdaptiveEnabled,
        learningEnabled: this.dynamicSrcLearningEnabled,
        restoreDebounceMs: this.dynamicSrcRestoreDebounceMs,
        minSwitchIntervalMs: this.dynamicSrcMinSwitchIntervalMs,
        seekHoldMs: this.dynamicSrcSeekHoldMs,
        underrunHoldMs: this.dynamicSrcUnderrunHoldMs,
        sharedStressHoldMs: this.dynamicSrcSharedStressHoldMs,
        outputErrorHoldMs: this.dynamicSrcOutputErrorHoldMs,
      },
    });
  }

  private async restoreDynamicSrcAutoSettingsFromStorage(): Promise<void> {
    return restoreDynamicSrcAutoSettingsFromStorageImpl.call(this as unknown as import('./nativeAudioDynamicSrcAutoSettings').DynamicSrcHost, {
      elevatedScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_ELEVATED,
      criticalScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_CRITICAL,
    });
  }

  private readTuningAutoSettings(): AudioTuningAutoSettings {
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

    return resolveStoredTuningAutoSettings({
      raw: readString(STORAGE_KEYS.NATIVE_AUDIO_TUNING_AUTO_SETTINGS),
      defaults,
    });
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
      this.telemetry.warn('audio.tuning-profile.auto-apply.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          nextProfile: decision.nextProfile,
          reason: decision.reason,
        },
      });
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
    this.emitRobustnessSnapshot();
  }

  private async restoreTuningAutoSettingsFromStorage(): Promise<void> {
    const persisted = this.readTuningAutoSettings();
    this.applyTuningAutoSettingsState(persisted);

    if (this.tuningAutoSettingsListenerCleanup) {
      this.emitRobustnessSnapshot();
      return;
    }
    if (this.tuningAutoSettingsListenerInitPromise) {
      await this.tuningAutoSettingsListenerInitPromise;
      this.emitRobustnessSnapshot();
      return;
    }

    const applyPersistedSettings = () => {
      const nextSettings = this.readTuningAutoSettings();
      this.applyTuningAutoSettingsState(nextSettings);
      this.emitRobustnessSnapshot();
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
    this.emitRobustnessSnapshot();
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

    const response = await this.invokeCommand<unknown>(
      'native_audio_set_engine_policy',
      normalized as Record<string, unknown>
    );
    this.applyEnginePolicyPayload(response);
    this.emitRobustnessSnapshot();
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
      this.emitRobustnessSnapshot();
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
    this.emitRobustnessSnapshot();
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

    this.emitRobustnessSnapshot();
  }

  private getAutoBackendChain(): string[] {
    return resolveAutoOutputBackendChain({
      availableBackends: this.availableOutputBackends,
      currentBackendId: this.currentOutputBackendId,
      isWindows: this.isWindowsOutputPlatform(),
    });
  }

  private isWindowsOutputPlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    const platform = `${(navigator as Navigator & { platform?: string }).platform ?? ''} ${navigator.userAgent ?? ''}`;
    return /win/i.test(platform);
  }

  private pruneUnderrunSpikeWindow(nowMs: number): void {
    this.underrunSpikeTimestampsMs = pruneUnderrunSpikeTimestamps(
      this.underrunSpikeTimestampsMs,
      nowMs,
      NativeAudioService.AUTO_BACKEND_UNDERRUN_WINDOW_MS
    );
  }

  private shouldAutoSwitchNow(reason: string, nowMs: number): boolean {
    const decision = evaluateAutoOutputSwitch({
      reason,
      nowMs,
      backendSwitchInFlight: this.backendSwitchInFlight,
      lastAutoSwitchAtMs: this.lastAutoBackendSwitchAtMs,
      lastUnderrunFrames: this.lastUnderrunFrames,
      underrunSpikeTimestampsMs: this.underrunSpikeTimestampsMs,
      config: {
        underrunWindowMs: NativeAudioService.AUTO_BACKEND_UNDERRUN_WINDOW_MS,
        underrunTriggerCount: NativeAudioService.AUTO_BACKEND_UNDERRUN_TRIGGER_COUNT,
        underrunFrameSpikeTrigger: NativeAudioService.AUTO_BACKEND_UNDERRUN_FRAME_SPIKE_TRIGGER,
        switchCooldownMs: NativeAudioService.AUTO_BACKEND_SWITCH_COOLDOWN_MS,
      },
    });
    this.underrunSpikeTimestampsMs = decision.prunedUnderrunSpikeTimestampsMs;
    return decision.shouldSwitch;
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
      const targetBackend = resolveNextAutoOutputBackend(chain, current);
      if (!targetBackend) return;
      if (targetBackend === current) return;

      const switched = await this.selectOutputBackendInternal(targetBackend, {
        persist: true,
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
    options?: { persist?: boolean }
  ): Promise<boolean> {
    try {
      const previousBackendId = this.currentOutputBackendId;
      const payload = await invokeWithTelemetry<unknown>('native_audio_select_output_backend', {
        backendId,
      }, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.output-backend.select',
      });
      const parsed = this.parseComponentsStatePayload(payload);
      const resolvedBackendId = this.sanitizeBackendId(parsed.outputBackendId) ?? backendId;
      if (!resolvedBackendId) {
        this.handleOutputBackendSwitchFailure('resolved-backend-empty');
        return false;
      }
      this.applyRuntimeAudioComponentsState(parsed);
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
      }

      return true;
    } catch (error) {
      this.telemetry.warn('audio.output-backend.select.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          backendId,
        },
      });
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

  handleRenderQueuePageLockStatus(pageLocked: boolean, nextPlaybackState?: PlaybackState): void {
    if (pageLocked) return;

    const playbackState = nextPlaybackState ?? this.state.playbackState;
    if (
      playbackState !== 'playing' &&
      playbackState !== 'buffering' &&
      playbackState !== 'loading'
    ) {
      return;
    }

    const nowMs = Date.now();
    if (nowMs < this.renderQueuePageLockProtectionUntilMs) {
      return;
    }

    this.renderQueuePageLockProtectionUntilMs =
      nowMs + NativeAudioService.RENDER_QUEUE_PAGE_LOCK_PROTECTION_DEBOUNCE_MS;
    this.protectionWindowReason = 'render-queue-page-lock-unavailable';
    this.protectionWindowUntilMs = Math.max(
      this.protectionWindowUntilMs,
      nowMs + NativeAudioService.RENDER_QUEUE_PAGE_LOCK_PROTECTION_MS
    );
    this.scheduleProtectionWindowExpiry();
    this.applyStreamingBufferPolicy(true);

    const effective = this.getEffectiveDynamicSrcTiming(nowMs);
    this.withDynamicSrcHold(
      'render-queue-page-lock-unavailable',
      Math.max(
        NativeAudioService.RENDER_QUEUE_PAGE_LOCK_PROTECTION_MS,
        effective.sharedStressHoldMs
      )
    );
    this.evaluateDynamicSrcAutoDegradation({
      nowMs,
      stressScore: effective.stressScore,
      triggerActions: true,
    });
    this.emitRobustnessSnapshot(true);
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
    void invokeWithTelemetry('native_audio_set_streaming_buffer_settings', target, {
      moduleId: 'audio',
      component: 'NativeAudioService',
      event: 'audio.streaming-buffer.set',
      failureLevel: 'warn',
    }).catch((error) => {
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
      this.emitRobustnessSnapshot();
      return;
    }

    const delayMs = Math.max(0, this.protectionWindowUntilMs - nowMs);
    this.protectionWindowTimer = setTimeout(() => {
      this.protectionWindowTimer = null;
      if (this.protectionWindowRefCount > 0) return;
      this.protectionWindowUntilMs = 0;
      this.protectionWindowReason = null;
      this.applyStreamingBufferPolicy(true);
      this.emitRobustnessSnapshot();
    }, delayMs);
  }

  private buildRobustnessSnapshot(nowMs: number = Date.now()): AudioRobustnessSnapshot {
    const source = createNativeAudioRobustnessSnapshotSource({
      record: this as unknown as Record<string, unknown>,
      state: this.state,
      estimatedAudioBufferBytes: this.estimatedAudioBufferBytes,
      renderQueuePageLockFailureCount: this.renderQueuePageLockFailureCount,
      renderQueuePageLockAttemptedBytes: this.renderQueuePageLockAttemptedBytes,
      renderQueuePageLockSucceededBytes: this.renderQueuePageLockSucceededBytes,
      renderQueuePageLockFailedBytes: this.renderQueuePageLockFailedBytes,
      bufferedAheadRollingWindow: this.bufferedAheadRollingWindow,
      bufferedAheadRollingSum: this.bufferedAheadRollingSum,
      underrunRecoveryUntilMs: this.underrunRecoveryUntilMs,
      dynamicSrcAdaptiveProfile: this.dynamicSrcAdaptiveProfile,
      dynamicSrcLearningProfile: this.dynamicSrcLearningProfile,
      pruneUnderrunSpikeWindow: (timestampMs) => this.pruneUnderrunSpikeWindow(timestampMs),
      getEffectiveDynamicSrcTiming: (timestampMs) => this.getEffectiveDynamicSrcTiming(timestampMs),
      evaluateDynamicSrcAutoDegradation: (options) => this.evaluateDynamicSrcAutoDegradation(options),
      buildDynamicSrcLearningDeviceKey: () => this.buildDynamicSrcLearningDeviceKey(),
      getDynamicSrcLearningScale: () => this.getDynamicSrcLearningScale(),
      hasActiveProtectionWindow: (timestampMs) => this.hasActiveProtectionWindow(timestampMs),
      hasActiveSharedStressWindow: (timestampMs) => this.hasActiveSharedStressWindow(timestampMs),
      lastWorkingSetTrimEvent: getLastProcessWorkingSetTrimEvent(),
    });
    return buildNativeAudioRobustnessSnapshot(source, nowMs);
  }

  private emitRobustnessSnapshot(force: boolean = false): void {
    this.robustnessController.emit(force);
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

  private ensureTrackInQueue(
    track: Track,
    trackPath: string
  ): { track: Track; queue: Track[]; index: number } {
    const stateTrack = compactTrackForState(track);
    const queueTrack = compactTrackForQueueState(track);
    let queue = this.state.queue;
    let index = this.findQueueIndexByPath(queue, trackPath);

    if (index === -1) {
      index = this.findQueueIndexByTrackIdentity(queue, stateTrack);
    }

    if (index === -1) {
      queue = [...queue, queueTrack];
      index = queue.length - 1;
    } else if (queue[index] !== queueTrack) {
      queue = [...queue];
      queue[index] = queueTrack;
    }

    return { track: stateTrack, queue, index };
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

  private scheduleTrackSwitchWorkingSetTrim(reason: string): void {
    this.scheduleTrackSwitchWorkingSetTrimAttempt(reason, Date.now());
  }

  private scheduleTrackSwitchWorkingSetTrimAttempt(reason: string, requestedAtMs: number): void {
    this.clearTrackSwitchWorkingSetTrimRetryTimer();

    const playbackState = this.state.playbackState;
    const bufferedAhead =
      typeof this.state.bufferedAhead === 'number' && Number.isFinite(this.state.bufferedAhead)
        ? Math.max(0, this.state.bufferedAhead)
        : 0;
    const outputBufferedAhead =
      typeof this.state.outputBufferedAhead === 'number' && Number.isFinite(this.state.outputBufferedAhead)
        ? Math.max(0, this.state.outputBufferedAhead)
        : 0;
    const fragilePlaybackWindow =
      playbackState === 'loading' ||
      playbackState === 'buffering' ||
      (playbackState === 'playing' &&
        (bufferedAhead < NativeAudioService.TRACK_SWITCH_TRIM_MIN_BUFFERED_AHEAD_SECONDS ||
          outputBufferedAhead <
            NativeAudioService.TRACK_SWITCH_TRIM_MIN_OUTPUT_BUFFERED_AHEAD_SECONDS));

    if (fragilePlaybackWindow) {
      const elapsedMs = Date.now() - requestedAtMs;
      if (elapsedMs >= NativeAudioService.TRACK_SWITCH_TRIM_MAX_DEFER_MS) {
        this.telemetry.warn('audio.working-set-trim.deferred-timeout', {
          fields: {
            reason,
            playbackState,
            bufferedAhead,
            outputBufferedAhead,
          },
        });
        return;
      }

      this.trackSwitchWorkingSetTrimRetryTimer = setTimeout(() => {
        this.trackSwitchWorkingSetTrimRetryTimer = null;
        this.scheduleTrackSwitchWorkingSetTrimAttempt(reason, requestedAtMs);
      }, NativeAudioService.TRACK_SWITCH_TRIM_RETRY_MS);
      return;
    }

    scheduleProcessWorkingSetTrim('tree', {
      delaysMs: [1000, 3200],
      reason,
    });
  }

  private clearTrackSwitchWorkingSetTrimRetryTimer(): void {
    if (this.trackSwitchWorkingSetTrimRetryTimer === null) return;
    clearTimeout(this.trackSwitchWorkingSetTrimRetryTimer);
    this.trackSwitchWorkingSetTrimRetryTimer = null;
  }

  private cancelPlaybackWorkingSetTrim(): void {
    this.clearTrackSwitchWorkingSetTrimRetryTimer();
    cancelScheduledProcessWorkingSetTrim('tree');
  }

  private buildQueuePaths(queue: Track[]): string[] {
    return queue.map((track) => this.getTrackPath(track)).filter(Boolean) as string[];
  }

  private buildNativeQueueEntryPaths(queue: Track[]): string[] | null {
    const queuePaths: string[] = [];
    for (const track of queue) {
      const trackPath =
        this.getTrackPath(track) ??
        (typeof track.id === 'string' && track.id.trim().length > 0
          ? `queue://track-id/${encodeURIComponent(track.id.trim())}`
          : null);
      if (!trackPath) {
        return null;
      }
      queuePaths.push(trackPath);
    }
    return queuePaths;
  }

  private syncAppendedQueueToNative(nextQueue: Track[], appendedTracks: Track[]): void {
    if (this.disposed) return;
    if (!isTauriRuntime()) return;
    if (this.nativeQueueMirrorDirty) return;

    const currentIndex = this.state.currentIndex;
    const appendedPaths = this.buildNativeQueueEntryPaths(appendedTracks);
    if (!appendedPaths) {
      this.markNativeQueueMirrorDirty('append-missing-identity', {
        addedCount: appendedTracks.length,
      });
      return;
    }

    void invokeWithTelemetry('native_audio_append_queue', { queue: appendedPaths }, {
      moduleId: 'audio',
      component: 'NativeAudioService',
      event: 'audio.queue.append',
    })
      .then(() => {
        this.markNativeQueueMutationSynced(nextQueue, currentIndex);
        this.telemetry.info('audio.queue.sync.flush', {
          fields: this.buildQueueTelemetryFields(nextQueue, currentIndex, {
            mode: 'append',
            addedCount: appendedTracks.length,
            queuePathCount: appendedPaths.length,
            queuePathApproxBytes: approxJsonBytes(appendedPaths),
          }),
        });
      })
      .catch((error) => {
        this.telemetry.warn('audio.queue.sync.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            phase: 'append',
            addedCount: appendedTracks.length,
          },
        });
        this.markNativeQueueMirrorDirty('append-command-failed', {
          addedCount: appendedTracks.length,
        });
      });
  }

  private canUseAtomicNativeQueueMutation(queue: Track[]): boolean {
    return (
      isTauriRuntime() &&
      !this.nativeQueueMirrorDirty &&
      this.buildNativeQueueEntryPaths(queue) !== null
    );
  }

  private markNativeQueueMutationSynced(queue: Track[], currentIndex: number): void {
    this.nativeQueueMirrorQueueRef = queue;
    this.nativeQueueMirrorIndex = currentIndex;
    if (this.state.queue === queue && this.state.currentIndex !== currentIndex) {
      this.scheduleNativeQueueIndexSync(this.state.currentIndex);
    }
  }

  private syncRemovedQueueItemToNative(
    previousQueue: Track[],
    nextQueue: Track[],
    removedIndex: number,
    currentIndex: number
  ): void {
    if (this.disposed) return;
    if (!this.canUseAtomicNativeQueueMutation(previousQueue)) {
      this.markNativeQueueMirrorDirty('remove-preconditions-missing', {
        removedIndex,
      });
      return;
    }

    void invokeWithTelemetry('native_audio_remove_queue_item', { index: removedIndex }, {
      moduleId: 'audio',
      component: 'NativeAudioService',
      event: 'audio.queue.remove-native',
    })
      .then(() => {
        this.markNativeQueueMutationSynced(nextQueue, currentIndex);
        this.telemetry.info('audio.queue.sync.flush', {
          fields: this.buildQueueTelemetryFields(nextQueue, currentIndex, {
            mode: 'remove',
            removedIndex,
          }),
        });
      })
      .catch((error) => {
        this.telemetry.warn('audio.queue.sync.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            phase: 'remove',
            removedIndex,
          },
        });
        this.markNativeQueueMirrorDirty('remove-command-failed', {
          removedIndex,
        });
      });
  }

  private syncMovedQueueItemToNative(
    previousQueue: Track[],
    nextQueue: Track[],
    fromIndex: number,
    toIndex: number,
    currentIndex: number
  ): void {
    if (this.disposed) return;
    if (!this.canUseAtomicNativeQueueMutation(previousQueue)) {
      this.markNativeQueueMirrorDirty('move-preconditions-missing', {
        fromIndex,
        toIndex,
      });
      return;
    }

    void invokeWithTelemetry('native_audio_move_queue_item', { fromIndex, toIndex }, {
      moduleId: 'audio',
      component: 'NativeAudioService',
      event: 'audio.queue.move-native',
    })
      .then(() => {
        this.markNativeQueueMutationSynced(nextQueue, currentIndex);
        this.telemetry.info('audio.queue.sync.flush', {
          fields: this.buildQueueTelemetryFields(nextQueue, currentIndex, {
            mode: 'move',
            fromIndex,
            toIndex,
          }),
        });
      })
      .catch((error) => {
        this.telemetry.warn('audio.queue.sync.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            phase: 'move',
            fromIndex,
            toIndex,
          },
        });
        this.markNativeQueueMirrorDirty('move-command-failed', {
          fromIndex,
          toIndex,
        });
      });
  }

  private async replaceQueueItemPathInNative(index: number, path: string): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    if (this.nativeQueueMirrorDirty || !this.buildNativeQueueEntryPaths(this.state.queue)) {
      return false;
    }

    try {
      await invokeWithTelemetry('native_audio_replace_queue_item_path', { index, path }, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.queue.patch-item-path',
      });
      this.markNativeQueueMutationSynced(this.state.queue, this.state.currentIndex);
      return true;
    } catch (error) {
      this.telemetry.warn('audio.queue.sync.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          phase: 'replace-item-path',
          index,
        },
      });
      this.markNativeQueueMirrorDirty('replace-item-path-command-failed', {
        index,
      });
      return false;
    }
  }

  private canUseQueueIndexTransport(queue: Track[], index: number): boolean {
    if (!isTauriRuntime()) return false;
    if (index < 0 || index >= queue.length) return false;
    if (this.nativeQueueMirrorDirty) return false;
    return this.buildNativeQueueEntryPaths(queue) !== null;
  }

  private disposed = false;
  private nativeQueueMirrorQueueRef: Track[] | null = null;
  private nativeQueueMirrorIndex = -1;
  private pendingNativeQueueIndex: number | null = null;
  private nativeQueueIndexSyncScheduled = false;
  private nativeQueueMirrorDirty = false;

  private resetNativeQueueMirrorState(): void {
    this.nativeQueueMirrorQueueRef = null;
    this.nativeQueueMirrorIndex = -1;
    this.pendingNativeQueueIndex = null;
    this.nativeQueueIndexSyncScheduled = false;
    this.nativeQueueMirrorDirty = false;
  }

  private markNativeQueueMirrorDirty(
    reason: string,
    fields?: Record<string, unknown>
  ): void {
    if (this.nativeQueueMirrorDirty) return;
    this.nativeQueueMirrorDirty = true;
    this.nativeQueueMirrorQueueRef = null;
    this.nativeQueueMirrorIndex = -1;
    this.pendingNativeQueueIndex = null;
    this.nativeQueueIndexSyncScheduled = false;
    this.telemetry.warn('audio.queue.native-mirror.dirty', {
      fields: {
        reason,
        ...fields,
      },
    });
  }

  private scheduleNativeQueueIndexSync(currentIndex: number): void {
    if (this.disposed || !isTauriRuntime() || this.nativeQueueMirrorDirty) return;
    if (
      this.nativeQueueMirrorQueueRef === this.state.queue &&
      this.nativeQueueMirrorIndex === currentIndex
    ) {
      return;
    }

    this.pendingNativeQueueIndex = currentIndex;
    if (this.nativeQueueIndexSyncScheduled) return;
    this.nativeQueueIndexSyncScheduled = true;

    const flush = () => {
      this.nativeQueueIndexSyncScheduled = false;
      const nextIndex = this.pendingNativeQueueIndex;
      this.pendingNativeQueueIndex = null;
      if (nextIndex == null) return;
      void this.syncQueueIndexToNative(nextIndex);
    };

    if (typeof queueMicrotask === 'function') {
      queueMicrotask(flush);
      return;
    }

    void Promise.resolve().then(flush);
  }

  private async syncQueueIndexToNative(currentIndex: number): Promise<void> {
    if (this.disposed || !isTauriRuntime() || this.nativeQueueMirrorDirty) return;
    if (
      this.nativeQueueMirrorQueueRef === this.state.queue &&
      this.nativeQueueMirrorIndex === currentIndex
    ) {
      return;
    }

    const fields = this.buildQueueTelemetryFields(this.state.queue, currentIndex, {
      mode: 'index-only',
    });
    try {
      await invokeWithTelemetry('native_audio_sync_queue_index', { currentIndex }, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.queue.sync.index',
      });
      this.nativeQueueMirrorQueueRef = this.state.queue;
      this.nativeQueueMirrorIndex = currentIndex;
      this.telemetry.info('audio.queue.sync.flush', { fields });
    } catch (error) {
      this.telemetry.warn('audio.queue.sync.failed', {
        message: readTelemetryErrorMessage(error),
        fields,
      });
      this.markNativeQueueMirrorDirty('index-command-failed', {
        currentIndex,
      });
    }
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
    return setupNativeListenersImpl.call(this as unknown as import('./nativeAudioNativeListeners').NativeAudioListenerHost);
  }

  private async setupRuntimeAudioComponentsListeners(): Promise<void> {
    if (!isTauriRuntime()) return;

    const syncRuntimeAudioComponents = async () => {
      try {
        const payload = await invokeWithTelemetry<unknown>(
          'native_audio_get_audio_components_state',
          undefined,
          {
            moduleId: 'audio',
            component: 'NativeAudioService',
            event: 'audio.components-state.read',
            failureLevel: 'warn',
          }
        );
        const parsed = this.parseComponentsStatePayload(payload);
        this.applyRuntimeAudioComponentsState(parsed);
      } catch (error) {
        this.logBestEffortError('sync runtime audio components', error);
      }
    };

    const eventNames = [
      TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_BACKEND_UPDATED,
      TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_DEVICE_UPDATED,
      TAURI_EVENTS.NATIVE_AUDIO_INPUT_ID_UPDATED,
    ] as const;

    for (const eventName of eventNames) {
      try {
        const unlisten = await listen(eventName, () => {
          void syncRuntimeAudioComponents();
        });
        this.runtimeComponentsListeners.push(unlisten);
      } catch (error) {
        this.logBestEffortError(`listen ${eventName}`, error);
      }
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
      return this.selectOutputBackendInternal(backendId, { persist: false })
        .then(() => {})
        .catch((error) => {
          this.logBestEffortError('restore output backend', error);
        });
    } catch (error) {
      this.logBestEffortError('parse output backend from storage', error);
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

      return invokeWithTelemetry('native_audio_select_audio_input', { inputId }, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.input.select.restore',
        failureLevel: 'warn',
      })
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
      return invokeWithTelemetry('native_audio_set_gain', { db }, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.gain.restore',
        failureLevel: 'warn',
      })
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
      return invokeWithTelemetry('native_audio_set_dsp_chain', { chain: parsed }, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.dsp-chain.restore',
        failureLevel: 'warn',
      })
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
    return this.robustnessController.getSnapshot();
  }

  onRobustnessSnapshot(callback: (snapshot: AudioRobustnessSnapshot) => void): () => void {
    return this.robustnessController.subscribe(callback);
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
      return await invokeWithTelemetry<T>(cmd, payload, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.backend.command',
      });
    } catch (error) {
      const message = error instanceof Error ? error : new Error(String(error));
      this.emitError(message);
      throw message;
    }
  }

  // Track loading and native transport handoff.
  private async loadTrackInternal(track: Track): Promise<boolean> {
    this.cancelPlaybackWorkingSetTrim();
    this.clearPendingSeek();
    if (!track) return false;

    const previousQueue = this.state.queue;
    const resolvedTrack = await this.resolveTrackForNativePlayback(track);

    const trackPath = this.resolveAbsoluteTrackPathOrEmitError(resolvedTrack);
    if (!trackPath) return false;

    const { track: stateTrack, queue, index } = this.ensureTrackInQueue(resolvedTrack, trackPath);
    this.applyTrackLoadingState(stateTrack, queue, index);

    const canUseQueueIndexLoad =
      queue.length === previousQueue.length &&
      this.isProbablyAbsolutePath(trackPath) &&
      this.canUseQueueIndexTransport(queue, index);
    const previousTrackPath =
      index >= 0 && index < previousQueue.length ? this.getTrackPath(previousQueue[index]) : null;

    let usedQueueIndexLoad = false;
    try {
      await this.applyRuntimeControlSettingsToBackend();
      await this.applyReplayGainForTrack(resolvedTrack);
      if (canUseQueueIndexLoad) {
        const pathPatched =
          this.normalizeTrackPathForCompare(previousTrackPath) ===
            this.normalizeTrackPathForCompare(trackPath) ||
          (await this.replaceQueueItemPathInNative(index, trackPath));
        if (pathPatched) {
          await this.invokeCommand('native_audio_load_queue_index', { index });
          this.markNativeQueueMutationSynced(queue, index);
          usedQueueIndexLoad = true;
        } else {
          await this.invokeCommand('native_audio_load', { path: trackPath });
        }
      } else {
        await this.invokeCommand('native_audio_load', { path: trackPath });
      }
    } catch {
      // invokeCommand already emits error; report failure to callers so they can avoid follow-up commands.
      return false;
    }

    if (!usedQueueIndexLoad && queue.length > previousQueue.length && !this.nativeQueueMirrorDirty) {
      this.markNativeQueueMutationSynced(queue, index);
    }

    this.updateState({
      playbackState: 'paused',
      currentTime: 0,
    });
    return true;
  }

  private async loadAndPlayTrackInternal(track: Track): Promise<boolean> {
    this.cancelPlaybackWorkingSetTrim();
    this.clearPendingSeek();
    if (!track) return false;

    const previousQueue = this.state.queue;
    const resolvedTrack = await this.resolveTrackForNativePlayback(track);

    const trackPath = this.resolveAbsoluteTrackPathOrEmitError(resolvedTrack);
    if (!trackPath) return false;

    const { track: stateTrack, queue, index } = this.ensureTrackInQueue(resolvedTrack, trackPath);
    this.applyTrackLoadingState(stateTrack, queue, index);

    const replayGainDb = this.computeReplayGainDbForTrack(resolvedTrack);

    try {
      await this.applyRuntimeControlSettingsToBackend();
      await this.invokeCommand('native_audio_load_and_play', { path: trackPath, replayGainDb });
    } catch {
      // invokeCommand already emits error; report failure to callers so they can avoid follow-up commands.
      return false;
    }

    if (queue.length > previousQueue.length && !this.nativeQueueMirrorDirty) {
      this.markNativeQueueMutationSynced(queue, index);
    }

    this.markTrackPlayedBestEffort(resolvedTrack);
    this.scheduleTrackSwitchWorkingSetTrim('native-audio-track-switch');

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
    this.cancelPlaybackWorkingSetTrim();
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
    const nextState = this.updateState({ playbackState: 'stopped', currentTime: 0 });
    this.fallbackClockBaseTimeSec = 0;
    this.fallbackClockStartedAtMs = null;
    this.stopFallbackTicker();
    this.applyPlaybackStateSideEffects(nextState.playbackState);
    this.timeUpdateCallbacks.forEach((cb) => cb(0));
  }

  private resetQueueRuntimeState(): void {
    this.desiredPlayIndex = null;
    this.playIndexQueue = Promise.resolve();
    this.pendingNativeQueueIndex = null;
    this.nativeQueueIndexSyncScheduled = false;

    this.stopFallbackTicker();
    this.fallbackClockBaseTimeSec = 0;
    this.fallbackClockStartedAtMs = null;
    this.lastBackendTimeUpdateAtMs = 0;
    this.lastPlaybackActiveAtMs = 0;

    this.bufferedAheadRollingWindow = [];
    this.bufferedAheadRollingSum = 0;
    this.bufferedAheadMinSeconds = null;
    this.rebufferCount = 0;
    this.lastPlaybackStateForMetrics = 'stopped';

    this.lastUnderrunEvents = 0;
    this.lastUnderrunFrames = 0;
    this.underrunSpikeTimestampsMs = [];
    this.underrunRecoveryUntilMs = 0;

    this.clearProtectionWindowTimer();
    this.protectionWindowUntilMs = 0;
    this.protectionWindowRefCount = 0;
    this.protectionWindowReason = null;

    this.clearDynamicSrcRestoreTimer();
    this.dynamicSrcHoldUntilMs = 0;
    this.dynamicSrcAutoDegradationLevel = 0;
    this.dynamicSrcAutoDegradationReason = null;
    this.dynamicSrcAutoDegradationLastChangedAtMs = null;
    this.sharedStressUntilMs = 0;
    this.sharedStressReason = null;
    this.sharedStressEscalationCount = 0;
    this.dynamicSrcPolicyExecutor.reset();

    if (this.spectrumDisableTimer !== null) {
      window.clearTimeout(this.spectrumDisableTimer);
      this.spectrumDisableTimer = null;
    }
    this.lastSpectrumTouchAtMs = 0;
    if (this.spectrumEnabled) {
      void this.setSpectrumEnabled(false);
    }
    this.spectrumData = null;
    this.spectrumFrames = {};
  }

  seek(time: number): void {
    seekImpl(this.transportFacadeContext, time);
  }

  // Volume and mute controls.
  setVolume(volume: number): void {
    setVolumeImpl(this.transportFacadeContext, volume);
    void persistAudioPlaybackVolume(this.state.volume);
    void persistAudioPlaybackMuted(this.state.muted);
  }

  getVolume(): number {
    return this.state.volume;
  }

  toggleMute(): void {
    const muted = !this.state.muted;
    this.fireAndForgetCommand('native_audio_set_mute', { muted });
    this.updateState({ muted });
    void persistAudioPlaybackMuted(muted);
  }

  // Playback state accessors.
  getCurrentTime(): number {
    return this.state.currentTime;
  }

  getDuration(): number {
    return this.state.duration;
  }

  getState(): AudioState {
    return this.state;
  }

  // Playback event subscriptions.
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

  // Queue mutation helpers.
  addToQueue(track: Track): void {
    if (!track) return;
    const queuedTrack = compactTrackForQueueState(track);
    const queue = [...this.state.queue, queuedTrack];
    const fields = this.buildQueueTelemetryFields(queue, this.state.currentIndex, {
      mode: 'single',
      addedCount: 1,
      queueLengthBefore: this.state.queue.length,
      ...buildTrackTelemetryFields(track),
    });
    this.telemetry.info('audio.queue.add', {
      fields,
    });
    this.updateState({ queue });
    this.syncAppendedQueueToNative(queue, [queuedTrack]);
    captureTelemetryScenarioSnapshot({
      moduleId: 'audio',
      component: 'NativeAudioService',
      event: 'audio.queue.add.snapshot',
      fields,
      minIntervalMs: 250,
    });
  }

  addMultipleToQueue(tracks: Track[]): void {
    if (!tracks.length) return;
    const appendedQueueTracks = tracks.map((track) => compactTrackForQueueState(track));
    const queue = [...this.state.queue, ...appendedQueueTracks];
    const fields = this.buildQueueTelemetryFields(queue, this.state.currentIndex, {
      mode: 'batch',
      addedCount: tracks.length,
      queueLengthBefore: this.state.queue.length,
      firstTrackId: tracks[0]?.id ?? null,
      lastTrackId: tracks[tracks.length - 1]?.id ?? null,
    });
    this.telemetry.info('audio.queue.add', {
      fields,
    });
    this.updateState({ queue });
    this.syncAppendedQueueToNative(queue, appendedQueueTracks);
    captureTelemetryScenarioSnapshot({
      moduleId: 'audio',
      component: 'NativeAudioService',
      event: 'audio.queue.add.snapshot',
      fields,
      minIntervalMs: 250,
    });
  }

  removeFromQueue(index: number): void {
    if (index < 0 || index >= this.state.queue.length) {
      return;
    }

    const previousQueue = this.state.queue;
    const removedTrack = previousQueue[index] ?? null;
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
    const fields = this.buildQueueTelemetryFields(queue, currentIndex, {
      mode: 'remove',
      removedIndex: index,
      queueLengthBefore: previousQueue.length,
      ...buildTrackTelemetryFields(removedTrack),
    });
    this.telemetry.info('audio.queue.remove', {
      fields,
    });
    captureTelemetryScenarioSnapshot({
      moduleId: 'audio',
      component: 'NativeAudioService',
      event: 'audio.queue.remove.snapshot',
      fields,
      minIntervalMs: 250,
    });
    this.syncRemovedQueueItemToNative(previousQueue, queue, index, currentIndex);
  }

  clearQueue(options?: { releasePlaylists?: boolean }): void {
    const queueLengthBefore = this.state.queue.length;
    const currentTrackBefore = this.state.currentTrack;
    const currentPlaylistIdBefore = this.state.currentPlaylist?.id ?? null;
    this.clearPendingSeek();
    this.resetQueueRuntimeState();
    const nextState = this.updateState({
      queue: [],
      currentIndex: -1,
      currentTrack: null,
      currentPlaylist: null,
      playbackState: 'stopped',
      currentTime: 0,
      duration: 0,
      bufferedTime: 0,
      bufferedAhead: 0,
      decodeBufferedAhead: 0,
      outputBufferedAhead: 0,
    });
    if (options?.releasePlaylists !== false) {
      this.releasePlaylistTracks();
    }
    if (isTauriRuntime()) {
      this.resetNativeQueueMirrorState();
      this.fireAndForgetCommand('native_audio_clear_queue');
    }
    this.fireAndForgetCommand('native_audio_stop');
    const fields = {
      queueLengthBefore,
      releasedPlaylists: options?.releasePlaylists !== false,
      currentPlaylistId: currentPlaylistIdBefore,
      ...buildTrackTelemetryFields(currentTrackBefore),
    };
    this.telemetry.info('audio.queue.clear', {
      fields,
    });
    captureTelemetryScenarioSnapshot({
      moduleId: 'audio',
      component: 'NativeAudioService',
      event: 'audio.queue.clear.snapshot',
      fields,
      minIntervalMs: 250,
    });
    scheduleProcessWorkingSetTrim('tree', {
      delaysMs: [0, 700, 2200, 4800],
      reason: 'native-audio-clear-queue',
    });
    this.applyPlaybackStateSideEffects(nextState.playbackState);
    this.timeUpdateCallbacks.forEach((cb) => cb(0));
    this.emitRobustnessSnapshot(true);
  }

  getQueue(): Track[] {
    return this.state.queue;
  }

  async listAudioInputs(): Promise<string[]> {
    if (!isTauriRuntime()) return [];

    try {
      const payload = await invokeWithTelemetry<unknown>('native_audio_list_audio_inputs', undefined, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.input.list',
      });
      return this.normalizeOutputBackends(payload);
    } catch (error) {
      this.telemetry.warn('audio.input.list.failed', {
        message: readTelemetryErrorMessage(error),
      });
      return [];
    }
  }

  async selectAudioInput(inputId: string | null): Promise<boolean> {
    if (!isTauriRuntime()) return false;

    const normalizedInputId = this.sanitizeBackendId(inputId);

    try {
      const payload = await invokeWithTelemetry<unknown>('native_audio_select_audio_input', {
        inputId: normalizedInputId,
      }, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.input.select',
      });
      const parsed = this.parseComponentsStatePayload(payload);
      const persistedInputId = this.sanitizeBackendId(parsed.preferredInputId) ?? normalizedInputId;

      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_INPUT_ID,
        persistedInputId,
        TAURI_EVENTS.NATIVE_AUDIO_INPUT_ID_UPDATED
      );
      captureTelemetryScenarioSnapshot({
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.input.select.snapshot',
        fields: {
          inputId: persistedInputId,
          requestedInputId: normalizedInputId,
          outputBackendId: this.sanitizeBackendId(parsed.outputBackendId) ?? null,
          outputDeviceName: parsed.outputDevice ?? null,
        },
        minIntervalMs: 400,
      });

      return true;
    } catch (error) {
      this.telemetry.warn('audio.input.select.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          inputId: normalizedInputId,
        },
      });
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
    this.cancelPlaybackWorkingSetTrim();
    if (index < 0 || index >= this.state.queue.length) return;

    const wasPlaying = this.state.playbackState === 'playing';
    const previousIndex = this.state.currentIndex;
    const originalTrack = this.state.queue[index];
    this.telemetry.info('audio.track.switch.start', {
      fields: {
        requestedIndex: index,
        previousIndex,
        queueLength: this.state.queue.length,
        wasPlaying,
        ...buildTrackTelemetryFields(originalTrack),
      },
    });

    try {
      const track = await this.resolveTrackForNativePlayback(originalTrack);
      const stateTrack = compactTrackForState(track);
      let playbackQueue = this.state.queue;
      if (track !== originalTrack) {
        playbackQueue = [...this.state.queue];
        playbackQueue[index] = compactTrackForQueueState(track);
        this.updateState({ queue: playbackQueue });
      }
      this.resetSharedTimelineStressTracking();
      this.updateState({ currentIndex: index });

      const crossfade = this.readCrossfadeSettings();
      const shouldCrossfade =
        wasPlaying && crossfade.enabled && crossfade.durationMs > 0 && index !== previousIndex;

      const trackPath = this.getTrackPath(track);
      const canUseQueueIndexTransport =
        !!trackPath &&
        this.isProbablyAbsolutePath(trackPath) &&
        this.canUseQueueIndexTransport(playbackQueue, index);

      if (shouldCrossfade) {
        if (!trackPath || !this.isProbablyAbsolutePath(trackPath)) {
          const error = new Error(
            'Native audio requires an absolute file path. This track has no filePath (likely added via File System Access API).'
          ) as Error & { code?: string };
          error.code = !trackPath ? 'NATIVE_TRACK_PATH_MISSING' : 'NATIVE_TRACK_PATH_NOT_ABSOLUTE';
          this.emitError(error);
          return;
        }

        const nextState = this.updateState({
          currentTrack: stateTrack,
          playbackState: 'loading',
          duration: stateTrack.duration ?? 0,
          currentTime: 0,
          bufferedTime: 0,
          bufferedAhead: 0,
          decodeBufferedAhead: 0,
          outputBufferedAhead: 0,
        });
        this.timeUpdateCallbacks.forEach((cb) => cb(nextState.currentTime));

        await this.applyReplayGainForTrack(track);
        if (canUseQueueIndexTransport) {
          const pathPatched =
            track === originalTrack ||
            (await this.replaceQueueItemPathInNative(index, trackPath));
          if (pathPatched) {
            await this.invokeCommand('native_audio_crossfade_to_queue_index', {
              index,
              durationMs: crossfade.durationMs,
            });
          } else {
            await this.invokeCommand('native_audio_crossfade_to', {
              path: trackPath,
              durationMs: crossfade.durationMs,
            });
          }
        } else {
          await this.invokeCommand('native_audio_crossfade_to', {
            path: trackPath,
            durationMs: crossfade.durationMs,
          });
        }
        this.markTrackPlayedBestEffort(track);
        this.scheduleTrackSwitchWorkingSetTrim('native-audio-crossfade-switch');
        const fields = {
          requestedIndex: index,
          previousIndex,
          queueLength: this.state.queue.length,
          strategy: 'crossfade',
          durationMs: crossfade.durationMs,
          ...buildTrackTelemetryFields(track),
        };
        this.telemetry.info('audio.track.switch.completed', {
          fields,
        });
        captureTelemetryScenarioSnapshot({
          moduleId: 'audio',
          component: 'NativeAudioService',
          event: 'audio.track.switch.completed.snapshot',
          fields,
          minIntervalMs: 250,
        });
        return;
      }

      let loaded = false;
      if (trackPath && this.isProbablyAbsolutePath(trackPath) && canUseQueueIndexTransport) {
        const replayGainDb = this.computeReplayGainDbForTrack(track);
        try {
          this.applyTrackLoadingState(stateTrack, playbackQueue, index);
          await this.applyRuntimeControlSettingsToBackend();
          const pathPatched =
            track === originalTrack ||
            (await this.replaceQueueItemPathInNative(index, trackPath));
          if (!pathPatched) {
            loaded = await this.loadAndPlayTrackInternal(track);
          } else {
            await this.invokeCommand('native_audio_load_and_play_queue_index', {
              index,
              replayGainDb,
            });
            this.markTrackPlayedBestEffort(track);
            this.scheduleTrackSwitchWorkingSetTrim('native-audio-track-switch');
            loaded = true;
          }
        } catch {
          loaded = false;
        }
      } else {
        loaded = await this.loadAndPlayTrackInternal(track);
      }
      if (!loaded) {
        this.telemetry.warn('audio.track.switch.failed', {
          fields: {
            requestedIndex: index,
            previousIndex,
            queueLength: this.state.queue.length,
            reason: 'load-and-play-returned-false',
            ...buildTrackTelemetryFields(track),
          },
        });
        return;
      }

      const fields = {
        requestedIndex: index,
        previousIndex,
        queueLength: this.state.queue.length,
        strategy: 'load-and-play',
        ...buildTrackTelemetryFields(track),
      };
      this.telemetry.info('audio.track.switch.completed', {
        fields,
      });
      captureTelemetryScenarioSnapshot({
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.track.switch.completed.snapshot',
        fields,
        minIntervalMs: 250,
      });
    } catch (error) {
      this.telemetry.error('audio.track.switch.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          requestedIndex: index,
          previousIndex,
          queueLength: this.state.queue.length,
          ...buildTrackTelemetryFields(originalTrack),
        },
      });
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

    const previousQueue = this.state.queue;
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
    const fields = this.buildQueueTelemetryFields(queue, currentIndex, {
      mode: 'move',
      fromIndex,
      toIndex,
      queueLengthBefore: previousQueue.length,
      ...buildTrackTelemetryFields(moved),
    });
    this.telemetry.info('audio.queue.reorder', {
      fields,
    });
    captureTelemetryScenarioSnapshot({
      moduleId: 'audio',
      component: 'NativeAudioService',
      event: 'audio.queue.reorder.snapshot',
      fields,
      minIntervalMs: 250,
    });
    this.syncMovedQueueItemToNative(previousQueue, queue, fromIndex, toIndex, currentIndex);
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

  // Playback mode and transport helpers.
  setPlayMode(mode: PlayMode): void {
    this.updateState({ playMode: mode });
    void persistAudioPlaybackPlayMode(this.state.playMode);
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

  // Playlist creation and mutation helpers.
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
      tracksHydrated: true,
    };

    const playlists = [...this.state.playlists, playlist];
    this.updateState({ playlists });
    this.upsertPlaylistMetadataToLibraryDbBestEffort(playlist);
    return playlist;
  }

  deletePlaylist(playlistId: string): void {
    const targetPlaylist = this.getPlaylist(playlistId);
    if (this.isReadonlyPlaylist(targetPlaylist)) return;

    this.playlistHydrationPromises.delete(playlistId);
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
      this.upsertPlaylistMetadataToLibraryDbBestEffort(updatedPlaylist);
    }
  }

  getPlaylists(): Playlist[] {
    return this.state.playlists;
  }

  getPlaylist(playlistId: string): Playlist | null {
    return this.state.playlists.find((pl) => pl.id === playlistId) ?? null;
  }

  async queryPlaylistTracksPage(
    playlistId: string,
    options?: {
      searchQuery?: string;
      sortField?: PlaylistTrackSortField;
      sortDirection?: PlaylistTrackSortDirection;
      limit?: number;
      offset?: number;
    }
  ): Promise<PlaylistTrackPageResult | null> {
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return null;

    const playlist = this.getPlaylist(normalizedPlaylistId);
    if (!playlist) return null;

    if (!isTauriRuntime()) {
      return this.queryPlaylistTrackPageFromTracks(playlist.tracks, options);
    }

    try {
      const page = await queryNativeLibraryPlaylistTracksPage({
        playlistId: normalizedPlaylistId,
        searchQuery: options?.searchQuery,
        sortField: options?.sortField,
        sortDirection: options?.sortDirection,
        limit: options?.limit,
        offset: options?.offset,
      });
      return {
        total: page.total,
        items: page.items
          .map((item) => {
            const fallbackId =
              item.localTrackId || item.entryId || `${normalizedPlaylistId}::${item.position}`;
            const track = this.parseTrackFromPlaylistPayload(item.trackPayloadJson, {
              id: fallbackId,
              title: item.snapshotTitle,
              artist: item.snapshotArtist,
              album: item.snapshotAlbum,
              duration: item.snapshotDurationSeconds,
            });
            if (!track) return null;
            return {
              playlistIndex: item.position,
              track,
            };
          })
          .filter(
            (
              item
            ): item is {
              playlistIndex: number;
              track: Track;
            } => item != null
          ),
      };
    } catch (error) {
      this.telemetry.warn('audio.playlist.query-page.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          playlistId: normalizedPlaylistId,
          searchQueryLength: options?.searchQuery?.trim().length ?? 0,
          sortField: options?.sortField ?? 'default',
          sortDirection: options?.sortDirection ?? 'asc',
        },
      });
    }

    if (
      playlist.kind === NativeAudioService.PLAYLIST_KIND_SMART &&
      normalizedPlaylistId === NativeAudioService.SMART_PLAYLIST_RECENT_ID
    ) {
      const limitHint =
        typeof options?.limit === 'number' && Number.isFinite(options.limit)
          ? Math.max(1, Math.min(2000, Math.floor(options.limit)))
          : this.resolveRecentSmartPlaylistLimit(playlist.smartRuleJson);
      const recentTracks = await this.buildRecentSmartPlaylistTracks(limitHint);
      return this.queryPlaylistTrackPageFromTracks(recentTracks, options);
    }

    return { items: [], total: 0 };
  }

  async hydratePlaylistTracks(playlistId: string): Promise<Playlist | null> {
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return null;

    const existingPlaylist = this.getPlaylist(normalizedPlaylistId);
    if (!existingPlaylist) return null;
    if (existingPlaylist.tracksHydrated !== false) {
      return existingPlaylist;
    }

    const pending = this.playlistHydrationPromises.get(normalizedPlaylistId);
    if (pending) {
      return pending;
    }

    this.telemetry.info('audio.playlist.hydrate.start', {
      fields: {
        playlistId: normalizedPlaylistId,
        trackCountHint: existingPlaylist.trackCount ?? existingPlaylist.tracks.length,
        kind: existingPlaylist.kind ?? null,
      },
    });
    const hydrationPromise = this.loadPlaylistTracksFromLibraryDb(existingPlaylist)
      .then((tracks) => {
        const latestPlaylist = this.getPlaylist(normalizedPlaylistId);
        if (!latestPlaylist) return null;

        const hydratedPlaylist = this.createHydratedPlaylist(latestPlaylist, tracks, {
          trackCount:
            typeof latestPlaylist.trackCount === 'number' && latestPlaylist.trackCount > 0
              ? latestPlaylist.trackCount
              : tracks.length,
          totalDuration:
            typeof latestPlaylist.totalDuration === 'number' && latestPlaylist.totalDuration > 0
              ? latestPlaylist.totalDuration
              : undefined,
        });
        const playlists = this.state.playlists.map((playlist) =>
          playlist.id === normalizedPlaylistId ? hydratedPlaylist : playlist
        );
        const currentPlaylist =
          this.state.currentPlaylist?.id === normalizedPlaylistId
            ? this.createPlaylistSummaryReference(hydratedPlaylist)
            : this.syncCurrentPlaylistReference(playlists);
        this.updateState({ playlists, currentPlaylist });
        this.telemetry.info('audio.playlist.hydrate.completed', {
          fields: {
            playlistId: normalizedPlaylistId,
            trackCount: tracks.length,
            kind: hydratedPlaylist.kind ?? null,
          },
        });
        return hydratedPlaylist;
      })
      .catch((error) => {
        this.telemetry.warn('audio.playlist.hydrate.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            playlistId: normalizedPlaylistId,
            trackCountHint: existingPlaylist.trackCount ?? existingPlaylist.tracks.length,
            kind: existingPlaylist.kind ?? null,
          },
        });
        return null;
      })
      .finally(() => {
        this.playlistHydrationPromises.delete(normalizedPlaylistId);
      });

    this.playlistHydrationPromises.set(normalizedPlaylistId, hydrationPromise);
    return hydrationPromise;
  }

  releasePlaylistTracks(playlistId?: string): void {
    const normalizedPlaylistId = String(playlistId || '').trim();
    const shouldReleaseAll = normalizedPlaylistId.length === 0;
    let changed = false;

    const playlists = this.state.playlists.map((playlist) => {
      const targetMatch = shouldReleaseAll || playlist.id === normalizedPlaylistId;
      if (!targetMatch || playlist.tracksHydrated === false || playlist.tracks.length === 0) {
        return playlist;
      }

      changed = true;
      this.playlistHydrationPromises.delete(playlist.id);
      return {
        ...playlist,
        tracks: [],
        trackCount:
          typeof playlist.trackCount === 'number' && Number.isFinite(playlist.trackCount)
            ? playlist.trackCount
            : 0,
        totalDuration:
          typeof playlist.totalDuration === 'number' && Number.isFinite(playlist.totalDuration)
            ? playlist.totalDuration
            : 0,
        tracksHydrated: false,
      };
    });

    if (!changed) return;

    const currentPlaylist =
      this.state.currentPlaylist && (shouldReleaseAll || this.state.currentPlaylist.id === normalizedPlaylistId)
        ? this.createPlaylistSummaryReference(
            playlists.find((playlist) => playlist.id === this.state.currentPlaylist?.id) ?? null
          )
        : this.syncCurrentPlaylistReference(playlists);
    this.updateState({ playlists, currentPlaylist });
  }

  addTrackToPlaylist(playlistId: string, track: Track): void {
    const targetPlaylist = this.getPlaylist(playlistId);
    if (this.isReadonlyPlaylist(targetPlaylist)) return;
    if (!targetPlaylist) return;
    const stateTrack = compactTrackForPlaylistState(track);

    if (targetPlaylist?.tracksHydrated === false) {
      const normalizedPlaylistId = String(playlistId || '').trim();
      if (!normalizedPlaylistId) return;

      void (async () => {
        const serializedTrackPayload = serializeTrackForPlaylist(stateTrack);
        if (serializedTrackPayload && isTauriRuntime()) {
          const savedPlaylist = await prependNativeLibraryPlaylistItem(normalizedPlaylistId, {
            trackPayloadJson: serializedTrackPayload,
            snapshotTitle: stateTrack.title,
            snapshotArtist: stateTrack.artist,
            snapshotAlbum: stateTrack.album,
            snapshotDurationSeconds:
              typeof stateTrack.duration === 'number' && Number.isFinite(stateTrack.duration)
                ? Math.max(0, stateTrack.duration)
                : undefined,
            createdAtMs: Date.now(),
          });
          if (savedPlaylist) {
            this.replacePlaylistStateWithNativeSummaryRecord(savedPlaylist);
            return;
          }
        }
        if (!isTauriRuntime()) {
          const nextTracks = prependTrackWithDedup(targetPlaylist.tracks, stateTrack);
          const nextPlaylist = this.buildPersistablePlaylistFromTracks(targetPlaylist, nextTracks);
          this.replacePlaylistStateWithSummary(nextPlaylist);
        }
      })().catch((error) => {
        this.telemetry.warn('audio.playlist.add-track.summary-update.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            playlistId: normalizedPlaylistId,
            trackId: stateTrack.id,
          },
        });
      });
      return;
    }

    const normalizedPlaylistId = String(playlistId || '').trim();
    const nextTracks = prependTrackWithDedup(targetPlaylist.tracks, stateTrack);
    const previousPlaylist = targetPlaylist;
    const optimisticPlaylist = this.buildPersistablePlaylistFromTracks(targetPlaylist, nextTracks);
    this.replacePlaylistState(optimisticPlaylist);

    if (!isTauriRuntime()) {
      return;
    }

    const serializedTrackPayload = serializeTrackForPlaylist(stateTrack);
    if (!normalizedPlaylistId || !serializedTrackPayload) {
      this.replacePlaylistState(previousPlaylist);
      this.telemetry.warn('audio.playlist.add-track.hydrated-update.skipped', {
        fields: {
          playlistId: normalizedPlaylistId || previousPlaylist.id,
          trackId: stateTrack.id,
          serializable: Boolean(serializedTrackPayload),
        },
      });
      return;
    }

    void prependNativeLibraryPlaylistItem(normalizedPlaylistId, {
      trackPayloadJson: serializedTrackPayload,
      snapshotTitle: stateTrack.title,
      snapshotArtist: stateTrack.artist,
      snapshotAlbum: stateTrack.album,
      snapshotDurationSeconds:
        typeof stateTrack.duration === 'number' && Number.isFinite(stateTrack.duration)
          ? Math.max(0, stateTrack.duration)
          : undefined,
      createdAtMs: Date.now(),
    })
      .then((savedPlaylist) => {
        if (!savedPlaylist) {
          this.replacePlaylistState(previousPlaylist);
          return;
        }
        this.replaceHydratedPlaylistStateWithNativeRecord(savedPlaylist, nextTracks);
      })
      .catch((error) => {
        this.replacePlaylistState(previousPlaylist);
        this.telemetry.warn('audio.playlist.add-track.hydrated-update.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            playlistId: normalizedPlaylistId,
            trackId: stateTrack.id,
          },
        });
      });
  }

  removeTrackFromPlaylist(playlistId: string, trackIndex: number): void {
    const targetPlaylist = this.getPlaylist(playlistId);
    if (this.isReadonlyPlaylist(targetPlaylist)) return;
    if (!targetPlaylist) return;

    if (targetPlaylist?.tracksHydrated === false) {
      const normalizedPlaylistId = String(playlistId || '').trim();
      const normalizedTrackIndex =
        Number.isInteger(trackIndex) && trackIndex >= 0 ? trackIndex : -1;
      if (!normalizedPlaylistId || normalizedTrackIndex < 0) return;

      void (async () => {
        if (isTauriRuntime()) {
          const savedPlaylist = await removeNativeLibraryPlaylistItemAt(
            normalizedPlaylistId,
            normalizedTrackIndex
          );
          if (savedPlaylist) {
            this.replacePlaylistStateWithNativeSummaryRecord(savedPlaylist);
            return;
          }
        }
        if (!isTauriRuntime()) {
          const nextTracks = [...targetPlaylist.tracks];
          if (normalizedTrackIndex >= nextTracks.length) return;
          nextTracks.splice(normalizedTrackIndex, 1);
          const nextPlaylist = this.buildPersistablePlaylistFromTracks(targetPlaylist, nextTracks);
          this.replacePlaylistStateWithSummary(nextPlaylist);
        }
      })().catch((error) => {
        this.telemetry.warn('audio.playlist.remove-track.summary-update.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            playlistId: normalizedPlaylistId,
            trackIndex: normalizedTrackIndex,
          },
        });
      });
      return;
    }

    const normalizedTrackIndex =
      Number.isInteger(trackIndex) && trackIndex >= 0 && trackIndex < targetPlaylist.tracks.length
        ? trackIndex
        : -1;
    if (normalizedTrackIndex < 0) return;

    const normalizedPlaylistId = String(playlistId || '').trim();
    const previousPlaylist = targetPlaylist;
    const nextTracks = [...targetPlaylist.tracks];
    nextTracks.splice(normalizedTrackIndex, 1);
    const optimisticPlaylist = this.buildPersistablePlaylistFromTracks(targetPlaylist, nextTracks);
    this.replacePlaylistState(optimisticPlaylist);

    if (!isTauriRuntime()) {
      return;
    }

    if (!normalizedPlaylistId) {
      this.replacePlaylistState(previousPlaylist);
      return;
    }

    void removeNativeLibraryPlaylistItemAt(normalizedPlaylistId, normalizedTrackIndex)
      .then((savedPlaylist) => {
        if (!savedPlaylist) {
          this.replacePlaylistState(previousPlaylist);
          return;
        }
        this.replaceHydratedPlaylistStateWithNativeRecord(savedPlaylist, nextTracks);
      })
      .catch((error) => {
        this.replacePlaylistState(previousPlaylist);
        this.telemetry.warn('audio.playlist.remove-track.hydrated-update.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            playlistId: normalizedPlaylistId,
            trackIndex: normalizedTrackIndex,
          },
        });
      });
  }

  clearPlaylist(playlistId: string): void {
    const targetPlaylist = this.getPlaylist(playlistId);
    if (this.isReadonlyPlaylist(targetPlaylist)) return;
    if (!targetPlaylist) return;

    if (targetPlaylist?.tracksHydrated === false) {
      const normalizedPlaylistId = String(playlistId || '').trim();
      if (!normalizedPlaylistId) return;

      void (async () => {
        if (isTauriRuntime()) {
          const savedPlaylist = await clearNativeLibraryPlaylistItems(normalizedPlaylistId);
          if (savedPlaylist) {
            this.replacePlaylistStateWithNativeSummaryRecord(savedPlaylist);
            return;
          }
        }
        if (!isTauriRuntime()) {
          const nextPlaylist = this.buildPersistablePlaylistFromTracks(targetPlaylist, []);
          this.replacePlaylistStateWithSummary(nextPlaylist);
        }
      })().catch((error) => {
        this.telemetry.warn('audio.playlist.clear.summary-update.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            playlistId: normalizedPlaylistId,
          },
        });
      });
      return;
    }

    const normalizedPlaylistId = String(playlistId || '').trim();
    const previousPlaylist = targetPlaylist;
    const optimisticPlaylist = this.buildPersistablePlaylistFromTracks(targetPlaylist, []);
    this.replacePlaylistState(optimisticPlaylist);

    if (!isTauriRuntime()) {
      return;
    }

    if (!normalizedPlaylistId) {
      this.replacePlaylistState(previousPlaylist);
      return;
    }

    void clearNativeLibraryPlaylistItems(normalizedPlaylistId)
      .then((savedPlaylist) => {
        if (!savedPlaylist) {
          this.replacePlaylistState(previousPlaylist);
          return;
        }
        this.replaceHydratedPlaylistStateWithNativeRecord(savedPlaylist, []);
      })
      .catch((error) => {
        this.replacePlaylistState(previousPlaylist);
        this.telemetry.warn('audio.playlist.clear.hydrated-update.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            playlistId: normalizedPlaylistId,
          },
        });
      });
  }

  async playPlaylist(playlistId: string): Promise<void> {
    const resolved = await this.loadPlaylistTracksForQueuePlayback(playlistId);
    if (!resolved || resolved.tracks.length === 0) return;
    const { playlist, tracks } = resolved;
    this.telemetry.info('audio.playlist.play', {
      fields: {
        playlistId: playlist.id,
        trackCount: tracks.length,
        kind: playlist.kind ?? null,
      },
    });
    this.clearQueue({ releasePlaylists: false });
    this.addMultipleToQueue(tracks);
    await this.playTrackAtIndex(0);
    this.updateState({
      currentPlaylist: this.createPlaylistSummaryReference(this.getPlaylist(playlistId) ?? playlist),
    });
    this.touchPlaylistOpenedBestEffort(playlistId);
  }

  async playPlaylistTrackAtIndex(playlistId: string, trackIndex: number): Promise<void> {
    const resolved = await this.loadPlaylistTracksForQueuePlayback(playlistId);
    if (!resolved || resolved.tracks.length === 0) return;
    const { playlist, tracks } = resolved;

    const normalizedTrackIndex =
      Number.isInteger(trackIndex) && trackIndex >= 0 && trackIndex < tracks.length
        ? trackIndex
        : -1;
    if (normalizedTrackIndex < 0) return;

    const track = tracks[normalizedTrackIndex] ?? null;
    this.telemetry.info('audio.playlist.track.play', {
      fields: {
        playlistId: playlist.id,
        playlistTrackCount: tracks.length,
        trackIndex: normalizedTrackIndex,
        trackId: track?.id ?? null,
        trackTitle: track?.title ?? null,
        kind: playlist.kind ?? null,
      },
    });

    this.clearQueue({ releasePlaylists: false });
    this.addMultipleToQueue(tracks);
    await this.playTrackAtIndex(normalizedTrackIndex);
    this.updateState({
      currentPlaylist: this.createPlaylistSummaryReference(this.getPlaylist(playlistId) ?? playlist),
    });
    this.touchPlaylistOpenedBestEffort(playlistId);
  }

  async addPlaylistToQueue(playlistId: string): Promise<void> {
    const resolved = await this.loadPlaylistTracksForQueuePlayback(playlistId);
    if (!resolved) return;
    const { playlist, tracks } = resolved;
    const fields = {
      playlistId: playlist.id,
      trackCount: tracks.length,
      kind: playlist.kind ?? null,
    };
    this.telemetry.info('audio.queue.add.playlist', {
      fields,
    });
    this.addMultipleToQueue(tracks);
    captureTelemetryScenarioSnapshot({
      moduleId: 'audio',
      component: 'NativeAudioService',
      event: 'audio.queue.add.playlist.snapshot',
      fields: {
        ...fields,
        queueLength: this.state.queue.length,
      },
      minIntervalMs: 250,
    });
  }

  async addPlaylistTrackIndexesToQueue(
    playlistId: string,
    trackIndexes: number[]
  ): Promise<void> {
    const resolved = await this.loadPlaylistTrackSelectionForQueue(playlistId, trackIndexes);
    if (!resolved) return;
    const { playlist, normalizedIndexes, tracks } = resolved;
    if (normalizedIndexes.length === 0) return;
    if (tracks.length === 0) return;

    const fields = {
      playlistId: playlist.id,
      playlistTrackCount:
        typeof playlist.trackCount === 'number' && Number.isFinite(playlist.trackCount)
          ? Math.max(0, Math.floor(playlist.trackCount))
          : playlist.tracks.length,
      selectedTrackCount: tracks.length,
      firstTrackIndex: normalizedIndexes[0] ?? null,
      lastTrackIndex: normalizedIndexes[normalizedIndexes.length - 1] ?? null,
      kind: playlist.kind ?? null,
    };
    this.telemetry.info('audio.queue.add.playlist-selection', {
      fields,
    });
    this.addMultipleToQueue(tracks);
    captureTelemetryScenarioSnapshot({
      moduleId: 'audio',
      component: 'NativeAudioService',
      event: 'audio.queue.add.playlist-selection.snapshot',
      fields: {
        ...fields,
        queueLength: this.state.queue.length,
      },
      minIntervalMs: 250,
    });
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
      await invokeWithTelemetry('native_audio_set_spectrum_enabled', { enabled }, {
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.spectrum.set-enabled',
      });
    } catch (error) {
      this.telemetry.warn('audio.spectrum.set-enabled.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          enabled,
        },
      });
    }
    if (!enabled) {
      this.spectrumData = null;
      this.spectrumFrames = {};
    }
  }

  // Spectrum data accessors.
  getFrequencyData(): Uint8Array | null {
    this.touchSpectrumUsage();
    return this.spectrumData;
  }

  getSpectrumFrame(tap: AudioSpectrumTap = 'post-dsp'): AudioSpectrumFrame | null {
    this.touchSpectrumUsage();
    return this.spectrumFrames[tap] ?? null;
  }

  // Lifecycle teardown.
  destroy(): void {
    this.disposed = true;
    this.cancelPlaybackWorkingSetTrim();
    this.resetNativeQueueMirrorState();
    this.playlistHydrationPromises.clear();
    this.diagnosticTimelineIgnoreBeforeMs = 0;

    this.stop();
    this.clearRecentSmartPlaylistWriteTimer();
    this.flushRecentSmartPlaylistWriteBufferBestEffort();
    this.clearPendingVolume();
    if (typeof window !== 'undefined') {
      this.seekCommandCoalescer.clearAll({ clearTimer: (timerId) => window.clearTimeout(timerId) });
      this.volumeCommandCoalescer.clearAll({ clearTimer: (timerId) => window.clearTimeout(timerId) });
    } else {
      this.seekCommandCoalescer.clearAll();
      this.volumeCommandCoalescer.clearAll();
    }
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
    this.playbackPreferencesListenerCleanup?.();
    this.playbackPreferencesListenerCleanup = null;
    this.playbackPreferencesListenerInitPromise = null;
    this.clearTuningAutoLoop();
    this.timeUpdateCallbacks.clear();
    this.endedCallbacks.clear();
    this.stateChangeCallbacks.clear();
    this.loadProgressCallbacks.clear();
    this.errorCallbacks.clear();
    this.robustnessController.destroy();
    this.dynamicSrcPolicyExecutor.reset();
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
    this.runtimeComponentsListeners.forEach((unlisten) => unlisten());
    this.runtimeComponentsListeners = [];
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
