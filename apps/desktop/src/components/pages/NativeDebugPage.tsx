import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import './NativeDebugPage.css';
import { useAudioEngine, useAudioService } from '../../contexts/AudioEngineContext';
import { usePerformanceControlSettings } from '../../contexts/usePerformanceControlSettings';
import { useLocale, useT } from '../../i18n';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { AudioRobustnessSnapshot, type AudioState, Playlist, Track } from '../../services/audio';
import type { AudioTuningProfileId } from '../../services/audio/types';
import {
  getPlaylistsOverlayResidencySnapshot,
  subscribePlaylistsOverlayResidencyTelemetry,
  type PlaylistsOverlayResidencySnapshot,
} from '../../modules/playlists/residencyTelemetry';
import { NativeDebugQueuePanel } from './native-debug/NativeDebugQueuePanel';
import { NativeDebugPlaybackDspPanel } from './native-debug/NativeDebugPlaybackDspPanel';
import { NativeDebugEnginePanel } from './native-debug/NativeDebugEnginePanel';
import { NativeDebugRobustnessPanel, type NativeDebugRobustnessMetricsView } from './native-debug/NativeDebugRobustnessPanel';
import { NativeDebugStatePanel } from './native-debug/NativeDebugStatePanel';
import {
  broadcastDataUpdate,
  broadcastSignal,
  readData,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../utils/windowCommunication';

const telemetry = getTelemetryLogger('debug', 'NativeDebugPage');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invokeNativeDebug<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  event: string
): Promise<T> {
  return invokeWithTelemetry<T>(command, args, {
    moduleId: 'debug',
    component: 'NativeDebugPage',
    event,
  });
}

function getFileName(filePath: string, fallback: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const last = segments[segments.length - 1];
  return last || fallback;
}

const SUPPORTED_EXTENSIONS = ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac'];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

type TrackResidencyDiagnostics = {
  trackCount: number;
  tracksWithFileContent: number;
  fileContentBytes: number;
  tracksWithLyrics: number;
  lyricChars: number;
  tracksWithTags: number;
  tagEntries: number;
  tagChars: number;
  tracksWithBlobCoverUrl: number;
  tracksWithDataCoverUrl: number;
  coverUrlChars: number;
  tracksWithFileHandle: number;
  commentChars: number;
  pathChars: number;
  filePathChars: number;
  originalPathChars: number;
  uniquePathCount: number;
  approxJsonBytes: number;
  approxHeavyFieldBytes: number;
};

function measureJsonBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return 0;
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(json).length;
    }
    return json.length * 2;
  } catch {
    return 0;
  }
}

function collectTrackResidencyDiagnostics(tracks: Track[]): TrackResidencyDiagnostics {
  let tracksWithFileContent = 0;
  let fileContentBytes = 0;
  let tracksWithLyrics = 0;
  let lyricChars = 0;
  let tracksWithTags = 0;
  let tagEntries = 0;
  let tagChars = 0;
  let tracksWithBlobCoverUrl = 0;
  let tracksWithDataCoverUrl = 0;
  let coverUrlChars = 0;
  let tracksWithFileHandle = 0;
  let commentChars = 0;
  let pathChars = 0;
  let filePathChars = 0;
  let originalPathChars = 0;
  const uniquePaths = new Set<string>();

  for (const track of tracks) {
    if (track.fileContent instanceof ArrayBuffer) {
      tracksWithFileContent += 1;
      fileContentBytes += track.fileContent.byteLength;
    }

    if (typeof track.lyrics === 'string' && track.lyrics.length > 0) {
      tracksWithLyrics += 1;
      lyricChars += track.lyrics.length;
    }

    if (Array.isArray(track.tags) && track.tags.length > 0) {
      tracksWithTags += 1;
      tagEntries += track.tags.length;
      tagChars += track.tags.reduce((total, tag) => total + (typeof tag === 'string' ? tag.length : 0), 0);
    }

    if (typeof track.coverUrl === 'string' && track.coverUrl.length > 0) {
      const lowerCoverUrl = track.coverUrl.trim().toLowerCase();
      coverUrlChars += track.coverUrl.length;
      if (lowerCoverUrl.startsWith('blob:')) {
        tracksWithBlobCoverUrl += 1;
      } else if (lowerCoverUrl.startsWith('data:')) {
        tracksWithDataCoverUrl += 1;
      }
    }

    if (track.fileHandle) {
      tracksWithFileHandle += 1;
    }

    if (typeof track.comment === 'string' && track.comment.length > 0) {
      commentChars += track.comment.length;
    }

    if (typeof track.path === 'string' && track.path.length > 0) {
      pathChars += track.path.length;
      uniquePaths.add(track.path);
    }

    if (typeof track.filePath === 'string' && track.filePath.length > 0) {
      filePathChars += track.filePath.length;
      uniquePaths.add(track.filePath);
    }

    if (typeof track.originalPath === 'string' && track.originalPath.length > 0) {
      originalPathChars += track.originalPath.length;
      uniquePaths.add(track.originalPath);
    }
  }

  return {
    trackCount: tracks.length,
    tracksWithFileContent,
    fileContentBytes,
    tracksWithLyrics,
    lyricChars,
    tracksWithTags,
    tagEntries,
    tagChars,
    tracksWithBlobCoverUrl,
    tracksWithDataCoverUrl,
    coverUrlChars,
    tracksWithFileHandle,
    commentChars,
    pathChars,
    filePathChars,
    originalPathChars,
    uniquePathCount: uniquePaths.size,
    approxJsonBytes: measureJsonBytes(tracks),
    approxHeavyFieldBytes:
      fileContentBytes +
      lyricChars * 2 +
      tagChars * 2 +
      coverUrlChars * 2 +
      commentChars * 2,
  };
}

type TrackDuplicationDiagnostics = {
  hydratedPlaylistCount: number;
  queueUniqueTrackCount: number;
  hydratedPlaylistTrackCount: number;
  hydratedPlaylistUniqueTrackCount: number;
  currentPlaylistTrackCount: number;
  currentPlaylistUniqueTrackCount: number;
  queueHydratedOverlapCount: number;
  queueHydratedOverlapApproxJsonBytes: number;
  queueCurrentPlaylistOverlapCount: number;
  queueCurrentPlaylistOverlapApproxJsonBytes: number;
  hydratedCurrentPlaylistOverlapCount: number;
  hydratedCurrentPlaylistOverlapApproxJsonBytes: number;
  tripleOverlapCount: number;
  tripleOverlapApproxJsonBytesUpperBound: number;
  unionUniqueTrackCount: number;
  logicalDuplicateCopies: number;
  logicalDuplicateApproxJsonBytesUpperBound: number;
};

function getTrackResidencyIdentity(track: Track): string {
  const filePath = typeof track.filePath === 'string' ? track.filePath.trim() : '';
  if (filePath) return `file:${filePath}`;

  const path = typeof track.path === 'string' ? track.path.trim() : '';
  if (path) return `path:${path}`;

  const originalPath = typeof track.originalPath === 'string' ? track.originalPath.trim() : '';
  if (originalPath) return `original:${originalPath}`;

  const id = typeof track.id === 'string' ? track.id.trim() : '';
  if (id) return `id:${id}`;

  return '';
}

function collectTrackDuplicationDiagnostics(
  queue: Track[],
  playlists: Playlist[],
  currentPlaylist: Playlist | null
): TrackDuplicationDiagnostics {
  const hydratedPlaylists = playlists.filter(
    (playlist) => playlist.tracksHydrated !== false && playlist.tracks.length > 0
  );
  const hydratedTracks = hydratedPlaylists.flatMap((playlist) => playlist.tracks);
  const currentPlaylistTracks = currentPlaylist?.tracks ?? [];
  const queueKeys = new Set<string>();
  const hydratedKeys = new Set<string>();
  const currentPlaylistKeys = new Set<string>();
  const trackPresence = new Map<
    string,
    {
      sample: Track;
      inQueue: boolean;
      inHydratedPlaylists: boolean;
      inCurrentPlaylist: boolean;
    }
  >();

  const markTracks = (
    tracks: Track[],
    bucket: 'queue' | 'hydratedPlaylists' | 'currentPlaylist',
    bucketKeys: Set<string>
  ) => {
    for (const track of tracks) {
      const identity = getTrackResidencyIdentity(track);
      if (!identity) continue;
      bucketKeys.add(identity);
      const existing = trackPresence.get(identity);
      if (existing) {
        if (bucket === 'queue') existing.inQueue = true;
        if (bucket === 'hydratedPlaylists') existing.inHydratedPlaylists = true;
        if (bucket === 'currentPlaylist') existing.inCurrentPlaylist = true;
        continue;
      }
      trackPresence.set(identity, {
        sample: track,
        inQueue: bucket === 'queue',
        inHydratedPlaylists: bucket === 'hydratedPlaylists',
        inCurrentPlaylist: bucket === 'currentPlaylist',
      });
    }
  };

  markTracks(queue, 'queue', queueKeys);
  markTracks(hydratedTracks, 'hydratedPlaylists', hydratedKeys);
  markTracks(currentPlaylistTracks, 'currentPlaylist', currentPlaylistKeys);

  let queueHydratedOverlapCount = 0;
  let queueHydratedOverlapApproxJsonBytes = 0;
  let queueCurrentPlaylistOverlapCount = 0;
  let queueCurrentPlaylistOverlapApproxJsonBytes = 0;
  let hydratedCurrentPlaylistOverlapCount = 0;
  let hydratedCurrentPlaylistOverlapApproxJsonBytes = 0;
  let tripleOverlapCount = 0;
  let tripleOverlapApproxJsonBytesUpperBound = 0;
  let logicalDuplicateCopies = 0;
  let logicalDuplicateApproxJsonBytesUpperBound = 0;

  for (const presence of trackPresence.values()) {
    const sampleJsonBytes = measureJsonBytes(presence.sample);
    const copies =
      Number(presence.inQueue) +
      Number(presence.inHydratedPlaylists) +
      Number(presence.inCurrentPlaylist);

    if (presence.inQueue && presence.inHydratedPlaylists) {
      queueHydratedOverlapCount += 1;
      queueHydratedOverlapApproxJsonBytes += sampleJsonBytes;
    }

    if (presence.inQueue && presence.inCurrentPlaylist) {
      queueCurrentPlaylistOverlapCount += 1;
      queueCurrentPlaylistOverlapApproxJsonBytes += sampleJsonBytes;
    }

    if (presence.inHydratedPlaylists && presence.inCurrentPlaylist) {
      hydratedCurrentPlaylistOverlapCount += 1;
      hydratedCurrentPlaylistOverlapApproxJsonBytes += sampleJsonBytes;
    }

    if (copies === 3) {
      tripleOverlapCount += 1;
      tripleOverlapApproxJsonBytesUpperBound += sampleJsonBytes * 2;
    }

    if (copies > 1) {
      logicalDuplicateCopies += copies - 1;
      logicalDuplicateApproxJsonBytesUpperBound += sampleJsonBytes * (copies - 1);
    }
  }

  return {
    hydratedPlaylistCount: hydratedPlaylists.length,
    queueUniqueTrackCount: queueKeys.size,
    hydratedPlaylistTrackCount: hydratedTracks.length,
    hydratedPlaylistUniqueTrackCount: hydratedKeys.size,
    currentPlaylistTrackCount: currentPlaylistTracks.length,
    currentPlaylistUniqueTrackCount: currentPlaylistKeys.size,
    queueHydratedOverlapCount,
    queueHydratedOverlapApproxJsonBytes,
    queueCurrentPlaylistOverlapCount,
    queueCurrentPlaylistOverlapApproxJsonBytes,
    hydratedCurrentPlaylistOverlapCount,
    hydratedCurrentPlaylistOverlapApproxJsonBytes,
    tripleOverlapCount,
    tripleOverlapApproxJsonBytesUpperBound,
    unionUniqueTrackCount: trackPresence.size,
    logicalDuplicateCopies,
    logicalDuplicateApproxJsonBytesUpperBound,
  };
}

