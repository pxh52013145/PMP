import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  AudioProtectionWindowOptions,
  AudioRobustnessSnapshot,
  AudioState,
  IAudioService,
  PlayMode,
  Playlist,
  Track,
  PlaybackState,
} from './types';
import { broadcastDataUpdate, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
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
  underrunEvents?: number;
  underrunFrames?: number;
  schedulerProfile?: 'normal' | 'guarded' | 'critical';
  transportMode?: 'robust' | 'transport-exact';
  hqSrcPhaseMode?: 'linear' | 'minimum' | 'intermediate';
  hqSrcStopbandDb?: number;
  transportExactInt32Container?: boolean;
  outputCallbackMetricsValid?: boolean;
  outputCallbackP99Us?: number;
  outputWaitTimeoutCount?: number;
  outputRenderUnderrunEvents?: number;
  outputRenderUnderrunFrames?: number;
  transferLowWatermarkSamples?: number;
  transferRenderLowHitCount?: number;
  transferDecodeLowHitCount?: number;
  renderQueuePageLocked?: boolean;
  queue?: string[];
  currentIndex?: number;
  ended?: boolean;
};

type NativeAudioEnginePolicyPayload = {
  transportMode?: 'robust' | 'transport-exact';
  hqSrcEnabled?: boolean;
  hqSrcPhaseMode?: 'linear' | 'minimum' | 'intermediate';
  hqSrcStopbandDb?: number;
  transportExactInt32Container?: boolean;
};

type NativeAudioEnginePolicyPatch = {
  transportMode?: 'robust' | 'transport-exact';
  hqSrcEnabled?: boolean;
  hqSrcPhaseMode?: 'linear' | 'minimum' | 'intermediate';
};

