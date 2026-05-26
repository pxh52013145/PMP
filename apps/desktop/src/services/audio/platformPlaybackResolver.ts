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

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readTrackString(track: Track, keys: string[]): string {
  const record = track as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = normalizeString(record[key]);
    if (value) return value;
  }
  return '';
}

function isProbablyAbsolutePath(value: string): boolean {
  if (!value) return false;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (value.startsWith('\\\\')) return true;
  if (value.startsWith('/')) return true;
  if (/^file:\/\//i.test(value)) return true;
  return false;
}

function isPlatformSourceLocator(value: string): boolean {
  const normalized = normalizeString(value).toLowerCase();
  return (
    normalized.startsWith('netease://') ||
    normalized.startsWith('bilibili://') ||
    normalized.startsWith('platform://')
  );
}

export function isBilibiliSourceLocator(value?: string | null): boolean {
  return normalizeString(value).toLowerCase().startsWith('bilibili://');
}

export function resolveBilibiliSourceLocatorFromTrack(
  track: Track,
  _options: ResolvePlatformPlaybackIdentityOptions = {}
): string | null {
  const locator = readTrackString(track, ['sourceLocator', 'source_locator', 'originalPath']);
  return isBilibiliSourceLocator(locator) ? locator : null;
}

export function inferPlatformConnectorIdFromTrack(
  track: Track,
  sourceLocator: string | null,
  _options: ResolvePlatformPlaybackIdentityOptions = {}
): string | null {
  const explicit = readTrackString(track, [
    'connectorId',
    'connector_id',
    'sourceConnectorId',
    'source_connector_id',
  ]);
  if (explicit) return explicit;

  const locator = normalizeString(sourceLocator).toLowerCase();
  if (locator.startsWith('netease://')) return NETEASE_PLATFORM_CONNECTOR_ID;
  if (locator.startsWith('bilibili://')) return BILIBILI_PLATFORM_CONNECTOR_ID;
  return null;
}

export function buildStablePlatformEntryId(connectorId: string, sourceKey: string): string {
  const safeConnectorId = connectorId.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const safeSourceKey = sourceKey.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return `entry::platform-archived::${safeConnectorId || 'unknown'}::${safeSourceKey || 'unknown'}`;
}

export function resolvePlatformPlaybackIdentity(
  track: Track,
  _options: ResolvePlatformPlaybackIdentityOptions = {}
): PlatformPlaybackIdentity | null {
  const sourceLocator =
    readTrackString(track, ['sourceLocator', 'source_locator']) ||
    [track.originalPath, track.comment, track.path]
      .map((value) => normalizeString(value))
      .find((value) => isPlatformSourceLocator(value) && !isProbablyAbsolutePath(value)) ||
    '';

  const hasInlinePlaybackSource = !!readTrackString(track, ['streamUrl', 'stream_url']);

  if (!sourceLocator && !hasInlinePlaybackSource) return null;

  const inferredConnectorId = inferPlatformConnectorIdFromTrack(track, sourceLocator, _options);
  const connectorId =
    inferredConnectorId ||
    readTrackString(track, ['sourceId', 'source_id']) ||
    'connector.platform.default';
  const sourceKey = sourceLocator || normalizeString(track.id) || normalizeString(track.path);
  if (!sourceKey) return null;

  return {
    connectorId,
    sourceLocator: sourceLocator || sourceKey,
    sourceKey,
    entryId: buildStablePlatformEntryId(connectorId, sourceKey),
  };
}
