import React from 'react';

import type {
  PlatformConnectorId,
  PlatformConnectorWorkspaceKind,
} from '../../../modules/music-platform';
import {
  BilibiliWorkspaceAdapter,
  BilibiliWorkspaceToolbar,
  type BilibiliWorkspaceToolbarProps,
} from './BilibiliWorkspaceAdapter';
import type { BilibiliWorkspaceProps } from './BilibiliWorkspace';
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
    toolbar: DedicatedWorkspacePlaceholderToolbarProps;
    workspace: DedicatedWorkspacePlaceholderProps;
  };
  qqmusic: {
    toolbar: DedicatedWorkspacePlaceholderToolbarProps;
    workspace: DedicatedWorkspacePlaceholderProps;
  };
}

export interface PlatformWorkspaceAdapter<K extends keyof PlatformWorkspaceAdapterPayloadMap> {
  workspaceKind: K;
  renderToolbar: (
    payload: PlatformWorkspaceAdapterPayloadMap[K]['toolbar']
  ) => React.ReactElement;
  renderWorkspace: (
    payload: PlatformWorkspaceAdapterPayloadMap[K]['workspace']
  ) => React.ReactElement;
}

export type AnyPlatformWorkspaceAdapter = {
  [K in keyof PlatformWorkspaceAdapterPayloadMap]: PlatformWorkspaceAdapter<K>;
}[keyof PlatformWorkspaceAdapterPayloadMap];

const bilibiliWorkspaceAdapter: PlatformWorkspaceAdapter<'bilibili'> = {
  workspaceKind: 'bilibili',
  renderToolbar: (payload) => <BilibiliWorkspaceToolbar {...payload} />,
  renderWorkspace: (payload) => <BilibiliWorkspaceAdapter {...payload} />,
};

const neteaseWorkspaceAdapter: PlatformWorkspaceAdapter<'netease'> = {
  workspaceKind: 'netease',
  renderToolbar: (payload) => <DedicatedWorkspacePlaceholderToolbar {...payload} />,
  renderWorkspace: (payload) => <DedicatedWorkspacePlaceholderAdapter {...payload} />,
};

const qqmusicWorkspaceAdapter: PlatformWorkspaceAdapter<'qqmusic'> = {
  workspaceKind: 'qqmusic',
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
}

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

  return null;
}

export function getPlatformWorkspaceAdapter(
  workspaceKind: PlatformConnectorWorkspaceKind
): AnyPlatformWorkspaceAdapter | null {
  return resolvePlatformWorkspaceAdapter({ workspaceKind });
}
