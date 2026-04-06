import { describe, expect, it, vi } from 'vitest';
import {
  bindHostRuntimeEventChannel,
  RUNTIME_EVENT_NAMES,
} from './runtimeEventChannel';

function createAudioHarness() {
  let onStateChange: ((state: unknown) => void) | null = null;
  let onTimeUpdate: ((time: number) => void) | null = null;
  let onEnded: (() => void) | null = null;
  let onLoadProgress: ((progress: number) => void) | null = null;
  let onError: ((error: unknown) => void) | null = null;

  return {
    service: {
      getState: vi.fn(() => ({ playbackState: 'paused' })),
      onStateChange: vi.fn((listener: (state: unknown) => void) => {
        onStateChange = listener;
        return () => {
          if (onStateChange === listener) onStateChange = null;
        };
      }),
      onTimeUpdate: vi.fn((listener: (time: number) => void) => {
        onTimeUpdate = listener;
        return () => {
          if (onTimeUpdate === listener) onTimeUpdate = null;
        };
      }),
      onEnded: vi.fn((listener: () => void) => {
        onEnded = listener;
        return () => {
          if (onEnded === listener) onEnded = null;
        };
      }),
      onLoadProgress: vi.fn((listener: (progress: number) => void) => {
        onLoadProgress = listener;
        return () => {
          if (onLoadProgress === listener) onLoadProgress = null;
        };
      }),
      onError: vi.fn((listener: (error: unknown) => void) => {
        onError = listener;
        return () => {
          if (onError === listener) onError = null;
        };
      }),
      play: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      stop: vi.fn(() => undefined),
      seek: vi.fn(() => undefined),
      setVolume: vi.fn(() => undefined),
      toggleMute: vi.fn(() => undefined),
    },
    emitState: (state: unknown) => onStateChange?.(state),
    emitTime: (time: number) => onTimeUpdate?.(time),
    emitEnded: () => onEnded?.(),
    emitLoadProgress: (progress: number) => onLoadProgress?.(progress),
    emitError: (error: unknown) => onError?.(error),
  };
}

function createNavigationHarness() {
  let onChange: ((snapshot: unknown) => void) | null = null;

  return {
    navigation: {
      navigateTo: vi.fn(),
      goBack: vi.fn(),
      getSnapshot: vi.fn(() => ({ currentIndex: 0 })),
      subscribe: vi.fn((listener: (snapshot: unknown) => void) => {
        onChange = listener;
        return () => {
          if (onChange === listener) onChange = null;
        };
      }),
    },
    emitChange: (snapshot: unknown) => onChange?.(snapshot),
  };
}

describe('runtime event channel', () => {
  it('binds host services into canonical runtime events', () => {
    const audio = createAudioHarness();
    const navigation = createNavigationHarness();
    const emitted: Array<{ eventName: string; payload: unknown }> = [];
    const configState: { listener: ((config: Record<string, unknown>) => void) | null } = {
      listener: null,
    };
    const timerState: { handler: (() => void) | null } = {
      handler: null,
    };

    const dispose = bindHostRuntimeEventChannel({
      permissions: new Set([
        'api:audio-state',
        'api:audio-visual',
        'api:navigation',
        'storage:local',
      ]),
      audioService: audio.service as never,
      navigation: navigation.navigation as never,
      emitRuntimeEvent: (eventName, payload) => {
        emitted.push({ eventName, payload });
      },
      subscribeConfig: (listener) => {
        configState.listener = listener;
        return () => {
          if (configState.listener === listener) configState.listener = null;
        };
      },
      getSpectrum: () => Uint8Array.from([1, 2, 3]),
      getSpectrumFrame: (options) => ({
        tap: options?.tap === 'pre-dsp' ? 'pre-dsp' : 'post-dsp',
        bins: Uint8Array.from(options?.tap === 'pre-dsp' ? [4, 5, 6] : [7, 8, 9]),
      }),
      setIntervalFn: (handler) => {
        timerState.handler = handler;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalFn: () => undefined,
    });

    audio.emitState({ playbackState: 'playing' });
    audio.emitTime(12.5);
    audio.emitLoadProgress(0.42);
    audio.emitError('decoder failed');
    audio.emitEnded();
    navigation.emitChange({ currentIndex: 2 });
    if (configState.listener) {
      configState.listener({ enabled: true });
    }
    if (timerState.handler) {
      timerState.handler();
    }

    expect(emitted).toEqual(
      expect.arrayContaining([
        { eventName: RUNTIME_EVENT_NAMES.audioState, payload: { state: { playbackState: 'playing' } } },
        { eventName: RUNTIME_EVENT_NAMES.audioTime, payload: { time: 12.5 } },
        { eventName: RUNTIME_EVENT_NAMES.audioLoadProgress, payload: { progress: 0.42 } },
        { eventName: RUNTIME_EVENT_NAMES.audioError, payload: { message: 'decoder failed' } },
        { eventName: RUNTIME_EVENT_NAMES.audioEnded, payload: undefined },
        { eventName: RUNTIME_EVENT_NAMES.navigationChanged, payload: { snapshot: { currentIndex: 2 } } },
        { eventName: RUNTIME_EVENT_NAMES.configChanged, payload: { config: { enabled: true } } },
        {
          eventName: RUNTIME_EVENT_NAMES.visualizerSpectrum,
          payload: { spectrum: Uint8Array.from([1, 2, 3]) },
        },
      ])
    );

    dispose();
    audio.emitState({ playbackState: 'paused' });
    expect(emitted).toHaveLength(10);
  });
});
