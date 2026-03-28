import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

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
import { useSkinSurfaceModel } from '../../themes/skinSurface';
import {
  buildThemePresenceAnimationStyle,
  getThemeMotionTotalMs,
  pickThemeMotionChannel,
  useThemePresenceState,
} from '../../themes/surfaceMotion';

import { useAudioService } from '../../contexts/AudioEngineContext';
import {
  getProcessPerfTotalsSnapshot,
  type ProcessPerfTotalsSnapshot,
} from '../../modules/debug';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { captureTelemetryScenarioSnapshot } from '../../services/telemetry/scenarioSnapshots';

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
  cancelScheduledProcessWorkingSetTrim,
  scheduleProcessWorkingSetTrim,
} from '../../utils/processWorkingSetTrim';

import {

  applyMusicLibraryBaseQuery,
  MUSIC_LIBRARY_BASE_FILTER_GROUP_LIMIT,

  type MusicLibraryBaseField,

  type MusicLibraryBaseFilterGroup,

  type MusicLibraryBaseGroupRule,

  type MusicLibraryBaseLogicalOperator,

  type MusicLibraryBaseOrderField,

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

  toggleMusicLibraryBaseSortField,

  updateMusicLibraryBaseFilterGroupOperator,

  updateMusicLibraryBaseGroupByRule,

  updateMusicLibraryBaseSortRule,

} from '../../modules/music-library/baseState';

import {

  MUSIC_LIBRARY_BASE_OPERATORS,

  MUSIC_LIBRARY_BASE_OPERATOR_LABEL_MAP,

} from '../../modules/music-library/baseMeta';

import {

  registerMusicLibraryDiscoveredFieldCapabilitiesFromTracks,

} from '../../modules/music-library/fieldDiscovery';

import {

  listRegisteredMusicLibraryBaseFieldCapabilities,
  getMusicLibraryBaseNativeFilterField,
  getMusicLibraryBaseNativeSortField,

  isMusicLibraryBaseFieldVisibleInBaseUi,

  listMusicLibraryBaseFilterFieldIds,

  listMusicLibraryBaseGroupFieldIds,

  listMusicLibraryBaseOrderFieldIds,

  registerMusicLibraryBaseFieldCapabilities,

  resolveMusicLibraryBaseFieldHeaderKey,

  resolveMusicLibraryBaseFieldLabel,

  subscribeMusicLibraryBaseFieldCapabilities,

} from '../../modules/music-library/fieldCapabilities';

import {

  resolveMusicLibraryFieldFacetDescriptor,

  subscribeMusicLibraryFacetCollectionDescriptors,

} from '../../modules/music-library/facetDescriptors';

import {

  loadMusicLibraryBaseFieldCapabilities,

  loadMusicLibraryBaseState,

  persistMusicLibraryBaseFieldCapabilities,

  persistMusicLibraryBaseState,

} from '../../modules/music-library/basePersistence';

import {

  applyBaseViewPropertiesToLocalTrackColumns,

  cloneDefaultLocalTrackColumnSettings,

  LEFT_ALIGNED_LOCAL_TRACK_COLUMNS,

  LOCAL_TRACK_COLUMN_DEFINITIONS,

  normalizeLocalTrackColumnSettings,

  normalizeLocalTrackColumnWidth,

  resolveMusicLibraryBaseFieldFromLocalTrackColumn,

  type LocalTrackColumnConfig,

  type LocalTrackColumnId,

} from '../../modules/music-library/localTrackColumns';

import { deriveLocalTrackLayoutModel } from '../../modules/music-library/localTrackLayout';

import {

  formatMusicLibraryFieldValue,

  formatMusicLibraryFileSize,

  formatMusicLibraryTimestamp,

} from '../../modules/music-library/fieldValue';

import {

  buildMusicLibraryGroupedRows,

  sliceMusicLibraryGroupedRows,

  type MusicLibraryGroupedRow,

  type MusicLibraryTrackRow,

} from '../../modules/music-library/groupedRows';

import {

  buildMusicLibraryCardVirtualLayout,
  MUSIC_LIBRARY_CARD_BLOCK_GAP_PX,
  MUSIC_LIBRARY_CARD_TRACK_ROW_HEIGHT_PX,
  MUSIC_LIBRARY_CARD_GROUP_INDENT_MARGIN_PX,
  MUSIC_LIBRARY_CARD_GROUP_INDENT_PADDING_PX,
  resolveMusicLibraryCardGridColumns,
  sliceMusicLibraryCardVirtualLayout,
} from '../../modules/music-library/cardVirtualWindow';
import {
  growMusicLibraryRenderedTrackLimit,
  shouldDeferMusicLibraryTrackChunkLoad,
  sliceMusicLibraryRenderedTracks,
} from '../../modules/music-library/renderWindow';
import {
  buildNativeBaseWindowRequest,
  clampNativeBaseWindowRequestToTotal,
  nativeBaseTrackWindowCoversRequest,
} from '../../modules/music-library/nativeBaseWindow';


import {

  buildStableFallbackAuditSnapshot,

  buildTagsJsonFromText,

  collectStableFallbackAuditEntries,

  deriveStableLibraryStats,

  parseTagsJsonAsText,

  type StableFallbackAuditSnapshot,

} from '../../modules/music-library/stableLibraryModel';

import { useCoverUrlForTrack } from '../magnet/shared/useCoverUrlForTrack';

import { buildLibraryTrackContextMenu } from '../magnet/trackContextMenu';

import { useBaseControlPanels } from './useBaseControlPanels';
import { PmpButton, PmpDialog } from '../primitives';

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



function getSelectableRuleFields<TField extends MusicLibraryBaseField>(

  ruleId: string,

  currentField: TField,

  rules: Array<{ id: string; field: TField }>,

  candidateFields: readonly TField[]

): TField[] {

  const usedFields = new Set(

    rules.filter((rule) => rule.id !== ruleId).map((rule) => rule.field)

  );

  return candidateFields.filter((field) => field === currentField || !usedFields.has(field));

}



function getSelectableSortRuleFields(

  ruleId: string,

  currentField: MusicLibraryBaseOrderField,

  sortRules: MusicLibraryBaseSortRule[],

  groupRules: MusicLibraryBaseGroupRule[]

): MusicLibraryBaseOrderField[] {

  const groupedFields = new Set(groupRules.map((rule) => rule.field));

  const candidateFields = listMusicLibraryBaseOrderFieldIds().filter(

    (field) => field === currentField || !groupedFields.has(field)

  ) as MusicLibraryBaseOrderField[];

  return getSelectableRuleFields(ruleId, currentField, sortRules, candidateFields);

}



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

const INITIAL_TRACK_LOAD_LIMIT = 120;

const TRACK_LOAD_CHUNK_SIZE = 72;

const TRACK_RENDER_CHUNK_SIZE = 48;

const TRACK_SCROLL_LOAD_TRIGGER_PX = 320;

const MODULE_CACHE_TRACK_CAP = 120;

const SEARCH_DEBOUNCE_MS = 180;

const TRACK_ROW_HEIGHT_PX = 46;

const TRACK_LIST_HEADER_HEIGHT_PX = 52;

const TRACK_WINDOW_OVERSCAN_ROWS = 8;

const NATIVE_BASE_PAGE_SIZE = 120;
const NATIVE_BASE_WINDOW_MIN_PAGES = 2;

const CARD_COVER_VISIBILITY_ROOT_MARGIN = '48px';

const MUSIC_LIBRARY_MAIN_HORIZONTAL_PADDING_PX = 40;

const MUSIC_LIBRARY_MEMORY_LOG_DEBOUNCE_MS = 900;

const MUSIC_LIBRARY_PROCESS_PERF_REFRESH_MS = 1_500;

const EMPTY_LIBRARY_STATS: LibraryStats = {
  totalTracks: 0,
  totalArtists: 0,
  totalAlbums: 0,
  totalSize: 0,
  totalDuration: 0,
};

const EMPTY_MAIN_VIEWPORT: MainViewportSnapshot = {
  scrollTop: 0,
  clientHeight: 0,
  clientWidth: 0,
};

type MusicLibraryRuntimeDiagnosticSnapshot = {
  timestampMs: number;
  sourceMode: MusicLibrarySourceMode;
  baseView: MusicLibraryBaseView;
  searchQuery: string;
  shouldUseNativeBaseQuery: boolean;
  coverPolicy: CoverRuntimeCachePolicy;
  counts: {
    tracks: number;
    nativeBaseTracks: number;
    filteredTracks: number;
    renderedTracks: number;
    groupedRows: number;
  };
  estimatedBytes: {
    tracks: number | null;
    nativeBaseTracks: number | null;
  };
  attribution: {
    trackArrayBytes: number;
    trackedRuntimeBytes: number;
    webview2PrivateResidualBytes: number | null;
    webview2PrivateMinusTrackArraysBytes: number | null;
  };
  process: {
    timestampMs: number | null;
    webview2PrivateBytes: number | null;
    webview2WorkingSetBytes: number | null;
    treePrivateBytes: number | null;
    treeWorkingSetBytes: number | null;
    webview2CpuPercent: number | null;
  };
  coverCache: ReturnType<typeof musicLibraryService.getCoverRuntimeCacheStats>;
  jsHeap: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  } | null;
};

type VisibilityListener = (isVisible: boolean) => void;

type SharedVisibilityObserverEntry = {
  observer: IntersectionObserver;
  listeners: Map<Element, Set<VisibilityListener>>;
};

const sharedVisibilityObservers = new Map<string, SharedVisibilityObserverEntry>();

function clearSharedVisibilityObservers(): void {
  for (const entry of sharedVisibilityObservers.values()) {
    entry.observer.disconnect();
    entry.listeners.clear();
  }
  sharedVisibilityObservers.clear();
}

declare global {
  interface Window {
    __PMP_MUSIC_LIBRARY_GET_SNAPSHOT__?: () => MusicLibraryRuntimeDiagnosticSnapshot;
    __PMP_LAST_MUSIC_LIBRARY_SNAPSHOT__?: MusicLibraryRuntimeDiagnosticSnapshot;
  }
}



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

