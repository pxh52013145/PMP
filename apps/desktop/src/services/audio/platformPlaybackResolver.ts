import { listPlatformConnectorDefinitions } from '../../modules/music-platform/connectorAuth';
import type { Track } from './types';

export const BILIBILI_PLATFORM_CONNECTOR_ID = 'connector.platform.bilibili';
export const NETEASE_PLATFORM_CONNECTOR_ID = 'connector.platform.netease';

type PlatformPlaybackConnectorHint = {
  connectorId: string;
  tokens: string[];
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

function normalizeToken(value: unknown): string {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function readConnectorSuffix(connectorId: string): string {
  return normalizeToken(connectorId.replace(/^connector\.platform\./i, ''));
}

function readBuiltinConnectorHints(): PlatformPlaybackConnectorHint[] {
  return [
    {
      connectorId: BILIBILI_PLATFORM_CONNECTOR_ID,
      tokens: ['bilibili'],
    },
    {
      connectorId: NETEASE_PLATFORM_CONNECTOR_ID,
      tokens: ['netease'],
    },
  ];
}

function listPlatformPlaybackConnectorHints(): PlatformPlaybackConnectorHint[] {
  const merged = new Map<string, Set<string>>();

  for (const builtin of readBuiltinConnectorHints()) {
    merged.set(builtin.connectorId, new Set(builtin.tokens));
  }

  try {
    for (const definition of listPlatformConnectorDefinitions()) {
      const connectorId = normalizeString(definition.connectorId).toLowerCase();
      if (!connectorId.startsWith('connector.platform.')) continue;

      const tokens = merged.get(connectorId) ?? new Set<string>();
      const suffix = readConnectorSuffix(connectorId);
      const workspaceKind = normalizeToken(definition.workspaceKind);

      if (suffix) tokens.add(suffix);
      if (workspaceKind) tokens.add(workspaceKind);

      merged.set(connectorId, tokens);
    }
  } catch {
    // Keep builtin hints available even if the connector registry is not ready.
  }

  return Array.from(merged.entries()).map(([connectorId, tokens]) => ({
    connectorId,
    tokens: Array.from(tokens.values()).filter((token) => token.length > 0),
  }));
}

function extractTrackIdPrefix(trackId: string): string {
  const normalizedTrackId = normalizeString(trackId).toLowerCase();
  if (!normalizedTrackId) return '';

  const separatorIndex = normalizedTrackId.indexOf(':');
  const prefix =
    separatorIndex > 0
      ? normalizedTrackId.slice(0, separatorIndex)
      : normalizedTrackId;
  return normalizeToken(prefix);
}

function extractCustomScheme(value: string): string {
  const normalized = normalizeString(value).toLowerCase();
  const match = /^([a-z][a-z0-9+.-]*):\/\//.exec(normalized);
  if (!match) return '';

  const scheme = normalizeToken(match[1]);
  if (
    scheme === 'http' ||
    scheme === 'https' ||
    scheme === 'file' ||
    scheme === 'blob' ||
    scheme === 'data'
  ) {
    return '';
  }

  return scheme;
}

function isRemoteUrl(value: string): boolean {
  const normalized = normalizeString(value).toLowerCase();
  return normalized.startsWith('http://') || normalized.startsWith('https://');
}

function findConnectorHintByTrackId(
  trackId: string,
  hints: PlatformPlaybackConnectorHint[]
): PlatformPlaybackConnectorHint | null {
  const prefix = extractTrackIdPrefix(trackId);
  if (!prefix) return null;

  return (
    hints.find((hint) => hint.tokens.includes(prefix)) ??
    null
  );
}

function findConnectorHintBySourceLocator(
  sourceLocator: string | null | undefined,
  hints: PlatformPlaybackConnectorHint[]
): PlatformPlaybackConnectorHint | null {
  const normalizedLocator = normalizeString(sourceLocator).toLowerCase();
  if (!normalizedLocator) return null;

  const scheme = extractCustomScheme(normalizedLocator);
  if (scheme) {
    return hints.find((hint) => hint.tokens.includes(scheme)) ?? null;
  }

  if (!isRemoteUrl(normalizedLocator)) {
    return null;
  }

  return (
    hints.find((hint) =>
      hint.tokens.some((token) => token.length > 0 && normalizedLocator.includes(token))
    ) ?? null
  );
}

function resolvePlatformSourceLocatorFromTrack(
  track: Track,
  hints: PlatformPlaybackConnectorHint[],
  hintedConnector: PlatformPlaybackConnectorHint | null
): string | null {
  const candidates = [track.originalPath, track.comment, track.path];

  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (!normalized) continue;

    const customScheme = extractCustomScheme(normalized);
    if (customScheme) {
      if (hintedConnector) {
        return normalized;
      }

      const matchedHint = findConnectorHintBySourceLocator(normalized, hints);
      if (matchedHint) {
        return normalized;
      }
      continue;
    }

    if (!isRemoteUrl(normalized)) {
      continue;
    }

    if (hintedConnector) {
      return normalized;
    }

    const matchedHint = findConnectorHintBySourceLocator(normalized, hints);
    if (matchedHint) {
      return normalized;
    }
  }

  return null;
}

export function isBilibiliSourceLocator(value: string | null | undefined): boolean {
  const hint = findConnectorHintBySourceLocator(value, listPlatformPlaybackConnectorHints());
  return hint?.connectorId === BILIBILI_PLATFORM_CONNECTOR_ID;
}

export function resolveBilibiliSourceLocatorFromTrack(track: Track): string | null {
  const hints = listPlatformPlaybackConnectorHints();
  const hintedConnector = findConnectorHintByTrackId(track.id, hints);
  const sourceLocator = resolvePlatformSourceLocatorFromTrack(track, hints, hintedConnector);
  return isBilibiliSourceLocator(sourceLocator) ? sourceLocator : null;
}

export function inferPlatformConnectorIdFromTrack(
  track: Track,
  sourceLocator: string | null
): string | null {
  const hints = listPlatformPlaybackConnectorHints();
  const trackIdHint = findConnectorHintByTrackId(track.id, hints);
  if (trackIdHint) {
    return trackIdHint.connectorId;
  }

  return findConnectorHintBySourceLocator(sourceLocator, hints)?.connectorId ?? null;
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
  const hints = listPlatformPlaybackConnectorHints();
  const hintedConnector = findConnectorHintByTrackId(track.id, hints);
  const sourceLocator = resolvePlatformSourceLocatorFromTrack(track, hints, hintedConnector);
  const connectorId =
    hintedConnector?.connectorId ??
    findConnectorHintBySourceLocator(sourceLocator, hints)?.connectorId ??
    null;
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
