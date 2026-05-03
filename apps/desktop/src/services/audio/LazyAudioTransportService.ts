import type {
  RuntimeCapsuleState,
  RuntimeLifecycleParticipant,
  RuntimePressureReason,
} from '../../contracts/runtimeCapsule';
import { getTelemetryLogger } from '../telemetry/TelemetryService';
import type { RuntimeCapsuleManagerService } from '../runtime-capsules';
import { AudioAdvancedSettingsShell } from './audioAdvancedSettingsShell';
import { AudioPlaylistShell } from './audioPlaylistShell';
import { NoopAudioService } from './NoopAudioService';
import type {
  AudioDynamicSrcAutoSettings,
  AudioDynamicSrcAutoSettingsPatch,
  AudioEnginePolicyPatch,
  AudioProtectionWindowOptions,
  AudioRobustnessSnapshot,
  AudioSpectrumFrame,
  AudioSpectrumTap,
  AudioState,
  AudioTuningAutoSettings,
  AudioTuningAutoSettingsPatch,
  AudioTuningProfileId,
  IAudioService,
  Playlist,
  PlaylistCreateOptions,
  PlaylistTrackPageResult,
  PlaylistTrackSortDirection,
  PlaylistTrackSortField,
  PlayMode,
  Track,
} from './types';

type StateListener = (state: AudioState) => void;
type TimeListener = (time: number) => void;
type ProgressListener = (progress: number) => void;
type ErrorListener = (error: Error) => void;
type RobustnessListener = (snapshot: AudioRobustnessSnapshot) => void;

export interface LazyAudioTransportServiceOptions {
  createTransport: () => IAudioService;
  runtimeCapsuleManager?: RuntimeCapsuleManagerService | null;
  onTransportCreated?: (transport: IAudioService) => void;
  onTransportDestroyed?: () => void;
}

const AUDIO_TRANSPORT_CAPSULE_ID = 'audio.transport';
const AUDIO_TRANSPORT_CAPABILITY_ID = 'audio.transport';
const AUDIO_TRANSPORT_LEASE_KEY = 'audio.transport:audio-engine';
const AUDIO_TRANSPORT_OWNER_ID = 'audio-engine';
const AUDIO_TRANSPORT_IDLE_RELEASE_MS = 30_000;

const EMPTY_ROBUSTNESS: AudioRobustnessSnapshot = {
  outputBackendId: null,
  outputBackends: [],
  underrunEvents: 0,
  underrunFrames: 0,
  underrunEventsWindow: 0,
  underrunRecoveryActive: false,
  protectionWindowActive: false,
  protectionRefCount: 0,
  protectionReason: null,
  autoSwitchCount: 0,
  lastAutoSwitchAtMs: null,
  lastAutoSwitchReason: null,
  bufferedAheadSeconds: 0,
  decodeBufferedAheadSeconds: 0,
  outputBufferedAheadSeconds: 0,
  bufferedAheadMinSeconds: null,
  bufferedAheadAvgSeconds: null,
  rebufferCount: 0,
};

function readTelemetryErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isTransportPlaybackActive(state: AudioState): boolean {
  return (
    state.playbackState === 'loading' ||
    state.playbackState === 'buffering' ||
    state.playbackState === 'playing'
  );
}

function isTransportPlaybackIdle(state: AudioState): boolean {
  return (
    state.playbackState === 'idle' ||
    state.playbackState === 'stopped' ||
    state.playbackState === 'error'
  );
}

export class LazyAudioTransportService implements IAudioService {
  private readonly telemetry = getTelemetryLogger('audio', 'LazyAudioTransportService');
  private readonly shell = new NoopAudioService();
  private readonly playlistShell = new AudioPlaylistShell(this.shell);
  private readonly advancedSettingsShell = new AudioAdvancedSettingsShell();
  private readonly stateListeners = new Set<StateListener>();
  private readonly timeListeners = new Set<TimeListener>();
  private readonly endedListeners = new Set<() => void>();
  private readonly loadProgressListeners = new Set<ProgressListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly robustnessListeners = new Set<RobustnessListener>();

  private delegate: IAudioService = this.shell;
  private transport: IAudioService | null = null;
  private transportLeaseId: string | null = null;
  private unregisterTransportParticipant: (() => void) | null = null;
  private idleReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private participantState: RuntimeCapsuleState = 'cold';
  private disposed = false;

  private delegateUnsubscribers: Array<() => void> = [];

