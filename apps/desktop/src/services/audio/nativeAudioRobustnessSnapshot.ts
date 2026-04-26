import { getAudioPerformanceTelemetrySnapshot } from './audioPerformanceTelemetry';
import type { DynamicSrcEffectiveTiming } from './dynamicSrcAdaptiveTiming';
import { toDynamicSrcAutoDegradationLabel } from './robustnessDegradation';
import type { AudioRobustnessSnapshot, AudioState } from './types';
import type { ProcessWorkingSetTrimEvent } from '../../utils/processWorkingSetTrim';

type NativeAudioRobustnessSnapshotSourceRecord = {
  currentOutputBackendId: AudioRobustnessSnapshot['outputBackendId'];
  availableOutputBackends: AudioRobustnessSnapshot['outputBackends'];
  lastSchedulerProfile?: AudioRobustnessSnapshot['schedulerProfile'];
  stabilityProfile?: AudioRobustnessSnapshot['stabilityProfile'];
  stabilityActionProfile?: AudioRobustnessSnapshot['stabilityActionProfile'];
  sourcePrepareProfile?: AudioRobustnessSnapshot['sourcePrepareProfile'];
  stabilityPrimaryReason?: AudioRobustnessSnapshot['stabilityPrimaryReason'];
  stabilityReasonCodes?: AudioRobustnessSnapshot['stabilityReasonCodes'];
  stabilityHintProfile?: AudioRobustnessSnapshot['stabilityHintProfile'];
  stabilityHintPrimaryReason?: AudioRobustnessSnapshot['stabilityHintPrimaryReason'];
  stabilityHintReasonCodes?: AudioRobustnessSnapshot['stabilityHintReasonCodes'];
  transportMode?: AudioRobustnessSnapshot['transportMode'];
  hqSrcPhaseMode?: AudioRobustnessSnapshot['hqSrcPhaseMode'];
  srcMode?: AudioRobustnessSnapshot['srcMode'];
  srcBackend?: AudioRobustnessSnapshot['srcBackend'];
  srcTargetSampleRate?: AudioRobustnessSnapshot['srcTargetSampleRate'];
  outputQuantizationMode?: AudioRobustnessSnapshot['outputQuantizationMode'];
  dynamicSrcAutoEnabled?: AudioRobustnessSnapshot['dynamicSrcAutoEnabled'];
  dynamicSrcProfile?: AudioRobustnessSnapshot['dynamicSrcProfile'];
  dynamicSrcLastSwitchAtMs?: AudioRobustnessSnapshot['dynamicSrcLastSwitchAtMs'];
  dynamicSrcLastSwitchReason?: AudioRobustnessSnapshot['dynamicSrcLastSwitchReason'];
  dynamicSrcHoldUntilMs: number;
  dynamicSrcManualLockActive?: AudioRobustnessSnapshot['dynamicSrcManualLockActive'];
  dynamicSrcAdaptiveEnabled?: AudioRobustnessSnapshot['dynamicSrcAdaptiveEnabled'];
  dynamicSrcAdaptiveProfile?: AudioRobustnessSnapshot['dynamicSrcAdaptiveProfile'];
  dynamicSrcAutoDegradationLevel?: AudioRobustnessSnapshot['dynamicSrcAutoDegradationLevel'];
  dynamicSrcAutoDegradationReason?: AudioRobustnessSnapshot['dynamicSrcAutoDegradationReason'];
  dynamicSrcAutoDegradationLastChangedAtMs?: AudioRobustnessSnapshot['dynamicSrcAutoDegradationLastChangedAtMs'];
  dynamicSrcLearningEnabled?: AudioRobustnessSnapshot['dynamicSrcLearningEnabled'];
  dynamicSrcRestoreDebounceMs?: AudioRobustnessSnapshot['dynamicSrcRestoreDebounceMs'];
  dynamicSrcMinSwitchIntervalMs?: AudioRobustnessSnapshot['dynamicSrcMinSwitchIntervalMs'];
  dynamicSrcSeekHoldMs?: AudioRobustnessSnapshot['dynamicSrcSeekHoldMs'];
  dynamicSrcUnderrunHoldMs?: AudioRobustnessSnapshot['dynamicSrcUnderrunHoldMs'];
  dynamicSrcSharedStressHoldMs?: AudioRobustnessSnapshot['dynamicSrcSharedStressHoldMs'];
  dynamicSrcOutputErrorHoldMs?: AudioRobustnessSnapshot['dynamicSrcOutputErrorHoldMs'];
  tuningAutoEnabled?: AudioRobustnessSnapshot['tuningAutoEnabled'];
  tuningAutoTickIntervalMs?: AudioRobustnessSnapshot['tuningAutoTickIntervalMs'];
  tuningAutoStableWindowMs?: AudioRobustnessSnapshot['tuningAutoStableWindowMs'];
  tuningAutoMinSwitchIntervalMs?: AudioRobustnessSnapshot['tuningAutoMinSwitchIntervalMs'];
  tuningAutoPostSwitchObserveWindowMs?: AudioRobustnessSnapshot['tuningAutoPostSwitchObserveWindowMs'];
  tuningAutoElevatedStressScore?: AudioRobustnessSnapshot['tuningAutoElevatedStressScore'];
  tuningAutoCriticalStressScore?: AudioRobustnessSnapshot['tuningAutoCriticalStressScore'];
  tuningAutoCriticalUnderrunEventsWindow?: AudioRobustnessSnapshot['tuningAutoCriticalUnderrunEventsWindow'];
  tuningAutoCriticalOverflowGrowthTicks?: AudioRobustnessSnapshot['tuningAutoCriticalOverflowGrowthTicks'];
  tuningAutoLastReason?: AudioRobustnessSnapshot['tuningAutoLastReason'];
  tuningAutoLastAppliedAtMs?: AudioRobustnessSnapshot['tuningAutoLastAppliedAtMs'];
  tuningAutoControllerState: {
    criticalOverflowGrowthStreak: NonNullable<AudioRobustnessSnapshot['tuningAutoCriticalOverflowGrowthStreak']>;
    activeProfile: NonNullable<AudioRobustnessSnapshot['tuningAutoActiveProfile']>;
    stableSinceMs: NonNullable<AudioRobustnessSnapshot['tuningAutoStableSinceMs']>;
    lastSwitchAtMs: NonNullable<AudioRobustnessSnapshot['tuningAutoLastSwitchAtMs']>;
  };
  hqSrcStopbandDb?: AudioRobustnessSnapshot['hqSrcStopbandDb'];
  hqSrcActive?: AudioRobustnessSnapshot['hqSrcActive'];
  hqSrcRatio?: AudioRobustnessSnapshot['hqSrcRatio'];
  sourceSampleRate?: AudioRobustnessSnapshot['sourceSampleRate'];
  outputSampleRate?: AudioRobustnessSnapshot['outputSampleRate'];
  transportExactInt32Container?: AudioRobustnessSnapshot['transportExactInt32Container'];
  outputCallbackMetricsValid?: AudioRobustnessSnapshot['outputCallbackMetricsValid'];
  lastUnderrunEvents: AudioRobustnessSnapshot['underrunEvents'];
  lastUnderrunFrames: AudioRobustnessSnapshot['underrunFrames'];
  underrunSpikeTimestampsMs: number[];
  protectionWindowRefCount: AudioRobustnessSnapshot['protectionRefCount'];
  autoBackendSwitchCount: AudioRobustnessSnapshot['autoSwitchCount'];
  lastAutoBackendSwitchAtMs: AudioRobustnessSnapshot['lastAutoSwitchAtMs'];
  lastAutoBackendSwitchReason: AudioRobustnessSnapshot['lastAutoSwitchReason'];
  bufferedAheadMinSeconds: AudioRobustnessSnapshot['bufferedAheadMinSeconds'];
  rebufferCount: AudioRobustnessSnapshot['rebufferCount'];
  outputCallbackP99Us?: AudioRobustnessSnapshot['outputCallbackP99Us'];
  outputWaitTimeoutCount?: AudioRobustnessSnapshot['outputWaitTimeoutCount'];
  outputRenderUnderrunEvents?: AudioRobustnessSnapshot['outputRenderUnderrunEvents'];
  outputRenderUnderrunFrames?: AudioRobustnessSnapshot['outputRenderUnderrunFrames'];
  outputCallbackIntervalJitterP99Us?: AudioRobustnessSnapshot['outputCallbackIntervalJitterP99Us'];
  outputCallbackIntervalOverrunCount?: AudioRobustnessSnapshot['outputCallbackIntervalOverrunCount'];
  outputCallbackExpectedIntervalUs?: AudioRobustnessSnapshot['outputCallbackExpectedIntervalUs'];
  transferLowWatermarkSamples?: AudioRobustnessSnapshot['transferLowWatermarkSamples'];
  transferRenderLowHitCount?: AudioRobustnessSnapshot['transferRenderLowHitCount'];
  transferDecodeLowHitCount?: AudioRobustnessSnapshot['transferDecodeLowHitCount'];
  transferAdaptationLevel?: AudioRobustnessSnapshot['transferAdaptationLevel'];
  transferOscillationStreak?: AudioRobustnessSnapshot['transferOscillationStreak'];
  renderQueuePageLocked?: AudioRobustnessSnapshot['renderQueuePageLocked'];
  renderQueuePageLockFailureCount?: AudioRobustnessSnapshot['renderQueuePageLockFailureCount'];
  renderQueuePageLockAttemptedBytes?: AudioRobustnessSnapshot['renderQueuePageLockAttemptedBytes'];
  renderQueuePageLockSucceededBytes?: AudioRobustnessSnapshot['renderQueuePageLockSucceededBytes'];
  renderQueuePageLockFailedBytes?: AudioRobustnessSnapshot['renderQueuePageLockFailedBytes'];
  transferMetricsValid?: AudioRobustnessSnapshot['transferMetricsValid'];
  sharedRenderAheadEnabled?: AudioRobustnessSnapshot['sharedRenderAheadEnabled'];
  sharedRenderUnderrunEvents?: AudioRobustnessSnapshot['sharedRenderUnderrunEvents'];
  sharedRenderUnderrunFrames?: AudioRobustnessSnapshot['sharedRenderUnderrunFrames'];
  sharedRenderLowHitCount?: AudioRobustnessSnapshot['sharedRenderLowHitCount'];
  sharedRenderLowWatermarkSamples?: AudioRobustnessSnapshot['sharedRenderLowWatermarkSamples'];
  memoryPoolF32GrowthEvents?: AudioRobustnessSnapshot['memoryPoolF32GrowthEvents'];
  memoryPoolF32GrowthBytes?: AudioRobustnessSnapshot['memoryPoolF32GrowthBytes'];
  memoryPoolF32PrewarmHits?: AudioRobustnessSnapshot['memoryPoolF32PrewarmHits'];
  realtimeMemoryLockAttemptedBytes?: AudioRobustnessSnapshot['realtimeMemoryLockAttemptedBytes'];
  realtimeMemoryLockSucceededBytes?: AudioRobustnessSnapshot['realtimeMemoryLockSucceededBytes'];
  realtimeMemoryLockFailedBytes?: AudioRobustnessSnapshot['realtimeMemoryLockFailedBytes'];
  realtimeMemoryLockSkippedBytes?: AudioRobustnessSnapshot['realtimeMemoryLockSkippedBytes'];
  realtimeMemoryLockFailureCount?: AudioRobustnessSnapshot['realtimeMemoryLockFailureCount'];
  realtimeMemoryLockSkippedCount?: AudioRobustnessSnapshot['realtimeMemoryLockSkippedCount'];
  realtimeMemoryLockedRoleMask?: AudioRobustnessSnapshot['realtimeMemoryLockedRoleMask'];
  realtimeMemoryFailedRoleMask?: AudioRobustnessSnapshot['realtimeMemoryFailedRoleMask'];
  realtimeMemorySkippedRoleMask?: AudioRobustnessSnapshot['realtimeMemorySkippedRoleMask'];
  realtimeMemoryPressureEvents?: AudioRobustnessSnapshot['realtimeMemoryPressureEvents'];
  controlQueueLockFree?: AudioRobustnessSnapshot['controlQueueLockFree'];
  controlQueueMode?: AudioRobustnessSnapshot['controlQueueMode'];
  controlQueueCapacity?: AudioRobustnessSnapshot['controlQueueCapacity'];
  controlQueueOverwriteEvents?: AudioRobustnessSnapshot['controlQueueOverwriteEvents'];
  controlQueueDropNewestEvents?: AudioRobustnessSnapshot['controlQueueDropNewestEvents'];
  controlQueueCoalescedOverflowEvents?: AudioRobustnessSnapshot['controlQueueCoalescedOverflowEvents'];
  controlQueueCriticalOverflowEvents?: AudioRobustnessSnapshot['controlQueueCriticalOverflowEvents'];
  estimatedAudioBufferBytes?: AudioRobustnessSnapshot['estimatedAudioBufferBytes'];
  diagnosticTimelineDroppedEvents?: AudioRobustnessSnapshot['diagnosticTimelineDroppedEvents'];
  diagnosticTimeline: NonNullable<AudioRobustnessSnapshot['diagnosticTimeline']>;
  protectionWindowReason: string | null;
  sharedStressReason: string | null;
};

