import { Track } from '../audio';
import { parseAudioFile } from '../../utils/audioMetadata';
import { open } from '@tauri-apps/api/dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { readDir, exists } from '@tauri-apps/api/fs';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { readJson } from '../../modules/storage';
import { PMP_STORAGE_CHANGE_EVENT, type PmpStorageChangeDetail } from '../../modules/storage/localStorage';
import {
  cleanupNativeLibrarySourceTracks,
  clearNativeLibrarySyncFailedSources,
  clearNativeLibraryTracks,
  deleteNativeLibraryUserEntry,
  deleteNativeLibraryTracks,
  generateNativeBilibiliQrCodeSession,
  getNativeBilibiliAuthStatus,
  getNativeLibrarySyncFailureOverview,
  getNativeLibrarySyncSchedulerStatus,
  getNativeLibrarySyncStatus,
  getNativeLibraryStats,
  listNativeLibraryCloudHashJobs,
  listNativeLibraryFallbackTasks,
  getNativeLibrarySchemaEnvelope,
  parseNativeLibrarySchemaChangedEventPayload,
  markNativeLibraryTrackPlayed,
  markNativeLibraryUserEntryPlayed,
  listNativeLibrarySourceHealth,
  listNativeLibraryFacetEntries,
  listNativeLibrarySources,
  listNativeLibraryUserEntries,
  queryNativeLibraryTracks,
  queryNativeLibraryTracksPage,
  getMusicLibraryFacetCollectionDescriptor,
  registerMusicLibrarySchemaFromNativeEnvelope,
  resolveMusicLibraryFieldFacetDescriptor,
  removeNativeLibrarySource,
  retryNativeLibrarySyncFailedSources,
  runNativeLibrarySyncTick,
  syncNativeLibraryTracks,
  startNativeLibrarySyncScheduler,
  stopNativeLibrarySyncScheduler,
  pollNativeBilibiliQrCodeSession,
  logoutNativeBilibili,
  updateNativeLibraryCloudHashJobStatus,
  updateNativeLibraryFallbackTaskStatus,
  upsertNativeLibraryCloudHashJob,
  upsertNativeLibraryFallbackTask,
  upsertNativeLibrarySource,
  upsertNativeLibraryUserEntry,
  type NativeLibraryAlbumRecord,
  type NativeBilibiliAuthStatus,
  type NativeBilibiliQrCodeSession,
  type NativeBilibiliQrPollResult,
  type NativeLibraryCloudHashJobQuery,
  type NativeLibraryCloudHashJobRecord,
  type NativeLibrarySyncSchedulerStatus,
  type NativeLibrarySyncFailureOverview,
  type NativeLibrarySyncClearResult,
  type NativeLibrarySyncRetryResult,
  type NativeLibrarySyncStatus,
  type NativeLibrarySyncTickResult,
  type NativeLibrarySourceHealthRecord,
  type NativeLibrarySourceRecord,
  type NativeLibraryStatsRecord,
  type NativeLibraryFallbackTaskQuery,
  type NativeLibraryFallbackTaskRecord,
  type NativeLibraryTrackRecord,
  type NativeLibraryTrackFilterInput,
  type NativeLibraryTrackFilterGroupInput,
  type NativeLibrarySchemaChangedEventPayload,
  type NativeLibrarySchemaEnvelope,
  type NativeLibraryTrackFieldCatalogRecord,
  type NativeLibraryTrackSortInput,
  type NativeLibraryTrackUpsertInput,
  type NativeLibraryUserEntryQuery,
  type NativeLibraryUserEntryRecord,
  type MusicLibraryCollectionFacetDescriptor,
} from '../../modules/music-library';
import {
  canUseNativeBaseFilter,
  canUseNativeBaseFilterGroup,
  canUseNativeBaseOrderRule,
  type MusicLibraryBaseField,
  type MusicLibraryBaseGroupRule,
  type MusicLibraryBaseFilter,
  type MusicLibraryBaseQuery,
  type MusicLibraryBaseSortRule,
  type MusicLibraryBaseSortField,
} from '../../modules/music-library/baseQuery';
import {
  getMusicLibraryBaseNativeFilterField,
  getMusicLibraryBaseNativeSortField,
  getMusicLibraryBaseFieldCapability,
} from '../../modules/music-library/fieldCapabilities';
import { compactTrackForMusicLibrary } from '../../modules/music-library/trackProjection';
import { STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import {
  recordCoverBlobUrlsReleased,
  recordCoverResolveCacheHit,
  recordCoverResolveCacheMiss,
  recordCoverResolveLookupRequest,
} from './audioPerformanceTelemetry';
import {
  getCloudPlaybackFallbackAdapter,
  type CloudPlaybackFallbackDispatchResult,
  type CloudPlaybackFallbackRequest,
} from './cloudPlaybackFallbackAdapter';
import {
  listMusicSourceFacadeItems,
  searchMusicSourceTracks,
  type MusicSourceFacadeItem,
  type MusicSourceTrackCandidate,
} from './musicSourceFacade';

// 音乐库数据库版本
const DB_VERSION = 5;
const DB_NAME = 'MusicLibrary';

const NATIVE_LIST_PROJECTION_FIELD_IDS = new Set<MusicLibraryBaseField>([
  'title',
  'artist',
  'album',
  'genre',
  'year',
  'format',
  'duration',
  'sampleRate',
  'fileSize',
  'dateAdded',
  'lastPlayed',
  'playCount',
]);

// 库统计信息
export interface LibraryStats {
  totalTracks: number;
  totalArtists: number;
  totalAlbums: number;
  totalSize: number;
  totalDuration: number;
}

export interface LibraryPathHealth {
  sourceId: string;
  sourcePath: string;
  sourceDisplayName?: string;
  totalTracks: number;
  availableTracks: number;
  missingTracks: number;
  totalArtists: number;
  totalAlbums: number;
  totalSize: number;
  sourceUpdatedAtMs: number;
  lastTrackUpdatedAtMs?: number;
}

export interface LocalPlaybackResolveInput {
  trackId?: string;
  quickFingerprint?: string;
  filePath?: string;
  sourceId?: string;
  includeMissing?: boolean;
  visibleOnly?: boolean;
}

export interface LocalPlaybackResolveResult {
  track: Track | null;
  strategy: 'trackId' | 'quickFingerprint' | 'filePath' | 'none';
  requiresNetworkFallback: boolean;
}

export interface CloudLibraryPlaybackBlueprint {
  entryId: string;
  ownerUid: string;
  cloudContentId?: string;
  trackId?: string;
  quickFingerprint?: string;
  filePath?: string;
  sourceId?: string;
  includeMissing?: boolean;
  visibleOnly?: boolean;
}

export type CloudLibraryNetworkFallbackRequest = CloudPlaybackFallbackRequest;

export interface CloudLibraryPlaybackPlan {
  entryId: string;
  ownerUid: string;
  local: LocalPlaybackResolveResult;
  strategy: 'local-trackId' | 'local-quickFingerprint' | 'local-filePath' | 'network-blueprint';
  networkFallback?: CloudLibraryNetworkFallbackRequest;
  fallbackDispatch?: CloudPlaybackFallbackDispatchResult;
}

export type UnifiedMusicSource = MusicSourceFacadeItem;
export type UnifiedTrackCandidate = MusicSourceTrackCandidate;
export type BilibiliAuthStatus = NativeBilibiliAuthStatus;
export type BilibiliQrCodeSession = NativeBilibiliQrCodeSession;
export type BilibiliQrPollResult = NativeBilibiliQrPollResult;

export type CloudFallbackTaskStatus =
  | 'queued'
  | 'dispatching'
  | 'resolved'
  | 'failed'
  | 'cancelled';

export type CloudHashJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface CloudLibraryEntryUpsertInput {
  entryId: string;
  ownerUid: string;
  trackId?: string;
  quickFingerprint?: string;
  cloudContentId?: string;
  displayTitle?: string;
  displayArtist?: string;
  rating?: number;
  tagsJson?: string;
  inCloud?: boolean;
  isMissing?: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
}

export interface CloudLibraryEntryQuery {
  ownerUid?: string;
  limit?: number;
  offset?: number;
  inCloudOnly?: boolean;
  includeMissing?: boolean;
  searchQuery?: string;
}

export interface CloudFallbackTaskQuery {
  ownerUid?: string;
  status?: CloudFallbackTaskStatus;
  limit?: number;
  offset?: number;
}

export interface CloudHashJobQuery {
  ownerUid?: string;
  status?: CloudHashJobStatus;
  limit?: number;
  offset?: number;
}

export interface CloudHashJobUpsertInput {
  jobId?: string;
  ownerUid: string;
  entryId: string;
  trackId?: string;
  quickFingerprint?: string;
  status?: CloudHashJobStatus;
  cloudFullHash?: string;
  lastError?: string;
  requestedAtMs?: number;
}

export interface AlbumSummary {
  album: string;
  artist: string;
  cover?: string;
  coverTrackPath?: string;
  coverTrackId?: string;
}

// 库路径信息
export interface LibraryPath {
  id: string;
  path: string;
  addedAt: Date;
  lastScanned?: Date;
  trackCount: number;
  isVisible: boolean;
  isScanned: boolean;
  folderHandle?: FileSystemDirectoryHandle; // ✅ 存储文件夹句柄用于权限管理
}

// 扫描进度信息
type StoredLibraryPathRecord = Omit<LibraryPath, 'addedAt' | 'lastScanned'> & {
  addedAt?: number;
  lastScanned?: number;
};

type StoredTrackRecord = Omit<Track, 'addedAt'> & { addedAt?: number };

type PathVisibilityContext = {
  visiblePathIds: Set<string>;
  hiddenPathPrefixes: string[];
};

export interface ScanProgress {
  total: number;
  current: number;
  currentFile?: string;
  isScanning: boolean;
  progress?: number; // 进度百分比
  speed?: number; // 扫描速度（文件/秒）
  remaining?: number; // 预计剩余时间（秒）
}

// 视图类型
export type ViewMode = 'artists' | 'albums' | 'folders' | 'genres' | 'years' | 'all';

// 排序选项
export type SortBy = 'title' | 'artist' | 'album' | 'duration' | 'addedAt' | 'year';

export interface LocalBaseTracksQuery {
  searchQuery?: string;
  baseQuery: MusicLibraryBaseQuery;
  limit?: number;
  offset?: number;
  includeMissing?: boolean;
  visibleOnly?: boolean;
}

export interface LocalBaseTracksPageResult {
  tracks: Track[];
  total: number;
}

export type CoverRuntimeCachePolicy = 'default' | 'watch' | 'high' | 'critical' | 'hidden';
export type CoverSizeHint = 'small' | 'medium' | 'large';

export class MusicLibraryService {
  private static instance: MusicLibraryService;
  private static startupRefreshScheduled: boolean = false;
  private db: IDBDatabase | null = null;
  private scanProgressListeners: Set<(progress: ScanProgress) => void> = new Set();
  private isScanning: boolean = false;
  private coverUrlCache: Map<string, string> = new Map();
  private coverBlobUrlCache: Map<string, { url: string; bytes: number }> = new Map();
  private coverBlobUrlTotalBytes: number = 0;
  private coverDecodedEstimateBytes: Map<string, number> = new Map();
  private coverDecodedEstimateTotalBytes: number = 0;
  private coverUrlInflight: Map<string, Promise<string | undefined>> = new Map();
  private albumCoverUrlCache: Map<string, string> = new Map();
  private albumCoverUrlInflight: Map<string, Promise<string | undefined>> = new Map();
  private legacyCoverUrlDropIds: Set<string> = new Set();
  private legacyCoverUrlDropScheduled = false;
  private legacyCoverUrlDropInFlight = false;
  private readonly DEFAULT_COVER_URL_CACHE_MAX_ENTRIES = 320;
  private readonly DEFAULT_ALBUM_COVER_URL_CACHE_MAX_ENTRIES = 96;
  private readonly DEFAULT_COVER_CACHE_MAX_BYTES = 80 * 1024 * 1024;
  private readonly DEFAULT_COVER_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  private readonly DEFAULT_COVER_BLOB_CACHE_MAX_BYTES = 12 * 1024 * 1024;
  private readonly DEFAULT_COVER_DECODED_ESTIMATE_MAX_ENTRIES = 160;
  private readonly DEFAULT_COVER_DECODED_ESTIMATE_MAX_BYTES = 36 * 1024 * 1024;

  private COVER_URL_CACHE_MAX_ENTRIES = this.DEFAULT_COVER_URL_CACHE_MAX_ENTRIES;
  private ALBUM_COVER_URL_CACHE_MAX_ENTRIES = this.DEFAULT_ALBUM_COVER_URL_CACHE_MAX_ENTRIES;
  private COVER_CACHE_MAX_BYTES = this.DEFAULT_COVER_CACHE_MAX_BYTES;
  private COVER_MAX_IMAGE_BYTES = this.DEFAULT_COVER_MAX_IMAGE_BYTES;
  private COVER_BLOB_CACHE_MAX_BYTES = this.DEFAULT_COVER_BLOB_CACHE_MAX_BYTES;
  private COVER_DECODED_ESTIMATE_MAX_ENTRIES = this.DEFAULT_COVER_DECODED_ESTIMATE_MAX_ENTRIES;
  private COVER_DECODED_ESTIMATE_MAX_BYTES = this.DEFAULT_COVER_DECODED_ESTIMATE_MAX_BYTES;

  private currentCoverRuntimeCachePolicy: CoverRuntimeCachePolicy = 'default';
  private coverMaxEdgePx: number = 256;
  private nativeSourceBootstrapScheduled = false;
  private readonly NATIVE_SCHEMA_ENVELOPE_CACHE_TTL_MS = 60_000;
  private readonly NATIVE_SCHEMA_ENVELOPE_STALE_RETRY_MS = 10_000;
  private nativeSchemaEnvelopeLoadPromise: Promise<NativeLibrarySchemaEnvelope | null> | null = null;
  private nativeSchemaEnvelopeCache: NativeLibrarySchemaEnvelope | null = null;
  private nativeSchemaEnvelopeCacheExpiresAtMs = 0;
  private nativeSchemaEnvelopeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private nativeSchemaChangeUnlistenPromise: Promise<UnlistenFn | null> | null = null;

  // 缓存 - 减少数据库查询
  private cachedStats: LibraryStats | null = null;
  private cacheTimestamp: number = 0;
  private CACHE_TTL = 5000; // 5秒缓存

  private constructor() {
    void this.initDB().catch((error) => {
      console.warn('[MusicLibraryService] initDB failed:', error);
    });
    this.coverMaxEdgePx = this.readCoverMaxEdgePxSetting();
    this.setupCoverSettingsListener();
    this.setupCoverVisibilityReclaimListener();
    this.setupNativeSchemaEnvelopeListener();
    this.scheduleNativeSourceBootstrap();
    this.scheduleStartupRefresh();
  }

  private readCoverMaxEdgePxSetting(): number {
    try {
      const value = readJson<number>(STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX, 256);
      const resolved = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 256;
      if (resolved <= 0) return 0;
      return resolved;
    } catch {
      return 256;
    }
  }

  private setupCoverSettingsListener(): void {
    if (typeof window === 'undefined') return;

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<PmpStorageChangeDetail>).detail;
      if (!detail || detail.key !== STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX) return;

      this.coverMaxEdgePx = this.readCoverMaxEdgePxSetting();
    };

    window.addEventListener(PMP_STORAGE_CHANGE_EVENT, handler as EventListener);
  }

  private setupCoverVisibilityReclaimListener(): void {
    if (typeof window === 'undefined') return;

    const onVisibilityChange = () => {
      if (!document.hidden) return;
      this.applyCoverRuntimeCachePolicy('hidden');
    };

    window.addEventListener('visibilitychange', onVisibilityChange);
  }

  private setupNativeSchemaEnvelopeListener(): void {
    if (!isTauriRuntime()) return;
    if (this.nativeSchemaChangeUnlistenPromise) return;

    this.nativeSchemaChangeUnlistenPromise = listen(
      TAURI_EVENTS.MUSIC_LIBRARY_SCHEMA_CHANGED,
      (event) => {
        const payload = parseNativeLibrarySchemaChangedEventPayload(event.payload);
        if (!payload) return;
        this.handleNativeSchemaChangedEvent(payload);
      }
    ).catch((error) => {
      this.nativeSchemaChangeUnlistenPromise = null;
      console.warn('[MusicLibraryService] failed to subscribe native schema change events:', error);
      return null;
    });
  }

  private handleNativeSchemaChangedEvent(payload: NativeLibrarySchemaChangedEventPayload): void {
    if (
      this.nativeSchemaEnvelopeCache?.schemaFingerprint &&
      this.nativeSchemaEnvelopeCache.schemaFingerprint === payload.schemaFingerprint
    ) {
      this.nativeSchemaEnvelopeCacheExpiresAtMs =
        Date.now() + this.NATIVE_SCHEMA_ENVELOPE_CACHE_TTL_MS;
      return;
    }

    this.scheduleNativeSchemaEnvelopeRefresh(payload.reason);
  }

  private scheduleNativeSchemaEnvelopeRefresh(reason: string): void {
    if (this.nativeSchemaEnvelopeRefreshTimer !== null) {
      clearTimeout(this.nativeSchemaEnvelopeRefreshTimer);
    }

    this.nativeSchemaEnvelopeRefreshTimer = setTimeout(() => {
      this.nativeSchemaEnvelopeRefreshTimer = null;
      void this.refreshNativeSchemaEnvelope().catch((error) => {
        console.warn(
          `[MusicLibraryService] failed to refresh native schema envelope after ${reason}:`,
          error
        );
      });
    }, 120);
  }

  private getPolicyLimits(policy: CoverRuntimeCachePolicy): {
    coverUrlCacheMaxEntries: number;
    albumCoverUrlCacheMaxEntries: number;
    coverBlobCacheMaxBytes: number;
    coverDecodedEstimateMaxEntries: number;
    coverDecodedEstimateMaxBytes: number;
    coverCacheMaxBytes: number;
    coverMaxImageBytes: number;
  } {
    const defaults = {
      coverUrlCacheMaxEntries: this.DEFAULT_COVER_URL_CACHE_MAX_ENTRIES,
      albumCoverUrlCacheMaxEntries: this.DEFAULT_ALBUM_COVER_URL_CACHE_MAX_ENTRIES,
      coverBlobCacheMaxBytes: this.DEFAULT_COVER_BLOB_CACHE_MAX_BYTES,
      coverDecodedEstimateMaxEntries: this.DEFAULT_COVER_DECODED_ESTIMATE_MAX_ENTRIES,
      coverDecodedEstimateMaxBytes: this.DEFAULT_COVER_DECODED_ESTIMATE_MAX_BYTES,
      coverCacheMaxBytes: this.DEFAULT_COVER_CACHE_MAX_BYTES,
      coverMaxImageBytes: this.DEFAULT_COVER_MAX_IMAGE_BYTES,
    };

    switch (policy) {
      case 'watch':
        return {
          ...defaults,
          coverUrlCacheMaxEntries: 256,
          albumCoverUrlCacheMaxEntries: 72,
          coverBlobCacheMaxBytes: 8 * 1024 * 1024,
          coverDecodedEstimateMaxEntries: 128,
          coverDecodedEstimateMaxBytes: 24 * 1024 * 1024,
          coverCacheMaxBytes: 64 * 1024 * 1024,
        };
      case 'high':
        return {
          ...defaults,
          coverUrlCacheMaxEntries: 192,
          albumCoverUrlCacheMaxEntries: 56,
          coverBlobCacheMaxBytes: 6 * 1024 * 1024,
          coverDecodedEstimateMaxEntries: 96,
          coverDecodedEstimateMaxBytes: 16 * 1024 * 1024,
          coverCacheMaxBytes: 48 * 1024 * 1024,
          coverMaxImageBytes: 3 * 1024 * 1024,
        };
      case 'critical':
        return {
          ...defaults,
          coverUrlCacheMaxEntries: 128,
          albumCoverUrlCacheMaxEntries: 40,
          coverBlobCacheMaxBytes: 4 * 1024 * 1024,
          coverDecodedEstimateMaxEntries: 64,
          coverDecodedEstimateMaxBytes: 10 * 1024 * 1024,
          coverCacheMaxBytes: 32 * 1024 * 1024,
          coverMaxImageBytes: 2 * 1024 * 1024,
        };
      case 'hidden':
        return {
          ...defaults,
          coverUrlCacheMaxEntries: 32,
          albumCoverUrlCacheMaxEntries: 16,
          coverBlobCacheMaxBytes: 1 * 1024 * 1024,
          coverDecodedEstimateMaxEntries: 16,
          coverDecodedEstimateMaxBytes: 2 * 1024 * 1024,
          coverCacheMaxBytes: 16 * 1024 * 1024,
          coverMaxImageBytes: Math.floor(1.5 * 1024 * 1024),
        };
      case 'default':
      default:
        return defaults;
    }
  }

  private pruneCoverDecodedEstimateCacheByPolicy(): void {
    while (
      this.coverDecodedEstimateBytes.size > this.COVER_DECODED_ESTIMATE_MAX_ENTRIES ||
      this.coverDecodedEstimateTotalBytes > this.COVER_DECODED_ESTIMATE_MAX_BYTES
    ) {
      const oldestUrl = this.coverDecodedEstimateBytes.keys().next().value as string | undefined;
      if (!oldestUrl) break;
      this.evictCoverUrlFromRuntimeCaches(oldestUrl);

      if (this.coverDecodedEstimateBytes.has(oldestUrl)) {
        const oldestBytes = this.coverDecodedEstimateBytes.get(oldestUrl);
        this.coverDecodedEstimateBytes.delete(oldestUrl);
        if (typeof oldestBytes === 'number') {
          this.coverDecodedEstimateTotalBytes = Math.max(
            0,
            this.coverDecodedEstimateTotalBytes - oldestBytes
          );
        }
      }
    }
  }

  private enforceRuntimeCacheBudgets(): void {
    this.pruneUrlCaches();

    while (
      this.coverBlobUrlTotalBytes > this.COVER_BLOB_CACHE_MAX_BYTES &&
      this.coverBlobUrlCache.size > 0
    ) {
      const oldestKey = this.coverBlobUrlCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.evictCoverBlobCacheEntry(oldestKey);
    }

    this.pruneCoverDecodedEstimateCacheByPolicy();
  }

  applyCoverRuntimeCachePolicy(policy: CoverRuntimeCachePolicy): void {
    const next = this.getPolicyLimits(policy);

    this.currentCoverRuntimeCachePolicy = policy;
    this.COVER_URL_CACHE_MAX_ENTRIES = next.coverUrlCacheMaxEntries;
    this.ALBUM_COVER_URL_CACHE_MAX_ENTRIES = next.albumCoverUrlCacheMaxEntries;
    this.COVER_BLOB_CACHE_MAX_BYTES = next.coverBlobCacheMaxBytes;
    this.COVER_DECODED_ESTIMATE_MAX_ENTRIES = next.coverDecodedEstimateMaxEntries;
    this.COVER_DECODED_ESTIMATE_MAX_BYTES = next.coverDecodedEstimateMaxBytes;
    this.COVER_CACHE_MAX_BYTES = next.coverCacheMaxBytes;
    this.COVER_MAX_IMAGE_BYTES = next.coverMaxImageBytes;

    this.enforceRuntimeCacheBudgets();
  }

  private stableIdFromPath(path: string): string {
    const normalized = path.replace(/\\/g, '/').toLowerCase();
    let hash = 2166136261;
    for (let i = 0; i < normalized.length; i++) {
      hash ^= normalized.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `track-${(hash >>> 0).toString(16)}`;
  }

  private normalizePathForCompare(path: string): string {
    return path.replace(/\\/g, '/').toLowerCase();
  }

  private sanitizeQuickFingerprint(raw: unknown): string | undefined {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!value) return undefined;

    const normalized = value.replace(/^qf2:/, '');
    if (!/^[0-9a-f]{16,128}$/.test(normalized)) return undefined;
    return `qf2:${normalized}`;
  }

  private sanitizeTrackRecordForStorage(track: StoredTrackRecord): StoredTrackRecord {
    const next: StoredTrackRecord = { ...track };

    delete (next as unknown as { file?: unknown }).file;
    delete (next as unknown as { fileContent?: unknown }).fileContent;

    const pathCandidate =
      typeof next.filePath === 'string' && next.filePath
        ? next.filePath
        : typeof next.path === 'string' && next.path
          ? next.path
          : undefined;

    if (pathCandidate) {
      next.filePath = pathCandidate;
      next.path = pathCandidate;
    }

    if (isTauriRuntime() && pathCandidate && this.isLikelyAbsolutePath(pathCandidate)) {
      delete (next as unknown as { fileHandle?: unknown }).fileHandle;
    }

    const coverUrl = typeof next.coverUrl === 'string' ? next.coverUrl.trim() : '';
    if (coverUrl) {
      const lower = coverUrl.toLowerCase();
      const isEphemeral =
        lower.startsWith('data:') ||
        lower.startsWith('blob:') ||
        lower.startsWith('asset:') ||
        lower.startsWith('tauri:') ||
        lower.includes('music-covers');
      const isAbsolutePath = Boolean(pathCandidate && this.isLikelyAbsolutePath(pathCandidate));
      if (isEphemeral && isAbsolutePath) {
        delete next.coverUrl;
      }
    }

    const quickFingerprint = this.sanitizeQuickFingerprint(next.quickFingerprint);
    if (quickFingerprint) {
      next.quickFingerprint = quickFingerprint;
    } else {
      delete (next as unknown as { quickFingerprint?: unknown }).quickFingerprint;
    }

    return next;
  }

  private getSourceDisplayName(pathValue: string): string {
    const trimmed = pathValue.trim();
    if (!trimmed) return '';
    const segments = trimmed.split(/[/\\]+/).filter(Boolean);
    if (segments.length === 0) return trimmed;
    return segments[segments.length - 1] || trimmed;
  }

  private async tryUpsertNativeLibrarySource(pathInfo: LibraryPath): Promise<void> {
    if (!isTauriRuntime()) return;
    const sourceId = String(pathInfo.id || '').trim();
    const sourcePath = String(pathInfo.path || '').trim();
    if (!sourceId || !sourcePath) return;

    try {
      await upsertNativeLibrarySource({
        id: sourceId,
        path: sourcePath,
        displayName: this.getSourceDisplayName(sourcePath),
        category: 'music',
        isVisible: pathInfo.isVisible !== false,
        isScanned: pathInfo.isScanned !== false,
        addedAtMs: pathInfo.addedAt instanceof Date ? pathInfo.addedAt.getTime() : Date.now(),
        lastScannedAtMs:
          pathInfo.lastScanned instanceof Date ? pathInfo.lastScanned.getTime() : undefined,
      });
    } catch (error) {
      console.warn('[MusicLibraryService] failed to sync native source:', sourceId, error);
    }
  }

  private async tryRemoveNativeLibrarySource(pathId: string): Promise<void> {
    if (!isTauriRuntime()) return;
    const sourceId = String(pathId || '').trim();
    if (!sourceId) return;
    try {
      await removeNativeLibrarySource(sourceId);
    } catch (error) {
      console.warn('[MusicLibraryService] failed to remove native source:', sourceId, error);
    }
  }

  private toNativeTrackUpsertInput(track: StoredTrackRecord): NativeLibraryTrackUpsertInput | null {
    const trackId = String(track.id || '').trim();
    const filePath = String(track.filePath || track.path || '').trim();
    if (!trackId || !filePath) return null;

    const quickFingerprint = this.sanitizeQuickFingerprint(track.quickFingerprint);

    const bitDepth =
      typeof (track as unknown as { bitDepth?: unknown }).bitDepth === 'number'
        ? ((track as unknown as { bitDepth: number }).bitDepth as number)
        : undefined;

    return {
      id: trackId,
      filePath,
      quickFingerprint,
      title: typeof track.title === 'string' ? track.title : undefined,
      artist: typeof track.artist === 'string' ? track.artist : undefined,
      album: typeof track.album === 'string' ? track.album : undefined,
      genre: typeof track.genre === 'string' ? track.genre : undefined,
      year: typeof track.year === 'number' ? Math.floor(track.year) : undefined,
      format: typeof track.format === 'string' ? track.format : undefined,
      duration: typeof track.duration === 'number' ? track.duration : undefined,
      sampleRate: typeof track.sampleRate === 'number' ? track.sampleRate : undefined,
      bitDepth,
      fileSize: typeof track.fileSize === 'number' ? track.fileSize : undefined,
      mtimeMs: typeof track.mtimeMs === 'number' ? track.mtimeMs : undefined,
      replayGainTrackDb:
        typeof track.replayGainTrackGainDb === 'number' ? track.replayGainTrackGainDb : undefined,
      replayGainAlbumDb:
        typeof track.replayGainAlbumGainDb === 'number' ? track.replayGainAlbumGainDb : undefined,
    };
  }

  private async trySyncNativeLibraryTracks(
    sourceId: string | undefined,
    upserts: StoredTrackRecord[],
    missingTrackIds: string[]
  ): Promise<void> {
    if (!isTauriRuntime()) return;
    const normalizedSourceId = String(sourceId || '').trim();
    if (!normalizedSourceId) return;

    const upsertPayload = upserts
      .filter((item) => {
        const itemSourceId = String(item.libraryPathId || '').trim();
        if (!itemSourceId) return true;
        return itemSourceId === normalizedSourceId;
      })
      .map((item) => this.toNativeTrackUpsertInput(item))
      .filter((item): item is NativeLibraryTrackUpsertInput => Boolean(item));

    const normalizedMissingIds = missingTrackIds
      .map((id) => String(id || '').trim())
      .filter((id) => id.length > 0);

    if (upsertPayload.length === 0 && normalizedMissingIds.length === 0) return;

    const chunkSize = 500;
    for (let index = 0; index < upsertPayload.length; index += chunkSize) {
      const chunk = upsertPayload.slice(index, index + chunkSize);
      const missing = index === 0 ? normalizedMissingIds : [];
      try {
        await syncNativeLibraryTracks(normalizedSourceId, chunk, missing);
      } catch (error) {
        console.warn('[MusicLibraryService] failed to sync native tracks:', normalizedSourceId, error);
        return;
      }
    }

    if (upsertPayload.length === 0 && normalizedMissingIds.length > 0) {
      try {
        await syncNativeLibraryTracks(normalizedSourceId, [], normalizedMissingIds);
      } catch (error) {
        console.warn('[MusicLibraryService] failed to sync native missing tracks:', normalizedSourceId, error);
      }
    }
  }

  private copyDynamicTrackFields(
    source: Record<string, unknown> | undefined,
    target: Record<string, unknown>,
    options?: { skipKeys?: string[] }
  ): void {
    if (!source) return;

    const skipKeys = new Set(options?.skipKeys ?? []);
    for (const [key, value] of Object.entries(source)) {
      if (skipKeys.has(key) || key in target) {
        continue;
      }

      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          target[key] = trimmed;
        }
        continue;
      }

      if (typeof value === 'number') {
        if (Number.isFinite(value)) {
          target[key] = value;
        }
        continue;
      }

      if (typeof value === 'boolean') {
        target[key] = value;
        continue;
      }

      if (Array.isArray(value)) {
        const normalized = value.filter(
          (item) =>
            typeof item === 'string' ||
            (typeof item === 'number' && Number.isFinite(item)) ||
            typeof item === 'boolean'
        );
        if (normalized.length > 0) {
          target[key] = normalized;
        }
      }
    }
  }

  private mapNativeTrackRecordToStoredTrack(record: NativeLibraryTrackRecord): StoredTrackRecord {
    const normalizedTitle =
      typeof record.title === 'string' && record.title.trim().length > 0
        ? record.title
        : record.filePath.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || 'Unknown';

    const createdAtMs =
      typeof record.createdAtMs === 'number' && Number.isFinite(record.createdAtMs)
        ? record.createdAtMs
        : record.updatedAtMs;

    const mapped: StoredTrackRecord = {
      id: record.id,
      path: record.filePath,
      filePath: record.filePath,
      title: normalizedTitle,
      artist: record.artist,
      album: record.album,
      genre: record.genre,
      year: record.year,
      format: record.format,
      duration: record.durationSeconds,
      sampleRate: record.sampleRate,
      fileSize: record.fileSize,
      mtimeMs: record.mtimeMs,
      quickFingerprint: this.sanitizeQuickFingerprint(record.quickFingerprint),
      libraryPathId: record.sourceId,
      replayGainTrackGainDb: record.replayGainTrackDb,
      replayGainAlbumGainDb: record.replayGainAlbumDb,
      metadataScannedAtMs: record.updatedAtMs,
      dateAdded: createdAtMs,
      addedAt: createdAtMs,
      playCount: record.playCount,
      lastPlayed: record.lastPlayedAtMs,
    };

    if (typeof record.bitDepth === 'number' && Number.isFinite(record.bitDepth)) {
      (mapped as unknown as { bitDepth?: number }).bitDepth = record.bitDepth;
    }

    const mappedDynamicFields = mapped as unknown as Record<string, unknown>;
    mappedDynamicFields.status = record.status;
    if (typeof record.createdAtMs === 'number' && Number.isFinite(record.createdAtMs)) {
      mappedDynamicFields.createdAtMs = record.createdAtMs;
    }
    mappedDynamicFields.updatedAtMs = record.updatedAtMs;
    if (typeof record.lastSeenAtMs === 'number' && Number.isFinite(record.lastSeenAtMs)) {
      mappedDynamicFields.lastSeenAtMs = record.lastSeenAtMs;
    }

    this.copyDynamicTrackFields(record.extraFields, mapped as unknown as Record<string, unknown>, {
      skipKeys: ['status', 'createdAtMs', 'updatedAtMs', 'lastSeenAtMs'],
    });

    return mapped;
  }

  private mapNativeTrackRecordToListTrack(record: NativeLibraryTrackRecord): Track {
    return compactTrackForMusicLibrary(
      this.restoreTrackForPlayback(this.mapNativeTrackRecordToStoredTrack(record))
    );
  }

  private isFieldCoveredByNativeListProjection(field: MusicLibraryBaseField): boolean {
    const capability = getMusicLibraryBaseFieldCapability(field);
    if (!capability) return false;
    if (capability.source !== 'builtin') return false;
    return NATIVE_LIST_PROJECTION_FIELD_IDS.has(capability.id as MusicLibraryBaseField);
  }

  private resolveNativeBaseQueryProjection(query: MusicLibraryBaseQuery): 'list' | 'full' {
    if (query.groupByRules.some((rule) => !this.isFieldCoveredByNativeListProjection(rule.field))) {
      return 'full';
    }

    return 'list';
  }

  private restoreTrackForListProjection(storedTrack: StoredTrackRecord): Track {
    return compactTrackForMusicLibrary(this.restoreTrackForPlayback(storedTrack));
  }

  async getLocalSchemaEnvelope(): Promise<NativeLibrarySchemaEnvelope | null> {
    if (!isTauriRuntime()) return null;
    return getNativeLibrarySchemaEnvelope();
  }

  private isNativeSchemaEnvelopeCacheFresh(nowMs = Date.now()): boolean {
    return !!this.nativeSchemaEnvelopeCache && nowMs < this.nativeSchemaEnvelopeCacheExpiresAtMs;
  }

  private isSameNativeSchemaEnvelope(
    previous: NativeLibrarySchemaEnvelope,
    next: NativeLibrarySchemaEnvelope
  ): boolean {
    if (previous.schemaFingerprint && next.schemaFingerprint) {
      return previous.schemaFingerprint === next.schemaFingerprint;
    }

    if (previous.schemaVersion !== next.schemaVersion) {
      return false;
    }

    if (previous.sourceTables.length !== next.sourceTables.length) {
      return false;
    }

    return previous.sourceTables.every((table, index) => {
      const candidate = next.sourceTables[index];
      return (
        candidate?.name === table.name &&
        candidate?.columnCount === table.columnCount &&
        candidate?.schemaHash === table.schemaHash
      );
    });
  }

  invalidateNativeSchemaEnvelopeCache(): void {
    this.nativeSchemaEnvelopeCacheExpiresAtMs = 0;
  }

  async refreshNativeSchemaEnvelope(): Promise<NativeLibrarySchemaEnvelope | null> {
    this.invalidateNativeSchemaEnvelopeCache();
    return this.loadAndRegisterNativeSchemaEnvelope({ force: true });
  }

  async listLocalTrackFieldCatalog(): Promise<NativeLibraryTrackFieldCatalogRecord[]> {
    const envelope = await this.loadAndRegisterNativeSchemaEnvelope();
    return envelope?.trackFields ?? [];
  }

  async listLocalFacetCollectionCatalog() {
    const envelope = await this.loadAndRegisterNativeSchemaEnvelope();
    return envelope?.facetCollections ?? [];
  }

  async loadAndRegisterNativeSchemaEnvelope(options?: {
    force?: boolean;
  }): Promise<NativeLibrarySchemaEnvelope | null> {
    if (!isTauriRuntime()) return null;

    const nowMs = Date.now();
    const cachedEnvelope = this.nativeSchemaEnvelopeCache;
    if (!options?.force && this.isNativeSchemaEnvelopeCacheFresh(nowMs)) {
      return cachedEnvelope;
    }
    if (this.nativeSchemaEnvelopeLoadPromise) {
      return this.nativeSchemaEnvelopeLoadPromise;
    }

    this.nativeSchemaEnvelopeLoadPromise = this.getLocalSchemaEnvelope()
      .then((envelope) => {
        if (!envelope) {
          return cachedEnvelope ?? null;
        }

        const schemaChanged =
          !cachedEnvelope || !this.isSameNativeSchemaEnvelope(cachedEnvelope, envelope);
        if (schemaChanged) {
          registerMusicLibrarySchemaFromNativeEnvelope(envelope);
        }
        this.nativeSchemaEnvelopeCache = envelope;
        this.nativeSchemaEnvelopeCacheExpiresAtMs =
          Date.now() + this.NATIVE_SCHEMA_ENVELOPE_CACHE_TTL_MS;
        return envelope;
      })
      .catch((error) => {
        if (cachedEnvelope) {
          console.warn(
            '[MusicLibraryService] failed to refresh native schema envelope, using stale cache:',
            error
          );
          this.nativeSchemaEnvelopeCacheExpiresAtMs =
            Date.now() + this.NATIVE_SCHEMA_ENVELOPE_STALE_RETRY_MS;
          return cachedEnvelope;
        }
        throw error;
      })
      .finally(() => {
        this.nativeSchemaEnvelopeLoadPromise = null;
      });

    return this.nativeSchemaEnvelopeLoadPromise;
  }

  private async ensureNativeSchemaEnvelopeLoaded(): Promise<void> {
    try {
      await this.loadAndRegisterNativeSchemaEnvelope();
    } catch (error) {
      console.warn('[MusicLibraryService] failed to load native schema envelope:', error);
    }
  }

  private async resolveNativeFacetCollectionDescriptor(
    id: 'artists' | 'genres' | 'albums'
  ): Promise<MusicLibraryCollectionFacetDescriptor | null> {
    await this.ensureNativeSchemaEnvelopeLoaded();
    return getMusicLibraryFacetCollectionDescriptor(id);
  }

  private pickPreferredNativeTrackRecord(records: NativeLibraryTrackRecord[]): NativeLibraryTrackRecord | null {
    if (records.length === 0) return null;

    const absoluteAvailable = records.find(
      (record) =>
        record.status === 'available' &&
        typeof record.filePath === 'string' &&
        this.isLikelyAbsolutePath(record.filePath)
    );
    if (absoluteAvailable) return absoluteAvailable;

    const available = records.find((record) => record.status === 'available');
    if (available) return available;

    return records[0] || null;
  }

  private toNativeTrackFilterFromBase(
    filter: MusicLibraryBaseFilter
  ): NativeLibraryTrackFilterInput | null {
    const field = getMusicLibraryBaseNativeFilterField(filter.field);
    if (!field) return null;

    const operator = filter.operator;
    const normalizedValue = typeof filter.value === 'string' ? filter.value.trim() : '';
    const isNumericField = field === 'durationSeconds' || field === 'playCount';

    if (operator === 'is_empty' || operator === 'is_not_empty') {
      return { field, operator };
    }

    if (!normalizedValue) return null;

    if (isNumericField) {
      if (operator !== 'equals' && operator !== 'not_equals' && operator !== 'gte' && operator !== 'lte') {
        return null;
      }
      const numeric = Number(normalizedValue);
      if (!Number.isFinite(numeric)) return null;
      return {
        field,
        operator,
        value: String(numeric),
      };
    }

    if (operator !== 'contains' && operator !== 'equals' && operator !== 'not_equals') {
      return null;
    }

    return {
      field,
      operator,
      value: normalizedValue,
    };
  }

  private toNativeTrackSortFieldFromBase(
    field: MusicLibraryBaseSortField
  ): NativeLibraryTrackSortInput['field'] | null {
    if (field === 'default') return null;
    return getMusicLibraryBaseNativeSortField(field);
  }

  private buildNativeTrackSortFromBase(
    groupByRules: MusicLibraryBaseGroupRule[],
    sortRules: MusicLibraryBaseSortRule[]
  ): {
    groupBy?: NativeLibraryTrackSortInput[];
    sort?: NativeLibraryTrackSortInput[];
  } {
    const normalizedGroupBy: NativeLibraryTrackSortInput[] = [];
    const normalizedSort: NativeLibraryTrackSortInput[] = [];
    const seenFields = new Set<NativeLibraryTrackSortInput['field']>();

    for (const rule of groupByRules) {
      const mappedField = this.toNativeTrackSortFieldFromBase(rule.field);
      if (!mappedField) continue;
      if (seenFields.has(mappedField)) continue;
      seenFields.add(mappedField);

      normalizedGroupBy.push({
        field: mappedField,
        order: rule.order === 'desc' ? 'desc' : 'asc',
      });
    }

    for (const rule of sortRules) {
      const mappedField = this.toNativeTrackSortFieldFromBase(rule.field);
      if (!mappedField) continue;
      if (seenFields.has(mappedField)) continue;
      seenFields.add(mappedField);

      normalizedSort.push({
        field: mappedField,
        order: rule.order === 'desc' ? 'desc' : 'asc',
      });
    }

    return {
      groupBy: normalizedGroupBy.length > 0 ? normalizedGroupBy : undefined,
      sort: normalizedSort.length > 0 ? normalizedSort : undefined,
    };
  }

  async queryLocalTracksByBase(query: LocalBaseTracksQuery): Promise<Track[] | null> {
    const result = await this.queryLocalTracksPageByBase(query);
    return result?.tracks ?? null;
  }

  async queryLocalTracksPageByBase(
    query: LocalBaseTracksQuery
  ): Promise<LocalBaseTracksPageResult | null> {
    if (!isTauriRuntime()) return null;

    const normalizedBaseQuery: MusicLibraryBaseQuery = {
      filterOperator: query.baseQuery.filterOperator === 'or' ? 'or' : 'and',
      filterGroups: Array.isArray(query.baseQuery.filterGroups) ? query.baseQuery.filterGroups : [],
      groupByRules: Array.isArray(query.baseQuery.groupByRules) ? query.baseQuery.groupByRules : [],
      sortRules: Array.isArray(query.baseQuery.sortRules) ? query.baseQuery.sortRules : [],
    };

    const nativeFilterGroups: NativeLibraryTrackFilterGroupInput[] = [];
    for (const group of normalizedBaseQuery.filterGroups) {
      if (!canUseNativeBaseFilterGroup(group)) {
        return null;
      }

      const mappedFilters: NativeLibraryTrackFilterInput[] = [];
      for (const filter of group.filters) {
        if (!canUseNativeBaseFilter(filter)) {
          return null;
        }
        const mapped = this.toNativeTrackFilterFromBase(filter);
        if (!mapped) {
          return null;
        }
        mappedFilters.push(mapped);
      }

      if (mappedFilters.length > 0) {
        nativeFilterGroups.push({
          operator: group.operator === 'or' ? 'or' : 'and',
          filters: mappedFilters,
        });
      }
    }

    const nativeFilters =
      nativeFilterGroups.length > 0
        ? nativeFilterGroups.flatMap((group) => group.filters ?? [])
        : undefined;

    const invalidRule = [...normalizedBaseQuery.groupByRules, ...normalizedBaseQuery.sortRules].find(
      (rule) => !canUseNativeBaseOrderRule(rule)
    );
    if (invalidRule) {
      return null;
    }

    const nativeOrdering = this.buildNativeTrackSortFromBase(
      normalizedBaseQuery.groupByRules,
      normalizedBaseQuery.sortRules
    );

    const normalizedSearchQuery =
      typeof query.searchQuery === 'string' && query.searchQuery.trim().length > 0
        ? query.searchQuery.trim()
        : undefined;

    const normalizedLimit =
      typeof query.limit === 'number' && Number.isFinite(query.limit)
        ? Math.max(1, Math.min(2000, Math.floor(query.limit)))
        : 2000;

    const normalizedOffset =
      typeof query.offset === 'number' && Number.isFinite(query.offset)
        ? Math.max(0, Math.floor(query.offset))
        : 0;

    try {
      const projection = this.resolveNativeBaseQueryProjection(normalizedBaseQuery);

      const result = await queryNativeLibraryTracksPage({
        projection,
        includeMissing: query.includeMissing === true,
        visibleOnly: query.visibleOnly !== false,
        searchQuery: normalizedSearchQuery,
        baseQuery: {
          filterOperator: normalizedBaseQuery.filterOperator,
          filterGroups: nativeFilterGroups.length > 0 ? nativeFilterGroups : undefined,
          filters: nativeFilters,
          groupBy: nativeOrdering.groupBy,
          sort: nativeOrdering.sort,
        },
        limit: normalizedLimit,
        offset: normalizedOffset,
      });

      return {
        tracks: result.items.map((item) => this.mapNativeTrackRecordToListTrack(item)),
        total: Math.max(0, Math.floor(result.total)),
      };
    } catch (error) {
      console.warn('[MusicLibraryService] native base-track query failed:', error);
      return null;
    }
  }

  private async tryGetAllTracksFromNativeDb(limit?: number, offset?: number): Promise<Track[] | null> {
    if (!isTauriRuntime()) return null;

    const normalizedLimit =
      typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
    const normalizedOffset =
      typeof offset === 'number' && Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : undefined;

    try {
      const nativeTracks = await queryNativeLibraryTracks({
        projection: 'list',
        limit: normalizedLimit,
        offset: normalizedOffset,
        includeMissing: false,
        visibleOnly: true,
      });

      if (nativeTracks.length === 0) {
        return null;
      }

      return nativeTracks.map((item) => this.mapNativeTrackRecordToListTrack(item));
    } catch (error) {
      console.warn('[MusicLibraryService] native track query failed, fallback to IndexedDB:', error);
      return null;
    }
  }

  private async trySearchTracksFromNativeDb(query: string, limit?: number): Promise<Track[] | null> {
    if (!isTauriRuntime()) return null;

    const normalizedQuery = query.trim();
    if (!normalizedQuery) return null;

    const normalizedLimit =
      typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;

    try {
      const nativeTracks = await queryNativeLibraryTracks({
        projection: 'list',
        limit: normalizedLimit,
        offset: 0,
        includeMissing: false,
        visibleOnly: true,
        searchQuery: normalizedQuery,
      });

      if (nativeTracks.length === 0) {
        return null;
      }

      return nativeTracks.map((item) => this.mapNativeTrackRecordToListTrack(item));
    } catch (error) {
      console.warn('[MusicLibraryService] native search query failed, fallback to IndexedDB:', error);
      return null;
    }
  }

  private async tryGetTrackByIdFromNativeDb(trackId: string): Promise<Track | null> {
    if (!isTauriRuntime()) return null;
    const normalizedTrackId = trackId.trim();
    if (!normalizedTrackId) return null;

    try {
      const nativeTracks = await queryNativeLibraryTracks({
        limit: 1,
        offset: 0,
        includeMissing: true,
        visibleOnly: false,
        trackId: normalizedTrackId,
      });

      if (nativeTracks.length === 0) {
        return null;
      }

      return this.restoreTrackForPlayback(this.mapNativeTrackRecordToStoredTrack(nativeTracks[0]));
    } catch (error) {
      console.warn('[MusicLibraryService] native track-by-id query failed, fallback to IndexedDB:', error);
      return null;
    }
  }

  private async tryGetTracksByArtistFromNativeDb(artist: string): Promise<Track[] | null> {
    if (!isTauriRuntime()) return null;
    const normalizedArtist = artist.trim();
    if (!normalizedArtist) return [];

    try {
      const nativeTracks = await queryNativeLibraryTracks({
        includeMissing: false,
        visibleOnly: true,
        artist: normalizedArtist,
      });

      if (nativeTracks.length === 0) {
        return null;
      }

      return nativeTracks.map((item) =>
        this.restoreTrackForPlayback(this.mapNativeTrackRecordToStoredTrack(item))
      );
    } catch (error) {
      console.warn(
        '[MusicLibraryService] native artist track query failed, fallback to IndexedDB:',
        error
      );
      return null;
    }
  }

  private async tryGetTracksByAlbumFromNativeDb(album: string): Promise<Track[] | null> {
    if (!isTauriRuntime()) return null;
    const normalizedAlbum = album.trim();
    if (!normalizedAlbum) return [];

    try {
      const nativeTracks = await queryNativeLibraryTracks({
        includeMissing: false,
        visibleOnly: true,
        album: normalizedAlbum,
      });

      if (nativeTracks.length === 0) {
        return null;
      }

      return nativeTracks.map((item) =>
        this.restoreTrackForPlayback(this.mapNativeTrackRecordToStoredTrack(item))
      );
    } catch (error) {
      console.warn(
        '[MusicLibraryService] native album track query failed, fallback to IndexedDB:',
        error
      );
      return null;
    }
  }

  private async loadNativeFacetCollection(
    descriptor: MusicLibraryCollectionFacetDescriptor,
    options?: { includeStoredCover?: boolean }
  ): Promise<string[] | AlbumSummary[] | null> {
    if (!isTauriRuntime()) return null;
    if (descriptor.kind === 'album-summaries' && options?.includeStoredCover) {
      return null;
    }

    try {
      const result = await listNativeLibraryFacetEntries({
        kind: descriptor.kind,
        field: descriptor.nativeField ?? descriptor.field,
        includeMissing: false,
        visibleOnly: true,
      });
      if (!result) return null;

      if (result.kind === 'album-summaries') {
        const albums = (result.albums ?? [])
          .map((item) => this.toAlbumSummaryFromNativeRecord(item))
          .sort((a, b) => a.album.localeCompare(b.album));
        return albums.length > 0 ? albums : null;
      }

      const values = result.textValues ?? [];
      return values.length > 0 ? values : null;
    } catch (error) {
      console.warn('[MusicLibraryService] native facet list failed, fallback to IndexedDB:', {
        descriptor,
        error,
      });
      return null;
    }
  }

  private async tryGetAllArtistsFromNativeDb(): Promise<string[] | null> {
    const descriptor = await this.resolveNativeFacetCollectionDescriptor('artists');
    if (!descriptor) return null;
    return (await this.loadNativeFacetCollection(descriptor)) as string[] | null;
  }

  private async tryGetAllGenresFromNativeDb(): Promise<string[] | null> {
    const descriptor = await this.resolveNativeFacetCollectionDescriptor('genres');
    if (!descriptor) return null;
    return (await this.loadNativeFacetCollection(descriptor)) as string[] | null;
  }

  async getBaseFieldFacetValues(
    field: MusicLibraryBaseField,
    options?: { limit?: number }
  ): Promise<string[]> {
    const descriptor = resolveMusicLibraryFieldFacetDescriptor(field);
    if (!descriptor) return [];
    if (!isTauriRuntime()) return [];

    try {
      const result = await listNativeLibraryFacetEntries({
        kind: descriptor.kind,
        field: descriptor.nativeField,
        includeMissing: false,
        visibleOnly: true,
        limit: options?.limit,
      });
      return result?.kind === 'text-values' ? result.textValues ?? [] : [];
    } catch (error) {
      console.warn('[MusicLibraryService] base field facet values query failed:', {
        field,
        descriptor,
        error,
      });
      return [];
    }
  }

  private toAlbumSummaryFromNativeRecord(record: NativeLibraryAlbumRecord): AlbumSummary {
    return {
      album: record.album,
      artist: record.artist,
      coverTrackPath: record.coverTrackPath,
      coverTrackId: record.coverTrackId,
    };
  }

  private async tryGetAllAlbumsFromNativeDb(
    includeStoredCover: boolean
  ): Promise<AlbumSummary[] | null> {
    const descriptor = await this.resolveNativeFacetCollectionDescriptor('albums');
    if (!descriptor) return null;
    return (await this.loadNativeFacetCollection(descriptor, {
      includeStoredCover,
    })) as AlbumSummary[] | null;
  }

  private toLibraryStatsFromNativeRecord(record: NativeLibraryStatsRecord): LibraryStats {
    return {
      totalTracks: Math.max(0, Math.floor(Number(record.totalTracks) || 0)),
      totalArtists: Math.max(0, Math.floor(Number(record.totalArtists) || 0)),
      totalAlbums: Math.max(0, Math.floor(Number(record.totalAlbums) || 0)),
      totalSize: Math.max(0, Math.floor(Number(record.totalSize) || 0)),
      totalDuration: Math.max(0, Number(record.totalDuration) || 0),
    };
  }

  private async tryGetLibraryStatsFromNativeDb(): Promise<LibraryStats | null> {
    if (!isTauriRuntime()) return null;
    try {
      const stats = await getNativeLibraryStats({
        includeMissing: false,
        visibleOnly: true,
      });
      if (!stats) return null;

      const normalized = this.toLibraryStatsFromNativeRecord(stats);
      if (normalized.totalTracks === 0) {
        return null;
      }
      return normalized;
    } catch (error) {
      console.warn('[MusicLibraryService] native library stats failed, fallback to IndexedDB:', error);
      return null;
    }
  }

  private scheduleNativeSourceBootstrap(): void {
    if (!isTauriRuntime()) return;
    if (this.nativeSourceBootstrapScheduled) return;
    this.nativeSourceBootstrapScheduled = true;

    window.setTimeout(() => {
      void this.syncNativeSourcesFromIndexedDb().catch((error) => {
        console.warn('[MusicLibraryService] native source bootstrap failed:', error);
      });
    }, 0);
  }

  private async syncNativeSourcesFromIndexedDb(): Promise<void> {
    if (!isTauriRuntime()) return;
    const paths = await this.readLibraryPathsFromIndexedDb();
    for (const pathInfo of paths) {
      await this.tryUpsertNativeLibrarySource(pathInfo);
    }
  }

  private toLibraryPathFromStoredRecord(stored: StoredLibraryPathRecord): LibraryPath {
    return {
      ...stored,
      addedAt: stored.addedAt ? new Date(stored.addedAt) : new Date(),
      lastScanned: stored.lastScanned ? new Date(stored.lastScanned) : undefined,
      isVisible: stored.isVisible !== false,
      isScanned: stored.isScanned !== false,
    };
  }

  private async readLibraryPathsFromIndexedDb(): Promise<LibraryPath[]> {
    const db = await this.ensureDB();
    const transaction = db.transaction(['libraryPaths'], 'readonly');
    const store = transaction.objectStore('libraryPaths');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const raw = Array.isArray(request.result) ? request.result : [];
        const paths: LibraryPath[] = raw.map((entry) =>
          this.toLibraryPathFromStoredRecord(entry as unknown as StoredLibraryPathRecord)
        );
        resolve(paths);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async upsertLibraryPathInIndexedDb(pathInfo: LibraryPath): Promise<void> {
    const db = await this.ensureDB();
    const transaction = db.transaction(['libraryPaths'], 'readwrite');
    const store = transaction.objectStore('libraryPaths');
    store.put({
      ...pathInfo,
      addedAt: pathInfo.addedAt instanceof Date ? pathInfo.addedAt.getTime() : Date.now(),
      lastScanned: pathInfo.lastScanned instanceof Date ? pathInfo.lastScanned.getTime() : undefined,
    });

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  private async updateLibraryPathScanSnapshot(pathId: string, trackCount: number): Promise<void> {
    const normalizedPathId = String(pathId || '').trim();
    if (!normalizedPathId) return;

    const db = await this.ensureDB();
    let updatedPath: LibraryPath | null = null;

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['libraryPaths'], 'readwrite');
      const store = transaction.objectStore('libraryPaths');
      const request = store.get(normalizedPathId);

      request.onsuccess = () => {
        const existing = request.result as StoredLibraryPathRecord | undefined;
        if (!existing) return;

        const next: LibraryPath = {
          ...this.toLibraryPathFromStoredRecord(existing),
          lastScanned: new Date(),
          trackCount: Math.max(0, Math.floor(Number(trackCount) || 0)),
        };

        store.put({
          ...next,
          addedAt: next.addedAt.getTime(),
          lastScanned: next.lastScanned ? next.lastScanned.getTime() : undefined,
        });
        updatedPath = next;
      };

      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    if (!updatedPath) {
      const fallback = (await this.getLibraryPaths()).find((path) => path.id === normalizedPathId);
      if (fallback) {
        updatedPath = {
          ...fallback,
          lastScanned: new Date(),
          trackCount: Math.max(0, Math.floor(Number(trackCount) || 0)),
        };
      }
    }

    if (updatedPath) {
      await this.upsertLibraryPathInIndexedDb(updatedPath).catch((error) => {
        console.warn('[MusicLibraryService] failed to upsert scan snapshot into IndexedDB:', error);
      });
      await this.tryUpsertNativeLibrarySource(updatedPath);
    }
  }

  private mergeNativeLibraryPath(
    source: NativeLibrarySourceRecord,
    storedById: Map<string, LibraryPath>,
    storedByNormalizedPath: Map<string, LibraryPath>
  ): LibraryPath {
    const matchById = storedById.get(source.id);
    const matchByPath = storedByNormalizedPath.get(this.normalizePathForCompare(source.path));
    const fallback = matchById ?? matchByPath;

    return {
      id: source.id,
      path: source.path,
      addedAt:
        typeof source.addedAtMs === 'number' && Number.isFinite(source.addedAtMs)
          ? new Date(source.addedAtMs)
          : fallback?.addedAt ?? new Date(),
      lastScanned:
        typeof source.lastScannedAtMs === 'number' && Number.isFinite(source.lastScannedAtMs)
          ? new Date(source.lastScannedAtMs)
          : fallback?.lastScanned,
      trackCount:
        typeof source.trackCount === 'number' && Number.isFinite(source.trackCount)
          ? Math.max(0, Math.floor(source.trackCount))
          : typeof fallback?.trackCount === 'number' && Number.isFinite(fallback.trackCount)
            ? fallback.trackCount
            : 0,
      isVisible: source.isVisible !== false,
      isScanned: source.isScanned !== false,
      folderHandle: fallback?.folderHandle,
    };
  }

  private async tryGetLibraryPathsFromNativeDb(): Promise<LibraryPath[] | null> {
    if (!isTauriRuntime()) return null;

    try {
      const nativeSources = await listNativeLibrarySources();
      if (nativeSources.length === 0) return null;

      const storedPaths = await this.readLibraryPathsFromIndexedDb().catch(() => []);
      const storedById = new Map<string, LibraryPath>();
      const storedByNormalizedPath = new Map<string, LibraryPath>();
      for (const path of storedPaths) {
        if (!path?.id) continue;
        storedById.set(path.id, path);
        storedByNormalizedPath.set(this.normalizePathForCompare(path.path), path);
      }

      return nativeSources
        .map((source) => this.mergeNativeLibraryPath(source, storedById, storedByNormalizedPath))
        .sort((left, right) => left.addedAt.getTime() - right.addedAt.getTime());
    } catch (error) {
      console.warn('[MusicLibraryService] native source list failed, fallback to IndexedDB:', error);
      return null;
    }
  }

  private normalizeFolderPrefix(folderPath: string): string {
    const normalized = this.normalizePathForCompare(folderPath);
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
  }

  private async buildPathVisibilityContext(): Promise<PathVisibilityContext> {
    const paths = await this.getLibraryPaths();
    const visiblePathIds = new Set<string>();
    const hiddenPathPrefixes: string[] = [];

    for (const path of paths) {
      if (!path?.id) continue;
      if (path.isVisible) {
        visiblePathIds.add(path.id);
      } else if (typeof path.path === 'string' && path.path.trim().length > 0) {
        hiddenPathPrefixes.push(this.normalizeFolderPrefix(path.path));
      }
    }

    return {
      visiblePathIds,
      hiddenPathPrefixes,
    };
  }

  private isStoredTrackVisible(storedTrack: StoredTrackRecord, context: PathVisibilityContext): boolean {
    const pathId = typeof storedTrack.libraryPathId === 'string' ? storedTrack.libraryPathId : '';
    if (pathId) {
      return context.visiblePathIds.has(pathId);
    }

    if (context.hiddenPathPrefixes.length === 0) {
      return true;
    }

    const pathValue = String(storedTrack.filePath || storedTrack.path || '').trim();
    if (!pathValue) {
      return true;
    }

    const normalizedPath = this.normalizePathForCompare(pathValue);
    return !context.hiddenPathPrefixes.some((prefix) => normalizedPath.startsWith(prefix));
  }

  private albumKeyForTrack(track: Track): string | null {
    const album = String(track.album || '').trim();
    if (!album) return null;
    const artist = String(track.artist || '').trim();
    return `${album}::${artist}`;
  }

  private coverKeyMatchesVariant(coverKey: string, maxEdgePx: number): boolean {
    const hasThumbSuffix = coverKey.includes('-thumb-');
    if (maxEdgePx > 0) {
      return coverKey.endsWith(`-thumb-${maxEdgePx}px`);
    }
    return !hasThumbSuffix;
  }

  private sanitizeCoverUrl(raw: unknown): string | undefined {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return undefined;

    const lower = value.toLowerCase();
    if (lower.startsWith('data:')) return value;
    if (lower.startsWith('blob:')) return value;
    if (lower.startsWith('http:') || lower.startsWith('https:')) return value;
    if (lower.startsWith('pmp://cover/')) return value;

    if (lower.startsWith('asset:') || lower.startsWith('tauri:')) return undefined;

    if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\')) {
      return undefined;
    }

    return undefined;
  }

  private sanitizeStoredCoverUrlForPath(raw: unknown, trackPath: unknown): string | undefined {
    const coverUrl = this.sanitizeCoverUrl(raw);
    if (!coverUrl) return undefined;

    // Desktop/Tauri: embedded `data:`/`blob:` cover payloads for absolute-path tracks are a major
    // memory multiplier (especially when they leak into `MediaMetadata` or UI state). Prefer the
    // Rust cover cache instead.
    if (
      isTauriRuntime() &&
      typeof trackPath === 'string' &&
      this.isLikelyAbsolutePath(trackPath) &&
      (coverUrl.startsWith('data:') || coverUrl.startsWith('blob:'))
    ) {
      return undefined;
    }

    return coverUrl;
  }

  private scheduleLegacyCoverUrlDrop(trackId: string): void {
    if (!trackId) return;
    if (!isTauriRuntime()) return;
    if (typeof window === 'undefined') return;

    this.legacyCoverUrlDropIds.add(trackId);
    if (this.legacyCoverUrlDropScheduled) return;
    this.legacyCoverUrlDropScheduled = true;

    window.setTimeout(() => {
      void this.flushLegacyCoverUrlDrops().catch(() => {});
    }, 1200);
  }

  private buildPmpCoverUrl(coverKey: string): string {
    const normalizedKey = String(coverKey || '').trim();
    if (!normalizedKey) return '';
    return `pmp://cover/${encodeURIComponent(normalizedKey)}`;
  }

  private shouldUsePmpCoverProtocol(): boolean {
    if (typeof window === 'undefined') return true;
    const protocol = String(window.location?.protocol || '').toLowerCase();
    // In Vite dev (`http://localhost:*`) custom schemes like `pmp://` are often blocked as
    // unknown/non-fetch protocols by the browser layer. Prefer convertFileSrc() there.
    if (protocol === 'http:' || protocol === 'https:') return false;
    return true;
  }

  private isPmpCoverUrl(url: string): boolean {
    const value = String(url || '').trim().toLowerCase();
    return value.startsWith('pmp://cover/');
  }

  private async buildResolvedCoverUrlForRuntime(
    coverPath: string,
    coverKey: string,
    coverSizeHint?: CoverSizeHint
  ): Promise<string | undefined> {
    if (this.shouldUsePmpCoverProtocol()) {
      const pmpUrl = this.buildPmpCoverUrlForHint(coverKey, coverSizeHint);
      if (pmpUrl) return pmpUrl;
    }

    try {
      const tauriApi = await import('@tauri-apps/api/tauri');
      const candidate =
        typeof tauriApi.convertFileSrc === 'function' ? tauriApi.convertFileSrc(coverPath) : '';
      const normalized = typeof candidate === 'string' ? candidate.trim() : '';
      if (normalized) return normalized;
    } catch {
      // fallback below
    }

    const fallback = this.buildPmpCoverUrlForHint(coverKey, coverSizeHint);
    return fallback || undefined;
  }

  private resolveCoverEdgePx(coverSizeHint?: CoverSizeHint): number {
    switch (coverSizeHint) {
      case 'small':
        return 96;
      case 'medium':
        return 256;
      case 'large':
        return 384;
      default:
        return this.coverMaxEdgePx > 0 ? this.coverMaxEdgePx : 0;
    }
  }

  private isValidCoverKey(coverKey: string): boolean {
    if (!coverKey) return false;
    if (coverKey.length > 192) return false;
    return /^[A-Za-z0-9._-]+$/.test(coverKey);
  }

  private parseCoverKeyFromPmpUrl(url: string): string | undefined {
    const value = String(url || '').trim();
    if (!value) return undefined;

    const match = /^pmp:\/\/(?:localhost\/)?cover\/([^?#]+)/i.exec(value);
    if (!match || !match[1]) return undefined;

    let decoded: string;
    try {
      decoded = decodeURIComponent(match[1]);
    } catch {
      return undefined;
    }

    const normalized = decoded.trim();
    if (!this.isValidCoverKey(normalized)) return undefined;
    return normalized;
  }

  private buildPmpCoverUrlForHint(coverKey: string, coverSizeHint?: CoverSizeHint): string {
    const base = this.buildPmpCoverUrl(coverKey);
    if (!base) return '';
    if (!coverSizeHint) return base;
    return `${base}?size=${coverSizeHint}`;
  }

  private async flushLegacyCoverUrlDrops(): Promise<void> {
    if (this.legacyCoverUrlDropInFlight) {
      if (!this.legacyCoverUrlDropScheduled && typeof window !== 'undefined') {
        this.legacyCoverUrlDropScheduled = true;
        window.setTimeout(() => {
          void this.flushLegacyCoverUrlDrops().catch(() => {});
        }, 1200);
      }
      return;
    }

    const ids = Array.from(this.legacyCoverUrlDropIds);
    this.legacyCoverUrlDropIds.clear();
    this.legacyCoverUrlDropScheduled = false;
    if (ids.length === 0) return;

    this.legacyCoverUrlDropInFlight = true;
    try {
      const db = await this.ensureDB();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readwrite');
        const store = transaction.objectStore('tracks');

        for (const id of ids) {
          const request = store.get(id);
          request.onsuccess = () => {
            const record = request.result as unknown;
            if (!record || typeof record !== 'object') return;
            const value = record as Record<string, unknown>;
            const coverUrl = typeof value.coverUrl === 'string' ? value.coverUrl.trim() : '';
            if (!coverUrl) return;

            const trackPath =
              typeof value.filePath === 'string'
                ? value.filePath
                : typeof value.path === 'string'
                  ? value.path
                  : '';
            if (!trackPath || !this.isLikelyAbsolutePath(trackPath)) return;

            const lower = coverUrl.toLowerCase();
            const isLegacy =
              lower.startsWith('data:') ||
              lower.startsWith('blob:') ||
              lower.startsWith('asset:') ||
              lower.startsWith('tauri:');
            if (!isLegacy) return;

            delete value.coverUrl;
            store.put(value);
          };
        }

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      this.legacyCoverUrlDropInFlight = false;
    }
  }

  private guessMimeTypeFromPath(path: string): string | undefined {
    const lower = path.toLowerCase();
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.flac')) return 'audio/flac';
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.dsf')) return 'audio/x-dsf';
    if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
    if (lower.endsWith('.aac')) return 'audio/aac';
    if (lower.endsWith('.ogg')) return 'audio/ogg';
    if (lower.endsWith('.opus')) return 'audio/opus';
    if (lower.endsWith('.aiff') || lower.endsWith('.aif')) return 'audio/aiff';
    return undefined;
  }

  private isLikelyAbsolutePath(path: string): boolean {
    if (!path) return false;
    if (path.startsWith('/')) return true;
    return /^[a-zA-Z]:[\\/]/.test(path);
  }

  private scheduleStartupRefresh(): void {
    if (MusicLibraryService.startupRefreshScheduled) return;
    MusicLibraryService.startupRefreshScheduled = true;

    if (typeof window === 'undefined') return;
    if (!isTauriRuntime()) return;

    window.setTimeout(() => {
      void this.refreshLibraryOnStartup().catch((error) => {
        console.error('[MusicLibrary] Startup refresh failed:', error);
      });
    }, 2500);
  }

  private async refreshLibraryOnStartup(): Promise<void> {
    if (this.isScanning) return;

    const paths = await this.getLibraryPaths();
    const toRefresh = paths.filter(
      (p) => p.isScanned && typeof p.path === 'string' && this.isLikelyAbsolutePath(p.path)
    );
    if (toRefresh.length === 0) return;

    for (const p of toRefresh) {
      if (this.isScanning) return;
      await this.scanFolderViaTauriBackend(p.path, p.id, false, { silentProgress: true });
    }
  }

  private async upsertCoverCacheEntry(entry: {
    key: string;
    filePath: string;
    bytes: number;
    lastAccessedAtMs: number;
  }): Promise<void> {
    const db = await this.ensureDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['coverCache'], 'readwrite');
      const store = transaction.objectStore('coverCache');
      store.put(entry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  private async touchCoverCacheEntry(key: string): Promise<void> {
    const db = await this.ensureDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['coverCache'], 'readwrite');
      const store = transaction.objectStore('coverCache');
      const request = store.get(key);
      request.onsuccess = () => {
        const existing = request.result;
        if (existing) {
          existing.lastAccessedAtMs = Date.now();
          store.put(existing);
        }
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  private async maybeUpdateTrackCoverInDB(
    audioPath: string,
    coverUrl: string,
    coverKey: string
  ): Promise<void> {
    const coverUrlString = String(coverUrl || '');
    const isSessionOnlyUrl =
      coverUrlString.startsWith('blob:') ||
      coverUrlString.startsWith('asset:') ||
      coverUrlString.startsWith('tauri:');

    // Blob/asset/tauri URLs are session-only; never persist them into IndexedDB.
    if (isSessionOnlyUrl) {
      const db = await this.ensureDB();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readwrite');
        const store = transaction.objectStore('tracks');

        if (!store.indexNames.contains('path')) {
          resolve();
          return;
        }

        const request = store.index('path').get(audioPath);
        request.onsuccess = () => {
          const existing = request.result;
          if (existing) {
            const prevCoverUrl = String(existing.coverUrl || '');
            const lower = prevCoverUrl.toLowerCase();
            const shouldDropLegacyCoverUrl =
              lower.startsWith('data:') ||
              lower.startsWith('blob:') ||
              lower.startsWith('asset:') ||
              lower.startsWith('tauri:');

            const next = { ...existing, coverKey } as Record<string, unknown>;
            if (shouldDropLegacyCoverUrl && 'coverUrl' in next) {
              delete next.coverUrl;
            }
            store.put({
              ...next,
            });
          }
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
      return;
    }

    const db = await this.ensureDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readwrite');
      const store = transaction.objectStore('tracks');

      if (!store.indexNames.contains('path')) {
        resolve();
        return;
      }

      const request = store.index('path').get(audioPath);
      request.onsuccess = () => {
        const existing = request.result;
        if (existing) {
          const prevCoverUrl = String(existing.coverUrl || '');
          const shouldReplace =
            !prevCoverUrl || prevCoverUrl.startsWith('data:') || prevCoverUrl !== coverUrl;
          if (shouldReplace) {
            store.put({
              ...existing,
              coverUrl,
              coverKey,
            });
          }
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  private touchCoverBlobCache(normalizedAudioPath: string): void {
    const existing = this.coverBlobUrlCache.get(normalizedAudioPath);
    if (!existing) return;
    this.coverBlobUrlCache.delete(normalizedAudioPath);
    this.coverBlobUrlCache.set(normalizedAudioPath, existing);
  }

  private addCoverBlobUrlToCache(
    normalizedAudioPath: string,
    url: string,
    bytes: number
  ): void {
    const existing = this.coverBlobUrlCache.get(normalizedAudioPath);
    if (existing) {
      this.coverBlobUrlCache.delete(normalizedAudioPath);
      this.coverBlobUrlTotalBytes = Math.max(0, this.coverBlobUrlTotalBytes - existing.bytes);
      this.forgetCoverDecodedEstimate(existing.url);
      this.removeAlbumCoverUrlCacheEntriesByUrl(existing.url);
      this.revokeObjectUrlIfNeeded(existing.url);
    }

    this.coverBlobUrlCache.set(normalizedAudioPath, { url, bytes });
    this.coverBlobUrlTotalBytes += bytes;

    this.enforceRuntimeCacheBudgets();
  }

  private removeAlbumCoverUrlCacheEntriesByUrl(url: string): void {
    if (!url) return;
    for (const [key, value] of this.albumCoverUrlCache.entries()) {
      if (value === url) {
        this.albumCoverUrlCache.delete(key);
      }
    }
  }

  private revokeObjectUrlIfNeeded(url: string): void {
    if (!url || !url.startsWith('blob:')) return;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // best-effort
    }
  }

  private evictCoverBlobCacheEntry(cacheKey: string): void {
    const blobEntry = this.coverBlobUrlCache.get(cacheKey);
    const cachedUrl = this.coverUrlCache.get(cacheKey);
    this.coverUrlCache.delete(cacheKey);

    if (blobEntry) {
      this.coverBlobUrlCache.delete(cacheKey);
      this.coverBlobUrlTotalBytes = Math.max(0, this.coverBlobUrlTotalBytes - blobEntry.bytes);
      this.forgetCoverDecodedEstimate(blobEntry.url);
      this.removeAlbumCoverUrlCacheEntriesByUrl(blobEntry.url);
      this.revokeObjectUrlIfNeeded(blobEntry.url);

      if (cachedUrl && cachedUrl !== blobEntry.url) {
        this.forgetCoverDecodedEstimate(cachedUrl);
        this.removeAlbumCoverUrlCacheEntriesByUrl(cachedUrl);
        this.revokeObjectUrlIfNeeded(cachedUrl);
      }
      return;
    }

    if (cachedUrl) {
      this.forgetCoverDecodedEstimate(cachedUrl);
      this.removeAlbumCoverUrlCacheEntriesByUrl(cachedUrl);
      this.revokeObjectUrlIfNeeded(cachedUrl);
    }
  }

  private evictCoverUrlFromRuntimeCaches(url: string): void {
    if (!url) return;

    let removed = false;

    for (const [cacheKey, entry] of Array.from(this.coverBlobUrlCache.entries())) {
      if (entry.url !== url) continue;
      removed = true;
      this.evictCoverBlobCacheEntry(cacheKey);
    }

    for (const [cacheKey, cached] of Array.from(this.coverUrlCache.entries())) {
      if (cached !== url) continue;
      removed = true;
      this.evictCoverBlobCacheEntry(cacheKey);
    }

    if (removed) return;

    this.removeAlbumCoverUrlCacheEntriesByUrl(url);
    this.forgetCoverDecodedEstimate(url);
    this.revokeObjectUrlIfNeeded(url);
  }

  private pruneUrlCaches(): void {
    while (this.coverUrlCache.size > this.COVER_URL_CACHE_MAX_ENTRIES) {
      const oldestKey = this.coverUrlCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.evictCoverBlobCacheEntry(oldestKey);
    }

    while (this.albumCoverUrlCache.size > this.ALBUM_COVER_URL_CACHE_MAX_ENTRIES) {
      const oldestKey = this.albumCoverUrlCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.albumCoverUrlCache.delete(oldestKey);
    }
  }

  private async pruneCoverCacheIfNeeded(): Promise<void> {
    const db = await this.ensureDB();

    const entries: Array<{
      key: string;
      filePath: string;
      bytes: number;
      lastAccessedAtMs: number;
    }> = await new Promise((resolve, reject) => {
      const transaction = db.transaction(['coverCache'], 'readonly');
      const store = transaction.objectStore('coverCache');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    let total = 0;
    for (const e of entries) total += Number(e.bytes || 0);
    if (total <= this.COVER_CACHE_MAX_BYTES) return;

    entries.sort((a, b) => Number(a.lastAccessedAtMs || 0) - Number(b.lastAccessedAtMs || 0));

    const keysToDelete: string[] = [];
    for (const entry of entries) {
      if (total <= this.COVER_CACHE_MAX_BYTES) break;
      keysToDelete.push(entry.key);
      total -= Number(entry.bytes || 0);
    }

    if (keysToDelete.length === 0) return;

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['coverCache'], 'readwrite');
      const store = transaction.objectStore('coverCache');
      for (const key of keysToDelete) {
        store.delete(key);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    const { invoke } = await import('@tauri-apps/api/tauri');
    for (const key of keysToDelete) {
      try {
        await invoke('music_library_remove_cover', { key });
      } catch (error) {
        console.warn('[MusicLibrary] Failed to delete cached cover file:', error);
      }
    }
  }

  async getCoverUrlForTrack(
    track: Track,
    options?: {
      allowAlbumFallback?: boolean;
      coverSizeHint?: CoverSizeHint;
      bypassRuntimePolicy?: boolean;
    }
  ): Promise<string | undefined> {
    recordCoverResolveLookupRequest();
    let coverLookupResolved = false;
    const markCoverLookupHit = () => {
      if (coverLookupResolved) return;
      coverLookupResolved = true;
      recordCoverResolveCacheHit();
    };
    const markCoverLookupMiss = () => {
      if (coverLookupResolved) return;
      coverLookupResolved = true;
      recordCoverResolveCacheMiss();
    };

    const allowAlbumFallback = options?.allowAlbumFallback !== false;
    const coverSizeHint = options?.coverSizeHint;
    const bypassRuntimePolicy = options?.bypassRuntimePolicy === true;
    const requestedEdgePx = this.resolveCoverEdgePx(coverSizeHint);
    const existingUrl = track.coverUrl;
    const inTauri = isTauriRuntime();

    const audioPath = track.filePath || track.path;
    const isAbsoluteAudioPath = Boolean(audioPath && this.isLikelyAbsolutePath(audioPath));
    const normalizedAudioPath =
      audioPath && this.isLikelyAbsolutePath(audioPath) ? this.normalizePathForCompare(audioPath) : null;
    const cacheKey = normalizedAudioPath ? `${normalizedAudioPath}|edge=${requestedEdgePx}` : null;

    if (
      (!inTauri || !isAbsoluteAudioPath) &&
      existingUrl &&
      (String(existingUrl).startsWith('data:') || String(existingUrl).startsWith('blob:')) &&
      track.coverKey &&
      this.coverKeyMatchesVariant(track.coverKey, requestedEdgePx)
    ) {
      void this.touchCoverCacheEntry(track.coverKey).catch(() => {});
      if (cacheKey && String(existingUrl).startsWith('blob:')) {
        this.touchCoverBlobCache(cacheKey);
      }
      markCoverLookupHit();
      return existingUrl;
    }

    if (!inTauri) {
      if (existingUrl) {
        markCoverLookupHit();
      } else {
        markCoverLookupMiss();
      }
      return existingUrl;
    }

    if (!audioPath || !isAbsoluteAudioPath) {
      if (existingUrl) {
        markCoverLookupHit();
      } else {
        markCoverLookupMiss();
      }
      return existingUrl;
    }

    const effectiveCacheKey = cacheKey ?? `${this.normalizePathForCompare(audioPath)}|edge=${requestedEdgePx}`;
    const normalizedExistingUrl =
      typeof existingUrl === 'string' && existingUrl.trim().length > 0 ? existingUrl.trim() : '';
    const allowPmpCoverUrl = this.shouldUsePmpCoverProtocol();

    if (this.isPmpCoverUrl(normalizedExistingUrl) && allowPmpCoverUrl) {
      const coverKeyFromUrl = this.parseCoverKeyFromPmpUrl(normalizedExistingUrl);
      const preferredExistingUrl = coverKeyFromUrl
        ? this.buildPmpCoverUrlForHint(coverKeyFromUrl, coverSizeHint) || normalizedExistingUrl
        : normalizedExistingUrl;

      this.coverUrlCache.set(effectiveCacheKey, preferredExistingUrl);
      this.touchCoverBlobCache(effectiveCacheKey);
      if (track.coverKey) {
        void this.touchCoverCacheEntry(track.coverKey).catch(() => {});
      }
      markCoverLookupHit();
      return preferredExistingUrl;
    }

    if (this.isPmpCoverUrl(normalizedExistingUrl) && !allowPmpCoverUrl) {
      // Ignore stale `pmp://` URLs in runtimes where custom scheme loading is blocked.
      this.coverUrlCache.delete(effectiveCacheKey);
    }

    const cached = this.coverUrlCache.get(effectiveCacheKey);
    if (cached) {
      if (this.isPmpCoverUrl(cached) && !allowPmpCoverUrl) {
        this.coverUrlCache.delete(effectiveCacheKey);
      } else {
        if (track.coverKey) {
          void this.touchCoverCacheEntry(track.coverKey).catch(() => {});
        }
        this.touchCoverBlobCache(effectiveCacheKey);
        markCoverLookupHit();
        return cached;
      }
    }

    const inflight = this.coverUrlInflight.get(effectiveCacheKey);
    if (inflight) {
      markCoverLookupHit();
      return inflight;
    }

    if (this.currentCoverRuntimeCachePolicy === 'hidden' && !bypassRuntimePolicy) {
      markCoverLookupMiss();
      return undefined;
    }

    markCoverLookupMiss();

    const promise = (async () => {
      const { invoke } = await import('@tauri-apps/api/tauri');

      const result = await invoke<
        | {
            key: string;
            path: string;
            size: number;
            mediaType?: string | null;
          }
        | null
      >('music_library_get_cover', {
        path: audioPath,
        maxBytes: this.COVER_MAX_IMAGE_BYTES,
        maxEdgePx: requestedEdgePx > 0 ? requestedEdgePx : undefined,
      });

      if (!result) return undefined;

      const coverPath = String(result.path || '').trim();
      if (!coverPath) return undefined;

      const resolvedUrl = await this.buildResolvedCoverUrlForRuntime(
        coverPath,
        String(result.key || ''),
        coverSizeHint
      );
      if (!resolvedUrl) return undefined;

      const url = resolvedUrl;
      this.coverUrlCache.set(effectiveCacheKey, url);
      this.addCoverBlobUrlToCache(effectiveCacheKey, url, result.size);
      this.pruneUrlCaches();

      const albumKey = this.albumKeyForTrack(track);
      if (albumKey) {
        this.albumCoverUrlCache.set(`${albumKey}|edge=${requestedEdgePx}`, url);
        this.pruneUrlCaches();
      }

      const now = Date.now();
      await this.upsertCoverCacheEntry({
        key: result.key,
        filePath: result.path,
        bytes: result.size,
        lastAccessedAtMs: now,
      });

      await this.maybeUpdateTrackCoverInDB(audioPath, url, result.key);
      await this.pruneCoverCacheIfNeeded();

      return url;
    })()
      .catch((error) => {
        console.warn('[MusicLibrary] Failed to get cover:', error);
        return undefined;
      })
      .finally(() => {
        this.coverUrlInflight.delete(effectiveCacheKey);
      });

    this.coverUrlInflight.set(effectiveCacheKey, promise);
    const direct = await promise;
    if (direct) return direct;

    const fallbackExistingUrl =
      normalizedExistingUrl && (!this.isPmpCoverUrl(normalizedExistingUrl) || allowPmpCoverUrl)
        ? normalizedExistingUrl
        : undefined;

    if (!allowAlbumFallback) {
      if (fallbackExistingUrl) {
        this.coverUrlCache.set(effectiveCacheKey, fallbackExistingUrl);
        this.touchCoverBlobCache(effectiveCacheKey);
      }
      return fallbackExistingUrl;
    }

    const albumKey = this.albumKeyForTrack(track);
    if (!albumKey) return undefined;
    const albumCacheKey = `${albumKey}|edge=${requestedEdgePx}`;

    const cachedAlbum = this.albumCoverUrlCache.get(albumCacheKey);
    if (cachedAlbum) {
      return cachedAlbum;
    }

    const inflightAlbum = this.albumCoverUrlInflight.get(albumCacheKey);
    if (inflightAlbum) return inflightAlbum;

    const albumPromise = (async () => {
      const album = String(track.album || '').trim();
      if (!album) return undefined;
      const artist = String(track.artist || '').trim();

      const candidates = await this.getTracksByAlbum(album);
      const filtered = candidates
        .filter((t) => t && (t.filePath || t.path))
        .filter((t) => (artist ? String(t.artist || '').trim() === artist : true))
        .slice(0, 12);

      for (const candidate of filtered) {
        if (candidate.id === track.id) continue;
        const url = await this.getCoverUrlForTrack(candidate, {
          allowAlbumFallback: false,
          coverSizeHint,
          bypassRuntimePolicy,
        });
        if (url) {
          this.albumCoverUrlCache.set(albumCacheKey, url);
          this.pruneUrlCaches();
          return url;
        }
      }

      return undefined;
    })()
      .catch((error) => {
        console.warn('[MusicLibrary] Failed to resolve album cover fallback:', error);
        return undefined;
      })
      .finally(() => {
        this.albumCoverUrlInflight.delete(albumCacheKey);
      });

    this.albumCoverUrlInflight.set(albumCacheKey, albumPromise);
    const albumResolved = await albumPromise;
    if (albumResolved) return albumResolved;

    if (fallbackExistingUrl) {
      this.coverUrlCache.set(effectiveCacheKey, fallbackExistingUrl);
      this.touchCoverBlobCache(effectiveCacheKey);
      return fallbackExistingUrl;
    }

    return undefined;
  }

  getCoverRuntimeCacheStats(): {
    coverUrlCacheEntries: number;
    coverBlobUrlCacheEntries: number;
    coverBlobUrlTotalBytes: number;
    coverDecodedEstimateEntries: number;
    coverDecodedEstimateTotalBytes: number;
    coverUrlInflight: number;
    albumCoverUrlCacheEntries: number;
    albumCoverUrlInflight: number;
  } {
    return {
      coverUrlCacheEntries: this.coverUrlCache.size,
      coverBlobUrlCacheEntries: this.coverBlobUrlCache.size,
      coverBlobUrlTotalBytes: this.coverBlobUrlTotalBytes,
      coverDecodedEstimateEntries: this.coverDecodedEstimateBytes.size,
      coverDecodedEstimateTotalBytes: this.coverDecodedEstimateTotalBytes,
      coverUrlInflight: this.coverUrlInflight.size,
      albumCoverUrlCacheEntries: this.albumCoverUrlCache.size,
      albumCoverUrlInflight: this.albumCoverUrlInflight.size,
    };
  }

  getCurrentCoverRuntimeCachePolicy(): CoverRuntimeCachePolicy {
    return this.currentCoverRuntimeCachePolicy;
  }

  clearCoverRuntimeCaches(): void {
    for (const entry of this.coverBlobUrlCache.values()) {
      try {
        URL.revokeObjectURL(entry.url);
      } catch {
        // best-effort
      }
    }

    this.coverUrlCache.clear();
    this.coverBlobUrlCache.clear();
    this.coverUrlInflight.clear();
    this.albumCoverUrlCache.clear();
    this.albumCoverUrlInflight.clear();
    this.coverBlobUrlTotalBytes = 0;
    this.coverDecodedEstimateBytes.clear();
    this.coverDecodedEstimateTotalBytes = 0;
  }

  releaseCoverUrls(urls: string[]): void {
    if (!Array.isArray(urls) || urls.length === 0) return;

    const uniqueUrls = new Set<string>();
    const blobUrls = new Set<string>();
    for (const url of urls) {
      if (typeof url !== 'string') continue;
      const trimmed = url.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('blob:')) {
        blobUrls.add(trimmed);
      }
      uniqueUrls.add(trimmed);
    }

    if (uniqueUrls.size === 0) return;
    if (blobUrls.size > 0) {
      recordCoverBlobUrlsReleased(blobUrls.size);
    }

    for (const url of uniqueUrls) {
      this.evictCoverUrlFromRuntimeCaches(url);
    }
  }

  reportCoverDecoded(coverUrl: string, naturalWidth: number, naturalHeight: number): void {
    if (!coverUrl) return;
    if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) return;
    const width = Math.round(naturalWidth);
    const height = Math.round(naturalHeight);
    if (width <= 0 || height <= 0) return;
    if (width > 16384 || height > 16384) return;

    const bytes = width * height * 4;
    if (!Number.isFinite(bytes) || bytes <= 0) return;
    if (bytes > 512 * 1024 * 1024) return;

    const existing = this.coverDecodedEstimateBytes.get(coverUrl);
    if (existing === bytes) {
      this.coverDecodedEstimateBytes.delete(coverUrl);
      this.coverDecodedEstimateBytes.set(coverUrl, bytes);
      return;
    }

    if (existing !== undefined) {
      this.coverDecodedEstimateBytes.delete(coverUrl);
      this.coverDecodedEstimateTotalBytes = Math.max(0, this.coverDecodedEstimateTotalBytes - existing);
    }

    this.coverDecodedEstimateBytes.set(coverUrl, bytes);
    this.coverDecodedEstimateTotalBytes += bytes;

    this.pruneCoverDecodedEstimateCacheByPolicy();
  }

  private forgetCoverDecodedEstimate(coverUrl: string): void {
    if (!coverUrl) return;
    const existing = this.coverDecodedEstimateBytes.get(coverUrl);
    if (existing === undefined) return;
    this.coverDecodedEstimateBytes.delete(coverUrl);
    this.coverDecodedEstimateTotalBytes = Math.max(0, this.coverDecodedEstimateTotalBytes - existing);
  }

  static getInstance(): MusicLibraryService {
    if (!MusicLibraryService.instance) {
      MusicLibraryService.instance = new MusicLibraryService();
    }
    return MusicLibraryService.instance;
  }

  // 初始化数据库
  private async initDB(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = (event.target as IDBOpenDBRequest).transaction;
        const oldVersion = (event as IDBVersionChangeEvent).oldVersion ?? 0;

        // 创建音乐轨道存储
        if (!db.objectStoreNames.contains('tracks')) {
          const tracksStore = db.createObjectStore('tracks', { keyPath: 'id' });
          tracksStore.createIndex('title', 'title', { unique: false });
          tracksStore.createIndex('artist', 'artist', { unique: false });
          tracksStore.createIndex('album', 'album', { unique: false });
          tracksStore.createIndex('genre', 'genre', { unique: false });
          tracksStore.createIndex('year', 'year', { unique: false });
          tracksStore.createIndex('addedAt', 'addedAt', { unique: false });
          tracksStore.createIndex('path', 'path', { unique: true });
          tracksStore.createIndex('libraryPathId', 'libraryPathId', { unique: false });
          tracksStore.createIndex('quickFingerprint', 'quickFingerprint', { unique: false });
        } else if (transaction) {
          const tracksStore = transaction.objectStore('tracks');
          if (!tracksStore.indexNames.contains('libraryPathId')) {
            tracksStore.createIndex('libraryPathId', 'libraryPathId', { unique: false });
          }
          if (!tracksStore.indexNames.contains('path')) {
            tracksStore.createIndex('path', 'path', { unique: true });
          }
          if (!tracksStore.indexNames.contains('quickFingerprint')) {
            tracksStore.createIndex('quickFingerprint', 'quickFingerprint', { unique: false });
          }
        }

        // 创建库路径存储
        if (!db.objectStoreNames.contains('libraryPaths')) {
          const pathsStore = db.createObjectStore('libraryPaths', { keyPath: 'id' });
          pathsStore.createIndex('path', 'path', { unique: true });
        } else if (transaction) {
          const pathsStore = transaction.objectStore('libraryPaths');
          if (!pathsStore.indexNames.contains('path')) {
            pathsStore.createIndex('path', 'path', { unique: true });
          }
        }

        // 封面磁盘缓存索引（仅存 key/路径/最近访问时间，不存 base64）
        if (!db.objectStoreNames.contains('coverCache')) {
          const coverStore = db.createObjectStore('coverCache', { keyPath: 'key' });
          coverStore.createIndex('lastAccessedAtMs', 'lastAccessedAtMs', { unique: false });
        } else if (transaction) {
          const coverStore = transaction.objectStore('coverCache');
          if (!coverStore.indexNames.contains('lastAccessedAtMs')) {
            coverStore.createIndex('lastAccessedAtMs', 'lastAccessedAtMs', { unique: false });
          }
        }

        // v3 migration: drop legacy base64 coverUrl for Desktop paths (covers can be regenerated via Rust cache)
        if (transaction && oldVersion < 3 && db.objectStoreNames.contains('tracks')) {
          const tracksStore = transaction.objectStore('tracks');
          const cursorRequest = tracksStore.openCursor();
          cursorRequest.onsuccess = (evt) => {
            const cursor = (evt.target as IDBRequest).result as IDBCursorWithValue | null;
            if (!cursor) return;

            const value = cursor.value as unknown as Record<string, unknown>;
            const coverUrl = String(value.coverUrl ?? '');
            const filePath = String(value.filePath ?? value.path ?? '');
            const isAbs = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/');

            if (isAbs && coverUrl.startsWith('data:')) {
              delete value.coverUrl;
              delete value.coverKey;
              tracksStore.put(value);
            }

            cursor.continue();
          };
        }

        // v4 migration: drop legacy asset/tauri/blob cover URLs that depend on Tauri assetScope.
        if (transaction && oldVersion < 4 && db.objectStoreNames.contains('tracks')) {
          const tracksStore = transaction.objectStore('tracks');
          const cursorRequest = tracksStore.openCursor();
          cursorRequest.onsuccess = (evt) => {
            const cursor = (evt.target as IDBRequest).result as IDBCursorWithValue | null;
            if (!cursor) return;

            const value = cursor.value as unknown as Record<string, unknown>;
            const coverUrl = String(value.coverUrl ?? '').trim();
            const lower = coverUrl.toLowerCase();
            const shouldDrop =
              !coverUrl ||
              lower.startsWith('asset:') ||
              lower.startsWith('tauri:') ||
              lower.startsWith('blob:') ||
              lower.includes('music-covers');

            if (shouldDrop && 'coverUrl' in value) {
              delete value.coverUrl;
              tracksStore.put(value);
            }

            cursor.continue();
          };
        }

        // v5 migration: aggressively drop heavy legacy payload fields from track records.
        if (transaction && oldVersion < 5 && db.objectStoreNames.contains('tracks')) {
          const tracksStore = transaction.objectStore('tracks');
          const cursorRequest = tracksStore.openCursor();
          cursorRequest.onsuccess = (evt) => {
            const cursor = (evt.target as IDBRequest).result as IDBCursorWithValue | null;
            if (!cursor) return;

            const value = cursor.value as unknown as Record<string, unknown>;
            const next = { ...value };
            let changed = false;

            if ('file' in next) {
              delete next.file;
              changed = true;
            }
            if ('fileContent' in next) {
              delete next.fileContent;
              changed = true;
            }
            if ('fileHandle' in next) {
              delete next.fileHandle;
              changed = true;
            }

            const filePath = String(next.filePath ?? next.path ?? '').trim();
            const isAbs = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/');

            const coverUrl = String(next.coverUrl ?? '').trim();
            if (coverUrl) {
              const lower = coverUrl.toLowerCase();
              const isEphemeral =
                lower.startsWith('data:') ||
                lower.startsWith('blob:') ||
                lower.startsWith('asset:') ||
                lower.startsWith('tauri:') ||
                lower.includes('music-covers');
              if (isEphemeral && isAbs && 'coverUrl' in next) {
                delete next.coverUrl;
                changed = true;
              }
            }

            const quickFingerprint =
              typeof next.quickFingerprint === 'string' ? next.quickFingerprint.trim().toLowerCase() : '';
            if (quickFingerprint) {
              const normalized = quickFingerprint.replace(/^qf2:/, '');
              if (/^[0-9a-f]{16,128}$/.test(normalized)) {
                const canonical = `qf2:${normalized}`;
                if (next.quickFingerprint !== canonical) {
                  next.quickFingerprint = canonical;
                  changed = true;
                }
              } else {
                delete next.quickFingerprint;
                changed = true;
              }
            }

            if (changed) {
              tracksStore.put(next);
            }

            cursor.continue();
          };
        }
      };
    });
  }

  // 确保数据库已初始化
  private async ensureDB(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.initDB();
    }
    if (!this.db) {
      throw new Error('Failed to initialize database');
    }
    return this.db;
  }

  // 添加库路径
  async addLibraryPath(folderHandle: FileSystemDirectoryHandle): Promise<LibraryPath> {
    const db = await this.ensureDB();
    const pathId = `path-${Date.now()}`;

    // 检查路径是否已存在
    const existingPaths = await this.getLibraryPaths();
    const exists = existingPaths.some((p) => p.path === folderHandle.name);
    if (exists) {
      console.log(`Path already exists: ${folderHandle.name}`);
      return existingPaths.find((p) => p.path === folderHandle.name)!;
    }

    const pathInfo: LibraryPath = {
      id: pathId,
      path: folderHandle.name,
      addedAt: new Date(),
      trackCount: 0,
      isVisible: true,
      isScanned: true,
      folderHandle: folderHandle, // ✅ 保存文件夹句柄
    };

    // 存储时将 Date 转换为时间戳
    const pathToStore = {
      ...pathInfo,
      addedAt: pathInfo.addedAt.getTime(),
      folderHandle: folderHandle, // ✅ FileHandle 可以序列化到 IndexedDB
    };

    const transaction = db.transaction(['libraryPaths'], 'readwrite');
    const store = transaction.objectStore('libraryPaths');
    store.add(pathToStore);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`Successfully added library path: ${folderHandle.name}`);
        resolve();
      };
      transaction.onerror = () => {
        console.error('Failed to add library path:', transaction.error);
        reject(transaction.error);
      };
    });

    await this.tryUpsertNativeLibrarySource(pathInfo);

    return pathInfo;
  }

  // 获取所有库路径
  async getLibraryPaths(): Promise<LibraryPath[]> {
    const nativePaths = await this.tryGetLibraryPathsFromNativeDb();
    if (nativePaths) {
      return nativePaths;
    }

    return this.readLibraryPathsFromIndexedDb();
  }

  private mapNativeSourceHealthRecord(record: NativeLibrarySourceHealthRecord): LibraryPathHealth {
    return {
      sourceId: record.sourceId,
      sourcePath: record.sourcePath,
      sourceDisplayName: record.sourceDisplayName,
      totalTracks: record.totalTracks,
      availableTracks: record.availableTracks,
      missingTracks: record.missingTracks,
      totalArtists: record.totalArtists,
      totalAlbums: record.totalAlbums,
      totalSize: record.totalSize,
      sourceUpdatedAtMs: record.sourceUpdatedAtMs,
      lastTrackUpdatedAtMs: record.lastTrackUpdatedAtMs,
    };
  }

  async getLibraryPathHealth(pathId?: string): Promise<LibraryPathHealth[] | null> {
    if (!isTauriRuntime()) return null;

    const normalizedPathId =
      typeof pathId === 'string' && pathId.trim().length > 0 ? pathId.trim() : undefined;

    try {
      const rows = await listNativeLibrarySourceHealth({ sourceId: normalizedPathId });
      return rows.map((item) => this.mapNativeSourceHealthRecord(item));
    } catch (error) {
      console.warn('[MusicLibraryService] native source health query failed:', error);
      return null;
    }
  }

  async cleanupLibraryPathTracks(
    pathId: string,
    options?: { missingOnly?: boolean }
  ): Promise<number> {
    if (!isTauriRuntime()) return 0;
    const normalizedPathId = String(pathId || '').trim();
    if (!normalizedPathId) return 0;

    try {
      const deleted = await cleanupNativeLibrarySourceTracks(normalizedPathId, {
        missingOnly: options?.missingOnly !== false,
      });
      if (deleted > 0) {
        this.clearCache();
      }
      return deleted;
    } catch (error) {
      console.warn('[MusicLibraryService] native source cleanup failed:', normalizedPathId, error);
      return 0;
    }
  }

  // 移除库路径
  async removeLibraryPath(pathId: string): Promise<void> {
    const normalizedPathId = String(pathId || '').trim();
    if (!normalizedPathId) return;

    const db = await this.ensureDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['libraryPaths', 'tracks'], 'readwrite');
      const pathsStore = transaction.objectStore('libraryPaths');
      const tracksStore = transaction.objectStore('tracks');

      pathsStore.delete(normalizedPathId);

      if (tracksStore.indexNames.contains('libraryPathId')) {
        const libraryPathIndex = tracksStore.index('libraryPathId');
        const cursorRequest = libraryPathIndex.openCursor(IDBKeyRange.only(normalizedPathId));
        cursorRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
          if (!cursor) return;
          cursor.delete();
          cursor.continue();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error);
      } else {
        const cursorRequest = tracksStore.openCursor();
        cursorRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
          if (!cursor) return;
          const value = cursor.value as StoredTrackRecord;
          if (String(value.libraryPathId || '').trim() === normalizedPathId) {
            cursor.delete();
          }
          cursor.continue();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    this.clearCache();
    await this.tryRemoveNativeLibrarySource(normalizedPathId);
  }

  async setLibraryPathVisibility(pathId: string, isVisible: boolean): Promise<void> {
    const db = await this.ensureDB();
    let updatedPath: LibraryPath | null = null;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['libraryPaths'], 'readwrite');
      const store = transaction.objectStore('libraryPaths');
      const request = store.get(pathId);

      request.onsuccess = () => {
        const existing = request.result as StoredLibraryPathRecord | undefined;
        if (!existing) return;
        const next: StoredLibraryPathRecord = {
          ...existing,
          isVisible,
        };
        store.put({
          ...next,
        });
        updatedPath = {
          ...next,
          addedAt: next.addedAt ? new Date(next.addedAt) : new Date(),
          lastScanned: next.lastScanned ? new Date(next.lastScanned) : undefined,
          isVisible: next.isVisible !== false,
          isScanned: next.isScanned !== false,
        };
      };

      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    if (!updatedPath) {
      const fallback = (await this.getLibraryPaths()).find((path) => path.id === pathId);
      if (fallback) {
        updatedPath = {
          ...fallback,
          isVisible,
        };
      }
    }

    this.clearCache();
    if (updatedPath) {
      await this.upsertLibraryPathInIndexedDb(updatedPath).catch((error) => {
        console.warn('[MusicLibraryService] failed to upsert path visibility in IndexedDB:', error);
      });
      await this.tryUpsertNativeLibrarySource(updatedPath);
    }
  }

  async setLibraryPathScanning(pathId: string, isScanned: boolean): Promise<void> {
    const db = await this.ensureDB();
    let updatedPath: LibraryPath | null = null;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['libraryPaths'], 'readwrite');
      const store = transaction.objectStore('libraryPaths');
      const request = store.get(pathId);

      request.onsuccess = () => {
        const existing = request.result as StoredLibraryPathRecord | undefined;
        if (!existing) return;
        const next: StoredLibraryPathRecord = {
          ...existing,
          isScanned,
        };
        store.put({
          ...next,
        });
        updatedPath = {
          ...next,
          addedAt: next.addedAt ? new Date(next.addedAt) : new Date(),
          lastScanned: next.lastScanned ? new Date(next.lastScanned) : undefined,
          isVisible: next.isVisible !== false,
          isScanned: next.isScanned !== false,
        };
      };

      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    if (!updatedPath) {
      const fallback = (await this.getLibraryPaths()).find((path) => path.id === pathId);
      if (fallback) {
        updatedPath = {
          ...fallback,
          isScanned,
        };
      }
    }

    if (updatedPath) {
      await this.upsertLibraryPathInIndexedDb(updatedPath).catch((error) => {
        console.warn('[MusicLibraryService] failed to upsert path scanning in IndexedDB:', error);
      });
      await this.tryUpsertNativeLibrarySource(updatedPath);
    }
  }

  async openInFileManager(path: string): Promise<boolean> {
    if (!isTauriRuntime()) return false;

    const normalizedPath = String(path || '').trim();
    if (!normalizedPath) return false;

    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('music_library_open_in_file_manager', {
        path: normalizedPath,
      });
      return true;
    } catch (error) {
      console.warn('[MusicLibraryService] failed to open in file manager:', normalizedPath, error);
      return false;
    }
  }

  // 扫描所有库路径
  async scanAllLibraryPaths(): Promise<void> {
    const paths = (await this.getLibraryPaths()).filter((path) => path.isScanned);
    console.log(`Found ${paths.length} library paths to scan`);
    const tauriRuntime = isTauriRuntime();

    for (const pathInfo of paths) {
      console.log(`Scanning library path: ${pathInfo.path}`);
      try {
        if (tauriRuntime) {
          await this.scanFolder(pathInfo.path, pathInfo.id);
          continue;
        }

        // 尝试重新获取文件夹句柄
        const showDirectoryPicker = (window as unknown as {
          showDirectoryPicker?: (options: { mode: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;
        }).showDirectoryPicker;
        if (showDirectoryPicker) {
          console.log(`请授权访问文件夹: ${pathInfo.path}`);
          // 注意：每次都需要用户重新授权
          const folderHandle = await showDirectoryPicker({
            mode: 'read',
            id: pathInfo.id, // 尝试使用相同的ID来获取之前的权限
          });
          await this.scanFolder(folderHandle, pathInfo.id);
        }
      } catch (error: unknown) {
        const name =
          typeof (error as { name?: unknown }).name === 'string'
            ? (error as { name: string }).name
            : undefined;
        if (name === 'AbortError') {
          console.log(`User cancelled scanning for path: ${pathInfo.path}`);
        } else {
          console.error(`Failed to scan path ${pathInfo.path}:`, error);
        }
      }
    }
  }

  // 扫描文件夹
  async scanFolder(
    folderPathOrHandle: string | FileSystemDirectoryHandle | null = null,
    pathId?: string
  ): Promise<void> {
    let shouldAddPath = false;
    let folderPath: string | null = null;
    let folderHandle: FileSystemDirectoryHandle | null = null;
    let useFileSystemAPI = false;

    const tauriRuntime = isTauriRuntime();

    // 优先使用 File System Access API（快速）
    if (!folderPathOrHandle) {
      try {
        // 检查是否支持 File System Access API
        // NOTE: In Tauri, we prefer native dialogs so we always have absolute file paths for NativeAudio.
        const showDirectoryPicker = (window as unknown as {
          showDirectoryPicker?: (options: { mode: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
        }).showDirectoryPicker;
        if (!tauriRuntime && showDirectoryPicker) {
          folderHandle = await showDirectoryPicker({ mode: 'read' });
          useFileSystemAPI = true;
          shouldAddPath = true;
          console.log('Using File System Access API (fast)');
        } else {
          // 降级到 Tauri dialog
          const selected = await open({
            directory: true,
            multiple: false,
            title: '选择音乐文件夹',
          });

          if (!selected || Array.isArray(selected)) {
            console.log('User cancelled folder selection');
            return;
          }

          folderPath = selected;
          shouldAddPath = true;
          console.log('Using Tauri dialog (fallback)');
        }
      } catch (error: unknown) {
        const name =
          typeof (error as { name?: unknown }).name === 'string'
            ? (error as { name: string }).name
            : undefined;
        if (name === 'AbortError') {
          console.log('User cancelled folder selection');
          return;
        }
        console.error('Error during folder selection:', error);
        throw error;
      }
    } else if (typeof folderPathOrHandle === 'string') {
      folderPath = folderPathOrHandle;
    } else {
      folderHandle = folderPathOrHandle;
      useFileSystemAPI = true;
    }

    // ML.1 (Desktop/Tauri): do all scanning + metadata extraction in Rust backend.
    // This avoids reading/decoding whole files in the frontend and prevents UI stalls/crashes.
    if (tauriRuntime && folderPath && !useFileSystemAPI) {
      await this.scanFolderViaTauriBackend(folderPath, pathId, shouldAddPath);
      return;
    }

    console.log('Starting to scan folder...');

    // 收集所有音频文件
    const audioFiles: Array<{
      path: string;
      name: string;
      file?: File;
      fileHandle?: FileSystemFileHandle;
    }> = [];

    try {
      if (useFileSystemAPI && folderHandle) {
        // 使用快速的 File System Access API
        await this.collectAudioFilesFromHandle(folderHandle, audioFiles);
      } else if (folderPath) {
        // 使用 Tauri fs API（较慢但支持路径）
        await this.collectAudioFilePaths(folderPath, audioFiles);
      } else {
        throw new Error('No folder source available');
      }

      console.log(`Successfully collected ${audioFiles.length} audio files`);
    } catch (error) {
      console.error('Error collecting audio files:', error);
      this.notifyScanProgress({
        total: 0,
        current: 0,
        isScanning: false,
      });
      throw error;
    }

    const total = audioFiles.length;
    let current = 0;

    this.notifyScanProgress({
      total,
      current: 0,
      isScanning: true,
    });

    if (total === 0) {
      console.log('No audio files found in selected folder');
      this.notifyScanProgress({
        total: 0,
        current: 0,
        isScanning: false,
      });
      return;
    }

    console.log(`Found ${total} audio files, starting scan...`);

    await this.ensureDB();
    const startTime = Date.now();

    // 批量处理 - 一次处理5个文件以提高速度
    const BATCH_SIZE = 5;

    for (let i = 0; i < audioFiles.length; i += BATCH_SIZE) {
      const batch = audioFiles.slice(i, Math.min(i + BATCH_SIZE, audioFiles.length));

      // 并行解析文件元数据
      const parsedTracks: Array<StoredTrackRecord | null> = await Promise.all(
        batch.map(async (audioFile, batchIndex): Promise<StoredTrackRecord | null> => {
          const absoluteIndex = i + batchIndex;

          // 更新进度（使用索引而不是共享变量，避免竞争）
          const progress = ((absoluteIndex + 1) / total) * 100;
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = (absoluteIndex + 1) / elapsed;
          const remaining = (total - absoluteIndex - 1) / speed;

          this.notifyScanProgress({
            total,
            current: absoluteIndex + 1,
            currentFile: audioFile.name,
            isScanning: true,
            progress,
            speed,
            remaining,
          });

          try {
            let track: Track;
            let filePath: string;

            // 如果有 File 对象（浏览器API），直接使用（快！）
            if (audioFile.file) {
              track = await parseAudioFile(audioFile.file);
              filePath = audioFile.path;
            } else {
              filePath = audioFile.path;

              // ML.0 (Desktop/Tauri): do not read full audio contents in the frontend during scans.
              // Store minimal metadata and rely on later phases for enrichment.
              track = {
                id: this.stableIdFromPath(filePath),
                title: audioFile.name.replace(/\.[^/.]+$/, ''),
                filePath,
                originalPath: filePath,
                path: filePath,
              };
            }

            // 准备存储的数据
            return {
              ...track,
              file: undefined,
              fileContent: undefined,
              fileHandle: audioFile.fileHandle,
              filePath: audioFile.fileHandle ? undefined : audioFile.path,
              mimeType: audioFile.file?.type || 'audio/mpeg',
              originalPath: filePath,
              path: filePath,
              addedAt: track.addedAt ? track.addedAt.getTime() : Date.now(),
            };
          } catch (error) {
            console.error(`Failed to process file ${audioFile.name}:`, error);
            return null;
          }
        })
      );

      // 批量存储到数据库（一个事务处理整个批次）
      const validTracks = parsedTracks.filter((t): t is StoredTrackRecord => t !== null);
      if (validTracks.length > 0) {
        await this.batchStoreTracks(validTracks);
      }

      current = i + batch.length;
    }

    console.log(`Scan completed: ${current} files processed`);

    // 清除缓存以便重新计算统计信息
    this.clearCache();

    // 如果是新添加的路径，保存到数据库
    if (shouldAddPath) {
      try {
        if (folderHandle) {
          // File System Access API 场景
          const newPath = await this.addLibraryPath(folderHandle);
          pathId = newPath.id;
          console.log(`Added library path: ${folderHandle.name}, ID: ${pathId}`);
        } else if (folderPath) {
          // Tauri dialog 场景
          const folderName = folderPath.split(/[/\\]/).pop() || folderPath;
          const newPath = await this.addLibraryPathByString(folderPath, folderName);
          pathId = newPath.id;
          console.log(`Added library path: ${folderPath}, ID: ${pathId}`);
        }
      } catch (error) {
        console.error('Failed to add library path:', error);
      }
    }

    // 更新路径的最后扫描时间和歌曲数量
    if (pathId) {
      try {
        await this.updateLibraryPathScanSnapshot(pathId, current);
      } catch (error) {
        console.error('Failed to update library path:', error);
      }
    }

    this.notifyScanProgress({
      total,
      current,
      isScanning: false,
    });
  }

  async cancelCurrentScan(): Promise<void> {
    if (!isTauriRuntime()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('music_library_cancel_scan');
    } catch (error) {
      console.error('[MusicLibrary] Failed to cancel scan:', error);
    } finally {
      this.notifyScanProgress({ total: 0, current: 0, isScanning: false });
    }
  }

  private async scanFolderViaTauriBackend(
    folderPath: string,
    pathId?: string,
    shouldAddPath: boolean = false,
    options?: { silentProgress?: boolean; enrichUnscannedMetadata?: boolean }
  ): Promise<void> {
    const silentProgress = options?.silentProgress ?? false;
    const enrichUnscannedMetadata = options?.enrichUnscannedMetadata ?? true;
    const pickFiniteNumber = (...values: Array<number | null | undefined>): number | undefined =>
      values.find((value): value is number => typeof value === 'number' && Number.isFinite(value));

    this.isScanning = true;

    if (!silentProgress) {
      this.notifyScanProgress({
        total: 0,
        current: 0,
        currentFile: folderPath.split(/[/\\]/).pop() || folderPath,
        isScanning: true,
        progress: 0,
      });
    }

    const { invoke } = await import('@tauri-apps/api/tauri');
    const { listen } = await import('@tauri-apps/api/event');

    // Ensure the folder is registered so tracks can be associated to a stable libraryPathId.
    if (shouldAddPath && !pathId) {
      try {
        const folderName = folderPath.split(/[/\\]/).pop() || folderPath;
        const newPath = await this.addLibraryPathByString(folderPath, folderName);
        pathId = newPath.id;
      } catch (error) {
        console.error('Failed to add library path before scanning:', error);
      }
    }

    const startTime = Date.now();
    const unlisten = silentProgress
      ? async () => {}
      : await listen<{ total: number; current: number; currentFile?: string }>(
          'music-library-scan-progress',
          (event) => {
            const total = event.payload?.total ?? 0;
            const current = event.payload?.current ?? 0;
            const progress = total > 0 ? (current / total) * 100 : 0;
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = elapsed > 0 ? current / elapsed : 0;
            const remaining = speed > 0 ? (total - current) / speed : undefined;

            this.notifyScanProgress({
              total,
              current,
              currentFile: event.payload?.currentFile,
              isScanning: current < total,
              progress,
              speed,
              remaining,
            });
          }
        );

    try {
      // ML.2 Stage A: fast enumerate only (mtime/size) without metadata probing.
      const quick = await invoke<
        Array<{
          path: string;
          fileName?: string;
          file_name?: string;
          size: number;
          mtimeMs?: number;
          mtime_ms?: number;
          quickFingerprint?: string | null;
          quick_fingerprint?: string | null;
        }>
      >('music_library_scan', {
        paths: [folderPath],
        options: { includeMetadata: false },
      });

      await this.ensureDB();

      const existing = await this.getStoredTracksForBackendScan(folderPath, pathId);
      const existingByPath = new Map<string, StoredTrackRecord>();
      const existingByQuickFingerprint = new Map<string, StoredTrackRecord[]>();
      for (const t of existing) {
        const p = String(t.filePath || t.path || '');
        if (!p) continue;
        existingByPath.set(this.normalizePathForCompare(p), t);

        const quickFingerprint = this.sanitizeQuickFingerprint(t.quickFingerprint);
        if (quickFingerprint) {
          const bucket = existingByQuickFingerprint.get(quickFingerprint);
          if (bucket) {
            bucket.push(t);
          } else {
            existingByQuickFingerprint.set(quickFingerprint, [t]);
          }
        }
      }

      const seen = new Set<string>();
      const reusedTrackIds = new Set<string>();
      const upserts: StoredTrackRecord[] = [];
      const needMetadataPaths: string[] = [];

      for (const item of quick) {
        const itemPath = String(item.path || '').trim();
        if (!itemPath) {
          continue;
        }

        const itemFileName =
          String(item.fileName || item.file_name || '').trim() ||
          itemPath.split(/[\\/]/).pop() ||
          itemPath;
        const itemMtimeMs = pickFiniteNumber(item.mtimeMs, item.mtime_ms) ?? 0;
        const itemQuickFingerprint = this.sanitizeQuickFingerprint(
          item.quickFingerprint ?? item.quick_fingerprint
        );

        const normalizedPath = this.normalizePathForCompare(itemPath);
        seen.add(normalizedPath);

        let prev = existingByPath.get(normalizedPath);
        if (!prev && itemQuickFingerprint) {
          const fingerprintCandidates = existingByQuickFingerprint.get(itemQuickFingerprint) || [];
          prev =
            fingerprintCandidates.find((candidate) => {
              if (!candidate?.id || reusedTrackIds.has(candidate.id)) return false;
              const candidatePath = String(candidate.filePath || candidate.path || '');
              if (!candidatePath) return false;
              const normalizedCandidatePath = this.normalizePathForCompare(candidatePath);
              return !seen.has(normalizedCandidatePath);
            }) || undefined;
        }

        if (prev?.id) {
          reusedTrackIds.add(prev.id);
        }

        const isNew = !prev;
        const unchanged =
          prev &&
          typeof prev.mtimeMs === 'number' &&
          typeof prev.fileSize === 'number' &&
          prev.mtimeMs === itemMtimeMs &&
          prev.fileSize === item.size;

        const needsLibraryPathLink = Boolean(pathId) && prev && !prev.libraryPathId;
        const metadataScannedBefore = prev && typeof prev.metadataScannedAtMs === 'number';
        const hasSampleRate =
          !!prev &&
          typeof prev.sampleRate === 'number' &&
          Number.isFinite(prev.sampleRate) &&
          prev.sampleRate > 0;
        const hasDuration =
          !!prev &&
          typeof prev.duration === 'number' &&
          Number.isFinite(prev.duration) &&
          prev.duration > 0;
        const hasFileSize =
          !!prev &&
          typeof prev.fileSize === 'number' &&
          Number.isFinite(prev.fileSize) &&
          prev.fileSize > 0;
        const hasExplicitBitrate =
          !!prev &&
          typeof prev.bitrate === 'number' &&
          Number.isFinite(prev.bitrate) &&
          prev.bitrate > 0;
        const hasBitrateDisplayData = hasExplicitBitrate || (hasDuration && hasFileSize);
        const needsMetadataBackfill = !!prev && (!hasSampleRate || !hasBitrateDisplayData);
        const shouldProbeMetadata =
          isNew ||
          !unchanged ||
          (!metadataScannedBefore && enrichUnscannedMetadata) ||
          (enrichUnscannedMetadata && needsMetadataBackfill);

        if (shouldProbeMetadata) needMetadataPaths.push(itemPath);
        if (!isNew && unchanged && !needsLibraryPathLink && !shouldProbeMetadata) continue;

        const fallbackTitle = itemFileName.replace(/\.[^/.]+$/, '');
        upserts.push(
          {
            ...(prev ?? {}),
            id: prev?.id ?? this.stableIdFromPath(itemPath),
            title: prev?.title ?? fallbackTitle,
            fileSize: item.size,
            mtimeMs: itemMtimeMs,
            quickFingerprint: itemQuickFingerprint ?? prev?.quickFingerprint,
            filePath: itemPath,
            originalPath: itemPath,
            path: itemPath,
            libraryPathId: pathId ?? prev?.libraryPathId,
            addedAt: prev?.addedAt ?? Date.now(),
            mimeType: prev?.mimeType ?? this.guessMimeTypeFromPath(itemPath),
            file: undefined,
            fileContent: undefined,
          } as StoredTrackRecord
        );
      }

      const deletions = existing
        .filter((t) => {
          if (t?.id && reusedTrackIds.has(t.id)) return false;
          const p = String(t.filePath || t.path || '');
          if (!p) return false;
          const normalizedPath = this.normalizePathForCompare(p);
          return !seen.has(normalizedPath);
        })
        .map((t) => t.id)
        .filter(Boolean);

      // ML.2 Stage B: only probe metadata for added/modified/unscanned items.
      if (needMetadataPaths.length > 0) {
        const scannedMeta = await invoke<
          Array<{
            path: string;
            fileName?: string;
            file_name?: string;
            size: number;
            mtimeMs?: number;
            mtime_ms?: number;
            quickFingerprint?: string | null;
            quick_fingerprint?: string | null;
            duration?: number | null;
            sampleRate?: number | null;
            sample_rate?: number | null;
            title?: string | null;
            artist?: string | null;
            album?: string | null;
            replayGainTrackDb?: number | null;
            replay_gain_track_db?: number | null;
            replayGainAlbumDb?: number | null;
            replay_gain_album_db?: number | null;
          }>
        >('music_library_scan', {
          paths: needMetadataPaths,
          options: { includeMetadata: true },
        });

        const metaByPath = new Map<string, (typeof scannedMeta)[number]>();
        for (const item of scannedMeta) {
          metaByPath.set(this.normalizePathForCompare(item.path), item);
        }

        const now = Date.now();
        for (const record of upserts) {
          const p = String(record.filePath || record.path || '');
          if (!p) continue;
          const meta = metaByPath.get(this.normalizePathForCompare(p));
          if (!meta) continue;

          const title = String(meta.title || '').trim();
          const artist = String(meta.artist || '').trim();
          const album = String(meta.album || '').trim();

          if (title.length > 0) record.title = title;
          if (artist.length > 0) record.artist = artist;
          if (album.length > 0) record.album = album;
          const duration = pickFiniteNumber(meta.duration);
          const sampleRate = pickFiniteNumber(meta.sampleRate, meta.sample_rate);
          const replayGainTrackDb = pickFiniteNumber(
            meta.replayGainTrackDb,
            meta.replay_gain_track_db
          );
          const replayGainAlbumDb = pickFiniteNumber(
            meta.replayGainAlbumDb,
            meta.replay_gain_album_db
          );

          if (duration !== undefined) record.duration = duration;
          if (sampleRate !== undefined) record.sampleRate = sampleRate;
          if (replayGainTrackDb !== undefined) {
            record.replayGainTrackGainDb = replayGainTrackDb;
          }
          if (replayGainAlbumDb !== undefined) {
            record.replayGainAlbumGainDb = replayGainAlbumDb;
          }

          const quickFingerprint = this.sanitizeQuickFingerprint(
            meta.quickFingerprint ?? meta.quick_fingerprint
          );
          if (quickFingerprint) {
            record.quickFingerprint = quickFingerprint;
          }

          record.metadataScannedAtMs = now;
        }

        const normalizedNeed = new Set(needMetadataPaths.map((p) => this.normalizePathForCompare(p)));
        for (const record of upserts) {
          const p = String(record.filePath || record.path || '');
          if (!p) continue;
          if (record.metadataScannedAtMs) continue;
          if (normalizedNeed.has(this.normalizePathForCompare(p))) {
            record.metadataScannedAtMs = Date.now();
          }
        }
      }

      await this.applyBackendScanDiff(upserts, deletions);
      await this.trySyncNativeLibraryTracks(pathId, upserts, deletions);
      this.clearCache();

      if (pathId) {
        try {
          await this.updateLibraryPathScanSnapshot(pathId, quick.length);
        } catch (error) {
          console.error('Failed to update library path metadata:', error);
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Scan cancelled')) {
        return;
      }
      throw error;
    } finally {
      await unlisten();
      this.isScanning = false;
      if (!silentProgress) {
        this.notifyScanProgress({ total: 0, current: 0, isScanning: false });
      }
    }
  }

  private async getStoredTracksForBackendScan(
    folderPath: string,
    pathId?: string
  ): Promise<StoredTrackRecord[]> {
    const nativeTracks = await this.tryGetStoredTracksForBackendScanFromNativeDb(folderPath, pathId);
    if (nativeTracks) {
      return nativeTracks;
    }

    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');
      const folderPrefix = this.normalizeFolderPrefix(folderPath);

      const scanByPrefix = () => {
        const results: StoredTrackRecord[] = [];
        const request = store.openCursor();
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
          if (!cursor) {
            resolve(results);
            return;
          }
          const value = cursor.value as unknown as StoredTrackRecord;
          const p = String(value.filePath || value.path || '');
          if (p) {
            const normalized = this.normalizePathForCompare(p);
            if (normalized.startsWith(folderPrefix)) results.push(value);
          }
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      };

      if (pathId && store.indexNames.contains('libraryPathId')) {
        try {
          const index = store.index('libraryPathId');
          const request = index.getAll(pathId);
          request.onsuccess = () => {
            const result = (request.result || []) as unknown as StoredTrackRecord[];
            if (result.length > 0) {
              resolve(result);
              return;
            }
            scanByPrefix();
          };
          request.onerror = () => {
            scanByPrefix();
          };
        } catch (_error) {
          scanByPrefix();
        }
      } else {
        scanByPrefix();
      }
    });
  }

  private async tryGetStoredTracksForBackendScanFromNativeDb(
    folderPath: string,
    pathId?: string
  ): Promise<StoredTrackRecord[] | null> {
    if (!isTauriRuntime()) return null;

    const normalizedPathId = String(pathId || '').trim();
    if (!normalizedPathId) return null;

    try {
      const nativeTracks = await queryNativeLibraryTracks({
        includeMissing: true,
        visibleOnly: false,
        sourceId: normalizedPathId,
      });

      const folderPrefix = this.normalizeFolderPrefix(folderPath);
      return nativeTracks
        .map((item) => this.mapNativeTrackRecordToStoredTrack(item))
        .filter((track) => {
          const trackPath = String(track.filePath || track.path || '').trim();
          if (!trackPath) return false;
          return this.normalizePathForCompare(trackPath).startsWith(folderPrefix);
        });
    } catch (error) {
      console.warn(
        '[MusicLibraryService] native backend-scan source query failed, fallback to IndexedDB:',
        error
      );
      return null;
    }
  }

  private async applyBackendScanDiff(
    upserts: StoredTrackRecord[],
    deletions: string[]
  ): Promise<void> {
    if (upserts.length === 0 && deletions.length === 0) return;

    const db = await this.ensureDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readwrite');
      const store = transaction.objectStore('tracks');

      for (const item of upserts) {
        store.put(this.sanitizeTrackRecordForStorage(item));
      }

      for (const id of deletions) {
        store.delete(id);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // 批量存储轨道到数据库（优化：一个事务处理多条记录）
  private async batchStoreTracks(tracks: StoredTrackRecord[]): Promise<void> {
    const db = await this.ensureDB();
    const transaction = db.transaction(['tracks'], 'readwrite');
    const store = transaction.objectStore('tracks');

    for (const trackToStore of tracks) {
      try {
        const sanitizedTrack = this.sanitizeTrackRecordForStorage(trackToStore);
        if (!sanitizedTrack.path) {
          await new Promise<void>((resolve, reject) => {
            const request = store.add(sanitizedTrack);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });
        } else {
          // 检查是否已存在
          const existingRequest = store.index('path').get(sanitizedTrack.path);
          await new Promise<void>((resolve, reject) => {
            existingRequest.onsuccess = () => {
              try {
                if (!existingRequest.result) {
                  const addRequest = store.add(sanitizedTrack);
                  addRequest.onsuccess = () => resolve();
                  addRequest.onerror = () => reject(addRequest.error);
                } else {
                  const existing = existingRequest.result as unknown as StoredTrackRecord;
                  const updatedTrack = this.sanitizeTrackRecordForStorage({
                    ...existing,
                    ...sanitizedTrack,
                    id: existing.id,
                  });
                  const updateRequest = store.put(updatedTrack);
                  updateRequest.onsuccess = () => resolve();
                  updateRequest.onerror = () => reject(updateRequest.error);
                }
              } catch (err) {
                reject(err);
              }
            };
            existingRequest.onerror = () => reject(existingRequest.error);
          });
        }
      } catch (error) {
        console.error('Failed to store track:', error);
      }
    }

    // 等待整个事务完成
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(new Error('Transaction aborted'));
    });
  }

  // 递归收集音频文件（使用 File System Access API - 快速）
  private async collectAudioFilesFromHandle(
    dirHandle: FileSystemDirectoryHandle,
    audioFiles: Array<{
      path: string;
      name: string;
      file?: File;
      fileHandle?: FileSystemFileHandle;
    }>,
    basePath: string = ''
  ): Promise<void> {
    const supportedFormats = ['.mp3', '.flac', '.wav', '.dsf', '.m4a', '.mp4', '.ogg', '.weba', '.aac'];
    const currentPath = basePath ? `${basePath}/${dirHandle.name}` : dirHandle.name;

    try {
      const values = (dirHandle as unknown as {
        values: () => AsyncIterable<FileSystemHandle>;
      }).values();
      for await (const entry of values) {
        if (entry.kind === 'file') {
          const fileHandle = entry as FileSystemFileHandle;
          const ext = '.' + entry.name.split('.').pop()?.toLowerCase();

          if (supportedFormats.includes(ext)) {
            // ✅ 快速！File 对象是懒加载的，不立即读取内容
            const file = await fileHandle.getFile();
            audioFiles.push({
              path: `${currentPath}/${entry.name}`,
              name: entry.name,
              file: file,
              fileHandle: fileHandle, // ✅ 存储 FileHandle（可序列化）
            });
          }
        } else if (entry.kind === 'directory') {
          const subDirHandle = entry as FileSystemDirectoryHandle;
          await this.collectAudioFilesFromHandle(subDirHandle, audioFiles, currentPath);
        }
      }
    } catch (error) {
      console.error(`Error scanning directory:`, error);
      throw error;
    }
  }

  // 递归收集音频文件路径（使用 Tauri fs API - 较慢但支持绝对路径）
  private async collectAudioFilePaths(
    dirPath: string,
    audioFiles: Array<{
      path: string;
      name: string;
      file?: File;
      fileHandle?: FileSystemFileHandle;
    }>,
    relativePath: string = ''
  ): Promise<void> {
    const supportedFormats = ['.mp3', '.flac', '.wav', '.dsf', '.m4a', '.mp4', '.ogg', '.weba', '.aac'];

    console.log(`Scanning directory: ${dirPath}`);

    try {
      const entries = await readDir(dirPath, { recursive: false });

      for (const entry of entries) {
        if (entry.children) {
          // 是目录，递归扫描
          const newRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name || '';
          await this.collectAudioFilePaths(entry.path, audioFiles, newRelativePath);
        } else {
          // 是文件
          const ext = '.' + (entry.name?.split('.').pop()?.toLowerCase() || '');
          if (supportedFormats.includes(ext)) {
            audioFiles.push({
              path: entry.path,
              name: entry.name || '',
              file: undefined, // 没有 File 对象，需要读取
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
      throw error;
    }
  }

  // 添加库路径（通过字符串路径）
  async addLibraryPathByString(path: string, _displayName?: string): Promise<LibraryPath> {
    const db = await this.ensureDB();
    const pathId = `path-${Date.now()}`;

    // 检查路径是否已存在
    const existingPaths = await this.getLibraryPaths();
    const exists = existingPaths.some((p) => p.path === path);
    if (exists) {
      console.log(`Path already exists: ${path}`);
      return existingPaths.find((p) => p.path === path)!;
    }

    const pathInfo: LibraryPath = {
      id: pathId,
      path: path,
      addedAt: new Date(),
      trackCount: 0,
      isVisible: true,
      isScanned: true,
    };

    // 存储时将 Date 转换为时间戳
    const pathToStore = {
      ...pathInfo,
      addedAt: pathInfo.addedAt.getTime(),
    };

    const transaction = db.transaction(['libraryPaths'], 'readwrite');
    const store = transaction.objectStore('libraryPaths');
    store.add(pathToStore);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`Successfully added library path: ${path}`);
        resolve();
      };
      transaction.onerror = () => {
        console.error('Failed to add library path:', transaction.error);
        reject(transaction.error);
      };
    });

    await this.tryUpsertNativeLibrarySource(pathInfo);

    return pathInfo;
  }

  // 获取所有轨道（带限制，避免内存溢出）
  async getAllTracks(limit?: number, offset?: number): Promise<Track[]> {
    const nativeTracks = await this.tryGetAllTracksFromNativeDb(limit, offset);
    if (nativeTracks) {
      return nativeTracks;
    }

    const db = await this.ensureDB();
    const visibilityContext = await this.buildPathVisibilityContext();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');

      if (limit) {
        const safeOffset =
          typeof offset === 'number' && Number.isFinite(offset) && offset > 0
            ? Math.floor(offset)
            : 0;

        // 使用游标限制结果数量
        const tracks: Track[] = [];
        const request = store.openCursor();
        let count = 0;
        let skipped = 0;

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (!cursor) {
            resolve(tracks);
            return;
          }

          const value = cursor.value as unknown as StoredTrackRecord;
          if (!this.isStoredTrackVisible(value, visibilityContext)) {
            cursor.continue();
            return;
          }

          if (skipped < safeOffset) {
            skipped++;
            cursor.continue();
            return;
          }

          if (count < limit) {
            tracks.push(this.restoreTrackForListProjection(value));
            count++;
            cursor.continue();
          } else {
            resolve(tracks);
          }
        };
        request.onerror = () => reject(request.error);
      } else {
        // 获取所有
        const request = store.getAll();
        request.onsuccess = () => {
          const raw = Array.isArray(request.result) ? request.result : [];
          const restoredTracks = raw
            .filter((track) =>
              this.isStoredTrackVisible(track as unknown as StoredTrackRecord, visibilityContext)
            )
            .map((track) =>
              this.restoreTrackForListProjection(track as unknown as StoredTrackRecord)
            );
          resolve(restoredTracks);
        };
        request.onerror = () => reject(request.error);
      }
    });
  }

  // 搜索轨道（避免一次性加载全库导致卡顿）
  async searchTracks(query: string, limit?: number): Promise<Track[]> {
    const q = query.trim().toLowerCase();
    if (!q) return typeof limit === 'number' ? this.getAllTracks(limit) : this.getAllTracks();

    const nativeTracks = await this.trySearchTracksFromNativeDb(q, limit);
    if (nativeTracks) {
      return nativeTracks;
    }

    const db = await this.ensureDB();
    const visibilityContext = await this.buildPathVisibilityContext();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');

      const results: Track[] = [];
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!cursor) {
          resolve(results);
          return;
        }

        const value = cursor.value as unknown as StoredTrackRecord;
        if (!this.isStoredTrackVisible(value, visibilityContext)) {
          cursor.continue();
          return;
        }
        const title = String(value.title || '').toLowerCase();
        const artist = String(value.artist || '').toLowerCase();
        const album = String(value.album || '').toLowerCase();

        if (title.includes(q) || artist.includes(q) || album.includes(q)) {
          results.push(this.restoreTrackForListProjection(value));
          if (typeof limit === 'number' && results.length >= limit) {
            resolve(results);
            return;
          }
        }

        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  }

  // 从存储的track恢复用于播放的track对象
  private restoreTrackForPlayback(storedTrack: StoredTrackRecord): Track {
    const toOptionalString = (value: unknown): string | undefined => {
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim();
      return trimmed ? trimmed : undefined;
    };
    const toOptionalNumber = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) ? value : undefined;

    const legacyTrack = storedTrack as StoredTrackRecord & {
      sample_rate?: unknown;
      bitrate_kbps?: unknown;
      bitrate_bps?: unknown;
      file_size?: unknown;
      mtime_ms?: unknown;
      replay_gain_track_db?: unknown;
      replay_gain_album_db?: unknown;
      quick_fingerprint?: unknown;
      metadata_scanned_at_ms?: unknown;
      library_path_id?: unknown;
      original_path?: unknown;
      cover_key?: unknown;
    };

    const rawBitrate = toOptionalNumber(
      storedTrack.bitrate ?? legacyTrack.bitrate_kbps ?? legacyTrack.bitrate_bps
    );
    const normalizedBitrate =
      typeof rawBitrate === 'number' ? (rawBitrate > 2000 ? rawBitrate / 1000 : rawBitrate) : undefined;

    const normalizedPath =
      toOptionalString(storedTrack.filePath) || toOptionalString(storedTrack.path) || undefined;

    const track: Track & Record<string, unknown> = {
      id: toOptionalString(storedTrack.id) || this.stableIdFromPath(normalizedPath || 'unknown'),
      title:
        toOptionalString(storedTrack.title) ||
        (normalizedPath ? normalizedPath.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') : undefined) ||
        'Unknown',
      artist: toOptionalString(storedTrack.artist),
      album: toOptionalString(storedTrack.album),
      albumArtist: toOptionalString(storedTrack.albumArtist),
      duration: toOptionalNumber(storedTrack.duration),
      year: toOptionalNumber(storedTrack.year),
      genre: toOptionalString(storedTrack.genre),
      trackNumber: toOptionalNumber(storedTrack.trackNumber),
      discNumber: toOptionalNumber(storedTrack.discNumber),
      composer: toOptionalString(storedTrack.composer),
      bitrate: normalizedBitrate,
      sampleRate: toOptionalNumber(storedTrack.sampleRate ?? legacyTrack.sample_rate),
      replayGainTrackGainDb: toOptionalNumber(
        storedTrack.replayGainTrackGainDb ?? legacyTrack.replay_gain_track_db
      ),
      replayGainAlbumGainDb: toOptionalNumber(
        storedTrack.replayGainAlbumGainDb ?? legacyTrack.replay_gain_album_db
      ),
      format: toOptionalString(storedTrack.format),
      codecName: toOptionalString(storedTrack.codecName),
      fileSize: toOptionalNumber(storedTrack.fileSize ?? legacyTrack.file_size),
      dateAdded: toOptionalNumber(storedTrack.dateAdded),
      lastPlayed: toOptionalNumber(storedTrack.lastPlayed),
      playCount: toOptionalNumber(storedTrack.playCount),
      rating: toOptionalNumber(storedTrack.rating),
      favorite: typeof storedTrack.favorite === 'boolean' ? storedTrack.favorite : undefined,
      tags: Array.isArray(storedTrack.tags)
        ? storedTrack.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
        : undefined,
      comment: toOptionalString(storedTrack.comment),
      mimeType: toOptionalString(storedTrack.mimeType),
      quickFingerprint: this.sanitizeQuickFingerprint(
        storedTrack.quickFingerprint ?? legacyTrack.quick_fingerprint
      ),
      mtimeMs: toOptionalNumber(storedTrack.mtimeMs ?? legacyTrack.mtime_ms),
      metadataScannedAtMs: toOptionalNumber(
        storedTrack.metadataScannedAtMs ?? legacyTrack.metadata_scanned_at_ms
      ),
      libraryPathId: toOptionalString(storedTrack.libraryPathId ?? legacyTrack.library_path_id),
      originalPath: toOptionalString(storedTrack.originalPath ?? legacyTrack.original_path),
      coverKey: toOptionalString(storedTrack.coverKey ?? legacyTrack.cover_key),
      path: normalizedPath,
      filePath: normalizedPath,
    };

    this.copyDynamicTrackFields(storedTrack as unknown as Record<string, unknown>, track, {
      skipKeys: [
        'id',
        'title',
        'artist',
        'album',
        'albumArtist',
        'duration',
        'year',
        'genre',
        'trackNumber',
        'discNumber',
        'composer',
        'bitrate',
        'sampleRate',
        'replayGainTrackGainDb',
        'replayGainAlbumGainDb',
        'format',
        'codecName',
        'fileSize',
        'dateAdded',
        'lastPlayed',
        'playCount',
        'rating',
        'favorite',
        'tags',
        'comment',
        'mimeType',
        'quickFingerprint',
        'mtimeMs',
        'metadataScannedAtMs',
        'libraryPathId',
        'originalPath',
        'coverKey',
        'path',
        'filePath',
        'coverUrl',
        'addedAt',
      ],
    });

    const rawCoverUrl = storedTrack.coverUrl;
    track.coverUrl = this.sanitizeStoredCoverUrlForPath(rawCoverUrl, track.filePath || track.path);
    if (
      typeof storedTrack.id === 'string' &&
      !track.coverUrl &&
      typeof rawCoverUrl === 'string' &&
      rawCoverUrl.length > 0
    ) {
      const audioPath = String(track.filePath || track.path || '');
      if (audioPath && this.isLikelyAbsolutePath(audioPath)) {
        const lower = rawCoverUrl.trim().toLowerCase();
        if (
          lower.startsWith('data:') ||
          lower.startsWith('blob:') ||
          lower.startsWith('asset:') ||
          lower.startsWith('tauri:')
        ) {
          this.scheduleLegacyCoverUrlDrop(storedTrack.id);
        }
      }
    }

    if (typeof storedTrack.addedAt === 'number') {
      track.addedAt = new Date(storedTrack.addedAt);
    }

    // 直接使用文件路径，供播放器读取
    if (track.filePath && track.path !== track.filePath) {
      track.path = track.filePath;
    }

    return track;
  }

  // 测试权限是否有效
  async testFileHandlePermissions(): Promise<{
    total: number;
    accessible: number;
    needAuth: number;
  }> {
    const tracks = await this.getAllTracks(100); // 测试前100首
    let accessible = 0;
    let needAuth = 0;

    for (const track of tracks) {
      if (track.fileHandle) {
        try {
          // 尝试访问文件，检查权限
          await track.fileHandle.getFile();
          accessible++;
        } catch (error) {
          needAuth++;
        }
      }
    }

    return { total: tracks.length, accessible, needAuth };
  }

  // ✅ 请求单个 FileHandle 的权限
  async requestFileHandlePermission(fileHandle: FileSystemFileHandle): Promise<boolean> {
    try {
      type PermissionCapableFileHandle = FileSystemFileHandle & {
        queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
        requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
      };
      const handle = fileHandle as unknown as PermissionCapableFileHandle;
      if (typeof handle.queryPermission !== 'function' || typeof handle.requestPermission !== 'function') {
        // 浏览器不支持权限 API
        return false;
      }

      const permission = await handle.queryPermission({ mode: 'read' });
      if (permission === 'granted') {
        return true;
      }

      if (permission === 'prompt') {
        const newPermission = await handle.requestPermission({ mode: 'read' });
        return newPermission === 'granted';
      }

      return false;
    } catch (error) {
      console.error('[MusicLibrary] Failed to request permission:', error);
      return false;
    }
  }
  // 检查文件是否存在
  async checkTrackAvailability(track: Track): Promise<boolean> {
    if (!track.filePath) {
      console.warn(`[MusicLibrary] Track ${track.title} has no filePath`);
      return false;
    }

    try {
      const fileExists = await exists(track.filePath);
      if (!fileExists) {
        console.warn(`[MusicLibrary] File not found for track ${track.title}: ${track.filePath}`);
      }
      return fileExists;
    } catch (error) {
      console.error(`[MusicLibrary] Error checking file existence for ${track.title}:`, error);
      return false;
    }
  }

  // 批量检查轨道可用性
  async checkTracksAvailability(tracks: Track[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const track of tracks) {
      const available = await this.checkTrackAvailability(track);
      results.set(track.id, available);
    }

    return results;
  }

  private async markTrackPlayedInIndexedDb(trackId: string, playedAtMs: number): Promise<boolean> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readwrite');
      const store = transaction.objectStore('tracks');
      const request = store.get(trackId);

      request.onsuccess = () => {
        const current = request.result as StoredTrackRecord | undefined;
        if (!current || typeof current !== 'object') {
          resolve(false);
          return;
        }

        const playCountRaw =
          typeof current.playCount === 'number' && Number.isFinite(current.playCount)
            ? current.playCount
            : 0;
        const nextRecord: StoredTrackRecord = {
          ...current,
          playCount: Math.max(0, Math.floor(playCountRaw)) + 1,
          lastPlayed: playedAtMs,
        };

        const putRequest = store.put(nextRecord);
        putRequest.onsuccess = () => resolve(true);
        putRequest.onerror = () => reject(putRequest.error);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async markTrackPlayed(trackId: string, options?: { playedAtMs?: number }): Promise<boolean> {
    const normalizedTrackId = String(trackId || '').trim();
    if (!normalizedTrackId) return false;

    const playedAtMs =
      typeof options?.playedAtMs === 'number' && Number.isFinite(options.playedAtMs)
        ? Math.max(0, Math.floor(options.playedAtMs))
        : Date.now();

    let nativeUpdated = false;
    if (isTauriRuntime()) {
      try {
        nativeUpdated = await markNativeLibraryTrackPlayed(normalizedTrackId, { playedAtMs });
      } catch (error) {
        console.warn('[MusicLibraryService] failed to mark native track playback:', normalizedTrackId, error);
      }
    }

    try {
      const indexedUpdated = await this.markTrackPlayedInIndexedDb(normalizedTrackId, playedAtMs);
      return nativeUpdated || indexedUpdated;
    } catch (error) {
      if (!nativeUpdated) {
        console.warn(
          '[MusicLibraryService] failed to mark indexeddb track playback:',
          normalizedTrackId,
          error
        );
      }
      return nativeUpdated;
    }
  }

  async upsertCloudLibraryEntry(
    input: CloudLibraryEntryUpsertInput
  ): Promise<NativeLibraryUserEntryRecord | null> {
    if (!isTauriRuntime()) return null;

    const entryId = String(input.entryId || '').trim();
    const ownerUid = String(input.ownerUid || '').trim();
    if (!entryId || !ownerUid) return null;

    try {
      return await upsertNativeLibraryUserEntry({
        id: entryId,
        ownerUid,
        trackId: typeof input.trackId === 'string' ? input.trackId.trim() : undefined,
        quickFingerprint: this.sanitizeQuickFingerprint(input.quickFingerprint),
        cloudContentId:
          typeof input.cloudContentId === 'string' ? input.cloudContentId.trim() : undefined,
        displayTitle:
          typeof input.displayTitle === 'string' ? input.displayTitle.trim() : undefined,
        displayArtist:
          typeof input.displayArtist === 'string' ? input.displayArtist.trim() : undefined,
        rating:
          typeof input.rating === 'number' && Number.isFinite(input.rating)
            ? Math.max(0, Math.min(100, Math.floor(input.rating)))
            : undefined,
        tagsJson: typeof input.tagsJson === 'string' ? input.tagsJson.trim() : undefined,
        inCloud: input.inCloud === true,
        isMissing: input.isMissing === true,
        createdAtMs:
          typeof input.createdAtMs === 'number' && Number.isFinite(input.createdAtMs)
            ? Math.max(0, Math.floor(input.createdAtMs))
            : undefined,
        updatedAtMs:
          typeof input.updatedAtMs === 'number' && Number.isFinite(input.updatedAtMs)
            ? Math.max(0, Math.floor(input.updatedAtMs))
            : undefined,
      });
    } catch (error) {
      console.warn('[MusicLibraryService] failed to upsert cloud library entry:', error);
      return null;
    }
  }

  async listCloudLibraryEntries(
    query?: CloudLibraryEntryQuery
  ): Promise<NativeLibraryUserEntryRecord[]> {
    if (!isTauriRuntime()) return [];
    try {
      const payload: NativeLibraryUserEntryQuery = {
        ownerUid: typeof query?.ownerUid === 'string' ? query.ownerUid.trim() : undefined,
        limit:
          typeof query?.limit === 'number' && Number.isFinite(query.limit)
            ? Math.max(1, Math.min(2000, Math.floor(query.limit)))
            : undefined,
        offset:
          typeof query?.offset === 'number' && Number.isFinite(query.offset)
            ? Math.max(0, Math.floor(query.offset))
            : undefined,
        inCloudOnly: query?.inCloudOnly === true,
        includeMissing: query?.includeMissing !== false,
        searchQuery:
          typeof query?.searchQuery === 'string' && query.searchQuery.trim().length > 0
            ? query.searchQuery.trim()
            : undefined,
      };
      return await listNativeLibraryUserEntries(payload);
    } catch (error) {
      console.warn('[MusicLibraryService] failed to list cloud library entries:', error);
      return [];
    }
  }

  async deleteCloudLibraryEntry(entryId: string): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    const normalizedEntryId = String(entryId || '').trim();
    if (!normalizedEntryId) return false;

    try {
      return await deleteNativeLibraryUserEntry(normalizedEntryId);
    } catch (error) {
      console.warn('[MusicLibraryService] failed to delete cloud library entry:', error);
      return false;
    }
  }

  async markCloudLibraryEntryPlayed(
    entryId: string,
    options?: { playedAtMs?: number }
  ): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    const normalizedEntryId = String(entryId || '').trim();
    if (!normalizedEntryId) return false;

    const playedAtMs =
      typeof options?.playedAtMs === 'number' && Number.isFinite(options.playedAtMs)
        ? Math.max(0, Math.floor(options.playedAtMs))
        : Date.now();

    try {
      return await markNativeLibraryUserEntryPlayed(normalizedEntryId, { playedAtMs });
    } catch (error) {
      console.warn('[MusicLibraryService] failed to mark cloud entry played:', error);
      return false;
    }
  }

  async queueCloudFallbackTask(
    request: CloudLibraryNetworkFallbackRequest
  ): Promise<NativeLibraryFallbackTaskRecord | null> {
    if (!isTauriRuntime()) return null;

    const ownerUid = String(request.ownerUid || '').trim();
    const entryId = String(request.entryId || '').trim();
    if (!ownerUid || !entryId) return null;

    try {
      return await upsertNativeLibraryFallbackTask({
        ownerUid,
        entryId,
        cloudContentId:
          typeof request.cloudContentId === 'string' ? request.cloudContentId.trim() : undefined,
        trackId: typeof request.trackId === 'string' ? request.trackId.trim() : undefined,
        quickFingerprint: this.sanitizeQuickFingerprint(request.quickFingerprint),
        reason: request.reason,
        requestedAtMs:
          typeof request.requestedAtMs === 'number' && Number.isFinite(request.requestedAtMs)
            ? Math.max(0, Math.floor(request.requestedAtMs))
            : Date.now(),
      });
    } catch (error) {
      console.warn('[MusicLibraryService] failed to queue cloud fallback task:', error);
      return null;
    }
  }

  async listCloudFallbackTasks(
    query?: CloudFallbackTaskQuery
  ): Promise<NativeLibraryFallbackTaskRecord[]> {
    if (!isTauriRuntime()) return [];
    try {
      const payload: NativeLibraryFallbackTaskQuery = {
        ownerUid: typeof query?.ownerUid === 'string' ? query.ownerUid.trim() : undefined,
        status: typeof query?.status === 'string' ? query.status.trim() : undefined,
        limit:
          typeof query?.limit === 'number' && Number.isFinite(query.limit)
            ? Math.max(1, Math.min(2000, Math.floor(query.limit)))
            : undefined,
        offset:
          typeof query?.offset === 'number' && Number.isFinite(query.offset)
            ? Math.max(0, Math.floor(query.offset))
            : undefined,
      };
      return await listNativeLibraryFallbackTasks(payload);
    } catch (error) {
      console.warn('[MusicLibraryService] failed to list cloud fallback tasks:', error);
      return [];
    }
  }

  async updateCloudFallbackTaskStatus(
    taskId: string,
    status: CloudFallbackTaskStatus,
    options?: { lastError?: string }
  ): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) return false;

    try {
      return await updateNativeLibraryFallbackTaskStatus(normalizedTaskId, status, {
        lastError: typeof options?.lastError === 'string' ? options.lastError.trim() : undefined,
      });
    } catch (error) {
      console.warn('[MusicLibraryService] failed to update cloud fallback task status:', error);
      return false;
    }
  }

  async upsertCloudHashJob(
    input: CloudHashJobUpsertInput
  ): Promise<NativeLibraryCloudHashJobRecord | null> {
    if (!isTauriRuntime()) return null;

    const ownerUid = String(input.ownerUid || '').trim();
    const entryId = String(input.entryId || '').trim();
    if (!ownerUid || !entryId) return null;

    try {
      return await upsertNativeLibraryCloudHashJob({
        id: typeof input.jobId === 'string' ? input.jobId.trim() : undefined,
        ownerUid,
        entryId,
        trackId: typeof input.trackId === 'string' ? input.trackId.trim() : undefined,
        quickFingerprint: this.sanitizeQuickFingerprint(input.quickFingerprint),
        status: typeof input.status === 'string' ? input.status : undefined,
        cloudFullHash:
          typeof input.cloudFullHash === 'string' ? input.cloudFullHash.trim() : undefined,
        lastError: typeof input.lastError === 'string' ? input.lastError.trim() : undefined,
        requestedAtMs:
          typeof input.requestedAtMs === 'number' && Number.isFinite(input.requestedAtMs)
            ? Math.max(0, Math.floor(input.requestedAtMs))
            : undefined,
      });
    } catch (error) {
      console.warn('[MusicLibraryService] failed to upsert cloud hash job:', error);
      return null;
    }
  }

  async listCloudHashJobs(query?: CloudHashJobQuery): Promise<NativeLibraryCloudHashJobRecord[]> {
    if (!isTauriRuntime()) return [];
    try {
      const payload: NativeLibraryCloudHashJobQuery = {
        ownerUid: typeof query?.ownerUid === 'string' ? query.ownerUid.trim() : undefined,
        status: typeof query?.status === 'string' ? query.status.trim() : undefined,
        limit:
          typeof query?.limit === 'number' && Number.isFinite(query.limit)
            ? Math.max(1, Math.min(2000, Math.floor(query.limit)))
            : undefined,
        offset:
          typeof query?.offset === 'number' && Number.isFinite(query.offset)
            ? Math.max(0, Math.floor(query.offset))
            : undefined,
      };
      return await listNativeLibraryCloudHashJobs(payload);
    } catch (error) {
      console.warn('[MusicLibraryService] failed to list cloud hash jobs:', error);
      return [];
    }
  }

  async updateCloudHashJobStatus(
    jobId: string,
    status: CloudHashJobStatus,
    options?: { cloudFullHash?: string; lastError?: string }
  ): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) return false;

    try {
      return await updateNativeLibraryCloudHashJobStatus(normalizedJobId, status, {
        cloudFullHash:
          typeof options?.cloudFullHash === 'string' ? options.cloudFullHash.trim() : undefined,
        lastError: typeof options?.lastError === 'string' ? options.lastError.trim() : undefined,
      });
    } catch (error) {
      console.warn('[MusicLibraryService] failed to update cloud hash job status:', error);
      return false;
    }
  }

  async getSyncOrchestratorStatus(): Promise<NativeLibrarySyncStatus | null> {
    if (!isTauriRuntime()) return null;
    try {
      return await getNativeLibrarySyncStatus();
    } catch (error) {
      console.warn('[MusicLibraryService] failed to get sync orchestrator status:', error);
      return null;
    }
  }

  async runSyncOrchestratorTick(reason?: string): Promise<NativeLibrarySyncTickResult | null> {
    if (!isTauriRuntime()) return null;
    const normalizedReason =
      typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : undefined;

    try {
      return await runNativeLibrarySyncTick(normalizedReason);
    } catch (error) {
      console.warn('[MusicLibraryService] failed to run sync orchestrator tick:', error);
      return null;
    }
  }

  async getSyncSchedulerStatus(): Promise<NativeLibrarySyncSchedulerStatus | null> {
    if (!isTauriRuntime()) return null;
    try {
      return await getNativeLibrarySyncSchedulerStatus();
    } catch (error) {
      console.warn('[MusicLibraryService] failed to get sync scheduler status:', error);
      return null;
    }
  }

  async startSyncScheduler(intervalMs?: number): Promise<NativeLibrarySyncSchedulerStatus | null> {
    if (!isTauriRuntime()) return null;

    const normalizedIntervalMs =
      typeof intervalMs === 'number' && Number.isFinite(intervalMs)
        ? Math.max(1000, Math.floor(intervalMs))
        : undefined;

    try {
      return await startNativeLibrarySyncScheduler({ intervalMs: normalizedIntervalMs });
    } catch (error) {
      console.warn('[MusicLibraryService] failed to start sync scheduler:', error);
      return null;
    }
  }

  async stopSyncScheduler(): Promise<NativeLibrarySyncSchedulerStatus | null> {
    if (!isTauriRuntime()) return null;
    try {
      return await stopNativeLibrarySyncScheduler();
    } catch (error) {
      console.warn('[MusicLibraryService] failed to stop sync scheduler:', error);
      return null;
    }
  }

  async getSyncFailureOverview(limit?: number): Promise<NativeLibrarySyncFailureOverview | null> {
    if (!isTauriRuntime()) return null;

    const normalizedLimit =
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.max(1, Math.min(1000, Math.floor(limit)))
        : undefined;

    try {
      return await getNativeLibrarySyncFailureOverview({ limit: normalizedLimit });
    } catch (error) {
      console.warn('[MusicLibraryService] failed to get sync failure overview:', error);
      return null;
    }
  }

  async retrySyncFailedSources(options?: {
    sourceIds?: string[];
    reason?: string;
  }): Promise<NativeLibrarySyncRetryResult | null> {
    if (!isTauriRuntime()) return null;

    const sourceIds = Array.isArray(options?.sourceIds) ? options.sourceIds : undefined;
    const normalizedSourceIds = sourceIds
      ? sourceIds
          .map((sourceId) => (typeof sourceId === 'string' ? sourceId.trim() : ''))
          .filter((sourceId) => sourceId.length > 0)
      : undefined;
    const normalizedReason =
      typeof options?.reason === 'string' && options.reason.trim().length > 0
        ? options.reason.trim()
        : undefined;

    try {
      return await retryNativeLibrarySyncFailedSources({
        sourceIds: normalizedSourceIds,
        reason: normalizedReason,
      });
    } catch (error) {
      console.warn('[MusicLibraryService] failed to retry sync failed sources:', error);
      return null;
    }
  }

  async clearSyncFailedSources(options?: {
    sourceIds?: string[];
  }): Promise<NativeLibrarySyncClearResult | null> {
    if (!isTauriRuntime()) return null;

    const sourceIds = Array.isArray(options?.sourceIds) ? options.sourceIds : undefined;
    const normalizedSourceIds = sourceIds
      ? sourceIds
          .map((sourceId) => (typeof sourceId === 'string' ? sourceId.trim() : ''))
          .filter((sourceId) => sourceId.length > 0)
      : undefined;

    try {
      return await clearNativeLibrarySyncFailedSources({
        sourceIds: normalizedSourceIds,
      });
    } catch (error) {
      console.warn('[MusicLibraryService] failed to clear sync failed sources:', error);
      return null;
    }
  }

  async listUnifiedMusicSources(): Promise<UnifiedMusicSource[]> {
    if (!isTauriRuntime()) return [];
    try {
      return await listMusicSourceFacadeItems();
    } catch (error) {
      console.warn('[MusicLibraryService] failed to list unified music sources:', error);
      return [];
    }
  }

  async searchUnifiedTracks(options: {
    query: string;
    limit?: number;
    sourceIds?: string[];
  }): Promise<UnifiedTrackCandidate[]> {
    if (!isTauriRuntime()) return [];
    try {
      return await searchMusicSourceTracks(options);
    } catch (error) {
      console.warn('[MusicLibraryService] failed to search unified tracks:', error);
      return [];
    }
  }

  async getBilibiliAuthStatus(): Promise<BilibiliAuthStatus | null> {
    if (!isTauriRuntime()) return null;
    try {
      return await getNativeBilibiliAuthStatus();
    } catch (error) {
      console.warn('[MusicLibraryService] failed to get Bilibili auth status:', error);
      return null;
    }
  }

  async generateBilibiliQrCodeSession(): Promise<BilibiliQrCodeSession | null> {
    if (!isTauriRuntime()) return null;
    try {
      return await generateNativeBilibiliQrCodeSession();
    } catch (error) {
      console.warn('[MusicLibraryService] failed to generate Bilibili QR session:', error);
      return null;
    }
  }

  async pollBilibiliQrCodeSession(sessionId: string): Promise<BilibiliQrPollResult | null> {
    if (!isTauriRuntime()) return null;
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) return null;
    try {
      return await pollNativeBilibiliQrCodeSession(normalizedSessionId);
    } catch (error) {
      console.warn('[MusicLibraryService] failed to poll Bilibili QR session:', error);
      return null;
    }
  }

  async logoutBilibili(): Promise<BilibiliAuthStatus | null> {
    if (!isTauriRuntime()) return null;
    try {
      return await logoutNativeBilibili();
    } catch (error) {
      console.warn('[MusicLibraryService] failed to logout Bilibili:', error);
      return null;
    }
  }

  async resolveLocalPlaybackCandidate(
    input: LocalPlaybackResolveInput
  ): Promise<LocalPlaybackResolveResult> {
    const normalizedTrackId = String(input.trackId || '').trim();
    const normalizedQuickFingerprint = this.sanitizeQuickFingerprint(input.quickFingerprint);
    const normalizedFilePath = String(input.filePath || '').trim();
    const normalizedSourceId = String(input.sourceId || '').trim();
    const includeMissing = input.includeMissing === true;
    const visibleOnly = input.visibleOnly === true;

    if (isTauriRuntime()) {
      try {
        if (normalizedTrackId) {
          const rows = await queryNativeLibraryTracks({
            limit: 1,
            offset: 0,
            includeMissing,
            visibleOnly,
            trackId: normalizedTrackId,
            sourceId: normalizedSourceId || undefined,
          });
          const preferred = this.pickPreferredNativeTrackRecord(rows);
          if (preferred) {
            return {
              track: this.restoreTrackForPlayback(this.mapNativeTrackRecordToStoredTrack(preferred)),
              strategy: 'trackId',
              requiresNetworkFallback: false,
            };
          }
        }

        if (normalizedQuickFingerprint) {
          const rows = await queryNativeLibraryTracks({
            limit: 16,
            offset: 0,
            includeMissing,
            visibleOnly,
            quickFingerprint: normalizedQuickFingerprint,
            sourceId: normalizedSourceId || undefined,
          });
          const preferred = this.pickPreferredNativeTrackRecord(rows);
          if (preferred) {
            return {
              track: this.restoreTrackForPlayback(this.mapNativeTrackRecordToStoredTrack(preferred)),
              strategy: 'quickFingerprint',
              requiresNetworkFallback: false,
            };
          }
        }

        if (normalizedFilePath) {
          const rows = await queryNativeLibraryTracks({
            limit: 1,
            offset: 0,
            includeMissing,
            visibleOnly,
            filePath: normalizedFilePath,
            sourceId: normalizedSourceId || undefined,
          });
          const preferred = this.pickPreferredNativeTrackRecord(rows);
          if (preferred) {
            return {
              track: this.restoreTrackForPlayback(this.mapNativeTrackRecordToStoredTrack(preferred)),
              strategy: 'filePath',
              requiresNetworkFallback: false,
            };
          }
        }
      } catch (error) {
        console.warn('[MusicLibraryService] local playback resolve from native db failed:', error);
      }
    }

    if (normalizedTrackId) {
      const track = await this.getTrackById(normalizedTrackId).catch(() => null);
      if (track) {
        return {
          track,
          strategy: 'trackId',
          requiresNetworkFallback: false,
        };
      }
    }

    return {
      track: null,
      strategy: 'none',
      requiresNetworkFallback: true,
    };
  }

  async resolvePlaybackPlanForCloudEntry(
    blueprint: CloudLibraryPlaybackBlueprint
  ): Promise<CloudLibraryPlaybackPlan> {
    const entryId = String(blueprint.entryId || '').trim();
    const ownerUid = String(blueprint.ownerUid || '').trim();
    if (!entryId || !ownerUid) {
      throw new Error('Cloud playback blueprint requires entryId and ownerUid');
    }

    if (isTauriRuntime()) {
      void this.upsertCloudLibraryEntry({
        entryId,
        ownerUid,
        trackId: blueprint.trackId,
        quickFingerprint: blueprint.quickFingerprint,
        cloudContentId: blueprint.cloudContentId,
        inCloud: true,
        updatedAtMs: Date.now(),
      });
    }

    const local = await this.resolveLocalPlaybackCandidate({
      trackId: blueprint.trackId,
      quickFingerprint: blueprint.quickFingerprint,
      filePath: blueprint.filePath,
      sourceId: blueprint.sourceId,
      includeMissing: blueprint.includeMissing,
      visibleOnly: blueprint.visibleOnly,
    });

    if (local.track) {
      const strategy =
        local.strategy === 'trackId'
          ? 'local-trackId'
          : local.strategy === 'quickFingerprint'
            ? 'local-quickFingerprint'
            : 'local-filePath';

      if (isTauriRuntime()) {
        void this.markCloudLibraryEntryPlayed(entryId, { playedAtMs: Date.now() });
      }

      return {
        entryId,
        ownerUid,
        local,
        strategy,
      };
    }

    const networkFallback: CloudLibraryNetworkFallbackRequest = {
      entryId,
      ownerUid,
      cloudContentId:
        typeof blueprint.cloudContentId === 'string' && blueprint.cloudContentId.trim().length > 0
          ? blueprint.cloudContentId.trim()
          : undefined,
      trackId:
        typeof blueprint.trackId === 'string' && blueprint.trackId.trim().length > 0
          ? blueprint.trackId.trim()
          : undefined,
      quickFingerprint: this.sanitizeQuickFingerprint(blueprint.quickFingerprint),
      requestedAtMs: Date.now(),
      reason: 'local-miss',
    };

    let fallbackDispatch: CloudPlaybackFallbackDispatchResult | undefined;
    try {
      fallbackDispatch = await getCloudPlaybackFallbackAdapter().dispatch(networkFallback);
    } catch (error) {
      console.warn('[MusicLibraryService] cloud fallback dispatch bridge failed:', error);
    }

    return {
      entryId,
      ownerUid,
      local,
      strategy: 'network-blueprint',
      networkFallback,
      fallbackDispatch,
    };
  }

  async getTrackById(trackId: string): Promise<Track | null> {
    const nativeTrack = await this.tryGetTrackByIdFromNativeDb(trackId);
    if (nativeTrack) {
      return nativeTrack;
    }

    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');
      const request = store.get(trackId);

      request.onsuccess = () => {
        const raw = request.result;
        if (!raw) {
          resolve(null);
          return;
        }
        resolve(this.restoreTrackForPlayback(raw as unknown as StoredTrackRecord));
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 按艺术家获取轨道
  async getTracksByArtist(artist: string): Promise<Track[]> {
    const nativeTracks = await this.tryGetTracksByArtistFromNativeDb(artist);
    if (nativeTracks) {
      return nativeTracks;
    }

    const db = await this.ensureDB();
    const visibilityContext = await this.buildPathVisibilityContext();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');
      const index = store.index('artist');
      const request = index.getAll(artist);

      request.onsuccess = () => {
        const raw = Array.isArray(request.result) ? request.result : [];
        const restoredTracks = raw
          .filter((track) =>
            this.isStoredTrackVisible(track as unknown as StoredTrackRecord, visibilityContext)
          )
          .map((track) => this.restoreTrackForPlayback(track as unknown as StoredTrackRecord));
        resolve(restoredTracks);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 按专辑获取轨道
  async getTracksByAlbum(album: string): Promise<Track[]> {
    const nativeTracks = await this.tryGetTracksByAlbumFromNativeDb(album);
    if (nativeTracks) {
      return nativeTracks;
    }

    const db = await this.ensureDB();
    const visibilityContext = await this.buildPathVisibilityContext();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');
      const index = store.index('album');
      const request = index.getAll(album);

      request.onsuccess = () => {
        const raw = Array.isArray(request.result) ? request.result : [];
        const restoredTracks = raw
          .filter((track) =>
            this.isStoredTrackVisible(track as unknown as StoredTrackRecord, visibilityContext)
          )
          .map((track) => this.restoreTrackForPlayback(track as unknown as StoredTrackRecord));
        resolve(restoredTracks);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 获取所有艺术家
  async getAllArtists(): Promise<string[]> {
    const nativeArtists = await this.tryGetAllArtistsFromNativeDb();
    if (nativeArtists) {
      return nativeArtists;
    }

    const db = await this.ensureDB();
    const visibilityContext = await this.buildPathVisibilityContext();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');

      const request = (store.indexNames.contains('artist') ? store.index('artist') : store).openCursor();
      const seen = new Set<string>();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!cursor) {
          resolve(Array.from(seen).sort());
          return;
        }
        const value = cursor.value as unknown as StoredTrackRecord;
        if (!this.isStoredTrackVisible(value, visibilityContext)) {
          cursor.continue();
          return;
        }
        const artist = String(value.artist ?? '').trim();
        if (artist) seen.add(artist);
        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  }

  // 获取所有专辑
  async getAllAlbums(options?: { includeStoredCover?: boolean }): Promise<AlbumSummary[]> {
    const includeStoredCover = options?.includeStoredCover ?? true;
    const nativeAlbums = await this.tryGetAllAlbumsFromNativeDb(includeStoredCover);
    if (nativeAlbums) {
      return nativeAlbums;
    }

    const db = await this.ensureDB();
    const visibilityContext = await this.buildPathVisibilityContext();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');

      if (!store.indexNames.contains('album')) {
        void this.getAllTracks()
          .then((tracks) => {
            const albumMap = new Map<string, AlbumSummary>();
            tracks.forEach((track) => {
              if (!track.album) return;
              const key = `${track.album}::${track.artist || ''}`;
              if (albumMap.has(key)) return;
              albumMap.set(key, {
              album: track.album,
              artist: track.artist || 'Unknown Artist',
              cover: includeStoredCover
                ? this.sanitizeStoredCoverUrlForPath(track.coverUrl, track.filePath || track.path)
                : undefined,
              coverTrackPath: track.filePath || track.path,
              coverTrackId: track.id,
            });
            });
            resolve(
              Array.from(albumMap.values()).sort((a, b) => a.album.localeCompare(b.album))
            );
          })
          .catch(reject);
        return;
      }

      const albumMap = new Map<string, AlbumSummary>();
      const index = store.index('album');
      const request = index.openCursor();
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!cursor) {
          resolve(Array.from(albumMap.values()).sort((a, b) => a.album.localeCompare(b.album)));
          return;
        }

        const value = cursor.value as unknown as StoredTrackRecord;
        if (!this.isStoredTrackVisible(value, visibilityContext)) {
          cursor.continue();
          return;
        }
        const album = String(value.album ?? '');
        if (album) {
          const artist = String(value.artist ?? 'Unknown Artist');
          const key = `${album}::${artist}`;
          if (!albumMap.has(key)) {
              albumMap.set(key, {
                album,
                artist,
                cover: includeStoredCover
                  ? this.sanitizeStoredCoverUrlForPath(value.coverUrl, value.filePath || value.path)
                  : undefined,
                coverTrackPath: value.filePath || value.path,
                coverTrackId: value.id,
              });
          }
        }

        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 获取所有流派
  async getAllGenres(): Promise<string[]> {
    const nativeGenres = await this.tryGetAllGenresFromNativeDb();
    if (nativeGenres) {
      return nativeGenres;
    }

    const db = await this.ensureDB();
    const visibilityContext = await this.buildPathVisibilityContext();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');

      const request = (store.indexNames.contains('genre') ? store.index('genre') : store).openCursor();
      const seen = new Set<string>();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!cursor) {
          resolve(Array.from(seen).sort());
          return;
        }
        const value = cursor.value as unknown as StoredTrackRecord;
        if (!this.isStoredTrackVisible(value, visibilityContext)) {
          cursor.continue();
          return;
        }
        const genre = String(value.genre ?? '').trim();
        if (genre) seen.add(genre);
        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  }

  // 获取库统计信息（带缓存）
  async getLibraryStats(): Promise<LibraryStats> {
    // 检查缓存
    const now = Date.now();
    if (this.cachedStats && now - this.cacheTimestamp < this.CACHE_TTL) {
      return this.cachedStats;
    }

    const nativeStats = await this.tryGetLibraryStatsFromNativeDb();
    if (nativeStats) {
      this.cachedStats = nativeStats;
      this.cacheTimestamp = now;
      return nativeStats;
    }

    const artists = new Set<string>();
    const albums = new Set<string>();
    let totalTracks = 0;
    let totalSize = 0;
    let totalDuration = 0;

    const db = await this.ensureDB();
    const visibilityContext = await this.buildPathVisibilityContext();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!cursor) {
          resolve();
          return;
        }

        const value = cursor.value as unknown as StoredTrackRecord;
        if (!this.isStoredTrackVisible(value, visibilityContext)) {
          cursor.continue();
          return;
        }
        totalTracks++;
        const artist = String(value.artist ?? '').trim();
        const album = String(value.album ?? '').trim();
        if (artist) artists.add(artist);
        if (album) albums.add(album);
        totalSize += Number(value.fileSize ?? 0);
        totalDuration += Number(value.duration ?? 0);

        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });

    const stats = {
      totalTracks,
      totalArtists: artists.size,
      totalAlbums: albums.size,
      totalSize,
      totalDuration,
    };

    // 更新缓存
    this.cachedStats = stats;
    this.cacheTimestamp = now;

    return stats;
  }

  // 清除缓存
  private clearCache(): void {
    this.cachedStats = null;
    this.cacheTimestamp = 0;
  }

  async clearLibrary(): Promise<void> {
    if (isTauriRuntime()) {
      try {
        await clearNativeLibraryTracks();
      } catch (error) {
        console.warn('[MusicLibraryService] failed to clear native tracks, fallback to IndexedDB:', error);
      }
    }

    const db = await this.ensureDB();
    const transaction = db.transaction(['tracks'], 'readwrite');
    const store = transaction.objectStore('tracks');
    await store.clear();

    // 清除缓存
    this.clearCache();
  }

  // 删除轨道
  async deleteTrack(id: string): Promise<void> {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return;

    if (isTauriRuntime()) {
      try {
        await deleteNativeLibraryTracks([normalizedId]);
      } catch (error) {
        console.warn(
          '[MusicLibraryService] failed to delete native track, fallback to IndexedDB:',
          normalizedId,
          error
        );
      }
    }

    const db = await this.ensureDB();
    const transaction = db.transaction(['tracks'], 'readwrite');
    const store = transaction.objectStore('tracks');
    await store.delete(normalizedId);

    // 清除缓存
    this.clearCache();
  }

  // 批量删除轨道（性能优化）
  async deleteMultipleTracks(ids: string[]): Promise<void> {
    const normalizedIds = ids
      .map((id) => String(id || '').trim())
      .filter((id) => id.length > 0);
    if (normalizedIds.length === 0) return;

    if (isTauriRuntime()) {
      try {
        await deleteNativeLibraryTracks(normalizedIds);
      } catch (error) {
        console.warn(
          '[MusicLibraryService] failed to delete native tracks, fallback to IndexedDB:',
          error
        );
      }
    }

    const db = await this.ensureDB();
    const transaction = db.transaction(['tracks'], 'readwrite');
    const store = transaction.objectStore('tracks');

    for (const id of normalizedIds) {
      store.delete(id);
    }

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    // 清除缓存
    this.clearCache();
  }

  // 订阅扫描进度
  onScanProgress(listener: (progress: ScanProgress) => void): () => void {
    this.scanProgressListeners.add(listener);
    return () => this.scanProgressListeners.delete(listener);
  }

  // 通知扫描进度
  private notifyScanProgress(progress: ScanProgress): void {
    this.isScanning = progress.isScanning;
    this.scanProgressListeners.forEach((listener) => listener(progress));
  }
}

export const musicLibraryService = MusicLibraryService.getInstance();
