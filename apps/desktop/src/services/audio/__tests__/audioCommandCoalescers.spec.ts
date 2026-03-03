import { describe, expect, it, vi } from 'vitest';

import {
  SeekCommandCoalescer,
  VolumeCommandCoalescer,
} from '../audioCommandCoalescers';

describe('audioCommandCoalescers', () => {
  it('dispatches seek with latest payload and sequence', () => {
    const coalescer = new SeekCommandCoalescer({
      coalesceMs: 12,
      minDispatchIntervalMs: 20,
      maxParallelInvocations: 3,
      staleGuardWindowMs: 8_000,
      staleGuardToleranceSeconds: 0.45,
    });

    coalescer.queueSeek(42, 9);
    const decision = coalescer.takeFlushDecision(1_000);
    expect(decision).toEqual({ action: 'dispatch', target: 42, seekSeq: 9 });
    coalescer.finishDispatch();
  });

  it('reschedules seek when min interval not satisfied', () => {
    const coalescer = new SeekCommandCoalescer({
      coalesceMs: 12,
      minDispatchIntervalMs: 20,
      maxParallelInvocations: 3,
      staleGuardWindowMs: 8_000,
      staleGuardToleranceSeconds: 0.45,
    });

    coalescer.queueSeek(10, 1);
    expect(coalescer.takeFlushDecision(1_000).action).toBe('dispatch');
    coalescer.queueSeek(12, 2);

    const decision = coalescer.takeFlushDecision(1_010);
    expect(decision.action).toBe('reschedule');
    if (decision.action === 'reschedule') {
      expect(decision.delayMs).toBe(10);
    }
  });

  it('limits parallel seek dispatch and reschedules overflow', () => {
    const coalescer = new SeekCommandCoalescer({
      coalesceMs: 12,
      minDispatchIntervalMs: 0,
      maxParallelInvocations: 1,
      staleGuardWindowMs: 8_000,
      staleGuardToleranceSeconds: 0.45,
    });

    coalescer.queueSeek(10, 1);
    expect(coalescer.takeFlushDecision(1_000).action).toBe('dispatch');
    coalescer.queueSeek(20, 2);

    const decision = coalescer.takeFlushDecision(1_001);
    expect(decision).toEqual({ action: 'reschedule', delayMs: 8 });

    coalescer.finishDispatch();
    const dispatch = coalescer.takeFlushDecision(1_010);
    expect(dispatch.action).toBe('dispatch');
  });

  it('uses seek stale guard to ignore regressive backend time', () => {
    const coalescer = new SeekCommandCoalescer({
      coalesceMs: 12,
      minDispatchIntervalMs: 20,
      maxParallelInvocations: 3,
      staleGuardWindowMs: 8_000,
      staleGuardToleranceSeconds: 0.45,
    });

    coalescer.markGuard(100, 10, 1_000);
    expect(coalescer.shouldIgnoreBackendCurrentTime(90, 1_100)).toBe(true);
    expect(coalescer.shouldIgnoreBackendCurrentTime(100, 1_120)).toBe(false);
  });

  it('schedules and clears seek timer through hooks', () => {
    const scheduleTimer = vi.fn((_: number, callback: () => void) => {
      callback();
      return 1;
    });
    const clearTimer = vi.fn();
    const flush = vi.fn();

    const coalescer = new SeekCommandCoalescer({
      coalesceMs: 12,
      minDispatchIntervalMs: 20,
      maxParallelInvocations: 3,
      staleGuardWindowMs: 8_000,
      staleGuardToleranceSeconds: 0.45,
    });

    coalescer.scheduleFlush(6, { scheduleTimer, clearTimer }, flush);
    expect(scheduleTimer).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);

    coalescer.queueSeek(10, 1);
    coalescer.clearPendingAndGuard({ clearTimer });
  });

  it('dispatches volume with debounce and throttle decisions', () => {
    const coalescer = new VolumeCommandCoalescer({
      coalesceMs: 24,
      minDispatchIntervalMs: 16,
    });

    coalescer.queueVolume(0.5);
    const first = coalescer.takeFlushDecision(1_000);
    expect(first).toEqual({ action: 'dispatch', volume: 0.5 });

    coalescer.queueVolume(0.7);
    const second = coalescer.takeFlushDecision(1_005);
    expect(second.action).toBe('reschedule');
    if (second.action === 'reschedule') {
      expect(second.delayMs).toBe(11);
    }
  });
});

