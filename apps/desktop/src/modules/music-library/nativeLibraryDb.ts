import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  invokeWithTelemetry,
  type TauriInvokeTelemetryOptions,
} from '../../services/telemetry/tauriInvokeTelemetry';

export interface NativeLibrarySourceUpsertInput {
  id: string;
  path: string;
  displayName?: string;
  category?: string;
  isVisible?: boolean;
  isScanned?: boolean;
  addedAtMs?: number;
  lastScannedAtMs?: number;
}

export interface NativeLibrarySourceRecord {
  id: string;
  path: string;
  displayName?: string;
  category: string;
  trackCount: number;
  isVisible: boolean;
  isScanned: boolean;
  addedAtMs: number;
  lastScannedAtMs?: number;
  updatedAtMs: number;
}

export interface NativeLibraryConnectorRecord {
  id: string;
  kind: string;
  driver: string;
  displayName?: string;
  status: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface NativeLibraryConnectorAccountRecord {
  id: string;
  connectorId: string;
  accountUid?: string;
  authState: string;
  tokenRef?: string;
  refreshTokenRef?: string;
  expiresAtMs?: number;
  createdAtMs: number;
  updatedAtMs: number;
}

const MUSIC_PLATFORM_AUTH_INVOKE_COMMAND = 'music_library_music_platform_auth_invoke';
const MUSIC_PLATFORM_API_INVOKE_COMMAND = 'music_library_music_platform_api_invoke';
const BILIBILI_CONNECTOR_ID = 'connector.platform.bilibili';
const NETEASE_CONNECTOR_ID = 'connector.platform.netease';
const PLATFORM_LIBRARY_BINDING_ID = 'host.pmp.platform-instance.library';
const PLATFORM_RECOMMENDATIONS_BINDING_ID =
  'host.pmp.platform-instance.recommendations';
const PLATFORM_SEARCH_BINDING_ID = 'host.pmp.platform-instance.search';
const PLATFORM_QUALITY_BINDING_ID = 'host.pmp.platform-instance.quality';

function buildNativeLibraryInvokeEvent(command: string): string {
  const tokens = command
    .trim()
    .toLowerCase()
    .split('_')
    .filter((token) => token.length > 0);

  if (tokens[0] === 'music' && tokens[1] === 'library') {
    tokens.splice(0, 2);
  }

  if (tokens[0] === 'music' && tokens[1] === 'platform') {
    tokens.splice(0, 2);
    if (tokens.length < 1) return 'music-library.platform';
    return `music-library.platform.${tokens.join('-')}`;
  }

  if (tokens.length < 1) return 'music-library.command';
  if (tokens.length === 1) return `music-library.${tokens[0]}`;
  return `music-library.${tokens[0]}.${tokens.slice(1).join('-')}`;
}

async function invoke<TResult = unknown>(
  command: string,
  args?: Record<string, unknown>,
  options: TauriInvokeTelemetryOptions = {}
): Promise<TResult> {
  const event =
    typeof options.event === 'string' && options.event.trim().length > 0
      ? options.event
      : buildNativeLibraryInvokeEvent(command);

  return invokeWithTelemetry<TResult>(command, args, {
    ...options,
    moduleId: options.moduleId ?? 'music-library',
    component: options.component ?? 'nativeLibraryDb',
    event,
  });
}

export interface NativeBilibiliQrCodeSession {
  connectorId: string;
  sessionId: string;
  qrcodeKey: string;
  qrUrl: string;
  qrImageDataUrl: string;
  generatedAtMs: number;
  expiresAtMs: number;
}

export interface NativeBilibiliQrPollResult {
  connectorId: string;
  sessionId: string;
  state: string;
  stateCode: number;
  stateMessage: string;
  authState: string;
  accountUid?: string;
  expiresAtMs?: number;
}

export interface NativeBilibiliAuthStatus {
  connectorId: string;
  authState: string;
  accountUid?: string;
  updatedAtMs?: number;
  expiresAtMs?: number;
  availability?: 'available' | 'degraded' | 'unavailable';
  availabilityMessage?: string;
}

export interface NativeMusicPlatformGlobalCacheSettings {
  customRootPath?: string;
  effectiveRootPath: string;
  defaultRootPath: string;
}

export interface NativeBilibiliFavoriteFolder {
  folderId: string;
  title: string;
  mediaCount: number;
  coverUrl?: string;
  updatedAtMs?: number;
}

export interface NativeBilibiliFavoriteResourceItem {
  resourceId: string;
  title: string;
  ownerName?: string;
  durationSeconds?: number;
  coverUrl?: string;
  sourceLocator: string;
  lyricLocator?: string;
  bvid?: string;
  cid?: string;
  contentKind: string;
}

export interface NativeBilibiliFavoriteResourcePage {
  folderId: string;
  pageNum: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  items: NativeBilibiliFavoriteResourceItem[];
}

export interface NativeBilibiliLyricLocatorRef {
  locator: string;
  format: string;
  lang?: string;
  sourceKind: string;
}

export type NativeLyricSourceKind = 'embedded' | 'sidecar' | 'cache' | 'web';

export interface NativeLyricToken {
  startMs: number;
  endMs: number;
  text: string;
}

export interface NativeLyricLine {
  startMs: number;
  endMs?: number;
  text: string;
  translation?: string;
  tokens: NativeLyricToken[];
}

export interface NativeLyricDocument {
  id: string;
  entryId?: string;
  trackId?: string;
  quickFingerprint?: string;
  sourceKind: NativeLyricSourceKind;
  sourceLocator?: string;
  format: string;
  language?: string;
  isDynamic: boolean;
  hasWordTiming: boolean;
  confidence: number;
  lines: NativeLyricLine[];
  rawText?: string;
  updatedAtMs: number;
}

export interface NativeLyricResolveRequest {
  entryId?: string;
  trackId?: string;
  trackFilePath?: string;
  quickFingerprint?: string;
  title?: string;
  artist?: string;
  durationSeconds?: number;
  embeddedLyrics?: string;
  lyricLocator?: string;
  cacheKey?: string;
  language?: string;
  forceWebLookup?: boolean;
}

export interface NativeLyricResolveQuery {
  entryId?: string;
  trackId?: string;
  trackFilePath?: string;
  quickFingerprint?: string;
  cacheKey?: string;
}

export interface NativeLyricResolveResult {
  selectionKey: string;
  selected?: NativeLyricDocument;
  selectedSource?: string;
  triedSources: string[];
  diagnostics: string[];
}

export type NativeLyricWriteBackPolicy = 'none' | 'sidecar' | 'embedded';

export interface NativeLyricWriteBackRequest {
  query: NativeLyricResolveQuery;
  trackFilePath?: string;
  policy?: NativeLyricWriteBackPolicy;
  formatHint?: string;
}

export interface NativeLyricWriteBackResult {
  applied: boolean;
  policy: string;
  outputPath?: string;
  skippedReason?: string;
  updatedAtMs: number;
}

export interface NativeBilibiliPlaybackPrepared {
  sourceLocator: string;
  streamUrl: string;
  cachePath: string;
  mimeType?: string;
  durationSeconds?: number;
  contentKind: string;
  selectedQualityKey: string;
  selectedQualityLabel: string;
}

export interface NativeBilibiliPlaybackQualityOption {
  key: string;
  label: string;
  available: boolean;
}

export interface NativeNeteaseQrCodeSession {
  connectorId: string;
  sessionId: string;
  qrKey: string;
  qrUrl: string;
  qrImageDataUrl: string;
  generatedAtMs: number;
  expiresAtMs: number;
}

export interface NativeNeteaseQrPollResult {
  connectorId: string;
  sessionId: string;
  state: string;
  stateCode: number;
  stateMessage: string;
  authState: string;
  accountUid?: string;
  expiresAtMs?: number;
}

export interface NativeNeteaseAuthStatus {
  connectorId: string;
  authState: string;
  accountUid?: string;
  updatedAtMs?: number;
  expiresAtMs?: number;
  availability?: 'available' | 'degraded' | 'unavailable';
  availabilityMessage?: string;
}

export interface NativeNeteaseUserPlaylist {
  playlistId: string;
  title: string;
  trackCount: number;
  coverUrl?: string;
  updatedAtMs?: number;
}

export interface NativeNeteaseRecommendedPlaylist {
  playlistId: string;
  title: string;
  trackCount: number;
  coverUrl?: string;
}

export interface NativeNeteaseSongItem {
  songId: string;
  title: string;
  artistNames: string;
  albumName?: string;
  durationSeconds?: number;
  coverUrl?: string;
  sourceLocator: string;
  webUrl: string;
}

export interface NativeNeteaseSongPage {
  sourceKind: string;
  sourceId: string;
  pageNum: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  items: NativeNeteaseSongItem[];
}

export interface NativeNeteasePlaybackPrepared {
  sourceLocator: string;
  streamUrl: string;
  cachePath: string;
  mimeType?: string;
  durationSeconds?: number;
  songId: string;
  selectedQualityKey?: string;
  selectedQualityLabel?: string;
}

export interface NativeLibraryTrackUpsertInput {
  id: string;
  filePath: string;
  quickFingerprint?: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  format?: string;
  duration?: number;
  sampleRate?: number;
  bitDepth?: number;
  fileSize?: number;
  mtimeMs?: number;
  replayGainTrackDb?: number;
  replayGainAlbumDb?: number;
}

export interface NativeLibraryTrackSyncResult {
  upserted: number;
  markedMissing: number;
}

export interface NativeLibraryTrackQuery {
  limit?: number;
  offset?: number;
  includeMissing?: boolean;
  visibleOnly?: boolean;
  projection?: 'list' | 'full';
  searchQuery?: string;
  artist?: string;
  album?: string;
  trackId?: string;
  sourceId?: string;
  quickFingerprint?: string;
  filePath?: string;
  baseQuery?: NativeLibraryTrackBaseQueryInput;
  filters?: NativeLibraryTrackFilterInput[];
  groupBy?: NativeLibraryTrackGroupByInput[];
  sort?: NativeLibraryTrackSortInput[];
}

type NativeLibraryDynamicTrackField = string & {
  readonly __nativeLibraryTrackFieldBrand?: unique symbol;
};

export type NativeLibraryKnownTrackFilterField =
  | 'title'
  | 'artist'
  | 'album'
  | 'genre'
  | 'year'
  | 'format'
  | 'durationSeconds'
  | 'playCount'
  | 'fileSize'
  | 'sampleRate'
  | 'bitDepth'
  | 'status'
  | 'sourceId'
  | 'createdAtMs'
  | 'updatedAtMs'
  | 'lastSeenAtMs'
  | 'lastPlayedAtMs';

export type NativeLibraryTrackFilterField =
  | NativeLibraryKnownTrackFilterField
  | NativeLibraryDynamicTrackField;

export type NativeLibraryTrackFilterOperator =
  | 'contains'
  | 'equals'
  | 'not_equals'
  | 'gte'
  | 'lte'
  | 'is_empty'
  | 'is_not_empty';

export interface NativeLibraryTrackFilterInput {
  field: NativeLibraryTrackFilterField;
  operator: NativeLibraryTrackFilterOperator;
  value?: string;
}

export type NativeLibraryTrackLogicalOperator = 'and' | 'or';

export interface NativeLibraryTrackFilterGroupInput {
  operator?: NativeLibraryTrackLogicalOperator;
  filters?: NativeLibraryTrackFilterInput[];
}

export type NativeLibraryKnownTrackSortField =
  | 'title'
  | 'artist'
  | 'album'
  | 'genre'
  | 'year'
  | 'format'
  | 'durationSeconds'
  | 'playCount'
  | 'lastPlayedAtMs'
  | 'fileSize'
  | 'sampleRate'
  | 'bitDepth'
  | 'createdAtMs'
  | 'lastSeenAtMs'
  | 'updatedAtMs';

export type NativeLibraryTrackSortField =
  | NativeLibraryKnownTrackSortField
  | NativeLibraryDynamicTrackField;

export interface NativeLibraryTrackSortInput {
  field: NativeLibraryTrackSortField;
  order?: 'asc' | 'desc';
}

export interface NativeLibraryTrackGroupByInput {
  field: NativeLibraryTrackSortField;
  order?: 'asc' | 'desc';
}

export interface NativeLibraryTrackBaseQueryInput {
  filterOperator?: NativeLibraryTrackLogicalOperator;
  filterGroups?: NativeLibraryTrackFilterGroupInput[];
  filters?: NativeLibraryTrackFilterInput[];
  groupBy?: NativeLibraryTrackGroupByInput[];
  sort?: NativeLibraryTrackSortInput[];
}

const NATIVE_LIBRARY_TRACK_FILTER_OPERATORS = new Set<NativeLibraryTrackFilterOperator>([
  'contains',
  'equals',
  'not_equals',
  'gte',
  'lte',
  'is_empty',
  'is_not_empty',
]);

function normalizeNativeTrackFieldName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeNativeTrackFilters(
  filters: NativeLibraryTrackQuery['filters']
): NativeLibraryTrackFilterInput[] | undefined {
  if (!Array.isArray(filters) || filters.length === 0) return undefined;

  const normalized: NativeLibraryTrackFilterInput[] = [];
  for (const rawFilter of filters) {
    if (!rawFilter || typeof rawFilter !== 'object') continue;

    const field = normalizeNativeTrackFieldName(rawFilter.field);
    const operator = rawFilter.operator;
    if (!field) continue;
    if (!NATIVE_LIBRARY_TRACK_FILTER_OPERATORS.has(operator)) continue;

    const needsValue =
      operator === 'contains' ||
      operator === 'equals' ||
      operator === 'not_equals' ||
      operator === 'gte' ||
      operator === 'lte';

    const normalizedValue =
      typeof rawFilter.value === 'string' && rawFilter.value.trim().length > 0
        ? rawFilter.value.trim()
        : undefined;

    if (needsValue && !normalizedValue) continue;

    normalized.push({
      field,
      operator,
      value: needsValue ? normalizedValue : undefined,
    });

    if (normalized.length >= 20) break;
  }

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNativeTrackFilterGroups(
  groups: NativeLibraryTrackBaseQueryInput['filterGroups']
): NativeLibraryTrackFilterGroupInput[] | undefined {
  if (!Array.isArray(groups) || groups.length === 0) return undefined;

  const normalized: NativeLibraryTrackFilterGroupInput[] = [];
  for (const rawGroup of groups) {
    if (!rawGroup || typeof rawGroup !== 'object') continue;

    const normalizedFilters = normalizeNativeTrackFilters(rawGroup.filters);
    if (!normalizedFilters || normalizedFilters.length === 0) continue;

    normalized.push({
      operator: rawGroup.operator === 'or' ? 'or' : 'and',
      filters: normalizedFilters,
    });

    if (normalized.length >= 8) break;
  }

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNativeTrackSort(sort: NativeLibraryTrackQuery['sort']): NativeLibraryTrackSortInput[] | undefined {
  if (!Array.isArray(sort) || sort.length === 0) return undefined;

  const normalized: NativeLibraryTrackSortInput[] = [];
  for (const rawSort of sort) {
    if (!rawSort || typeof rawSort !== 'object') continue;
    const field = normalizeNativeTrackFieldName(rawSort.field);
    if (!field) continue;

    normalized.push({
      field,
      order: rawSort.order === 'desc' ? 'desc' : 'asc',
    });

    if (normalized.length >= 4) break;
  }

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNativeTrackGroupBy(
  groupBy: NativeLibraryTrackQuery['groupBy']
): NativeLibraryTrackGroupByInput[] | undefined {
  if (!Array.isArray(groupBy) || groupBy.length === 0) return undefined;

  const normalized: NativeLibraryTrackGroupByInput[] = [];
  for (const rawGroup of groupBy) {
    if (!rawGroup || typeof rawGroup !== 'object') continue;
    const field = normalizeNativeTrackFieldName(rawGroup.field);
    if (!field) continue;

    normalized.push({
      field,
      order: rawGroup.order === 'desc' ? 'desc' : 'asc',
    });

    if (normalized.length >= 4) break;
  }

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNativeTrackBaseQuery(
  baseQuery: NativeLibraryTrackQuery['baseQuery'],
  fallbackFilters?: NativeLibraryTrackFilterInput[],
  fallbackGroupBy?: NativeLibraryTrackGroupByInput[],
  fallbackSort?: NativeLibraryTrackSortInput[]
): NativeLibraryTrackBaseQueryInput | undefined {
  const normalizedFilterOperator: NativeLibraryTrackLogicalOperator =
    baseQuery?.filterOperator === 'or' ? 'or' : 'and';
  const normalizedFilterGroups = normalizeNativeTrackFilterGroups(baseQuery?.filterGroups);
  const normalizedFilters = normalizeNativeTrackFilters(baseQuery?.filters) ?? fallbackFilters;
  const normalizedGroupBy = normalizeNativeTrackGroupBy(baseQuery?.groupBy) ?? fallbackGroupBy;
  const normalizedSort = normalizeNativeTrackSort(baseQuery?.sort) ?? fallbackSort;

  const effectiveFilterGroups =
    normalizedFilterGroups ??
    (normalizedFilters && normalizedFilters.length > 0
      ? [
          {
            operator: normalizedFilterOperator,
            filters: normalizedFilters,
          },
        ]
      : undefined);

  if (!effectiveFilterGroups && !normalizedFilters && !normalizedGroupBy && !normalizedSort) {
    return undefined;
  }
  return {
    filterOperator: normalizedFilterOperator,
    filterGroups: effectiveFilterGroups,
    filters: normalizedFilters,
    groupBy: normalizedGroupBy,
    sort: normalizedSort,
  };
}

export interface NativeLibraryTrackRecord {
  id: string;
  sourceId: string;
  filePath: string;
  quickFingerprint?: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  date?: string;
  originalDate?: string;
  trackNumber?: number;
  trackTotal?: number;
  discNumber?: number;
  discTotal?: number;
  format?: string;
  durationSeconds?: number;
  sampleRate?: number;
  bitDepth?: number;
  fileSize?: number;
  mtimeMs?: number;
  replayGainTrackDb?: number;
  replayGainAlbumDb?: number;
  composer?: string;
  lyricist?: string;
  conductor?: string;
  arranger?: string;
  label?: string;
  catalogNumber?: string;
  barcode?: string;
  isrc?: string;
  bpm?: number;
  musicalKey?: string;
  language?: string;
  comment?: string;
  lyrics?: string;
  mbidRecording?: string;
  mbidRelease?: string;
  mbidReleaseGroup?: string;
  mbidArtist?: string;
  mbidAlbumArtist?: string;
  acoustid?: string;
  tagSource?: string;
  tagConfidence?: number;
  tagUpdatedAtMs?: number;
  tagLockedFields?: string[];
  tagLastAuditId?: string;
  playCount: number;
  lastPlayedAtMs?: number;
  status: string;
  createdAtMs?: number;
  updatedAtMs: number;
  lastSeenAtMs?: number;
  extraFields?: Record<string, unknown>;
}

export interface NativeLibraryTrackPageResult {
  items: NativeLibraryTrackRecord[];
  total: number;
}

export type NativeLibraryLocalPlaybackResolveStrategy =
  | 'trackId'
  | 'quickFingerprint'
  | 'filePath'
  | 'none';

export interface NativeLibraryLocalPlaybackResolveInput {
  trackId?: string;
  quickFingerprint?: string;
  filePath?: string;
  sourceId?: string;
  includeMissing?: boolean;
  visibleOnly?: boolean;
}

export interface NativeLibraryLocalPlaybackResolveResult {
  track: NativeLibraryTrackRecord | null;
  strategy: NativeLibraryLocalPlaybackResolveStrategy;
  requiresNetworkFallback: boolean;
}

export interface NativeLibraryTrackFieldCatalogRecord {
  id: string;
  label: string;
  kind: 'text' | 'number';
  trackKey: string;
  columnName: string;
  sourceTable: string;
  declaredType: string;
  nullable: boolean;
  filterable: boolean;
  sortable: boolean;
  groupable: boolean;
  facetable: boolean;
  nativeFilterField?: NativeLibraryTrackFilterField;
  nativeSortField?: NativeLibraryTrackSortField;
}

export interface NativeLibraryFacetCatalogRecord {
  id: string;
  field: string;
  label: string;
  kind: NativeLibraryFacetKind;
  nativeField?: NativeLibraryTrackFilterField | string;
}

export interface NativeLibraryFacetQuery {
  includeMissing?: boolean;
  visibleOnly?: boolean;
}

export type NativeLibraryFacetKind = 'text-values' | 'album-summaries';

export interface NativeLibraryTextFacetQuery extends NativeLibraryFacetQuery {
  field: NativeLibraryTrackFilterField | string;
  limit?: number;
}

export interface NativeLibraryFacetEntriesQuery extends NativeLibraryFacetQuery {
  kind: NativeLibraryFacetKind;
  field?: NativeLibraryTrackFilterField | string;
  limit?: number;
}

export interface NativeLibraryAlbumRecord {
  album: string;
  artist: string;
  coverTrackId: string;
  coverTrackPath: string;
}

export interface NativeLibraryFacetEntriesResult {
  kind: NativeLibraryFacetKind;
  textValues?: string[];
  albums?: NativeLibraryAlbumRecord[];
}

export interface NativeLibrarySchemaSourceTableRecord {
  name: string;
  columnCount: number;
  schemaHash: string;
  columns: string[];
}

export interface NativeLibrarySchemaEnvelope {
  schemaVersion: number;
  generatedAtMs: number;
  schemaFingerprint: string;
  sourceTables: NativeLibrarySchemaSourceTableRecord[];
  trackFields: NativeLibraryTrackFieldCatalogRecord[];
  facetCollections: NativeLibraryFacetCatalogRecord[];
}

export interface NativeLibrarySchemaChangedEventPayload {
  reason: string;
  emittedAtMs: number;
  schemaVersion: number;
  schemaFingerprint: string;
  sourceTables: NativeLibrarySchemaSourceTableRecord[];
}

export interface NativeLibraryStatsRecord {
  totalTracks: number;
  totalArtists: number;
  totalAlbums: number;
  totalSize: number;
  totalDuration: number;
}

export interface NativeLibrarySourceHealthQuery {
  sourceId?: string;
}

export interface NativeLibrarySourceHealthRecord {
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

export interface NativeLibraryUserEntryUpsertInput {
  id: string;
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

export interface NativeLibraryUserEntryQuery {
  ownerUid?: string;
  limit?: number;
  offset?: number;
  inCloudOnly?: boolean;
  includeMissing?: boolean;
  searchQuery?: string;
}

export interface NativeLibraryUserEntryRecord {
  id: string;
  ownerUid: string;
  trackId?: string;
  quickFingerprint?: string;
  cloudContentId?: string;
  displayTitle?: string;
  displayArtist?: string;
  rating?: number;
  tagsJson?: string;
  inCloud: boolean;
  isMissing: boolean;
  playCount: number;
  lastPlayedAtMs?: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export type NativeLibraryStableEntrySourceKind =
  | 'local'
  | 'nas'
  | 'platform'
  | 'cache'
  | 'pmp-server';

export type NativeLibraryStableEntrySourceAvailability =
  | 'available'
  | 'missing'
  | 'remote-only'
  | 'stale'
  | 'auth-required'
  | 'unknown';

export interface NativeLibraryStableEntrySourceUpsertInput {
  id?: string;
  entryId: string;
  sourceKind: NativeLibraryStableEntrySourceKind | string;
  connectorId?: string;
  sourceId?: string;
  sourceItemId?: string;
  locator?: string;
  trackId?: string;
  quickFingerprint?: string;
  fullFingerprint?: string;
  availability?: NativeLibraryStableEntrySourceAvailability | string;
  qualityScore?: number;
  confidence?: number;
  priority?: number;
  lastVerifiedAtMs?: number;
  createdAtMs?: number;
  updatedAtMs?: number;
}

export interface NativeLibraryStableEntrySourceQuery {
  entryId?: string;
  sourceKind?: NativeLibraryStableEntrySourceKind | string;
  connectorId?: string;
  sourceId?: string;
  trackId?: string;
  availability?: NativeLibraryStableEntrySourceAvailability | string;
  limit?: number;
  offset?: number;
}

export interface NativeLibraryStableEntrySourceRecord {
  id: string;
  entryId: string;
  sourceKind: NativeLibraryStableEntrySourceKind;
  connectorId?: string;
  sourceId?: string;
  sourceItemId?: string;
  locator?: string;
  trackId?: string;
  quickFingerprint?: string;
  fullFingerprint?: string;
  availability: NativeLibraryStableEntrySourceAvailability;
  qualityScore?: number;
  confidence: number;
  priority: number;
  lastVerifiedAtMs?: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface NativeLibraryPlaylistUpsertInput {
  id: string;
  ownerUid: string;
  name: string;
  description?: string;
  coverUrl?: string;
  kind?: 'manual' | 'smart' | 'platform';
  sourceConnectorId?: string;
  sourcePlaylistId?: string;
  smartRuleJson?: string;
  isReadonly?: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
  lastOpenedAtMs?: number;
}

export interface NativeLibraryPlaylistQuery {
  ownerUid?: string;
  kind?: 'manual' | 'smart' | 'platform';
  limit?: number;
  offset?: number;
}

export interface NativeLibraryPlaylistRecord {
  id: string;
  ownerUid: string;
  name: string;
  description?: string;
  coverUrl?: string;
  kind: 'manual' | 'smart' | 'platform';
  sourceConnectorId?: string;
  sourcePlaylistId?: string;
  smartRuleJson?: string;
  isReadonly: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  lastOpenedAtMs?: number;
  trackCount: number;
  totalDuration: number;
}

export interface NativeLibraryPlaylistItemUpsertInput {
  id?: string;
  position?: number;
  localTrackId?: string;
  entryId?: string;
  trackPayloadJson?: string;
  snapshotTitle?: string;
  snapshotArtist?: string;
  snapshotAlbum?: string;
  snapshotDurationSeconds?: number;
  createdAtMs?: number;
}

export interface NativeLibraryPlaylistItemRecord {
  id: string;
  playlistId: string;
  position: number;
  localTrackId?: string;
  entryId?: string;
  trackPayloadJson?: string;
  snapshotTitle?: string;
  snapshotArtist?: string;
  snapshotAlbum?: string;
  snapshotDurationSeconds?: number;
  createdAtMs: number;
}

export type NativeLibraryPlaylistTrackSortField =
  | 'default'
  | 'title'
  | 'artist'
  | 'album'
  | 'duration';

export type NativeLibraryPlaylistTrackSortDirection = 'asc' | 'desc';

export interface NativeLibraryPlaylistTrackPageQuery {
  playlistId: string;
  searchQuery?: string;
  sortField?: NativeLibraryPlaylistTrackSortField;
  sortDirection?: NativeLibraryPlaylistTrackSortDirection;
  limit?: number;
  offset?: number;
}

export interface NativeLibraryPlaylistTrackPageResult {
  items: NativeLibraryPlaylistItemRecord[];
  total: number;
}

export interface NativeLibraryFallbackTaskUpsertInput {
  id?: string;
  ownerUid: string;
  entryId: string;
  cloudContentId?: string;
  trackId?: string;
  quickFingerprint?: string;
  reason?: string;
  requestedAtMs?: number;
}

export interface NativeLibraryFallbackTaskQuery {
  ownerUid?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface NativeLibraryFallbackTaskRecord {
  id: string;
  ownerUid: string;
  entryId: string;
  cloudContentId?: string;
  trackId?: string;
  quickFingerprint?: string;
  reason: string;
  status: string;
  enqueueCount: number;
  requestedAtMs: number;
  lastRequestedAtMs: number;
  updatedAtMs: number;
  lastError?: string;
}

export interface NativeLibraryCloudHashJobUpsertInput {
  id?: string;
  ownerUid: string;
  entryId: string;
  trackId?: string;
  quickFingerprint?: string;
  status?: string;
  cloudFullHash?: string;
  lastError?: string;
  requestedAtMs?: number;
}

export interface NativeLibraryCloudHashJobQuery {
  ownerUid?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface NativeLibraryCloudHashJobRecord {
  id: string;
  ownerUid: string;
  entryId: string;
  trackId?: string;
  quickFingerprint?: string;
  status: string;
  cloudFullHash?: string;
  lastError?: string;
  attemptCount: number;
  requestedAtMs: number;
  updatedAtMs: number;
}

export interface NativeLibrarySyncStatus {
  initialized: boolean;
  running: boolean;
  totalTicks: number;
  lastTickReason?: string;
  lastTickStartedAtMs?: number;
  lastTickFinishedAtMs?: number;
  lastError?: string;
  updatedAtMs?: number;
}

export interface NativeLibrarySyncTickResult {
  reason: string;
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
  scannedSources: number;
  changedSources: number;
  skippedSources: number;
  failedSources: number;
  failedSourceItems: NativeLibrarySyncFailedSource[];
  enqueuedMetadataJobs: number;
}

export interface NativeLibrarySyncFailedSource {
  sourceId: string;
  sourcePath: string;
  error: string;
  backoffUntilMs?: number;
  failedAtMs: number;
}

export interface NativeLibrarySyncFailureSourceSummary {
  sourceId: string;
  sourcePath: string;
  sourceDisplayName?: string;
  connectorId: string;
  lastError?: string;
  backoffUntilMs?: number;
  backoffRemainingMs?: number;
  backoffActive: boolean;
  lastSuccessAtMs?: number;
  incrementalScanAtMs?: number;
  updatedAtMs: number;
}

export interface NativeLibrarySyncFailureOverview {
  generatedAtMs: number;
  totalFailedSources: number;
  backoffActiveSources: number;
  items: NativeLibrarySyncFailureSourceSummary[];
}

export interface NativeLibrarySyncRetryResult {
  allSources: boolean;
  requestedSources: number;
  clearedSources: number;
  tickResult: NativeLibrarySyncTickResult;
}

export interface NativeLibrarySyncClearResult {
  allSources: boolean;
  requestedSources: number;
  clearedSources: number;
  clearedAtMs: number;
}

export interface NativeLibrarySyncSchedulerStatus {
  running: boolean;
  intervalMs: number;
  startedAtMs?: number;
  nextRunAtMs?: number;
  ticksTotal: number;
  lastTickStartedAtMs?: number;
  lastTickFinishedAtMs?: number;
  lastError?: string;
  lastTickResult?: NativeLibrarySyncTickResult;
  updatedAtMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readRecordField(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asOptionalString(value: unknown): string | undefined {
  const normalized = asTrimmedString(value);
  return normalized || undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => asOptionalString(item))
    .filter((item): item is string => typeof item === 'string');
  return items.length > 0 ? items : undefined;
}

function normalizeQuickFingerprint(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return undefined;
  const normalized = raw.replace(/^qf2:/, '');
  if (!/^[0-9a-f]{16,128}$/.test(normalized)) return undefined;
  return `qf2:${normalized}`;
}

function ensureSourceRecord(value: unknown): NativeLibrarySourceRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(value.id);
  const path = asTrimmedString(value.path);
  const category = asTrimmedString(value.category) || 'music';
  const isVisible = asBool(value.isVisible);
  const isScanned = asBool(value.isScanned);
  const trackCount = asNumber(value.trackCount);
  const addedAtMs = asNumber(value.addedAtMs);
  const updatedAtMs = asNumber(value.updatedAtMs);

  if (!id || !path || isVisible === undefined || isScanned === undefined) return null;
  if (addedAtMs === undefined || updatedAtMs === undefined) return null;

  return {
    id,
    path,
    displayName: asOptionalString(value.displayName),
    category,
    trackCount: trackCount === undefined ? 0 : Math.max(0, Math.floor(trackCount)),
    isVisible,
    isScanned,
    addedAtMs,
    lastScannedAtMs: asNumber(value.lastScannedAtMs),
    updatedAtMs,
  };
}

function ensureConnectorRecord(value: unknown): NativeLibraryConnectorRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(readRecordField(value, 'id'));
  const kind = asTrimmedString(readRecordField(value, 'kind'));
  const driver = asTrimmedString(readRecordField(value, 'driver'));
  const status = asTrimmedString(readRecordField(value, 'status'));
  const createdAtMs = asNumber(readRecordField(value, 'createdAtMs', 'created_at_ms'));
  const updatedAtMs = asNumber(readRecordField(value, 'updatedAtMs', 'updated_at_ms'));
  if (!id || !kind || !driver || !status || createdAtMs === undefined || updatedAtMs === undefined) {
    return null;
  }

  return {
    id,
    kind,
    driver,
    displayName: asOptionalString(readRecordField(value, 'displayName', 'display_name')),
    status,
    createdAtMs,
    updatedAtMs,
  };
}

function ensureConnectorAccountRecord(value: unknown): NativeLibraryConnectorAccountRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(readRecordField(value, 'id'));
  const connectorId = asTrimmedString(readRecordField(value, 'connectorId', 'connector_id'));
  const authState = asTrimmedString(readRecordField(value, 'authState', 'auth_state'));
  const createdAtMs = asNumber(readRecordField(value, 'createdAtMs', 'created_at_ms'));
  const updatedAtMs = asNumber(readRecordField(value, 'updatedAtMs', 'updated_at_ms'));
  if (!id || !connectorId || !authState || createdAtMs === undefined || updatedAtMs === undefined) {
    return null;
  }

  return {
    id,
    connectorId,
    accountUid: asOptionalString(readRecordField(value, 'accountUid', 'account_uid')),
    authState,
    tokenRef: asOptionalString(readRecordField(value, 'tokenRef', 'token_ref')),
    refreshTokenRef: asOptionalString(readRecordField(value, 'refreshTokenRef', 'refresh_token_ref')),
    expiresAtMs: asNumber(readRecordField(value, 'expiresAtMs', 'expires_at_ms')),
    createdAtMs,
    updatedAtMs,
  };
}

function ensureBilibiliQrCodeSession(value: unknown): NativeBilibiliQrCodeSession | null {
  if (!isRecord(value)) return null;

  const connectorId = asTrimmedString(readRecordField(value, 'connectorId', 'connector_id'));
  const sessionId = asTrimmedString(readRecordField(value, 'sessionId', 'session_id'));
  const qrcodeKey = asTrimmedString(readRecordField(value, 'qrcodeKey', 'qrcode_key'));
  const qrUrl = asTrimmedString(readRecordField(value, 'qrUrl', 'qr_url'));
  const qrImageDataUrl = asTrimmedString(readRecordField(value, 'qrImageDataUrl', 'qr_image_data_url'));
  const generatedAtMs = asNumber(readRecordField(value, 'generatedAtMs', 'generated_at_ms'));
  const expiresAtMs = asNumber(readRecordField(value, 'expiresAtMs', 'expires_at_ms'));
  if (
    !connectorId ||
    !sessionId ||
    !qrcodeKey ||
    !qrUrl ||
    !qrImageDataUrl ||
    generatedAtMs === undefined ||
    expiresAtMs === undefined
  ) {
    return null;
  }

  return {
    connectorId,
    sessionId,
    qrcodeKey,
    qrUrl,
    qrImageDataUrl,
    generatedAtMs,
    expiresAtMs,
  };
}

function ensureBilibiliQrPollResult(value: unknown): NativeBilibiliQrPollResult | null {
  if (!isRecord(value)) return null;

  const connectorId = asTrimmedString(readRecordField(value, 'connectorId', 'connector_id'));
  const sessionId = asTrimmedString(readRecordField(value, 'sessionId', 'session_id'));
  const state = asTrimmedString(readRecordField(value, 'state'));
  const stateCode = asNumber(readRecordField(value, 'stateCode', 'state_code'));
  const stateMessage = asTrimmedString(readRecordField(value, 'stateMessage', 'state_message'));
  const authState = asTrimmedString(readRecordField(value, 'authState', 'auth_state'));
  if (
    !connectorId ||
    !sessionId ||
    !state ||
    stateCode === undefined ||
    !stateMessage ||
    !authState
  ) {
    return null;
  }

  return {
    connectorId,
    sessionId,
    state,
    stateCode,
    stateMessage,
    authState,
    accountUid: asOptionalString(readRecordField(value, 'accountUid', 'account_uid')),
    expiresAtMs: asNumber(readRecordField(value, 'expiresAtMs', 'expires_at_ms')),
  };
}

function ensureBilibiliAuthStatus(value: unknown): NativeBilibiliAuthStatus | null {
  if (!isRecord(value)) return null;

  const connectorId = asTrimmedString(readRecordField(value, 'connectorId', 'connector_id'));
  const authState = asTrimmedString(readRecordField(value, 'authState', 'auth_state'));
  if (!connectorId || !authState) return null;

  const availabilityRaw = asTrimmedString(readRecordField(value, 'availability'));
  const availability = (() => {
    const normalized = availabilityRaw.toLowerCase();
    if (normalized === 'available' || normalized === 'degraded' || normalized === 'unavailable') {
      return normalized;
    }
    return undefined;
  })();

  return {
    connectorId,
    authState,
    accountUid: asOptionalString(readRecordField(value, 'accountUid', 'account_uid')),
    updatedAtMs: asNumber(readRecordField(value, 'updatedAtMs', 'updated_at_ms')),
    expiresAtMs: asNumber(readRecordField(value, 'expiresAtMs', 'expires_at_ms')),
    availability,
    availabilityMessage: asOptionalString(
      readRecordField(value, 'availabilityMessage', 'availability_message')
    ),
  };
}

function ensureMusicPlatformGlobalCacheSettings(
  value: unknown
): NativeMusicPlatformGlobalCacheSettings | null {
  if (!isRecord(value)) return null;

  const effectiveRootPath = asTrimmedString(
    readRecordField(value, 'effectiveRootPath', 'effective_root_path')
  );
  const defaultRootPath = asTrimmedString(
    readRecordField(value, 'defaultRootPath', 'default_root_path')
  );

  if (!effectiveRootPath || !defaultRootPath) return null;

  return {
    customRootPath: asOptionalString(readRecordField(value, 'customRootPath', 'custom_root_path')),
    effectiveRootPath,
    defaultRootPath,
  };
}

function ensureBilibiliFavoriteFolder(value: unknown): NativeBilibiliFavoriteFolder | null {
  if (!isRecord(value)) return null;

  const folderId = asTrimmedString(readRecordField(value, 'folderId', 'folder_id'));
  const title = asTrimmedString(readRecordField(value, 'title'));
  const mediaCount = asNumber(readRecordField(value, 'mediaCount', 'media_count'));
  if (!folderId || !title || mediaCount === undefined) return null;

  return {
    folderId,
    title,
    mediaCount: Math.max(0, Math.floor(mediaCount)),
    coverUrl: asOptionalString(readRecordField(value, 'coverUrl', 'cover_url')),
    updatedAtMs: asNumber(readRecordField(value, 'updatedAtMs', 'updated_at_ms')),
  };
}

function ensureBilibiliFavoriteResourceItem(value: unknown): NativeBilibiliFavoriteResourceItem | null {
  if (!isRecord(value)) return null;

  const resourceId = asTrimmedString(readRecordField(value, 'resourceId', 'resource_id'));
  const title = asTrimmedString(readRecordField(value, 'title'));
  const sourceLocator = asTrimmedString(readRecordField(value, 'sourceLocator', 'source_locator'));
  const contentKind = asTrimmedString(readRecordField(value, 'contentKind', 'content_kind'));
  if (!resourceId || !title || !sourceLocator || !contentKind) return null;

  const durationSeconds = asNumber(readRecordField(value, 'durationSeconds', 'duration_seconds'));

  return {
    resourceId,
    title,
    ownerName: asOptionalString(readRecordField(value, 'ownerName', 'owner_name')),
    durationSeconds:
      durationSeconds === undefined ? undefined : Math.max(0, Math.floor(durationSeconds)),
    coverUrl: asOptionalString(readRecordField(value, 'coverUrl', 'cover_url')),
    sourceLocator,
    lyricLocator: asOptionalString(readRecordField(value, 'lyricLocator', 'lyric_locator')),
    bvid: asOptionalString(readRecordField(value, 'bvid')),
    cid: asOptionalString(readRecordField(value, 'cid')),
    contentKind,
  };
}

function ensureBilibiliFavoriteResourcePage(value: unknown): NativeBilibiliFavoriteResourcePage | null {
  if (!isRecord(value)) return null;

  const folderId = asTrimmedString(readRecordField(value, 'folderId', 'folder_id'));
  const pageNum = asNumber(readRecordField(value, 'pageNum', 'page_num'));
  const pageSize = asNumber(readRecordField(value, 'pageSize', 'page_size'));
  const total = asNumber(readRecordField(value, 'total'));
  const hasMore = asBool(readRecordField(value, 'hasMore', 'has_more'));
  if (
    !folderId ||
    pageNum === undefined ||
    pageSize === undefined ||
    total === undefined ||
    hasMore === undefined
  ) {
    return null;
  }

  const itemsRaw = readRecordField(value, 'items');
  const items: NativeBilibiliFavoriteResourceItem[] = [];
  if (Array.isArray(itemsRaw)) {
    for (const item of itemsRaw) {
      const parsed = ensureBilibiliFavoriteResourceItem(item);
      if (!parsed) continue;
      items.push(parsed);
    }
  }

  return {
    folderId,
    pageNum: Math.max(1, Math.floor(pageNum)),
    pageSize: Math.max(1, Math.floor(pageSize)),
    total: Math.max(0, Math.floor(total)),
    hasMore,
    items,
  };
}

function ensureBilibiliLyricLocatorRef(value: unknown): NativeBilibiliLyricLocatorRef | null {
  if (!isRecord(value)) return null;

  const locator = asTrimmedString(readRecordField(value, 'locator'));
  const format = asTrimmedString(readRecordField(value, 'format'));
  const sourceKind = asTrimmedString(readRecordField(value, 'sourceKind', 'source_kind'));
  if (!locator || !format || !sourceKind) return null;

  return {
    locator,
    format,
    lang: asOptionalString(readRecordField(value, 'lang')),
    sourceKind,
  };
}

function ensureLyricSourceKind(value: unknown): NativeLyricSourceKind | null {
  const normalized = asTrimmedString(value).toLowerCase();
  if (
    normalized !== 'embedded' &&
    normalized !== 'sidecar' &&
    normalized !== 'cache' &&
    normalized !== 'web'
  ) {
    return null;
  }
  return normalized;
}

function ensureLyricToken(value: unknown): NativeLyricToken | null {
  if (!isRecord(value)) return null;
  const startMs = asNumber(readRecordField(value, 'startMs', 'start_ms'));
  const endMs = asNumber(readRecordField(value, 'endMs', 'end_ms'));
  const text = asTrimmedString(readRecordField(value, 'text'));
  if (startMs === undefined || endMs === undefined || !text) return null;
  return {
    startMs: Math.max(0, Math.floor(startMs)),
    endMs: Math.max(0, Math.floor(endMs)),
    text,
  };
}

function ensureLyricLine(value: unknown): NativeLyricLine | null {
  if (!isRecord(value)) return null;
  const startMs = asNumber(readRecordField(value, 'startMs', 'start_ms'));
  if (startMs === undefined) return null;

  const rawTokens = readRecordField(value, 'tokens');
  const tokens: NativeLyricToken[] = [];
  if (Array.isArray(rawTokens)) {
    for (const item of rawTokens) {
      const parsed = ensureLyricToken(item);
      if (!parsed) continue;
      tokens.push(parsed);
    }
  }

  const explicitText = asTrimmedString(readRecordField(value, 'text'));
  const tokenText = tokens.map((token) => token.text).join('').trim();
  const text = explicitText || tokenText;
  if (!text) return null;

  return {
    startMs: Math.max(0, Math.floor(startMs)),
    endMs: asNumber(readRecordField(value, 'endMs', 'end_ms')),
    text,
    translation: asOptionalString(readRecordField(value, 'translation')),
    tokens,
  };
}

function ensureLyricDocument(value: unknown): NativeLyricDocument | null {
  if (!isRecord(value)) return null;

  const rawId = asTrimmedString(readRecordField(value, 'id'));
  const sourceKind = ensureLyricSourceKind(readRecordField(value, 'sourceKind', 'source_kind'));
  const format = asTrimmedString(readRecordField(value, 'format'));
  const isDynamic = asBool(readRecordField(value, 'isDynamic', 'is_dynamic'));
  const hasWordTiming = asBool(readRecordField(value, 'hasWordTiming', 'has_word_timing'));
  const confidence = asNumber(readRecordField(value, 'confidence'));
  const updatedAtMs = asNumber(readRecordField(value, 'updatedAtMs', 'updated_at_ms'));
  if (
    !sourceKind ||
    !format ||
    isDynamic === undefined ||
    hasWordTiming === undefined ||
    confidence === undefined ||
    updatedAtMs === undefined
  ) {
    return null;
  }

  const rawLines = readRecordField(value, 'lines');
  const lines: NativeLyricLine[] = [];
  if (Array.isArray(rawLines)) {
    for (const item of rawLines) {
      const parsed = ensureLyricLine(item);
      if (!parsed) continue;
      lines.push(parsed);
    }
  }

  const entryId = asOptionalString(readRecordField(value, 'entryId', 'entry_id'));
  const trackId = asOptionalString(readRecordField(value, 'trackId', 'track_id'));
  const id =
    rawId ||
    `transient:${sourceKind}:${Math.max(0, Math.floor(updatedAtMs))}:${trackId || entryId || 'unknown'}`;

  return {
    id,
    entryId,
    trackId,
    quickFingerprint: asOptionalString(
      readRecordField(value, 'quickFingerprint', 'quick_fingerprint')
    ),
    sourceKind,
    sourceLocator: asOptionalString(readRecordField(value, 'sourceLocator', 'source_locator')),
    format,
    language: asOptionalString(readRecordField(value, 'language')),
    isDynamic,
    hasWordTiming,
    confidence: Math.max(0, Math.min(1, confidence)),
    lines,
    rawText: asOptionalString(readRecordField(value, 'rawText', 'raw_text')),
    updatedAtMs: Math.max(0, Math.floor(updatedAtMs)),
  };
}

function ensureLyricResolveResult(value: unknown): NativeLyricResolveResult | null {
  if (!isRecord(value)) return null;
  const selectionKey = asTrimmedString(readRecordField(value, 'selectionKey', 'selection_key'));
  if (!selectionKey) return null;

  const selected = ensureLyricDocument(readRecordField(value, 'selected')) || undefined;
  const triedRaw = readRecordField(value, 'triedSources', 'tried_sources');
  const diagnosticsRaw = readRecordField(value, 'diagnostics');

  const triedSources: string[] = [];
  if (Array.isArray(triedRaw)) {
    for (const item of triedRaw) {
      const normalized = asTrimmedString(item);
      if (!normalized) continue;
      triedSources.push(normalized);
    }
  }

  const diagnostics: string[] = [];
  if (Array.isArray(diagnosticsRaw)) {
    for (const item of diagnosticsRaw) {
      const normalized = asTrimmedString(item);
      if (!normalized) continue;
      diagnostics.push(normalized);
    }
  }

  return {
    selectionKey,
    selected,
    selectedSource: asOptionalString(readRecordField(value, 'selectedSource', 'selected_source')),
    triedSources,
    diagnostics,
  };
}

function ensureLyricWriteBackResult(value: unknown): NativeLyricWriteBackResult | null {
  if (!isRecord(value)) return null;
  const applied = asBool(readRecordField(value, 'applied'));
  const policy = asTrimmedString(readRecordField(value, 'policy'));
  const updatedAtMs = asNumber(readRecordField(value, 'updatedAtMs', 'updated_at_ms'));
  if (applied === undefined || !policy || updatedAtMs === undefined) return null;

  return {
    applied,
    policy,
    outputPath: asOptionalString(readRecordField(value, 'outputPath', 'output_path')),
    skippedReason: asOptionalString(readRecordField(value, 'skippedReason', 'skipped_reason')),
    updatedAtMs: Math.max(0, Math.floor(updatedAtMs)),
  };
}

function normalizeLyricResolveQuery(
  query?: NativeLyricResolveQuery
): NativeLyricResolveQuery {
  return {
    entryId:
      typeof query?.entryId === 'string' && query.entryId.trim().length > 0
        ? query.entryId.trim()
        : undefined,
    trackId:
      typeof query?.trackId === 'string' && query.trackId.trim().length > 0
        ? query.trackId.trim()
        : undefined,
    trackFilePath:
      typeof query?.trackFilePath === 'string' && query.trackFilePath.trim().length > 0
        ? query.trackFilePath.trim()
        : undefined,
    quickFingerprint: normalizeQuickFingerprint(query?.quickFingerprint),
    cacheKey:
      typeof query?.cacheKey === 'string' && query.cacheKey.trim().length > 0
        ? query.cacheKey.trim()
        : undefined,
  };
}

function ensureBilibiliPlaybackPrepared(value: unknown): NativeBilibiliPlaybackPrepared | null {
  if (!isRecord(value)) return null;

  const sourceLocator = asTrimmedString(readRecordField(value, 'sourceLocator', 'source_locator'));
  const streamUrl = asTrimmedString(readRecordField(value, 'streamUrl', 'stream_url'));
  const cachePath = asTrimmedString(readRecordField(value, 'cachePath', 'cache_path'));
  const contentKind = asTrimmedString(readRecordField(value, 'contentKind', 'content_kind'));
  const selectedQualityKey = asTrimmedString(
    readRecordField(value, 'selectedQualityKey', 'selected_quality_key')
  );
  const selectedQualityLabel = asTrimmedString(
    readRecordField(value, 'selectedQualityLabel', 'selected_quality_label')
  );
  if (
    !sourceLocator ||
    !streamUrl ||
    !cachePath ||
    !contentKind ||
    !selectedQualityKey ||
    !selectedQualityLabel
  ) {
    return null;
  }

  const durationSeconds = asNumber(readRecordField(value, 'durationSeconds', 'duration_seconds'));

  return {
    sourceLocator,
    streamUrl,
    cachePath,
    mimeType: asOptionalString(readRecordField(value, 'mimeType', 'mime_type')),
    durationSeconds:
      durationSeconds === undefined ? undefined : Math.max(0, Math.floor(durationSeconds)),
    contentKind,
    selectedQualityKey,
    selectedQualityLabel,
  };
}

function ensureBilibiliPlaybackQualityOption(
  value: unknown
): NativeBilibiliPlaybackQualityOption | null {
  if (!isRecord(value)) return null;

  const key = asTrimmedString(readRecordField(value, 'key'));
  const label = asTrimmedString(readRecordField(value, 'label'));
  const available = asBool(readRecordField(value, 'available'));
  if (!key || !label || available === undefined) return null;

  return {
    key,
    label,
    available,
  };
}

function ensureNeteaseQrCodeSession(value: unknown): NativeNeteaseQrCodeSession | null {
  if (!isRecord(value)) return null;

  const connectorId = asTrimmedString(readRecordField(value, 'connectorId', 'connector_id'));
  const sessionId = asTrimmedString(readRecordField(value, 'sessionId', 'session_id'));
  const qrKey = asTrimmedString(readRecordField(value, 'qrKey', 'qr_key'));
  const qrUrl = asTrimmedString(readRecordField(value, 'qrUrl', 'qr_url'));
  const qrImageDataUrl = asTrimmedString(readRecordField(value, 'qrImageDataUrl', 'qr_image_data_url'));
  const generatedAtMs = asNumber(readRecordField(value, 'generatedAtMs', 'generated_at_ms'));
  const expiresAtMs = asNumber(readRecordField(value, 'expiresAtMs', 'expires_at_ms'));
  if (
    !connectorId ||
    !sessionId ||
    !qrKey ||
    !qrUrl ||
    !qrImageDataUrl ||
    generatedAtMs === undefined ||
    expiresAtMs === undefined
  ) {
    return null;
  }

  return {
    connectorId,
    sessionId,
    qrKey,
    qrUrl,
    qrImageDataUrl,
    generatedAtMs,
    expiresAtMs,
  };
}

function ensureNeteaseQrPollResult(value: unknown): NativeNeteaseQrPollResult | null {
  if (!isRecord(value)) return null;

  const connectorId = asTrimmedString(readRecordField(value, 'connectorId', 'connector_id'));
  const sessionId = asTrimmedString(readRecordField(value, 'sessionId', 'session_id'));
  const state = asTrimmedString(readRecordField(value, 'state'));
  const stateCode = asNumber(readRecordField(value, 'stateCode', 'state_code'));
  const stateMessage = asTrimmedString(readRecordField(value, 'stateMessage', 'state_message'));
  const authState = asTrimmedString(readRecordField(value, 'authState', 'auth_state'));
  if (
    !connectorId ||
    !sessionId ||
    !state ||
    stateCode === undefined ||
    !stateMessage ||
    !authState
  ) {
    return null;
  }

  return {
    connectorId,
    sessionId,
    state,
    stateCode,
    stateMessage,
    authState,
    accountUid: asOptionalString(readRecordField(value, 'accountUid', 'account_uid')),
    expiresAtMs: asNumber(readRecordField(value, 'expiresAtMs', 'expires_at_ms')),
  };
}

function ensureNeteaseAuthStatus(value: unknown): NativeNeteaseAuthStatus | null {
  if (!isRecord(value)) return null;

  const connectorId = asTrimmedString(readRecordField(value, 'connectorId', 'connector_id'));
  const authState = asTrimmedString(readRecordField(value, 'authState', 'auth_state'));
  if (!connectorId || !authState) return null;

  const availabilityRaw = asTrimmedString(readRecordField(value, 'availability'));
  const availability = (() => {
    const normalized = availabilityRaw.toLowerCase();
    if (normalized === 'available' || normalized === 'degraded' || normalized === 'unavailable') {
      return normalized;
    }
    return undefined;
  })();

  return {
    connectorId,
    authState,
    accountUid: asOptionalString(readRecordField(value, 'accountUid', 'account_uid')),
    updatedAtMs: asNumber(readRecordField(value, 'updatedAtMs', 'updated_at_ms')),
    expiresAtMs: asNumber(readRecordField(value, 'expiresAtMs', 'expires_at_ms')),
    availability,
    availabilityMessage: asOptionalString(
      readRecordField(value, 'availabilityMessage', 'availability_message')
    ),
  };
}

function ensureNeteaseUserPlaylist(value: unknown): NativeNeteaseUserPlaylist | null {
  if (!isRecord(value)) return null;

  const playlistId = asTrimmedString(readRecordField(value, 'playlistId', 'playlist_id'));
  const title = asTrimmedString(readRecordField(value, 'title'));
  const trackCount = asNumber(readRecordField(value, 'trackCount', 'track_count'));
  if (!playlistId || !title || trackCount === undefined) return null;

  return {
    playlistId,
    title,
    trackCount: Math.max(0, Math.floor(trackCount)),
    coverUrl: asOptionalString(readRecordField(value, 'coverUrl', 'cover_url')),
    updatedAtMs: asNumber(readRecordField(value, 'updatedAtMs', 'updated_at_ms')),
  };
}

function ensureNeteaseRecommendedPlaylist(
  value: unknown
): NativeNeteaseRecommendedPlaylist | null {
  if (!isRecord(value)) return null;

  const playlistId = asTrimmedString(readRecordField(value, 'playlistId', 'playlist_id'));
  const title = asTrimmedString(readRecordField(value, 'title'));
  const trackCount = asNumber(readRecordField(value, 'trackCount', 'track_count'));
  if (!playlistId || !title || trackCount === undefined) return null;

  return {
    playlistId,
    title,
    trackCount: Math.max(0, Math.floor(trackCount)),
    coverUrl: asOptionalString(readRecordField(value, 'coverUrl', 'cover_url')),
  };
}

function ensureNeteaseSongItem(value: unknown): NativeNeteaseSongItem | null {
  if (!isRecord(value)) return null;

  const songId = asTrimmedString(readRecordField(value, 'songId', 'song_id'));
  const title = asTrimmedString(readRecordField(value, 'title'));
  const artistNames = asTrimmedString(readRecordField(value, 'artistNames', 'artist_names'));
  const sourceLocator = asTrimmedString(readRecordField(value, 'sourceLocator', 'source_locator'));
  const webUrl = asTrimmedString(readRecordField(value, 'webUrl', 'web_url'));
  if (!songId || !title || !artistNames || !sourceLocator || !webUrl) return null;

  const durationSeconds = asNumber(readRecordField(value, 'durationSeconds', 'duration_seconds'));

  return {
    songId,
    title,
    artistNames,
    albumName: asOptionalString(readRecordField(value, 'albumName', 'album_name')),
    durationSeconds:
      durationSeconds === undefined ? undefined : Math.max(0, Math.floor(durationSeconds)),
    coverUrl: asOptionalString(readRecordField(value, 'coverUrl', 'cover_url')),
    sourceLocator,
    webUrl,
  };
}

function ensureNeteaseSongPage(value: unknown): NativeNeteaseSongPage | null {
  if (!isRecord(value)) return null;

  const sourceKind = asTrimmedString(readRecordField(value, 'sourceKind', 'source_kind'));
  const sourceId = asTrimmedString(readRecordField(value, 'sourceId', 'source_id'));
  const pageNum = asNumber(readRecordField(value, 'pageNum', 'page_num'));
  const pageSize = asNumber(readRecordField(value, 'pageSize', 'page_size'));
  const total = asNumber(readRecordField(value, 'total'));
  const hasMore = asBool(readRecordField(value, 'hasMore', 'has_more'));
  if (
    !sourceKind ||
    !sourceId ||
    pageNum === undefined ||
    pageSize === undefined ||
    total === undefined ||
    hasMore === undefined
  ) {
    return null;
  }

  const itemsRaw = readRecordField(value, 'items');
  const items: NativeNeteaseSongItem[] = [];
  if (Array.isArray(itemsRaw)) {
    for (const item of itemsRaw) {
      const parsed = ensureNeteaseSongItem(item);
      if (!parsed) continue;
      items.push(parsed);
    }
  }

  return {
    sourceKind,
    sourceId,
    pageNum: Math.max(1, Math.floor(pageNum)),
    pageSize: Math.max(1, Math.floor(pageSize)),
    total: Math.max(0, Math.floor(total)),
    hasMore,
    items,
  };
}

function ensureNeteasePlaybackPrepared(
  value: unknown
): NativeNeteasePlaybackPrepared | null {
  if (!isRecord(value)) return null;

  const sourceLocator = asTrimmedString(readRecordField(value, 'sourceLocator', 'source_locator'));
  const streamUrl = asTrimmedString(readRecordField(value, 'streamUrl', 'stream_url'));
  const cachePath = asTrimmedString(readRecordField(value, 'cachePath', 'cache_path'));
  const songId = asTrimmedString(readRecordField(value, 'songId', 'song_id'));
  if (!sourceLocator || !streamUrl || !cachePath || !songId) return null;

  const durationSeconds = asNumber(readRecordField(value, 'durationSeconds', 'duration_seconds'));

  return {
    sourceLocator,
    streamUrl,
    cachePath,
    mimeType: asOptionalString(readRecordField(value, 'mimeType', 'mime_type')),
    durationSeconds:
      durationSeconds === undefined ? undefined : Math.max(0, Math.floor(durationSeconds)),
    songId,
    selectedQualityKey: asOptionalString(
      readRecordField(value, 'selectedQualityKey', 'selected_quality_key')
    ),
    selectedQualityLabel: asOptionalString(
      readRecordField(value, 'selectedQualityLabel', 'selected_quality_label')
    ),
  };
}

function ensureTrackSyncResult(value: unknown): NativeLibraryTrackSyncResult | null {
  if (!isRecord(value)) return null;
  const upserted = asNumber(value.upserted);
  const markedMissing = asNumber(value.markedMissing);
  if (upserted === undefined || markedMissing === undefined) return null;
  return {
    upserted,
    markedMissing,
  };
}

function ensureTrackRecord(value: unknown): NativeLibraryTrackRecord | null {
  if (!isRecord(value)) return null;
  const id = asTrimmedString(readRecordField(value, 'id'));
  const sourceId = asTrimmedString(readRecordField(value, 'sourceId', 'source_id'));
  const filePath = asTrimmedString(readRecordField(value, 'filePath', 'file_path'));
  const status = asTrimmedString(readRecordField(value, 'status'));
  const updatedAtMs = asNumber(readRecordField(value, 'updatedAtMs', 'updated_at_ms'));
  const playCount = asNumber(readRecordField(value, 'playCount', 'play_count'));
  if (
    !id ||
    !sourceId ||
    !filePath ||
    !status ||
    updatedAtMs === undefined ||
    playCount === undefined
  ) {
    return null;
  }

  return {
    id,
    sourceId,
    filePath,
    quickFingerprint: asOptionalString(
      readRecordField(value, 'quickFingerprint', 'quick_fingerprint')
    ),
    title: asOptionalString(readRecordField(value, 'title')),
    artist: asOptionalString(readRecordField(value, 'artist')),
    album: asOptionalString(readRecordField(value, 'album')),
    albumArtist: asOptionalString(readRecordField(value, 'albumArtist', 'album_artist')),
    genre: asOptionalString(readRecordField(value, 'genre')),
    year: asNumber(readRecordField(value, 'year')),
    date: asOptionalString(readRecordField(value, 'date')),
    originalDate: asOptionalString(readRecordField(value, 'originalDate', 'original_date')),
    trackNumber: asNumber(readRecordField(value, 'trackNumber', 'track_number')),
    trackTotal: asNumber(readRecordField(value, 'trackTotal', 'track_total')),
    discNumber: asNumber(readRecordField(value, 'discNumber', 'disc_number')),
    discTotal: asNumber(readRecordField(value, 'discTotal', 'disc_total')),
    format: asOptionalString(readRecordField(value, 'format')),
    durationSeconds: asNumber(readRecordField(value, 'durationSeconds', 'duration_seconds')),
    sampleRate: asNumber(readRecordField(value, 'sampleRate', 'sample_rate')),
    bitDepth: asNumber(readRecordField(value, 'bitDepth', 'bit_depth')),
    fileSize: asNumber(readRecordField(value, 'fileSize', 'file_size')),
    mtimeMs: asNumber(readRecordField(value, 'mtimeMs', 'mtime_ms')),
    replayGainTrackDb: asNumber(
      readRecordField(value, 'replayGainTrackDb', 'replay_gain_track_db')
    ),
    replayGainAlbumDb: asNumber(
      readRecordField(value, 'replayGainAlbumDb', 'replay_gain_album_db')
    ),
    composer: asOptionalString(readRecordField(value, 'composer')),
    lyricist: asOptionalString(readRecordField(value, 'lyricist')),
    conductor: asOptionalString(readRecordField(value, 'conductor')),
    arranger: asOptionalString(readRecordField(value, 'arranger')),
    label: asOptionalString(readRecordField(value, 'label')),
    catalogNumber: asOptionalString(readRecordField(value, 'catalogNumber', 'catalog_number')),
    barcode: asOptionalString(readRecordField(value, 'barcode')),
    isrc: asOptionalString(readRecordField(value, 'isrc')),
    bpm: asNumber(readRecordField(value, 'bpm')),
    musicalKey: asOptionalString(readRecordField(value, 'musicalKey', 'musical_key')),
    language: asOptionalString(readRecordField(value, 'language')),
    comment: asOptionalString(readRecordField(value, 'comment')),
    lyrics: asOptionalString(readRecordField(value, 'lyrics')),
    mbidRecording: asOptionalString(readRecordField(value, 'mbidRecording', 'mbid_recording')),
    mbidRelease: asOptionalString(readRecordField(value, 'mbidRelease', 'mbid_release')),
    mbidReleaseGroup: asOptionalString(
      readRecordField(value, 'mbidReleaseGroup', 'mbid_release_group')
    ),
    mbidArtist: asOptionalString(readRecordField(value, 'mbidArtist', 'mbid_artist')),
    mbidAlbumArtist: asOptionalString(
      readRecordField(value, 'mbidAlbumArtist', 'mbid_album_artist')
    ),
    acoustid: asOptionalString(readRecordField(value, 'acoustid')),
    tagSource: asOptionalString(readRecordField(value, 'tagSource', 'tag_source')),
    tagConfidence: asNumber(readRecordField(value, 'tagConfidence', 'tag_confidence')),
    tagUpdatedAtMs: asNumber(readRecordField(value, 'tagUpdatedAtMs', 'tag_updated_at_ms')),
    tagLockedFields: asStringArray(readRecordField(value, 'tagLockedFields', 'tag_locked_fields')),
    tagLastAuditId: asOptionalString(
      readRecordField(value, 'tagLastAuditId', 'tag_last_audit_id')
    ),
    playCount: Math.max(0, Math.floor(playCount)),
    lastPlayedAtMs: asNumber(readRecordField(value, 'lastPlayedAtMs', 'last_played_at_ms')),
    status,
    createdAtMs: asNumber(readRecordField(value, 'createdAtMs', 'created_at_ms')),
    updatedAtMs,
    lastSeenAtMs: asNumber(readRecordField(value, 'lastSeenAtMs', 'last_seen_at_ms')),
    extraFields: asOptionalRecord(readRecordField(value, 'extraFields', 'extra_fields')),
  };
}

function ensureTrackPageResult(value: unknown): NativeLibraryTrackPageResult | null {
  if (!isRecord(value)) return null;

  const totalValue = asNumber(readRecordField(value, 'total', 'totalCount', 'total_count'));
  const itemsRaw = readRecordField(value, 'items', 'rows', 'tracks');
  if (totalValue === undefined || !Array.isArray(itemsRaw)) return null;

  const items: NativeLibraryTrackRecord[] = [];
  for (const item of itemsRaw) {
    const parsed = ensureTrackRecord(item);
    if (!parsed) continue;
    items.push(parsed);
  }

  return {
    items,
    total: Math.max(0, Math.floor(totalValue)),
  };
}

function normalizeLocalPlaybackResolveStrategy(
  value: unknown
): NativeLibraryLocalPlaybackResolveStrategy | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    normalized === 'trackId' ||
    normalized === 'quickFingerprint' ||
    normalized === 'filePath' ||
    normalized === 'none'
  ) {
    return normalized;
  }
  return null;
}

function ensureLocalPlaybackResolveResult(
  value: unknown
): NativeLibraryLocalPlaybackResolveResult | null {
  if (!isRecord(value)) return null;

  const strategy = normalizeLocalPlaybackResolveStrategy(readRecordField(value, 'strategy'));
  const requiresNetworkFallback = asBool(
    readRecordField(value, 'requiresNetworkFallback', 'requires_network_fallback')
  );
  const rawTrack = readRecordField(value, 'track');
  const track = rawTrack == null ? null : ensureTrackRecord(rawTrack);

  if (!strategy || requiresNetworkFallback === undefined) return null;
  if (rawTrack != null && !track) return null;

  return {
    track,
    strategy,
    requiresNetworkFallback,
  };
}

function ensureFacetCatalogRecord(value: unknown): NativeLibraryFacetCatalogRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(readRecordField(value, 'id'));
  const field = asTrimmedString(readRecordField(value, 'field'));
  const label = asTrimmedString(readRecordField(value, 'label'));
  const kind = normalizeFacetKind(readRecordField(value, 'kind'));
  const nativeField = normalizeNativeTrackFieldName(readRecordField(value, 'nativeField', 'native_field'));
  if (!id || !field || !label || !kind) return null;

  return {
    id,
    field,
    label,
    kind,
    nativeField,
  };
}

function ensureTrackFieldCatalogRecord(value: unknown): NativeLibraryTrackFieldCatalogRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(readRecordField(value, 'id'));
  const label = asTrimmedString(readRecordField(value, 'label'));
  const trackKey = asTrimmedString(readRecordField(value, 'trackKey', 'track_key'));
  const columnName = asTrimmedString(readRecordField(value, 'columnName', 'column_name'));
  const sourceTable = asTrimmedString(readRecordField(value, 'sourceTable', 'source_table'));
  const declaredType = asTrimmedString(readRecordField(value, 'declaredType', 'declared_type'));
  const kindRaw = asTrimmedString(readRecordField(value, 'kind'));
  const nullable = asBool(readRecordField(value, 'nullable'));
  const filterable = asBool(readRecordField(value, 'filterable'));
  const sortable = asBool(readRecordField(value, 'sortable'));
  const groupable = asBool(readRecordField(value, 'groupable'));
  const facetable = asBool(readRecordField(value, 'facetable'));

  if (!id || !label || !trackKey || !columnName || !sourceTable) return null;
  if (
    nullable === undefined ||
    filterable === undefined ||
    sortable === undefined ||
    groupable === undefined ||
    facetable === undefined
  ) {
    return null;
  }

  const kind: NativeLibraryTrackFieldCatalogRecord['kind'] = kindRaw === 'number' ? 'number' : 'text';
  const nativeFilterField = normalizeNativeTrackFieldName(
    readRecordField(value, 'nativeFilterField', 'native_filter_field')
  ) as NativeLibraryTrackFilterField | undefined;
  const nativeSortField = normalizeNativeTrackFieldName(
    readRecordField(value, 'nativeSortField', 'native_sort_field')
  ) as NativeLibraryTrackSortField | undefined;

  return {
    id,
    label,
    kind,
    trackKey,
    columnName,
    sourceTable,
    declaredType,
    nullable,
    filterable,
    sortable,
    groupable,
    facetable,
    nativeFilterField,
    nativeSortField,
  };
}

function normalizeFacetQuery(query?: NativeLibraryFacetQuery): NativeLibraryFacetQuery {
  return {
    includeMissing: query?.includeMissing === true,
    visibleOnly: query?.visibleOnly !== false,
  };
}

function normalizeTextFacetQuery(query?: NativeLibraryTextFacetQuery): NativeLibraryTextFacetQuery | null {
  const field = normalizeNativeTrackFieldName(query?.field);
  if (!field) return null;

  return {
    field,
    includeMissing: query?.includeMissing === true,
    visibleOnly: query?.visibleOnly !== false,
    limit:
      typeof query?.limit === 'number' && Number.isFinite(query.limit)
        ? Math.max(1, Math.min(5000, Math.floor(query.limit)))
        : undefined,
  };
}

function normalizeFacetKind(value: unknown): NativeLibraryFacetKind | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'text-values') return 'text-values';
  if (normalized === 'album-summaries') return 'album-summaries';
  return undefined;
}

function normalizeFacetEntriesQuery(
  query?: NativeLibraryFacetEntriesQuery
): NativeLibraryFacetEntriesQuery | null {
  const kind = normalizeFacetKind(query?.kind);
  if (!kind) return null;

  const normalized: NativeLibraryFacetEntriesQuery = {
    kind,
    includeMissing: query?.includeMissing === true,
    visibleOnly: query?.visibleOnly !== false,
    limit:
      typeof query?.limit === 'number' && Number.isFinite(query.limit)
        ? Math.max(1, Math.min(5000, Math.floor(query.limit)))
        : undefined,
  };

  if (kind === 'text-values') {
    const field = normalizeNativeTrackFieldName(query?.field);
    if (!field) return null;
    normalized.field = field;
  } else {
    const field = normalizeNativeTrackFieldName(query?.field);
    if (field) {
      normalized.field = field;
    }
  }

  return normalized;
}

function ensureAlbumRecord(value: unknown): NativeLibraryAlbumRecord | null {
  if (!isRecord(value)) return null;

  const album = asTrimmedString(value.album);
  const artist = asTrimmedString(value.artist);
  const coverTrackId = asTrimmedString(value.coverTrackId);
  const coverTrackPath = asTrimmedString(value.coverTrackPath);
  if (!album || !artist || !coverTrackId || !coverTrackPath) return null;

  return {
    album,
    artist,
    coverTrackId,
    coverTrackPath,
  };
}

function ensureFacetEntriesResult(value: unknown): NativeLibraryFacetEntriesResult | null {
  if (!isRecord(value)) return null;

  const kind = normalizeFacetKind(readRecordField(value, 'kind'));
  if (!kind) return null;

  if (kind === 'text-values') {
    const rawValues = readRecordField(value, 'textValues', 'text_values');
    if (!Array.isArray(rawValues)) {
      return {
        kind,
        textValues: [],
      };
    }

    const textValues: string[] = [];
    for (const item of rawValues) {
      const normalized = asTrimmedString(item);
      if (!normalized) continue;
      textValues.push(normalized);
    }

    return {
      kind,
      textValues,
    };
  }

  const rawAlbums = readRecordField(value, 'albums');
  if (!Array.isArray(rawAlbums)) {
    return {
      kind,
      albums: [],
    };
  }

  const albums: NativeLibraryAlbumRecord[] = [];
  for (const item of rawAlbums) {
    const parsed = ensureAlbumRecord(item);
    if (!parsed) continue;
    albums.push(parsed);
  }

  return {
    kind,
    albums,
  };
}

function ensureSchemaSourceTableRecord(
  value: unknown
): NativeLibrarySchemaSourceTableRecord | null {
  if (!isRecord(value)) return null;

  const name = asTrimmedString(readRecordField(value, 'name'));
  const columnCount = asNumber(readRecordField(value, 'columnCount', 'column_count'));
  const schemaHash = asTrimmedString(readRecordField(value, 'schemaHash', 'schema_hash'));
  const rawColumns = readRecordField(value, 'columns');
  if (!name || columnCount === undefined || !schemaHash || !Array.isArray(rawColumns)) return null;

  const columns: string[] = [];
  for (const item of rawColumns) {
    const normalized = asTrimmedString(item);
    if (!normalized) continue;
    columns.push(normalized);
  }

  return {
    name,
    columnCount,
    schemaHash,
    columns,
  };
}

function ensureSchemaEnvelope(value: unknown): NativeLibrarySchemaEnvelope | null {
  if (!isRecord(value)) return null;

  const schemaVersion = asNumber(readRecordField(value, 'schemaVersion', 'schema_version'));
  const generatedAtMs = asNumber(readRecordField(value, 'generatedAtMs', 'generated_at_ms'));
  const schemaFingerprint = asTrimmedString(
    readRecordField(value, 'schemaFingerprint', 'schema_fingerprint')
  );
  const rawSourceTables = readRecordField(value, 'sourceTables', 'source_tables');
  const rawTrackFields = readRecordField(value, 'trackFields', 'track_fields');
  const rawFacetCollections = readRecordField(value, 'facetCollections', 'facet_collections');
  if (
    schemaVersion === undefined ||
    generatedAtMs === undefined ||
    !schemaFingerprint ||
    !Array.isArray(rawSourceTables) ||
    !Array.isArray(rawTrackFields) ||
    !Array.isArray(rawFacetCollections)
  ) {
    return null;
  }

  const sourceTables: NativeLibrarySchemaSourceTableRecord[] = [];
  for (const item of rawSourceTables) {
    const parsed = ensureSchemaSourceTableRecord(item);
    if (!parsed) continue;
    sourceTables.push(parsed);
  }

  const trackFields: NativeLibraryTrackFieldCatalogRecord[] = [];
  for (const item of rawTrackFields) {
    const parsed = ensureTrackFieldCatalogRecord(item);
    if (!parsed) continue;
    trackFields.push(parsed);
  }

  const facetCollections: NativeLibraryFacetCatalogRecord[] = [];
  for (const item of rawFacetCollections) {
    const parsed = ensureFacetCatalogRecord(item);
    if (!parsed) continue;
    facetCollections.push(parsed);
  }

  return {
    schemaVersion,
    generatedAtMs,
    schemaFingerprint,
    sourceTables,
    trackFields,
    facetCollections,
  };
}

export function parseNativeLibrarySchemaChangedEventPayload(
  value: unknown
): NativeLibrarySchemaChangedEventPayload | null {
  if (!isRecord(value)) return null;

  const reason = asTrimmedString(readRecordField(value, 'reason'));
  const emittedAtMs = asNumber(readRecordField(value, 'emittedAtMs', 'emitted_at_ms'));
  const schemaVersion = asNumber(readRecordField(value, 'schemaVersion', 'schema_version'));
  const schemaFingerprint = asTrimmedString(
    readRecordField(value, 'schemaFingerprint', 'schema_fingerprint')
  );
  const rawSourceTables = readRecordField(value, 'sourceTables', 'source_tables');
  if (
    !reason ||
    emittedAtMs === undefined ||
    schemaVersion === undefined ||
    !schemaFingerprint ||
    !Array.isArray(rawSourceTables)
  ) {
    return null;
  }

  const sourceTables: NativeLibrarySchemaSourceTableRecord[] = [];
  for (const item of rawSourceTables) {
    const parsed = ensureSchemaSourceTableRecord(item);
    if (!parsed) continue;
    sourceTables.push(parsed);
  }

  return {
    reason,
    emittedAtMs,
    schemaVersion,
    schemaFingerprint,
    sourceTables,
  };
}

function ensureStatsRecord(value: unknown): NativeLibraryStatsRecord | null {
  if (!isRecord(value)) return null;

  const totalTracks = asNumber(value.totalTracks);
  const totalArtists = asNumber(value.totalArtists);
  const totalAlbums = asNumber(value.totalAlbums);
  const totalSize = asNumber(value.totalSize);
  const totalDuration = asNumber(value.totalDuration);
  if (
    totalTracks === undefined ||
    totalArtists === undefined ||
    totalAlbums === undefined ||
    totalSize === undefined ||
    totalDuration === undefined
  ) {
    return null;
  }

  return {
    totalTracks,
    totalArtists,
    totalAlbums,
    totalSize,
    totalDuration,
  };
}

function ensureSourceHealthRecord(value: unknown): NativeLibrarySourceHealthRecord | null {
  if (!isRecord(value)) return null;

  const sourceId = asTrimmedString(value.sourceId);
  const sourcePath = asTrimmedString(value.sourcePath);
  const totalTracks = asNumber(value.totalTracks);
  const availableTracks = asNumber(value.availableTracks);
  const missingTracks = asNumber(value.missingTracks);
  const totalArtists = asNumber(value.totalArtists);
  const totalAlbums = asNumber(value.totalAlbums);
  const totalSize = asNumber(value.totalSize);
  const sourceUpdatedAtMs = asNumber(value.sourceUpdatedAtMs);

  if (!sourceId || !sourcePath) return null;
  if (
    totalTracks === undefined ||
    availableTracks === undefined ||
    missingTracks === undefined ||
    totalArtists === undefined ||
    totalAlbums === undefined ||
    totalSize === undefined ||
    sourceUpdatedAtMs === undefined
  ) {
    return null;
  }

  return {
    sourceId,
    sourcePath,
    sourceDisplayName: asOptionalString(value.sourceDisplayName),
    totalTracks: Math.max(0, Math.floor(totalTracks)),
    availableTracks: Math.max(0, Math.floor(availableTracks)),
    missingTracks: Math.max(0, Math.floor(missingTracks)),
    totalArtists: Math.max(0, Math.floor(totalArtists)),
    totalAlbums: Math.max(0, Math.floor(totalAlbums)),
    totalSize: Math.max(0, Math.floor(totalSize)),
    sourceUpdatedAtMs,
    lastTrackUpdatedAtMs: asNumber(value.lastTrackUpdatedAtMs),
  };
}

function ensureUserEntryRecord(value: unknown): NativeLibraryUserEntryRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(value.id);
  const ownerUid = asTrimmedString(value.ownerUid);
  const inCloud = asBool(value.inCloud);
  const isMissing = asBool(value.isMissing);
  const playCount = asNumber(value.playCount);
  const createdAtMs = asNumber(value.createdAtMs);
  const updatedAtMs = asNumber(value.updatedAtMs);
  if (
    !id ||
    !ownerUid ||
    inCloud === undefined ||
    isMissing === undefined ||
    playCount === undefined ||
    createdAtMs === undefined ||
    updatedAtMs === undefined
  ) {
    return null;
  }

  return {
    id,
    ownerUid,
    trackId: asOptionalString(value.trackId),
    quickFingerprint: normalizeQuickFingerprint(value.quickFingerprint),
    cloudContentId: asOptionalString(value.cloudContentId),
    displayTitle: asOptionalString(value.displayTitle),
    displayArtist: asOptionalString(value.displayArtist),
    rating: asNumber(value.rating),
    tagsJson: asOptionalString(value.tagsJson),
    inCloud,
    isMissing,
    playCount: Math.max(0, Math.floor(playCount)),
    lastPlayedAtMs: asNumber(value.lastPlayedAtMs),
    createdAtMs,
    updatedAtMs,
  };
}

function normalizeStableEntrySourceKind(value: unknown): NativeLibraryStableEntrySourceKind {
  const raw = asTrimmedString(value).toLowerCase();
  if (raw === 'nas' || raw === 'platform' || raw === 'cache') return raw;
  if (raw === 'pmp-server' || raw === 'pmp_server' || raw === 'server') return 'pmp-server';
  return 'local';
}

function normalizeStableEntrySourceAvailability(
  value: unknown
): NativeLibraryStableEntrySourceAvailability {
  const raw = asTrimmedString(value).toLowerCase();
  if (
    raw === 'available' ||
    raw === 'missing' ||
    raw === 'remote-only' ||
    raw === 'stale' ||
    raw === 'auth-required'
  ) {
    return raw;
  }
  if (raw === 'remote_only') return 'remote-only';
  if (raw === 'auth_required') return 'auth-required';
  return 'unknown';
}

function normalizeOptionalUnitNumber(value: unknown): number | undefined {
  const parsed = asNumber(value);
  if (parsed === undefined) return undefined;
  return Math.max(0, Math.min(1, parsed));
}

function normalizeOptionalInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = asNumber(value);
  if (parsed === undefined) return undefined;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function ensureStableEntrySourceRecord(
  value: unknown
): NativeLibraryStableEntrySourceRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(value.id);
  const entryId = asTrimmedString(value.entryId);
  const createdAtMs = asNumber(value.createdAtMs);
  const updatedAtMs = asNumber(value.updatedAtMs);
  const confidence = asNumber(value.confidence);
  const priority = asNumber(value.priority);
  if (
    !id ||
    !entryId ||
    createdAtMs === undefined ||
    updatedAtMs === undefined ||
    confidence === undefined ||
    priority === undefined
  ) {
    return null;
  }

  return {
    id,
    entryId,
    sourceKind: normalizeStableEntrySourceKind(value.sourceKind),
    connectorId: asOptionalString(value.connectorId),
    sourceId: asOptionalString(value.sourceId),
    sourceItemId: asOptionalString(value.sourceItemId),
    locator: asOptionalString(value.locator),
    trackId: asOptionalString(value.trackId),
    quickFingerprint: normalizeQuickFingerprint(value.quickFingerprint),
    fullFingerprint: asOptionalString(value.fullFingerprint),
    availability: normalizeStableEntrySourceAvailability(value.availability),
    qualityScore: normalizeOptionalUnitNumber(value.qualityScore),
    confidence: Math.max(0, Math.min(1, confidence)),
    priority: Math.max(0, Math.floor(priority)),
    lastVerifiedAtMs: asNumber(value.lastVerifiedAtMs),
    createdAtMs,
    updatedAtMs,
  };
}

function normalizePlaylistKind(value: unknown): NativeLibraryPlaylistRecord['kind'] {
  const raw = asTrimmedString(value).toLowerCase();
  if (raw === 'smart') return 'smart';
  if (raw === 'platform') return 'platform';
  return 'manual';
}

function ensurePlaylistRecord(value: unknown): NativeLibraryPlaylistRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(value.id);
  const ownerUid = asTrimmedString(value.ownerUid);
  const name = asTrimmedString(value.name);
  const isReadonly = asBool(value.isReadonly);
  const createdAtMs = asNumber(value.createdAtMs);
  const updatedAtMs = asNumber(value.updatedAtMs);
  if (
    !id ||
    !ownerUid ||
    !name ||
    isReadonly === undefined ||
    createdAtMs === undefined ||
    updatedAtMs === undefined
  ) {
    return null;
  }

