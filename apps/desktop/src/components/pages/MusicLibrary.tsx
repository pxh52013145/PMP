import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Track } from '../../services/audio';
import {
  musicLibraryService,
  LibraryStats,
  ScanProgress,
  ViewMode,
  LibraryPath,
  LibraryPathHealth,
  AlbumSummary,
  CoverRuntimeCachePolicy,
  CloudFallbackTaskStatus,
  CloudHashJobStatus,
} from '../../services/audio/MusicLibraryService';
import { ConfirmDialog } from '../magnet/ConfirmDialog';
import { ContextMenu, ContextMenuItem } from '../magnet/ContextMenu';
import { useNavigation } from '../../contexts/NavigationContext';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { readJson, writeJson } from '../../modules/storage';
import {
  MUSIC_LIBRARY_SOURCE_CHANGE_EVENT,
  type MusicLibrarySourceChangeDetail,
  type MusicLibrarySourceMode,
} from '../../contracts/musicLibrarySource';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { useLocale, useT } from '../../i18n';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import './MusicLibrary.css';

interface MusicLibraryProps {
  isOpen?: boolean;
  onClose?: () => void;
  onAddToQueue?: (tracks: Track[]) => void;
  onPlayNow?: (tracks: Track[], startIndex?: number) => void;
  embedded?: boolean; // 閺勵垰鎯佸畵灞藉弳濡€崇础閿涘牆婀狽avigationPage娑擃叏绱?
}

// 閴?濡€虫健缁狙呯处鐎涙﹫绱扮捄銊х矋娴犺泛鐤勬笟瀣彙娴滎偓绱濇稉宥勭窗閸ョ姳璐熺紒鍕閸楁瓕娴囬懓灞兼丢婢?
type ModuleCacheSnapshot = {
  tracks: Track[];
  artists: string[];
  albums: AlbumSummary[];
  genres: string[];
  trackNextOffset: number;
  hasMoreTracks: boolean;
  timestamp: number;
};

let moduleCache: ModuleCacheSnapshot | null = null;

// ? 濡€虫健缁狙勭泊閸斻劋缍呯純顔剧处鐎涙﹫绱伴幐?viewMode 鐠佹澘绻傛稉缁樼泊閸斻劍娼担宥囩枂娑撳酣鏁嬮悙鐧哥礄鐠恒劑銆夐棃銏ｇ儲鏉?缂佸嫪娆㈤崡姝屾祰娣囨繃瀵旈敍?
type MainScrollAnchor =
  | { kind: 'track'; id: string; offset: number }
  | { kind: 'album'; key: string; offset: number };

type MainScrollRootKind = 'main' | 'navigation';
type MainScrollMemory = { scrollTop: number; anchor?: MainScrollAnchor; rootKind?: MainScrollRootKind };

type ViewScrollMemory = Partial<Record<ViewMode, MainScrollMemory>>;
const moduleScrollMemory: ViewScrollMemory = {};
let moduleLastViewMode: ViewMode | null = null;

type SidebarViewMode = Extract<ViewMode, 'artists' | 'genres'>;

type StableLibraryEntry = Awaited<ReturnType<typeof musicLibraryService.listCloudLibraryEntries>>[number];
type StableFallbackTask = Awaited<ReturnType<typeof musicLibraryService.listCloudFallbackTasks>>[number];
type StableHashJob = Awaited<ReturnType<typeof musicLibraryService.listCloudHashJobs>>[number];

type LocalTrackColumnId =
  | 'title'
  | 'artist'
  | 'album'
  | 'duration'
  | 'year'
  | 'genre'
  | 'trackNumber'
  | 'discNumber'
  | 'composer'
  | 'bitrate'
  | 'sampleRate'
  | 'format'
  | 'playCount'
  | 'lastPlayed'
  | 'rating'
  | 'fileSize'
  | 'dateAdded';

type LocalTrackColumnConfig = {
  id: LocalTrackColumnId;
  visible: boolean;
  widthPx?: number;
};

type LocalTrackColumnDefinition = {
  headerKey: string;
  defaultWidthPx: number;
  minWidthPx: number;
  maxWidthPx?: number;
  className: string;
};

type LocalTrackColumnResizeSession = {
  pointerId: number;
  columnId: LocalTrackColumnId;
  startClientX: number;
  startWidthPx: number;
};

type LocalTrackColumnReorderSession = {
  pointerId: number;
  columnId: LocalTrackColumnId;
  startClientX: number;
  startClientY: number;
  dragging: boolean;
};

type StableFallbackAuditEntry = {
  atMs: number;
  request: {
    entryId: string;
    ownerUid: string;
    cloudContentId?: string;
    trackId?: string;
    quickFingerprint?: string;
    requestedAtMs: number;
    reason?: string;
  };
  dispatch: {
    accepted: boolean;
    deduped: boolean;
    queueSize: number;
  };
};

type StableFallbackAuditSnapshot = {
  stats: {
    totalEvents: number;
    acceptedEvents: number;
    dedupedEvents: number;
    rejectedEvents: number;
    lastQueuedAtMs?: number;
  };
  recent: StableFallbackAuditEntry[];
};

const LOCAL_TRACK_COLUMN_ORDER: LocalTrackColumnId[] = [
  'title',
  'artist',
  'album',
  'duration',
  'year',
  'genre',
  'trackNumber',
  'discNumber',
  'composer',
  'bitrate',
  'sampleRate',
  'format',
  'playCount',
  'lastPlayed',
  'rating',
  'fileSize',
  'dateAdded',
];

const DEFAULT_VISIBLE_LOCAL_TRACK_COLUMNS = new Set<LocalTrackColumnId>([
  'title',
  'artist',
  'album',
  'duration',
]);

const LOCAL_TRACK_COLUMN_DEFINITIONS: Record<LocalTrackColumnId, LocalTrackColumnDefinition> = {
  title: {
    headerKey: 'pages.music-library.tracks.header.title',
    defaultWidthPx: 280,
    minWidthPx: 160,
    maxWidthPx: 640,
    className: 'music-library-track-title',
  },
  artist: {
    headerKey: 'pages.music-library.tracks.header.artist',
    defaultWidthPx: 220,
    minWidthPx: 120,
    maxWidthPx: 520,
    className: 'music-library-track-artist',
  },
  album: {
    headerKey: 'pages.music-library.tracks.header.album',
    defaultWidthPx: 220,
    minWidthPx: 120,
    maxWidthPx: 520,
    className: 'music-library-track-album',
  },
  duration: {
    headerKey: 'pages.music-library.tracks.header.duration',
    defaultWidthPx: 84,
    minWidthPx: 72,
    maxWidthPx: 140,
    className: 'music-library-track-duration',
  },
  year: {
    headerKey: 'pages.music-library.columns.year',
    defaultWidthPx: 80,
    minWidthPx: 60,
    maxWidthPx: 120,
    className: 'music-library-track-meta music-library-track-meta-number',
  },
  genre: {
    headerKey: 'pages.music-library.columns.genre',
    defaultWidthPx: 160,
    minWidthPx: 100,
    maxWidthPx: 360,
    className: 'music-library-track-meta',
  },
  trackNumber: {
    headerKey: 'pages.music-library.columns.trackNumber',
    defaultWidthPx: 84,
    minWidthPx: 68,
    maxWidthPx: 120,
    className: 'music-library-track-meta music-library-track-meta-number',
  },
  discNumber: {
    headerKey: 'pages.music-library.columns.discNumber',
    defaultWidthPx: 84,
    minWidthPx: 68,
    maxWidthPx: 120,
    className: 'music-library-track-meta music-library-track-meta-number',
  },
  composer: {
    headerKey: 'pages.music-library.columns.composer',
    defaultWidthPx: 180,
    minWidthPx: 120,
    maxWidthPx: 420,
    className: 'music-library-track-meta',
  },
  bitrate: {
    headerKey: 'pages.music-library.columns.bitrate',
    defaultWidthPx: 110,
    minWidthPx: 88,
    maxWidthPx: 160,
    className: 'music-library-track-meta music-library-track-meta-number',
  },
  sampleRate: {
    headerKey: 'pages.music-library.columns.sampleRate',
    defaultWidthPx: 126,
    minWidthPx: 96,
    maxWidthPx: 180,
    className: 'music-library-track-meta music-library-track-meta-number',
  },
  format: {
    headerKey: 'pages.music-library.columns.format',
    defaultWidthPx: 100,
    minWidthPx: 82,
    maxWidthPx: 160,
    className: 'music-library-track-meta music-library-track-meta-code',
  },
  playCount: {
    headerKey: 'pages.music-library.columns.playCount',
    defaultWidthPx: 100,
    minWidthPx: 76,
    maxWidthPx: 140,
    className: 'music-library-track-meta music-library-track-meta-number',
  },
  lastPlayed: {
    headerKey: 'pages.music-library.columns.lastPlayed',
    defaultWidthPx: 180,
    minWidthPx: 130,
    maxWidthPx: 360,
    className: 'music-library-track-meta',
  },
  rating: {
    headerKey: 'pages.music-library.columns.rating',
    defaultWidthPx: 84,
    minWidthPx: 64,
    maxWidthPx: 120,
    className: 'music-library-track-meta music-library-track-meta-number',
  },
  fileSize: {
    headerKey: 'pages.music-library.columns.fileSize',
    defaultWidthPx: 120,
    minWidthPx: 96,
    maxWidthPx: 180,
    className: 'music-library-track-meta music-library-track-meta-number',
  },
  dateAdded: {
    headerKey: 'pages.music-library.columns.dateAdded',
    defaultWidthPx: 180,
    minWidthPx: 130,
    maxWidthPx: 360,
    className: 'music-library-track-meta',
  },
};

const LOCAL_TRACK_INDEX_COLUMN_WIDTH_PX = 40;
const LOCAL_TRACK_ACTIONS_COLUMN_WIDTH_PX = 72;
const LOCAL_TRACK_GRID_GAP_PX = 10;
const LOCAL_TRACK_TITLE_MAX_VIEWPORT_RATIO = 0.5;

const DEFAULT_LOCAL_TRACK_COLUMN_SETTINGS: LocalTrackColumnConfig[] = LOCAL_TRACK_COLUMN_ORDER.map((id) => ({
  id,
  visible: DEFAULT_VISIBLE_LOCAL_TRACK_COLUMNS.has(id),
  widthPx: LOCAL_TRACK_COLUMN_DEFINITIONS[id].defaultWidthPx,
}));

const STABLE_FALLBACK_STATUS_OPTIONS: CloudFallbackTaskStatus[] = [
  'queued',
  'dispatching',
  'resolved',
  'failed',
  'cancelled',
];

const STABLE_HASH_STATUS_OPTIONS: CloudHashJobStatus[] = ['pending', 'running', 'completed', 'failed'];

const STABLE_FALLBACK_AUDIT_MAX = 120;

function isLocalTrackColumnId(value: unknown): value is LocalTrackColumnId {
  return typeof value === 'string' && LOCAL_TRACK_COLUMN_ORDER.includes(value as LocalTrackColumnId);
}

function normalizeLocalTrackColumnWidth(columnId: LocalTrackColumnId, widthPx: unknown): number {
  const definition = LOCAL_TRACK_COLUMN_DEFINITIONS[columnId];
  const fallback = definition.defaultWidthPx;
  if (typeof widthPx !== 'number' || !Number.isFinite(widthPx)) {
    return fallback;
  }

  const rounded = Math.round(widthPx);
  const min = definition.minWidthPx;
  const max = definition.maxWidthPx;

  if (typeof max === 'number') {
    return Math.min(max, Math.max(min, rounded));
  }
  return Math.max(min, rounded);
}

function normalizeLocalTrackColumnSettings(input: unknown): LocalTrackColumnConfig[] {
  const orderedIds: LocalTrackColumnId[] = [];
  const visibilityMap = new Map<LocalTrackColumnId, boolean>();
  const widthMap = new Map<LocalTrackColumnId, number>();
  let hasExplicitVisibility = false;

  if (Array.isArray(input)) {
    for (const item of input) {
      if (isLocalTrackColumnId(item)) {
        if (!orderedIds.includes(item)) orderedIds.push(item);
        visibilityMap.set(item, true);
        continue;
      }

      if (!item || typeof item !== 'object') continue;
      const rawId = (item as { id?: unknown }).id;
      if (!isLocalTrackColumnId(rawId)) continue;
      if (!orderedIds.includes(rawId)) orderedIds.push(rawId);
      const rawVisible = (item as { visible?: unknown }).visible;
      const visible = typeof rawVisible === 'boolean' ? rawVisible : true;
      const rawWidthPx = (item as { widthPx?: unknown }).widthPx;
      visibilityMap.set(rawId, visible);
      widthMap.set(rawId, normalizeLocalTrackColumnWidth(rawId, rawWidthPx));
      hasExplicitVisibility = true;
    }
  }

  if (orderedIds.length === 0) {
    return DEFAULT_LOCAL_TRACK_COLUMN_SETTINGS.map((item) => ({ ...item }));
  }

  for (const id of LOCAL_TRACK_COLUMN_ORDER) {
    if (!orderedIds.includes(id)) {
      orderedIds.push(id);
    }
  }

  const useImplicitVisibleOnly = !hasExplicitVisibility;
  const normalized = orderedIds.map((id) => {
    const persistedVisible = visibilityMap.get(id);
    const visible =
      persistedVisible ??
      (useImplicitVisibleOnly ? false : DEFAULT_VISIBLE_LOCAL_TRACK_COLUMNS.has(id));
    return {
      id,
      visible,
      widthPx: widthMap.get(id) ?? LOCAL_TRACK_COLUMN_DEFINITIONS[id].defaultWidthPx,
    };
  });

  if (normalized.some((item) => item.visible)) {
    return normalized;
  }

  return normalized.map((item) =>
    item.id === 'title'
      ? {
          ...item,
          visible: true,
        }
      : item
  );
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asOptionalString(value: unknown): string | undefined {
  const normalized = asTrimmedString(value);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStableFallbackAuditEntry(value: unknown): StableFallbackAuditEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as {
    atMs?: unknown;
    request?: Record<string, unknown>;
    dispatch?: Record<string, unknown>;
  };
  if (!entry.request || typeof entry.request !== 'object') return null;
  if (!entry.dispatch || typeof entry.dispatch !== 'object') return null;

  const ownerUid = asTrimmedString(entry.request.ownerUid);
  const entryId = asTrimmedString(entry.request.entryId);
  if (!ownerUid || !entryId) return null;

  const atMs =
    typeof entry.atMs === 'number' && Number.isFinite(entry.atMs)
      ? Math.max(0, Math.floor(entry.atMs))
      : Date.now();
  const requestedAtMs =
    typeof entry.request.requestedAtMs === 'number' && Number.isFinite(entry.request.requestedAtMs)
      ? Math.max(0, Math.floor(entry.request.requestedAtMs))
      : atMs;
  const queueSize =
    typeof entry.dispatch.queueSize === 'number' && Number.isFinite(entry.dispatch.queueSize)
      ? Math.max(0, Math.floor(entry.dispatch.queueSize))
      : 0;

  return {
    atMs,
    request: {
      entryId,
      ownerUid,
      cloudContentId: asOptionalString(entry.request.cloudContentId),
      trackId: asOptionalString(entry.request.trackId),
      quickFingerprint: asOptionalString(entry.request.quickFingerprint),
      requestedAtMs,
      reason: asOptionalString(entry.request.reason),
    },
    dispatch: {
      accepted: Boolean(entry.dispatch.accepted),
      deduped: Boolean(entry.dispatch.deduped),
      queueSize,
    },
  };
}

function buildStableFallbackAuditSnapshot(entries: StableFallbackAuditEntry[]): StableFallbackAuditSnapshot {
  const recent = [...entries]
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, STABLE_FALLBACK_AUDIT_MAX)
    .map((item) => ({
      atMs: item.atMs,
      request: { ...item.request },
      dispatch: { ...item.dispatch },
    }));

  let acceptedEvents = 0;
  let dedupedEvents = 0;
  let rejectedEvents = 0;
  let lastQueuedAtMs: number | undefined;

  for (const item of recent) {
    if (item.dispatch.accepted) {
      acceptedEvents += 1;
      if (lastQueuedAtMs === undefined || item.atMs > lastQueuedAtMs) {
        lastQueuedAtMs = item.atMs;
      }
    } else {
      rejectedEvents += 1;
    }
    if (item.dispatch.deduped) {
      dedupedEvents += 1;
    }
  }

  return {
    stats: {
      totalEvents: recent.length,
      acceptedEvents,
      dedupedEvents,
      rejectedEvents,
      lastQueuedAtMs,
    },
    recent,
  };
}

function parseTagsJsonAsText(tagsJson?: string): string {
  const normalized = asTrimmedString(tagsJson);
  if (!normalized) return '';
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (!Array.isArray(parsed)) return normalized;
    const tags = parsed
      .map((item) => asTrimmedString(item))
      .filter((item) => item.length > 0);
    return tags.join(', ');
  } catch {
    return normalized;
  }
}

function buildTagsJsonFromText(raw: string): string | undefined {
  const tags = raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (tags.length === 0) return undefined;
  return JSON.stringify(Array.from(new Set(tags)));
}

type SidebarScrollAnchor =
  | { kind: 'artist'; key: string; offset: number }
  | { kind: 'genre'; key: string; offset: number };

type SidebarScrollMemory = { scrollTop: number; anchor?: SidebarScrollAnchor };

type SidebarViewScrollMemory = Partial<Record<SidebarViewMode, SidebarScrollMemory>>;
const moduleSidebarScrollMemory: SidebarViewScrollMemory = {};

type MainViewportSnapshot = {
  scrollTop: number;
  clientHeight: number;
  clientWidth: number;
};

const CACHE_DURATION = 5 * 60 * 1000; // 5閸掑棝鎸撶紓鎾崇摠
const INITIAL_TRACK_LOAD_LIMIT = 180;
const TRACK_LOAD_CHUNK_SIZE = 120;
const TRACK_RENDER_CHUNK_SIZE = 160;
const TRACK_SCROLL_LOAD_TRIGGER_PX = 320;
const MODULE_CACHE_TRACK_CAP = 300;
const TRACK_TEXT_MAX_CHARS = 200;
const TRACK_TEXT_INTERN_POOL_MAX = 4096;
const SEARCH_DEBOUNCE_MS = 180;
const TRACK_ROW_HEIGHT_PX = 46;
const TRACK_LIST_HEADER_HEIGHT_PX = 52;
const TRACK_WINDOW_OVERSCAN_ROWS = 20;
const ALBUM_CARD_MIN_WIDTH_PX = 150;
const ALBUM_GRID_GAP_PX = 15;
const ALBUM_CARD_VERTICAL_EXTRA_PX = 72;
const ALBUM_WINDOW_OVERSCAN_ROWS = 3;

const trackTextInternPool = new Map<string, string>();

type MissingCleanupConfirmTarget =
  | {
      mode: 'path';
      pathId: string;
      pathName: string;
      count: number;
    }
  | {
      mode: 'all';
      count: number;
    };

function trimTracksForModuleCache(tracks: Track[]): Track[] {
  if (tracks.length <= MODULE_CACHE_TRACK_CAP) return tracks;
  return tracks.slice(0, MODULE_CACHE_TRACK_CAP);
}

function buildModuleCacheSnapshot(input: {
  tracks: Track[];
  artists: string[];
  albums: AlbumSummary[];
  genres: string[];
  trackNextOffset: number;
  hasMoreTracks: boolean;
  normalizeForIncrementalLoad?: boolean;
}): ModuleCacheSnapshot {
  const trimmedTracks = trimTracksForModuleCache(input.tracks);
  const normalizedOffset = Math.min(
    Math.max(0, Number.isFinite(input.trackNextOffset) ? Math.floor(input.trackNextOffset) : 0),
    trimmedTracks.length
  );
  const normalizedHasMore = input.normalizeForIncrementalLoad
    ? input.hasMoreTracks || input.trackNextOffset > trimmedTracks.length
    : input.hasMoreTracks;

  return {
    tracks: trimmedTracks,
    artists: input.artists,
    albums: input.albums,
    genres: input.genres,
    trackNextOffset: normalizedOffset,
    hasMoreTracks: normalizedHasMore,
    timestamp: Date.now(),
  };
}

function trimTrackText(value: unknown, maxChars: number = TRACK_TEXT_MAX_CHARS): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

function internTrackText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const existing = trackTextInternPool.get(value);
  if (existing) return existing;
  trackTextInternPool.set(value, value);
  if (trackTextInternPool.size > TRACK_TEXT_INTERN_POOL_MAX) {
    const oldestKey = trackTextInternPool.keys().next().value as string | undefined;
    if (oldestKey) trackTextInternPool.delete(oldestKey);
  }
  return value;
}

