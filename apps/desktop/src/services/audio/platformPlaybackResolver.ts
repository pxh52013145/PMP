import type { Track } from './types';

export const BILIBILI_PLATFORM_CONNECTOR_ID = 'connector.platform.bilibili';
export const NETEASE_PLATFORM_CONNECTOR_ID = 'connector.platform.netease';

export type ResolvePlatformPlaybackIdentityOptions = {
  includeRegistry?: boolean;
};

export type PlatformPlaybackIdentity = {
  connectorId: string;
  sourceLocator: string | null;
  sourceKey: string;
  entryId: string;
};

export function isBilibiliSourceLocator(): boolean {
  return false;
}

export function resolveBilibiliSourceLocatorFromTrack(
  _track: Track,
  _options: ResolvePlatformPlaybackIdentityOptions = {}
): string | null {
  return null;
}

export function inferPlatformConnectorIdFromTrack(
  _track: Track,
  _sourceLocator: string | null,
  _options: ResolvePlatformPlaybackIdentityOptions = {}
): string | null {
  return null;
}

export function buildStablePlatformEntryId(connectorId: string, sourceKey: string): string {
  const safeConnectorId = connectorId.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const safeSourceKey = sourceKey.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return `entry::platform-archived::${safeConnectorId || 'unknown'}::${safeSourceKey || 'unknown'}`;
}

export function resolvePlatformPlaybackIdentity(
  _track: Track,
  _options: ResolvePlatformPlaybackIdentityOptions = {}
): PlatformPlaybackIdentity | null {
  return null;
}