  return {
    id,
    ownerUid,
    name,
    description: asOptionalString(value.description),
    coverUrl: asOptionalString(readRecordField(value, 'coverUrl', 'cover_url')),
    kind: normalizePlaylistKind(value.kind),
    sourceConnectorId: asOptionalString(value.sourceConnectorId),
    sourcePlaylistId: asOptionalString(value.sourcePlaylistId),
    smartRuleJson: asOptionalString(value.smartRuleJson),
    isReadonly,
    createdAtMs,
    updatedAtMs,
    lastOpenedAtMs: asNumber(value.lastOpenedAtMs),
    trackCount: Math.max(0, Math.floor(asNumber(value.trackCount) ?? 0)),
    totalDuration: Math.max(0, asNumber(value.totalDuration) ?? 0),
  };
}

function ensurePlaylistItemRecord(value: unknown): NativeLibraryPlaylistItemRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(value.id);
  const playlistId = asTrimmedString(value.playlistId);
  const position = asNumber(value.position);
  const createdAtMs = asNumber(value.createdAtMs);
  if (!id || !playlistId || position === undefined || createdAtMs === undefined) {
    return null;
  }

  return {
    id,
    playlistId,
    position: Math.max(0, Math.floor(position)),
    localTrackId: asOptionalString(value.localTrackId),
    entryId: asOptionalString(value.entryId),
    trackPayloadJson: asOptionalString(value.trackPayloadJson),
    snapshotTitle: asOptionalString(value.snapshotTitle),
    snapshotArtist: asOptionalString(value.snapshotArtist),
    snapshotAlbum: asOptionalString(value.snapshotAlbum),
    snapshotDurationSeconds: asNumber(value.snapshotDurationSeconds),
    createdAtMs,
  };
}