  constructor(private readonly options: LazyAudioTransportServiceOptions) {
    this.attachDelegate(this.shell);
    this.registerTransportParticipant();
    void this.playlistShell.restorePlaylistSummaries();
  }

  isTransportActive(): boolean {
    return this.transport !== null;
  }

  getTransportParticipant(): RuntimeLifecycleParticipant {
    return {
      id: 'audio.transport.service',
      capsuleId: AUDIO_TRANSPORT_CAPSULE_ID,
      onWarm: () => {
        this.participantState = 'warming';
        this.createTransportInstance('capsule warm');
        this.participantState = this.transport ? 'active' : 'faulted';
      },
      onSuspend: () => {
        this.participantState = 'idle-warm';
      },
      onHibernate: () => {
        this.participantState = 'hibernated';
        this.destroyTransportInstance('capsule hibernate');
      },
      onTeardown: () => {
        this.participantState = 'tearing_down';
        this.destroyTransportInstance('capsule teardown');
        this.participantState = 'cold';
      },
      collectSnapshot: () => ({
        id: 'audio.transport.service',
        capsuleId: AUDIO_TRANSPORT_CAPSULE_ID,
        state: this.participantState,
        detail: {
          transportActive: this.transport !== null,
          leaseActive: this.transportLeaseId !== null,
          delegate: this.transport ? 'transport' : 'shell',
        },
      }),
    };
  }

  async loadTrack(track: Track): Promise<void> {
    await this.ensureTransport('load track').loadTrack(track);
  }

  async play(): Promise<void> {
    const state = this.getState();
    if (!state.currentTrack && state.queue.length === 0) return;

    const transport = this.ensureTransport('play');
    const targetIndex =
      state.currentIndex >= 0 && state.currentIndex < state.queue.length ? state.currentIndex : 0;

    if (!transport.getState().currentTrack && state.queue.length > 0) {
      await transport.playTrackAtIndex(targetIndex);
      return;
    }

    if (!transport.getState().currentTrack && state.currentTrack) {
      await transport.loadTrack(state.currentTrack);
    }

    await transport.play();
  }

  pause(): void {
    if (this.transport) {
      void this.transport.pause();
      return;
    }
    this.shell.pause();
  }

  stop(): void {
    this.delegate.stop();
    this.scheduleIdleTransportLeaseRelease();
  }

  seek(time: number): void {
    this.delegate.seek(time);
  }

  setVolume(volume: number): void {
    this.delegate.setVolume(volume);
  }

  getVolume(): number {
    return this.delegate.getVolume();
  }

  toggleMute(): void {
    this.delegate.toggleMute();
  }

  getCurrentTime(): number {
    return this.delegate.getCurrentTime();
  }

  getDuration(): number {
    return this.delegate.getDuration();
  }

  getState(): AudioState {
    return this.shell.getState();
  }

  onTimeUpdate(callback: TimeListener): () => void {
    this.timeListeners.add(callback);
    callback(this.getCurrentTime());
    return () => this.timeListeners.delete(callback);
  }

  onEnded(callback: () => void): () => void {
    this.endedListeners.add(callback);
    return () => this.endedListeners.delete(callback);
  }

  onStateChange(callback: StateListener): () => void {
    this.stateListeners.add(callback);
    callback(this.getState());
    return () => this.stateListeners.delete(callback);
  }

  onLoadProgress(callback: ProgressListener): () => void {
    this.loadProgressListeners.add(callback);
    return () => this.loadProgressListeners.delete(callback);
  }

  onError(callback: ErrorListener): () => void {
    this.errorListeners.add(callback);
    return () => this.errorListeners.delete(callback);
  }

  enterProtectionWindow(options?: AudioProtectionWindowOptions): () => void {
    if (!this.transport?.enterProtectionWindow) return () => undefined;
    return this.transport.enterProtectionWindow(options);
  }

  async setEnginePolicy(patch: AudioEnginePolicyPatch): Promise<void> {
    if (this.transport?.setEnginePolicy) {
      await this.transport.setEnginePolicy(patch);
      return;
    }
    await this.advancedSettingsShell.setEnginePolicy(patch);
  }

  getDynamicSrcAutoSettings(): AudioDynamicSrcAutoSettings {
    return (
      this.transport?.getDynamicSrcAutoSettings?.() ??
      this.advancedSettingsShell.getDynamicSrcAutoSettings()
    );
  }

