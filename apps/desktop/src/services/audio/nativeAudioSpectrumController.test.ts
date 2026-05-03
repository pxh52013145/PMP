import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeAudioSpectrumController } from './nativeAudioSpectrumController';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('NativeAudioSpectrumController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not enable spectrum when playback is idle', async () => {
    const setBackendEnabled = vi.fn<[boolean], Promise<void>>(() => Promise.resolve());
    const controller = new NativeAudioSpectrumController({
      now: () => 10_000,
      setBackendEnabled,
    });

    controller.touch('idle');
    await flushMicrotasks();

    expect(setBackendEnabled).not.toHaveBeenCalled();
    expect(controller.isEnabled()).toBe(false);
  });

  it('enables spectrum on active playback and disables it after idle timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const setBackendEnabled = vi.fn<[boolean], Promise<void>>(() => Promise.resolve());
    const onClearData = vi.fn();
    const controller = new NativeAudioSpectrumController({
      setBackendEnabled,
      onClearData,
    });

    controller.handlePlaybackState('playing');
    controller.touch('playing');
    await flushMicrotasks();

    expect(controller.isEnabled()).toBe(true);
    expect(setBackendEnabled).toHaveBeenCalledWith(true);

    vi.advanceTimersByTime(2600);
    await flushMicrotasks();

    expect(controller.isEnabled()).toBe(false);
    expect(setBackendEnabled).toHaveBeenLastCalledWith(false);
    expect(onClearData).toHaveBeenCalledTimes(1);
  });

  it('keeps paused spectrum reads inside playback grace and disables after grace expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const setBackendEnabled = vi.fn<[boolean], Promise<void>>(() => Promise.resolve());
    const controller = new NativeAudioSpectrumController({
      setBackendEnabled,
    });

    controller.handlePlaybackState('playing');
    vi.setSystemTime(12_000);
    controller.touch('paused');
    await flushMicrotasks();

    expect(controller.isEnabled()).toBe(true);
    expect(setBackendEnabled).toHaveBeenCalledWith(true);

    vi.setSystemTime(15_001);
    controller.touch('paused');
    await flushMicrotasks();

    expect(controller.isEnabled()).toBe(false);
    expect(setBackendEnabled).toHaveBeenLastCalledWith(false);
  });

  it('clears spectrum data when reset disables an active controller', async () => {
    const setBackendEnabled = vi.fn<[boolean], Promise<void>>(() => Promise.resolve());
    const onClearData = vi.fn();
    const controller = new NativeAudioSpectrumController({
      now: () => 10_000,
      setBackendEnabled,
      onClearData,
    });

    controller.handlePlaybackState('playing');
    controller.touch('playing');
    await flushMicrotasks();

    controller.reset();
    await flushMicrotasks();

    expect(setBackendEnabled).toHaveBeenLastCalledWith(false);
    expect(onClearData).toHaveBeenCalledTimes(1);
  });
});
