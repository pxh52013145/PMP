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

export interface PlatformWorkspaceAdapterPayloadMap {
  bilibili: {
    toolbar: BilibiliWorkspaceToolbarProps;
    workspace: BilibiliWorkspaceProps;
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

const bilibiliWorkspaceAdapter: PlatformWorkspaceAdapter<'bilibili'> = {
  workspaceKind: 'bilibili',
  renderToolbar: (payload) => <BilibiliWorkspaceToolbar {...payload} />,
  renderWorkspace: (payload) => <BilibiliWorkspaceAdapter {...payload} />,
};

const platformWorkspaceKindAdapterRegistry: {
  [K in keyof PlatformWorkspaceAdapterPayloadMap]: PlatformWorkspaceAdapter<K>;
} = {
  bilibili: bilibiliWorkspaceAdapter,
};

const platformWorkspaceConnectorAdapterRegistry: Partial<
  Record<PlatformConnectorId, PlatformWorkspaceAdapter<keyof PlatformWorkspaceAdapterPayloadMap>>
> = {
  'connector.platform.bilibili': bilibiliWorkspaceAdapter,
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
): PlatformWorkspaceAdapter<keyof PlatformWorkspaceAdapterPayloadMap> | null {
  const normalizedConnectorId = normalizeConnectorId(options.connectorId);
  if (normalizedConnectorId) {
    const connectorAdapter = platformWorkspaceConnectorAdapterRegistry[normalizedConnectorId];
    if (connectorAdapter) return connectorAdapter;
  }

  if (options.workspaceKind !== 'bilibili') return null;
  return platformWorkspaceKindAdapterRegistry.bilibili;
}

export function getPlatformWorkspaceAdapter(
  workspaceKind: PlatformConnectorWorkspaceKind
): PlatformWorkspaceAdapter<keyof PlatformWorkspaceAdapterPayloadMap> | null {
  return resolvePlatformWorkspaceAdapter({ workspaceKind });
}
