import type { MusicPlatformWorkspaceDescriptor } from './musicPlatformWorkspace';

export type PlatformCompatAvailability = 'available' | 'degraded' | 'unavailable';

export type PlatformCompatLoginMode = 'none' | 'cookie' | 'qr' | 'cookie+qr';

export type PlatformCompatRuntimeAuthState =
  | 'unauthorized'
  | 'pending'
  | 'authorized'
  | 'expired'
  | 'revoked'
  | 'error';

export type PlatformInstanceAuthState = 'empty' | 'authorizing' | 'authorized' | 'expired' | 'error';

export const PLATFORM_COMPAT_PMP_SUPPORTED_BINDINGS = {
  auth: 'host.pmp.connector-auth',
  library: 'host.pmp.platform-instance.library',
  recommendations: 'host.pmp.platform-instance.recommendations',
  search: 'host.pmp.platform-instance.search',
  quality: 'host.pmp.platform-instance.quality',
  pages: 'host.pmp.platform-instance.pages',
} as const;

export type PlatformCompatPmpSupportedBindingBucket =
  keyof typeof PLATFORM_COMPAT_PMP_SUPPORTED_BINDINGS;

export type PlatformCompatPmpSupportedBindingId =
  (typeof PLATFORM_COMPAT_PMP_SUPPORTED_BINDINGS)[PlatformCompatPmpSupportedBindingBucket];

export const PLATFORM_COMPAT_PMP_SUPPORTED_BINDING_IDS = Object.freeze(
  Object.values(PLATFORM_COMPAT_PMP_SUPPORTED_BINDINGS)
) as readonly PlatformCompatPmpSupportedBindingId[];

export function isPlatformCompatPmpSupportedBindingId(
  value: unknown
): value is PlatformCompatPmpSupportedBindingId {
  return (
    typeof value === 'string' &&
    PLATFORM_COMPAT_PMP_SUPPORTED_BINDING_IDS.includes(
      value as PlatformCompatPmpSupportedBindingId
    )
  );
}

export interface PlatformApiError {
  code:
    | 'AUTH_REQUIRED'
    | 'API_UNAVAILABLE'
    | 'RATE_LIMITED'
    | 'NETWORK_ERROR'
    | 'INVALID_RESPONSE'
    | 'UNSUPPORTED_CAPABILITY'
    | string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export type PlatformApiResult<T = unknown> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: PlatformApiError;
    };

export interface PlatformWorkspaceCollectionItem {
  collectionId: string;
  title: string;
  trackCount: number;
  coverUrl?: string;
  updatedAtMs?: number;
}

export interface PlatformWorkspaceCollectionListResult {
  items: PlatformWorkspaceCollectionItem[];
}

export interface PlatformWorkspaceResourceItem {
  resourceId: string;
  title: string;
  sourceLocator: string;
  durationSeconds?: number;
  coverUrl?: string;
  lyricLocator?: string;
  ownerName?: string;
  artistNames?: string;
  albumName?: string;
  webUrl?: string;
  vipRequired?: boolean;
  vipLabel?: string;
  qualityKey?: string;
  qualityLabel?: string;
  tagLabels?: string[];
  bvid?: string;
  cid?: string;
  contentKind?: string;
}

export interface PlatformWorkspaceResourcePage {
  sourceKind: string;
  sourceId: string;
  pageNum: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  items: PlatformWorkspaceResourceItem[];
}

export interface PlatformWorkspaceResolvedResourceResult {
  item: PlatformWorkspaceResourceItem | null;
}

export type PlatformConnectorId = `connector.platform.${string}`;

export type PlatformResourceKind =
  | 'song'
  | 'video'
  | 'album'
  | 'playlist'
  | 'podcast'
  | 'episode'
  | 'artist'
  | 'folder'
  | string;

export type PreparedPlaybackSchemaVersion = 'prepared-playback.v2';

export type PreparedPlaybackSourceKind =
  | 'cache-file'
  | 'remote-url'
  | 'host-proxy'
  | 'sidecar-proxy';