type NativeAudioMeta = {
  device: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  gainDb: number | null;
  replayGainDb: number | null;
};

type NativeAudioComponentsState = {
  outputBackendId: string | null;
  outputDeviceId: string | null;
  outputDevice: string | null;
  preferredInputId: string | null;
  activeInputId: string | null;
};

function parseNativeAudioComponentsState(payload: unknown): NativeAudioComponentsState {
  const record = asRecord(payload);
  const outputBackendId = typeof record?.outputBackendId === 'string' ? record.outputBackendId : null;
  const outputDeviceId = typeof record?.outputDeviceId === 'string' ? record.outputDeviceId : null;
  const outputDevice = typeof record?.outputDevice === 'string' ? record.outputDevice : null;
  const preferredInputId = typeof record?.preferredInputId === 'string' ? record.preferredInputId : null;
  const activeInputId = typeof record?.activeInputId === 'string' ? record.activeInputId : null;
  return { outputBackendId, outputDeviceId, outputDevice, preferredInputId, activeInputId };
}

type NativeDspEqBandKind = 'peaking' | 'low-shelf' | 'high-shelf';

type NativeDspEqBand = {
  kind: NativeDspEqBandKind;
  frequencyHz: number;
  q: number;
  gainDb: number;
};

type NativeDspNodeConfig =
  | { type: 'gain'; db: number }
  | { type: 'eq'; bands: NativeDspEqBand[] }
  | { type: 'limiter'; thresholdDb: number };

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

type CrossfadeSettings = {
  enabled: boolean;
  durationMs: number;
};

type NativeAudioSrcMode = 'source-native' | 'match-output' | 'target-rate';
type NativeAudioSrcBackend = 'rubato' | 'linear-simd';
type NativeAudioSrcPresetId = 'balanced' | 'hi-end' | 'low-latency';

type NativeAudioEnginePolicyPayload = {
  srcMode?: NativeAudioSrcMode;
  srcBackend?: NativeAudioSrcBackend;
  srcTargetSampleRate?: number | null;
};

type NativeAudioDynamicSrcSettings = {
  enabled: boolean;
  adaptiveEnabled: boolean;
  learningEnabled: boolean;
  restoreDebounceMs: number;
  minSwitchIntervalMs: number;
  seekHoldMs: number;
  underrunHoldMs: number;
  sharedStressHoldMs: number;
  outputErrorHoldMs: number;
};

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

const DEFAULT_EQ_BANDS: NativeDspEqBand[] = [
  { kind: 'low-shelf', frequencyHz: 120, q: 1, gainDb: 0 },
  { kind: 'peaking', frequencyHz: 1000, q: 1, gainDb: 0 },
  { kind: 'high-shelf', frequencyHz: 8000, q: 1, gainDb: 0 },
];

type NativeRetireStats = {
  pendingTasks: number | null;
  enqueuedTotal: number | null;
  executedTotal: number | null;
  inlineFallbackTotal: number | null;
  panicTotal: number | null;
};

type NativeBufferDebugSnapshot = {
  timestampMs: number;
  playbackState: AudioState['playbackState'];
  trackPath: string | null;
  bufferedAhead: number;
  decodeBufferedAhead: number | null;
  outputBufferedAhead: number | null;
  retirePendingTasks: number | null;
  retireEnqueuedTotal: number | null;
  retireExecutedTotal: number | null;
};

type NativeTrackSwitchDebugSnapshot = {
  status: 'pending' | 'completed' | 'error';
  startedAtMs: number;
  completedAtMs: number | null;
  fromTrack: string | null;
  toTrack: string | null;
  before: NativeBufferDebugSnapshot | null;
  current: NativeBufferDebugSnapshot;
  after: NativeBufferDebugSnapshot | null;
};

const EMPTY_RETIRE_STATS: NativeRetireStats = {
  pendingTasks: null,
  enqueuedTotal: null,
  executedTotal: null,
  inlineFallbackTotal: null,
  panicTotal: null,
};

function parseOptionalNonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

function getDebugTrackPath(track: Track | null | undefined): string | null {
  if (!track) return null;
  const candidates = [track.originalPath, track.filePath, track.path];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
}

function captureBufferDebugSnapshot(
  state: AudioState,
  retireStats: NativeRetireStats,
  timestampMs: number = Date.now()
): NativeBufferDebugSnapshot {
  return {
    timestampMs,
    playbackState: state.playbackState,
    trackPath: getDebugTrackPath(state.currentTrack),
    bufferedAhead:
      typeof state.bufferedAhead === 'number' && Number.isFinite(state.bufferedAhead)
        ? Math.max(0, state.bufferedAhead)
        : 0,
    decodeBufferedAhead:
      typeof state.decodeBufferedAhead === 'number' && Number.isFinite(state.decodeBufferedAhead)
        ? Math.max(0, state.decodeBufferedAhead)
        : null,
    outputBufferedAhead:
      typeof state.outputBufferedAhead === 'number' && Number.isFinite(state.outputBufferedAhead)
        ? Math.max(0, state.outputBufferedAhead)
        : null,
    retirePendingTasks: retireStats.pendingTasks,
    retireEnqueuedTotal: retireStats.enqueuedTotal,
    retireExecutedTotal: retireStats.executedTotal,
  };
}

