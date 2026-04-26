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

function buildCacheFileTrack(
  track: Track,
  options: {
    cachePath: string;
    sourceLocator: string;
    durationSeconds?: number;
  }
): Track {
  return {
    ...track,
    filePath: options.cachePath,
    path: options.cachePath,
    originalPath: options.sourceLocator,
    duration:
      typeof track.duration === 'number' && Number.isFinite(track.duration)
        ? track.duration
        : options.durationSeconds,
    comment:
      typeof track.comment === 'string' && track.comment.trim().length > 0
        ? track.comment
        : options.sourceLocator,
  };
}

export type AudioPlaybackPreparationHint = 'platform-cache-materializing';

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

export class PlatformPlaybackFacadeProvider implements PlatformPlaybackProvider {
  async prepare(
    track: Track,
    identity: PlatformPlaybackIdentity,
    context: AudioPlaybackSourceResolverContext = {}
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

    context.recordStabilityHint?.('platform-cache-materializing', {
      event: 'audio.stability.hint.platform-cache-materializing',
    });

    try {
      const { preparePlatformPlayback } = await import('../../modules/music-platform/platformFacade');
      const preparedResult = await preparePlatformPlayback({
        connectorId: identity.connectorId,
        sourceLocator,
      });
      const prepared = preparedResult?.prepared;
      const cachePath = normalizeString(prepared?.cachePath);
      const streamUrl = normalizeString(prepared?.streamUrl);

      if (cachePath && isProbablyAbsolutePath(cachePath)) {
        return {
          kind: 'cache-file',
          track: buildCacheFileTrack(track, {
            cachePath,
            sourceLocator,
            durationSeconds: prepared?.durationSeconds,
          }),
          path: cachePath,
          connectorId: identity.connectorId,
          sourceLocator,
        };
      }

      if (streamUrl) {
        return {
          kind: 'remote-stream',
          track: {
            ...track,
            path:
              typeof track.path === 'string' && track.path.trim().length > 0
                ? track.path
                : sourceLocator,
            originalPath: sourceLocator,
            duration:
              typeof track.duration === 'number' && Number.isFinite(track.duration)
                ? track.duration
                : prepared?.durationSeconds,
            comment:
              typeof track.comment === 'string' && track.comment.trim().length > 0
                ? track.comment
                : sourceLocator,
          },
          streamUrl,
          connectorId: identity.connectorId,
          sourceLocator,
          mimeType: normalizeString(prepared?.mimeType) || undefined,
          headers: prepared?.headers,
          expiresAtMs: prepared?.expiresAtMs,
          seekable: prepared?.seekable,
          rangeRequests: prepared?.rangeRequests,
          durationSeconds: prepared?.durationSeconds,
        };
      }

      return {
        kind: 'deferred',
        track,
        reason: !cachePath ? 'missing-cache-path' : 'cache-path-not-absolute',
        connectorId: identity.connectorId,
        sourceLocator,
      };
    } catch {
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