export type PreparedPlaybackSourceV2 =
  | {
      kind: 'cache-file';
      cachePath: string;
      mimeType?: string;
      contentLengthBytes?: number;
      checksum?: {
        algorithm: 'sha256' | 'md5' | string;
        value: string;
      };
    }
  | {
      kind: 'remote-url';
      streamUrl: string;
      method?: 'GET';
      headers?: Record<string, string>;
      referrer?: string;
      userAgent?: string;
      mimeType?: string;
      contentLengthBytes?: number;
      expiresAtMs?: number;
      seekable?: boolean;
      rangeRequests?: boolean;
    }
  | {
      kind: 'host-proxy';
      proxyStreamId: string;
      streamUrl?: string;
      mimeType?: string;
      contentLengthBytes?: number;
      expiresAtMs?: number;
      seekable?: boolean;
      rangeRequests?: boolean;
    }
  | {
      kind: 'sidecar-proxy';
      sidecarStreamId: string;
      streamUrl?: string;
      mimeType?: string;
      contentLengthBytes?: number;
      expiresAtMs?: number;
      seekable?: boolean;
      rangeRequests?: boolean;
    };

export interface PreparedPlaybackQualityV2 {
  requestedKey?: string;
  selectedKey?: string;
  selectedLabel?: string;
  bitrateKbps?: number;
  sampleRateHz?: number;
  bitDepth?: number;
  codec?: string;
  lossless?: boolean;
}

export interface PreparedPlaybackArtworkV2 {
  coverUrl?: string;
  coverCachePath?: string;
  coverAssetUrl?: string;
  dominantColor?: string;
}

export interface PreparedPlaybackLyricsV2 {
  lyricLocator?: string;
  lyricUrl?: string;
  lyricCachePath?: string;
  format?: 'lrc' | 'qrc' | 'ttml' | 'plain' | string;
  language?: string;
}

export interface PreparedPlaybackRightsV2 {
  playable: boolean;
  reason?:
    | 'vip-required'
    | 'region-restricted'
    | 'copyright-unavailable'
    | 'auth-required'
    | 'quality-unavailable'
    | 'provider-error'
    | string;
  message?: string;
  retryable?: boolean;
}

export interface PreparedPlaybackCachePolicyV2 {
  cacheKey?: string;
  scope: 'instance' | 'installation' | 'session';
  mode?: 'streaming-prefix' | 'full-track' | 'no-cache' | 'sidecar-managed';
  complete?: boolean;
  expiresAtMs?: number;
}

export interface PreparedPlaybackRefreshPolicyV2 {
  refreshable: boolean;
  refreshBeforeMs?: number;
  method?: 'preparePlayback' | 'refreshPreparedPlayback' | string;
}

export type PreparedPlaybackDiagnosticSeverityV2 = 'info' | 'warn' | 'error';

export interface PreparedPlaybackDiagnosticV2 {
  code: string;
  message: string;
  severity?: PreparedPlaybackDiagnosticSeverityV2;
  retryable?: boolean;
  details?: unknown;
}

export interface PreparedPlaybackV2 {
  schemaVersion: PreparedPlaybackSchemaVersion;
  preparedId: string;
  connectorId: PlatformConnectorId;
  instanceId: string;
  sourceLocator: string;
  resourceId?: string;
  resourceKind?: PlatformResourceKind;
  title?: string;
  artistNames?: string;
  albumName?: string;
  durationSeconds?: number;
  source: PreparedPlaybackSourceV2;
  quality?: PreparedPlaybackQualityV2;
  artwork?: PreparedPlaybackArtworkV2;
  lyrics?: PreparedPlaybackLyricsV2;
  rights?: PreparedPlaybackRightsV2;
  cache?: PreparedPlaybackCachePolicyV2;
  refresh?: PreparedPlaybackRefreshPolicyV2;
  diagnostics?: PreparedPlaybackDiagnosticV2[];
  providerMetadata?: Record<string, unknown>;
}

export interface PlatformWorkspacePreparedPlayback {
  schemaVersion?: PreparedPlaybackSchemaVersion;
  preparedId?: string;
  connectorId?: PlatformConnectorId | string;
  instanceId?: string;
  sourceLocator: string;
  source?: PreparedPlaybackSourceV2;
  streamUrl?: string;
  cachePath?: string;
  mimeType?: string;
  headers?: Record<string, string>;
  expiresAtMs?: number;
  seekable?: boolean;
  rangeRequests?: boolean;
  durationSeconds?: number;
  resourceId?: string;
  resourceKind?: PlatformResourceKind;
  selectedQualityKey?: string;
  selectedQualityLabel?: string;
  contentKind?: string;
  quality?: PreparedPlaybackQualityV2;
  artwork?: PreparedPlaybackArtworkV2;
  lyrics?: PreparedPlaybackLyricsV2;
  rights?: PreparedPlaybackRightsV2;
  cache?: PreparedPlaybackCachePolicyV2;
  refresh?: PreparedPlaybackRefreshPolicyV2;
  diagnostics?: PreparedPlaybackDiagnosticV2[];
  providerMetadata?: Record<string, unknown>;
}