function ensurePlaylistTrackPageResult(value: unknown): NativeLibraryPlaylistTrackPageResult | null {
  if (!isRecord(value)) return null;

  const total = asNumber(value.total);
  const rawItems = Array.isArray(value.items) ? value.items : null;
  if (total === undefined || !rawItems) return null;

  const items: NativeLibraryPlaylistItemRecord[] = [];
  for (const item of rawItems) {
    const parsed = ensurePlaylistItemRecord(item);
    if (!parsed) continue;
    items.push(parsed);
  }

  return {
    total: Math.max(0, Math.floor(total)),
    items,
  };
}

function ensureFallbackTaskRecord(value: unknown): NativeLibraryFallbackTaskRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(value.id);
  const ownerUid = asTrimmedString(value.ownerUid);
  const entryId = asTrimmedString(value.entryId);
  const reason = asTrimmedString(value.reason);
  const status = asTrimmedString(value.status);
  const enqueueCount = asNumber(value.enqueueCount);
  const requestedAtMs = asNumber(value.requestedAtMs);
  const lastRequestedAtMs = asNumber(value.lastRequestedAtMs);
  const updatedAtMs = asNumber(value.updatedAtMs);
  if (
    !id ||
    !ownerUid ||
    !entryId ||
    !reason ||
    !status ||
    enqueueCount === undefined ||
    requestedAtMs === undefined ||
    lastRequestedAtMs === undefined ||
    updatedAtMs === undefined
  ) {
    return null;
  }

  return {
    id,
    ownerUid,
    entryId,
    cloudContentId: asOptionalString(value.cloudContentId),
    trackId: asOptionalString(value.trackId),
    quickFingerprint: normalizeQuickFingerprint(value.quickFingerprint),
    reason,
    status,
    enqueueCount: Math.max(0, Math.floor(enqueueCount)),
    requestedAtMs,
    lastRequestedAtMs,
    updatedAtMs,
    lastError: asOptionalString(value.lastError),
  };
}

