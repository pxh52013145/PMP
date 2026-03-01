import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Track } from '../../services/audio';
import {
  musicLibraryService,
  LibraryStats,
  ScanProgress,
  LibraryPath,
  LibraryPathHealth,
  CoverRuntimeCachePolicy,
  CloudFallbackTaskStatus,
  CloudHashJobStatus,
} from '../../services/audio/MusicLibraryService';
import { ConfirmDialog } from '../magnet/ConfirmDialog';
import { ContextMenu, ContextMenuItem } from '../magnet/ContextMenu';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { readJson } from '../../modules/storage';
import {
  MUSIC_LIBRARY_SOURCE_CHANGE_EVENT,
  MUSIC_LIBRARY_STATS_CHANGE_EVENT,
  type MusicLibraryFooterStatItem,
  type MusicLibraryStatsChangeDetail,
  type MusicLibrarySourceChangeDetail,
  type MusicLibrarySourceMode,
} from '../../contracts/musicLibrarySource';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { useLocale, useT } from '../../i18n';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  applyMusicLibraryBaseQuery,
  canUseNativeBaseFilterGroup,
  canUseNativeBaseOrderRule,
  type MusicLibraryBaseField,
  type MusicLibraryBaseFilterGroup,
  type MusicLibraryBaseGroupRule,
  type MusicLibraryBaseLogicalOperator,
  type MusicLibraryBaseOperator,
  type MusicLibraryBaseQuery,
  type MusicLibraryBaseSortRule,
  type MusicLibraryBaseView,
} from '../../modules/music-library/baseQuery';
import {
  appendMusicLibraryBaseFilter,
  appendMusicLibraryBaseFilterGroup,
  appendMusicLibraryBaseGroupByRule,
  appendMusicLibraryBaseSortRule,
  createMusicLibraryBaseEmptyFilterState,
  createMusicLibraryBaseQuickFilterState,
  moveMusicLibraryBaseGroupByRule,
  moveMusicLibraryBaseSortRule,
  removeMusicLibraryBaseFilter,
  removeMusicLibraryBaseFilterGroup,
  removeMusicLibraryBaseGroupByRule,
  removeMusicLibraryBaseSortRule,
  updateMusicLibraryBaseFilterGroupOperator,
  updateMusicLibraryBaseGroupByRule,
  updateMusicLibraryBaseSortRule,
} from '../../modules/music-library/baseState';
import {
  MUSIC_LIBRARY_BASE_FIELD_LABEL_MAP,
  MUSIC_LIBRARY_BASE_FILTER_FIELDS,
  MUSIC_LIBRARY_BASE_OPERATORS,
  MUSIC_LIBRARY_BASE_OPERATOR_LABEL_MAP,
  MUSIC_LIBRARY_BASE_ORDER_RULE_FIELDS,
} from '../../modules/music-library/baseMeta';
import {
  loadMusicLibraryBaseState,
  persistMusicLibraryBaseState,
} from '../../modules/music-library/basePersistence';
import {
  applyBaseViewPropertiesToLocalTrackColumns,
  cloneDefaultLocalTrackColumnSettings,
  LEFT_ALIGNED_LOCAL_TRACK_COLUMNS,
  LOCAL_TRACK_COLUMN_DEFINITIONS,
  normalizeLocalTrackColumnSettings,
  normalizeLocalTrackColumnWidth,
  type LocalTrackColumnConfig,
  type LocalTrackColumnId,
} from '../../modules/music-library/localTrackColumns';
import { deriveLocalTrackLayoutModel } from '../../modules/music-library/localTrackLayout';
import {
  buildStableFallbackAuditSnapshot,
  buildTagsJsonFromText,
  collectStableFallbackAuditEntries,
  deriveStableLibraryStats,
  parseTagsJsonAsText,
  type StableFallbackAuditSnapshot,
} from '../../modules/music-library/stableLibraryModel';
import { useCoverUrlForTrack } from '../magnet/shared/useCoverUrlForTrack';
import { buildAddToPlaylistMenuItem } from '../magnet/trackContextMenu';
import { useBaseControlPanels } from './useBaseControlPanels';
import './MusicLibrary.css';

interface MusicLibraryProps {
  isOpen?: boolean;
  onClose?: () => void;
  onAddToQueue?: (tracks: Track[]) => void;
  onPlayNow?: (tracks: Track[], startIndex?: number) => void;
  embedded?: boolean; // 闁哄嫷鍨伴幆浣哥暤鐏炶棄寮虫俊顖椻偓宕囩闁挎稑鐗嗗﹢鐙絘vigationPage濞戞搩鍙忕槐?
}

// 闁?婵☆垪鈧櫕鍋ョ紒鐙欏懐澶勯悗娑欙公缁辨壆鎹勯妸褏鐭嬪ù鐘烘硾閻ゅ嫭绗熺€ｎ亜褰欏ù婊庡亾缁辨繃绋夊鍕獥闁搞儳濮崇拹鐔虹磼閸曨亝顐介柛妤佺摃濞村洭鎳撶仦鍏间涪濠?
type ModuleCacheSnapshot = {
  tracks: Track[];
  trackNextOffset: number;
  hasMoreTracks: boolean;
  timestamp: number;
};

let moduleCache: ModuleCacheSnapshot | null = null;

// ? 婵☆垪鈧櫕鍋ョ紒鐙欏嫮娉婇柛鏂诲妺缂嶅懐绱旈鍓у閻庢稒锕槐浼村箰?viewMode 閻犱焦婢樼换鍌涚▔缂佹娉婇柛鏂诲妽濞碱垱鎷呭鍥╂瀭濞戞挸閰ｉ弫瀣倷閻у摜绀勯悹鎭掑姂閵嗗妫冮姀锝囧劜閺?缂備礁瀚▎銏ゅ础濮濆本绁板ǎ鍥ㄧ箖鐎垫棃鏁?
type MainScrollAnchor =
  | { kind: 'track'; id: string; offset: number };

type MainScrollRootKind = 'main' | 'navigation';
type MainScrollMemory = { scrollTop: number; anchor?: MainScrollAnchor; rootKind?: MainScrollRootKind };

type MusicLibraryViewMode = 'all';

type ViewScrollMemory = Partial<Record<MusicLibraryViewMode, MainScrollMemory>>;
const moduleScrollMemory: ViewScrollMemory = {};

type StableLibraryEntry = Awaited<ReturnType<typeof musicLibraryService.listCloudLibraryEntries>>[number];
type StableFallbackTask = Awaited<ReturnType<typeof musicLibraryService.listCloudFallbackTasks>>[number];
type StableHashJob = Awaited<ReturnType<typeof musicLibraryService.listCloudHashJobs>>[number];

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

const STABLE_FALLBACK_STATUS_OPTIONS: CloudFallbackTaskStatus[] = [
  'queued',
  'dispatching',
  'resolved',
  'failed',
  'cancelled',
];

const STABLE_HASH_STATUS_OPTIONS: CloudHashJobStatus[] = ['pending', 'running', 'completed', 'failed'];

type MainViewportSnapshot = {
  scrollTop: number;
  clientHeight: number;
  clientWidth: number;
};

const CACHE_DURATION = 5 * 60 * 1000; // 5闁告帒妫濋幐鎾剁磽閹惧磭鎽?
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
    trackNextOffset: normalizedOffset,
    hasMoreTracks: normalizedHasMore,
    timestamp: Date.now(),
  };
}

