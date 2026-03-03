import { afterEach, describe, expect, it, vi } from 'vitest';

import { NativeAudioRobustnessController } from '../nativeAudioRobustnessController';
import type { AudioRobustnessSnapshot } from '../types';

describe('nativeAudioRobustnessController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes and emits latest snapshot', () => {
    let seq = 0;
    const controller = new NativeAudioRobustnessController({
      minIntervalMs: 10,
      forceBurstWindowMs: 100,
      forceBurstLimit: 3,
      buildSnapshot: () => ({ seq } as unknown as AudioRobustnessSnapshot),
    });
    const callback = vi.fn();

    const unsubscribe = controller.subscribe(callback);
    expect(callback).toHaveBeenCalledTimes(1);

    seq = 1;
    controller.emit(true);
    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribe();
    seq = 2;
    controller.emit(true);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('deduplicates non-force emissions with same signature', () => {
    const controller = new NativeAudioRobustnessController({
      minIntervalMs: 10,
      forceBurstWindowMs: 100,
      forceBurstLimit: 3,
      buildSnapshot: () => ({ stable: true } as unknown as AudioRobustnessSnapshot),
    });
    const callback = vi.fn();
    controller.subscribe(callback);

    controller.emit(false);
    controller.emit(false);

    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('defers emissions by gate interval and flushes later', () => {
    vi.useFakeTimers();

    let seq = 0;
    const controller = new NativeAudioRobustnessController({
      minIntervalMs: 50,
      forceBurstWindowMs: 100,
      forceBurstLimit: 3,
      buildSnapshot: () => ({ seq } as unknown as AudioRobustnessSnapshot),
    });
    const callback = vi.fn();
    controller.subscribe(callback);

    seq = 1;
    controller.emit(false);
    expect(callback).toHaveBeenCalledTimes(2);

    seq = 2;
    controller.emit(false);
    expect(callback).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(55);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('forwards listener callback errors to onListenerError', () => {
    const onListenerError = vi.fn();
    const controller = new NativeAudioRobustnessController({
      minIntervalMs: 10,
      forceBurstWindowMs: 100,
      forceBurstLimit: 3,
      buildSnapshot: () => ({ ok: true } as unknown as AudioRobustnessSnapshot),
      onListenerError,
    });

    let firstCall = true;
    controller.subscribe(() => {
      if (firstCall) {
        firstCall = false;
        return;
      }
      throw new Error('listener boom');
    });
    controller.emit(true);

    expect(onListenerError).toHaveBeenCalledTimes(1);
  });
});