function ensureCloudHashJobRecord(value: unknown): NativeLibraryCloudHashJobRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(value.id);
  const ownerUid = asTrimmedString(value.ownerUid);
  const entryId = asTrimmedString(value.entryId);
  const status = asTrimmedString(value.status);
  const attemptCount = asNumber(value.attemptCount);
  const requestedAtMs = asNumber(value.requestedAtMs);
  const updatedAtMs = asNumber(value.updatedAtMs);
  if (
    !id ||
    !ownerUid ||
    !entryId ||
    !status ||
    attemptCount === undefined ||
    requestedAtMs === undefined ||
    updatedAtMs === undefined
  ) {
    return null;
  }

  return {
    id,
    ownerUid,
    entryId,
    trackId: asOptionalString(value.trackId),
    quickFingerprint: normalizeQuickFingerprint(value.quickFingerprint),
    status,
    cloudFullHash: asOptionalString(value.cloudFullHash),
    lastError: asOptionalString(value.lastError),
    attemptCount: Math.max(0, Math.floor(attemptCount)),
    requestedAtMs,
    updatedAtMs,
  };
}

function ensureSyncStatus(value: unknown): NativeLibrarySyncStatus | null {
  if (!isRecord(value)) return null;

  const initialized = asBool(readRecordField(value, 'initialized'));
  const running = asBool(readRecordField(value, 'running'));
  const totalTicks = asNumber(readRecordField(value, 'totalTicks', 'total_ticks'));
  if (initialized === undefined || running === undefined || totalTicks === undefined) {
    return null;
  }

  return {
    initialized,
    running,
    totalTicks: Math.max(0, Math.floor(totalTicks)),
    lastTickReason: asOptionalString(readRecordField(value, 'lastTickReason', 'last_tick_reason')),
    lastTickStartedAtMs: asNumber(
      readRecordField(value, 'lastTickStartedAtMs', 'last_tick_started_at_ms')
    ),
    lastTickFinishedAtMs: asNumber(
      readRecordField(value, 'lastTickFinishedAtMs', 'last_tick_finished_at_ms')
    ),
    lastError: asOptionalString(readRecordField(value, 'lastError', 'last_error')),
    updatedAtMs: asNumber(readRecordField(value, 'updatedAtMs', 'updated_at_ms')),
  };
}

