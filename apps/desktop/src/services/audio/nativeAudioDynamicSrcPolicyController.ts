import {
  resolveDynamicSrcDegradationTransition,
  type AudioStabilityScoreMetrics,
} from './audioStabilityController';
import {
  getDynamicSrcAdaptiveScale,
  resolveDynamicSrcAdaptiveProfile,
  resolveDynamicSrcEffectiveTiming,
  type DynamicSrcEffectiveTiming,
} from './dynamicSrcAdaptiveTiming';
import {
  DynamicSrcPolicyExecutor,
  type DynamicSrcExecutionPlan,
} from './dynamicSrcPolicyExecutor';
import type {
  AudioDynamicSrcAdaptiveProfile,
  AudioDynamicSrcAutoSettings,
  AudioDynamicSrcAutoSettingsPatch,
  AudioDynamicSrcDegradationLevel,
  PlaybackState,
} from './types';
import type {
  NativeAudioSrcPolicy,
} from './nativeAudioServiceTypes';

export type DynamicSrcPolicyProfile = 'quality' | 'latency';

export type NativeAudioDynamicSrcPolicyThresholds = {
  elevatedScoreThreshold: number;
  criticalScoreThreshold: number;
  severeUnderrunFramesThreshold: number;
  degradationL2HoldFloorMs: number;
};

export type NativeAudioDynamicSrcPolicyControllerOptions = {
  defaults: AudioDynamicSrcAutoSettings;
  thresholds: NativeAudioDynamicSrcPolicyThresholds;
  setTimeoutFn?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
};

export type DynamicSrcDegradationAction =
  | { kind: 'none' }
  | { kind: 'ensure-latency'; reason: string }
  | { kind: 'hold'; reason: string; holdMs: number }
  | { kind: 'schedule-restore' };

export type DynamicSrcHoldResult = {
  ensureLatencyReason: string | null;
  deferredLatencyReason: string | null;
};

export type DynamicSrcRestoreReadiness =
  | { action: 'restore' }
  | { action: 'schedule' }
  | { action: 'skip' };

