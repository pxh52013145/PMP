import { resolvePlatformPlaybackIdentity, type PlatformPlaybackIdentity } from './platformPlaybackResolver';
import { getTrackPathForIdentity } from './trackIdentity';
import type { Track } from './types';

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRemoteHttpUrl(value: string): boolean {
  const normalized = normalizeString(value).toLowerCase();
  return normalized.startsWith('http://') || normalized.startsWith('https://');
}

function isProbablyAbsolutePath(value: string): boolean {
  if (!value) return false;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (value.startsWith('\\\\')) return true;
  if (value.startsWith('/')) return true;
  return false;
}

export type AudioPlaybackPreparationHint = 'platform-cache-materializing';

interface PlatformPreparedPlaybackLike {
  sourceLocator?: unknown;
  cachePath?: unknown;
  streamUrl?: unknown;
  durationSeconds?: number;
  mimeType?: unknown;
  headers?: Record<string, string>;
  expiresAtMs?: number;
  seekable?: boolean;
  rangeRequests?: boolean;
}

export type NativeAudioSourcePayload =
  | {
      kind: 'local-file';
      path: string;
      sourceLocator?: string;
      connectorId?: string;
    }
  | {
      kind: 'cache-file';
      path: string;
      sourceLocator?: string;
      connectorId?: string;
    }
  | {
      kind: 'remote-stream';
      streamUrl: string;
      sourceLocator?: string;
      connectorId?: string;
      mimeType?: string;
      headers?: Record<string, string>;
      expiresAtMs?: number;
      seekable?: boolean;
      rangeRequests?: boolean;
    };

export type PreparedAudioSource =
  | {
      kind: 'local-file';
      track: Track;
      path: string | null;
    }
  | {
      kind: 'cache-file';
      track: Track;
      path: string;
      connectorId: string;
      sourceLocator: string;
    }
  | {
      kind: 'remote-stream';
      track: Track;
      streamUrl: string;
      connectorId: string;
      sourceLocator: string;
      mimeType?: string;
      headers?: Record<string, string>;
      expiresAtMs?: number;
      seekable?: boolean;
      rangeRequests?: boolean;
      durationSeconds?: number;
    }
  | {
      kind: 'deferred';
      track: Track;
      reason:
        | 'missing-source-locator'
        | 'missing-cache-path'
        | 'cache-path-not-absolute'
        | 'missing-stream-url'
        | 'cache-only-playback-disabled'
        | 'platform-prepare-failed';
      connectorId?: string;
      sourceLocator?: string;
    };

export function toNativeAudioSourcePayload(
  source: PreparedAudioSource
): NativeAudioSourcePayload | null {
  switch (source.kind) {
    case 'local-file':
      return source.path
        ? {
            kind: 'local-file',
            path: source.path,
          }
        : null;
    case 'cache-file':
      return {
        kind: 'cache-file',
        path: source.path,
        sourceLocator: source.sourceLocator,
        connectorId: source.connectorId,
      };
    case 'remote-stream':
      return {
        kind: 'remote-stream',
        streamUrl: source.streamUrl,
        sourceLocator: source.sourceLocator,
        connectorId: source.connectorId,
        mimeType: source.mimeType,
        headers: source.headers,
        expiresAtMs: source.expiresAtMs,
        seekable: source.seekable,
        rangeRequests: source.rangeRequests,
      };
    case 'deferred':
      if (source.sourceLocator && isRemoteHttpUrl(source.sourceLocator)) {
        return {
          kind: 'remote-stream',
          streamUrl: source.sourceLocator,
          sourceLocator: source.sourceLocator,
          connectorId: source.connectorId,
        };
      }
      return null;
    default:
      return null;
  }
}

export interface AudioPlaybackSourceResolverContext {
  recordStabilityHint?: (
    reason: AudioPlaybackPreparationHint,
    options?: {
      holdMs?: number;
      minimumProfile?: 'normal' | 'guarded' | 'critical';
      event?: string;
    }
  ) => void;
}

export interface PlatformPlaybackProvider {
  prepare(
    track: Track,
    identity: PlatformPlaybackIdentity,
    context?: AudioPlaybackSourceResolverContext
  ): Promise<PreparedAudioSource>;
}

function buildRemoteStreamSource(
  track: Track,
  identity: PlatformPlaybackIdentity,
  prepared: PlatformPreparedPlaybackLike,
  streamUrl: string
): PreparedAudioSource {
  const sourceLocator = normalizeString(identity.sourceLocator);
  const remoteTrack = {
    ...track,
    filePath: undefined,
    path: sourceLocator || normalizeString(track.path),
    originalPath: sourceLocator,
    duration:
      typeof track.duration === 'number' && Number.isFinite(track.duration)
        ? track.duration
        : prepared.durationSeconds,
    comment:
      typeof track.comment === 'string' && track.comment.trim().length > 0
        ? track.comment
        : sourceLocator,
    sourceLocator,
    streamUrl,
    connectorId: identity.connectorId,
    cachePath: undefined,
    cache_path: undefined,
  } as Track;

  return {
    kind: 'remote-stream',
    track: remoteTrack,
    streamUrl,
    connectorId: identity.connectorId,
    sourceLocator,
    mimeType: normalizeString(prepared.mimeType) || undefined,
    headers: prepared.headers,
    expiresAtMs: prepared.expiresAtMs,
    seekable: prepared.seekable,
    rangeRequests: prepared.rangeRequests,
    durationSeconds: prepared.durationSeconds,
  };
}