function ensureSyncFailedSource(value: unknown): NativeLibrarySyncFailedSource | null {
  if (!isRecord(value)) return null;

  const sourceId = asTrimmedString(readRecordField(value, 'sourceId', 'source_id'));
  const sourcePath = asTrimmedString(readRecordField(value, 'sourcePath', 'source_path'));
  const error = asTrimmedString(readRecordField(value, 'error'));
  const failedAtMs = asNumber(readRecordField(value, 'failedAtMs', 'failed_at_ms'));
  if (!sourceId || !sourcePath || !error || failedAtMs === undefined) {
    return null;
  }

  return {
    sourceId,
    sourcePath,
    error,
    backoffUntilMs: asNumber(readRecordField(value, 'backoffUntilMs', 'backoff_until_ms')),
    failedAtMs,
  };
}

function ensureSyncFailureSourceSummary(
  value: unknown
): NativeLibrarySyncFailureSourceSummary | null {
  if (!isRecord(value)) return null;

  const sourceId = asTrimmedString(readRecordField(value, 'sourceId', 'source_id'));
  const sourcePath = asTrimmedString(readRecordField(value, 'sourcePath', 'source_path'));
  const connectorId = asTrimmedString(readRecordField(value, 'connectorId', 'connector_id'));
  const backoffActive = asBool(readRecordField(value, 'backoffActive', 'backoff_active'));
  const updatedAtMs = asNumber(readRecordField(value, 'updatedAtMs', 'updated_at_ms'));
  if (!sourceId || !sourcePath || !connectorId || backoffActive === undefined || updatedAtMs === undefined) {
    return null;
  }

  return {
    sourceId,
    sourcePath,
    sourceDisplayName: asOptionalString(
      readRecordField(value, 'sourceDisplayName', 'source_display_name')
    ),
    connectorId,
    lastError: asOptionalString(readRecordField(value, 'lastError', 'last_error')),
    backoffUntilMs: asNumber(readRecordField(value, 'backoffUntilMs', 'backoff_until_ms')),
    backoffRemainingMs: asNumber(
      readRecordField(value, 'backoffRemainingMs', 'backoff_remaining_ms')
    ),
    backoffActive,
    lastSuccessAtMs: asNumber(readRecordField(value, 'lastSuccessAtMs', 'last_success_at_ms')),
    incrementalScanAtMs: asNumber(
      readRecordField(value, 'incrementalScanAtMs', 'incremental_scan_at_ms')
    ),
    updatedAtMs,
  };
}

function ensureSyncFailureOverview(value: unknown): NativeLibrarySyncFailureOverview | null {
  if (!isRecord(value)) return null;

  const generatedAtMs = asNumber(readRecordField(value, 'generatedAtMs', 'generated_at_ms'));
  const totalFailedSources = asNumber(
    readRecordField(value, 'totalFailedSources', 'total_failed_sources')
  );
  const backoffActiveSources = asNumber(
    readRecordField(value, 'backoffActiveSources', 'backoff_active_sources')
  );
  const rawItems = readRecordField(value, 'items');

  if (
    generatedAtMs === undefined ||
    totalFailedSources === undefined ||
    backoffActiveSources === undefined ||
    !Array.isArray(rawItems)
  ) {
    return null;
  }

  const items: NativeLibrarySyncFailureSourceSummary[] = [];
  for (const item of rawItems) {
    const parsed = ensureSyncFailureSourceSummary(item);
    if (!parsed) continue;
    items.push(parsed);
  }

  return {
    generatedAtMs,
    totalFailedSources: Math.max(0, Math.floor(totalFailedSources)),
    backoffActiveSources: Math.max(0, Math.floor(backoffActiveSources)),
    items,
  };
}

function ensureSyncTickResult(value: unknown): NativeLibrarySyncTickResult | null {
  if (!isRecord(value)) return null;

  const reason = asTrimmedString(readRecordField(value, 'reason'));
  const startedAtMs = asNumber(readRecordField(value, 'startedAtMs', 'started_at_ms'));
  const finishedAtMs = asNumber(readRecordField(value, 'finishedAtMs', 'finished_at_ms'));
  const durationMs = asNumber(readRecordField(value, 'durationMs', 'duration_ms'));
  const scannedSources = asNumber(readRecordField(value, 'scannedSources', 'scanned_sources'));
  const changedSources = asNumber(readRecordField(value, 'changedSources', 'changed_sources'));
  const skippedSources = asNumber(readRecordField(value, 'skippedSources', 'skipped_sources'));
  const failedSources = asNumber(readRecordField(value, 'failedSources', 'failed_sources'));
  const enqueuedMetadataJobs = asNumber(
    readRecordField(value, 'enqueuedMetadataJobs', 'enqueued_metadata_jobs')
  );
  const failedSourceItemsRaw = readRecordField(value, 'failedSourceItems', 'failed_source_items');

  if (
    !reason ||
    startedAtMs === undefined ||
    finishedAtMs === undefined ||
    durationMs === undefined ||
    scannedSources === undefined ||
    changedSources === undefined ||
    skippedSources === undefined ||
    failedSources === undefined ||
    enqueuedMetadataJobs === undefined ||
    !Array.isArray(failedSourceItemsRaw)
  ) {
    return null;
  }

  const failedSourceItems: NativeLibrarySyncFailedSource[] = [];
  for (const item of failedSourceItemsRaw) {
    const parsed = ensureSyncFailedSource(item);
    if (!parsed) continue;
    failedSourceItems.push(parsed);
  }

  return {
    reason,
    startedAtMs,
    finishedAtMs,
    durationMs,
    scannedSources: Math.max(0, Math.floor(scannedSources)),
    changedSources: Math.max(0, Math.floor(changedSources)),
    skippedSources: Math.max(0, Math.floor(skippedSources)),
    failedSources: Math.max(0, Math.floor(failedSources)),
    failedSourceItems,
    enqueuedMetadataJobs: Math.max(0, Math.floor(enqueuedMetadataJobs)),
  };
}

function ensureSyncSchedulerStatus(value: unknown): NativeLibrarySyncSchedulerStatus | null {
  if (!isRecord(value)) return null;

  const running = asBool(readRecordField(value, 'running'));
  const intervalMs = asNumber(readRecordField(value, 'intervalMs', 'interval_ms'));
  const ticksTotal = asNumber(readRecordField(value, 'ticksTotal', 'ticks_total'));
  if (running === undefined || intervalMs === undefined || ticksTotal === undefined) {
    return null;
  }

  return {
    running,
    intervalMs: Math.max(0, Math.floor(intervalMs)),
    startedAtMs: asNumber(readRecordField(value, 'startedAtMs', 'started_at_ms')),
    nextRunAtMs: asNumber(readRecordField(value, 'nextRunAtMs', 'next_run_at_ms')),
    ticksTotal: Math.max(0, Math.floor(ticksTotal)),
    lastTickStartedAtMs: asNumber(
      readRecordField(value, 'lastTickStartedAtMs', 'last_tick_started_at_ms')
    ),
    lastTickFinishedAtMs: asNumber(
      readRecordField(value, 'lastTickFinishedAtMs', 'last_tick_finished_at_ms')
    ),
    lastError: asOptionalString(readRecordField(value, 'lastError', 'last_error')),
    lastTickResult: ensureSyncTickResult(
      readRecordField(value, 'lastTickResult', 'last_tick_result')
    ) ?? undefined,
    updatedAtMs: asNumber(readRecordField(value, 'updatedAtMs', 'updated_at_ms')),
  };
}

function ensureSyncRetryResult(value: unknown): NativeLibrarySyncRetryResult | null {
  if (!isRecord(value)) return null;

  const allSources = asBool(readRecordField(value, 'allSources', 'all_sources'));
  const requestedSources = asNumber(readRecordField(value, 'requestedSources', 'requested_sources'));
  const clearedSources = asNumber(readRecordField(value, 'clearedSources', 'cleared_sources'));
  const tickResult = ensureSyncTickResult(readRecordField(value, 'tickResult', 'tick_result'));

  if (
    allSources === undefined ||
    requestedSources === undefined ||
    clearedSources === undefined ||
    !tickResult
  ) {
    return null;
  }

  return {
    allSources,
    requestedSources: Math.max(0, Math.floor(requestedSources)),
    clearedSources: Math.max(0, Math.floor(clearedSources)),
    tickResult,
  };
}

function ensureSyncClearResult(value: unknown): NativeLibrarySyncClearResult | null {
  if (!isRecord(value)) return null;

  const allSources = asBool(readRecordField(value, 'allSources', 'all_sources'));
  const requestedSources = asNumber(readRecordField(value, 'requestedSources', 'requested_sources'));
  const clearedSources = asNumber(readRecordField(value, 'clearedSources', 'cleared_sources'));
  const clearedAtMs = asNumber(readRecordField(value, 'clearedAtMs', 'cleared_at_ms'));

  if (
    allSources === undefined ||
    requestedSources === undefined ||
    clearedSources === undefined ||
    clearedAtMs === undefined
  ) {
    return null;
  }

  return {
    allSources,
    requestedSources: Math.max(0, Math.floor(requestedSources)),
    clearedSources: Math.max(0, Math.floor(clearedSources)),
    clearedAtMs,
  };
}

export async function upsertNativeLibrarySource(
  source: NativeLibrarySourceUpsertInput
): Promise<NativeLibrarySourceRecord | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('music_library_db_upsert_source', { source }).catch(() => null);
  return ensureSourceRecord(raw);
}

export async function listNativeLibrarySources(): Promise<NativeLibrarySourceRecord[]> {
  if (!isTauriRuntime()) return [];
  const raw = await invoke<unknown>('music_library_db_list_sources').catch(() => null);
  if (!Array.isArray(raw)) return [];

  const result: NativeLibrarySourceRecord[] = [];
  for (const item of raw) {
    const parsed = ensureSourceRecord(item);
    if (!parsed) continue;
    result.push(parsed);
  }
  return result;
}

export async function listNativeLibraryConnectors(): Promise<NativeLibraryConnectorRecord[]> {
  if (!isTauriRuntime()) return [];
  const raw = await invoke<unknown>('music_library_db_list_connectors').catch(() => null);
  if (!Array.isArray(raw)) return [];

  const result: NativeLibraryConnectorRecord[] = [];
  for (const item of raw) {
    const parsed = ensureConnectorRecord(item);
    if (!parsed) continue;
    result.push(parsed);
  }
  return result;
}

export async function listNativeLibraryConnectorAccounts(
  connectorId?: string
): Promise<NativeLibraryConnectorAccountRecord[]> {
  if (!isTauriRuntime()) return [];

  const normalizedConnectorId =
    typeof connectorId === 'string' && connectorId.trim().length > 0
      ? connectorId.trim()
      : undefined;

  const raw = await invoke<unknown>('music_library_db_list_connector_accounts', {
    connectorId: normalizedConnectorId,
  }).catch(() => null);
  if (!Array.isArray(raw)) return [];

  const result: NativeLibraryConnectorAccountRecord[] = [];
  for (const item of raw) {
    const parsed = ensureConnectorAccountRecord(item);
    if (!parsed) continue;
    result.push(parsed);
  }
  return result;
}

function normalizeNativeMusicPlatformInstanceId(
  instanceId?: string | null
): string | undefined {
  return typeof instanceId === 'string' && instanceId.trim().length > 0
    ? instanceId.trim()
    : undefined;
}

function normalizeNativeMusicPlatformPayload(
  payload?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!payload) return undefined;

  const normalizedEntries = Object.entries(payload).filter(([, value]) => value !== undefined);
  if (normalizedEntries.length < 1) return undefined;
  return Object.fromEntries(normalizedEntries);
}

async function invokeNativeMusicPlatformAuthCommand<TResult = unknown>(options: {
  connectorId: string;
  method: string;
  instanceId?: string | null;
  payload?: Record<string, unknown>;
  telemetry?: TauriInvokeTelemetryOptions;
}): Promise<TResult> {
  const request = {
    connectorId: options.connectorId,
    method: options.method,
    instanceId: normalizeNativeMusicPlatformInstanceId(options.instanceId),
    payload: normalizeNativeMusicPlatformPayload(options.payload),
  };

  if (options.telemetry) {
    return invokeWithTelemetry<TResult>(
      MUSIC_PLATFORM_AUTH_INVOKE_COMMAND,
      { request },
      options.telemetry
    );
  }

  return invoke<TResult>(MUSIC_PLATFORM_AUTH_INVOKE_COMMAND, { request });
}

async function invokeNativeMusicPlatformApiCommand<TResult = unknown>(options: {
  connectorId: string;
  bindingId: string;
  method: string;
  instanceId?: string | null;
  payload?: Record<string, unknown>;
  telemetry?: TauriInvokeTelemetryOptions;
}): Promise<TResult> {
  const request = {
    connectorId: options.connectorId,
    bindingId: options.bindingId,
    method: options.method,
    instanceId: normalizeNativeMusicPlatformInstanceId(options.instanceId),
    payload: normalizeNativeMusicPlatformPayload(options.payload),
  };

  if (options.telemetry) {
    return invokeWithTelemetry<TResult>(
      MUSIC_PLATFORM_API_INVOKE_COMMAND,
      { request },
      options.telemetry
    );
  }

  return invoke<TResult>(MUSIC_PLATFORM_API_INVOKE_COMMAND, { request });
}

type NativeMusicPlatformApiBucket = 'library' | 'recommendations' | 'search' | 'quality';
type NativeMusicPlatformAuthMethod =
  | 'beginQrLogin'
  | 'pollQrLogin'
  | 'getSnapshot'
  | 'logout'
  | 'clearAuthCookies';

type NativeMusicPlatformAuthCompatDescriptor<TQrSession, TQrPoll, TStatus> = {
  connectorId: string;
  parseQrSession: (value: unknown) => TQrSession | null;
  parseQrPollResult: (value: unknown) => TQrPoll | null;
  parseStatus: (value: unknown) => TStatus | null;
  telemetry?: Partial<Record<NativeMusicPlatformAuthMethod, TauriInvokeTelemetryOptions>>;
};

type NativeMusicPlatformApiCompatDescriptor = {
  connectorId: string;
  bindings: Partial<Record<NativeMusicPlatformApiBucket, string>>;
};

type NativeMusicPlatformInvokeParsedOptions<TResult> = {
  method: string;
  instanceId?: string | null;
  payload?: Record<string, unknown>;
  telemetry?: TauriInvokeTelemetryOptions;
  suppressErrors?: boolean;
  parse: (value: unknown) => TResult | null;
};

type NativeMusicPlatformInvokeArrayOptions<TResult> = {
  method: string;
  instanceId?: string | null;
  payload?: Record<string, unknown>;
  telemetry?: TauriInvokeTelemetryOptions;
  suppressErrors?: boolean;
  parseItem: (value: unknown) => TResult | null;
};

function parseNativeMusicPlatformArray<TResult>(
  value: unknown,
  parseItem: (value: unknown) => TResult | null
): TResult[] {
  if (!Array.isArray(value)) return [];

  const result: TResult[] = [];
  for (const item of value) {
    const parsed = parseItem(item);
    if (!parsed) continue;
    result.push(parsed);
  }
  return result;
}