export interface PlatformWorkspaceQualityOption {
  key: string;
  label: string;
  available: boolean;
}

export interface PlatformWorkspaceQualityOptionListResult {
  options: PlatformWorkspaceQualityOption[];
}

export interface PlatformWorkspaceQualityState {
  options: PlatformWorkspaceQualityOption[];
  currentKey: string;
  currentLabel?: string;
}

export interface PlatformWorkspaceLyricLocatorResolved {
  locator: string;
  format: string;
  lang?: string;
  sourceKind: string;
}

export interface PlatformWorkspaceCoverAsset {
  assetUrl?: string;
  cachePath?: string;
  path?: string;
  url?: string;
}

export interface PlatformWorkspaceFeatureFlags {
  collections: boolean;
  recommendations: boolean;
  search: boolean;
  quality: boolean;
  favorites?: boolean;
  playlist?: boolean;
  history?: boolean;
  lyrics?: boolean;
  covers?: boolean;
  prepare?: boolean;
}

export interface PlatformWorkspacePageItem {
  pageId: string;
  kind: string;
  title: string;
  enabled: boolean;
  subtitle?: string;
  badgeLabel?: string;
  iconKey?: string;
}

export interface PlatformWorkspacePageListResult {
  items: PlatformWorkspacePageItem[];
}

export interface PlatformWorkspacePageModel {
  features: PlatformWorkspaceFeatureFlags;
  defaultPageId?: string;
  pages: PlatformWorkspacePageItem[];
}

export interface PlatformCompatCapabilityMap {
  playlists: boolean;
  favorites: boolean;
  dailyRecommendations: boolean;
  search: boolean;
  quality: boolean;
  navigation: boolean;
  settings: boolean;
  pages: boolean;
  history?: boolean;
  lyrics?: boolean;
  covers?: boolean;
  prepare?: boolean;
}

export const PLATFORM_API_BUCKET_IDS = [
  'auth',
  'library',
  'favorites',
  'playlist',
  'recommendations',
  'search',
  'quality',
  'lyrics',
  'covers',
  'history',
  'user-actions',
  'settings',
  'pages',
  'prepare',
] as const;

export type PlatformApiBucketId =
  | (typeof PLATFORM_API_BUCKET_IDS)[number]
  | string;

export const PLATFORM_API_BUCKET_CANONICAL_METHODS = {
  favorites: ['listCollections', 'listResources', 'addResource', 'removeResource'],
  playlist: [
    'listCollections',
    'listResources',
    'createPlaylist',
    'deletePlaylist',
    'renamePlaylist',
    'addResource',
    'removeResource',
    'reorderResources',
  ],
  history: ['listResources', 'recordPlayback', 'syncRecent', 'clearHistory'],
  prepare: ['preparePlayback', 'refreshPreparedPlayback', 'validatePreparedPlayback'],
} as const;

export type PlatformApiBucketCapabilityState =
  | 'unsupported'
  | 'read-only'
  | 'read-write'
  | 'degraded'
  | 'requires-auth'
  | 'requires-sidecar';

export type PlatformApiMethodRequirement = 'none' | 'optional' | 'required';

export type PlatformApiMutationConsistency = 'immediate' | 'eventual' | 'unknown';

export type PlatformApiMutationRollbackSupport = 'supported' | 'unsupported' | 'unknown';

export type PlatformApiMutationDuplicateBehavior =
  | 'allow'
  | 'ignore'
  | 'replace'
  | 'error'
  | 'unknown';

export type PlatformApiMutationConflictBehavior =
  | 'last-write-wins'
  | 'provider-defined'
  | 'error'
  | 'unknown';

