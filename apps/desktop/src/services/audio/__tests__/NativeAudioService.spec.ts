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
  localStorage.clear();
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

  it('restores output backend and audio input from storage', async () => {
    localStorage.setItem(STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_BACKEND, JSON.stringify('rodio-cpal'));
    localStorage.setItem(STORAGE_KEYS.NATIVE_AUDIO_INPUT_ID, JSON.stringify('symphonia'));

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invoke).toHaveBeenCalledWith('native_audio_select_output_backend', {
      backendId: 'rodio-cpal',
    });
    expect(invoke).toHaveBeenCalledWith('native_audio_select_audio_input', {
      inputId: 'symphonia',
    });

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

  it('wraps to last track on playPrevious in loop mode', async () => {
    const service = new NativeAudioService();
    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
      { id: 't2', title: 'B', filePath: 'C:\\\\Music\\\\b.mp3' },
    ]);

    service.setPlayMode('loop');
    await service.playTrackAtIndex(0);
    await service.playPrevious();

    expect(service.getState().currentIndex).toBe(1);
    service.destroy();
  });

  it('moves to next track on playNext in single-loop mode', async () => {
    const service = new NativeAudioService();
    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
      { id: 't2', title: 'B', filePath: 'C:\\\\Music\\\\b.mp3' },
    ]);

    service.setPlayMode('single-loop');
    await service.playTrackAtIndex(0);
    await service.playNext();

    expect(service.getState().currentIndex).toBe(1);
    service.destroy();
  });

  it('replays first track on playPrevious in sequence mode', async () => {
    const service = new NativeAudioService();
    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
      { id: 't2', title: 'B', filePath: 'C:\\\\Music\\\\b.mp3' },
    ]);

    await service.playTrackAtIndex(0);
    vi.clearAllMocks();

    await service.playPrevious();

    expect(invoke).toHaveBeenCalledWith('native_audio_load', { path: 'C:\\\\Music\\\\a.mp3' });
    service.destroy();
  });

  it('picks a random track on playPrevious in shuffle mode', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const service = new NativeAudioService();
    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
      { id: 't2', title: 'B', filePath: 'C:\\\\Music\\\\b.mp3' },
    ]);

    service.setPlayMode('shuffle');
    await service.playTrackAtIndex(0);
    await service.playPrevious();

    expect(service.getState().currentIndex).toBe(1);
    random.mockRestore();
    service.destroy();
  });

  it('replays the same track when ended in single-loop mode', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
      { id: 't2', title: 'B', filePath: 'C:\\\\Music\\\\b.mp3' },
    ]);
    service.setPlayMode('single-loop');

    await service.playTrackAtIndex(0);

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    handlers.native_audio_state?.({ payload: { playbackState: 'stopped', ended: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invoke).toHaveBeenCalledWith('native_audio_load', { path: 'C:\\\\Music\\\\a.mp3' });
    expect(invoke).toHaveBeenCalledWith('native_audio_play', undefined);
    service.destroy();
  });

  it('coalesces rapid seek calls before invoking backend', async () => {
    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    (service as unknown as { state: { duration: number } }).state.duration = 100;

    vi.useFakeTimers();
    service.seek(10);
    service.seek(20);
    service.seek(30);

    expect(invoke).not.toHaveBeenCalledWith('native_audio_seek', expect.anything());

    await vi.advanceTimersByTimeAsync(200);

    expect(invoke).toHaveBeenCalledWith('native_audio_seek', { time: 30 });

    vi.useRealTimers();
    service.destroy();
  });
});