async function invokeNativeMusicPlatformAuthParsed<TResult>(
  connectorId: string,
  options: NativeMusicPlatformInvokeParsedOptions<TResult>
): Promise<TResult | null> {
  if (!isTauriRuntime()) return null;

  try {
    const raw = await invokeNativeMusicPlatformAuthCommand<unknown>({
      connectorId,
      method: options.method,
      instanceId: options.instanceId,
      payload: options.payload,
      telemetry: options.telemetry,
    });
    return options.parse(raw);
  } catch (error) {
    if (options.suppressErrors) {
      return null;
    }
    throw error;
  }
}

async function invokeNativeMusicPlatformApiParsed<TResult>(
  connectorId: string,
  bindingId: string,
  options: NativeMusicPlatformInvokeParsedOptions<TResult>
): Promise<TResult | null> {
  if (!isTauriRuntime()) return null;

  try {
    const raw = await invokeNativeMusicPlatformApiCommand<unknown>({
      connectorId,
      bindingId,
      method: options.method,
      instanceId: options.instanceId,
      payload: options.payload,
      telemetry: options.telemetry,
    });
    return options.parse(raw);
  } catch (error) {
    if (options.suppressErrors) {
      return null;
    }
    throw error;
  }
}

async function invokeNativeMusicPlatformApiArray<TResult>(
  connectorId: string,
  bindingId: string,
  options: NativeMusicPlatformInvokeArrayOptions<TResult>
): Promise<TResult[]> {
  if (!isTauriRuntime()) return [];

  try {
    const raw = await invokeNativeMusicPlatformApiCommand<unknown>({
      connectorId,
      bindingId,
      method: options.method,
      instanceId: options.instanceId,
      payload: options.payload,
      telemetry: options.telemetry,
    });
    return parseNativeMusicPlatformArray(raw, options.parseItem);
  } catch (error) {
    if (options.suppressErrors) {
      return [];
    }
    throw error;
  }
}

function createNativeMusicPlatformAuthCompatBridge<TQrSession, TQrPoll, TStatus>(
  descriptor: NativeMusicPlatformAuthCompatDescriptor<TQrSession, TQrPoll, TStatus>
) {
  return {
    beginQrLogin: (
      instanceId?: string | null,
      options?: { suppressErrors?: boolean }
    ): Promise<TQrSession | null> =>
      invokeNativeMusicPlatformAuthParsed(descriptor.connectorId, {
        method: 'beginQrLogin',
        instanceId,
        telemetry: descriptor.telemetry?.beginQrLogin,
        suppressErrors: options?.suppressErrors,
        parse: descriptor.parseQrSession,
      }),
    pollQrLogin: (
      sessionId: string,
      options?: { suppressErrors?: boolean }
    ): Promise<TQrPoll | null> => {
      const normalizedSessionId = sessionId.trim();
      if (!normalizedSessionId) {
        return Promise.resolve(null);
      }
      return invokeNativeMusicPlatformAuthParsed(descriptor.connectorId, {
        method: 'pollQrLogin',
        payload: {
          sessionId: normalizedSessionId,
        },
        telemetry: descriptor.telemetry?.pollQrLogin,
        suppressErrors: options?.suppressErrors,
        parse: descriptor.parseQrPollResult,
      });
    },
    getSnapshot: (
      instanceId?: string | null,
      options?: { suppressErrors?: boolean }
    ): Promise<TStatus | null> =>
      invokeNativeMusicPlatformAuthParsed(descriptor.connectorId, {
        method: 'getSnapshot',
        instanceId,
        telemetry: descriptor.telemetry?.getSnapshot,
        suppressErrors: options?.suppressErrors,
        parse: descriptor.parseStatus,
      }),
    logout: (
      instanceId?: string | null,
      options?: { suppressErrors?: boolean }
    ): Promise<TStatus | null> =>
      invokeNativeMusicPlatformAuthParsed(descriptor.connectorId, {
        method: 'logout',
        instanceId,
        telemetry: descriptor.telemetry?.logout,
        suppressErrors: options?.suppressErrors,
        parse: descriptor.parseStatus,
      }),
    clearAuthCookies: (
      instanceId?: string | null,
      options?: { suppressErrors?: boolean }
    ): Promise<TStatus | null> =>
      invokeNativeMusicPlatformAuthParsed(descriptor.connectorId, {
        method: 'clearAuthCookies',
        instanceId,
        telemetry: descriptor.telemetry?.clearAuthCookies,
        suppressErrors: options?.suppressErrors,
        parse: descriptor.parseStatus,
      }),
  };
}

function createNativeMusicPlatformApiCompatBridge(
  descriptor: NativeMusicPlatformApiCompatDescriptor
) {
  return {
    invokeParsed<TResult>(
      bucket: NativeMusicPlatformApiBucket,
      options: NativeMusicPlatformInvokeParsedOptions<TResult>
    ): Promise<TResult | null> {
      const bindingId = descriptor.bindings[bucket];
      if (!bindingId) {
        return Promise.resolve(null);
      }
      return invokeNativeMusicPlatformApiParsed(descriptor.connectorId, bindingId, options);
    },
    invokeList<TResult>(
      bucket: NativeMusicPlatformApiBucket,
      options: NativeMusicPlatformInvokeArrayOptions<TResult>
    ): Promise<TResult[]> {
      const bindingId = descriptor.bindings[bucket];
      if (!bindingId) {
        return Promise.resolve([]);
      }
      return invokeNativeMusicPlatformApiArray(descriptor.connectorId, bindingId, options);
    },
  };
}

const bilibiliNativeAuthCompatBridge = createNativeMusicPlatformAuthCompatBridge({
  connectorId: BILIBILI_CONNECTOR_ID,
  parseQrSession: ensureBilibiliQrCodeSession,
  parseQrPollResult: ensureBilibiliQrPollResult,
  parseStatus: ensureBilibiliAuthStatus,
  telemetry: {
    clearAuthCookies: {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.bilibili.clear-auth-cookies',
      includeResultSize: true,
      failureLevel: 'warn',
    },
  },
});

const bilibiliNativeApiCompatBridge = createNativeMusicPlatformApiCompatBridge({
  connectorId: BILIBILI_CONNECTOR_ID,
  bindings: {
    library: PLATFORM_LIBRARY_BINDING_ID,
    recommendations: PLATFORM_RECOMMENDATIONS_BINDING_ID,
    search: PLATFORM_SEARCH_BINDING_ID,
    quality: PLATFORM_QUALITY_BINDING_ID,
  },
});

const neteaseNativeAuthCompatBridge = createNativeMusicPlatformAuthCompatBridge({
  connectorId: NETEASE_CONNECTOR_ID,
  parseQrSession: ensureNeteaseQrCodeSession,
  parseQrPollResult: ensureNeteaseQrPollResult,
  parseStatus: ensureNeteaseAuthStatus,
  telemetry: {
    beginQrLogin: {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.netease.qr-generate',
      includeResultSize: true,
    },
    pollQrLogin: {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.netease.qr-poll',
      includeResultSize: true,
    },
    getSnapshot: {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.netease.get-auth-status',
      includeResultSize: true,
      failureLevel: 'warn',
    },
    logout: {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.netease.logout',
      includeResultSize: true,
      failureLevel: 'warn',
    },
    clearAuthCookies: {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.netease.clear-auth-cookies',
      includeResultSize: true,
      failureLevel: 'warn',
    },
  },
});

const neteaseNativeApiCompatBridge = createNativeMusicPlatformApiCompatBridge({
  connectorId: NETEASE_CONNECTOR_ID,
  bindings: {
    library: PLATFORM_LIBRARY_BINDING_ID,
    recommendations: PLATFORM_RECOMMENDATIONS_BINDING_ID,
    search: PLATFORM_SEARCH_BINDING_ID,
    quality: PLATFORM_QUALITY_BINDING_ID,
  },
});

export async function generateNativeBilibiliQrCodeSession(
  instanceId?: string | null
): Promise<NativeBilibiliQrCodeSession | null> {
  return bilibiliNativeAuthCompatBridge.beginQrLogin(instanceId, {
    suppressErrors: true,
  });
}

export async function pollNativeBilibiliQrCodeSession(
  sessionId: string
): Promise<NativeBilibiliQrPollResult | null> {
  return bilibiliNativeAuthCompatBridge.pollQrLogin(sessionId, {
    suppressErrors: true,
  });
}

export async function getNativeBilibiliAuthStatus(
  instanceId?: string | null
): Promise<NativeBilibiliAuthStatus | null> {
  return bilibiliNativeAuthCompatBridge.getSnapshot(instanceId, {
    suppressErrors: true,
  });
}

export async function getNativeMusicPlatformGlobalCacheSettings(): Promise<NativeMusicPlatformGlobalCacheSettings | null> {
  if (!isTauriRuntime()) return null;

  const raw = await invoke<unknown>('music_library_music_platform_global_get_cache_settings').catch(
    () => null
  );
  return ensureMusicPlatformGlobalCacheSettings(raw);
}

export async function setNativeMusicPlatformGlobalCacheSettings(
  customRootPath?: string | null
): Promise<NativeMusicPlatformGlobalCacheSettings | null> {
  if (!isTauriRuntime()) return null;

  const normalizedCustomRootPath =
    typeof customRootPath === 'string' && customRootPath.trim().length > 0
      ? customRootPath.trim()
      : undefined;

  const raw = await invoke<unknown>('music_library_music_platform_global_set_cache_settings', {
    customRootPath: normalizedCustomRootPath,
  }).catch(() => null);
  return ensureMusicPlatformGlobalCacheSettings(raw);
}

export async function logoutNativeBilibili(
  instanceId?: string | null
): Promise<NativeBilibiliAuthStatus | null> {
  return bilibiliNativeAuthCompatBridge.logout(instanceId, {
    suppressErrors: true,
  });
}

export async function clearNativeBilibiliAuthCookies(
  instanceId?: string | null
): Promise<NativeBilibiliAuthStatus | null> {
  return bilibiliNativeAuthCompatBridge.clearAuthCookies(instanceId, {
    suppressErrors: true,
  });
}

export async function listNativeBilibiliFavoriteFolders(
  instanceId?: string | null
): Promise<NativeBilibiliFavoriteFolder[]> {
  return bilibiliNativeApiCompatBridge.invokeList('library', {
    method: 'listCollections',
    instanceId,
    suppressErrors: true,
    parseItem: ensureBilibiliFavoriteFolder,
  });
}

export async function listNativeBilibiliFavoriteResources(options: {
  folderId: string;
  pageNum?: number;
  pageSize?: number;
  instanceId?: string | null;
}): Promise<NativeBilibiliFavoriteResourcePage | null> {
  if (!isTauriRuntime()) return null;

  const folderId = options.folderId.trim();
  if (!folderId) return null;

  const pageNum =
    typeof options.pageNum === 'number' && Number.isFinite(options.pageNum)
      ? Math.max(1, Math.floor(options.pageNum))
      : undefined;
  const pageSize =
    typeof options.pageSize === 'number' && Number.isFinite(options.pageSize)
      ? Math.max(1, Math.floor(options.pageSize))
      : undefined;

  return bilibiliNativeApiCompatBridge.invokeParsed('library', {
    method: 'listPlaylistTracks',
    instanceId: options.instanceId,
    payload: {
      folderId,
      pageNum,
      pageSize,
    },
    suppressErrors: true,
    parse: ensureBilibiliFavoriteResourcePage,
  });
}

export async function listNativeBilibiliRecommendedResources(
  instanceId?: string | null
): Promise<
  NativeBilibiliFavoriteResourcePage | null
> {
  return bilibiliNativeApiCompatBridge.invokeParsed('recommendations', {
    method: 'listDaily',
    instanceId,
    parse: ensureBilibiliFavoriteResourcePage,
  });
}

export async function listNativeBilibiliSearchResources(options: {
  keyword: string;
  pageNum?: number;
  pageSize?: number;
  instanceId?: string | null;
}): Promise<NativeBilibiliFavoriteResourcePage | null> {
  if (!isTauriRuntime()) return null;

  const keyword = options.keyword.trim();
  if (!keyword) return null;

  const pageNum =
    typeof options.pageNum === 'number' && Number.isFinite(options.pageNum)
      ? Math.max(1, Math.floor(options.pageNum))
      : undefined;
  const pageSize =
    typeof options.pageSize === 'number' && Number.isFinite(options.pageSize)
      ? Math.max(1, Math.floor(options.pageSize))
      : undefined;

  return bilibiliNativeApiCompatBridge.invokeParsed('search', {
    method: 'query',
    instanceId: options.instanceId,
    payload: {
      keyword,
      pageNum,
      pageSize,
    },
    parse: ensureBilibiliFavoriteResourcePage,
  });
}

export async function searchNativeBilibiliResourceByBvid(
  bvid: string,
  instanceId?: string | null
): Promise<NativeBilibiliFavoriteResourceItem | null> {
  const normalizedBvid = bvid.trim();
  if (!normalizedBvid) return null;
  return bilibiliNativeApiCompatBridge.invokeParsed('search', {
    method: 'resolveLocator',
    instanceId,
    payload: {
      bvid: normalizedBvid,
    },
    suppressErrors: true,
    parse: ensureBilibiliFavoriteResourceItem,
  });
}

export async function prepareNativeBilibiliCoverCache(
  coverUrl: string,
  instanceId?: string | null
): Promise<string | null> {
  const normalizedCoverUrl = coverUrl.trim();
  if (!normalizedCoverUrl) return null;
  return bilibiliNativeApiCompatBridge.invokeParsed('library', {
    method: 'prepareCoverCache',
    instanceId,
    payload: {
      coverUrl: normalizedCoverUrl,
    },
    parse: (raw) => asTrimmedString(raw) || null,
  });
}

export async function listNativeBilibiliPlaybackQualities(
  sourceLocator: string,
  instanceId?: string | null
): Promise<NativeBilibiliPlaybackQualityOption[]> {
  const normalizedSourceLocator = sourceLocator.trim();
  if (!normalizedSourceLocator) return [];
  return bilibiliNativeApiCompatBridge.invokeList('quality', {
    method: 'listOptions',
    instanceId,
    payload: {
      sourceLocator: normalizedSourceLocator,
    },
    parseItem: ensureBilibiliPlaybackQualityOption,
  });
}

export async function prepareNativeBilibiliCachedPlayback(
  sourceLocator: string,
  qualityHint?: string,
  instanceId?: string | null
): Promise<NativeBilibiliPlaybackPrepared | null> {
  const normalizedSourceLocator = sourceLocator.trim();
  if (!normalizedSourceLocator) return null;

  const normalizedQualityHint =
    typeof qualityHint === 'string' && qualityHint.trim().length > 0
      ? qualityHint.trim().toLowerCase()
      : undefined;
  return bilibiliNativeApiCompatBridge.invokeParsed('library', {
    method: 'preparePlayback',
    instanceId,
    payload: {
      sourceLocator: normalizedSourceLocator,
      qualityHint: normalizedQualityHint,
    },
    parse: ensureBilibiliPlaybackPrepared,
  });
}

export async function resolveNativeBilibiliLyricLocator(
  lyricLocator: string,
  instanceId?: string | null
): Promise<NativeBilibiliLyricLocatorRef | null> {
  const normalizedLocator = lyricLocator.trim();
  if (!normalizedLocator) return null;
  return bilibiliNativeApiCompatBridge.invokeParsed('library', {
    method: 'resolveLyricLocator',
    instanceId,
    payload: {
      lyricLocator: normalizedLocator,
    },
    suppressErrors: true,
    parse: ensureBilibiliLyricLocatorRef,
  });
}

export async function generateNativeNeteaseQrCodeSession(
  instanceId?: string | null
): Promise<NativeNeteaseQrCodeSession | null> {
  return neteaseNativeAuthCompatBridge.beginQrLogin(instanceId, {
    suppressErrors: true,
  });
}

export async function pollNativeNeteaseQrCodeSession(
  sessionId: string
): Promise<NativeNeteaseQrPollResult | null> {
  return neteaseNativeAuthCompatBridge.pollQrLogin(sessionId);
}

export async function getNativeNeteaseAuthStatus(
  instanceId?: string | null
): Promise<NativeNeteaseAuthStatus | null> {
  return neteaseNativeAuthCompatBridge.getSnapshot(instanceId, {
    suppressErrors: true,
  });
}

export async function logoutNativeNetease(
  instanceId?: string | null
): Promise<NativeNeteaseAuthStatus | null> {
  return neteaseNativeAuthCompatBridge.logout(instanceId, {
    suppressErrors: true,
  });
}

export async function clearNativeNeteaseAuthCookies(
  instanceId?: string | null
): Promise<NativeNeteaseAuthStatus | null> {
  return neteaseNativeAuthCompatBridge.clearAuthCookies(instanceId, {
    suppressErrors: true,
  });
}

export async function listNativeNeteaseRecommendedPlaylists(
  instanceId?: string | null
): Promise<
  NativeNeteaseRecommendedPlaylist[]
> {
  return neteaseNativeApiCompatBridge.invokeList('recommendations', {
    method: 'listRecommendedPlaylists',
    instanceId,
    parseItem: ensureNeteaseRecommendedPlaylist,
  });
}

export async function listNativeNeteaseRecommendedSongs(
  instanceId?: string | null
): Promise<NativeNeteaseSongPage | null> {
  return neteaseNativeApiCompatBridge.invokeParsed('recommendations', {
    method: 'listDaily',
    instanceId,
    parse: ensureNeteaseSongPage,
  });
}

export async function listNativeNeteaseUserPlaylists(
  instanceId?: string | null
): Promise<NativeNeteaseUserPlaylist[]> {
  return neteaseNativeApiCompatBridge.invokeList('library', {
    method: 'listCollections',
    instanceId,
    parseItem: ensureNeteaseUserPlaylist,
  });
}

export async function listNativeNeteasePlaylistTracks(
  playlistId: string,
  instanceId?: string | null
): Promise<NativeNeteaseSongPage | null> {
  const normalizedPlaylistId = playlistId.trim();
  if (!normalizedPlaylistId) return null;
  return neteaseNativeApiCompatBridge.invokeParsed('library', {
    method: 'listPlaylistTracks',
    instanceId,
    payload: {
      playlistId: normalizedPlaylistId,
    },
    parse: ensureNeteaseSongPage,
  });
}

export async function searchNativeNeteaseSongs(options: {
  keyword: string;
  pageNum?: number;
  pageSize?: number;
  instanceId?: string | null;
}): Promise<NativeNeteaseSongPage | null> {
  const keyword = options.keyword.trim();
  if (!keyword) return null;

  const pageNum =
    typeof options.pageNum === 'number' && Number.isFinite(options.pageNum)
      ? Math.max(1, Math.floor(options.pageNum))
      : undefined;
  const pageSize =
    typeof options.pageSize === 'number' && Number.isFinite(options.pageSize)
      ? Math.max(1, Math.floor(options.pageSize))
      : undefined;
  return neteaseNativeApiCompatBridge.invokeParsed('search', {
    method: 'query',
    instanceId: options.instanceId,
    payload: {
      keyword,
      pageNum,
      pageSize,
    },
    parse: ensureNeteaseSongPage,
  });
}

export async function prepareNativeNeteaseCachedPlayback(
  sourceLocator: string,
  qualityHint?: string,
  instanceId?: string | null
): Promise<NativeNeteasePlaybackPrepared | null> {
  const normalizedSourceLocator = sourceLocator.trim();
  if (!normalizedSourceLocator) return null;
  const normalizedQualityHint = qualityHint?.trim();
  return neteaseNativeApiCompatBridge.invokeParsed('library', {
    method: 'preparePlayback',
    instanceId,
    payload: {
      sourceLocator: normalizedSourceLocator,
      qualityHint: normalizedQualityHint || undefined,
    },
    parse: ensureNeteasePlaybackPrepared,
  });
}

export async function resolveNativeLibraryLyrics(
  request: NativeLyricResolveRequest
): Promise<NativeLyricResolveResult | null> {
  if (!isTauriRuntime()) return null;

  const payload: NativeLyricResolveRequest = {
    entryId:
      typeof request.entryId === 'string' && request.entryId.trim().length > 0
        ? request.entryId.trim()
        : undefined,
    trackId:
      typeof request.trackId === 'string' && request.trackId.trim().length > 0
        ? request.trackId.trim()
        : undefined,
    trackFilePath:
      typeof request.trackFilePath === 'string' && request.trackFilePath.trim().length > 0
        ? request.trackFilePath.trim()
        : undefined,
    quickFingerprint: normalizeQuickFingerprint(request.quickFingerprint),
    title:
      typeof request.title === 'string' && request.title.trim().length > 0
        ? request.title.trim()
        : undefined,
    artist:
      typeof request.artist === 'string' && request.artist.trim().length > 0
        ? request.artist.trim()
        : undefined,
    durationSeconds:
      typeof request.durationSeconds === 'number' && Number.isFinite(request.durationSeconds)
        ? Math.max(0, request.durationSeconds)
        : undefined,
    embeddedLyrics:
      typeof request.embeddedLyrics === 'string' && request.embeddedLyrics.trim().length > 0
        ? request.embeddedLyrics.trim()
        : undefined,
    lyricLocator:
      typeof request.lyricLocator === 'string' && request.lyricLocator.trim().length > 0
        ? request.lyricLocator.trim()
        : undefined,
    cacheKey:
      typeof request.cacheKey === 'string' && request.cacheKey.trim().length > 0
        ? request.cacheKey.trim()
        : undefined,
    language:
      typeof request.language === 'string' && request.language.trim().length > 0
        ? request.language.trim()
        : undefined,
    forceWebLookup: request.forceWebLookup === true,
  };

  if (
    !payload.entryId &&
    !payload.trackId &&
    !payload.quickFingerprint &&
    !payload.trackFilePath
  ) {
    return null;
  }

  const raw = await invoke<unknown>('music_library_lyrics_resolve', {
    request: payload,
  }).catch(() => null);
  return ensureLyricResolveResult(raw);
}

