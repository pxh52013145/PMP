import type { IAudioService, AudioState, PlaybackState, PlayMode, Playlist, Track } from './types';

type TimeListener = (time: number) => void;
type StateListener = (state: AudioState) => void;
type ProgressListener = (progress: number) => void;
type ErrorListener = (error: Error) => void;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export class NoopAudioService implements IAudioService {
  private playbackState: PlaybackState = 'idle';
  private currentTrack: Track | null = null;
  private currentTime = 0;
  private duration = 0;
  private volume = 0.7;
  private muted = false;
  private playMode: PlayMode = 'sequence';
  private queue: Track[] = [];
  private currentIndex = -1;
  private playlists: Playlist[] = [];
  private currentPlaylist: Playlist | null = null;

  private timeUpdateCallbacks = new Set<TimeListener>();
  private endedCallbacks = new Set<() => void>();
  private stateChangeCallbacks = new Set<StateListener>();
  private loadProgressCallbacks = new Set<ProgressListener>();
  private errorCallbacks = new Set<ErrorListener>();

  private emitState() {
    const state = this.getState();
    this.stateChangeCallbacks.forEach((cb) => cb(state));
  }

  async loadTrack(track: Track): Promise<void> {
    this.currentTrack = track;
    this.playbackState = 'paused';
    this.currentTime = 0;
    this.duration = typeof track.duration === 'number' ? track.duration : 0;
    this.loadProgressCallbacks.forEach((cb) => cb(1));
    this.emitState();
  }

  async play(): Promise<void> {
    if (!this.currentTrack && this.queue.length > 0) {
      await this.playTrackAtIndex(Math.max(0, this.currentIndex));
      return;
    }
    this.playbackState = 'playing';
    this.emitState();
  }

  pause(): void {
    this.playbackState = 'paused';
    this.emitState();
  }

  stop(): void {
    this.playbackState = 'stopped';
    this.currentTime = 0;
    this.timeUpdateCallbacks.forEach((cb) => cb(this.currentTime));
    this.emitState();
  }

  seek(time: number): void {
    this.currentTime = clampNonNegative(time);
    this.timeUpdateCallbacks.forEach((cb) => cb(this.currentTime));
    this.emitState();
  }

  setVolume(volume: number): void {
    this.volume = clamp01(volume);
    this.emitState();
  }

  getVolume(): number {
    return this.volume;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.emitState();
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  getDuration(): number {
    return this.duration;
  }

  getState(): AudioState {
    return {
      currentTrack: this.currentTrack,
      playbackState: this.playbackState,
      currentTime: this.currentTime,
      duration: this.duration,
      volume: this.volume,
      muted: this.muted,
      playMode: this.playMode,
      queue: [...this.queue],
      currentIndex: this.currentIndex,
      playlists: [...this.playlists],
      currentPlaylist: this.currentPlaylist,
    };
  }

  onTimeUpdate(callback: (time: number) => void): () => void {
    this.timeUpdateCallbacks.add(callback);
    callback(this.currentTime);
    return () => this.timeUpdateCallbacks.delete(callback);
  }

  onEnded(callback: () => void): () => void {
    this.endedCallbacks.add(callback);
    return () => this.endedCallbacks.delete(callback);
  }

  onStateChange(callback: (state: AudioState) => void): () => void {
    this.stateChangeCallbacks.add(callback);
    callback(this.getState());
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

  addToQueue(track: Track): void {
    this.queue.push(track);
    if (this.currentIndex === -1) this.currentIndex = 0;
    this.emitState();
  }

  addMultipleToQueue(tracks: Track[]): void {
    if (tracks.length === 0) return;
    this.queue.push(...tracks);
    if (this.currentIndex === -1) this.currentIndex = 0;
    this.emitState();
  }

  removeFromQueue(index: number): void {
    if (index < 0 || index >= this.queue.length) return;
    this.queue.splice(index, 1);
    if (this.queue.length === 0) {
      this.currentIndex = -1;
      this.currentTrack = null;
      this.playbackState = 'stopped';
    } else if (this.currentIndex >= this.queue.length) {
      this.currentIndex = this.queue.length - 1;
    }
    this.emitState();
  }

  clearQueue(): void {
    this.queue = [];
    this.currentIndex = -1;
    this.currentTrack = null;
    this.playbackState = 'stopped';
    this.currentTime = 0;
    this.emitState();
  }

  getQueue(): Track[] {
    return [...this.queue];
  }

  async playTrackAtIndex(index: number): Promise<void> {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    const track = this.queue[index];
    await this.loadTrack(track);
    await this.play();
  }

  reorderQueue(fromIndex: number, toIndex: number): void {
    if (
      fromIndex < 0 ||
      fromIndex >= this.queue.length ||
      toIndex < 0 ||
      toIndex >= this.queue.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [moved] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, moved);
    if (this.currentIndex === fromIndex) this.currentIndex = toIndex;
    this.emitState();
  }

  async playPrevious(): Promise<void> {
    if (this.queue.length === 0) return;
    const prev = this.currentIndex > 0 ? this.currentIndex - 1 : 0;
    await this.playTrackAtIndex(prev);
  }

  async playNext(): Promise<void> {
    if (this.queue.length === 0) return;
    const next = this.currentIndex + 1;
    await this.playTrackAtIndex(Math.min(this.queue.length - 1, next));
  }

  setPlayMode(mode: PlayMode): void {
    this.playMode = mode;
    this.emitState();
  }

  getPlayMode(): PlayMode {
    return this.playMode;
  }

  fastForward(seconds: number): void {
    this.seek(this.currentTime + clampNonNegative(seconds));
  }

  rewind(seconds: number): void {
    this.seek(Math.max(0, this.currentTime - clampNonNegative(seconds)));
  }

  createPlaylist(name: string, description?: string): Playlist {
    const playlist: Playlist = {
      id: `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name,
      description,
      tracks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      trackCount: 0,
      totalDuration: 0,
      favorite: false,
    };
    this.playlists.push(playlist);
    this.emitState();
    return playlist;
  }

  deletePlaylist(playlistId: string): void {
    const index = this.playlists.findIndex((p) => p.id === playlistId);
    if (index === -1) return;
    this.playlists.splice(index, 1);
    if (this.currentPlaylist?.id === playlistId) this.currentPlaylist = null;
    this.emitState();
  }

  renamePlaylist(playlistId: string, newName: string): void {
    const playlist = this.playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    playlist.name = newName;
    playlist.updatedAt = Date.now();
    this.emitState();
  }

  getPlaylists(): Playlist[] {
    return [...this.playlists];
  }

  getPlaylist(playlistId: string): Playlist | null {
    return this.playlists.find((p) => p.id === playlistId) ?? null;
  }

  addTrackToPlaylist(playlistId: string, track: Track): void {
    const playlist = this.playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    playlist.tracks.push(track);
    playlist.trackCount = playlist.tracks.length;
    playlist.totalDuration = playlist.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    playlist.updatedAt = Date.now();
    this.emitState();
  }

  removeTrackFromPlaylist(playlistId: string, trackIndex: number): void {
    const playlist = this.playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    if (trackIndex < 0 || trackIndex >= playlist.tracks.length) return;
    playlist.tracks.splice(trackIndex, 1);
    playlist.trackCount = playlist.tracks.length;
    playlist.totalDuration = playlist.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    playlist.updatedAt = Date.now();
    this.emitState();
  }

  clearPlaylist(playlistId: string): void {
    const playlist = this.playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    playlist.tracks = [];
    playlist.trackCount = 0;
    playlist.totalDuration = 0;
    playlist.updatedAt = Date.now();
    this.emitState();
  }

  async playPlaylist(playlistId: string): Promise<void> {
    const playlist = this.playlists.find((p) => p.id === playlistId);
    if (!playlist || playlist.tracks.length === 0) return;
    this.currentPlaylist = playlist;
    this.clearQueue();
    this.addMultipleToQueue(playlist.tracks);
    await this.playTrackAtIndex(0);
  }

  addPlaylistToQueue(playlistId: string): void {
    const playlist = this.playlists.find((p) => p.id === playlistId);
    if (!playlist || playlist.tracks.length === 0) return;
    this.addMultipleToQueue(playlist.tracks);
  }

  destroy(): void {
    this.timeUpdateCallbacks.clear();
    this.endedCallbacks.clear();
    this.stateChangeCallbacks.clear();
    this.loadProgressCallbacks.clear();
    this.errorCallbacks.clear();
  }
}

