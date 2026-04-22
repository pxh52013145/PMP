import { afterEach, describe, expect, it, vi } from 'vitest';

const durableTextState = new Map<string, string>();
const pluginWindowMocks = vi.hoisted(() => ({
  openPluginWindow: vi.fn(async () => {}),
  closePluginWindow: vi.fn(async () => {}),
}));

vi.mock('../../utils/pluginWindows', () => ({
  openPluginWindow: pluginWindowMocks.openPluginWindow,
  closePluginWindow: pluginWindowMocks.closePluginWindow,
}));

vi.mock('../../modules/music-platform', async () => {
  const actual = await vi.importActual<typeof import('../../modules/music-platform')>(
    '../../modules/music-platform'
  );

  return {
    ...actual,
    listPlatformConnectorDefinitions: vi.fn(() => [
      {
        connectorId: 'connector.platform.bilibili',
        displayName: 'Bilibili',
        labelKey: 'magnet.platform-login.platform.bilibili',
        iconKey: 'bilibili',
        enabled: true,
        authFlow: 'qr',
        workspaceKind: 'bilibili',
        workspaceMode: 'dedicated',
        sortOrder: 10,
      },
    ]),
    listPlatformInstanceAuthSnapshots: vi.fn(async () => [
      {
        instanceId: 'bilibili:builtin',
        platformId: 'bilibili',
        connectorId: 'connector.platform.bilibili',
        displayName: 'Bilibili',
        authState: 'authorized',
        accountUid: 'uid-1',
      },
    ]),
    refreshPlatformInstanceAuthSnapshot: vi.fn(async (instanceId: string) => ({
      instanceId,
      platformId: 'bilibili',
      connectorId: 'connector.platform.bilibili',
      displayName: 'Bilibili',
      authState: 'authorized',
      accountUid: 'uid-1',
    })),
    getPlatformInstanceAuthSnapshot: vi.fn((instanceId: string) => ({
      instanceId,
      platformId: 'bilibili',
      connectorId: 'connector.platform.bilibili',
      displayName: 'Bilibili',
      authState: 'authorized',
      accountUid: 'uid-1',
    })),
    resolvePlatformInstanceId: vi.fn(
      ({ instanceId, connectorId }: { instanceId?: string; connectorId?: string }) =>
        instanceId || (connectorId ? 'bilibili:builtin' : null)
    ),
    listPlatformConnectorAuthSnapshots: vi.fn(async () => [
      {
        connectorId: 'connector.platform.bilibili',
        displayName: 'Bilibili',
        authState: 'authorized',
        accountUid: 'uid-1',
      },
    ]),
    getPlatformConnectorAuthSnapshot: vi.fn(async (connectorId: string) => ({
      connectorId,
      displayName: 'Bilibili',
      authState: 'authorized',
      accountUid: 'uid-1',
    })),
    beginPlatformQrLogin: vi.fn(async (connectorId: string) => ({
      connectorId,
      sessionId: 'session-1',
      qrcodeKey: 'qr-key',
      qrUrl: 'https://example.test/qr',
      qrImageDataUrl: 'data:image/png;base64,xxx',
      generatedAtMs: 1_710_000_000_000,
      expiresAtMs: 1_710_000_060_000,
    })),
    pollPlatformQrLogin: vi.fn(async (connectorId: string, sessionId: string) => ({
      connectorId,
      sessionId,
      state: 'authorized',
      stateCode: 0,
      stateMessage: 'Authorized',
      authState: 'authorized',
      accountUid: 'uid-1',
    })),
    logoutPlatformConnector: vi.fn(async (connectorId: string) => ({
      connectorId,
      displayName: 'Bilibili',
      authState: 'unauthorized',
    })),
    beginPlatformInstanceQrLogin: vi.fn(async (instanceId: string) => ({
      instanceId,
      platformId: 'bilibili',
      connectorId: 'connector.platform.bilibili',
      sessionId: 'session-1',
      qrcodeKey: 'qr-key',
      qrUrl: 'https://example.test/qr',
      qrImageDataUrl: 'data:image/png;base64,xxx',
      generatedAtMs: 1_710_000_000_000,
      expiresAtMs: 1_710_000_060_000,
    })),
    pollPlatformInstanceQrLogin: vi.fn(async (instanceId: string, sessionId: string) => ({
      instanceId,
      platformId: 'bilibili',
      connectorId: 'connector.platform.bilibili',
      sessionId,
      state: 'authorized',
      stateCode: 0,
      stateMessage: 'Authorized',
      authState: 'authorized',
      accountUid: 'uid-1',
    })),
    logoutPlatformInstance: vi.fn(async (instanceId: string) => ({
      instanceId,
      platformId: 'bilibili',
      connectorId: 'connector.platform.bilibili',
      displayName: 'Bilibili',
      authState: 'unauthorized',
    })),
    clearPlatformInstanceAuthCookies: vi.fn(async (instanceId: string) => ({
      instanceId,
      platformId: 'bilibili',
      connectorId: 'connector.platform.bilibili',
      displayName: 'Bilibili',
      authState: 'unauthorized',
    })),
    listPlatformConnectorFacadeItems: vi.fn(async () => [
      {
        connectorId: 'connector.platform.bilibili',
        displayName: 'Bilibili',
        authState: 'authorized',
        sourceIds: ['virtual::connector.platform.bilibili'],
        sources: [],
        capabilities: {
          canSearchTracks: true,
          canSearchAlbums: false,
          canListPlaylists: true,
          canEditPlaylists: false,
          canFetchLyrics: true,
          canFetchCovers: true,
          canResolveStream: false,
          canRunIncrementalSync: false,
        },
      },
    ]),
    searchPlatformTracks: vi.fn(async (options: { query: string; connectorIds?: string[] }) => ({
      connectorViews: [
        {
          connectorId: 'connector.platform.bilibili',
          displayName: 'Bilibili',
          authState: 'authorized',
          sourceIds: ['virtual::connector.platform.bilibili'],
          sources: [],
          capabilities: {
            canSearchTracks: true,
            canSearchAlbums: false,
            canListPlaylists: true,
            canEditPlaylists: false,
            canFetchLyrics: true,
            canFetchCovers: true,
            canResolveStream: false,
            canRunIncrementalSync: false,
          },
        },
      ],
      tracks: [
        {
          trackId: `track:${options.query}`,
          sourceId: 'virtual::connector.platform.bilibili',
          connectorId:
            Array.isArray(options.connectorIds) && options.connectorIds[0]
              ? options.connectorIds[0]
              : 'connector.platform.bilibili',
          title: `Result for ${options.query}`,
          availability: 'available',
          sourceLocator: 'bilibili://BV1-test',
        },
      ],
    })),
    preparePlatformPlayback: vi.fn(
      async (options: {
        sourceLocator: string;
        connectorId?: string;
        qualityHint?: string;
        instanceId?: string;
      }) => {
        if (options.connectorId === 'connector.platform.netease') {
          return {
            connectorId: 'connector.platform.netease',
            prepared: {
              sourceLocator: options.sourceLocator,
              streamUrl: 'https://example.test/netease-stream',
              cachePath: '/cache/netease-track',
              songId: 'song-1',
            },
          };
        }

        return {
          connectorId: options.connectorId ?? 'connector.platform.bilibili',
          prepared: {
            sourceLocator: options.sourceLocator,
            streamUrl: 'https://example.test/bilibili-stream',
            cachePath: '/cache/bilibili-track',
            contentKind: 'video',
            selectedQualityKey: options.qualityHint ?? 'auto',
            selectedQualityLabel: options.qualityHint ?? 'Auto',
          },
        };
      }
    ),
    getPlatformWorkspacePageModel: vi.fn(
      async (options: { connectorId: string; instanceId?: string | null }) => ({
        features: {
          collections: true,
          recommendations: true,
          search: true,
          quality: true,
        },
        defaultPageId: 'recommended',
        pages: [
          {
            pageId: 'recommended',
            kind: 'recommended',
            title: `${options.connectorId} Recommended`,
            enabled: true,
          },
          {
            pageId: 'instance',
            kind: 'workspace',
            title: `${options.instanceId ?? 'builtin'} Library`,
            enabled: true,
          },
        ],
      })
    ),
    listPlatformWorkspacePages: vi.fn(
      async (options: { connectorId: string; instanceId?: string | null }) => [
        {
          pageId: 'recommended',
          kind: 'recommended',
          title: `${options.connectorId} Recommended`,
          enabled: true,
        },
        {
          pageId: 'instance',
          kind: 'workspace',
          title: `${options.instanceId ?? 'builtin'} Library`,
          enabled: true,
        },
      ]
    ),
    listPlatformWorkspaceCollections: vi.fn(
      async (options: { connectorId: string; instanceId?: string | null }) => [
        {
          collectionId: `${options.connectorId}:favorites`,
          title: `${options.instanceId ?? 'builtin'} Favorites`,
          trackCount: 12,
        },
      ]
    ),
    listPlatformWorkspaceCollectionResources: vi.fn(
      async (options: { connectorId: string; collectionId: string; instanceId?: string | null }) => ({
        sourceKind: 'playlist',
        sourceId: options.collectionId,
        pageNum: 1,
        pageSize: 1,
        total: 1,
        hasMore: false,
        items: [
          {
            resourceId: `${options.collectionId}:track-1`,
            title: `${options.connectorId} Collection Track`,
            sourceLocator: 'netease://song/collection-track-1',
          },
        ],
      })
    ),
    listPlatformWorkspaceRecommendedCollections: vi.fn(
      async (options: { connectorId: string }) => [
        {
          collectionId: `${options.connectorId}:daily-playlists`,
          title: 'Daily Playlists',
          trackCount: 8,
        },
      ]
    ),
    listPlatformWorkspaceRecommendedResources: vi.fn(
      async (options: { connectorId: string }) => ({
        sourceKind: 'recommended',
        sourceId: `${options.connectorId}:daily`,
        pageNum: 1,
        pageSize: 1,
        total: 1,
        hasMore: false,
        items: [
          {
            resourceId: 'daily-track-1',
            title: `${options.connectorId} Daily Track`,
            sourceLocator: 'netease://song/daily-track-1',
          },
        ],
      })
    ),
    searchPlatformWorkspaceResources: vi.fn(
      async (options: { connectorId: string; keyword: string }) => ({
        sourceKind: 'search',
        sourceId: options.keyword,
        pageNum: 1,
        pageSize: 1,
        total: 1,
        hasMore: false,
        items: [
          {
            resourceId: `search:${options.keyword}`,
            title: `${options.connectorId} Search Result`,
            sourceLocator: 'netease://song/search-track-1',
          },
        ],
      })
    ),
    preparePlatformWorkspacePlayback: vi.fn(
      async (options: { connectorId: string; sourceLocator: string; qualityHint?: string }) => ({
        sourceLocator: options.sourceLocator,
        streamUrl: `https://example.test/${options.connectorId}/workspace-stream`,
        cachePath: `/cache/${options.connectorId}/workspace-track`,
        selectedQualityKey: options.qualityHint ?? 'auto',
        selectedQualityLabel: options.qualityHint ?? 'Auto',
      })
    ),
    listPlatformWorkspaceQualityState: vi.fn(
      async (_options: { connectorId: string; sourceLocator?: string | null }) => ({
        currentKey: 'lossless',
        currentLabel: 'Lossless',
        options: [
          { key: 'auto', label: 'Auto', available: true },
          { key: 'lossless', label: 'Lossless', available: true },
        ],
      })
    ),
    setPlatformWorkspaceQualityPreference: vi.fn(
      async (options: { qualityKey: string }) => ({
        currentKey: options.qualityKey,
        currentLabel: options.qualityKey.toUpperCase(),
        options: [
          { key: 'auto', label: 'Auto', available: true },
          { key: options.qualityKey, label: options.qualityKey.toUpperCase(), available: true },
        ],
      })
    ),
    resolvePlatformWorkspaceCoverAssetUrl: vi.fn(
      async (options: { coverUrl?: string | null }) =>
        options.coverUrl ? `asset://${options.coverUrl.replace(/^https?:\/\//, '')}` : undefined
    ),
  };
});

