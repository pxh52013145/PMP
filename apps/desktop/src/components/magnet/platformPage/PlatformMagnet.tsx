import React, { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  Check,
  ChevronLeft,
  Compass,
  Disc3,
  Filter,
  Heart,
  LayoutGrid,
  Library,
  Mic,
  Music,
  Play,
  Plus,
  Power,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  Tv,
  X,
} from 'lucide-react';

import type {
  PlatformCompatContractFile,
  PlatformInstanceRecord,
  PlatformRenderSelectionRecord,
} from '@pixel-matrix/plugin-platform-contracts';

import { useAudioService } from '../../../contexts/AudioEngineContext';
import { useT } from '../../../i18n';
import type { Playlist as AudioPlaylist } from '../../../services/audio';
import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import { useSkinSurfaceModel } from '../../../themes/skinSurface';
import { useConfirmDialog } from '../../core/ConfirmDialog';
import {
  getMusicPlatformGlobalCacheSettings,
  listPlatformCompatRegistryRecords,
  listPlatformConnectorDefinitions,
  listPlatformConnectorFacadeItems,
  listPlatformInstances,
  listPlatformRenderSelections,
  pickMusicPlatformGlobalCacheDirectory,
  readPlatformLoginRegistry,
  refreshAndEmitPlatformConnectorAuthSnapshot,
  resolvePlatformConnectorTemplate,
  setMusicPlatformGlobalCacheSettings,
  setPlatformRenderSelectionMounted,
  subscribePlatformCompatRegistry,
  subscribePlatformConnectorDefinitions,
  subscribePlatformInstances,
  subscribePlatformLoginRegistry,
  subscribePlatformRenderSelections,
  type PlatformCompatRegistryRecord,
  type PlatformConnectorDefinition,
  type PlatformConnectorFacadeItem,
  type PlatformConnectorId,
  type PlatformLoginRegistryEntry,
  type MusicPlatformGlobalCacheSettings,
} from '../../../modules/music-platform';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';
import {
  PLATFORM_MAGNET_VARIANT_PRESETS,
  parsePlatformMagnetSkinProps,
  type PlatformMagnetDefaultMode,
} from './platformMagnetSkin';
import { BilibiliPlaybackSettingsContent } from './BilibiliPlaybackSettingsModal';
import { MusicTemplatePlaybackSettingsContent } from './MusicTemplatePlaybackSettings';
import {
  DedicatedWorkspacePlaceholderAdapter,
  DedicatedWorkspacePlaceholderToolbar,
} from './DedicatedWorkspacePlaceholderAdapter';
import {
  renderPlatformWorkspaceAdapterToolbar,
  renderPlatformWorkspaceAdapterWorkspace,
  resolveDailySubtitleKeyByConnectorId,
  resolvePlatformWorkspaceAdapter,
  resolvePlatformWorkspaceAdapterKind,
  resolveDefaultWorkspaceAdapterKindByWorkspaceDefaultMode,
  type PlatformWorkspaceAdapterKind,
  type PlatformWorkspaceAdapterPayloadMap,
} from './platformWorkspaceAdapterRegistry';
import {
  toConnectorWorkspaceMode,
  type PlatformWorkspaceDescriptor,
} from './platformWorkspaceModes';
import { useBilibiliWorkspaceAdapterController } from './useBilibiliWorkspaceAdapterController';
import { useDedicatedWorkspacePlaceholderController } from './useDedicatedWorkspacePlaceholderController';
import { useMusicTemplateWorkspaceAdapterController } from './useMusicTemplateWorkspaceAdapterController';

import './PlatformMagnet.css';

type IconComponent = ComponentType<{ className?: string; style?: React.CSSProperties }>;

type PlatformMagnetRendererProps = {
  skinProps?: Record<string, unknown>;
};

type PlatformPageView = 'daily' | 'overview' | 'instance' | 'local';
type SettingsTabId = 'global' | string;
type CreateView = 'create' | 'existing';
type ContentTransitionPhase = 'entered' | 'entering' | 'exiting';

type RegisteredPlatformItem = {
  entry: PlatformLoginRegistryEntry;
  definition: PlatformConnectorDefinition | null;
  contractRecord: PlatformCompatRegistryRecord | null;
  instance: PlatformInstanceRecord | null;
  renderSelection: PlatformRenderSelectionRecord | null;
  facade: PlatformConnectorFacadeItem | null;
};

type PlaylistDrawerGroup = {
  id: string;
  connectorId: string | null;
  label: string;
  playlists: AudioPlaylist[];
  collections?: Array<{
    collectionId: string | null;
    title: string;
    count: number | null;
  }>;
  selectedCollectionId?: string | null;
  collectionSectionLabelKey?: string;
  playlistSectionLabelKey?: string;
  collectionLoading?: boolean;
  collectionError?: string | null;
};

type WorkspaceShellSearchState = {
  value: string;
  placeholder: string;
  disabled: boolean;
  loading: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

type WorkspaceSettingsPanelRenderContext = {
  settingsLabel: string;
  settingsItems: RegisteredPlatformItem[];
};

type WorkspaceRuntimeAdapter = {
  shellSearch?: WorkspaceShellSearchState;
  playlistOpener?: (() => void) | null;
  playlistActionLabelKey?: string;
  shouldResetPageStageScroll?: boolean;
  scrollResetToken?: string | null;
  buildDrawerGroup?: () => PlaylistDrawerGroup | null;
  selectDrawerFolder?: (folderId: string | null) => void;
  selectDrawerPlaylist?: (playlistId: string) => void;
  resolveDrawerConnectorId?: () => string | null;
  handleBackAction?: () => boolean;
  renderSettingsPanel?: (context: WorkspaceSettingsPanelRenderContext) => JSX.Element | null;
};

const CONNECTOR_VISUAL_META_BY_ICON_KEY: Record<string, { Icon: IconComponent; color: string }> = {
  bilibili: { Icon: Tv, color: '#67c7ff' },
  netease: { Icon: Disc3, color: '#ff6b87' },
};

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function readTelemetryErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatTrackDuration(seconds: number | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return '--:--';
  }

  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const rest = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

function formatPlaylistDuration(seconds: number | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return '--:--';
  }

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(hours > 0 ? 2 : 1, '0');
  const rest = (total % 60).toString().padStart(2, '0');

  return hours > 0 ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
}

function formatTrackIndexLabel(index: number): string {
  return String(index + 1).padStart(2, '0');
}

function resolvePlaylistCoverUrl(playlist: AudioPlaylist | null): string | null {
  if (!playlist) return null;

  const playlistCover = typeof playlist.coverUrl === 'string' ? playlist.coverUrl.trim() : '';
  if (playlistCover.length > 0) return playlistCover;

  for (const track of playlist.tracks) {
    const trackCover = typeof track.coverUrl === 'string' ? track.coverUrl.trim() : '';
    if (trackCover.length > 0) return trackCover;
  }

  return null;
}

function filterWorkspacePlaylists(playlists: AudioPlaylist[]): AudioPlaylist[] {
  return playlists.filter((playlist) => playlist.kind !== 'platform' && playlist.kind !== 'smart');
}

function toAuthLabelKey(authState: string | undefined): string {
  const normalized = authState?.trim().toLowerCase() ?? 'unauthorized';
  switch (normalized) {
    case 'pending':
    case 'authorized':
    case 'expired':
    case 'revoked':
    case 'error':
      return `magnet.platform-login.auth.${normalized}`;
    default:
      return 'magnet.platform-login.auth.unauthorized';
  }
}

function resolveRegisteredItemAccountValue(item: RegisteredPlatformItem | null): string {
  if (!item) return '-';
  return (
    item.facade?.accountUid ??
    item.instance?.account.accountId ??
    item.instance?.account.accountName ??
    '-'
  );
}

function listCapabilityLabelKeys(contract: PlatformCompatContractFile | null): string[] {
  if (!contract) return [];

  const next: string[] = [];
  if (contract.capabilities.playlists) {
    next.push('magnet.platform.compat.capability.playlists');
  }
  if (contract.capabilities.favorites) {
    next.push('magnet.platform.compat.capability.favorites');
  }
  if (contract.capabilities.dailyRecommendations) {
    next.push('magnet.platform.compat.capability.dailyRecommendations');
  }
  if (contract.capabilities.search) {
    next.push('magnet.platform.compat.capability.search');
  }
  if (contract.capabilities.quality) {
    next.push('magnet.platform.compat.capability.quality');
  }
  if (contract.capabilities.pages) {
    next.push('magnet.platform.compat.capability.pages');
  }

  return next;
}

function listApiBindingKeys(contract: PlatformCompatContractFile | null): string[] {
  if (!contract) return [];

  return Object.entries(contract.apiBindings)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([key]) => key);
}

function resolvePreferredConnectorId(
  selectedConnectorId: string | null,
  items: RegisteredPlatformItem[],
  defaultMode: PlatformMagnetDefaultMode
): string | null {
  const registeredConnectorIds = new Set(items.map((item) => item.entry.connectorId));
  if (selectedConnectorId && registeredConnectorIds.has(selectedConnectorId as PlatformConnectorId)) {
    return selectedConnectorId;
  }

  const preferredAdapterKind = resolveDefaultWorkspaceAdapterKindByWorkspaceDefaultMode(defaultMode);
  const matchesPreferredAdapter = (item: RegisteredPlatformItem): boolean => {
    if (!preferredAdapterKind || !item.definition) return false;
    return (
      resolvePlatformWorkspaceAdapterKind({
        connectorId: item.entry.connectorId,
        workspaceKind: item.definition.workspaceKind,
        platformTemplate: resolvePlatformConnectorTemplate(item.definition),
      }) === preferredAdapterKind
    );
  };

  const mountedItems = items.filter((item) => item.renderSelection?.mounted === true);
  if (preferredAdapterKind) {
    const preferredMounted = mountedItems.find(matchesPreferredAdapter);
    if (preferredMounted) return preferredMounted.entry.connectorId;
  }

  if (mountedItems[0]) {
    return mountedItems[0].entry.connectorId;
  }

  if (preferredAdapterKind) {
    const preferredRegistered = items.find(matchesPreferredAdapter);
    if (preferredRegistered) return preferredRegistered.entry.connectorId;
  }

  return items[0]?.entry.connectorId ?? null;
}

function getConnectorVisualMeta(
  connectorId: string | null | undefined,
  definition?: PlatformConnectorDefinition | null
): {
  Icon: IconComponent;
  color: string;
  iconAssetUrl?: string;
} {
  const template = definition ? resolvePlatformConnectorTemplate(definition) : 'generic';
  const fallbackIcon = template === 'video' ? Tv : template === 'music' ? Disc3 : Music;
  const iconKey = definition?.iconKey?.trim().toLowerCase() ?? '';
  const connectorSuffix =
    typeof connectorId === 'string' ? connectorId.replace('connector.platform.', '').trim().toLowerCase() : '';
  const builtin = CONNECTOR_VISUAL_META_BY_ICON_KEY[iconKey] ?? CONNECTOR_VISUAL_META_BY_ICON_KEY[connectorSuffix];
  return {
    Icon: builtin?.Icon ?? fallbackIcon,
    color: definition?.accentColor || builtin?.color || '#a1a1aa',
    iconAssetUrl: definition?.iconAssetUrl,
  };
}

function isSearchFilterableConnector(definition: PlatformConnectorDefinition | null): boolean {
  if (!definition) return true;
  return resolvePlatformConnectorTemplate(definition) !== 'video';
}

function ConnectorGlyph({
  connectorId,
  definition,
  active = false,
  compact = false,
}: {
  connectorId: string | null | undefined;
  definition?: PlatformConnectorDefinition | null;
  active?: boolean;
  compact?: boolean;
}): JSX.Element {
  const { Icon, color, iconAssetUrl } = getConnectorVisualMeta(connectorId, definition);

  return (
    <span
      className={cx(
        'platform-preview-soft-ring inline-flex shrink-0 items-center justify-center rounded-full',
        compact ? 'h-9 w-9' : 'h-11 w-11'
      )}
      style={{
        color,
        background: active ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
        boxShadow: active
          ? 'inset 0 0 0 1px rgba(255,255,255,0.12)'
          : 'inset 0 0 0 1px rgba(255,255,255,0.06)',
      }}
    >
      <ConnectorVisualIcon
        Icon={Icon}
        color={color}
        iconAssetUrl={iconAssetUrl}
        className={compact ? 'h-4 w-4 object-contain' : 'h-5 w-5 object-contain'}
      />
    </span>
  );
}

function ConnectorVisualIcon({
  Icon,
  color,
  iconAssetUrl,
  className,
  style,
}: {
  Icon: IconComponent;
  color: string;
  iconAssetUrl?: string;
  className: string;
  style?: React.CSSProperties;
}): JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [iconAssetUrl]);

  if (iconAssetUrl && !imageFailed) {
    return (
      <img
        src={iconAssetUrl}
        alt=""
        aria-hidden
        className={className}
        style={style}
        onError={() => {
          setImageFailed(true);
        }}
      />
    );
  }

  return <Icon className={className} style={{ ...style, color }} />;
}

