import {
  AudioPlaybackSourceResolver,
  toNativeAudioSourcePayload,
  type AudioPlaybackPreparationHint,
  type PreparedAudioSource,
} from './audioPlaybackSourceResolver';
import { getTrackPathForIdentity } from './trackIdentity';
import type { Track } from './types';

export interface NativeAudioSourcePreparationOptions {
  isRuntime: () => boolean;
  invokeCommand: <T = void>(cmd: string, payload?: Record<string, unknown>) => Promise<T>;
  emitError: (error: Error) => void;
  recordStabilityHint: (
    reason: AudioPlaybackPreparationHint,
    options?: {
      holdMs?: number;
      minimumProfile?: 'normal' | 'guarded' | 'critical';
      event?: string;
    }
  ) => void;
  onUnsupportedSource?: (source: PreparedAudioSource, track: Track) => void;
  resolver?: AudioPlaybackSourceResolver;
}

export class NativeAudioSourcePreparation {
  private readonly resolver: AudioPlaybackSourceResolver;

  constructor(private readonly options: NativeAudioSourcePreparationOptions) {
    this.resolver = options.resolver ?? new AudioPlaybackSourceResolver();
  }

  async prepare(track: Track): Promise<PreparedAudioSource> {
    if (!this.options.isRuntime()) {
      return {
        kind: 'local-file',
        track,
        path: getTrackPathForIdentity(track),
      };
    }

    return this.resolver.prepare(track, {
      recordStabilityHint: (reason, options) => {
        this.options.recordStabilityHint(reason, options);
      },
    });
  }

  resolveTrack(source: PreparedAudioSource): Track {
    switch (source.kind) {
      case 'cache-file':
      case 'local-file':
      case 'remote-stream':
        return source.track;
      case 'deferred':
        if (!source.sourceLocator) {
          return source.track;
        }
        return {
          ...source.track,
          originalPath:
            typeof source.track.originalPath === 'string' &&
            source.track.originalPath.trim().length > 0
              ? source.track.originalPath
              : source.sourceLocator,
          comment:
            typeof source.track.comment === 'string' && source.track.comment.trim().length > 0
              ? source.track.comment
              : source.sourceLocator,
        };
    }
  }

  resolveIdentityPath(source: PreparedAudioSource, track: Track): string | null {
    switch (source.kind) {
      case 'local-file':
      case 'cache-file':
        return source.path;
      case 'remote-stream':
        return source.sourceLocator || source.streamUrl;
      case 'deferred':
        return source.sourceLocator ?? getTrackPathForIdentity(track);
      default:
        return getTrackPathForIdentity(track);
    }
  }

  resolveNativeTransportPath(source: PreparedAudioSource): string | null {
    switch (source.kind) {
      case 'local-file':
      case 'cache-file':
        return source.path;
      default:
        return null;
    }
  }

  applyMaterializedPath(
    source: PreparedAudioSource,
    track: Track,
    materializedPath: string | null | undefined
  ): Track {
    void source;
    void materializedPath;
    return track;
  }

  async loadSource(
    source: PreparedAudioSource,
    options?: {
      play?: boolean;
      replayGainDb?: number;
    }
  ): Promise<string | null> {
    const transportPath = this.resolveNativeTransportPath(source);
    if (transportPath && !isProbablyAbsolutePath(transportPath)) {
      const error = new Error(
        'Native audio requires an absolute file path. This track has no filePath (likely added via File System Access API).'
      ) as Error & { code?: string };
      error.code = 'NATIVE_TRACK_PATH_NOT_ABSOLUTE';
      this.options.emitError(error);
      return null;
    }

    const payload = toNativeAudioSourcePayload(source);
    if (!payload) {
      this.emitUnsupportedSource(source, this.resolveTrack(source));
      return null;
    }

    const command = options?.play ? 'native_audio_load_and_play_source' : 'native_audio_load_source';

    try {
      if (options?.play) {
        return await this.options.invokeCommand<string>(command, {
          source: payload,
          replayGainDb: options.replayGainDb,
        });
      }

      return await this.options.invokeCommand<string>(command, {
        source: payload,
      });
    } catch (error) {
      const loadError = new Error(readErrorMessage(error)) as Error & { code?: string };
      loadError.code = 'NATIVE_AUDIO_LOAD_SOURCE_FAILED';
      this.options.emitError(loadError);
      return null;
    }
  }

  private emitUnsupportedSource(source: PreparedAudioSource, track: Track): void {
    const error = new Error(
      'Native audio could not resolve a playable source for this track.'
    ) as Error & { code?: string };
    error.code =
      source.kind === 'deferred' ? 'NATIVE_TRACK_SOURCE_DEFERRED' : 'NATIVE_TRACK_SOURCE_UNSUPPORTED';
    this.options.emitError(error);
    this.options.onUnsupportedSource?.(source, track);
  }
}

function isProbablyAbsolutePath(value: string): boolean {
  if (!value) return false;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (value.startsWith('\\\\')) return true;
  if (value.startsWith('/')) return true;
  return false;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { isProbablyAbsolutePath as isProbablyNativeAudioPath };
