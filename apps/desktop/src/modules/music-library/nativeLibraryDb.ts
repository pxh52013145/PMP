import { invoke } from '@tauri-apps/api/tauri';
import { isTauriRuntime } from '../../utils/tauriRuntime';

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

export interface NativeBilibiliPlaybackCacheSettings {
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

export interface NativeLibraryTrackUpsertInput {
  id: string;
  filePath: string;
  quickFingerprint?: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
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
  searchQuery?: string;
  artist?: string;
  album?: string;
  trackId?: string;
  sourceId?: string;
  quickFingerprint?: string;
  filePath?: string;
}

export interface NativeLibraryTrackRecord {
  id: string;
  sourceId: string;
  filePath: string;
  quickFingerprint?: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  durationSeconds?: number;
  sampleRate?: number;
  bitDepth?: number;
  fileSize?: number;
  mtimeMs?: number;
  replayGainTrackDb?: number;
  replayGainAlbumDb?: number;
  playCount: number;
  lastPlayedAtMs?: number;
  status: string;
  updatedAtMs: number;
}

export interface NativeLibraryFacetQuery {
  includeMissing?: boolean;
  visibleOnly?: boolean;
}

export interface NativeLibraryAlbumRecord {
  album: string;
  artist: string;
  coverTrackId: string;
  coverTrackPath: string;
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

function ensureBilibiliPlaybackCacheSettings(
  value: unknown
): NativeBilibiliPlaybackCacheSettings | null {
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
    genre: asOptionalString(readRecordField(value, 'genre')),
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
    playCount: Math.max(0, Math.floor(playCount)),
    lastPlayedAtMs: asNumber(readRecordField(value, 'lastPlayedAtMs', 'last_played_at_ms')),
    status,
    updatedAtMs,
  };
}

function normalizeFacetQuery(query?: NativeLibraryFacetQuery): NativeLibraryFacetQuery {
  return {
    includeMissing: query?.includeMissing === true,
    visibleOnly: query?.visibleOnly !== false,
  };
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

export async function generateNativeBilibiliQrCodeSession(): Promise<NativeBilibiliQrCodeSession | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('music_library_bilibili_qr_generate').catch(() => null);
  return ensureBilibiliQrCodeSession(raw);
}

export async function pollNativeBilibiliQrCodeSession(
  sessionId: string
): Promise<NativeBilibiliQrPollResult | null> {
  if (!isTauriRuntime()) return null;
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return null;

  const raw = await invoke<unknown>('music_library_bilibili_qr_poll', {
    sessionId: normalizedSessionId,
  }).catch(() => null);
  return ensureBilibiliQrPollResult(raw);
}

export async function getNativeBilibiliAuthStatus(): Promise<NativeBilibiliAuthStatus | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('music_library_bilibili_get_auth_status').catch(() => null);
  return ensureBilibiliAuthStatus(raw);
}

export async function getNativeBilibiliPlaybackCacheSettings(): Promise<NativeBilibiliPlaybackCacheSettings | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('music_library_bilibili_get_playback_cache_settings').catch(
    () => null
  );
  return ensureBilibiliPlaybackCacheSettings(raw);
}

export async function setNativeBilibiliPlaybackCacheSettings(
  customRootPath?: string | null
): Promise<NativeBilibiliPlaybackCacheSettings | null> {
  if (!isTauriRuntime()) return null;

  const normalizedCustomRootPath =
    typeof customRootPath === 'string' && customRootPath.trim().length > 0
      ? customRootPath.trim()
      : undefined;

  const raw = await invoke<unknown>('music_library_bilibili_set_playback_cache_settings', {
    customRootPath: normalizedCustomRootPath,
  }).catch(() => null);

  return ensureBilibiliPlaybackCacheSettings(raw);
}

export async function logoutNativeBilibili(): Promise<NativeBilibiliAuthStatus | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('music_library_bilibili_logout').catch(() => null);
  return ensureBilibiliAuthStatus(raw);
}

export async function listNativeBilibiliFavoriteFolders(): Promise<NativeBilibiliFavoriteFolder[]> {
  if (!isTauriRuntime()) return [];
  const raw = await invoke<unknown>('music_library_bilibili_list_favorite_folders').catch(() => null);
  if (!Array.isArray(raw)) return [];

  const result: NativeBilibiliFavoriteFolder[] = [];
  for (const item of raw) {
    const parsed = ensureBilibiliFavoriteFolder(item);
    if (!parsed) continue;
    result.push(parsed);
  }

  return result;
}

