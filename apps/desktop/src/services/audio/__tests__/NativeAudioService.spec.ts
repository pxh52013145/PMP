import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { NativeAudioService } from '../NativeAudioService';
import { invoke } from '@tauri-apps/api/tauri';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import { listen } from '@tauri-apps/api/event';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NativeAudioService', () => {
  it('initializes with idle playback state', () => {
    const service = new NativeAudioService();
    expect(service.getState().playbackState).toBe('idle');
    service.destroy();
  });

  it('emits a coded error when track has no absolute file path', async () => {
    const service = new NativeAudioService();
    const onError = vi.fn();
    service.onError(onError);

    await service.loadTrack({ id: 't1', title: 'No Path', path: 'folder/song.mp3' });

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0]?.[0] as { code?: unknown; message?: unknown } | undefined;
    expect(error?.code).toBe('NATIVE_TRACK_PATH_NOT_ABSOLUTE');
    expect(invoke).not.toHaveBeenCalledWith('native_audio_load', expect.anything());
    service.destroy();
  });

  it('emits error when receiving native_audio_error event', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    listenMock.mockImplementation(
      async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      if (eventName === 'native_audio_error') {
        handler({ payload: { seq: 1, code: 'NATIVE_AUDIO_STREAM_ERROR', message: 'decoder failed' } });
      }
      return () => {};
    }
    );

    const service = new NativeAudioService();
    const onError = vi.fn();
    service.onError(onError);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0]?.[0] as { code?: unknown; message?: unknown } | undefined;
    expect(error?.code).toBe('NATIVE_AUDIO_STREAM_ERROR');
    expect(String(error?.message)).toContain('decoder failed');
    service.destroy();
  });

  it('applies replaygain (track gain + preamp) before loading a track', async () => {
    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS,
      JSON.stringify({ enabled: true, mode: 'track', preampDb: 2 })
    );

    const service = new NativeAudioService();
    await service.loadTrack({
      id: 't2',
      title: 'RG Track',
      filePath: 'C:\\\\Music\\\\rg.mp3',
      replayGainTrackGainDb: -6,
    });

    expect(invoke).toHaveBeenCalledWith('native_audio_set_replay_gain', { db: -4 });
    expect(invoke).toHaveBeenCalledWith('native_audio_load', { path: 'C:\\\\Music\\\\rg.mp3' });
    service.destroy();
  });

  it('crossfades to the next track when enabled and switching while playing', async () => {
    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS,
      JSON.stringify({ enabled: true, durationMs: 1000 })
    );

    const service = new NativeAudioService();
    await service.loadTrack({
      id: 't1',
      title: 'A',
      filePath: 'C:\\\\Music\\\\a.mp3',
    });
    await service.play();
    service.addToQueue({
      id: 't2',
      title: 'B',
      filePath: 'C:\\\\Music\\\\b.mp3',
    });

    await service.playTrackAtIndex(1);

    expect(invoke).toHaveBeenCalledWith('native_audio_crossfade_to', {
      path: 'C:\\\\Music\\\\b.mp3',
      durationMs: 1000,
    });
    expect(invoke).not.toHaveBeenCalledWith('native_audio_load', { path: 'C:\\\\Music\\\\b.mp3' });
    service.destroy();
  });
});