function isModuleCacheTrackMetadataCompatible(snapshot: ModuleCacheSnapshot): boolean {
  return snapshot.tracks.every((track) => {
    const hasDuration =
      typeof track.duration === 'number' && Number.isFinite(track.duration) && track.duration > 0;
    if (!hasDuration) {
      return true;
    }

    const hasBitrate =
      typeof track.bitrate === 'number' && Number.isFinite(track.bitrate) && track.bitrate > 0;
    const hasFileSize =
      typeof track.fileSize === 'number' && Number.isFinite(track.fileSize) && track.fileSize > 0;
    return hasBitrate || hasFileSize;
  });
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
  const safeComposer = internTrackText(trimTrackText(track.composer));
  const safeFormat = internTrackText(trimTrackText(track.format, 32));
  const safeCodecName = internTrackText(trimTrackText(track.codecName, 48));

  return {
    id: track.id,
    title: safeTitle,
    artist: safeArtist,
    album: safeAlbum,
    genre: safeGenre,
    duration: typeof track.duration === 'number' ? track.duration : undefined,
    year: typeof track.year === 'number' ? track.year : undefined,
    trackNumber: typeof track.trackNumber === 'number' ? track.trackNumber : undefined,
    discNumber: typeof track.discNumber === 'number' ? track.discNumber : undefined,
    composer: safeComposer,
    bitrate: typeof track.bitrate === 'number' ? track.bitrate : undefined,
    sampleRate: typeof track.sampleRate === 'number' ? track.sampleRate : undefined,
    format: safeFormat,
    codecName: safeCodecName,
    fileSize: typeof track.fileSize === 'number' ? track.fileSize : undefined,
    dateAdded: typeof track.dateAdded === 'number' ? track.dateAdded : undefined,
    lastPlayed: typeof track.lastPlayed === 'number' ? track.lastPlayed : undefined,
    playCount: typeof track.playCount === 'number' ? track.playCount : undefined,
    rating: typeof track.rating === 'number' ? track.rating : undefined,
    favorite: typeof track.favorite === 'boolean' ? track.favorite : undefined,
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

type LocalTrackCardProps = {
  track: Track;
  index: number;
  isPlayPending: boolean;
  subtitle: string;
  onTrackDoubleClick: (track: Track, index: number) => void;
  onTrackContextMenu: (track: Track, index: number, event: React.MouseEvent) => void;
  onPlaySingleTrack?: (track: Track, event: React.MouseEvent) => void;
  onAddSingleTrack?: (track: Track, event: React.MouseEvent) => void;
  playButtonTitle: string;
  addButtonTitle: string;
};

const LocalTrackCard: React.FC<LocalTrackCardProps> = ({
  track,
  index,
  isPlayPending,
  subtitle,
  onTrackDoubleClick,
  onTrackContextMenu,
  onPlaySingleTrack,
  onAddSingleTrack,
  playButtonTitle,
  addButtonTitle,
}) => {
  const coverUrl = useCoverUrlForTrack(track, { coverSizeHint: 'small' });
  const [coverLoadFailed, setCoverLoadFailed] = useState(false);

  useEffect(() => {
    setCoverLoadFailed(false);
  }, [coverUrl, track.id]);

  const normalizedCoverUrl = typeof coverUrl === 'string' ? coverUrl.trim() : '';
  const displayCoverUrl = !coverLoadFailed && normalizedCoverUrl.length > 0 ? normalizedCoverUrl : undefined;
  const fallbackCoverGlyph =
    typeof track.title === 'string' && track.title.trim().length > 0
      ? track.title.trim().slice(0, 1).toUpperCase()
      : '♪';

  return (
    <div
      data-track-id={track.id}
      className={`music-library-track-card${isPlayPending ? ' is-play-pending' : ''}`}
      onDoubleClick={() => onTrackDoubleClick(track, index)}
      onContextMenu={(event) => onTrackContextMenu(track, index, event)}
    >
      <div className="music-library-track-card-cover" aria-hidden="true">
        {displayCoverUrl ? (
          <img
            src={displayCoverUrl}
            alt={track.title || subtitle}
            loading="lazy"
            decoding="async"
            onLoad={(event) => {
              const target = event.currentTarget;
              musicLibraryService.reportCoverDecoded(
                displayCoverUrl,
                target.naturalWidth,
                target.naturalHeight
              );
            }}
            onError={() => setCoverLoadFailed(true)}
          />
        ) : (
          <div className="music-library-track-card-cover-fallback">{fallbackCoverGlyph}</div>
        )}
      </div>

      <div className="music-library-track-card-body">
        <div className="music-library-track-card-title" title={track.title || '-'}>
          {track.title || '-'}
        </div>
        <div className="music-library-track-card-subtitle" title={subtitle}>
          {subtitle}
        </div>
      </div>

      <div className="music-library-track-card-actions">
        {onPlaySingleTrack && (
          <button
            onClick={(event) => onPlaySingleTrack(track, event)}
            title={playButtonTitle}
            className="track-action-play"
          >
            ▶
          </button>
        )}
        {onAddSingleTrack && (
          <button
            onClick={(event) => onAddSingleTrack(track, event)}
            title={addButtonTitle}
            className="track-action-add"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
};

// 婵炴挸鎳樺▍搴∥熼垾铏仴缂傚倹鎸搁悺?
export function clearModuleCache() {
  moduleCache = null;
}

export const MusicLibrary: React.FC<MusicLibraryProps> = ({
  isOpen = true,
  onClose,
  onAddToQueue,
  onPlayNow,
  embedded = false,
}) => {
  const audioService = useAudioService();
  const t = useT();
  const locale = useLocale();
  const [librarySourceMode, setLibrarySourceMode] = useState<MusicLibrarySourceMode>('local');
  const viewMode: MusicLibraryViewMode = 'all';
  const [searchQuery, setSearchQuery] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [libraryStats, setLibraryStats] = useState<LibraryStats>({
    totalTracks: 0,
    totalArtists: 0,
    totalAlbums: 0,
    totalSize: 0,
    totalDuration: 0,
  });
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
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
  const [stableFallbackAudit, setStableFallbackAudit] = useState<StableFallbackAuditSnapshot>(() =>
    buildStableFallbackAuditSnapshot([])
  );
  const [fallbackTaskStatusPendingId, setFallbackTaskStatusPendingId] = useState<string | null>(null);
  const [hashJobStatusPendingId, setHashJobStatusPendingId] = useState<string | null>(null);
  const [editingStableEntry, setEditingStableEntry] = useState<StableLibraryEntry | null>(null);
  const [stableEntryRatingInput, setStableEntryRatingInput] = useState('');
  const [stableEntryTagsInput, setStableEntryTagsInput] = useState('');
  const [isStableMetadataSaving, setIsStableMetadataSaving] = useState(false);
  const [localTrackColumnsLoaded, setLocalTrackColumnsLoaded] = useState(false);
  const [localTrackColumnSettings, setLocalTrackColumnSettings] = useState<LocalTrackColumnConfig[]>(() =>
    cloneDefaultLocalTrackColumnSettings()
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
  const currentCoverPolicyRef = useRef<CoverRuntimeCachePolicy>('default');
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const baseToolbarRegionRef = useRef<HTMLDivElement | null>(null);
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

  const {
    showBaseSortPanel,
    showBaseFilterPanel,
    showColumnSettings,
    toggleBaseControlPanel,
  } = useBaseControlPanels({
    enabled: isOpen && librarySourceMode === 'local',
    toolbarRegionRef: baseToolbarRegionRef,
  });

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

  // ? 閻犱焦婢樼换鍌氼煥濮橆剙袟濞达絽绉堕悿鍡涙晬濮橆厼鐦?viewMode 缂備礁鐡ㄦ慨銏＄▔缂佹娉婇柛鏂诲妽濞?scrollTop + 闂佹寧姘ㄩ崑锝夋晬瀹€鍕級闁稿繐绉峰▔鏇熴亜閻㈠憡妗?闁告帒娲﹀畷?tab 濞戞挶鍨归妵鎴炴媴瀹ュ洨鏋?
  const isRestoringMainScrollRef = useRef(false);
  const mainScrollUserDirtyRef = useRef(false);
  const mainScrollAnchorDebounceRef = useRef<number | null>(null);
  const mainScrollRestoreStateRef = useRef<{ viewMode: MusicLibraryViewMode | null; done: boolean }>({
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
    (root: HTMLElement): MainScrollAnchor | null => {
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

      const element = findFirstVisible('.music-library-track[data-track-id]');
      const id = element?.getAttribute('data-track-id')?.trim();
      if (!element || !id) return null;
      const rect = element.getBoundingClientRect();
      return { kind: 'track', id, offset: rect.top - rootRect.top };
    },
    []
  );

  const captureMainScrollMemory = useCallback(
    (mode: MusicLibraryViewMode) => {
      const root = getMainScrollRoot();
      if (!root) return;

      const memory: MainScrollMemory = {
        scrollTop: root.scrollTop,
      };
      const main = mainScrollRef.current;
      const navigationContent = main?.closest<HTMLElement>('.navigation-content') ?? null;
      memory.rootKind = navigationContent && root === navigationContent ? 'navigation' : 'main';

      const anchor = computeMainScrollAnchor(root);
      if (anchor) memory.anchor = anchor;

      moduleScrollMemory[mode] = memory;
    },
    [computeMainScrollAnchor, getMainScrollRoot]
  );

  const scheduleMainScrollAnchorUpdate = useCallback(
    (mode: MusicLibraryViewMode) => {
      if (typeof window === 'undefined') return;
      if (mainScrollAnchorDebounceRef.current !== null) {
        window.clearTimeout(mainScrollAnchorDebounceRef.current);
      }

      mainScrollAnchorDebounceRef.current = window.setTimeout(() => {
        mainScrollAnchorDebounceRef.current = null;

        const root = getMainScrollRoot(moduleScrollMemory[mode]?.rootKind);
        if (!root) return;

        const anchor = computeMainScrollAnchor(root);
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

  // 闁圭儤甯掔花顓㈡偐閼哥鍋?
  const [baseView, setBaseView] = useState<MusicLibraryBaseView>('table');
  const [baseFilterJoinOperator, setBaseFilterJoinOperator] =
    useState<MusicLibraryBaseLogicalOperator>('and');
  const [baseFilterGroups, setBaseFilterGroups] = useState<MusicLibraryBaseFilterGroup[]>([]);
  const [activeBaseFilterGroupId, setActiveBaseFilterGroupId] = useState<string | null>(null);
  const [baseGroupByRules, setBaseGroupByRules] = useState<MusicLibraryBaseGroupRule[]>([]);
  const [baseSortRules, setBaseSortRules] = useState<MusicLibraryBaseSortRule[]>([]);
  const [baseFilterField, setBaseFilterField] = useState<MusicLibraryBaseField>('artist');
  const [baseFilterRuleOperator, setBaseFilterRuleOperator] =
    useState<MusicLibraryBaseOperator>('contains');
  const [baseFilterValue, setBaseFilterValue] = useState('');
  const [propertySearchQuery, setPropertySearchQuery] = useState('');
  const [nativeBaseTracks, setNativeBaseTracks] = useState<Track[] | null>(null);
  const [isNativeBaseTracksLoading, setIsNativeBaseTracksLoading] = useState(false);

  // 闁告瑦濞婇弫顓㈡嚕濠婂啫绀嬮柣妯垮煐閳?
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

    const remaining = root.scrollHeight - (root.scrollTop + root.clientHeight);
    if (remaining <= TRACK_SCROLL_LOAD_TRIGGER_PX) {
      setRenderedTrackLimit((prev) => prev + TRACK_RENDER_CHUNK_SIZE);
    }
    maybeLoadTrackChunkFromScroll();

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
  }, [getMainScrollRoot, isOpen, syncMainViewport, tracks.length, viewMode]);

  useLayoutEffect(() => {
    if (!isOpen || librarySourceMode !== 'local') {
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
  }, [isOpen, librarySourceMode, refreshLocalTrackLayoutWidth]);

  const loadLibraryData = useCallback(async () => {
    const token = ++libraryLoadTokenRef.current;
    console.log('Loading library data...');
    const releaseProtection = beginAudioProtection('music-library-load', 25_000);

    // 闁?缂佹柨顑呭畵鍡涘及閸撗佷粵婵☆垪鈧櫕鍋ョ紓鍌涙尭閻°劑寮悧鍫濈ウ闁挎稑鐗嗛々褔寮稿鍕畳闁轰礁鐗炵槐?
    const now = Date.now();
    if (
      moduleCache &&
      now - moduleCache.timestamp < CACHE_DURATION &&
      isModuleCacheTrackMetadataCompatible(moduleCache)
    ) {
      console.log('Using module cache for instant display');
      setTracks(moduleCache.tracks);
      trackNextOffsetRef.current = moduleCache.trackNextOffset;
      setHasMoreTracks(moduleCache.hasMoreTracks);
      setRenderedTrackLimit(TRACK_RENDER_CHUNK_SIZE);
      updateCoverRuntimePolicy('high');

      // 闁革负鍔岄幃妤呭矗閺夎法纾芥慨婵勫劜濞插潡寮幍顔惧煚閻犱讲鈧弓绻嗛柟?
      musicLibraryService.getLibraryStats().then((stats) => {
        if (token !== libraryLoadTokenRef.current) return;
        setLibraryStats(stats);
      });
      return; // 闁?闁烩晛鐡ㄧ敮瀛樻交閺傛寧绀€闁挎稑濂旂粭澶愭煂瀹ュ棙鐓€闁告梻濮惧ù?
    }

    // 婵炲备鍓濆﹢浣虹磽閹惧磭鎽犻柟瀛樼墱缁憋妇鈧稒顭堢换鍐嫉閻曞倻绀夊ù?IndexedDB 闁告梻濮惧ù?
    console.log('Loading from IndexedDB...');

    try {
      // 闁?濞村吋锚鐎垫煡鏁嶅杈ㄧ函闁规亽鍎辨慨鐐存姜閼恒儲娈堕柟璇″櫙缁辨繈姊介幇顒€鐓戝☉?1000 濡絾鐗槐娆撴焼閸喖甯抽梺鎻掔Т椤﹁尙鎷犵拠鎻掔悼闁?
      const initialTracks = await musicLibraryService.getAllTracks(INITIAL_TRACK_LOAD_LIMIT);

      if (token !== libraryLoadTokenRef.current) return;

      const compactInitialTracks = compactTracksForLibrary(initialTracks);
      const hasMore = compactInitialTracks.length >= INITIAL_TRACK_LOAD_LIMIT;
      trackNextOffsetRef.current = initialTracks.length;
      setHasMoreTracks(hasMore);
      setRenderedTrackLimit(TRACK_RENDER_CHUNK_SIZE);
      updateCoverRuntimePolicy('high');

      console.log('Library data loaded:', {
        tracks: compactInitialTracks.length,
      });

      // 闁哄洤鐡ㄩ弻濠囧及閸撗佷粵闁轰胶澧楀畵渚€宕仦鐏镐線宕稿Δ鍐閻?
      moduleCache = buildModuleCacheSnapshot({
        tracks: compactInitialTracks,
        trackNextOffset: trackNextOffsetRef.current,
        hasMoreTracks: hasMore,
        normalizeForIncrementalLoad: true,
      });

      setTracks(compactInitialTracks);

      // 闁革负鍔岄幃妤呭矗閺夎法纾芥慨婵勫劥椤撳摜绮诲Δ鍐煚閻犱讲鈧弓绻嗛柟顓у灲缁辨瑦绋夊澶嬧枎濠靛鎷稩闁?
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
  }, [beginAudioProtection, updateCoverRuntimePolicy]);

  // 闁告梻濮惧ù鍥ㄦ償閹惧湱鐔呯€?
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
      setLibrarySourceMode(nextMode);
      setShowPathsManager(false);
      setSearchQuery('');

      if (searchDebounceTimerRef.current != null) {
        window.clearTimeout(searchDebounceTimerRef.current);
        searchDebounceTimerRef.current = null;
      }

      {
        const emptyFilterState = createMusicLibraryBaseEmptyFilterState();
        setBaseFilterJoinOperator(emptyFilterState.filterJoinOperator);
        setBaseFilterGroups(emptyFilterState.filterGroups);
        setActiveBaseFilterGroupId(emptyFilterState.activeFilterGroupId);
      }

      if (nextMode === 'local') {
        searchTokenRef.current += 1;
        void resetLibraryDataFromStorage();
        return;
      }

      setMainViewport((prev) => ({ ...prev, scrollTop: 0 }));
      const root = getMainScrollRoot(moduleScrollMemory[viewMode]?.rootKind);
      root?.scrollTo({ top: 0 });
      void loadStableLibraryEntries();
    },
    [
      captureMainScrollMemory,
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
    updateCoverRuntimePolicy('high');
    void loadLibraryData();
  }, [
    isOpen,
    librarySourceMode,
    loadLibraryData,
    loadStableLibraryEntries,
    searchQuery,
    updateCoverRuntimePolicy,
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

  // 閻犱降鍨藉Σ鍕箥椤愶絽浼庨弶鈺傜☉鐎?
  useEffect(() => {
    if (librarySourceMode !== 'local') return;
    const unsubscribe = musicLibraryService.onScanProgress((progress) => {
      console.log('Scan progress:', progress);
      setScanProgress(progress);

      // 闁规鍋呭璺ㄢ偓鐟版湰閸ㄦ岸宕ユ惔銈呮闁告柣鍔岄崺娑㈠棘閻楀牊娈堕柟璇″枛閹锋壆鎹勯姘辩獮闁告帗顨夐妴?
      if (!progress.isScanning && progress.current > 0) {
        console.log('Scan completed, refreshing library...');
        clearModuleCache(); // 闁?婵炴挸鎳樺▍搴ｇ磽閹惧磭鎽?
        // 鐎点倖鍎肩换婊勭▔閳ь剟鎮欓崷顓涒偓妯荤┍濠靛洦娈堕柟璇″枛閸熸捇宕楅妷銉ф殮闁?
        setTimeout(() => {
          Promise.all([
            loadLibraryData(),
            loadLibraryPaths(), // 闁告艾鏈鍌炲礆闁垮鐓€閻犱警鍨扮欢鐐哄礆濡ゅ嫨鈧?
          ]);
        }, 300); // 闁告垵绻愰惃顖氼嚈閹壆绠块柛?300ms
      }
    });
    return unsubscribe;
  }, [librarySourceMode, loadLibraryData, loadLibraryPaths]);

  useEffect(() => {
    if (!isOpen) return;
    if (librarySourceMode !== 'local') {
      updateCoverRuntimePolicy('hidden');
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
  ]);

  // Desktop/Tauri: 濞戞挻鎹佺欢顐や焊娓氣偓濞间即骞婇幒鎴濐潱閺夌偞鏋荤槐姗tersectionObserver + 妤犵偠娉涜ぐ鍌炴⒓閻斿嘲鐏欓柨?
  

  // 濠㈣泛瀚幃濠囧棘閸ワ附顐藉鎯邦潐婢瑰倿骞?
  const handleScanFolder = async () => {
    const releaseProtection = beginAudioProtection('music-library-scan', 90_000);
    try {
      console.log('Starting folder scan...');
      await musicLibraryService.scanFolder();
      console.log('Folder scan completed, refreshing library data...');
      // 闁规鍋呭璺ㄢ偓鐟版湰閸ㄦ岸宕ユ惔銏㈩伕闂傚嫨鍊楃槐锔锯偓娑櫭懟鐔煎礆闁垮鐓€闁轰胶澧楀畵渚€宕畝鍐唴鐎垫澘瀚崹顏嗘偘?
      clearModuleCache(); // 闁?婵炴挸鎳樺▍搴ｇ磽閹惧磭鎽犻柨娑樿嫰瀹搁亶宕氶崼鏇炴闁哄倹婢樻慨鐐存姜?
      await Promise.all([
        loadLibraryData(),
        loadLibraryPaths(), // 闁告帡鏀遍弻濠勬崉椤栨氨绐為柛鎺擃殙閵?
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
      updateCoverRuntimePolicy('high');
      moduleCache = buildModuleCacheSnapshot({
        tracks: compactResults,
        trackNextOffset: trackNextOffsetRef.current,
        hasMoreTracks: false,
      });
    } else {
      await resetLibraryDataFromStorage();
      if (token !== searchTokenRef.current) return;
      updateCoverRuntimePolicy('high');
    }

    maybeLoadTrackChunkFromScroll();
  }, [
    bumpAudioProtection,
    maybeLoadTrackChunkFromScroll,
    resetLibraryDataFromStorage,
    updateCoverRuntimePolicy,
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
    const loadedState = loadMusicLibraryBaseState<LocalTrackColumnConfig>({
      createDefaultColumns: cloneDefaultLocalTrackColumnSettings,
      normalizeColumns: normalizeLocalTrackColumnSettings,
      applyBaseViewPropertiesToColumns: applyBaseViewPropertiesToLocalTrackColumns,
    });

    setBaseView(loadedState.schema.view.mode);
    setBaseFilterJoinOperator(loadedState.schema.query.filterOperator);
    setBaseFilterGroups(loadedState.schema.query.filterGroups);
    setActiveBaseFilterGroupId(loadedState.schema.query.filterGroups[0]?.id ?? null);
    setBaseGroupByRules(loadedState.schema.query.groupByRules);
    setBaseSortRules(loadedState.schema.query.sortRules);
    setLocalTrackColumnSettings(loadedState.columns);

    setLocalTrackColumnsLoaded(true);
  }, []);

  useEffect(() => {
    if (!localTrackColumnsLoaded) return;
    persistMusicLibraryBaseState<LocalTrackColumnConfig>({
      query: {
        filterOperator: baseFilterJoinOperator,
        filterGroups: baseFilterGroups,
        groupByRules: baseGroupByRules,
        sortRules: baseSortRules,
      },
      viewMode: baseView,
      columns: localTrackColumnSettings,
      debounceMs: 150,
    });
  }, [
    baseFilterGroups,
    baseFilterJoinOperator,
    baseGroupByRules,
    baseSortRules,
    baseView,
    localTrackColumnSettings,
    localTrackColumnsLoaded,
  ]);

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
    setLocalTrackColumnSettings(cloneDefaultLocalTrackColumnSettings());
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
    if (searchQuery.trim()) return;
    maybeLoadTrackChunkFromScroll();
  }, [isOpen, librarySourceMode, maybeLoadTrackChunkFromScroll, searchQuery, tracks.length]);

  const addBaseSortRule = useCallback(() => {
    setBaseSortRules((prev) => appendMusicLibraryBaseSortRule(prev));
  }, []);

  const addBaseGroupByRule = useCallback(() => {
    setBaseGroupByRules((prev) => appendMusicLibraryBaseGroupByRule(prev));
  }, []);

  const updateBaseSortRule = useCallback(
    (id: string, patch: Partial<Pick<MusicLibraryBaseSortRule, 'field' | 'order'>>) => {
      setBaseSortRules((prev) => updateMusicLibraryBaseSortRule(prev, id, patch));
    },
    []
  );

  const updateBaseGroupByRule = useCallback(
    (id: string, patch: Partial<Pick<MusicLibraryBaseGroupRule, 'field' | 'order'>>) => {
      setBaseGroupByRules((prev) => updateMusicLibraryBaseGroupByRule(prev, id, patch));
    },
    []
  );

  const removeBaseSortRule = useCallback((id: string) => {
    setBaseSortRules((prev) => removeMusicLibraryBaseSortRule(prev, id));
  }, []);

  const removeBaseGroupByRule = useCallback((id: string) => {
    setBaseGroupByRules((prev) => removeMusicLibraryBaseGroupByRule(prev, id));
  }, []);

  const moveBaseSortRule = useCallback((id: string, offset: -1 | 1) => {
    setBaseSortRules((prev) => moveMusicLibraryBaseSortRule(prev, id, offset));
  }, []);

  const moveBaseGroupByRule = useCallback((id: string, offset: -1 | 1) => {
    setBaseGroupByRules((prev) => moveMusicLibraryBaseGroupByRule(prev, id, offset));
  }, []);

  const filteredPropertyColumns = useMemo(() => {
    const keyword = propertySearchQuery.trim().toLowerCase();
    if (!keyword) return localTrackColumnSettings;

    return localTrackColumnSettings.filter((column) => {
      const label = t(LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].headerKey).toLowerCase();
      return label.includes(keyword) || column.id.toLowerCase().includes(keyword);
    });
  }, [localTrackColumnSettings, propertySearchQuery, t]);

  const baseQueryState = useMemo<MusicLibraryBaseQuery>(
    () => ({
      filterOperator: baseFilterJoinOperator,
      filterGroups: baseFilterGroups,
      groupByRules: baseGroupByRules,
      sortRules: baseSortRules,
    }),
    [baseFilterJoinOperator, baseFilterGroups, baseGroupByRules, baseSortRules]
  );

  const handleAddBaseFilter = useCallback(() => {
    const nextState = appendMusicLibraryBaseFilter(
      {
        filterGroups: baseFilterGroups,
        activeFilterGroupId: activeBaseFilterGroupId,
      },
      baseFilterField,
      baseFilterRuleOperator,
      baseFilterValue
    );
    if (!nextState.added) return;

    setBaseFilterGroups(nextState.filterGroups);
    setActiveBaseFilterGroupId(nextState.activeFilterGroupId);
    setBaseFilterValue('');
  }, [
    activeBaseFilterGroupId,
    baseFilterField,
    baseFilterGroups,
    baseFilterRuleOperator,
    baseFilterValue,
  ]);

  const handleRemoveBaseFilter = useCallback((groupId: string, filterId: string) => {
    setBaseFilterGroups((previous) => removeMusicLibraryBaseFilter(previous, groupId, filterId));
  }, []);

  const handleAddBaseFilterGroup = useCallback(() => {
    const nextState = appendMusicLibraryBaseFilterGroup({
      filterGroups: baseFilterGroups,
      activeFilterGroupId: activeBaseFilterGroupId,
    });
    setBaseFilterGroups(nextState.filterGroups);
    setActiveBaseFilterGroupId(nextState.activeFilterGroupId);
  }, [activeBaseFilterGroupId, baseFilterGroups]);

  const handleUpdateBaseFilterGroupOperator = useCallback(
    (groupId: string, operator: MusicLibraryBaseLogicalOperator) => {
      setBaseFilterGroups((previous) =>
        updateMusicLibraryBaseFilterGroupOperator(previous, groupId, operator)
      );
    },
    []
  );

  const handleRemoveBaseFilterGroup = useCallback(
    (groupId: string) => {
      const nextState = removeMusicLibraryBaseFilterGroup(
        {
          filterGroups: baseFilterGroups,
          activeFilterGroupId: activeBaseFilterGroupId,
        },
        groupId
      );
      setBaseFilterGroups(nextState.filterGroups);
      setActiveBaseFilterGroupId(nextState.activeFilterGroupId);
    },
    [activeBaseFilterGroupId, baseFilterGroups]
  );

  const handleClearBaseFilters = useCallback(() => {
    const emptyFilterState = createMusicLibraryBaseEmptyFilterState();
    setBaseFilterJoinOperator(emptyFilterState.filterJoinOperator);
    setBaseFilterGroups(emptyFilterState.filterGroups);
    setActiveBaseFilterGroupId(emptyFilterState.activeFilterGroupId);
    setBaseFilterValue('');
  }, []);

  const handleApplyQuickBaseFilter = useCallback((field: MusicLibraryBaseField, value: string) => {
    const quickFilterState = createMusicLibraryBaseQuickFilterState(field, value);
    if (!quickFilterState) return;

    setBaseFilterJoinOperator(quickFilterState.filterJoinOperator);
    setBaseFilterGroups(quickFilterState.filterGroups);
    setActiveBaseFilterGroupId(quickFilterState.activeFilterGroupId);
  }, []);

  const canUseNativeBaseQuery = useMemo(() => {
    if (librarySourceMode !== 'local') return false;
    if (!isTauriRuntime()) return false;
    if (!baseQueryState.filterGroups.every((group) => canUseNativeBaseFilterGroup(group))) return false;
    if (!baseQueryState.groupByRules.every((rule) => canUseNativeBaseOrderRule(rule))) return false;
    if (!baseQueryState.sortRules.every((rule) => canUseNativeBaseOrderRule(rule))) return false;

    return true;
  }, [baseQueryState, librarySourceMode]);

  const shouldUseNativeBaseQuery =
    canUseNativeBaseQuery &&
    (baseQueryState.filterGroups.some((group) => group.filters.length > 0) ||
      baseQueryState.groupByRules.length > 0 ||
      baseQueryState.sortRules.length > 0);

  useEffect(() => {
    if (!isOpen || !shouldUseNativeBaseQuery) {
      setNativeBaseTracks(null);
      setIsNativeBaseTracksLoading(false);
      return;
    }

    let cancelled = false;
    setIsNativeBaseTracksLoading(true);

    void musicLibraryService
      .queryLocalTracksByBase({
        searchQuery,
        baseQuery: baseQueryState,
        limit: 2000,
        offset: 0,
        includeMissing: false,
        visibleOnly: true,
      })
      .then((rows) => {
        if (cancelled) return;
        setNativeBaseTracks(rows);
      })
      .finally(() => {
        if (cancelled) return;
        setIsNativeBaseTracksLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, shouldUseNativeBaseQuery, searchQuery, baseQueryState]);

  // 闁兼儳鍢茶ぐ鍥ㄦ交閸ャ劍濮㈤柛婊冩湰鐢挻鎯旇箛鎾村€甸柣銊ュ瀵ゆ椽鏌?
  const filteredTracks = useMemo(() => {
    if (nativeBaseTracks) {
      return nativeBaseTracks;
    }

    return applyMusicLibraryBaseQuery(tracks, baseQueryState);
  }, [nativeBaseTracks, tracks, baseQueryState]);

  // 闁兼儳鍢茶ぐ鍥箳閹烘垹纰嶉柛姘捣濞堟垶绋夐幘鍦竼闁告帗顨夐妴?
  const sortedStableEntries = useMemo(() => {
    return [...stableEntries].sort((a, b) => {
      const updatedDiff = (b.updatedAtMs || 0) - (a.updatedAtMs || 0);
      if (updatedDiff !== 0) return updatedDiff;
      return a.id.localeCompare(b.id);
    });
  }, [stableEntries]);

  const stableLibraryStats = useMemo(() => deriveStableLibraryStats(stableEntries), [stableEntries]);

  const {
    renderedLocalTrackColumns,
    visibleLocalTrackColumnCount,
    localTrackGridTemplate,
  } = useMemo(
    () =>
      deriveLocalTrackLayoutModel({
        localTrackColumnSettings,
        localTrackLayoutWidth,
        mainViewportClientWidth: mainViewport.clientWidth,
      }),
    [localTrackColumnSettings, localTrackLayoutWidth, mainViewport.clientWidth]
  );

  useEffect(() => {
    const header = localTrackListHeaderScrollRef.current;
    const body = localTrackListBodyScrollRef.current;
    if (!header || !body) return;
    header.scrollLeft = body.scrollLeft;
  }, [localTrackGridTemplate, renderedLocalTrackColumns.length]);

  const isUsingNativeBaseTracks = nativeBaseTracks != null;

  const filteredTracksTotal = filteredTracks.length;

  useEffect(() => {
    setRenderedTrackLimit((prev) => {
      if (!Number.isFinite(prev) || prev <= 0) {
        return Math.min(filteredTracksTotal, TRACK_RENDER_CHUNK_SIZE);
      }
      return Math.min(filteredTracksTotal, prev);
    });
  }, [filteredTracksTotal]);

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

  const showTrackLoadHint =
    !isUsingNativeBaseTracks &&
    (isTrackChunkLoading || hasMoreTracks || renderedTracks.length < filteredTracksTotal);

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

    if (memory) {
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
    }

    if (tryRestoreFromScrollTop(memory.scrollTop)) {
      mainScrollRestoreStateRef.current.done = true;
    }
  }, [
    escapeCssSelector,
    filteredTracks,
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

  // 闁告娲栭崵顔界▔閹惧湱甯?- 閻庝絻澹堥崺鍛村礆妫颁胶鐟╅弶鍫熷灱椤曟盯骞嗛崨娣偓?
  // 闁告瑥鑻崵顔界▔閹惧湱甯?- 闁圭虎鍘介弬浣圭▔閹惧湱甯?
  // 闁圭虎鍘介弬渚€鎳濋悜妯婚挬閻?
  // 闁告瑥鑻崵顔碱潰鐏炵偓閿ら柨娑欑閸у﹪宕濋悩鍐差暡闁哄牆顦崇换鍐煥閵堝懏鍊甸柣銊ュ閻℃洟寮撮幓鎺戠厒闂傚啰鍠庨崹顏堟晬鐏炶偐鐭ら梺顐㈩槷閼垫垿鎯冮崟顒傛憙闁哄洦褰冪槐鎴炴叏鐎ｎ偅灏￠柡鈧?
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

  // 闁告瑯浜濋幐閬嶅绩閹冪濡絾鐗楅悺鏇㈠即?
  const handlePlaySingleTrack = (track: Track, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!onPlayNow) {
      console.log('Play single track:', track.title, '(embedded mode - no playback)');
      return;
    }
    markPendingPlayTrack(track);
    console.log('[MusicLibrary] Playing single track:', track.title);
    onPlayNow([track]);
  };

  // 闁告瑯浜濋崸濠囧礉閻樻彃绀嬪Λ锝嗙墬閻℃洟寮撮幓鎺戠厒闂傚啰鍠庨崹?
  const handleAddSingleTrack = (track: Track, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!onAddToQueue) {
      console.log('Add track:', track.title, '(embedded mode - no queue)');
      return;
    }
    console.log('闁?Adding single track:', track.title);
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
        const filteredAudit = collectStableFallbackAuditEntries(
          rawAudit,
          normalizedOwnerUid || undefined
        );
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

  // 濠㈣泛瀚幃濠傤潰鐏炵偓閿ら柛娆愬▕閺侇參鎳ｅ鍐ㄧ
  const handleTrackContextMenu = (track: Track, index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const playTracks = filteredTracks;
    const playStartIndex = playTracks.findIndex((candidate) => candidate.id === track.id);
    const localFilePath = String(track.filePath || track.path || track.originalPath || '').trim();
    const addToPlaylistMenuItem = buildAddToPlaylistMenuItem({
      t,
      track,
      playlists: audioService.getPlaylists(),
      onAddToPlaylist: (playlistId, trackToAdd) => {
        audioService.addTrackToPlaylist(playlistId, trackToAdd);
      },
    });

    const menuItems: ContextMenuItem[] = [
      {
        label: t('pages.music-library.contextMenu.play'),
        icon: '>',
        onClick: () => handlePlaySingleTrack(track),
      },
      {
        label: t('pages.music-library.contextMenu.addToQueue'),
        icon: '+',
        onClick: () => handleAddSingleTrack(track),
      },
      {
        label: t('pages.music-library.contextMenu.playAllFromHere'),
        icon: '>>',
        onClick: () => onPlayNow?.(playTracks, playStartIndex >= 0 ? playStartIndex : index),
      },
      addToPlaylistMenuItem,
      { divider: true },
      {
        label: t('pages.music-library.contextMenu.openInFileManager'),
        icon: '📂',
        onClick: () => {
          if (!localFilePath) return;
          void musicLibraryService.openInFileManager(localFilePath).then((opened) => {
            if (!opened) {
              setErrorMessage(t('pages.music-library.contextMenu.openInFileManagerFailed'));
            }
          });
        },
        disabled: !localFilePath,
      },
      { divider: true },
      {
        label: t('pages.music-library.contextMenu.viewAlbum'),
        icon: 'A',
        onClick: () => {
          if (!track.album) return;
          handleApplyQuickBaseFilter('album', track.album);
        },
        disabled: !track.album,
      },
      {
        label: t('pages.music-library.contextMenu.viewArtist'),
        icon: 'R',
        onClick: () => {
          if (!track.artist) return;
          handleApplyQuickBaseFilter('artist', track.artist);
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

  // 濠㈣泛瀚幃濠冪▔閹惧湱甯嗛柛娆愬▕閺侇參鎳ｅ鍐ㄧ
  // 闁哄秶鍘х槐锟犲礌閺嶃劍鐎ù鐘烘硾閵囧洨浜?
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

  // 闁哄秶鍘х槐锟犲礌閺嶃劍顦ч梻鈧?
  const formatTotalDuration = useCallback(
    (seconds: number): string => {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      if (hours > 0) {
        return t('pages.music-library.duration.hoursMinutes', { hours, minutes });
      }
      return t('pages.music-library.duration.minutes', { minutes });
    },
    [t]
  );

  // 闁哄秶鍘х槐锟犲礌閺嶎剙缂撻梺顒佹尰濡炲倿姊?
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
      const resolveBitrateKbps = (): number | null => {
        if (typeof track.bitrate === 'number' && Number.isFinite(track.bitrate) && track.bitrate > 0) {
          return track.bitrate >= 2000 ? track.bitrate / 1000 : track.bitrate;
        }

        if (
          typeof track.fileSize === 'number' &&
          Number.isFinite(track.fileSize) &&
          track.fileSize > 0 &&
          typeof track.duration === 'number' &&
          Number.isFinite(track.duration) &&
          track.duration > 0
        ) {
          const estimated = (track.fileSize * 8) / track.duration / 1000;
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
          const bitrate = resolveBitrateKbps();
          return typeof bitrate === 'number' && Number.isFinite(bitrate)
            ? `${Math.max(0, Math.round(bitrate))} kbps`
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

  const footerStatItems = useMemo<MusicLibraryFooterStatItem[]>(() => {
    if (!isOpen) return [];

    if (librarySourceMode === 'stable') {
      return [
        {
          value: String(stableLibraryStats.totalEntries),
          unit: t('pages.music-library.stable.stats.entries'),
        },
        {
          value: String(stableLibraryStats.localReady),
          unit: t('pages.music-library.stable.stats.localReady'),
        },
        {
          value: String(stableLibraryStats.inCloud),
          unit: t('pages.music-library.stable.stats.inCloud'),
        },
        {
          value: String(stableLibraryStats.missing),
          unit: t('pages.music-library.stable.stats.missing'),
        },
      ];
    }

    return [
      {
        value: String(libraryStats.totalTracks),
        unit: t('pages.music-library.stats.tracksUnit'),
      },
      {
        value: String(libraryStats.totalArtists),
        unit: t('pages.music-library.stats.artistsUnit'),
      },
      {
        value: String(libraryStats.totalAlbums),
        unit: t('pages.music-library.stats.albumsUnit'),
      },
      {
        value: formatFileSize(libraryStats.totalSize),
      },
      {
        value: formatTotalDuration(libraryStats.totalDuration),
      },
    ];
  }, [
    formatFileSize,
    formatTotalDuration,
    isOpen,
    librarySourceMode,
    libraryStats.totalAlbums,
    libraryStats.totalArtists,
    libraryStats.totalSize,
    libraryStats.totalDuration,
    libraryStats.totalTracks,
    stableLibraryStats.inCloud,
    stableLibraryStats.localReady,
    stableLibraryStats.missing,
    stableLibraryStats.totalEntries,
    t,
  ]);

  useEffect(() => {
    const detail: MusicLibraryStatsChangeDetail = {
      mode: librarySourceMode,
      items: footerStatItems,
    };

    window.dispatchEvent(
      new CustomEvent<MusicLibraryStatsChangeDetail>(MUSIC_LIBRARY_STATS_CHANGE_EVENT, {
        detail,
      })
    );
  }, [footerStatItems, librarySourceMode]);

  useEffect(
    () => () => {
      window.dispatchEvent(
        new CustomEvent<MusicLibraryStatsChangeDetail>(MUSIC_LIBRARY_STATS_CHANGE_EVENT, {
          detail: {
            mode: 'local',
            items: [],
          },
        })
      );
    },
    []
  );

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

      <div
        className="music-library-toolbar-region"
        ref={librarySourceMode === 'local' ? baseToolbarRegionRef : undefined}
      >
        <div className="music-library-toolbar">
          <div className="music-library-actions">
            {librarySourceMode === 'local' ? (
              <div className="music-library-base-toolbar-left">
                <div className="music-library-base-view-switch" role="group" aria-label="视图模式">
                  <button
                    className={`music-library-base-view-btn ${baseView === 'table' ? 'active' : ''}`}
                    onClick={() => setBaseView('table')}
                  >
                    表格
                  </button>
                  <button
                    className={`music-library-base-view-btn ${baseView === 'card' ? 'active' : ''}`}
                    onClick={() => setBaseView('card')}
                  >
                    卡片
                  </button>
                </div>
                <span className="music-library-base-results">共 {filteredTracksTotal} 首</span>
              </div>
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
            <div className="music-library-base-toolbar-actions">
              <button
                className={`music-library-btn ${showBaseSortPanel ? 'is-active' : ''}`}
                onClick={() => toggleBaseControlPanel('sort')}
              >
                排序
              </button>
              <button
                className={`music-library-btn ${showBaseFilterPanel ? 'is-active' : ''}`}
                onClick={() => toggleBaseControlPanel('filter')}
              >
                筛选
              </button>
              <button
                className={`music-library-btn ${showColumnSettings ? 'is-active' : ''}`}
                onClick={() => toggleBaseControlPanel('properties')}
              >
                属性
              </button>
            </div>
          )}
        </div>

        {librarySourceMode === 'local' &&
          (showBaseSortPanel || showBaseFilterPanel || showColumnSettings) && (
            <div className="music-library-base-popover-region">
              {showBaseSortPanel && (
                <div className="music-library-base-popover-panel" role="dialog" aria-label="排序面板">
                  <div className="music-library-base-popover-section">
                    <div className="music-library-base-popover-title">Group by</div>
                    {baseGroupByRules.length === 0 ? (
                      <div className="music-library-base-popover-note">未设置分组</div>
                    ) : (
                      <div className="music-library-base-rule-list">
                        {baseGroupByRules.map((rule, index) => (
                          <div className="music-library-base-popover-row" key={rule.id}>
                            <select
                              className="music-library-sort-select"
                              value={rule.field}
                              onChange={(event) =>
                                updateBaseGroupByRule(rule.id, {
                                  field: event.target.value as MusicLibraryBaseGroupRule['field'],
                                })
                              }
                            >
                              {MUSIC_LIBRARY_BASE_ORDER_RULE_FIELDS.map((field) => (
                                <option key={field} value={field}>
                                  {MUSIC_LIBRARY_BASE_FIELD_LABEL_MAP[field]}
                                </option>
                              ))}
                            </select>
                            <select
                              className="music-library-sort-select"
                              value={rule.order}
                              onChange={(event) =>
                                updateBaseGroupByRule(rule.id, {
                                  order: event.target.value as MusicLibraryBaseGroupRule['order'],
                                })
                              }
                            >
                              <option value="asc">A → Z</option>
                              <option value="desc">Z → A</option>
                            </select>
                            <button
                              className="music-library-base-popover-icon-btn"
                              title="上移"
                              onClick={() => moveBaseGroupByRule(rule.id, -1)}
                              disabled={index === 0}
                            >
                              ↑
                            </button>
                            <button
                              className="music-library-base-popover-icon-btn"
                              title="下移"
                              onClick={() => moveBaseGroupByRule(rule.id, 1)}
                              disabled={index === baseGroupByRules.length - 1}
                            >
                              ↓
                            </button>
                            <button
                              className="music-library-base-popover-icon-btn"
                              title="移除分组"
                              onClick={() => removeBaseGroupByRule(rule.id)}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button className="music-library-btn" onClick={addBaseGroupByRule}>
                      + 添加分组
                    </button>
                  </div>
                  <div className="music-library-base-popover-section">
                    <div className="music-library-base-popover-title">Sort by</div>
                    {baseSortRules.length === 0 ? (
                      <div className="music-library-base-popover-note">未设置排序</div>
                    ) : (
                      <div className="music-library-base-rule-list">
                        {baseSortRules.map((rule, index) => (
                          <div className="music-library-base-popover-row" key={rule.id}>
                            <select
                              className="music-library-sort-select"
                              value={rule.field}
                              onChange={(event) =>
                                updateBaseSortRule(rule.id, {
                                  field: event.target.value as MusicLibraryBaseSortRule['field'],
                                })
                              }
                            >
                              {MUSIC_LIBRARY_BASE_ORDER_RULE_FIELDS.map((field) => (
                                <option key={field} value={field}>
                                  {MUSIC_LIBRARY_BASE_FIELD_LABEL_MAP[field]}
                                </option>
                              ))}
                            </select>
                            <select
                              className="music-library-sort-select"
                              value={rule.order}
                              onChange={(event) =>
                                updateBaseSortRule(rule.id, {
                                  order: event.target.value as MusicLibraryBaseSortRule['order'],
                                })
                              }
                            >
                              <option value="asc">A → Z</option>
                              <option value="desc">Z → A</option>
                            </select>
                            <button
                              className="music-library-base-popover-icon-btn"
                              title="上移"
                              onClick={() => moveBaseSortRule(rule.id, -1)}
                              disabled={index === 0}
                            >
                              ↑
                            </button>
                            <button
                              className="music-library-base-popover-icon-btn"
                              title="下移"
                              onClick={() => moveBaseSortRule(rule.id, 1)}
                              disabled={index === baseSortRules.length - 1}
                            >
                              ↓
                            </button>
                            <button
                              className="music-library-base-popover-icon-btn"
                              title="移除排序"
                              onClick={() => removeBaseSortRule(rule.id)}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button className="music-library-btn" onClick={addBaseSortRule}>
                      + 添加排序
                    </button>
                  </div>
                </div>
              )}

              {showBaseFilterPanel && (
                <div className="music-library-base-popover-panel" role="dialog" aria-label="筛选面板">
                  <div className="music-library-base-popover-section">
                    <div className="music-library-base-popover-title">筛选规则组</div>
                    <div className="music-library-base-filter-editor">
                      <select
                        className="music-library-sort-select"
                        value={baseFilterJoinOperator}
                        onChange={(event) =>
                          setBaseFilterJoinOperator(
                            event.target.value as MusicLibraryBaseLogicalOperator
                          )
                        }
                      >
                        <option value="and">组之间 AND</option>
                        <option value="or">组之间 OR</option>
                      </select>
                      <select
                        className="music-library-sort-select"
                        value={activeBaseFilterGroupId ?? ''}
                        onChange={(event) =>
                          setActiveBaseFilterGroupId(event.target.value || null)
                        }
                      >
                        <option value="">选择分组</option>
                        {baseFilterGroups.map((group, index) => (
                          <option key={group.id} value={group.id}>
                            规则组 {index + 1}
                          </option>
                        ))}
                      </select>
                      <button className="music-library-btn" onClick={handleAddBaseFilterGroup}>
                        + 分组
                      </button>
                    </div>

                    <div className="music-library-base-filter-editor">
                      <select
                        className="music-library-sort-select"
                        value={baseFilterField}
                        onChange={(event) =>
                          setBaseFilterField(event.target.value as MusicLibraryBaseField)
                        }
                      >
                        {MUSIC_LIBRARY_BASE_FILTER_FIELDS.map((field) => (
                          <option key={field} value={field}>
                            {MUSIC_LIBRARY_BASE_FIELD_LABEL_MAP[field]}
                          </option>
                        ))}
                      </select>
                      <select
                        className="music-library-sort-select"
                        value={baseFilterRuleOperator}
                        onChange={(event) =>
                          setBaseFilterRuleOperator(event.target.value as MusicLibraryBaseOperator)
                        }
                      >
                        {MUSIC_LIBRARY_BASE_OPERATORS.map((operator) => (
                          <option key={operator} value={operator}>
                            {MUSIC_LIBRARY_BASE_OPERATOR_LABEL_MAP[operator]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={baseFilterValue}
                        onChange={(event) => setBaseFilterValue(event.target.value)}
                        placeholder="值"
                        className="music-library-base-filter-input"
                      />
                      <button className="music-library-btn" onClick={handleAddBaseFilter}>
                        添加筛选
                      </button>
                      <button
                        className="music-library-btn"
                        onClick={handleClearBaseFilters}
                        disabled={baseFilterGroups.length === 0}
                      >
                        清空筛选
                      </button>
                    </div>
                  </div>

                  {baseFilterGroups.length > 0 && (
                    <div className="music-library-base-filter-groups">
                      {baseFilterGroups.map((group, index) => (
                        <div className="music-library-base-filter-group" key={group.id}>
                          <div className="music-library-base-filter-group-header">
                            <strong>规则组 {index + 1}</strong>
                            <select
                              className="music-library-sort-select"
                              value={group.operator}
                              onChange={(event) =>
                                handleUpdateBaseFilterGroupOperator(
                                  group.id,
                                  event.target.value as MusicLibraryBaseLogicalOperator
                                )
                              }
                            >
                              <option value="and">组内 AND</option>
                              <option value="or">组内 OR</option>
                            </select>
                            <button
                              className="music-library-base-popover-icon-btn"
                              title="移除分组"
                              onClick={() => handleRemoveBaseFilterGroup(group.id)}
                            >
                              ✕
                            </button>
                          </div>
                          {group.filters.length > 0 ? (
                            <div className="music-library-base-filter-chips">
                              {group.filters.map((filter) => {
                                const valueText = filter.value?.trim() ? ` ${filter.value}` : '';
                                return (
                                  <button
                                    key={filter.id}
                                    className="music-library-base-filter-chip"
                                    onClick={() => handleRemoveBaseFilter(group.id, filter.id)}
                                    title="移除筛选"
                                  >
                                    {MUSIC_LIBRARY_BASE_FIELD_LABEL_MAP[filter.field]}{' '}
                                    {MUSIC_LIBRARY_BASE_OPERATOR_LABEL_MAP[filter.operator]}
                                    {valueText} ×
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="music-library-base-popover-note">该分组暂无条件</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {showColumnSettings && (
                <div
                  className="music-library-base-popover-panel music-library-base-properties-popover"
                  role="dialog"
                  aria-label="属性面板"
                >
                  <div className="music-library-base-property-search">
                    <input
                      type="text"
                      value={propertySearchQuery}
                      onChange={(event) => setPropertySearchQuery(event.target.value)}
                      placeholder="查找属性..."
                    />
                  </div>
                  <div className="music-library-column-list music-library-base-property-list">
                    {filteredPropertyColumns.length === 0 ? (
                      <div className="music-library-modal-empty">未找到匹配属性</div>
                    ) : (
                      filteredPropertyColumns.map((column) => {
                        const columnIndex = localTrackColumnSettings.findIndex(
                          (item) => item.id === column.id
                        );

                        return (
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
                                disabled={columnIndex <= 0}
                                title={t('pages.music-library.columns.action.moveUp')}
                                onClick={() => moveLocalTrackColumn(column.id, -1)}
                              >
                                ↑
                              </button>
                              <button
                                className="music-library-column-move"
                                disabled={columnIndex === localTrackColumnSettings.length - 1}
                                title={t('pages.music-library.columns.action.moveDown')}
                                onClick={() => moveLocalTrackColumn(column.id, 1)}
                              >
                                ↓
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="music-library-base-property-footer">
                    <button className="music-library-btn" onClick={resetLocalTrackColumns}>
                      重置属性
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
      </div>

      {librarySourceMode === 'local' && (
        <div className="music-library-local-ops">
          <button
            className="music-library-btn"
            onClick={() => setShowPathsManager(true)}
            title={t('pages.music-library.paths.manageTitle')}
          >
            <span>{t('pages.music-library.paths.button', { count: libraryPaths.length })}</span>
          </button>
          <button
            className="music-library-btn"
            onClick={() => setShowClearConfirm(true)}
            disabled={libraryStats.totalTracks === 0}
          >
            {t('common.action.clear')}
          </button>
        </div>
      )}

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
                <div className="music-library-empty-icon">⏳</div>
                <div className="music-library-empty-text">{t('pages.music-library.stable.loading')}</div>
              </div>
            ) : sortedStableEntries.length === 0 ? (
              <div className="music-library-empty">
                <div className="music-library-empty-icon">☁️</div>
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
          <div className="music-library-main music-library-main-local" ref={mainScrollRef}>
            {libraryStats.totalTracks === 0 ? (
              <div className="music-library-empty">
                <div className="music-library-empty-icon">🎵</div>
                <div className="music-library-empty-text">{t('pages.music-library.empty.title')}</div>
                <button className="music-library-btn" onClick={handleScanFolder}>
                  {t('pages.music-library.empty.scanButton')}
                </button>
              </div>
            ) : (
              <>

              {baseView === 'card' && (
                <div className="music-library-card-list">
                  {renderedTracks.map((track, index) => {
                    const isPlayPending =
                      pendingPlayTrackIdentity !== null &&
                      resolveTrackIdentity(track) === pendingPlayTrackIdentity;
                    const normalizedArtist = String(track.artist || '').trim();
                    const normalizedAlbum = String(track.album || '').trim();
                    const subtitle = normalizedAlbum
                      ? `${normalizedArtist || t('common.unknown.artist')} · ${normalizedAlbum}`
                      : normalizedArtist || t('common.unknown.artist');

                    return (
                      <LocalTrackCard
                        key={`card-${track.id}`}
                        track={track}
                        index={index}
                        isPlayPending={isPlayPending}
                        subtitle={subtitle}
                        onTrackDoubleClick={handleTrackDoubleClick}
                        onTrackContextMenu={handleTrackContextMenu}
                        onPlaySingleTrack={onPlayNow ? handlePlaySingleTrack : undefined}
                        onAddSingleTrack={onAddToQueue ? handleAddSingleTrack : undefined}
                        playButtonTitle={t('pages.music-library.tracks.action.playOneTitle')}
                        addButtonTitle={t('pages.music-library.tracks.action.addOneTitle')}
                      />
                    );
                  })}
                </div>
              )}
                <div
                  className={`music-library-list${resizingLocalTrackColumnId ? ' is-resizing-columns' : ''}${baseView === 'card' ? ' is-hidden' : ''}`}
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
                        <div
                          className="music-library-list-header-cell music-library-list-header-actions"
                          aria-hidden="true"
                        />
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
                        const alignClass = LEFT_ALIGNED_LOCAL_TRACK_COLUMNS.has(column.id)
                          ? 'music-library-track-cell-left'
                          : 'music-library-track-cell-right';
                        return (
                          <div
                            key={`${track.id}-${column.id}`}
                            className={`${className} ${alignClass}`}
                            title={value}
                          >
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
                  {showTrackLoadHint && (
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
                  {isNativeBaseTracksLoading && (
                    <div className="music-library-track-load-hint" role="status" aria-live="polite">
                      {t('pages.music-library.loading.tracksChunk')}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

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

      {/* 婵炴挸鎳愰埞鏍兜椤旀鍚囬悗鐢殿攰閻﹁棄顩?*/}
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

      {/* 閹煎瓨鎹侀惌鎯ь嚗閸曨収鍚€闁荤偛妫楀▍?*/}
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
                          {path.isScanned ? '停止' : '启用'}
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

      {/* 闂佹寧鐟ㄩ銈夊箵閹邦喓浠涢悗鐢殿攰閻﹁棄顩?*/}
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

  // 鐎规挸鑻崣鍡椢熼垾宕囩闁烩晛鐡ㄧ敮瀛樻交閺傛寧绀€闁告劕鎳庨鎰版晬瀹€鍕鐎规挸鑻崣鍡椢熼垾宕囩濞达綀娉曢弫顥秓rtal
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


