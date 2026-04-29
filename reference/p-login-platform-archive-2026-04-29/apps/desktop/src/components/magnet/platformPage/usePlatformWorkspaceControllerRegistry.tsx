import { useMemo } from 'react';

import type { Playlist as AudioPlaylist } from '../../../services/audio';
import type { IAudioService } from '../../../services/audio/types';
import type {
  PlatformCompatRegistryRecord,
  PlatformConnectorDefinition,
  PlatformConnectorFacadeItem,
  PlatformInstanceRecord,
} from '../../../modules/music-platform';
import {
  DedicatedWorkspacePlaceholderAdapter,
  DedicatedWorkspacePlaceholderToolbar,
} from './DedicatedWorkspacePlaceholderAdapter';
import type {
  PlatformWorkspaceAdapterKind,
  PlatformWorkspaceAdapterPayloadMap,
} from './platformWorkspaceAdapterRegistry';
import type { PlatformWorkspaceDescriptor } from './platformWorkspaceModes';
import {
  buildConnectorIdsByAdapterKind,
  createPlatformWorkspaceRuntimeAdapterRegistry,
  type PlatformPageView,
  type WorkspaceRuntimeAdapter,
} from './platformWorkspaceRuntimeAdapters';
import { useBilibiliWorkspaceAdapterController } from './useBilibiliWorkspaceAdapterController';
import { useDedicatedWorkspacePlaceholderController } from './useDedicatedWorkspacePlaceholderController';
import { useMusicTemplateWorkspaceAdapterController } from './useMusicTemplateWorkspaceAdapterController';

type Translator = (key: string, params?: Record<string, string | number>) => string;

export interface PlatformWorkspaceRegistrationItem {
  entry: { connectorId: string };
  definition: PlatformConnectorDefinition | null;
  contractRecord: PlatformCompatRegistryRecord | null;
  instance: PlatformInstanceRecord | null;
  facade: PlatformConnectorFacadeItem | null;
}

type ConnectorVisualMeta = {
  color: string;
  iconAssetUrl?: string;
};

export interface UsePlatformWorkspaceControllerRegistryParams {
  activePage: PlatformPageView;
  settingsOpen: boolean;
  activeWorkspacePath: 'legacy' | 'pack' | 'none';
  activeConnectorId: string | null;
  activeWorkspaceConnectorId: string | null;
  activeWorkspaceAdapterKind: PlatformWorkspaceAdapterKind | null;
  activeWorkspaceDescriptor: PlatformWorkspaceDescriptor | null;
  settingsWorkspaceAdapterKind: PlatformWorkspaceAdapterKind | null;
  activeItem: PlatformWorkspaceRegistrationItem | null;
  settingsItem: PlatformWorkspaceRegistrationItem | null;
  mountedRegisteredItems: PlatformWorkspaceRegistrationItem[];
  platformPlaylistsByConnectorId: Map<string, AudioPlaylist[]>;
  audioService: IAudioService;
  t: Translator;
  selectedPlaylistId: string | null;
  selectedLocalPlaylistId: string | null;
  playlistError: string | null;
  setPlaylistError: (value: string | null) => void;
  resolveConnectorVisualMeta: (
    connectorId: string | null | undefined,
    definition?: PlatformConnectorDefinition | null
  ) => ConnectorVisualMeta;
}

export interface PlatformWorkspaceControllerRegistryResult {
  workspaceTemplateAdapterPayloads: PlatformWorkspaceAdapterPayloadMap;
  workspaceRuntimeAdapterRegistry: Record<
    PlatformWorkspaceAdapterKind,
    WorkspaceRuntimeAdapter
  >;
  fallbackToolbar: JSX.Element | null;
  fallbackWorkspace: JSX.Element;
}

function resolveWorkspaceItemDisplayName(
  item: PlatformWorkspaceRegistrationItem | null,
  t: Translator
): string | null {
  if (!item) return null;
  if (item.definition?.labelKey) {
    return t(item.definition.labelKey);
  }
  return item.facade?.displayName ?? item.definition?.displayName ?? item.entry.connectorId;
}