function clampMs(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function resolveNativeAudioDynamicSrcSettingsPatch(input: {
  patch: AudioDynamicSrcAutoSettingsPatch;
  current: AudioDynamicSrcAutoSettings;
}): AudioDynamicSrcAutoSettings {
  const enabled =
    typeof input.patch.enabled === 'boolean' ? input.patch.enabled : input.current.enabled;
  const adaptiveEnabled =
    typeof input.patch.adaptiveEnabled === 'boolean'
      ? input.patch.adaptiveEnabled
      : input.current.adaptiveEnabled;
  const learningEnabled =
    typeof input.patch.learningEnabled === 'boolean'
      ? input.patch.learningEnabled
      : input.current.learningEnabled;

  return {
    enabled,
    adaptiveEnabled,
    learningEnabled,
    restoreDebounceMs: clampMs(
      input.patch.restoreDebounceMs,
      input.current.restoreDebounceMs,
      500,
      30_000
    ),
    minSwitchIntervalMs: clampMs(
      input.patch.minSwitchIntervalMs,
      input.current.minSwitchIntervalMs,
      100,
      10_000
    ),
    seekHoldMs: clampMs(input.patch.seekHoldMs, input.current.seekHoldMs, 500, 20_000),
    underrunHoldMs: clampMs(
      input.patch.underrunHoldMs,
      input.current.underrunHoldMs,
      2_000,
      120_000
    ),
    sharedStressHoldMs: clampMs(
      input.patch.sharedStressHoldMs,
      input.current.sharedStressHoldMs,
      1_000,
      90_000
    ),
    outputErrorHoldMs: clampMs(
      input.patch.outputErrorHoldMs,
      input.current.outputErrorHoldMs,
      1_000,
      120_000
    ),
  };
}

export class NativeAudioDynamicSrcPolicyController {
  private settings: AudioDynamicSrcAutoSettings;
  private policyProfile: DynamicSrcPolicyProfile = 'quality';
  private degradationLevel: AudioDynamicSrcDegradationLevel = 0;
  private degradationReason: string | null = null;
  private degradationLastChangedAtMs: number | null = null;
  private lastSwitchAtMs: number | null = null;
  private lastSwitchReason: string | null = null;
  private holdUntilMs = 0;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly policyExecutor = new DynamicSrcPolicyExecutor();
  private manualLock = false;
  private qualityPolicy: NativeAudioSrcPolicy = {
    srcMode: 'match-output',
    srcBackend: 'rubato',
    srcTargetSampleRate: null,
  };
  private deferredLatencyReason: string | null = null;
  private adaptiveProfile: AudioDynamicSrcAdaptiveProfile = 'baseline';

  constructor(private readonly options: NativeAudioDynamicSrcPolicyControllerOptions) {
    this.settings = { ...options.defaults };
  }

  getSettings(): AudioDynamicSrcAutoSettings {
    return { ...this.settings };
  }

  applySettings(settings: AudioDynamicSrcAutoSettings): void {
    this.settings = { ...settings };
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }

  set enabled(value: boolean) {
    this.settings = { ...this.settings, enabled: value };
  }

  get adaptiveEnabled(): boolean {
    return this.settings.adaptiveEnabled;
  }

  set adaptiveEnabled(value: boolean) {
    this.settings = { ...this.settings, adaptiveEnabled: value };
  }

  get learningEnabled(): boolean {
    return this.settings.learningEnabled;
  }

  set learningEnabled(value: boolean) {
    this.settings = { ...this.settings, learningEnabled: value };
  }

  get restoreDebounceMs(): number {
    return this.settings.restoreDebounceMs;
  }

  set restoreDebounceMs(value: number) {
    this.settings = { ...this.settings, restoreDebounceMs: value };
  }

  get minSwitchIntervalMs(): number {
    return this.settings.minSwitchIntervalMs;
  }

  set minSwitchIntervalMs(value: number) {
    this.settings = { ...this.settings, minSwitchIntervalMs: value };
  }

  get seekHoldMs(): number {
    return this.settings.seekHoldMs;
  }

  set seekHoldMs(value: number) {
    this.settings = { ...this.settings, seekHoldMs: value };
  }

  get underrunHoldMs(): number {
    return this.settings.underrunHoldMs;
  }

  set underrunHoldMs(value: number) {
    this.settings = { ...this.settings, underrunHoldMs: value };
  }

  get sharedStressHoldMs(): number {
    return this.settings.sharedStressHoldMs;
  }

  set sharedStressHoldMs(value: number) {
    this.settings = { ...this.settings, sharedStressHoldMs: value };
  }

  get outputErrorHoldMs(): number {
    return this.settings.outputErrorHoldMs;
  }

  set outputErrorHoldMs(value: number) {
    this.settings = { ...this.settings, outputErrorHoldMs: value };
  }

  get profile(): DynamicSrcPolicyProfile {
    return this.policyProfile;
  }

  set profile(value: DynamicSrcPolicyProfile) {
    this.policyProfile = value;
  }

  get autoDegradationLevel(): AudioDynamicSrcDegradationLevel {
    return this.degradationLevel;
  }

  set autoDegradationLevel(value: AudioDynamicSrcDegradationLevel) {
    this.degradationLevel = value;
  }

  get autoDegradationReason(): string | null {
    return this.degradationReason;
  }

  set autoDegradationReason(value: string | null) {
    this.degradationReason = value;
  }

  get autoDegradationLastChangedAtMs(): number | null {
    return this.degradationLastChangedAtMs;
  }

  set autoDegradationLastChangedAtMs(value: number | null) {
    this.degradationLastChangedAtMs = value;
  }

  get lastPolicySwitchAtMs(): number | null {
    return this.lastSwitchAtMs;
  }

  get lastPolicySwitchReason(): string | null {
    return this.lastSwitchReason;
  }

  set lastPolicySwitchReason(value: string | null) {
    this.lastSwitchReason = value;
  }

  get holdUntil(): number {
    return this.holdUntilMs;
  }

  set holdUntil(value: number) {
    this.holdUntilMs = value;
  }

  get manualLockActive(): boolean {
    return this.manualLock;
  }

  set manualLockActive(value: boolean) {
    this.manualLock = value;
  }

  get currentQualityPolicy(): NativeAudioSrcPolicy {
    return { ...this.qualityPolicy };
  }

  set currentQualityPolicy(policy: NativeAudioSrcPolicy) {
    this.qualityPolicy = { ...policy };
  }

  get deferredLatency(): string | null {
    return this.deferredLatencyReason;
  }

  set deferredLatency(value: string | null) {
    this.deferredLatencyReason = value;
  }

  get currentAdaptiveProfile(): AudioDynamicSrcAdaptiveProfile {
    return this.adaptiveProfile;
  }

  set currentAdaptiveProfile(value: AudioDynamicSrcAdaptiveProfile) {
    this.adaptiveProfile = value;
  }

  resolveAdaptiveProfile(stressScore: number): AudioDynamicSrcAdaptiveProfile {
    return resolveDynamicSrcAdaptiveProfile({
      adaptiveEnabled: this.settings.adaptiveEnabled,
      stressScore,
      elevatedScoreThreshold: this.options.thresholds.elevatedScoreThreshold,
      criticalScoreThreshold: this.options.thresholds.criticalScoreThreshold,
    });
  }

  getEffectiveTiming(input: {
    stressScore: number;
    learningScale: number;
  }): DynamicSrcEffectiveTiming {
    return resolveDynamicSrcEffectiveTiming({
      adaptiveEnabled: this.settings.adaptiveEnabled,
      stressScore: input.stressScore,
      learningScale: input.learningScale,
      elevatedScoreThreshold: this.options.thresholds.elevatedScoreThreshold,
      criticalScoreThreshold: this.options.thresholds.criticalScoreThreshold,
      base: {
        restoreDebounceMs: this.settings.restoreDebounceMs,
        minSwitchIntervalMs: this.settings.minSwitchIntervalMs,
        seekHoldMs: this.settings.seekHoldMs,
        underrunHoldMs: this.settings.underrunHoldMs,
        sharedStressHoldMs: this.settings.sharedStressHoldMs,
        outputErrorHoldMs: this.settings.outputErrorHoldMs,
      },
    });
  }

  evaluateAutoDegradation(input: {
    nowMs: number;
    triggerActions?: boolean;
    stressScore?: number;
    lastUnderrunFrames: number;
    metrics: AudioStabilityScoreMetrics;
    effectiveTiming?: DynamicSrcEffectiveTiming;
  }): DynamicSrcDegradationAction {
    const transition = resolveDynamicSrcDegradationTransition({
      previousState: {
        level: this.degradationLevel,
        reason: this.degradationReason,
      },
      autoEnabled: this.settings.enabled,
      manualLockActive: this.manualLock,
      stressScoreOverride: input.stressScore,
      lastUnderrunFrames: input.lastUnderrunFrames,
      severeUnderrunFramesThreshold: this.options.thresholds.severeUnderrunFramesThreshold,
      elevatedScoreThreshold: this.options.thresholds.elevatedScoreThreshold,
      criticalScoreThreshold: this.options.thresholds.criticalScoreThreshold,
      metrics: input.metrics,
    });

    if (!transition.changed) {
      return { kind: 'none' };
    }

    const previousLevel = this.degradationLevel;
    this.degradationLevel = transition.nextState.level;
    this.degradationReason = transition.nextState.reason;
    this.degradationLastChangedAtMs = input.nowMs;

    if (!input.triggerActions) {
      return { kind: 'none' };
    }

    if (transition.nextState.level === 1 && previousLevel < 1) {
      return {
        kind: 'ensure-latency',
        reason: `auto-degradation:l1:${transition.nextState.reason ?? 'stress'}`,
      };
    }

    if (transition.nextState.level === 2 && previousLevel < 2) {
      const effective = input.effectiveTiming;
      const holdMs = Math.max(
        this.options.thresholds.degradationL2HoldFloorMs,
        effective?.underrunHoldMs ?? this.settings.underrunHoldMs,
        effective?.sharedStressHoldMs ?? this.settings.sharedStressHoldMs
      );
      return {
        kind: 'hold',
        reason: `auto-degradation:l2:${transition.nextState.reason ?? 'stress'}`,
        holdMs,
      };
    }

    if (transition.nextState.level === 0 && previousLevel > 0) {
      return { kind: 'schedule-restore' };
    }

    return { kind: 'none' };
  }

  clearRestoreTimer(): void {
    if (this.restoreTimer === null) return;
    const clearTimeoutFn = this.options.clearTimeoutFn ?? clearTimeout;
    clearTimeoutFn(this.restoreTimer);
    this.restoreTimer = null;
  }

  scheduleRestoreEvaluation(input: {
    minDelayMs?: number;
    nowMs: number;
    effectiveTiming: DynamicSrcEffectiveTiming;
    onRestore: () => void;
  }): number {
    this.clearRestoreTimer();
    const holdRemaining = Math.max(0, this.holdUntilMs - input.nowMs);
    const sanitizedMinDelayMs = Math.max(0, Math.floor(input.minDelayMs ?? 0));
    const delayMs = Math.max(
      input.effectiveTiming.restoreDebounceMs,
      holdRemaining,
      sanitizedMinDelayMs
    );

    const setTimeoutFn = this.options.setTimeoutFn ?? setTimeout;
    this.restoreTimer = setTimeoutFn(() => {
      this.restoreTimer = null;
      input.onRestore();
    }, delayMs);
    return delayMs;
  }

  withHold(input: {
    reason: string;
    holdMs: number;
    nowMs: number;
    effectiveTiming: DynamicSrcEffectiveTiming;
    hasPendingSeekWork: boolean;
  }): DynamicSrcHoldResult {
    const safeHoldMs = Math.max(1000, Math.floor(input.holdMs));
    const adaptiveHoldMs = Math.max(
      1000,
      Math.floor(safeHoldMs * getDynamicSrcAdaptiveScale(input.effectiveTiming.profile))
    );
    this.holdUntilMs = Math.max(this.holdUntilMs, input.nowMs + safeHoldMs);
    this.holdUntilMs = Math.max(this.holdUntilMs, input.nowMs + adaptiveHoldMs);
    this.lastSwitchReason = input.reason;
    this.adaptiveProfile = input.effectiveTiming.profile;

    if (input.reason === 'seek' && input.hasPendingSeekWork) {
      this.deferredLatencyReason = input.reason;
      return {
        ensureLatencyReason: null,
        deferredLatencyReason: input.reason,
      };
    }

    this.deferredLatencyReason = null;
    return {
      ensureLatencyReason: input.reason,
      deferredLatencyReason: null,
    };
  }

  flushDeferredLatencyPolicy(input: {
    trigger: string;
    hasPendingSeekWork: boolean;
  }): string | null {
    const deferredReason = this.deferredLatencyReason;
    if (!deferredReason) return null;
    if (input.hasPendingSeekWork) return null;

    this.deferredLatencyReason = null;
    return `${deferredReason}:${input.trigger}`;
  }

  planPolicyApply(input: {
    currentPolicy: NativeAudioSrcPolicy;
    targetPolicy: NativeAudioSrcPolicy;
    nowMs: number;
    minSwitchIntervalMs: number;
    profile: DynamicSrcPolicyProfile;
  }): DynamicSrcExecutionPlan {
    const plan = this.policyExecutor.plan({
      currentPolicy: input.currentPolicy,
      targetPolicy: input.targetPolicy,
      nowMs: input.nowMs,
      minSwitchIntervalMs: input.minSwitchIntervalMs,
    });

    if (plan.action === 'skip-current' || plan.action === 'skip-pending') {
      this.policyProfile = input.profile;
    }

    return plan;
  }

  beginPolicyApply(target: NativeAudioSrcPolicy, nowMs: number): void {
    this.policyExecutor.beginApply(target, nowMs);
  }

  markPolicyApplied(input: {
    profile: DynamicSrcPolicyProfile;
    reason: string;
    appliedAtMs: number;
  }): void {
    this.policyProfile = input.profile;
    this.lastSwitchAtMs = input.appliedAtMs;
    this.lastSwitchReason = input.reason;
  }

  finishPolicyApply(target: NativeAudioSrcPolicy): void {
    this.policyExecutor.finishApply(target);
  }

  canEnsureLatency(): boolean {
    return this.settings.enabled && !this.manualLock;
  }

  getRestoreReadiness(input: {
    nowMs: number;
    underrunRecoveryUntilMs: number;
    protectionWindowActive: boolean;
    sharedStressWindowActive: boolean;
    playbackState: PlaybackState;
  }): DynamicSrcRestoreReadiness {
    if (!this.settings.enabled) return { action: 'skip' };
    if (this.manualLock) return { action: 'skip' };
    if (input.nowMs < this.holdUntilMs) return { action: 'schedule' };
    if (input.underrunRecoveryUntilMs > input.nowMs) return { action: 'schedule' };
    if (input.protectionWindowActive || input.sharedStressWindowActive) {
      return { action: 'schedule' };
    }
    if (input.playbackState === 'buffering' || input.playbackState === 'loading') {
      return { action: 'schedule' };
    }
    return { action: 'restore' };
  }

  disableAuto(): void {
    this.policyProfile = 'quality';
    this.adaptiveProfile = 'baseline';
    this.holdUntilMs = 0;
    this.clearRestoreTimer();
  }

  enableAuto(input: {
    currentQualityPolicy: NativeAudioSrcPolicy;
    stressScore: number;
  }): void {
    this.manualLock = false;
    this.qualityPolicy = { ...input.currentQualityPolicy };
    this.policyProfile = 'quality';
    this.adaptiveProfile = this.resolveAdaptiveProfile(input.stressScore);
    this.lastSwitchReason = 'dynamic-src-enabled';
  }

  lockManualQualityPolicy(policy: NativeAudioSrcPolicy): void {
    this.manualLock = true;
    this.qualityPolicy = { ...policy };
    this.policyProfile = 'quality';
    this.holdUntilMs = 0;
    this.clearRestoreTimer();
  }

  resetRuntimePolicy(): void {
    this.clearRestoreTimer();
    this.holdUntilMs = 0;
    this.degradationLevel = 0;
    this.degradationReason = null;
    this.degradationLastChangedAtMs = null;
    this.deferredLatencyReason = null;
    this.policyExecutor.reset();
  }

  dispose(): void {
    this.resetRuntimePolicy();
  }
}