export async function getNativeLibrarySelectedLyrics(
  query: NativeLyricResolveQuery
): Promise<NativeLyricDocument | null> {
  if (!isTauriRuntime()) return null;
  const payload = normalizeLyricResolveQuery(query);

  if (
    !payload.entryId &&
    !payload.trackId &&
    !payload.quickFingerprint &&
    !payload.trackFilePath &&
    !payload.cacheKey
  ) {
    return null;
  }

  const raw = await invoke<unknown>('music_library_lyrics_get_selected', {
    query: payload,
  }).catch(() => null);
  return ensureLyricDocument(raw);
}

export async function writeBackNativeLibraryLyrics(
  request: NativeLyricWriteBackRequest
): Promise<NativeLyricWriteBackResult | null> {
  if (!isTauriRuntime()) return null;
  const normalizedQuery = normalizeLyricResolveQuery(request.query);

  if (
    !normalizedQuery.entryId &&
    !normalizedQuery.trackId &&
    !normalizedQuery.quickFingerprint &&
    !normalizedQuery.trackFilePath &&
    !normalizedQuery.cacheKey
  ) {
    return null;
  }

  const normalizedPolicy =
    request.policy === 'none' || request.policy === 'sidecar' || request.policy === 'embedded'
      ? request.policy
      : undefined;
  const normalizedTrackFilePath =
    typeof request.trackFilePath === 'string' && request.trackFilePath.trim().length > 0
      ? request.trackFilePath.trim()
      : undefined;
  const normalizedFormatHint =
    typeof request.formatHint === 'string' && request.formatHint.trim().length > 0
      ? request.formatHint.trim().toLowerCase()
      : undefined;

  const raw = await invoke<unknown>('music_library_lyrics_write_back', {
    request: {
      query: normalizedQuery,
      trackFilePath: normalizedTrackFilePath,
      policy: normalizedPolicy,
      formatHint: normalizedFormatHint,
    },
  }).catch(() => null);
  return ensureLyricWriteBackResult(raw);
}

export async function removeNativeLibrarySource(sourceId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const normalized = sourceId.trim();
  if (!normalized) return;
  await invokeWithTelemetry('music_library_db_remove_source', { sourceId: normalized }, {
    moduleId: 'music-library',
    component: 'nativeLibraryDb',
    event: 'music-library.db.remove-source',
    successLevel: 'info',
  });
}

export async function syncNativeLibraryTracks(
  sourceId: string,
  upserts: NativeLibraryTrackUpsertInput[],
  missingTrackIds: string[]
): Promise<NativeLibraryTrackSyncResult | null> {
  if (!isTauriRuntime()) return null;
  const normalizedSourceId = sourceId.trim();
  if (!normalizedSourceId) return null;

  const raw = await invoke<unknown>('music_library_db_sync_tracks', {
    sourceId: normalizedSourceId,
    upserts,
    missingTrackIds,
  }).catch(() => null);

  return ensureTrackSyncResult(raw);
}

export async function getNativeLibrarySyncStatus(): Promise<NativeLibrarySyncStatus | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('music_library_sync_get_status').catch(() => null);
  return ensureSyncStatus(raw);
}

export async function runNativeLibrarySyncTick(
  reason?: string
): Promise<NativeLibrarySyncTickResult | null> {
  if (!isTauriRuntime()) return null;
  const normalizedReason =
    typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : undefined;
  const raw = await invoke<unknown>('music_library_sync_run_tick', {
    reason: normalizedReason,
  }).catch(() => null);
  return ensureSyncTickResult(raw);
}

export async function getNativeLibrarySyncSchedulerStatus(): Promise<NativeLibrarySyncSchedulerStatus | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('music_library_sync_scheduler_get_status').catch(() => null);
  return ensureSyncSchedulerStatus(raw);
}

export async function startNativeLibrarySyncScheduler(
  options?: { intervalMs?: number }
): Promise<NativeLibrarySyncSchedulerStatus | null> {
  if (!isTauriRuntime()) return null;

  const intervalMs =
    typeof options?.intervalMs === 'number' && Number.isFinite(options.intervalMs)
      ? Math.max(1, Math.floor(options.intervalMs))
      : undefined;

  const raw = await invoke<unknown>('music_library_sync_scheduler_start', {
    intervalMs,
  }).catch(() => null);
  return ensureSyncSchedulerStatus(raw);
}

export async function stopNativeLibrarySyncScheduler(): Promise<NativeLibrarySyncSchedulerStatus | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('music_library_sync_scheduler_stop').catch(() => null);
  return ensureSyncSchedulerStatus(raw);
}

export async function getNativeLibrarySyncFailureOverview(
  options?: { limit?: number }
): Promise<NativeLibrarySyncFailureOverview | null> {
  if (!isTauriRuntime()) return null;

  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(1000, Math.floor(options.limit)))
      : undefined;

  const raw = await invoke<unknown>('music_library_sync_get_failure_overview', {
    limit,
  }).catch(() => null);
  return ensureSyncFailureOverview(raw);
}

export async function retryNativeLibrarySyncFailedSources(options?: {
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

  const reason =
    typeof options?.reason === 'string' && options.reason.trim().length > 0
      ? options.reason.trim()
      : undefined;

  const raw = await invoke<unknown>('music_library_sync_retry_failed_sources', {
    sourceIds: normalizedSourceIds,
    reason,
  }).catch(() => null);
  return ensureSyncRetryResult(raw);
}

export async function clearNativeLibrarySyncFailedSources(options?: {
  sourceIds?: string[];
}): Promise<NativeLibrarySyncClearResult | null> {
  if (!isTauriRuntime()) return null;

  const sourceIds = Array.isArray(options?.sourceIds) ? options.sourceIds : undefined;
  const normalizedSourceIds = sourceIds
    ? sourceIds
        .map((sourceId) => (typeof sourceId === 'string' ? sourceId.trim() : ''))
        .filter((sourceId) => sourceId.length > 0)
    : undefined;

  const raw = await invoke<unknown>('music_library_sync_clear_failed_sources', {
    sourceIds: normalizedSourceIds,
  }).catch(() => null);
  return ensureSyncClearResult(raw);
}

export async function clearNativeLibraryTracks(): Promise<number> {
  if (!isTauriRuntime()) return 0;
  const raw = await invoke<unknown>('music_library_db_clear_tracks').catch(() => null);
  const parsed = asNumber(raw);
  if (parsed === undefined) return 0;
  return Math.max(0, Math.floor(parsed));
}

export async function deleteNativeLibraryTracks(trackIds: string[]): Promise<number> {
  if (!isTauriRuntime()) return 0;

  const normalizedIds = trackIds
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => id.length > 0);

  if (normalizedIds.length === 0) return 0;

  const raw = await invoke<unknown>('music_library_db_delete_tracks', {
    trackIds: normalizedIds,
  }).catch(() => null);

  const parsed = asNumber(raw);
  if (parsed === undefined) return 0;
  return Math.max(0, Math.floor(parsed));
}

export async function markNativeLibraryTrackPlayed(
  trackId: string,
  options?: { playedAtMs?: number }
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const normalizedTrackId = trackId.trim();
  if (!normalizedTrackId) return false;

  const playedAtMs =
    typeof options?.playedAtMs === 'number' && Number.isFinite(options.playedAtMs)
      ? Math.max(0, Math.floor(options.playedAtMs))
      : undefined;

  const raw = await invoke<unknown>('music_library_db_mark_track_played', {
    trackId: normalizedTrackId,
    playedAtMs,
  }).catch(() => null);

  return raw === true;
}

export async function listNativeLibrarySourceHealth(
  query?: NativeLibrarySourceHealthQuery
): Promise<NativeLibrarySourceHealthRecord[]> {
  if (!isTauriRuntime()) return [];

  const sourceId =
    typeof query?.sourceId === 'string' && query.sourceId.trim().length > 0
      ? query.sourceId.trim()
      : undefined;

  const raw = await invoke<unknown>('music_library_db_list_source_health', {
    query: {
      sourceId,
    },
  }).catch(() => null);

  if (!Array.isArray(raw)) return [];

  const result: NativeLibrarySourceHealthRecord[] = [];
  for (const item of raw) {
    const parsed = ensureSourceHealthRecord(item);
    if (!parsed) continue;
    result.push(parsed);
  }
  return result;
}

export async function cleanupNativeLibrarySourceTracks(
  sourceId: string,
  options?: { missingOnly?: boolean }
): Promise<number> {
  if (!isTauriRuntime()) return 0;
  const normalizedSourceId = sourceId.trim();
  if (!normalizedSourceId) return 0;

  const raw = await invoke<unknown>('music_library_db_cleanup_source_tracks', {
    sourceId: normalizedSourceId,
    missingOnly: options?.missingOnly !== false,
  }).catch(() => null);

  const parsed = asNumber(raw);
  if (parsed === undefined) return 0;
  return Math.max(0, Math.floor(parsed));
}

function buildNativeLibraryTrackQueryPayload(
  query?: NativeLibraryTrackQuery
): NativeLibraryTrackQuery {
  const normalizedFilters = normalizeNativeTrackFilters(query?.filters);
  const normalizedGroupBy = normalizeNativeTrackGroupBy(query?.groupBy);
  const normalizedSort = normalizeNativeTrackSort(query?.sort);
  const normalizedBaseQuery = normalizeNativeTrackBaseQuery(
    query?.baseQuery,
    normalizedFilters,
    normalizedGroupBy,
    normalizedSort
  );

  const payload: NativeLibraryTrackQuery = {
    limit:
      typeof query?.limit === 'number' && Number.isFinite(query.limit)
        ? Math.max(1, Math.min(2000, Math.floor(query.limit)))
        : undefined,
    offset:
      typeof query?.offset === 'number' && Number.isFinite(query.offset)
        ? Math.max(0, Math.floor(query.offset))
        : undefined,
    includeMissing: query?.includeMissing === true,
    visibleOnly: query?.visibleOnly !== false,
    projection: query?.projection === 'list' ? 'list' : query?.projection === 'full' ? 'full' : undefined,
    searchQuery:
      typeof query?.searchQuery === 'string' && query.searchQuery.trim().length > 0
        ? query.searchQuery.trim()
        : undefined,
    artist:
      typeof query?.artist === 'string' && query.artist.trim().length > 0
        ? query.artist.trim()
        : undefined,
    album:
      typeof query?.album === 'string' && query.album.trim().length > 0
        ? query.album.trim()
        : undefined,
    trackId:
      typeof query?.trackId === 'string' && query.trackId.trim().length > 0
        ? query.trackId.trim()
        : undefined,
    sourceId:
      typeof query?.sourceId === 'string' && query.sourceId.trim().length > 0
        ? query.sourceId.trim()
        : undefined,
    quickFingerprint: normalizeQuickFingerprint(query?.quickFingerprint),
    filePath:
      typeof query?.filePath === 'string' && query.filePath.trim().length > 0
        ? query.filePath.trim()
        : undefined,
    baseQuery: normalizedBaseQuery,
    filters: normalizedFilters,
    groupBy: normalizedGroupBy,
    sort: normalizedSort,
  };

  return payload;
}

export async function queryNativeLibraryTracks(
  query?: NativeLibraryTrackQuery
): Promise<NativeLibraryTrackRecord[]> {
  if (!isTauriRuntime()) return [];

  const payload = buildNativeLibraryTrackQueryPayload(query);

  const raw = await invokeWithTelemetry<unknown>(
    'music_library_db_query_tracks',
    { query: payload },
    {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.db.query-tracks',
      includeResultSize: true,
    }
  ).catch(() => null);
  if (!Array.isArray(raw)) return [];

  const tracks: NativeLibraryTrackRecord[] = [];
  for (const item of raw) {
    const parsed = ensureTrackRecord(item);
    if (!parsed) continue;
    tracks.push(parsed);
  }
  return tracks;
}

export async function queryNativeLibraryTracksPage(
  query?: NativeLibraryTrackQuery
): Promise<NativeLibraryTrackPageResult> {
  if (!isTauriRuntime()) return { items: [], total: 0 };

  const payload = buildNativeLibraryTrackQueryPayload(query);
  const raw = await invokeWithTelemetry<unknown>(
    'music_library_db_query_tracks_page',
    {
      query: payload,
    },
    {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.db.query-tracks.page',
      includeResultSize: true,
    }
  ).catch(() => null);

  const parsed = ensureTrackPageResult(raw);
  if (!parsed) return { items: [], total: 0 };
  return parsed;
}

export async function resolveNativeLibraryLocalPlaybackCandidate(
  input: NativeLibraryLocalPlaybackResolveInput
): Promise<NativeLibraryLocalPlaybackResolveResult | null> {
  const payload: NativeLibraryLocalPlaybackResolveInput = {
    trackId: asOptionalString(input.trackId),
    quickFingerprint: normalizeQuickFingerprint(input.quickFingerprint),
    filePath: asOptionalString(input.filePath),
    sourceId: asOptionalString(input.sourceId),
    includeMissing: input.includeMissing === true,
    visibleOnly: input.visibleOnly === true,
  };

  if (!payload.trackId && !payload.quickFingerprint && !payload.filePath) {
    return {
      track: null,
      strategy: 'none',
      requiresNetworkFallback: true,
    };
  }

  if (!isTauriRuntime()) return null;

  const raw = await invokeWithTelemetry<unknown>(
    'music_library_db_resolve_local_playback_candidate',
    {
      input: payload,
    },
    {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.db.resolve-local-playback',
    }
  ).catch(() => null);

  return ensureLocalPlaybackResolveResult(raw);
}

export async function getNativeLibrarySchemaEnvelope(): Promise<NativeLibrarySchemaEnvelope | null> {
  if (!isTauriRuntime()) return null;

  const raw = await invoke<unknown>('music_library_db_get_schema_envelope').catch(() => null);
  return ensureSchemaEnvelope(raw);
}

export async function notifyNativeLibrarySchemaChanged(reason?: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  const raw = await invoke<unknown>('music_library_db_notify_schema_changed', {
    reason: typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : undefined,
  }).catch(() => false);

  return raw === true;
}

export async function listNativeLibraryTrackFieldCatalog(): Promise<
  NativeLibraryTrackFieldCatalogRecord[]
> {
  const envelope = await getNativeLibrarySchemaEnvelope();
  if (envelope) return envelope.trackFields;
  if (!isTauriRuntime()) return [];

  const raw = await invoke<unknown>('music_library_db_list_track_field_catalog').catch(() => null);
  if (!Array.isArray(raw)) return [];

  const fields: NativeLibraryTrackFieldCatalogRecord[] = [];
  for (const item of raw) {
    const parsed = ensureTrackFieldCatalogRecord(item);
    if (!parsed) continue;
    fields.push(parsed);
  }
  return fields;
}

export async function listNativeLibraryFacetCatalog(): Promise<NativeLibraryFacetCatalogRecord[]> {
  const envelope = await getNativeLibrarySchemaEnvelope();
  if (envelope) return envelope.facetCollections;
  if (!isTauriRuntime()) return [];

  const raw = await invoke<unknown>('music_library_db_list_facet_catalog').catch(() => null);
  if (!Array.isArray(raw)) return [];

  const items: NativeLibraryFacetCatalogRecord[] = [];
  for (const item of raw) {
    const parsed = ensureFacetCatalogRecord(item);
    if (!parsed) continue;
    items.push(parsed);
  }
  return items;
}

export async function listNativeLibraryFacetEntries(
  query?: NativeLibraryFacetEntriesQuery
): Promise<NativeLibraryFacetEntriesResult | null> {
  if (!isTauriRuntime()) return null;
  const normalizedQuery = normalizeFacetEntriesQuery(query);
  if (!normalizedQuery) return null;

  const raw = await invoke<unknown>('music_library_db_list_facet_entries', {
    query: normalizedQuery,
  }).catch(() => null);

  return ensureFacetEntriesResult(raw);
}

export async function listNativeLibraryArtists(query?: NativeLibraryFacetQuery): Promise<string[]> {
  return listNativeLibraryTextFacetValues({
    field: 'artist',
    ...normalizeFacetQuery(query),
  });
}

export async function listNativeLibraryTextFacetValues(
  query?: NativeLibraryTextFacetQuery
): Promise<string[]> {
  const normalizedQuery = normalizeTextFacetQuery(query);
  if (!normalizedQuery) return [];
  const result = await listNativeLibraryFacetEntries({
    kind: 'text-values',
    ...normalizedQuery,
  });
  return result?.kind === 'text-values' ? result.textValues ?? [] : [];
}

export async function listNativeLibraryGenres(query?: NativeLibraryFacetQuery): Promise<string[]> {
  return listNativeLibraryTextFacetValues({
    field: 'genre',
    ...normalizeFacetQuery(query),
  });
}

export async function listNativeLibraryAlbums(
  query?: NativeLibraryFacetQuery
): Promise<NativeLibraryAlbumRecord[]> {
  const result = await listNativeLibraryFacetEntries({
    kind: 'album-summaries',
    field: 'album',
    ...normalizeFacetQuery(query),
  });
  return result?.kind === 'album-summaries' ? result.albums ?? [] : [];
}

export async function getNativeLibraryStats(
  query?: NativeLibraryFacetQuery
): Promise<NativeLibraryStatsRecord | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('music_library_db_get_stats', {
    query: normalizeFacetQuery(query),
  }).catch(() => null);
  return ensureStatsRecord(raw);
}

export async function upsertNativeLibraryUserEntry(
  entry: NativeLibraryUserEntryUpsertInput
): Promise<NativeLibraryUserEntryRecord | null> {
  if (!isTauriRuntime()) return null;

  const payload: NativeLibraryUserEntryUpsertInput = {
    ...entry,
    id: asTrimmedString(entry.id),
    ownerUid: asTrimmedString(entry.ownerUid),
    trackId: asOptionalString(entry.trackId),
    quickFingerprint: normalizeQuickFingerprint(entry.quickFingerprint),
    cloudContentId: asOptionalString(entry.cloudContentId),
    displayTitle: asOptionalString(entry.displayTitle),
    displayArtist: asOptionalString(entry.displayArtist),
    rating:
      typeof entry.rating === 'number' && Number.isFinite(entry.rating)
        ? Math.max(0, Math.min(100, Math.floor(entry.rating)))
        : undefined,
    tagsJson: asOptionalString(entry.tagsJson),
    inCloud: entry.inCloud === true,
    isMissing: entry.isMissing === true,
    createdAtMs:
      typeof entry.createdAtMs === 'number' && Number.isFinite(entry.createdAtMs)
        ? Math.max(0, Math.floor(entry.createdAtMs))
        : undefined,
    updatedAtMs:
      typeof entry.updatedAtMs === 'number' && Number.isFinite(entry.updatedAtMs)
        ? Math.max(0, Math.floor(entry.updatedAtMs))
        : undefined,
  };

  if (!payload.id || !payload.ownerUid) return null;

  const raw = await invoke<unknown>('music_library_db_upsert_user_entry', {
    entry: payload,
  }).catch(() => null);
  return ensureUserEntryRecord(raw);
}