function compactTrackForLibrary(track: Track): Track {
  const safePath = typeof track.filePath === 'string' && track.filePath ? track.filePath : track.path;
  const normalizedCoverUrl = typeof track.coverUrl === 'string' ? track.coverUrl.trim() : '';
  const normalizedCoverLower = normalizedCoverUrl.toLowerCase();
  const safeCoverUrl =
    normalizedCoverLower.startsWith('blob:') ||
    normalizedCoverLower.startsWith('http://') ||
    normalizedCoverLower.startsWith('https://') ||
    normalizedCoverLower.startsWith('pmp://cover/')
      ? normalizedCoverUrl
      : undefined;
  const safeTitle = internTrackText(trimTrackText(track.title) || track.id) || track.id;
  const safeArtist = internTrackText(trimTrackText(track.artist));
  const safeAlbum = internTrackText(trimTrackText(track.album));
  const safeGenre = internTrackText(trimTrackText(track.genre));
  const safeCoverKey = internTrackText(trimTrackText(track.coverKey, 256));
  const safeOriginalPath = internTrackText(trimTrackText(track.originalPath, 512));
  const safeQuickFingerprint = internTrackText(trimTrackText(track.quickFingerprint, 80));

  return {
    id: track.id,
    title: safeTitle,
    artist: safeArtist,
    album: safeAlbum,
    genre: safeGenre,
    duration: typeof track.duration === 'number' ? track.duration : undefined,
    year: typeof track.year === 'number' ? track.year : undefined,
    filePath: typeof safePath === 'string' && safePath ? safePath : track.filePath,
    path: safePath,
    originalPath: safeOriginalPath,
    fileHandle: safePath ? undefined : track.fileHandle,
    coverKey: safeCoverKey,
    coverUrl: safeCoverUrl,
    quickFingerprint: safeQuickFingerprint,
    replayGainTrackGainDb:
      typeof track.replayGainTrackGainDb === 'number' ? track.replayGainTrackGainDb : undefined,
    replayGainAlbumGainDb:
      typeof track.replayGainAlbumGainDb === 'number' ? track.replayGainAlbumGainDb : undefined,
  };
}

function compactTracksForLibrary(tracks: Track[]): Track[] {
  if (tracks.length === 0) return tracks;
  return tracks.map(compactTrackForLibrary);
}

// 濞撳懘娅庡Ο鈥虫健缂傛挸鐡?
export function clearModuleCache() {
  moduleCache = null;
}

function albumKey(album: string, artist: string): string {
  return `${album}::${artist}`;
}

