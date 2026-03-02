import type { Track } from './types';

export const BILIBILI_PLATFORM_CONNECTOR_ID = 'connector.platform.bilibili';

export type PlatformPlaybackIdentity = {
  connectorId: string;
  sourceLocator: string | null;
  sourceKey: string;
  entryId: string;
};

export function isBilibiliSourceLocator(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.startsWith('bilibili://') ||
    normalized.includes('bilibili.com/video/') ||
    normalized.includes('bvid=')
  );
}

export function resolveBilibiliSourceLocatorFromTrack(track: Track): string | null {
  const candidates = [track.originalPath, track.comment, track.path];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim();
    if (!normalized) continue;
    if (isBilibiliSourceLocator(normalized)) {
      return normalized;
    }
  }
  return null;
}

export function inferPlatformConnectorIdFromTrack(
  track: Track,
  sourceLocator: string | null
): string | null {
  const normalizedTrackId = typeof track.id === 'string' ? track.id.trim().toLowerCase() : '';
  if (normalizedTrackId.startsWith('bilibili:')) {
    return BILIBILI_PLATFORM_CONNECTOR_ID;
  }
  if (isBilibiliSourceLocator(sourceLocator)) {
    return BILIBILI_PLATFORM_CONNECTOR_ID;
  }
  return null;
}

export function buildStablePlatformEntryId(connectorId: string, sourceKey: string): string {
  const seed = `${connectorId.trim().toLowerCase()}|${sourceKey.trim().toLowerCase()}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const safeConnectorId = connectorId.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const hashHex = (hash >>> 0).toString(16).padStart(8, '0');
  return `entry::platform::${safeConnectorId}::${hashHex}`;
}

export function resolvePlatformPlaybackIdentity(track: Track): PlatformPlaybackIdentity | null {
  const sourceLocator = resolveBilibiliSourceLocatorFromTrack(track);
  const connectorId = inferPlatformConnectorIdFromTrack(track, sourceLocator);
  if (!connectorId) return null;

  const sourceKey =
    sourceLocator ||
    (typeof track.id === 'string' && track.id.trim().length > 0 ? track.id.trim() : '') ||
    (typeof track.title === 'string' && track.title.trim().length > 0 ? track.title.trim() : 'unknown');

  return {
    connectorId,
    sourceLocator,
    sourceKey,
    entryId: buildStablePlatformEntryId(connectorId, sourceKey),
  };
}
