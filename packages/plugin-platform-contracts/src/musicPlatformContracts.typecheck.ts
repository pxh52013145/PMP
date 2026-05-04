import type { MusicPlatformWorkspaceDescriptor } from './musicPlatformWorkspace';
import type {
  PlatformApiBucketCapabilitySchema,
  PlatformCompatContractFile,
  PlatformWorkspacePreparedPlayback,
  PreparedPlaybackV2,
} from './platformCompat';

export type AssertTrue<T extends true> = T;

export type PreparedPlaybackV2FitsWorkspacePreparedPlayback = AssertTrue<
  PreparedPlaybackV2 extends PlatformWorkspacePreparedPlayback ? true : false
>;

export const legacyPreparedPlaybackContractCheck = {
  sourceLocator: 'provider://legacy-track/1',
  streamUrl: 'https://media.example.test/track.flac',
  cachePath: 'C:\\pmp-cache\\legacy-track.flac',
  mimeType: 'audio/flac',
  durationSeconds: 181,
  resourceId: 'legacy-track-1',
  selectedQualityKey: 'lossless',
  selectedQualityLabel: 'Lossless',
} satisfies PlatformWorkspacePreparedPlayback;

export const preparedPlaybackV2ContractCheck = {
  schemaVersion: 'prepared-playback.v2',
  preparedId: 'prepared-example-1',
  connectorId: 'connector.platform.example',
  instanceId: 'instance-example-1',
  sourceLocator: 'provider://song/123',
  resourceId: '123',
  resourceKind: 'song',
  title: 'Example Song',
  artistNames: 'Example Artist',
  albumName: 'Example Album',
  durationSeconds: 181,
  source: {
    kind: 'remote-url',
    streamUrl: 'https://media.example.test/song/123.flac',
    method: 'GET',
    headers: {
      Referer: 'https://example.test',
    },
    mimeType: 'audio/flac',
    expiresAtMs: 4_102_444_800_000,
    seekable: true,
    rangeRequests: true,
  },
  quality: {
    requestedKey: 'lossless',
    selectedKey: 'lossless',
    selectedLabel: 'Lossless',
    codec: 'flac',
    lossless: true,
  },
  rights: {
    playable: true,
  },
  cache: {
    scope: 'instance',
    mode: 'streaming-prefix',
    cacheKey: 'instance-example-1/provider/song/123/lossless',
    complete: false,
  },
  refresh: {
    refreshable: true,
    refreshBeforeMs: 60_000,
    method: 'refreshPreparedPlayback',
  },
} satisfies PreparedPlaybackV2;

export const workspaceTemplateContractCheck = {
  ownership: 'pack',
  requiredRuntimeCarrier: 'webview-frame',
  template: {
    id: 'music-generic-workspace',
    variant: 'library-first',
    personalization: {
      accent: 'manifest.connector.accentColor',
      icon: 'manifest.entry.icon',
      defaultPageId: 'home',
      resourceLayout: 'dense-list',
      preferQualitySelector: true,
    },
  },
  root: {
    viewId: 'example.workspace.root',
    viewType: 'music-platform.workspace-root',
  },
} satisfies MusicPlatformWorkspaceDescriptor;

export const bucketMethodCapabilityContractCheck = {
  favorites: {
    state: 'read-write',
    methods: {
      listCollections: {
        required: false,
        state: 'read-only',
      },
      addResource: {
        required: false,
        state: 'read-write',
        auth: 'required',
        consistency: 'eventual',
      },
      removeResource: {
        required: false,
        state: 'read-write',
        auth: 'required',
        consistency: 'eventual',
      },
    },
    constraints: {
      supportsMultipleFavoriteCollections: true,
      requiresResourceResolveBeforeMutation: false,
      mutationConsistency: 'eventual',
    },
  },
  playlist: {
    state: 'read-write',
    methods: {
      listCollections: { state: 'read-only' },
      addResource: {
        state: 'read-write',
        auth: 'required',
        duplicateBehavior: 'ignore',
      },
      reorderResources: {
        state: 'read-write',
        auth: 'required',
        consistency: 'eventual',
      },
    },
  },
  history: {
    state: 'read-write',
    methods: {
      listResources: { state: 'read-only' },
      recordPlayback: {
        state: 'read-write',
        auth: 'optional',
        consistency: 'eventual',
      },
    },
  },
} satisfies PlatformApiBucketCapabilitySchema;

export const platformCompatContractV2FieldsCheck = {
  contractVersion: '1.0',
  platform: {
    platformId: 'platform.example',
    displayName: 'Example',
    staticIcon: 'icon.png',
    supportsMultiInstance: true,
  },
  auth: {
    loginMode: 'qr',
    requiresCookie: false,
    requiresAccountId: false,
    supportsRefresh: true,
  },
  capabilities: {
    playlists: true,
    favorites: true,
    dailyRecommendations: false,
    search: true,
    quality: true,
    navigation: true,
    settings: true,
    pages: true,
    history: true,
    prepare: true,
  },
  apiBindings: {
    auth: 'host.pmp.connector-auth',
    search: 'host.pmp.music-platform.search',
    prepare: 'host.pmp.music-platform.prepare',
  },
  api: bucketMethodCapabilityContractCheck,
  workspace: workspaceTemplateContractCheck,
} satisfies PlatformCompatContractFile;
