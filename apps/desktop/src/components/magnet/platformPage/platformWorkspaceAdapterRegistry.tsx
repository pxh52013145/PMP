import React from 'react';

import type {
  PlatformConnectorId,
  PlatformConnectorTemplate,
  PlatformConnectorWorkspaceKind,
} from '../../../modules/music-platform';
import {
  BilibiliWorkspaceAdapter,
  BilibiliWorkspaceToolbar,
  type BilibiliWorkspaceToolbarProps,
} from './BilibiliWorkspaceAdapter';
import type { BilibiliWorkspaceProps } from './BilibiliWorkspace';
import {
  NeteaseWorkspaceAdapter,
  NeteaseWorkspaceToolbar,
  type NeteaseWorkspaceToolbarProps,
} from './NeteaseWorkspaceAdapter';
import type { NeteaseWorkspaceProps } from './NeteaseWorkspace';
import {
  DedicatedWorkspacePlaceholderAdapter,
  DedicatedWorkspacePlaceholderToolbar,
  type DedicatedWorkspacePlaceholderProps,
  type DedicatedWorkspacePlaceholderToolbarProps,
} from './DedicatedWorkspacePlaceholderAdapter';

export interface PlatformWorkspaceAdapterPayloadMap {
  bilibili: {
    toolbar: BilibiliWorkspaceToolbarProps;
    workspace: BilibiliWorkspaceProps;
  };
  netease: {
    toolbar: NeteaseWorkspaceToolbarProps;
    workspace: NeteaseWorkspaceProps;
  };
  qqmusic: {
    toolbar: DedicatedWorkspacePlaceholderToolbarProps;
    workspace: DedicatedWorkspacePlaceholderProps;
  };
}

export interface PlatformWorkspaceAdapter<K extends keyof PlatformWorkspaceAdapterPayloadMap> {
  workspaceKind: K;
  settingsController: 'none' | 'bilibili';
  renderToolbar: (
    payload: PlatformWorkspaceAdapterPayloadMap[K]['toolbar']
  ) => React.ReactElement | null;
  renderWorkspace: (
    payload: PlatformWorkspaceAdapterPayloadMap[K]['workspace']
  ) => React.ReactElement;
}

export type AnyPlatformWorkspaceAdapter = {
  [K in keyof PlatformWorkspaceAdapterPayloadMap]: PlatformWorkspaceAdapter<K>;
}[keyof PlatformWorkspaceAdapterPayloadMap];

const bilibiliWorkspaceAdapter: PlatformWorkspaceAdapter<'bilibili'> = {
  workspaceKind: 'bilibili',
  settingsController: 'bilibili',
  renderToolbar: (payload) => <BilibiliWorkspaceToolbar {...payload} />,
  renderWorkspace: (payload) => <BilibiliWorkspaceAdapter {...payload} />,
};

const neteaseWorkspaceAdapter: PlatformWorkspaceAdapter<'netease'> = {
  workspaceKind: 'netease',
  settingsController: 'none',
  renderToolbar: (payload) => <NeteaseWorkspaceToolbar {...payload} />,
  renderWorkspace: (payload) => <NeteaseWorkspaceAdapter {...payload} />,
};

const qqmusicWorkspaceAdapter: PlatformWorkspaceAdapter<'qqmusic'> = {
  workspaceKind: 'qqmusic',
  settingsController: 'none',
  renderToolbar: (payload) => <DedicatedWorkspacePlaceholderToolbar {...payload} />,
  renderWorkspace: (payload) => <DedicatedWorkspacePlaceholderAdapter {...payload} />,
};

const platformWorkspaceKindAdapterRegistry: {
  [K in keyof PlatformWorkspaceAdapterPayloadMap]: PlatformWorkspaceAdapter<K>;
} = {
  bilibili: bilibiliWorkspaceAdapter,
  netease: neteaseWorkspaceAdapter,
  qqmusic: qqmusicWorkspaceAdapter,
};

const platformWorkspaceConnectorAdapterRegistry: Partial<
  Record<PlatformConnectorId, AnyPlatformWorkspaceAdapter>
> = {
  'connector.platform.bilibili': bilibiliWorkspaceAdapter,
  'connector.platform.netease': neteaseWorkspaceAdapter,
  'connector.platform.qqmusic': qqmusicWorkspaceAdapter,
};

