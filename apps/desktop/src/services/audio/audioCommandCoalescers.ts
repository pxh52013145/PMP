export type SeekFlushDecision =
  | { action: 'noop' }
  | { action: 'reschedule'; delayMs: number }
  | { action: 'dispatch'; target: number; seekSeq: number | null };

export type VolumeFlushDecision =
  | { action: 'noop' }
  | { action: 'reschedule'; delayMs: number }
  | { action: 'dispatch'; volume: number };

type TimerHooks = {
  scheduleTimer(delayMs: number, callback: () => void): number;
  clearTimer(timerId: number): void;
};

export type SeekCommandCoalescerConfig = {
  coalesceMs: number;
  minDispatchIntervalMs: number;
  maxParallelInvocations: number;
  staleGuardWindowMs: number;
  staleGuardToleranceSeconds: number;
};

export class SeekCommandCoalescer {
  private pendingSeekTime: number | null = null;
  private pendingSeekSeq: number | null = null;
  private pendingSeekTimer: number | null = null;
  private pendingSeekTarget: number | null = null;
  private pendingSeekDirection: 'forward' | 'backward' | null = null;
  private pendingSeekSettleUntilMs = 0;
  private activeSeekInvokeCount = 0;
  private lastSeekDispatchAtMs = 0;

  constructor(private readonly config: SeekCommandCoalescerConfig) {}

  clearPendingAndGuard(hooks?: Pick<TimerHooks, 'clearTimer'>): void {
    this.pendingSeekTime = null;
    this.pendingSeekSeq = null;
    this.clearPendingTimer(hooks);
    this.clearGuard();
  }

  clearAll(hooks?: Pick<TimerHooks, 'clearTimer'>): void {
    this.clearPendingAndGuard(hooks);
    this.activeSeekInvokeCount = 0;
    this.lastSeekDispatchAtMs = 0;
  }

  hasPendingWork(): boolean {
    return this.activeSeekInvokeCount > 0 || typeof this.pendingSeekTime === 'number';
  }

  hasQueuedSeek(): boolean {
    return typeof this.pendingSeekTime === 'number';
  }

  queueSeek(target: number, seekSeq: number | null): void {
    this.pendingSeekTime = target;
    this.pendingSeekSeq = seekSeq;
  }

  markGuard(target: number, currentTime: number, nowMs: number): void {
    if (!Number.isFinite(target)) return;
    this.pendingSeekDirection = target >= currentTime ? 'forward' : 'backward';
    this.pendingSeekTarget = target;
    this.pendingSeekSettleUntilMs = nowMs + this.config.staleGuardWindowMs;
  }

  clearGuard(): void {
    this.pendingSeekTarget = null;
    this.pendingSeekDirection = null;
    this.pendingSeekSettleUntilMs = 0;
  }

  isSameGuardTarget(target: number): boolean {
    if (typeof this.pendingSeekTarget !== 'number') return false;
    return (
      Math.abs(this.pendingSeekTarget - target) <= this.config.staleGuardToleranceSeconds
    );
  }

  shouldIgnoreBackendCurrentTime(nextTime: number, nowMs: number): boolean {
    if (!Number.isFinite(nextTime)) return false;
    if (typeof this.pendingSeekTarget !== 'number') return false;

    const target = this.pendingSeekTarget;
    const tolerance = this.config.staleGuardToleranceSeconds;
    const direction = this.pendingSeekDirection;
    const waitingForSeekCommit =
      this.activeSeekInvokeCount > 0 || typeof this.pendingSeekTime === 'number';

    if (Math.abs(nextTime - target) <= tolerance) {
      this.clearGuard();
      return false;
    }

    if (direction === 'forward' && nextTime > target + tolerance) {
      this.clearGuard();
      return false;
    }

    if (direction === 'backward' && nextTime < target - tolerance) {
      this.clearGuard();
      return false;
    }

    if (waitingForSeekCommit) {
      return true;
    }

    if (nowMs <= this.pendingSeekSettleUntilMs) {
      if (direction === 'forward') {
        return nextTime < target - tolerance;
      }
      if (direction === 'backward') {
        return nextTime > target + tolerance;
      }
    }

    this.clearGuard();
    return false;
  }