  async setDynamicSrcAutoSettings(settings: AudioDynamicSrcAutoSettingsPatch): Promise<void> {
    if (this.transport?.setDynamicSrcAutoSettings) {
      await this.transport.setDynamicSrcAutoSettings(settings);
      return;
    }
    await this.advancedSettingsShell.setDynamicSrcAutoSettings(settings);
  }

  async applyTuningProfile(profileId: AudioTuningProfileId): Promise<void> {
    if (this.transport?.applyTuningProfile) {
      await this.transport.applyTuningProfile(profileId);
      return;
    }
    await this.advancedSettingsShell.applyTuningProfile(profileId);
  }

  getAudioTuningAutoSettings(): AudioTuningAutoSettings {
    return (
      this.transport?.getAudioTuningAutoSettings?.() ??
      this.advancedSettingsShell.getAudioTuningAutoSettings()
    );
  }

  async setAudioTuningAutoSettings(settings: AudioTuningAutoSettingsPatch): Promise<void> {
    if (this.transport?.setAudioTuningAutoSettings) {
      await this.transport.setAudioTuningAutoSettings(settings);
      return;
    }
    await this.advancedSettingsShell.setAudioTuningAutoSettings(settings);
  }

  getRobustnessSnapshot(): AudioRobustnessSnapshot {
    return this.transport?.getRobustnessSnapshot?.() ?? EMPTY_ROBUSTNESS;
  }

  onRobustnessSnapshot(callback: RobustnessListener): () => void {
    this.robustnessListeners.add(callback);
    if (this.transport?.getRobustnessSnapshot) {
      callback(this.transport.getRobustnessSnapshot());
    }
    return () => this.robustnessListeners.delete(callback);
  }

  addToQueue(track: Track): void {
    this.delegate.addToQueue(track);
  }

  addMultipleToQueue(tracks: Track[]): void {
    this.delegate.addMultipleToQueue(tracks);
  }

  removeFromQueue(index: number): void {
    this.delegate.removeFromQueue(index);
  }

  clearQueue(): void {
    this.delegate.clearQueue();
    this.scheduleIdleTransportLeaseRelease();
  }

  getQueue(): Track[] {
    return this.delegate.getQueue();
  }

  async playTrackAtIndex(index: number): Promise<void> {
    const queue = this.getQueue();
    if (index < 0 || index >= queue.length) return;
    await this.ensureTransport('play track at index').playTrackAtIndex(index);
  }

  reorderQueue(fromIndex: number, toIndex: number): void {
    this.delegate.reorderQueue(fromIndex, toIndex);
  }

  async playPrevious(): Promise<void> {
    if (this.getQueue().length === 0) return;
    await this.ensureTransport('play previous').playPrevious();
  }

  async playNext(): Promise<void> {
    if (this.getQueue().length === 0) return;
    await this.ensureTransport('play next').playNext();
  }

  setPlayMode(mode: PlayMode): void {
    this.delegate.setPlayMode(mode);
  }

  getPlayMode(): PlayMode {
    return this.delegate.getPlayMode();
  }

  fastForward(seconds: number): void {
    this.delegate.fastForward(seconds);
  }