export interface PlatformApiBucketMethodCapability {
  required?: boolean;
  state?: PlatformApiBucketCapabilityState;
  auth?: PlatformApiMethodRequirement;
  sidecar?: PlatformApiMethodRequirement;
  consistency?: PlatformApiMutationConsistency;
  rollback?: PlatformApiMutationRollbackSupport;
  duplicateBehavior?: PlatformApiMutationDuplicateBehavior;
  conflictBehavior?: PlatformApiMutationConflictBehavior;
  inputModel?: string;
  outputModel?: string;
  errors?: string[];
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface PlatformApiBucketConstraints {
  supportsMultipleFavoriteCollections?: boolean;
  requiresResourceResolveBeforeMutation?: boolean;
  mutationConsistency?: PlatformApiMutationConsistency;
  rollback?: PlatformApiMutationRollbackSupport;
  duplicateBehavior?: PlatformApiMutationDuplicateBehavior;
  conflictBehavior?: PlatformApiMutationConflictBehavior;
  [key: string]: unknown;
}

export interface PlatformApiBucketCapabilityDescriptor {
  state: PlatformApiBucketCapabilityState;
  methods?: Record<string, PlatformApiBucketMethodCapability>;
  constraints?: PlatformApiBucketConstraints;
  degradedReason?: string;
  requiresAuth?: boolean;
  requiresSidecar?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PlatformApiBucketCapabilitySchema {
  [bucketId: string]: PlatformApiBucketCapabilityDescriptor | undefined;
  auth?: PlatformApiBucketCapabilityDescriptor;
  library?: PlatformApiBucketCapabilityDescriptor;
  favorites?: PlatformApiBucketCapabilityDescriptor;
  playlist?: PlatformApiBucketCapabilityDescriptor;
  recommendations?: PlatformApiBucketCapabilityDescriptor;
  search?: PlatformApiBucketCapabilityDescriptor;
  quality?: PlatformApiBucketCapabilityDescriptor;
  lyrics?: PlatformApiBucketCapabilityDescriptor;
  covers?: PlatformApiBucketCapabilityDescriptor;
  history?: PlatformApiBucketCapabilityDescriptor;
  'user-actions'?: PlatformApiBucketCapabilityDescriptor;
  settings?: PlatformApiBucketCapabilityDescriptor;
  pages?: PlatformApiBucketCapabilityDescriptor;
  prepare?: PlatformApiBucketCapabilityDescriptor;
}

export interface PlatformCompatContractFile {
  contractVersion: '1.0';
  platform: {
    platformId: string;
    displayName: string;
    staticIcon: string;
    vendor?: string;
    supportsMultiInstance: boolean;
  };
  auth: {
    loginMode: PlatformCompatLoginMode;
    requiresCookie: boolean;
    requiresAccountId: boolean;
    supportsRefresh: boolean;
  };
  capabilities: PlatformCompatCapabilityMap;
  apiBindings: {
    auth: string;
    library?: string;
    favorites?: string;
    playlist?: string;
    recommendations?: string;
    search?: string;
    quality?: string;
    lyrics?: string;
    covers?: string;
    history?: string;
    navigation?: string;
    settings?: string;
    pages?: string;
    prepare?: string;
  };
  api?: PlatformApiBucketCapabilitySchema;
  workspace?: MusicPlatformWorkspaceDescriptor;
  extension?: Record<string, unknown>;
}

export interface PlatformCompatRuntimeLibraryApi {
  listCollections?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspaceCollectionListResult>
  >;
  listResources?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspaceResourcePage | null>
  >;
  listPlaylistTracks?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspaceResourcePage | null>
  >;
  createPlaylist?: (input: Record<string, unknown>) => Promise<PlatformApiResult<unknown>>;
  deletePlaylist?: (input: Record<string, unknown>) => Promise<PlatformApiResult<unknown>>;
  addTrackToPlaylist?: (input: Record<string, unknown>) => Promise<PlatformApiResult<unknown>>;
  removeTrackFromPlaylist?: (input: Record<string, unknown>) => Promise<PlatformApiResult<unknown>>;
  preparePlayback?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspacePreparedPlayback | null>
  >;
  resolveLyricLocator?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspaceLyricLocatorResolved | null>
  >;
  resolveCoverAssetUrl?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<string | PlatformWorkspaceCoverAsset | null>
  >;
}

export interface PlatformCompatRuntimeRecommendationsApi {
  listDaily?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspaceResourcePage | null>
  >;
  listRecommendedSongs?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspaceResourcePage | null>
  >;
  listRecommendedPlaylists?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspaceCollectionListResult>
  >;
}

export interface PlatformCompatRuntimeSearchApi {
  query?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspaceResourcePage | null>
  >;
  resolveLocator?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspaceResolvedResourceResult>
  >;
  preparePlayback?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspacePreparedPlayback | null>
  >;
}

export interface PlatformCompatRuntimeQualityApi {
  listOptions?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspaceQualityState | PlatformWorkspaceQualityOptionListResult | null>
  >;
  getCurrent?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspaceQualityState | null>
  >;
  setPreferred?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspaceQualityState | null>
  >;
}

export interface PlatformCompatRuntimeNavigationApi {
  [method: string]:
    | ((input: Record<string, unknown>) => Promise<PlatformApiResult<unknown>>)
    | undefined;
}

export interface PlatformCompatRuntimeSettingsApi {
  get?: (input: Record<string, unknown>) => Promise<PlatformApiResult<unknown>>;
  set?: (input: Record<string, unknown>) => Promise<PlatformApiResult<unknown>>;
  reset?: (input: Record<string, unknown>) => Promise<PlatformApiResult<unknown>>;
  [method: string]:
    | ((input: Record<string, unknown>) => Promise<PlatformApiResult<unknown>>)
    | undefined;
}

export interface PlatformCompatRuntimePagesApi {
  getWorkspaceModel?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspacePageModel | null>
  >;
  listPages?: (input: Record<string, unknown>) => Promise<
    PlatformApiResult<PlatformWorkspacePageListResult>
  >;
}

export interface PlatformCompatRuntimeApi {
  auth?: {
    getSnapshot?: (input: { instanceId: string }) => Promise<
      PlatformApiResult<{
        authState: PlatformCompatRuntimeAuthState;
        accountId?: string;
        accountName?: string;
        updatedAtMs?: number;
        expiresAtMs?: number;
        availability?: PlatformCompatAvailability;
        availabilityMessage?: string;
        metadata?: Record<string, unknown>;
      }>
    >;
    refreshSnapshot?: (input: { instanceId: string }) => Promise<
      PlatformApiResult<{
        authState: PlatformCompatRuntimeAuthState;
        accountId?: string;
        accountName?: string;
        updatedAtMs?: number;
        expiresAtMs?: number;
        availability?: PlatformCompatAvailability;
        availabilityMessage?: string;
        metadata?: Record<string, unknown>;
      }>
    >;
    beginQrLogin?: (input: { instanceId: string }) => Promise<
      PlatformApiResult<{
        sessionId: string;
        qrcodeKey: string;
        qrUrl: string;
        qrImageDataUrl: string;
        generatedAtMs: number;
        expiresAtMs: number;
      }>
    >;
    pollQrLogin?: (input: { instanceId: string; sessionId: string }) => Promise<
      PlatformApiResult<{
        sessionId: string;
        state: string;
        stateCode: number;
        stateMessage: string;
        authState: PlatformCompatRuntimeAuthState;
        accountId?: string;
        expiresAtMs?: number;
        metadata?: Record<string, unknown>;
      }>
    >;
    logout?: (input: { instanceId: string }) => Promise<
      PlatformApiResult<{
        authState: PlatformCompatRuntimeAuthState;
        accountId?: string;
        accountName?: string;
        updatedAtMs?: number;
        expiresAtMs?: number;
        availability?: PlatformCompatAvailability;
        availabilityMessage?: string;
        metadata?: Record<string, unknown>;
      }>
    >;
    clearAuthCookies?: (input: { instanceId: string }) => Promise<
      PlatformApiResult<{
        authState: PlatformCompatRuntimeAuthState;
        accountId?: string;
        accountName?: string;
        updatedAtMs?: number;
        expiresAtMs?: number;
        availability?: PlatformCompatAvailability;
        availabilityMessage?: string;
        metadata?: Record<string, unknown>;
      }>
    >;
  };
  library?: PlatformCompatRuntimeLibraryApi;
  recommendations?: PlatformCompatRuntimeRecommendationsApi;
  search?: PlatformCompatRuntimeSearchApi;
  quality?: PlatformCompatRuntimeQualityApi;
  navigation?: PlatformCompatRuntimeNavigationApi;
  settings?: PlatformCompatRuntimeSettingsApi;
  pages?: PlatformCompatRuntimePagesApi;
  metadata?: Record<string, unknown>;
}

export interface PlatformInstanceRecord {
  instanceId: string;
  platformId: string;
  instanceLabel: string;
  displayName: string;
  staticIcon: string;
  account: {
    accountId?: string;
    accountName?: string;
  };
  auth: {
    status: PlatformInstanceAuthState;
    cookieRef?: string;
    cookieUpdatedAtMs?: number;
  };
  capabilities: PlatformCompatCapabilityMap;
  registrations: {
    navigationIds: string[];
    settingsIds: string[];
    pageIds: string[];
  };
  availability: PlatformCompatAvailability;
  availabilityMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface PlatformRenderSelectionRecord {
  instanceId: string;
  mounted: boolean;
  mountedAtMs?: number;
  order?: number;
  metadata?: Record<string, unknown>;
}
