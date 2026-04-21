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
  MusicTemplateWorkspaceAdapter,
  MusicTemplateWorkspaceToolbar,
  type MusicTemplateWorkspaceToolbarProps,
} from './MusicTemplateWorkspaceAdapter';
import type { MusicTemplateWorkspaceProps } from './MusicTemplateWorkspace';
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
  music: {
    toolbar: MusicTemplateWorkspaceToolbarProps;
    workspace: MusicTemplateWorkspaceProps;
  };
  generic: {
    toolbar: DedicatedWorkspacePlaceholderToolbarProps;
    workspace: DedicatedWorkspacePlaceholderProps;
  };
}

export type PlatformWorkspaceAdapterKind = keyof PlatformWorkspaceAdapterPayloadMap;

export interface PlatformWorkspaceAdapter<K extends PlatformWorkspaceAdapterKind> {
  adapterKind: K;
  renderToolbar: (
    payload: PlatformWorkspaceAdapterPayloadMap[K]['toolbar']
  ) => React.ReactElement | null;
  renderWorkspace: (
    payload: PlatformWorkspaceAdapterPayloadMap[K]['workspace']
  ) => React.ReactElement;
}

export type AnyPlatformWorkspaceAdapter = {
  [K in PlatformWorkspaceAdapterKind]: PlatformWorkspaceAdapter<K>;
}[PlatformWorkspaceAdapterKind];

const bilibiliWorkspaceAdapter: PlatformWorkspaceAdapter<'bilibili'> = {
  adapterKind: 'bilibili',
  renderToolbar: (payload) => <BilibiliWorkspaceToolbar {...payload} />,
  renderWorkspace: (payload) => <BilibiliWorkspaceAdapter {...payload} />,
};

const musicTemplateWorkspaceAdapter: PlatformWorkspaceAdapter<'music'> = {
  adapterKind: 'music',
  renderToolbar: (payload) => <MusicTemplateWorkspaceToolbar {...payload} />,
  renderWorkspace: (payload) => <MusicTemplateWorkspaceAdapter {...payload} />,
};

const genericWorkspaceAdapter: PlatformWorkspaceAdapter<'generic'> = {
  adapterKind: 'generic',
  renderToolbar: (payload) => <DedicatedWorkspacePlaceholderToolbar {...payload} />,
  renderWorkspace: (payload) => <DedicatedWorkspacePlaceholderAdapter {...payload} />,
};

const platformWorkspaceKindAdapterRegistry: Partial<
  Record<PlatformConnectorWorkspaceKind, AnyPlatformWorkspaceAdapter>
> = {
  bilibili: bilibiliWorkspaceAdapter,
  netease: musicTemplateWorkspaceAdapter,
  generic: genericWorkspaceAdapter,
};

const platformWorkspaceConnectorAdapterRegistry: Partial<
  Record<PlatformConnectorId, AnyPlatformWorkspaceAdapter>
> = {
  'connector.platform.bilibili': bilibiliWorkspaceAdapter,
  'connector.platform.netease': musicTemplateWorkspaceAdapter,
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

export type PlatformWorkspaceDefaultMode = 'generic' | 'video' | 'music';

export function resolveDefaultWorkspaceAdapterKindByWorkspaceDefaultMode(
  defaultMode: PlatformWorkspaceDefaultMode
): PlatformWorkspaceAdapterKind | null {
  switch (defaultMode) {
    case 'video':
      return 'bilibili';
    case 'music':
      return 'music';
    case 'generic':
      return 'generic';
    default:
      return null;
  }
}

const DAILY_SUBTITLE_KEY_BY_CONNECTOR_ID: Partial<Record<PlatformConnectorId, string>> = {
  'connector.platform.bilibili': 'magnet.platform.daily.bilibili.subtitle',
  'connector.platform.netease': 'magnet.platform.daily.music-template.subtitle',
};

export function resolvePlatformWorkspaceAdapter(
  options: PlatformWorkspaceAdapterResolveOptions
): AnyPlatformWorkspaceAdapter | null {
  const normalizedConnectorId = normalizeConnectorId(options.connectorId);
  if (normalizedConnectorId) {
    const connectorAdapter = platformWorkspaceConnectorAdapterRegistry[normalizedConnectorId];
    if (connectorAdapter) return connectorAdapter;
  }

  const workspaceKindAdapter = platformWorkspaceKindAdapterRegistry[options.workspaceKind];
  if (workspaceKindAdapter) {
    return workspaceKindAdapter;
  }

  if (options.platformTemplate === 'video') {
    return bilibiliWorkspaceAdapter;
  }
  if (options.platformTemplate === 'music') {
    return musicTemplateWorkspaceAdapter;
  }
  if (options.platformTemplate === 'generic') {
    return genericWorkspaceAdapter;
  }

  return null;
}

export function resolvePlatformWorkspaceAdapterKind(
  options: PlatformWorkspaceAdapterResolveOptions
): PlatformWorkspaceAdapterKind | null {
  return resolvePlatformWorkspaceAdapter(options)?.adapterKind ?? null;
}

export function getPlatformWorkspaceAdapter(
  workspaceKind: PlatformConnectorWorkspaceKind
): AnyPlatformWorkspaceAdapter | null {
  return resolvePlatformWorkspaceAdapter({ workspaceKind });
}

export function resolveDailySubtitleKeyByConnectorId(
  connectorId: string | null | undefined
): string {
  const normalizedConnectorId = normalizeConnectorId(connectorId);
  if (!normalizedConnectorId) return 'magnet.platform.daily.defaultSubtitle';
  return DAILY_SUBTITLE_KEY_BY_CONNECTOR_ID[normalizedConnectorId] ?? 'magnet.platform.daily.defaultSubtitle';
}

export function renderPlatformWorkspaceAdapterToolbar(
  adapter: AnyPlatformWorkspaceAdapter,
  payloads: PlatformWorkspaceAdapterPayloadMap
): React.ReactElement | null {
  const payload = payloads[adapter.adapterKind];
  return adapter.renderToolbar(payload.toolbar as never);
}

export function renderPlatformWorkspaceAdapterWorkspace(
  adapter: AnyPlatformWorkspaceAdapter,
  payloads: PlatformWorkspaceAdapterPayloadMap
): React.ReactElement {
  const payload = payloads[adapter.adapterKind];
  return adapter.renderWorkspace(payload.workspace as never);
}
