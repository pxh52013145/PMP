import type {
  SeekCommandCoalescer,
  VolumeCommandCoalescer,
} from './audioCommandCoalescers';
import type { AudioState } from './types';

type RuntimeControlSettingsLike = {
  volumeDebounceEnabled: boolean;
};

type DynamicSrcTimingLike = {
  seekHoldMs: number;
};

export type NativeAudioTransportFacadeContext = {
  seekCoalesceMs: number;
  volumeCoalesceMs: number;
  seekCommandSeqCounter: number;
  dynamicSrcDeferredLatencyReason: string | null;
  state: AudioState;
  fallbackClockBaseTimeSec: number;
  fallbackClockStartedAtMs: number | null;
  timeUpdateCallbacks: Set<(time: number) => void>;
  seekCommandCoalescer: SeekCommandCoalescer;
  volumeCommandCoalescer: VolumeCommandCoalescer;
  invokeCommand(command: string, payload?: Record<string, unknown>): Promise<unknown>;
  fireAndForgetCommand(command: string, payload?: Record<string, unknown>): void;
  flushDeferredLatencySrcPolicy(trigger: string): void;
  getEffectiveDynamicSrcTiming(nowMs?: number): DynamicSrcTimingLike;
  withDynamicSrcHold(reason: string, holdMs: number): void;
  updateState(partial: Partial<AudioState>): AudioState;
  ensureFallbackTicker(): void;
  readRuntimeControlSettings(): RuntimeControlSettingsLike;
  notifyLatestSeekSequence(seekSeq: number | null): void;
};

export function clearPendingSeekImpl(ctx: NativeAudioTransportFacadeContext): void {
  const clearTimer = (timerId: number) => {
    if (typeof window === 'undefined') return;
    window.clearTimeout(timerId);
  };
  ctx.seekCommandCoalescer.clearPendingAndGuard({ clearTimer });
  ctx.dynamicSrcDeferredLatencyReason = null;
}

export function hasPendingSeekWorkImpl(ctx: NativeAudioTransportFacadeContext): boolean {
  return ctx.seekCommandCoalescer.hasPendingWork();
}

export function markPendingSeekGuardImpl(
  ctx: NativeAudioTransportFacadeContext,
  target: number
): void {
  if (!Number.isFinite(target)) return;
  ctx.seekCommandCoalescer.markGuard(target, ctx.state.currentTime, Date.now());
}

export function clearPendingSeekGuardImpl(ctx: NativeAudioTransportFacadeContext): void {
  ctx.seekCommandCoalescer.clearGuard();
}

export function shouldIgnoreBackendCurrentTimeImpl(
  ctx: NativeAudioTransportFacadeContext,
  nextTime: number
): boolean {
  return ctx.seekCommandCoalescer.shouldIgnoreBackendCurrentTime(nextTime, Date.now());
}

export function flushPendingSeekCommandImpl(ctx: NativeAudioTransportFacadeContext): void {
  const decision = ctx.seekCommandCoalescer.takeFlushDecision(Date.now());
  if (decision.action === 'noop') return;
  if (decision.action === 'reschedule') {
    scheduleSeekFlushImpl(ctx, decision.delayMs);
    return;
  }

  const { target, seekSeq } = decision;
  const payload: Record<string, unknown> = { time: target };
  if (typeof seekSeq === 'number' && Number.isFinite(seekSeq)) {
    payload.seekSeq = Math.max(1, Math.floor(seekSeq));
  }

  void ctx
    .invokeCommand('native_audio_seek', payload)
    .catch(() => {
      const hasQueuedSeek = ctx.seekCommandCoalescer.hasQueuedSeek();
      const isSameGuardTarget = ctx.seekCommandCoalescer.isSameGuardTarget(target);
      if (!hasQueuedSeek && isSameGuardTarget) {
        ctx.seekCommandCoalescer.clearGuard();
      }
    })
    .finally(() => {
      ctx.seekCommandCoalescer.finishDispatch();
      if (ctx.seekCommandCoalescer.hasQueuedSeek()) {
        scheduleSeekFlushImpl(ctx, 0);
        return;
      }

      ctx.flushDeferredLatencySrcPolicy('seek-settled');
    });
}

