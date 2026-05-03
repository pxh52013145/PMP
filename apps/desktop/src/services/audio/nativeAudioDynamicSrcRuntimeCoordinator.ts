import {
  computeDynamicSrcStressScore,
  type AudioStabilityScoreMetrics,
} from './audioStabilityController';
import type { DynamicSrcEffectiveTiming } from './dynamicSrcAdaptiveTiming';
import {
  buildDynamicSrcLearningDeviceKey as buildLearningDeviceKey,
} from './nativeAudioDynamicSrcLearning';
import type { NativeAudioDynamicSrcLearningController } from './nativeAudioDynamicSrcLearningController';
import type { NativeAudioDynamicSrcPolicyController } from './nativeAudioDynamicSrcPolicyController';

export type NativeAudioDynamicSrcRuntimeState = Omit<
  AudioStabilityScoreMetrics,
  'nowMs' | 'protectionWindowActive' | 'sharedStressWindowActive'
> & {
  lastUnderrunFrames: number;
  outputBackendId: string | null;
  outputDeviceId: string | null;
  outputDeviceName: string | null;
};

export type NativeAudioDynamicSrcRuntimeCoordinatorHost = {
  getRuntimeState(): NativeAudioDynamicSrcRuntimeState;
  hasActiveProtectionWindow(nowMs: number): boolean;
  hasActiveSharedStressWindow(nowMs: number): boolean;
  hasPendingSeekWork(): boolean;
  ensureLatencySrcPolicy(reason: string): Promise<void> | void;
  restoreQualitySrcPolicy(reason: string): Promise<boolean> | boolean;
};

export type NativeAudioDynamicSrcRuntimeCoordinatorOptions = {
  policyController: NativeAudioDynamicSrcPolicyController;
  learningController: NativeAudioDynamicSrcLearningController;
  host: NativeAudioDynamicSrcRuntimeCoordinatorHost;
};

export class NativeAudioDynamicSrcRuntimeCoordinator {
  private readonly policyController: NativeAudioDynamicSrcPolicyController;
  private readonly learningController: NativeAudioDynamicSrcLearningController;
  private readonly host: NativeAudioDynamicSrcRuntimeCoordinatorHost;

  constructor(options: NativeAudioDynamicSrcRuntimeCoordinatorOptions) {
    this.policyController = options.policyController;
    this.learningController = options.learningController;
    this.host = options.host;
  }

  buildDynamicSrcStabilityMetrics(nowMs: number = Date.now()): AudioStabilityScoreMetrics {
    const state = this.host.getRuntimeState();
    return {
      playbackState: state.playbackState,
      underrunRecoveryUntilMs: state.underrunRecoveryUntilMs,
      nowMs,
      protectionWindowActive: this.host.hasActiveProtectionWindow(nowMs),
      sharedStressWindowActive: this.host.hasActiveSharedStressWindow(nowMs),
      outputCallbackMetricsValid: state.outputCallbackMetricsValid,
      outputWaitTimeoutCount: state.outputWaitTimeoutCount,
      outputRenderUnderrunEvents: state.outputRenderUnderrunEvents,
      outputCallbackIntervalOverrunCount: state.outputCallbackIntervalOverrunCount,
      outputCallbackIntervalJitterP99Us: state.outputCallbackIntervalJitterP99Us,
      transferMetricsValid: state.transferMetricsValid,
      transferRenderLowHitCount: state.transferRenderLowHitCount,
      transferDecodeLowHitCount: state.transferDecodeLowHitCount,
      renderQueuePageLocked: state.renderQueuePageLocked,
      sharedRenderAheadEnabled: state.sharedRenderAheadEnabled,
      sharedRenderUnderrunEvents: state.sharedRenderUnderrunEvents,
      sharedRenderLowHitCount: state.sharedRenderLowHitCount,
    };
  }

  getDynamicSrcStressScore(nowMs: number = Date.now()): number {
    return computeDynamicSrcStressScore(this.buildDynamicSrcStabilityMetrics(nowMs));
  }

  buildDynamicSrcLearningDeviceKey(): string {
    const state = this.host.getRuntimeState();
    return buildLearningDeviceKey(
      state.outputBackendId,
      state.outputDeviceId,
      state.outputDeviceName
    );
  }