type NativeAudioSpectrumPayload = {
  bins: number[];
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
};

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
  private spectrumData: Uint8Array | null = null;
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
  private lastSchedulerProfile: 'normal' | 'guarded' | 'critical' = 'normal';
  private transportMode: 'robust' | 'transport-exact' = 'robust';
  private hqSrcPhaseMode: 'linear' | 'minimum' | 'intermediate' = 'linear';
  private hqSrcStopbandDb: number = 140;
  private transportExactInt32Container = true;
  private outputCallbackMetricsValid = false;
  private outputCallbackP99Us = 0;
  private outputWaitTimeoutCount = 0;
  private outputRenderUnderrunEvents = 0;
  private outputRenderUnderrunFrames = 0;
  private transferLowWatermarkSamples = 0;
  private transferRenderLowHitCount = 0;
  private transferDecodeLowHitCount = 0;
  private renderQueuePageLocked = false;

  private static readonly SEEK_COALESCE_MS = 60;
  private static readonly UNDERRUN_RECOVERY_WINDOW_MS = 20_000;
  private static readonly AUTO_BACKEND_UNDERRUN_WINDOW_MS = 15_000;
  private static readonly AUTO_BACKEND_UNDERRUN_TRIGGER_COUNT = 3;
  private static readonly AUTO_BACKEND_UNDERRUN_FRAME_SPIKE_TRIGGER = 1024;
  private static readonly AUTO_BACKEND_SWITCH_COOLDOWN_MS = 45_000;
  private static readonly PROTECTION_WINDOW_DEFAULT_MS = 20_000;
  private static readonly PROTECTION_WINDOW_MAX_MS = 120_000;
  private static readonly ROBUSTNESS_BUFFER_WINDOW_SIZE = 48;

  private fireAndForgetCommand(cmd: string, payload?: Record<string, unknown>): void {
    void this.invokeCommand(cmd, payload).catch(() => {});
  }

  private clearPendingSeek(): void {
    this.pendingSeekTime = null;
    if (this.pendingSeekTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.pendingSeekTimer);
    }
    this.pendingSeekTimer = null;
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
      if (!raw) return { startOrSeekSeconds: null, crossfadeSeconds: null };
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return { startOrSeekSeconds: null, crossfadeSeconds: null };
      const record = parsed as Record<string, unknown>;

      const startRaw = record.startOrSeekSeconds;
      const crossfadeRaw = record.crossfadeSeconds;

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

      return { startOrSeekSeconds: start, crossfadeSeconds: crossfade };
    } catch {
      return { startOrSeekSeconds: null, crossfadeSeconds: null };
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
    } catch {
      // best-effort
    }
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

    if (typeof policy.hqSrcStopbandDb === 'number' && Number.isFinite(policy.hqSrcStopbandDb)) {
      this.hqSrcStopbandDb = Math.max(0, Math.min(200, Math.floor(policy.hqSrcStopbandDb)));
    }

    if (typeof policy.transportExactInt32Container === 'boolean') {
      this.transportExactInt32Container = policy.transportExactInt32Container;
    }
  }

  async setEnginePolicy(patch: NativeAudioEnginePolicyPatch): Promise<void> {
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

    const response = await invoke<unknown>('native_audio_set_engine_policy', normalized);
    this.applyEnginePolicyPayload(response);
    this.emitRobustnessSnapshot(true);
  }

  private getAutoBackendChain(): string[] {
    const backends = [...this.availableOutputBackends];
    if (this.currentOutputBackendId && !backends.includes(this.currentOutputBackendId)) {
      backends.unshift(this.currentOutputBackendId);
    }

    const unique = Array.from(new Set(backends.filter((value) => value.length > 0)));
    if (unique.length <= 1) return unique;

    const platform =
      typeof navigator !== 'undefined'
        ? `${(navigator as Navigator & { platform?: string }).platform ?? ''} ${navigator.userAgent ?? ''}`
        : '';
    const isWindows = /win/i.test(platform);
    if (!isWindows) return unique;

    const preferredOrder = ['wasapi-exclusive', 'wasapi', 'rodio-cpal'];
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

  private maybeAutoSwitchOutputBackend(reason: string, options?: { force?: boolean }): void {
    const nowMs = Date.now();
    if (!options?.force && !this.shouldAutoSwitchNow(reason, nowMs)) {
      return;
    }

    void this.tryAutoSwitchOutputBackend(reason);
  }

  private async tryAutoSwitchOutputBackend(reason: string): Promise<void> {
    if (this.backendSwitchInFlight) return;

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
      const currentIndex = current ? chain.indexOf(current) : -1;
      const targetBackend =
        currentIndex >= 0 ? chain[(currentIndex + 1) % chain.length] ?? null : chain[0] ?? null;
      if (!targetBackend) return;
      if (targetBackend === current) return;

      const switched = await this.selectOutputBackendInternal(targetBackend, {
        persist: true,
        clearDevice: true,
      });
      if (!switched) return;

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
      const payload = await invoke<unknown>('native_audio_select_output_backend', {
        backendId,
      });
      const parsed = this.parseComponentsStatePayload(payload);
      const resolvedBackendId = this.sanitizeBackendId(parsed.outputBackendId) ?? backendId;
      this.currentOutputBackendId = resolvedBackendId;

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
    };
  }

  private buildRecoveryStreamingBufferSettings(base: StreamingBufferSettings): StreamingBufferSettings {
    const background = this.buildBackgroundStreamingBufferSettings(base);
    return {
      startOrSeekSeconds: Math.min(4, Math.max(background.startOrSeekSeconds ?? 2.4, 3.2)),
      crossfadeSeconds: Math.min(3, Math.max(background.crossfadeSeconds ?? 1.0, 1.4)),
    };
  }

  private buildProtectionStreamingBufferSettings(base: StreamingBufferSettings): StreamingBufferSettings {
    const recovery = this.buildRecoveryStreamingBufferSettings(base);
    return {
      startOrSeekSeconds: Math.min(4, Math.max(recovery.startOrSeekSeconds ?? 3.2, 3.8)),
      crossfadeSeconds: Math.min(3, Math.max(recovery.crossfadeSeconds ?? 1.4, 1.8)),
    };
  }

  private hasActiveProtectionWindow(nowMs: number = Date.now()): boolean {
    if (this.protectionWindowRefCount > 0) return true;
    return this.protectionWindowUntilMs > nowMs;
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

    return this.normalizeStreamingBufferSettings(target);
  }

  private isSameStreamingBufferSettings(
    left: StreamingBufferSettings | null,
    right: StreamingBufferSettings | null
  ): boolean {
    if (!left || !right) return false;
    return (
      left.startOrSeekSeconds === right.startOrSeekSeconds &&
      left.crossfadeSeconds === right.crossfadeSeconds
    );
  }

  private applyStreamingBufferPolicy(force: boolean = false): void {
    const nowMs = Date.now();

    if (this.protectionWindowRefCount === 0 && this.protectionWindowUntilMs > 0 && nowMs >= this.protectionWindowUntilMs) {
      this.protectionWindowUntilMs = 0;
      this.protectionWindowReason = null;
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
    this.maybeAutoSwitchOutputBackend('underrun-spike');
  }

  private maybeReleaseUnderrunRecovery(playbackState: PlaybackState): void {
    if (this.underrunRecoveryUntilMs <= 0) return;
    const nowMs = Date.now();
    if (nowMs < this.underrunRecoveryUntilMs) return;
    if (playbackState === 'buffering') return;

    this.underrunRecoveryUntilMs = 0;
    this.applyStreamingBufferPolicy(true);
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
      hqSrcStopbandDb: this.hqSrcStopbandDb,
      transportExactInt32Container: this.transportExactInt32Container,
      outputCallbackMetricsValid: this.outputCallbackMetricsValid,
      underrunEvents: this.lastUnderrunEvents,
      underrunFrames: this.lastUnderrunFrames,
      underrunEventsWindow: this.underrunSpikeTimestampsMs.length,
      underrunRecoveryActive: recoveryActive,
      protectionWindowActive: protectionActive,
      protectionRefCount: this.protectionWindowRefCount,
      protectionReason: protectionActive ? this.protectionWindowReason : null,
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
      transferLowWatermarkSamples: this.transferLowWatermarkSamples,
      transferRenderLowHitCount: this.transferRenderLowHitCount,
      transferDecodeLowHitCount: this.transferDecodeLowHitCount,
      renderQueuePageLocked: this.renderQueuePageLocked,
    };
  }

  private emitRobustnessSnapshot(force: boolean = false): void {
    if (this.robustnessCallbacks.size === 0) return;
    const snapshot = this.buildRobustnessSnapshot();
    const signature = JSON.stringify(snapshot);
    if (!force && signature === this.lastEmittedRobustnessSignature) {
      return;
    }
    this.lastEmittedRobustnessSignature = signature;
    this.robustnessCallbacks.forEach((callback) => callback(snapshot));
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
      this.maybeAutoSwitchOutputBackend(`output-error:${code}`);
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

        const update: Partial<AudioState> = {};
        if (typeof next.playbackState !== 'undefined') update.playbackState = next.playbackState;
        if (typeof next.volume !== 'undefined') update.volume = next.volume;
        if (typeof next.muted !== 'undefined') update.muted = next.muted;
        if (typeof next.currentTime !== 'undefined') update.currentTime = next.currentTime;
        if (typeof next.duration !== 'undefined') update.duration = next.duration;
        if (typeof next.bufferedTime !== 'undefined') update.bufferedTime = next.bufferedTime;
        if (typeof next.bufferedAhead !== 'undefined') update.bufferedAhead = next.bufferedAhead;

        if (typeof next.underrunEvents === 'number' && Number.isFinite(next.underrunEvents)) {
          if (next.underrunEvents > this.lastUnderrunEvents) {
            this.handleUnderrunSpike(next.underrunEvents, next.underrunFrames);
          } else {
            this.lastUnderrunEvents = Math.max(this.lastUnderrunEvents, Math.floor(next.underrunEvents));
          }
        }

        if (typeof next.underrunFrames === 'number' && Number.isFinite(next.underrunFrames)) {
          this.lastUnderrunFrames = Math.max(this.lastUnderrunFrames, Math.floor(next.underrunFrames));
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

        if (typeof next.hqSrcStopbandDb === 'number' && Number.isFinite(next.hqSrcStopbandDb)) {
          this.hqSrcStopbandDb = Math.max(0, Math.min(200, Math.floor(next.hqSrcStopbandDb)));
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
          typeof next.transferLowWatermarkSamples === 'number' &&
          Number.isFinite(next.transferLowWatermarkSamples)
        ) {
          this.transferLowWatermarkSamples = Math.max(0, Math.floor(next.transferLowWatermarkSamples));
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
        if (typeof next.currentTime !== 'undefined') {
          this.lastBackendTimeUpdateAtMs = performance.now();
          if (merged.playbackState === 'playing') {
            this.fallbackClockBaseTimeSec = Number(next.currentTime) || 0;
            this.fallbackClockStartedAtMs = this.lastBackendTimeUpdateAtMs;
            this.ensureFallbackTicker();
          } else {
            this.fallbackClockBaseTimeSec = Number(next.currentTime) || 0;
            this.fallbackClockStartedAtMs = null;
          }
          this.timeUpdateCallbacks.forEach((cb) => cb(next.currentTime as number));
        }
        if (next.ended) {
          this.endedCallbacks.forEach((cb) => cb());
          void this.handleTrackEnded();
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
    void playbackState;
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

  // ===== 播放控制 =====
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
    this.pendingSeekTime = clamped;
    this.scheduleSeekFlush();
    const nextState = this.updateState({ currentTime: clamped });
    this.fallbackClockBaseTimeSec = clamped;
    this.fallbackClockStartedAtMs = nextState.playbackState === 'playing' ? performance.now() : null;
    if (nextState.playbackState === 'playing') {
      this.ensureFallbackTicker();
    }
    this.timeUpdateCallbacks.forEach((cb) => cb(clamped));
  }

  // ===== 音量控制 =====
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

  // ===== 状态查询 =====
  getCurrentTime(): number {
    return this.state.currentTime;
  }

  getDuration(): number {
    return this.state.duration;
  }

  getState(): AudioState {
    return this.state;
  }

  // ===== 事件监听 =====
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

  // ===== 播放队列 =====
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

  // ===== 播放模式 =====
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

  // ===== 播放列表管理 =====
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

  // ===== 音频可视化 (placeholder) =====
  getFrequencyData(): Uint8Array | null {
    return this.spectrumData;
  }

  // ===== 清理 =====
  destroy(): void {
    this.stop();
    this.stopFallbackTicker();
    this.clearProtectionWindowTimer();
    this.protectionWindowUntilMs = 0;
    this.protectionWindowRefCount = 0;
    this.protectionWindowReason = null;
    this.timeUpdateCallbacks.clear();
    this.endedCallbacks.clear();
    this.stateChangeCallbacks.clear();
    this.loadProgressCallbacks.clear();
    this.errorCallbacks.clear();
    this.robustnessCallbacks.clear();
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
  }
}