export function scheduleSeekFlushImpl(
  ctx: NativeAudioTransportFacadeContext,
  delayMs: number = ctx.seekCoalesceMs
): void {
  if (typeof window === 'undefined') {
    flushPendingSeekCommandImpl(ctx);
    return;
  }

  ctx.seekCommandCoalescer.scheduleFlush(
    delayMs,
    {
      scheduleTimer: (safeDelayMs, callback) => window.setTimeout(callback, safeDelayMs),
      clearTimer: (timerId) => window.clearTimeout(timerId),
    },
    () => flushPendingSeekCommandImpl(ctx)
  );
}

export function clearPendingVolumeImpl(ctx: NativeAudioTransportFacadeContext): void {
  const clearTimer = (timerId: number) => {
    if (typeof window === 'undefined') return;
    window.clearTimeout(timerId);
  };
  ctx.volumeCommandCoalescer.clearPending({ clearTimer });
}

export function flushPendingVolumeCommandImpl(ctx: NativeAudioTransportFacadeContext): void {
  const decision = ctx.volumeCommandCoalescer.takeFlushDecision(Date.now());
  if (decision.action === 'noop') return;
  if (decision.action === 'reschedule') {
    scheduleVolumeFlushImpl(ctx, decision.delayMs);
    return;
  }

  ctx.fireAndForgetCommand('native_audio_set_volume', { volume: decision.volume });
}

export function scheduleVolumeFlushImpl(
  ctx: NativeAudioTransportFacadeContext,
  delayMs: number = ctx.volumeCoalesceMs
): void {
  if (typeof window === 'undefined') {
    flushPendingVolumeCommandImpl(ctx);
    return;
  }

  ctx.volumeCommandCoalescer.scheduleFlush(
    delayMs,
    {
      scheduleTimer: (safeDelayMs, callback) => window.setTimeout(callback, safeDelayMs),
      clearTimer: (timerId) => window.clearTimeout(timerId),
    },
    () => flushPendingVolumeCommandImpl(ctx)
  );
}

export function seekImpl(ctx: NativeAudioTransportFacadeContext, time: number): void {
  const duration = ctx.state.duration || time;
  const clamped = Math.max(0, Math.min(time, duration));
  markPendingSeekGuardImpl(ctx, clamped);

  ctx.seekCommandSeqCounter = ctx.seekCommandSeqCounter + 1;
  const seekSeq = ctx.seekCommandSeqCounter;
  ctx.seekCommandCoalescer.queueSeek(clamped, seekSeq);
  ctx.notifyLatestSeekSequence(seekSeq);

  const effective = ctx.getEffectiveDynamicSrcTiming();
  ctx.withDynamicSrcHold('seek', effective.seekHoldMs);
  scheduleSeekFlushImpl(ctx);

  const nextState = ctx.updateState({ currentTime: clamped });
  ctx.fallbackClockBaseTimeSec = clamped;
  ctx.fallbackClockStartedAtMs =
    nextState.playbackState === 'playing' ? performance.now() : null;
  if (nextState.playbackState === 'playing') {
    ctx.ensureFallbackTicker();
  }
  ctx.timeUpdateCallbacks.forEach((callback) => callback(clamped));
}

export function setVolumeImpl(ctx: NativeAudioTransportFacadeContext, volume: number): void {
  const clamped = Math.max(0, Math.min(1, volume));
  const runtimeControlSettings = ctx.readRuntimeControlSettings();
  if (runtimeControlSettings.volumeDebounceEnabled) {
    ctx.volumeCommandCoalescer.queueVolume(clamped);
    scheduleVolumeFlushImpl(ctx);
  } else {
    clearPendingVolumeImpl(ctx);
    ctx.volumeCommandCoalescer.markImmediateDispatch(Date.now());
    ctx.fireAndForgetCommand('native_audio_set_volume', { volume: clamped });
  }
  ctx.updateState({ volume: clamped, muted: clamped === 0 ? true : ctx.state.muted });
}