export async function listNativeLibraryUserEntries(
  query?: NativeLibraryUserEntryQuery
): Promise<NativeLibraryUserEntryRecord[]> {
  if (!isTauriRuntime()) return [];

  const payload: NativeLibraryUserEntryQuery = {
    ownerUid:
      typeof query?.ownerUid === 'string' && query.ownerUid.trim().length > 0
        ? query.ownerUid.trim()
        : undefined,
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

  const raw = await invoke<unknown>('music_library_db_list_user_entries', {
    query: payload,
  }).catch(() => null);
  if (!Array.isArray(raw)) return [];

  const entries: NativeLibraryUserEntryRecord[] = [];
  for (const item of raw) {
    const parsed = ensureUserEntryRecord(item);
    if (!parsed) continue;
    entries.push(parsed);
  }
  return entries;
}

export async function deleteNativeLibraryUserEntry(entryId: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const normalizedEntryId = entryId.trim();
  if (!normalizedEntryId) return false;

  const raw = await invoke<unknown>('music_library_db_delete_user_entry', {
    entryId: normalizedEntryId,
  }).catch(() => null);
  return raw === true;
}

export async function markNativeLibraryUserEntryPlayed(
  entryId: string,
  options?: { playedAtMs?: number }
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const normalizedEntryId = entryId.trim();
  if (!normalizedEntryId) return false;

  const playedAtMs =
    typeof options?.playedAtMs === 'number' && Number.isFinite(options.playedAtMs)
      ? Math.max(0, Math.floor(options.playedAtMs))
      : undefined;

  const raw = await invoke<unknown>('music_library_db_mark_user_entry_played', {
    entryId: normalizedEntryId,
    playedAtMs,
  }).catch(() => null);
  return raw === true;
}

export async function upsertNativeLibraryStableEntrySource(
  source: NativeLibraryStableEntrySourceUpsertInput
): Promise<NativeLibraryStableEntrySourceRecord | null> {
  if (!isTauriRuntime()) return null;

  const payload: NativeLibraryStableEntrySourceUpsertInput = {
    id: asOptionalString(source.id),
    entryId: asTrimmedString(source.entryId),
    sourceKind: normalizeStableEntrySourceKind(source.sourceKind),
    connectorId: asOptionalString(source.connectorId),
    sourceId: asOptionalString(source.sourceId),
    sourceItemId: asOptionalString(source.sourceItemId),
    locator: asOptionalString(source.locator),
    trackId: asOptionalString(source.trackId),
    quickFingerprint: normalizeQuickFingerprint(source.quickFingerprint),
    fullFingerprint: asOptionalString(source.fullFingerprint),
    availability: normalizeStableEntrySourceAvailability(source.availability),
    qualityScore: normalizeOptionalUnitNumber(source.qualityScore),
    confidence: normalizeOptionalUnitNumber(source.confidence),
    priority: normalizeOptionalInteger(source.priority, 0, 10000),
    lastVerifiedAtMs: normalizeOptionalInteger(source.lastVerifiedAtMs),
    createdAtMs: normalizeOptionalInteger(source.createdAtMs),
    updatedAtMs: normalizeOptionalInteger(source.updatedAtMs),
  };

  if (!payload.entryId) return null;

  const raw = await invoke<unknown>('music_library_db_upsert_stable_entry_source', {
    source: payload,
  }).catch(() => null);
  return ensureStableEntrySourceRecord(raw);
}

export async function listNativeLibraryStableEntrySources(
  query?: NativeLibraryStableEntrySourceQuery
): Promise<NativeLibraryStableEntrySourceRecord[]> {
  if (!isTauriRuntime()) return [];

  const payload: NativeLibraryStableEntrySourceQuery = {
    entryId: asOptionalString(query?.entryId),
    sourceKind:
      typeof query?.sourceKind === 'string' && query.sourceKind.trim().length > 0
        ? normalizeStableEntrySourceKind(query.sourceKind)
        : undefined,
    connectorId: asOptionalString(query?.connectorId),
    sourceId: asOptionalString(query?.sourceId),
    trackId: asOptionalString(query?.trackId),
    availability:
      typeof query?.availability === 'string' && query.availability.trim().length > 0
        ? normalizeStableEntrySourceAvailability(query.availability)
        : undefined,
    limit: normalizeOptionalInteger(query?.limit, 1, 2000),
    offset: normalizeOptionalInteger(query?.offset),
  };

  const raw = await invoke<unknown>('music_library_db_list_stable_entry_sources', {
    query: payload,
  }).catch(() => null);
  if (!Array.isArray(raw)) return [];

  const sources: NativeLibraryStableEntrySourceRecord[] = [];
  for (const item of raw) {
    const parsed = ensureStableEntrySourceRecord(item);
    if (!parsed) continue;
    sources.push(parsed);
  }
  return sources;
}

export async function deleteNativeLibraryStableEntrySource(sourceId: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const normalizedSourceId = sourceId.trim();
  if (!normalizedSourceId) return false;

  const raw = await invoke<unknown>('music_library_db_delete_stable_entry_source', {
    sourceId: normalizedSourceId,
  }).catch(() => null);
  return raw === true;
}

export async function upsertNativeLibraryPlaylist(
  playlist: NativeLibraryPlaylistUpsertInput
): Promise<NativeLibraryPlaylistRecord | null> {
  if (!isTauriRuntime()) return null;

  const payload: NativeLibraryPlaylistUpsertInput = {
    ...playlist,
    id: asTrimmedString(playlist.id),
    ownerUid: asTrimmedString(playlist.ownerUid),
    name: asTrimmedString(playlist.name),
    description: asOptionalString(playlist.description),
    coverUrl: asOptionalString(playlist.coverUrl),
    kind: normalizePlaylistKind(playlist.kind),
    sourceConnectorId: asOptionalString(playlist.sourceConnectorId),
    sourcePlaylistId: asOptionalString(playlist.sourcePlaylistId),
    smartRuleJson: asOptionalString(playlist.smartRuleJson),
    isReadonly: playlist.isReadonly === true,
    createdAtMs:
      typeof playlist.createdAtMs === 'number' && Number.isFinite(playlist.createdAtMs)
        ? Math.max(0, Math.floor(playlist.createdAtMs))
        : undefined,
    updatedAtMs:
      typeof playlist.updatedAtMs === 'number' && Number.isFinite(playlist.updatedAtMs)
        ? Math.max(0, Math.floor(playlist.updatedAtMs))
        : undefined,
    lastOpenedAtMs:
      typeof playlist.lastOpenedAtMs === 'number' && Number.isFinite(playlist.lastOpenedAtMs)
        ? Math.max(0, Math.floor(playlist.lastOpenedAtMs))
        : undefined,
  };
  if (!payload.id || !payload.ownerUid || !payload.name) return null;

  const raw = await invoke<unknown>('music_library_db_upsert_playlist', {
    playlist: payload,
  }).catch(() => null);
  return ensurePlaylistRecord(raw);
}

export async function listNativeLibraryPlaylists(
  query?: NativeLibraryPlaylistQuery
): Promise<NativeLibraryPlaylistRecord[]> {
  if (!isTauriRuntime()) return [];

  const payload: NativeLibraryPlaylistQuery = {
    ownerUid:
      typeof query?.ownerUid === 'string' && query.ownerUid.trim().length > 0
        ? query.ownerUid.trim()
        : undefined,
    kind: query?.kind ? normalizePlaylistKind(query.kind) : undefined,
    limit:
      typeof query?.limit === 'number' && Number.isFinite(query.limit)
        ? Math.max(1, Math.min(2000, Math.floor(query.limit)))
        : undefined,
    offset:
      typeof query?.offset === 'number' && Number.isFinite(query.offset)
        ? Math.max(0, Math.floor(query.offset))
        : undefined,
  };

  const raw = await invokeWithTelemetry<unknown>(
    'music_library_db_list_playlists',
    {
      query: payload,
    },
    {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.db.list-playlists',
      includeResultSize: true,
    }
  ).catch(() => null);
  if (!Array.isArray(raw)) return [];

  const playlists: NativeLibraryPlaylistRecord[] = [];
  for (const item of raw) {
    const parsed = ensurePlaylistRecord(item);
    if (!parsed) continue;
    playlists.push(parsed);
  }
  return playlists;
}

export async function deleteNativeLibraryPlaylist(playlistId: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const normalizedPlaylistId = playlistId.trim();
  if (!normalizedPlaylistId) return false;

  const raw = await invoke<unknown>('music_library_db_delete_playlist', {
    playlistId: normalizedPlaylistId,
  }).catch(() => null);
  return raw === true;
}

export async function touchNativeLibraryPlaylistOpened(
  playlistId: string,
  options?: { openedAtMs?: number }
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const normalizedPlaylistId = playlistId.trim();
  if (!normalizedPlaylistId) return false;

  const openedAtMs =
    typeof options?.openedAtMs === 'number' && Number.isFinite(options.openedAtMs)
      ? Math.max(0, Math.floor(options.openedAtMs))
      : undefined;

  const raw = await invoke<unknown>('music_library_db_touch_playlist_opened', {
    playlistId: normalizedPlaylistId,
    openedAtMs,
  }).catch(() => null);
  return raw === true;
}

export async function replaceNativeLibraryPlaylistItems(
  playlistId: string,
  items: NativeLibraryPlaylistItemUpsertInput[]
): Promise<number> {
  if (!isTauriRuntime()) return 0;
  const normalizedPlaylistId = playlistId.trim();
  if (!normalizedPlaylistId) return 0;

  const payload = items.map((item) => ({
    id: asOptionalString(item.id),
    position:
      typeof item.position === 'number' && Number.isFinite(item.position)
        ? Math.max(0, Math.floor(item.position))
        : undefined,
    localTrackId: asOptionalString(item.localTrackId),
    entryId: asOptionalString(item.entryId),
    trackPayloadJson: asOptionalString(item.trackPayloadJson),
    snapshotTitle: asOptionalString(item.snapshotTitle),
    snapshotArtist: asOptionalString(item.snapshotArtist),
    snapshotAlbum: asOptionalString(item.snapshotAlbum),
    snapshotDurationSeconds:
      typeof item.snapshotDurationSeconds === 'number' && Number.isFinite(item.snapshotDurationSeconds)
        ? Math.max(0, item.snapshotDurationSeconds)
        : undefined,
    createdAtMs:
      typeof item.createdAtMs === 'number' && Number.isFinite(item.createdAtMs)
        ? Math.max(0, Math.floor(item.createdAtMs))
        : undefined,
  }));

  const raw = await invoke<unknown>('music_library_db_replace_playlist_items', {
    playlistId: normalizedPlaylistId,
    items: payload,
  }).catch(() => null);

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  return 0;
}

export async function listNativeLibraryPlaylistItems(
  playlistId: string,
  options?: { limit?: number }
): Promise<NativeLibraryPlaylistItemRecord[]> {
  if (!isTauriRuntime()) return [];
  const normalizedPlaylistId = playlistId.trim();
  if (!normalizedPlaylistId) return [];

  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(512, Math.floor(options.limit)))
      : undefined;

  const raw = await invokeWithTelemetry<unknown>(
    'music_library_db_list_playlist_items',
    {
      playlistId: normalizedPlaylistId,
      limit,
    },
    {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.db.list-playlist-items',
      includeResultSize: true,
    }
  ).catch(() => null);
  if (!Array.isArray(raw)) return [];

  const result: NativeLibraryPlaylistItemRecord[] = [];
  for (const item of raw) {
    const parsed = ensurePlaylistItemRecord(item);
    if (!parsed) continue;
    result.push(parsed);
  }
  return result;
}

export async function prependNativeLibraryPlaylistItem(
  playlistId: string,
  item: NativeLibraryPlaylistItemUpsertInput
): Promise<NativeLibraryPlaylistRecord | null> {
  if (!isTauriRuntime()) return null;
  const normalizedPlaylistId = playlistId.trim();
  if (!normalizedPlaylistId) return null;

  const payload = {
    id: asOptionalString(item.id),
    position:
      typeof item.position === 'number' && Number.isFinite(item.position)
        ? Math.max(0, Math.floor(item.position))
        : undefined,
    localTrackId: asOptionalString(item.localTrackId),
    entryId: asOptionalString(item.entryId),
    trackPayloadJson: asOptionalString(item.trackPayloadJson),
    snapshotTitle: asOptionalString(item.snapshotTitle),
    snapshotArtist: asOptionalString(item.snapshotArtist),
    snapshotAlbum: asOptionalString(item.snapshotAlbum),
    snapshotDurationSeconds:
      typeof item.snapshotDurationSeconds === 'number' && Number.isFinite(item.snapshotDurationSeconds)
        ? Math.max(0, item.snapshotDurationSeconds)
        : undefined,
    createdAtMs:
      typeof item.createdAtMs === 'number' && Number.isFinite(item.createdAtMs)
        ? Math.max(0, Math.floor(item.createdAtMs))
        : undefined,
  };

  const raw = await invokeWithTelemetry<unknown>(
    'music_library_db_prepend_playlist_item',
    {
      playlistId: normalizedPlaylistId,
      item: payload,
    },
    {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.db.prepend-playlist-item',
      includeResultSize: true,
    }
  ).catch(() => null);

  return ensurePlaylistRecord(raw);
}

export async function removeNativeLibraryPlaylistItemAt(
  playlistId: string,
  position: number
): Promise<NativeLibraryPlaylistRecord | null> {
  if (!isTauriRuntime()) return null;
  const normalizedPlaylistId = playlistId.trim();
  if (!normalizedPlaylistId) return null;
  if (!Number.isFinite(position)) return null;

  const raw = await invokeWithTelemetry<unknown>(
    'music_library_db_remove_playlist_item_at',
    {
      playlistId: normalizedPlaylistId,
      position: Math.max(0, Math.floor(position)),
    },
    {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.db.remove-playlist-item',
      includeResultSize: true,
    }
  ).catch(() => null);

  return ensurePlaylistRecord(raw);
}

export async function clearNativeLibraryPlaylistItems(
  playlistId: string
): Promise<NativeLibraryPlaylistRecord | null> {
  if (!isTauriRuntime()) return null;
  const normalizedPlaylistId = playlistId.trim();
  if (!normalizedPlaylistId) return null;

  const raw = await invokeWithTelemetry<unknown>(
    'music_library_db_clear_playlist_items',
    {
      playlistId: normalizedPlaylistId,
    },
    {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.db.clear-playlist-items',
      includeResultSize: true,
    }
  ).catch(() => null);

  return ensurePlaylistRecord(raw);
}

export async function queryNativeLibraryPlaylistTracksPage(
  query: NativeLibraryPlaylistTrackPageQuery
): Promise<NativeLibraryPlaylistTrackPageResult> {
  if (!isTauriRuntime()) return { items: [], total: 0 };

  const playlistId = asTrimmedString(query.playlistId);
  if (!playlistId) return { items: [], total: 0 };

  const limit =
    typeof query.limit === 'number' && Number.isFinite(query.limit)
      ? Math.max(1, Math.min(2000, Math.floor(query.limit)))
      : undefined;
  const offset =
    typeof query.offset === 'number' && Number.isFinite(query.offset)
      ? Math.max(0, Math.floor(query.offset))
      : undefined;
  const searchQuery = asOptionalString(query.searchQuery);
  const sortField: NativeLibraryPlaylistTrackSortField =
    query.sortField === 'title' ||
    query.sortField === 'artist' ||
    query.sortField === 'album' ||
    query.sortField === 'duration'
      ? query.sortField
      : 'default';
  const sortDirection: NativeLibraryPlaylistTrackSortDirection =
    query.sortDirection === 'desc' ? 'desc' : 'asc';

  const raw = await invokeWithTelemetry<unknown>(
    'music_library_db_query_playlist_tracks_page',
    {
      query: {
        playlistId,
        searchQuery,
        sortField,
        sortDirection,
        limit,
        offset,
      },
    },
    {
      moduleId: 'music-library',
      component: 'nativeLibraryDb',
      event: 'music-library.db.query-playlist-tracks.page',
      includeResultSize: true,
    }
  ).catch(() => null);

  const parsed = ensurePlaylistTrackPageResult(raw);
  if (!parsed) return { items: [], total: 0 };
  return parsed;
}

export async function upsertNativeLibraryFallbackTask(
  task: NativeLibraryFallbackTaskUpsertInput
): Promise<NativeLibraryFallbackTaskRecord | null> {
  if (!isTauriRuntime()) return null;

  const payload: NativeLibraryFallbackTaskUpsertInput = {
    ...task,
    id: asOptionalString(task.id),
    ownerUid: asTrimmedString(task.ownerUid),
    entryId: asTrimmedString(task.entryId),
    cloudContentId: asOptionalString(task.cloudContentId),
    trackId: asOptionalString(task.trackId),
    quickFingerprint: normalizeQuickFingerprint(task.quickFingerprint),
    reason: asOptionalString(task.reason),
    requestedAtMs:
      typeof task.requestedAtMs === 'number' && Number.isFinite(task.requestedAtMs)
        ? Math.max(0, Math.floor(task.requestedAtMs))
        : undefined,
  };

  if (!payload.ownerUid || !payload.entryId) return null;

  const raw = await invoke<unknown>('music_library_db_upsert_fallback_task', {
    task: payload,
  }).catch(() => null);
  return ensureFallbackTaskRecord(raw);
}

export async function listNativeLibraryFallbackTasks(
  query?: NativeLibraryFallbackTaskQuery
): Promise<NativeLibraryFallbackTaskRecord[]> {
  if (!isTauriRuntime()) return [];

  const payload: NativeLibraryFallbackTaskQuery = {
    ownerUid:
      typeof query?.ownerUid === 'string' && query.ownerUid.trim().length > 0
        ? query.ownerUid.trim()
        : undefined,
    status:
      typeof query?.status === 'string' && query.status.trim().length > 0
        ? query.status.trim()
        : undefined,
    limit:
      typeof query?.limit === 'number' && Number.isFinite(query.limit)
        ? Math.max(1, Math.min(2000, Math.floor(query.limit)))
        : undefined,
    offset:
      typeof query?.offset === 'number' && Number.isFinite(query.offset)
        ? Math.max(0, Math.floor(query.offset))
        : undefined,
  };

  const raw = await invoke<unknown>('music_library_db_list_fallback_tasks', {
    query: payload,
  }).catch(() => null);
  if (!Array.isArray(raw)) return [];

  const tasks: NativeLibraryFallbackTaskRecord[] = [];
  for (const item of raw) {
    const parsed = ensureFallbackTaskRecord(item);
    if (!parsed) continue;
    tasks.push(parsed);
  }
  return tasks;
}

export async function updateNativeLibraryFallbackTaskStatus(
  taskId: string,
  status: string,
  options?: { lastError?: string }
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const normalizedTaskId = taskId.trim();
  const normalizedStatus = status.trim();
  if (!normalizedTaskId || !normalizedStatus) return false;

  const raw = await invoke<unknown>('music_library_db_update_fallback_task_status', {
    taskId: normalizedTaskId,
    status: normalizedStatus,
    lastError: asOptionalString(options?.lastError),
  }).catch(() => null);
  return raw === true;
}

export async function upsertNativeLibraryCloudHashJob(
  job: NativeLibraryCloudHashJobUpsertInput
): Promise<NativeLibraryCloudHashJobRecord | null> {
  if (!isTauriRuntime()) return null;

  const payload: NativeLibraryCloudHashJobUpsertInput = {
    ...job,
    id: asOptionalString(job.id),
    ownerUid: asTrimmedString(job.ownerUid),
    entryId: asTrimmedString(job.entryId),
    trackId: asOptionalString(job.trackId),
    quickFingerprint: normalizeQuickFingerprint(job.quickFingerprint),
    status: asOptionalString(job.status),
    cloudFullHash: asOptionalString(job.cloudFullHash),
    lastError: asOptionalString(job.lastError),
    requestedAtMs:
      typeof job.requestedAtMs === 'number' && Number.isFinite(job.requestedAtMs)
        ? Math.max(0, Math.floor(job.requestedAtMs))
        : undefined,
  };

  if (!payload.ownerUid || !payload.entryId) return null;

  const raw = await invoke<unknown>('music_library_db_upsert_cloud_hash_job', {
    job: payload,
  }).catch(() => null);
  return ensureCloudHashJobRecord(raw);
}

export async function listNativeLibraryCloudHashJobs(
  query?: NativeLibraryCloudHashJobQuery
): Promise<NativeLibraryCloudHashJobRecord[]> {
  if (!isTauriRuntime()) return [];

  const payload: NativeLibraryCloudHashJobQuery = {
    ownerUid:
      typeof query?.ownerUid === 'string' && query.ownerUid.trim().length > 0
        ? query.ownerUid.trim()
        : undefined,
    status:
      typeof query?.status === 'string' && query.status.trim().length > 0
        ? query.status.trim()
        : undefined,
    limit:
      typeof query?.limit === 'number' && Number.isFinite(query.limit)
        ? Math.max(1, Math.min(2000, Math.floor(query.limit)))
        : undefined,
    offset:
      typeof query?.offset === 'number' && Number.isFinite(query.offset)
        ? Math.max(0, Math.floor(query.offset))
        : undefined,
  };

  const raw = await invoke<unknown>('music_library_db_list_cloud_hash_jobs', {
    query: payload,
  }).catch(() => null);
  if (!Array.isArray(raw)) return [];

  const jobs: NativeLibraryCloudHashJobRecord[] = [];
  for (const item of raw) {
    const parsed = ensureCloudHashJobRecord(item);
    if (!parsed) continue;
    jobs.push(parsed);
  }
  return jobs;
}

export async function updateNativeLibraryCloudHashJobStatus(
  jobId: string,
  status: string,
  options?: { cloudFullHash?: string; lastError?: string }
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const normalizedJobId = jobId.trim();
  const normalizedStatus = status.trim();
  if (!normalizedJobId || !normalizedStatus) return false;

  const raw = await invoke<unknown>('music_library_db_update_cloud_hash_job_status', {
    jobId: normalizedJobId,
    status: normalizedStatus,
    cloudFullHash: asOptionalString(options?.cloudFullHash),
    lastError: asOptionalString(options?.lastError),
  }).catch(() => null);
  return raw === true;
}