export const MusicLibrary: React.FC<MusicLibraryProps> = ({
  isOpen = true,
  onClose,
  onAddToQueue,
  onPlayNow,
  embedded = false,
}) => {
  const audioService = useAudioService();
  const { navigateTo } = useNavigation();
  const t = useT();
  const locale = useLocale();
  const [librarySourceMode, setLibrarySourceMode] = useState<MusicLibrarySourceMode>('local');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return moduleLastViewMode ?? (isTauriRuntime() ? 'all' : 'albums');
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [artists, setArtists] = useState<string[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [libraryStats, setLibraryStats] = useState<LibraryStats>({
    totalTracks: 0,
    totalArtists: 0,
    totalAlbums: 0,
    totalSize: 0,
    totalDuration: 0,
  });
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [libraryPaths, setLibraryPaths] = useState<LibraryPath[]>([]);
  const [libraryPathHealthMap, setLibraryPathHealthMap] = useState<Record<string, LibraryPathHealth>>(
    {}
  );
  const [isLibraryPathHealthLoading, setIsLibraryPathHealthLoading] = useState(false);
  const [isLibraryPathHealthAvailable, setIsLibraryPathHealthAvailable] = useState(true);
  const [pathCleanupBusyMap, setPathCleanupBusyMap] = useState<Record<string, boolean>>({});
  const [isCleanupAllMissingBusy, setIsCleanupAllMissingBusy] = useState(false);
  const [cleanupConfirmTarget, setCleanupConfirmTarget] =
    useState<MissingCleanupConfirmTarget | null>(null);
  const [showPathsManager, setShowPathsManager] = useState(false);
  const [stableEntries, setStableEntries] = useState<StableLibraryEntry[]>([]);
  const [isStableEntriesLoading, setIsStableEntriesLoading] = useState(false);
  const [stableOwnerFilter, setStableOwnerFilter] = useState('');
  const [stableInCloudOnly, setStableInCloudOnly] = useState(false);
  const [stableIncludeMissing, setStableIncludeMissing] = useState(true);
  const [showStableQueuePanel, setShowStableQueuePanel] = useState(false);
  const [isStableQueueLoading, setIsStableQueueLoading] = useState(false);
  const [stableFallbackTasks, setStableFallbackTasks] = useState<StableFallbackTask[]>([]);
  const [stableHashJobs, setStableHashJobs] = useState<StableHashJob[]>([]);
  const [stableFallbackAudit, setStableFallbackAudit] = useState<StableFallbackAuditSnapshot>({
    stats: {
      totalEvents: 0,
      acceptedEvents: 0,
      dedupedEvents: 0,
      rejectedEvents: 0,
    },
    recent: [],
  });
  const [fallbackTaskStatusPendingId, setFallbackTaskStatusPendingId] = useState<string | null>(null);
  const [hashJobStatusPendingId, setHashJobStatusPendingId] = useState<string | null>(null);
  const [editingStableEntry, setEditingStableEntry] = useState<StableLibraryEntry | null>(null);
  const [stableEntryRatingInput, setStableEntryRatingInput] = useState('');
  const [stableEntryTagsInput, setStableEntryTagsInput] = useState('');
  const [isStableMetadataSaving, setIsStableMetadataSaving] = useState(false);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [localTrackColumnsLoaded, setLocalTrackColumnsLoaded] = useState(false);
  const [localTrackColumnSettings, setLocalTrackColumnSettings] = useState<LocalTrackColumnConfig[]>(() =>
    DEFAULT_LOCAL_TRACK_COLUMN_SETTINGS.map((item) => ({ ...item }))
  );
  const [localTrackLayoutWidth, setLocalTrackLayoutWidth] = useState(0);
  const [pendingPlayTrackIdentity, setPendingPlayTrackIdentity] = useState<string | null>(null);
  const [draggingLocalTrackColumnId, setDraggingLocalTrackColumnId] =
    useState<LocalTrackColumnId | null>(null);
  const [dragOverLocalTrackColumnId, setDragOverLocalTrackColumnId] =
    useState<LocalTrackColumnId | null>(null);
  const [isLocalTrackColumnReordering, setIsLocalTrackColumnReordering] = useState(false);
  const [resizingLocalTrackColumnId, setResizingLocalTrackColumnId] =
    useState<LocalTrackColumnId | null>(null);
  const [hasMoreTracks, setHasMoreTracks] = useState(false);
  const [isTrackChunkLoading, setIsTrackChunkLoading] = useState(false);
  const [renderedTrackLimit, setRenderedTrackLimit] = useState(TRACK_RENDER_CHUNK_SIZE);
  const trackNextOffsetRef = useRef(0);
  const trackChunkLoadingRef = useRef(false);
  const searchTokenRef = useRef(0);
  const searchDebounceTimerRef = useRef<number | null>(null);
  const libraryLoadTokenRef = useRef(0);
  const stableLoadTokenRef = useRef(0);
  const [mainViewport, setMainViewport] = useState<MainViewportSnapshot>({
    scrollTop: 0,
    clientHeight: 0,
    clientWidth: 0,
  });
  const facetLoadingRef = useRef<{ artists: boolean; albums: boolean; genres: boolean }>({
    artists: false,
    albums: false,
    genres: false,
  });
  const currentCoverPolicyRef = useRef<CoverRuntimeCachePolicy>('default');
  const requestedAlbumCoversRef = useRef<Set<string>>(new Set());
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const albumCardElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const albumCardRefCallbacksRef = useRef<Map<string, (el: HTMLDivElement | null) => void>>(
    new Map()
  );
  const albumCoverObserverRef = useRef<IntersectionObserver | null>(null);
  const albumCoverQueueRef = useRef<string[]>([]);
  const albumCoverInFlightRef = useRef<number>(0);
  const albumCoverDrainRafRef = useRef<number | null>(null);
  const albumInfoByKeyRef = useRef<Map<string, AlbumSummary>>(new Map());
  const albumCoverGenerationRef = useRef<number>(0);
  const albumOffscreenReclaimTimerRef = useRef<number | null>(null);
  const localTrackColumnResizeSessionRef = useRef<LocalTrackColumnResizeSession | null>(null);
  const localTrackColumnResizeRafRef = useRef<number | null>(null);
  const localTrackColumnResizePendingRef = useRef<
    { columnId: LocalTrackColumnId; widthPx: number } | null
  >(null);
  const localTrackColumnReorderSessionRef = useRef<LocalTrackColumnReorderSession | null>(null);
  const localTrackColumnHeaderElementsRef = useRef<Map<LocalTrackColumnId, HTMLDivElement>>(new Map());
  const localTrackListHeaderScrollRef = useRef<HTMLDivElement | null>(null);
  const localTrackListBodyScrollRef = useRef<HTMLDivElement | null>(null);
  const localTrackListLayoutRef = useRef<HTMLDivElement | null>(null);
  const localTrackHorizontalScrollSyncingRef = useRef(false);
  const dragOverLocalTrackColumnIdRef = useRef<LocalTrackColumnId | null>(null);
  const pendingPlayTrackIdentityRef = useRef<string | null>(null);
  const pendingPlayResetTimerRef = useRef<number | null>(null);

  const beginAudioProtection = useCallback(
    (reason: string, durationMs: number = 20_000): (() => void) => {
      return audioService.enterProtectionWindow?.({ reason, durationMs }) ?? (() => {});
    },
    [audioService]
  );

  const bumpAudioProtection = useCallback(
    (reason: string, durationMs: number = 20_000) => {
      const release = beginAudioProtection(reason, durationMs);
      release();
    },
    [beginAudioProtection]
  );

  const resolveTrackIdentity = useCallback((track: Track | null | undefined): string | null => {
    if (!track) return null;
    const id = String(track.id || '').trim();
    if (id.length > 0) return `id:${id}`;
    const filePath = String(track.filePath || track.path || track.originalPath || '').trim();
    if (filePath.length > 0) return `path:${filePath}`;
    return null;
  }, []);

  const clearPendingPlayTrack = useCallback(() => {
    if (pendingPlayResetTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(pendingPlayResetTimerRef.current);
      pendingPlayResetTimerRef.current = null;
    }
    pendingPlayTrackIdentityRef.current = null;
    setPendingPlayTrackIdentity(null);
  }, []);

  const markPendingPlayTrack = useCallback(
    (track: Track) => {
      const identity = resolveTrackIdentity(track);
      if (!identity) return;

      pendingPlayTrackIdentityRef.current = identity;
      setPendingPlayTrackIdentity(identity);

      if (pendingPlayResetTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(pendingPlayResetTimerRef.current);
      }

      if (typeof window !== 'undefined') {
        pendingPlayResetTimerRef.current = window.setTimeout(() => {
          pendingPlayResetTimerRef.current = null;
          if (pendingPlayTrackIdentityRef.current === identity) {
            pendingPlayTrackIdentityRef.current = null;
            setPendingPlayTrackIdentity(null);
          }
        }, 3_500);
      }
    },
    [resolveTrackIdentity]
  );

  useEffect(() => {
    const unsubscribeState = audioService.onStateChange((state) => {
      const pending = pendingPlayTrackIdentityRef.current;
      if (!pending) return;

      const currentIdentity = resolveTrackIdentity(state.currentTrack);
      if (currentIdentity && currentIdentity === pending) {
        clearPendingPlayTrack();
      }
    });

    const unsubscribeError = audioService.onError(() => {
      clearPendingPlayTrack();
    });

    return () => {
      unsubscribeState();
      unsubscribeError();
      clearPendingPlayTrack();
    };
  }, [audioService, clearPendingPlayTrack, resolveTrackIdentity]);

  // ? 鐠佹澘绻傚姘З娴ｅ秶鐤嗛敍姘瘻 viewMode 缂佸瓨濮㈡稉缁樼泊閸斻劍娼?scrollTop + 闁挎氨鍋ｉ敍宀勪缉閸忓秷娉曟い鐢告桨/閸掑洦宕?tab 娑撱垹銇戞担宥囩枂
  const isRestoringMainScrollRef = useRef(false);
  const mainScrollUserDirtyRef = useRef(false);
  const mainScrollAnchorDebounceRef = useRef<number | null>(null);
  const mainScrollRestoreStateRef = useRef<{ viewMode: ViewMode | null; done: boolean }>({
    viewMode: null,
    done: false,
  });

  const escapeCssSelector = useCallback((value: string): string => {
    const css = (globalThis as unknown as { CSS?: { escape?: (text: string) => string } }).CSS;
    if (css?.escape) return css.escape(value);
    return value.replace(/["\\]/g, '\\$&');
  }, []);

  const getMainScrollRoot = useCallback(
    (preferred?: MainScrollRootKind): HTMLElement | null => {
      const main = mainScrollRef.current;
      if (!main) return null;

      const navigationContent =
        typeof main.closest === 'function'
          ? main.closest<HTMLElement>('.navigation-content')
          : null;

      const isScrollable = (element: HTMLElement): boolean =>
        element.scrollHeight > element.clientHeight + 1;

      // If one of the roots is already scrolled, treat that as the active scroll root.
      if (navigationContent && navigationContent.scrollTop > 0) return navigationContent;
      if (main.scrollTop > 0) return main;

      if (preferred === 'navigation' && navigationContent && isScrollable(navigationContent)) {
        return navigationContent;
      }
      if (preferred === 'main' && isScrollable(main)) {
        return main;
      }

      if (isScrollable(main)) return main;
      if (navigationContent && isScrollable(navigationContent)) return navigationContent;

      return main;
    },
    []
  );

  const syncMainViewport = useCallback((root: HTMLElement | null) => {
    if (!root) return;
    const next: MainViewportSnapshot = {
      scrollTop: root.scrollTop,
      clientHeight: root.clientHeight,
      clientWidth: root.clientWidth,
    };

    setMainViewport((prev) => {
      if (
        prev.scrollTop === next.scrollTop &&
        prev.clientHeight === next.clientHeight &&
        prev.clientWidth === next.clientWidth
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const refreshLocalTrackLayoutWidth = useCallback(() => {
    const listLayout = localTrackListLayoutRef.current;
    const main = mainScrollRef.current;
    const navigationContent = main?.closest<HTMLElement>('.navigation-content') ?? null;

    const nextWidth =
      listLayout?.clientWidth ?? main?.clientWidth ?? navigationContent?.clientWidth ?? 0;

    setLocalTrackLayoutWidth((prev) => (prev === nextWidth ? prev : nextWidth));
  }, []);

  const computeMainScrollAnchor = useCallback(
    (root: HTMLElement, mode: ViewMode): MainScrollAnchor | null => {
      const rootRect = root.getBoundingClientRect();

      const findFirstVisible = (selector: string): HTMLElement | null => {
        const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
        for (const element of elements) {
          const rect = element.getBoundingClientRect();
          if (rect.bottom <= rootRect.top) continue;
          return element;
        }
        return null;
      };

      if (mode === 'albums') {
        const element = findFirstVisible('.music-library-album-card[data-album-key]');
        const key = element?.getAttribute('data-album-key')?.trim();
        if (!element || !key) return null;
        const rect = element.getBoundingClientRect();
        return { kind: 'album', key, offset: rect.top - rootRect.top };
      }

      const element = findFirstVisible('.music-library-track[data-track-id]');
      const id = element?.getAttribute('data-track-id')?.trim();
      if (!element || !id) return null;
      const rect = element.getBoundingClientRect();
      return { kind: 'track', id, offset: rect.top - rootRect.top };
    },
    []
  );

  const captureMainScrollMemory = useCallback(
    (mode: ViewMode) => {
      const root = getMainScrollRoot();
      if (!root) return;

      const memory: MainScrollMemory = {
        scrollTop: root.scrollTop,
      };
      const main = mainScrollRef.current;
      const navigationContent = main?.closest<HTMLElement>('.navigation-content') ?? null;
      memory.rootKind = navigationContent && root === navigationContent ? 'navigation' : 'main';

      const anchor = computeMainScrollAnchor(root, mode);
      if (anchor) memory.anchor = anchor;

      moduleScrollMemory[mode] = memory;
    },
    [computeMainScrollAnchor, getMainScrollRoot]
  );

  const scheduleMainScrollAnchorUpdate = useCallback(
    (mode: ViewMode) => {
      if (typeof window === 'undefined') return;
      if (mainScrollAnchorDebounceRef.current !== null) {
        window.clearTimeout(mainScrollAnchorDebounceRef.current);
      }

      mainScrollAnchorDebounceRef.current = window.setTimeout(() => {
        mainScrollAnchorDebounceRef.current = null;

        const root = getMainScrollRoot(moduleScrollMemory[mode]?.rootKind);
        if (!root) return;

        const anchor = computeMainScrollAnchor(root, mode);
        if (!anchor) return;

        const previous = moduleScrollMemory[mode];
        moduleScrollMemory[mode] = {
          ...(previous ?? { scrollTop: root.scrollTop }),
          scrollTop: root.scrollTop,
          anchor,
        };
      }, 140);
    },
    [computeMainScrollAnchor, getMainScrollRoot]
  );

  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') return;
      if (mainScrollAnchorDebounceRef.current !== null) {
        window.clearTimeout(mainScrollAnchorDebounceRef.current);
        mainScrollAnchorDebounceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    moduleLastViewMode = viewMode;
  }, [viewMode]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    if (librarySourceMode !== 'local') return;
    return () => {
      const root = getMainScrollRoot(moduleScrollMemory[viewMode]?.rootKind);
      const currentScrollTop = root?.scrollTop ?? 0;
      const existing = moduleScrollMemory[viewMode];

      // When the Music Library unmounts, the shared `.navigation-content` container can reset its
      // scroll position to 0 before this cleanup runs. Avoid overwriting a previously recorded
      // non-zero scroll memory with that transient reset.
      if (existing && existing.scrollTop > 0 && currentScrollTop === 0) {
        return;
      }

      if (!existing) {
        if (currentScrollTop > 0) captureMainScrollMemory(viewMode);
        return;
      }

      if (mainScrollUserDirtyRef.current && currentScrollTop > 0) {
        captureMainScrollMemory(viewMode);
        return;
      }

      if (currentScrollTop > 0 && existing.scrollTop !== currentScrollTop) {
        captureMainScrollMemory(viewMode);
      }
    };
  }, [captureMainScrollMemory, getMainScrollRoot, isOpen, librarySourceMode, viewMode]);

  // ? Artists/Genres sidebar: 閻欘剛鐝涘姘З鐠佹澘绻傞敍鍫ユ晪閻愮懓绱￠幁銏狀槻閿?
  const isRestoringSidebarScrollRef = useRef(false);
  const sidebarScrollUserDirtyRef = useRef(false);
  const sidebarScrollRestoreStateRef = useRef<{ viewMode: SidebarViewMode | null; done: boolean }>({
    viewMode: null,
    done: false,
  });

  const getSidebarScrollRoot = useCallback((): HTMLElement | null => {
    return sidebarScrollRef.current;
  }, []);

  const computeSidebarScrollAnchor = useCallback(
    (root: HTMLElement, mode: SidebarViewMode): SidebarScrollAnchor | null => {
      const rootRect = root.getBoundingClientRect();
      const selector =
        mode === 'artists'
          ? '.music-library-sidebar-item[data-artist-name]'
          : '.music-library-sidebar-item[data-genre-name]';

      const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (rect.bottom <= rootRect.top) continue;
        if (mode === 'artists') {
          const key = element.getAttribute('data-artist-name')?.trim();
          if (!key) return null;
          return { kind: 'artist', key, offset: rect.top - rootRect.top };
        }
        const key = element.getAttribute('data-genre-name')?.trim();
        if (!key) return null;
        return { kind: 'genre', key, offset: rect.top - rootRect.top };
      }
      return null;
    },
    []
  );

  const captureSidebarScrollMemory = useCallback(
    (mode: ViewMode) => {
      if (mode !== 'artists' && mode !== 'genres') return;
      const root = getSidebarScrollRoot();
      if (!root) return;

      const memory: SidebarScrollMemory = {
        scrollTop: root.scrollTop,
      };

      const anchor = computeSidebarScrollAnchor(root, mode);
      if (anchor) memory.anchor = anchor;

      moduleSidebarScrollMemory[mode] = memory;
    },
    [computeSidebarScrollAnchor, getSidebarScrollRoot]
  );

  const handleSidebarScroll = useCallback(() => {
    if (isRestoringSidebarScrollRef.current) return;
    if (viewMode !== 'artists' && viewMode !== 'genres') return;
    const root = getSidebarScrollRoot();
    if (!root) return;
    sidebarScrollUserDirtyRef.current = true;

    const previous = moduleSidebarScrollMemory[viewMode];
    moduleSidebarScrollMemory[viewMode] = {
      ...(previous ?? { scrollTop: 0 }),
      scrollTop: root.scrollTop,
    };
  }, [getSidebarScrollRoot, viewMode]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    if (viewMode !== 'artists' && viewMode !== 'genres') return;
    const root = getSidebarScrollRoot();
    if (!root) return;

    if (sidebarScrollRestoreStateRef.current.viewMode !== viewMode) {
      sidebarScrollRestoreStateRef.current = { viewMode, done: false };
      sidebarScrollUserDirtyRef.current = false;
    }

    if (sidebarScrollRestoreStateRef.current.done) return;

    const memory = moduleSidebarScrollMemory[viewMode];
    const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);

    const setScrollTop = (target: number) => {
      const clamped = Math.min(Math.max(0, target), maxScrollTop);
      if (root.scrollTop === clamped) return;
      isRestoringSidebarScrollRef.current = true;
      root.scrollTop = clamped;
      window.requestAnimationFrame(() => {
        isRestoringSidebarScrollRef.current = false;
      });
    };

    const tryRestoreFromScrollTop = (scrollTop: number): boolean => {
      setScrollTop(scrollTop);
      return scrollTop === 0 || scrollTop <= maxScrollTop;
    };

    if (!memory) {
      setScrollTop(0);
      sidebarScrollRestoreStateRef.current.done = true;
      return;
    }

    const anchor = memory.anchor;
    if (anchor) {
      const selector =
        viewMode === 'artists'
          ? `[data-artist-name="${escapeCssSelector(anchor.key)}"]`
          : `[data-genre-name="${escapeCssSelector(anchor.key)}"]`;
      const element = root.querySelector<HTMLElement>(selector);
      if (element) {
        const rootRect = root.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const elementTopInContent = elementRect.top - rootRect.top + root.scrollTop;
        const targetScrollTop = elementTopInContent - anchor.offset;
        setScrollTop(targetScrollTop);
        sidebarScrollRestoreStateRef.current.done = true;
        return;
      }
    }

    if (tryRestoreFromScrollTop(memory.scrollTop)) {
      sidebarScrollRestoreStateRef.current.done = true;
    }
  }, [
    artists.length,
    escapeCssSelector,
    genres.length,
    getSidebarScrollRoot,
    isOpen,
    viewMode,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    return () => {
      if (viewMode !== 'artists' && viewMode !== 'genres') return;
      const root = getSidebarScrollRoot();
      const currentScrollTop = root?.scrollTop ?? 0;
      const existing = moduleSidebarScrollMemory[viewMode];
      const shouldCapture =
        sidebarScrollUserDirtyRef.current ||
        !existing ||
        (currentScrollTop > 0 && existing.scrollTop !== currentScrollTop);

      if (shouldCapture) captureSidebarScrollMemory(viewMode);
    };
  }, [captureSidebarScrollMemory, getSidebarScrollRoot, isOpen, viewMode]);

  // 閹烘帒绨悩鑸碘偓?
  const [sortBy, setSortBy] = useState<
    'title' | 'artist' | 'album' | 'duration' | 'year' | 'default'
  >('default');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // 閸欐娊鏁懣婊冨礋閻樿埖鈧?
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const updateCoverRuntimePolicy = useCallback((policy: CoverRuntimeCachePolicy) => {
    if (currentCoverPolicyRef.current === policy) return;
    currentCoverPolicyRef.current = policy;
    musicLibraryService.applyCoverRuntimeCachePolicy(policy);
  }, []);

  const loadFacetCollections = useCallback(
    async (mode: ViewMode, trackSource?: Track[]) => {
      if (mode === 'artists') {
        if (artists.length > 0 || facetLoadingRef.current.artists) return;
        facetLoadingRef.current.artists = true;
        try {
          if (trackSource && trackSource.length > 0) {
            const uniqueArtists = Array.from(
              new Set(trackSource.map((track) => track.artist).filter(Boolean))
            ).sort();
            setArtists(uniqueArtists as string[]);
            return;
          }
          setArtists(await musicLibraryService.getAllArtists());
        } catch (error) {
          console.warn('[MusicLibrary] Failed to load artists facet:', error);
        } finally {
          facetLoadingRef.current.artists = false;
        }
        return;
      }

      if (mode === 'genres') {
        if (genres.length > 0 || facetLoadingRef.current.genres) return;
        facetLoadingRef.current.genres = true;
        try {
          if (trackSource && trackSource.length > 0) {
            const uniqueGenres = Array.from(
              new Set(trackSource.map((track) => track.genre).filter(Boolean))
            ).sort();
            setGenres(uniqueGenres as string[]);
            return;
          }
          setGenres(await musicLibraryService.getAllGenres());
        } catch (error) {
          console.warn('[MusicLibrary] Failed to load genres facet:', error);
        } finally {
          facetLoadingRef.current.genres = false;
        }
        return;
      }

      if (mode === 'albums') {
        if (albums.length > 0 || facetLoadingRef.current.albums) return;
        facetLoadingRef.current.albums = true;
        try {
          if (trackSource && trackSource.length > 0) {
            const albumMap = new Map<string, AlbumSummary>();
            for (const track of trackSource) {
              if (!track.album) continue;
              const artist = track.artist || t('common.unknown.artist');
              const key = albumKey(track.album, artist);
              if (albumMap.has(key)) continue;

              albumMap.set(key, {
                album: track.album,
                artist,
                cover:
                  typeof track.coverUrl === 'string' &&
                  (track.coverUrl.startsWith('blob:') ||
                    track.coverUrl.startsWith('data:') ||
                    track.coverUrl.startsWith('http://') ||
                    track.coverUrl.startsWith('https://'))
                    ? track.coverUrl
                    : undefined,
                coverTrackPath: track.filePath || track.path,
                coverTrackId: track.id,
              });
            }
            setAlbums(Array.from(albumMap.values()));
            return;
          }
          setAlbums(await musicLibraryService.getAllAlbums({ includeStoredCover: false }));
        } catch (error) {
          console.warn('[MusicLibrary] Failed to load albums facet:', error);
        } finally {
          facetLoadingRef.current.albums = false;
        }
      }
    },
    [albums.length, artists.length, genres.length, t]
  );

  const scheduleTrackChunkLoad = useCallback(async (): Promise<boolean> => {
    if (trackChunkLoadingRef.current) return false;
    if (!hasMoreTracks) return false;
    const offset = trackNextOffsetRef.current;
    if (!Number.isFinite(offset) || offset < 0) return false;

    trackChunkLoadingRef.current = true;
    setIsTrackChunkLoading(true);
    const releaseProtection = beginAudioProtection('music-library-track-chunk', 18_000);

    try {
      const nextChunk = await musicLibraryService.getAllTracks(TRACK_LOAD_CHUNK_SIZE, offset);
      if (nextChunk.length === 0) {
        setHasMoreTracks(false);
        return false;
      }

      const compactChunk = compactTracksForLibrary(nextChunk);
      const chunkHasMore = nextChunk.length >= TRACK_LOAD_CHUNK_SIZE;

      trackNextOffsetRef.current = offset + nextChunk.length;
      setTracks((prev) => {
        const merged = [...prev, ...compactChunk];
        if (moduleCache) {
          moduleCache = buildModuleCacheSnapshot({
            tracks: merged,
            artists: moduleCache.artists,
            albums: moduleCache.albums,
            genres: moduleCache.genres,
            trackNextOffset: trackNextOffsetRef.current,
            hasMoreTracks: chunkHasMore,
            normalizeForIncrementalLoad: true,
          });
        }
        return merged;
      });

      if (!chunkHasMore) {
        setHasMoreTracks(false);
      }

      return true;
    } catch (error) {
      console.warn('[MusicLibrary] Failed to load next track chunk:', error);
      setHasMoreTracks(false);
      return false;
    } finally {
      trackChunkLoadingRef.current = false;
      setIsTrackChunkLoading(false);
      releaseProtection();
    }
  }, [beginAudioProtection, hasMoreTracks]);

  const maybeLoadTrackChunkFromScroll = useCallback(() => {
    if (!hasMoreTracks) return;
    const root = getMainScrollRoot();
    if (!root) return;
    const remaining = root.scrollHeight - (root.scrollTop + root.clientHeight);
    if (remaining <= TRACK_SCROLL_LOAD_TRIGGER_PX) {
      void scheduleTrackChunkLoad();
    }
  }, [getMainScrollRoot, hasMoreTracks, scheduleTrackChunkLoad]);

  const handleMainScroll = useCallback(() => {
    const root = getMainScrollRoot(moduleScrollMemory[viewMode]?.rootKind);
    if (!root) return;

    if (isRestoringMainScrollRef.current) {
      syncMainViewport(root);
      return;
    }

    mainScrollUserDirtyRef.current = true;

    const previous = moduleScrollMemory[viewMode];
    moduleScrollMemory[viewMode] = {
      ...(previous ?? { scrollTop: 0 }),
      scrollTop: root.scrollTop,
      rootKind:
        (() => {
          const main = mainScrollRef.current;
          const navigationContent = main?.closest<HTMLElement>('.navigation-content') ?? null;
          return navigationContent && root === navigationContent ? 'navigation' : 'main';
        })(),
    };

    if (viewMode !== 'albums') {
      const remaining = root.scrollHeight - (root.scrollTop + root.clientHeight);
      if (remaining <= TRACK_SCROLL_LOAD_TRIGGER_PX) {
        setRenderedTrackLimit((prev) => prev + TRACK_RENDER_CHUNK_SIZE);
      }
      maybeLoadTrackChunkFromScroll();
    }

    syncMainViewport(root);
    scheduleMainScrollAnchorUpdate(viewMode);
  }, [
    getMainScrollRoot,
    maybeLoadTrackChunkFromScroll,
    scheduleMainScrollAnchorUpdate,
    syncMainViewport,
    viewMode,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const main = mainScrollRef.current;
    if (!main) return;

    const navigationContent = main.closest<HTMLElement>('.navigation-content');
    const handler = () => handleMainScroll();

    main.addEventListener('scroll', handler, { passive: true });
    navigationContent?.addEventListener('scroll', handler, { passive: true });

    return () => {
      main.removeEventListener('scroll', handler);
      navigationContent?.removeEventListener('scroll', handler);
    };
  }, [handleMainScroll, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const refreshViewport = () => {
      const root = getMainScrollRoot(moduleScrollMemory[viewMode]?.rootKind);
      syncMainViewport(root);
    };

    refreshViewport();
    window.addEventListener('resize', refreshViewport);

    return () => {
      window.removeEventListener('resize', refreshViewport);
    };
  }, [albums.length, getMainScrollRoot, isOpen, syncMainViewport, tracks.length, viewMode]);

  useLayoutEffect(() => {
    if (!isOpen || librarySourceMode !== 'local' || viewMode === 'albums') {
      setLocalTrackLayoutWidth((prev) => (prev === 0 ? prev : 0));
      return;
    }

    refreshLocalTrackLayoutWidth();

    const observedElements: HTMLElement[] = [];
    const pushObservedElement = (element: HTMLElement | null | undefined) => {
      if (!element) return;
      if (observedElements.includes(element)) return;
      observedElements.push(element);
    };

    const main = mainScrollRef.current;
    pushObservedElement(localTrackListLayoutRef.current);
    pushObservedElement(main);
    pushObservedElement(main?.closest<HTMLElement>('.navigation-content'));

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            refreshLocalTrackLayoutWidth();
          })
        : null;

    if (resizeObserver) {
      for (const element of observedElements) {
        resizeObserver.observe(element);
      }
    }

    window.addEventListener('resize', refreshLocalTrackLayoutWidth);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', refreshLocalTrackLayoutWidth);
    };
  }, [isOpen, librarySourceMode, refreshLocalTrackLayoutWidth, viewMode]);

  // 鍒囨崲瑙嗗浘妯″紡鏃舵竻闄ょ瓫閫夌姸鎬?
  const handleViewModeChange = (
    newMode: ViewMode,
    options?: { artist?: string; genre?: string }
  ) => {
    captureMainScrollMemory(viewMode);
    captureSidebarScrollMemory(viewMode);
    moduleLastViewMode = newMode;
    setViewMode(newMode);
    // 濞撳懘娅庨幍鈧張澶岀摣闁娼禒璁圭礉鐠佲晜鐦℃稉顏囶潒閸ュ墽瀚粩?
    setSelectedArtist(options?.artist || null);
    setSelectedAlbum(null);
    setSelectedGenre(options?.genre || null);
  };

  const loadLibraryData = useCallback(async () => {
    const token = ++libraryLoadTokenRef.current;
    console.log('Loading library data...');
    const releaseProtection = beginAudioProtection('music-library-load', 25_000);

    // 閴?缁斿宓嗛弰鍓с仛濡€虫健缂傛挸鐡ㄩ弫鐗堝祦閿涘牆顩ч弸婊勬箒閺佸牞绱?
    const now = Date.now();
    if (moduleCache && now - moduleCache.timestamp < CACHE_DURATION) {
      console.log('Using module cache for instant display');
      setTracks(moduleCache.tracks);
      setArtists(moduleCache.artists);
      requestedAlbumCoversRef.current.clear();
      setAlbums(moduleCache.albums);
      setGenres(moduleCache.genres);
      trackNextOffsetRef.current = moduleCache.trackNextOffset;
      setHasMoreTracks(moduleCache.hasMoreTracks);
      setRenderedTrackLimit(TRACK_RENDER_CHUNK_SIZE);
      updateCoverRuntimePolicy(viewMode === 'albums' ? 'watch' : 'high');

      if (viewMode === 'albums' || viewMode === 'artists' || viewMode === 'genres') {
        void loadFacetCollections(viewMode, moduleCache.tracks);
      }

      // 閸︺劌鎮楅崣鏉跨磽濮濄儲娲块弬鎵埠鐠佲€蹭繆閹?
      musicLibraryService.getLibraryStats().then((stats) => {
        if (token !== libraryLoadTokenRef.current) return;
        setLibraryStats(stats);
      });
      return; // 閴?閻╁瓨甯存潻鏂挎礀閿涘奔绗夐柌宥嗘煀閸旂姾娴?
    }

    // 濞屸剝婀佺紓鎾崇摠閹存牜绱︾€涙绻冮張鐕傜礉娴?IndexedDB 閸旂姾娴?
    console.log('Loading from IndexedDB...');

    try {
      // 閴?娴兼ê瀵查敍姘辨纯閹恒儱濮炴潪鑺ユ殶閹诡噯绱濋梽鎰煑娑?1000 妫ｆ牭绱欓柆鍨帳闁插秴顦茬拠璇插絿閿?
      const initialTracks = await musicLibraryService.getAllTracks(INITIAL_TRACK_LOAD_LIMIT);

      if (token !== libraryLoadTokenRef.current) return;

      const compactInitialTracks = compactTracksForLibrary(initialTracks);
      const hasMore = compactInitialTracks.length >= INITIAL_TRACK_LOAD_LIMIT;
      trackNextOffsetRef.current = initialTracks.length;
      setHasMoreTracks(hasMore);
      setRenderedTrackLimit(TRACK_RENDER_CHUNK_SIZE);
      updateCoverRuntimePolicy(viewMode === 'albums' ? 'watch' : 'high');

      console.log('Library data loaded:', {
        tracks: compactInitialTracks.length,
      });

      // 閺囧瓨鏌婇弰鍓с仛閺佺増宓侀崪灞灸侀崸妤冪处鐎?
      moduleCache = buildModuleCacheSnapshot({
        tracks: compactInitialTracks,
        artists: [],
        albums: [],
        genres: [],
        trackNextOffset: trackNextOffsetRef.current,
        hasMoreTracks: hasMore,
        normalizeForIncrementalLoad: true,
      });

      setTracks(compactInitialTracks);
      setArtists([]);
      requestedAlbumCoversRef.current.clear();
      setAlbums([]);
      setGenres([]);
      facetLoadingRef.current = { artists: false, albums: false, genres: false };

      if (viewMode === 'albums' || viewMode === 'artists' || viewMode === 'genres') {
        void loadFacetCollections(viewMode, compactInitialTracks);
      }

      // 閸︺劌鎮楅崣鏉跨磽濮濄儴顓哥粻妤冪埠鐠佲€蹭繆閹垽绱欐稉宥夋▎婵夋拷I閿?
      musicLibraryService.getLibraryStats().then((stats) => {
        if (token !== libraryLoadTokenRef.current) return;
        setLibraryStats(stats);
        console.log('Library stats loaded:', stats);
      });
    } catch (error) {
      console.error('Failed to load library data:', error);
      setHasMoreTracks(false);
    } finally {
      releaseProtection();
    }
  }, [beginAudioProtection, loadFacetCollections, updateCoverRuntimePolicy, viewMode]);

  // 閸旂姾娴囨惔鎾圭熅瀵?
  const loadStableLibraryEntries = useCallback(
    async (
      query?: string,
      overrides?: {
        ownerUid?: string;
        inCloudOnly?: boolean;
        includeMissing?: boolean;
      }
    ) => {
    const token = ++stableLoadTokenRef.current;

    if (!isTauriRuntime()) {
      if (token !== stableLoadTokenRef.current) return;
      setStableEntries([]);
      setIsStableEntriesLoading(false);
      return;
    }
    
    setIsStableEntriesLoading(true);
    try {
      const normalizedOwnerUid = (overrides?.ownerUid ?? stableOwnerFilter).trim();
      const inCloudOnly = overrides?.inCloudOnly ?? stableInCloudOnly;
      const includeMissing = overrides?.includeMissing ?? stableIncludeMissing;
      const rows = await musicLibraryService.listCloudLibraryEntries({
        ownerUid: normalizedOwnerUid || undefined,
        inCloudOnly,
        includeMissing,
        limit: 1500,
        searchQuery: typeof query === 'string' && query.trim().length > 0 ? query.trim() : undefined,
      });

      if (token !== stableLoadTokenRef.current) return;
      setStableEntries(rows);
    } catch (error) {
      if (token !== stableLoadTokenRef.current) return;
      console.warn('Failed to load stable library entries:', error);
      setStableEntries([]);
    } finally {
      if (token === stableLoadTokenRef.current) {
        setIsStableEntriesLoading(false);
      }
    }
    },
    [stableInCloudOnly, stableIncludeMissing, stableOwnerFilter]
  );

  const loadLibraryPathHealth = useCallback(async () => {
    if (!isTauriRuntime()) {
      setLibraryPathHealthMap({});
      setIsLibraryPathHealthAvailable(false);
      return;
    }

    setIsLibraryPathHealthLoading(true);
    try {
      const healthRows = await musicLibraryService.getLibraryPathHealth();
      if (!healthRows) {
        setLibraryPathHealthMap({});
        setIsLibraryPathHealthAvailable(false);
        return;
      }

      const nextMap: Record<string, LibraryPathHealth> = {};
      for (const row of healthRows) {
        if (!row.sourceId) continue;
        nextMap[row.sourceId] = row;
      }
      setLibraryPathHealthMap(nextMap);
      setIsLibraryPathHealthAvailable(true);
    } catch (error) {
      console.warn('Failed to load library path health:', error);
      setLibraryPathHealthMap({});
      setIsLibraryPathHealthAvailable(false);
    } finally {
      setIsLibraryPathHealthLoading(false);
    }
  }, []);

  const loadLibraryPaths = useCallback(async () => {
    try {
      const paths = await musicLibraryService.getLibraryPaths();
      setLibraryPaths(paths);
      if (showPathsManager) {
        void loadLibraryPathHealth();
      }
      return paths;
    } catch (error) {
      console.error('Failed to load library paths:', error);
      return [];
    }
  }, [loadLibraryPathHealth, showPathsManager]);

  const resetLibraryDataFromStorage = useCallback(async () => {
    clearModuleCache();
    await loadLibraryData();
  }, [loadLibraryData]);

  const handleLibrarySourceChange = useCallback(
    (nextMode: MusicLibrarySourceMode) => {
      if (librarySourceMode === nextMode) return;

      captureMainScrollMemory(viewMode);
      captureSidebarScrollMemory(viewMode);
      setLibrarySourceMode(nextMode);
      setShowPathsManager(false);
      setSearchQuery('');

      if (searchDebounceTimerRef.current != null) {
        window.clearTimeout(searchDebounceTimerRef.current);
        searchDebounceTimerRef.current = null;
      }

      if (nextMode === 'local') {
        searchTokenRef.current += 1;
        setSelectedArtist(null);
        setSelectedAlbum(null);
        setSelectedGenre(null);
        void resetLibraryDataFromStorage();
        return;
      }

      setSelectedArtist(null);
      setSelectedAlbum(null);
      setSelectedGenre(null);
      setViewMode('all');
      setMainViewport((prev) => ({ ...prev, scrollTop: 0 }));
      const root = getMainScrollRoot(moduleScrollMemory[viewMode]?.rootKind);
      root?.scrollTo({ top: 0 });
      void loadStableLibraryEntries();
    },
    [
      captureMainScrollMemory,
      captureSidebarScrollMemory,
      getMainScrollRoot,
      librarySourceMode,
      loadStableLibraryEntries,
      resetLibraryDataFromStorage,
      viewMode,
    ]
  );

  useEffect(() => {
    if (!embedded) return;

    const onSourceChange = (event: Event) => {
      const customEvent = event as CustomEvent<MusicLibrarySourceChangeDetail>;
      const nextMode = customEvent.detail?.mode;
      if (nextMode !== 'local' && nextMode !== 'stable') return;
      handleLibrarySourceChange(nextMode);
    };

    window.addEventListener(MUSIC_LIBRARY_SOURCE_CHANGE_EVENT, onSourceChange as EventListener);
    return () => {
      window.removeEventListener(MUSIC_LIBRARY_SOURCE_CHANGE_EVENT, onSourceChange as EventListener);
    };
  }, [embedded, handleLibrarySourceChange]);

  useEffect(() => {
    if (!isOpen) return;
    if (librarySourceMode === 'stable') {
      updateCoverRuntimePolicy('hidden');
      void loadStableLibraryEntries(searchQuery);
      return;
    }
    updateCoverRuntimePolicy(viewMode === 'albums' ? 'watch' : 'high');
    void loadLibraryData();
  }, [
    isOpen,
    librarySourceMode,
    loadLibraryData,
    loadStableLibraryEntries,
    searchQuery,
    updateCoverRuntimePolicy,
    viewMode,
  ]);

  useEffect(() => {
    if (librarySourceMode === 'stable') return;
    setShowStableQueuePanel(false);
    setEditingStableEntry(null);
  }, [librarySourceMode]);

  useEffect(() => {
    if (!isOpen) return;
    if (librarySourceMode !== 'local') return;
    void loadLibraryPaths();
  }, [isOpen, librarySourceMode, loadLibraryPaths]);

  useEffect(() => {
    if (librarySourceMode !== 'local') return;
    if (!showPathsManager) return;
    void loadLibraryPathHealth();
  }, [librarySourceMode, loadLibraryPathHealth, showPathsManager]);

  useEffect(() => {
    if (!isOpen) {
      updateCoverRuntimePolicy('hidden');
      return;
    }
    return () => {
      updateCoverRuntimePolicy('hidden');
    };
  }, [isOpen, updateCoverRuntimePolicy]);

  // 鐠併垽妲勯幍顐ｅ伎鏉╂稑瀹?
  useEffect(() => {
    if (librarySourceMode !== 'local') return;
    const unsubscribe = musicLibraryService.onScanProgress((progress) => {
      console.log('Scan progress:', progress);
      setScanProgress(progress);

      // 閹殿偅寮跨€瑰本鍨氶崥搴ゅ殰閸斻劌鍩涢弬鐗堟殶閹诡喖鎷扮捄顖氱窞閸掓銆?
      if (!progress.isScanning && progress.current > 0) {
        console.log('Scan completed, refreshing library...');
        clearModuleCache(); // 閴?濞撳懘娅庣紓鎾崇摠
        // 瀵ゆ儼绻滄稉鈧悙鍦€樻穱婵囨殶閹诡喖鍟撻崗銉ョ暚閹?
        setTimeout(() => {
          Promise.all([
            loadLibraryData(),
            loadLibraryPaths(), // 閸氬本妞傞崚閿嬫煀鐠侯垰绶為崚妤勩€?
          ]);
        }, 300); // 閸戝繐鐨鎯扮箿閸?300ms
      }
    });
    return unsubscribe;
  }, [librarySourceMode, loadLibraryData, loadLibraryPaths]);

  useEffect(() => {
    const map = new Map<string, AlbumSummary>();
    for (const a of albums) {
      map.set(albumKey(a.album, a.artist), a);
    }
    albumInfoByKeyRef.current = map;
  }, [albums]);

  useEffect(() => {
    if (!isOpen) return;
    if (librarySourceMode !== 'local') {
      updateCoverRuntimePolicy('hidden');
      return;
    }
    if (viewMode === 'albums') {
      updateCoverRuntimePolicy('watch');
      return;
    }

    if (searchQuery.trim()) {
      updateCoverRuntimePolicy('high');
      return;
    }

    updateCoverRuntimePolicy(hasMoreTracks ? 'watch' : 'high');
  }, [
    hasMoreTracks,
    isOpen,
    librarySourceMode,
    searchQuery,
    updateCoverRuntimePolicy,
    viewMode,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    if (librarySourceMode !== 'local') return;
    if (searchQuery.trim()) return;
    if (viewMode !== 'albums' && viewMode !== 'artists' && viewMode !== 'genres') return;
    void loadFacetCollections(viewMode, tracks);
  }, [isOpen, librarySourceMode, loadFacetCollections, searchQuery, tracks, viewMode]);

  const getAlbumCardRef = useCallback((key: string) => {
    const existing = albumCardRefCallbacksRef.current.get(key);
    if (existing) return existing;

    const cb = (el: HTMLDivElement | null) => {
      const previousEl = albumCardElementsRef.current.get(key);
      if (previousEl && previousEl !== el) {
        albumCoverObserverRef.current?.unobserve(previousEl);
      }

      if (el) {
        albumCardElementsRef.current.set(key, el);
        albumCoverObserverRef.current?.observe(el);
      } else {
        albumCardElementsRef.current.delete(key);
      }
    };

    albumCardRefCallbacksRef.current.set(key, cb);
    return cb;
  }, []);

  // Desktop/Tauri: 娑撴捁绶亸渚€娼伴幊鎺戝鏉炴枻绱橧ntersectionObserver + 楠炶泛褰傞梼鐔峰灙閿?
  useEffect(() => {
    if (!isOpen) return;
    if (!isTauriRuntime()) return;
    if (viewMode !== 'albums') return;
    if (typeof IntersectionObserver === 'undefined') return;

    const root = mainScrollRef.current;
    if (!root) return;

    const generation = (albumCoverGenerationRef.current += 1);
    let disposed = false;

    albumCoverQueueRef.current = [];
    albumCoverInFlightRef.current = 0;

    const maxConcurrency = searchQuery.trim() ? 2 : hasMoreTracks ? 2 : 3;
    const rootMargin = searchQuery.trim() ? '220px 0px' : hasMoreTracks ? '280px 0px' : '360px 0px';

    function scheduleDrain() {
      if (disposed) return;
      if (albumCoverDrainRafRef.current != null) return;
      albumCoverDrainRafRef.current = window.requestAnimationFrame(() => {
        albumCoverDrainRafRef.current = null;
        drainQueue();
      });
    }

    async function loadCoverForAlbumKey(key: string) {
      const info = albumInfoByKeyRef.current.get(key);
      if (!info || info.cover || !info.coverTrackPath) return;

      const stub: Track = {
        id: info.coverTrackId || `cover-${info.album}-${info.artist}`,
        title: info.album,
        album: info.album,
        artist: info.artist,
        filePath: info.coverTrackPath,
        path: info.coverTrackPath,
      };

      const url = await musicLibraryService.getCoverUrlForTrack(stub, { coverSizeHint: 'small' });
      if (!url) return;
      if (disposed) return;
      if (albumCoverGenerationRef.current !== generation) return;

      setAlbums((prev) =>
        prev.map((a) => (albumKey(a.album, a.artist) === key ? { ...a, cover: url } : a))
      );
    }

    function drainQueue() {
      if (disposed) return;

      while (albumCoverInFlightRef.current < maxConcurrency) {
        const nextKey = albumCoverQueueRef.current.shift();
        if (!nextKey) return;

        albumCoverInFlightRef.current += 1;
        void loadCoverForAlbumKey(nextKey)
          .catch(() => {})
          .finally(() => {
            albumCoverInFlightRef.current = Math.max(0, albumCoverInFlightRef.current - 1);
            scheduleDrain();
          });
      }
    }

    function enqueue(key: string) {
      if (disposed) return;
      if (requestedAlbumCoversRef.current.has(key)) return;

      const info = albumInfoByKeyRef.current.get(key);
      if (!info || info.cover || !info.coverTrackPath) return;

      requestedAlbumCoversRef.current.add(key);
      albumCoverQueueRef.current.push(key);
      scheduleDrain();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const key = (entry.target as HTMLElement).dataset.albumKey;
          if (!key) continue;
          enqueue(key);
        }
      },
      {
        root,
        rootMargin,
        threshold: 0.01,
      }
    );

    albumCoverObserverRef.current = observer;
    for (const el of albumCardElementsRef.current.values()) {
      observer.observe(el);
    }

    return () => {
      disposed = true;
      if (albumCoverDrainRafRef.current != null) {
        cancelAnimationFrame(albumCoverDrainRafRef.current);
        albumCoverDrainRafRef.current = null;
      }
      observer.disconnect();
      if (albumCoverObserverRef.current === observer) {
        albumCoverObserverRef.current = null;
      }
    };
  }, [hasMoreTracks, isOpen, searchQuery, viewMode]);

  // 婢跺嫮鎮婇弬鍥︽婢惰澹傞幓?
  const handleScanFolder = async () => {
    const releaseProtection = beginAudioProtection('music-library-scan', 90_000);
    try {
      console.log('Starting folder scan...');
      await musicLibraryService.scanFolder();
      console.log('Folder scan completed, refreshing library data...');
      // 閹殿偅寮跨€瑰本鍨氶崥搴㈢闂勩倗绱︾€涙ê鑻熼崚閿嬫煀閺佺増宓侀崪宀冪熅瀵板嫬鍨悰?
      clearModuleCache(); // 閴?濞撳懘娅庣紓鎾崇摠閿涘苯宸遍崚鍫曞櫢閺傛澘濮炴潪?
      await Promise.all([
        loadLibraryData(),
        loadLibraryPaths(), // 閸掗攱鏌婄捄顖氱窞閸掓銆?
      ]);
      console.log('Library data and paths refreshed');
      setErrorMessage(null);
    } catch (error) {
      console.error('Failed to scan folder:', error);
      setErrorMessage(
        t('pages.music-library.error.scanFolderFailed', {
          message: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      releaseProtection();
    }
  };

  const handleCancelScan = async () => {
    try {
      await musicLibraryService.cancelCurrentScan();
    } catch (error) {
      console.error('Failed to cancel scan:', error);
    }
  };
  const handleClearLibrary = async () => {
    await musicLibraryService.clearLibrary();
    clearModuleCache();
    await loadLibraryData();
    setShowClearConfirm(false);
  };

  const handleSearch = useCallback(async (query: string) => {
    bumpAudioProtection('music-library-search', 20_000);
    const token = ++searchTokenRef.current;
    setRenderedTrackLimit(TRACK_RENDER_CHUNK_SIZE);

    if (query.trim()) {
      const results = await musicLibraryService.searchTracks(query, 600);
      if (token !== searchTokenRef.current) return;

      const compactResults = compactTracksForLibrary(results);
      setTracks(compactResults);
      trackNextOffsetRef.current = results.length;
      setHasMoreTracks(false);
      updateCoverRuntimePolicy(viewMode === 'albums' ? 'watch' : 'high');

      const uniqueArtists = Array.from(
        new Set(compactResults.map((track) => track.artist).filter(Boolean))
      );
      const uniqueGenres = Array.from(
        new Set(compactResults.map((track) => track.genre).filter(Boolean))
      );

      const albumMap = new Map<string, AlbumSummary>();
      compactResults.forEach((track) => {
        if (!track.album) return;

        const key = `${track.album}-${track.artist}`;
        if (albumMap.has(key)) return;

        albumMap.set(key, {
          album: track.album,
          artist: track.artist || t('common.unknown.artist'),
          cover:
            typeof track.coverUrl === 'string' &&
            (track.coverUrl.toLowerCase().startsWith('data:') ||
              track.coverUrl.toLowerCase().startsWith('blob:') ||
              track.coverUrl.toLowerCase().startsWith('http:') ||
              track.coverUrl.toLowerCase().startsWith('https:') ||
              track.coverUrl.toLowerCase().startsWith('pmp://cover/'))
              ? track.coverUrl
              : undefined,
          coverTrackPath: track.filePath || track.path,
          coverTrackId: track.id,
        });
      });

      const uniqueAlbums = Array.from(albumMap.values());

      setArtists(uniqueArtists as string[]);
      setGenres(uniqueGenres as string[]);
      requestedAlbumCoversRef.current.clear();
      setAlbums(uniqueAlbums);
      moduleCache = buildModuleCacheSnapshot({
        tracks: compactResults,
        artists: uniqueArtists as string[],
        albums: uniqueAlbums,
        genres: uniqueGenres as string[],
        trackNextOffset: trackNextOffsetRef.current,
        hasMoreTracks: false,
      });
    } else {
      await resetLibraryDataFromStorage();
      if (token !== searchTokenRef.current) return;
      updateCoverRuntimePolicy(viewMode === 'albums' ? 'watch' : 'high');
    }

    maybeLoadTrackChunkFromScroll();
  }, [
    bumpAudioProtection,
    maybeLoadTrackChunkFromScroll,
    resetLibraryDataFromStorage,
    updateCoverRuntimePolicy,
    viewMode,
    t,
  ]);

  const handleSearchInputChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (searchDebounceTimerRef.current != null) {
        window.clearTimeout(searchDebounceTimerRef.current);
      }
      searchDebounceTimerRef.current = window.setTimeout(() => {
        if (librarySourceMode === 'stable') {
          void loadStableLibraryEntries(query);
          return;
        }
        void handleSearch(query);
      }, SEARCH_DEBOUNCE_MS);
    },
    [handleSearch, librarySourceMode, loadStableLibraryEntries]
  );

  useEffect(() => {
    return () => {
      if (searchDebounceTimerRef.current != null) {
        window.clearTimeout(searchDebounceTimerRef.current);
        searchDebounceTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const stored = readJson<unknown>(
      STORAGE_KEYS.MUSIC_LIBRARY_TRACK_COLUMNS_V1,
      DEFAULT_LOCAL_TRACK_COLUMN_SETTINGS
    );
    setLocalTrackColumnSettings(normalizeLocalTrackColumnSettings(stored));
    setLocalTrackColumnsLoaded(true);
  }, []);

  useEffect(() => {
    if (!localTrackColumnsLoaded) return;
    writeJson(STORAGE_KEYS.MUSIC_LIBRARY_TRACK_COLUMNS_V1, localTrackColumnSettings, {
      mode: 'idle',
      debounceMs: 150,
    });
  }, [localTrackColumnSettings, localTrackColumnsLoaded]);

  const toggleLocalTrackColumn = useCallback(
    (columnId: LocalTrackColumnId) => {
      setLocalTrackColumnSettings((previous) => {
        const current = previous.find((item) => item.id === columnId);
        if (!current) return previous;
        if (current.visible) {
          const visibleCount = previous.filter((item) => item.visible).length;
          if (visibleCount <= 1) {
            setErrorMessage(t('pages.music-library.columns.atLeastOneVisible'));
            return previous;
          }
        }

        return previous.map((item) =>
          item.id === columnId
            ? {
                ...item,
                visible: !item.visible,
              }
            : item
        );
      });
    },
    [t]
  );

  const moveLocalTrackColumn = useCallback((columnId: LocalTrackColumnId, offset: -1 | 1) => {
    setLocalTrackColumnSettings((previous) => {
      const index = previous.findIndex((item) => item.id === columnId);
      if (index < 0) return previous;
      const targetIndex = index + offset;
      if (targetIndex < 0 || targetIndex >= previous.length) return previous;
      const next = [...previous];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  }, []);

  const moveLocalTrackColumnTo = useCallback(
    (columnId: LocalTrackColumnId, targetColumnId: LocalTrackColumnId) => {
      if (columnId === targetColumnId) return;
      setLocalTrackColumnSettings((previous) => {
        const fromIndex = previous.findIndex((item) => item.id === columnId);
        const toIndex = previous.findIndex((item) => item.id === targetColumnId);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return previous;
        const next = [...previous];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
    []
  );

  const setLocalTrackColumnWidth = useCallback((columnId: LocalTrackColumnId, widthPx: number) => {
    setLocalTrackColumnSettings((previous) => {
      let changed = false;
      const next = previous.map((item) => {
        if (item.id !== columnId) return item;
        const normalizedWidthPx = normalizeLocalTrackColumnWidth(columnId, widthPx);
        if (item.widthPx === normalizedWidthPx) return item;
        changed = true;
        return {
          ...item,
          widthPx: normalizedWidthPx,
        };
      });
      return changed ? next : previous;
    });
  }, []);

  const flushLocalTrackColumnResize = useCallback(() => {
    localTrackColumnResizeRafRef.current = null;
    const pending = localTrackColumnResizePendingRef.current;
    if (!pending) return;
    localTrackColumnResizePendingRef.current = null;
    setLocalTrackColumnWidth(pending.columnId, pending.widthPx);
  }, [setLocalTrackColumnWidth]);

  const cancelLocalTrackColumnResizeFrame = useCallback(() => {
    if (localTrackColumnResizeRafRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(localTrackColumnResizeRafRef.current);
    }
    localTrackColumnResizeRafRef.current = null;
    localTrackColumnResizePendingRef.current = null;
  }, []);

  const scheduleLocalTrackColumnResize = useCallback(
    (columnId: LocalTrackColumnId, widthPx: number) => {
      localTrackColumnResizePendingRef.current = {
        columnId,
        widthPx,
      };

      if (typeof window === 'undefined') {
        flushLocalTrackColumnResize();
        return;
      }

      if (localTrackColumnResizeRafRef.current !== null) {
        return;
      }

      localTrackColumnResizeRafRef.current = window.requestAnimationFrame(() => {
        flushLocalTrackColumnResize();
      });
    },
    [flushLocalTrackColumnResize]
  );

  useEffect(() => {
    dragOverLocalTrackColumnIdRef.current = dragOverLocalTrackColumnId;
  }, [dragOverLocalTrackColumnId]);

  const setLocalTrackColumnHeaderElement = useCallback(
    (columnId: LocalTrackColumnId, element: HTMLDivElement | null) => {
      const map = localTrackColumnHeaderElementsRef.current;
      if (element) {
        map.set(columnId, element);
      } else {
        map.delete(columnId);
      }
    },
    []
  );

  const getNearestLocalTrackColumnId = useCallback(
    (clientX: number): LocalTrackColumnId | null => {
      let targetId: LocalTrackColumnId | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const column of localTrackColumnSettings) {
        if (!column.visible) continue;
        const element = localTrackColumnHeaderElementsRef.current.get(column.id);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const distance = Math.abs(clientX - center);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          targetId = column.id;
        }
      }

      return targetId;
    },
    [localTrackColumnSettings]
  );

  const handleLocalTrackColumnPointerDown = useCallback(
    (columnId: LocalTrackColumnId, event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (resizingLocalTrackColumnId) return;

      localTrackColumnReorderSessionRef.current = {
        pointerId: event.pointerId,
        columnId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        dragging: false,
      };
      setDragOverLocalTrackColumnId(null);
      setIsLocalTrackColumnReordering(true);
    },
    [resizingLocalTrackColumnId]
  );

  useEffect(() => {
    if (!isLocalTrackColumnReordering) return;
    const session = localTrackColumnReorderSessionRef.current;
    if (!session) return;

    const previousBodyCursor = document.body.style.cursor;
    const previousBodyUserSelect = document.body.style.userSelect;

    const stopSession = () => {
      localTrackColumnReorderSessionRef.current = null;
      setDraggingLocalTrackColumnId(null);
      setDragOverLocalTrackColumnId(null);
      dragOverLocalTrackColumnIdRef.current = null;
      setIsLocalTrackColumnReordering(false);
      document.body.style.cursor = previousBodyCursor;
      document.body.style.userSelect = previousBodyUserSelect;
    };

    const handlePointerMove = (event: PointerEvent) => {
      const current = localTrackColumnReorderSessionRef.current;
      if (!current || event.pointerId !== current.pointerId) return;

      const deltaX = event.clientX - current.startClientX;
      const deltaY = event.clientY - current.startClientY;
      const travel = Math.hypot(deltaX, deltaY);

      if (!current.dragging && travel < 6) {
        return;
      }

      if (!current.dragging) {
        current.dragging = true;
        setDraggingLocalTrackColumnId(current.columnId);
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      }

      const targetId = getNearestLocalTrackColumnId(event.clientX);
      if (targetId) {
        dragOverLocalTrackColumnIdRef.current = targetId;
        setDragOverLocalTrackColumnId((previous) => (previous === targetId ? previous : targetId));
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const current = localTrackColumnReorderSessionRef.current;
      if (!current || event.pointerId !== current.pointerId) return;

      if (current.dragging) {
        const targetId =
          getNearestLocalTrackColumnId(event.clientX) ?? dragOverLocalTrackColumnIdRef.current;
        if (targetId && targetId !== current.columnId) {
          moveLocalTrackColumnTo(current.columnId, targetId);
        }
      }

      stopSession();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const current = localTrackColumnReorderSessionRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      stopSession();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      document.body.style.cursor = previousBodyCursor;
      document.body.style.userSelect = previousBodyUserSelect;
    };
  }, [getNearestLocalTrackColumnId, isLocalTrackColumnReordering, moveLocalTrackColumnTo]);

  const syncLocalTrackHorizontalScroll = useCallback((source: 'header' | 'body') => {
    if (localTrackHorizontalScrollSyncingRef.current) return;
    const header = localTrackListHeaderScrollRef.current;
    const body = localTrackListBodyScrollRef.current;
    if (!header || !body) return;

    localTrackHorizontalScrollSyncingRef.current = true;
    if (source === 'body') {
      header.scrollLeft = body.scrollLeft;
    } else {
      body.scrollLeft = header.scrollLeft;
    }
    localTrackHorizontalScrollSyncingRef.current = false;
  }, []);

  const handleLocalTrackHeaderScroll = useCallback(() => {
    syncLocalTrackHorizontalScroll('header');
  }, [syncLocalTrackHorizontalScroll]);

  const handleLocalTrackBodyScroll = useCallback(() => {
    syncLocalTrackHorizontalScroll('body');
  }, [syncLocalTrackHorizontalScroll]);

  const handleLocalTrackColumnResizePointerDown = useCallback(
    (columnId: LocalTrackColumnId, event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const currentSetting = localTrackColumnSettings.find((item) => item.id === columnId);
      if (!currentSetting) return;

      localTrackColumnResizeSessionRef.current = {
        pointerId: event.pointerId,
        columnId,
        startClientX: event.clientX,
        startWidthPx: normalizeLocalTrackColumnWidth(columnId, currentSetting.widthPx),
      };
      setResizingLocalTrackColumnId(columnId);
    },
    [localTrackColumnSettings]
  );

  const resetLocalTrackColumns = useCallback(() => {
    setLocalTrackColumnSettings(DEFAULT_LOCAL_TRACK_COLUMN_SETTINGS.map((item) => ({ ...item })));
  }, []);

  useEffect(() => {
    return () => {
      cancelLocalTrackColumnResizeFrame();
    };
  }, [cancelLocalTrackColumnResizeFrame]);

  useEffect(() => {
    if (!resizingLocalTrackColumnId) return;

    const previousBodyCursor = document.body.style.cursor;
    const previousBodyUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const stopResize = () => {
      cancelLocalTrackColumnResizeFrame();
      localTrackColumnResizeSessionRef.current = null;
      setResizingLocalTrackColumnId(null);
      document.body.style.cursor = previousBodyCursor;
      document.body.style.userSelect = previousBodyUserSelect;
    };

    const resolveResizeWidth = (
      event: PointerEvent
    ): { columnId: LocalTrackColumnId; widthPx: number } | null => {
      const session = localTrackColumnResizeSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return null;
      const delta = event.clientX - session.startClientX;
      return {
        columnId: session.columnId,
        widthPx: session.startWidthPx + delta,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = resolveResizeWidth(event);
      if (!nextWidth) return;
      scheduleLocalTrackColumnResize(nextWidth.columnId, nextWidth.widthPx);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const nextWidth = resolveResizeWidth(event);
      if (!nextWidth) return;
      cancelLocalTrackColumnResizeFrame();
      setLocalTrackColumnWidth(nextWidth.columnId, nextWidth.widthPx);
      stopResize();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const session = localTrackColumnResizeSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      flushLocalTrackColumnResize();
      stopResize();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      cancelLocalTrackColumnResizeFrame();
      document.body.style.cursor = previousBodyCursor;
      document.body.style.userSelect = previousBodyUserSelect;
      if (localTrackColumnResizeSessionRef.current?.columnId === resizingLocalTrackColumnId) {
        localTrackColumnResizeSessionRef.current = null;
      }
    };
  }, [
    cancelLocalTrackColumnResizeFrame,
    flushLocalTrackColumnResize,
    resizingLocalTrackColumnId,
    scheduleLocalTrackColumnResize,
    setLocalTrackColumnWidth,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    if (librarySourceMode !== 'local') return;
    if (viewMode === 'albums') return;
    if (searchQuery.trim()) return;
    maybeLoadTrackChunkFromScroll();
  }, [isOpen, librarySourceMode, maybeLoadTrackChunkFromScroll, searchQuery, viewMode, tracks.length]);

  // 閹烘帒绨径鍕倞閸戣姤鏆?
  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      // 婵″倹鐏夊鑼病閺勵垰缍嬮崜宥嗗笓鎼村繐鐡у▓纰夌礉閸掑洦宕查幒鎺戠碍閺傜懓鎮?
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // 閸掑洦宕查崚鐗堟煀閻ㄥ嫭甯撴惔蹇撶摟濞堢绱濇妯款吇閸楀洤绨?
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  // 鎼存梻鏁ら幒鎺戠碍閸掔増鏆熺紒?
  const applySorting = useCallback(<T extends Track | { album: string; artist: string }>(items: T[]): T[] => {
    if (sortBy === 'default') return items;

    const sorted = [...items];
    sorted.sort((a, b) => {
      let compareA: string | number = '';
      let compareB: string | number = '';

      // 閺嶈宓侀幒鎺戠碍鐎涙顔岄懢宄板絿濮ｆ棁绶濋崐?
      if ('title' in a && sortBy === 'title') {
        compareA = (a as Track).title?.toLowerCase() || '';
        compareB = (b as Track).title?.toLowerCase() || '';
      } else if (sortBy === 'artist') {
        compareA = ('artist' in a ? a.artist : '')?.toLowerCase() || '';
        compareB = ('artist' in b ? b.artist : '')?.toLowerCase() || '';
      } else if (sortBy === 'album') {
        compareA = ('album' in a ? a.album : '')?.toLowerCase() || '';
        compareB = ('album' in b ? b.album : '')?.toLowerCase() || '';
      } else if ('duration' in a && sortBy === 'duration') {
        compareA = (a as Track).duration || 0;
        compareB = (b as Track).duration || 0;
      } else if ('year' in a && sortBy === 'year') {
        compareA = (a as Track).year || 0;
        compareB = (b as Track).year || 0;
      } else {
        return 0;
      }

      // 濮ｆ棁绶?
      let result = 0;
      if (typeof compareA === 'string' && typeof compareB === 'string') {
        result = compareA.localeCompare(compareB);
      } else {
        result = Number(compareA) - Number(compareB);
      }

      // 鎼存梻鏁ら幒鎺戠碍閺傜懓鎮?
      return sortOrder === 'asc' ? result : -result;
    });

    return sorted;
  }, [sortBy, sortOrder]);

  // 閼惧嘲褰囨潻鍥ㄦ姢閸滃本甯撴惔蹇撴倵閻ㄥ嫯寤洪柆?
  const filteredTracks = useMemo(() => {
    let filtered = tracks;

    if (selectedArtist) {
      filtered = filtered.filter((t) => t.artist === selectedArtist);
    }
    if (selectedAlbum) {
      filtered = filtered.filter((t) => t.album === selectedAlbum);
    }
    if (selectedGenre) {
      filtered = filtered.filter((t) => t.genre === selectedGenre);
    }

    return applySorting(filtered);
  }, [applySorting, selectedAlbum, selectedArtist, selectedGenre, tracks]);

  // 閼惧嘲褰囬幒鎺戠碍閸氬海娈戞稉鎾圭帆閸掓銆?
  const sortedAlbums = useMemo(() => applySorting(albums), [albums, applySorting]);

  const sortedStableEntries = useMemo(() => {
    return [...stableEntries].sort((a, b) => {
      const updatedDiff = (b.updatedAtMs || 0) - (a.updatedAtMs || 0);
      if (updatedDiff !== 0) return updatedDiff;
      return a.id.localeCompare(b.id);
    });
  }, [stableEntries]);

  const stableLibraryStats = useMemo(() => {
    const totalEntries = stableEntries.length;
    const inCloud = stableEntries.filter((entry) => entry.inCloud).length;
    const missing = stableEntries.filter((entry) => entry.isMissing).length;
    return {
      totalEntries,
      inCloud,
      missing,
      localReady: Math.max(0, totalEntries - missing),
    };
  }, [stableEntries]);

  const visibleLocalTrackColumns = useMemo(
    () => localTrackColumnSettings.filter((item) => item.visible),
    [localTrackColumnSettings]
  );

  const localTrackResponsiveWidth =
    localTrackLayoutWidth > 0
      ? localTrackLayoutWidth
      : mainViewport.clientWidth > 0
        ? mainViewport.clientWidth
        : 960;

  const renderedLocalTrackColumns = useMemo(() => {
    return visibleLocalTrackColumns;
  }, [visibleLocalTrackColumns]);

  const resolvedLocalTrackColumnWidths = useMemo(() => {
    const widthById = new Map<LocalTrackColumnId, number>();

    for (const column of renderedLocalTrackColumns) {
      widthById.set(column.id, normalizeLocalTrackColumnWidth(column.id, column.widthPx));
    }

    if (renderedLocalTrackColumns.length === 0) {
      return widthById;
    }

    const viewportWidth = localTrackResponsiveWidth;
    const totalColumnCount = renderedLocalTrackColumns.length + 2;
    const gapTotal = Math.max(0, totalColumnCount - 1) * LOCAL_TRACK_GRID_GAP_PX;
    const reservedWidth =
      LOCAL_TRACK_INDEX_COLUMN_WIDTH_PX + LOCAL_TRACK_ACTIONS_COLUMN_WIDTH_PX + gapTotal;
    const contentWidthBudget = Math.max(0, viewportWidth - reservedWidth);
    const totalMinWidth = renderedLocalTrackColumns.reduce((sum, column) => {
      return sum + LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].minWidthPx;
    }, 0);

    const titleColumn = renderedLocalTrackColumns.find((column) => column.id === 'title');
    if (titleColumn) {
      const titleDefinition = LOCAL_TRACK_COLUMN_DEFINITIONS.title;
      const nonTitleMinimumWidth = totalMinWidth - titleDefinition.minWidthPx;
      const titleSoftMax = Math.floor(contentWidthBudget * LOCAL_TRACK_TITLE_MAX_VIEWPORT_RATIO);
      const titleHardMax = contentWidthBudget - nonTitleMinimumWidth;
      const definitionMax = titleDefinition.maxWidthPx ?? Number.POSITIVE_INFINITY;
      const cappedTitleMax = Math.max(
        titleDefinition.minWidthPx,
        Math.min(definitionMax, Math.min(titleSoftMax, titleHardMax))
      );

      const currentTitleWidth = widthById.get('title') ?? titleDefinition.defaultWidthPx;
      widthById.set('title', Math.min(currentTitleWidth, cappedTitleMax));
    }

    const totalAdjustedWidth = renderedLocalTrackColumns.reduce((sum, column) => {
      return sum + (widthById.get(column.id) ?? LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].defaultWidthPx);
    }, 0);

    if (totalAdjustedWidth <= contentWidthBudget) {
      return widthById;
    }

    if (totalMinWidth >= contentWidthBudget) {
      for (const column of renderedLocalTrackColumns) {
        widthById.set(column.id, LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].minWidthPx);
      }
      return widthById;
    }

    const shrinkableWidth = renderedLocalTrackColumns.reduce((sum, column) => {
      const minWidth = LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].minWidthPx;
      const currentWidth =
        widthById.get(column.id) ?? LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].defaultWidthPx;
      return sum + Math.max(0, currentWidth - minWidth);
    }, 0);

    if (shrinkableWidth <= 0) {
      return widthById;
    }

    const reduceWidth = totalAdjustedWidth - contentWidthBudget;
    for (const column of renderedLocalTrackColumns) {
      const definition = LOCAL_TRACK_COLUMN_DEFINITIONS[column.id];
      const currentWidth = widthById.get(column.id) ?? definition.defaultWidthPx;
      const capacity = Math.max(0, currentWidth - definition.minWidthPx);
      if (capacity <= 0) continue;
      const ratio = capacity / shrinkableWidth;
      const nextWidth = currentWidth - reduceWidth * ratio;
      widthById.set(column.id, Math.max(definition.minWidthPx, Math.round(nextWidth)));
    }

    return widthById;
  }, [localTrackResponsiveWidth, renderedLocalTrackColumns]);

  const localTrackGridTemplate = useMemo(() => {
    const columnWidths = renderedLocalTrackColumns
      .map((item) => {
        const definition = LOCAL_TRACK_COLUMN_DEFINITIONS[item.id];
        const widthPx =
          resolvedLocalTrackColumnWidths.get(item.id) ??
          normalizeLocalTrackColumnWidth(item.id, item.widthPx);
        return `minmax(${definition.minWidthPx}px, ${widthPx}px)`;
      })
      .join(' ');
    return `${LOCAL_TRACK_INDEX_COLUMN_WIDTH_PX}px ${columnWidths} ${LOCAL_TRACK_ACTIONS_COLUMN_WIDTH_PX}px`;
  }, [renderedLocalTrackColumns, resolvedLocalTrackColumnWidths]);

  useEffect(() => {
    const header = localTrackListHeaderScrollRef.current;
    const body = localTrackListBodyScrollRef.current;
    if (!header || !body) return;
    header.scrollLeft = body.scrollLeft;
  }, [localTrackGridTemplate, renderedLocalTrackColumns.length]);

  const visibleLocalTrackColumnCount = visibleLocalTrackColumns.length;

  const filteredTracksTotal = filteredTracks.length;

  useEffect(() => {
    if (viewMode === 'albums') {
      setRenderedTrackLimit(filteredTracksTotal);
      return;
    }

    setRenderedTrackLimit((prev) => {
      if (!Number.isFinite(prev) || prev <= 0) {
        return Math.min(filteredTracksTotal, TRACK_RENDER_CHUNK_SIZE);
      }
      return Math.min(filteredTracksTotal, prev);
    });
  }, [filteredTracksTotal, viewMode]);

  const renderedTracks = useMemo(() => {
    if (renderedTrackLimit >= filteredTracks.length) return filteredTracks;
    return filteredTracks.slice(0, renderedTrackLimit);
  }, [filteredTracks, renderedTrackLimit]);

  const trackVirtualWindow = useMemo(() => {
    const viewportHeight = mainViewport.clientHeight > 0 ? mainViewport.clientHeight : 720;
    const effectiveScrollTop = Math.max(0, mainViewport.scrollTop - TRACK_LIST_HEADER_HEIGHT_PX);
    const visibleRows = Math.max(1, Math.ceil(viewportHeight / TRACK_ROW_HEIGHT_PX));
    const start = Math.max(
      0,
      Math.floor(effectiveScrollTop / TRACK_ROW_HEIGHT_PX) - TRACK_WINDOW_OVERSCAN_ROWS
    );
    const end = Math.min(
      renderedTracks.length,
      start + visibleRows + TRACK_WINDOW_OVERSCAN_ROWS * 2
    );

    return {
      start,
      end,
      topSpacerPx: start * TRACK_ROW_HEIGHT_PX,
      bottomSpacerPx: Math.max(0, (renderedTracks.length - end) * TRACK_ROW_HEIGHT_PX),
    };
  }, [mainViewport.clientHeight, mainViewport.scrollTop, renderedTracks.length]);

  const virtualizedTracks = useMemo(
    () => renderedTracks.slice(trackVirtualWindow.start, trackVirtualWindow.end),
    [renderedTracks, trackVirtualWindow.end, trackVirtualWindow.start]
  );

  const albumVirtualWindow = useMemo(() => {
    const viewportHeight = mainViewport.clientHeight > 0 ? mainViewport.clientHeight : 720;
    const contentWidth = Math.max(240, (mainViewport.clientWidth || 900) - 40);
    const columns = Math.max(
      1,
      Math.floor((contentWidth + ALBUM_GRID_GAP_PX) / (ALBUM_CARD_MIN_WIDTH_PX + ALBUM_GRID_GAP_PX))
    );
    const cardWidth =
      (contentWidth - (columns - 1) * ALBUM_GRID_GAP_PX) / Math.max(1, columns);
    const rowHeight = Math.max(180, cardWidth + ALBUM_CARD_VERTICAL_EXTRA_PX);
    const totalRows = Math.ceil(sortedAlbums.length / columns);
    const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowHeight));
    const startRow = Math.max(
      0,
      Math.floor(mainViewport.scrollTop / rowHeight) - ALBUM_WINDOW_OVERSCAN_ROWS
    );
    const endRow = Math.min(
      totalRows,
      startRow + visibleRows + ALBUM_WINDOW_OVERSCAN_ROWS * 2
    );
    const start = Math.min(sortedAlbums.length, startRow * columns);
    const end = Math.min(sortedAlbums.length, endRow * columns);

    return {
      start,
      end,
      topSpacerPx: startRow * rowHeight,
      bottomSpacerPx: Math.max(0, (totalRows - endRow) * rowHeight),
    };
  }, [
    mainViewport.clientHeight,
    mainViewport.clientWidth,
    mainViewport.scrollTop,
    sortedAlbums.length,
  ]);

  const virtualizedAlbums = useMemo(
    () => sortedAlbums.slice(albumVirtualWindow.start, albumVirtualWindow.end),
    [albumVirtualWindow.end, albumVirtualWindow.start, sortedAlbums]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (viewMode !== 'albums') {
      const releaseUrls: string[] = [];
      setAlbums((previousAlbums) => {
        let changed = false;
        const nextAlbums = previousAlbums.map((albumItem) => {
          if (!albumItem.cover) return albumItem;
          const coverUrl = albumItem.cover.trim();
          if (coverUrl) releaseUrls.push(coverUrl);
          changed = true;
          return { ...albumItem, cover: undefined };
        });
        return changed ? nextAlbums : previousAlbums;
      });

      requestedAlbumCoversRef.current.clear();
      if (releaseUrls.length > 0) {
        musicLibraryService.releaseCoverUrls(releaseUrls);
      }
      return;
    }

    if (albumOffscreenReclaimTimerRef.current != null) {
      window.clearTimeout(albumOffscreenReclaimTimerRef.current);
    }

    albumOffscreenReclaimTimerRef.current = window.setTimeout(() => {
      albumOffscreenReclaimTimerRef.current = null;

      const keepAlbumKeys = new Set<string>(
        virtualizedAlbums.map((albumItem) => albumKey(albumItem.album, albumItem.artist))
      );
      const releaseUrls: string[] = [];
      const droppedAlbumKeys: string[] = [];

      setAlbums((previousAlbums) => {
        let changed = false;
        const nextAlbums = previousAlbums.map((albumItem) => {
          if (!albumItem.cover) return albumItem;

          const key = albumKey(albumItem.album, albumItem.artist);
          if (keepAlbumKeys.has(key)) return albumItem;

          const coverUrl = albumItem.cover.trim();
          if (coverUrl) releaseUrls.push(coverUrl);
          droppedAlbumKeys.push(key);
          changed = true;
          return { ...albumItem, cover: undefined };
        });

        return changed ? nextAlbums : previousAlbums;
      });

      if (droppedAlbumKeys.length > 0) {
        for (const key of droppedAlbumKeys) {
          requestedAlbumCoversRef.current.delete(key);
        }
      }

      if (releaseUrls.length > 0) {
        musicLibraryService.releaseCoverUrls(releaseUrls);
      }
    }, 450);

    return () => {
      if (albumOffscreenReclaimTimerRef.current != null) {
        window.clearTimeout(albumOffscreenReclaimTimerRef.current);
        albumOffscreenReclaimTimerRef.current = null;
      }
    };
  }, [isOpen, viewMode, virtualizedAlbums]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    if (mainScrollRestoreStateRef.current.viewMode !== viewMode) {
      mainScrollRestoreStateRef.current = { viewMode, done: false };
      mainScrollUserDirtyRef.current = false;
    }

    if (mainScrollRestoreStateRef.current.done) return;

    const memory = moduleScrollMemory[viewMode];
    const root = getMainScrollRoot(memory?.rootKind);
    if (!root) return;
    const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);

    if (viewMode !== 'albums' && memory) {
      const anchor = memory.anchor;
      if (anchor?.kind === 'track') {
        const anchorIndex = filteredTracks.findIndex((track) => track.id === anchor.id);
        if (anchorIndex >= 0) {
          const desiredLimit = Math.min(
            filteredTracks.length,
            Math.max(renderedTrackLimit, anchorIndex + TRACK_RENDER_CHUNK_SIZE)
          );
          if (desiredLimit > renderedTrackLimit) {
            setRenderedTrackLimit(desiredLimit);
            return;
          }
        } else if (hasMoreTracks) {
          void scheduleTrackChunkLoad();
          return;
        }
      }

      const desiredScrollTop = memory.scrollTop;
      if (
        desiredScrollTop > 0 &&
        desiredScrollTop > maxScrollTop + 1 &&
        (renderedTrackLimit < filteredTracks.length || hasMoreTracks)
      ) {
        if (renderedTrackLimit < filteredTracks.length) {
          setRenderedTrackLimit((prev) => {
            if (prev >= filteredTracks.length) return prev;
            return Math.min(filteredTracks.length, prev + TRACK_RENDER_CHUNK_SIZE);
          });
          return;
        }

        if (hasMoreTracks) {
          void scheduleTrackChunkLoad();
          return;
        }
      }
    }

    const setScrollTop = (target: number) => {
      const clamped = Math.min(Math.max(0, target), maxScrollTop);
      if (root.scrollTop === clamped) return;
      isRestoringMainScrollRef.current = true;
      root.scrollTop = clamped;
      window.requestAnimationFrame(() => {
        isRestoringMainScrollRef.current = false;
      });
    };

    const tryRestoreFromScrollTop = (scrollTop: number): boolean => {
      if (scrollTop !== 0 && scrollTop > maxScrollTop) {
        return false;
      }
      setScrollTop(scrollTop);
      return true;
    };

    if (!memory) {
      setScrollTop(0);
      mainScrollRestoreStateRef.current.done = true;
      return;
    }

    const anchor = memory.anchor;
    if (anchor) {
      if (anchor.kind === 'track') {
        const selector = `[data-track-id="${escapeCssSelector(anchor.id)}"]`;
        const element = root.querySelector<HTMLElement>(selector);
        if (element) {
          const rootRect = root.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const elementTopInContent = elementRect.top - rootRect.top + root.scrollTop;
          const targetScrollTop = elementTopInContent - anchor.offset;
          setScrollTop(targetScrollTop);
          mainScrollRestoreStateRef.current.done = true;
          return;
        }
      } else if (anchor.kind === 'album') {
        const selector = `[data-album-key="${escapeCssSelector(anchor.key)}"]`;
        const element = root.querySelector<HTMLElement>(selector);
        if (element) {
          const rootRect = root.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const elementTopInContent = elementRect.top - rootRect.top + root.scrollTop;
          const targetScrollTop = elementTopInContent - anchor.offset;
          setScrollTop(targetScrollTop);
          mainScrollRestoreStateRef.current.done = true;
          return;
        }
      }
    }

    if (tryRestoreFromScrollTop(memory.scrollTop)) {
      mainScrollRestoreStateRef.current.done = true;
    }
  }, [
    albums.length,
    artists.length,
    escapeCssSelector,
    filteredTracks,
    genres.length,
    getMainScrollRoot,
    hasMoreTracks,
    isOpen,
    librarySourceMode,
    libraryStats.totalTracks,
    renderedTrackLimit,
    scheduleTrackChunkLoad,
    tracks.length,
    viewMode,
  ]);

  // 閸楁洖鍤稉鎾圭帆 - 鐎佃壈鍩呴崚棰佺瑩鏉堟垼顕涢幆鍛淬€?
  const handleAlbumClick = (albumName: string, artist: string) => {
    if (embedded) {
      // 閸︹暋mbedded濡€崇础娑撳绱濈€佃壈鍩呴崚棰佺瑩鏉堟垿銆夐棃?
      navigateTo('album', { albumName, artist });
    }
  };

  // 閸欏苯鍤稉鎾圭帆 - 閹绢厽鏂佹稉鎾圭帆
  const handlePlayAlbum = async (album: string) => {
    if (!onPlayNow) {
      console.log('Play album:', album, '(embedded mode - no playback)');
      return;
    }
    const albumTracks = await musicLibraryService.getTracksByAlbum(album);
    if (albumTracks.length > 0) {
      onPlayNow(albumTracks);
    }
  };

  // 閹绢厽鏂侀懝鐑樻钩鐎?
  const handlePlayArtist = async (artist: string) => {
    if (!onPlayNow) {
      console.log('Play artist:', artist, '(embedded mode - no playback)');
      return;
    }
    const artistTracks = await musicLibraryService.getTracksByArtist(artist);
    if (artistTracks.length > 0) {
      onPlayNow(artistTracks);
    }
  };

  // 閸欏苯鍤灞炬锤閿涙碍鍧婇崝鐘冲閺堝绻冨銈呮倵閻ㄥ嫭鐡曢弴鎻掑煂闂冪喎鍨敍灞肩矤闁鑵戦惃鍕摃閺囨彃绱戞慨瀣尡閺€?
  const handleTrackDoubleClick = (track: Track, index: number) => {
    if (!onPlayNow) {
      console.log('Play track:', track.title, '(embedded mode - no playback)');
      return;
    }

    markPendingPlayTrack(track);
    const originalIndex = filteredTracks.findIndex((candidate) => candidate.id === track.id);
    const startIndex = originalIndex >= 0 ? originalIndex : index;
    console.log(`[MusicLibrary] Playing from track ${startIndex + 1}/${filteredTracks.length}`);
    onPlayNow(filteredTracks, startIndex);
  };

  // 閸欘亝鎸遍弨鎯у礋妫ｆ牗鐡曢弴?
  const handlePlaySingleTrack = (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onPlayNow) {
      console.log('Play single track:', track.title, '(embedded mode - no playback)');
      return;
    }
    markPendingPlayTrack(track);
    console.log('[MusicLibrary] Playing single track:', track.title);
    onPlayNow([track]);
  };

  // 閸欘亝鍧婇崝鐘插礋妫ｆ牗鐡曢弴鎻掑煂闂冪喎鍨?
  const handleAddSingleTrack = (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onAddToQueue) {
      console.log('Add track:', track.title, '(embedded mode - no queue)');
      return;
    }
    console.log('閴?Adding single track:', track.title);
    onAddToQueue([track]);
  };

  const handlePlayStableEntry = useCallback(
    async (entry: StableLibraryEntry) => {
      bumpAudioProtection('music-library-stable-play', 20_000);
      try {
        const playbackPlan = await musicLibraryService.resolvePlaybackPlanForCloudEntry({
          entryId: entry.id,
          ownerUid: entry.ownerUid,
          trackId: entry.trackId,
          quickFingerprint: entry.quickFingerprint,
          cloudContentId: entry.cloudContentId,
          includeMissing: true,
          visibleOnly: true,
        });

        if (playbackPlan.local.track) {
          if (onPlayNow) {
            onPlayNow([playbackPlan.local.track], 0);
          } else {
            await audioService.loadTrack(playbackPlan.local.track);
            await audioService.play();
          }
          return;
        }

        setErrorMessage(t('pages.music-library.stable.playbackFallbackQueued'));
      } catch (error) {
        setErrorMessage(
          t('pages.music-library.stable.playbackFailed', {
            message: error instanceof Error ? error.message : String(error),
          })
        );
      }
    },
    [audioService, bumpAudioProtection, onPlayNow, t]
  );

  const handleRemoveStableEntry = useCallback(
    async (entry: StableLibraryEntry) => {
      bumpAudioProtection('music-library-stable-remove', 20_000);
      const removed = await musicLibraryService.deleteCloudLibraryEntry(entry.id);
      if (!removed) {
        setErrorMessage(t('pages.music-library.stable.removeFailed'));
        return;
      }
      await loadStableLibraryEntries(searchQuery);
    },
    [bumpAudioProtection, loadStableLibraryEntries, searchQuery, t]
  );

  const loadStableQueueData = useCallback(
    async (ownerUidOverride?: string) => {
      if (!isTauriRuntime()) {
        setStableFallbackTasks([]);
        setStableHashJobs([]);
        setStableFallbackAudit(
          buildStableFallbackAuditSnapshot([])
        );
        return;
      }

      const ownerUidRaw =
        typeof ownerUidOverride === 'string' ? ownerUidOverride : stableOwnerFilter;
      const normalizedOwnerUid = ownerUidRaw.trim();

      setIsStableQueueLoading(true);
      try {
        const [tasks, jobs] = await Promise.all([
          musicLibraryService.listCloudFallbackTasks({
            ownerUid: normalizedOwnerUid || undefined,
            limit: 300,
          }),
          musicLibraryService.listCloudHashJobs({
            ownerUid: normalizedOwnerUid || undefined,
            limit: 300,
          }),
        ]);

        const nextTasks = [...tasks].sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
        const nextJobs = [...jobs].sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
        setStableFallbackTasks(nextTasks);
        setStableHashJobs(nextJobs);

        const rawAudit = readJson<unknown[]>(STORAGE_KEYS.MUSIC_LIBRARY_CLOUD_FALLBACK_AUDIT_V1, []);
        const normalizedAudit = Array.isArray(rawAudit)
          ? rawAudit
              .map((item) => normalizeStableFallbackAuditEntry(item))
              .filter((item): item is StableFallbackAuditEntry => item !== null)
          : [];
        const filteredAudit = normalizedOwnerUid
          ? normalizedAudit.filter((item) => item.request.ownerUid === normalizedOwnerUid)
          : normalizedAudit;
        setStableFallbackAudit(buildStableFallbackAuditSnapshot(filteredAudit));
      } catch (error) {
        console.warn('Failed to load stable queue data:', error);
        setErrorMessage(t('pages.music-library.stable.queue.loadFailed'));
      } finally {
        setIsStableQueueLoading(false);
      }
    },
    [stableOwnerFilter, t]
  );

  useEffect(() => {
    if (!showStableQueuePanel) return;
    if (librarySourceMode !== 'stable') return;
    void loadStableQueueData();
  }, [librarySourceMode, loadStableQueueData, showStableQueuePanel]);

  const handleUpdateFallbackTaskStatus = useCallback(
    async (taskId: string, status: CloudFallbackTaskStatus) => {
      const normalizedTaskId = taskId.trim();
      if (!normalizedTaskId) return;
      setFallbackTaskStatusPendingId(normalizedTaskId);
      try {
        const updated = await musicLibraryService.updateCloudFallbackTaskStatus(normalizedTaskId, status);
        if (!updated) {
          setErrorMessage(t('pages.music-library.stable.queue.updateStatusFailed'));
          return;
        }
        await loadStableQueueData();
      } finally {
        setFallbackTaskStatusPendingId(null);
      }
    },
    [loadStableQueueData, t]
  );

  const handleUpdateHashJobStatus = useCallback(
    async (jobId: string, status: CloudHashJobStatus) => {
      const normalizedJobId = jobId.trim();
      if (!normalizedJobId) return;
      setHashJobStatusPendingId(normalizedJobId);
      try {
        const updated = await musicLibraryService.updateCloudHashJobStatus(normalizedJobId, status);
        if (!updated) {
          setErrorMessage(t('pages.music-library.stable.queue.updateStatusFailed'));
          return;
        }
        await loadStableQueueData();
      } finally {
        setHashJobStatusPendingId(null);
      }
    },
    [loadStableQueueData, t]
  );

  const handleOpenStableMetadataEditor = useCallback((entry: StableLibraryEntry) => {
    setEditingStableEntry(entry);
    setStableEntryRatingInput(
      typeof entry.rating === 'number' && Number.isFinite(entry.rating) ? String(entry.rating) : ''
    );
    setStableEntryTagsInput(parseTagsJsonAsText(entry.tagsJson));
  }, []);

  const handleCloseStableMetadataEditor = useCallback(() => {
    setEditingStableEntry(null);
    setStableEntryRatingInput('');
    setStableEntryTagsInput('');
    setIsStableMetadataSaving(false);
  }, []);

  const handleSaveStableMetadata = useCallback(async () => {
    if (!editingStableEntry) return;

    const parsedRating = Number.parseInt(stableEntryRatingInput.trim(), 10);
    const normalizedRating =
      Number.isFinite(parsedRating) && parsedRating >= 0
        ? Math.max(0, Math.min(100, Math.floor(parsedRating)))
        : undefined;

    setIsStableMetadataSaving(true);
    try {
      const updated = await musicLibraryService.upsertCloudLibraryEntry({
        entryId: editingStableEntry.id,
        ownerUid: editingStableEntry.ownerUid,
        trackId: editingStableEntry.trackId,
        quickFingerprint: editingStableEntry.quickFingerprint,
        cloudContentId: editingStableEntry.cloudContentId,
        displayTitle: editingStableEntry.displayTitle,
        displayArtist: editingStableEntry.displayArtist,
        inCloud: editingStableEntry.inCloud,
        isMissing: editingStableEntry.isMissing,
        createdAtMs: editingStableEntry.createdAtMs,
        updatedAtMs: Date.now(),
        rating: normalizedRating,
        tagsJson: buildTagsJsonFromText(stableEntryTagsInput),
      });
      if (!updated) {
        setErrorMessage(t('pages.music-library.stable.metadata.saveFailed'));
        return;
      }

      handleCloseStableMetadataEditor();
      await loadStableLibraryEntries(searchQuery);
    } finally {
      setIsStableMetadataSaving(false);
    }
  }, [
    editingStableEntry,
    handleCloseStableMetadataEditor,
    loadStableLibraryEntries,
    searchQuery,
    stableEntryRatingInput,
    stableEntryTagsInput,
    t,
  ]);

  const handleApplyStableFilters = useCallback(() => {
    void loadStableLibraryEntries(searchQuery);
    if (showStableQueuePanel) {
      void loadStableQueueData();
    }
  }, [loadStableLibraryEntries, loadStableQueueData, searchQuery, showStableQueuePanel]);

  const handleResetStableFilters = useCallback(() => {
    setStableOwnerFilter('');
    setStableInCloudOnly(false);
    setStableIncludeMissing(true);
    void loadStableLibraryEntries(searchQuery, {
      ownerUid: '',
      inCloudOnly: false,
      includeMissing: true,
    });
    if (showStableQueuePanel) {
      void loadStableQueueData('');
    }
  }, [loadStableLibraryEntries, loadStableQueueData, searchQuery, showStableQueuePanel]);

  // 婢跺嫮鎮婂灞炬锤閸欐娊鏁懣婊冨礋
  const handleTrackContextMenu = (track: Track, index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const playTracks = filteredTracks;
    const playStartIndex = playTracks.findIndex((candidate) => candidate.id === track.id);

    const menuItems: ContextMenuItem[] = [
      {
        label: t('pages.music-library.contextMenu.play'),
        icon: '>',
        onClick: () => handlePlaySingleTrack(track, e),
      },
      {
        label: t('pages.music-library.contextMenu.addToQueue'),
        icon: '+',
        onClick: () => onAddToQueue?.([track]),
      },
      {
        label: t('pages.music-library.contextMenu.playAllFromHere'),
        icon: '>>',
        onClick: () => onPlayNow?.(playTracks, playStartIndex >= 0 ? playStartIndex : index),
      },
      { divider: true } as ContextMenuItem,
      {
        label: t('pages.music-library.contextMenu.viewAlbum'),
        icon: 'A',
        onClick: () => {
          if (track.album && embedded) {
            handleAlbumClick(track.album, track.artist || '');
          }
        },
        disabled: !track.album || !embedded,
      },
      {
        label: t('pages.music-library.contextMenu.viewArtist'),
        icon: 'R',
        onClick: () => {
          if (track.artist) {
            handleViewModeChange('artists', { artist: track.artist });
          }
        },
        disabled: !track.artist,
      },
    ];

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: menuItems,
    });
  };

  // 婢跺嫮鎮婃稉鎾圭帆閸欐娊鏁懣婊冨礋
  const handleAlbumContextMenu = (album: string, artist: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const menuItems: ContextMenuItem[] = [
      {
        label: t('pages.music-library.contextMenu.viewAlbum'),
        icon: 'A',
        onClick: () => handleAlbumClick(album, artist),
        disabled: !embedded,
      },
      {
        label: t('pages.music-library.contextMenu.playAlbum'),
        icon: '>',
        onClick: () => handlePlayAlbum(album),
      },
      {
        label: t('pages.music-library.contextMenu.addToQueue'),
        icon: '+',
        onClick: async () => {
          const albumTracks = await musicLibraryService.getTracksByAlbum(album);
          onAddToQueue?.(albumTracks);
        },
      },
      { divider: true } as ContextMenuItem,
      {
        label: t('pages.music-library.contextMenu.viewArtist'),
        icon: 'R',
        onClick: () => {
          handleViewModeChange('artists', { artist: artist });
        },
      },
    ];

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: menuItems,
    });
  };

  // 閺嶇厧绱￠崠鏍ㄦ瀮娴犺泛銇囩亸?
  const formatStableUpdatedAt = useCallback(
    (timestampMs?: number) => {
      if (!timestampMs || !Number.isFinite(timestampMs)) {
        return t('common.state.unknown');
      }
      return new Date(timestampMs).toLocaleString(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    },
    [locale, t]
  );

  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }, []);

  // 閺嶇厧绱￠崠鏍ㄦ闂€?
  const formatTotalDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return t('pages.music-library.duration.hoursMinutes', { hours, minutes });
    }
    return t('pages.music-library.duration.minutes', { minutes });
  };

  // 閺嶇厧绱￠崠鏍缓闁挻妞傞梹?
  const formatDuration = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const formatOptionalTimestamp = useCallback(
    (value?: number) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return '-';
      }
      const ms = value > 10_000_000_000 ? value : value * 1000;
      return formatStableUpdatedAt(ms);
    },
    [formatStableUpdatedAt]
  );

  const renderLocalTrackColumnValue = useCallback(
    (track: Track, columnId: LocalTrackColumnId): string => {
      const resolveEstimatedBitrate = (): number | null => {
        if (typeof track.bitrate === 'number' && Number.isFinite(track.bitrate) && track.bitrate > 0) {
          return track.bitrate;
        }

        if (
          typeof track.fileSize === 'number' &&
          Number.isFinite(track.fileSize) &&
          track.fileSize > 0 &&
          typeof track.duration === 'number' &&
          Number.isFinite(track.duration) &&
          track.duration > 0
        ) {
          const estimated = (track.fileSize * 8) / track.duration;
          if (Number.isFinite(estimated) && estimated > 0) {
            return estimated;
          }
        }

        return null;
      };

      const resolveFormat = (): string | null => {
        const explicit = (track.format || track.codecName || '').trim();
        if (explicit.length > 0) {
          return explicit.toUpperCase();
        }

        const path = (track.path || track.originalPath || '').trim();
        const extension = path.includes('.') ? path.split('.').pop()?.trim() ?? '' : '';
        if (extension.length > 0) {
          return extension.toUpperCase();
        }

        return null;
      };

      switch (columnId) {
        case 'title':
          return track.title || '-';
        case 'artist':
          return track.artist || '-';
        case 'album':
          return track.album || '-';
        case 'duration':
          return typeof track.duration === 'number' && Number.isFinite(track.duration)
            ? formatDuration(track.duration)
            : '-';
        case 'year':
          return typeof track.year === 'number' && Number.isFinite(track.year) ? String(track.year) : '-';
        case 'genre':
          return track.genre || '-';
        case 'trackNumber':
          return typeof track.trackNumber === 'number' && Number.isFinite(track.trackNumber)
            ? String(track.trackNumber)
            : '-';
        case 'discNumber':
          return typeof track.discNumber === 'number' && Number.isFinite(track.discNumber)
            ? String(track.discNumber)
            : '-';
        case 'composer':
          return track.composer || '-';
        case 'bitrate': {
          const bitrate = resolveEstimatedBitrate();
          return typeof bitrate === 'number' && Number.isFinite(bitrate)
            ? `${Math.max(0, Math.round(bitrate / 1000))} kbps`
            : '-';
        }
        case 'sampleRate':
          return typeof track.sampleRate === 'number' && Number.isFinite(track.sampleRate)
            ? `${Math.max(0, Math.round(track.sampleRate))} Hz`
            : '-';
        case 'format': {
          const format = resolveFormat();
          return format ?? '-';
        }
        case 'playCount':
          return typeof track.playCount === 'number' && Number.isFinite(track.playCount)
            ? String(Math.max(0, Math.floor(track.playCount)))
            : '-';
        case 'lastPlayed':
          return formatOptionalTimestamp(track.lastPlayed);
        case 'rating':
          return typeof track.rating === 'number' && Number.isFinite(track.rating)
            ? String(Math.max(0, Math.floor(track.rating)))
            : '-';
        case 'fileSize':
          return typeof track.fileSize === 'number' && Number.isFinite(track.fileSize)
            ? formatFileSize(Math.max(0, track.fileSize))
            : '-';
        case 'dateAdded':
          return formatOptionalTimestamp(track.dateAdded);
        default:
          return '-';
      }
    },
    [formatDuration, formatFileSize, formatOptionalTimestamp]
  );

  const totalMissingTracks = useMemo(() => {
    return libraryPaths.reduce((sum, path) => {
      const health = libraryPathHealthMap[path.id];
      return sum + (health?.missingTracks ?? 0);
    }, 0);
  }, [libraryPathHealthMap, libraryPaths]);

  const handleCleanupMissingForPath = useCallback(
    async (pathId: string) => {
      const normalizedPathId = String(pathId || '').trim();
      if (!normalizedPathId) return;

      setPathCleanupBusyMap((prev) => ({
        ...prev,
        [normalizedPathId]: true,
      }));

      const releaseProtection = beginAudioProtection('music-library-cleanup-missing-path', 45_000);
      try {
        const deleted = await musicLibraryService.cleanupLibraryPathTracks(normalizedPathId, {
          missingOnly: true,
        });
        if (deleted > 0) {
          await Promise.all([loadLibraryPaths(), loadLibraryData()]);
        } else {
          await loadLibraryPathHealth();
        }
      } finally {
        setPathCleanupBusyMap((prev) => ({
          ...prev,
          [normalizedPathId]: false,
        }));
        releaseProtection();
      }
    },
    [beginAudioProtection, loadLibraryData, loadLibraryPathHealth, loadLibraryPaths]
  );

  const handleCleanupMissingForAllPaths = useCallback(async () => {
    if (totalMissingTracks <= 0) return;
    setIsCleanupAllMissingBusy(true);

    const releaseProtection = beginAudioProtection('music-library-cleanup-missing-all-paths', 120_000);
    try {
      let deletedTotal = 0;
      for (const path of libraryPaths) {
        const missingCount = libraryPathHealthMap[path.id]?.missingTracks ?? 0;
        if (missingCount <= 0) continue;
        const deleted = await musicLibraryService.cleanupLibraryPathTracks(path.id, { missingOnly: true });
        deletedTotal += deleted;
      }

      if (deletedTotal > 0) {
        await Promise.all([loadLibraryPaths(), loadLibraryData()]);
      } else {
        await loadLibraryPathHealth();
      }
    } finally {
      setIsCleanupAllMissingBusy(false);
      releaseProtection();
    }
  }, [
    beginAudioProtection,
    libraryPathHealthMap,
    libraryPaths,
    loadLibraryData,
    loadLibraryPathHealth,
    loadLibraryPaths,
    totalMissingTracks,
  ]);

  const handleRequestCleanupMissingForPath = useCallback(
    (pathId: string, pathName: string, count: number) => {
      const normalizedPathId = String(pathId || '').trim();
      if (!normalizedPathId || count <= 0) return;
      setCleanupConfirmTarget({
        mode: 'path',
        pathId: normalizedPathId,
        pathName: pathName || normalizedPathId,
        count,
      });
    },
    []
  );

  const handleRequestCleanupMissingForAllPaths = useCallback(() => {
    if (totalMissingTracks <= 0) return;
    setCleanupConfirmTarget({
      mode: 'all',
      count: totalMissingTracks,
    });
  }, [totalMissingTracks]);

  const handleConfirmCleanupMissing = useCallback(async () => {
    if (!cleanupConfirmTarget) return;
    const target = cleanupConfirmTarget;
    setCleanupConfirmTarget(null);
    if (target.mode === 'path') {
      await handleCleanupMissingForPath(target.pathId);
      return;
    }
    await handleCleanupMissingForAllPaths();
  }, [cleanupConfirmTarget, handleCleanupMissingForAllPaths, handleCleanupMissingForPath]);

  const cleanupConfirmMessage = useMemo(() => {
    if (!cleanupConfirmTarget) return '';
    if (cleanupConfirmTarget.mode === 'path') {
      return t('pages.music-library.pathsManager.cleanupConfirm.pathMessage', {
        path: cleanupConfirmTarget.pathName,
        count: cleanupConfirmTarget.count,
      });
    }
    return t('pages.music-library.pathsManager.cleanupConfirm.allMessage', {
      count: cleanupConfirmTarget.count,
    });
  }, [cleanupConfirmTarget, t]);

  if (!isOpen) return null;

  const libraryContent = (
    <div className={`music-library ${embedded ? 'music-library-embedded' : ''}`}>
      {!embedded && (
        <div className="music-library-header">
          <div className="music-library-header-left">
            <h2 className="music-library-title">{t('pages.music-library.title')}</h2>
            <div className="music-library-source-modes">
              <button
                className={`music-library-source-btn ${librarySourceMode === 'local' ? 'active' : ''}`}
                onClick={() => handleLibrarySourceChange('local')}
              >
                {t('pages.music-library.source.local')}
              </button>
              <button
                className={`music-library-source-btn ${librarySourceMode === 'stable' ? 'active' : ''}`}
                onClick={() => handleLibrarySourceChange('stable')}
              >
                {t('pages.music-library.source.stable')}
              </button>
            </div>
          </div>
          {onClose && (
            <button className="music-library-close" onClick={onClose}>
              X
            </button>
          )}
        </div>
      )}

      <div className="music-library-toolbar">
        <div className="music-library-actions">
          {librarySourceMode === 'local' ? (
            <>
              <button
                className="music-library-btn"
                onClick={() => setShowPathsManager(true)}
                title={t('pages.music-library.paths.manageTitle')}
              >
                <span>{t('pages.music-library.paths.button', { count: libraryPaths.length })}</span>
              </button>
              <button className="music-library-btn" onClick={() => setShowColumnSettings(true)}>
                {t('pages.music-library.columns.button')}
              </button>
              <button
                className="music-library-btn"
                onClick={() => setShowClearConfirm(true)}
                disabled={libraryStats.totalTracks === 0}
              >
                {t('common.action.clear')}
              </button>
            </>
          ) : (
            <>
              <button
                className="music-library-btn"
                onClick={() => {
                  void loadStableLibraryEntries(searchQuery);
                }}
                disabled={isStableEntriesLoading}
              >
                {t('common.action.refresh')}
              </button>
              <button className="music-library-btn" onClick={() => setShowStableQueuePanel(true)}>
                {t('pages.music-library.stable.queue.button')}
              </button>
            </>
          )}
        </div>

        <div className="music-library-search">
          <input
            type="text"
            placeholder={
              librarySourceMode === 'local'
                ? t('pages.music-library.search.placeholder')
                : t('pages.music-library.stable.search.placeholder')
            }
            value={searchQuery}
            onChange={(e) => handleSearchInputChange(e.target.value)}
          />
          <span className="music-library-search-icon">🔍</span>
        </div>

        {librarySourceMode === 'local' && (
        <div className="music-library-sort">
          <label htmlFor="sort-select">{t('pages.music-library.sort.label')}</label>
          <select
            id="sort-select"
            className="music-library-sort-select"
            value={sortBy}
            onChange={(e) => handleSort(e.target.value as typeof sortBy)}
          >
            <option value="default">{t('pages.music-library.sort.option.default')}</option>
            {/* Albums 鐟欏棗娴橀崣顏呮▔缁€杞扮瑩鏉堟垵鎷伴懝鐑樻钩鐎硅埖甯撴惔?*/}
            {viewMode !== 'albums' && <option value="title">{t('pages.music-library.sort.option.title')}</option>}
            <option value="artist">{t('pages.music-library.sort.option.artist')}</option>
            <option value="album">{t('pages.music-library.sort.option.album')}</option>
            {viewMode !== 'albums' && (
              <option value="duration">{t('pages.music-library.sort.option.duration')}</option>
            )}
            {viewMode !== 'albums' && <option value="year">{t('pages.music-library.sort.option.year')}</option>}
          </select>
          <button
            className={`music-library-sort-order-btn ${sortBy === 'default' ? 'disabled' : ''}`}
            onClick={() =>
              sortBy !== 'default' && setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
            }
            disabled={sortBy === 'default'}
            title={
              sortBy === 'default'
                ? t('pages.music-library.sortOrder.disabledTitle')
                : sortOrder === 'asc'
                  ? t('pages.music-library.sortOrder.ascTitle')
                  : t('pages.music-library.sortOrder.descTitle')
            }
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>
          <span
            className="music-library-sort-hint"
            title={
              sortBy === 'default'
                ? t('pages.music-library.sortHint.defaultTitle')
                : t('pages.music-library.sortHint.playTitle')
            }
            style={{ opacity: sortBy === 'default' ? 0.4 : 1 }}
          >
            ▶
          </span>
        </div>
        )}

        {librarySourceMode === 'local' && (
        <div className="music-library-view-modes">
          <button
            className={`music-library-view-btn ${viewMode === 'all' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('all')}
          >
            {t('pages.music-library.viewMode.all')}
          </button>
          <button
            className={`music-library-view-btn ${viewMode === 'albums' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('albums')}
          >
            {t('pages.music-library.viewMode.albums')}
          </button>
          <button
            className={`music-library-view-btn ${viewMode === 'artists' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('artists')}
          >
            {t('pages.music-library.viewMode.artists')}
          </button>
          <button
            className={`music-library-view-btn ${viewMode === 'genres' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('genres')}
          >
            {t('pages.music-library.viewMode.genres')}
          </button>
        </div>
        )}

        <div className="music-library-stats">
          {librarySourceMode === 'local' ? (
            <>
              <div className="music-library-stat">
                <strong>{libraryStats.totalTracks}</strong> {t('pages.music-library.stats.tracksUnit')}
              </div>
              <div className="music-library-stat">
                <strong>{libraryStats.totalArtists}</strong> {t('pages.music-library.stats.artistsUnit')}
              </div>
              <div className="music-library-stat">
                <strong>{libraryStats.totalAlbums}</strong> {t('pages.music-library.stats.albumsUnit')}
              </div>
              <div className="music-library-stat">
                <strong>{formatFileSize(libraryStats.totalSize)}</strong>
              </div>
              <div className="music-library-stat">
                <strong>{formatTotalDuration(libraryStats.totalDuration)}</strong>
              </div>
            </>
          ) : (
            <>
              <div className="music-library-stat">
                <strong>{stableLibraryStats.totalEntries}</strong>{' '}
                {t('pages.music-library.stable.stats.entries')}
              </div>
              <div className="music-library-stat">
                <strong>{stableLibraryStats.localReady}</strong>{' '}
                {t('pages.music-library.stable.stats.localReady')}
              </div>
              <div className="music-library-stat">
                <strong>{stableLibraryStats.inCloud}</strong>{' '}
                {t('pages.music-library.stable.stats.inCloud')}
              </div>
              <div className="music-library-stat">
                <strong>{stableLibraryStats.missing}</strong>{' '}
                {t('pages.music-library.stable.stats.missing')}
              </div>
            </>
          )}
        </div>
      </div>

      {librarySourceMode === 'stable' && (
        <div className="music-library-stable-filters">
          <label className="music-library-stable-filter-field">
            <span>{t('pages.music-library.stable.filters.ownerUidLabel')}</span>
            <input
              type="text"
              value={stableOwnerFilter}
              placeholder={t('pages.music-library.stable.filters.ownerUidPlaceholder')}
              onChange={(event) => setStableOwnerFilter(event.target.value)}
            />
          </label>
          <label className="music-library-stable-filter-toggle">
            <input
              type="checkbox"
              checked={stableInCloudOnly}
              onChange={(event) => setStableInCloudOnly(event.target.checked)}
            />
            <span>{t('pages.music-library.stable.filters.inCloudOnly')}</span>
          </label>
          <label className="music-library-stable-filter-toggle">
            <input
              type="checkbox"
              checked={stableIncludeMissing}
              onChange={(event) => setStableIncludeMissing(event.target.checked)}
            />
            <span>{t('pages.music-library.stable.filters.includeMissing')}</span>
          </label>
          <button className="music-library-btn" onClick={handleApplyStableFilters}>
            {t('pages.music-library.stable.filters.apply')}
          </button>
          <button className="music-library-btn" onClick={handleResetStableFilters}>
            {t('pages.music-library.stable.filters.reset')}
          </button>
        </div>
      )}

      <div className="music-library-content">
        {librarySourceMode === 'stable' ? (
          <div className="music-library-main music-library-main-stable" ref={mainScrollRef}>
            {isStableEntriesLoading ? (
              <div className="music-library-empty">
                <div className="music-library-empty-icon">…</div>
                <div className="music-library-empty-text">{t('pages.music-library.stable.loading')}</div>
              </div>
            ) : sortedStableEntries.length === 0 ? (
              <div className="music-library-empty">
                <div className="music-library-empty-icon">★</div>
                <div className="music-library-empty-text">{t('pages.music-library.stable.empty.title')}</div>
                <div className="music-library-empty-subtext">
                  {t('pages.music-library.stable.empty.hint')}
                </div>
              </div>
            ) : (
              <div className="music-library-stable-list">
                <div className="music-library-stable-header">
                  <div>#</div>
                  <div>{t('pages.music-library.stable.header.title')}</div>
                  <div>{t('pages.music-library.stable.header.artist')}</div>
                  <div>{t('pages.music-library.stable.header.owner')}</div>
                  <div>{t('pages.music-library.stable.header.playCount')}</div>
                  <div>{t('pages.music-library.stable.header.lastPlayed')}</div>
                  <div>{t('pages.music-library.stable.header.updatedAt')}</div>
                  <div>{t('pages.music-library.stable.header.status')}</div>
                  <div>{t('pages.music-library.tracks.header.actions')}</div>
                </div>
                {sortedStableEntries.map((entry, index) => {
                  const displayTitle = entry.displayTitle || entry.trackId || entry.id;
                  const displayArtist = entry.displayArtist || t('common.unknown.artist');
                  const playCount =
                    typeof entry.playCount === 'number' && Number.isFinite(entry.playCount)
                      ? Math.max(0, Math.floor(entry.playCount))
                      : 0;
                  const statusLabel = entry.isMissing
                    ? t('pages.music-library.stable.status.missing')
                    : entry.inCloud
                      ? t('pages.music-library.stable.status.inCloud')
                      : t('pages.music-library.stable.status.localOnly');
                  const statusClass = entry.isMissing
                    ? 'is-missing'
                    : entry.inCloud
                      ? 'is-cloud'
                      : 'is-local';

                  return (
                    <div
                      key={entry.id}
                      className="music-library-stable-entry"
                      onDoubleClick={() => {
                        void handlePlayStableEntry(entry);
                      }}
                    >
                      <div className="music-library-stable-cell">{index + 1}</div>
                      <div className="music-library-stable-cell music-library-stable-title" title={displayTitle}>
                        {displayTitle}
                      </div>
                      <div className="music-library-stable-cell" title={displayArtist}>
                        {displayArtist}
                      </div>
                      <div className="music-library-stable-cell" title={entry.ownerUid}>
                        {entry.ownerUid}
                      </div>
                      <div className="music-library-stable-cell">{playCount}</div>
                      <div className="music-library-stable-cell">
                        {formatOptionalTimestamp(entry.lastPlayedAtMs)}
                      </div>
                      <div className="music-library-stable-cell">
                        {formatStableUpdatedAt(entry.updatedAtMs)}
                      </div>
                      <div className="music-library-stable-cell">
                        <span className={`music-library-stable-status ${statusClass}`}>{statusLabel}</span>
                      </div>
                      <div className="music-library-stable-actions">
                        <button
                          className="track-action-meta"
                          title={t('pages.music-library.stable.action.editMetadata')}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenStableMetadataEditor(entry);
                          }}
                        >
                          M
                        </button>
                        <button
                          className="track-action-play"
                          title={t('pages.music-library.stable.action.play')}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handlePlayStableEntry(entry);
                          }}
                        >
                          ▶
                        </button>
                        <button
                          className="track-action-remove"
                          title={t('pages.music-library.stable.action.remove')}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleRemoveStableEntry(entry);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <>
        {(viewMode === 'artists' || viewMode === 'genres') && (
          <div className="music-library-sidebar" ref={sidebarScrollRef} onScroll={handleSidebarScroll}>
            {viewMode === 'artists' && (
              <div className="music-library-sidebar-section">
                <div className="music-library-sidebar-title">{t('pages.music-library.sidebar.artists')}</div>
                {artists.map((artist) => (
                  <div
                    key={artist}
                    data-artist-name={artist}
                    className={`music-library-sidebar-item ${selectedArtist === artist ? 'selected' : ''}`}
                    onClick={() => setSelectedArtist(selectedArtist === artist ? null : artist)}
                    onDoubleClick={() => handlePlayArtist(artist)}
                  >
                    <span>{artist}</span>
                    <span className="music-library-sidebar-count">
                      {tracks.filter((t) => t.artist === artist).length}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'genres' && (
              <div className="music-library-sidebar-section">
                <div className="music-library-sidebar-title">{t('pages.music-library.sidebar.genres')}</div>
                {genres.map((genre) => (
                  <div
                    key={genre}
                    data-genre-name={genre}
                    className={`music-library-sidebar-item ${selectedGenre === genre ? 'selected' : ''}`}
                    onClick={() => setSelectedGenre(selectedGenre === genre ? null : genre)}
                  >
                    <span>{genre}</span>
                    <span className="music-library-sidebar-count">
                      {tracks.filter((t) => t.genre === genre).length}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

          <div className="music-library-main" ref={mainScrollRef}>
          {libraryStats.totalTracks === 0 ? (
            <div className="music-library-empty">
              <div className="music-library-empty-icon">♪</div>
              <div className="music-library-empty-text">{t('pages.music-library.empty.title')}</div>
              <button className="music-library-btn" onClick={handleScanFolder}>
                {t('pages.music-library.empty.scanButton')}
              </button>
            </div>
          ) : (
            <>
              {viewMode === 'albums' && (
                <>
                  {albumVirtualWindow.topSpacerPx > 0 && (
                    <div
                      className="music-library-virtual-spacer"
                      style={{ height: `${albumVirtualWindow.topSpacerPx}px` }}
                      aria-hidden="true"
                    />
                  )}
                  <div className="music-library-grid">
                  {virtualizedAlbums.map(({ album, artist, cover }) => {
                    const key = albumKey(album, artist);
                    return (
                      <div
                        key={`${album}-${artist}`}
                        ref={getAlbumCardRef(key)}
                        data-album-key={key}
                        className="music-library-album-card"
                        onClick={() => handleAlbumClick(album, artist)}
                        onDoubleClick={() => handlePlayAlbum(album)}
                        onContextMenu={(e) => handleAlbumContextMenu(album, artist, e)}
                        title={t('pages.music-library.albums.cardTooltip')}
                      >
                        <div className="music-library-album-cover">
                          {cover ? (
                            <img
                              src={cover}
                              alt={album}
                              loading="lazy"
                              decoding="async"
                              onLoad={(event) => {
                                musicLibraryService.reportCoverDecoded(
                                  cover,
                                  event.currentTarget.naturalWidth,
                                  event.currentTarget.naturalHeight
                                );
                              }}
                            />
                          ) : (
                            '♫'
                          )}
                        </div>
                        <div className="music-library-album-title">{album}</div>
                        <div className="music-library-album-artist">{artist}</div>
                      </div>
                    );
                  })}
                  </div>
                  {albumVirtualWindow.bottomSpacerPx > 0 && (
                    <div
                      className="music-library-virtual-spacer"
                      style={{ height: `${albumVirtualWindow.bottomSpacerPx}px` }}
                      aria-hidden="true"
                    />
                  )}
                </>
              )}

              {(viewMode === 'all' || viewMode === 'artists' || viewMode === 'genres') && (
                <div
                  className={`music-library-list${resizingLocalTrackColumnId ? ' is-resizing-columns' : ''}`}
                  ref={localTrackListLayoutRef}
                >
                  <div className="music-library-list-header-shell">
                    <div
                      className="music-library-list-header-track"
                      ref={localTrackListHeaderScrollRef}
                      onScroll={handleLocalTrackHeaderScroll}
                    >
                      <div
                        className="music-library-list-header"
                        style={{ gridTemplateColumns: localTrackGridTemplate }}
                      >
                        <div className="music-library-list-header-cell music-library-list-header-leading">
                          #
                        </div>
                        {renderedLocalTrackColumns.map((column) => {
                          const isDragging = draggingLocalTrackColumnId === column.id;
                          const isDropTarget =
                            dragOverLocalTrackColumnId === column.id &&
                            draggingLocalTrackColumnId != null &&
                            draggingLocalTrackColumnId !== column.id;

                          return (
                            <div
                              key={column.id}
                              className={`music-library-list-header-cell music-library-list-header-column${isDragging ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}${resizingLocalTrackColumnId === column.id ? ' is-resizing' : ''}`}
                              ref={(element) => setLocalTrackColumnHeaderElement(column.id, element)}
                              data-local-track-column-id={column.id}
                              onPointerDown={(event) => handleLocalTrackColumnPointerDown(column.id, event)}
                              title={t('pages.music-library.columns.action.dragToReorder')}
                            >
                              <span className="music-library-list-header-label">
                                {t(LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].headerKey)}
                              </span>
                              <button
                                type="button"
                                className="music-library-column-resize-handle"
                                onPointerDown={(event) =>
                                  handleLocalTrackColumnResizePointerDown(column.id, event)
                                }
                                aria-label={t('pages.music-library.columns.action.dragToResize')}
                                title={t('pages.music-library.columns.action.dragToResize')}
                              />
                            </div>
                          );
                        })}
                        <div className="music-library-list-header-cell music-library-list-header-actions">
                          {t('pages.music-library.tracks.header.actions')}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div
                    className="music-library-list-scroll"
                    ref={localTrackListBodyScrollRef}
                    onScroll={handleLocalTrackBodyScroll}
                  >
                    <div className="music-library-list-content">
                  {trackVirtualWindow.topSpacerPx > 0 && (
                    <div
                      className="music-library-virtual-spacer"
                      style={{ height: `${trackVirtualWindow.topSpacerPx}px` }}
                      aria-hidden="true"
                    />
                  )}
                  {virtualizedTracks.map((track, index) => {
                    const absoluteIndex = trackVirtualWindow.start + index;
                    const isPlayPending =
                      pendingPlayTrackIdentity !== null &&
                      resolveTrackIdentity(track) === pendingPlayTrackIdentity;
                    return (
                    <div
                      key={track.id}
                      data-track-id={track.id}
                      className={`music-library-track${isPlayPending ? ' is-play-pending' : ''}`}
                      style={{ gridTemplateColumns: localTrackGridTemplate }}
                      onDoubleClick={() => handleTrackDoubleClick(track, absoluteIndex)}
                      onContextMenu={(e) => handleTrackContextMenu(track, absoluteIndex, e)}
                      title={t('pages.music-library.tracks.rowTooltip')}
                    >
                      <div className="music-library-track-number">{absoluteIndex + 1}</div>
                      {renderedLocalTrackColumns.map((column) => {
                        const value = renderLocalTrackColumnValue(track, column.id);
                        const className = LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].className;
                        return (
                          <div key={`${track.id}-${column.id}`} className={className} title={value}>
                            {value}
                          </div>
                        );
                      })}
                      <div className="music-library-track-actions">
                        {onPlayNow && (
                          <button
                            onClick={(e) => handlePlaySingleTrack(track, e)}
                            title={t('pages.music-library.tracks.action.playOneTitle')}
                            className="track-action-play"
                          >
                            ▶
                          </button>
                        )}
                        {onAddToQueue && (
                          <button
                            onClick={(e) => handleAddSingleTrack(track, e)}
                            title={t('pages.music-library.tracks.action.addOneTitle')}
                            className="track-action-add"
                          >
                            +
                          </button>
                        )}
                      </div>
                    </div>
                    );
                  })}
                  {trackVirtualWindow.bottomSpacerPx > 0 && (
                    <div
                      className="music-library-virtual-spacer"
                      style={{ height: `${trackVirtualWindow.bottomSpacerPx}px` }}
                      aria-hidden="true"
                    />
                  )}
                    </div>
                  </div>
                  {(isTrackChunkLoading || hasMoreTracks || renderedTracks.length < filteredTracksTotal) && (
                    <div className="music-library-track-load-hint" role="status" aria-live="polite">
                      {isTrackChunkLoading
                        ? t('pages.music-library.loading.tracksChunk')
                        : renderedTracks.length < filteredTracksTotal
                          ? t('pages.music-library.loading.renderWindowHint', {
                              shown: renderedTracks.length,
                              total: filteredTracksTotal,
                            })
                          : t('pages.music-library.loading.scrollToLoadMore')}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
          </>
        )}
      </div>

      {showColumnSettings && (
        <div className="music-library-modal-overlay" onClick={() => setShowColumnSettings(false)}>
          <div
            className="music-library-modal music-library-columns-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="music-library-modal-header">
              <h3>{t('pages.music-library.columns.modal.title')}</h3>
              <div className="music-library-modal-header-actions">
                <button className="music-library-btn" onClick={resetLocalTrackColumns}>
                  {t('pages.music-library.columns.modal.reset')}
                </button>
                <button className="music-library-modal-close" onClick={() => setShowColumnSettings(false)}>
                  X
                </button>
              </div>
            </div>
            <div className="music-library-modal-body">
              <div className="music-library-modal-description">
                {t('pages.music-library.columns.modal.description')}
              </div>
              <div className="music-library-column-list">
                {localTrackColumnSettings.map((column, index) => (
                  <div className="music-library-column-item" key={column.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={column.visible}
                        disabled={column.visible && visibleLocalTrackColumnCount <= 1}
                        onChange={() => toggleLocalTrackColumn(column.id)}
                      />
                      <span>{t(LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].headerKey)}</span>
                    </label>
                    <div className="music-library-column-actions">
                      <button
                        className="music-library-column-move"
                        disabled={index === 0}
                        title={t('pages.music-library.columns.action.moveUp')}
                        onClick={() => moveLocalTrackColumn(column.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="music-library-column-move"
                        disabled={index === localTrackColumnSettings.length - 1}
                        title={t('pages.music-library.columns.action.moveDown')}
                        onClick={() => moveLocalTrackColumn(column.id, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showStableQueuePanel && (
        <div className="music-library-modal-overlay" onClick={() => setShowStableQueuePanel(false)}>
          <div
            className="music-library-modal music-library-stable-queue-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="music-library-modal-header">
              <h3>{t('pages.music-library.stable.queue.title')}</h3>
              <div className="music-library-modal-header-actions">
                <button
                  className="music-library-btn"
                  onClick={() => {
                    void loadStableQueueData();
                  }}
                  disabled={isStableQueueLoading}
                >
                  {t('common.action.refresh')}
                </button>
                <button className="music-library-modal-close" onClick={() => setShowStableQueuePanel(false)}>
                  X
                </button>
              </div>
            </div>
            <div className="music-library-modal-body">
              {isStableQueueLoading ? (
                <div className="music-library-modal-loading">{t('pages.music-library.stable.queue.loading')}</div>
              ) : (
                <>
                  <div className="music-library-queue-section">
                    <div className="music-library-queue-title">
                      {t('pages.music-library.stable.queue.fallbackTasks.title')}
                    </div>
                    {stableFallbackTasks.length === 0 ? (
                      <div className="music-library-modal-empty">{t('pages.music-library.stable.queue.empty')}</div>
                    ) : (
                      <div className="music-library-queue-table">
                        <div className="music-library-queue-row music-library-queue-row-header">
                          <div>{t('pages.music-library.stable.queue.header.entryId')}</div>
                          <div>{t('pages.music-library.stable.queue.header.status')}</div>
                          <div>{t('pages.music-library.stable.queue.header.attempts')}</div>
                          <div>{t('pages.music-library.stable.queue.header.updatedAt')}</div>
                          <div>{t('pages.music-library.stable.queue.header.error')}</div>
                        </div>
                        {stableFallbackTasks.map((task) => (
                          <div className="music-library-queue-row" key={task.id}>
                            <div title={task.entryId}>{task.entryId}</div>
                            <div>
                              <select
                                value={task.status}
                                disabled={fallbackTaskStatusPendingId === task.id}
                                onChange={(event) => {
                                  void handleUpdateFallbackTaskStatus(
                                    task.id,
                                    event.target.value as CloudFallbackTaskStatus
                                  );
                                }}
                              >
                                {STABLE_FALLBACK_STATUS_OPTIONS.map((status) => (
                                  <option key={status} value={status}>
                                    {t(`pages.music-library.stable.queue.status.${status}`)}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>{task.enqueueCount}</div>
                            <div>{formatOptionalTimestamp(task.updatedAtMs)}</div>
                            <div title={task.lastError || '-'}>{task.lastError || '-'}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="music-library-queue-section">
                    <div className="music-library-queue-title">
                      {t('pages.music-library.stable.queue.hashJobs.title')}
                    </div>
                    {stableHashJobs.length === 0 ? (
                      <div className="music-library-modal-empty">{t('pages.music-library.stable.queue.empty')}</div>
                    ) : (
                      <div className="music-library-queue-table">
                        <div className="music-library-queue-row music-library-queue-row-header">
                          <div>{t('pages.music-library.stable.queue.header.entryId')}</div>
                          <div>{t('pages.music-library.stable.queue.header.status')}</div>
                          <div>{t('pages.music-library.stable.queue.header.attempts')}</div>
                          <div>{t('pages.music-library.stable.queue.header.updatedAt')}</div>
                          <div>{t('pages.music-library.stable.queue.header.error')}</div>
                        </div>
                        {stableHashJobs.map((job) => (
                          <div className="music-library-queue-row" key={job.id}>
                            <div title={job.entryId}>{job.entryId}</div>
                            <div>
                              <select
                                value={job.status}
                                disabled={hashJobStatusPendingId === job.id}
                                onChange={(event) => {
                                  void handleUpdateHashJobStatus(
                                    job.id,
                                    event.target.value as CloudHashJobStatus
                                  );
                                }}
                              >
                                {STABLE_HASH_STATUS_OPTIONS.map((status) => (
                                  <option key={status} value={status}>
                                    {t(`pages.music-library.stable.queue.status.${status}`)}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>{job.attemptCount}</div>
                            <div>{formatOptionalTimestamp(job.updatedAtMs)}</div>
                            <div title={job.lastError || '-'}>{job.lastError || '-'}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="music-library-queue-section">
                    <div className="music-library-queue-title">
                      {t('pages.music-library.stable.queue.audit.title')}
                    </div>
                    <div className="music-library-queue-audit-stats">
                      <span>
                        {t('pages.music-library.stable.queue.audit.total', {
                          count: stableFallbackAudit.stats.totalEvents,
                        })}
                      </span>
                      <span>
                        {t('pages.music-library.stable.queue.audit.accepted', {
                          count: stableFallbackAudit.stats.acceptedEvents,
                        })}
                      </span>
                      <span>
                        {t('pages.music-library.stable.queue.audit.deduped', {
                          count: stableFallbackAudit.stats.dedupedEvents,
                        })}
                      </span>
                      <span>
                        {t('pages.music-library.stable.queue.audit.rejected', {
                          count: stableFallbackAudit.stats.rejectedEvents,
                        })}
                      </span>
                    </div>
                    {stableFallbackAudit.recent.length === 0 ? (
                      <div className="music-library-modal-empty">{t('pages.music-library.stable.queue.empty')}</div>
                    ) : (
                      <div className="music-library-queue-table">
                        <div className="music-library-queue-row music-library-queue-row-header">
                          <div>{t('pages.music-library.stable.queue.audit.time')}</div>
                          <div>{t('pages.music-library.stable.header.owner')}</div>
                          <div>{t('pages.music-library.stable.queue.header.entryId')}</div>
                          <div>{t('pages.music-library.stable.queue.audit.queueSize')}</div>
                          <div>{t('pages.music-library.stable.queue.header.status')}</div>
                        </div>
                        {stableFallbackAudit.recent.slice(0, 20).map((item) => (
                          <div
                            className="music-library-queue-row"
                            key={`${item.request.entryId}-${item.request.ownerUid}-${item.atMs}`}
                          >
                            <div>{formatOptionalTimestamp(item.atMs)}</div>
                            <div title={item.request.ownerUid}>{item.request.ownerUid}</div>
                            <div title={item.request.entryId}>{item.request.entryId}</div>
                            <div>{item.dispatch.queueSize}</div>
                            <div>
                              {item.dispatch.accepted
                                ? item.dispatch.deduped
                                  ? t('pages.music-library.stable.queue.status.deduped')
                                  : t('pages.music-library.stable.queue.status.queued')
                                : t('pages.music-library.stable.queue.status.rejected')}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {editingStableEntry && (
        <div className="music-library-modal-overlay" onClick={handleCloseStableMetadataEditor}>
          <div
            className="music-library-modal music-library-stable-metadata-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="music-library-modal-header">
              <h3>{t('pages.music-library.stable.metadata.title')}</h3>
              <button className="music-library-modal-close" onClick={handleCloseStableMetadataEditor}>
                X
              </button>
            </div>
            <div className="music-library-modal-body">
              <label className="music-library-stable-metadata-field">
                <span>{t('pages.music-library.stable.metadata.rating')}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={stableEntryRatingInput}
                  onChange={(event) => setStableEntryRatingInput(event.target.value)}
                />
              </label>
              <label className="music-library-stable-metadata-field">
                <span>{t('pages.music-library.stable.metadata.tags')}</span>
                <textarea
                  value={stableEntryTagsInput}
                  onChange={(event) => setStableEntryTagsInput(event.target.value)}
                  placeholder={t('pages.music-library.stable.metadata.tagsHint')}
                />
              </label>
              <div className="music-library-modal-footer">
                <button className="music-library-btn" onClick={handleCloseStableMetadataEditor}>
                  {t('common.action.cancel')}
                </button>
                <button
                  className="music-library-btn"
                  onClick={() => {
                    void handleSaveStableMetadata();
                  }}
                  disabled={isStableMetadataSaving}
                >
                  {isStableMetadataSaving
                    ? t('common.action.save')
                    : t('pages.music-library.stable.metadata.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {librarySourceMode === 'local' && scanProgress && scanProgress.isScanning && (
        <div className="music-library-scan-progress">
          <div className="music-library-scan-header">
            <div className="music-library-scan-title">{t('pages.music-library.scan.title')}</div>
            <button
              className="music-library-scan-cancel"
              onClick={handleCancelScan}
              title={t('pages.music-library.scan.cancelTitle')}
            >
              {t('common.action.cancel')}
            </button>
            <div className="music-library-scan-percentage">
              {scanProgress.progress ? `${scanProgress.progress.toFixed(1)}%` : '0%'}
            </div>
          </div>
          {scanProgress.currentFile && (
            <div className="music-library-scan-file">
              {t('pages.music-library.scan.processing', { file: scanProgress.currentFile })}
            </div>
          )}
          <div className="music-library-scan-progress-bar">
            <div
              className="music-library-scan-progress-fill"
              style={{
                width: `${(scanProgress.current / scanProgress.total) * 100}%`,
              }}
            />
          </div>
          <div className="music-library-scan-stats">
            <span className="scan-stat-count">
              {t('pages.music-library.scan.count', {
                current: scanProgress.current,
                total: scanProgress.total,
              })}
            </span>
            {scanProgress.speed && (
              <span className="scan-stat-speed">
                {t('pages.music-library.scan.speed', { speed: scanProgress.speed.toFixed(1) })}
              </span>
            )}
            {scanProgress.remaining && scanProgress.remaining > 0 && (
              <span className="scan-stat-remaining">
                {t('pages.music-library.scan.remaining', { seconds: Math.ceil(scanProgress.remaining) })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 濞撳懐鈹栫涵顔款吇鐎电鐦藉?*/}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title={t('pages.music-library.clear.title')}
        message={t('pages.music-library.clear.message')}
        confirmText={t('common.action.clear')}
        cancelText={t('common.action.cancel')}
        confirmButtonStyle="danger"
        onConfirm={handleClearLibrary}
        onCancel={() => setShowClearConfirm(false)}
      />

      <ConfirmDialog
        isOpen={cleanupConfirmTarget !== null}
        title={t('pages.music-library.pathsManager.cleanupConfirm.title')}
        message={cleanupConfirmMessage}
        confirmText={t('pages.music-library.pathsManager.cleanupConfirm.confirmButton')}
        cancelText={t('common.action.cancel')}
        confirmButtonStyle="danger"
        onConfirm={() => {
          void handleConfirmCleanupMissing();
        }}
        onCancel={() => setCleanupConfirmTarget(null)}
      />

      {/* 鎼存捁鐭惧鍕吀閻炲棗娅?*/}
      {showPathsManager && (
        <div className="paths-manager-overlay" onClick={() => setShowPathsManager(false)}>
          <div className="paths-manager-modal" onClick={(e) => e.stopPropagation()}>
            <div className="paths-manager-header">
              <h3>{t('pages.music-library.pathsManager.title')}</h3>
              <div className="paths-manager-header-actions">
                <button
                  className="paths-scan-btn"
                  onClick={async () => {
                    await handleScanFolder();
                    await loadLibraryPaths();
                  }}
                  disabled={scanProgress?.isScanning}
                >
                  {t('pages.music-library.pathsManager.addFolderButton')}
                </button>
                <button
                  className="paths-clean-missing-btn"
                  onClick={handleRequestCleanupMissingForAllPaths}
                  disabled={
                    scanProgress?.isScanning ||
                    isCleanupAllMissingBusy ||
                    isLibraryPathHealthLoading ||
                    cleanupConfirmTarget !== null ||
                    totalMissingTracks <= 0
                  }
                  title={t('pages.music-library.pathsManager.path.cleanupMissingAllTitle', {
                    count: totalMissingTracks,
                  })}
                >
                  {isCleanupAllMissingBusy
                    ? t('pages.music-library.pathsManager.path.cleanupMissingBusy')
                    : t('pages.music-library.pathsManager.path.cleanupMissingAllButton', {
                        count: totalMissingTracks,
                      })}
                </button>
                <button onClick={() => setShowPathsManager(false)}>X</button>
              </div>
            </div>

            <div className="paths-manager-body">
              {libraryPaths.length === 0 ? (
                <div className="paths-manager-empty">
                  <div className="paths-empty-icon">📁</div>
                  <div className="paths-empty-text">{t('pages.music-library.pathsManager.empty.title')}</div>
                  <div className="paths-empty-hint">{t('pages.music-library.pathsManager.empty.hint')}</div>
                </div>
              ) : (
                <div className="paths-manager-list">
                  {libraryPaths.map((path) => {
                    const pathHealth = libraryPathHealthMap[path.id];
                    const missingCount = pathHealth?.missingTracks ?? 0;
                    const isPathCleanupBusy = pathCleanupBusyMap[path.id] === true;

                    return (
                    <div key={path.id} className="path-item">
                      <div className="path-item-icon">📁</div>
                      <div className="path-item-info">
                        <div className="path-item-name" title={path.path}>
                          {path.path}
                        </div>
                        <div className="path-item-meta">
                          {path.trackCount > 0 && (
                            <span className="path-meta-tracks">
                              {t('pages.music-library.pathsManager.path.trackCount', { count: path.trackCount })}
                            </span>
                          )}
                          {missingCount > 0 && (
                            <span className="path-meta-missing">
                              {t('pages.music-library.pathsManager.path.missingCount', {
                                count: missingCount,
                              })}
                            </span>
                          )}
                          {!path.isVisible && (
                            <span className="path-meta-hidden">
                              {t('pages.music-library.pathsManager.path.hiddenBadge')}
                            </span>
                          )}
                          {!path.isScanned && (
                            <span className="path-meta-scan-paused">
                              {t('pages.music-library.pathsManager.path.scanPausedBadge')}
                            </span>
                          )}
                          {path.lastScanned && (
                            <span className="path-meta-time">
                              🕒{' '}
                              {new Date(path.lastScanned).toLocaleString(locale, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                          {!path.lastScanned && (
                            <span className="path-meta-unscanned">
                              {t('pages.music-library.pathsManager.path.unscanned')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="path-item-actions">
                        <button
                          className={`path-item-action-btn ${path.isVisible ? 'path-item-visibility-on' : 'path-item-visibility-off'}`}
                          onClick={async () => {
                            const releaseProtection = beginAudioProtection(
                              'music-library-toggle-path-visibility',
                              20_000
                            );
                            try {
                              await musicLibraryService.setLibraryPathVisibility(path.id, !path.isVisible);
                              await Promise.all([loadLibraryPaths(), loadLibraryData()]);
                            } finally {
                              releaseProtection();
                            }
                          }}
                          title={
                            path.isVisible
                              ? t('pages.music-library.pathsManager.path.hideTitle')
                              : t('pages.music-library.pathsManager.path.showTitle')
                          }
                        >
                          {path.isVisible ? '👁' : '🙈'}
                        </button>
                        <button
                          className={`path-item-action-btn ${path.isScanned ? 'path-item-scanning-on' : 'path-item-scanning-off'}`}
                          onClick={async () => {
                            const releaseProtection = beginAudioProtection(
                              'music-library-toggle-path-scanning',
                              20_000
                            );
                            try {
                              await musicLibraryService.setLibraryPathScanning(path.id, !path.isScanned);
                              await loadLibraryPaths();
                            } finally {
                              releaseProtection();
                            }
                          }}
                          title={
                            path.isScanned
                              ? t('pages.music-library.pathsManager.path.disableScanTitle')
                              : t('pages.music-library.pathsManager.path.enableScanTitle')
                          }
                        >
                          {path.isScanned ? '🔄' : '⏸'}
                        </button>
                        <button
                          className="path-item-action-btn path-item-clean-missing"
                          onClick={() => {
                            handleRequestCleanupMissingForPath(path.id, path.path, missingCount);
                          }}
                          disabled={
                            scanProgress?.isScanning ||
                            isLibraryPathHealthLoading ||
                            isPathCleanupBusy ||
                            cleanupConfirmTarget !== null ||
                            missingCount <= 0
                          }
                          title={
                            missingCount > 0
                              ? t('pages.music-library.pathsManager.path.cleanupMissingTitle', {
                                  count: missingCount,
                                })
                              : t('pages.music-library.pathsManager.path.cleanupMissingDisabledTitle')
                          }
                        >
                          {isPathCleanupBusy
                            ? t('pages.music-library.pathsManager.path.cleanupMissingBusy')
                            : '🧹'}
                        </button>
                        <button
                          className="path-item-action-btn path-item-rescan"
                          onClick={async () => {
                            const releaseProtection = beginAudioProtection('music-library-rescan-path', 90_000);
                            try {
                              await musicLibraryService.scanFolder(path.path, path.id);
                              await loadLibraryPaths();
                              await loadLibraryData();
                            } catch (error) {
                              console.error('Failed to rescan path:', error);
                            } finally {
                              releaseProtection();
                            }
                          }}
                          disabled={scanProgress?.isScanning}
                          title={t('pages.music-library.pathsManager.path.rescanTitle')}
                        >
                          ↻
                        </button>
                        <button
                          className="path-item-action-btn path-item-remove"
                          onClick={async () => {
                            const releaseProtection = beginAudioProtection('music-library-remove-path', 20_000);
                            try {
                              await musicLibraryService.removeLibraryPath(path.id);
                              await Promise.all([loadLibraryPaths(), loadLibraryData()]);
                            } finally {
                              releaseProtection();
                            }
                          }}
                          title={t('pages.music-library.pathsManager.path.removeTitle')}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="paths-manager-footer">
              <div className="paths-manager-info">
                {t('pages.music-library.pathsManager.footer')}
              </div>
              <div className="paths-manager-health-info">
                {isLibraryPathHealthLoading
                  ? t('pages.music-library.pathsManager.health.loading')
                  : isLibraryPathHealthAvailable
                    ? t('pages.music-library.pathsManager.health.summary', {
                        count: totalMissingTracks,
                      })
                    : t('pages.music-library.pathsManager.health.unavailable')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 闁挎瑨顕ら幓鎰仛鐎电鐦藉?*/}
      {errorMessage && (
        <ConfirmDialog
          isOpen={true}
          title={t('common.dialog.errorTitle')}
          message={errorMessage}
          confirmText={t('common.action.ok')}
          cancelText=""
          confirmButtonStyle="primary"
          onConfirm={() => setErrorMessage(null)}
          onCancel={() => setErrorMessage(null)}
        />
      )}
    </div>
  );

  // 瀹撳苯鍙嗗Ο鈥崇础閻╁瓨甯存潻鏂挎礀閸愬懎顔愰敍宀勬姜瀹撳苯鍙嗗Ο鈥崇础娴ｈ法鏁ortal
  return (
    <>
      {embedded ? libraryContent : createPortal(libraryContent, document.body)}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
};