export async function listNativeBilibiliFavoriteResources(options: {
  folderId: string;
  pageNum?: number;
  pageSize?: number;
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

  const raw = await invoke<unknown>('music_library_bilibili_list_favorite_resources', {
    folderId,
    pageNum,
    pageSize,
  }).catch(() => null);
  return ensureBilibiliFavoriteResourcePage(raw);
}

export async function listNativeBilibiliRecommendedResources(): Promise<
  NativeBilibiliFavoriteResourcePage | null
> {
  if (!isTauriRuntime()) return null;

  const raw = await invoke<unknown>('music_library_bilibili_list_recommended_resources');
  return ensureBilibiliFavoriteResourcePage(raw);
}

export async function listNativeBilibiliSearchResources(options: {
  keyword: string;
  pageNum?: number;
  pageSize?: number;
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

  const raw = await invoke<unknown>('music_library_bilibili_search_resources', {
    keyword,
    pageNum,
    pageSize,
  });
  return ensureBilibiliFavoriteResourcePage(raw);
}

export async function searchNativeBilibiliResourceByBvid(
  bvid: string
): Promise<NativeBilibiliFavoriteResourceItem | null> {
  if (!isTauriRuntime()) return null;

  const normalizedBvid = bvid.trim();
  if (!normalizedBvid) return null;

  const raw = await invoke<unknown>('music_library_bilibili_search_resource_by_bvid', {
    bvid: normalizedBvid,
  }).catch(() => null);

  return ensureBilibiliFavoriteResourceItem(raw);
}

export async function prepareNativeBilibiliCoverCache(coverUrl: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;

  const normalizedCoverUrl = coverUrl.trim();
  if (!normalizedCoverUrl) return null;

  const raw = await invoke<unknown>('music_library_bilibili_prepare_cover_cache', {
    coverUrl: normalizedCoverUrl,
  });

  const cachePath = asTrimmedString(raw);
  return cachePath || null;
}

export async function listNativeBilibiliPlaybackQualities(
  sourceLocator: string
): Promise<NativeBilibiliPlaybackQualityOption[]> {
  if (!isTauriRuntime()) return [];

  const normalizedSourceLocator = sourceLocator.trim();
  if (!normalizedSourceLocator) return [];

  const raw = await invoke<unknown>('music_library_bilibili_list_playback_qualities', {
    sourceLocator: normalizedSourceLocator,
  });
  if (!Array.isArray(raw)) return [];

  const items: NativeBilibiliPlaybackQualityOption[] = [];
  for (const item of raw) {
    const parsed = ensureBilibiliPlaybackQualityOption(item);
    if (parsed) items.push(parsed);
  }
  return items;
}

export async function prepareNativeBilibiliCachedPlayback(
  sourceLocator: string,
  qualityHint?: string
): Promise<NativeBilibiliPlaybackPrepared | null> {
  if (!isTauriRuntime()) return null;

  const normalizedSourceLocator = sourceLocator.trim();
  if (!normalizedSourceLocator) return null;

  const normalizedQualityHint =
    typeof qualityHint === 'string' && qualityHint.trim().length > 0
      ? qualityHint.trim().toLowerCase()
      : undefined;

  const raw = await invoke<unknown>('music_library_bilibili_prepare_cached_playback', {
    sourceLocator: normalizedSourceLocator,
    qualityHint: normalizedQualityHint,
  });

  return ensureBilibiliPlaybackPrepared(raw);
}

export async function resolveNativeBilibiliLyricLocator(
  lyricLocator: string
): Promise<NativeBilibiliLyricLocatorRef | null> {
  if (!isTauriRuntime()) return null;

  const normalizedLocator = lyricLocator.trim();
  if (!normalizedLocator) return null;

  const raw = await invoke<unknown>('music_library_bilibili_resolve_lyric_locator', {
    lyricLocator: normalizedLocator,
  }).catch(() => null);
  return ensureBilibiliLyricLocatorRef(raw);
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
  await invoke('music_library_db_remove_source', { sourceId: normalized });
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

export async function queryNativeLibraryTracks(
  query?: NativeLibraryTrackQuery
): Promise<NativeLibraryTrackRecord[]> {
  if (!isTauriRuntime()) return [];

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
  };

  const raw = await invoke<unknown>('music_library_db_query_tracks', { query: payload }).catch(
    () => null
  );
  if (!Array.isArray(raw)) return [];

  const tracks: NativeLibraryTrackRecord[] = [];
  for (const item of raw) {
    const parsed = ensureTrackRecord(item);
    if (!parsed) continue;
    tracks.push(parsed);
  }
  return tracks;
}

export async function listNativeLibraryArtists(query?: NativeLibraryFacetQuery): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  const raw = await invoke<unknown>('music_library_db_list_artists', {
    query: normalizeFacetQuery(query),
  }).catch(() => null);

  if (!Array.isArray(raw)) return [];
  const artists: string[] = [];
  for (const item of raw) {
    const normalized = asTrimmedString(item);
    if (!normalized) continue;
    artists.push(normalized);
  }
  return artists;
}

export async function listNativeLibraryGenres(query?: NativeLibraryFacetQuery): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  const raw = await invoke<unknown>('music_library_db_list_genres', {
    query: normalizeFacetQuery(query),
  }).catch(() => null);

  if (!Array.isArray(raw)) return [];
  const genres: string[] = [];
  for (const item of raw) {
    const normalized = asTrimmedString(item);
    if (!normalized) continue;
    genres.push(normalized);
  }
  return genres;
}

export async function listNativeLibraryAlbums(
  query?: NativeLibraryFacetQuery
): Promise<NativeLibraryAlbumRecord[]> {
  if (!isTauriRuntime()) return [];
  const raw = await invoke<unknown>('music_library_db_list_albums', {
    query: normalizeFacetQuery(query),
  }).catch(() => null);

  if (!Array.isArray(raw)) return [];
  const albums: NativeLibraryAlbumRecord[] = [];
  for (const item of raw) {
    const parsed = ensureAlbumRecord(item);
    if (!parsed) continue;
    albums.push(parsed);
  }
  return albums;
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