  rewind(seconds: number): void {
    this.delegate.rewind(seconds);
  }

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
    this.delegate.clearQueue();
    this.delegate.addMultipleToQueue(resolved.tracks);
    this.playlistShell.setCurrentPlaylist(resolved.playlist);
    await this.playTrackAtIndex(0);
    this.playlistShell.touchPlaylistOpened(playlistId);
  }

  async addPlaylistToQueue(playlistId: string): Promise<void> {
    const resolved = await this.playlistShell.resolvePlaylistTracksForQueue(playlistId);
    if (!resolved || resolved.tracks.length === 0) return;
    this.delegate.addMultipleToQueue(resolved.tracks);
  }

  async playPlaylistTrackAtIndex(playlistId: string, trackIndex: number): Promise<void> {
    const resolved = await this.playlistShell.resolvePlaylistTracksForQueue(playlistId);
    if (!resolved || resolved.tracks.length === 0) return;
    const normalizedIndex =
      Number.isInteger(trackIndex) && trackIndex >= 0 && trackIndex < resolved.tracks.length
        ? trackIndex
        : -1;
    if (normalizedIndex < 0) return;
    this.delegate.clearQueue();
    this.delegate.addMultipleToQueue(resolved.tracks);
    this.playlistShell.setCurrentPlaylist(resolved.playlist);
    await this.playTrackAtIndex(normalizedIndex);
    this.playlistShell.touchPlaylistOpened(playlistId);
  }

  async addPlaylistTrackIndexesToQueue(
    playlistId: string,
    trackIndexes: number[]
  ): Promise<void> {
    const resolved = await this.playlistShell.resolvePlaylistTrackSelectionForQueue(
      playlistId,
      trackIndexes
    );
    if (!resolved || resolved.tracks.length === 0) return;
    this.delegate.addMultipleToQueue(resolved.tracks);
  }

  async hydratePlaylistTracks(playlistId: string): Promise<Playlist | null> {
    return this.playlistShell.hydratePlaylistTracks(playlistId);
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

  async resolvePlaylistCoverPreview(
    playlistId: string,
    options?: {
      coverSizeHint?: 'small' | 'medium' | 'large';
      preferCompactPreview?: boolean;
    }
  ): Promise<string | undefined> {
    return this.playlistShell.resolvePlaylistCoverPreview(playlistId, options);
  }

  releasePlaylistTracks(playlistId?: string): void {
    this.playlistShell.releasePlaylistTracks(playlistId);
  }

  getFrequencyData(): Uint8Array | null {
    return this.transport?.getFrequencyData?.() ?? null;
  }

  getSpectrumFrame(tap?: AudioSpectrumTap): AudioSpectrumFrame | null {
    return this.transport?.getSpectrumFrame?.(tap) ?? null;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearIdleTransportLeaseRelease();
    this.unregisterTransportParticipant?.();
    this.unregisterTransportParticipant = null;
    this.releaseTransportLease('shutdown', 'audio service destroyed');
    this.destroyTransportInstance('service destroyed', { attachShell: false });
    this.playlistShell.dispose();
    this.detachDelegate();
    this.shell.destroy();
    this.stateListeners.clear();
    this.timeListeners.clear();
    this.endedListeners.clear();
    this.loadProgressListeners.clear();
    this.errorListeners.clear();
    this.robustnessListeners.clear();
  }

  private registerTransportParticipant(): void {
    const manager = this.options.runtimeCapsuleManager;
    if (!manager) return;
    this.unregisterTransportParticipant = manager.registerParticipant(
      AUDIO_TRANSPORT_CAPSULE_ID,
      this.getTransportParticipant()
    );
  }

  private ensureTransport(detail: string): IAudioService {
    if (this.disposed) return this.shell;
    this.clearIdleTransportLeaseRelease();
    this.acquireOrRenewTransportLease(detail);
    return this.createTransportInstance(detail) ?? this.shell;
  }

  private createTransportInstance(detail: string): IAudioService | null {
    if (this.transport) return this.transport;

    try {
      const transport = this.options.createTransport();
      this.transport = transport;
      this.participantState = 'active';
      this.seedTransportFromShell(transport);
      this.delegate = transport;
      this.attachDelegate(transport);
      this.options.onTransportCreated?.(transport);
      this.telemetry.info('audio.transport.created', {
        fields: {
          detail,
        },
      });
      return transport;
    } catch (error) {
      this.participantState = 'faulted';
      this.releaseTransportLease('manual', 'transport creation failed');
      this.emitError(error instanceof Error ? error : new Error(String(error)));
      this.telemetry.error('audio.transport.create.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          detail,
        },
      });
      return null;
    }
  }

  private destroyTransportInstance(
    detail: string,
    options: { attachShell?: boolean } = {}
  ): void {
    const transport = this.transport;
    if (!transport) return;

    try {
      this.shell.replaceState(this.mergeTransportStateIntoShell(transport.getState()), {
        emit: false,
      });
    } catch {
      // Best effort: keep whatever shell state we already have.
    }

    this.detachDelegate();
    this.transport = null;
    this.delegate = this.shell;

    try {
      transport.destroy();
    } catch (error) {
      this.telemetry.warn('audio.transport.destroy.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          detail,
        },
      });
    }

    if (options.attachShell !== false && !this.disposed) {
      this.attachDelegate(this.shell);
    }
    this.options.onTransportDestroyed?.();
  }

  private seedTransportFromShell(transport: IAudioService): void {
    const state = this.shell.getState();

    transport.setVolume(state.volume);
    if (transport.getState().muted !== state.muted) {
      transport.toggleMute();
    }
    transport.setPlayMode(state.playMode);

    if (state.queue.length > 0) {
      transport.clearQueue();
      transport.addMultipleToQueue(state.queue);
    }
  }

  private attachDelegate(delegate: IAudioService): void {
    this.detachDelegate();
    this.delegateUnsubscribers = [
      delegate.onStateChange((state) => {
        let stateToEmit = state;
        if (delegate === this.transport) {
          stateToEmit = this.mergeTransportStateIntoShell(state);
          this.shell.replaceState(stateToEmit, { emit: false });
        }
        this.emitState(stateToEmit);
        this.applyTransportLeasePolicy(stateToEmit);
      }),
      delegate.onTimeUpdate((time) => {
        this.timeListeners.forEach((listener) => listener(time));
      }),
      delegate.onEnded(() => {
        this.endedListeners.forEach((listener) => listener());
        this.scheduleIdleTransportLeaseRelease();
      }),
      delegate.onLoadProgress((progress) => {
        this.loadProgressListeners.forEach((listener) => listener(progress));
      }),
      delegate.onError((error) => {
        this.emitError(error);
      }),
    ];

    if (delegate.onRobustnessSnapshot) {
      this.delegateUnsubscribers.push(
        delegate.onRobustnessSnapshot((snapshot) => {
          this.robustnessListeners.forEach((listener) => listener(snapshot));
        })
      );
    }
  }

  private mergeTransportStateIntoShell(transportState: AudioState): AudioState {
    const shellState = this.shell.getState();
    return {
      ...transportState,
      playlists: shellState.playlists,
      currentPlaylist: shellState.currentPlaylist,
    };
  }

  private detachDelegate(): void {
    for (const unsubscribe of this.delegateUnsubscribers) {
      try {
        unsubscribe();
      } catch {
        // ignore listener cleanup failures
      }
    }
    this.delegateUnsubscribers = [];
  }

  private emitState(state: AudioState): void {
    this.stateListeners.forEach((listener) => listener(state));
  }

  private emitError(error: Error): void {
    this.errorListeners.forEach((listener) => listener(error));
  }

  private applyTransportLeasePolicy(state: AudioState): void {
    if (!this.transportLeaseId) return;
    if (isTransportPlaybackActive(state)) {
      this.clearIdleTransportLeaseRelease();
      this.acquireOrRenewTransportLease('active playback');
      return;
    }
    if (isTransportPlaybackIdle(state)) {
      this.scheduleIdleTransportLeaseRelease();
    }
  }

  private scheduleIdleTransportLeaseRelease(): void {
    if (!this.transportLeaseId || this.idleReleaseTimer) return;
    this.idleReleaseTimer = setTimeout(() => {
      this.idleReleaseTimer = null;
      const state = this.transport?.getState();
      if (state && isTransportPlaybackActive(state)) return;
      this.releaseTransportLease('idle-timeout', 'audio transport idle');
    }, AUDIO_TRANSPORT_IDLE_RELEASE_MS);
  }

  private clearIdleTransportLeaseRelease(): void {
    if (!this.idleReleaseTimer) return;
    clearTimeout(this.idleReleaseTimer);
    this.idleReleaseTimer = null;
  }

  private acquireOrRenewTransportLease(detail: string): void {
    const manager = this.options.runtimeCapsuleManager;
    if (!manager) return;

    if (this.transportLeaseId) {
      const renewed = manager.renewLease(this.transportLeaseId, {
        priority: 'foreground',
        reason: {
          detail,
        },
      });
      if (renewed) return;
      this.transportLeaseId = null;
    }

    const lease = manager.acquireLease({
      capabilityId: AUDIO_TRANSPORT_CAPABILITY_ID,
      leaseKey: AUDIO_TRANSPORT_LEASE_KEY,
      ownerKind: 'system',
      ownerId: AUDIO_TRANSPORT_OWNER_ID,
      priority: 'foreground',
      reason: {
        detail,
      },
    });
    this.transportLeaseId = lease?.id ?? null;
  }

  private releaseTransportLease(kind: RuntimePressureReason['kind'], detail: string): void {
    const manager = this.options.runtimeCapsuleManager;
    const leaseId = this.transportLeaseId;
    if (!manager || !leaseId) return;
    this.transportLeaseId = null;
    manager.releaseLease(leaseId, {
      kind,
      sourceId: AUDIO_TRANSPORT_OWNER_ID,
      detail,
    });
  }
}
