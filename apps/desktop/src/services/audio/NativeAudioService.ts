import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { setupNativeListenersImpl } from './nativeAudioNativeListeners';
import {
  restoreDynamicSrcAutoSettingsFromStorageImpl,
  type DynamicSrcAutoSettingsHost,
} from './nativeAudioDynamicSrcAutoSettings';
import {
  AudioDynamicSrcAdaptiveProfile,
  AudioDynamicSrcDegradationLevel,
  AudioDynamicSrcAutoSettingsPatch,
  AudioDynamicSrcAutoSettings,
  AudioProtectionWindowOptions,
  AudioRobustnessSnapshot,
  AudioStabilityProfile,
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
} from './trackIdentity';
import {
  resolvePlatformPlaybackIdentity,
} from './platformPlaybackResolver';
import {
  type PreparedAudioSource,
} from './audioPlaybackSourceResolver';
import {
  computeDynamicSrcStressScore,
} from './audioStabilityController';
import {
  pruneUnderrunSpikeTimestamps,
} from './audioOutputFailoverController';
import { NativeAudioOutputBackendController } from './nativeAudioOutputBackendController';
import {
  SeekCommandCoalescer,
  VolumeCommandCoalescer,
} from './audioCommandCoalescers';
import {
  isSameStreamingBufferSettings,
  resolveStoredStreamingBufferSettings,
  resolveStreamingBufferPolicyTarget,
  type StreamingBufferSettings,
} from './streamingBufferPolicy';
import {
  resolveAudioTuningProfilePayload,
} from './audioTuningProfiles';
import {
  NativeAudioTuningAutoController,
  resolveNativeAudioTuningAutoSettingsPatch,
} from './nativeAudioTuningAutoController';
import {
  NativeAudioDynamicSrcLearningController,
} from './nativeAudioDynamicSrcLearningController';
import {
  NativeAudioDynamicSrcPolicyController,
  resolveNativeAudioDynamicSrcSettingsPatch,
} from './nativeAudioDynamicSrcPolicyController';
import { resolveStoredTuningAutoSettings } from './nativeAudioAutoSettingsStorage';
import {
  persistAudioPlaybackMuted,
  persistAudioPlaybackPlayMode,
  persistAudioPlaybackVolume,
  readPersistedAudioPlaybackPreferences,
  setupAudioPlaybackPreferencesListener,
  type AudioPlaybackPreferences,
} from './audioPlaybackPreferences';
import {
  markNativeLibraryUserEntryPlayed,
  upsertNativeLibraryUserEntry,
} from '../../modules/music-library';
import { readString, removeKey } from '../../modules/storage';
import {
  cancelScheduledProcessWorkingSetTrim,
  getLastProcessWorkingSetTrimEvent,
  scheduleProcessWorkingSetTrim,
} from '../../utils/processWorkingSetTrim';
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
  AudioPlaylistShell,
  parseTracksFromPlaylistItems,
} from './audioPlaylistShell';
import { RecentSmartPlaylistWriter } from './recentSmartPlaylistWriter';
import { NativeAudioSpectrumController } from './nativeAudioSpectrumController';
import { NativeAudioQueueMirror } from './nativeAudioQueueMirror';
import { NativeAudioSourcePreparation } from './nativeAudioSourcePreparation';
import {
  compactTrackForQueueState,
  compactTrackForState,
} from './trackStateProjection';
import type { CoverSizeHint } from './MusicLibraryService';
import {
  parseLegacyRuntimeControlFromReplayGain,
  type CrossfadeSettings,
  type DynamicSrcLearningMap,
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
  private readonly sourcePreparation = new NativeAudioSourcePreparation({
    isRuntime: isTauriRuntime,
    invokeCommand: (command, payload) => this.invokeCommand(command, payload),
    emitError: (error) => this.emitError(error),
    recordStabilityHint: (reason, options) =>
      this.recordNativeStabilityHintBestEffort(reason, options),
    onUnsupportedSource: (source, track) => {
      this.telemetry.warn('audio.source.prepare.unsupported', {
        fields: {
          sourceKind: source.kind,
          deferredReason: source.kind === 'deferred' ? source.reason : null,
          ...buildTrackTelemetryFields(track),
        },
      });
    },
  });
  private readonly playlistShell = new AudioPlaylistShell({
    getState: () => this.state,
    getPlaylists: () => this.state.playlists,
    getPlaylist: (playlistId) =>
      this.state.playlists.find((playlist) => playlist.id === playlistId) ?? null,
    replacePlaylists: (playlists, currentPlaylist) => {
      const partial: Partial<AudioState> = { playlists };
      if (currentPlaylist !== undefined) {
        partial.currentPlaylist = currentPlaylist;
      } else if (this.state.currentPlaylist) {
        partial.currentPlaylist =
          playlists.find((playlist) => playlist.id === this.state.currentPlaylist?.id) ?? null;
      }
      this.updateState(partial);
    },
  });
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
  private readonly spectrumController = new NativeAudioSpectrumController({
    setBackendEnabled: (enabled) => this.setNativeSpectrumEnabled(enabled),
    onBackendSetFailed: (enabled, error) => {
      this.telemetry.warn('audio.spectrum.set-enabled.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          enabled,
        },
      });
    },
    onClearData: () => this.clearSpectrumData(),
  });
  private readonly queueMirror = new NativeAudioQueueMirror({
    isDisposed: () => this.disposed,
    isRuntime: isTauriRuntime,
    getQueue: () => this.state.queue,
    getCurrentIndex: () => this.state.currentIndex,
    getTrackPath: (track) => this.getTrackPath(track),
    buildTelemetryFields: (queue, currentIndex, extra) =>
      this.buildQueueTelemetryFields(queue, currentIndex, extra),
  });
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
  private readonly recentSmartPlaylistWriter = new RecentSmartPlaylistWriter({
    playlistId: NativeAudioService.SMART_PLAYLIST_RECENT_ID,
    playlistName: NativeAudioService.SMART_PLAYLIST_RECENT_NAME,
    playlistLimit: NativeAudioService.SMART_PLAYLIST_RECENT_LIMIT,
    debounceMs: NativeAudioService.RECENT_SMART_PLAYLIST_WRITE_DEBOUNCE_MS,
    maxBufferedEvents: NativeAudioService.RECENT_SMART_PLAYLIST_MAX_BUFFERED_EVENTS,
    isRuntime: isTauriRuntime,
    getPlaylists: () => this.state.playlists,
    getCurrentPlaylist: () => this.state.currentPlaylist,
    updateState: (partial) => this.updateState(partial),
    ensureBuiltinSmartPlaylistsInLibraryDb: () => this.ensureBuiltinSmartPlaylistsInLibraryDb(),
    parseTracksFromPlaylistItems,
    onFlushFailed: (error, bufferedEntryCount) => {
      this.telemetry.warn('audio.recent-playlist.flush.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          bufferedEntryCount,
        },
      });
    },
  });
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
  private readonly outputBackendController = new NativeAudioOutputBackendController({
    config: {
      underrunWindowMs: NativeAudioService.AUTO_BACKEND_UNDERRUN_WINDOW_MS,
      underrunTriggerCount: NativeAudioService.AUTO_BACKEND_UNDERRUN_TRIGGER_COUNT,
      underrunFrameSpikeTrigger: NativeAudioService.AUTO_BACKEND_UNDERRUN_FRAME_SPIKE_TRIGGER,
      switchCooldownMs: NativeAudioService.AUTO_BACKEND_SWITCH_COOLDOWN_MS,
    },
    isWindowsOutputPlatform: () => this.isWindowsOutputPlatform(),
  });

  private get availableOutputBackends(): string[] {
    return this.outputBackendController.availableOutputBackends;
  }

  private set availableOutputBackends(backends: string[]) {
    this.outputBackendController.replaceOutputBackends(backends);
  }

  private get currentOutputBackendId(): string | null {
    return this.outputBackendController.currentOutputBackendId;
  }

  private set currentOutputBackendId(backendId: string | null) {
    this.outputBackendController.setCurrentOutputBackendId(backendId);
  }

  private get currentOutputDeviceId(): string | null {
    return this.outputBackendController.currentOutputDeviceId;
  }

  private get currentOutputDeviceName(): string | null {
    return this.outputBackendController.currentOutputDeviceName;
  }

  private get backendSwitchInFlight(): boolean {
    return this.outputBackendController.backendSwitchInFlight;
  }

  private get autoBackendSwitchCount(): number {
    return this.outputBackendController.autoBackendSwitchCount;
  }

  private get lastAutoBackendSwitchAtMs(): number | null {
    return this.outputBackendController.lastAutoBackendSwitchAtMs;
  }

  private get lastAutoBackendSwitchReason(): string | null {
    return this.outputBackendController.lastAutoBackendSwitchReason;
  }
  private lastSchedulerProfile: 'normal' | 'guarded' | 'critical' = 'normal';
  private stabilityProfile: AudioStabilityProfile = 'balanced';
  private stabilityActionProfile: 'normal' | 'guarded' | 'critical' = 'normal';
  private sourcePrepareProfile: 'baseline' | 'steady' | 'aggressive' | 'failsafe' = 'baseline';
  private stabilityPrimaryReason: string | null = null;
  private stabilityReasonCodes: string[] = [];
  private stabilityHintProfile: 'normal' | 'guarded' | 'critical' | undefined;
  private stabilityHintPrimaryReason: string | null = null;
  private stabilityHintReasonCodes: string[] = [];
  private transportMode: 'robust' | 'transport-exact' = 'robust';
  private hqSrcPhaseMode: 'linear' | 'minimum' | 'intermediate' = 'linear';
  private srcMode: 'source-native' | 'match-output' | 'target-rate' = 'match-output';
  private srcBackend: 'rubato' | 'linear-simd' = 'rubato';
  private srcTargetSampleRate: number | null = null;
  private outputQuantizationMode: 'round' | 'tpdf' = 'round';
  private readonly dynamicSrcPolicyController = new NativeAudioDynamicSrcPolicyController({
    defaults: {
      enabled: true,
      adaptiveEnabled: true,
      learningEnabled: true,
      restoreDebounceMs: NativeAudioService.DYNAMIC_SRC_RESTORE_DEBOUNCE_MS,
      minSwitchIntervalMs: NativeAudioService.DYNAMIC_SRC_MIN_SWITCH_INTERVAL_MS,
      seekHoldMs: NativeAudioService.DYNAMIC_SRC_SEEK_HOLD_MS,
      underrunHoldMs: NativeAudioService.DYNAMIC_SRC_UNDERRUN_HOLD_MS,
      sharedStressHoldMs: NativeAudioService.DYNAMIC_SRC_SHARED_STRESS_HOLD_MS,
      outputErrorHoldMs: NativeAudioService.DYNAMIC_SRC_OUTPUT_ERROR_HOLD_MS,
    },
    thresholds: {
      elevatedScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_ELEVATED,
      criticalScoreThreshold: NativeAudioService.DYNAMIC_SRC_ADAPTIVE_SCORE_CRITICAL,
      severeUnderrunFramesThreshold: NativeAudioService.AUTO_BACKEND_UNDERRUN_FRAME_SPIKE_TRIGGER,
      degradationL2HoldFloorMs: NativeAudioService.DYNAMIC_SRC_DEGRADATION_L2_HOLD_FLOOR_MS,
    },
  });

  private get dynamicSrcAutoEnabled(): boolean {
    return this.dynamicSrcPolicyController.enabled;
  }

  private get dynamicSrcProfile(): 'quality' | 'latency' {
    return this.dynamicSrcPolicyController.profile;
  }

  private get dynamicSrcAutoDegradationLevel(): AudioDynamicSrcDegradationLevel {
    return this.dynamicSrcPolicyController.autoDegradationLevel;
  }

  private get dynamicSrcAutoDegradationReason(): string | null {
    return this.dynamicSrcPolicyController.autoDegradationReason;
  }

  private get dynamicSrcAutoDegradationLastChangedAtMs(): number | null {
    return this.dynamicSrcPolicyController.autoDegradationLastChangedAtMs;
  }

  private get dynamicSrcLastSwitchAtMs(): number | null {
    return this.dynamicSrcPolicyController.lastPolicySwitchAtMs;
  }

  private get dynamicSrcLastSwitchReason(): string | null {
    return this.dynamicSrcPolicyController.lastPolicySwitchReason;
  }

  private get dynamicSrcHoldUntilMs(): number {
    return this.dynamicSrcPolicyController.holdUntil;
  }

  private get dynamicSrcManualLockActive(): boolean {
    return this.dynamicSrcPolicyController.manualLockActive;
  }

  private get dynamicSrcQualityPolicy(): NativeAudioSrcPolicy {
    return this.dynamicSrcPolicyController.currentQualityPolicy;
  }

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
  private memoryPoolF32GrowthEvents = 0;
  private memoryPoolF32GrowthBytes = 0;
  private memoryPoolF32PrewarmHits = 0;
  private realtimeMemoryLockAttemptedBytes = 0;
  private realtimeMemoryLockSucceededBytes = 0;
  private realtimeMemoryLockFailedBytes = 0;
  private realtimeMemoryLockSkippedBytes = 0;
  private realtimeMemoryLockFailureCount = 0;
  private realtimeMemoryLockSkippedCount = 0;
  private realtimeMemoryLockedRoleMask = 0;
  private realtimeMemoryFailedRoleMask = 0;
  private realtimeMemorySkippedRoleMask = 0;
  private realtimeMemoryPressureEvents = 0;
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
  private static readonly SMART_PLAYLIST_RECENT_ID = 'smart-recently-played';
  private static readonly SMART_PLAYLIST_RECENT_NAME = 'Recently Played';
  private static readonly SMART_PLAYLIST_RECENT_LIMIT = 1000;
  private static readonly RECENT_SMART_PLAYLIST_WRITE_DEBOUNCE_MS = 500;
  private static readonly RECENT_SMART_PLAYLIST_MAX_BUFFERED_EVENTS = 64;

  private get dynamicSrcRestoreDebounceMs(): number {
    return this.dynamicSrcPolicyController.restoreDebounceMs;
  }

  private get dynamicSrcMinSwitchIntervalMs(): number {
    return this.dynamicSrcPolicyController.minSwitchIntervalMs;
  }

  private get dynamicSrcSeekHoldMs(): number {
    return this.dynamicSrcPolicyController.seekHoldMs;
  }

  private get dynamicSrcUnderrunHoldMs(): number {
    return this.dynamicSrcPolicyController.underrunHoldMs;
  }

  private get dynamicSrcSharedStressHoldMs(): number {
    return this.dynamicSrcPolicyController.sharedStressHoldMs;
  }

  private get dynamicSrcOutputErrorHoldMs(): number {
    return this.dynamicSrcPolicyController.outputErrorHoldMs;
  }

  private get dynamicSrcAdaptiveEnabled(): boolean {
    return this.dynamicSrcPolicyController.adaptiveEnabled;
  }

  private get dynamicSrcAdaptiveProfile(): AudioDynamicSrcAdaptiveProfile {
    return this.dynamicSrcPolicyController.currentAdaptiveProfile;
  }

  private get dynamicSrcLearningEnabled(): boolean {
    return this.dynamicSrcPolicyController.learningEnabled;
  }

  private readonly dynamicSrcLearningController = new NativeAudioDynamicSrcLearningController({
    maxItems: NativeAudioService.DYNAMIC_SRC_LEARNING_MAX_ITEMS,
    persistMinIntervalMs: NativeAudioService.DYNAMIC_SRC_LEARNING_PERSIST_MIN_INTERVAL_MS,
    updateMinIntervalMs: NativeAudioService.DYNAMIC_SRC_LEARNING_UPDATE_MIN_INTERVAL_MS,
    minDelta: NativeAudioService.DYNAMIC_SRC_LEARNING_MIN_DELTA,
    persistProfile: (profile) =>
      broadcastDataUpdate(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE, profile),
  });

  private get dynamicSrcLearningProfile(): DynamicSrcLearningMap {
    return this.dynamicSrcLearningController.getProfile();
  }

  private readonly tuningAutoController = new NativeAudioTuningAutoController({
    initialSettings: {
      enabled: NativeAudioService.TUNING_AUTO_ENABLED_DEFAULT,
      tickIntervalMs: NativeAudioService.TUNING_AUTO_TICK_INTERVAL_MS,
      stableWindowMs: NativeAudioService.TUNING_AUTO_STABLE_WINDOW_MS,
      minSwitchIntervalMs: NativeAudioService.TUNING_AUTO_MIN_SWITCH_INTERVAL_MS,
      postSwitchObserveWindowMs: NativeAudioService.TUNING_AUTO_POST_SWITCH_OBSERVE_WINDOW_MS,
      elevatedStressScore: NativeAudioService.TUNING_AUTO_ELEVATED_STRESS_SCORE,
      criticalStressScore: NativeAudioService.TUNING_AUTO_CRITICAL_STRESS_SCORE,
      criticalUnderrunEventsWindow: NativeAudioService.TUNING_AUTO_CRITICAL_UNDERRUN_EVENTS_WINDOW,
      criticalOverflowGrowthTicks: NativeAudioService.TUNING_AUTO_CRITICAL_OVERFLOW_GROWTH_TICKS,
    },
    isDisposed: () => this.disposed,
    onTick: () => this.tickTuningAutoController(),
  });

  private get tuningAutoSettings(): AudioTuningAutoSettings {
    return this.tuningAutoController.getSettings();
  }

  private get tuningAutoEnabled(): boolean {
    return this.tuningAutoController.enabled;
  }

  private get tuningAutoTickIntervalMs(): number {
    return this.tuningAutoController.tickIntervalMs;
  }

  private get tuningAutoStableWindowMs(): number {
    return this.tuningAutoController.stableWindowMs;
  }

  private get tuningAutoMinSwitchIntervalMs(): number {
    return this.tuningAutoController.minSwitchIntervalMs;
  }

  private get tuningAutoPostSwitchObserveWindowMs(): number {
    return this.tuningAutoController.postSwitchObserveWindowMs;
  }

  private get tuningAutoElevatedStressScore(): number {
    return this.tuningAutoController.elevatedStressScore;
  }

  private get tuningAutoCriticalStressScore(): number {
    return this.tuningAutoController.criticalStressScore;
  }

  private get tuningAutoCriticalUnderrunEventsWindow(): number {
    return this.tuningAutoController.criticalUnderrunEventsWindow;
  }

  private get tuningAutoCriticalOverflowGrowthTicks(): number {
    return this.tuningAutoController.criticalOverflowGrowthTicks;
  }

  private get tuningAutoControllerState() {
    return this.tuningAutoController.getControllerState();
  }

  private get tuningAutoLastReason(): string | null {
    return this.tuningAutoController.getLastReason();
  }

  private get tuningAutoLastAppliedAtMs(): number | null {
    return this.tuningAutoController.getLastAppliedAtMs();
  }

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

  private async prepareSourceForNativePlayback(track: Track): Promise<PreparedAudioSource> {
    return this.sourcePreparation.prepare(track);
  }

  private resolveTrackForPreparedSource(source: PreparedAudioSource): Track {
    return this.sourcePreparation.resolveTrack(source);
  }

  private resolvePreparedSourceIdentityPath(source: PreparedAudioSource, track: Track): string | null {
    return this.sourcePreparation.resolveIdentityPath(source, track);
  }

  private resolvePreparedSourcePathForNativeTransport(source: PreparedAudioSource): string | null {
    return this.sourcePreparation.resolveNativeTransportPath(source);
  }

  private applyPreparedSourceMaterializedPath(
    source: PreparedAudioSource,
    track: Track,
    materializedPath: string | null | undefined
  ): Track {
    return this.sourcePreparation.applyMaterializedPath(source, track, materializedPath);
  }

  private async invokePreparedSourceLoadCommand(
    source: PreparedAudioSource,
    options?: {
      play?: boolean;
      replayGainDb?: number;
    }
  ): Promise<string | null> {
    return this.sourcePreparation.loadSource(source, options);
  }

  private async syncMaterializedQueueItemPathIfNeeded(
    index: number,
    previousQueuePath: string | null | undefined,
    materializedPath: string | null | undefined
  ): Promise<void> {
    if (!materializedPath || !this.isProbablyAbsolutePath(materializedPath)) {
      return;
    }
    if (index < 0 || index >= this.state.queue.length) {
      return;
    }

    const normalizedPreviousPath = this.normalizeTrackPathForCompare(previousQueuePath);
    const normalizedMaterializedPath = this.normalizeTrackPathForCompare(materializedPath);
    if (!normalizedMaterializedPath || normalizedPreviousPath === normalizedMaterializedPath) {
      return;
    }

    await this.replaceQueueItemPathInNative(index, materializedPath);
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

  async resolvePlaylistCoverPreview(
    playlistId: string,
    options?: { coverSizeHint?: CoverSizeHint; preferCompactPreview?: boolean }
  ): Promise<string | undefined> {
    return this.playlistShell.resolvePlaylistCoverPreview(playlistId, options);
  }

  private enqueueRecentSmartPlaylistTrackBestEffort(track: Track, playedAtMs: number): void {
    this.recentSmartPlaylistWriter.enqueueTrackBestEffort(track, playedAtMs);
  }

  private async ensureBuiltinSmartPlaylistsInLibraryDb(): Promise<void> {
    await this.playlistShell.restorePlaylistSummaries();
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
    return this.outputBackendController.isSharedOutputBackend(backendId);
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
        get: () => this.dynamicSrcPolicyController.deferredLatency,
        set: (value: string | null) => {
          this.dynamicSrcPolicyController.deferredLatency = value;
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
    void this.backendSwitchInFlight;
    void this.autoBackendSwitchCount;
    void this.lastAutoBackendSwitchAtMs;
    void this.lastAutoBackendSwitchReason;
    void this.lastSchedulerProfile;
    void this.dynamicSrcAutoEnabled;
    void this.dynamicSrcProfile;
    void this.dynamicSrcAutoDegradationLevel;
    void this.dynamicSrcAutoDegradationReason;
    void this.dynamicSrcAutoDegradationLastChangedAtMs;
    void this.dynamicSrcLastSwitchAtMs;
    void this.dynamicSrcLastSwitchReason;
    void this.dynamicSrcHoldUntilMs;
    void this.dynamicSrcManualLockActive;
    void this.dynamicSrcRestoreDebounceMs;
    void this.dynamicSrcMinSwitchIntervalMs;
    void this.dynamicSrcSeekHoldMs;
    void this.dynamicSrcUnderrunHoldMs;
    void this.dynamicSrcSharedStressHoldMs;
    void this.dynamicSrcOutputErrorHoldMs;
    void this.dynamicSrcAdaptiveEnabled;
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
    void this.tuningAutoEnabled;
    void this.tuningAutoTickIntervalMs;
    void this.tuningAutoStableWindowMs;
    void this.tuningAutoMinSwitchIntervalMs;
    void this.tuningAutoPostSwitchObserveWindowMs;
    void this.tuningAutoElevatedStressScore;
    void this.tuningAutoCriticalStressScore;
    void this.tuningAutoCriticalUnderrunEventsWindow;
    void this.tuningAutoCriticalOverflowGrowthTicks;
    void this.tuningAutoControllerState;
    void this.tuningAutoLastReason;
    void this.tuningAutoLastAppliedAtMs;
    void this.markPendingSeekGuard;
    void this.clearPendingSeekGuard;
    void this.shouldIgnoreBackendCurrentTime;
    void this.flushPendingSeekCommand;
    void this.scheduleSeekFlush;
    void this.flushPendingVolumeCommand;
    void this.scheduleVolumeFlush;
    void this.updateDynamicSrcLearningFromStress;
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

      if (
        record.stabilityProfile === 'low-latency' ||
        record.stabilityProfile === 'balanced' ||
        record.stabilityProfile === 'stable' ||
        record.stabilityProfile === 'game-safe' ||
        record.stabilityProfile === 'safe-mode'
      ) {
        patch.stabilityProfile = record.stabilityProfile;
      }

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
      stabilityProfile: this.stabilityProfile,
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
    this.outputBackendController.applyRuntimeAudioComponentsState({
      ...components,
      outputBackendId: this.sanitizeBackendId(components.outputBackendId),
      outputDeviceId: this.sanitizeNonEmptyString(components.outputDeviceId),
      outputDevice: this.sanitizeNonEmptyString(components.outputDevice),
    });
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
      if (this.dynamicSrcPolicyController.profile !== 'latency') {
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
    this.dynamicSrcPolicyController.currentQualityPolicy = {
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

  private updateDynamicSrcLearningFromStress(stressScore: number, nowMs: number = Date.now()): void {
    this.dynamicSrcLearningController.updateFromStress({
      enabled: this.dynamicSrcLearningEnabled,
      deviceKey: this.buildDynamicSrcLearningDeviceKey(),
      stressScore,
      nowMs,
    });
  }

  private getDynamicSrcLearningScale(): number {
    return this.dynamicSrcLearningController.getScale({
      enabled: this.dynamicSrcLearningEnabled,
      deviceKey: this.buildDynamicSrcLearningDeviceKey(),
    });
  }

  private evaluateDynamicSrcAutoDegradation(options?: {
    nowMs?: number;
    triggerActions?: boolean;
    stressScore?: number;
  }): void {
    const nowMs = options?.nowMs ?? Date.now();
    const action = this.dynamicSrcPolicyController.evaluateAutoDegradation({
      nowMs,
      triggerActions: options?.triggerActions,
      stressScore: options?.stressScore,
      lastUnderrunFrames: this.lastUnderrunFrames,
      metrics: this.buildDynamicSrcStabilityMetrics(nowMs),
      effectiveTiming: options?.triggerActions
        ? this.getEffectiveDynamicSrcTiming(nowMs)
        : undefined,
    });

    if (action.kind === 'none') {
      return;
    }

    if (action.kind === 'ensure-latency') {
      void this.ensureLatencySrcPolicy(action.reason);
      return;
    }

    if (action.kind === 'hold') {
      this.withDynamicSrcHold(action.reason, action.holdMs);
      return;
    }

    if (action.kind === 'schedule-restore') {
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
    return this.dynamicSrcPolicyController.getEffectiveTiming({
      stressScore,
      learningScale: this.getDynamicSrcLearningScale(),
    });
  }

  private clearDynamicSrcRestoreTimer(): void {
    this.dynamicSrcPolicyController.clearRestoreTimer();
  }

  private scheduleDynamicSrcRestoreEvaluation(minDelayMs: number = 0): void {
    const nowMs = Date.now();
    this.dynamicSrcPolicyController.scheduleRestoreEvaluation({
      minDelayMs,
      nowMs,
      effectiveTiming: this.getEffectiveDynamicSrcTiming(nowMs),
      onRestore: () => {
        void this.maybeRestoreQualitySrc('stable-window');
      },
    });
  }

  private withDynamicSrcHold(reason: string, holdMs: number): void {
    const nowMs = Date.now();
    const hold = this.dynamicSrcPolicyController.withHold({
      reason,
      holdMs,
      nowMs,
      effectiveTiming: this.getEffectiveDynamicSrcTiming(nowMs),
      hasPendingSeekWork: this.hasPendingSeekWork(),
    });
    if (hold.ensureLatencyReason) {
      void this.ensureLatencySrcPolicy(hold.ensureLatencyReason);
    }
    this.scheduleDynamicSrcRestoreEvaluation();
  }

  private flushDeferredLatencySrcPolicy(trigger: string): void {
    const reason = this.dynamicSrcPolicyController.flushDeferredLatencyPolicy({
      trigger,
      hasPendingSeekWork: this.hasPendingSeekWork(),
    });
    if (!reason) return;
    void this.ensureLatencySrcPolicy(reason);
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
    const plan = this.dynamicSrcPolicyController.planPolicyApply({
      currentPolicy: current,
      targetPolicy: target,
      nowMs,
      minSwitchIntervalMs: effective.minSwitchIntervalMs,
      profile,
    });

    if (plan.action === 'skip-current' || plan.action === 'skip-pending') {
      return false;
    }

    if (plan.action === 'defer') {
      this.scheduleDynamicSrcRestoreEvaluation(plan.delayMs);
      return false;
    }

    const applyNowMs = plan.nowMs;
    this.dynamicSrcPolicyController.beginPolicyApply(target, applyNowMs);

    try {
      await this.setEnginePolicyInternal(target, { fromDynamicAuto: true });
      this.dynamicSrcPolicyController.markPolicyApplied({
        profile,
        reason,
        appliedAtMs: applyNowMs,
      });
      this.emitRobustnessSnapshot(true);
      return true;
    } catch {
      return false;
    } finally {
      this.dynamicSrcPolicyController.finishPolicyApply(target);
    }
  }

  private async ensureLatencySrcPolicy(reason: string): Promise<void> {
    if (!this.dynamicSrcPolicyController.canEnsureLatency()) return;
    await this.applySrcPolicyIfNeeded(this.getLatencySrcPolicy(), reason, 'latency');
  }

  private async maybeRestoreQualitySrc(reason: string): Promise<void> {
    const nowMs = Date.now();
    const readiness = this.dynamicSrcPolicyController.getRestoreReadiness({
      nowMs,
      underrunRecoveryUntilMs: this.underrunRecoveryUntilMs,
      protectionWindowActive: this.hasActiveProtectionWindow(nowMs),
      sharedStressWindowActive: this.hasActiveSharedStressWindow(nowMs),
      playbackState: this.state.playbackState,
    });
    if (readiness.action === 'skip') return;
    if (readiness.action === 'schedule') {
      this.scheduleDynamicSrcRestoreEvaluation();
      return;
    }

    const restored = await this.applySrcPolicyIfNeeded(
      this.dynamicSrcQualityPolicy,
      reason,
      'quality'
    );
    if (!restored && this.dynamicSrcPolicyController.profile !== 'quality') {
      this.scheduleDynamicSrcRestoreEvaluation();
    }
  }

  private createDynamicSrcAutoSettingsHost(): DynamicSrcAutoSettingsHost {
    return {
      policyController: this.dynamicSrcPolicyController,
      learningController: this.dynamicSrcLearningController,
      getDynamicSrcSettingsListenerCleanup: () => this.dynamicSrcSettingsListenerCleanup,
      setDynamicSrcSettingsListenerCleanup: (cleanup) => {
        this.dynamicSrcSettingsListenerCleanup = cleanup;
      },
      getDynamicSrcSettingsListenerInitPromise: () => this.dynamicSrcSettingsListenerInitPromise,
      setDynamicSrcSettingsListenerInitPromise: (promise) => {
        this.dynamicSrcSettingsListenerInitPromise = promise;
      },
      getDynamicSrcStressScore: () => this.getDynamicSrcStressScore(),
      evaluateDynamicSrcAutoDegradation: (options) =>
        this.evaluateDynamicSrcAutoDegradation(options),
      emitRobustnessSnapshot: (force) => this.emitRobustnessSnapshot(force),
      scheduleDynamicSrcRestoreEvaluation: () => this.scheduleDynamicSrcRestoreEvaluation(),
    };
  }

  private async restoreDynamicSrcAutoSettingsFromStorage(): Promise<void> {
    return restoreDynamicSrcAutoSettingsFromStorageImpl(this.createDynamicSrcAutoSettingsHost());
  }

  private readTuningAutoSettings(): AudioTuningAutoSettings {
    return resolveStoredTuningAutoSettings({
      raw: readString(STORAGE_KEYS.NATIVE_AUDIO_TUNING_AUTO_SETTINGS),
      defaults: this.tuningAutoSettings,
    });
  }

  private applyTuningAutoSettingsState(settings: AudioTuningAutoSettings): void {
    this.tuningAutoController.applySettings(settings);
  }

  private async tickTuningAutoController(): Promise<void> {
    const nowMs = Date.now();
    const snapshot = this.buildRobustnessSnapshot(nowMs);
    const decision = this.tuningAutoController.evaluateTick({
      nowMs,
      snapshot,
    });
    if (!decision) return;
    if (!decision.changed) return;

    if (!this.tuningAutoController.beginApply()) return;
    try {
      await this.applyTuningProfile(decision.nextProfile);
      this.tuningAutoController.markAutoApplied(decision.reason, Date.now());
    } catch (error) {
      this.telemetry.warn('audio.tuning-profile.auto-apply.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          nextProfile: decision.nextProfile,
          reason: decision.reason,
        },
      });
    } finally {
      this.tuningAutoController.finishApply();
      this.emitRobustnessSnapshot(true);
    }
  }

  getAudioTuningAutoSettings(): AudioTuningAutoSettings {
    return this.tuningAutoSettings;
  }

  async setAudioTuningAutoSettings(settingsPatch: AudioTuningAutoSettingsPatch): Promise<void> {
    const current = this.getAudioTuningAutoSettings();
    const nextSettings = resolveNativeAudioTuningAutoSettingsPatch({
      patch: settingsPatch,
      current,
    });

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

    if (
      policy.stabilityProfile === 'low-latency' ||
      policy.stabilityProfile === 'balanced' ||
      policy.stabilityProfile === 'stable' ||
      policy.stabilityProfile === 'game-safe' ||
      policy.stabilityProfile === 'safe-mode'
    ) {
      this.stabilityProfile = policy.stabilityProfile;
    }

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

    if (
      !this.dynamicSrcPolicyController.enabled ||
      this.dynamicSrcPolicyController.manualLockActive
    ) {
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
    if (
      patch.stabilityProfile === 'low-latency' ||
      patch.stabilityProfile === 'balanced' ||
      patch.stabilityProfile === 'stable' ||
      patch.stabilityProfile === 'game-safe' ||
      patch.stabilityProfile === 'safe-mode'
    ) {
      normalized.stabilityProfile = patch.stabilityProfile;
    }
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
      this.dynamicSrcPolicyController.lockManualQualityPolicy(requestedSrcPolicy);
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
    return this.dynamicSrcPolicyController.getSettings();
  }

  async setDynamicSrcAutoSettings(settings: AudioDynamicSrcAutoSettingsPatch): Promise<void> {
    const nextSettings = resolveNativeAudioDynamicSrcSettingsPatch({
      patch: settings,
      current: this.getDynamicSrcAutoSettings(),
    });

    if (!nextSettings.enabled && this.dynamicSrcPolicyController.profile === 'latency') {
      await this.applySrcPolicyIfNeeded(this.dynamicSrcQualityPolicy, 'dynamic-src-disabled', 'quality');
    }

    await broadcastDataUpdate(
      STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS,
      nextSettings,
      TAURI_EVENTS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS_UPDATED
    );

    this.dynamicSrcPolicyController.applySettings(nextSettings);
    if (!nextSettings.learningEnabled) {
      this.dynamicSrcLearningController.clearPersistTimer();
    }

    if (!nextSettings.enabled) {
      this.dynamicSrcPolicyController.disableAuto();
      this.evaluateDynamicSrcAutoDegradation({ triggerActions: false });
      this.emitRobustnessSnapshot();
      return;
    }

    this.captureCurrentQualitySrcPolicy();
    this.dynamicSrcPolicyController.enableAuto({
      currentQualityPolicy: this.dynamicSrcQualityPolicy,
      stressScore: this.getDynamicSrcStressScore(),
    });
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

    this.tuningAutoController.markManualApplied(profileId, nowMs);

    this.emitRobustnessSnapshot();
  }

  private getAutoBackendChain(): string[] {
    return this.outputBackendController.resolveAutoBackendChain();
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
    const decision = this.outputBackendController.evaluateAutoSwitch({
      reason,
      nowMs,
      lastUnderrunFrames: this.lastUnderrunFrames,
      underrunSpikeTimestampsMs: this.underrunSpikeTimestampsMs,
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
    const nowMs = Date.now();
    if (
      !this.outputBackendController.canTryAutoSwitch({
        nowMs,
        pinned: this.hasPinnedOutputBackendChoice(),
      })
    ) {
      return;
    }

    if (!this.outputBackendController.beginSwitch()) return;

    try {
      await this.refreshOutputBackendInventory();

      const chain = this.getAutoBackendChain();
      if (chain.length <= 1) return;

      const current = this.currentOutputBackendId;
      if (!this.isSharedOutputBackend(current)) return;
      const targetBackend = this.outputBackendController.resolveNextAutoBackend();
      if (!targetBackend) return;
      if (targetBackend === current) return;

      const switched = await this.selectOutputBackendInternal(targetBackend, {
        persist: true,
      });
      if (!switched) {
        this.handleOutputBackendSwitchFailure(reason);
        return;
      }

      this.outputBackendController.markAutoSwitch(reason, Date.now());
      this.emitRobustnessSnapshot(true);
    } finally {
      this.outputBackendController.finishSwitch();
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
    this.dynamicSrcPolicyController.holdUntil = 0;
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
      stabilityActionProfile: this.stabilityActionProfile,
      sourcePrepareProfile: this.sourcePrepareProfile,
      stabilityPrimaryReason: this.stabilityPrimaryReason,
      stabilityReasonCodes: this.stabilityReasonCodes,
      stabilityHintProfile: this.stabilityHintProfile,
      stabilityHintPrimaryReason: this.stabilityHintPrimaryReason,
      stabilityHintReasonCodes: this.stabilityHintReasonCodes,
      estimatedAudioBufferBytes: this.estimatedAudioBufferBytes,
      renderQueuePageLockFailureCount: this.renderQueuePageLockFailureCount,
      renderQueuePageLockAttemptedBytes: this.renderQueuePageLockAttemptedBytes,
      renderQueuePageLockSucceededBytes: this.renderQueuePageLockSucceededBytes,
      renderQueuePageLockFailedBytes: this.renderQueuePageLockFailedBytes,
      memoryPoolF32GrowthEvents: this.memoryPoolF32GrowthEvents,
      memoryPoolF32GrowthBytes: this.memoryPoolF32GrowthBytes,
      memoryPoolF32PrewarmHits: this.memoryPoolF32PrewarmHits,
      realtimeMemoryLockAttemptedBytes: this.realtimeMemoryLockAttemptedBytes,
      realtimeMemoryLockSucceededBytes: this.realtimeMemoryLockSucceededBytes,
      realtimeMemoryLockFailedBytes: this.realtimeMemoryLockFailedBytes,
      realtimeMemoryLockSkippedBytes: this.realtimeMemoryLockSkippedBytes,
      realtimeMemoryLockFailureCount: this.realtimeMemoryLockFailureCount,
      realtimeMemoryLockSkippedCount: this.realtimeMemoryLockSkippedCount,
      realtimeMemoryLockedRoleMask: this.realtimeMemoryLockedRoleMask,
      realtimeMemoryFailedRoleMask: this.realtimeMemoryFailedRoleMask,
      realtimeMemorySkippedRoleMask: this.realtimeMemorySkippedRoleMask,
      realtimeMemoryPressureEvents: this.realtimeMemoryPressureEvents,
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

  private recordNativeStabilityHintBestEffort(
    reason:
      | 'source-prepare-warmup'
      | 'platform-cache-materializing'
      | 'foreground-heavy-app-start',
    options?: {
      holdMs?: number;
      minimumProfile?: 'normal' | 'guarded' | 'critical';
      event?: string;
    }
  ): void {
    if (!isTauriRuntime()) return;

    const payload: Record<string, unknown> = { reason };
    if (
      options?.minimumProfile === 'normal' ||
      options?.minimumProfile === 'guarded' ||
      options?.minimumProfile === 'critical'
    ) {
      payload.minimumProfile = options.minimumProfile;
    }
    if (
      typeof options?.holdMs === 'number' &&
      Number.isFinite(options.holdMs) &&
      options.holdMs > 0
    ) {
      payload.holdMs = Math.max(250, Math.floor(options.holdMs));
    }

    void invokeWithTelemetry('native_audio_record_stability_hint', payload, {
      moduleId: 'audio',
      component: 'NativeAudioService',
      event: options?.event ?? 'audio.stability.hint.native',
      failureLevel: 'warn',
    }).catch(() => {
      // Best-effort: stability hints should never block playback control flow.
    });
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

  private async replaceQueueItemPathInNative(index: number, path: string): Promise<boolean> {
    return this.queueMirror.replaceItemPath(index, path);
  }

  private canUseQueueIndexTransport(queue: Track[], index: number): boolean {
    return this.queueMirror.canUseQueueIndexTransport(queue, index);
  }

  private disposed = false;

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
    this.recordNativeStabilityHintBestEffort('foreground-heavy-app-start', {
      holdMs: durationMsRaw,
      event: 'audio.stability.hint.protection-window',
    });
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
    this.spectrumController.handlePlaybackState(playbackState);

    if (playbackState === 'playing' || playbackState === 'paused' || playbackState === 'idle') {
      this.scheduleDynamicSrcRestoreEvaluation();
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
    const preparedSource = await this.prepareSourceForNativePlayback(track);
    const resolvedTrack = this.resolveTrackForPreparedSource(preparedSource);
    const trackPath = this.resolvePreparedSourceIdentityPath(preparedSource, resolvedTrack);
    if (!trackPath) return false;

    const ensuredTrack = this.ensureTrackInQueue(resolvedTrack, trackPath);
    let stateTrack = ensuredTrack.track;
    let queue = ensuredTrack.queue;
    const index = ensuredTrack.index;
    this.applyTrackLoadingState(stateTrack, queue, index);

    const transportPath = this.resolvePreparedSourcePathForNativeTransport(preparedSource);
    const canUseQueueIndexLoad =
      queue.length === previousQueue.length &&
      !!transportPath &&
      this.isProbablyAbsolutePath(transportPath) &&
      this.canUseQueueIndexTransport(queue, index);
    const previousTrackPath =
      index >= 0 && index < previousQueue.length ? this.getTrackPath(previousQueue[index]) : null;

    let usedQueueIndexLoad = false;
    let loaded = false;
    let materializedPath: string | null = null;
    try {
      await this.applyRuntimeControlSettingsToBackend();
      await this.applyReplayGainForTrack(resolvedTrack);
      if (canUseQueueIndexLoad) {
        const pathPatched =
          this.normalizeTrackPathForCompare(previousTrackPath) ===
            this.normalizeTrackPathForCompare(transportPath) ||
          (await this.replaceQueueItemPathInNative(index, transportPath));
        if (pathPatched) {
          await this.invokeCommand('native_audio_load_queue_index', { index });
          this.queueMirror.markMutationSynced(queue, index);
          usedQueueIndexLoad = true;
          loaded = true;
        } else {
          materializedPath = await this.invokePreparedSourceLoadCommand(preparedSource);
          loaded = typeof materializedPath === 'string' && materializedPath.trim().length > 0;
        }
      } else {
        materializedPath = await this.invokePreparedSourceLoadCommand(preparedSource);
        loaded = typeof materializedPath === 'string' && materializedPath.trim().length > 0;
      }
    } catch {
      // invokeCommand already emits error; report failure to callers so they can avoid follow-up commands.
      return false;
    }

    if (!loaded) {
      return false;
    }

    if (materializedPath) {
      const previousQueueTrackPath = index >= 0 && index < queue.length ? this.getTrackPath(queue[index]) : null;
      const materializedTrack = this.applyPreparedSourceMaterializedPath(
        preparedSource,
        resolvedTrack,
        materializedPath
      );
      if (materializedTrack !== resolvedTrack) {
        stateTrack = compactTrackForState(materializedTrack);
        const queueTrack = compactTrackForQueueState(materializedTrack);
        if (index >= 0 && index < queue.length && queue[index] !== queueTrack) {
          queue = [...queue];
          queue[index] = queueTrack;
        }
        this.updateState({
          currentTrack: stateTrack,
          queue,
          currentIndex: index,
        });
        await this.syncMaterializedQueueItemPathIfNeeded(
          index,
          previousQueueTrackPath,
          materializedPath
        );
      }
    }

    if (!usedQueueIndexLoad && queue.length > previousQueue.length && !this.queueMirror.isDirty()) {
      this.queueMirror.markMutationSynced(queue, index);
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
    const preparedSource = await this.prepareSourceForNativePlayback(track);
    const resolvedTrack = this.resolveTrackForPreparedSource(preparedSource);
    const trackPath = this.resolvePreparedSourceIdentityPath(preparedSource, resolvedTrack);
    if (!trackPath) return false;

    const ensuredTrack = this.ensureTrackInQueue(resolvedTrack, trackPath);
    let stateTrack = ensuredTrack.track;
    let queue = ensuredTrack.queue;
    const index = ensuredTrack.index;
    this.applyTrackLoadingState(stateTrack, queue, index);

    const replayGainDb = this.computeReplayGainDbForTrack(resolvedTrack);

    let loaded = false;
    let materializedPath: string | null = null;
    try {
      await this.applyRuntimeControlSettingsToBackend();
      materializedPath = await this.invokePreparedSourceLoadCommand(preparedSource, {
        play: true,
        replayGainDb,
      });
      loaded = typeof materializedPath === 'string' && materializedPath.trim().length > 0;
    } catch {
      loaded = false;
    }
    if (!loaded) {
      return false;
    }

    let playedTrack = resolvedTrack;
    if (materializedPath) {
      const previousQueueTrackPath = index >= 0 && index < queue.length ? this.getTrackPath(queue[index]) : null;
      const materializedTrack = this.applyPreparedSourceMaterializedPath(
        preparedSource,
        resolvedTrack,
        materializedPath
      );
      if (materializedTrack !== resolvedTrack) {
        playedTrack = materializedTrack;
        stateTrack = compactTrackForState(materializedTrack);
        const queueTrack = compactTrackForQueueState(materializedTrack);
        if (index >= 0 && index < queue.length && queue[index] !== queueTrack) {
          queue = [...queue];
          queue[index] = queueTrack;
        }
        this.updateState({
          currentTrack: stateTrack,
          queue,
          currentIndex: index,
        });
        await this.syncMaterializedQueueItemPathIfNeeded(
          index,
          previousQueueTrackPath,
          materializedPath
        );
      }
    }

    if (queue.length > previousQueue.length && !this.queueMirror.isDirty()) {
      this.queueMirror.markMutationSynced(queue, index);
    }

    this.markTrackPlayedBestEffort(playedTrack);
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
    this.queueMirror.clearPendingIndexSync();

    this.stopFallbackTicker();
    this.fallbackClockBaseTimeSec = 0;
    this.fallbackClockStartedAtMs = null;
    this.lastBackendTimeUpdateAtMs = 0;

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

    this.dynamicSrcPolicyController.resetRuntimePolicy();
    this.sharedStressUntilMs = 0;
    this.sharedStressReason = null;
    this.sharedStressEscalationCount = 0;
    this.spectrumController.reset();
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
    this.queueMirror.syncAppended(queue, [queuedTrack]);
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
    this.queueMirror.syncAppended(queue, appendedQueueTracks);
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
    this.queueMirror.syncRemoved(previousQueue, queue, index, currentIndex);
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
      this.queueMirror.reset();
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
      const preparedSource = await this.prepareSourceForNativePlayback(originalTrack);
      const track = this.resolveTrackForPreparedSource(preparedSource);
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

      const trackPath = this.resolvePreparedSourcePathForNativeTransport(preparedSource);
      const canUseQueueIndexTransport =
        !!trackPath &&
        this.isProbablyAbsolutePath(trackPath) &&
        this.canUseQueueIndexTransport(playbackQueue, index);

      if (shouldCrossfade && trackPath && this.isProbablyAbsolutePath(trackPath)) {
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
      } else if (shouldCrossfade) {
        this.telemetry.info('audio.track.switch.crossfade.fallback', {
          fields: {
            requestedIndex: index,
            previousIndex,
            queueLength: this.state.queue.length,
            sourceKind: preparedSource.kind,
            ...buildTrackTelemetryFields(track),
          },
        });
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
    this.queueMirror.syncMoved(previousQueue, queue, fromIndex, toIndex, currentIndex);
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
    return this.playlistShell.createPlaylist(name, description, options);
  }

  deletePlaylist(playlistId: string): void {
    this.playlistShell.deletePlaylist(playlistId);
  }

  renamePlaylist(playlistId: string, newName: string): void {
    this.playlistShell.renamePlaylist(playlistId, newName);
  }

  getPlaylists(): Playlist[] {
    return this.playlistShell.getPlaylists();
  }

  getPlaylist(playlistId: string): Playlist | null {
    return this.playlistShell.getPlaylist(playlistId);
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
    return this.playlistShell.queryPlaylistTracksPage(playlistId, options);
  }

  async hydratePlaylistTracks(playlistId: string): Promise<Playlist | null> {
    return this.playlistShell.hydratePlaylistTracks(playlistId);
  }

  releasePlaylistTracks(playlistId?: string): void {
    this.playlistShell.releasePlaylistTracks(playlistId);
  }

  addTrackToPlaylist(playlistId: string, track: Track): void {
    this.playlistShell.addTrackToPlaylist(playlistId, track);
  }

  removeTrackFromPlaylist(playlistId: string, trackIndex: number): void {
    this.playlistShell.removeTrackFromPlaylist(playlistId, trackIndex);
  }

  clearPlaylist(playlistId: string): void {
    this.playlistShell.clearPlaylist(playlistId);
  }

  async playPlaylist(playlistId: string): Promise<void> {
    const resolved = await this.playlistShell.resolvePlaylistTracksForQueue(playlistId);
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
    this.playlistShell.setCurrentPlaylist(this.getPlaylist(playlistId) ?? playlist);
    this.playlistShell.touchPlaylistOpened(playlistId);
  }

  async playPlaylistTrackAtIndex(playlistId: string, trackIndex: number): Promise<void> {
    const resolved = await this.playlistShell.resolvePlaylistTracksForQueue(playlistId);
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
    this.playlistShell.setCurrentPlaylist(this.getPlaylist(playlistId) ?? playlist);
    this.playlistShell.touchPlaylistOpened(playlistId);
  }

  async addPlaylistToQueue(playlistId: string): Promise<void> {
    const resolved = await this.playlistShell.resolvePlaylistTracksForQueue(playlistId);
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
    const resolved = await this.playlistShell.resolvePlaylistTrackSelectionForQueue(
      playlistId,
      trackIndexes
    );
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
    this.spectrumController.touch(this.state.playbackState);
  }

  private async setNativeSpectrumEnabled(enabled: boolean): Promise<void> {
    await invokeWithTelemetry('native_audio_set_spectrum_enabled', { enabled }, {
      moduleId: 'audio',
      component: 'NativeAudioService',
      event: 'audio.spectrum.set-enabled',
    });
  }

  private clearSpectrumData(): void {
    this.spectrumData = null;
    this.spectrumFrames = {};
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
    this.queueMirror.reset();
    this.diagnosticTimelineIgnoreBeforeMs = 0;

    this.stop();
    this.recentSmartPlaylistWriter.dispose({ flush: true });
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
    this.dynamicSrcPolicyController.dispose();
    this.dynamicSrcLearningController.dispose();
    this.protectionWindowUntilMs = 0;
    this.protectionWindowRefCount = 0;
    this.protectionWindowReason = null;
    this.dynamicSrcSettingsListenerCleanup?.();
    this.dynamicSrcSettingsListenerCleanup = null;
    this.dynamicSrcSettingsListenerInitPromise = null;
    this.tuningAutoSettingsListenerCleanup?.();
    this.tuningAutoSettingsListenerCleanup = null;
    this.tuningAutoSettingsListenerInitPromise = null;
    this.playbackPreferencesListenerCleanup?.();
    this.playbackPreferencesListenerCleanup = null;
    this.playbackPreferencesListenerInitPromise = null;
    this.tuningAutoController.dispose();
    this.timeUpdateCallbacks.clear();
    this.endedCallbacks.clear();
    this.stateChangeCallbacks.clear();
    this.loadProgressCallbacks.clear();
    this.errorCallbacks.clear();
    this.robustnessController.destroy();
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
    this.spectrumController.destroy();
  }
}
