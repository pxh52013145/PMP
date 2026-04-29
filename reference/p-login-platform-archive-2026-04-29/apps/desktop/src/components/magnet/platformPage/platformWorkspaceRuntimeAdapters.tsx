import type { Playlist as AudioPlaylist } from '../../../services/audio';
import {
  resolvePlatformConnectorTemplate,
  type PlatformConnectorDefinition,
  type PlatformConnectorFacadeItem,
} from '../../../modules/music-platform';
import { BilibiliPlaybackSettingsContent } from './BilibiliPlaybackSettingsModal';
import { MusicTemplatePlaybackSettingsContent } from './MusicTemplatePlaybackSettings';
import {
  resolvePlatformWorkspaceAdapterKind,
  type PlatformWorkspaceAdapterKind,
} from './platformWorkspaceAdapterRegistry';
import type { BilibiliWorkspaceAdapterControllerResult } from './useBilibiliWorkspaceAdapterController';
import type { MusicTemplateWorkspaceAdapterControllerResult } from './useMusicTemplateWorkspaceAdapterController';

type Translator = (key: string, params?: Record<string, string | number>) => string;

export type PlatformPageView = 'daily' | 'overview' | 'instance' | 'local';

export type PlaylistDrawerGroup = {
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

export type WorkspaceShellSearchState = {
  value: string;
  placeholder: string;
  disabled: boolean;
  loading: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export type WorkspaceSettingsPanelRenderContext = {
  settingsLabel: string;
  settingsItems: PlatformWorkspaceRegisteredItem[];
};

export type WorkspaceRuntimeAdapter = {
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

export type PlatformWorkspaceRegisteredItem = {
  entry: { connectorId: string };
  definition: PlatformConnectorDefinition | null;
  facade: PlatformConnectorFacadeItem | null;
};

export function buildConnectorIdsByAdapterKind(
  mountedRegisteredItems: PlatformWorkspaceRegisteredItem[]
): Map<PlatformWorkspaceAdapterKind, string[]> {
  const next = new Map<PlatformWorkspaceAdapterKind, string[]>();
  for (const item of mountedRegisteredItems) {
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
}

function findRegisteredItemByConnectorId(
  mountedRegisteredItems: PlatformWorkspaceRegisteredItem[],
  connectorId: string | null
): PlatformWorkspaceRegisteredItem | null {
  if (!connectorId) return null;
  return mountedRegisteredItems.find((item) => item.entry.connectorId === connectorId) ?? null;
}

function resolveRegisteredItemLabel(
  item: PlatformWorkspaceRegisteredItem | null,
  fallbackConnectorId: string,
  t: Translator
): string {
  if (item?.definition?.labelKey) {
    return t(item.definition.labelKey);
  }
  return item?.facade?.displayName ?? fallbackConnectorId;
}

export interface CreatePlatformWorkspaceRuntimeAdapterRegistryParams {
  activePage: PlatformPageView;
  activeConnectorId: string | null;
  activeMusicConnectorId: string | null;
  mountedRegisteredItems: PlatformWorkspaceRegisteredItem[];
  platformPlaylistsByConnectorId: Map<string, AudioPlaylist[]>;
  connectorIdsByAdapterKind: Map<PlatformWorkspaceAdapterKind, string[]>;
  bilibiliController: BilibiliWorkspaceAdapterControllerResult;
  settingsBilibiliController: BilibiliWorkspaceAdapterControllerResult;
  musicTemplateController: MusicTemplateWorkspaceAdapterControllerResult;
  settingsMusicTemplateController: MusicTemplateWorkspaceAdapterControllerResult;
  t: Translator;
}

export function createPlatformWorkspaceRuntimeAdapterRegistry(
  params: CreatePlatformWorkspaceRuntimeAdapterRegistryParams
): Record<PlatformWorkspaceAdapterKind, WorkspaceRuntimeAdapter> {
  const {
    activePage,
    activeConnectorId,
    activeMusicConnectorId,
    mountedRegisteredItems,
    platformPlaylistsByConnectorId,
    connectorIdsByAdapterKind,
    bilibiliController,
    settingsBilibiliController,
    musicTemplateController,
    settingsMusicTemplateController,
    t,
  } = params;

  return {
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
        const bilibiliItem = findRegisteredItemByConnectorId(mountedRegisteredItems, activeConnectorId);
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
          label: resolveRegisteredItemLabel(bilibiliItem, activeConnectorId, t),
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
        <BilibiliPlaybackSettingsContent {...settingsBilibiliController.bilibiliSettingsProps} />
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
        const musicItem = findRegisteredItemByConnectorId(mountedRegisteredItems, connectorId);

        return {
          id: connectorId,
          connectorId,
          label: resolveRegisteredItemLabel(musicItem, connectorId, t),
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
  };
}
