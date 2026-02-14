import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

afterEach(() => {
  vi.useRealTimers();
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

    expect(invoke).toHaveBeenCalledWith(
      'native_audio_seek',
      expect.objectContaining({ time: 30, seekSeq: expect.any(Number) })
    );

    vi.useRealTimers();
    service.destroy();
  });

  it('reports latest seek sequence immediately and ignores marker failure', async () => {
    vi.useFakeTimers();

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_mark_seek_seq') {
        return Promise.reject(new Error('marker failed'));
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    const onError = vi.fn();
    service.onError(onError);

    (service as unknown as { state: { duration: number } }).state.duration = 180;
    invokeMock.mockClear();

    service.seek(64);
    await vi.advanceTimersByTimeAsync(200);

    expect(invoke).toHaveBeenCalledWith(
      'native_audio_mark_seek_seq',
      expect.objectContaining({ seekSeq: expect.any(Number) })
    );
    expect(invoke).toHaveBeenCalledWith(
      'native_audio_seek',
      expect.objectContaining({ time: 64, seekSeq: expect.any(Number) })
    );
    expect(onError).not.toHaveBeenCalled();

    service.destroy();
    vi.useRealTimers();
  });

  it('keeps latest seek sequence marker updated while seek invokes are saturated', async () => {
    vi.useFakeTimers();

    const pendingSeekResolvers: Array<() => void> = [];
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_seek') {
        return new Promise<void>((resolve) => {
          pendingSeekResolvers.push(resolve);
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    (service as unknown as { state: { duration: number } }).state.duration = 300;
    invokeMock.mockClear();

    for (let i = 0; i < 12; i += 1) {
      service.seek(i * 5);
      await vi.advanceTimersByTimeAsync(25);
    }

    await vi.advanceTimersByTimeAsync(300);

    const seekCalls = invokeMock.mock.calls.filter((call) => call[0] === 'native_audio_seek');
    expect(seekCalls).toHaveLength(3);

    const markerCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'native_audio_mark_seek_seq'
    );
    expect(markerCalls).toHaveLength(12);

    const lastSeekSeq = Number(
      (seekCalls[seekCalls.length - 1]?.[1] as { seekSeq?: number } | undefined)?.seekSeq
    );
    const lastMarkerSeq = Number(
      (markerCalls[markerCalls.length - 1]?.[1] as { seekSeq?: number } | undefined)?.seekSeq
    );
    expect(lastMarkerSeq).toBeGreaterThan(lastSeekSeq);

    pendingSeekResolvers.forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(0);

    service.destroy();
    vi.useRealTimers();
  });

  it('keeps latest seek target while an earlier seek promise is unresolved', async () => {
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

    expect(invoke).toHaveBeenCalledWith(
      'native_audio_seek',
      expect.objectContaining({ time: 10, seekSeq: expect.any(Number) })
    );

    service.seek(50);
    service.seek(80);
    await vi.advanceTimersByTimeAsync(80);

    const seekCallsBeforeResolve = invokeMock.mock.calls.filter((call) => call[0] === 'native_audio_seek');
    expect(seekCallsBeforeResolve).toHaveLength(2);
    expect(seekCallsBeforeResolve[1]?.[1]).toEqual(
      expect.objectContaining({ time: 80, seekSeq: expect.any(Number) })
    );

    if (firstSeekGate.release) {
      firstSeekGate.release();
    }
    await vi.advanceTimersByTimeAsync(0);

    const seekCallsAfterResolve = invokeMock.mock.calls.filter((call) => call[0] === 'native_audio_seek');
    expect(seekCallsAfterResolve).toHaveLength(2);

    service.destroy();
    vi.useRealTimers();
  });

  it('throttles rapid seek bursts and keeps latest target without event pile-up', async () => {
    vi.useFakeTimers();

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue(undefined);

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    (service as unknown as { state: { duration: number } }).state.duration = 500;
    invokeMock.mockClear();

    for (let i = 0; i < 80; i += 1) {
      service.seek(i * 2);
      await vi.advanceTimersByTimeAsync(5);
    }

    await vi.advanceTimersByTimeAsync(2_000);

    const seekCalls = invokeMock.mock.calls.filter((call) => call[0] === 'native_audio_seek');
    expect(seekCalls.length).toBeLessThanOrEqual(25);

    const lastPayload = seekCalls[seekCalls.length - 1]?.[1] as
      | { time?: number; seekSeq?: number }
      | undefined;
    expect(lastPayload?.time).toBe(158);

    const seqs = seekCalls
      .map((call) => (call[1] as { seekSeq?: number } | undefined)?.seekSeq)
      .filter((value): value is number => typeof value === 'number');
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }

    service.destroy();
    vi.useRealTimers();
  });

  it.each(['sequence', 'loop', 'single-loop', 'shuffle'] as const)(
    'keeps latest seek target stable under rapid bursts in %s mode',
    async (mode) => {
      vi.useFakeTimers();

      const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
      invokeMock.mockResolvedValue(undefined);

      const service = new NativeAudioService();
      await vi.advanceTimersByTimeAsync(0);

      service.setPlayMode(mode);
      (service as unknown as { state: { duration: number } }).state.duration = 220;
      invokeMock.mockClear();

      for (let i = 0; i < 24; i += 1) {
        service.seek(i * 3);
        await vi.advanceTimersByTimeAsync(4);
      }

      await vi.advanceTimersByTimeAsync(1_000);

      const seekCalls = invokeMock.mock.calls.filter((call) => call[0] === 'native_audio_seek');
      expect(seekCalls.length).toBeLessThanOrEqual(24);

      const lastPayload = seekCalls[seekCalls.length - 1]?.[1] as
        | { time?: number; seekSeq?: number }
        | undefined;
      expect(lastPayload?.time).toBe(69);
      expect(typeof lastPayload?.seekSeq).toBe('number');

      service.destroy();
      vi.useRealTimers();
    }
  );

  it('ignores stale native currentTime right after seek until seek settles', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    vi.useFakeTimers();

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    const observed: number[] = [];
    const unsub = service.onTimeUpdate((time) => {
      observed.push(time);
    });

    (service as unknown as { state: { duration: number; currentTime: number } }).state.duration = 240;
    (service as unknown as { state: { duration: number; currentTime: number } }).state.currentTime = 5;

    service.seek(120);

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        currentTime: 22,
      },
    });

    expect(service.getCurrentTime()).toBe(120);
    expect(observed[observed.length - 1]).toBe(120);

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        currentTime: 120,
      },
    });

    expect(service.getCurrentTime()).toBe(120);

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        currentTime: 123,
      },
    });

    expect(service.getCurrentTime()).toBe(123);

    unsub();
    service.destroy();
    vi.useRealTimers();
  });

  it('keeps ignoring stale native currentTime for slow seek settle window', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    vi.useFakeTimers();

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    (service as unknown as { state: { duration: number; currentTime: number } }).state.duration = 240;
    (service as unknown as { state: { duration: number; currentTime: number } }).state.currentTime = 5;

    service.seek(120);
    await vi.advanceTimersByTimeAsync(2_000);

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        currentTime: 24,
      },
    });

    expect(service.getCurrentTime()).toBe(120);

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        currentTime: 120,
      },
    });

    expect(service.getCurrentTime()).toBe(120);

    service.destroy();
    vi.useRealTimers();
  });

  it('releases stale guard after seek command failure so backend clock can recover', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_seek') {
        return Promise.reject(new Error('seek failed'));
      }
      return Promise.resolve(undefined);
    });

    vi.useFakeTimers();

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    (service as unknown as { state: { duration: number; currentTime: number } }).state.duration = 240;
    (service as unknown as { state: { duration: number; currentTime: number } }).state.currentTime = 5;

    service.seek(120);
    await vi.advanceTimersByTimeAsync(100);

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        currentTime: 26,
      },
    });

    expect(service.getCurrentTime()).toBe(26);

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
      decodeMode: 'streaming',
    });

    service.destroy();
  });

  it('restores engine policy from storage', async () => {
    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_ENGINE_POLICY,
      JSON.stringify({
        transportMode: 'transport-exact',
        srcMode: 'target-rate',
        srcBackend: 'linear-simd',
        srcTargetSampleRate: 96000,
        outputQuantizationMode: 'round',
      })
    );

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invoke).toHaveBeenCalledWith('native_audio_set_engine_policy', {
      transportMode: 'transport-exact',
      srcMode: 'target-rate',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: 96000,
      outputQuantizationMode: 'round',
    });

    service.destroy();
  });

  it('keeps full-track decode mode when recovery policy escalates buffering', async () => {
    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS,
      JSON.stringify({
        startOrSeekSeconds: 1.4,
        crossfadeSeconds: 0.7,
        decodeMode: 'full-track',
      })
    );

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
        currentTime: 2,
        duration: 12,
      },
    });

    expect(invoke).toHaveBeenCalledWith('native_audio_set_streaming_buffer_settings', {
      startOrSeekSeconds: 3.2,
      crossfadeSeconds: 1.4,
      decodeMode: 'full-track',
    });

    service.destroy();
  });

  it('auto switches shared backend after repeated underrun spikes', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi-exclusive', 'rodio-cpal', 'wasapi', 'wasapi-shared-raw']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'rodio-cpal' });
      }
      if (cmd === 'native_audio_select_output_backend') {
        if (payload?.backendId === 'wasapi-shared-raw') {
          return Promise.resolve({ outputBackendId: 'wasapi-shared-raw' });
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
      backendId: 'wasapi-shared-raw',
    });

    service.destroy();
  });

  it('does not treat underrun counter reset as a spike', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi-exclusive', 'rodio-cpal', 'wasapi']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'rodio-cpal' });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const baseline = service.getRobustnessSnapshot?.();
    expect(baseline?.underrunEvents).toBe(0);

    handlers.native_audio_state?.({ payload: { playbackState: 'playing', underrunEvents: 4 } });
    handlers.native_audio_state?.({ payload: { playbackState: 'playing', underrunEvents: 1 } });

    const afterReset = service.getRobustnessSnapshot?.();
    expect(afterReset?.underrunEvents).toBe(1);

    const backendSwitchCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'native_audio_select_output_backend'
    );
    expect(backendSwitchCalls).toHaveLength(0);

    service.destroy();
  });

  it('resets underrun metrics after shared backend switch', async () => {
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

    (service as unknown as { handleUnderrunSpike: (events: number, frames?: number) => void }).handleUnderrunSpike(5, 1024);
    let snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.underrunEvents).toBe(5);

    await (service as unknown as {
      selectOutputBackendInternal: (
        backendId: string | null,
        options?: { persist?: boolean; clearDevice?: boolean }
      ) => Promise<boolean>;
    }).selectOutputBackendInternal('wasapi', { persist: false, clearDevice: false });

    snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.outputBackendId).toBe('wasapi');
    expect(snapshot?.underrunEvents).toBe(0);
    expect(snapshot?.underrunFrames).toBe(0);

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
          srcMode: 'target-rate',
          srcBackend: 'linear-simd',
          srcTargetSampleRate: 96000,
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
    expect(snapshot?.srcMode).toBe('target-rate');
    expect(snapshot?.srcBackend).toBe('linear-simd');
    expect(snapshot?.srcTargetSampleRate).toBe(96000);
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
        outputCallbackIntervalJitterP99Us: 456,
        outputCallbackIntervalOverrunCount: 9,
        outputCallbackExpectedIntervalUs: 10000,
      },
    });

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.outputCallbackMetricsValid).toBe(false);
    expect(snapshot?.outputCallbackP99Us).toBe(0);
    expect(snapshot?.outputWaitTimeoutCount).toBe(0);
    expect(snapshot?.outputRenderUnderrunEvents).toBe(0);
    expect(snapshot?.outputRenderUnderrunFrames).toBe(0);
    expect(snapshot?.outputCallbackIntervalJitterP99Us).toBe(0);
    expect(snapshot?.outputCallbackIntervalOverrunCount).toBe(0);
    expect(snapshot?.outputCallbackExpectedIntervalUs).toBe(0);

    service.destroy();
  });

  it('updates callback jitter metrics when exclusive metrics are valid', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi-exclusive']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'wasapi-exclusive' });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    handlers.native_audio_state?.({
      payload: {
        outputCallbackMetricsValid: true,
        outputCallbackP99Us: 120,
        outputWaitTimeoutCount: 2,
        outputRenderUnderrunEvents: 1,
        outputRenderUnderrunFrames: 64,
        outputCallbackIntervalJitterP99Us: 80,
        outputCallbackIntervalOverrunCount: 3,
        outputCallbackExpectedIntervalUs: 10000,
      },
    });

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.outputCallbackMetricsValid).toBe(true);
    expect(snapshot?.outputCallbackP99Us).toBe(120);
    expect(snapshot?.outputWaitTimeoutCount).toBe(2);
    expect(snapshot?.outputRenderUnderrunEvents).toBe(1);
    expect(snapshot?.outputRenderUnderrunFrames).toBe(64);
    expect(snapshot?.outputCallbackIntervalJitterP99Us).toBe(80);
    expect(snapshot?.outputCallbackIntervalOverrunCount).toBe(3);
    expect(snapshot?.outputCallbackExpectedIntervalUs).toBe(10000);

    service.destroy();
  });

  it('parses diagnostic timeline payload into robustness snapshot', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    handlers.native_audio_state?.({
      payload: {
        diagnosticTimelineDroppedEvents: 2,
        diagnosticTimeline: [
          {
            seq: 101,
            timestampMs: 1_700_000_000_000,
            kind: 'shared.transfer.render_low_watermark',
            value: 2048,
            aux: 4096,
          },
          {
            seq: 102,
            timestampMs: 1_700_000_000_050,
            kind: 'shared.output.render_underrun',
            value: 64,
            aux: 2,
          },
        ],
      },
    });

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.diagnosticTimelineDroppedEvents).toBe(2);
    expect(snapshot?.diagnosticTimeline?.length).toBe(2);
    expect(snapshot?.diagnosticTimeline?.[0]?.seq).toBe(101);
    expect(snapshot?.diagnosticTimeline?.[1]?.kind).toBe('shared.output.render_underrun');

    service.destroy();
  });

  it('applies stronger shared-mode buffer policy when timeline shows sustained pressure', async () => {
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

    invokeMock.mockClear();

    const now = Date.now();
    handlers.native_audio_state?.({
      payload: {
        diagnosticTimeline: [
          {
            seq: 201,
            timestampMs: now - 100,
            kind: 'shared.transfer.render_low_watermark',
            value: 1024,
            aux: 4096,
          },
          {
            seq: 202,
            timestampMs: now - 90,
            kind: 'shared.transfer.decode_low_watermark',
            value: 900,
            aux: 4096,
          },
          {
            seq: 203,
            timestampMs: now - 80,
            kind: 'shared.render_ahead.low_watermark',
            value: 800,
            aux: 4096,
          },
          {
            seq: 204,
            timestampMs: now - 70,
            kind: 'shared.transfer.render_low_watermark',
            value: 700,
            aux: 4096,
          },
        ],
      },
    });

    const streamSettingCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'native_audio_set_streaming_buffer_settings'
    );

    expect(streamSettingCalls.length).toBeGreaterThan(0);
    expect(streamSettingCalls).toContainEqual([
      'native_audio_set_streaming_buffer_settings',
      {
        startOrSeekSeconds: 3.6,
        crossfadeSeconds: 1.9,
        decodeMode: 'streaming',
      },
    ]);

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.protectionReason).toBe('shared-low-watermark-pressure');

    service.destroy();
  });

  it('temporarily switches SRC to latency profile during seek and restores quality profile after stable window', async () => {
    vi.useFakeTimers();

    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'wasapi' });
      }
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          srcMode: 'target-rate',
          srcBackend: 'rubato',
          srcTargetSampleRate: 96000,
        });
      }
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    invokeMock.mockClear();
    (service as unknown as { state: { duration: number } }).state.duration = 200;
    service.seek(32);
    await vi.advanceTimersByTimeAsync(100);

    expect(invoke).toHaveBeenCalledWith('native_audio_set_engine_policy', {
      srcMode: 'match-output',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: null,
    });

    const during = service.getRobustnessSnapshot?.();
    expect(during?.dynamicSrcProfile).toBe('latency');

    handlers.native_audio_state?.({ payload: { playbackState: 'playing', currentTime: 33 } });
    await vi.advanceTimersByTimeAsync(4_200);

    expect(invoke).toHaveBeenCalledWith('native_audio_set_engine_policy', {
      srcMode: 'target-rate',
      srcBackend: 'rubato',
      srcTargetSampleRate: 96000,
    });

    const restored = service.getRobustnessSnapshot?.();
    expect(restored?.dynamicSrcProfile).toBe('quality');

    service.destroy();
    vi.useRealTimers();
  });

  it('defers latency SRC switch until active seek command settles', async () => {
    vi.useFakeTimers();

    const seekGate: { release: (() => void) | null } = { release: null };
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          srcMode: 'target-rate',
          srcBackend: 'rubato',
          srcTargetSampleRate: 96000,
        });
      }
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
        });
      }
      if (cmd === 'native_audio_seek') {
        return new Promise<void>((resolve) => {
          seekGate.release = () => resolve();
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    invokeMock.mockClear();
    (service as unknown as { state: { duration: number } }).state.duration = 200;
    service.seek(48);
    await vi.advanceTimersByTimeAsync(100);

    expect(invoke).toHaveBeenCalledWith(
      'native_audio_seek',
      expect.objectContaining({ time: 48, seekSeq: expect.any(Number) })
    );

    const policyCallsWhileSeekInFlight = invokeMock.mock.calls.filter(
      (call) => call[0] === 'native_audio_set_engine_policy'
    );
    expect(policyCallsWhileSeekInFlight).toHaveLength(0);

    if (seekGate.release) {
      seekGate.release();
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(invoke).toHaveBeenCalledWith('native_audio_set_engine_policy', {
      srcMode: 'match-output',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: null,
    });

    service.destroy();
    vi.useRealTimers();
  });

  it('deduplicates deferred latency SRC switching during rapid seek bursts', async () => {
    vi.useFakeTimers();

    const pendingPolicyResolvers: Array<() => void> = [];
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          srcMode: 'target-rate',
          srcBackend: 'rubato',
          srcTargetSampleRate: 96000,
        });
      }
      if (cmd === 'native_audio_set_engine_policy') {
        return new Promise((resolve) => {
          pendingPolicyResolvers.push(() =>
            resolve({
              srcMode: payload?.srcMode,
              srcBackend: payload?.srcBackend,
              srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
            })
          );
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    invokeMock.mockClear();
    (service as unknown as { state: { duration: number } }).state.duration = 300;

    for (let i = 0; i < 10; i += 1) {
      service.seek(12 + i * 8);
      await vi.advanceTimersByTimeAsync(30);
    }

    const latencyPolicyCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'native_audio_set_engine_policy'
    );
    expect(latencyPolicyCalls).toHaveLength(1);

    pendingPolicyResolvers.forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(0);

    service.destroy();
    vi.useRealTimers();
  });

  it('does not auto-switch SRC while manual SRC lock is active', async () => {
    vi.useFakeTimers();

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'wasapi' });
      }
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          srcMode: 'target-rate',
          srcBackend: 'rubato',
          srcTargetSampleRate: 96000,
        });
      }
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    await service.setEnginePolicy?.({
      srcMode: 'target-rate',
      srcBackend: 'rubato',
      srcTargetSampleRate: 96000,
    });

    invokeMock.mockClear();
    (service as unknown as { state: { duration: number } }).state.duration = 180;
    service.seek(18);
    await vi.advanceTimersByTimeAsync(80);

    const autoSrcCallsDuringManualLock = invokeMock.mock.calls.filter(
      (call) => call[0] === 'native_audio_set_engine_policy'
    );
    expect(autoSrcCallsDuringManualLock).toHaveLength(0);

    await service.setDynamicSrcAutoSettings?.({ enabled: true });

    invokeMock.mockClear();
    service.seek(42);
    await vi.advanceTimersByTimeAsync(80);

    expect(invoke).toHaveBeenCalledWith('native_audio_set_engine_policy', {
      srcMode: 'match-output',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: null,
    });

    service.destroy();
    vi.useRealTimers();
  });

  it('persists engine policy after setEnginePolicy', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          transportMode: payload?.transportMode,
          hqSrcPhaseMode: 'minimum',
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
          outputQuantizationMode: payload?.outputQuantizationMode,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await service.setEnginePolicy?.({
      transportMode: 'robust',
      srcMode: 'target-rate',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: 96000,
      outputQuantizationMode: 'tpdf',
    });

    const persistedRaw = localStorage.getItem(STORAGE_KEYS.NATIVE_AUDIO_ENGINE_POLICY);
    expect(persistedRaw).toBeTruthy();
    const persisted = JSON.parse(persistedRaw as string) as Record<string, unknown>;
    expect(persisted).toMatchObject({
      transportMode: 'robust',
      hqSrcPhaseMode: 'minimum',
      srcMode: 'target-rate',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: 96000,
      outputQuantizationMode: 'tpdf',
    });

    service.destroy();
  });

  it('accepts configurable dynamic SRC timing parameters from settings and reflects them in snapshot', async () => {
    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await service.setDynamicSrcAutoSettings?.({
      enabled: true,
      adaptiveEnabled: true,
      learningEnabled: true,
      restoreDebounceMs: 5200,
      minSwitchIntervalMs: 900,
      seekHoldMs: 2500,
      underrunHoldMs: 18000,
      sharedStressHoldMs: 11000,
      outputErrorHoldMs: 15000,
    });

    const settings = service.getDynamicSrcAutoSettings?.();
    expect(settings?.restoreDebounceMs).toBe(5200);
    expect(settings?.minSwitchIntervalMs).toBe(900);
    expect(settings?.seekHoldMs).toBe(2500);
    expect(settings?.underrunHoldMs).toBe(18000);
    expect(settings?.sharedStressHoldMs).toBe(11000);
    expect(settings?.outputErrorHoldMs).toBe(15000);

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.dynamicSrcRestoreDebounceMs).toBe(5200);
    expect(snapshot?.dynamicSrcMinSwitchIntervalMs).toBe(900);
    expect(snapshot?.dynamicSrcSeekHoldMs).toBe(2500);
    expect(snapshot?.dynamicSrcUnderrunHoldMs).toBe(18000);
    expect(snapshot?.dynamicSrcSharedStressHoldMs).toBe(11000);
    expect(snapshot?.dynamicSrcOutputErrorHoldMs).toBe(15000);

    service.destroy();
  });

  it('persists per-device dynamic SRC learning profile and increases effective timing scale', async () => {
    vi.useFakeTimers();

    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_DEVICE,
      JSON.stringify({ id: 'device-1', name: 'Device One' })
    );

    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'wasapi' });
      }
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          srcMode: 'target-rate',
          srcBackend: 'rubato',
          srcTargetSampleRate: 96000,
        });
      }
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    await service.setDynamicSrcAutoSettings?.({
      enabled: true,
      adaptiveEnabled: true,
      learningEnabled: true,
      restoreDebounceMs: 3000,
      minSwitchIntervalMs: 1000,
      seekHoldMs: 2000,
      underrunHoldMs: 3000,
      sharedStressHoldMs: 3000,
      outputErrorHoldMs: 3000,
    });

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        outputCallbackMetricsValid: true,
        outputWaitTimeoutCount: 3,
        outputRenderUnderrunEvents: 2,
        outputCallbackIntervalOverrunCount: 1,
      },
    });
    await vi.advanceTimersByTimeAsync(100);

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.dynamicSrcLearningEnabled).toBe(true);
    expect(typeof snapshot?.dynamicSrcLearningScale).toBe('number');
    expect((snapshot?.dynamicSrcLearningScale ?? 1) > 1).toBe(true);
    expect(typeof snapshot?.dynamicSrcLearningDeviceKey).toBe('string');
    expect((snapshot?.dynamicSrcLearningStressIndex ?? 0) > 0).toBe(true);

    const learningRaw = localStorage.getItem(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE);
    expect(typeof learningRaw).toBe('string');

    service.destroy();
    vi.useRealTimers();
  });

  it('applies adaptive timing profile when stress rises and restores baseline once stable', async () => {
    vi.useFakeTimers();

    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'wasapi' });
      }
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          srcMode: 'target-rate',
          srcBackend: 'rubato',
          srcTargetSampleRate: 96000,
        });
      }
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    await service.setDynamicSrcAutoSettings?.({
      enabled: true,
      adaptiveEnabled: true,
      learningEnabled: false,
      restoreDebounceMs: 2000,
      minSwitchIntervalMs: 1000,
      seekHoldMs: 1500,
      underrunHoldMs: 3000,
      sharedStressHoldMs: 3000,
      outputErrorHoldMs: 3000,
    });

    invokeMock.mockClear();
    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        outputCallbackMetricsValid: true,
        outputWaitTimeoutCount: 3,
        outputRenderUnderrunEvents: 2,
        outputCallbackIntervalOverrunCount: 1,
      },
    });
    (service as unknown as { state: { duration: number } }).state.duration = 120;
    service.seek(20);
    await vi.advanceTimersByTimeAsync(120);

    expect(invoke).toHaveBeenCalledWith('native_audio_set_engine_policy', {
      srcMode: 'match-output',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: null,
    });

    const stressed = service.getRobustnessSnapshot?.();
    expect(stressed?.dynamicSrcAdaptiveEnabled).toBe(true);
    expect(stressed?.dynamicSrcAdaptiveProfile).not.toBe('baseline');
    expect(typeof stressed?.dynamicSrcStressScore).toBe('number');
    expect((stressed?.dynamicSrcStressScore ?? 0) > 0).toBe(true);
    expect((stressed?.dynamicSrcEffectiveRestoreDebounceMs ?? 0) > (stressed?.dynamicSrcRestoreDebounceMs ?? 0)).toBe(true);
    expect((stressed?.dynamicSrcEffectiveMinSwitchIntervalMs ?? 0) < (stressed?.dynamicSrcMinSwitchIntervalMs ?? 0)).toBe(true);

    handlers.native_audio_state?.({ payload: { playbackState: 'playing', currentTime: 22 } });
    handlers.native_audio_state?.({
      payload: {
        outputCallbackMetricsValid: true,
        outputWaitTimeoutCount: 0,
        outputRenderUnderrunEvents: 0,
        outputCallbackIntervalOverrunCount: 0,
      },
    });
    await vi.advanceTimersByTimeAsync(6200);

    const recovered = service.getRobustnessSnapshot?.();
    expect(recovered?.dynamicSrcAdaptiveProfile).toBe('baseline');
    expect(recovered?.dynamicSrcStressScore).toBe(0);
    expect(recovered?.dynamicSrcEffectiveRestoreDebounceMs).toBe(recovered?.dynamicSrcRestoreDebounceMs);
    expect(recovered?.dynamicSrcEffectiveMinSwitchIntervalMs).toBe(recovered?.dynamicSrcMinSwitchIntervalMs);

    service.destroy();
    vi.useRealTimers();
  });

  it('stores and exposes dual spectrum frames by tap', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    handlers.native_audio_spectrum?.({
      payload: {
        frameId: 100,
        timestampMs: 1234,
        tapId: 'pre-dsp',
        sampleRate: 48000,
        bins: [0.1, 0.2, 0.3],
      },
    });

    handlers.native_audio_spectrum?.({
      payload: {
        frameId: 100,
        timestampMs: 1234,
        tapId: 'post-dsp',
        sampleRate: 48000,
        bins: [0.2, 0.3, 0.4],
      },
    });

    const pre = service.getSpectrumFrame?.('pre-dsp');
    const post = service.getSpectrumFrame?.('post-dsp');

    expect(pre?.frameId).toBe(100);
    expect(pre?.tap).toBe('pre-dsp');
    expect(post?.frameId).toBe(100);
    expect(post?.tap).toBe('post-dsp');
    expect(post?.bins?.length).toBe(3);

    service.destroy();
  });
});
