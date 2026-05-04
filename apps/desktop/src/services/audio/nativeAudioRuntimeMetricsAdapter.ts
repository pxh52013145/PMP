import type { NativeAudioStatePayload } from './nativeAudioServiceTypes';

export type NativeAudioRuntimeMetricsState = {
  outputSampleRate: number;
  sourceSampleRate: number;
  outputCallbackMetricsValid: boolean;
  outputCallbackP99Us: number;
  outputWaitTimeoutCount: number;
  outputRenderUnderrunEvents: number;
  outputRenderUnderrunFrames: number;
  outputCallbackIntervalJitterP99Us: number;
  outputCallbackIntervalOverrunCount: number;
  outputCallbackExpectedIntervalUs: number;
  transferLowWatermarkSamples: number;
  transferRenderLowHitCount: number;
  transferDecodeLowHitCount: number;
  transferAdaptationLevel: number;
  transferOscillationStreak: number;
  renderQueuePageLocked: boolean;
  renderQueuePageLockFailureCount: number;
  renderQueuePageLockAttemptedBytes: number;
  renderQueuePageLockSucceededBytes: number;
  renderQueuePageLockFailedBytes: number;
  transferMetricsValid: boolean;
  sharedRenderAheadEnabled: boolean;
  sharedRenderUnderrunEvents: number;
  sharedRenderUnderrunFrames: number;
  sharedRenderLowHitCount: number;
  sharedRenderLowWatermarkSamples: number;
  controlQueueLockFree: boolean;
  controlQueueMode: string;
  controlQueueCapacity: number;
  controlQueueOverwriteEvents: number;
  controlQueueDropNewestEvents: number;
  controlQueueCoalescedOverflowEvents: number;
  controlQueueCriticalOverflowEvents: number;
  estimatedAudioBufferBytes: number;
  memoryPoolF32GrowthEvents: number;
  memoryPoolF32GrowthBytes: number;
  memoryPoolF32PrewarmHits: number;
  realtimeMemoryLockAttemptedBytes: number;
  realtimeMemoryLockSucceededBytes: number;
  realtimeMemoryLockFailedBytes: number;
  realtimeMemoryLockSkippedBytes: number;
  realtimeMemoryLockFailureCount: number;
  realtimeMemoryLockSkippedCount: number;
  realtimeMemoryLockedRoleMask: number;
  realtimeMemoryFailedRoleMask: number;
  realtimeMemorySkippedRoleMask: number;
  realtimeMemoryPressureEvents: number;
  diagnosticTimelineDroppedEvents: number;
};

export type NativeAudioRuntimeMetricsApplyResult = {
  renderQueuePageLockStatus: {
    locked: boolean;
    playbackState?: NativeAudioStatePayload['playbackState'];
  } | null;
};

function normalizeNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function applyIfFinite(
  state: NativeAudioRuntimeMetricsState,
  key: keyof NativeAudioRuntimeMetricsState,
  value: unknown
): void {
  const normalized = normalizeNonNegativeInteger(value);
  if (normalized === null) return;
  state[key] = normalized as never;
}

function resetOutputCallbackMetrics(state: NativeAudioRuntimeMetricsState): void {
  state.outputCallbackP99Us = 0;
  state.outputWaitTimeoutCount = 0;
  state.outputRenderUnderrunEvents = 0;
  state.outputRenderUnderrunFrames = 0;
  state.outputCallbackIntervalJitterP99Us = 0;
  state.outputCallbackIntervalOverrunCount = 0;
  state.outputCallbackExpectedIntervalUs = 0;
}

function resetTransferMetrics(state: NativeAudioRuntimeMetricsState): void {
  state.transferMetricsValid = false;
  state.transferLowWatermarkSamples = 0;
  state.transferRenderLowHitCount = 0;
  state.transferDecodeLowHitCount = 0;
  state.transferAdaptationLevel = 0;
  state.transferOscillationStreak = 0;
  state.renderQueuePageLocked = false;
  state.renderQueuePageLockFailureCount = 0;
  state.renderQueuePageLockAttemptedBytes = 0;
  state.renderQueuePageLockSucceededBytes = 0;
  state.renderQueuePageLockFailedBytes = 0;
}