export const NativeDebugPage: React.FC = () => {
  const audioService = useAudioService();
  const { service: performanceControlService, snapshot: performanceSnapshot } =
    usePerformanceControlSettings();
  const t = useT();
  const locale = useLocale();
  const { isNativeAvailable } = useAudioEngine();
  const [state, setState] = useState(() => audioService.getState());
  const [logs, setLogs] = useState<string[]>([]);
  const [playlistsOverlayResidency, setPlaylistsOverlayResidency] =
    useState<PlaylistsOverlayResidencySnapshot>(() => getPlaylistsOverlayResidencySnapshot());
  const [isSelectingFile, setIsSelectingFile] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [nativeMeta, setNativeMeta] = useState<NativeAudioMeta>({
    device: null,
    sampleRate: null,
    bitDepth: null,
    gainDb: null,
    replayGainDb: null,
  });
  const [componentsState, setComponentsState] = useState<NativeAudioComponentsState>({
    outputBackendId: null,
    outputDeviceId: null,
    outputDevice: null,
    preferredInputId: null,
    activeInputId: null,
  });
  const [outputBackends, setOutputBackends] = useState<string[]>([]);
  const [selectedBackend, setSelectedBackend] = useState<string>('');
  const [audioInputs, setAudioInputs] = useState<string[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>('');
  const [dspGainDb, setDspGainDb] = useState(0);
  const [eqBands, setEqBands] = useState<NativeDspEqBand[]>(DEFAULT_EQ_BANDS);
  const [limiterEnabled, setLimiterEnabled] = useState(false);
  const [limiterThresholdDb, setLimiterThresholdDb] = useState(-1);
  const [replayGainSettings, setReplayGainSettings] = useState<ReplayGainSettings>({
    enabled: true,
    mode: 'track',
    preampDb: 0,
  });
  const [runtimeControlSettings, setRuntimeControlSettings] = useState<RuntimeControlSettings>({
    dynamicGainEnabled: false,
    volumeDebounceEnabled: true,
  });
  const [crossfadeSettings, setCrossfadeSettings] = useState<CrossfadeSettings>({
    enabled: false,
    durationMs: 1200,
  });
  const [srcMode, setSrcMode] = useState<NativeAudioSrcMode>('match-output');
  const [srcBackend, setSrcBackend] = useState<NativeAudioSrcBackend>('rubato');
  const [srcTargetRate, setSrcTargetRate] = useState<string>('96000');
  const [srcPresetId, setSrcPresetId] = useState<NativeAudioSrcPresetId>('balanced');
  const [tuningProfileId, setTuningProfileId] = useState<AudioTuningProfileId>('ll-guarded');
  const [dynamicSrcSettings, setDynamicSrcSettings] = useState<NativeAudioDynamicSrcSettings>({
    enabled: true,
    adaptiveEnabled: true,
    learningEnabled: true,
    restoreDebounceMs: 4000,
    minSwitchIntervalMs: 600,
    seekHoldMs: 2000,
    underrunHoldMs: 12000,
    sharedStressHoldMs: 8000,
    outputErrorHoldMs: 10000,
  });
  const [robustness, setRobustness] = useState<AudioRobustnessSnapshot>(() =>
    audioService.getRobustnessSnapshot?.() ?? EMPTY_ROBUSTNESS
  );
  const [retireStats, setRetireStats] = useState<NativeRetireStats>(EMPTY_RETIRE_STATS);
  const [trackSwitchSnapshot, setTrackSwitchSnapshot] = useState<NativeTrackSwitchDebugSnapshot | null>(null);
  const previousTrackPathRef = useRef<string | null>(getDebugTrackPath(state.currentTrack));
  const previousBufferSnapshotRef = useRef<NativeBufferDebugSnapshot>(
    captureBufferDebugSnapshot(state, EMPTY_RETIRE_STATS)
  );
  const pendingTrackSwitchRef = useRef<NativeTrackSwitchDebugSnapshot | null>(null);

  const getFrequencyData = useCallback(() => audioService.getFrequencyData?.() ?? null, [audioService]);

  const appendLog = useCallback((message: string) => {
    setLogs((prev) => {
      const timestamp = new Date().toLocaleTimeString(locale);
      const next = [`[${timestamp}] ${message}`, ...prev];
      return next.slice(0, 50);
    });
  }, [locale]);

  useEffect(() => {
    return subscribePlaylistsOverlayResidencyTelemetry((snapshot) => {
      setPlaylistsOverlayResidency(snapshot);
    });
  }, []);

  useEffect(() => {
    setState(audioService.getState());
    const unsubscribeState = audioService.onStateChange((next) => setState(next));
    const unsubscribeRobustness =
      audioService.onRobustnessSnapshot?.((next) => setRobustness(next)) ?? (() => {});
    const unsubscribeError = audioService.onError((error) => {
      const message = error?.message ?? String(error);
      setLastError(message);
      appendLog(t('pages.native-debug.log.error', { message }));
    });
    return () => {
      unsubscribeState();
      unsubscribeRobustness();
      unsubscribeError();
    };
  }, [audioService, appendLog, t]);

  useEffect(() => {
    void performanceControlService.refreshNow();
  }, [performanceControlService]);

  const isNativeEngine = isNativeAvailable;

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<string | null>(STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_BACKEND);
    if (typeof persisted === 'string') {
      setSelectedBackend(persisted);
    } else if (persisted === null) {
      setSelectedBackend('');
    }
  }, [isNativeEngine]);

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<string | null>(STORAGE_KEYS.NATIVE_AUDIO_INPUT_ID);
    if (typeof persisted === 'string') {
      setSelectedInput(persisted);
    } else if (persisted === null) {
      setSelectedInput('');
    }
  }, [isNativeEngine]);

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS);
    const record = asRecord(persisted);
    if (!record) return;

    const enabled = typeof record.enabled === 'boolean' ? record.enabled : true;
    const modeRaw = typeof record.mode === 'string' ? record.mode : 'track';
    const mode: ReplayGainMode = modeRaw === 'album' ? 'album' : 'track';
    const preampDb =
      typeof record.preampDb === 'number' && isFinite(record.preampDb) ? record.preampDb : 0;

    setReplayGainSettings({ enabled, mode, preampDb });
  }, [isNativeEngine]);

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS);
    const record = asRecord(persisted);
    if (!record) return;

    const dynamicGainEnabled =
      typeof record.dynamicGainEnabled === 'boolean'
        ? record.dynamicGainEnabled
        : typeof record.dynamicFallbackEnabled === 'boolean'
          ? record.dynamicFallbackEnabled
          : false;
    const volumeDebounceEnabled =
      typeof record.volumeDebounceEnabled === 'boolean' ? record.volumeDebounceEnabled : true;

    setRuntimeControlSettings({ dynamicGainEnabled, volumeDebounceEnabled });
  }, [isNativeEngine]);

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS);
    const record = asRecord(persisted);
    if (!record) return;

    const enabled = typeof record.enabled === 'boolean' ? record.enabled : false;
    const durationMs = typeof record.durationMs === 'number' ? record.durationMs : 1200;

    setCrossfadeSettings({
      enabled,
      durationMs: typeof durationMs === 'number' && isFinite(durationMs) ? durationMs : 1200,
    });
  }, [isNativeEngine]);

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_DSP_CHAIN);
    if (!Array.isArray(persisted)) return;

    const gainNode = persisted.find((node): node is { type: 'gain'; db: number } => {
      const record = asRecord(node);
      return record?.type === 'gain' && typeof record.db === 'number';
    });

    if (gainNode) {
      setDspGainDb(gainNode.db);
    }

    const eqNode = persisted.find((node): node is { type: 'eq'; bands: unknown[] } => {
      const record = asRecord(node);
      return record?.type === 'eq' && Array.isArray(record.bands);
    });

    if (eqNode) {
      const nextBands: NativeDspEqBand[] = [];
      for (const band of eqNode.bands) {
        const bandRecord = asRecord(band);
        if (!bandRecord) continue;
        const kind = bandRecord.kind as NativeDspEqBandKind | undefined;
        const frequencyHz = typeof bandRecord.frequencyHz === 'number' ? bandRecord.frequencyHz : null;
        const q = typeof bandRecord.q === 'number' ? bandRecord.q : null;
        const gainDb = typeof bandRecord.gainDb === 'number' ? bandRecord.gainDb : null;
        if (!kind || frequencyHz === null || q === null || gainDb === null) continue;
        if (kind !== 'peaking' && kind !== 'low-shelf' && kind !== 'high-shelf') continue;
        nextBands.push({ kind, frequencyHz, q, gainDb });
      }
      if (nextBands.length > 0) {
        setEqBands(nextBands);
      }
    }

    const limiterNode = persisted.find((node): node is { type: 'limiter'; thresholdDb: number } => {
      const record = asRecord(node);
      return record?.type === 'limiter' && typeof record.thresholdDb === 'number';
    });

    if (limiterNode) {
      setLimiterEnabled(true);
      setLimiterThresholdDb(limiterNode.thresholdDb);
    } else {
      setLimiterEnabled(false);
    }
  }, [isNativeEngine]);

  useEffect(() => {
    if (!isNativeEngine) return;

    let unlisten: UnlistenFn | null = null;
    void listen('native_audio_state', (event) => {
      const payload = event.payload as Record<string, unknown>;
      const next =
        payload && 'state' in payload ? (payload.state as Record<string, unknown>) : payload;

      const device = typeof next.device === 'string' ? next.device : null;
      const sampleRate = typeof next.sampleRate === 'number' ? next.sampleRate : null;
      const bitDepth = typeof next.bitDepth === 'number' ? next.bitDepth : null;
      const gainDb = typeof next.gainDb === 'number' ? next.gainDb : null;
      const replayGainDb = typeof next.replayGainDb === 'number' ? next.replayGainDb : null;
      const nextRetireStats: NativeRetireStats = {
        pendingTasks: parseOptionalNonNegativeInt(next.retirePendingTasks),
        enqueuedTotal: parseOptionalNonNegativeInt(next.retireEnqueuedTotal),
        executedTotal: parseOptionalNonNegativeInt(next.retireExecutedTotal),
        inlineFallbackTotal: parseOptionalNonNegativeInt(next.retireInlineFallbackTotal),
        panicTotal: parseOptionalNonNegativeInt(next.retirePanicTotal),
      };

      setNativeMeta({ device, sampleRate, bitDepth, gainDb, replayGainDb });
      setRetireStats(nextRetireStats);
      if (gainDb !== null) {
        setDspGainDb(gainDb);
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [isNativeEngine]);

  const currentTrackLabel = useMemo(() => {
    if (!state.currentTrack) return t('pages.native-debug.currentTrack.none');
    const { title, artist } = state.currentTrack;
    return artist ? `${title} - ${artist}` : title;
  }, [state.currentTrack, t]);

  const currentTrackDebugPath = useMemo(
    () => getDebugTrackPath(state.currentTrack),
    [state.currentTrack]
  );

  const currentBufferDebugSnapshot = useMemo(
    () => captureBufferDebugSnapshot(state, retireStats),
    [retireStats, state]
  );

  useEffect(() => {
    const previousTrackPath = previousTrackPathRef.current;
    const previousBufferSnapshot = previousBufferSnapshotRef.current;
    const trackChanged = currentTrackDebugPath !== previousTrackPath;

    if (
      state.playbackState === 'loading' &&
      trackChanged &&
      typeof currentTrackDebugPath === 'string' &&
      currentTrackDebugPath.length > 0
    ) {
      const snapshot: NativeTrackSwitchDebugSnapshot = {
        status: 'pending',
        startedAtMs: currentBufferDebugSnapshot.timestampMs,
        completedAtMs: null,
        fromTrack: previousTrackPath,
        toTrack: currentTrackDebugPath,
        before: previousBufferSnapshot,
        current: currentBufferDebugSnapshot,
        after: null,
      };
      pendingTrackSwitchRef.current = snapshot;
      setTrackSwitchSnapshot(snapshot);
    } else if (pendingTrackSwitchRef.current) {
      const pendingSnapshot = pendingTrackSwitchRef.current;
      const liveSnapshot: NativeTrackSwitchDebugSnapshot = {
        ...pendingSnapshot,
        current: currentBufferDebugSnapshot,
      };
      const switchSettled =
        currentTrackDebugPath === pendingSnapshot.toTrack &&
        state.playbackState !== 'loading' &&
        state.playbackState !== 'buffering';

      if (switchSettled) {
        const status: NativeTrackSwitchDebugSnapshot['status'] =
          state.playbackState === 'error' ? 'error' : 'completed';
        const completedSnapshot: NativeTrackSwitchDebugSnapshot = {
          ...liveSnapshot,
          status,
          completedAtMs: currentBufferDebugSnapshot.timestampMs,
          after: currentBufferDebugSnapshot,
        };
        pendingTrackSwitchRef.current = null;
        setTrackSwitchSnapshot(completedSnapshot);
      } else {
        pendingTrackSwitchRef.current = liveSnapshot;
        setTrackSwitchSnapshot(liveSnapshot);
      }
    }

    previousTrackPathRef.current = currentTrackDebugPath;
    previousBufferSnapshotRef.current = currentBufferDebugSnapshot;
  }, [currentBufferDebugSnapshot, currentTrackDebugPath, state.playbackState]);

  const parseSrcTargetRate = useCallback((value: string): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.max(8000, Math.min(768000, Math.floor(parsed)));
  }, []);

  const detectSrcPreset = useCallback(
    (
      mode: NativeAudioSrcMode,
      backend: NativeAudioSrcBackend,
      targetRate: number | null
    ): NativeAudioSrcPresetId => {
      if (mode === 'target-rate' && backend === 'rubato' && targetRate === 192000) {
        return 'hi-end';
      }
      if (mode === 'match-output' && backend === 'linear-simd') {
        return 'low-latency';
      }
      return 'balanced';
    },
    []
  );

  const applySrcPolicyState = useCallback(
    (payload: NativeAudioEnginePolicyPayload) => {
      const mode =
        payload.srcMode === 'source-native' ||
        payload.srcMode === 'match-output' ||
        payload.srcMode === 'target-rate'
          ? payload.srcMode
          : 'match-output';
      const backend =
        payload.srcBackend === 'rubato' || payload.srcBackend === 'linear-simd'
          ? payload.srcBackend
          : 'rubato';
      const targetRate =
        typeof payload.srcTargetSampleRate === 'number' && Number.isFinite(payload.srcTargetSampleRate)
          ? Math.max(8000, Math.min(768000, Math.floor(payload.srcTargetSampleRate)))
          : null;

      setSrcMode(mode);
      setSrcBackend(backend);
      setSrcTargetRate(String(targetRate ?? 96000));
      setSrcPresetId(detectSrcPreset(mode, backend, targetRate));
    },
    [detectSrcPreset]
  );

  const readDynamicSrcAutoSettings = useCallback((): NativeAudioDynamicSrcSettings => {
    const getter = audioService.getDynamicSrcAutoSettings;
    if (!getter) {
      return {
        enabled: true,
        adaptiveEnabled: true,
        learningEnabled: true,
        restoreDebounceMs: 4000,
        minSwitchIntervalMs: 600,
        seekHoldMs: 2000,
        underrunHoldMs: 12000,
        sharedStressHoldMs: 8000,
        outputErrorHoldMs: 10000,
      };
    }
    try {
      const settings = getter.call(audioService);
      return {
        enabled: typeof settings?.enabled === 'boolean' ? settings.enabled : true,
        adaptiveEnabled:
          typeof settings?.adaptiveEnabled === 'boolean' ? settings.adaptiveEnabled : true,
        learningEnabled:
          typeof settings?.learningEnabled === 'boolean' ? settings.learningEnabled : true,
        restoreDebounceMs:
          typeof settings?.restoreDebounceMs === 'number' ? settings.restoreDebounceMs : 4000,
        minSwitchIntervalMs:
          typeof settings?.minSwitchIntervalMs === 'number' ? settings.minSwitchIntervalMs : 600,
        seekHoldMs: typeof settings?.seekHoldMs === 'number' ? settings.seekHoldMs : 2000,
        underrunHoldMs:
          typeof settings?.underrunHoldMs === 'number' ? settings.underrunHoldMs : 12000,
        sharedStressHoldMs:
          typeof settings?.sharedStressHoldMs === 'number' ? settings.sharedStressHoldMs : 8000,
        outputErrorHoldMs:
          typeof settings?.outputErrorHoldMs === 'number' ? settings.outputErrorHoldMs : 10000,
      };
    } catch {
      return {
        enabled: true,
        adaptiveEnabled: true,
        learningEnabled: true,
        restoreDebounceMs: 4000,
        minSwitchIntervalMs: 600,
        seekHoldMs: 2000,
        underrunHoldMs: 12000,
        sharedStressHoldMs: 8000,
        outputErrorHoldMs: 10000,
      };
    }
  }, [audioService]);

  const applyDynamicSrcAutoSettings = useCallback(
    async (patch: Partial<NativeAudioDynamicSrcSettings>) => {
      const setter = audioService.setDynamicSrcAutoSettings;
      if (!setter) return;

      const nextSettings: NativeAudioDynamicSrcSettings = {
        ...dynamicSrcSettings,
        ...patch,
      };

      setDynamicSrcSettings(nextSettings);
      try {
        await setter.call(audioService, nextSettings);
        if (typeof patch.enabled === 'boolean') {
          appendLog(
            patch.enabled
              ? t('pages.native-debug.log.dynamicSrcAutoEnabled')
              : t('pages.native-debug.log.dynamicSrcAutoDisabled')
          );
        } else {
          appendLog(t('pages.native-debug.log.dynamicSrcParamsUpdated'));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setDynamicSrcSettings(dynamicSrcSettings);
        appendLog(t('pages.native-debug.log.dynamicSrcAutoUpdateFailed', { message }));
      }
    },
    [appendLog, audioService, dynamicSrcSettings, t]
  );

  const fetchEnginePolicy = useCallback(async () => {
    try {
      const payload = await invokeNativeDebug<unknown>(
        'native_audio_get_engine_policy',
        undefined,
        'debug.audio.engine-policy.read'
      );
      const record = asRecord(payload);
      if (!record) return;
      applySrcPolicyState(record as NativeAudioEnginePolicyPayload);
    } catch (error) {
      telemetry.warn('debug.audio.engine-policy.read.failed', {
        message: getErrorMessage(error),
      });
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.enginePolicyFetchFailed', { message }));
    }
  }, [appendLog, applySrcPolicyState, t]);

  useEffect(() => {
    if (!isNativeEngine) return;
    const settings = readDynamicSrcAutoSettings();
    setDynamicSrcSettings(settings);
  }, [isNativeEngine, readDynamicSrcAutoSettings]);

  const handleApplySrcPolicy = useCallback(async () => {
    const targetRate = parseSrcTargetRate(srcTargetRate);
    const shouldUseTarget = srcMode === 'target-rate';

    try {
      const payload = await invokeNativeDebug<unknown>(
        'native_audio_set_engine_policy',
        {
          srcMode,
          srcBackend,
          srcTargetSampleRate: shouldUseTarget ? targetRate : null,
        },
        'debug.audio.engine-policy.set'
      );
      const record = asRecord(payload);
      if (record) {
        applySrcPolicyState(record as NativeAudioEnginePolicyPayload);
      }

      appendLog(
        t('pages.native-debug.log.srcPolicyApplied', {
          mode: srcMode,
          backend: srcBackend,
          targetRate: shouldUseTarget ? targetRate ?? 0 : 0,
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.srcPolicyApplyFailed', { message }));
    }
  }, [
    appendLog,
    applySrcPolicyState,
    parseSrcTargetRate,
    srcBackend,
    srcMode,
    srcTargetRate,
    t,
  ]);

  const handleApplySrcPreset = useCallback(
    async (presetId: NativeAudioSrcPresetId) => {
      let nextMode: NativeAudioSrcMode = 'match-output';
      let nextBackend: NativeAudioSrcBackend = 'rubato';
      let nextTarget: number | null = null;

      if (presetId === 'hi-end') {
        nextMode = 'target-rate';
        nextBackend = 'rubato';
        nextTarget = 192000;
      } else if (presetId === 'low-latency') {
        nextMode = 'match-output';
        nextBackend = 'linear-simd';
      }

      setSrcPresetId(presetId);
      setSrcMode(nextMode);
      setSrcBackend(nextBackend);
      if (nextTarget) {
        setSrcTargetRate(String(nextTarget));
      }

      try {
        const payload = await invokeNativeDebug<unknown>(
          'native_audio_set_engine_policy',
          {
            srcMode: nextMode,
            srcBackend: nextBackend,
            srcTargetSampleRate: nextMode === 'target-rate' ? nextTarget : null,
          },
          'debug.audio.engine-policy.set'
        );
        const record = asRecord(payload);
        if (record) {
          applySrcPolicyState(record as NativeAudioEnginePolicyPayload);
        }

        appendLog(
          t('pages.native-debug.log.srcPresetApplied', {
            preset: t(`pages.native-debug.src.preset.${presetId}`),
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendLog(t('pages.native-debug.log.srcPolicyApplyFailed', { message }));
      }
    },
    [appendLog, applySrcPolicyState, t]
  );

  const handleApplyTuningProfile = useCallback(
    async (profileId: AudioTuningProfileId) => {
      const applier = audioService.applyTuningProfile;
      if (!applier) {
        appendLog(t('pages.native-debug.log.tuningProfileUnsupported'));
        return;
      }

      const previous = tuningProfileId;
      setTuningProfileId(profileId);

      try {
        await applier.call(audioService, profileId);
        setDynamicSrcSettings(readDynamicSrcAutoSettings());
        await fetchEnginePolicy();
        appendLog(
          t('pages.native-debug.log.tuningProfileApplied', {
            profile: t(`pages.native-debug.tuning.profile.${profileId}`),
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setTuningProfileId(previous);
        appendLog(t('pages.native-debug.log.tuningProfileApplyFailed', { message }));
      }
    },
    [appendLog, audioService, fetchEnginePolicy, readDynamicSrcAutoSettings, t, tuningProfileId]
  );

  const handleRefreshAudioComponents = useCallback(async () => {
    try {
      const payload = await invokeNativeDebug<unknown>(
        'native_audio_get_audio_components_state',
        undefined,
        'debug.audio.components-state.read'
      );
      const parsed = parseNativeAudioComponentsState(payload);
      setComponentsState(parsed);
      setSelectedBackend(parsed.outputBackendId ?? '');
      setSelectedInput(parsed.preferredInputId ?? '');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.error', { message }));
    }

    await fetchEnginePolicy();

    try {
      const backends = await invokeNativeDebug<string[]>(
        'native_audio_list_output_backends',
        undefined,
        'debug.audio.output-backends.list'
      );
      setOutputBackends(backends);
      appendLog(t('pages.native-debug.log.outputBackendsFetched', { count: backends.length }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.outputBackendsFetchFailed', { message }));
    }

    try {
      const inputs = await invokeNativeDebug<string[]>(
        'native_audio_list_audio_inputs',
        undefined,
        'debug.audio.audio-inputs.list'
      );
      setAudioInputs(inputs);
      appendLog(t('pages.native-debug.log.audioInputsFetched', { count: inputs.length }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.audioInputsFetchFailed', { message }));
    }
  }, [appendLog, fetchEnginePolicy, t]);

  useEffect(() => {
    if (!isNativeEngine) return;
    void handleRefreshAudioComponents();
  }, [handleRefreshAudioComponents, isNativeEngine]);

  const handleApplyOutputBackend = useCallback(async () => {
    const backendId = selectedBackend.length > 0 ? selectedBackend : null;

    try {
      const payload = await invokeNativeDebug<unknown>(
        'native_audio_select_output_backend',
        { backendId },
        'debug.audio.output-backend.select'
      );
      const parsed = parseNativeAudioComponentsState(payload);
      setComponentsState(parsed);
      setSelectedBackend(parsed.outputBackendId ?? '');

      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_BACKEND,
        parsed.outputBackendId,
        TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_BACKEND_UPDATED
      );

      appendLog(
        t('pages.native-debug.log.outputBackendSwitched', {
          backendId: parsed.outputBackendId ?? t('pages.native-debug.outputBackend.default'),
        })
      );

      if (componentsState.outputBackendId && componentsState.outputBackendId !== parsed.outputBackendId) {
        await broadcastSignal(TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_DEVICE_UPDATED);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.outputBackendSwitchFailed', { message }));
    }
  }, [
    appendLog,
    componentsState.outputBackendId,
    selectedBackend,
    t,
  ]);

  const handleApplyAudioInput = useCallback(async () => {
    const inputId = selectedInput.length > 0 ? selectedInput : null;

    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_INPUT_ID,
        inputId,
        TAURI_EVENTS.NATIVE_AUDIO_INPUT_ID_UPDATED
      );

      const payload = await invokeNativeDebug<unknown>(
        'native_audio_select_audio_input',
        { inputId },
        'debug.audio.audio-input.select'
      );
      const parsed = parseNativeAudioComponentsState(payload);
      setComponentsState(parsed);
      setSelectedInput(parsed.preferredInputId ?? '');

      appendLog(
        t('pages.native-debug.log.audioInputSelected', {
          inputId: parsed.preferredInputId ?? t('pages.native-debug.audioInput.auto'),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.audioInputSelectFailed', { message }));
    }
  }, [appendLog, selectedInput, t]);

  const handleRefreshOutputRoute = useCallback(async () => {
    try {
      await invokeNativeDebug(
        'native_audio_select_device',
        {
          deviceId: null,
          deviceName: null,
        },
        'debug.audio.output-device.refresh'
      );
      await broadcastSignal(TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_DEVICE_UPDATED);
      await handleRefreshAudioComponents();
      appendLog(
        t('pages.native-debug.log.outputDeviceSwitched', {
          device: t('pages.native-debug.outputDevice.default'),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.outputDeviceSwitchFailed', { message }));
    }
  }, [appendLog, handleRefreshAudioComponents, t]);

  const applyDspChain = useCallback(
    async (
      nextGainDb: number,
      nextEqBands: NativeDspEqBand[],
      logLine: string,
      nextLimiterEnabled: boolean = limiterEnabled,
      nextLimiterThresholdDb: number = limiterThresholdDb
    ) => {
      try {
        const chain: NativeDspNodeConfig[] = [
          { type: 'gain', db: nextGainDb },
          { type: 'eq', bands: nextEqBands },
        ];
        if (nextLimiterEnabled) {
          chain.push({ type: 'limiter', thresholdDb: nextLimiterThresholdDb });
        }

        await broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_DSP_CHAIN,
          chain,
          TAURI_EVENTS.NATIVE_AUDIO_DSP_CHAIN_UPDATED
        );
        await broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_GAIN_DB,
          nextGainDb,
          TAURI_EVENTS.NATIVE_AUDIO_GAIN_DB_UPDATED
        );
        await invokeNativeDebug('native_audio_set_dsp_chain', { chain }, 'debug.audio.dsp-chain.set');
        appendLog(logLine);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendLog(t('pages.native-debug.log.dspApplyFailed', { message }));
      }
    },
    [appendLog, limiterEnabled, limiterThresholdDb, t]
  );

  const handleGainChange = useCallback(
    async (db: number) => {
      setDspGainDb(db);
      await applyDspChain(db, eqBands, t('pages.native-debug.log.dspGainSet', { db: db.toFixed(1) }));
    },
    [applyDspChain, eqBands, t]
  );

  const handleEqBandGainChange = useCallback(
    async (index: number, gainDb: number) => {
      const next = eqBands.map((band, i) => (i === index ? { ...band, gainDb } : band));
      setEqBands(next);
      await applyDspChain(
        dspGainDb,
        next,
        t('pages.native-debug.log.eqBandSet', {
          index: index + 1,
          gainDb: gainDb.toFixed(1),
        })
      );
    },
    [applyDspChain, dspGainDb, eqBands, t]
  );

  const handleEqReset = useCallback(async () => {
    const next = eqBands.map((band) => ({ ...band, gainDb: 0 }));
    setEqBands(next);
    await applyDspChain(dspGainDb, next, t('pages.native-debug.log.eqReset'));
  }, [applyDspChain, dspGainDb, eqBands, t]);

  const handleLimiterToggle = useCallback(
    async (enabled: boolean) => {
      setLimiterEnabled(enabled);
      await applyDspChain(
        dspGainDb,
        eqBands,
        t('pages.native-debug.log.limiterToggle', {
          state: enabled ? t('common.state.on') : t('common.state.off'),
        }),
        enabled,
        limiterThresholdDb
      );
    },
    [applyDspChain, dspGainDb, eqBands, limiterThresholdDb, t]
  );

  const handleLimiterThresholdChange = useCallback(
    async (db: number) => {
      setLimiterThresholdDb(db);
      await applyDspChain(
        dspGainDb,
        eqBands,
        t('pages.native-debug.log.limiterThreshold', { db: db.toFixed(1) }),
        limiterEnabled,
        db
      );
    },
    [applyDspChain, dspGainDb, eqBands, limiterEnabled, t]
  );

  const handleApplyCrossfadeSettings = useCallback(async () => {
    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS,
        crossfadeSettings,
        TAURI_EVENTS.NATIVE_AUDIO_CROSSFADE_SETTINGS_UPDATED
      );
      appendLog(
        t('pages.native-debug.log.crossfadeUpdated', {
          state: crossfadeSettings.enabled ? t('common.state.on') : t('common.state.off'),
          durationMs: Math.round(crossfadeSettings.durationMs),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.crossfadeUpdateFailed', { message }));
    }
  }, [appendLog, crossfadeSettings, t]);

  const handleApplyReplayGainSettings = useCallback(async () => {
    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS,
        replayGainSettings,
        TAURI_EVENTS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS_UPDATED
      );

      const track = audioService.getState().currentTrack;
      const base =
        replayGainSettings.mode === 'album'
          ? track?.replayGainAlbumGainDb
          : track?.replayGainTrackGainDb;
      const hasBase = typeof base === 'number' && isFinite(base);
      const effective = replayGainSettings.enabled && hasBase ? base + replayGainSettings.preampDb : 0;

      await invokeNativeDebug('native_audio_set_replay_gain', {
        db: effective,
      }, 'debug.audio.replay-gain.set');

      appendLog(
        t('pages.native-debug.log.replayGainUpdated', {
          state: replayGainSettings.enabled ? t('common.state.on') : t('common.state.off'),
          mode: replayGainSettings.mode,
          preampDb: replayGainSettings.preampDb.toFixed(1),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.replayGainUpdateFailed', { message }));
    }
  }, [appendLog, audioService, replayGainSettings, t]);

  const handleApplyRuntimeControlSettings = useCallback(async () => {
    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS,
        runtimeControlSettings,
        TAURI_EVENTS.NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS_UPDATED
      );

      await invokeNativeDebug('native_audio_set_dynamic_gain_enabled', {
        enabled: runtimeControlSettings.dynamicGainEnabled,
      }, 'debug.audio.dynamic-gain.set');

      const track = audioService.getState().currentTrack;
      const base =
        replayGainSettings.mode === 'album'
          ? track?.replayGainAlbumGainDb
          : track?.replayGainTrackGainDb;
      const hasBase = typeof base === 'number' && isFinite(base);
      const effective = replayGainSettings.enabled && hasBase ? base + replayGainSettings.preampDb : 0;

      await invokeNativeDebug('native_audio_set_replay_gain', {
        db: effective,
      }, 'debug.audio.replay-gain.set');

      appendLog(t('settings.audioAdvanced.runtimeControl.applySuccess'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('settings.audioAdvanced.runtimeControl.applyFailed', { message }));
    }
  }, [appendLog, audioService, replayGainSettings, runtimeControlSettings, t]);

  const handleSelectTrack = useCallback(async () => {
    setIsSelectingFile(true);
    setLastError(null);
    try {
      const dialog = await import('@tauri-apps/api/dialog');
      const selected = await dialog.open({
        multiple: false,
        filters: [{ name: t('pages.native-debug.filePicker.filter.audioFiles'), extensions: SUPPORTED_EXTENSIONS }],
      });

      if (!selected) {
        appendLog(t('pages.native-debug.log.filePicker.cancelled'));
        return;
      }

      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof filePath !== 'string') {
        appendLog(t('pages.native-debug.log.filePicker.invalidSelection'));
        return;
      }

      const track: Track = {
        id: `native-${Date.now()}`,
        title: getFileName(filePath, t('common.unknown.audioFile')),
        filePath,
        path: filePath,
        originalPath: filePath,
      };

      audioService.clearQueue();
      audioService.addToQueue(track);
      appendLog(t('pages.native-debug.log.fileLoaded', { title: track.title }));
      await audioService.playTrackAtIndex(0);
      appendLog(t('pages.native-debug.log.playCommandSent'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      appendLog(t('pages.native-debug.log.fileLoadFailed', { message }));
    } finally {
      setIsSelectingFile(false);
    }
  }, [appendLog, audioService, t]);

  const handlePlay = useCallback(async () => {
    if (state.playbackState === 'paused' && state.currentTrack) {
      await audioService.play();
      appendLog(t('pages.native-debug.log.play.resumed'));
      return;
    }

    if (!state.currentTrack && state.queue.length > 0) {
      const index = state.currentIndex >= 0 ? state.currentIndex : 0;
      await audioService.playTrackAtIndex(index);
      appendLog(t('pages.native-debug.log.play.fromQueueIndex', { index }));
      return;
    }

    if (state.currentTrack) {
      await audioService.play();
      appendLog(t('pages.native-debug.log.play.currentTrack'));
      return;
    }

    appendLog(t('pages.native-debug.log.play.noTracks'));
  }, [audioService, appendLog, state.currentIndex, state.currentTrack, state.playbackState, state.queue.length, t]);

  const handleStop = useCallback(() => {
    audioService.stop();
    appendLog(t('pages.native-debug.log.stop'));
  }, [audioService, appendLog, t]);

  const handleNext = useCallback(async () => {
    await audioService.playNext();
    appendLog(t('pages.native-debug.log.play.next'));
  }, [audioService, appendLog, t]);

  const handlePrev = useCallback(async () => {
    await audioService.playPrevious();
    appendLog(t('pages.native-debug.log.play.prev'));
  }, [audioService, appendLog, t]);

  const handleVolumeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      audioService.setVolume(value);
      appendLog(t('pages.native-debug.log.volumeChanged', { value: value.toFixed(2) }));
    },
    [audioService, appendLog, t]
  );

  const handleToggleMute = useCallback(() => {
    audioService.toggleMute();
    appendLog(t('pages.native-debug.log.muteToggled'));
  }, [audioService, appendLog, t]);

  const handleTogglePlayPause = useCallback(async () => {
    if (state.playbackState === 'playing') {
      await audioService.pause();
      appendLog(t('pages.native-debug.log.pause'));
      return;
    }
    await handlePlay();
  }, [appendLog, handlePlay, audioService, state.playbackState, t]);

  const handleQueuePlay = useCallback(
    async (index: number) => {
      await audioService.playTrackAtIndex(index);
      appendLog(t('pages.native-debug.log.queue.playIndex', { index }));
    },
    [audioService, appendLog, t]
  );

  const handleQueueRemove = useCallback(
    (index: number) => {
      audioService.removeFromQueue(index);
      appendLog(t('pages.native-debug.log.queue.removeIndex', { index }));
    },
    [audioService, appendLog, t]
  );

  const handleClearQueue = useCallback(() => {
    audioService.clearQueue();
    appendLog(t('pages.native-debug.log.queue.cleared'));
  }, [audioService, appendLog, t]);

  const queueResidencyDiagnostics = useMemo(
    () => collectTrackResidencyDiagnostics(state.queue),
    [state.queue]
  );
  const playlistTrackResidencyDiagnostics = useMemo(
    () => collectTrackResidencyDiagnostics(state.playlists.flatMap((playlist) => playlist.tracks)),
    [state.playlists]
  );
  const currentTrackResidencyDiagnostics = useMemo(
    () => collectTrackResidencyDiagnostics(state.currentTrack ? [state.currentTrack] : []),
    [state.currentTrack]
  );
  const playlistDuplicationDiagnostics = useMemo(
    () => collectTrackDuplicationDiagnostics(state.queue, state.playlists, state.currentPlaylist),
    [state.currentPlaylist, state.playlists, state.queue]
  );
  const queuePathsPayloadDiagnostics = useMemo(() => {
    const queuePaths = state.queue
      .map((track) => track.filePath || track.path || track.originalPath || '')
      .filter((value) => value.length > 0);

    return {
      pathCount: queuePaths.length,
      totalChars: queuePaths.reduce((total, value) => total + value.length, 0),
      approxJsonBytes: measureJsonBytes(queuePaths),
    };
  }, [state.queue]);
  const playlistStateFootprint = useMemo(() => {
    const playlistSummaries = state.playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      kind: playlist.kind,
      readonly: playlist.readonly,
      trackCount: playlist.trackCount ?? playlist.tracks.length,
      loadedTrackCount: playlist.tracks.length,
      totalDuration: playlist.totalDuration ?? 0,
      updatedAt: playlist.updatedAt,
      tracksHydrated: playlist.tracksHydrated !== false,
    }));

    return {
      playlistCount: state.playlists.length,
      loadedTrackCount: state.playlists.reduce((total, playlist) => total + playlist.tracks.length, 0),
      approxJsonBytes: measureJsonBytes(state.playlists),
      approxSummaryJsonBytes: measureJsonBytes(playlistSummaries),
      currentPlaylistId: state.currentPlaylist?.id ?? null,
      currentPlaylistTrackCount: state.currentPlaylist?.tracks.length ?? 0,
      currentPlaylistJsonBytes: measureJsonBytes(state.currentPlaylist),
    };
  }, [state.currentPlaylist, state.playlists]);
  const audioStateJsonBytes = useMemo(() => measureJsonBytes(state), [state]);
  const processResidencyComparison = useMemo(() => {
    const webview2 = performanceSnapshot.webview2;
    const webview2PrivateBytes = webview2?.webview2PrivateBytes ?? null;
    const stateTrackedJsonBytes = audioStateJsonBytes;

    return {
      queueApproxJsonBytes: queueResidencyDiagnostics.approxJsonBytes,
      playlistApproxJsonBytes: playlistTrackResidencyDiagnostics.approxJsonBytes,
      currentTrackApproxJsonBytes: currentTrackResidencyDiagnostics.approxJsonBytes,
      audioStateApproxJsonBytes: stateTrackedJsonBytes,
      webview2PrivateBytes,
      webview2WorkingSetBytes: webview2?.webview2WorkingSetBytes ?? null,
      treePrivateBytes: webview2?.treePrivateBytes ?? null,
      treeWorkingSetBytes: webview2?.treeWorkingSetBytes ?? null,
      webview2CpuPercent: webview2?.webview2CpuPercent ?? null,
      privateBytesMinusAudioStateJsonBytes:
        webview2PrivateBytes != null ? Math.max(0, webview2PrivateBytes - stateTrackedJsonBytes) : null,
      privateBytesMinusQueueJsonBytes:
        webview2PrivateBytes != null
          ? Math.max(0, webview2PrivateBytes - queueResidencyDiagnostics.approxJsonBytes)
          : null,
    };
  }, [
    audioStateJsonBytes,
    currentTrackResidencyDiagnostics.approxJsonBytes,
    performanceSnapshot.webview2,
    playlistTrackResidencyDiagnostics.approxJsonBytes,
    queueResidencyDiagnostics.approxJsonBytes,
  ]);
  const playlistsOverlayResidencySummary = useMemo(
    () => ({
      latestSample: playlistsOverlayResidency.latestSample,
      samples: playlistsOverlayResidency.samples.slice(0, 8),
    }),
    [playlistsOverlayResidency]
  );

  const displayedDiagnostics = useMemo(
    () =>
      JSON.stringify(
        {
          retire: retireStats,
          currentBuffers: currentBufferDebugSnapshot,
          lastTrackSwitch: trackSwitchSnapshot,
          residency: {
            currentTrack: currentTrackResidencyDiagnostics,
            queue: queueResidencyDiagnostics,
            playlists: {
              ...playlistStateFootprint,
              ...playlistTrackResidencyDiagnostics,
            },
            logicalOverlap: playlistDuplicationDiagnostics,
          },
          stateFootprint: {
            audioStateJsonBytes,
            queuePaths: queuePathsPayloadDiagnostics,
          },
          processComparison: processResidencyComparison,
          playlistsOverlayResidency: playlistsOverlayResidencySummary,
          nativeAudio: {
            estimatedAudioBufferBytes: robustness.estimatedAudioBufferBytes ?? 0,
          },
        },
        null,
        2
      ),
    [
      audioStateJsonBytes,
      currentBufferDebugSnapshot,
      currentTrackResidencyDiagnostics,
      playlistDuplicationDiagnostics,
      playlistsOverlayResidencySummary,
      playlistStateFootprint,
      playlistTrackResidencyDiagnostics,
      processResidencyComparison,
      queuePathsPayloadDiagnostics,
      queueResidencyDiagnostics,
      robustness.estimatedAudioBufferBytes,
      retireStats,
      trackSwitchSnapshot,
    ]
  );
  const displayedState = useMemo(() => JSON.stringify(state, null, 2), [state]);
  const displayedRobustness = useMemo(() => JSON.stringify(robustness, null, 2), [robustness]);
  const diagnosticTimelineRows = useMemo(
    () =>
      (robustness.diagnosticTimeline ?? []).map((event) => {
        const timestamp = new Date(event.timestampMs).toLocaleTimeString(locale);
        return `${timestamp} #${event.seq} ${event.kind} value=${event.value} aux=${event.aux}`;
      }),
    [locale, robustness.diagnosticTimeline]
  );

  const outputMetricsUnavailableLabel = useMemo(() => {
    if (robustness.outputCallbackMetricsValid !== false) {
      return t('pages.native-debug.robustness.output.metricsUnavailable');
    }

    return t('pages.native-debug.robustness.output.metricsUnavailableWithBackend', {
      backend: robustness.outputBackendId ?? t('common.state.unknown'),
    });
  }, [robustness.outputBackendId, robustness.outputCallbackMetricsValid, t]);

  const outputMonitorStatusLabel = useMemo(() => {
    if (robustness.outputCallbackMetricsValid === true) {
      return t('pages.native-debug.robustness.monitor.output.enabled');
    }
    if (robustness.outputCallbackMetricsValid === false) {
      return t('pages.native-debug.robustness.monitor.output.disabled', {
        backend: robustness.outputBackendId ?? t('common.state.unknown'),
      });
    }
    return t('common.state.unknown');
  }, [robustness.outputBackendId, robustness.outputCallbackMetricsValid, t]);

  const transferMonitorStatusLabel = useMemo(() => {
    const activeInputId = componentsState.activeInputId;
    if (robustness.transferMetricsValid === true) {
      return t('pages.native-debug.robustness.monitor.transfer.enabled', {
        inputId: activeInputId ?? t('common.state.unknown'),
      });
    }

    return t('pages.native-debug.robustness.monitor.transfer.disabled', {
      inputId: activeInputId ?? t('common.state.unknown'),
    });
  }, [componentsState.activeInputId, robustness.transferMetricsValid, t]);

  const robustnessMetricsView = useMemo<NativeDebugRobustnessMetricsView>(() => {
    const unknown = t('common.state.unknown');

    const formatCount = (value?: number) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)).toString() : unknown;

    const formatSecondsValue = (value?: number | null) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;

    const formatSecondsLabel = (value?: number | null) => {
      const normalized = formatSecondsValue(value);
      return normalized === null ? unknown : `${normalized.toFixed(2)} s`;
    };

    const formatUs = (value?: number) =>
      typeof value === 'number' && Number.isFinite(value) ? `${Math.max(0, Math.floor(value))} us` : unknown;

    const formatBytes = (value?: number) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return unknown;
      const normalized = Math.max(0, value);
      if (normalized >= 1024 * 1024) return `${(normalized / (1024 * 1024)).toFixed(2)} MiB`;
      if (normalized >= 1024) return `${(normalized / 1024).toFixed(2)} KiB`;
      return `${Math.floor(normalized)} B`;
    };

    const outputMetric = (value?: number, unit: 'count' | 'us' = 'count') => {
      if (robustness.outputCallbackMetricsValid === false) {
        return outputMetricsUnavailableLabel;
      }
      return unit === 'us' ? formatUs(value) : formatCount(value);
    };

    const srcBackend =
      robustness.srcBackend === 'rubato'
        ? t('pages.native-debug.src.backend.rubato')
        : robustness.srcBackend === 'linear-simd'
          ? t('pages.native-debug.src.backend.linear-simd')
          : unknown;

    const stability =
      robustness.stabilityProfile === 'low-latency'
        ? t('settings.audioAdvanced.enginePolicy.stabilityProfile.lowLatency')
        : robustness.stabilityProfile === 'balanced'
          ? t('settings.audioAdvanced.enginePolicy.stabilityProfile.balanced')
          : robustness.stabilityProfile === 'stable'
            ? t('settings.audioAdvanced.enginePolicy.stabilityProfile.stable')
            : robustness.stabilityProfile === 'game-safe'
            ? t('settings.audioAdvanced.enginePolicy.stabilityProfile.gameSafe')
              : robustness.stabilityProfile === 'safe-mode'
                ? t('settings.audioAdvanced.enginePolicy.stabilityProfile.safeMode')
                : unknown;

    const stabilityActionProfile =
      robustness.stabilityActionProfile === 'guarded'
        ? t('pages.native-debug.robustness.stability.action.guarded')
        : robustness.stabilityActionProfile === 'critical'
          ? t('pages.native-debug.robustness.stability.action.critical')
          : robustness.stabilityActionProfile === 'normal'
            ? t('pages.native-debug.robustness.stability.action.normal')
            : unknown;

    const sourcePrepareProfile =
      robustness.sourcePrepareProfile === 'steady'
        ? t('pages.native-debug.robustness.stability.sourcePrepare.steady')
        : robustness.sourcePrepareProfile === 'aggressive'
          ? t('pages.native-debug.robustness.stability.sourcePrepare.aggressive')
          : robustness.sourcePrepareProfile === 'failsafe'
            ? t('pages.native-debug.robustness.stability.sourcePrepare.failsafe')
            : robustness.sourcePrepareProfile === 'baseline'
              ? t('pages.native-debug.robustness.stability.sourcePrepare.baseline')
              : unknown;

    const stabilityHintProfile =
      robustness.stabilityHintProfile === 'guarded'
        ? t('pages.native-debug.robustness.stability.action.guarded')
        : robustness.stabilityHintProfile === 'critical'
          ? t('pages.native-debug.robustness.stability.action.critical')
          : robustness.stabilityHintProfile === 'normal'
            ? t('pages.native-debug.robustness.stability.action.normal')
            : t('pages.native-debug.robustness.stability.reason.none');

    const formatStabilityReason = (reason?: string | null) => {
      if (typeof reason !== 'string' || reason.length === 0) {
        return t('pages.native-debug.robustness.stability.reason.none');
      }

      switch (reason) {
        case 'buffer-critical':
          return t('pages.native-debug.robustness.stability.reason.buffer-critical');
        case 'buffer-guarded':
          return t('pages.native-debug.robustness.stability.reason.buffer-guarded');
        case 'underrun-recovery':
          return t('pages.native-debug.robustness.stability.reason.underrun-recovery');
        case 'shared-stress':
          return t('pages.native-debug.robustness.stability.reason.shared-stress');
        case 'output-wait-timeout':
          return t('pages.native-debug.robustness.stability.reason.output-wait-timeout');
        case 'output-render-underrun':
          return t('pages.native-debug.robustness.stability.reason.output-render-underrun');
        case 'output-callback-overrun':
          return t('pages.native-debug.robustness.stability.reason.output-callback-overrun');
        case 'shared-render-underrun':
          return t('pages.native-debug.robustness.stability.reason.shared-render-underrun');
        case 'shared-render-low-watermark':
          return t('pages.native-debug.robustness.stability.reason.shared-render-low-watermark');
        case 'shared-render-jitter':
          return t('pages.native-debug.robustness.stability.reason.shared-render-jitter');
        case 'transfer-low-watermark':
          return t('pages.native-debug.robustness.stability.reason.transfer-low-watermark');
        case 'control-queue-overflow':
          return t('pages.native-debug.robustness.stability.reason.control-queue-overflow');
        case 'memory-pressure':
          return t('pages.native-debug.robustness.stability.reason.memory-pressure');
        case 'memory-lock-failure':
          return t('pages.native-debug.robustness.stability.reason.memory-lock-failure');
        case 'memory-lock-skipped':
          return t('pages.native-debug.robustness.stability.reason.memory-lock-skipped');
        case 'memory-pool-growth':
          return t('pages.native-debug.robustness.stability.reason.memory-pool-growth');
        case 'source-prepare-warmup':
          return t('pages.native-debug.robustness.stability.reason.source-prepare-warmup');
        case 'platform-cache-materializing':
          return t('pages.native-debug.robustness.stability.reason.platform-cache-materializing');
        case 'foreground-heavy-app-start':
          return t('pages.native-debug.robustness.stability.reason.foreground-heavy-app-start');
        default:
          return reason;
      }
    };

    const stabilityPrimaryReason = formatStabilityReason(robustness.stabilityPrimaryReason);
    const stabilityReasonCodes =
      Array.isArray(robustness.stabilityReasonCodes) && robustness.stabilityReasonCodes.length > 0
        ? robustness.stabilityReasonCodes.map((reason) => formatStabilityReason(reason)).join(', ')
        : t('pages.native-debug.robustness.stability.reason.none');
    const stabilityHintPrimaryReason = formatStabilityReason(robustness.stabilityHintPrimaryReason);
    const stabilityHintReasonCodes =
      Array.isArray(robustness.stabilityHintReasonCodes) &&
      robustness.stabilityHintReasonCodes.length > 0
        ? robustness.stabilityHintReasonCodes
            .map((reason) => formatStabilityReason(reason))
            .join(', ')
        : t('pages.native-debug.robustness.stability.reason.none');

    const quantization =
      robustness.outputQuantizationMode === 'tpdf'
        ? 'TPDF Dither'
        : robustness.outputQuantizationMode === 'round'
          ? 'Round'
          : unknown;

    const bufferNowValue = formatSecondsValue(robustness.bufferedAheadSeconds) ?? 0;
    const decodeBufferNowValue =
      formatSecondsValue(robustness.decodeBufferedAheadSeconds) ?? 0;
    const outputBufferNowValue =
      formatSecondsValue(robustness.outputBufferedAheadSeconds) ?? 0;
    const bufferReferenceValue =
      typeof robustness.bufferedAheadMinSeconds === 'number' &&
      Number.isFinite(robustness.bufferedAheadMinSeconds) &&
      robustness.bufferedAheadMinSeconds > 0
        ? Math.max(robustness.bufferedAheadMinSeconds * 2, 0.5)
        : 1.5;

    const bufferPercent = Math.round(Math.max(0, Math.min((bufferNowValue / bufferReferenceValue) * 100, 100)));
    const bufferStatus =
      bufferNowValue < 0.15
        ? t('settings.audioAdvanced.monitor.bufferStatus.low')
        : bufferNowValue < 0.4
          ? t('settings.audioAdvanced.monitor.bufferStatus.guard')
          : t('settings.audioAdvanced.monitor.bufferStatus.stable');

    const outputSampleRate =
      typeof robustness.outputSampleRate === 'number' && Number.isFinite(robustness.outputSampleRate)
        ? `${Math.floor(robustness.outputSampleRate)} Hz`
        : unknown;
    const controlQueueMode =
      typeof robustness.controlQueueMode === 'string' && robustness.controlQueueMode.length > 0
        ? robustness.controlQueueMode
        : unknown;
    const trimStateLabel =
      robustness.lastWorkingSetTrimSucceeded === true
        ? t('pages.native-debug.robustness.workingSetTrim.success')
        : robustness.lastWorkingSetTrimSucceeded === false
          ? t('pages.native-debug.robustness.workingSetTrim.failed')
          : unknown;
    const lastWorkingSetTrim =
      typeof robustness.lastWorkingSetTrimAtMs === 'number' &&
      Number.isFinite(robustness.lastWorkingSetTrimAtMs)
        ? `${new Date(robustness.lastWorkingSetTrimAtMs).toLocaleTimeString(locale)} · ${
            robustness.lastWorkingSetTrimTarget ?? unknown
          } · ${trimStateLabel} · ${robustness.lastWorkingSetTrimReason ?? unknown}`
        : unknown;

    return {
      backend: robustness.outputBackendId ?? unknown,
      scheduler: robustness.schedulerProfile ?? unknown,
      stability,
      stabilityActionProfile,
      sourcePrepareProfile,
      stabilityHintProfile,
      stabilityPrimaryReason,
      stabilityReasonCodes,
      stabilityHintPrimaryReason,
      stabilityHintReasonCodes,
      transport: robustness.transportMode ?? unknown,
      srcBackend,
      quantization,
      outputMonitorStatus: outputMonitorStatusLabel,
      transferMonitorStatus: transferMonitorStatusLabel,
      callbackP99: outputMetric(robustness.outputCallbackP99Us, 'us'),
      callbackJitterP99: outputMetric(robustness.outputCallbackIntervalJitterP99Us, 'us'),
      waitTimeout: outputMetric(robustness.outputWaitTimeoutCount),
      callbackOverrun: outputMetric(robustness.outputCallbackIntervalOverrunCount),
      outputUnderrunEvents: outputMetric(robustness.outputRenderUnderrunEvents),
      outputUnderrunFrames: outputMetric(robustness.outputRenderUnderrunFrames),
      bufferPercent,
      bufferStatus,
      bufferNow: formatSecondsLabel(robustness.bufferedAheadSeconds),
      decodeBufferNow: formatSecondsLabel(decodeBufferNowValue),
      outputBufferNow: formatSecondsLabel(outputBufferNowValue),
      bufferMin: formatSecondsLabel(robustness.bufferedAheadMinSeconds),
      bufferAvg: formatSecondsLabel(robustness.bufferedAheadAvgSeconds),
      rebuffer: formatCount(robustness.rebufferCount),
      remoteNetworkRebuffer: `${formatCount(
        robustness.remoteNetworkRebufferWaitCount
      )} / ${formatCount(robustness.remoteNetworkRebufferTimeoutCount)}`,
      remoteHttpRetry: formatCount(robustness.remoteHttpRetryCount),
      remoteRange: `${formatCount(robustness.remoteRangeRequestCount)} / ${formatCount(
        robustness.remoteRangeSeekCount
      )} / ${formatCount(robustness.remoteRangeIgnoredCount)}`,
      remoteUrlRefresh: `${formatCount(robustness.remoteUrlRefreshNeededCount)} / ${formatCount(
        robustness.remoteUrlRefreshUnavailableCount
      )}`,
      audioRenderUnderrunDiagnostics: `${formatCount(
        robustness.audioRenderUnderrunDiagnosticCount
      )} / ${formatCount(robustness.audioRenderUnderrunDiagnosticFrames)} ${t(
        'pages.native-debug.robustness.unit.frames'
      )}`,
      engineUnderrunEvents: formatCount(robustness.underrunEvents),
      engineUnderrunWindow: formatCount(robustness.underrunEventsWindow),
      outputSampleRate,
      transferLowWatermark: formatCount(robustness.transferLowWatermarkSamples),
      transferRenderLowHits: formatCount(robustness.transferRenderLowHitCount),
      transferDecodeLowHits: formatCount(robustness.transferDecodeLowHitCount),
      pageLockAttemptedBytes: formatBytes(robustness.renderQueuePageLockAttemptedBytes),
      pageLockSucceededBytes: formatBytes(robustness.renderQueuePageLockSucceededBytes),
      pageLockFailedBytes: formatBytes(robustness.renderQueuePageLockFailedBytes),
      pageLockFailureCount: formatCount(robustness.renderQueuePageLockFailureCount),
      memoryPoolF32GrowthEvents: formatCount(robustness.memoryPoolF32GrowthEvents),
      memoryPoolF32GrowthBytes: formatBytes(robustness.memoryPoolF32GrowthBytes),
      memoryPoolF32PrewarmHits: formatCount(robustness.memoryPoolF32PrewarmHits),
      realtimeMemoryLockAttemptedBytes: formatBytes(robustness.realtimeMemoryLockAttemptedBytes),
      realtimeMemoryLockSucceededBytes: formatBytes(robustness.realtimeMemoryLockSucceededBytes),
      realtimeMemoryLockFailedBytes: formatBytes(robustness.realtimeMemoryLockFailedBytes),
      realtimeMemoryLockSkippedBytes: formatBytes(robustness.realtimeMemoryLockSkippedBytes),
      realtimeMemoryLockFailureCount: formatCount(robustness.realtimeMemoryLockFailureCount),
      realtimeMemoryLockSkippedCount: formatCount(robustness.realtimeMemoryLockSkippedCount),
      realtimeMemoryRoleMasks: `${formatCount(robustness.realtimeMemoryLockedRoleMask)} / ${formatCount(
        robustness.realtimeMemoryFailedRoleMask
      )} / ${formatCount(robustness.realtimeMemorySkippedRoleMask)}`,
      realtimeMemoryPressureEvents: formatCount(robustness.realtimeMemoryPressureEvents),
      controlQueueMode,
      controlQueueCapacity: formatCount(robustness.controlQueueCapacity),
      controlQueueOverwriteEvents: formatCount(robustness.controlQueueOverwriteEvents),
      controlQueueDropNewestEvents: formatCount(robustness.controlQueueDropNewestEvents),
      controlQueueCoalescedOverflowEvents: formatCount(
        robustness.controlQueueCoalescedOverflowEvents
      ),
      controlQueueCriticalOverflowEvents: formatCount(robustness.controlQueueCriticalOverflowEvents),
      dspRefillBudgetExceededCount: formatCount(robustness.dspRefillBudgetExceededCount),
      dspRefillBudgetExceededLast:
        typeof robustness.dspRefillBudgetExceededLastUs === 'number' &&
        Number.isFinite(robustness.dspRefillBudgetExceededLastUs) &&
        typeof robustness.dspRefillBudgetExceededLastBudgetUs === 'number' &&
        Number.isFinite(robustness.dspRefillBudgetExceededLastBudgetUs)
          ? `${Math.max(0, Math.floor(robustness.dspRefillBudgetExceededLastUs))} / ${Math.max(
              0,
              Math.floor(robustness.dspRefillBudgetExceededLastBudgetUs)
            )} us`
          : unknown,
      vstBridgeFailureCount: formatCount(robustness.vstBridgeFailureCount),
      vstBridgeWriteBackpressureCount: formatCount(robustness.vstBridgeWriteBackpressureCount),
      vstBridgeStallCount: formatCount(robustness.vstBridgeStallCount),
      vstBridgeRestartAttemptCount: formatCount(robustness.vstBridgeRestartAttemptCount),
      vstSidecarCallbackLockMiss: `${formatCount(
        robustness.vstSidecarCallbackLockMissCount
      )} / ${formatCount(robustness.vstSidecarCallbackLockMissFrames)} ${t(
        'pages.native-debug.robustness.unit.frames'
      )}`,
      vstSidecarDryBypassFrames: formatCount(robustness.vstSidecarDryBypassFrames),
      vstSidecarOutputBackpressure: `${formatCount(
        robustness.vstSidecarOutputBackpressureCount
      )} / ${formatCount(robustness.vstSidecarOutputBackpressureFrames)} ${t(
        'pages.native-debug.robustness.unit.frames'
      )}`,
      lastWorkingSetTrim,
    };
  }, [
    locale,
    outputMetricsUnavailableLabel,
    outputMonitorStatusLabel,
    robustness,
    t,
    transferMonitorStatusLabel,
  ]);

  const lastAutoSwitchLabel = useMemo(() => {
    if (!robustness.lastAutoSwitchAtMs) {
      return t('pages.native-debug.robustness.lastAutoSwitch.none');
    }

    const timestamp = new Date(robustness.lastAutoSwitchAtMs).toLocaleTimeString(locale);
    const reason = robustness.lastAutoSwitchReason || t('common.state.unknown');
    return t('pages.native-debug.robustness.lastAutoSwitch.value', { timestamp, reason });
  }, [locale, robustness.lastAutoSwitchAtMs, robustness.lastAutoSwitchReason, t]);

  const formatSeconds = useCallback(
    (value: number | null): string => {
      if (typeof value !== 'number' || !isFinite(value)) {
        return t('common.state.unknown');
      }
      return `${value.toFixed(2)}s`;
    },
    [t]
  );

  if (!isNativeEngine) {
    return (
      <div className="native-debug-page">
        <div className="native-debug-card native-debug-warning">
          <h2>{t('pages.native-debug.notNative.title')}</h2>
          <p>{t('pages.native-debug.notNative.desc')}</p>
        </div>
      </div>
    );
  }

  const eqBandKindLabel = (kind: NativeDspEqBandKind) => {
    if (kind === 'low-shelf') return t('pages.native-debug.eq.kind.lowShelf');
    if (kind === 'high-shelf') return t('pages.native-debug.eq.kind.highShelf');
    return t('pages.native-debug.eq.kind.peaking');
  };

  return (
    <div className="native-debug-page">
      <div className="native-debug-layout">
        <section className="native-debug-card native-debug-controls">
          <header>
            <div>
              <p className="section-label">{t('pages.native-debug.section.controls')}</p>
              <h2>{t('pages.native-debug.title')}</h2>
            </div>
            <span className={`state-pill state-${state.playbackState}`}>{state.playbackState}</span>
          </header>

          <NativeDebugPlaybackDspPanel
            t={t}
            state={state}
            currentTrackLabel={currentTrackLabel}
            isSelectingFile={isSelectingFile}
            dspGainDb={dspGainDb}
            crossfadeSettings={crossfadeSettings}
            replayGainSettings={replayGainSettings}
            runtimeControlSettings={runtimeControlSettings}
            nativeMeta={nativeMeta}
            eqBands={eqBands}
            limiterEnabled={limiterEnabled}
            limiterThresholdDb={limiterThresholdDb}
            setCrossfadeSettings={setCrossfadeSettings}
            setReplayGainSettings={setReplayGainSettings}
            setRuntimeControlSettings={setRuntimeControlSettings}
            handleSelectTrack={handleSelectTrack}
            handlePrev={handlePrev}
            handleTogglePlayPause={handleTogglePlayPause}
            handleStop={handleStop}
            handleNext={handleNext}
            handleVolumeChange={handleVolumeChange}
            handleToggleMute={handleToggleMute}
            handleGainChange={handleGainChange}
            handleApplyCrossfadeSettings={handleApplyCrossfadeSettings}
            handleApplyReplayGainSettings={handleApplyReplayGainSettings}
            handleApplyRuntimeControlSettings={handleApplyRuntimeControlSettings}
            eqBandKindLabel={eqBandKindLabel}
            handleEqReset={handleEqReset}
            handleEqBandGainChange={handleEqBandGainChange}
            handleLimiterToggle={handleLimiterToggle}
            handleLimiterThresholdChange={handleLimiterThresholdChange}
          />

          <NativeDebugEnginePanel
            t={t}
            componentsState={componentsState}
            selectedBackend={selectedBackend}
            outputBackends={outputBackends}
            selectedInput={selectedInput}
            audioInputs={audioInputs}
            srcPresetId={srcPresetId}
            tuningProfileId={tuningProfileId}
            srcMode={srcMode}
            srcBackend={srcBackend}
            srcTargetRate={srcTargetRate}
            dynamicSrcSettings={dynamicSrcSettings}
            nativeMeta={nativeMeta}
            isPlaying={state.playbackState === 'playing'}
            getFrequencyData={getFrequencyData}
            setSelectedBackend={setSelectedBackend}
            setSelectedInput={setSelectedInput}
            setSrcMode={setSrcMode}
            setSrcBackend={setSrcBackend}
            setSrcTargetRate={setSrcTargetRate}
            setDynamicSrcSettings={setDynamicSrcSettings}
            handleRefreshAudioComponents={handleRefreshAudioComponents}
            handleApplyOutputBackend={handleApplyOutputBackend}
            handleApplyAudioInput={handleApplyAudioInput}
            handleApplySrcPreset={handleApplySrcPreset}
            handleApplyTuningProfile={handleApplyTuningProfile}
            handleApplySrcPolicy={handleApplySrcPolicy}
            applyDynamicSrcAutoSettings={applyDynamicSrcAutoSettings}
            handleRefreshOutputRoute={handleRefreshOutputRoute}
          />
          <NativeDebugRobustnessPanel
            t={t}
            robustness={robustness}
            robustnessMetricsView={robustnessMetricsView}
            outputMetricsUnavailableLabel={outputMetricsUnavailableLabel}
            formatSeconds={formatSeconds}
            lastAutoSwitchLabel={lastAutoSwitchLabel}
            diagnosticTimelineRows={diagnosticTimelineRows}
            displayedRobustness={displayedRobustness}
          />
          <NativeDebugQueuePanel
            t={t}
            queue={state.queue}
            currentIndex={state.currentIndex}
            lastError={lastError}
            onClearQueue={handleClearQueue}
            onPlayAtIndex={handleQueuePlay}
            onRemoveAtIndex={handleQueueRemove}
          />
        </section>
        <NativeDebugStatePanel
          t={t}
          displayedDiagnostics={displayedDiagnostics}
          displayedState={displayedState}
          logs={logs}
        />
      </div>
    </div>
  );
};


