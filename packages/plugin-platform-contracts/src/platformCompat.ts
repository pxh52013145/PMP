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

export interface PlatformWorkspacePreparedPlayback {
  sourceLocator: string;
  streamUrl: string;
  cachePath: string;
  mimeType?: string;
  durationSeconds?: number;
  resourceId?: string;
  selectedQualityKey?: string;
  selectedQualityLabel?: string;
  contentKind?: string;
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
    recommendations?: string;
    search?: string;
    quality?: string;
    navigation?: string;
    settings?: string;
    pages?: string;
  };
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