export function usePlatformWorkspaceControllerRegistry(
  params: UsePlatformWorkspaceControllerRegistryParams
): PlatformWorkspaceControllerRegistryResult {
  const {
    activePage,
    settingsOpen,
    activeWorkspacePath,
    activeConnectorId,
    activeWorkspaceConnectorId,
    activeWorkspaceAdapterKind,
    activeWorkspaceDescriptor,
    settingsWorkspaceAdapterKind,
    activeItem,
    settingsItem,
    mountedRegisteredItems,
    platformPlaylistsByConnectorId,
    audioService,
    t,
    selectedPlaylistId,
    selectedLocalPlaylistId,
    playlistError,
    setPlaylistError,
    resolveConnectorVisualMeta,
  } = params;

  const activeVideoItem = useMemo<PlatformWorkspaceRegistrationItem | null>(
    () => (activeWorkspaceAdapterKind === 'bilibili' ? activeItem : null),
    [activeItem, activeWorkspaceAdapterKind]
  );
  const activeMusicItem = useMemo<PlatformWorkspaceRegistrationItem | null>(
    () => (activeWorkspaceAdapterKind === 'music' ? activeItem : null),
    [activeItem, activeWorkspaceAdapterKind]
  );
  const settingsVideoItem = useMemo<PlatformWorkspaceRegistrationItem | null>(
    () => (settingsWorkspaceAdapterKind === 'bilibili' ? settingsItem : null),
    [settingsItem, settingsWorkspaceAdapterKind]
  );
  const settingsMusicItem = useMemo<PlatformWorkspaceRegistrationItem | null>(
    () => (settingsWorkspaceAdapterKind === 'music' ? settingsItem : null),
    [settingsItem, settingsWorkspaceAdapterKind]
  );

  const activeMusicConnectorId = activeMusicItem?.entry.connectorId ?? null;
  const activeMusicDefinition = activeMusicItem?.definition ?? null;
  const activeMusicDisplayName = useMemo(
    () => resolveWorkspaceItemDisplayName(activeMusicItem, t),
    [activeMusicItem, t]
  );
  const settingsMusicConnectorId = settingsMusicItem?.entry.connectorId ?? null;
  const settingsMusicDisplayName = useMemo(
    () => resolveWorkspaceItemDisplayName(settingsMusicItem, t),
    [settingsMusicItem, t]
  );

  const bilibiliController = useBilibiliWorkspaceAdapterController({
    workspaceVisible: activePage === 'instance' && activeWorkspacePath === 'legacy',
    activeWorkspaceConnectorId,
    activeVideoConnectorId: activeVideoItem?.entry.connectorId ?? null,
    activeVideoInstanceId: activeVideoItem?.instance?.instanceId ?? null,
    activeVideoAuthState: activeVideoItem?.facade?.authState ?? null,
    audioService,
    t,
    selectedLocalPlaylistId,
    playlistError,
    setPlaylistError,
  });
  const settingsBilibiliController = useBilibiliWorkspaceAdapterController({
    workspaceVisible: settingsOpen,
    workspaceDataEnabled: false,
    activeWorkspaceConnectorId: settingsOpen
      ? settingsVideoItem?.entry.connectorId ?? null
      : null,
    activeVideoConnectorId: settingsOpen
      ? settingsVideoItem?.entry.connectorId ?? null
      : null,
    activeVideoInstanceId: settingsOpen
      ? settingsVideoItem?.instance?.instanceId ?? null
      : null,
    activeVideoAuthState: settingsOpen
      ? settingsVideoItem?.facade?.authState ?? null
      : null,
    audioService,
    t,
    selectedLocalPlaylistId: null,
    playlistError,
    setPlaylistError,
  });

  const musicTemplateController = useMusicTemplateWorkspaceAdapterController({
    workspaceVisible: activePage === 'instance' && activeWorkspacePath === 'legacy',
    activeWorkspaceConnectorId,
    activeMusicConnectorId,
    activeMusicDisplayName,
    activeMusicContractRecord: activeMusicItem?.contractRecord ?? null,
    activeMusicInstanceId: activeMusicItem?.instance?.instanceId ?? null,
    activeMusicAuthState: activeMusicItem?.facade?.authState ?? null,
    prefersDarkMode: true,
    audioService,
    t,
    selectedPlaylistId,
    playlistError,
    setPlaylistError,
  });
  const settingsMusicTemplateController = useMusicTemplateWorkspaceAdapterController({
    workspaceVisible: settingsOpen,
    workspaceDataEnabled: false,
    activeWorkspaceConnectorId: settingsOpen ? settingsMusicConnectorId : null,
    activeMusicConnectorId: settingsOpen ? settingsMusicConnectorId : null,
    activeMusicDisplayName: settingsOpen ? settingsMusicDisplayName : null,
    activeMusicContractRecord: settingsOpen
      ? settingsMusicItem?.contractRecord ?? null
      : null,
    activeMusicInstanceId: settingsOpen
      ? settingsMusicItem?.instance?.instanceId ?? null
      : null,
    activeMusicAuthState: settingsOpen
      ? settingsMusicItem?.facade?.authState ?? null
      : null,
    prefersDarkMode: true,
    audioService,
    t,
    selectedPlaylistId: null,
    playlistError,
    setPlaylistError,
  });

  const musicTemplatePlatformLabel =
    activeMusicDisplayName ??
    musicTemplateController.musicTemplateWorkspaceProps.platformLabel;
  const musicTemplateVisualMeta = resolveConnectorVisualMeta(
    activeMusicConnectorId,
    activeMusicDefinition
  );
  const musicTemplateWorkspaceProps = {
    ...musicTemplateController.musicTemplateWorkspaceProps,
    platformLabel: musicTemplatePlatformLabel,
    platformAccentColor: musicTemplateVisualMeta.color,
    platformFallbackLabel:
      musicTemplatePlatformLabel.trim().charAt(0).toUpperCase() || 'M',
    platformIconAssetUrl: musicTemplateVisualMeta.iconAssetUrl ?? null,
  };

  const placeholderController = useDedicatedWorkspacePlaceholderController({
    activeWorkspaceDescriptor,
    t,
  });

  const connectorIdsByAdapterKind = useMemo(
    () => buildConnectorIdsByAdapterKind(mountedRegisteredItems),
    [mountedRegisteredItems]
  );

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

  const workspaceRuntimeAdapterRegistry = useMemo<
    Record<PlatformWorkspaceAdapterKind, WorkspaceRuntimeAdapter>
  >(
    () =>
      createPlatformWorkspaceRuntimeAdapterRegistry({
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
      }),
    [
      activeConnectorId,
      activeMusicConnectorId,
      activePage,
      bilibiliController,
      connectorIdsByAdapterKind,
      mountedRegisteredItems,
      musicTemplateController,
      platformPlaylistsByConnectorId,
      settingsBilibiliController,
      settingsMusicTemplateController,
      t,
    ]
  );

  return {
    workspaceTemplateAdapterPayloads,
    workspaceRuntimeAdapterRegistry,
    fallbackToolbar: (
      <DedicatedWorkspacePlaceholderToolbar
        {...placeholderController.placeholderToolbarProps}
      />
    ),
    fallbackWorkspace: (
      <DedicatedWorkspacePlaceholderAdapter
        {...placeholderController.placeholderWorkspaceProps}
      />
    ),
  };
}
