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

  const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
  invokeMock.mockResolvedValue(undefined);

  const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
  listenMock.mockResolvedValue(() => {});
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

  it('loads the current queue track when play() is called without a loaded track', async () => {
    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
      { id: 't2', title: 'B', filePath: 'C:\\\\Music\\\\b.mp3' },
    ]);

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    await service.play();

    expect(invoke).toHaveBeenCalledWith('native_audio_load', { path: 'C:\\\\Music\\\\a.mp3' });
    expect(invoke).toHaveBeenCalledWith('native_audio_play', undefined);
    service.destroy();
  });

  it('avoids calling play() when the backend fails to load the selected track', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_load') {
        return Promise.reject(new Error('load failed'));
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    service.addMultipleToQueue([{ id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' }]);
    invokeMock.mockClear();

    await service.playTrackAtIndex(0);

    expect(invoke).toHaveBeenCalledWith('native_audio_load', { path: 'C:\\\\Music\\\\a.mp3' });
    expect(invoke).not.toHaveBeenCalledWith('native_audio_play', undefined);
    service.destroy();
  });

  it('crossfades to the next track when enabled and switching while playing', async () => {
    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS,
      JSON.stringify({ enabled: true, durationMs: 1000 })
    );

    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await service.loadTrack({
      id: 't1',
      title: 'A',
      filePath: 'C:\\\\Music\\\\a.mp3',
    });
    await service.play();

    handlers['native_audio_state']?.({ payload: { playbackState: 'playing', currentTime: 0, duration: 0 } });
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

  it('clears currentTrack when backend reports trackPath as null', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await service.loadTrack({ id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' });
    expect(service.getState().currentTrack).not.toBeNull();

    handlers.native_audio_state?.({ payload: { trackPath: null } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.getState().currentTrack).toBeNull();
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

  it('keeps only latest seek while backend seek is in-flight', async () => {
    vi.useFakeTimers();

    const firstSeekGate: { release: (() => void) | null } = { release: null };
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_seek') {
        return new Promise<void>((resolve) => {
          if (!firstSeekGate.release) {
            firstSeekGate.release = () => resolve();
          } else {
            resolve();
          }
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    (service as unknown as { state: { duration: number } }).state.duration = 200;

    service.seek(10);
    await vi.advanceTimersByTimeAsync(80);

    expect(invoke).toHaveBeenCalledWith('native_audio_seek', { time: 10 });

    service.seek(50);
    service.seek(80);
    await vi.advanceTimersByTimeAsync(80);

    const seekCallsBeforeResolve = invokeMock.mock.calls.filter((call) => call[0] === 'native_audio_seek');
    expect(seekCallsBeforeResolve).toHaveLength(1);

    if (firstSeekGate.release) {
      firstSeekGate.release();
    }
    await vi.advanceTimersByTimeAsync(0);

    const seekCallsAfterResolve = invokeMock.mock.calls.filter((call) => call[0] === 'native_audio_seek');
    expect(seekCallsAfterResolve).toHaveLength(2);
    expect(seekCallsAfterResolve[1]).toEqual(['native_audio_seek', { time: 80 }]);

    service.destroy();
    vi.useRealTimers();
  });

  it('does not rebuild queue/currentTrack when native state payload is unchanged', async () => {
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

    await service.playTrackAtIndex(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const before = service.getState();
    const beforeQueueRef = before.queue;
    const beforeTrackRef = before.currentTrack;

    handlers.native_audio_state?.({
      payload: {
        queue: ['C:\\\\Music\\\\a.mp3', 'C:\\\\Music\\\\b.mp3'],
        currentIndex: 0,
        trackPath: 'C:\\\\Music\\\\a.mp3',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const after = service.getState();
    expect(after.queue).toBe(beforeQueueRef);
    expect(after.currentTrack).toBe(beforeTrackRef);

    service.destroy();
  });

  it('applies temporary streaming recovery settings on underrun spikes', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        underrunEvents: 2,
        currentTime: 1,
        duration: 10,
      },
    });

    expect(invoke).toHaveBeenCalledWith('native_audio_set_streaming_buffer_settings', {
      startOrSeekSeconds: 3.2,
      crossfadeSeconds: 1.4,
    });

    service.destroy();
  });

  it('auto switches output backend after repeated underrun spikes', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['rodio-cpal', 'wasapi']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'rodio-cpal' });
      }
      if (cmd === 'native_audio_select_output_backend') {
        if (payload?.backendId === 'wasapi') {
          return Promise.resolve({ outputBackendId: 'wasapi' });
        }
        return Promise.resolve({ outputBackendId: 'rodio-cpal' });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    invokeMock.mockClear();

    handlers.native_audio_state?.({ payload: { playbackState: 'playing', underrunEvents: 1 } });
    handlers.native_audio_state?.({ payload: { playbackState: 'playing', underrunEvents: 2 } });
    handlers.native_audio_state?.({ payload: { playbackState: 'playing', underrunEvents: 3, underrunFrames: 2048 } });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invoke).toHaveBeenCalledWith('native_audio_select_output_backend', {
      backendId: 'wasapi',
    });

    service.destroy();
  });

  it('keeps protection window active and then releases after timeout', async () => {
    vi.useFakeTimers();

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['rodio-cpal']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'rodio-cpal' });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    invokeMock.mockClear();
    const release = service.enterProtectionWindow?.({ reason: 'scan', durationMs: 2_000 });
    const during = service.getRobustnessSnapshot?.();
    expect(during?.protectionWindowActive).toBe(true);
    expect(during?.protectionRefCount).toBe(1);
    expect(during?.protectionReason).toBe('scan');

    release?.();

    await vi.advanceTimersByTimeAsync(2_100);
    const after = service.getRobustnessSnapshot?.();
    expect(after?.protectionWindowActive).toBe(false);
    expect(after?.protectionRefCount).toBe(0);

    service.destroy();
    vi.useRealTimers();
  });

  it('hydrates engine policy into robustness snapshot', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['rodio-cpal']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'rodio-cpal' });
      }
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          transportMode: 'transport-exact',
          hqSrcEnabled: true,
          hqSrcPhaseMode: 'linear',
          hqSrcStopbandDb: 140,
          transportExactInt32Container: true,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.transportMode).toBe('transport-exact');
    expect(snapshot?.hqSrcPhaseMode).toBe('linear');
    expect(snapshot?.hqSrcStopbandDb).toBe(140);
    expect(snapshot?.transportExactInt32Container).toBe(true);

    service.destroy();
  });

  it('marks output callback metrics unavailable for non-exclusive backend', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi', 'rodio-cpal']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'wasapi' });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    handlers.native_audio_state?.({
      payload: {
        outputCallbackMetricsValid: false,
        outputCallbackP99Us: 321,
        outputWaitTimeoutCount: 7,
        outputRenderUnderrunEvents: 3,
        outputRenderUnderrunFrames: 128,
      },
    });

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.outputCallbackMetricsValid).toBe(false);
    expect(snapshot?.outputCallbackP99Us).toBe(0);
    expect(snapshot?.outputWaitTimeoutCount).toBe(0);
    expect(snapshot?.outputRenderUnderrunEvents).toBe(0);
    expect(snapshot?.outputRenderUnderrunFrames).toBe(0);

    service.destroy();
  });
});
