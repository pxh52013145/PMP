import { describe, expect, it, vi } from 'vitest';
import type { PreparedAudioSource } from './audioPlaybackSourceResolver';
import { NativeAudioSourcePreparation } from './nativeAudioSourcePreparation';
import type { Track } from './types';

const TRACK: Track = {
  id: 'track-a',
  title: 'Track A',
  path: 'C:\\music\\a.flac',
  duration: 10,
};

function createPreparation(options?: { runtime?: boolean; invokeError?: unknown }) {
  const invokeCommand = vi.fn();
  const invokeCommandImpl = async <T = void>(
    cmd: string,
    payload?: Record<string, unknown>
  ): Promise<T> => {
    invokeCommand(cmd, payload);
    if (options?.invokeError) {
      throw options.invokeError;
    }
    return 'C:\\music\\materialized.flac' as T;
  };
  const emitError = vi.fn();
  const recordStabilityHint = vi.fn();
  const onUnsupportedSource = vi.fn();

  const preparation = new NativeAudioSourcePreparation({
    isRuntime: () => options?.runtime ?? true,
    invokeCommand: invokeCommandImpl,
    emitError,
    recordStabilityHint,
    onUnsupportedSource,
  });

  return {
    preparation,
    invokeCommand,
    emitError,
    recordStabilityHint,
    onUnsupportedSource,
  };
}

describe('NativeAudioSourcePreparation', () => {
  it('prepares a local file source outside the Tauri runtime', async () => {
    const { preparation, recordStabilityHint } = createPreparation({ runtime: false });

    await expect(preparation.prepare(TRACK)).resolves.toEqual({
      kind: 'local-file',
      track: TRACK,
      path: 'C:\\music\\a.flac',
    });
    expect(recordStabilityHint).not.toHaveBeenCalled();
  });

  it('resolves deferred source metadata from the source locator', () => {
    const { preparation } = createPreparation();
    const source: PreparedAudioSource = {
      kind: 'deferred',
      track: {
        id: 'track-b',
        title: 'Track B',
      },
      reason: 'missing-cache-path',
      connectorId: 'cloud',
      sourceLocator: 'cloud://track-b',
    };

    expect(preparation.resolveTrack(source)).toMatchObject({
      id: 'track-b',
      originalPath: 'cloud://track-b',
      comment: 'cloud://track-b',
    });
    expect(preparation.resolveIdentityPath(source, source.track)).toBe('cloud://track-b');
  });

  it('emits a coded error for relative local paths before invoking native load', async () => {
    const { preparation, invokeCommand, emitError } = createPreparation();
    const source: PreparedAudioSource = {
      kind: 'local-file',
      track: TRACK,
      path: 'relative\\a.flac',
    };

    await expect(preparation.loadSource(source)).resolves.toBeNull();

    expect(invokeCommand).not.toHaveBeenCalled();
    expect(emitError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'NATIVE_TRACK_PATH_NOT_ABSOLUTE',
      })
    );
  });

  it('loads and plays remote stream payloads through the source command', async () => {
    const { preparation, invokeCommand } = createPreparation();
    const source: PreparedAudioSource = {
      kind: 'remote-stream',
      track: TRACK,
      streamUrl: 'https://example.test/audio.flac',
      connectorId: 'cloud',
      sourceLocator: 'cloud://track-a',
      mimeType: 'audio/flac',
      seekable: true,
    };

    await expect(preparation.loadSource(source, { play: true, replayGainDb: -2 })).resolves.toBe(
      'C:\\music\\materialized.flac'
    );

    expect(invokeCommand).toHaveBeenCalledWith('native_audio_load_and_play_source', {
      source: expect.objectContaining({
        kind: 'remote-stream',
        streamUrl: 'https://example.test/audio.flac',
        sourceLocator: 'cloud://track-a',
        connectorId: 'cloud',
        mimeType: 'audio/flac',
        seekable: true,
      }),
      replayGainDb: -2,
    });
  });

  it('emits native load failures without throwing', async () => {
    const { preparation, emitError } = createPreparation({
      invokeError: new Error('[AUDIO_INPUT_OPEN_FAILED] all inputs failed'),
    });
    const source: PreparedAudioSource = {
      kind: 'local-file',
      track: TRACK,
      path: 'C:\\music\\broken.m4a',
    };

    await expect(preparation.loadSource(source, { play: true })).resolves.toBeNull();

    expect(emitError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'NATIVE_AUDIO_LOAD_SOURCE_FAILED',
        message: '[AUDIO_INPUT_OPEN_FAILED] all inputs failed',
      })
    );
  });

  it('reports unsupported deferred sources without throwing', async () => {
    const { preparation, emitError, onUnsupportedSource } = createPreparation();
    const source: PreparedAudioSource = {
      kind: 'deferred',
      track: TRACK,
      reason: 'missing-source-locator',
    };

    await expect(preparation.loadSource(source)).resolves.toBeNull();

    expect(emitError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'NATIVE_TRACK_SOURCE_DEFERRED',
      })
    );
    expect(onUnsupportedSource).toHaveBeenCalledWith(source, TRACK);
  });

  it('applies materialized paths back to remote stream tracks', () => {
    const { preparation } = createPreparation();
    const source: PreparedAudioSource = {
      kind: 'remote-stream',
      track: TRACK,
      streamUrl: 'https://example.test/audio.flac',
      connectorId: 'cloud',
      sourceLocator: 'cloud://track-a',
    };

    expect(
      preparation.applyMaterializedPath(source, TRACK, 'C:\\cache\\track-a.flac')
    ).toMatchObject({
      filePath: 'C:\\cache\\track-a.flac',
      path: 'C:\\cache\\track-a.flac',
      originalPath: 'cloud://track-a',
      comment: 'cloud://track-a',
    });
  });
});