function hasActiveMusicLibraryBaseQuery(query: MusicLibraryBaseQuery): boolean {
  return (
    query.filterGroups.some((group) => group.filters.length > 0) ||
    query.groupByRules.length > 0 ||
    query.sortRules.length > 0
  );
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



function estimateMusicLibraryTrackArrayBytes(
  tracks: Track[] | null | undefined,
  sampleLimit: number = 24
): number | null {

  if (!Array.isArray(tracks)) return null;

  if (tracks.length === 0) return 0;



  const boundedSampleLimit = Math.max(1, Math.min(sampleLimit, tracks.length));

  try {

    const sampleJson = JSON.stringify(tracks.slice(0, boundedSampleLimit));

    if (!sampleJson) return null;

    const sampleBytes = new TextEncoder().encode(sampleJson).length;

    return Math.round((sampleBytes / boundedSampleLimit) * tracks.length);

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



function getSharedVisibilityObserver(rootMargin: string): SharedVisibilityObserverEntry | null {

  if (typeof IntersectionObserver === 'undefined') return null;



  const existing = sharedVisibilityObservers.get(rootMargin);

  if (existing) return existing;



  const listeners = new Map<Element, Set<VisibilityListener>>();

  const observer = new IntersectionObserver(

    (entries) => {

      for (const entry of entries) {

        const targetListeners = listeners.get(entry.target);

        if (!targetListeners) continue;

        for (const listener of targetListeners) {

          listener(Boolean(entry.isIntersecting));

        }

      }

    },

    { rootMargin }

  );



  const nextEntry = { observer, listeners };

  sharedVisibilityObservers.set(rootMargin, nextEntry);

  return nextEntry;

}



function useElementVisibility<T extends HTMLElement>(rootMargin: string): [React.RefObject<T>, boolean] {

  const elementRef = useRef<T | null>(null);

  const [isVisible, setIsVisible] = useState(() => typeof IntersectionObserver === 'undefined');



  useEffect(() => {

    const element = elementRef.current;

    if (!element) return;



    if (typeof IntersectionObserver === 'undefined') {

      setIsVisible(true);

      return;

    }



    const observerEntry = getSharedVisibilityObserver(rootMargin);

    if (!observerEntry) {

      setIsVisible(true);

      return;

    }



    const listener: VisibilityListener = (nextVisible) => {

      setIsVisible((previous) => (previous === nextVisible ? previous : nextVisible));

    };



    let targetListeners = observerEntry.listeners.get(element);

    if (!targetListeners) {

      targetListeners = new Set<VisibilityListener>();

      observerEntry.listeners.set(element, targetListeners);

      observerEntry.observer.observe(element);

    }

    targetListeners.add(listener);



    return () => {

      const currentTargetListeners = observerEntry.listeners.get(element);

      if (!currentTargetListeners) return;



      currentTargetListeners.delete(listener);

      if (currentTargetListeners.size > 0) return;



      observerEntry.listeners.delete(element);

      observerEntry.observer.unobserve(element);



      if (observerEntry.listeners.size === 0) {

        observerEntry.observer.disconnect();

        sharedVisibilityObservers.delete(rootMargin);

      }

    };

  }, [rootMargin]);



  return [elementRef, isVisible];

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

  const [cardRef, isCardVisible] = useElementVisibility<HTMLDivElement>(

    CARD_COVER_VISIBILITY_ROOT_MARGIN

  );
  const coverImageRef = useRef<HTMLImageElement | null>(null);
  const bindCoverImageRef = useCallback((element: HTMLImageElement | null) => {

    const previous = coverImageRef.current;

    if (previous && previous !== element) {

      previous.removeAttribute('src');

      previous.removeAttribute('srcset');

    }

    coverImageRef.current = element;

  }, []);

  const coverUrl = useCoverUrlForTrack(isCardVisible ? track : null, {

    coverSizeHint: 'small',

    bypassRuntimePolicy: false,

  });

  const [coverLoadFailed, setCoverLoadFailed] = useState(false);



  useEffect(() => {

    setCoverLoadFailed(false);

  }, [coverUrl, track.id]);



  const normalizedCoverUrl = typeof coverUrl === 'string' ? coverUrl.trim() : '';

  const displayCoverUrl = !coverLoadFailed && normalizedCoverUrl.length > 0 ? normalizedCoverUrl : undefined;
  const coverFetchPriorityProps = { fetchpriority: 'low' } as Record<string, string>;

  useEffect(() => {

    const image = coverImageRef.current;

    if (!image) return;

    if (isCardVisible && displayCoverUrl) return;

    image.removeAttribute('src');

    image.removeAttribute('srcset');

  }, [displayCoverUrl, isCardVisible]);

  const fallbackCoverGlyph =

    typeof track.title === 'string' && track.title.trim().length > 0

      ? track.title.trim().slice(0, 1).toUpperCase()

      : '♪';



  return (

    <div

      ref={cardRef}

      data-track-id={track.id}

      className={`music-library-track-card${isPlayPending ? ' is-play-pending' : ''}`}

      onDoubleClick={() => onTrackDoubleClick(track, index)}

      onContextMenu={(event) => onTrackContextMenu(track, index, event)}

    >

      <div className="music-library-track-card-cover" aria-hidden="true">

        {displayCoverUrl ? (

          <img

            ref={bindCoverImageRef}

            src={displayCoverUrl}

            alt={track.title || subtitle}

            loading="lazy"

            decoding="async"

            {...coverFetchPriorityProps}

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
  const telemetry = useMemo(() => getTelemetryLogger('music-library', 'MusicLibraryPage'), []);

  const t = useT();

  const locale = useLocale();

  const [librarySourceMode, setLibrarySourceMode] = useState<MusicLibrarySourceMode>('local');

  const viewMode: MusicLibraryViewMode = 'all';

  const [searchQuery, setSearchQuery] = useState('');

  const [nativeBaseSearchQuery, setNativeBaseSearchQuery] = useState('');

  const [tracks, setTracks] = useState<Track[]>([]);

  const [libraryStats, setLibraryStats] = useState<LibraryStats>({

    totalTracks: 0,

    totalArtists: 0,

    totalAlbums: 0,

    totalSize: 0,

    totalDuration: 0,

  });

  const [isLibraryStatsLoaded, setIsLibraryStatsLoaded] = useState(false);

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

  const [localTrackFooterScrollWidth, setLocalTrackFooterScrollWidth] = useState(0);

  const [pendingPlayTrackIdentity, setPendingPlayTrackIdentity] = useState<string | null>(null);

  const [draggingLocalTrackColumnId, setDraggingLocalTrackColumnId] =

    useState<LocalTrackColumnId | null>(null);

  const [dragOverLocalTrackColumnId, setDragOverLocalTrackColumnId] =

    useState<LocalTrackColumnId | null>(null);

  const [isLocalTrackColumnReordering, setIsLocalTrackColumnReordering] = useState(false);

  const [resizingLocalTrackColumnId, setResizingLocalTrackColumnId] =

    useState<LocalTrackColumnId | null>(null);

  const [hasMoreTracks, setHasMoreTracks] = useState(false);

  const hasMoreTracksRef = useRef(false);

  const [isTrackChunkLoading, setIsTrackChunkLoading] = useState(false);

  const [renderedTrackLimit, setRenderedTrackLimit] = useState(TRACK_RENDER_CHUNK_SIZE);
  const renderedTrackLimitRef = useRef(TRACK_RENDER_CHUNK_SIZE);
  const filteredTrackCountRef = useRef(0);

  const trackNextOffsetRef = useRef(0);

  const trackChunkLoadingRef = useRef(false);

  const searchTokenRef = useRef(0);

  const searchDebounceTimerRef = useRef<number | null>(null);

  const initialViewportAutoloadKeyRef = useRef<string | null>(null);

  const libraryLoadTokenRef = useRef(0);
  const hasRequestedLibraryStatsRef = useRef(false);
  const libraryStatsLoadTokenRef = useRef(0);

  const stableLoadTokenRef = useRef(0);

  const [mainViewport, setMainViewport] = useState<MainViewportSnapshot>({

    scrollTop: 0,

    clientHeight: 0,

    clientWidth: 0,

  });

  const currentCoverPolicyRef = useRef<CoverRuntimeCachePolicy>('default');

  const musicLibraryDiagnosticsTimerRef = useRef<number | null>(null);

  const musicLibraryDiagnosticsSignatureRef = useRef('');

  useEffect(() => {
    telemetry.info(isOpen ? 'music-library.page.enter' : 'music-library.page.leave', {
      fields: {
        embedded,
      },
    });
    captureTelemetryScenarioSnapshot({
      moduleId: 'music-library',
      component: 'MusicLibraryPage',
      event: isOpen ? 'music-library.page.enter.snapshot' : 'music-library.page.leave.snapshot',
      fields: {
        embedded,
      },
      minIntervalMs: 400,
    });
  }, [embedded, isOpen, telemetry]);

  useEffect(() => {
    if (!isOpen) {
      hasRequestedLibraryStatsRef.current = false;
    }
  }, [isOpen]);

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

  const localTrackListFooterScrollRef = useRef<HTMLDivElement | null>(null);

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

  const baseQueryState = useMemo<MusicLibraryBaseQuery>(

    () => ({

      filterOperator: baseFilterJoinOperator,

      filterGroups: baseFilterGroups,

      groupByRules: baseGroupByRules,

      sortRules: baseSortRules,

    }),

    [baseFilterJoinOperator, baseFilterGroups, baseGroupByRules, baseSortRules]

  );

  const hasActiveBaseQuery = useMemo(
    () => hasActiveMusicLibraryBaseQuery(baseQueryState),
    [baseQueryState]
  );

  const shouldUseNativeBaseQuery =
    librarySourceMode === 'local' &&
    isTauriRuntime() &&
    hasActiveBaseQuery;

  const shouldUseWebFallbackBaseQuery =

    librarySourceMode === 'local' &&

    !isTauriRuntime() &&

    hasActiveBaseQuery;

  const shouldUseLegacyModuleCache =

    librarySourceMode === 'local' &&

    !isTauriRuntime();

  const shouldUseNativeBaseWindowedQuery =
    shouldUseNativeBaseQuery &&
    baseGroupByRules.length === 0;

  const [collapsedTrackGroupKeys, setCollapsedTrackGroupKeys] = useState<Set<string>>(() => new Set());

  const [baseFilterField, setBaseFilterField] = useState<MusicLibraryBaseField>('artist');

  const [baseFilterRuleOperator, setBaseFilterRuleOperator] =

    useState<MusicLibraryBaseOperator>('contains');

  const [baseFilterValue, setBaseFilterValue] = useState('');

  const [baseFilterFacetValues, setBaseFilterFacetValues] = useState<string[]>([]);

  const [isBaseFilterFacetValuesLoading, setIsBaseFilterFacetValuesLoading] = useState(false);

  const [propertySearchQuery, setPropertySearchQuery] = useState('');

  const [baseFieldRegistryVersion, setBaseFieldRegistryVersion] = useState(0);

  const baseFilterFacetValuesListId = useId();

  const [nativeSchemaEnvelopeStatus, setNativeSchemaEnvelopeStatus] = useState<

    'idle' | 'loading' | 'loaded' | 'failed' | 'unsupported'

  >(() => (isTauriRuntime() ? 'idle' : 'unsupported'));

  const [nativeBaseTracks, setNativeBaseTracks] = useState<Track[] | null>(null);

  const [nativeBaseTrackWindowOffset, setNativeBaseTrackWindowOffset] = useState(0);

  const [nativeBaseTracksTotal, setNativeBaseTracksTotal] = useState<number | null>(null);

  const [hasMoreNativeBaseTracks, setHasMoreNativeBaseTracks] = useState(false);

  const [isNativeBaseTracksLoading, setIsNativeBaseTracksLoading] = useState(false);

  const [musicLibraryProcessPerf, setMusicLibraryProcessPerf] = useState<ProcessPerfTotalsSnapshot | null>(
    null
  );

  const nativeBaseTrackNextOffsetRef = useRef(0);

  const nativeBaseTrackLoadingRef = useRef(false);

  const nativeBaseQueryKeyRef = useRef('');

  const nativeBaseTracksRef = useRef<Track[] | null>(null);

  const nativeBaseTrackWindowOffsetRef = useRef(0);

  const hasMoreNativeBaseTracksRef = useRef(false);



  const [contextMenu, setContextMenu] = useState<{

    x: number;

    y: number;

    items: ContextMenuItem[];

  } | null>(null);

  const releaseLocalLibraryViewState = useCallback(() => {
    trackChunkLoadingRef.current = false;
    trackNextOffsetRef.current = 0;
    hasMoreTracksRef.current = false;
    nativeBaseTrackNextOffsetRef.current = 0;
    nativeBaseTrackLoadingRef.current = false;
    nativeBaseQueryKeyRef.current = '';
    nativeBaseTracksRef.current = null;
    nativeBaseTrackWindowOffsetRef.current = 0;
    hasMoreNativeBaseTracksRef.current = false;
    initialViewportAutoloadKeyRef.current = null;

    setTracks([]);
    setNativeBaseTracks(null);
    setNativeBaseTrackWindowOffset(0);
    setNativeBaseTracksTotal(null);
    setHasMoreNativeBaseTracks(false);
    setIsNativeBaseTracksLoading(false);
    setHasMoreTracks(false);
    setIsTrackChunkLoading(false);
    setRenderedTrackLimit(TRACK_RENDER_CHUNK_SIZE);
    setLibraryStats(EMPTY_LIBRARY_STATS);
    setIsLibraryStatsLoaded(false);
    setLibraryPaths([]);
    setLibraryPathHealthMap({});
    setIsLibraryPathHealthLoading(false);
    setIsLibraryPathHealthAvailable(true);
    setPathCleanupBusyMap({});
    setIsCleanupAllMissingBusy(false);
    setShowPathsManager(false);
    setScanProgress(null);
    setErrorMessage(null);
    setContextMenu(null);
    setCleanupConfirmTarget(null);
    setMainViewport(EMPTY_MAIN_VIEWPORT);
  }, []);

  const resetLoadedTrackPages = useCallback((options?: { clearModuleCache?: boolean }) => {
    if (options?.clearModuleCache) {
      clearModuleCache();
    }
    trackChunkLoadingRef.current = false;
    trackNextOffsetRef.current = 0;
    hasMoreTracksRef.current = false;
    setTracks([]);
    setHasMoreTracks(false);
    setIsTrackChunkLoading(false);
  }, []);

  const resetNativeBaseTrackPages = useCallback(() => {
    nativeBaseTrackNextOffsetRef.current = 0;
    nativeBaseTrackLoadingRef.current = false;
    nativeBaseQueryKeyRef.current = '';
    nativeBaseTracksRef.current = null;
    nativeBaseTrackWindowOffsetRef.current = 0;
    hasMoreNativeBaseTracksRef.current = false;
    setNativeBaseTracks(null);
    setNativeBaseTrackWindowOffset(0);
    setNativeBaseTracksTotal(null);
    setHasMoreNativeBaseTracks(false);
    setIsNativeBaseTracksLoading(false);
  }, []);

  const releaseStableLibraryViewState = useCallback(() => {
    setStableEntries([]);
    setIsStableEntriesLoading(false);
    setShowStableQueuePanel(false);
    setIsStableQueueLoading(false);
    setStableFallbackTasks([]);
    setStableHashJobs([]);
    setStableFallbackAudit(buildStableFallbackAuditSnapshot([]));
    setFallbackTaskStatusPendingId(null);
    setHashJobStatusPendingId(null);
    setEditingStableEntry(null);
    setStableEntryRatingInput('');
    setStableEntryTagsInput('');
    setIsStableMetadataSaving(false);
  }, []);

  const releaseMusicLibraryRuntimeResources = useCallback(
    (options?: { closeDatabase?: boolean; resetSchemaCache?: boolean }) => {
      if (searchDebounceTimerRef.current != null) {
        window.clearTimeout(searchDebounceTimerRef.current);
        searchDebounceTimerRef.current = null;
      }
      if (musicLibraryDiagnosticsTimerRef.current != null) {
        window.clearTimeout(musicLibraryDiagnosticsTimerRef.current);
        musicLibraryDiagnosticsTimerRef.current = null;
      }

      clearModuleCache();
      clearSharedVisibilityObservers();
      currentCoverPolicyRef.current = 'hidden';
      musicLibraryService.applyCoverRuntimeCachePolicy('hidden');
      musicLibraryService.releaseLibraryViewRuntimeMemory({
        closeDatabase: options?.closeDatabase,
        resetSchemaCache: options?.resetSchemaCache,
      });
    },
    []
  );

  const teardownHiddenMusicLibraryView = useCallback(() => {
    libraryLoadTokenRef.current += 1;
    stableLoadTokenRef.current += 1;
    searchTokenRef.current += 1;
    if (isTauriRuntime()) {
      clearModuleCache();
    }
    releaseLocalLibraryViewState();
    releaseStableLibraryViewState();
    releaseMusicLibraryRuntimeResources({
      closeDatabase: true,
      resetSchemaCache: true,
    });
    scheduleProcessWorkingSetTrim('webview2', {
      delaysMs: [0, 500, 1800, 4200],
      reason: 'music-library-hidden',
    });
    const playbackState = audioService.getState().playbackState;
    if (playbackState === 'idle' || playbackState === 'stopped' || playbackState === 'error') {
      scheduleProcessWorkingSetTrim('tree', {
        delaysMs: [0, 900, 2600],
        reason: 'music-library-hidden-idle',
      });
    }
  }, [
    audioService,
    releaseLocalLibraryViewState,
    releaseMusicLibraryRuntimeResources,
    releaseStableLibraryViewState,
  ]);



  const updateCoverRuntimePolicy = useCallback((policy: CoverRuntimeCachePolicy) => {

    if (currentCoverPolicyRef.current === policy) return;

    currentCoverPolicyRef.current = policy;

    musicLibraryService.applyCoverRuntimeCachePolicy(policy);

  }, []);

  const scheduleTrackChunkLoad = useCallback(async (): Promise<boolean> => {

    if (trackChunkLoadingRef.current) return false;

    if (!hasMoreTracksRef.current) return false;

    const offset = trackNextOffsetRef.current;

    if (!Number.isFinite(offset) || offset < 0) return false;

    const token = libraryLoadTokenRef.current;



    trackChunkLoadingRef.current = true;

    setIsTrackChunkLoading(true);

    const releaseProtection = beginAudioProtection('music-library-track-chunk', 18_000);



    try {

      const nextChunk = await musicLibraryService.getAllTracks(TRACK_LOAD_CHUNK_SIZE, offset);

      if (token !== libraryLoadTokenRef.current) {
        return false;
      }

      if (nextChunk.length === 0) {

        hasMoreTracksRef.current = false;

        setHasMoreTracks(false);

        return false;

      }



      const chunkHasMore = nextChunk.length >= TRACK_LOAD_CHUNK_SIZE;



      trackNextOffsetRef.current = offset + nextChunk.length;

      setTracks((prev) => {

        const merged = [...prev, ...nextChunk];

        if (shouldUseLegacyModuleCache && moduleCache) {

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

        hasMoreTracksRef.current = false;

        setHasMoreTracks(false);

      }



      return true;

    } catch (error) {

      telemetry.warn('music-library.chunk-load.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          mode: 'legacy',
          offset,
          searchQueryLength: searchQuery.trim().length,
        },
      });

      hasMoreTracksRef.current = false;

      setHasMoreTracks(false);

      return false;

    } finally {

      trackChunkLoadingRef.current = false;

      setIsTrackChunkLoading(false);

      releaseProtection();

    }

  }, [beginAudioProtection, searchQuery, shouldUseLegacyModuleCache, telemetry]);



  const activeBaseSearchQuery = shouldUseNativeBaseQuery ? nativeBaseSearchQuery : searchQuery;

  const nativeBaseQueryKey = useMemo(

    () =>

      JSON.stringify({

        searchQuery: activeBaseSearchQuery.trim(),

        baseQuery: baseQueryState,

      }),

    [activeBaseSearchQuery, baseQueryState]

  );

  const activeBaseQueryRequestKey =
    shouldUseNativeBaseQuery ? nativeBaseQueryKey : '';

  const previousShouldUseNativeBaseQueryRef = useRef(false);
  useEffect(() => {
    if (shouldUseNativeBaseQuery && !previousShouldUseNativeBaseQueryRef.current) {
      setNativeBaseSearchQuery(searchQuery);
    }
    previousShouldUseNativeBaseQueryRef.current = shouldUseNativeBaseQuery;
  }, [searchQuery, shouldUseNativeBaseQuery]);




  useEffect(() => {

    hasMoreTracksRef.current = hasMoreTracks;

  }, [hasMoreTracks]);

  useEffect(() => {

    renderedTrackLimitRef.current = renderedTrackLimit;

  }, [renderedTrackLimit]);

  useEffect(() => {

    nativeBaseTracksRef.current = nativeBaseTracks;

  }, [nativeBaseTracks]);

  useEffect(() => {

    nativeBaseTrackWindowOffsetRef.current = nativeBaseTrackWindowOffset;

  }, [nativeBaseTrackWindowOffset]);



  useEffect(() => {

    hasMoreNativeBaseTracksRef.current = hasMoreNativeBaseTracks;

  }, [hasMoreNativeBaseTracks]);



  const loadNativeBaseTrackChunk = useCallback(

    async (options?: { reset?: boolean; offset?: number; limit?: number }): Promise<boolean> => {

      if (!isOpen || !shouldUseNativeBaseQuery) return false;

      if (nativeBaseTrackLoadingRef.current) return false;



      const reset = options?.reset === true;

      const requestKey = nativeBaseQueryKey;

      const offset =
        typeof options?.offset === 'number' && Number.isFinite(options.offset)
          ? Math.max(0, Math.floor(options.offset))
          : reset
            ? 0
            : nativeBaseTrackNextOffsetRef.current;
      const limit =
        typeof options?.limit === 'number' && Number.isFinite(options.limit)
          ? Math.max(1, Math.floor(options.limit))
          : NATIVE_BASE_PAGE_SIZE;

      const currentNativeBaseTracks = nativeBaseTracksRef.current;

      if (
        !shouldUseNativeBaseWindowedQuery &&
        !reset &&
        !hasMoreNativeBaseTracksRef.current &&
        currentNativeBaseTracks !== null
      ) {

        return false;

      }



      nativeBaseTrackLoadingRef.current = true;

      nativeBaseQueryKeyRef.current = requestKey;

      setIsNativeBaseTracksLoading(true);



      try {

          const page = await musicLibraryService.queryLocalTracksPageByBase({

            searchQuery: nativeBaseSearchQuery,

            baseQuery: baseQueryState,

            limit,

            offset,

            includeMissing: false,

            visibleOnly: true,

          });



        if (nativeBaseQueryKeyRef.current !== requestKey) {

          return false;

        }



        const rows = page?.tracks ?? [];

        const nextTotal =

          typeof page?.total === 'number' && Number.isFinite(page.total)

            ? Math.max(0, Math.floor(page.total))

            : null;

        const previousTracks = reset || currentNativeBaseTracks == null ? [] : currentNativeBaseTracks;

        const nextTracks = shouldUseNativeBaseWindowedQuery
          ? rows
          : !reset && previousTracks.length > 0
            ? rows.length === 0
              ? previousTracks
              : (() => {
                  const seen = new Set(previousTracks.map((item) => item.id));
                  const appended = rows.filter((item) => !seen.has(item.id));
                  return appended.length > 0 ? [...previousTracks, ...appended] : previousTracks;
                })()
            : rows;



        nativeBaseTrackNextOffsetRef.current =
          shouldUseNativeBaseWindowedQuery ? offset : offset + rows.length;

        setNativeBaseTracksTotal(nextTotal);

        const nextHasMore =

          nextTotal !== null ? offset + rows.length < nextTotal : rows.length >= limit;

        hasMoreNativeBaseTracksRef.current = nextHasMore;

        nativeBaseTracksRef.current = nextTracks;
        nativeBaseTrackWindowOffsetRef.current = offset;

        setHasMoreNativeBaseTracks(nextHasMore);

        setNativeBaseTracks(nextTracks);
        setNativeBaseTrackWindowOffset(offset);

        return rows.length > 0;

      } finally {

        if (nativeBaseQueryKeyRef.current === requestKey) {

          nativeBaseTrackLoadingRef.current = false;

          setIsNativeBaseTracksLoading(false);

        }

      }

    },

    [

      baseQueryState,

      isOpen,

      nativeBaseQueryKey,

      nativeBaseSearchQuery,

      shouldUseNativeBaseQuery,

      shouldUseNativeBaseWindowedQuery,

    ]

  );

  const maybeLoadTrackChunkFromScroll = useCallback(() => {

    const root = getMainScrollRoot();

    if (!root) return;

    const remaining = root.scrollHeight - (root.scrollTop + root.clientHeight);

    if (remaining > TRACK_SCROLL_LOAD_TRIGGER_PX) return;

    if (
      shouldDeferMusicLibraryTrackChunkLoad({
        baseView,
        renderedTrackLimit: renderedTrackLimitRef.current,
        availableTrackCount: filteredTrackCountRef.current,
      })
    ) {
      return;
    }

    if (shouldUseNativeBaseWindowedQuery) {

      return;

    }

    if (shouldUseNativeBaseQuery) {

      if (hasMoreNativeBaseTracksRef.current || nativeBaseTracksRef.current === null) {

        void loadNativeBaseTrackChunk();

      }

      return;

    }



    if (!hasMoreTracksRef.current) return;

    void scheduleTrackChunkLoad();

  }, [

    getMainScrollRoot,

    loadNativeBaseTrackChunk,

    scheduleTrackChunkLoad,
    baseView,
    shouldUseNativeBaseQuery,
    shouldUseNativeBaseWindowedQuery,

  ]);





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

    if (baseView === 'card' && remaining <= TRACK_SCROLL_LOAD_TRIGGER_PX) {

      setRenderedTrackLimit((prev) =>
        growMusicLibraryRenderedTrackLimit(
          prev,
          filteredTrackCountRef.current,
          TRACK_RENDER_CHUNK_SIZE
        )
      );

    }

    maybeLoadTrackChunkFromScroll();



    syncMainViewport(root);

    scheduleMainScrollAnchorUpdate(viewMode);

  }, [

    getMainScrollRoot,

    maybeLoadTrackChunkFromScroll,

    scheduleMainScrollAnchorUpdate,

    syncMainViewport,
    baseView,
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

  }, [

    getMainScrollRoot,

    isOpen,

    nativeBaseTracks?.length,

    syncMainViewport,

    tracks.length,

    viewMode,

  ]);



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

  const loadLibraryStats = useCallback(
    async () => {
      hasRequestedLibraryStatsRef.current = true;
      const token = ++libraryStatsLoadTokenRef.current;

      try {
        const stats = await musicLibraryService.getLibraryStats();

        if (token !== libraryStatsLoadTokenRef.current) return;

        setLibraryStats(stats);
        setIsLibraryStatsLoaded(true);

        telemetry.info('music-library.stats.loaded', {
          fields: {
            totalTracks: stats.totalTracks,
            totalAlbums: stats.totalAlbums,
            totalArtists: stats.totalArtists,
          },
        });
      } catch (error) {
        hasRequestedLibraryStatsRef.current = false;
        telemetry.warn('music-library.stats.load.failed', {
          message: readTelemetryErrorMessage(error),
        });
      }
    },
    [telemetry]
  );



  const loadLibraryData = useCallback(async () => {

    const token = ++libraryLoadTokenRef.current;

    telemetry.info('music-library.data-load.start', {
      fields: {
        searchQueryLength: searchQuery.trim().length,
      },
    });

    const releaseProtection = beginAudioProtection('music-library-load', 25_000);



    // ???yO?gQ?mTuua??m?S???dwO?|uZ&?W'???jK??0}L??m-\????R?[??`k??o?0??cz??U0??[?z??U??su??p?y??p?i?

    const now = Date.now();

    if (

      shouldUseLegacyModuleCache &&

      moduleCache &&

      now - moduleCache.timestamp < CACHE_DURATION &&

      isModuleCacheTrackMetadataCompatible(moduleCache)

    ) {

      telemetry.info('music-library.data-load.cache-hit', {
        fields: {
          trackCount: moduleCache.tracks.length,
          hasMoreTracks: moduleCache.hasMoreTracks,
          searchQueryLength: searchQuery.trim().length,
        },
      });

      setTracks(moduleCache.tracks);

      trackNextOffsetRef.current = moduleCache.trackNextOffset;

      setHasMoreTracks(moduleCache.hasMoreTracks);

      setRenderedTrackLimit(TRACK_RENDER_CHUNK_SIZE);

      void loadLibraryStats();

      return; // ??????p[f!?'1nep;j?N???P?[?~? ??cz?o?e?|?o-aBq9p?0?h?? ??JT?h?o?`??

    }



    // uZ?pYS??ob?cmy??x???`?x???r?gp<j?X?a?Y'??zm?"XbcP????Z???f;P?~

// [legacy garbled comment omitted]

    if (!shouldUseLegacyModuleCache) {
      clearModuleCache();
    }

    telemetry.info('music-library.data-load.primary-read.start', {
      fields: {
        source: shouldUseLegacyModuleCache ? 'web-indexeddb' : 'desktop-native',
        searchQueryLength: searchQuery.trim().length,
      },
    });



    try {

      // ????oQgT???Waq???]]?Hg'1?Q????NN???ha?X[?Y??R`2QZX?g?t3 ?j??H~?Y?NG^R?? ?b	&?1000 ?o??~}?`??iZ?d<q????U/u?b?h???c"$iA?\???r?b???c?`???

      const initialTracks = await musicLibraryService.getAllTracks(INITIAL_TRACK_LOAD_LIMIT);



      if (token !== libraryLoadTokenRef.current) return;



      const hasMore = initialTracks.length >= INITIAL_TRACK_LOAD_LIMIT;

      trackNextOffsetRef.current = initialTracks.length;

      setHasMoreTracks(hasMore);

      setRenderedTrackLimit(TRACK_RENDER_CHUNK_SIZE);



      telemetry.info('music-library.data-load.completed', {
        fields: {
          trackCount: initialTracks.length,
          hasMore,
          searchQueryLength: searchQuery.trim().length,
        },
      });



      // ???T$m!?)1;_?o?V?S???dwO?|??p????o@iuun? ?[F??N?P??}?[?z?P?D?)滕?

      if (shouldUseLegacyModuleCache) {
        moduleCache = buildModuleCacheSnapshot({

          tracks: initialTracks,

          trackNextOffset: trackNextOffsetRef.current,

          hasMoreTracks: hasMore,

          normalizeForIncrementalLoad: true,

        });
      }



      setTracks(initialTracks);

      void loadLibraryStats();

    } catch (error) {

      telemetry.error('music-library.data-load.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          searchQueryLength: searchQuery.trim().length,
        },
      });

      setHasMoreTracks(false);

    } finally {

      releaseProtection();

    }

  }, [beginAudioProtection, searchQuery, shouldUseLegacyModuleCache, telemetry]);

  const reloadCurrentLocalTrackSource = useCallback(async () => {

    if (shouldUseNativeBaseQuery) {

      libraryLoadTokenRef.current += 1;

      searchTokenRef.current += 1;

      resetLoadedTrackPages({ clearModuleCache: true });

      nativeBaseTrackNextOffsetRef.current = 0;

      nativeBaseTrackLoadingRef.current = false;

      nativeBaseQueryKeyRef.current = nativeBaseQueryKey;

      nativeBaseTracksRef.current = [];

      hasMoreNativeBaseTracksRef.current = false;

      setNativeBaseTracks([]);

      setNativeBaseTracksTotal(null);

      setHasMoreNativeBaseTracks(false);

      setRenderedTrackLimit(TRACK_RENDER_CHUNK_SIZE);

      await Promise.all([loadNativeBaseTrackChunk({ reset: true }), loadLibraryStats()]);

      return;

    }

    await loadLibraryData();

  }, [

    loadLibraryData,

    loadNativeBaseTrackChunk,

    nativeBaseQueryKey,

    resetLoadedTrackPages,

    loadLibraryStats,

    shouldUseNativeBaseQuery,

  ]);



  // ??JT?h?o?`?e?&1Q???`qn?oT? ?

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

      telemetry.warn('music-library.stable.entries.load.failed', {
        message: readTelemetryErrorMessage(error),
      });

      setStableEntries([]);

    } finally {

      if (token === stableLoadTokenRef.current) {

        setIsStableEntriesLoading(false);

      }

    }

    },

    [stableInCloudOnly, stableIncludeMissing, stableOwnerFilter, telemetry]

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

      telemetry.warn('music-library.paths.health.load.failed', {
        message: readTelemetryErrorMessage(error),
      });

      setLibraryPathHealthMap({});

      setIsLibraryPathHealthAvailable(false);

    } finally {

      setIsLibraryPathHealthLoading(false);

    }

  }, [telemetry]);



  const loadLibraryPaths = useCallback(async () => {

    try {

      const paths = await musicLibraryService.getLibraryPaths();

      setLibraryPaths(paths);

      if (showPathsManager) {

        void loadLibraryPathHealth();

      }

      return paths;

    } catch (error) {

      telemetry.error('music-library.paths.load.failed', {
        message: readTelemetryErrorMessage(error),
      });

      return [];

    }

  }, [loadLibraryPathHealth, showPathsManager, telemetry]);



  const resetLibraryDataFromStorage = useCallback(async () => {

    clearModuleCache();

    await reloadCurrentLocalTrackSource();

  }, [reloadCurrentLocalTrackSource]);



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
        stableLoadTokenRef.current += 1;
        releaseStableLibraryViewState();
        releaseMusicLibraryRuntimeResources();

        searchTokenRef.current += 1;

        void resetLibraryDataFromStorage();

        return;

      }



      libraryLoadTokenRef.current += 1;
      searchTokenRef.current += 1;
      releaseLocalLibraryViewState();
      releaseMusicLibraryRuntimeResources();
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

      releaseLocalLibraryViewState,
 
      releaseMusicLibraryRuntimeResources,
 
      releaseStableLibraryViewState,
 
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

    if (librarySourceMode === 'stable') return;

    if (shouldUseNativeBaseQuery) {

      return;

    }

    if (searchQuery.trim()) {

      return;

    }

    void loadLibraryData();

  }, [

    isOpen,

    librarySourceMode,

    loadLibraryData,

    searchQuery,

    shouldUseNativeBaseQuery,

  ]);

  useEffect(() => {

    if (!isOpen) return;

    if (librarySourceMode !== 'stable') return;

    updateCoverRuntimePolicy('hidden');

    void loadStableLibraryEntries();

  }, [isOpen, librarySourceMode, loadStableLibraryEntries, updateCoverRuntimePolicy]);



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
    if (isOpen) {
      cancelScheduledProcessWorkingSetTrim('webview2');
    }
  }, [isOpen]);

  useEffect(() => {

    if (!isOpen) {

      setMusicLibraryProcessPerf(null);

      return;

    }

    if (!isTauriRuntime()) return;

    let cancelled = false;

    const sync = () => {

      void getProcessPerfTotalsSnapshot()
        .then((snapshot) => {

          if (cancelled) return;

          setMusicLibraryProcessPerf(snapshot);

        })
        .catch(() => {

          if (cancelled) return;

          setMusicLibraryProcessPerf(null);

        });

    };

    sync();

    const timer = window.setInterval(sync, MUSIC_LIBRARY_PROCESS_PERF_REFRESH_MS);

    return () => {

      cancelled = true;

      window.clearInterval(timer);

    };

  }, [isOpen]);

  useEffect(() => {

    if (!isOpen) {
      teardownHiddenMusicLibraryView();
    }
  }, [isOpen, teardownHiddenMusicLibraryView]);

  useEffect(() => {

    return () => {
      libraryLoadTokenRef.current += 1;
      stableLoadTokenRef.current += 1;
      searchTokenRef.current += 1;
      releaseMusicLibraryRuntimeResources({
        closeDatabase: true,
        resetSchemaCache: true,
      });
    };

  }, [releaseMusicLibraryRuntimeResources]);



  // ???rM?h???U??{$i6a}}|m?^6_:??P	&??

  useEffect(() => {

    if (librarySourceMode !== 'local') return;

    const unsubscribe = musicLibraryService.onScanProgress((progress) => {

      setScanProgress(progress);



      // ?????K?mT??t"1SP?Hrpn??&1?\?[?0?`??nT????JT?gT??\:]Z 2?h??@iJrZX?g?t3 ?g????X???R??Y??ns??JT^h?Y?Y?

      if (!progress.isScanning && progress.current > 0) {
        telemetry.info('music-library.scan.refresh-requested', {
          fields: {
            current: progress.current,
            total: progress.total,
          },
        });

        clearModuleCache(); // ???uZ?p8c??:j?%4dG??x???`?x???

        // ??pPN???bcJZ?R?%??L_R??k7]S??mSP?Yd?

// [legacy garbled comment omitted]

        setTimeout(() => {

          Promise.all([

            reloadCurrentLocalTrackSource(),

            loadLibraryPaths(), // ??JT~????L??py???W???? ???rf?h?nb"k??Ty?o?0?Z'??

          ]);

        }, 300); // ??JT?W?~0a?`V?<l?V????X?~WW?g?300ms

      }

    });

    return unsubscribe;

  }, [librarySourceMode, loadLibraryPaths, reloadCurrentLocalTrackSource, telemetry]);



  useEffect(() => {

    if (!isOpen) return;

    if (librarySourceMode !== 'local') {

      updateCoverRuntimePolicy('hidden');

      return;

    }



    if (baseView !== 'card') {

      updateCoverRuntimePolicy('hidden');

      return;

    }



    if (searchQuery.trim()) {

      updateCoverRuntimePolicy('critical');

      return;

    }



    updateCoverRuntimePolicy(

      (
        shouldUseNativeBaseQuery
          ? hasMoreNativeBaseTracks
          : hasMoreTracks
      )
        ? 'watch'
        : 'critical'

    );

  }, [

    baseView,

    hasMoreNativeBaseTracks,

    hasMoreTracks,

    isOpen,

    librarySourceMode,

    searchQuery,

    shouldUseNativeBaseQuery,

    updateCoverRuntimePolicy,

  ]);



  // Desktop/Tauri: ?ob;c??zO"kP??0