function normalizeConnectorId(connectorId: string | null | undefined): PlatformConnectorId | null {
  if (typeof connectorId !== 'string') return null;
  const normalized = connectorId.trim().toLowerCase();
  if (!normalized.startsWith('connector.platform.')) return null;
  return normalized as PlatformConnectorId;
}

export interface PlatformWorkspaceAdapterResolveOptions {
  connectorId?: string | null;
  workspaceKind: PlatformConnectorWorkspaceKind;
  platformTemplate?: PlatformConnectorTemplate;
}

export type PlatformWorkspaceDefaultMode = 'generic' | 'bilibili' | 'netease';

const DEFAULT_CONNECTOR_ID_BY_MODE: Partial<
  Record<PlatformWorkspaceDefaultMode, PlatformConnectorId>
> = {
  bilibili: 'connector.platform.bilibili',
  netease: 'connector.platform.netease',
};

const DAILY_SUBTITLE_KEY_BY_CONNECTOR_ID: Partial<Record<PlatformConnectorId, string>> = {
  'connector.platform.bilibili': 'magnet.platform.daily.bilibili.subtitle',
  'connector.platform.netease': 'magnet.platform.daily.netease.subtitle',
  'connector.platform.qqmusic': 'magnet.platform.daily.qqmusic.subtitle',
};

export function resolvePlatformWorkspaceAdapter(
  options: PlatformWorkspaceAdapterResolveOptions
): AnyPlatformWorkspaceAdapter | null {
  const normalizedConnectorId = normalizeConnectorId(options.connectorId);
  if (normalizedConnectorId) {
    const connectorAdapter = platformWorkspaceConnectorAdapterRegistry[normalizedConnectorId];
    if (connectorAdapter) return connectorAdapter;
  }

  if (options.workspaceKind in platformWorkspaceKindAdapterRegistry) {
    return platformWorkspaceKindAdapterRegistry[
      options.workspaceKind as keyof PlatformWorkspaceAdapterPayloadMap
    ];
  }

  if (options.platformTemplate === 'video') {
    return bilibiliWorkspaceAdapter;
  }
  if (options.platformTemplate === 'music') {
    return neteaseWorkspaceAdapter;
  }
  if (options.platformTemplate === 'generic') {
    return qqmusicWorkspaceAdapter;
  }

  return null;
}

export function getPlatformWorkspaceAdapter(
  workspaceKind: PlatformConnectorWorkspaceKind
): AnyPlatformWorkspaceAdapter | null {
  return resolvePlatformWorkspaceAdapter({ workspaceKind });
}

export function resolveDefaultConnectorIdByWorkspaceDefaultMode(
  defaultMode: PlatformWorkspaceDefaultMode
): PlatformConnectorId | null {
  return DEFAULT_CONNECTOR_ID_BY_MODE[defaultMode] ?? null;
}

export function resolveDailySubtitleKeyByConnectorId(
  connectorId: string | null | undefined
): string {
  const normalizedConnectorId = normalizeConnectorId(connectorId);
  if (!normalizedConnectorId) return 'magnet.platform.daily.defaultSubtitle';
  return DAILY_SUBTITLE_KEY_BY_CONNECTOR_ID[normalizedConnectorId] ?? 'magnet.platform.daily.defaultSubtitle';
}

export function resolveWorkspaceSettingsController(
  options: PlatformWorkspaceAdapterResolveOptions
): AnyPlatformWorkspaceAdapter['settingsController'] {
  return resolvePlatformWorkspaceAdapter(options)?.settingsController ?? 'none';
}

export function renderPlatformWorkspaceAdapterToolbar(
  adapter: AnyPlatformWorkspaceAdapter,
  payloads: PlatformWorkspaceAdapterPayloadMap
): React.ReactElement | null {
  const payload = payloads[adapter.workspaceKind];
  return adapter.renderToolbar(payload.toolbar as never);
}

export function renderPlatformWorkspaceAdapterWorkspace(
  adapter: AnyPlatformWorkspaceAdapter,
  payloads: PlatformWorkspaceAdapterPayloadMap
): React.ReactElement {
  const payload = payloads[adapter.workspaceKind];
  return adapter.renderWorkspace(payload.workspace as never);
}