vi.mock('../../modules/music-library', async () => {
  const actual = await vi.importActual<typeof import('../../modules/music-library')>(
    '../../modules/music-library'
  );

  return {
    ...actual,
    listNativeLibraryTrackFieldCatalog: vi.fn(async () => [
      {
        field: 'artist',
        label: 'Artist',
        kind: 'text',
        trackKey: 'artist',
        columnName: 'artist',
        sourceTable: 'local_tracks',
        declaredType: 'TEXT',
        nullable: false,
        filterable: true,
        sortable: true,
        groupable: true,
        facetable: true,
        nativeFilterField: 'artist',
        nativeSortField: 'artist',
      },
    ]),
    listNativeLibraryFacetCatalog: vi.fn(async () => [
      {
        id: 'artist',
        field: 'artist',
        label: 'Artist',
        kind: 'text-values',
        nativeField: 'artist',
      },
    ]),
    listNativeLibraryFacetEntries: vi.fn(async (query?: { kind?: string }) => {
      if (query?.kind === 'album-summaries') {
        return {
          kind: 'album-summaries' as const,
          albums: [
            {
              album: 'Album A',
              artist: 'Artist A',
              coverTrackId: 'track-1',
              coverTrackPath: '/music/track-1.mp3',
            },
          ],
        };
      }

      return {
        kind: 'text-values' as const,
        textValues: ['Artist A', 'Artist B'],
      };
    }),
    listNativeLibraryTextFacetValues: vi.fn(async () => ['Artist A', 'Artist B']),
  };
});

vi.mock('../../modules/storage', async () => {
  const actual =
    await vi.importActual<typeof import('../../modules/storage')>('../../modules/storage');

  return {
    ...actual,
    readDurableText: vi.fn(
      async (_namespace: string, id: string) => durableTextState.get(id) ?? null
    ),
    writeDurableText: vi.fn(async (_namespace: string, id: string, value: string) => {
      durableTextState.set(id, value);
      return true;
    }),
    removeDurableText: vi.fn(async (_namespace: string, id: string) => {
      durableTextState.delete(id);
    }),
  };
});

import * as musicLibraryModule from '../../modules/music-library';
import * as musicPlatformModule from '../../modules/music-platform';
import * as storageModule from '../../modules/storage';
import type { CommandContribution } from '../../contracts/contributions';
import { DEFAULT_TELEMETRY_POLICY, type TelemetryRecord } from '../../contracts/telemetry';
import { setLocale } from '../../i18n/core';
import { clearMagnetRenderers, registerMagnetRenderer } from '../../magnet-system/registry';
import { clearMagnetVariants, registerMagnetVariant } from '../../magnet-system/variantRegistry';
import type { CommandsService } from '../../services/commands';
import type { KeybindingsService } from '../../services/keybindings';
import {
  setGlobalTelemetryService,
  type TelemetryLogger,
  type TelemetryRecordInput,
  type TelemetryService,
  type TelemetrySnapshot,
  type TelemetrySpan,
  type TelemetrySpanStartOptions,
} from '../../services/telemetry';
import { DEFAULT_THEME } from '../../themes/runtimeTheme';
import {
  configureAudioInputAdapterGovernance,
  createPluginMountApi,
  getPmpHostCapabilityPackDescriptor,
  listPmpHostCapabilityFamilies,
  listPluginHostCapabilities,
  registerAudioInputAdapterProvider,
} from './pluginHostApi';
import type { HostAudioService, HostNavigation, PluginHostTrayApi } from './pluginHostApi';
import { clearExtensionConfig, getExtensionConfigKey } from './pluginConfig';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

const TEST_PLUGIN_ID = 'host-pmp-capability-test';

function createAudioServiceStub(overrides: Partial<HostAudioService> = {}): HostAudioService {
  return {
    getState: () => ({
      currentTrack: {
        id: 'track-1',
        title: 'Track 1',
      },
      playMode: 'sequence',
    }),
    onStateChange: () => () => {},
    onTimeUpdate: () => () => {},
    onEnded: () => () => {},
    onLoadProgress: () => () => {},
    onError: () => () => {},
    play: async () => {},
    pause: async () => {},
    stop: () => {},
    seek: () => {},
    setVolume: () => {},
    toggleMute: () => {},
    getPlayMode: () => 'sequence',
    setPlayMode: () => {},
    getFrequencyData: () => new Uint8Array([1, 2, 3]),
    getSpectrumFrame: (tap) => ({
      frameId: 1,
      timestampMs: 1_710_000_000_000,
      tap: tap ?? 'post-dsp',
      sampleRate: 48_000,
      bins: new Uint8Array([1, 2, 3]),
    }),
    listAudioInputs: () => ['symphonia'],
    ...overrides,
  };
}

function createNavigationStub(overrides: Partial<HostNavigation> = {}): HostNavigation {
  return {
    navigateTo: () => {},
    goBack: () => {},
    getSnapshot: () => ({
      currentPage: { type: 'music-library' },
      history: [{ type: 'home' }, { type: 'music-library' }],
      currentIndex: 1,
    }),
    subscribe: () => () => {},
    ...overrides,
  };
}

function createKeybindingsStub(context: Record<string, unknown> = {}): KeybindingsService {
  return {
    getSnapshot: () => ({
      defaults: [],
      user: [],
      effective: [],
      conflicts: [],
    }),
    setUserKeybindings: () => {},
    resetUserKeybindings: () => {},
    setContext: () => {},
    getContext: () => context,
    handleKeyboardEvent: () => false,
    destroy: () => {},
  };
}

function createCommandsStub(commandList: CommandContribution[] = []) {
  const commands = new Map(commandList.map((command) => [command.id, command]));
  const dispatch = vi.fn(async (id: string, args?: unknown) => {
    const command = commands.get(id);
    if (!command) {
      throw new Error(`[CommandsService] Command not registered: ${id}`);
    }
    await command.run(args);
  });

  return {
    service: {
      list: () => Array.from(commands.values()),
      get: (id: string) => commands.get(id) ?? null,
      dispatch,
    },
    dispatch,
  };
}

function createTrayStub(options: { supported?: boolean; visible?: boolean | null } = {}) {
  let visible = options.visible ?? true;
  const getMainWindowVisible = vi.fn(async () => visible);
  const activateItem = vi.fn(async (itemId: string) => {
    if (itemId === 'show') {
      visible = true;
      return;
    }
    if (itemId === 'hide') {
      visible = false;
      return;
    }
    if (itemId === 'toggle-main-window') {
      visible = !visible;
      return;
    }
    if (itemId === 'quit') {
      return;
    }
    throw new Error(`Unknown tray item: ${itemId}`);
  });

  return {
    api: {
      supported: options.supported ?? true,
      getMainWindowVisible,
      activateItem,
    } satisfies PluginHostTrayApi,
    getMainWindowVisible,
    activateItem,
  };
}

function createNoopTelemetryLogger(): TelemetryLogger {
  const span: TelemetrySpan = {
    end: () => {},
  };

  return {
    log: () => {},
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    metric: () => {},
    startSpan: (_event: string, _options?: TelemetrySpanStartOptions) => span,
  };
}

function createTelemetryServiceStub(
  options: {
    snapshot?: Partial<TelemetrySnapshot> & {
      status?: Partial<TelemetrySnapshot['status']>;
      policy?: Partial<TelemetrySnapshot['policy']>;
    };
  } = {}
): {
  service: TelemetryService;
  ingested: Array<{ moduleId: string; record: TelemetryRecordInput; component?: string | null }>;
} {
  const ingested: Array<{
    moduleId: string;
    record: TelemetryRecordInput;
    component?: string | null;
  }> = [];

  const snapshot: TelemetrySnapshot = {
    policy: {
      ...DEFAULT_TELEMETRY_POLICY,
      ...(options.snapshot?.policy ?? {}),
    },
    status: {
      enabled: true,
      currentSessionId: 'session-1',
      queuedRecords: 0,
      flushedRecords: 0,
      droppedRecords: 0,
      currentFileBytes: 128,
      currentFilePath: '/debug/telemetry/current-session.jsonl',
      frontendMinLevel: 'info',
      backendMinLevel: 'info',
      persistMinLevel: 'warn',
      lastError: null,
      ...(options.snapshot?.status ?? {}),
    },
    tail: [] as TelemetryRecord[],
    bufferedRecords: 0,
    queueDroppedRecords: 0,
    tailDroppedRecords: 0,
    transportAvailable: true,
    bootstrapState: 'ready',
    lastFlushAtMs: 1_710_000_000_000,
    lastBootstrapAtMs: 1_710_000_000_000,
    ...(options.snapshot ?? {}),
  };

  const flushNow = vi.fn(async () => {});
  const noopLogger = createNoopTelemetryLogger();

  const service: TelemetryService = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    refreshRuntime: async () => snapshot,
    clearSession: async () => {},
    flushNow,
    getLogger: () => noopLogger,
    ingest: (moduleId, record, component) => {
      ingested.push({ moduleId, record, component });
    },
    destroy: () => {},
  };

  return {
    service,
    ingested,
  };
}