function resetSharedRenderAheadMetrics(state: NativeAudioRuntimeMetricsState): void {
  state.sharedRenderUnderrunEvents = 0;
  state.sharedRenderUnderrunFrames = 0;
  state.sharedRenderLowHitCount = 0;
  state.sharedRenderLowWatermarkSamples = 0;
}

export function applyNativeAudioRuntimeMetricsPayload(
  state: NativeAudioRuntimeMetricsState,
  payload: NativeAudioStatePayload
): NativeAudioRuntimeMetricsApplyResult {
  const sampleRate = normalizeNonNegativeInteger(payload.sampleRate);
  if (sampleRate !== null) state.outputSampleRate = sampleRate;

  const sourceSampleRate = normalizeNonNegativeInteger(payload.sourceSampleRate);
  if (sourceSampleRate !== null) state.sourceSampleRate = sourceSampleRate;

  if (typeof payload.outputCallbackMetricsValid === 'boolean') {
    state.outputCallbackMetricsValid = payload.outputCallbackMetricsValid;
    if (!state.outputCallbackMetricsValid) {
      resetOutputCallbackMetrics(state);
    }
  }

  if (state.outputCallbackMetricsValid) {
    applyIfFinite(state, 'outputCallbackP99Us', payload.outputCallbackP99Us);
    applyIfFinite(state, 'outputWaitTimeoutCount', payload.outputWaitTimeoutCount);
    applyIfFinite(state, 'outputRenderUnderrunEvents', payload.outputRenderUnderrunEvents);
    applyIfFinite(state, 'outputRenderUnderrunFrames', payload.outputRenderUnderrunFrames);
    applyIfFinite(
      state,
      'outputCallbackIntervalJitterP99Us',
      payload.outputCallbackIntervalJitterP99Us
    );
    applyIfFinite(
      state,
      'outputCallbackIntervalOverrunCount',
      payload.outputCallbackIntervalOverrunCount
    );
    applyIfFinite(
      state,
      'outputCallbackExpectedIntervalUs',
      payload.outputCallbackExpectedIntervalUs
    );
  }

  const transferLowWatermarkSamples = normalizeNonNegativeInteger(
    payload.transferLowWatermarkSamples
  );
  if (transferLowWatermarkSamples !== null) {
    state.transferMetricsValid = true;
    state.transferLowWatermarkSamples = transferLowWatermarkSamples;
  } else {
    resetTransferMetrics(state);
  }

  applyIfFinite(state, 'transferRenderLowHitCount', payload.transferRenderLowHitCount);
  applyIfFinite(state, 'transferDecodeLowHitCount', payload.transferDecodeLowHitCount);
  applyIfFinite(state, 'transferAdaptationLevel', payload.transferAdaptationLevel);
  applyIfFinite(state, 'transferOscillationStreak', payload.transferOscillationStreak);

  let renderQueuePageLockStatus: NativeAudioRuntimeMetricsApplyResult['renderQueuePageLockStatus'] =
    null;
  if (typeof payload.renderQueuePageLocked === 'boolean') {
    state.renderQueuePageLocked = payload.renderQueuePageLocked;
    renderQueuePageLockStatus = {
      locked: payload.renderQueuePageLocked,
      playbackState: payload.playbackState,
    };
  }

  applyIfFinite(state, 'renderQueuePageLockFailureCount', payload.renderQueuePageLockFailureCount);
  applyIfFinite(
    state,
    'renderQueuePageLockAttemptedBytes',
    payload.renderQueuePageLockAttemptedBytes
  );
  applyIfFinite(
    state,
    'renderQueuePageLockSucceededBytes',
    payload.renderQueuePageLockSucceededBytes
  );
  applyIfFinite(state, 'renderQueuePageLockFailedBytes', payload.renderQueuePageLockFailedBytes);

  if (typeof payload.sharedRenderAheadEnabled === 'boolean') {
    state.sharedRenderAheadEnabled = payload.sharedRenderAheadEnabled;
    if (!state.sharedRenderAheadEnabled) {
      resetSharedRenderAheadMetrics(state);
    }
  }

  if (state.sharedRenderAheadEnabled) {
    applyIfFinite(state, 'sharedRenderUnderrunEvents', payload.sharedRenderUnderrunEvents);
    applyIfFinite(state, 'sharedRenderUnderrunFrames', payload.sharedRenderUnderrunFrames);
    applyIfFinite(state, 'sharedRenderLowHitCount', payload.sharedRenderLowHitCount);
    applyIfFinite(
      state,
      'sharedRenderLowWatermarkSamples',
      payload.sharedRenderLowWatermarkSamples
    );
  }

  if (typeof payload.controlQueueLockFree === 'boolean') {
    state.controlQueueLockFree = payload.controlQueueLockFree;
  }

  if (typeof payload.controlQueueMode === 'string' && payload.controlQueueMode.trim().length > 0) {
    state.controlQueueMode = payload.controlQueueMode.trim();
  }

  applyIfFinite(state, 'controlQueueCapacity', payload.controlQueueCapacity);
  applyIfFinite(state, 'controlQueueOverwriteEvents', payload.controlQueueOverwriteEvents);
  applyIfFinite(state, 'controlQueueDropNewestEvents', payload.controlQueueDropNewestEvents);
  applyIfFinite(
    state,
    'controlQueueCoalescedOverflowEvents',
    payload.controlQueueCoalescedOverflowEvents
  );
  applyIfFinite(
    state,
    'controlQueueCriticalOverflowEvents',
    payload.controlQueueCriticalOverflowEvents
  );
  applyIfFinite(state, 'estimatedAudioBufferBytes', payload.estimatedAudioBufferBytes);
  applyIfFinite(state, 'memoryPoolF32GrowthEvents', payload.memoryPoolF32GrowthEvents);
  applyIfFinite(state, 'memoryPoolF32GrowthBytes', payload.memoryPoolF32GrowthBytes);
  applyIfFinite(state, 'memoryPoolF32PrewarmHits', payload.memoryPoolF32PrewarmHits);
  applyIfFinite(
    state,
    'realtimeMemoryLockAttemptedBytes',
    payload.realtimeMemoryLockAttemptedBytes
  );
  applyIfFinite(
    state,
    'realtimeMemoryLockSucceededBytes',
    payload.realtimeMemoryLockSucceededBytes
  );
  applyIfFinite(state, 'realtimeMemoryLockFailedBytes', payload.realtimeMemoryLockFailedBytes);
  applyIfFinite(state, 'realtimeMemoryLockSkippedBytes', payload.realtimeMemoryLockSkippedBytes);
  applyIfFinite(state, 'realtimeMemoryLockFailureCount', payload.realtimeMemoryLockFailureCount);
  applyIfFinite(state, 'realtimeMemoryLockSkippedCount', payload.realtimeMemoryLockSkippedCount);
  applyIfFinite(state, 'realtimeMemoryLockedRoleMask', payload.realtimeMemoryLockedRoleMask);
  applyIfFinite(state, 'realtimeMemoryFailedRoleMask', payload.realtimeMemoryFailedRoleMask);
  applyIfFinite(state, 'realtimeMemorySkippedRoleMask', payload.realtimeMemorySkippedRoleMask);
  applyIfFinite(state, 'realtimeMemoryPressureEvents', payload.realtimeMemoryPressureEvents);
  applyIfFinite(
    state,
    'diagnosticTimelineDroppedEvents',
    payload.diagnosticTimelineDroppedEvents
  );

  return { renderQueuePageLockStatus };
}