  takeFlushDecision(nowMs: number): SeekFlushDecision {
    const target = this.pendingSeekTime;
    const seekSeq = this.pendingSeekSeq;
    if (typeof target !== 'number' || !Number.isFinite(target)) {
      this.pendingSeekTime = null;
      this.pendingSeekSeq = null;
      return { action: 'noop' };
    }

    if (this.activeSeekInvokeCount >= this.config.maxParallelInvocations) {
      return { action: 'reschedule', delayMs: 8 };
    }

    const elapsedSinceLastDispatch = nowMs - this.lastSeekDispatchAtMs;
    const remainingThrottleMs = this.config.minDispatchIntervalMs - elapsedSinceLastDispatch;
    if (remainingThrottleMs > 0) {
      return { action: 'reschedule', delayMs: remainingThrottleMs };
    }

    this.pendingSeekTime = null;
    this.pendingSeekSeq = null;
    this.lastSeekDispatchAtMs = nowMs;
    this.activeSeekInvokeCount += 1;

    return { action: 'dispatch', target, seekSeq };
  }

  finishDispatch(): void {
    this.activeSeekInvokeCount = Math.max(0, this.activeSeekInvokeCount - 1);
  }

  scheduleFlush(delayMs: number | undefined, hooks: TimerHooks, flush: () => void): void {
    this.clearPendingTimer(hooks);
    const safeDelayMs = Number.isFinite(delayMs)
      ? Math.max(0, Math.floor(delayMs ?? this.config.coalesceMs))
      : this.config.coalesceMs;

    this.pendingSeekTimer = hooks.scheduleTimer(safeDelayMs, () => {
      this.pendingSeekTimer = null;
      flush();
    });
  }

  private clearPendingTimer(hooks?: Pick<TimerHooks, 'clearTimer'>): void {
    if (this.pendingSeekTimer === null) return;
    hooks?.clearTimer(this.pendingSeekTimer);
    this.pendingSeekTimer = null;
  }
}

export type VolumeCommandCoalescerConfig = {
  coalesceMs: number;
  minDispatchIntervalMs: number;
};

export class VolumeCommandCoalescer {
  private pendingVolume: number | null = null;
  private pendingVolumeTimer: number | null = null;
  private lastVolumeDispatchAtMs = 0;

  constructor(private readonly config: VolumeCommandCoalescerConfig) {}

  clearPending(hooks?: Pick<TimerHooks, 'clearTimer'>): void {
    this.pendingVolume = null;
    this.clearPendingTimer(hooks);
  }

  clearAll(hooks?: Pick<TimerHooks, 'clearTimer'>): void {
    this.clearPending(hooks);
    this.lastVolumeDispatchAtMs = 0;
  }

  queueVolume(volume: number): void {
    this.pendingVolume = volume;
  }

  markImmediateDispatch(nowMs: number): void {
    this.lastVolumeDispatchAtMs = nowMs;
  }

  takeFlushDecision(nowMs: number): VolumeFlushDecision {
    const volume = this.pendingVolume;
    if (typeof volume !== 'number' || !Number.isFinite(volume)) {
      this.pendingVolume = null;
      return { action: 'noop' };
    }

    const elapsedSinceLastDispatch = nowMs - this.lastVolumeDispatchAtMs;
    const remainingThrottleMs = this.config.minDispatchIntervalMs - elapsedSinceLastDispatch;
    if (remainingThrottleMs > 0) {
      return { action: 'reschedule', delayMs: remainingThrottleMs };
    }

    this.pendingVolume = null;
    this.lastVolumeDispatchAtMs = nowMs;
    return { action: 'dispatch', volume };
  }

  scheduleFlush(delayMs: number | undefined, hooks: TimerHooks, flush: () => void): void {
    this.clearPendingTimer(hooks);
    const safeDelayMs = Number.isFinite(delayMs)
      ? Math.max(0, Math.floor(delayMs ?? this.config.coalesceMs))
      : this.config.coalesceMs;

    this.pendingVolumeTimer = hooks.scheduleTimer(safeDelayMs, () => {
      this.pendingVolumeTimer = null;
      flush();
    });
  }

  private clearPendingTimer(hooks?: Pick<TimerHooks, 'clearTimer'>): void {
    if (this.pendingVolumeTimer === null) return;
    hooks?.clearTimer(this.pendingVolumeTimer);
    this.pendingVolumeTimer = null;
  }
}

