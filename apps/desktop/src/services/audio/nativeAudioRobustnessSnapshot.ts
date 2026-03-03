import { getAudioPerformanceTelemetrySnapshot } from './audioPerformanceTelemetry';
import type { DynamicSrcEffectiveTiming } from './dynamicSrcAdaptiveTiming';
import { toDynamicSrcAutoDegradationLabel } from './robustnessDegradation';
import type { AudioRobustnessSnapshot, AudioState } from './types';

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
};

export function buildNativeAudioRobustnessSnapshot(
  source: NativeAudioRobustnessSnapshotSource,
  nowMs: number = Date.now(),
): AudioRobustnessSnapshot {
  const sourceRecord = source as NativeAudioRobustnessSnapshotSource & Record<string, any>;

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

  return {
    outputBackendId: sourceRecord.currentOutputBackendId,
    outputBackends: [...sourceRecord.availableOutputBackends],
    schedulerProfile: sourceRecord.lastSchedulerProfile,
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
      sourceRecord.dynamicSrcAutoDegradationLevel,
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
    transferMetricsValid: sourceRecord.transferMetricsValid,
    sharedRenderAheadEnabled: sourceRecord.sharedRenderAheadEnabled,
    sharedRenderUnderrunEvents: sourceRecord.sharedRenderUnderrunEvents,
    sharedRenderUnderrunFrames: sourceRecord.sharedRenderUnderrunFrames,
    sharedRenderLowHitCount: sourceRecord.sharedRenderLowHitCount,
    sharedRenderLowWatermarkSamples: sourceRecord.sharedRenderLowWatermarkSamples,
    controlQueueLockFree: sourceRecord.controlQueueLockFree,
    controlQueueMode: sourceRecord.controlQueueMode,
    controlQueueCapacity: sourceRecord.controlQueueCapacity,
    controlQueueOverwriteEvents: sourceRecord.controlQueueOverwriteEvents,
    controlQueueDropNewestEvents: sourceRecord.controlQueueDropNewestEvents,
    controlQueueCoalescedOverflowEvents: sourceRecord.controlQueueCoalescedOverflowEvents,
    controlQueueCriticalOverflowEvents: sourceRecord.controlQueueCriticalOverflowEvents,
    diagnosticTimelineDroppedEvents: sourceRecord.diagnosticTimelineDroppedEvents,
    diagnosticTimeline: [...sourceRecord.diagnosticTimeline],
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
