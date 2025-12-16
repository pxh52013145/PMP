import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { AudioState, IAudioService, PlayMode, Playlist, Track, PlaybackState } from './types';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

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
  private spectrumData: Uint8Array | null = null;
  private restoredOutputDevice = false;
  private restoredGainDb = false;

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
    this.restoreOutputDeviceFromStorage();
    this.restoreGainDbFromStorage();
  }

  // ===== Helpers =====
  private updateState(partial: Partial<AudioState>) {
    this.state = { ...this.state, ...partial };
    this.stateChangeCallbacks.forEach((cb) => cb(this.state));
    return this.state;
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
    } catch (error) {
      console.warn('[NativeAudio] Failed to register state listener:', error);
    }
  }

  private restoreOutputDeviceFromStorage() {
    if (this.restoredOutputDevice) return;
    this.restoredOutputDevice = true;

    try {
      const raw = localStorage.getItem(STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_DEVICE);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      const deviceName = typeof parsed === 'string' ? parsed : null;
      if (!deviceName) return;
      void invoke('native_audio_select_device', { deviceName }).catch(() => {});
    } catch {
      // ignore
    }
  }

  private restoreGainDbFromStorage() {
    if (this.restoredGainDb) return;
    this.restoredGainDb = true;

    try {
      const raw = localStorage.getItem(STORAGE_KEYS.NATIVE_AUDIO_GAIN_DB);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      const db = typeof parsed === 'number' ? parsed : null;
      if (db === null) return;
      void invoke('native_audio_set_gain', { db }).catch(() => {});
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
        this.seek(0);
        await this.play();
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
    if (!track) return;

    const trackPath = this.getTrackPath(track);
    if (!trackPath) {
      this.emitError(new Error('Track path is missing'));
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

    await this.invokeCommand('native_audio_load', { path: trackPath });

    this.updateState({
      playbackState: 'paused',
      currentTime: 0,
    });
  }

  async play(): Promise<void> {
    if (!this.state.currentTrack && this.state.queue.length === 0) {
      return;
    }
    await this.invokeCommand('native_audio_play');
    const nextState = this.updateState({ playbackState: 'playing' });
    this.applyPlaybackStateSideEffects(nextState.playbackState);
  }

  async pause(): Promise<void> {
    await this.invokeCommand('native_audio_pause');
    const nextState = this.updateState({ playbackState: 'paused' });
    this.applyPlaybackStateSideEffects(nextState.playbackState);
  }

  stop(): void {
    void this.invokeCommand('native_audio_stop');
    this.updateState({ playbackState: 'stopped', currentTime: 0 });
    this.timeUpdateCallbacks.forEach((cb) => cb(0));
  }

  seek(time: number): void {
    const duration = this.state.duration || time;
    const clamped = Math.max(0, Math.min(time, duration));
    void this.invokeCommand('native_audio_seek', { time: clamped });
    this.updateState({ currentTime: clamped });
    this.timeUpdateCallbacks.forEach((cb) => cb(clamped));
  }

  // ===== 音量控制 =====
  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    void this.invokeCommand('native_audio_set_volume', { volume: clamped });
    this.updateState({ volume: clamped, muted: clamped === 0 ? true : this.state.muted });
  }

  getVolume(): number {
    return this.state.volume;
  }

  toggleMute(): void {
    const muted = !this.state.muted;
    void this.invokeCommand('native_audio_set_mute', { muted });
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
    this.updateState({
      queue: [],
      currentIndex: -1,
      currentTrack: null,
      playbackState: 'stopped',
      currentTime: 0,
    });
    this.syncQueueToNative([], -1);
    void this.invokeCommand('native_audio_stop');
    this.timeUpdateCallbacks.forEach((cb) => cb(0));
  }

  getQueue(): Track[] {
    return this.state.queue;
  }

  async playTrackAtIndex(index: number): Promise<void> {
    if (index < 0 || index >= this.state.queue.length) return;
    const track = this.state.queue[index];
    this.updateState({ currentIndex: index });
    this.syncQueueToNative(this.state.queue, index);
    await this.loadTrack(track);
    await this.play();
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
    if (this.state.currentIndex > 0) {
      await this.playTrackAtIndex(this.state.currentIndex - 1);
    }
  }

  async playNext(): Promise<void> {
    const { playMode, queue, currentIndex } = this.state;
    if (!queue.length) return;

    if (playMode === 'single-loop') {
      await this.playTrackAtIndex(currentIndex);
      return;
    }

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
    this.spectrumData = null;
  }
}