export type NativeAudioRobustnessSnapshotSource = {
  pruneUnderrunSpikeWindow(nowMs: number): void;
  getEffectiveDynamicSrcTiming(nowMs: number): DynamicSrcEffectiveTiming;
  evaluateDynamicSrcAutoDegradation(options: {
    nowMs: number;
    stressScore: number;
    triggerActions: boolean;
  }): void;
  buildDynamicSrcLearningDeviceKey(): string;
  getDynamicSrcLearningScale(): number;
  hasActiveProtectionWindow(nowMs: number): boolean;
  hasActiveSharedStressWindow(nowMs: number): boolean;
  state: AudioState;
  bufferedAheadRollingWindow: number[];
  bufferedAheadRollingSum: number;
  underrunRecoveryUntilMs: number;
  dynamicSrcAdaptiveProfile: DynamicSrcEffectiveTiming['profile'];
  dynamicSrcLearningProfile: Record<string, { stressIndex: number } | undefined>;
  lastWorkingSetTrimEvent: ProcessWorkingSetTrimEvent | null;
};

export function buildNativeAudioRobustnessSnapshot(
  source: NativeAudioRobustnessSnapshotSource,
  nowMs: number = Date.now(),
): AudioRobustnessSnapshot {
  const sourceRecord = source as NativeAudioRobustnessSnapshotSource &
    NativeAudioRobustnessSnapshotSourceRecord;

  source.pruneUnderrunSpikeWindow(nowMs);
  const effectiveDynamicSrc = source.getEffectiveDynamicSrcTiming(nowMs);
  source.dynamicSrcAdaptiveProfile = effectiveDynamicSrc.profile;
  source.evaluateDynamicSrcAutoDegradation({
    nowMs,
    stressScore: effectiveDynamicSrc.stressScore,
    triggerActions: false,
  });
  const learningDeviceKey = source.buildDynamicSrcLearningDeviceKey();
  const learningStressIndex = source.dynamicSrcLearningProfile[learningDeviceKey]?.stressIndex ?? 0;
  const learningScale = source.getDynamicSrcLearningScale();
  const audioPerfTelemetry = getAudioPerformanceTelemetrySnapshot();

  const bufferedAheadNow =
    typeof source.state.bufferedAhead === 'number' && Number.isFinite(source.state.bufferedAhead)
      ? Math.max(0, source.state.bufferedAhead)
      : 0;
  const decodeBufferedAheadNow =
    typeof source.state.decodeBufferedAhead === 'number' &&
    Number.isFinite(source.state.decodeBufferedAhead)
      ? Math.max(0, source.state.decodeBufferedAhead)
      : 0;
  const outputBufferedAheadNow =
    typeof source.state.outputBufferedAhead === 'number' &&
    Number.isFinite(source.state.outputBufferedAhead)
      ? Math.max(0, source.state.outputBufferedAhead)
      : 0;
  const bufferedAheadAvg =
    source.bufferedAheadRollingWindow.length > 0
      ? source.bufferedAheadRollingSum / source.bufferedAheadRollingWindow.length
      : null;
  const recoveryActive = source.underrunRecoveryUntilMs > nowMs;
  const protectionActive = source.hasActiveProtectionWindow(nowMs);
  const dspRefillBudgetEvents = sourceRecord.diagnosticTimeline.filter(
    (event) => event.kind === 'dsp.refill.budget_exceeded'
  );
  const latestDspRefillBudgetEvent = dspRefillBudgetEvents[dspRefillBudgetEvents.length - 1] ?? null;
  const vstBridgeFailureEvents = sourceRecord.diagnosticTimeline.filter(
    (event) => event.kind === 'vst.bridge.failure'
  );
  const vstBridgeRestartEvents = sourceRecord.diagnosticTimeline.filter(
    (event) => event.kind === 'vst.bridge.restart_attempt'
  );
  const vstBridgeWriteBackpressureEvents = vstBridgeFailureEvents.filter((event) => event.value === 1);
  const vstBridgeStallEvents = vstBridgeFailureEvents.filter((event) => event.value === 3);
  const vstSidecarCallbackLockMissEvents = sourceRecord.diagnosticTimeline.filter(
    (event) => event.kind === 'vst.sidecar.callback_lock_miss'
  );
  const vstSidecarDryBypassEvents = sourceRecord.diagnosticTimeline.filter(
    (event) => event.kind === 'vst.sidecar.dry_bypass'
  );
  const vstSidecarOutputBackpressureEvents = sourceRecord.diagnosticTimeline.filter(
    (event) => event.kind === 'vst.sidecar.output_backpressure'
  );
  const lastTrim = source.lastWorkingSetTrimEvent;

  return {
    outputBackendId: sourceRecord.currentOutputBackendId,
    outputBackends: [...sourceRecord.availableOutputBackends],
    schedulerProfile: sourceRecord.lastSchedulerProfile,
    stabilityProfile: sourceRecord.stabilityProfile,
    stabilityActionProfile: sourceRecord.stabilityActionProfile,
    sourcePrepareProfile: sourceRecord.sourcePrepareProfile,
    stabilityPrimaryReason: sourceRecord.stabilityPrimaryReason,
    stabilityReasonCodes: sourceRecord.stabilityReasonCodes
      ? [...sourceRecord.stabilityReasonCodes]
      : undefined,
    stabilityHintProfile: sourceRecord.stabilityHintProfile,
    stabilityHintPrimaryReason: sourceRecord.stabilityHintPrimaryReason,
    stabilityHintReasonCodes: sourceRecord.stabilityHintReasonCodes
      ? [...sourceRecord.stabilityHintReasonCodes]
      : undefined,
    transportMode: sourceRecord.transportMode,
    hqSrcPhaseMode: sourceRecord.hqSrcPhaseMode,
    srcMode: sourceRecord.srcMode,
    srcBackend: sourceRecord.srcBackend,
    srcTargetSampleRate: sourceRecord.srcTargetSampleRate,
    outputQuantizationMode: sourceRecord.outputQuantizationMode,
    dynamicSrcAutoEnabled: sourceRecord.dynamicSrcAutoEnabled,
    dynamicSrcProfile: sourceRecord.dynamicSrcProfile,
    dynamicSrcLastSwitchAtMs: sourceRecord.dynamicSrcLastSwitchAtMs,
    dynamicSrcLastSwitchReason: sourceRecord.dynamicSrcLastSwitchReason,
    dynamicSrcHoldUntilMs: Math.max(0, sourceRecord.dynamicSrcHoldUntilMs - nowMs),
    dynamicSrcManualLockActive: sourceRecord.dynamicSrcManualLockActive,
    dynamicSrcAdaptiveEnabled: sourceRecord.dynamicSrcAdaptiveEnabled,
    dynamicSrcAdaptiveProfile: sourceRecord.dynamicSrcAdaptiveProfile,
    dynamicSrcStressScore: effectiveDynamicSrc.stressScore,
    dynamicSrcAutoDegradationLevel: sourceRecord.dynamicSrcAutoDegradationLevel,
    dynamicSrcAutoDegradationLabel: toDynamicSrcAutoDegradationLabel(
      sourceRecord.dynamicSrcAutoDegradationLevel ?? 0,
    ),
    dynamicSrcAutoDegradationReason: sourceRecord.dynamicSrcAutoDegradationReason,
    dynamicSrcAutoDegradationLastChangedAtMs:
      sourceRecord.dynamicSrcAutoDegradationLastChangedAtMs,
    dynamicSrcLearningEnabled: sourceRecord.dynamicSrcLearningEnabled,
    dynamicSrcLearningDeviceKey: learningDeviceKey,
    dynamicSrcLearningStressIndex: Number(learningStressIndex.toFixed(4)),
    dynamicSrcLearningScale: Number(learningScale.toFixed(4)),
    dynamicSrcRestoreDebounceMs: sourceRecord.dynamicSrcRestoreDebounceMs,
    dynamicSrcMinSwitchIntervalMs: sourceRecord.dynamicSrcMinSwitchIntervalMs,
    dynamicSrcSeekHoldMs: sourceRecord.dynamicSrcSeekHoldMs,
    dynamicSrcUnderrunHoldMs: sourceRecord.dynamicSrcUnderrunHoldMs,
    dynamicSrcSharedStressHoldMs: sourceRecord.dynamicSrcSharedStressHoldMs,
    dynamicSrcOutputErrorHoldMs: sourceRecord.dynamicSrcOutputErrorHoldMs,
    tuningAutoEnabled: sourceRecord.tuningAutoEnabled,
    tuningAutoTickIntervalMs: sourceRecord.tuningAutoTickIntervalMs,
    tuningAutoStableWindowMs: sourceRecord.tuningAutoStableWindowMs,
    tuningAutoMinSwitchIntervalMs: sourceRecord.tuningAutoMinSwitchIntervalMs,
    tuningAutoPostSwitchObserveWindowMs: sourceRecord.tuningAutoPostSwitchObserveWindowMs,
    tuningAutoElevatedStressScore: sourceRecord.tuningAutoElevatedStressScore,
    tuningAutoCriticalStressScore: sourceRecord.tuningAutoCriticalStressScore,
    tuningAutoCriticalUnderrunEventsWindow: sourceRecord.tuningAutoCriticalUnderrunEventsWindow,
    tuningAutoCriticalOverflowGrowthTicks: sourceRecord.tuningAutoCriticalOverflowGrowthTicks,
    tuningAutoCriticalOverflowGrowthStreak:
      sourceRecord.tuningAutoControllerState.criticalOverflowGrowthStreak,
    tuningAutoActiveProfile: sourceRecord.tuningAutoControllerState.activeProfile,
    tuningAutoLastReason: sourceRecord.tuningAutoLastReason,
    tuningAutoLastAppliedAtMs: sourceRecord.tuningAutoLastAppliedAtMs,
    tuningAutoStableSinceMs: sourceRecord.tuningAutoControllerState.stableSinceMs,
    tuningAutoLastSwitchAtMs: sourceRecord.tuningAutoControllerState.lastSwitchAtMs,
    dynamicSrcEffectiveRestoreDebounceMs: effectiveDynamicSrc.restoreDebounceMs,
    dynamicSrcEffectiveMinSwitchIntervalMs: effectiveDynamicSrc.minSwitchIntervalMs,
    dynamicSrcEffectiveSeekHoldMs: effectiveDynamicSrc.seekHoldMs,
    dynamicSrcEffectiveUnderrunHoldMs: effectiveDynamicSrc.underrunHoldMs,
    dynamicSrcEffectiveSharedStressHoldMs: effectiveDynamicSrc.sharedStressHoldMs,
    dynamicSrcEffectiveOutputErrorHoldMs: effectiveDynamicSrc.outputErrorHoldMs,
    hqSrcStopbandDb: sourceRecord.hqSrcStopbandDb,
    hqSrcActive: sourceRecord.hqSrcActive,
    hqSrcRatio: sourceRecord.hqSrcRatio,
    sourceSampleRate: sourceRecord.sourceSampleRate,
    outputSampleRate: sourceRecord.outputSampleRate,
    transportExactInt32Container: sourceRecord.transportExactInt32Container,
    outputCallbackMetricsValid: sourceRecord.outputCallbackMetricsValid,
    underrunEvents: sourceRecord.lastUnderrunEvents,
    underrunFrames: sourceRecord.lastUnderrunFrames,
    underrunEventsWindow: sourceRecord.underrunSpikeTimestampsMs.length,
    underrunRecoveryActive: recoveryActive,
    protectionWindowActive: protectionActive,
    protectionRefCount: sourceRecord.protectionWindowRefCount,
    autoSwitchCount: sourceRecord.autoBackendSwitchCount,
    lastAutoSwitchAtMs: sourceRecord.lastAutoBackendSwitchAtMs,
    lastAutoSwitchReason: sourceRecord.lastAutoBackendSwitchReason,
    bufferedAheadSeconds: bufferedAheadNow,
    decodeBufferedAheadSeconds: decodeBufferedAheadNow,
    outputBufferedAheadSeconds: outputBufferedAheadNow,
    bufferedAheadMinSeconds: sourceRecord.bufferedAheadMinSeconds,
    bufferedAheadAvgSeconds: bufferedAheadAvg,
    rebufferCount: sourceRecord.rebufferCount,
    outputCallbackP99Us: sourceRecord.outputCallbackP99Us,
    outputWaitTimeoutCount: sourceRecord.outputWaitTimeoutCount,
    outputRenderUnderrunEvents: sourceRecord.outputRenderUnderrunEvents,
    outputRenderUnderrunFrames: sourceRecord.outputRenderUnderrunFrames,
    outputCallbackIntervalJitterP99Us: sourceRecord.outputCallbackIntervalJitterP99Us,
    outputCallbackIntervalOverrunCount: sourceRecord.outputCallbackIntervalOverrunCount,
    outputCallbackExpectedIntervalUs: sourceRecord.outputCallbackExpectedIntervalUs,
    transferLowWatermarkSamples: sourceRecord.transferLowWatermarkSamples,
    transferRenderLowHitCount: sourceRecord.transferRenderLowHitCount,
    transferDecodeLowHitCount: sourceRecord.transferDecodeLowHitCount,
    transferAdaptationLevel: sourceRecord.transferAdaptationLevel,
    transferOscillationStreak: sourceRecord.transferOscillationStreak,
    renderQueuePageLocked: sourceRecord.renderQueuePageLocked,
    renderQueuePageLockFailureCount: sourceRecord.renderQueuePageLockFailureCount,
    renderQueuePageLockAttemptedBytes: sourceRecord.renderQueuePageLockAttemptedBytes,
    renderQueuePageLockSucceededBytes: sourceRecord.renderQueuePageLockSucceededBytes,
    renderQueuePageLockFailedBytes: sourceRecord.renderQueuePageLockFailedBytes,
    transferMetricsValid: sourceRecord.transferMetricsValid,
    sharedRenderAheadEnabled: sourceRecord.sharedRenderAheadEnabled,
    sharedRenderUnderrunEvents: sourceRecord.sharedRenderUnderrunEvents,
    sharedRenderUnderrunFrames: sourceRecord.sharedRenderUnderrunFrames,
    sharedRenderLowHitCount: sourceRecord.sharedRenderLowHitCount,
    sharedRenderLowWatermarkSamples: sourceRecord.sharedRenderLowWatermarkSamples,
    memoryPoolF32GrowthEvents: sourceRecord.memoryPoolF32GrowthEvents,
    memoryPoolF32GrowthBytes: sourceRecord.memoryPoolF32GrowthBytes,
    memoryPoolF32PrewarmHits: sourceRecord.memoryPoolF32PrewarmHits,
    realtimeMemoryLockAttemptedBytes: sourceRecord.realtimeMemoryLockAttemptedBytes,
    realtimeMemoryLockSucceededBytes: sourceRecord.realtimeMemoryLockSucceededBytes,
    realtimeMemoryLockFailedBytes: sourceRecord.realtimeMemoryLockFailedBytes,
    realtimeMemoryLockSkippedBytes: sourceRecord.realtimeMemoryLockSkippedBytes,
    realtimeMemoryLockFailureCount: sourceRecord.realtimeMemoryLockFailureCount,
    realtimeMemoryLockSkippedCount: sourceRecord.realtimeMemoryLockSkippedCount,
    realtimeMemoryLockedRoleMask: sourceRecord.realtimeMemoryLockedRoleMask,
    realtimeMemoryFailedRoleMask: sourceRecord.realtimeMemoryFailedRoleMask,
    realtimeMemorySkippedRoleMask: sourceRecord.realtimeMemorySkippedRoleMask,
    realtimeMemoryPressureEvents: sourceRecord.realtimeMemoryPressureEvents,
    controlQueueLockFree: sourceRecord.controlQueueLockFree,
    controlQueueMode: sourceRecord.controlQueueMode,
    controlQueueCapacity: sourceRecord.controlQueueCapacity,
    controlQueueOverwriteEvents: sourceRecord.controlQueueOverwriteEvents,
    controlQueueDropNewestEvents: sourceRecord.controlQueueDropNewestEvents,
    controlQueueCoalescedOverflowEvents: sourceRecord.controlQueueCoalescedOverflowEvents,
    controlQueueCriticalOverflowEvents: sourceRecord.controlQueueCriticalOverflowEvents,
    estimatedAudioBufferBytes: sourceRecord.estimatedAudioBufferBytes,
    diagnosticTimelineDroppedEvents: sourceRecord.diagnosticTimelineDroppedEvents,
    diagnosticTimeline: [...sourceRecord.diagnosticTimeline],
    dspRefillBudgetExceededCount: dspRefillBudgetEvents.length,
    dspRefillBudgetExceededLastUs: latestDspRefillBudgetEvent?.value ?? null,
    dspRefillBudgetExceededLastBudgetUs: latestDspRefillBudgetEvent?.aux ?? null,
    vstBridgeFailureCount: vstBridgeFailureEvents.length,
    vstBridgeWriteBackpressureCount: vstBridgeWriteBackpressureEvents.length,
    vstBridgeStallCount: vstBridgeStallEvents.length,
    vstBridgeRestartAttemptCount: vstBridgeRestartEvents.length,
    vstSidecarCallbackLockMissCount: vstSidecarCallbackLockMissEvents.reduce(
      (sum, event) => sum + event.value,
      0
    ),
    vstSidecarCallbackLockMissFrames: vstSidecarCallbackLockMissEvents.reduce(
      (sum, event) => sum + event.aux,
      0
    ),
    vstSidecarDryBypassFrames: vstSidecarDryBypassEvents.reduce(
      (sum, event) => sum + event.value,
      0
    ),
    vstSidecarOutputBackpressureCount: vstSidecarOutputBackpressureEvents.reduce(
      (sum, event) => sum + event.value,
      0
    ),
    vstSidecarOutputBackpressureFrames: vstSidecarOutputBackpressureEvents.reduce(
      (sum, event) => sum + event.aux,
      0
    ),
    lastWorkingSetTrimAtMs: lastTrim?.timestampMs ?? null,
    lastWorkingSetTrimTarget: lastTrim?.target ?? null,
    lastWorkingSetTrimReason: lastTrim?.reason ?? null,
    lastWorkingSetTrimSucceeded: lastTrim?.succeeded ?? null,
    lastWorkingSetTrimAttemptedCount: lastTrim?.attemptedCount ?? 0,
    lastWorkingSetTrimTrimmedCount: lastTrim?.trimmedCount ?? 0,
    lastWorkingSetTrimFailedCount: lastTrim?.failedCount ?? 0,
    recentPlaylistWriteScheduledCount: audioPerfTelemetry.recentPlaylistWriteScheduledCount,
    recentPlaylistWriteFlushCount: audioPerfTelemetry.recentPlaylistWriteFlushCount,
    recentPlaylistWriteEventCount: audioPerfTelemetry.recentPlaylistWriteEventCount,
    recentPlaylistWriteTrackCount: audioPerfTelemetry.recentPlaylistWriteTrackCount,
    recentPlaylistWritePayloadBytesTotal: audioPerfTelemetry.recentPlaylistWritePayloadBytesTotal,
    recentPlaylistWritePayloadBytesLast: audioPerfTelemetry.recentPlaylistWritePayloadBytesLast,
    coverResolveRequestCount: audioPerfTelemetry.coverResolveRequestCount,
    coverResolveCacheHitCount: audioPerfTelemetry.coverResolveCacheHitCount,
    coverResolveCacheMissCount: audioPerfTelemetry.coverResolveCacheMissCount,
    coverResolveHitRate: audioPerfTelemetry.coverResolveHitRate,
    coverBlobReleaseCount: audioPerfTelemetry.coverBlobReleaseCount,
    protectionReason: protectionActive
      ? sourceRecord.protectionWindowReason ?? sourceRecord.sharedStressReason
      : source.hasActiveSharedStressWindow(nowMs)
        ? sourceRecord.sharedStressReason
        : null,
  };
}