function createMountApi(options: {
  permissions: string[];
  audioService?: HostAudioService;
  navigation?: HostNavigation;
  commands?: CommandsService | null;
  keybindings?: KeybindingsService | null;
  pluginId?: string;
  sourceKind?: 'extv2';
  trayApi?: PluginHostTrayApi | null;
}) {
  return createPluginMountApi({
    pluginId: options.pluginId ?? TEST_PLUGIN_ID,
    hostLabel: 'HostPmpCapabilityTest',
    sourceKind: options.sourceKind,
    permissions: new Set(options.permissions),
    audioService: options.audioService ?? createAudioServiceStub(),
    commands: options.commands,
    navigation: options.navigation ?? createNavigationStub(),
    keybindings: options.keybindings,
    trayApi: options.trayApi,
  });
}

afterEach(() => {
  configureAudioInputAdapterGovernance({
    thirdPartyEnabled: false,
    allowedProviderIds: null,
    timeoutMs: 2_000,
    maxOpenSessionsPerPlugin: 24,
    quarantineThreshold: 3,
    quarantineMs: 120_000,
  });
  durableTextState.clear();
  clearMagnetRenderers();
  clearMagnetVariants();
  clearExtensionConfig(TEST_PLUGIN_ID);
  setLocale('zh-CN');
  setGlobalTelemetryService(null);
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('host.pmp capabilities', () => {
  it('registers core and host.pmp capability ids', () => {
    const capabilityIds = listPluginHostCapabilities().map((capability) => capability.id);

    expect(capabilityIds).toEqual(
      expect.arrayContaining([
        'core.capability-registry',
        'host.pmp.navigation',
        'host.pmp.shell.window',
        'host.pmp.shell.menu',
        'host.pmp.shell.context-menu',
        'host.pmp.shell.tray',
        'host.pmp.shell.status-item',
        'host.pmp.storage.config',
        'host.pmp.storage.durable-text',
        'host.pmp.storage.sync',
        'host.pmp.magnets.catalog',
        'host.pmp.magnets.layout',
        'host.pmp.magnets.renderer',
        'host.pmp.audio-engine.playback',
        'host.pmp.audio-engine.analysis',
        'host.pmp.audio-engine.input',
        'host.pmp.music-platform.catalog',
        'host.pmp.music-platform.search',
        'host.pmp.music-platform.prepare',
        'host.pmp.connector-auth',
        'host.pmp.theme-bindings',
        'host.pmp.library-fields',
        'host.pmp.keybinding-context',
        'host.pmp.i18n',
        'host.pmp.telemetry',
      ])
    );
  });

  it('exposes core.capability-registry through the mount api host bridge', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'api:navigation'],
    });

    const result = await api.host.invokeCapability('core.capability-registry', 'has', {
      id: 'host.pmp.navigation',
    });

    expect(result).toEqual({
      ok: true,
      data: {
        id: 'host.pmp.navigation',
        visible: true,
      },
    });
  });

  it('exposes host capability pack descriptor through public helpers and registry describe', async () => {
    const descriptor = getPmpHostCapabilityPackDescriptor();
    const familyIds = listPmpHostCapabilityFamilies();

    expect(descriptor).toMatchObject({
      hostId: 'pmp',
      packVersion: '1.0.0',
      coreCompatibility: 'core.contracts@2.0',
    });
    expect(descriptor.capabilityFamilies).toEqual(familyIds);

    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'api:navigation'],
    });
    const describeResult = await api.host.invokeCapability('core.capability-registry', 'describe');

    expect(describeResult).toMatchObject({
      ok: true,
      data: {
        id: 'core.capability-registry',
        version: '1.1.0',
        methods: ['describe', 'list', 'get', 'has'],
        hostCapabilityPack: descriptor,
      },
    });
    expect(
      (
        describeResult as {
          data: { visibleHostCapabilityFamilies: string[] };
        }
      ).data.visibleHostCapabilityFamilies
    ).toEqual(expect.arrayContaining(['host.pmp.navigation', 'host.pmp.audio-engine.playback']));
  });

  it('routes host.pmp.navigation calls into the existing navigation bridge', async () => {
    const navigateTo = vi.fn();
    const goBack = vi.fn();
    const navigation = createNavigationStub({
      navigateTo,
      goBack,
    });
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'api:navigation'],
      navigation,
    });

    const snapshotResult = await api.host.invokeCapability('host.pmp.navigation', 'getSnapshot');

    expect(snapshotResult).toEqual({
      ok: true,
      data: navigation.getSnapshot?.(),
    });

    await api.host.invokeCapability('host.pmp.navigation', 'navigateTo', {
      page: 'library',
    });
    await api.host.invokeCapability('host.pmp.navigation', 'goBack');

    expect(navigateTo).toHaveBeenCalledWith('library', undefined);
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('injects sourceKind into plugin navigation routes for extv2 mounts', async () => {
    const navigateTo = vi.fn();
    const navigation = createNavigationStub({
      navigateTo,
    });
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'api:navigation'],
      navigation,
      sourceKind: 'extv2',
      pluginId: 'shared-plugin',
    });

    await api.host.invokeCapability('host.pmp.navigation', 'navigateTo', {
      page: 'plugin-page',
      params: {
        pluginId: 'shared-plugin',
        pageId: 'demo-page',
      },
    });
    await api.host.invokeCapability('host.pmp.navigation', 'navigateTo', {
      page: 'plugin-visualizer',
      params: {
        pluginId: 'shared-plugin',
        visualizerId: 'demo-visualizer',
      },
    });

    expect(navigateTo).toHaveBeenNthCalledWith(1, 'plugin-page', {
      pluginId: 'shared-plugin',
      pageId: 'demo-page',
      sourceKind: 'extv2',
    });
    expect(navigateTo).toHaveBeenNthCalledWith(2, 'plugin-visualizer', {
      pluginId: 'shared-plugin',
      visualizerId: 'demo-visualizer',
      sourceKind: 'extv2',
    });
  });

  it('routes host.pmp.shell.window open/close through the source-aware window bridge', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'api:window'],
      sourceKind: 'extv2',
      pluginId: 'shared-plugin',
    });

    const describeResult = await api.host.invokeCapability('host.pmp.shell.window', 'describe');
    const openResult = await api.host.invokeCapability('host.pmp.shell.window', 'open', {
      windowId: 'demo-window',
      options: {
        title: 'Demo Window',
        width: 920,
        height: 620,
      },
    });
    const closeResult = await api.host.invokeCapability('host.pmp.shell.window', 'close', {
      windowId: 'demo-window',
    });

    expect(describeResult).toEqual({
      ok: true,
      data: {
        capabilityId: 'host.pmp.shell.window',
        stage: 'host-pack',
        implementation: 'pmp-host-window-shell',
        methods: ['describe', 'open', 'close'],
      },
    });
    expect(openResult).toEqual({
      ok: true,
      data: {
        capabilityId: 'host.pmp.shell.window',
        opened: true,
        windowId: 'demo-window',
      },
    });
    expect(closeResult).toEqual({
      ok: true,
      data: {
        capabilityId: 'host.pmp.shell.window',
        closed: true,
        windowId: 'demo-window',
      },
    });
    expect(pluginWindowMocks.openPluginWindow).toHaveBeenCalledWith({
      sourceKind: 'extv2',
      pluginId: 'shared-plugin',
      windowId: 'demo-window',
      title: 'Demo Window',
      width: 920,
      height: 620,
      x: undefined,
      y: undefined,
    });
    expect(pluginWindowMocks.closePluginWindow).toHaveBeenCalledWith(
      'shared-plugin',
      'demo-window',
      'extv2'
    );
  });

  it('exposes host.pmp.shell.menu as a permission-gated builtin command catalog', async () => {
    const togglePalette = vi.fn(async () => {});
    const navigateHome = vi.fn(async () => {});
    const nextTrack = vi.fn(async () => {});
    const pluginOverride = vi.fn(async () => {});
    const commands = createCommandsStub([
      {
        kind: 'command',
        id: 'commandPalette:toggle',
        title: 'Toggle Command Palette',
        description: 'Open or close the command palette',
        source: 'builtin',
        group: 'core',
        order: 1,
        run: togglePalette,
      },
      {
        kind: 'command',
        id: 'app:navigate-home',
        title: 'Go Home',
        description: 'Navigate to the home page',
        source: 'builtin',
        group: 'navigation',
        order: 10,
        run: navigateHome,
      },
      {
        kind: 'command',
        id: 'audio:next-track',
        title: 'Next Track',
        description: 'Skip to the next track',
        source: 'builtin',
        group: 'audio',
        order: 310,
        run: nextTrack,
      },
      {
        kind: 'command',
        id: 'plugin:custom-action',
        title: 'Plugin Custom Action',
        description: 'Should not leak through shell.menu',
        source: 'plugin',
        group: 'plugin',
        order: 1,
        run: pluginOverride,
      },
    ]);
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'api:navigation'],
      commands: commands.service,
    });

    const describeResult = await api.host.invokeCapability('host.pmp.shell.menu', 'describe');
    const listItemsResult = await api.host.invokeCapability('host.pmp.shell.menu', 'listItems');
    const getItemResult = await api.host.invokeCapability('host.pmp.shell.menu', 'getItem', {
      itemId: 'app:navigate-home',
    });
    const activateItemResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:navigate-home',
      }
    );
    const deniedItemResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'audio:next-track',
      }
    );

    expect(describeResult).toEqual({
      ok: true,
      data: {
        capabilityId: 'host.pmp.shell.menu',
        stage: 'host-pack',
        implementation: 'builtin-command-catalog',
        methods: ['describe', 'listItems', 'getItem', 'activateItem'],
        itemCount: 3,
        availableItemCount: 2,
        groups: ['audio', 'core', 'navigation'],
      },
    });
    expect(listItemsResult).toEqual({
      ok: true,
      data: {
        itemCount: 3,
        items: [
          {
            id: 'commandPalette:toggle',
            title: 'Toggle Command Palette',
            description: 'Open or close the command palette',
            group: 'core',
            order: 1,
            source: 'builtin',
            tags: [],
            requiredPermission: null,
            available: true,
            metadata: undefined,
          },
          {
            id: 'app:navigate-home',
            title: 'Go Home',
            description: 'Navigate to the home page',
            group: 'navigation',
            order: 10,
            source: 'builtin',
            tags: [],
            requiredPermission: 'api:navigation',
            available: true,
            metadata: undefined,
          },
          {
            id: 'audio:next-track',
            title: 'Next Track',
            description: 'Skip to the next track',
            group: 'audio',
            order: 310,
            source: 'builtin',
            tags: [],
            requiredPermission: 'api:audio-control',
            available: false,
            metadata: undefined,
          },
        ],
      },
    });
    expect(getItemResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:navigate-home',
        found: true,
        item: {
          id: 'app:navigate-home',
          title: 'Go Home',
          description: 'Navigate to the home page',
          group: 'navigation',
          order: 10,
          source: 'builtin',
          tags: [],
          requiredPermission: 'api:navigation',
          available: true,
          metadata: undefined,
        },
      },
    });
    expect(activateItemResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:navigate-home',
        activated: true,
        requiredPermission: 'api:navigation',
      },
    });
    expect(deniedItemResult).toEqual({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Permission denied: api:audio-control',
        retryable: undefined,
        details: {
          itemId: 'audio:next-track',
          requiredPermission: 'api:audio-control',
        },
      },
    });
    expect(commands.dispatch).toHaveBeenCalledTimes(1);
    expect(commands.dispatch).toHaveBeenCalledWith('app:navigate-home', undefined);
    expect(togglePalette).not.toHaveBeenCalled();
    expect(navigateHome).toHaveBeenCalledTimes(1);
    expect(nextTrack).not.toHaveBeenCalled();
    expect(pluginOverride).not.toHaveBeenCalled();
  });

  it('exposes host.pmp.shell.context-menu as a schema-only host surface contract', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability'],
    });

    const describeResult = await api.host.invokeCapability(
      'host.pmp.shell.context-menu',
      'describe'
    );
    const schemaResult = await api.host.invokeCapability(
      'host.pmp.shell.context-menu',
      'getSchema'
    );

    expect(describeResult).toEqual({
      ok: true,
      data: {
        capabilityId: 'host.pmp.shell.context-menu',
        stage: 'host-pack',
        implementation: 'pmp-react-context-menu-surface',
        methods: ['describe', 'getSchema'],
        supported: true,
        bridgeMode: 'schema-only',
        surfaceId: 'overlay.context-menu',
        itemKinds: ['action', 'divider', 'submenu'],
        supportsIcons: true,
        supportsDangerState: true,
        supportsNestedMenus: true,
        closeTriggers: ['outside-pointerdown', 'escape', 'item-activation'],
        placement: 'viewport-clamped-pointer-anchor',
      },
    });
    expect(schemaResult).toEqual({
      ok: true,
      data: {
        supported: true,
        bridgeMode: 'schema-only',
        surfaceId: 'overlay.context-menu',
        itemKinds: ['action', 'divider', 'submenu'],
        supportsIcons: true,
        supportsDangerState: true,
        supportsNestedMenus: true,
        closeTriggers: ['outside-pointerdown', 'escape', 'item-activation'],
        placement: 'viewport-clamped-pointer-anchor',
      },
    });
  });

  it('exposes host.pmp.shell.tray as a permission-gated system tray bridge', async () => {
    const tray = createTrayStub({ visible: true });
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'api:window'],
      trayApi: tray.api,
    });

    const describeResult = await api.host.invokeCapability('host.pmp.shell.tray', 'describe');
    const stateResult = await api.host.invokeCapability('host.pmp.shell.tray', 'getState');
    const listItemsResult = await api.host.invokeCapability('host.pmp.shell.tray', 'listItems');
    const hideResult = await api.host.invokeCapability('host.pmp.shell.tray', 'activateItem', {
      itemId: 'hide',
    });
    const toggleResult = await api.host.invokeCapability('host.pmp.shell.tray', 'activateItem', {
      itemId: 'toggle-main-window',
    });

    expect(describeResult).toEqual({
      ok: true,
      data: {
        capabilityId: 'host.pmp.shell.tray',
        stage: 'host-pack',
        implementation: 'tauri-system-tray-bridge',
        methods: ['describe', 'getState', 'listItems', 'activateItem'],
        supported: true,
        primaryActionId: 'toggle-main-window',
        itemCount: 3,
        availableItemCount: 3,
      },
    });
    expect(stateResult).toEqual({
      ok: true,
      data: {
        supported: true,
        primaryActionId: 'toggle-main-window',
        mainWindowVisible: true,
        itemCount: 3,
        items: [
          {
            id: 'show',
            label: 'Show Window',
            action: 'show-main-window',
            requiredPermission: 'api:window',
            available: true,
          },
          {
            id: 'hide',
            label: 'Hide Window',
            action: 'hide-main-window',
            requiredPermission: 'api:window',
            available: true,
          },
          {
            id: 'quit',
            label: 'Quit',
            action: 'request-app-exit',
            requiredPermission: 'api:window',
            available: true,
          },
        ],
      },
    });
    expect(listItemsResult).toEqual({
      ok: true,
      data: {
        supported: true,
        primaryActionId: 'toggle-main-window',
        itemCount: 3,
        items: [
          {
            id: 'show',
            label: 'Show Window',
            action: 'show-main-window',
            requiredPermission: 'api:window',
            available: true,
          },
          {
            id: 'hide',
            label: 'Hide Window',
            action: 'hide-main-window',
            requiredPermission: 'api:window',
            available: true,
          },
          {
            id: 'quit',
            label: 'Quit',
            action: 'request-app-exit',
            requiredPermission: 'api:window',
            available: true,
          },
        ],
      },
    });
    expect(hideResult).toEqual({
      ok: true,
      data: {
        itemId: 'hide',
        activated: true,
        mainWindowVisible: false,
      },
    });
    expect(toggleResult).toEqual({
      ok: true,
      data: {
        itemId: 'toggle-main-window',
        activated: true,
        mainWindowVisible: true,
      },
    });
    expect(tray.activateItem).toHaveBeenNthCalledWith(1, 'hide');
    expect(tray.activateItem).toHaveBeenNthCalledWith(2, 'toggle-main-window');

    const deniedApi = createMountApi({
      permissions: ['api:host', 'api:host-capability'],
      trayApi: tray.api,
    });
    const deniedResult = await deniedApi.host.invokeCapability(
      'host.pmp.shell.tray',
      'activateItem',
      {
        itemId: 'quit',
      }
    );

    expect(deniedResult).toEqual({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Permission denied: api:window',
        retryable: undefined,
        details: {
          itemId: 'quit',
          requiredPermission: 'api:window',
        },
      },
    });
    expect(tray.activateItem).toHaveBeenCalledTimes(2);
  });

  it('exposes host.pmp.shell.status-item as an explicit unavailable host slot catalog', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability'],
    });

    const describeResult = await api.host.invokeCapability(
      'host.pmp.shell.status-item',
      'describe'
    );
    const listSlotsResult = await api.host.invokeCapability(
      'host.pmp.shell.status-item',
      'listSlots'
    );

    expect(describeResult).toEqual({
      ok: true,
      data: {
        capabilityId: 'host.pmp.shell.status-item',
        stage: 'host-pack',
        implementation: 'host-shell-status-item-placeholder',
        methods: ['describe', 'listSlots'],
        supported: false,
        bridgeMode: 'unavailable',
        reason: 'not-wired',
        slotCount: 0,
        slots: [],
      },
    });
    expect(listSlotsResult).toEqual({
      ok: true,
      data: {
        supported: false,
        bridgeMode: 'unavailable',
        reason: 'not-wired',
        slotCount: 0,
        slots: [],
      },
    });
  });

  it('routes host.pmp.storage.config through the extv2 config store', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'storage:local'],
    });

    await api.host.invokeCapability('host.pmp.storage.config', 'set', {
      theme: 'ice',
    });
    const patchResult = await api.host.invokeCapability('host.pmp.storage.config', 'patch', {
      accent: 'blue',
    });
    const getResult = await api.host.invokeCapability('host.pmp.storage.config', 'get');

    expect(patchResult).toEqual({
      ok: true,
      data: {
        theme: 'ice',
        accent: 'blue',
      },
    });
    expect(getResult).toEqual({
      ok: true,
      data: {
        theme: 'ice',
        accent: 'blue',
      },
    });

    await api.host.invokeCapability('host.pmp.storage.config', 'reset');
    expect(api.config.get()).toEqual({});
  });

  it('persists extv2 config under the extv2 namespace', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'storage:local'],
      pluginId: 'shared-plugin',
      sourceKind: 'extv2',
    });

    await api.host.invokeCapability('host.pmp.storage.config', 'set', {
      profile: 'extv2',
    });

    expect(api.config.get()).toEqual({ profile: 'extv2' });
    expect(localStorage.getItem(getExtensionConfigKey('shared-plugin', 'extv2'))).toBe(
      JSON.stringify({ profile: 'extv2' })
    );
  });

  it('exposes host.pmp.storage.sync as a revisioned config snapshot bridge', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'storage:local'],
    });

    const initialState = await api.host.invokeCapability('host.pmp.storage.sync', 'getSyncState');
    const writeResult = await api.host.invokeCapability('host.pmp.storage.sync', 'writeConfig', {
      value: {
        theme: 'ice',
      },
    });
    const patchResult = await api.host.invokeCapability('host.pmp.storage.sync', 'patchConfig', {
      value: {
        accent: 'blue',
      },
    });
    const readResult = await api.host.invokeCapability('host.pmp.storage.sync', 'readConfig');
    const removeResult = await api.host.invokeCapability('host.pmp.storage.sync', 'removeConfig');

    expect(initialState).toEqual({
      ok: true,
      data: {
        syncState: {
          revision: 0,
          updatedAt: null,
          present: false,
        },
      },
    });
    expect(writeResult).toEqual({
      ok: true,
      data: {
        config: {
          theme: 'ice',
        },
        syncState: {
          revision: 1,
          updatedAt: expect.any(Number),
          present: true,
        },
      },
    });
    expect(patchResult).toEqual({
      ok: true,
      data: {
        config: {
          theme: 'ice',
          accent: 'blue',
        },
        syncState: {
          revision: 2,
          updatedAt: expect.any(Number),
          present: true,
        },
      },
    });
    expect(readResult).toEqual({
      ok: true,
      data: {
        config: {
          theme: 'ice',
          accent: 'blue',
        },
        syncState: {
          revision: 2,
          updatedAt: expect.any(Number),
          present: true,
        },
      },
    });
    expect(removeResult).toEqual({
      ok: true,
      data: {
        config: {},
        syncState: {
          revision: 3,
          updatedAt: expect.any(Number),
          present: false,
        },
      },
    });
    expect(api.config.get()).toEqual({});
  });

  it('routes host.pmp.storage.durable-text through plugin-scoped durable storage', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'storage:durable-text'],
    });

    const writeResult = await api.host.invokeCapability('host.pmp.storage.durable-text', 'write', {
      key: 'lyrics-cache',
      value: 'hello world',
    });
    const readResult = await api.host.invokeCapability('host.pmp.storage.durable-text', 'read', {
      key: 'lyrics-cache',
    });
    const removeResult = await api.host.invokeCapability(
      'host.pmp.storage.durable-text',
      'remove',
      {
        key: 'lyrics-cache',
      }
    );

    expect(writeResult).toEqual({
      ok: true,
      data: {
        key: 'lyrics-cache',
        written: true,
      },
    });
    expect(readResult).toEqual({
      ok: true,
      data: {
        key: 'lyrics-cache',
        value: 'hello world',
      },
    });
    expect(removeResult).toEqual({
      ok: true,
      data: {
        key: 'lyrics-cache',
        removed: true,
      },
    });
    expect(storageModule.writeDurableText).toHaveBeenCalledWith(
      'plugin-data',
      `${TEST_PLUGIN_ID}__lyrics-cache`,
      'hello world'
    );
  });

  it('routes host.pmp.magnets.catalog through the magnet catalog boundary', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'api:magnets-catalog'],
    });

    const listBefore = await api.host.invokeCapability('host.pmp.magnets.catalog', 'list');
    const upsertResult = await api.host.invokeCapability('host.pmp.magnets.catalog', 'upsert', {
      magnet: {
        id: 'plugin-clock',
        type: 'custom',
        name: 'Plugin Clock',
        renderer: 'plugin.renderer.clock',
        previewText: '12:34',
        description: 'Clock sample',
        anchorType: 'single',
        anchors: [{ id: 'anchor-1', gridX: 5, gridY: 6, role: 'anchor' }],
        content: 'clock',
        style: {
          backgroundColor: '#101820',
        },
        interactions: {
          draggable: true,
          clickable: true,
        },
      },
    });
    const getResult = await api.host.invokeCapability('host.pmp.magnets.catalog', 'get', {
      magnetId: 'plugin-clock',
    });
    const builtinResult = await api.host.invokeCapability('host.pmp.magnets.catalog', 'upsert', {
      magnet: {
        id: 'btn-close',
        type: 'custom',
        name: 'Should Fail',
        anchorType: 'single',
        anchors: [{ id: 'anchor-1', gridX: 0, gridY: 0, role: 'anchor' }],
        content: 'fail',
        style: {},
        interactions: {
          draggable: false,
          clickable: true,
        },
      },
    });
    const removeResult = await api.host.invokeCapability('host.pmp.magnets.catalog', 'remove', {
      magnetId: 'plugin-clock',
    });

    expect(listBefore).toMatchObject({
      ok: true,
      data: {
        magnetCount: 0,
        magnets: [],
      },
    });
    expect(upsertResult).toMatchObject({
      ok: true,
      data: {
        magnetId: 'plugin-clock',
        magnetCount: 1,
        magnet: {
          id: 'plugin-clock',
          name: 'Plugin Clock',
          renderer: 'plugin.renderer.clock',
        },
      },
    });
    expect(getResult).toMatchObject({
      ok: true,
      data: {
        magnetId: 'plugin-clock',
        found: true,
        magnet: {
          id: 'plugin-clock',
          name: 'Plugin Clock',
        },
      },
    });
    expect(builtinResult).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'FORBIDDEN',
        message: 'Built-in magnet ids are host-managed',
      }),
    });
    expect(removeResult).toMatchObject({
      ok: true,
      data: {
        magnetId: 'plugin-clock',
        removed: true,
        magnetCount: 0,
      },
    });
  });

  it('routes host.pmp.magnets.layout through the magnet layout boundary', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'api:magnets-layout'],
    });

    const ensureResult = await api.host.invokeCapability(
      'host.pmp.magnets.layout',
      'ensureLayout',
      {
        spaceId: 'plugin-space',
      }
    );
    const setActiveResult = await api.host.invokeCapability(
      'host.pmp.magnets.layout',
      'setActiveMagnetIds',
      {
        spaceId: 'plugin-space',
        activeMagnetIds: ['plugin-clock'],
      }
    );
    const updateAnchorsResult = await api.host.invokeCapability(
      'host.pmp.magnets.layout',
      'updateMagnetAnchors',
      {
        spaceId: 'plugin-space',
        magnetId: 'plugin-clock',
        anchors: [{ id: 'anchor-1', gridX: 8, gridY: 9, role: 'anchor' }],
      }
    );
    const deactivateResult = await api.host.invokeCapability(
      'host.pmp.magnets.layout',
      'setMagnetActive',
      {
        spaceId: 'plugin-space',
        magnetId: 'plugin-clock',
        active: false,
      }
    );
    const getLayoutResult = await api.host.invokeCapability(
      'host.pmp.magnets.layout',
      'getLayout',
      {
        spaceId: 'plugin-space',
      }
    );

    expect(ensureResult).toMatchObject({
      ok: true,
      data: {
        spaceId: 'plugin-space',
        didCreate: true,
        source: 'storage',
        layout: {
          activeMagnetIds: expect.arrayContaining(['btn-close', 'btn-editor']),
        },
      },
    });
    expect(setActiveResult).toMatchObject({
      ok: true,
      data: {
        spaceId: 'plugin-space',
        source: 'storage',
        layout: {
          activeMagnetIds: expect.arrayContaining(['plugin-clock', 'btn-close', 'btn-editor']),
        },
      },
    });
    expect(updateAnchorsResult).toMatchObject({
      ok: true,
      data: {
        spaceId: 'plugin-space',
        magnetId: 'plugin-clock',
        source: 'storage',
        anchors: [{ id: 'anchor-1', gridX: 8, gridY: 9, role: 'anchor' }],
        layout: {
          anchorsByMagnetId: {
            'plugin-clock': [{ id: 'anchor-1', gridX: 8, gridY: 9, role: 'anchor' }],
          },
        },
      },
    });
    expect(deactivateResult).toMatchObject({
      ok: true,
      data: {
        spaceId: 'plugin-space',
        magnetId: 'plugin-clock',
        active: false,
        source: 'storage',
      },
    });
    expect(
      (deactivateResult as { ok: true; data: { layout: { activeMagnetIds: string[] } } }).data
        .layout.activeMagnetIds
    ).not.toContain('plugin-clock');
    expect(getLayoutResult).toMatchObject({
      ok: true,
      data: {
        spaceId: 'plugin-space',
        source: 'storage',
        layout: {
          anchorsByMagnetId: {
            'plugin-clock': [{ id: 'anchor-1', gridX: 8, gridY: 9, role: 'anchor' }],
          },
        },
      },
    });
  });

  it('exposes host.pmp.magnets.renderer through shared renderer registries and system rules', async () => {
    registerMagnetRenderer({
      id: 'plugin.renderer.clock',
      render: () => null,
      preview: 'Clock',
      description: 'Plugin clock renderer',
      group: 'plugin',
      tags: ['clock', 'plugin'],
      source: 'plugin',
      metadata: {
        shape: 'square',
      },
    });
    registerMagnetRenderer({
      id: 'builtin.renderer.panel',
      render: () => null,
      description: 'Builtin panel renderer',
      group: 'layout',
      source: 'builtin',
    });
    registerMagnetVariant('plugin.renderer.clock', {
      id: 'compact',
      label: 'Compact',
      description: 'Compact clock',
      source: 'plugin',
      metadata: {
        density: 'compact',
      },
    });
    registerMagnetVariant('plugin.renderer.clock', {
      id: 'wide',
      label: 'Wide',
      source: 'plugin',
    });
    registerMagnetVariant('builtin.renderer.panel', {
      id: 'default',
      label: 'Default',
      source: 'builtin',
    });

    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability'],
    });

    const describeResult = await api.host.invokeCapability('host.pmp.magnets.renderer', 'describe');
    const listRenderersResult = await api.host.invokeCapability(
      'host.pmp.magnets.renderer',
      'listRenderers'
    );
    const getRendererResult = await api.host.invokeCapability(
      'host.pmp.magnets.renderer',
      'getRenderer',
      {
        rendererId: 'plugin.renderer.clock',
      }
    );
    const listVariantsResult = await api.host.invokeCapability(
      'host.pmp.magnets.renderer',
      'listVariants'
    );
    const systemRulesResult = await api.host.invokeCapability(
      'host.pmp.magnets.renderer',
      'getSystemLayoutRules',
      {
        spaceId: 'space2',
      }
    );

    expect(describeResult).toEqual({
      ok: true,
      data: {
        capabilityId: 'host.pmp.magnets.renderer',
        stage: 'host-pack',
        implementation: 'renderer-registry-variant-registry-system-layouts',
        methods: [
          'describe',
          'listRenderers',
          'getRenderer',
          'listVariants',
          'getSystemLayoutRules',
        ],
        rendererCount: 2,
        variantRendererCount: 2,
        variantCount: 3,
        systemSpaces: ['space1', 'space2'],
        fallbackScope: 'required',
      },
    });
    expect(listRenderersResult).toMatchObject({
      ok: true,
      data: {
        rendererCount: 2,
        renderers: expect.arrayContaining([
          {
            id: 'plugin.renderer.clock',
            description: 'Plugin clock renderer',
            group: 'plugin',
            tags: ['clock', 'plugin'],
            source: 'plugin',
            hasPreview: true,
            metadata: {
              shape: 'square',
            },
          },
          {
            id: 'builtin.renderer.panel',
            description: 'Builtin panel renderer',
            group: 'layout',
            tags: [],
            source: 'builtin',
            hasPreview: false,
          },
        ]),
      },
    });
    expect(getRendererResult).toEqual({
      ok: true,
      data: {
        rendererId: 'plugin.renderer.clock',
        found: true,
        renderer: {
          id: 'plugin.renderer.clock',
          description: 'Plugin clock renderer',
          group: 'plugin',
          tags: ['clock', 'plugin'],
          source: 'plugin',
          hasPreview: true,
          metadata: {
            shape: 'square',
          },
        },
        variantCount: 2,
        variants: [
          {
            rendererId: 'plugin.renderer.clock',
            id: 'compact',
            label: 'Compact',
            description: 'Compact clock',
            source: 'plugin',
            metadata: {
              density: 'compact',
            },
          },
          {
            rendererId: 'plugin.renderer.clock',
            id: 'wide',
            label: 'Wide',
            description: undefined,
            source: 'plugin',
            metadata: undefined,
          },
        ],
      },
    });
    expect(listVariantsResult).toMatchObject({
      ok: true,
      data: {
        rendererCount: 2,
        variantCount: 3,
        variantsByRenderer: expect.arrayContaining([
          {
            rendererId: 'builtin.renderer.panel',
            variantCount: 1,
            variants: [
              {
                rendererId: 'builtin.renderer.panel',
                id: 'default',
                label: 'Default',
                source: 'builtin',
              },
            ],
          },
          {
            rendererId: 'plugin.renderer.clock',
            variantCount: 2,
            variants: [
              expect.objectContaining({
                rendererId: 'plugin.renderer.clock',
                id: 'compact',
              }),
              expect.objectContaining({
                rendererId: 'plugin.renderer.clock',
                id: 'wide',
              }),
            ],
          },
        ]),
      },
    });
    expect(systemRulesResult).toMatchObject({
      ok: true,
      data: {
        spaceId: 'space2',
        resolvedSpaceId: 'space2',
        usesFallbackRules: false,
        requiredMagnetIds: expect.arrayContaining(['btn-close', 'drag-handle']),
        defaultMagnetIds: expect.arrayContaining(['btn-platform-login', 'platform-magnet']),
        requiredAnchorsByMagnetId: {
          'btn-close': [{ id: 'anchor', gridX: 26, gridY: 0, role: 'anchor' }],
        },
        defaultAnchorsByMagnetId: {
          'btn-platform-login': [{ id: 'anchor', gridX: 1, gridY: 0, role: 'anchor' }],
        },
      },
    });
  });

  it('aliases host.pmp.audio-engine.input to the shared audio input bridge', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'api:audio-input-adapter'],
      audioService: createAudioServiceStub({
        listAudioInputs: () => ['symphonia'],
      }),
    });

    const result = await api.host.invokeCapability('host.pmp.audio-engine.input', 'listInputs');

    expect(result).toMatchObject({
      ok: true,
      data: {
        builtinInputCount: 1,
        inputs: [{ id: 'symphonia', builtin: true }],
      },
    });
  });

  it('opens and closes audio input sessions through the host session facade', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'api:audio-input-adapter'],
      audioService: createAudioServiceStub({
        listAudioInputs: () => ['symphonia'],
      }),
    });

    const opened = await api.host.openSession('host.pmp.audio-engine.input', 'openSession', {
      path: 'D:/music/demo.flac',
    });

    expect(opened).toMatchObject({
      sessionId: expect.stringMatching(/^audio-input-session-/),
      metadata: {
        sourcePath: 'D:/music/demo.flac',
        selectedAdapterKind: 'builtin',
        selectedInputId: 'symphonia',
      },
    });

    await expect(
      api.host.closeSession('host.pmp.audio-engine.input', opened?.sessionId ?? '')
    ).resolves.toBeUndefined();
  });

  it('opens audio analysis streams through the host stream facade', async () => {
    vi.useFakeTimers();

    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'api:audio-visual'],
    });

    const stream = await api.host.openStream(
      'host.pmp.audio-engine.analysis',
      'openSpectrumFrameStream',
      {
        tap: 'pre-dsp',
        intervalMs: 20,
      }
    );

    expect(stream).toMatchObject({
      streamId: expect.stringMatching(/^audio-analysis-stream-/),
      mode: 'push',
      transport: 'inline-json',
    });

    const onData = vi.fn();
    const onEnd = vi.fn();
    const unlistenData = stream?.onData(onData);
    const unlistenEnd = stream?.onEnd(onEnd);

    await vi.advanceTimersByTimeAsync(25);

    expect(onData).toHaveBeenCalledWith(
      expect.objectContaining({
        tap: 'pre-dsp',
      }),
      expect.objectContaining({
        streamId: stream?.streamId,
        sequence: 0,
      })
    );

    await stream?.dispose('done');

    expect(onEnd).toHaveBeenCalledWith(
      'done',
      expect.objectContaining({
        streamId: stream?.streamId,
        reason: 'done',
      })
    );

    unlistenData?.();
    unlistenEnd?.();
  });

  it('best-effort closes provider sessions during runtime cleanup reasons', async () => {
    configureAudioInputAdapterGovernance({
      thirdPartyEnabled: true,
      allowedProviderIds: ['provider.cleanup-test'],
    });

    const unregisterProvider = registerAudioInputAdapterProvider({
      info: {
        id: 'provider.cleanup-test',
        name: 'Cleanup Test Provider',
        version: '1.0.0',
        protocolVersion: '1.0.0',
      },
      openSession: async () => ({
        providerSessionId: 'provider-session-cleanup',
        selectedInputId: 'provider.cleanup-test',
      }),
      closeSession: async () => {
        throw new Error('provider close failed');
      },
    });

    try {
      const api = createMountApi({
        permissions: ['api:host', 'api:host-capability', 'api:audio-input-adapter'],
      });

      const opened = await api.host.openSession('host.pmp.audio-engine.input', 'openSession', {
        path: 'D:/music/demo.flac',
        providerId: 'provider.cleanup-test',
        fallbackToBuiltin: false,
      });

      await expect(
        api.host.closeSession(
          'host.pmp.audio-engine.input',
          opened?.sessionId ?? '',
          'runtime-dispose'
        )
      ).resolves.toBeUndefined();

      await expect(
        api.host.closeSession(
          'host.pmp.audio-engine.input',
          opened?.sessionId ?? '',
          'runtime-dispose'
        )
      ).rejects.toThrow(/Unknown audio input adapter session/);
    } finally {
      unregisterProvider();
    }
  });

  it('routes music platform catalog/search/prepare through existing facades', async () => {
    const api = createMountApi({
      permissions: [
        'api:host',
        'api:host-capability',
        'api:music-platform-catalog',
        'api:music-platform-search',
        'api:music-platform-prepare',
      ],
    });

    const catalogResult = await api.host.invokeCapability(
      'host.pmp.music-platform.catalog',
      'listConnectors'
    );
    const searchResult = await api.host.invokeCapability(
      'host.pmp.music-platform.search',
      'searchTracks',
      {
        query: 'demo',
        connectorIds: ['connector.platform.bilibili'],
      }
    );
    const prepareBilibiliResult = await api.host.invokeCapability(
      'host.pmp.music-platform.prepare',
      'preparePlayback',
      {
        connectorId: 'connector.platform.bilibili',
        sourceLocator: 'bilibili://BV1-test',
        qualityHint: '1080p',
      }
    );
    const prepareNeteaseResult = await api.host.invokeCapability(
      'host.pmp.music-platform.prepare',
      'preparePlayback',
      {
        connectorId: 'connector.platform.netease',
        sourceLocator: 'netease://song/1',
      }
    );

    expect(catalogResult).toMatchObject({
      ok: true,
      data: {
        connectorCount: 1,
        connectors: [{ connectorId: 'connector.platform.bilibili' }],
      },
    });
    expect(searchResult).toMatchObject({
      ok: true,
      data: {
        query: 'demo',
        trackCount: 1,
        tracks: [{ connectorId: 'connector.platform.bilibili' }],
      },
    });
    expect(prepareBilibiliResult).toMatchObject({
      ok: true,
      data: {
        connectorId: 'connector.platform.bilibili',
        prepared: {
          sourceLocator: 'bilibili://BV1-test',
          selectedQualityKey: '1080p',
        },
      },
    });
    expect(prepareNeteaseResult).toMatchObject({
      ok: true,
      data: {
        connectorId: 'connector.platform.netease',
        prepared: {
          sourceLocator: 'netease://song/1',
          songId: 'song-1',
        },
      },
    });
    expect(musicPlatformModule.listPlatformConnectorFacadeItems).toHaveBeenCalledTimes(1);
    expect(musicPlatformModule.searchPlatformTracks).toHaveBeenCalledWith({
      query: 'demo',
      limit: undefined,
      connectorIds: ['connector.platform.bilibili'],
    });
    expect(musicPlatformModule.preparePlatformPlayback).toHaveBeenNthCalledWith(1, {
      connectorId: 'connector.platform.bilibili',
      sourceLocator: 'bilibili://BV1-test',
      qualityHint: '1080p',
      instanceId: undefined,
    });
    expect(musicPlatformModule.preparePlatformPlayback).toHaveBeenNthCalledWith(2, {
      connectorId: 'connector.platform.netease',
      sourceLocator: 'netease://song/1',
      qualityHint: undefined,
      instanceId: undefined,
    });
  });

  it('routes host.pmp.music-platform.workspace through instance-aware workspace facades', async () => {
    const api = createMountApi({
      permissions: [
        'api:host',
        'api:host-capability',
        'api:music-platform-workspace',
      ],
    });

    const describeResult = await api.host.invokeCapability(
      'host.pmp.music-platform.workspace',
      'describe'
    );
    const modelResult = await api.host.invokeCapability(
      'host.pmp.music-platform.workspace',
      'getWorkspaceModel',
      {
        connectorId: 'connector.platform.netease',
      }
    );
    const pagesResult = await api.host.invokeCapability(
      'host.pmp.music-platform.workspace',
      'listPages',
      {
        connectorId: 'connector.platform.netease',
      }
    );
    const collectionsResult = await api.host.invokeCapability(
      'host.pmp.music-platform.workspace',
      'listCollections',
      {
        connectorId: 'connector.platform.netease',
        forceRefresh: true,
      }
    );
    const collectionResourcesResult = await api.host.invokeCapability(
      'host.pmp.music-platform.workspace',
      'listCollectionResources',
      {
        connectorId: 'connector.platform.netease',
        collectionId: 'connector.platform.netease:favorites',
      }
    );
    const recommendedCollectionsResult = await api.host.invokeCapability(
      'host.pmp.music-platform.workspace',
      'listRecommendedCollections',
      {
        connectorId: 'connector.platform.netease',
      }
    );
    const recommendedResourcesResult = await api.host.invokeCapability(
      'host.pmp.music-platform.workspace',
      'listRecommendedResources',
      {
        connectorId: 'connector.platform.netease',
      }
    );
    const searchResult = await api.host.invokeCapability(
      'host.pmp.music-platform.workspace',
      'searchResources',
      {
        connectorId: 'connector.platform.netease',
        query: 'daily mix',
      }
    );
    const prepareResult = await api.host.invokeCapability(
      'host.pmp.music-platform.workspace',
      'preparePlayback',
      {
        connectorId: 'connector.platform.netease',
        sourceLocator: 'netease://song/workspace-track-1',
        qualityHint: 'lossless',
      }
    );
    const qualityStateResult = await api.host.invokeCapability(
      'host.pmp.music-platform.workspace',
      'listQualityState',
      {
        connectorId: 'connector.platform.netease',
      }
    );
    const qualityPreferenceResult = await api.host.invokeCapability(
      'host.pmp.music-platform.workspace',
      'setQualityPreference',
      {
        connectorId: 'connector.platform.netease',
        qualityKey: 'exhigh',
      }
    );
    const coverResult = await api.host.invokeCapability(
      'host.pmp.music-platform.workspace',
      'resolveCoverAssetUrl',
      {
        connectorId: 'connector.platform.netease',
        coverUrl: 'https://example.test/covers/netease.jpg',
      }
    );

    expect(describeResult).toMatchObject({
      ok: true,
      data: {
        capabilityId: 'host.pmp.music-platform.workspace',
      },
    });
    expect(modelResult).toMatchObject({
      ok: true,
      data: {
        connectorId: 'connector.platform.netease',
        instanceId: 'bilibili:builtin',
        model: {
          defaultPageId: 'recommended',
        },
      },
    });
    expect(pagesResult).toMatchObject({
      ok: true,
      data: {
        items: [{ pageId: 'recommended' }, { pageId: 'instance' }],
      },
    });
    expect(collectionsResult).toMatchObject({
      ok: true,
      data: {
        items: [{ collectionId: 'connector.platform.netease:favorites' }],
      },
    });
    expect(collectionResourcesResult).toMatchObject({
      ok: true,
      data: {
        collectionId: 'connector.platform.netease:favorites',
        page: {
          sourceId: 'connector.platform.netease:favorites',
        },
      },
    });
    expect(recommendedCollectionsResult).toMatchObject({
      ok: true,
      data: {
        items: [{ collectionId: 'connector.platform.netease:daily-playlists' }],
      },
    });
    expect(recommendedResourcesResult).toMatchObject({
      ok: true,
      data: {
        page: {
          sourceKind: 'recommended',
        },
      },
    });
    expect(searchResult).toMatchObject({
      ok: true,
      data: {
        query: 'daily mix',
        page: {
          sourceId: 'daily mix',
        },
      },
    });
    expect(prepareResult).toMatchObject({
      ok: true,
      data: {
        prepared: {
          sourceLocator: 'netease://song/workspace-track-1',
          selectedQualityKey: 'lossless',
        },
      },
    });
    expect(qualityStateResult).toMatchObject({
      ok: true,
      data: {
        state: {
          currentKey: 'lossless',
        },
      },
    });
    expect(qualityPreferenceResult).toMatchObject({
      ok: true,
      data: {
        state: {
          currentKey: 'exhigh',
        },
      },
    });
    expect(coverResult).toMatchObject({
      ok: true,
      data: {
        assetUrl: 'asset://example.test/covers/netease.jpg',
      },
    });
    expect(musicPlatformModule.resolvePlatformInstanceId).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
    });
    expect(musicPlatformModule.getPlatformWorkspacePageModel).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      instanceId: 'bilibili:builtin',
    });
    expect(musicPlatformModule.listPlatformWorkspacePages).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      instanceId: 'bilibili:builtin',
    });
    expect(musicPlatformModule.listPlatformWorkspaceCollections).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      instanceId: 'bilibili:builtin',
      forceRefresh: true,
    });
    expect(musicPlatformModule.listPlatformWorkspaceCollectionResources).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      instanceId: 'bilibili:builtin',
      collectionId: 'connector.platform.netease:favorites',
      pageNum: undefined,
      pageSize: undefined,
      forceRefresh: false,
    });
    expect(musicPlatformModule.listPlatformWorkspaceRecommendedCollections).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      instanceId: 'bilibili:builtin',
      forceRefresh: false,
    });
    expect(musicPlatformModule.listPlatformWorkspaceRecommendedResources).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      instanceId: 'bilibili:builtin',
      forceRefresh: false,
    });
    expect(musicPlatformModule.searchPlatformWorkspaceResources).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      instanceId: 'bilibili:builtin',
      keyword: 'daily mix',
      pageNum: undefined,
      pageSize: undefined,
      forceRefresh: false,
    });
    expect(musicPlatformModule.preparePlatformWorkspacePlayback).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      instanceId: 'bilibili:builtin',
      sourceLocator: 'netease://song/workspace-track-1',
      qualityHint: 'lossless',
      resourceId: undefined,
      webUrl: undefined,
    });
    expect(musicPlatformModule.listPlatformWorkspaceQualityState).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      instanceId: 'bilibili:builtin',
      sourceLocator: undefined,
      forceRefresh: false,
    });
    expect(musicPlatformModule.setPlatformWorkspaceQualityPreference).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      instanceId: 'bilibili:builtin',
      qualityKey: 'exhigh',
      sourceLocator: undefined,
    });
    expect(musicPlatformModule.resolvePlatformWorkspaceCoverAssetUrl).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      instanceId: 'bilibili:builtin',
      coverUrl: 'https://example.test/covers/netease.jpg',
    });
  });

  it('routes host.pmp.connector-auth through instance-aware auth runtime', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'api:connector-auth'],
    });

    const definitionsResult = await api.host.invokeCapability(
      'host.pmp.connector-auth',
      'listDefinitions'
    );
    const snapshotsResult = await api.host.invokeCapability(
      'host.pmp.connector-auth',
      'listAuthSnapshots'
    );
    const snapshotResult = await api.host.invokeCapability(
      'host.pmp.connector-auth',
      'getAuthSnapshot',
      {
        connectorId: 'connector.platform.bilibili',
      }
    );
    const beginResult = await api.host.invokeCapability('host.pmp.connector-auth', 'beginQrLogin', {
      connectorId: 'connector.platform.bilibili',
    });
    const pollResult = await api.host.invokeCapability('host.pmp.connector-auth', 'pollQrLogin', {
      connectorId: 'connector.platform.bilibili',
      sessionId: 'session-1',
    });
    const logoutResult = await api.host.invokeCapability('host.pmp.connector-auth', 'logout', {
      connectorId: 'connector.platform.bilibili',
    });

    expect(definitionsResult).toMatchObject({
      ok: true,
      data: {
        definitions: [{ connectorId: 'connector.platform.bilibili' }],
      },
    });
    expect(snapshotsResult).toMatchObject({
      ok: true,
      data: {
        snapshots: [
          {
            connectorId: 'connector.platform.bilibili',
            instanceId: 'bilibili:builtin',
            authState: 'authorized',
          },
        ],
      },
    });
    expect(snapshotResult).toMatchObject({
      ok: true,
      data: {
        connectorId: 'connector.platform.bilibili',
        instanceId: 'bilibili:builtin',
        snapshot: {
          connectorId: 'connector.platform.bilibili',
          instanceId: 'bilibili:builtin',
          authState: 'authorized',
        },
      },
    });
    expect(beginResult).toMatchObject({
      ok: true,
      data: {
        connectorId: 'connector.platform.bilibili',
        instanceId: 'bilibili:builtin',
        session: { instanceId: 'bilibili:builtin', sessionId: 'session-1' },
      },
    });
    expect(pollResult).toMatchObject({
      ok: true,
      data: {
        connectorId: 'connector.platform.bilibili',
        instanceId: 'bilibili:builtin',
        sessionId: 'session-1',
        result: { instanceId: 'bilibili:builtin', authState: 'authorized' },
      },
    });
    expect(logoutResult).toMatchObject({
      ok: true,
      data: {
        connectorId: 'connector.platform.bilibili',
        instanceId: 'bilibili:builtin',
        snapshot: { instanceId: 'bilibili:builtin', authState: 'unauthorized' },
      },
    });
    expect(musicPlatformModule.listPlatformConnectorDefinitions).toHaveBeenCalledTimes(1);
    expect(musicPlatformModule.listPlatformInstanceAuthSnapshots).toHaveBeenCalledWith({
      refresh: true,
    });
    expect(musicPlatformModule.resolvePlatformInstanceId).toHaveBeenCalledWith({
      instanceId: null,
      connectorId: 'connector.platform.bilibili',
    });
    expect(musicPlatformModule.refreshPlatformInstanceAuthSnapshot).toHaveBeenCalledWith(
      'bilibili:builtin'
    );
    expect(musicPlatformModule.beginPlatformInstanceQrLogin).toHaveBeenCalledWith(
      'bilibili:builtin'
    );
    expect(musicPlatformModule.pollPlatformInstanceQrLogin).toHaveBeenCalledWith(
      'bilibili:builtin',
      'session-1'
    );
    expect(musicPlatformModule.logoutPlatformInstance).toHaveBeenCalledWith(
      'bilibili:builtin'
    );
  });

  it('exposes host.pmp.theme-bindings through the persisted theme model', async () => {
    localStorage.setItem(
      STORAGE_KEYS.THEME_CONFIG,
      JSON.stringify({
        ...DEFAULT_THEME,
        id: 'theme-plugin-test',
        name: 'Plugin Test Theme',
        version: '1.2.0',
        bindings: {
          ...(DEFAULT_THEME.bindings ?? {}),
          'magnet.plugin-clock': {
            surface: 'surface.plugin-clock',
            variant: 'compact',
          },
        },
        surfaces: {
          'surface.plugin-clock': {
            tokens: {
              background: '#101820',
            },
          },
        },
      })
    );

    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability'],
    });

    const bindingIdsResult = await api.host.invokeCapability(
      'host.pmp.theme-bindings',
      'listBindingIds'
    );
    const bindingResult = await api.host.invokeCapability(
      'host.pmp.theme-bindings',
      'resolveBinding',
      {
        bindingId: 'magnet.plugin-clock',
      }
    );
    const surfaceResult = await api.host.invokeCapability(
      'host.pmp.theme-bindings',
      'resolveSurface',
      {
        bindingId: 'magnet.plugin-clock',
      }
    );

    expect(bindingIdsResult).toMatchObject({
      ok: true,
      data: {
        themeId: 'theme-plugin-test',
        bindingIds: expect.arrayContaining(['magnet.plugin-clock', 'surface.plugin-clock']),
      },
    });
    expect(bindingResult).toMatchObject({
      ok: true,
      data: {
        bindingId: 'magnet.plugin-clock',
        source: 'binding',
        surfaceId: 'surface.plugin-clock',
        binding: {
          variant: 'compact',
        },
      },
    });
    expect(surfaceResult).toMatchObject({
      ok: true,
      data: {
        requestedId: 'magnet.plugin-clock',
        surfaceId: 'surface.plugin-clock',
        exists: true,
        surface: {
          tokens: {
            background: '#101820',
          },
        },
      },
    });
  });

  it('exposes host.pmp.keybinding-context through the current keybinding service snapshot', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability'],
      keybindings: createKeybindingsStub({
        'app.windowType': 'main',
        'audio.hasQueue': true,
        'ui.commandPaletteOpen': false,
      }),
    });

    const listKeysResult = await api.host.invokeCapability(
      'host.pmp.keybinding-context',
      'listKeys'
    );
    const valueResult = await api.host.invokeCapability('host.pmp.keybinding-context', 'getValue', {
      key: 'audio.hasQueue',
    });

    expect(listKeysResult).toMatchObject({
      ok: true,
      data: {
        keyCount: 3,
        keys: expect.arrayContaining(['app.windowType', 'audio.hasQueue', 'ui.commandPaletteOpen']),
      },
    });
    expect(valueResult).toEqual({
      ok: true,
      data: {
        key: 'audio.hasQueue',
        exists: true,
        value: true,
      },
    });
  });

  it('exposes host.pmp.i18n through shared locale state and plugin-scoped bundles', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability'],
      pluginId: 'host-pmp-i18n-test',
    });

    const registerResult = await api.host.invokeCapability('host.pmp.i18n', 'registerMessages', {
      locale: 'en-US',
      messages: {
        'plugin.greeting': 'Hello {name}',
      },
    });
    const translateResult = await api.host.invokeCapability('host.pmp.i18n', 'translate', {
      key: 'plugin.greeting',
      locale: 'en-US',
      params: {
        name: 'Pixel',
      },
    });
    const setLocaleResult = await api.host.invokeCapability('host.pmp.i18n', 'setLocale', {
      locale: 'en-US',
    });
    const stateResult = await api.host.invokeCapability('host.pmp.i18n', 'getState');

    expect(registerResult).toEqual({
      ok: true,
      data: {
        locale: 'en-US',
        messageCount: 1,
        registeredLocales: ['en-US'],
      },
    });
    expect(translateResult).toEqual({
      ok: true,
      data: {
        key: 'plugin.greeting',
        requestedLocale: 'en-US',
        resolvedLocale: 'en-US',
        found: true,
        message: 'Hello Pixel',
      },
    });
    expect(setLocaleResult).toEqual({
      ok: true,
      data: {
        locale: 'en-US',
        previousLocale: 'zh-CN',
        changed: true,
      },
    });
    expect(stateResult).toEqual({
      ok: true,
      data: {
        activeLocale: 'en-US',
        fallbackLocale: 'zh-CN',
        supportedLocales: ['zh-CN', 'en-US'],
        registeredLocales: ['en-US'],
      },
    });
    expect(localStorage.getItem(STORAGE_KEYS.LOCALE)).toBe(JSON.stringify('en-US'));
  });

  it('exposes host.pmp.telemetry as a redacted host sink with injected plugin identity', async () => {
    const telemetry = createTelemetryServiceStub();
    setGlobalTelemetryService(telemetry.service);

    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability'],
    });

    const statusResult = await api.host.invokeCapability('host.pmp.telemetry', 'getStatus');
    const logResult = await api.host.invokeCapability('host.pmp.telemetry', 'log', {
      loggerId: 'plugin.ui',
      event: 'plugin.render.failed',
      level: 'warn',
      message: 'Bearer secret-token',
      fields: {
        cookie: 'session=abc',
        accessToken: 'top-secret',
        ok: true,
      },
    });

    expect(statusResult).toMatchObject({
      ok: true,
      data: {
        policy: {
          enabled: true,
          persistMinLevel: 'warn',
        },
        status: {
          enabled: true,
          currentSessionId: 'session-1',
          currentFileBytes: 128,
        },
        transportAvailable: true,
      },
    });
    expect(
      (statusResult as { ok: true; data: { status: Record<string, unknown> } }).data.status
    ).not.toHaveProperty('currentFilePath');
    expect(logResult).toEqual({
      ok: true,
      data: {
        acceptedCount: 1,
        moduleId: 'extensions-plugin',
        pluginId: TEST_PLUGIN_ID,
        loggerId: 'plugin.ui',
        event: 'plugin.render.failed',
        level: 'warn',
        kind: 'log',
      },
    });
    expect(telemetry.ingested).toHaveLength(1);
    expect(telemetry.ingested[0]).toEqual({
      moduleId: 'extensions-plugin',
      component: 'host-pmp-capability-test:plugin.ui',
      record: {
        level: 'warn',
        event: 'plugin.render.failed',
        kind: 'log',
        component: 'host-pmp-capability-test:plugin.ui',
        message: 'Bearer [REDACTED]',
        traceId: null,
        spanId: null,
        windowId: null,
        fields: {
          cookie: '[REDACTED]',
          accessToken: '[REDACTED]',
          ok: true,
          pluginId: TEST_PLUGIN_ID,
          hostLabel: 'HostPmpCapabilityTest',
          loggerId: 'plugin.ui',
          runtimeId: 'unknown',
          trustLevel: 'unknown',
          hostCapabilityId: 'host.pmp.telemetry',
          pluginTelemetry: true,
        },
      },
    });
  });

  it('exposes host.pmp.library-fields through the native library schema facades', async () => {
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability'],
    });

    const fieldCatalogResult = await api.host.invokeCapability(
      'host.pmp.library-fields',
      'listFieldCatalog'
    );
    const facetCatalogResult = await api.host.invokeCapability(
      'host.pmp.library-fields',
      'listFacetCatalog'
    );
    const textFacetResult = await api.host.invokeCapability(
      'host.pmp.library-fields',
      'listTextFacetValues',
      {
        field: 'artist',
        limit: 10,
      }
    );
    const facetEntriesResult = await api.host.invokeCapability(
      'host.pmp.library-fields',
      'listFacetEntries',
      {
        kind: 'album-summaries',
        limit: 5,
      }
    );

    expect(fieldCatalogResult).toMatchObject({
      ok: true,
      data: {
        fieldCount: 1,
        fields: [{ field: 'artist', filterable: true, sortable: true, facetable: true }],
      },
    });
    expect(facetCatalogResult).toMatchObject({
      ok: true,
      data: {
        facetCount: 1,
        facets: [{ id: 'artist', kind: 'text-values' }],
      },
    });
    expect(textFacetResult).toMatchObject({
      ok: true,
      data: {
        query: { field: 'artist', limit: 10 },
        valueCount: 2,
        values: ['Artist A', 'Artist B'],
      },
    });
    expect(facetEntriesResult).toMatchObject({
      ok: true,
      data: {
        query: { kind: 'album-summaries', limit: 5 },
        result: {
          kind: 'album-summaries',
          albums: [{ album: 'Album A', artist: 'Artist A' }],
        },
      },
    });
    expect(musicLibraryModule.listNativeLibraryTrackFieldCatalog).toHaveBeenCalledTimes(1);
    expect(musicLibraryModule.listNativeLibraryFacetCatalog).toHaveBeenCalledTimes(1);
    expect(musicLibraryModule.listNativeLibraryTextFacetValues).toHaveBeenCalledWith({
      field: 'artist',
      limit: 10,
    });
    expect(musicLibraryModule.listNativeLibraryFacetEntries).toHaveBeenCalledWith({
      kind: 'album-summaries',
      limit: 5,
    });
  });

  it('enforces per-method permissions for host.pmp.audio-engine.playback', async () => {
    const play = vi.fn(async () => {});
    const audioState = {
      currentTrack: {
        id: 'track-1',
        title: 'Track 1',
      },
      playMode: 'shuffle',
    };
    const api = createMountApi({
      permissions: ['api:host', 'api:host-capability', 'api:audio-state'],
      audioService: createAudioServiceStub({
        getState: () => audioState,
        getPlayMode: () => 'shuffle',
        play,
      }),
    });

    const stateResult = await api.host.invokeCapability(
      'host.pmp.audio-engine.playback',
      'getState'
    );
    const playResult = await api.host.invokeCapability('host.pmp.audio-engine.playback', 'play');

    expect(stateResult).toEqual({
      ok: true,
      data: audioState,
    });
    expect(playResult).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'FORBIDDEN',
        message: 'Permission denied: api:audio-control',
      }),
    });
    expect(play).not.toHaveBeenCalled();
  });
});
