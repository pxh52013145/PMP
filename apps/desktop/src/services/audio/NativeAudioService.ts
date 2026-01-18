import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { AudioState, IAudioService, PlayMode, Playlist, Track, PlaybackState } from './types';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { readString } from '../../modules/storage';

type StateListener = (state: AudioState) => void;

type NativeAudioStatePayload = {
  playbackState?: PlaybackState;
  volume?: number;
  muted?: boolean;
  trackPath?: string | null;
  currentTime?: number;
  duration?: number;
  sampleRate?: number;
  queue?: string[];
  currentIndex?: number;
  ended?: boolean;
};

type NativeAudioSpectrumPayload = {
  bins: number[];
};

type NativeAudioErrorPayload = {
  seq?: number;
  code?: string;
  message?: string;
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
  private stateListener?: UnlistenFn;
  private spectrumListener?: UnlistenFn;
  private errorListener?: UnlistenFn;
  private spectrumData: Uint8Array | null = null;
  private restoredOutputBackend = false;
  private restoredOutputDevice = false;
  private restoredInputId = false;
  private restoredVstEnabled = false;
  private restoredDspGraph = false;
  private restoredDspChain = false;
  private restoredDspChainApplied = false;
  private restoredGainDb = false;
  private lastNativeErrorSeq = 0;
  private fallbackTicker: number | null = null;
  private fallbackClockStartedAtMs: number | null = null;
  private fallbackClockBaseTimeSec: number = 0;
  private lastBackendTimeUpdateAtMs: number = 0;
  private pendingSeekTime: number | null = null;
  private pendingSeekTimer: number | null = null;
  private desiredPlayIndex: number | null = null;
  private playIndexQueue: Promise<void> = Promise.resolve();

  private static readonly SEEK_COALESCE_MS = 60;

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

  private scheduleSeekFlush(): void {
    if (this.pendingSeekTimer !== null) return;
    const scheduled =
      typeof window !== 'undefined'
        ? window.setTimeout(() => {
            this.pendingSeekTimer = null;
            const target = this.pendingSeekTime;
            this.pendingSeekTime = null;
            if (typeof target === 'number' && isFinite(target)) {
              this.fireAndForgetCommand('native_audio_seek', { time: target });
            }
          }, NativeAudioService.SEEK_COALESCE_MS)
        : null;

    // Non-browser (tests) fallback: flush immediately.
    if (scheduled === null) {
      const target = this.pendingSeekTime;
      this.pendingSeekTime = null;
      if (typeof target === 'number' && isFinite(target)) {
        this.fireAndForgetCommand('native_audio_seek', { time: target });
      }
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
      volume: 0.7,
      muted: false,
      playMode: 'sequence',
      queue: [],
      currentIndex: -1,
      playlists: [],
      currentPlaylist: null,
    };

    this.setupNativeListeners();
    void this.restoreFromStorage().catch(() => {});
  }

  private async restoreFromStorage(): Promise<void> {
    await this.restoreOutputBackendFromStorage();
    await this.restoreOutputDeviceFromStorage();
    await this.restoreAudioInputFromStorage();
    await this.restoreVstEnabledFromStorage();

    const restoredGraph = await this.restoreDspGraphFromBackend();
    if (!restoredGraph) {
      await this.restoreDspChainFromStorage();
    }

    await this.restoreGainDbFromStorage();
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

  // ===== Helpers =====
  private updateState(partial: Partial<AudioState>) {
    this.state = { ...this.state, ...partial };
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
    const previousQueue = this.state.queue;
    return queuePaths.map((trackPath) => {
      const resolved = this.resolveTrackFromPath(trackPath);
      if (resolved) return resolved.track;

      const existing = previousQueue.find((track) => this.getTrackPath(track) === trackPath);
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

  private emitError(error: Error) {
    this.updateState({ playbackState: 'error' });
    this.errorCallbacks.forEach((cb) => cb(error));
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

        if (Array.isArray(next.queue)) {
          update.queue = this.resolveQueueFromPaths(next.queue);
        }
        if (typeof next.currentIndex === 'number') {
          update.currentIndex = next.currentIndex;
        }

        if (typeof next.trackPath !== 'undefined' && next.trackPath) {
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
        }

        const merged = this.updateState(update);
        if (typeof next.playbackState !== 'undefined') {
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
      });

      this.spectrumListener = await listen('native_audio_spectrum', (event) => {
        const payload = event.payload as NativeAudioSpectrumPayload;
        if (!payload?.bins || !Array.isArray(payload.bins)) return;
        const bins = payload.bins;
        const next = new Uint8Array(bins.length);
        for (let i = 0; i < bins.length; i++) {
          const value = typeof bins[i] === 'number' ? bins[i] : 0;
          const clamped = Math.max(0, Math.min(1, value));
          next[i] = Math.round(clamped * 255);
        }
        this.spectrumData = next;
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
      const backendId = typeof parsed === 'string' ? parsed : null;
      if (!backendId) return;

      return invoke('native_audio_select_output_backend', { backendId })
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
      const deviceName = typeof parsed === 'string' ? parsed : null;
      if (!deviceName) return;
      return invoke('native_audio_select_device', { deviceName })
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
  async loadTrack(track: Track): Promise<void> {
    try {
      this.clearPendingSeek();
      if (!track) return;

      const trackPath = this.getTrackPath(track);
      if (!trackPath || !this.isProbablyAbsolutePath(trackPath)) {
        const error = new Error(
          'Native audio requires an absolute file path. This track has no filePath (likely added via File System Access API).'
        ) as Error & { code?: string };
        error.code = !trackPath ? 'NATIVE_TRACK_PATH_MISSING' : 'NATIVE_TRACK_PATH_NOT_ABSOLUTE';
        this.emitError(error);
        return;
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
      });
      this.timeUpdateCallbacks.forEach((cb) => cb(nextState.currentTime));

      this.syncQueueToNative(queue, index);

      await this.applyReplayGainForTrack(track);
      await this.invokeCommand('native_audio_load', { path: trackPath });

      this.updateState({
        playbackState: 'paused',
        currentTime: 0,
      });
    } catch {
      // invokeCommand already emits error; swallow to avoid unhandled rejections in UI call sites.
    }
  }

  async play(): Promise<void> {
    try {
      if (!this.state.currentTrack && this.state.queue.length === 0) {
        return;
      }
      await this.invokeCommand('native_audio_play');
      const nextState = this.updateState({ playbackState: 'playing' });
      this.fallbackClockBaseTimeSec = nextState.currentTime;
      this.fallbackClockStartedAtMs = performance.now();
      this.ensureFallbackTicker();
      this.applyPlaybackStateSideEffects(nextState.playbackState);
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
        });
        this.timeUpdateCallbacks.forEach((cb) => cb(nextState.currentTime));

        await this.applyReplayGainForTrack(track);
        await this.invokeCommand('native_audio_crossfade_to', {
          path: trackPath,
          durationMs: crossfade.durationMs,
        });

        const playingState = this.updateState({ playbackState: 'playing', currentTime: 0 });
        this.fallbackClockBaseTimeSec = playingState.currentTime;
        this.fallbackClockStartedAtMs = performance.now();
        this.ensureFallbackTicker();
        this.applyPlaybackStateSideEffects(playingState.playbackState);
        return;
      }

      await this.loadTrack(track);
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
    return this.spectrumData ? new Uint8Array(this.spectrumData) : null;
  }

  // ===== 清理 =====
  destroy(): void {
    this.stop();
    this.stopFallbackTicker();
    this.timeUpdateCallbacks.clear();
    this.endedCallbacks.clear();
    this.stateChangeCallbacks.clear();
    this.loadProgressCallbacks.clear();
    this.errorCallbacks.clear();
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
