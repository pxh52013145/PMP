import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { AudioState, IAudioService, PlayMode, Playlist, Track, PlaybackState } from './types';

type StateListener = (state: AudioState) => void;

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
  private progressTimer: number | null = null;
  private playbackStartTimestamp: number | null = null;

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
  }

  // ===== Helpers =====
  private updateState(partial: Partial<AudioState>) {
    this.state = { ...this.state, ...partial };
    this.stateChangeCallbacks.forEach((cb) => cb(this.state));
    return this.state;
  }

  private emitError(error: Error) {
    this.updateState({ playbackState: 'error' });
    this.errorCallbacks.forEach((cb) => cb(error));
  }

  private async setupNativeListeners() {
    try {
      this.stateListener = await listen('native_audio_state', (event) => {
        const payload = event.payload as Partial<AudioState> | { state?: Partial<AudioState> };
        const nextState =
          payload && 'state' in payload ? payload.state : (payload as Partial<AudioState>);
        if (nextState) {
          const merged = this.updateState(nextState);
          if (typeof nextState.playbackState !== 'undefined') {
            this.applyPlaybackStateSideEffects(merged.playbackState);
          }
        }
      });
    } catch (error) {
      console.warn('[NativeAudio] Failed to register state listener:', error);
    }
  }

  private getNow(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  private startProgressTimer(baseTime: number = this.state.currentTime) {
    if (typeof window === 'undefined') return;
    this.stopProgressTimer(false);
    this.playbackStartTimestamp = this.getNow() - baseTime * 1000;
    this.progressTimer = window.setInterval(() => {
      if (this.playbackStartTimestamp == null) return;
      const elapsed = (this.getNow() - this.playbackStartTimestamp) / 1000;
      const duration = this.state.duration || 0;
      const nextTime = duration > 0 ? Math.min(elapsed, duration) : elapsed;
      this.updateState({ currentTime: nextTime });
      this.timeUpdateCallbacks.forEach((cb) => cb(nextTime));
      if (duration > 0 && nextTime >= duration) {
        this.stopProgressTimer(false);
      }
    }, 250);
  }

  private stopProgressTimer(syncPosition: boolean = true) {
    if (this.progressTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.progressTimer);
    }
    this.progressTimer = null;
    if (syncPosition && this.playbackStartTimestamp != null) {
      const elapsed = (this.getNow() - this.playbackStartTimestamp) / 1000;
      const duration = this.state.duration || 0;
      const clamped = duration > 0 ? Math.min(elapsed, duration) : elapsed;
      this.updateState({ currentTime: clamped });
      this.timeUpdateCallbacks.forEach((cb) => cb(clamped));
    }
    this.playbackStartTimestamp = null;
  }

  private applyPlaybackStateSideEffects(playbackState: PlaybackState) {
    if (playbackState === 'playing') {
      this.startProgressTimer();
    } else if (playbackState === 'paused') {
      this.stopProgressTimer(true);
    } else if (
      playbackState === 'stopped' ||
      playbackState === 'idle' ||
      playbackState === 'error'
    ) {
      this.stopProgressTimer(false);
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

  // ===== 播放控制 =====
  async loadTrack(track: Track): Promise<void> {
    if (!track) return;

    this.stopProgressTimer(false);
    const nextState = this.updateState({
      currentTrack: track,
      playbackState: 'loading',
      duration: track.duration ?? 0,
      currentTime: 0,
    });
    this.timeUpdateCallbacks.forEach((cb) => cb(nextState.currentTime));

    await this.invokeCommand('native_audio_load', {
      path: track.filePath ?? track.path ?? track.originalPath,
    });

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
    this.stopProgressTimer(false);
    this.updateState({ playbackState: 'stopped', currentTime: 0 });
    this.timeUpdateCallbacks.forEach((cb) => cb(0));
  }

  seek(time: number): void {
    const duration = this.state.duration || time;
    const clamped = Math.max(0, Math.min(time, duration));
    void this.invokeCommand('native_audio_seek', { time: clamped });
    this.updateState({ currentTime: clamped });
    if (this.state.playbackState === 'playing') {
      this.startProgressTimer(clamped);
    } else {
      this.stopProgressTimer(false);
    }
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
  }

  addMultipleToQueue(tracks: Track[]): void {
    if (!tracks.length) return;
    const queue = [...this.state.queue, ...tracks];
    this.updateState({ queue });
  }

  removeFromQueue(index: number): void {
    const queue = [...this.state.queue];
    queue.splice(index, 1);
    const currentIndex =
      this.state.currentIndex >= queue.length ? queue.length - 1 : this.state.currentIndex;
    this.updateState({ queue, currentIndex });
  }

  clearQueue(): void {
    this.stopProgressTimer(false);
    this.updateState({
      queue: [],
      currentIndex: -1,
      currentTrack: null,
      playbackState: 'stopped',
      currentTime: 0,
    });
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
    await this.loadTrack(track);
    await this.play();
  }

  reorderQueue(fromIndex: number, toIndex: number): void {
    const queue = [...this.state.queue];
    const [item] = queue.splice(fromIndex, 1);
    queue.splice(toIndex, 0, item);
    this.updateState({ queue });
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

    const nextIndex = currentIndex + 1 < queue.length ? currentIndex + 1 : 0;
    await this.playTrackAtIndex(nextIndex);
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
    return null;
  }

  // ===== 清理 =====
  destroy(): void {
    this.stop();
    this.stopProgressTimer(false);
    this.timeUpdateCallbacks.clear();
    this.endedCallbacks.clear();
    this.stateChangeCallbacks.clear();
    this.loadProgressCallbacks.clear();
    this.errorCallbacks.clear();
    if (this.stateListener) {
      this.stateListener();
      this.stateListener = undefined;
    }
  }
}