// [legacy garbled comment omitted]

  



  // ?o#2?lp??C^?o?V?h???0D?P???篓??PobZpt?P???

  const handleScanFolder = async () => {

    const releaseProtection = beginAudioProtection('music-library-scan', 90_000);

    try {
      telemetry.info('music-library.scan.start', {
        fields: {
          sourceMode: librarySourceMode,
        },
      });

      await musicLibraryService.scanFolder();

      // ?????K?mT??t"1SP?Hrpn??&1?\?[?0?`??)2O??P?ZJ?Ci?i?/?SPZ?jH??a?Nqy???W???? ??p????o@iuun? ?[D?]uP?F?4U??W?op?9]O??UXP?

      clearModuleCache(); // ???uZ?p8c??:j?%4dG??x???`?x???r?gZ?j?Z9pd?N?[6l<]ǔ?p_????T9PbZ;jha?X[?Y?

      await Promise.all([

        reloadCurrentLocalTrackSource(),

        loadLibraryPaths(), // ??JT!^??M?;_?o?R	]$i(h(l?~?p?g???d?k???

      ]);

      telemetry.info('music-library.scan.completed', {
        fields: {
          sourceMode: librarySourceMode,
        },
      });

      setErrorMessage(null);

    } catch (error) {

      telemetry.error('music-library.scan.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          sourceMode: librarySourceMode,
        },
      });

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

      telemetry.error('music-library.scan.cancel.failed', {
        message: readTelemetryErrorMessage(error),
      });

    }

  };

  const handleClearLibrary = async () => {

    await musicLibraryService.clearLibrary();

    clearModuleCache();

    await reloadCurrentLocalTrackSource();

    setShowClearConfirm(false);

  };



  const handleSearch = useCallback(async (query: string) => {

    bumpAudioProtection('music-library-search', 20_000);

    const token = ++searchTokenRef.current;

    setRenderedTrackLimit(TRACK_RENDER_CHUNK_SIZE);

    if (shouldUseNativeBaseQuery) {

      return;

    }



    if (query.trim()) {

      libraryLoadTokenRef.current += 1;

      const results = await musicLibraryService.searchTracks(query, 600);

      if (token !== searchTokenRef.current) return;



      setTracks(results);

      trackNextOffsetRef.current = results.length;

      setHasMoreTracks(false);

      if (shouldUseLegacyModuleCache) {
        moduleCache = buildModuleCacheSnapshot({

          tracks: results,

          trackNextOffset: trackNextOffsetRef.current,

          hasMoreTracks: false,

        });
      }

    } else {

      await resetLibraryDataFromStorage();

      if (token !== searchTokenRef.current) return;

    }



    maybeLoadTrackChunkFromScroll();

  }, [

    bumpAudioProtection,

    maybeLoadTrackChunkFromScroll,

    resetLibraryDataFromStorage,

    shouldUseLegacyModuleCache,

    shouldUseNativeBaseQuery,

  ]);



  const handleSearchInputChange = useCallback(

    (query: string) => {

      setSearchQuery(query);

      if (searchDebounceTimerRef.current != null) {

        window.clearTimeout(searchDebounceTimerRef.current);

      }

      if (shouldUseNativeBaseQuery && !query.trim()) {

        setNativeBaseSearchQuery('');

      }

      searchDebounceTimerRef.current = window.setTimeout(() => {

        if (librarySourceMode === 'stable') {

          void loadStableLibraryEntries(query);

          return;

        }

        if (shouldUseNativeBaseQuery) {

          setNativeBaseSearchQuery(query);

          return;

        }

        void handleSearch(query);

      }, SEARCH_DEBOUNCE_MS);

    },

    [handleSearch, librarySourceMode, loadStableLibraryEntries, shouldUseNativeBaseQuery]

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

    const unsubscribeFieldCapabilities = subscribeMusicLibraryBaseFieldCapabilities(() => {

      setBaseFieldRegistryVersion((value) => value + 1);

    });

    const unsubscribeFacetCollections = subscribeMusicLibraryFacetCollectionDescriptors(() => {

      setBaseFieldRegistryVersion((value) => value + 1);

    });



    return () => {

      unsubscribeFieldCapabilities();

      unsubscribeFacetCollections();

    };

  }, []);



  useEffect(() => {

    const persistedFieldCapabilities = loadMusicLibraryBaseFieldCapabilities();

    if (persistedFieldCapabilities.length > 0) {

      registerMusicLibraryBaseFieldCapabilities(persistedFieldCapabilities);

    }

  }, []);



  useEffect(() => {

    if (!isTauriRuntime()) {

      setNativeSchemaEnvelopeStatus('unsupported');

      return;

    }



    let cancelled = false;

    setNativeSchemaEnvelopeStatus('loading');



    void musicLibraryService.loadAndRegisterNativeSchemaEnvelope()

      .then((schemaEnvelope) => {

        if (cancelled) return;

        setNativeSchemaEnvelopeStatus(schemaEnvelope ? 'loaded' : 'failed');

      })

      .catch((error) => {
        telemetry.warn('music-library.schema.load.failed', {
          message: readTelemetryErrorMessage(error),
        });

        if (cancelled) return;

        setNativeSchemaEnvelopeStatus('failed');

      });



    return () => {

      cancelled = true;

    };

  }, [telemetry]);



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



  useEffect(() => {

    persistMusicLibraryBaseFieldCapabilities(listRegisteredMusicLibraryBaseFieldCapabilities(), {

      debounceMs: 150,

    });

  }, [baseFieldRegistryVersion]);



  useEffect(() => {

    if (isTauriRuntime() && nativeSchemaEnvelopeStatus === 'loading') {

      return;

    }

    if (tracks.length === 0) {

      return;

    }



    registerMusicLibraryDiscoveredFieldCapabilitiesFromTracks(tracks);

  }, [nativeSchemaEnvelopeStatus, tracks]);



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



  const syncLocalTrackHorizontalScroll = useCallback((source: 'header' | 'body' | 'footer') => {

    if (localTrackHorizontalScrollSyncingRef.current) return;

    const header = localTrackListHeaderScrollRef.current;

    const body = localTrackListBodyScrollRef.current;

    const footer = localTrackListFooterScrollRef.current;

    if (!header || !body) return;

    const nextScrollLeft =
      source === 'header'
        ? header.scrollLeft
        : source === 'body'
          ? body.scrollLeft
          : footer?.scrollLeft ?? body.scrollLeft;



    localTrackHorizontalScrollSyncingRef.current = true;

    if (source !== 'header') {
      header.scrollLeft = nextScrollLeft;
    }

    if (source !== 'body') {
      body.scrollLeft = nextScrollLeft;
    }

    if (footer && source !== 'footer') {
      footer.scrollLeft = nextScrollLeft;
    }

    localTrackHorizontalScrollSyncingRef.current = false;

  }, []);



  const handleLocalTrackHeaderScroll = useCallback(() => {

    syncLocalTrackHorizontalScroll('header');

  }, [syncLocalTrackHorizontalScroll]);



  const handleLocalTrackBodyScroll = useCallback(() => {

    syncLocalTrackHorizontalScroll('body');

  }, [syncLocalTrackHorizontalScroll]);



  const handleLocalTrackFooterScroll = useCallback(() => {

    syncLocalTrackHorizontalScroll('footer');

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



  const initialViewportAutoloadKey = useMemo(

    () =>

      JSON.stringify({

        sourceMode: librarySourceMode,

        searchQuery: searchQuery.trim(),

        baseQueryRequestKey: activeBaseQueryRequestKey,

      }),

    [activeBaseQueryRequestKey, librarySourceMode, searchQuery]

  );



  useEffect(() => {

    if (!isOpen) {

      initialViewportAutoloadKeyRef.current = null;

      return;

    }

    if (librarySourceMode !== 'local') return;

    if (searchQuery.trim()) return;

    const visibleTrackSourceLength = shouldUseNativeBaseQuery

      ? (nativeBaseTracks?.length ?? 0)
      : tracks.length;

    if (visibleTrackSourceLength <= 0) return;

    const root = getMainScrollRoot();

    if (!root || root.clientHeight <= 0) return;

    if (initialViewportAutoloadKeyRef.current === initialViewportAutoloadKey) return;

    initialViewportAutoloadKeyRef.current = initialViewportAutoloadKey;

    maybeLoadTrackChunkFromScroll();

  }, [

    getMainScrollRoot,

    initialViewportAutoloadKey,

    isOpen,

    librarySourceMode,

    maybeLoadTrackChunkFromScroll,

    nativeBaseTracks?.length,

    searchQuery,

    shouldUseNativeBaseQuery,

    tracks.length,

  ]);



  const addBaseSortRule = useCallback(() => {

    setBaseSortRules((prev) =>

      appendMusicLibraryBaseSortRule(prev, {

        excludedFields: baseGroupByRules.map((rule) => rule.field),

      })

    );

  }, [baseGroupByRules]);



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

  const requiresDesktopNativeBaseFieldSupport =
    librarySourceMode === 'local' && isTauriRuntime();



  const availableBaseGroupFields = useMemo(

    () => {

      void baseFieldRegistryVersion;

      return (listMusicLibraryBaseGroupFieldIds() as MusicLibraryBaseGroupRule['field'][]).filter((field) => {

        if (!isMusicLibraryBaseFieldVisibleInBaseUi(field)) return false;

        if (requiresDesktopNativeBaseFieldSupport && !getMusicLibraryBaseNativeSortField(field)) {
          return false;
        }

        return true;

      });

    },

    [baseFieldRegistryVersion, requiresDesktopNativeBaseFieldSupport]

  );

  const availableBaseOrderFields = useMemo(

    () => {

      void baseFieldRegistryVersion;

      return (listMusicLibraryBaseOrderFieldIds() as MusicLibraryBaseSortRule['field'][]).filter((field) => {

        if (!isMusicLibraryBaseFieldVisibleInBaseUi(field)) return false;

        if (requiresDesktopNativeBaseFieldSupport && !getMusicLibraryBaseNativeSortField(field)) {
          return false;
        }

        return true;

      });

    },

    [baseFieldRegistryVersion, requiresDesktopNativeBaseFieldSupport]

  );

  const availableBaseFilterFields = useMemo(

    () => {

      void baseFieldRegistryVersion;

      return listMusicLibraryBaseFilterFieldIds().filter((field) => {

        if (!isMusicLibraryBaseFieldVisibleInBaseUi(field)) return false;

        if (requiresDesktopNativeBaseFieldSupport && !getMusicLibraryBaseNativeFilterField(field)) {
          return false;
        }

        return true;

      });

    },

    [baseFieldRegistryVersion, requiresDesktopNativeBaseFieldSupport]

  );

  const baseFilterFacetDescriptor = useMemo(

    () => {

      void baseFieldRegistryVersion;
      return resolveMusicLibraryFieldFacetDescriptor(baseFilterField);

    },

    [baseFieldRegistryVersion, baseFilterField]

  );



  const canAddBaseGroupByRule = baseGroupByRules.length < availableBaseGroupFields.length;

  const canAddBaseSortRule = availableBaseOrderFields.some(

    (field) =>

      !baseGroupByRules.some((rule) => rule.field === field) &&

      !baseSortRules.some((rule) => rule.field === field)

  );

  const canAddBaseFilterGroup =
    baseFilterGroups.length < MUSIC_LIBRARY_BASE_FILTER_GROUP_LIMIT;



  useEffect(() => {

    setCollapsedTrackGroupKeys(new Set());

  }, [baseGroupByRules]);



  useEffect(() => {

    const allowedGroupFields = new Set(availableBaseGroupFields);

    setBaseGroupByRules((previous) => {

      const next = previous.filter((rule) => allowedGroupFields.has(rule.field));

      return next.length === previous.length ? previous : next;

    });

  }, [availableBaseGroupFields]);



  useEffect(() => {

    const allowedOrderFields = new Set(availableBaseOrderFields);

    setBaseSortRules((previous) => {

      const next = previous.filter((rule) => allowedOrderFields.has(rule.field));

      return next.length === previous.length ? previous : next;

    });

  }, [availableBaseOrderFields]);



  useEffect(() => {

    if (availableBaseFilterFields.length === 0) return;

    if (availableBaseFilterFields.includes(baseFilterField)) return;

    setBaseFilterField(availableBaseFilterFields[0] as MusicLibraryBaseField);

  }, [availableBaseFilterFields, baseFilterField]);



  useEffect(() => {

    const allowedFilterFields = new Set(availableBaseFilterFields);

    setBaseFilterGroups((previous) => {

      const next = previous
        .map((group) => ({
          ...group,
          filters: group.filters.filter((filter) => allowedFilterFields.has(filter.field)),
        }))
        .filter((group) => group.filters.length > 0);

      if (next.length === previous.length) {
        const changed = next.some((group, index) => group.filters.length !== previous[index]?.filters.length);
        if (!changed) {
          return previous;
        }
      }

      return next;

    });

  }, [availableBaseFilterFields]);



  useEffect(() => {

    const groupedFields = new Set(baseGroupByRules.map((rule) => rule.field));

    setBaseSortRules((previous) => {

      const next = previous.filter((rule) => !groupedFields.has(rule.field));

      return next.length === previous.length ? previous : next;

    });

  }, [baseGroupByRules]);



  useEffect(() => {

    if (baseFilterGroups.length === 0) {
      if (activeBaseFilterGroupId !== null) {
        setActiveBaseFilterGroupId(null);
      }
      return;
    }

    if (activeBaseFilterGroupId && baseFilterGroups.some((group) => group.id === activeBaseFilterGroupId)) {
      return;
    }

    setActiveBaseFilterGroupId(baseFilterGroups[0]?.id ?? null);

  }, [activeBaseFilterGroupId, baseFilterGroups]);



  const toggleTrackGroupCollapsed = useCallback((groupKey: string) => {

    setCollapsedTrackGroupKeys((previous) => {

      const next = new Set(previous);

      if (next.has(groupKey)) {

        next.delete(groupKey);

      } else {

        next.add(groupKey);

      }

      return next;

    });

  }, []);



  const toggleColumnSortRule = useCallback(

    (columnId: LocalTrackColumnId, event: React.MouseEvent<HTMLButtonElement>) => {

      event.stopPropagation();

      const sortField = LOCAL_TRACK_COLUMN_DEFINITIONS[columnId].sortField;

      if (!sortField) return;

      setBaseSortRules((previous) =>

        toggleMusicLibraryBaseSortField(previous, sortField, {

          multi: event.shiftKey,

        })

      );

    },

    []

  );



  const filteredPropertyColumns = useMemo(() => {

    const keyword = propertySearchQuery.trim().toLowerCase();

    if (!keyword) return localTrackColumnSettings;



    return localTrackColumnSettings.filter((column) => {

      const label = t(LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].headerKey).toLowerCase();

      return label.includes(keyword) || column.id.toLowerCase().includes(keyword);

    });

  }, [localTrackColumnSettings, propertySearchQuery, t]);



  const filteredBaseFilterFacetValues = useMemo(() => {

    const keyword = baseFilterValue.trim().toLowerCase();

    const items = keyword

      ? baseFilterFacetValues.filter((item) => item.toLowerCase().includes(keyword))

      : baseFilterFacetValues;

    return items.slice(0, 64);

  }, [baseFilterFacetValues, baseFilterValue]);



  useEffect(() => {

    if (!showBaseFilterPanel || !baseFilterFacetDescriptor) {

      setBaseFilterFacetValues([]);

      setIsBaseFilterFacetValuesLoading(false);

      return;

    }



    let cancelled = false;

    setIsBaseFilterFacetValuesLoading(true);



    void musicLibraryService

      .getBaseFieldFacetValues(baseFilterFacetDescriptor.field, { limit: 240 })

      .then((values) => {

        if (cancelled) return;

        setBaseFilterFacetValues(values);

      })

      .catch(() => {

        if (cancelled) return;

        setBaseFilterFacetValues([]);

      })

      .finally(() => {

        if (cancelled) return;

        setIsBaseFilterFacetValuesLoading(false);

      });



    return () => {

      cancelled = true;

    };

  }, [baseFilterFacetDescriptor, showBaseFilterPanel]);



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





  useEffect(() => {

    if (!isOpen || !shouldUseNativeBaseQuery) {

      resetNativeBaseTrackPages();

      return;

    }

    libraryLoadTokenRef.current += 1;

    searchTokenRef.current += 1;

    nativeBaseTrackNextOffsetRef.current = 0;

    resetLoadedTrackPages({ clearModuleCache: true });

    nativeBaseTrackLoadingRef.current = false;

    nativeBaseQueryKeyRef.current = nativeBaseQueryKey;

    nativeBaseTracksRef.current = [];
    nativeBaseTrackWindowOffsetRef.current = 0;

    hasMoreNativeBaseTracksRef.current = false;

    setNativeBaseTracks([]);
    setNativeBaseTrackWindowOffset(0);

    setNativeBaseTracksTotal(null);

    setHasMoreNativeBaseTracks(false);

    setRenderedTrackLimit(TRACK_RENDER_CHUNK_SIZE);

    if (!hasRequestedLibraryStatsRef.current) {
      void loadLibraryStats();
    }

    if (!shouldUseNativeBaseWindowedQuery) {

      void loadNativeBaseTrackChunk({ reset: true });

    }

  }, [

    isOpen,

    loadNativeBaseTrackChunk,

    nativeBaseQueryKey,

    resetLoadedTrackPages,

    resetNativeBaseTrackPages,

    shouldUseNativeBaseQuery,

    shouldUseNativeBaseWindowedQuery,

    loadLibraryStats,

    telemetry,

  ]);

  const cardViewportWidth = useMemo(

    () =>

      Math.max(
        320,
        (mainViewport.clientWidth > 0 ? mainViewport.clientWidth : 960) -
          MUSIC_LIBRARY_MAIN_HORIZONTAL_PADDING_PX
      ),

    [mainViewport.clientWidth]

  );

  const nativeBaseWindowRequest = useMemo(() => {

    if (!shouldUseNativeBaseWindowedQuery) {

      return null;

    }

    const viewportHeightPx = mainViewport.clientHeight > 0 ? mainViewport.clientHeight : 720;
    const request = buildNativeBaseWindowRequest({
      baseView,
      viewportHeightPx,
      scrollTopPx: mainViewport.scrollTop,
      cardViewportWidthPx: cardViewportWidth,
      listHeaderHeightPx: TRACK_LIST_HEADER_HEIGHT_PX,
      trackRowHeightPx: TRACK_ROW_HEIGHT_PX,
      overscanRows: TRACK_WINDOW_OVERSCAN_ROWS,
      pageSize: NATIVE_BASE_PAGE_SIZE,
      minPages: NATIVE_BASE_WINDOW_MIN_PAGES,
    });

    return clampNativeBaseWindowRequestToTotal(request, nativeBaseTracksTotal);

  }, [

    baseView,

    cardViewportWidth,

    mainViewport.clientHeight,

    mainViewport.scrollTop,

    nativeBaseTracksTotal,

    shouldUseNativeBaseWindowedQuery,

  ]);

  const nativeBaseTrackWindowMatchesRequest = useMemo(() => {
    if (!shouldUseNativeBaseWindowedQuery || !nativeBaseWindowRequest) {
      return true;
    }

    return nativeBaseTrackWindowCoversRequest({
      currentOffset: nativeBaseTrackWindowOffset,
      currentLength: nativeBaseTracks?.length ?? 0,
      request: nativeBaseWindowRequest,
      total: nativeBaseTracksTotal,
    });
  }, [
    nativeBaseTrackWindowOffset,
    nativeBaseTracks,
    nativeBaseTracksTotal,
    nativeBaseWindowRequest,
    shouldUseNativeBaseWindowedQuery,
  ]);

  const nativeBaseTrackDisplayOffset = shouldUseNativeBaseWindowedQuery
    ? nativeBaseTrackWindowMatchesRequest
      ? nativeBaseTrackWindowOffset
      : (nativeBaseWindowRequest?.offset ?? nativeBaseTrackWindowOffset)
    : 0;

  const nativeBaseTracksForRender = useMemo(() => {
    if (!nativeBaseTracks) return null;
    if (!shouldUseNativeBaseWindowedQuery) return nativeBaseTracks;
    return nativeBaseTrackWindowMatchesRequest ? nativeBaseTracks : [];
  }, [nativeBaseTracks, nativeBaseTrackWindowMatchesRequest, shouldUseNativeBaseWindowedQuery]);

  // 闁兼儳鍢茶ぐ鍥ㄦ交閸ャ劍濮㈤柛婊冩湰鐢挻鎯旇箛鎾村€甸柣銊ュ瀵ゆ椽鏌?

  const filteredTracks = useMemo(() => {

    if (nativeBaseTracksForRender) {

      return nativeBaseTracksForRender;

    }

    return shouldUseWebFallbackBaseQuery ? applyMusicLibraryBaseQuery(tracks, baseQueryState) : tracks;

  }, [baseQueryState, nativeBaseTracksForRender, shouldUseWebFallbackBaseQuery, tracks]);



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



  useLayoutEffect(() => {

    const header = localTrackListHeaderScrollRef.current;

    const body = localTrackListBodyScrollRef.current;

    const footer = localTrackListFooterScrollRef.current;

    if (!header || !body) return;

    header.scrollLeft = body.scrollLeft;

    if (footer) {
      footer.scrollLeft = body.scrollLeft;
    }

    const nextFooterScrollWidth = Math.max(header.scrollWidth, body.scrollWidth);

    setLocalTrackFooterScrollWidth((prev) =>
      prev === nextFooterScrollWidth ? prev : nextFooterScrollWidth
    );

  }, [localTrackGridTemplate, renderedLocalTrackColumns.length]);



  const isUsingNativeBaseTracks = nativeBaseTracks != null;

  const hasMoreVisibleTrackSource = isUsingNativeBaseTracks

    ? hasMoreNativeBaseTracks
    : hasMoreTracks;

  const isPartialBaseQueryResult =

    (shouldUseWebFallbackBaseQuery && hasMoreTracks) ||

    (shouldUseNativeBaseQuery && hasMoreNativeBaseTracks);



  const resolveBaseFieldLabel = useCallback(

    (field: MusicLibraryBaseOrderField) => {

      const headerKey = resolveMusicLibraryBaseFieldHeaderKey(field);

      return headerKey ? t(headerKey) : resolveMusicLibraryBaseFieldLabel(field);

    },

    [t]

  );



  const filteredTracksTotal =

    shouldUseNativeBaseQuery && nativeBaseTracksTotal !== null

      ? nativeBaseTracksTotal

      : filteredTracks.length;



  useEffect(() => {

    setRenderedTrackLimit((prev) => {

      if (!Number.isFinite(prev) || prev <= 0) {

        return Math.min(filteredTracksTotal, TRACK_RENDER_CHUNK_SIZE);

      }

      return Math.min(filteredTracksTotal, prev);

    });

  }, [filteredTracksTotal]);


  const renderedTracks = useMemo(
    () =>
      shouldUseNativeBaseWindowedQuery
        ? filteredTracks
        : sliceMusicLibraryRenderedTracks(filteredTracks, {
            baseView,
            renderedTrackLimit,
          }),
    [baseView, filteredTracks, renderedTrackLimit, shouldUseNativeBaseWindowedQuery]
  );

  useEffect(() => {

    filteredTrackCountRef.current = filteredTracksTotal;

  }, [filteredTracksTotal]);



  const groupedRows = useMemo<MusicLibraryGroupedRow[]>(

    () =>

      buildMusicLibraryGroupedRows({

        tracks: renderedTracks,

        groupByRules: baseGroupByRules,

        collapsedGroupKeys: collapsedTrackGroupKeys,

        resolveFieldLabel: resolveBaseFieldLabel,

        resolveFieldDisplayValue: (field, track) => formatMusicLibraryFieldValue(track, field),

      }),

    [

      baseGroupByRules,

      collapsedTrackGroupKeys,

      renderedTracks,

      resolveBaseFieldLabel,

    ]

  );



  const virtualizedTrackSourceRows = useMemo(

    () => (baseView === 'card' ? [] : groupedRows),

    [baseView, groupedRows]

  );



  const trackVirtualWindow = useMemo(() => {

    const viewportHeight = mainViewport.clientHeight > 0 ? mainViewport.clientHeight : 720;
    const baseTopSpacerPx = shouldUseNativeBaseWindowedQuery
      ? nativeBaseTrackDisplayOffset * TRACK_ROW_HEIGHT_PX
      : 0;
    const baseBottomSpacerPx = shouldUseNativeBaseWindowedQuery
      ? Math.max(
          0,
          filteredTracksTotal - nativeBaseTrackDisplayOffset - virtualizedTrackSourceRows.length
        ) * TRACK_ROW_HEIGHT_PX
      : 0;

    const effectiveScrollTop = Math.max(
      0,
      mainViewport.scrollTop - TRACK_LIST_HEADER_HEIGHT_PX - baseTopSpacerPx
    );

    const visibleRows = Math.max(1, Math.ceil(viewportHeight / TRACK_ROW_HEIGHT_PX));

    const start = Math.max(

      0,

      Math.floor(effectiveScrollTop / TRACK_ROW_HEIGHT_PX) - TRACK_WINDOW_OVERSCAN_ROWS

    );

    const end = Math.min(

      virtualizedTrackSourceRows.length,

      start + visibleRows + TRACK_WINDOW_OVERSCAN_ROWS * 2

    );

    const visibleWindow = sliceMusicLibraryGroupedRows({

      rows: virtualizedTrackSourceRows,

      start,

      end,

    });



    return {

      rows: visibleWindow.rows,

      topSpacerPx:
        baseTopSpacerPx + visibleWindow.topSpacerRowCount * TRACK_ROW_HEIGHT_PX,

      bottomSpacerPx:
        baseBottomSpacerPx + visibleWindow.bottomSpacerRowCount * TRACK_ROW_HEIGHT_PX,

    };

  }, [

    filteredTracksTotal,

    mainViewport.clientHeight,

    mainViewport.scrollTop,

    nativeBaseTrackDisplayOffset,

    shouldUseNativeBaseWindowedQuery,

    virtualizedTrackSourceRows,

  ]);

  useEffect(() => {

    if (!isOpen || !shouldUseNativeBaseWindowedQuery || !nativeBaseWindowRequest) {

      return;

    }

    if (nativeBaseTracksTotal === 0) {
      return;
    }

    const currentOffset = nativeBaseTrackWindowOffsetRef.current;
    const currentLength = nativeBaseTracksRef.current?.length ?? 0;
    if (
      nativeBaseTrackWindowCoversRequest({
        currentOffset,
        currentLength,
        request: nativeBaseWindowRequest,
        total: nativeBaseTracksTotal,
      })
    ) {

      return;

    }

    void loadNativeBaseTrackChunk({
      offset: nativeBaseWindowRequest.offset,
      limit: nativeBaseWindowRequest.limit,
      reset: currentLength === 0 && currentOffset === 0,
    });

  }, [

    isOpen,

    loadNativeBaseTrackChunk,

    nativeBaseQueryKey,

    nativeBaseWindowRequest,

    nativeBaseTracksTotal,

    shouldUseNativeBaseWindowedQuery,

  ]);



  const cardVirtualLayout = useMemo(

    () => buildMusicLibraryCardVirtualLayout(groupedRows, cardViewportWidth),

    [cardViewportWidth, groupedRows]

  );



  const cardVirtualWindow = useMemo(

    () => {

      const viewportHeight = mainViewport.clientHeight > 0 ? mainViewport.clientHeight : 720;
      const columns = Math.max(1, resolveMusicLibraryCardGridColumns(cardViewportWidth));
      const rowStridePx =
        MUSIC_LIBRARY_CARD_TRACK_ROW_HEIGHT_PX + MUSIC_LIBRARY_CARD_BLOCK_GAP_PX;
      const baseTopSpacerPx = shouldUseNativeBaseWindowedQuery
        ? Math.floor(nativeBaseTrackDisplayOffset / columns) * rowStridePx
        : 0;
      const visibleWindow = sliceMusicLibraryCardVirtualLayout(
        cardVirtualLayout,
        Math.max(0, mainViewport.scrollTop - baseTopSpacerPx),
        viewportHeight
      );
      const loadedRowCount = Math.ceil(renderedTracks.length / columns);
      const remainingRowCount = shouldUseNativeBaseWindowedQuery
        ? Math.max(
            0,
            Math.ceil(filteredTracksTotal / columns) -
              Math.floor(nativeBaseTrackDisplayOffset / columns) -
              loadedRowCount
          )
        : 0;

      return {
        blocks: visibleWindow.blocks,
        topSpacerPx: baseTopSpacerPx + visibleWindow.topSpacerPx,
        bottomSpacerPx:
          visibleWindow.bottomSpacerPx + remainingRowCount * rowStridePx,
      };

    },

    [

      cardVirtualLayout,

      cardViewportWidth,

      filteredTracksTotal,

      mainViewport.clientHeight,

      mainViewport.scrollTop,

      nativeBaseTrackDisplayOffset,

      renderedTracks.length,

      shouldUseNativeBaseWindowedQuery,

    ]

  );


  const isNativeBaseTrackWindowStale =
    shouldUseNativeBaseWindowedQuery &&
    nativeBaseWindowRequest !== null &&
    !nativeBaseTrackWindowMatchesRequest;

  const isVisibleTrackSourceLoading = isUsingNativeBaseTracks

    ? isNativeBaseTracksLoading || isNativeBaseTrackWindowStale
    : isTrackChunkLoading;

  const showTrackLoadHint = isUsingNativeBaseTracks

    ? isVisibleTrackSourceLoading ||

      hasMoreNativeBaseTracks ||

      (baseView === 'card' && renderedTracks.length < filteredTracksTotal)
    : isVisibleTrackSourceLoading ||

        hasMoreTracks ||

        (baseView === 'card' && renderedTracks.length < filteredTracksTotal);



  const getMusicLibraryRuntimeDiagnosticSnapshot = useCallback(

    (): MusicLibraryRuntimeDiagnosticSnapshot => {

      const coverCache = musicLibraryService.getCoverRuntimeCacheStats();

      const performanceMemory = (

        performance as Performance & {

          memory?: {

            usedJSHeapSize?: number;

            totalJSHeapSize?: number;

            jsHeapSizeLimit?: number;

          };

        }

      ).memory;

      const tracksBytes = estimateMusicLibraryTrackArrayBytes(tracks) ?? 0;

      const nativeBaseTracksBytes = estimateMusicLibraryTrackArrayBytes(nativeBaseTracks) ?? 0;

      const trackArrayBytes = tracksBytes + nativeBaseTracksBytes;

      const trackedRuntimeBytes =

        trackArrayBytes + coverCache.coverBlobUrlTotalBytes + coverCache.coverDecodedEstimateTotalBytes;

      const webview2PrivateBytes =

        musicLibraryProcessPerf?.totals.webview2PrivateBytes ?? null;



      return {

        timestampMs: Date.now(),

        sourceMode: librarySourceMode,

        baseView,

        searchQuery: searchQuery.trim(),

        shouldUseNativeBaseQuery,

        coverPolicy: musicLibraryService.getCurrentCoverRuntimeCachePolicy(),

        counts: {

          tracks: tracks.length,

          nativeBaseTracks: nativeBaseTracks?.length ?? 0,

          filteredTracks: filteredTracks.length,

          renderedTracks: renderedTracks.length,

          groupedRows: groupedRows.length,

        },

        estimatedBytes: {

          tracks: tracksBytes,

          nativeBaseTracks: nativeBaseTracksBytes,

        },

        attribution: {

          trackArrayBytes,

          trackedRuntimeBytes,

          webview2PrivateResidualBytes:

            webview2PrivateBytes !== null ? Math.max(0, webview2PrivateBytes - trackedRuntimeBytes) : null,

          webview2PrivateMinusTrackArraysBytes:

            webview2PrivateBytes !== null ? Math.max(0, webview2PrivateBytes - trackArrayBytes) : null,

        },

        process: {

          timestampMs: musicLibraryProcessPerf?.timestampMs ?? null,

          webview2PrivateBytes,

          webview2WorkingSetBytes: musicLibraryProcessPerf?.totals.webview2WorkingSetBytes ?? null,

          treePrivateBytes: musicLibraryProcessPerf?.totals.privateBytes ?? null,

          treeWorkingSetBytes: musicLibraryProcessPerf?.totals.workingSetBytes ?? null,

          webview2CpuPercent: musicLibraryProcessPerf?.totals.webview2CpuPercent ?? null,

        },

        coverCache,

        jsHeap:

          performanceMemory &&

          typeof performanceMemory.usedJSHeapSize === 'number' &&

          typeof performanceMemory.totalJSHeapSize === 'number' &&

          typeof performanceMemory.jsHeapSizeLimit === 'number'

            ? {

                usedJSHeapSize: performanceMemory.usedJSHeapSize,

                totalJSHeapSize: performanceMemory.totalJSHeapSize,

                jsHeapSizeLimit: performanceMemory.jsHeapSizeLimit,

              }

            : null,

      };

    },

    [

      baseView,

      filteredTracks,

      groupedRows.length,

      librarySourceMode,

      nativeBaseTracks,

      musicLibraryProcessPerf,

      renderedTracks.length,

      searchQuery,

      shouldUseNativeBaseQuery,

      tracks,

    ]

  );



  useEffect(() => {

    if (typeof window === 'undefined') return;



    const getRuntimeSnapshot = (): MusicLibraryRuntimeDiagnosticSnapshot => {

      const snapshot = getMusicLibraryRuntimeDiagnosticSnapshot();

      window.__PMP_LAST_MUSIC_LIBRARY_SNAPSHOT__ = snapshot;

      return snapshot;

    };



    window.__PMP_MUSIC_LIBRARY_GET_SNAPSHOT__ = getRuntimeSnapshot;

    window.__PMP_LAST_MUSIC_LIBRARY_SNAPSHOT__ = getRuntimeSnapshot();



    return () => {

      if (window.__PMP_MUSIC_LIBRARY_GET_SNAPSHOT__ === getRuntimeSnapshot) {

        delete window.__PMP_MUSIC_LIBRARY_GET_SNAPSHOT__;

      }

    };

  }, [getMusicLibraryRuntimeDiagnosticSnapshot]);



  useEffect(() => {

    if (!isOpen) {

      if (musicLibraryDiagnosticsTimerRef.current != null) {

        window.clearTimeout(musicLibraryDiagnosticsTimerRef.current);

        musicLibraryDiagnosticsTimerRef.current = null;

      }

      return;

    }



    if (typeof window === 'undefined') return;



    if (musicLibraryDiagnosticsTimerRef.current != null) {

      window.clearTimeout(musicLibraryDiagnosticsTimerRef.current);

    }



    musicLibraryDiagnosticsTimerRef.current = window.setTimeout(() => {

      musicLibraryDiagnosticsTimerRef.current = null;

      const snapshot = getMusicLibraryRuntimeDiagnosticSnapshot();

      const signature = JSON.stringify({

        sourceMode: snapshot.sourceMode,

        baseView: snapshot.baseView,

        searchQuery: snapshot.searchQuery,

        tracks: snapshot.counts.tracks,

        nativeBaseTracks: snapshot.counts.nativeBaseTracks,

        filteredTracks: snapshot.counts.filteredTracks,

        renderedTracks: snapshot.counts.renderedTracks,

        groupedRows: snapshot.counts.groupedRows,

        coverPolicy: snapshot.coverPolicy,

        coverBlobUrlTotalBytes: snapshot.coverCache.coverBlobUrlTotalBytes,

        coverDecodedEstimateTotalBytes: snapshot.coverCache.coverDecodedEstimateTotalBytes,

        trackedRuntimeBytes: snapshot.attribution.trackedRuntimeBytes,

        webview2PrivateBytes: snapshot.process.webview2PrivateBytes,

        webview2PrivateResidualBytes: snapshot.attribution.webview2PrivateResidualBytes,

        usedJSHeapSize: snapshot.jsHeap?.usedJSHeapSize ?? null,

      });



      if (musicLibraryDiagnosticsSignatureRef.current === signature) {

        return;

      }



      musicLibraryDiagnosticsSignatureRef.current = signature;

      telemetry.debug('music-library.diagnostics.snapshot', {
        fields: snapshot as unknown as Record<string, unknown>,
      });

    }, MUSIC_LIBRARY_MEMORY_LOG_DEBOUNCE_MS);



    return () => {

      if (musicLibraryDiagnosticsTimerRef.current != null) {

        window.clearTimeout(musicLibraryDiagnosticsTimerRef.current);

        musicLibraryDiagnosticsTimerRef.current = null;

      }

    };

  }, [getMusicLibraryRuntimeDiagnosticSnapshot, isOpen, telemetry]);



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

      if (!shouldUseNativeBaseWindowedQuery && anchor?.kind === 'track') {

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

        } else if (hasMoreVisibleTrackSource) {

          void (
            shouldUseNativeBaseQuery
              ? loadNativeBaseTrackChunk()
              : scheduleTrackChunkLoad()
          );

          return;

        }

      }



      const desiredScrollTop = memory.scrollTop;

      if (
        !shouldUseNativeBaseWindowedQuery &&

        desiredScrollTop > 0 &&

        desiredScrollTop > maxScrollTop + 1 &&

        (renderedTrackLimit < filteredTracks.length || hasMoreVisibleTrackSource)

      ) {

        if (renderedTrackLimit < filteredTracks.length) {

          setRenderedTrackLimit((prev) => {

            if (prev >= filteredTracks.length) return prev;

            return Math.min(filteredTracks.length, prev + TRACK_RENDER_CHUNK_SIZE);

          });

          return;

        }



        if (hasMoreVisibleTrackSource) {

          void (
            shouldUseNativeBaseQuery
              ? loadNativeBaseTrackChunk()
              : scheduleTrackChunkLoad()
          );

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

    hasMoreVisibleTrackSource,

    isOpen,

    librarySourceMode,

    libraryStats.totalTracks,

    loadNativeBaseTrackChunk,

    renderedTrackLimit,

    scheduleTrackChunkLoad,

    shouldUseNativeBaseQuery,

    shouldUseNativeBaseWindowedQuery,

    tracks.length,

    viewMode,

  ]);



  // 闁告娲栭崵顔界▔閹惧湱甯?- 閻庝絻澹堥崺鍛村礆妫颁胶鐟╅弶鍫熷灱椤曟盯骞嗛崨娣偓?

  // 闁告瑥鑻崵顔界▔閹惧湱甯?- 闁圭虎鍘介弬浣圭▔閹惧湱甯?

  // 闁圭虎鍘介弬渚€鎳濋悜妯婚挬閻?

  // 闁告瑥鑻崵顔碱潰鐏炵偓閿ら柨娑欑閸у﹪宕濋悩鍐差暡闁哄牆顦崇换鍐煥閵堝懏鍊甸柣銊ュ閻℃洟寮撮幓鎺戠厒闂傚啰鍠庨崹顏堟晬鐏炶偐鐭ら梺顐㈩槷閼垫垿鎯冮崟顒傛憙闁哄洦褰冪槐鎴炴叏鐎ｎ偅灏￠柡鈧?

  const resolvePlayableTracksForCurrentView = useCallback(async (): Promise<Track[]> => {

    if (!shouldUseNativeBaseWindowedQuery || filteredTracks.length >= filteredTracksTotal) {

      return filteredTracks;

    }

    const resolvedTracks: Track[] = [];
    let offset = 0;
    let total = filteredTracksTotal;

    while (offset < total) {

      const page = await musicLibraryService.queryLocalTracksPageByBase({

        searchQuery: nativeBaseSearchQuery,

        baseQuery: baseQueryState,

        limit: NATIVE_BASE_PAGE_SIZE,

        offset,

        includeMissing: false,

        visibleOnly: true,

      });

      const rows = page?.tracks ?? [];
      if (typeof page?.total === 'number' && Number.isFinite(page.total)) {

        total = Math.max(0, Math.floor(page.total));

      }
      if (rows.length === 0) {

        break;

      }
      resolvedTracks.push(...rows);
      offset += rows.length;

    }

    return resolvedTracks.length > 0 ? resolvedTracks : filteredTracks;

  }, [

    baseQueryState,

    filteredTracks,

    filteredTracksTotal,

    nativeBaseSearchQuery,

    shouldUseNativeBaseWindowedQuery,

  ]);

  const handleTrackDoubleClick = useCallback((track: Track, index: number) => {

    if (!onPlayNow) {
      telemetry.debug('music-library.play-track.skipped', {
        fields: {
          mode: 'list',
          reason: 'embedded-no-playback',
          trackId: track.id,
          trackTitle: track.title ?? null,
        },
      });

      return;

    }



    markPendingPlayTrack(track);

    void resolvePlayableTracksForCurrentView()
      .then((playTracks) => {
        const originalIndex = shouldUseNativeBaseWindowedQuery
          ? index
          : playTracks.findIndex((candidate) => candidate.id === track.id);
        const startIndex = originalIndex >= 0 ? originalIndex : index;

        telemetry.info('music-library.play-track', {
          fields: {
            mode: 'list',
            startIndex,
            filteredTrackCount: playTracks.length,
            trackId: track.id,
            trackTitle: track.title ?? null,
          },
        });

        onPlayNow(playTracks, startIndex);
      })
      .catch((error) => {
        telemetry.warn('music-library.play-track.resolve.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            trackId: track.id,
            trackTitle: track.title ?? null,
          },
        });
      });

  }, [

    markPendingPlayTrack,

    onPlayNow,

    resolvePlayableTracksForCurrentView,

    shouldUseNativeBaseWindowedQuery,

    telemetry,

  ]);



  // 闁告瑯浜濋幐閬嶅绩閹冪濡絾鐗楅悺鏇㈠即?

  const handlePlaySingleTrack = useCallback((track: Track, e?: React.MouseEvent) => {

    e?.stopPropagation();

    if (!onPlayNow) {
      telemetry.debug('music-library.play-track.skipped', {
        fields: {
          mode: 'single',
          reason: 'embedded-no-playback',
          trackId: track.id,
          trackTitle: track.title ?? null,
        },
      });

      return;

    }

    markPendingPlayTrack(track);

    telemetry.info('music-library.play-track', {
      fields: {
        mode: 'single',
        trackId: track.id,
        trackTitle: track.title ?? null,
      },
    });

    onPlayNow([track]);

  }, [markPendingPlayTrack, onPlayNow, telemetry]);



  // 闁告瑯浜濋崸濠囧礉閻樻彃绀嬪Λ锝嗙墬閻℃洟寮撮幓鎺戠厒闂傚啰鍠庨崹?

  const handleAddSingleTrack = useCallback((track: Track, e?: React.MouseEvent) => {

    e?.stopPropagation();

    if (!onAddToQueue) {
      telemetry.debug('music-library.add-track.skipped', {
        fields: {
          reason: 'embedded-no-queue',
          trackId: track.id,
          trackTitle: track.title ?? null,
        },
      });

      return;

    }

    telemetry.info('music-library.add-track', {
      fields: {
        trackId: track.id,
        trackTitle: track.title ?? null,
      },
    });

    onAddToQueue([track]);

  }, [onAddToQueue, telemetry]);



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

        telemetry.warn('music-library.stable.queue.load.failed', {
          message: readTelemetryErrorMessage(error),
        });

        setErrorMessage(t('pages.music-library.stable.queue.loadFailed'));

      } finally {

        setIsStableQueueLoading(false);

      }

    },

    [stableOwnerFilter, t, telemetry]

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

  const handleTrackContextMenu = useCallback((track: Track, index: number, e: React.MouseEvent) => {

    e.preventDefault();

    e.stopPropagation();



    const localFilePath = String(track.filePath || track.path || track.originalPath || '').trim();

    const menuItems: ContextMenuItem[] = buildLibraryTrackContextMenu({

      t,

      track,

      playlists: audioService.getPlaylists(),

      onPlay: () => handlePlaySingleTrack(track),

      onAddToQueue: () => handleAddSingleTrack(track),

      onAddToPlaylist: (playlistId, trackToAdd) => {

        audioService.addTrackToPlaylist(playlistId, trackToAdd);

      },

      playAllFromHereLabel: t('pages.music-library.contextMenu.playAllFromHere'),

      onPlayAllFromHere: () => {
        if (!onPlayNow) return;
        void resolvePlayableTracksForCurrentView()
          .then((playTracks) => {
            const playStartIndex = shouldUseNativeBaseWindowedQuery
              ? index
              : playTracks.findIndex((candidate) => candidate.id === track.id);
            onPlayNow(playTracks, playStartIndex >= 0 ? playStartIndex : index);
          })
          .catch((error) => {
            telemetry.warn('music-library.context-menu.play-all-from-here.failed', {
              message: readTelemetryErrorMessage(error),
              fields: {
                trackId: track.id,
                trackTitle: track.title ?? null,
              },
            });
          });
      },

      openInFileManagerLabel: t('pages.music-library.contextMenu.openInFileManager'),

      openInFileManagerDisabled: !localFilePath,

      onOpenInFileManager: () => {

        if (!localFilePath) return;

        void musicLibraryService.openInFileManager(localFilePath).then((opened) => {

          if (!opened) {

            setErrorMessage(t('pages.music-library.contextMenu.openInFileManagerFailed'));

          }

        });

      },

      viewAlbumLabel: t('pages.music-library.contextMenu.viewAlbum'),

      viewAlbumDisabled: !track.album,

      onViewAlbum: () => {

        if (!track.album) return;

        handleApplyQuickBaseFilter('album', track.album);

      },

      viewArtistLabel: t('pages.music-library.contextMenu.viewArtist'),

      viewArtistDisabled: !track.artist,

      onViewArtist: () => {

        if (!track.artist) return;

        handleApplyQuickBaseFilter('artist', track.artist);

      },

    });



    setContextMenu({

      x: e.clientX,

      y: e.clientY,

      items: menuItems,

    });

  }, [
    audioService,
    handleAddSingleTrack,
    handleApplyQuickBaseFilter,
    handlePlaySingleTrack,
    onPlayNow,
    resolvePlayableTracksForCurrentView,
    shouldUseNativeBaseWindowedQuery,
    t,
    telemetry,
  ]);



  const cardViewContent = useMemo(() => {

    const renderTrackCardByRow = (row: MusicLibraryTrackRow) => {

      const track = filteredTracks[row.trackIndex];

      if (!track) {

        return null;

      }

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

          index={nativeBaseTrackDisplayOffset + row.trackIndex}

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

    };
    const resolveIndentedBlockStyle = (depth: number): React.CSSProperties | undefined => {

      if (depth <= 0) return undefined;

      return {

        marginLeft: `${depth * MUSIC_LIBRARY_CARD_GROUP_INDENT_MARGIN_PX}px`,

        paddingLeft: `${depth * MUSIC_LIBRARY_CARD_GROUP_INDENT_PADDING_PX}px`,

        borderLeft: '1px solid rgba(140, 170, 255, 0.18)',

      };

    };



    return (

      <>

        {cardVirtualWindow.topSpacerPx > 0 && (

          <div

            className="music-library-virtual-spacer"

            style={{ height: `${cardVirtualWindow.topSpacerPx}px` }}

            aria-hidden="true"

          />

        )}

        {cardVirtualWindow.blocks.map((block) => {

          if (block.kind === 'group-header') {

            const row = block.row;
            const blockStyle = resolveIndentedBlockStyle(block.depth);

            return (

              <div key={block.key} style={blockStyle}>

                <button

                  type="button"

                  className="music-library-card-group-header"

                  onClick={() => toggleTrackGroupCollapsed(row.groupKey)}

                  title={

                    row.collapsed

                      ? t('pages.music-library.group.expandTitle')

                      : t('pages.music-library.group.collapseTitle')

                  }

                >

                  <span className="music-library-card-group-arrow" aria-hidden="true">

                    {row.collapsed ? '▶' : '▼'}

                  </span>

                  <span className="music-library-card-group-field">{row.fieldLabel}</span>

                  <span className="music-library-card-group-title">{row.title}</span>

                  <span className="music-library-card-group-count">

                    {t('pages.album.stats.trackCount', { count: row.count })}

                  </span>

                </button>

              </div>

            );

          }



          const blockStyle = resolveIndentedBlockStyle(block.depth);

          return (

            <div key={block.key} className="music-library-card-grid" style={blockStyle}>

              {block.rows.map(renderTrackCardByRow)}

            </div>

          );

        })}

        {cardVirtualWindow.bottomSpacerPx > 0 && (

          <div

            className="music-library-virtual-spacer"

            style={{ height: `${cardVirtualWindow.bottomSpacerPx}px` }}

            aria-hidden="true"

          />

        )}

      </>

    );

  }, [

    cardVirtualWindow.blocks,
    cardVirtualWindow.bottomSpacerPx,
    cardVirtualWindow.topSpacerPx,
    filteredTracks,
    nativeBaseTrackDisplayOffset,

    handleAddSingleTrack,

    handlePlaySingleTrack,

    handleTrackContextMenu,

    handleTrackDoubleClick,

    onAddToQueue,

    onPlayNow,

    pendingPlayTrackIdentity,

    resolveTrackIdentity,

    t,

    toggleTrackGroupCollapsed,

  ]);



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

    return formatMusicLibraryFileSize(bytes);

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

  const formatOptionalTimestamp = useCallback(

    (value?: number) => {

      return formatMusicLibraryTimestamp(value, {

        emptyPlaceholder: '-',

        format: 'datetime',

        locale,

      });

    },

    [locale]

  );



  const renderLocalTrackColumnValue = useCallback(

    (track: Track, columnId: LocalTrackColumnId): string => {

      const baseField = resolveMusicLibraryBaseFieldFromLocalTrackColumn(columnId);

      if (baseField) {

        return formatMusicLibraryFieldValue(track, baseField, {

          timestampFormat: 'datetime',

          locale,

        });

      }



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



      switch (columnId) {

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

        default:

          return '-';

      }

    },

    [locale]

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

          await Promise.all([loadLibraryPaths(), reloadCurrentLocalTrackSource()]);

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

    [beginAudioProtection, loadLibraryPathHealth, loadLibraryPaths, reloadCurrentLocalTrackSource]

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

        await Promise.all([loadLibraryPaths(), reloadCurrentLocalTrackSource()]);

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

    loadLibraryPathHealth,

    loadLibraryPaths,

    reloadCurrentLocalTrackSource,

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



  const pageSurface = useSkinSurfaceModel('page.music-library');
  const pageEnterMotion = useMemo(
    () => pickThemeMotionChannel(pageSurface.root.motion, ['enter']),
    [pageSurface.root.motion]
  );
  const pageExitMotion = useMemo(
    () => pickThemeMotionChannel(pageSurface.root.motion, ['exit']),
    [pageSurface.root.motion]
  );
  const pagePresence = useThemePresenceState({
    open: isOpen,
    enterDurationMs: getThemeMotionTotalMs(pageEnterMotion?.spec),
    exitDurationMs: getThemeMotionTotalMs(pageExitMotion?.spec),
  });

  if (!pagePresence.rendered) return null;

  const pageMotionStyle =
    pagePresence.phase === 'enter'
      ? buildThemePresenceAnimationStyle(pageEnterMotion?.spec, 'enter')
      : pagePresence.phase === 'exit'
        ? buildThemePresenceAnimationStyle(pageExitMotion?.spec, 'exit')
        : undefined;

  const rootProps = pageSurface.getElementProps({
    bindingId: 'page.music-library',
    className: ['music-library', embedded ? 'music-library-embedded' : ''].filter(Boolean).join(' '),
    style: pageMotionStyle,
  });

  const libraryContent = (

    <div
      {...rootProps}
      data-surface-id="page.music-library"
      data-surface-variant={pageSurface.variant}
      data-open={isOpen ? 'true' : 'false'}
      data-pmp-motion-phase={pagePresence.phase}
      {...((pagePresence.phase === 'enter' ? pageEnterMotion?.name : pagePresence.phase === 'exit' ? pageExitMotion?.name : undefined)
        ? {
            'data-pmp-motion-channel':
              pagePresence.phase === 'enter' ? pageEnterMotion?.name : pageExitMotion?.name,
          }
        : {})}
      {...((pagePresence.phase === 'enter'
        ? pageEnterMotion?.spec.preset
        : pagePresence.phase === 'exit'
          ? pageExitMotion?.spec.preset
          : undefined)
        ? {
            'data-pmp-motion-preset':
              pagePresence.phase === 'enter' ? pageEnterMotion?.spec.preset : pageExitMotion?.spec.preset,
          }
        : {})}
    >

      {!embedded && (

        <div className="music-library-header" data-pmp-part="header">

          <div className="music-library-header-left" data-pmp-part="header-main">

            <h2 className="music-library-title">{t('pages.music-library.title')}</h2>

            <div className="music-library-source-modes" data-pmp-part="source-modes">

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
        data-pmp-part="toolbar-region"

        ref={librarySourceMode === 'local' ? baseToolbarRegionRef : undefined}

      >

        <div className="music-library-toolbar" data-pmp-part="toolbar">

          <div className="music-library-actions" data-pmp-part="actions">

            {librarySourceMode === 'local' ? (

              <div className="music-library-base-toolbar-left">

                <div
                  className="music-library-base-view-switch"
                  role="group"
                  aria-label={t('pages.music-library.base.viewModeLabel')}
                >

                  <button

                    className={`music-library-base-view-btn ${baseView === 'table' ? 'active' : ''}`}

                    onClick={() => setBaseView('table')}

                  >

                    {t('pages.music-library.base.view.table')}

                  </button>

                  <button

                    className={`music-library-base-view-btn ${baseView === 'card' ? 'active' : ''}`}

                    onClick={() => setBaseView('card')}

                  >

                    {t('pages.music-library.base.view.card')}

                  </button>

                </div>

                {isPartialBaseQueryResult ? (

                  <span

                    className="music-library-base-results-hint"

                    title={t('pages.music-library.base.partialResultTitle')}

                  >

                    {t('pages.music-library.base.partialResultBadge')}

                  </span>

                ) : null}

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

            <span className="music-library-search-icon">⌕</span>

          </div>



          {librarySourceMode === 'local' && (

            <div className="music-library-base-toolbar-actions">

              <button

                className={`music-library-btn ${showBaseSortPanel ? 'is-active' : ''}`}

                onClick={() => toggleBaseControlPanel('sort')}

              >

                {t('pages.music-library.base.sortButton')}

              </button>

              <button

                className={`music-library-btn ${showBaseFilterPanel ? 'is-active' : ''}`}

                onClick={() => toggleBaseControlPanel('filter')}

              >

                {t('pages.music-library.base.filterButton')}

              </button>

              <button

                className={`music-library-btn ${showColumnSettings ? 'is-active' : ''}`}

                onClick={() => toggleBaseControlPanel('properties')}

              >

                {t('pages.music-library.base.fieldsButton')}

              </button>

            </div>

          )}

        </div>



        {librarySourceMode === 'local' &&

          (showBaseSortPanel || showBaseFilterPanel || showColumnSettings) && (

            <div className="music-library-base-popover-region">

              {showBaseSortPanel && (

                <div
                  className="music-library-base-popover-panel"
                  role="dialog"
                  aria-label={t('pages.music-library.sort.panelTitle')}
                >

                  <div className="music-library-base-popover-section">

                    <div className="music-library-base-popover-title">

                      {t('pages.music-library.group.panelTitle')}

                    </div>

                    <div className="music-library-base-popover-help">

                      {t('pages.music-library.group.help')}

                    </div>

                    {baseGroupByRules.length === 0 ? (

                      <div className="music-library-base-popover-note">
                        {t('pages.music-library.group.empty')}
                      </div>

                    ) : (

                      <div className="music-library-base-rule-list">

                        {baseGroupByRules.map((rule, index) => (

                          <div className="music-library-base-popover-row" key={rule.id}>

                            <span className="music-library-base-popover-priority">#{index + 1}</span>

                            <select

                              className="music-library-sort-select"

                              value={rule.field}

                              onChange={(event) =>

                                updateBaseGroupByRule(rule.id, {

                                  field: event.target.value as MusicLibraryBaseGroupRule['field'],

                                })

                              }

                            >

                              {getSelectableRuleFields(

                                rule.id,

                                rule.field,

                                baseGroupByRules,

                                availableBaseGroupFields

                              ).map((field) => (

                                <option key={field} value={field}>

                                  {resolveBaseFieldLabel(field)}

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

                              <option value="asc">{t('pages.music-library.order.asc')}</option>

                              <option value="desc">{t('pages.music-library.order.desc')}</option>

                            </select>

                            <button

                              className="music-library-base-popover-icon-btn"

                              title={t('pages.music-library.columns.action.moveUp')}

                              onClick={() => moveBaseGroupByRule(rule.id, -1)}

                              disabled={index === 0}

                            >

                              ↑

                            </button>

                            <button

                              className="music-library-base-popover-icon-btn"

                              title={t('pages.music-library.columns.action.moveDown')}

                              onClick={() => moveBaseGroupByRule(rule.id, 1)}

                              disabled={index === baseGroupByRules.length - 1}

                            >

                              ↓

                            </button>

                            <button

                              className="music-library-base-popover-icon-btn"

                              title={t('common.action.remove')}

                              onClick={() => removeBaseGroupByRule(rule.id)}

                            >

                              ×

                            </button>

                          </div>

                        ))}

                      </div>

                    )}

                    <button

                      className="music-library-btn"

                      onClick={addBaseGroupByRule}

                      disabled={!canAddBaseGroupByRule}

                      title={

                        canAddBaseGroupByRule

                          ? undefined

                          : t('pages.music-library.group.addDisabledTitle')

                      }

                    >

                      {t('pages.music-library.group.addButton')}

                    </button>

                  </div>

                  <div className="music-library-base-popover-section">

                    <div className="music-library-base-popover-title">

                      {t('pages.music-library.sort.panelTitle')}

                    </div>

                    <div className="music-library-base-popover-help">

                      {t('pages.music-library.sort.help')}

                    </div>

                    {baseSortRules.length === 0 ? (

                      <div className="music-library-base-popover-note">
                        {t('pages.music-library.sort.empty')}
                      </div>

                    ) : (

                      <div className="music-library-base-rule-list">

                        {baseSortRules.map((rule, index) => (

                          <div className="music-library-base-popover-row" key={rule.id}>

                            <span className="music-library-base-popover-priority">#{index + 1}</span>

                            <select

                              className="music-library-sort-select"

                              value={rule.field}

                              onChange={(event) =>

                                updateBaseSortRule(rule.id, {

                                  field: event.target.value as MusicLibraryBaseSortRule['field'],

                                })

                              }

                            >

                              {getSelectableSortRuleFields(

                                rule.id,

                                rule.field,

                                baseSortRules,

                                baseGroupByRules

                              ).map((field) => (

                                <option key={field} value={field}>

                                  {resolveBaseFieldLabel(field)}

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

                              <option value="asc">{t('pages.music-library.order.asc')}</option>

                              <option value="desc">{t('pages.music-library.order.desc')}</option>

                            </select>

                            <button

                              className="music-library-base-popover-icon-btn"

                              title={t('pages.music-library.columns.action.moveUp')}

                              onClick={() => moveBaseSortRule(rule.id, -1)}

                              disabled={index === 0}

                            >

                              ↑

                            </button>

                            <button

                              className="music-library-base-popover-icon-btn"

                              title={t('pages.music-library.columns.action.moveDown')}

                              onClick={() => moveBaseSortRule(rule.id, 1)}

                              disabled={index === baseSortRules.length - 1}

                            >

                              ↓

                            </button>

                            <button

                              className="music-library-base-popover-icon-btn"

                              title={t('common.action.remove')}

                              onClick={() => removeBaseSortRule(rule.id)}

                            >

                              ×

                            </button>

                          </div>

                        ))}

                      </div>

                    )}

                    <button

                      className="music-library-btn"

                      onClick={addBaseSortRule}

                      disabled={!canAddBaseSortRule}

                      title={

                        canAddBaseSortRule

                          ? undefined

                          : t('pages.music-library.sort.addDisabledTitle')

                      }

                    >

                      {t('pages.music-library.sort.addButton')}

                    </button>

                  </div>

                </div>

              )}



              {showBaseFilterPanel && (

                <div
                  className="music-library-base-popover-panel"
                  role="dialog"
                  aria-label={t('pages.music-library.filter.panelTitle')}
                >

                  <div className="music-library-base-popover-section">

                    <div className="music-library-base-popover-title">
                      {t('pages.music-library.filter.groupRulesTitle')}
                    </div>

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

                        <option value="and">{t('pages.music-library.filter.groupJoin.and')}</option>

                        <option value="or">{t('pages.music-library.filter.groupJoin.or')}</option>

                      </select>

                      <select

                        className="music-library-sort-select"

                        value={activeBaseFilterGroupId ?? ''}

                        onChange={(event) =>

                          setActiveBaseFilterGroupId(event.target.value || null)

                        }

                      >

                        <option value="">{t('pages.music-library.filter.selectGroupPlaceholder')}</option>

                        {baseFilterGroups.map((group, index) => (

                          <option key={group.id} value={group.id}>

                            {t('pages.music-library.filter.groupLabel', { index: index + 1 })}

                          </option>

                        ))}

                      </select>

                      <button
                        className="music-library-btn"
                        onClick={handleAddBaseFilterGroup}
                        disabled={!canAddBaseFilterGroup}
                        title={
                          canAddBaseFilterGroup
                            ? undefined
                            : t('pages.music-library.filter.addGroupDisabledTitle', {
                                count: MUSIC_LIBRARY_BASE_FILTER_GROUP_LIMIT,
                              })
                        }
                      >

                        {t('pages.music-library.filter.addGroupButton')}

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

                        {availableBaseFilterFields.map((field) => (

                          <option key={field} value={field}>

                            {resolveMusicLibraryBaseFieldHeaderKey(field)

                              ? t(resolveMusicLibraryBaseFieldHeaderKey(field) as string)

                              : resolveMusicLibraryBaseFieldLabel(field)}

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

                        list={baseFilterFacetDescriptor ? baseFilterFacetValuesListId : undefined}

                        placeholder={
                          baseFilterFacetDescriptor
                            ? t('pages.music-library.filter.valuePlaceholderWithFacet')
                            : t('pages.music-library.filter.valuePlaceholder')
                        }

                        className="music-library-base-filter-input"

                      />

                      {baseFilterFacetDescriptor && filteredBaseFilterFacetValues.length > 0 && (

                        <datalist id={baseFilterFacetValuesListId}>

                          {filteredBaseFilterFacetValues.map((item) => (

                            <option key={item} value={item} />

                          ))}

                        </datalist>

                      )}

                      <button className="music-library-btn" onClick={handleAddBaseFilter}>

                        {t('pages.music-library.filter.addButton')}

                      </button>

                      <button

                        className="music-library-btn"

                        onClick={handleClearBaseFilters}

                        disabled={baseFilterGroups.length === 0}

                      >

                        {t('pages.music-library.filter.clearButton')}

                      </button>

                    </div>

                    {baseFilterFacetDescriptor && (

                      <div className="music-library-base-popover-note">

                        {isBaseFilterFacetValuesLoading

                          ? t('pages.music-library.filter.facetLoading', {
                              label: baseFilterFacetDescriptor.label,
                            })

                          : t('pages.music-library.filter.facetLoaded', {
                              label: baseFilterFacetDescriptor.label,
                              count: baseFilterFacetValues.length,
                            })}

                      </div>

                    )}

                  </div>



                  {baseFilterGroups.length > 0 && (

                    <div className="music-library-base-filter-groups">

                      {baseFilterGroups.map((group, index) => (
                        <div className="music-library-base-filter-group" key={group.id}>

                          <div className="music-library-base-filter-group-header">

                            <strong>
                              {t('pages.music-library.filter.groupLabel', { index: index + 1 })}
                            </strong>

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

                              <option value="and">{t('pages.music-library.filter.innerJoin.and')}</option>

                              <option value="or">{t('pages.music-library.filter.innerJoin.or')}</option>

                            </select>

                            <button

                              className="music-library-base-popover-icon-btn"

                              title={t('common.action.remove')}

                              onClick={() => handleRemoveBaseFilterGroup(group.id)}

                            >

                              ×

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

                                    title={t('pages.music-library.filter.removeTitle')}

                                  >

                                    {resolveMusicLibraryBaseFieldLabel(filter.field)}{' '}

                                    {MUSIC_LIBRARY_BASE_OPERATOR_LABEL_MAP[filter.operator]}

                                    {valueText} ×

                                  </button>

                                );

                              })}

                            </div>

                          ) : (

                            <div className="music-library-base-popover-note">
                              {t('pages.music-library.filter.emptyGroup')}
                            </div>

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

                  aria-label={t('pages.music-library.fields.panelTitle')}

                >

                  <div className="music-library-base-property-search">

                    <input

                      type="text"

                      value={propertySearchQuery}

                      onChange={(event) => setPropertySearchQuery(event.target.value)}

                      placeholder={t('pages.music-library.fields.searchPlaceholder')}

                    />

                  </div>

                  <div className="music-library-column-list music-library-base-property-list">

                    {filteredPropertyColumns.length === 0 ? (

                      <div className="music-library-modal-empty">
                        {t('pages.music-library.fields.empty')}
                      </div>

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

                      {t('pages.music-library.fields.resetButton')}

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

            disabled={isLibraryStatsLoaded && libraryStats.totalTracks === 0}

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

          <div className="music-library-main music-library-main-stable">
            <div className="music-library-main-scroll" ref={mainScrollRef}>

            {isStableEntriesLoading ? (

              <div className="music-library-empty">

                <div className="music-library-empty-icon">⏳</div>

                <div className="music-library-empty-text">{t('pages.music-library.stable.loading')}</div>

              </div>

            ) : sortedStableEntries.length === 0 ? (

              <div className="music-library-empty">

                <div className="music-library-empty-icon">☁</div>

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

                          ?

                        </button>

                      </div>

                    </div>

                  );

                })}

              </div>

            )}

            </div>
          </div>

        ) : (

          <div
            className={`music-library-main music-library-main-local${baseView === 'card' ? ' is-card-view' : ' is-table-view'}`}
          >
            <div className="music-library-main-scroll" ref={mainScrollRef}>

            {isLibraryStatsLoaded && libraryStats.totalTracks === 0 ? (

              <div className="music-library-empty">

                <div className="music-library-empty-icon">♪</div>

                <div className="music-library-empty-text">{t('pages.music-library.empty.title')}</div>

                <button className="music-library-btn" onClick={handleScanFolder}>

                  {t('pages.music-library.empty.scanButton')}

                </button>

              </div>

            ) : (

              <>



              {baseView === 'card' && (

                <div className="music-library-card-groups">{cardViewContent}</div>

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

                          const sortField = LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].sortField;

                          const activeSortIndex = sortField

                            ? baseSortRules.findIndex((rule) => rule.field === sortField)

                            : -1;

                          const activeSortRule = activeSortIndex >= 0 ? baseSortRules[activeSortIndex] : null;

                          const isGroupedColumn = sortField

                            ? baseGroupByRules.some((rule) => rule.field === sortField)

                            : false;

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

                              {sortField ? (

                                <button

                                  type="button"

                                  className={`music-library-list-header-sort-btn${activeSortRule ? ' is-active' : ''}`}

                                  onPointerDown={(event) => event.stopPropagation()}

                                  onClick={(event) => toggleColumnSortRule(column.id, event)}

                                  title={t('pages.music-library.sort.headerToggleTitle')}

                                >

                                  <span className="music-library-list-header-label">

                                    {t(LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].headerKey)}

                                  </span>

                                  <span className="music-library-list-header-meta">

                                    {isGroupedColumn && (

                                      <span className="music-library-list-header-group-badge">

                                        {t('pages.music-library.group.badge')}

                                      </span>

                                    )}

                                    {activeSortRule && (

                                      <span className="music-library-list-header-sort-indicator">

                                        <span aria-hidden="true">

                                          {activeSortRule.order === 'asc' ? '↑' : '↓'}

                                        </span>

                                        {baseSortRules.length > 1 && (

                                          <span className="music-library-list-header-sort-priority">

                                            {activeSortIndex + 1}

                                          </span>

                                        )}

                                      </span>

                                    )}

                                  </span>

                                </button>

                              ) : (

                                <span className="music-library-list-header-label">

                                  {t(LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].headerKey)}

                                </span>

                              )}

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

                  {trackVirtualWindow.rows.map((row) => {

                    if (row.kind === 'group-header') {

                      return (

                        <div

                          key={row.id}

                          className="music-library-track-group"

                          style={{

                            gridTemplateColumns: localTrackGridTemplate,

                            '--music-library-group-indent': `${row.depth * 18}px`,

                          } as React.CSSProperties}

                        >

                          <button

                            type="button"

                            className="music-library-track-group-toggle"

                            onClick={() => toggleTrackGroupCollapsed(row.groupKey)}

                            title={

                              row.collapsed

                                ? t('pages.music-library.group.expandTitle')

                                : t('pages.music-library.group.collapseTitle')

                            }

                          >

                            <span className="music-library-track-group-arrow" aria-hidden="true">

                              {row.collapsed ? '▶' : '▼'}

                            </span>

                            <span className="music-library-track-group-field">{row.fieldLabel}</span>

                            <span className="music-library-track-group-title">{row.title}</span>

                            <span className="music-library-track-group-count">

                              {t('pages.album.stats.trackCount', { count: row.count })}

                            </span>

                          </button>

                        </div>

                      );

                    }



                    const track = filteredTracks[row.trackIndex];

                    if (!track) {

                      return null;

                    }

                    const absoluteIndex = nativeBaseTrackDisplayOffset + row.trackIndex;

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

                        {onPlayNow && (

                          <button

                            onClick={(e) => handlePlaySingleTrack(track, e)}

                            title={t('pages.music-library.tracks.action.playOneTitle')}

                            className={`music-library-track-action-btn ${onAddToQueue ? 'music-library-track-action-btn--secondary' : 'music-library-track-action-btn--primary'} track-action-play`}

                          >

                            ▶

                          </button>

                        )}

                        {onAddToQueue && (

                          <button

                            onClick={(e) => handleAddSingleTrack(track, e)}

                            title={t('pages.music-library.tracks.action.addOneTitle')}

                            className="music-library-track-action-btn music-library-track-action-btn--primary track-action-add"

                          >

                            +

                          </button>

                        )}

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

                  <div
                    className="music-library-list-footer-scroll"
                    ref={localTrackListFooterScrollRef}
                    onScroll={handleLocalTrackFooterScroll}
                    aria-hidden="true"
                  >
                    <div
                      className="music-library-list-footer-spacer"
                      style={{ width: `${Math.max(localTrackFooterScrollWidth, localTrackLayoutWidth)}px` }}
                    />
                  </div>

                  {showTrackLoadHint && (

                    <div className="music-library-track-load-hint" role="status" aria-live="polite">

                      {isVisibleTrackSourceLoading

                        ? t('pages.music-library.loading.tracksChunk')

                        : !shouldUseNativeBaseWindowedQuery &&
                            renderedTracks.length < filteredTracksTotal

                          ? t('pages.music-library.loading.renderWindowHint', {

                              shown: renderedTracks.length,

                              total: filteredTracksTotal,

                            })

                          : t('pages.music-library.loading.scrollToLoadMore')}

                    </div>

                  )}

                </div>

              </>

            )}

            </div>
          </div>

        )}

      </div>



      {showStableQueuePanel && (
        <PmpDialog
          open={showStableQueuePanel}
          title={<h3>{t('pages.music-library.stable.queue.title')}</h3>}
          overlayClassName="music-library-modal-overlay"
          className="music-library-modal music-library-stable-queue-modal"
          headerClassName="music-library-modal-header"
          bodyClassName="music-library-modal-body"
          headerActions={
            <div className="music-library-modal-header-actions">
              <PmpButton
                type="button"
                className="music-library-btn"
                variant="default"
                onClick={() => {
                  void loadStableQueueData();
                }}
                disabled={isStableQueueLoading}
              >
                {t('common.action.refresh')}
              </PmpButton>
              <PmpButton
                type="button"
                className="music-library-modal-close"
                variant="ghost"
                onClick={() => setShowStableQueuePanel(false)}
                title={t('common.action.close')}
                aria-label={t('common.action.close')}
              >
                ×
              </PmpButton>
            </div>
          }
          onClose={() => setShowStableQueuePanel(false)}
        >
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
        </PmpDialog>
      )}



      {editingStableEntry && (
        <PmpDialog
          open={Boolean(editingStableEntry)}
          title={<h3>{t('pages.music-library.stable.metadata.title')}</h3>}
          overlayClassName="music-library-modal-overlay"
          className="music-library-modal music-library-stable-metadata-modal"
          headerClassName="music-library-modal-header"
          bodyClassName="music-library-modal-body"
          footerClassName="music-library-modal-footer"
          headerActions={
            <PmpButton
              type="button"
              className="music-library-modal-close"
              variant="ghost"
              onClick={handleCloseStableMetadataEditor}
              title={t('common.action.close')}
              aria-label={t('common.action.close')}
            >
              ×
            </PmpButton>
          }
          footer={
            <>
              <PmpButton
                type="button"
                className="music-library-btn"
                variant="ghost"
                onClick={handleCloseStableMetadataEditor}
              >
                {t('common.action.cancel')}
              </PmpButton>
              <PmpButton
                type="button"
                className="music-library-btn"
                variant="primary"
                onClick={() => {
                  void handleSaveStableMetadata();
                }}
                disabled={isStableMetadataSaving}
              >
                {isStableMetadataSaving
                  ? t('common.action.save')
                  : t('pages.music-library.stable.metadata.save')}
              </PmpButton>
            </>
          }
          onClose={handleCloseStableMetadataEditor}
        >
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
        </PmpDialog>
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
        <PmpDialog
          open={showPathsManager}
          title={<h3>{t('pages.music-library.pathsManager.title')}</h3>}
          overlayClassName="paths-manager-overlay"
          className="paths-manager-modal"
          headerClassName="paths-manager-header"
          bodyClassName="paths-manager-body"
          footerClassName="paths-manager-footer"
          headerActions={
            <div className="paths-manager-header-actions">
              <PmpButton
                type="button"
                className="paths-scan-btn"
                variant="primary"
                onClick={async () => {
                  await handleScanFolder();
                  await loadLibraryPaths();
                }}
                disabled={scanProgress?.isScanning}
              >
                {t('pages.music-library.pathsManager.addFolderButton')}
              </PmpButton>
              <PmpButton
                type="button"
                className="paths-clean-missing-btn"
                variant="default"
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
              </PmpButton>
              <PmpButton
                type="button"
                className="paths-manager-close-btn"
                variant="ghost"
                title={t('common.action.close')}
                aria-label={t('common.action.close')}
                onClick={() => setShowPathsManager(false)}
              >
                ×
              </PmpButton>
            </div>
          }
          footer={
            <>
              <div className="paths-manager-health-info">
                {isLibraryPathHealthLoading
                  ? t('pages.music-library.pathsManager.health.loading')
                  : isLibraryPathHealthAvailable
                    ? t('pages.music-library.pathsManager.health.summary', {
                        count: totalMissingTracks,
                      })
                    : t('pages.music-library.pathsManager.health.unavailable')}
              </div>
            </>
          }
          onClose={() => setShowPathsManager(false)}
        >

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

                              await Promise.all([loadLibraryPaths(), reloadCurrentLocalTrackSource()]);

                            } finally {

                              releaseProtection();

                            }

                          }}

                          title={

                            path.isVisible

                              ? t('pages.music-library.pathsManager.path.hideTitle')

                              : t('pages.music-library.pathsManager.path.showTitle')

                          }
                          aria-label={
                            path.isVisible
                              ? t('pages.music-library.pathsManager.path.hideTitle')
                              : t('pages.music-library.pathsManager.path.showTitle')
                          }

                        >

                          <svg
                            viewBox="0 0 24 24"
                            className="path-item-action-icon"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                            {path.isVisible ? (
                              <>
                                <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
                                <path d="M21 12c-2.4 4-5.4 6-9 6c-3.6 0-6.6-2-9-6c2.4-4 5.4-6 9-6c3.6 0 6.6 2 9 6" />
                              </>
                            ) : (
                              <>
                                <path d="M21 12c-2.4 4-5.4 6-9 6c-3.6 0-6.6-2-9-6c2.4-4 5.4-6 9-6c3.6 0 6.6 2 9 6" />
                                <path d="M3 3l18 18" />
                              </>
                            )}
                          </svg>

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
                          aria-label={
                            path.isScanned
                              ? t('pages.music-library.pathsManager.path.disableScanTitle')
                              : t('pages.music-library.pathsManager.path.enableScanTitle')
                          }

                        >

                          <svg
                            viewBox="0 0 24 24"
                            className="path-item-action-icon"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                            {path.isScanned ? (
                              <>
                                <path d="M9 8v8" />
                                <path d="M15 8v8" />
                              </>
                            ) : (
                              <path d="M8 5v14l11-7z" />
                            )}
                          </svg>

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
                          aria-label={
                            missingCount > 0
                              ? t('pages.music-library.pathsManager.path.cleanupMissingTitle', { count: missingCount })
                              : t('pages.music-library.pathsManager.path.cleanupMissingDisabledTitle')
                          }

                        >

                          <svg
                            viewBox="0 0 24 24"
                            className={`path-item-action-icon${isPathCleanupBusy ? ' path-item-action-icon--spin' : ''}`}
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                            {isPathCleanupBusy ? (
                              <path d="M12 3a9 9 0 1 0 9 9" />
                            ) : (
                              <>
                                <path d="M6 21l10-10" />
                                <path d="M16 7l4 4" />
                                <path d="M5 20l5-5l4 4l-5 5h-4z" />
                              </>
                            )}
                          </svg>

                        </button>

                        <button

                          className="path-item-action-btn path-item-rescan"

                          onClick={async () => {

                            const releaseProtection = beginAudioProtection('music-library-rescan-path', 90_000);

                            try {

                              await musicLibraryService.scanFolder(path.path, path.id);

                              await loadLibraryPaths();

                              await reloadCurrentLocalTrackSource();

                            } catch (error) {
                              telemetry.error('music-library.paths.rescan.failed', {
                                message: readTelemetryErrorMessage(error),
                                fields: {
                                  sourceId: path.id,
                                  path: path.path,
                                },
                              });

                            } finally {

                              releaseProtection();

                            }

                          }}

                          disabled={scanProgress?.isScanning}

                          title={t('pages.music-library.pathsManager.path.rescanTitle')}
                          aria-label={t('pages.music-library.pathsManager.path.rescanTitle')}

                        >

                          <svg
                            viewBox="0 0 24 24"
                            className="path-item-action-icon"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                            <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" />
                            <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
                          </svg>

                        </button>

                        <button

                          className="path-item-action-btn path-item-remove"

                          onClick={async () => {

                            const releaseProtection = beginAudioProtection('music-library-remove-path', 20_000);

                            try {

                              await musicLibraryService.removeLibraryPath(path.id);

                              await Promise.all([loadLibraryPaths(), reloadCurrentLocalTrackSource()]);

                            } finally {

                              releaseProtection();

                            }

                          }}

                          title={t('pages.music-library.pathsManager.path.removeTitle')}
                          aria-label={t('pages.music-library.pathsManager.path.removeTitle')}

                        >

                          <svg
                            viewBox="0 0 24 24"
                            className="path-item-action-icon"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                            <path d="M4 7h16" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                            <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
                            <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
                          </svg>

                        </button>

                      </div>

                    </div>

                    );

                  })}

                </div>

              )}

        </PmpDialog>
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