function readInlinePlatformPreparedPlayback(
  track: Track,
  identity: PlatformPlaybackIdentity
): PlatformPreparedPlaybackLike | null {
  const record = track as unknown as Record<string, unknown>;
  const cachePath = normalizeString(record.cachePath ?? record.cache_path);
  const streamUrl = normalizeString(record.streamUrl ?? record.stream_url);
  if (!cachePath && !streamUrl) return null;

  const durationSeconds =
    typeof record.durationSeconds === 'number' && Number.isFinite(record.durationSeconds)
      ? record.durationSeconds
      : track.duration;

  return {
    sourceLocator: identity.sourceLocator,
    cachePath,
    streamUrl,
    durationSeconds,
    mimeType: record.mimeType ?? record.mime_type ?? track.mimeType,
    headers:
      record.headers && typeof record.headers === 'object' && !Array.isArray(record.headers)
        ? record.headers as Record<string, string>
        : undefined,
    expiresAtMs:
      typeof record.expiresAtMs === 'number' && Number.isFinite(record.expiresAtMs)
        ? record.expiresAtMs
        : undefined,
    seekable: typeof record.seekable === 'boolean' ? record.seekable : undefined,
    rangeRequests:
      typeof record.rangeRequests === 'boolean'
        ? record.rangeRequests
        : typeof record.range_requests === 'boolean'
          ? record.range_requests
          : undefined,
  };
}

export async function resolvePreparedPlatformPlaybackSource(
  track: Track,
  identity: PlatformPlaybackIdentity,
  prepared: PlatformPreparedPlaybackLike | null | undefined
): Promise<PreparedAudioSource> {
  const sourceLocator = normalizeString(identity.sourceLocator);
  const cachePath = normalizeString(prepared?.cachePath);
  const streamUrl = normalizeString(prepared?.streamUrl);

  if (streamUrl) {
    return buildRemoteStreamSource(track, identity, prepared ?? {}, streamUrl);
  }

  if (cachePath && isProbablyAbsolutePath(cachePath)) {
    return {
      kind: 'deferred',
      track,
      reason: 'cache-only-playback-disabled',
      connectorId: identity.connectorId,
      sourceLocator,
    };
  }

  return {
    kind: 'deferred',
    track,
    reason: !cachePath ? 'missing-stream-url' : 'cache-path-not-absolute',
    connectorId: identity.connectorId,
    sourceLocator,
  };
}

export class PlatformPlaybackFacadeProvider implements PlatformPlaybackProvider {
  async prepare(
    track: Track,
    identity: PlatformPlaybackIdentity,
    _context: AudioPlaybackSourceResolverContext = {}
  ): Promise<PreparedAudioSource> {
    const sourceLocator = normalizeString(identity.sourceLocator);
    if (!sourceLocator) {
      return {
        kind: 'deferred',
        track,
        reason: 'missing-source-locator',
        connectorId: identity.connectorId,
      };
    }

    try {
      const { preparePlatformPlayback } = await import('../../modules/music-platform/platformFacade');
      const inlinePrepared = readInlinePlatformPreparedPlayback(track, identity);
      const preparedResult = await preparePlatformPlayback({
        connectorId: identity.connectorId,
        sourceLocator,
      });
      return resolvePreparedPlatformPlaybackSource(
        track,
        identity,
        preparedResult?.prepared ?? inlinePrepared
      );
    } catch {
      const inlinePrepared = readInlinePlatformPreparedPlayback(track, identity);
      if (inlinePrepared) {
        return resolvePreparedPlatformPlaybackSource(
          track,
          identity,
          inlinePrepared
        );
      }
      return {
        kind: 'deferred',
        track,
        reason: 'platform-prepare-failed',
        connectorId: identity.connectorId,
        sourceLocator,
      };
    }
  }
}

export class AudioPlaybackSourceResolver {
  constructor(private readonly platformPlaybackProvider: PlatformPlaybackProvider = new PlatformPlaybackFacadeProvider()) {}

  async prepare(
    track: Track,
    context: AudioPlaybackSourceResolverContext = {}
  ): Promise<PreparedAudioSource> {
    const identity = resolvePlatformPlaybackIdentity(track);
    if (!identity?.sourceLocator) {
      return {
        kind: 'local-file',
        track,
        path: getTrackPathForIdentity(track),
      };
    }

    return this.platformPlaybackProvider.prepare(track, identity, context);
  }
}
