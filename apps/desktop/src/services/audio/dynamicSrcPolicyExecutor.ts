import type { NativeAudioSrcPolicy } from './nativeAudioServiceTypes';

export type DynamicSrcExecutionPlan =
  | { action: 'skip-current' }
  | { action: 'skip-pending' }
  | { action: 'defer'; delayMs: number }
  | { action: 'apply'; nowMs: number };

export type DynamicSrcExecutionInput = {
  currentPolicy: NativeAudioSrcPolicy;
  targetPolicy: NativeAudioSrcPolicy;
  nowMs: number;
  minSwitchIntervalMs: number;
};

export function isSameDynamicSrcPolicy(
  left: NativeAudioSrcPolicy,
  right: NativeAudioSrcPolicy
): boolean {
  return (
    left.srcMode === right.srcMode &&
    left.srcBackend === right.srcBackend &&
    left.srcTargetSampleRate === right.srcTargetSampleRate
  );
}

export class DynamicSrcPolicyExecutor {
  private lastApplyAtMs: number | null = null;
  private pendingPolicy: NativeAudioSrcPolicy | null = null;

  reset(): void {
    this.lastApplyAtMs = null;
    this.pendingPolicy = null;
  }

  plan(input: DynamicSrcExecutionInput): DynamicSrcExecutionPlan {
    const nowMs = Math.max(0, Math.floor(input.nowMs));
    const minSwitchIntervalMs = Math.max(0, Math.floor(input.minSwitchIntervalMs));

    if (isSameDynamicSrcPolicy(input.currentPolicy, input.targetPolicy)) {
      return { action: 'skip-current' };
    }

    if (this.pendingPolicy && isSameDynamicSrcPolicy(this.pendingPolicy, input.targetPolicy)) {
      return { action: 'skip-pending' };
    }

    if (this.lastApplyAtMs !== null) {
      const elapsedMs = nowMs - this.lastApplyAtMs;
      if (elapsedMs >= 0 && elapsedMs < minSwitchIntervalMs) {
        return {
          action: 'defer',
          delayMs: minSwitchIntervalMs - elapsedMs,
        };
      }
    }

    return {
      action: 'apply',
      nowMs,
    };
  }

  beginApply(targetPolicy: NativeAudioSrcPolicy, nowMs: number): void {
    this.pendingPolicy = { ...targetPolicy };
    this.lastApplyAtMs = Math.max(0, Math.floor(nowMs));
  }

  finishApply(targetPolicy: NativeAudioSrcPolicy): void {
    if (this.pendingPolicy && isSameDynamicSrcPolicy(this.pendingPolicy, targetPolicy)) {
      this.pendingPolicy = null;
    }
  }
}