const PlatformMagnetDefaultRenderer: React.FC<PlatformMagnetRendererProps> = ({ skinProps: rawSkinProps }) => {
  const skinProps = useMemo(() => parsePlatformMagnetSkinProps(rawSkinProps), [rawSkinProps]);
  const t = useT();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const localPlaylistSurface = useSkinSurfaceModel('page.music-library');
  const audioService = useAudioService();
  const telemetry = useMemo(() => getTelemetryLogger('magnet.platform', 'PlatformMagnet'), []);
  const launcherRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const pageStageScrollRef = useRef<HTMLDivElement | null>(null);
  const localPlaylistHydrationRef = useRef<Set<string>>(new Set());
  const connectorViewsRequestIdRef = useRef(0);

  const [platformDefinitions, setPlatformDefinitions] = useState<PlatformConnectorDefinition[]>(() =>
    listPlatformConnectorDefinitions()
  );
  const platformDefinitionsById = useMemo(
    () => new Map(platformDefinitions.map((definition) => [definition.connectorId, definition])),
    [platformDefinitions]
  );
  const localPlaylistThemeStyle = useMemo(
    () => localPlaylistSurface.getPart('root', { includeSurfaceTokens: true }).style,
    [localPlaylistSurface]
  );
  const resolveConnectorVisualMeta = useCallback(
    (
      connectorId: string | null | undefined,
      definition?: PlatformConnectorDefinition | null
    ) => {
      const resolvedDefinition =
        definition ??
        (connectorId
          ? platformDefinitionsById.get(connectorId as PlatformConnectorId) ?? null
          : null);
      return getConnectorVisualMeta(connectorId, resolvedDefinition);
    },
    [platformDefinitionsById]
  );

  const [registryEntries, setRegistryEntries] = useState<PlatformLoginRegistryEntry[]>(() =>
    readPlatformLoginRegistry(platformDefinitions)
  );
  const [platformInstances, setPlatformInstances] = useState<PlatformInstanceRecord[]>(() =>
    listPlatformInstances()
  );
  const [renderSelections, setRenderSelections] = useState<PlatformRenderSelectionRecord[]>(() =>
    listPlatformRenderSelections()
  );
  const [contractRecords, setContractRecords] = useState<PlatformCompatRegistryRecord[]>(() =>
    listPlatformCompatRegistryRecords()
  );
  const [connectorViews, setConnectorViews] = useState<PlatformConnectorFacadeItem[]>([]);
  const [connectorViewsLoading, setConnectorViewsLoading] = useState(true);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<PlatformPageView>('daily');
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createView, setCreateView] = useState<CreateView>('create');
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('global');
  const [createName, setCreateName] = useState('');
  const [createNameEditing, setCreateNameEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [localQuery, setLocalQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [, setLastRefreshAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [globalCacheSettings, setGlobalCacheSettings] = useState<MusicPlatformGlobalCacheSettings | null>(
    null
  );
  const [globalCachePathDraft, setGlobalCachePathDraft] = useState('');
  const [globalCacheSettingsLoading, setGlobalCacheSettingsLoading] = useState(false);
  const [globalCacheSettingsSaving, setGlobalCacheSettingsSaving] = useState(false);
  const [globalCacheSettingsInfo, setGlobalCacheSettingsInfo] = useState<string | null>(null);
  const [globalCacheSettingsError, setGlobalCacheSettingsError] = useState<string | null>(null);
  const [selectedFilterConnectorIds, setSelectedFilterConnectorIds] = useState<string[]>([]);
  const [contentTransitionPhase, setContentTransitionPhase] = useState<ContentTransitionPhase>('entered');
  const [allPlaylists, setAllPlaylists] = useState<AudioPlaylist[]>(() => audioService.getPlaylists());
  const [workspacePlaylists, setWorkspacePlaylists] = useState<AudioPlaylist[]>(() =>
    filterWorkspacePlaylists(audioService.getPlaylists())
  );
  const [selectedPlaylistIdsByConnector, setSelectedPlaylistIdsByConnector] = useState<Record<string, string>>({});
  const [selectedLocalPlaylistId, setSelectedLocalPlaylistId] = useState<string | null>(null);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const createNameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setPlatformDefinitions(listPlatformConnectorDefinitions());
    return subscribePlatformConnectorDefinitions((definitions) => {
      setPlatformDefinitions(definitions);
    });
  }, []);

  const refreshConnectorViews = useCallback(async (options?: { refreshAuth?: boolean }) => {
    const requestId = ++connectorViewsRequestIdRef.current;
    setConnectorViewsLoading(true);

    try {
      const nextViews = await listPlatformConnectorFacadeItems({
        refresh: options?.refreshAuth === true,
      });
      if (connectorViewsRequestIdRef.current !== requestId) return;
      setConnectorViews(nextViews);
      setLastRefreshAt(Date.now());
    } catch (error) {
      if (connectorViewsRequestIdRef.current !== requestId) return;
      telemetry.warn('platform.runtime.connector-views.refresh-failed', {
        message: readTelemetryErrorMessage(error),
      });
    } finally {
      if (connectorViewsRequestIdRef.current === requestId) {
        setConnectorViewsLoading(false);
      }
    }
  }, [telemetry]);

  useEffect(() => {
    const syncWorkspacePlaylists = (playlists: AudioPlaylist[]): void => {
      setAllPlaylists(playlists);
      setWorkspacePlaylists(filterWorkspacePlaylists(playlists));
    };

    syncWorkspacePlaylists(audioService.getState().playlists);
    return audioService.onStateChange((state) => {
      syncWorkspacePlaylists(state.playlists);
    });
  }, [audioService]);

  useEffect(() => {
    const hydratePlaylistTracks = audioService.hydratePlaylistTracks;
    if (typeof hydratePlaylistTracks !== 'function') return;

    for (const playlist of workspacePlaylists) {
      if (playlist.tracksHydrated !== false) continue;
      if ((playlist.trackCount ?? 0) <= 0) continue;
      if (localPlaylistHydrationRef.current.has(playlist.id)) continue;

      localPlaylistHydrationRef.current.add(playlist.id);
      void hydratePlaylistTracks.call(audioService, playlist.id).finally(() => {
        localPlaylistHydrationRef.current.delete(playlist.id);
      });
    }
  }, [audioService, workspacePlaylists]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};

    const refresh = () => {
      if (disposed) return;
      setRegistryEntries(readPlatformLoginRegistry(platformDefinitions));
    };

    refresh();
    void subscribePlatformLoginRegistry(() => {
      refresh();
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }
      unsubscribe = cleanup;
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [platformDefinitions]);

  useEffect(() => {
    setPlatformInstances(listPlatformInstances());
    return subscribePlatformInstances((instances) => {
      setPlatformInstances(instances);
    });
  }, []);

  useEffect(() => {
    setRenderSelections(listPlatformRenderSelections());
    return subscribePlatformRenderSelections((records) => {
      setRenderSelections(records);
    });
  }, []);

  useEffect(() => {
    setContractRecords(listPlatformCompatRegistryRecords());
    return subscribePlatformCompatRegistry((records) => {
      setContractRecords(records);
    });
  }, []);

  useEffect(() => {
    void refreshConnectorViews({ refreshAuth: true });
  }, [refreshConnectorViews]);

  useEffect(() => {
    void refreshConnectorViews();
  }, [platformInstances, refreshConnectorViews]);

  useEffect(() => {
    if (!launcherOpen && !navOpen) return undefined;

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (launcherRef.current?.contains(target)) return;
      if (navRef.current?.contains(target)) return;
      setLauncherOpen(false);
      setNavOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [launcherOpen, navOpen]);

  const connectorViewsById = useMemo(
    () => new Map(connectorViews.map((item) => [item.connectorId, item])),
    [connectorViews]
  );
  const renderSelectionsByInstanceId = useMemo(
    () => new Map(renderSelections.map((record) => [record.instanceId, record])),
    [renderSelections]
  );
  const contractRecordsByPlatformId = useMemo(
    () => new Map(contractRecords.map((record) => [record.platformId, record])),
    [contractRecords]
  );
  const platformInstancesByConnectorId = useMemo(() => {
    const next = new Map<string, PlatformInstanceRecord>();
    for (const instance of platformInstances) {
      const connectorId =
        typeof instance.metadata?.connectorId === 'string' ? instance.metadata.connectorId : '';
      if (!connectorId) continue;
      next.set(connectorId, instance);
    }
    return next;
  }, [platformInstances]);

  const registeredItems = useMemo<RegisteredPlatformItem[]>(
    () =>
      registryEntries
        .filter((entry) => entry.enabled !== false)
        .map((entry) => {
          const definition = platformDefinitionsById.get(entry.connectorId) ?? null;
          const instance = platformInstancesByConnectorId.get(entry.connectorId) ?? null;
          const renderSelection = instance
            ? renderSelectionsByInstanceId.get(instance.instanceId) ?? null
            : null;
          const contractRecord = instance
            ? contractRecordsByPlatformId.get(instance.platformId) ?? null
            : null;

          return {
            entry,
            definition,
            contractRecord,
            instance,
            renderSelection,
            facade: connectorViewsById.get(entry.connectorId) ?? null,
          };
        }),
    [
      connectorViewsById,
      contractRecordsByPlatformId,
      platformDefinitionsById,
      platformInstancesByConnectorId,
      registryEntries,
      renderSelectionsByInstanceId,
    ]
  );

  useEffect(() => {
    const nextSelectedConnectorId = resolvePreferredConnectorId(
      selectedConnectorId,
      registeredItems,
      skinProps.defaultMode
    );
    if (nextSelectedConnectorId !== selectedConnectorId) {
      setSelectedConnectorId(nextSelectedConnectorId);
    }
  }, [registeredItems, selectedConnectorId, skinProps.defaultMode]);

  const activeItem =
    registeredItems.find((item) => item.entry.connectorId === selectedConnectorId) ??
    registeredItems[0] ??
    null;
  const activeDefinition = activeItem?.definition ?? null;
  const activeContractRecord = activeItem?.contractRecord ?? null;
  const activeInstance = activeItem?.instance ?? null;
  const activeRenderSelection = activeItem?.renderSelection ?? null;
  const activeFacade = activeItem?.facade ?? null;
  const activeConnectorId = activeItem?.entry.connectorId ?? null;
  const activeWorkspaceConnectorId =
    activeRenderSelection?.mounted === true && activeConnectorId ? activeConnectorId : null;

  const activeWorkspaceDescriptor = useMemo<PlatformWorkspaceDescriptor | null>(() => {
    if (!activeDefinition) return null;
    return {
      mode: toConnectorWorkspaceMode(activeDefinition.connectorId),
      connectorId: activeDefinition.connectorId,
      workspaceKind: activeDefinition.workspaceKind,
      displayName: activeDefinition.displayName,
      labelKey: activeDefinition.labelKey,
    };
  }, [activeDefinition]);
  const activeWorkspaceAdapterKind = useMemo<PlatformWorkspaceAdapterKind | null>(() => {
    if (!activeDefinition) return null;
    return resolvePlatformWorkspaceAdapterKind({
      connectorId: activeConnectorId,
      workspaceKind: activeDefinition.workspaceKind,
      platformTemplate: resolvePlatformConnectorTemplate(activeDefinition),
    });
  }, [activeConnectorId, activeDefinition]);
  const activeVideoItem = useMemo<RegisteredPlatformItem | null>(
    () => (activeWorkspaceAdapterKind === 'bilibili' ? activeItem : null),
    [activeItem, activeWorkspaceAdapterKind]
  );
  const activeMusicItem = useMemo<RegisteredPlatformItem | null>(
    () => (activeWorkspaceAdapterKind === 'music' ? activeItem : null),
    [activeItem, activeWorkspaceAdapterKind]
  );
  const activeMusicConnectorId = activeMusicItem?.entry.connectorId ?? null;
  const activeMusicDefinition = activeMusicItem?.definition ?? null;
  const activeMusicContractRecord = activeMusicItem?.contractRecord ?? null;
  const activeMusicInstanceId = activeMusicItem?.instance?.instanceId ?? null;
  const activeMusicAuthState = activeMusicItem?.facade?.authState ?? null;
  const activeMusicDisplayName = useMemo(() => {
    if (!activeMusicItem) return null;
    if (activeMusicDefinition?.labelKey) {
      return t(activeMusicDefinition.labelKey);
    }
    return (
      activeMusicItem.facade?.displayName ??
      activeMusicDefinition?.displayName ??
      activeMusicConnectorId
    );
  }, [activeMusicConnectorId, activeMusicDefinition, activeMusicItem, t]);

  const platformPlaylistsByConnectorId = useMemo(() => {
    const next = new Map<string, AudioPlaylist[]>();
    for (const playlist of allPlaylists) {
      if (playlist.kind !== 'platform') continue;
      const connectorId = typeof playlist.sourceConnectorId === 'string' ? playlist.sourceConnectorId.trim() : '';
      if (!connectorId) continue;
      const bucket = next.get(connectorId) ?? [];
      bucket.push(playlist);
      next.set(connectorId, bucket);
    }
    return next;
  }, [allPlaylists]);
  const activePlatformPlaylists = useMemo(
    () => (activeConnectorId ? platformPlaylistsByConnectorId.get(activeConnectorId) ?? [] : []),
    [activeConnectorId, platformPlaylistsByConnectorId]
  );
  const selectedPlaylistId = activeConnectorId
    ? selectedPlaylistIdsByConnector[activeConnectorId] ?? activePlatformPlaylists[0]?.id ?? null
    : null;
  const localPlaylists = workspacePlaylists;
  const resolvedSelectedLocalPlaylistId =
    selectedLocalPlaylistId && localPlaylists.some((playlist) => playlist.id === selectedLocalPlaylistId)
      ? selectedLocalPlaylistId
      : localPlaylists[0]?.id ?? null;
  const selectedLocalPlaylist = useMemo(
    () =>
      localPlaylists.find((playlist) => playlist.id === resolvedSelectedLocalPlaylistId) ??
      localPlaylists[0] ??
      null,
    [localPlaylists, resolvedSelectedLocalPlaylistId]
  );

  useEffect(() => {
    if (!activeConnectorId || activePlatformPlaylists.length === 0) return;
    if (
      selectedPlaylistId &&
      activePlatformPlaylists.some((playlist) => playlist.id === selectedPlaylistId)
    ) {
      return;
    }

    setSelectedPlaylistIdsByConnector((prev) => ({
      ...prev,
      [activeConnectorId]: activePlatformPlaylists[0]?.id ?? '',
    }));
  }, [activeConnectorId, activePlatformPlaylists, selectedPlaylistId]);

  useEffect(() => {
    if (localPlaylists.length === 0) {
      if (selectedLocalPlaylistId !== null) {
        setSelectedLocalPlaylistId(null);
      }
      return;
    }

    if (
      selectedLocalPlaylistId &&
      localPlaylists.some((playlist) => playlist.id === selectedLocalPlaylistId)
    ) {
      return;
    }

    setSelectedLocalPlaylistId(localPlaylists[0]?.id ?? null);
  }, [localPlaylists, selectedLocalPlaylistId]);

  useEffect(() => {
    setPlaylistError(null);
  }, [activeConnectorId]);

  useEffect(() => {
    const availableConnectorIds = registeredItems
      .filter((item) => isSearchFilterableConnector(item.definition))
      .map((item) => item.entry.connectorId);
    const availableConnectorIdSet = new Set<string>(availableConnectorIds);
    setSelectedFilterConnectorIds((current) => {
      const next = current.filter((connectorId) => availableConnectorIdSet.has(connectorId));
      if (availableConnectorIds.length === 0) return [];
      return next.length > 0 ? next : availableConnectorIds;
    });
  }, [registeredItems]);

  useEffect(() => {
    if (!createOpen || !createNameEditing || createView !== 'create') return;

    const frameId = window.requestAnimationFrame(() => {
      createNameInputRef.current?.focus();
      createNameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [createNameEditing, createOpen, createView]);

  const handleSelectLocalPlaylist = useCallback(
    (playlistId: string) => {
      setSelectedLocalPlaylistId(playlistId);
      setActivePage('local');
      setSubmittedQuery('');
    },
    []
  );

  const handlePlayLocalPlaylist = useCallback(async () => {
    if (!selectedLocalPlaylist) return;
    await audioService.playPlaylist(selectedLocalPlaylist.id);
  }, [audioService, selectedLocalPlaylist]);

  const handlePlayLocalTrackAtIndex = useCallback(
    async (trackIndex: number) => {
      if (!selectedLocalPlaylist) return;
      await audioService.playPlaylist(selectedLocalPlaylist.id);
      if (trackIndex > 0) {
        await audioService.playTrackAtIndex(trackIndex);
      }
    },
    [audioService, selectedLocalPlaylist]
  );

  const handleDeleteLocalPlaylist = useCallback(async () => {
    if (!selectedLocalPlaylist) return;

    const ok = await confirm({
      title: t('magnet.platform.confirm.local.deletePlaylist.title'),
      message: t('magnet.platform.confirm.local.deletePlaylist.message', {
        name: selectedLocalPlaylist.name,
      }),
      confirmText: t('common.action.delete'),
      cancelText: t('common.action.cancel'),
      danger: true,
    });
    if (!ok) return;

    audioService.deletePlaylist(selectedLocalPlaylist.id);
  }, [audioService, confirm, selectedLocalPlaylist, t]);

  const handleRemoveTrackFromLocalPlaylist = useCallback(
    async (trackIndex: number) => {
      if (!selectedLocalPlaylist) return;
      const track = selectedLocalPlaylist.tracks[trackIndex];
      const trackLabel = track?.title?.trim() || `${trackIndex + 1}`;

      const ok = await confirm({
        title: t('magnet.platform.confirm.local.removeTrack.title'),
        message: t('magnet.platform.confirm.local.removeTrack.message', {
          track: trackLabel,
          playlist: selectedLocalPlaylist.name,
        }),
        confirmText: t('common.action.remove'),
        cancelText: t('common.action.cancel'),
        danger: true,
      });
      if (!ok) return;

      audioService.removeTrackFromPlaylist(selectedLocalPlaylist.id, trackIndex);
    },
    [audioService, confirm, selectedLocalPlaylist, t]
  );

  const settingsConnectorDefinition = useMemo<PlatformConnectorDefinition | null>(() => {
    if (settingsTab === 'global') return null;
    return platformDefinitionsById.get(settingsTab as PlatformConnectorId) ?? null;
  }, [platformDefinitionsById, settingsTab]);
  const settingsWorkspaceAdapterKind = useMemo(() => {
    if (!settingsConnectorDefinition) return null;
    return resolvePlatformWorkspaceAdapterKind({
      connectorId: settingsConnectorDefinition.connectorId,
      workspaceKind: settingsConnectorDefinition.workspaceKind,
      platformTemplate: resolvePlatformConnectorTemplate(settingsConnectorDefinition),
    });
  }, [settingsConnectorDefinition]);
  const settingsItems = useMemo(
    () =>
      settingsTab === 'global'
        ? []
        : registeredItems.filter((item) => item.entry.connectorId === settingsTab),
    [registeredItems, settingsTab]
  );
  const settingsItem = settingsItems[0] ?? null;
  const settingsMusicItem = useMemo<RegisteredPlatformItem | null>(
    () => (settingsWorkspaceAdapterKind === 'music' ? settingsItem : null),
    [settingsItem, settingsWorkspaceAdapterKind]
  );
  const settingsVideoItem = useMemo<RegisteredPlatformItem | null>(
    () => (settingsWorkspaceAdapterKind === 'bilibili' ? settingsItem : null),
    [settingsItem, settingsWorkspaceAdapterKind]
  );
  const settingsMusicConnectorId = settingsMusicItem?.entry.connectorId ?? null;
  const settingsMusicDefinition = settingsMusicItem?.definition ?? null;
  const settingsMusicContractRecord = settingsMusicItem?.contractRecord ?? null;
  const settingsMusicInstanceId = settingsMusicItem?.instance?.instanceId ?? null;
  const settingsMusicAuthState = settingsMusicItem?.facade?.authState ?? null;
  const settingsMusicDisplayName = useMemo(() => {
    if (!settingsMusicItem) return null;
    if (settingsMusicDefinition?.labelKey) {
      return t(settingsMusicDefinition.labelKey);
    }
    return (
      settingsMusicItem.facade?.displayName ??
      settingsMusicDefinition?.displayName ??
      settingsMusicConnectorId
    );
  }, [settingsMusicConnectorId, settingsMusicDefinition, settingsMusicItem, t]);
  const controllerVideoItem =
    (settingsOpen && settingsVideoItem ? settingsVideoItem : activeVideoItem) ?? null;

  const bilibiliController = useBilibiliWorkspaceAdapterController({
    activeWorkspaceConnectorId,
    activeVideoConnectorId: controllerVideoItem?.entry.connectorId ?? null,
    activeVideoInstanceId: controllerVideoItem?.instance?.instanceId ?? null,
    activeVideoAuthState: controllerVideoItem?.facade?.authState ?? null,
    audioService,
    t,
    selectedLocalPlaylistId: resolvedSelectedLocalPlaylistId,
    playlistError,
    setPlaylistError,
  });

  const musicTemplateController = useMusicTemplateWorkspaceAdapterController({
    activeWorkspaceConnectorId,
    activeMusicConnectorId,
    activeMusicDisplayName,
    activeMusicContractRecord,
    activeMusicInstanceId,
    activeMusicAuthState,
    prefersDarkMode: true,
    audioService,
    t,
    selectedPlaylistId,
    playlistError,
    setPlaylistError,
  });
  const settingsMusicTemplateController = useMusicTemplateWorkspaceAdapterController({
    activeWorkspaceConnectorId: settingsMusicConnectorId,
    activeMusicConnectorId: settingsMusicConnectorId,
    activeMusicDisplayName: settingsMusicDisplayName,
    activeMusicContractRecord: settingsMusicContractRecord,
    activeMusicInstanceId: settingsMusicInstanceId,
    activeMusicAuthState: settingsMusicAuthState,
    prefersDarkMode: true,
    audioService,
    t,
    selectedPlaylistId: null,
    playlistError,
    setPlaylistError,
  });
  const musicTemplatePlatformLabel =
    activeMusicDisplayName ?? musicTemplateController.musicTemplateWorkspaceProps.platformLabel;
  const musicTemplateVisualMeta = getConnectorVisualMeta(
    activeMusicConnectorId,
    activeMusicDefinition
  );
  const musicTemplatePlatformAccentColor = musicTemplateVisualMeta.color;
  const musicTemplatePlatformFallbackLabel =
    musicTemplatePlatformLabel.trim().charAt(0).toUpperCase() || 'M';
  const musicTemplateWorkspaceProps = {
    ...musicTemplateController.musicTemplateWorkspaceProps,
    platformLabel: musicTemplatePlatformLabel,
    platformAccentColor: musicTemplatePlatformAccentColor,
    platformFallbackLabel: musicTemplatePlatformFallbackLabel,
    platformIconAssetUrl: musicTemplateVisualMeta.iconAssetUrl ?? null,
  };

  const placeholderController = useDedicatedWorkspacePlaceholderController({
    activeWorkspaceDescriptor,
    t,
  });

  const connectorIdsByAdapterKind = useMemo(() => {
    const next = new Map<PlatformWorkspaceAdapterKind, string[]>();
    for (const item of registeredItems) {
      if (!item.definition) continue;
      const adapterKind = resolvePlatformWorkspaceAdapterKind({
        connectorId: item.entry.connectorId,
        workspaceKind: item.definition.workspaceKind,
        platformTemplate: resolvePlatformConnectorTemplate(item.definition),
      });
      if (!adapterKind) continue;
      const bucket = next.get(adapterKind) ?? [];
      bucket.push(item.entry.connectorId);
      next.set(adapterKind, bucket);
    }
    return next;
  }, [registeredItems]);

  const workspaceTemplateAdapterPayloads: PlatformWorkspaceAdapterPayloadMap = {
    bilibili: {
      toolbar: {},
      workspace: bilibiliController.bilibiliWorkspaceProps,
    },
    music: {
      toolbar: musicTemplateController.musicTemplateToolbarProps,
      workspace: musicTemplateWorkspaceProps,
    },
    generic: {
      toolbar: placeholderController.placeholderToolbarProps,
      workspace: placeholderController.placeholderWorkspaceProps,
    },
  };

  const activeWorkspaceTemplateAdapter = useMemo(() => {
    if (!activeDefinition) return null;
    return resolvePlatformWorkspaceAdapter({
      connectorId: activeConnectorId,
      workspaceKind: activeDefinition.workspaceKind,
      platformTemplate: resolvePlatformConnectorTemplate(activeDefinition),
    });
  }, [activeConnectorId, activeDefinition]);

  const workspaceRuntimeAdapterRegistry = useMemo<Record<PlatformWorkspaceAdapterKind, WorkspaceRuntimeAdapter>>(
    () => ({
      bilibili: {
        shellSearch: bilibiliController.bilibiliShellSearch,
        shouldResetPageStageScroll: true,
        scrollResetToken: bilibiliController.bilibiliPreviewFolders.selectedFolderId,
        resolveDrawerConnectorId: () =>
          activeConnectorId ?? connectorIdsByAdapterKind.get('bilibili')?.[0] ?? null,
        selectDrawerFolder: (folderId) => {
          if (folderId) {
            bilibiliController.bilibiliPreviewFolders.onSelectFolder(folderId);
            return;
          }
          bilibiliController.bilibiliPreviewFolders.onShowRecommended();
        },
        buildDrawerGroup: () => {
          if (activePage !== 'instance' || !activeConnectorId) return null;
          const bilibiliItem =
            registeredItems.find((item) => item.entry.connectorId === activeConnectorId) ?? null;
          const bilibiliCollections = bilibiliController.bilibiliPreviewFolders.authorized
            ? [
                {
                  collectionId: null,
                  title: t('magnet.platform.bilibili.folder.recommendedEntry'),
                  count: null,
                },
                ...bilibiliController.bilibiliPreviewFolders.folders.map((folder) => ({
                  collectionId: folder.folderId,
                  title: folder.title,
                  count: folder.mediaCount,
                })),
              ]
            : [];

          return {
            id: activeConnectorId,
            connectorId: activeConnectorId,
            label: bilibiliItem?.definition?.labelKey
              ? t(bilibiliItem.definition.labelKey)
              : bilibiliItem?.facade?.displayName ?? activeConnectorId,
            playlists: platformPlaylistsByConnectorId.get(activeConnectorId) ?? [],
            collections: bilibiliCollections,
            selectedCollectionId: bilibiliController.bilibiliPreviewFolders.selectedFolderId,
            collectionSectionLabelKey: 'magnet.platform.bilibili.folder.title',
            playlistSectionLabelKey: 'magnet.platform.bilibili.drawer.playlists.open',
            collectionLoading: bilibiliController.bilibiliPreviewFolders.loading,
            collectionError: bilibiliController.bilibiliPreviewFolders.error,
          };
        },
        renderSettingsPanel: () => (
          <BilibiliPlaybackSettingsContent {...bilibiliController.bilibiliSettingsProps} />
        ),
      },
      music: {
        shellSearch: musicTemplateController.musicTemplateShellSearch,
        resolveDrawerConnectorId: () =>
          activeMusicConnectorId ?? connectorIdsByAdapterKind.get('music')?.[0] ?? null,
        selectDrawerPlaylist: (playlistId) => {
          const targetPlaylist =
            musicTemplateController.musicTemplateDrawerPlaylists.find(
              (playlist) => playlist.id === playlistId
            ) ?? null;
          const collectionId = targetPlaylist?.sourcePlaylistId?.trim() || targetPlaylist?.id?.trim() || '';
          if (!collectionId) return;
          musicTemplateController.musicTemplateOpenDrawerPlaylist(collectionId);
        },
        handleBackAction: () => {
          if (!musicTemplateController.musicTemplateCanGoBack) {
            return false;
          }
          return musicTemplateController.musicTemplateHandleBackAction();
        },
        buildDrawerGroup: () => {
          const connectorId =
            activeMusicConnectorId ?? connectorIdsByAdapterKind.get('music')?.[0] ?? null;
          if (activePage !== 'instance' || !connectorId) return null;
          const musicItem =
            registeredItems.find((item) => item.entry.connectorId === connectorId) ?? null;

          return {
            id: connectorId,
            connectorId,
            label: musicItem?.definition?.labelKey
              ? t(musicItem.definition.labelKey)
              : musicItem?.facade?.displayName ?? connectorId,
            playlists: musicTemplateController.musicTemplateDrawerPlaylists,
            playlistSectionLabelKey: 'magnet.platform.music-template.playlist.title',
            collectionLoading: musicTemplateController.musicTemplateWorkspaceProps.collectionLoading,
            collectionError: musicTemplateController.musicTemplateWorkspaceProps.collectionError,
          };
        },
        renderSettingsPanel: () =>
          settingsMusicTemplateController.musicTemplateSettingsSupported ? (
            <MusicTemplatePlaybackSettingsContent
              {...settingsMusicTemplateController.musicTemplateSettingsProps}
            />
          ) : null,
      },
      generic: {},
    }),
    [
      activeConnectorId,
      activeMusicConnectorId,
      activePage,
      bilibiliController.bilibiliPreviewFolders,
      bilibiliController.bilibiliSettingsProps,
      bilibiliController.bilibiliShellSearch,
      connectorIdsByAdapterKind,
      musicTemplateController,
      settingsMusicTemplateController,
      platformPlaylistsByConnectorId,
      registeredItems,
      t,
    ]
  );

  const activeWorkspaceRuntimeAdapter = useMemo<WorkspaceRuntimeAdapter | null>(() => {
    if (!activeWorkspaceAdapterKind) return null;
    return workspaceRuntimeAdapterRegistry[activeWorkspaceAdapterKind] ?? null;
  }, [activeWorkspaceAdapterKind, workspaceRuntimeAdapterRegistry]);

  const activeWorkspaceShellSearch =
    activePage === 'instance' ? activeWorkspaceRuntimeAdapter?.shellSearch ?? null : null;

  useEffect(() => {
    if (activePage !== 'instance') return;
    if (!activeWorkspaceRuntimeAdapter?.shouldResetPageStageScroll) return;
    const pageStageElement = pageStageScrollRef.current;
    if (!pageStageElement) return;
    pageStageElement.scrollTop = 0;
    pageStageElement.scrollLeft = 0;
  }, [
    activePage,
    activeWorkspaceRuntimeAdapter?.shouldResetPageStageScroll,
    activeWorkspaceRuntimeAdapter?.scrollResetToken,
  ]);

  const closeTopMenus = useCallback(() => {
    setLauncherOpen(false);
    setNavOpen(false);
    setFilterOpen(false);
  }, []);

  const closeCreateDialog = useCallback(() => {
    setCreateOpen(false);
    setCreateView('create');
    setCreateName('');
    setCreateNameEditing(false);
  }, []);

  const openCreateDialog = useCallback(() => {
    setCreateOpen(true);
    setCreateView('create');
    setCreateName('');
    setCreateNameEditing(false);
  }, []);

  const commitCreateName = useCallback(() => {
    setCreateName((current) => current.trim());
    setCreateNameEditing(false);
  }, []);

  const handleSelectConnector = useCallback((connectorId: string) => {
    setSelectedConnectorId(connectorId);
    setActivePage('instance');
    setSubmittedQuery('');
    closeTopMenus();
  }, [closeTopMenus]);

  const handleSearchSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activeWorkspaceShellSearch) {
      setSubmittedQuery('');
      activeWorkspaceShellSearch.onSubmit();
      closeTopMenus();
      return;
    }

    if (activePage === 'local') {
      closeTopMenus();
      return;
    }

    setSubmittedQuery(query.trim());
    closeTopMenus();
  }, [
    activePage,
    activeWorkspaceShellSearch,
    closeTopMenus,
    query,
  ]);

  const handleSelectDrawerPlaylist = useCallback(
    (connectorId: string | null, playlistId: string) => {
      if (connectorId === null) {
        setSelectedLocalPlaylistId(playlistId);
        setActivePage('local');
        setSubmittedQuery('');
        setDrawerOpen(false);
        return;
      }

      const mountedFallbackConnectorId =
        registeredItems.find((item) => item.renderSelection?.mounted === true)?.entry.connectorId ?? null;
      const targetConnectorId =
        connectorId ?? activeConnectorId ?? mountedFallbackConnectorId ?? registeredItems[0]?.entry.connectorId ?? null;
      if (!targetConnectorId) {
        setDrawerOpen(false);
        return;
      }

      setSelectedPlaylistIdsByConnector((prev) => ({
        ...prev,
        [targetConnectorId]: playlistId,
      }));

      const runtimeDrawerConnectorId = activeWorkspaceRuntimeAdapter?.resolveDrawerConnectorId?.() ?? null;
      if (
        activePage === 'instance' &&
        runtimeDrawerConnectorId === targetConnectorId &&
        activeWorkspaceRuntimeAdapter?.selectDrawerPlaylist
      ) {
        activeWorkspaceRuntimeAdapter.selectDrawerPlaylist(playlistId);
      }

      // Local playlists should still land in a renderable workspace context.
      // If the resolved connector is authorized but not mounted yet, auto-mount it.
      const targetItem = registeredItems.find((item) => item.entry.connectorId === targetConnectorId) ?? null;
      const canAutoMount =
        connectorId === null &&
        Boolean(targetItem?.instance) &&
        targetItem?.renderSelection?.mounted !== true &&
        targetItem?.facade?.authState === 'authorized';
      if (canAutoMount && targetItem?.instance) {
        setPlatformRenderSelectionMounted(targetItem.instance.instanceId, true);
      }

      setSelectedConnectorId(targetConnectorId);
      setActivePage('instance');
      setSubmittedQuery('');
      setDrawerOpen(false);
    },
    [activeConnectorId, activePage, activeWorkspaceRuntimeAdapter, registeredItems]
  );

  const handleSelectWorkspaceDrawerFolder = useCallback(
    (folderId: string | null) => {
      const resolveDrawerConnectorId = activeWorkspaceRuntimeAdapter?.resolveDrawerConnectorId;
      const selectDrawerFolder = activeWorkspaceRuntimeAdapter?.selectDrawerFolder;
      if (!resolveDrawerConnectorId || !selectDrawerFolder) {
        setDrawerOpen(false);
        return;
      }

      const connectorId = resolveDrawerConnectorId();
      if (!connectorId) {
        setDrawerOpen(false);
        return;
      }

      selectDrawerFolder(folderId);
      setSelectedConnectorId(connectorId);
      setActivePage('instance');
      setSubmittedQuery('');
      setDrawerOpen(false);
    },
    [activeWorkspaceRuntimeAdapter]
  );

  const handleCreateLocalPlaylist = useCallback(() => {
    const nextPlaylist = audioService.createPlaylist(
      createName.trim() || t('magnet.platform.local.create.defaultName'),
      '',
      { kind: 'manual' }
    );
    setSelectedLocalPlaylistId(nextPlaylist.id);
    setActivePage('local');
    setSubmittedQuery('');
    closeCreateDialog();
  }, [audioService, closeCreateDialog, createName, t]);

  const handleToggleMounted = useCallback((item: RegisteredPlatformItem) => {
    if (!item.instance) return;

    const nextMounted = item.renderSelection?.mounted !== true;
    setPlatformRenderSelectionMounted(item.instance.instanceId, nextMounted);
    if (nextMounted) {
      setSelectedConnectorId(item.entry.connectorId);
    }
  }, []);

  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all(
        registeredItems.map(async (item) => {
          if (!item.definition) return;
          await refreshAndEmitPlatformConnectorAuthSnapshot(item.definition.connectorId);
        })
      );
      await refreshConnectorViews();
    } catch (error) {
      telemetry.warn('platform.runtime.refresh-all.failed', {
        message: readTelemetryErrorMessage(error),
      });
    } finally {
      setRefreshing(false);
    }
  }, [refreshConnectorViews, registeredItems, telemetry]);

  const refreshGlobalCacheSettings = useCallback(async () => {
    setGlobalCacheSettingsLoading(true);
    setGlobalCacheSettingsError(null);
    setGlobalCacheSettingsInfo(null);
    try {
      const settings = await getMusicPlatformGlobalCacheSettings();
      setGlobalCacheSettings(settings);
      setGlobalCachePathDraft(settings?.customRootPath ?? '');
    } catch (error) {
      setGlobalCacheSettingsError(
        error instanceof Error
          ? error.message
          : t('magnet.platform.global.cache.errorLoad')
      );
    } finally {
      setGlobalCacheSettingsLoading(false);
    }
  }, [t]);

  const handleBrowseGlobalCachePath = useCallback(async () => {
    const selected = await pickMusicPlatformGlobalCacheDirectory();
    if (!selected) return;
    setGlobalCachePathDraft(selected);
    setGlobalCacheSettingsInfo(null);
  }, []);

  const handleSaveGlobalCachePath = useCallback(async () => {
    if (globalCacheSettingsSaving) return;

    setGlobalCacheSettingsSaving(true);
    setGlobalCacheSettingsError(null);
    setGlobalCacheSettingsInfo(null);
    try {
      const settings = await setMusicPlatformGlobalCacheSettings(globalCachePathDraft);
      setGlobalCacheSettings(settings);
      setGlobalCachePathDraft(settings?.customRootPath ?? '');
      setGlobalCacheSettingsInfo(t('magnet.platform.global.cache.stateSaved'));
    } catch (error) {
      setGlobalCacheSettingsError(
        error instanceof Error
          ? error.message
          : t('magnet.platform.global.cache.errorSave')
      );
    } finally {
      setGlobalCacheSettingsSaving(false);
    }
  }, [globalCachePathDraft, globalCacheSettingsSaving, t]);

  const handleResetGlobalCachePath = useCallback(async () => {
    if (globalCacheSettingsSaving) return;

    setGlobalCacheSettingsSaving(true);
    setGlobalCacheSettingsError(null);
    setGlobalCacheSettingsInfo(null);
    try {
      const settings = await setMusicPlatformGlobalCacheSettings(undefined);
      setGlobalCacheSettings(settings);
      setGlobalCachePathDraft('');
      setGlobalCacheSettingsInfo(t('magnet.platform.global.cache.stateReset'));
    } catch (error) {
      setGlobalCacheSettingsError(
        error instanceof Error
          ? error.message
          : t('magnet.platform.global.cache.errorSave')
      );
    } finally {
      setGlobalCacheSettingsSaving(false);
    }
  }, [globalCacheSettingsSaving, t]);

  const registeredCount = registeredItems.length;
  const loadedCount = registeredItems.filter((item) => item.renderSelection?.mounted === true).length;
  const authorizedCount = registeredItems.filter((item) => item.facade?.authState === 'authorized').length;
  const launcherPreviewItems = useMemo(
    () =>
      [...registeredItems]
        .sort((left, right) => {
          const leftActive = left.entry.connectorId === activeConnectorId ? 1 : 0;
          const rightActive = right.entry.connectorId === activeConnectorId ? 1 : 0;
          if (leftActive !== rightActive) {
            return rightActive - leftActive;
          }

          const leftMounted = left.renderSelection?.mounted === true ? 1 : 0;
          const rightMounted = right.renderSelection?.mounted === true ? 1 : 0;
          if (leftMounted !== rightMounted) {
            return rightMounted - leftMounted;
          }

          const leftAuthorized = left.facade?.authState === 'authorized' ? 1 : 0;
          const rightAuthorized = right.facade?.authState === 'authorized' ? 1 : 0;
          if (leftAuthorized !== rightAuthorized) {
            return rightAuthorized - leftAuthorized;
          }

          return left.entry.connectorId.localeCompare(right.entry.connectorId, 'zh-CN');
        })
        .slice(0, 3),
    [activeConnectorId, registeredItems]
  );
  const launcherPreviewOverflowCount = Math.max(0, registeredCount - launcherPreviewItems.length);
  const activeConnectorLabel =
    activeDefinition?.labelKey
      ? t(activeDefinition.labelKey)
      : activeFacade?.displayName ?? activeInstance?.displayName ?? '';
  const activeAuthLabel = t(toAuthLabelKey(activeFacade?.authState));
  const activeVisualMeta = resolveConnectorVisualMeta(activeConnectorId, activeDefinition);
  const activeMounted = activeRenderSelection?.mounted === true;
  const activeCanToggleMounted = Boolean(activeInstance) && (activeMounted || activeFacade?.authState === 'authorized');
  const activeWorkspacePlaylistOpener =
    activePage === 'instance' && activeMounted
      ? activeWorkspaceRuntimeAdapter?.playlistOpener ?? null
      : null;
  const activeWorkspacePrimaryActionLabel =
    activeWorkspacePlaylistOpener && activeWorkspaceRuntimeAdapter?.playlistActionLabelKey
      ? t(activeWorkspaceRuntimeAdapter.playlistActionLabelKey)
      : t('magnet.platform.fab.playlists');
  const activeWorkspacePrimaryActionTitle =
    activeWorkspacePlaylistOpener ? activeWorkspacePrimaryActionLabel : t('magnet.platform.action.openDrawer');
  const shellSearchValue = activeWorkspaceShellSearch?.value ?? (activePage === 'local' ? localQuery : query);
  const shellSearchPlaceholder = activeWorkspaceShellSearch?.placeholder ??
    (activePage === 'local'
      ? t('pages.playlists.manage.search.placeholder')
      : t('magnet.platform.search.filterTitle'));
  const shellSearchDisabled = activeWorkspaceShellSearch?.disabled ?? false;
  const searchReadyCount = registeredItems.filter(
    (item) =>
      item.facade?.authState === 'authorized' && item.contractRecord?.contract.capabilities.search === true
  ).length;
  const dailyItems = registeredItems.filter(
    (item) => item.facade?.authState === 'authorized' || item.renderSelection?.mounted === true
  );
  const normalizedQuery = submittedQuery.trim().toLowerCase();
  const heroSubtitle = activeItem
    ? activeMounted
      ? t('magnet.platform.hero.featuredIdle', { platform: activeConnectorLabel || t('magnet.platform.title') })
      : t('magnet.platform.hero.subtitle')
    : t('magnet.platform.subtitle');
  const matchesSearch = useCallback(
    (item: RegisteredPlatformItem): boolean => {
      if (!normalizedQuery) return true;

      const label = item.definition?.labelKey
        ? t(item.definition.labelKey)
        : item.facade?.displayName ?? item.entry.connectorId;
      const haystack = [
        label,
        item.entry.connectorId,
        item.facade?.accountUid,
        item.instance?.account.accountId,
        item.instance?.account.accountName,
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    },
    [normalizedQuery, t]
  );
  const matchesConnectorFilter = useCallback(
    (item: RegisteredPlatformItem): boolean => {
      if (selectedFilterConnectorIds.length === 0) return true;
      if (!isSearchFilterableConnector(item.definition)) return true;
      return selectedFilterConnectorIds.includes(item.entry.connectorId);
    },
    [selectedFilterConnectorIds]
  );
  const filteredRegisteredItems = useMemo(
    () =>
      registeredItems.filter(
        (item) => matchesConnectorFilter(item) && matchesSearch(item)
      ),
    [matchesConnectorFilter, matchesSearch, registeredItems]
  );
  const filteredDailyItems = useMemo(
    () =>
      dailyItems.filter(
        (item) => matchesConnectorFilter(item) && matchesSearch(item)
      ),
    [dailyItems, matchesConnectorFilter, matchesSearch]
  );
  const showBackButton = Boolean(submittedQuery) || activePage !== 'daily';
  const showDailyFilter = activePage === 'daily';
  const defaultCreateName = t('magnet.platform.local.create.defaultName');
  const filterableRegisteredItems = useMemo(
    () => registeredItems.filter((item) => isSearchFilterableConnector(item.definition)),
    [registeredItems]
  );
  const drawerGroups = useMemo<PlaylistDrawerGroup[]>(() => {
    const groups: PlaylistDrawerGroup[] = [];
    const workspaceGroup = activeWorkspaceRuntimeAdapter?.buildDrawerGroup?.() ?? null;
    if (workspaceGroup) {
      groups.push(workspaceGroup);
    }

    if (localPlaylists.length > 0 && activePage !== 'instance') {
      groups.push({
        id: 'local',
        connectorId: null,
        label: t('magnet.platform.drawer.local'),
        playlists: localPlaylists,
      });
    }

    return groups.filter(
      (group) =>
        group.connectorId === null ||
        group.playlists.length > 0 ||
        (group.collections?.length ?? 0) > 0 ||
        Boolean(group.collectionLoading) ||
        Boolean(group.collectionError)
    );
  }, [
    activePage,
    activeWorkspaceRuntimeAdapter,
    localPlaylists,
    t
  ]);
  const settingsNavItems = useMemo(
    () => Array.from(new Map(registeredItems.map((item) => [item.entry.connectorId, item])).values()),
    [registeredItems]
  );
  const settingsNavConnectorIdSet = useMemo(
    () => new Set(settingsNavItems.map((item) => item.entry.connectorId)),
    [settingsNavItems]
  );
  const preferredSettingsTab: SettingsTabId =
    activePage === 'instance' && activeConnectorId && settingsNavConnectorIdSet.has(activeConnectorId)
      ? activeConnectorId
      : 'global';
  const settingsLabel =
    settingsConnectorDefinition?.labelKey
      ? t(settingsConnectorDefinition.labelKey)
      : settingsConnectorDefinition?.displayName ?? settingsItem?.entry.connectorId ?? '';
  const settingsContract = settingsItem?.contractRecord?.contract ?? null;
  const settingsWorkspaceRuntimeAdapter =
    settingsWorkspaceAdapterKind ? workspaceRuntimeAdapterRegistry[settingsWorkspaceAdapterKind] ?? null : null;
  const settingsWorkspacePanel =
    settingsItems.length > 0 && settingsWorkspaceRuntimeAdapter?.renderSettingsPanel
      ? settingsWorkspaceRuntimeAdapter.renderSettingsPanel({
          settingsLabel,
          settingsItems,
        })
      : null;

  useEffect(() => {
    if (!settingsOpen || settingsTab !== 'global') return;
    void refreshGlobalCacheSettings();
  }, [refreshGlobalCacheSettings, settingsOpen, settingsTab]);

  useEffect(() => {
    if (!settingsOpen || settingsTab === 'global') return;
    if (settingsNavItems.some((item) => item.entry.connectorId === settingsTab)) return;
    setSettingsTab('global');
  }, [settingsNavItems, settingsOpen, settingsTab]);

  useEffect(() => {
    if (!showDailyFilter && filterOpen) {
      setFilterOpen(false);
    }
  }, [filterOpen, showDailyFilter]);

  useEffect(() => {
    if (activePage !== 'local' && localQuery.length > 0) {
      setLocalQuery('');
    }
  }, [activePage, localQuery]);

  useEffect(() => {
    let frameId = 0;
    setContentTransitionPhase('exiting');

    const timerId = window.setTimeout(() => {
      setContentTransitionPhase('entering');
      frameId = window.requestAnimationFrame(() => {
        setContentTransitionPhase('entered');
      });
    }, 140);

    return () => {
      window.clearTimeout(timerId);
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [activePage, submittedQuery]);

  const renderWorkspaceToolbar = () => {
    if (activeWorkspaceTemplateAdapter) {
      return renderPlatformWorkspaceAdapterToolbar(
        activeWorkspaceTemplateAdapter,
        workspaceTemplateAdapterPayloads
      );
    }

    return <DedicatedWorkspacePlaceholderToolbar {...placeholderController.placeholderToolbarProps} />;
  };

  const renderWorkspaceBody = () => {
    if (activeWorkspaceTemplateAdapter) {
      return renderPlatformWorkspaceAdapterWorkspace(
        activeWorkspaceTemplateAdapter,
        workspaceTemplateAdapterPayloads
      );
    }

    return <DedicatedWorkspacePlaceholderAdapter {...placeholderController.placeholderWorkspaceProps} />;
  };

  const renderNavPopover = () => {
    if (!navOpen) return null;

    return (
      <div className="platform-preview-popover platform-preview-nav-panel absolute left-0 top-12 z-30 w-[244px] rounded-[22px] p-2.5 transition-all duration-150">
        <div className="platform-preview-nav-section">
          <button
            type="button"
            onClick={() => {
              setActivePage('daily');
              setSubmittedQuery('');
              setNavOpen(false);
            }}
            className={cx(
              'platform-preview-nav-entry flex w-full items-center gap-3 rounded-[16px] px-3.5 py-3 text-left text-sm transition-colors',
              activePage === 'daily'
                ? 'platform-preview-nav-entry-active text-white'
                : 'text-white/62 hover:text-white/88'
            )}
          >
            <Disc3 className="h-4 w-4 shrink-0" />
            <span className="truncate">{t('magnet.platform.daily.title')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActivePage('local');
              setSubmittedQuery('');
              setNavOpen(false);
            }}
            className={cx(
              'platform-preview-nav-entry flex w-full items-center gap-3 rounded-[16px] px-3.5 py-3 text-left text-sm transition-colors',
              activePage === 'local'
                ? 'platform-preview-nav-entry-active text-white'
                : 'text-white/62 hover:text-white/88'
            )}
          >
            <Library className="h-4 w-4 shrink-0" />
            <span className="truncate">{t('magnet.platform.nav.local')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActivePage('overview');
              setSubmittedQuery('');
              setNavOpen(false);
            }}
            className={cx(
              'platform-preview-nav-entry flex w-full items-center gap-3 rounded-[16px] px-3.5 py-3 text-left text-sm transition-colors',
              activePage === 'overview'
                ? 'platform-preview-nav-entry-active text-white'
                : 'text-white/62 hover:text-white/88'
            )}
          >
            <LayoutGrid className="h-4 w-4 shrink-0" />
            <span className="truncate">{t('magnet.platform.nav.overview')}</span>
          </button>
        </div>

        {filteredRegisteredItems.length > 0 ? (
          <>
            <div className="platform-preview-nav-divider" />
            <div className="platform-preview-nav-caption px-2">{t('magnet.platform.launcher.title')}</div>
            <div className="platform-preview-nav-section">
              {filteredRegisteredItems.map((item) => {
                const { Icon, color, iconAssetUrl } = resolveConnectorVisualMeta(
                  item.entry.connectorId,
                  item.definition
                );

                return (
                  <button
                    key={item.entry.connectorId}
                    type="button"
                    onClick={() => handleSelectConnector(item.entry.connectorId)}
                    className={cx(
                      'platform-preview-nav-instance flex w-full items-center justify-between gap-3 rounded-full px-4 py-3 text-left text-sm transition-colors',
                      activePage === 'instance' && item.entry.connectorId === activeConnectorId
                        ? 'platform-preview-nav-instance-active text-white'
                        : 'text-white/64 hover:text-white/88'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {iconAssetUrl ? (
                        <img
                          src={iconAssetUrl}
                          alt=""
                          aria-hidden
                          className="h-4 w-4 shrink-0 object-contain"
                        />
                      ) : (
                        <Icon className="h-4 w-4 shrink-0" style={{ color }} />
                      )}
                      <span className="truncate">
                        {item.facade?.accountUid ??
                          (item.definition?.labelKey
                            ? t(item.definition.labelKey)
                            : item.facade?.displayName ?? item.entry.connectorId)}
                      </span>
                    </div>
                    <span
                      className="platform-preview-nav-instance-status inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        background:
                          item.renderSelection?.mounted === true
                            ? '#22c55e'
                            : item.facade?.authState === 'authorized'
                              ? color
                              : 'rgba(255,255,255,0.22)',
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </>
        ) : registeredItems.length > 0 ? (
          <>
            <div className="platform-preview-nav-divider" />
            <div className="rounded-[18px] px-3 py-4 text-center text-xs text-white/46">{query.trim()}</div>
          </>
        ) : null}
      </div>
    );
  };

  const renderWorkspacePanel = () => {
    if (!activeContractRecord || !activeDefinition) {
      return (
        <div className="flex min-h-[340px] flex-1 flex-col items-center justify-center gap-3 rounded-[22px] border border-dashed border-white/10 bg-black/10 px-6 text-center">
          <LayoutGrid className="h-8 w-8 text-white/24" />
          <div className="text-base font-medium text-white">{t('magnet.platform-login.status.comingSoon')}</div>
          <p className="max-w-md text-sm leading-6 text-white/54">{t('magnet.platform.empty.noMountedHint')}</p>
        </div>
      );
    }

    if (!activeMounted) {
      return (
        <div className="flex min-h-[340px] flex-1 flex-col items-center justify-center gap-4 rounded-[22px] border border-dashed border-white/10 bg-black/10 px-6 text-center">
          <LayoutGrid className="h-8 w-8 text-white/24" />
          <div className="text-base font-medium text-white">{t('magnet.platform.empty.noMounted')}</div>
          <p className="max-w-md text-sm leading-6 text-white/54">{t('magnet.platform.empty.noMountedHint')}</p>
          <button
            type="button"
            onClick={() => activeItem && handleToggleMounted(activeItem)}
            disabled={!activeCanToggleMounted}
            className={cx(
              'platform-preview-detail-ghost inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm text-white/82',
              !activeCanToggleMounted && 'cursor-not-allowed opacity-50'
            )}
          >
            <Power className="h-4 w-4" />
            <span>{t('magnet.platform.instance.activateWorkspace')}</span>
          </button>
        </div>
      );
    }

    const workspaceToolbar = renderWorkspaceToolbar();

    return (
      <>
        {workspaceToolbar ? <div className="mt-3">{workspaceToolbar}</div> : null}
        <div className="mt-3 min-h-0 flex-1">
          {connectorViewsLoading && !activeFacade ? (
            <div className="platform-workspace-loading flex h-full min-h-[320px] items-center justify-center text-sm text-white/48">
              {t('common.state.loading')}
            </div>
          ) : (
            renderWorkspaceBody()
          )}
        </div>
      </>
    );
  };

  const handleGoBack = useCallback(() => {
    if (submittedQuery) {
      setSubmittedQuery('');
      setQuery('');
      return;
    }

    if (activePage === 'instance' && activeWorkspaceRuntimeAdapter?.handleBackAction?.()) {
      closeTopMenus();
      return;
    }

    if (activePage !== 'daily') {
      setActivePage('daily');
      closeTopMenus();
    }
  }, [activePage, activeWorkspaceRuntimeAdapter, closeTopMenus, submittedQuery]);

  const renderSearchPanel = () => (
    <div className="mx-auto max-w-5xl space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-white/62">
          <Search className="h-4 w-4" />
          <span>{submittedQuery}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setSubmittedQuery('');
            setQuery('');
          }}
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/62"
        >
          {t('common.action.close')}
        </button>
      </div>

      {filteredRegisteredItems.length > 0 ? (
        <div className="space-y-2">
          {filteredRegisteredItems.map((item) => {
            const { Icon, color, iconAssetUrl } = resolveConnectorVisualMeta(
              item.entry.connectorId,
              item.definition
            );
            const label = item.definition?.labelKey
              ? t(item.definition.labelKey)
              : item.facade?.displayName ?? item.entry.connectorId;

            return (
              <button
                key={item.entry.connectorId}
                type="button"
                onClick={() => handleSelectConnector(item.entry.connectorId)}
                className="platform-preview-card grid w-full grid-cols-[auto,minmax(0,1fr),auto] items-center gap-3 rounded-[18px] px-4 py-3 text-left"
              >
                <span className="platform-preview-channel-icon inline-flex h-11 w-11 items-center justify-center rounded-full">
                  {iconAssetUrl ? (
                    <img src={iconAssetUrl} alt="" aria-hidden className="h-5 w-5 object-contain" />
                  ) : (
                    <Icon className="h-5 w-5" style={{ color }} />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">{label}</span>
                  <span className="mt-1 block truncate text-xs text-white/42">
                    {[item.facade?.accountUid, item.entry.connectorId].filter(Boolean).join(' / ')}
                  </span>
                </span>
                <span className="text-xs text-white/42">
                  {t('magnet.platform.instance.auth', {
                    state: t(toAuthLabelKey(item.facade?.authState)),
                  })}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-[280px] items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/3 text-sm text-white/42">
          {t('magnet.platform.empty')}
        </div>
      )}
    </div>
  );

  const renderOverviewPanel = () => {
    const overviewGroups = [
      {
        id: 'registered',
        label: t('magnet.platform.runtime.statRegistered'),
        value: String(registeredCount),
        hint: t('magnet.platform.overview.statRegisteredHint'),
        Icon: Library,
      },
      {
        id: 'loaded',
        label: t('magnet.platform.runtime.statLoaded'),
        value: String(loadedCount),
        hint: t('magnet.platform.overview.statLoadedHint'),
        Icon: Disc3,
      },
      {
        id: 'authorized',
        label: t('magnet.platform.runtime.statAuthorized'),
        value: String(authorizedCount),
        hint: t('magnet.platform.overview.statAuthorizedHint'),
        Icon: Check,
      },
      {
        id: 'searchable',
        label: t('magnet.platform.runtime.statSearchable'),
        value: String(searchReadyCount),
        hint: t('magnet.platform.overview.statSearchableHint'),
        Icon: Search,
      },
    ] as const;

    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center gap-3">
          <span className="platform-preview-soft-ring inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/4 text-white/72">
            <LayoutGrid className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
              {t('magnet.platform.nav.overview')}
            </div>
            <div className="mt-2 text-sm font-medium text-white">
              {t('magnet.platform.overview.statusTitle')}
            </div>
            <div className="text-xs text-white/42">{t('magnet.platform.overview.statusDesc')}</div>
          </div>
        </div>

        {activeItem ? (
          <section className="platform-preview-detail-hero relative overflow-hidden rounded-[28px] px-6 pb-6 pt-7">
            <div
              className="platform-preview-detail-backdrop absolute inset-x-0 top-0 h-[220px]"
              style={
                {
                  '--platform-detail-accent': activeVisualMeta.color,
                } as React.CSSProperties
              }
            />
            <div className="relative z-[1]">
              <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex min-w-0 flex-1 items-start gap-5">
                  <div className="platform-preview-detail-cover flex h-24 w-24 shrink-0 items-center justify-center rounded-[20px]">
                    <span className="platform-preview-detail-cover-core inline-flex h-12 w-12 items-center justify-center rounded-full">
                      {activeVisualMeta.iconAssetUrl ? (
                        <img
                          src={activeVisualMeta.iconAssetUrl}
                          alt=""
                          aria-hidden
                          className="h-7 w-7 object-contain"
                        />
                      ) : (
                        <activeVisualMeta.Icon className="h-7 w-7" style={{ color: activeVisualMeta.color }} />
                      )}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1 pt-1">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-white/36">
                      {t('magnet.platform.hero.kicker')}
                    </div>
                    <h3 className="mt-3 truncate text-[34px] font-semibold tracking-[-0.04em] text-white xl:text-[42px]">
                      {activeConnectorLabel}
                    </h3>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-white/54">{heroSubtitle}</p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <span
                        className={cx(
                          'platform-preview-channel-tag inline-flex items-center rounded-full px-3 py-1 text-xs',
                          activeMounted ? 'bg-emerald-400/12 text-emerald-200' : 'text-white/62'
                        )}
                      >
                        {t(activeMounted ? 'magnet.platform.instance.loaded' : 'magnet.platform.instance.unloaded')}
                      </span>
                      <span className="platform-preview-channel-tag inline-flex items-center rounded-full px-3 py-1 text-xs text-white/62">
                        {t('magnet.platform.instance.auth', {
                          state: activeAuthLabel,
                        })}
                      </span>
                      {activeContractRecord ? (
                        <span className="platform-preview-channel-tag inline-flex items-center rounded-full px-3 py-1 text-xs text-white/62">
                          {t('magnet.platform.contract.version', {
                            version: activeContractRecord.contract.contractVersion,
                          })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {activeInstance ? (
                    <button
                      type="button"
                      onClick={() => handleToggleMounted(activeItem)}
                      disabled={!activeCanToggleMounted}
                      className={cx(
                        'platform-preview-detail-primary inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium',
                        !activeCanToggleMounted && 'cursor-not-allowed opacity-50'
                      )}
                      style={{ background: activeVisualMeta.color, color: '#081017' }}
                    >
                      <Power className="h-4 w-4" />
                      <span>
                        {t(
                          activeMounted
                            ? 'magnet.platform-login.action.deactivate'
                            : 'magnet.platform.instance.activateWorkspace'
                        )}
                      </span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => {
                      void handleRefreshAll();
                    }}
                    className="platform-preview-detail-ghost inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm text-white/78"
                    disabled={refreshing}
                  >
                    <RefreshCw className={cx('h-4 w-4', refreshing && 'animate-spin')} />
                    <span>{refreshing ? t('common.state.loading') : t('magnet.platform.action.refresh')}</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-4">
          {overviewGroups.map(({ id, label, value, hint, Icon }) => (
            <section key={id} className="platform-preview-card rounded-[22px] p-4">
              <div className="mb-4 flex items-center gap-3">
                <span className="platform-preview-soft-ring inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/4 text-white/62">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="text-sm text-white/72">{label}</div>
              </div>
              <div className="text-[28px] font-semibold tracking-[-0.04em] text-white">{value}</div>
              <div className="mt-2 text-xs text-white/48">{hint}</div>
            </section>
          ))}
        </div>
      </div>
    );
  };

  const renderDailyPanel = () => {
    if (registeredItems.length === 0) {
      return (
        <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <LayoutGrid className="h-8 w-8 text-white/24" />
          <div className="text-base font-medium text-white">{t('magnet.platform.empty.noRegistered')}</div>
          <p className="max-w-md text-sm leading-6 text-white/54">{t('magnet.platform.empty.noRegisteredHint')}</p>
        </div>
      );
    }

    if (dailyItems.length === 0) {
      return (
        <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <Disc3 className="h-8 w-8 text-white/24" />
          <div className="text-base font-medium text-white">{t('magnet.platform.daily.empty')}</div>
          <p className="max-w-md text-sm leading-6 text-white/54">{t('magnet.platform.daily.emptyHint')}</p>
        </div>
      );
    }

    if (filteredDailyItems.length === 0) {
      return (
        <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <Search className="h-8 w-8 text-white/24" />
          <div className="text-base font-medium text-white">{t('magnet.platform.empty')}</div>
          <p className="max-w-md text-sm leading-6 text-white/54">{query.trim()}</p>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-5xl space-y-6">
        {skinProps.showSummary ? (
          <div className="flex items-center gap-4 text-[11px] uppercase tracking-[0.18em] text-white/32">
            <span>
              {t('magnet.platform.summary.connectors', {
                total: registeredCount,
                authorized: authorizedCount,
              })}
            </span>
            <span>{t('magnet.platform.summary.loaded', { count: loadedCount })}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-center gap-8">
          {filteredDailyItems.map((item) => {
            const { Icon, color, iconAssetUrl } = resolveConnectorVisualMeta(
              item.entry.connectorId,
              item.definition
            );
            const mounted = item.renderSelection?.mounted === true;
            const canToggleMounted = item.facade?.authState === 'authorized' && Boolean(item.instance);
            const active = item.entry.connectorId === activeConnectorId && activePage === 'instance';
            const platformName = item.definition?.labelKey
              ? t(item.definition.labelKey)
              : item.facade?.displayName ?? item.entry.connectorId;

            return (
              <div
                key={item.entry.connectorId}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectConnector(item.entry.connectorId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSelectConnector(item.entry.connectorId);
                  }
                }}
                className="group flex cursor-pointer flex-col items-center gap-3 text-center outline-none"
              >
                <div
                  className={cx(
                    'platform-preview-record relative flex h-[176px] w-[176px] items-center justify-center overflow-hidden rounded-full transition-transform duration-200 group-hover:scale-[1.01]',
                    active && 'platform-preview-record-active'
                  )}
                >
                  <div className="platform-preview-record-center relative flex h-[68px] w-[68px] items-center justify-center rounded-full">
                    <div className="platform-preview-record-core flex h-[68px] w-[68px] items-center justify-center rounded-full">
                      <span className="platform-preview-record-icon inline-flex h-10 w-10 items-center justify-center rounded-full">
                        {iconAssetUrl ? (
                          <img src={iconAssetUrl} alt="" aria-hidden className="h-5 w-5 object-contain" />
                        ) : (
                          <Icon className="h-5 w-5" style={{ color }} />
                        )}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!mounted && canToggleMounted) {
                          handleToggleMounted(item);
                        }
                        handleSelectConnector(item.entry.connectorId);
                      }}
                      className="platform-preview-record-play absolute left-1/2 top-1/2 inline-flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/18 bg-white/8 text-white shadow-xl backdrop-blur-md transition-all duration-200 hover:scale-105 hover:bg-white/14"
                      title={t('common.action.open')}
                      aria-label={t('common.action.open')}
                    >
                      <Play className="h-6 w-6 translate-x-[1px] fill-current" />
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium text-white">{platformName}</div>
                  <div className="text-xs text-white/42">
                    {mounted
                      ? t('magnet.platform.hero.featuredIdle', { platform: platformName })
                      : t(resolveDailySubtitleKeyByConnectorId(item.entry.connectorId))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderLocalPanel = () => {
    if (localPlaylists.length === 0) {
      return (
        <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <Library className="h-8 w-8 text-white/24" />
          <div className="text-base font-medium text-white">{t('magnet.platform.local.empty')}</div>
          <p className="max-w-md text-sm leading-6 text-white/54">{t('magnet.platform.local.subtitle')}</p>
        </div>
      );
    }

    const targetPlaylist = selectedLocalPlaylist ?? localPlaylists[0] ?? null;
    const localTracks = targetPlaylist?.tracks ?? [];
    const normalizedLocalQuery = localQuery.trim().toLowerCase();
    const filteredLocalTrackEntries =
      normalizedLocalQuery.length > 0
        ? localTracks.flatMap((track, trackIndex) => {
            const haystack = [
              track.title,
              track.artist,
              track.album,
            ]
              .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
              .join(' ')
              .toLowerCase();
            return haystack.includes(normalizedLocalQuery) ? [{ track, trackIndex }] : [];
          })
        : localTracks.map((track, trackIndex) => ({ track, trackIndex }));
    const playlistCoverUrl = resolvePlaylistCoverUrl(targetPlaylist);
    const playlistTrackCount = targetPlaylist?.trackCount ?? localTracks.length;
    const playlistDuration =
      typeof targetPlaylist?.totalDuration === 'number' && Number.isFinite(targetPlaylist.totalDuration)
        ? targetPlaylist.totalDuration
        : localTracks.reduce(
            (total, track) => total + (typeof track.duration === 'number' && Number.isFinite(track.duration) ? track.duration : 0),
            0
          );
    const playlistDescription =
      typeof targetPlaylist?.description === 'string' && targetPlaylist.description.trim().length > 0
        ? targetPlaylist.description.trim()
        : null;

    return (
      <div
        className="platform-preview-local-shell mx-auto flex max-w-6xl flex-col gap-5"
        style={localPlaylistThemeStyle}
        data-surface-id="page.music-library"
        data-surface-variant={localPlaylistSurface.variant}
      >
        <section className="platform-preview-local-hero relative overflow-hidden rounded-[30px]">
          {playlistCoverUrl ? (
            <div
              className="pointer-events-none absolute inset-x-[-8%] top-[-18%] h-[88%] scale-110 bg-cover bg-center opacity-28 blur-[78px]"
              style={{ backgroundImage: `url(${playlistCoverUrl})` }}
            />
          ) : null}
          <div className="platform-preview-local-hero-overlay pointer-events-none absolute inset-0" />

          <div className="relative flex flex-col gap-6 px-6 py-6 sm:px-8 sm:py-8 md:mx-auto md:max-w-[980px] lg:px-10 lg:py-9">
            {localPlaylists.length > 1 ? (
              <div className="space-y-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-white/34">
                  {t('magnet.platform.local.title')}
                </div>
                <div className="platform-preview-scroll flex gap-3 overflow-x-auto pb-1">
                  {localPlaylists.map((playlist) => {
                    const selected = targetPlaylist?.id === playlist.id;
                    const switcherCoverUrl = resolvePlaylistCoverUrl(playlist);
                    return (
                      <button
                        key={playlist.id}
                        type="button"
                        onClick={() => handleSelectLocalPlaylist(playlist.id)}
                        className={cx(
                          'platform-preview-local-switcher-card min-w-[196px] shrink-0 rounded-[20px] px-3 py-3 text-left transition-all duration-200',
                          selected
                            ? 'platform-preview-local-switcher-card-active text-white shadow-[0_14px_30px_rgba(0,0,0,0.18)]'
                            : 'text-white/70'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="platform-preview-local-switcher-cover relative h-11 w-11 overflow-hidden rounded-[14px]">
                            {switcherCoverUrl ? (
                              <img
                                src={switcherCoverUrl}
                                alt=""
                                aria-hidden
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-white/48">
                                <Library className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{playlist.name}</div>
                            <div className="mt-1 text-xs text-white/42">
                              {playlist.trackCount ?? playlist.tracks.length}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="grid gap-6 md:grid-cols-[140px,minmax(0,1fr)] md:items-center md:gap-6 lg:justify-center lg:gap-8 lg:grid-cols-[160px,minmax(0,680px)] xl:grid-cols-[168px,minmax(0,720px)]">
              <div className="platform-preview-local-cover relative h-[148px] w-[148px] overflow-hidden rounded-[28px] shadow-[0_26px_60px_rgba(0,0,0,0.38)] md:h-[140px] md:w-[140px] lg:h-[160px] lg:w-[160px] xl:h-[168px] xl:w-[168px]">
                {playlistCoverUrl ? (
                  <img src={playlistCoverUrl} alt="" aria-hidden className="h-full w-full object-cover" />
                ) : (
                  <div className="platform-preview-local-cover-fallback flex h-full w-full items-center justify-center">
                    <Library className="h-14 w-14" />
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent_38%,rgba(0,0,0,0.32)_100%)]" />
              </div>

              <div className="min-w-0 md:max-w-[520px] lg:max-w-[680px]">
                <div className="text-[11px] uppercase tracking-[0.28em] text-white/52">
                  {t('magnet.platform.nav.local')}
                </div>
                <h2 className="mt-3 break-words text-4xl font-semibold leading-none text-white sm:text-5xl">
                  {targetPlaylist?.name ?? '-'}
                </h2>
                <div className="mt-4 text-sm text-white/72">
                  {t('magnet.platform.local.detail.summary', {
                    count: playlistTrackCount,
                    duration: formatPlaylistDuration(playlistDuration),
                  })}
                </div>
                {playlistDescription ? (
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-white/56">{playlistDescription}</p>
                ) : null}

                <div className={cx('flex flex-wrap items-center gap-3', playlistDescription ? 'mt-7' : 'mt-5')}>
                  <button
                    type="button"
                    onClick={() => void handlePlayLocalPlaylist()}
                    disabled={!targetPlaylist}
                    className="platform-preview-local-primary-action inline-flex h-14 w-14 items-center justify-center rounded-full transition-transform duration-200 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-55"
                    title={t('common.action.play')}
                  >
                    <Play className="h-6 w-6 translate-x-[1px] fill-current" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(true);
                      setSettingsOpen(false);
                      closeCreateDialog();
                      closeTopMenus();
                    }}
                    className="platform-preview-local-secondary-action inline-flex h-12 w-12 items-center justify-center rounded-full transition-colors hover:text-white"
                    title={t('magnet.platform.fab.playlists')}
                  >
                    <Library className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteLocalPlaylist()}
                    disabled={!targetPlaylist}
                    className="platform-preview-local-destructive-action inline-flex h-12 w-12 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-55"
                    title={t('common.action.delete')}
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {playlistError ? (
          <div className="rounded-[20px] border border-rose-400/20 bg-rose-400/7 px-4 py-3 text-sm text-rose-100/88">
            {playlistError}
          </div>
        ) : null}

        <section className="platform-preview-local-table overflow-hidden rounded-[26px] shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
          <div className="platform-preview-local-table-head grid grid-cols-[44px,minmax(0,1fr),68px,40px] items-center gap-3 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-white/30 md:grid-cols-[52px,minmax(0,1.45fr),minmax(0,0.9fr),76px,44px] md:px-6">
            <span>{t('magnet.platform.detail.column.index')}</span>
            <span>{t('magnet.platform.detail.column.title')}</span>
            <span className="hidden md:block">{t('magnet.platform.detail.column.album')}</span>
            <span className="text-right">{t('magnet.platform.detail.column.duration')}</span>
            <span />
          </div>

          {localTracks.length === 0 ? (
            <div className="flex min-h-[280px] items-center justify-center px-6 text-center text-sm text-white/42">
              {t('magnet.platform.local.emptyTracks')}
            </div>
          ) : filteredLocalTrackEntries.length === 0 ? (
            <div className="flex min-h-[280px] items-center justify-center px-6 text-center text-sm text-white/42">
              {t('magnet.platform.panel.search.empty')}
            </div>
          ) : (
            <div className="platform-preview-local-table-body">
              {filteredLocalTrackEntries.map(({ track, trackIndex }) => {
                const trackCoverUrl =
                  typeof track.coverUrl === 'string' && track.coverUrl.trim().length > 0
                    ? track.coverUrl.trim()
                    : null;
                return (
                  <div
                    key={`${targetPlaylist?.id ?? 'local'}:${track.id}:${trackIndex}`}
                    className="platform-preview-local-row group grid grid-cols-[44px,minmax(0,1fr),68px,40px] items-center gap-3 px-4 py-3 transition-colors md:grid-cols-[52px,minmax(0,1.45fr),minmax(0,0.9fr),76px,44px] md:px-6"
                  >
                    <span className="text-xs text-white/36">{formatTrackIndexLabel(trackIndex)}</span>

                    <button
                      type="button"
                      onDoubleClick={() => void handlePlayLocalTrackAtIndex(trackIndex)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void handlePlayLocalTrackAtIndex(trackIndex);
                        }
                      }}
                      className="platform-preview-local-track-trigger flex min-w-0 items-center gap-3 text-left"
                      title={t('magnet.platform.local.track.playHint')}
                      aria-label={t('magnet.platform.local.track.playHint')}
                    >
                      <div className="platform-preview-local-track-cover relative h-12 w-12 shrink-0 overflow-hidden rounded-[14px]">
                        {trackCoverUrl ? (
                          <img src={trackCoverUrl} alt="" aria-hidden className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-white/38">
                            <Disc3 className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium text-white transition-colors group-hover:text-white/96">
                            {track.title}
                          </span>
                          {track.favorite ? <Heart className="h-3.5 w-3.5 shrink-0 fill-current text-[#ff6b6d]" /> : null}
                        </div>
                        <div className="truncate text-xs text-white/42">{track.artist || track.album || '-'}</div>
                      </div>
                    </button>

                    <div className="hidden truncate text-sm text-white/46 md:block">{track.album || '-'}</div>
                    <div className="text-right text-xs text-white/38">{formatTrackDuration(track.duration)}</div>

                    <button
                      type="button"
                      onClick={() => void handleRemoveTrackFromLocalPlaylist(trackIndex)}
                      className="platform-preview-local-row-action inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:text-white"
                      title={t('common.action.remove')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  };

  const renderMainPanel = () => {
    if (submittedQuery) {
      return renderSearchPanel();
    }

    if (activePage === 'daily') {
      return renderDailyPanel();
    }

    if (activePage === 'overview') {
      return renderOverviewPanel();
    }

    if (activePage === 'local') {
      return renderLocalPanel();
    }

    if (!activeItem) {
      return (
        <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 px-6 text-center">
          <LayoutGrid className="h-8 w-8 text-white/24" />
          <div className="text-base font-medium text-white">{t('magnet.platform.empty.noRegistered')}</div>
          <p className="max-w-md text-sm leading-6 text-white/54">{t('magnet.platform.empty.noRegisteredHint')}</p>
        </div>
      );
    }

    return (
      <div className="min-h-full">
        <section className="flex min-h-[620px] flex-col">{renderWorkspacePanel()}</section>
      </div>
    );
  };

  const settingsTriggerTitle =
    activePage === 'instance' && activeConnectorLabel
      ? t('magnet.platform.settings.action.openPlatform', {
          platform: activeConnectorLabel,
        })
      : t('magnet.platform.settings.action.openGlobal');

  return (
    <div className="platform-preview-magnet relative h-full w-full overflow-hidden rounded-[24px] text-white">
      <div className="platform-preview-shell relative flex h-full flex-col">
        <header className="platform-preview-header relative z-30 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4">
          <div ref={launcherRef} className="relative flex items-center justify-self-start">
            <button
              type="button"
              onClick={() => {
                setLauncherOpen((current) => !current);
                setNavOpen(false);
                setFilterOpen(false);
              }}
              className={cx(
                'platform-preview-launcher-trigger inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors',
                launcherOpen ? 'platform-preview-launcher-trigger-open' : 'platform-preview-launcher-trigger-closed'
              )}
              title={t('magnet.platform.launcher.title')}
              aria-pressed={launcherOpen}
            >
              {launcherPreviewItems.length > 0 ? (
                <span className="platform-preview-launcher-trigger-preview" aria-hidden>
                  {launcherPreviewItems.map((item, index) => {
                    const { Icon, color, iconAssetUrl } = resolveConnectorVisualMeta(
                      item.entry.connectorId,
                      item.definition
                    );
                    const emphasized =
                      item.renderSelection?.mounted === true || item.facade?.authState === 'authorized';

                    return (
                      <span
                        key={item.entry.connectorId}
                        className={cx(
                          'platform-preview-launcher-trigger-preview-item',
                          `platform-preview-launcher-trigger-preview-item--${index}`,
                          emphasized
                            ? 'platform-preview-launcher-trigger-preview-item-emphasized'
                            : 'platform-preview-launcher-trigger-preview-item-muted'
                        )}
                      >
                        <ConnectorVisualIcon
                          Icon={Icon}
                          color={emphasized ? color : 'rgba(170, 182, 198, 0.8)'}
                          iconAssetUrl={iconAssetUrl}
                          className="h-3.5 w-3.5 object-contain"
                          style={{ opacity: emphasized ? 1 : 0.82 }}
                        />
                      </span>
                    );
                  })}
                  {launcherPreviewOverflowCount > 0 ? (
                    <span className="platform-preview-launcher-trigger-preview-badge">
                      +{Math.min(launcherPreviewOverflowCount, 9)}
                    </span>
                  ) : null}
                </span>
              ) : (
                <LayoutGrid className="h-5 w-5" />
              )}
            </button>

            <div
              className={cx(
                'platform-preview-launcher-strip absolute left-[3.4rem] top-1/2 flex -translate-y-1/2 items-center',
                launcherOpen
                  ? 'translate-x-0 opacity-100 blur-0'
                  : 'pointer-events-none -translate-x-3 opacity-0 blur-[4px]'
              )}
            >
              {registeredItems.map((item) => {
                const { Icon, color, iconAssetUrl } = resolveConnectorVisualMeta(
                  item.entry.connectorId,
                  item.definition
                );
                const mounted = item.renderSelection?.mounted === true;
                const canToggleMounted = Boolean(item.instance) && (mounted || item.facade?.authState === 'authorized');
                const iconColor = mounted ? color : 'rgba(170, 182, 198, 0.52)';
                const itemLabel = item.definition?.labelKey
                  ? t(item.definition.labelKey)
                  : item.facade?.displayName ?? item.entry.connectorId;

                return (
                  <button
                    key={item.entry.connectorId}
                    type="button"
                    onClick={() => {
                      if (!canToggleMounted) return;
                      handleToggleMounted(item);
                    }}
                    aria-pressed={mounted}
                    disabled={!canToggleMounted}
                    className={cx(
                      'platform-preview-launcher-item group relative inline-flex items-center justify-center',
                      mounted ? 'platform-preview-launcher-item--mounted' : 'platform-preview-launcher-item--hidden',
                      !canToggleMounted && 'cursor-not-allowed opacity-45'
                    )}
                    title={itemLabel}
                  >
                    <ConnectorVisualIcon
                      Icon={Icon}
                      color={iconColor}
                      iconAssetUrl={iconAssetUrl}
                      className="platform-preview-launcher-item-icon h-6 w-6 object-contain transition-all duration-200"
                      style={{ opacity: mounted ? 1 : 0.62 }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mx-auto flex min-w-0 items-center gap-3">
            <div ref={navRef} className="relative">
              <button
                type="button"
              onClick={() => {
                setNavOpen((current) => !current);
                setLauncherOpen(false);
                setFilterOpen(false);
              }}
                className={cx(
                  'platform-preview-soft-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors',
                  navOpen || activePage !== 'daily' ? 'bg-white/10 text-white' : 'bg-white/4 text-white/62'
                )}
                title={t('magnet.platform.nav.channels')}
              >
                <Compass className="h-4 w-4" />
              </button>

              {renderNavPopover()}
            </div>

            <form
              onSubmit={handleSearchSubmit}
              className="platform-preview-searchbar flex min-w-0 w-full max-w-[360px] items-center gap-2 rounded-full px-3 py-1.5 sm:max-w-[390px]"
            >
              <Search className="h-4 w-4 shrink-0 text-white/35" />
              <input
                value={shellSearchValue}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (activeWorkspaceShellSearch) {
                    setSubmittedQuery('');
                    activeWorkspaceShellSearch.onChange(nextValue);
                    return;
                  }
                  if (activePage === 'local') {
                    setLocalQuery(nextValue);
                    return;
                  }
                  setQuery(nextValue);
                }}
                placeholder={shellSearchPlaceholder}
                aria-label={t('magnet.platform.nav.search')}
                disabled={shellSearchDisabled}
                className="h-8 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/28"
              />
              <div
                className={cx(
                  'platform-preview-filter-slot relative',
                  showDailyFilter ? 'platform-preview-filter-slot-visible' : 'platform-preview-filter-slot-hidden'
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!showDailyFilter) return;
                    setFilterOpen((current) => !current);
                    setLauncherOpen(false);
                    setNavOpen(false);
                  }}
                  disabled={!showDailyFilter}
                  tabIndex={showDailyFilter ? 0 : -1}
                  aria-hidden={!showDailyFilter}
                  className={cx(
                    'platform-preview-soft-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
                    filterOpen ? 'bg-white/10 text-white' : 'bg-white/4 text-white/62'
                  )}
                  title={t('magnet.platform.search.filterTitle')}
                >
                  <Filter className="h-4 w-4" />
                </button>

                <div
                  className={cx(
                    'platform-preview-filter-panel absolute right-0 top-10 z-20 w-[220px] overflow-hidden rounded-[18px] transition-all duration-150',
                    showDailyFilter && filterOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'
                  )}
                >
                  <div className="border-b border-white/6 px-4 py-3 text-xs text-white/38">
                    {t('magnet.platform.search.filterPanelTitle')}
                  </div>
                  <div className="p-2">
                    {filterableRegisteredItems.length > 0 ? (
                      filterableRegisteredItems.map((item) => {
                        const selected = selectedFilterConnectorIds.includes(item.entry.connectorId);
                        const label = item.definition?.labelKey
                          ? t(item.definition.labelKey)
                          : item.facade?.displayName ?? item.entry.connectorId;
                        const { Icon, color, iconAssetUrl } = resolveConnectorVisualMeta(
                          item.entry.connectorId,
                          item.definition
                        );

                        return (
                          <button
                            key={item.entry.connectorId}
                            type="button"
                            onClick={() => {
                              setSelectedFilterConnectorIds((current) => {
                                if (selected && current.length === 1) return current;
                                return selected
                                  ? current.filter((connectorId) => connectorId !== item.entry.connectorId)
                                  : [...current, item.entry.connectorId];
                              });
                            }}
                            className="flex w-full items-center justify-between rounded-[14px] px-3 py-3 text-left transition-colors hover:bg-white/6"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              {iconAssetUrl ? (
                                <img
                                  src={iconAssetUrl}
                                  alt=""
                                  aria-hidden
                                  className="h-4 w-4 shrink-0 object-contain"
                                />
                              ) : (
                                <Icon className="h-4 w-4 shrink-0" style={{ color }} />
                              )}
                              <span className="truncate text-sm text-white/78">{label}</span>
                            </div>
                            <span
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                              style={{
                                background: selected ? color : 'transparent',
                                borderColor: selected ? color : 'rgba(255,255,255,0.16)',
                              }}
                            >
                              {selected ? <Check className="h-3 w-3 text-white" /> : null}
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-3 py-3 text-xs text-white/42">{t('magnet.platform.empty')}</div>
                    )}
                  </div>
                </div>
              </div>
            </form>

            <button
              type="button"
              className="platform-preview-soft-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/4 text-white/62"
              title={t('magnet.platform.identify.placeholder')}
            >
              <Mic className="h-4 w-4" />
            </button>
          </div>

          <div className="justify-self-end">
            <button
              type="button"
            onClick={() => {
                setSettingsTab(preferredSettingsTab);
                setSettingsOpen(true);
                setDrawerOpen(false);
                closeCreateDialog();
                closeTopMenus();
              }}
              className="platform-preview-soft-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/4 text-white/62"
              aria-label={settingsTriggerTitle}
              title={settingsTriggerTitle}
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="relative min-h-0 flex-1 overflow-hidden">
          {launcherOpen || navOpen || filterOpen ? (
            <button
              type="button"
              className="absolute inset-0 z-10"
              aria-label={t('common.action.close')}
              onClick={closeTopMenus}
            />
          ) : null}

          {showBackButton ? (
            <div className="platform-preview-back-region group absolute left-2 top-2 z-20">
              <button
                type="button"
                onClick={handleGoBack}
                className="platform-preview-back-button platform-preview-soft-ring inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#131922] text-white/72"
                title={t('magnet.platform.action.goBack')}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            </div>
          ) : null}

          <div
            ref={pageStageScrollRef}
            className={cx(
              'platform-preview-scroll platform-preview-page-stage relative z-[1] h-full overflow-y-auto px-5 pb-24 pt-5',
              contentTransitionPhase === 'exiting'
                ? 'platform-preview-page-stage-exiting'
                : contentTransitionPhase === 'entering'
                  ? 'platform-preview-page-stage-entering'
                  : 'platform-preview-page-stage-entered'
            )}
          >
            {renderMainPanel()}
          </div>

            <button
              type="button"
              onClick={() => {
                if (activeWorkspacePlaylistOpener) {
                  setDrawerOpen(false);
                  setSettingsOpen(false);
                  closeCreateDialog();
                  activeWorkspacePlaylistOpener();
                  return;
                }
                setDrawerOpen(true);
                setSettingsOpen(false);
                closeCreateDialog();
              }}
            className="platform-preview-fab platform-preview-fab-left absolute bottom-4 left-4 z-20 inline-flex h-11 shrink-0 items-center rounded-full text-white/72"
            title={activeWorkspacePrimaryActionTitle}
          >
            <Library className="h-5 w-5 shrink-0" />
            <span className="platform-preview-fab-label">{activeWorkspacePrimaryActionLabel}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setDrawerOpen(false);
              setSettingsOpen(false);
              openCreateDialog();
            }}
            className="platform-preview-fab platform-preview-fab-right absolute bottom-4 right-4 z-20 inline-flex h-11 shrink-0 items-center rounded-full text-white/72"
            title={t('magnet.platform.action.createLocal')}
          >
            <span className="platform-preview-fab-label">{t('magnet.platform.fab.create')}</span>
            <Plus className="h-5 w-5 shrink-0" />
          </button>

          {drawerOpen || settingsOpen || createOpen ? (
            <button
              type="button"
              className="platform-preview-overlay absolute inset-0 z-30"
              aria-label={t('common.action.close')}
              onClick={() => {
                setDrawerOpen(false);
                setSettingsOpen(false);
                closeCreateDialog();
              }}
            />
          ) : null}

          <aside
            className={cx(
              'platform-preview-sheet absolute inset-y-3 left-3 z-40 flex w-[320px] max-w-[calc(100%-1.5rem)] flex-col rounded-[24px] border border-white/10 p-4 transition-all duration-150',
              drawerOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-[105%] opacity-0'
            )}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm text-white/72">{t('magnet.platform.drawer.title')}</div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="text-white/52">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="platform-preview-scroll flex-1 space-y-4 overflow-y-auto pr-1">
              {drawerGroups.length > 0 ? (
                drawerGroups.map((group) => (
                  <div key={group.id} className="space-y-2">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/28">
                      {group.connectorId ? (
                        <ConnectorGlyph
                          connectorId={group.connectorId}
                          definition={
                            group.connectorId
                              ? platformDefinitionsById.get(group.connectorId as PlatformConnectorId) ?? null
                              : null
                          }
                          compact
                        />
                      ) : (
                        <span className="platform-preview-soft-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/4 text-white/58">
                          <Library className="h-4 w-4" />
                        </span>
                      )}
                      <span className="truncate">{group.label}</span>
                    </div>
                    {group.collections && group.collections.length > 0 ? (
                      <div className="space-y-2">
                        <div className="px-1 text-[10px] uppercase tracking-[0.18em] text-white/24">
                          {group.collectionSectionLabelKey
                            ? t(group.collectionSectionLabelKey)
                            : t('magnet.platform.bilibili.folder.title')}
                        </div>
                        {group.collections.map((collection) => {
                          const selected =
                            activeConnectorId === group.connectorId &&
                            group.selectedCollectionId === collection.collectionId;
                          return (
                            <button
                              key={`${group.id}:folder:${collection.collectionId ?? 'recommended'}`}
                              type="button"
                              onClick={() => handleSelectWorkspaceDrawerFolder(collection.collectionId)}
                              className={cx(
                                'platform-preview-card flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left text-sm transition-colors',
                                selected ? 'platform-preview-card-active text-white' : 'text-white/68'
                              )}
                            >
                              <span className="platform-preview-soft-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/4 text-white/58">
                                {collection.collectionId ? (
                                  <Library className="h-4 w-4" />
                                ) : (
                                  <Compass className="h-4 w-4" />
                                )}
                              </span>
                              <span className="min-w-0 flex-1 truncate">{collection.title}</span>
                              {typeof collection.count === 'number' ? (
                                <span className="text-xs text-white/34">{collection.count}</span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    {group.collectionLoading ? (
                      <div className="rounded-[16px] border border-dashed border-white/10 bg-white/3 px-3 py-4 text-center text-xs text-white/42">
                        {t('common.state.loading')}
                      </div>
                    ) : null}
                    {group.collectionError ? (
                      <div className="rounded-[16px] border border-dashed border-rose-400/20 bg-rose-400/5 px-3 py-4 text-center text-xs text-rose-200/80">
                        {group.collectionError}
                      </div>
                    ) : null}
                    {group.playlists.length > 0 ? (
                      <div className="space-y-2">
                        {group.playlistSectionLabelKey ? (
                          <div className="px-1 text-[10px] uppercase tracking-[0.18em] text-white/24">
                            {group.playlistSectionLabelKey
                              ? t(group.playlistSectionLabelKey)
                              : t('magnet.platform.bilibili.drawer.playlists.open')}
                          </div>
                        ) : null}
                        {group.playlists.map((playlist) => {
                          const selected =
                            group.connectorId !== null
                              ? selectedPlaylistIdsByConnector[group.connectorId] === playlist.id &&
                                activeConnectorId === group.connectorId
                              : resolvedSelectedLocalPlaylistId === playlist.id;

                          return (
                            <button
                              key={`${group.id}:${playlist.id}`}
                              type="button"
                              onClick={() => handleSelectDrawerPlaylist(group.connectorId, playlist.id)}
                              className={cx(
                                'platform-preview-card flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left text-sm transition-colors',
                                selected ? 'platform-preview-card-active text-white' : 'text-white/68'
                              )}
                            >
                              {group.connectorId ? (
                                <ConnectorGlyph
                                  connectorId={group.connectorId}
                                  definition={
                                    group.connectorId
                                      ? platformDefinitionsById.get(group.connectorId as PlatformConnectorId) ?? null
                                      : null
                                  }
                                  compact
                                  active={selected}
                                />
                              ) : (
                                <span className="platform-preview-soft-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/4 text-white/58">
                                  <Library className="h-4 w-4" />
                                </span>
                              )}
                              <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                              <span className="text-xs text-white/34">
                                {playlist.trackCount ?? playlist.tracks.length}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : !group.collections || group.collections.length === 0 ? (
                      <div className="rounded-[16px] border border-dashed border-white/10 bg-white/3 px-3 py-5 text-center text-xs text-white/42">
                        {t('magnet.platform.drawer.empty')}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="flex min-h-[220px] items-center justify-center rounded-[20px] border border-dashed border-white/10 bg-white/3 px-6 text-center text-sm text-white/42">
                  {t('magnet.platform.drawer.empty')}
                </div>
              )}
            </div>
          </aside>

          <section
            className={cx(
              'platform-preview-dialog absolute left-1/2 top-1/2 z-40 flex h-[460px] max-h-[calc(100%-1.5rem)] w-[720px] max-w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[26px] border border-white/10 transition-all duration-150',
              settingsOpen ? 'scale-100 opacity-100' : 'pointer-events-none scale-[0.96] opacity-0'
            )}
          >
            <div className="w-[210px] border-r border-white/10 bg-white/2 p-3">
              <button
                type="button"
                onClick={() => setSettingsTab('global')}
                className={cx(
                  'flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left text-sm transition-colors',
                  settingsTab === 'global' ? 'bg-white/10 text-white' : 'text-white/62 hover:bg-white/6'
                )}
              >
                <Settings className="h-4 w-4" />
                <span>{t('magnet.platform.global.title')}</span>
              </button>
              {settingsNavItems.map((item) => {
                const label = item.definition?.labelKey
                  ? t(item.definition.labelKey)
                  : item.definition?.displayName ?? item.entry.connectorId;

                return (
                  <button
                    key={item.entry.connectorId}
                    type="button"
                    onClick={() => setSettingsTab(item.entry.connectorId)}
                    className={cx(
                      'mt-2 flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left text-sm transition-colors',
                      settingsTab === item.entry.connectorId ? 'bg-white/10 text-white' : 'text-white/62 hover:bg-white/6'
                    )}
                  >
                    <ConnectorGlyph
                      connectorId={item.entry.connectorId}
                      definition={item.definition}
                      compact
                      active={settingsTab === item.entry.connectorId}
                    />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>

            <div className="platform-preview-scroll flex-1 overflow-y-auto p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
                    {t('magnet.platform.settings.panelTitle')}
                  </div>
                  <div className="mt-2 truncate text-sm font-medium text-white">
                    {settingsTab === 'global' ? t('magnet.platform.global.title') : settingsLabel}
                  </div>
                  <div className="mt-1 text-xs text-white/42">
                    {settingsTab === 'global'
                      ? t('magnet.platform.settings.panelScopeGlobal')
                      : t('magnet.platform.settings.panelScopePlatform', { platform: settingsLabel })}
                  </div>
                </div>
                <button type="button" onClick={() => setSettingsOpen(false)} className="text-white/52">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {settingsTab === 'global' ? (
                <div className="space-y-4">
                  <div className="rounded-[18px] border border-white/8 bg-black/10 px-5 py-5">
                    <div className="flex items-center gap-3">
                      <span className="platform-preview-soft-ring inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/4 text-white/72">
                        <SlidersHorizontal className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-base font-medium text-white">
                          {t('magnet.platform.global.title')}
                        </div>
                        <div className="mt-1 text-xs text-white/42">
                          {t('magnet.platform.global.subtitle')}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[18px] border border-white/8 bg-black/10 px-5 py-5">
                    <div className="mb-4">
                      <div className="text-sm font-medium text-white">
                        {t('magnet.platform.global.cache.title')}
                      </div>
                      <div className="mt-1 text-xs text-white/42">
                        {t('magnet.platform.global.cache.subtitle')}
                      </div>
                    </div>

                    <div className="platform-magnet-settings-path-item">
                      <span className="platform-magnet-settings-path-label">
                        {t('magnet.platform.global.cache.effectivePath')}
                      </span>
                      <p className="platform-magnet-settings-path-value">
                        {globalCacheSettings?.effectiveRootPath || '-'}
                      </p>
                    </div>

                    <div className="platform-magnet-settings-path-item">
                      <span className="platform-magnet-settings-path-label">
                        {t('magnet.platform.global.cache.defaultPath')}
                      </span>
                      <p className="platform-magnet-settings-path-value">
                        {globalCacheSettings?.defaultRootPath || '-'}
                      </p>
                    </div>

                    <div className="platform-magnet-settings-path-item">
                      <span className="platform-magnet-settings-path-label">
                        {t('magnet.platform.global.cache.customPath')}
                      </span>
                    </div>

                    <div className="platform-magnet-settings-row">
                      <input
                        type="text"
                        className="platform-magnet-settings-input"
                        value={globalCachePathDraft}
                        placeholder={t('magnet.platform.global.cache.customPathPlaceholder')}
                        onChange={(event) => {
                          setGlobalCachePathDraft(event.target.value);
                          setGlobalCacheSettingsInfo(null);
                        }}
                        disabled={globalCacheSettingsLoading || globalCacheSettingsSaving}
                        spellCheck={false}
                      />

                      <button
                        type="button"
                        className="platform-magnet-mini-btn"
                        onClick={() => {
                          void handleBrowseGlobalCachePath();
                        }}
                        disabled={globalCacheSettingsLoading || globalCacheSettingsSaving}
                      >
                        {t('magnet.platform.global.cache.actionBrowse')}
                      </button>
                    </div>

                    <div className="platform-magnet-settings-actions">
                      <button
                        type="button"
                        className="platform-magnet-mini-btn"
                        onClick={() => {
                          void handleSaveGlobalCachePath();
                        }}
                        disabled={globalCacheSettingsLoading || globalCacheSettingsSaving}
                      >
                        {globalCacheSettingsSaving
                          ? t('magnet.platform.global.cache.stateSaving')
                          : t('magnet.platform.global.cache.actionSave')}
                      </button>
                      <button
                        type="button"
                        className="platform-magnet-mini-btn"
                        onClick={() => {
                          void handleResetGlobalCachePath();
                        }}
                        disabled={globalCacheSettingsLoading || globalCacheSettingsSaving}
                      >
                        {t('magnet.platform.global.cache.actionReset')}
                      </button>
                    </div>

                    <p className="platform-magnet-note">
                      {t('magnet.platform.global.cache.scopeHint')}
                    </p>
                    <p className="platform-magnet-note">
                      {t('magnet.platform.global.cache.overrideHint')}
                    </p>

                    {globalCacheSettingsLoading ? (
                      <p className="platform-magnet-note">
                        {t('magnet.platform.global.cache.stateLoading')}
                      </p>
                    ) : null}
                    {globalCacheSettingsInfo ? (
                      <p className="platform-magnet-note">{globalCacheSettingsInfo}</p>
                    ) : null}
                    {globalCacheSettingsError ? (
                      <p className="platform-magnet-error">{globalCacheSettingsError}</p>
                    ) : null}
                  </div>

                  <div className="rounded-[18px] border border-white/8 bg-black/10 px-5 py-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">
                          {t('magnet.platform.runtime.title')}
                        </div>
                        <div className="mt-1 text-xs text-white/42">
                          {t('magnet.platform.runtime.desc')}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void handleRefreshAll();
                        }}
                        className="platform-preview-detail-ghost inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs text-white/76"
                        disabled={refreshing}
                      >
                        <RefreshCw className={cx('h-3.5 w-3.5', refreshing && 'animate-spin')} />
                        <span>
                          {refreshing ? t('common.state.loading') : t('magnet.platform.action.refresh')}
                        </span>
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        {
                          key: 'loaded',
                          label: t('magnet.platform.runtime.statLoaded'),
                          value: String(loadedCount),
                        },
                        {
                          key: 'authorized',
                          label: t('magnet.platform.runtime.statAuthorized'),
                          value: String(authorizedCount),
                        },
                        {
                          key: 'registered',
                          label: t('magnet.platform.runtime.statRegistered'),
                          value: String(registeredCount),
                        },
                        {
                          key: 'searchable',
                          label: t('magnet.platform.runtime.statSearchable'),
                          value: String(searchReadyCount),
                        },
                      ].map((item) => (
                        <div
                          key={item.key}
                          className="rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-3"
                        >
                          <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
                            {item.label}
                          </div>
                          <div className="mt-2 text-lg font-semibold text-white">{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : settingsItem ? (
                <div className="space-y-4">
                  <div className="rounded-[18px] border border-white/8 bg-black/10 px-5 py-5">
                    <div className="flex items-center gap-3">
                      <ConnectorGlyph
                        connectorId={settingsItem.entry.connectorId}
                        definition={settingsItem.definition}
                        active
                      />
                      <div className="min-w-0">
                        <div className="truncate text-base font-medium text-white">{settingsLabel}</div>
                        <div className="mt-1 text-xs text-white/42">{settingsItem.entry.connectorId}</div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
                          {t('magnet.platform.card.connectorId', {
                            connectorId: settingsItem.entry.connectorId,
                          })}
                        </div>
                        <div className="mt-2 text-sm text-white/72">{settingsLabel}</div>
                      </div>
                      <div className="rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
                          {t('magnet.platform.settings.instancesTitle')}
                        </div>
                        <div className="mt-2 text-sm text-white/72">
                          {t('magnet.platform.settings.instancesCount', {
                            count: settingsItems.length,
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[18px] border border-white/8 bg-black/10 px-5 py-5">
                    <div className="mb-4">
                      <div className="text-sm font-medium text-white">
                        {t('magnet.platform.settings.sharedTitle')}
                      </div>
                      <div className="mt-1 text-xs text-white/42">
                        {t('magnet.platform.settings.subtitleShared', { platform: settingsLabel })}
                      </div>
                    </div>
                    {settingsWorkspacePanel ? (
                      settingsWorkspacePanel
                    ) : (
                      <div className="rounded-[14px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-4 text-sm text-white/52">
                        {t('magnet.platform.settings.sharedEmpty')}
                      </div>
                    )}
                  </div>

                  {settingsItems.length > 0 ? (
                    <div className="rounded-[18px] border border-white/8 bg-black/10 px-5 py-5">
                      <div className="mb-4">
                        <div className="text-sm font-medium text-white">
                          {t('magnet.platform.settings.instancesTitle')}
                        </div>
                        <div className="mt-1 text-xs text-white/42">
                          {t('magnet.platform.settings.instancesDesc')}
                        </div>
                      </div>
                      <div className="space-y-3">
                        {settingsItems.map((item) => {
                          const accountValue = resolveRegisteredItemAccountValue(item);
                          return (
                            <div
                              key={`${item.entry.connectorId}:${item.instance?.instanceId ?? 'instance'}`}
                              className="rounded-[18px] border border-white/8 bg-black/10 px-4 py-4"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-white">
                                    {accountValue}
                                  </div>
                                  <div className="mt-1 text-xs text-white/42">
                                    {item.instance?.instanceId ?? item.entry.connectorId}
                                  </div>
                                </div>
                                <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/48">
                                  {t(toAuthLabelKey(item.facade?.authState))}
                                </span>
                              </div>
                              <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/58">
                                <span>
                                  {t('magnet.platform.instance.account', {
                                    account: accountValue,
                                  })}
                                </span>
                                <span>
                                  {t('magnet.platform.card.connectorId', {
                                    connectorId: item.entry.connectorId,
                                  })}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {(settingsItem.contractRecord || listCapabilityLabelKeys(settingsContract).length > 0) ? (
                    <div className="rounded-[18px] border border-white/8 bg-black/10 px-5 py-5">
                      <div className="mb-3 text-sm font-medium text-white">
                        {t('magnet.platform.settings.contractTitle')}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {settingsItem.contractRecord ? (
                          <span className="rounded-full border border-white/18 bg-white/10 px-3 py-1.5 text-xs text-white">
                            {t('magnet.platform.contract.version', {
                              version: settingsItem.contractRecord.contract.contractVersion,
                            })}
                          </span>
                        ) : null}
                        {listCapabilityLabelKeys(settingsContract).map((labelKey) => (
                          <span key={labelKey} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/48">
                            {t(labelKey)}
                          </span>
                        ))}
                        {listApiBindingKeys(settingsContract).map((bindingKey) => (
                          <span key={bindingKey} className="rounded-full border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.12em] text-white/48">
                            {bindingKey}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          <section
            className={cx(
              'platform-preview-dialog platform-preview-create-dialog absolute left-1/2 top-1/2 z-40 flex max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[24px] border border-white/10 p-5',
              createOpen ? 'scale-100 opacity-100' : 'pointer-events-none scale-[0.96] opacity-0',
              createView === 'create' ? 'platform-preview-create-dialog-create' : 'platform-preview-create-dialog-existing'
            )}
          >
            <div className="mb-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setCreateView((current) => (current === 'create' ? 'existing' : 'create'));
                  setCreateNameEditing(false);
                }}
                className="platform-preview-create-toggle platform-preview-soft-ring inline-flex h-9 shrink-0 items-center rounded-full bg-white/4 text-white/62"
                title={
                  createView === 'create'
                    ? t('magnet.platform.local.create.selectExisting')
                    : t('magnet.platform.local.create.backToCreate')
                }
              >
                {createView === 'create' ? (
                  <>
                    <Library className="h-4 w-4" />
                    <span className="text-xs">{t('magnet.platform.fab.playlists')}</span>
                  </>
                ) : (
                  <>
                    <ChevronLeft className="h-4 w-4" />
                    <span className="text-xs">{t('magnet.platform.fab.create')}</span>
                  </>
                )}
              </button>
              <div className="min-w-0 flex-1 px-2 text-center">
                {createView === 'create' ? (
                  createNameEditing ? (
                    <input
                      ref={createNameInputRef}
                      value={createName}
                      onChange={(event) => setCreateName(event.target.value)}
                      onBlur={commitCreateName}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitCreateName();
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setCreateNameEditing(false);
                        }
                      }}
                      placeholder={defaultCreateName}
                      className="platform-preview-create-title-input w-full rounded-full border border-white/10 bg-white/4 px-4 py-2 text-center text-sm text-white outline-none placeholder:text-white/28"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCreateNameEditing(true)}
                      className="platform-preview-create-title-button max-w-full truncate rounded-full px-4 py-2 text-sm text-white"
                      title={t('magnet.platform.local.create.nameLabel')}
                    >
                      {createName.trim() || defaultCreateName}
                    </button>
                  )
                ) : (
                  <div className="truncate text-sm text-white/72">
                    {t('magnet.platform.local.create.existingTitle')}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={closeCreateDialog}
                className="platform-preview-soft-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/4 text-white/52"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="platform-preview-scroll min-h-0 flex-1">
              {createView === 'create' ? (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <div className="platform-preview-create-canvas flex min-h-0 flex-1 items-center justify-center rounded-[20px] px-3 py-3">
                    <div className="text-center text-xs text-white/36">
                      {t('magnet.platform.local.create.itemsEmpty')}
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleCreateLocalPlaylist}
                      className="rounded-full border border-white bg-white px-4 py-2 text-sm text-black"
                    >
                      {t('common.action.create')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 pr-1">
                  {workspacePlaylists.length > 0 ? (
                    workspacePlaylists.map((playlist) => (
                      <button
                        key={playlist.id}
                        type="button"
                        onClick={() => {
                          handleSelectDrawerPlaylist(null, playlist.id);
                          closeCreateDialog();
                        }}
                        className="platform-preview-card flex w-full items-center gap-3 rounded-[18px] px-3 py-3 text-left text-white/72 transition-colors hover:text-white"
                      >
                        <span className="platform-preview-soft-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/4">
                          <Library className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-white">{playlist.name}</div>
                        </div>
                        <div className="shrink-0 text-xs text-white/36">
                          {playlist.trackCount ?? playlist.tracks.length}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="flex min-h-[220px] items-center justify-center rounded-[20px] border border-dashed border-white/10 bg-white/3 px-6 text-center text-sm text-white/42">
                      {t('magnet.platform.local.create.existingEmpty')}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </main>
        {confirmDialog}
      </div>
    </div>
  );
  /*
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] bg-[#0b1016] text-white">
      <div className="flex h-full min-h-0 flex-col gap-4 p-4">
        <header className="rounded-[24px] border border-white/8 bg-white/[0.03] px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/36">
                {t('magnet.platform.hero.kicker')}
              </div>
              <h3 className="mt-2 text-[22px] font-semibold text-white">{t('magnet.platform.title')}</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/62">
                {t('magnet.platform.subtitle')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {skinProps.showSummary ? (
                <>
                  <div className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-2 text-xs text-white/62">
                    {t('magnet.platform.summary.connectors', {
                      total: registeredCount,
                      authorized: authorizedCount,
                    })}
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-2 text-xs text-white/62">
                    {t('magnet.platform.summary.loaded', {
                      count: loadedCount,
                    })}
                  </div>
                </>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  void handleRefreshAll();
                }}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm text-white/82 transition hover:bg-white/[0.1]"
                disabled={refreshing}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                <span>{refreshing ? t('common.state.loading') : t('magnet.platform.action.refresh')}</span>
              </button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[320px,minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col rounded-[24px] border border-white/8 bg-white/[0.03]">
            <div className="border-b border-white/8 px-4 py-4">
              <div className="text-sm font-semibold text-white">{t('magnet.platform.launcher.title')}</div>
              <p className="mt-1 text-xs leading-5 text-white/54">
                {t('magnet.platform.launcher.subtitle')}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
              {registeredItems.length === 0 ? (
                <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 rounded-[18px] border border-dashed border-white/10 bg-black/10 px-5 text-center">
                  <LayoutGrid className="h-8 w-8 text-white/28" />
                  <div className="text-sm font-medium text-white">
                    {t('magnet.platform.empty.noRegistered')}
                  </div>
                  <p className="max-w-[220px] text-xs leading-5 text-white/54">
                    {t('magnet.platform.empty.noRegisteredHint')}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {registeredItems.map((item) => {
                    const { Icon, color, iconAssetUrl } = resolveConnectorVisualMeta(
                      item.entry.connectorId,
                      item.definition
                    );
                    const mounted = item.renderSelection?.mounted === true;
                    const selected = item.entry.connectorId === activeConnectorId;
                    const canToggleMounted =
                      item.facade?.authState === 'authorized' && Boolean(item.instance);

                    return (
                      <div
                        key={item.entry.connectorId}
                        className={`rounded-[20px] border p-3 transition ${
                          selected
                            ? 'border-white/16 bg-white/[0.09]'
                            : 'border-white/8 bg-black/10 hover:bg-white/[0.05]'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => setSelectedConnectorId(item.entry.connectorId)}
                          >
                            <div className="flex items-center gap-3">
                              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/20">
                                {iconAssetUrl ? (
                                  <img
                                    src={iconAssetUrl}
                                    alt=""
                                    aria-hidden
                                    className="h-5 w-5 object-contain"
                                  />
                                ) : (
                                  <Icon className="h-5 w-5" style={{ color }} />
                                )}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-white">
                                  {item.definition?.labelKey
                                    ? t(item.definition.labelKey)
                                    : item.facade?.displayName ?? item.entry.connectorId}
                                </span>
                                <span className="mt-1 block truncate text-xs text-white/52">
                                  {item.facade?.accountUid ?? t(toAuthLabelKey(item.facade?.authState))}
                                </span>
                              </span>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleMounted(item)}
                            disabled={!canToggleMounted}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
                              mounted
                                ? 'border-emerald-400/20 bg-emerald-400/12 text-emerald-200'
                                : 'border-white/10 bg-white/[0.05] text-white/72'
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            <Power className="h-3.5 w-3.5" />
                            <span>
                              {t(
                                mounted
                                  ? 'magnet.platform-login.action.deactivate'
                                  : 'magnet.platform-login.action.activate'
                              )}
                            </span>
                          </button>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] ${
                              mounted
                                ? 'bg-emerald-400/12 text-emerald-200'
                                : 'bg-white/[0.06] text-white/62'
                            }`}
                          >
                            {t(
                              mounted
                                ? 'magnet.platform.instance.loaded'
                                : 'magnet.platform.instance.unloaded'
                            )}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/62">
                            {t('magnet.platform.instance.auth', {
                              state: t(toAuthLabelKey(item.facade?.authState)),
                            })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col rounded-[24px] border border-white/8 bg-white/[0.03]">
            {activeItem ? (
              <>
                <div className="border-b border-white/8 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-[0.18em] text-white/34">
                        {t('magnet.platform.instance.registered')}
                      </div>
                      <h4 className="mt-2 truncate text-xl font-semibold text-white">
                        {activeConnectorLabel}
                      </h4>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/58">
                        <span>
                          {t('magnet.platform.instance.account', {
                            account: resolveRegisteredItemAccountValue(activeItem),
                          })}
                        </span>
                        <span>
                          {t('magnet.platform.instance.auth', {
                            state: activeAuthLabel,
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {activeInstance ? (
                        <button
                          type="button"
                          onClick={() => handleToggleMounted(activeItem)}
                          disabled={activeFacade?.authState !== 'authorized'}
                          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
                            activeRenderSelection?.mounted
                              ? 'border-emerald-400/20 bg-emerald-400/12 text-emerald-200'
                              : 'border-white/10 bg-white/[0.06] text-white/78'
                          } disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <Power className="h-4 w-4" />
                          <span>
                            {t(
                              activeRenderSelection?.mounted
                                ? 'magnet.platform-login.action.deactivate'
                                : 'magnet.platform.instance.activateWorkspace'
                            )}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {(activeContractRecord || capabilityLabelKeys.length > 0 || apiBindingKeys.length > 0) ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {activeContractRecord ? (
                        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/68">
                          {t('magnet.platform.contract.version', {
                            version: activeContractRecord.contract.contractVersion,
                          })}
                        </span>
                      ) : null}
                      {capabilityLabelKeys.map((labelKey) => (
                        <span
                          key={labelKey}
                          className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/68"
                        >
                          {t(labelKey)}
                        </span>
                      ))}
                      {apiBindingKeys.map((bindingKey) => (
                        <span
                          key={bindingKey}
                          className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] text-white/54"
                        >
                          {bindingKey}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 px-4 py-4">
                  {!activeContractRecord || !activeDefinition ? (
                    <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 rounded-[20px] border border-dashed border-white/10 bg-black/10 px-6 text-center">
                      <LayoutGrid className="h-8 w-8 text-white/28" />
                      <div className="text-base font-medium text-white">
                        {t('magnet.platform-login.status.comingSoon')}
                      </div>
                      <p className="max-w-md text-sm leading-6 text-white/56">
                        {t('magnet.platform.empty.noMountedHint')}
                      </p>
                    </div>
                  ) : activeRenderSelection?.mounted !== true ? (
                    <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-4 rounded-[20px] border border-dashed border-white/10 bg-black/10 px-6 text-center">
                      <LayoutGrid className="h-8 w-8 text-white/28" />
                      <div className="text-base font-medium text-white">
                        {t('magnet.platform.empty.noMounted')}
                      </div>
                      <p className="max-w-md text-sm leading-6 text-white/56">
                        {t('magnet.platform.empty.noMountedHint')}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleToggleMounted(activeItem)}
                        disabled={activeFacade?.authState !== 'authorized'}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm text-white/82 transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Power className="h-4 w-4" />
                        <span>{t('magnet.platform.instance.activateWorkspace')}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex h-full min-h-0 flex-col gap-4">
                      <div className="rounded-[18px] border border-white/8 bg-black/10 px-3 py-3">
                        {renderWorkspaceToolbar()}
                      </div>
                      <div className="min-h-0 flex-1 overflow-hidden rounded-[20px] border border-white/8 bg-black/10 p-2">
                        {connectorViewsLoading && !activeFacade ? (
                          <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-white/48">
                            {t('common.state.loading')}
                          </div>
                        ) : (
                          renderWorkspaceBody()
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 px-6 text-center">
                <LayoutGrid className="h-8 w-8 text-white/28" />
                <div className="text-base font-medium text-white">
                  {t('magnet.platform.empty.noRegistered')}
                </div>
                <p className="max-w-md text-sm leading-6 text-white/56">
                  {t('magnet.platform.empty.noRegisteredHint')}
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  */
};

const PLATFORM_MAGNET_RENDERERS = {
  ...buildMagnetVariantRenderers(PlatformMagnetDefaultRenderer, PLATFORM_MAGNET_VARIANT_PRESETS),
} satisfies Record<string, ComponentType<PlatformMagnetRendererProps>>;

export const PlatformMagnet: React.FC = () => {
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('platform-magnet', PLATFORM_MAGNET_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer skinProps={skin.props} />;
};