  updateDynamicSrcLearningFromStress(stressScore: number, nowMs: number = Date.now()): void {
    this.learningController.updateFromStress({
      enabled: this.policyController.learningEnabled,
      deviceKey: this.buildDynamicSrcLearningDeviceKey(),
      stressScore,
      nowMs,
    });
  }

  getDynamicSrcLearningScale(): number {
    return this.learningController.getScale({
      enabled: this.policyController.learningEnabled,
      deviceKey: this.buildDynamicSrcLearningDeviceKey(),
    });
  }

  getEffectiveDynamicSrcTiming(nowMs: number = Date.now()): DynamicSrcEffectiveTiming {
    const stressScore = this.getDynamicSrcStressScore(nowMs);
    return this.policyController.getEffectiveTiming({
      stressScore,
      learningScale: this.getDynamicSrcLearningScale(),
    });
  }

  evaluateDynamicSrcAutoDegradation(options?: {
    nowMs?: number;
    triggerActions?: boolean;
    stressScore?: number;
  }): void {
    const nowMs = options?.nowMs ?? Date.now();
    const state = this.host.getRuntimeState();
    const action = this.policyController.evaluateAutoDegradation({
      nowMs,
      triggerActions: options?.triggerActions,
      stressScore: options?.stressScore,
      lastUnderrunFrames: state.lastUnderrunFrames,
      metrics: this.buildDynamicSrcStabilityMetrics(nowMs),
      effectiveTiming: options?.triggerActions
        ? this.getEffectiveDynamicSrcTiming(nowMs)
        : undefined,
    });

    if (action.kind === 'none') {
      return;
    }

    if (action.kind === 'ensure-latency') {
      void this.host.ensureLatencySrcPolicy(action.reason);
      return;
    }

    if (action.kind === 'hold') {
      this.withDynamicSrcHold(action.reason, action.holdMs);
      return;
    }

    if (action.kind === 'schedule-restore') {
      this.scheduleDynamicSrcRestoreEvaluation();
    }
  }

  clearDynamicSrcRestoreTimer(): void {
    this.policyController.clearRestoreTimer();
  }

  scheduleDynamicSrcRestoreEvaluation(minDelayMs: number = 0): number {
    const nowMs = Date.now();
    return this.policyController.scheduleRestoreEvaluation({
      minDelayMs,
      nowMs,
      effectiveTiming: this.getEffectiveDynamicSrcTiming(nowMs),
      onRestore: () => {
        void this.maybeRestoreQualitySrc('stable-window');
      },
    });
  }

  withDynamicSrcHold(reason: string, holdMs: number): void {
    const nowMs = Date.now();
    const hold = this.policyController.withHold({
      reason,
      holdMs,
      nowMs,
      effectiveTiming: this.getEffectiveDynamicSrcTiming(nowMs),
      hasPendingSeekWork: this.host.hasPendingSeekWork(),
    });
    if (hold.ensureLatencyReason) {
      void this.host.ensureLatencySrcPolicy(hold.ensureLatencyReason);
    }
    this.scheduleDynamicSrcRestoreEvaluation();
  }

  flushDeferredLatencySrcPolicy(trigger: string): void {
    const reason = this.policyController.flushDeferredLatencyPolicy({
      trigger,
      hasPendingSeekWork: this.host.hasPendingSeekWork(),
    });
    if (!reason) return;
    void this.host.ensureLatencySrcPolicy(reason);
  }

  async maybeRestoreQualitySrc(reason: string): Promise<void> {
    const nowMs = Date.now();
    const state = this.host.getRuntimeState();
    const readiness = this.policyController.getRestoreReadiness({
      nowMs,
      underrunRecoveryUntilMs: state.underrunRecoveryUntilMs,
      protectionWindowActive: this.host.hasActiveProtectionWindow(nowMs),
      sharedStressWindowActive: this.host.hasActiveSharedStressWindow(nowMs),
      playbackState: state.playbackState,
    });
    if (readiness.action === 'skip') return;
    if (readiness.action === 'schedule') {
      this.scheduleDynamicSrcRestoreEvaluation();
      return;
    }

    const restored = await this.host.restoreQualitySrcPolicy(reason);
    if (!restored && this.policyController.profile !== 'quality') {
      this.scheduleDynamicSrcRestoreEvaluation();
    }
  }
}
