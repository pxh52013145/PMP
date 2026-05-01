import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markStartupReady, onStartupIdle } from './startupReady';

function resetStartupReadyFlag(): void {
  delete document.documentElement.dataset.pmpStartupReady;
}

describe('startupReady', () => {
  beforeEach(() => {
    resetStartupReadyFlag();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetStartupReadyFlag();
  });

  it('runs startup idle work after startup-ready, delay, and idle fallback', async () => {
    const task = vi.fn();

    const cleanup = onStartupIdle(task, { delayMs: 100, timeoutMs: 50 });

    await vi.advanceTimersByTimeAsync(200);
    expect(task).not.toHaveBeenCalled();

    markStartupReady();
    await vi.advanceTimersByTimeAsync(99);
    expect(task).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(task).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(49);
    expect(task).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('can cancel pending startup idle work', async () => {
    const task = vi.fn();

    const cleanup = onStartupIdle(task, { delayMs: 100, timeoutMs: 50 });
    markStartupReady();
    cleanup();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).not.toHaveBeenCalled();
  });
});
