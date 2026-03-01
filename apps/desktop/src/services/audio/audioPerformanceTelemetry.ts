export interface AudioPerformanceTelemetrySnapshot {
  recentPlaylistWriteScheduledCount: number;
  recentPlaylistWriteFlushCount: number;
  recentPlaylistWriteEventCount: number;
  recentPlaylistWriteTrackCount: number;
  recentPlaylistWritePayloadBytesTotal: number;
  recentPlaylistWritePayloadBytesLast: number;
  coverResolveRequestCount: number;
  coverResolveCacheHitCount: number;
  coverResolveCacheMissCount: number;
  coverResolveHitRate: number;
  coverBlobReleaseCount: number;
}

type AudioPerformanceTelemetryMutable = {
  recentPlaylistWriteScheduledCount: number;
  recentPlaylistWriteFlushCount: number;
  recentPlaylistWriteEventCount: number;
  recentPlaylistWriteTrackCount: number;
  recentPlaylistWritePayloadBytesTotal: number;
  recentPlaylistWritePayloadBytesLast: number;
  coverResolveRequestCount: number;
  coverResolveCacheHitCount: number;
  coverResolveCacheMissCount: number;
  coverBlobReleaseCount: number;
};

const telemetryState: AudioPerformanceTelemetryMutable = {
  recentPlaylistWriteScheduledCount: 0,
  recentPlaylistWriteFlushCount: 0,
  recentPlaylistWriteEventCount: 0,
  recentPlaylistWriteTrackCount: 0,
  recentPlaylistWritePayloadBytesTotal: 0,
  recentPlaylistWritePayloadBytesLast: 0,
  coverResolveRequestCount: 0,
  coverResolveCacheHitCount: 0,
  coverResolveCacheMissCount: 0,
  coverBlobReleaseCount: 0,
};

export function recordRecentPlaylistWriteScheduled(): void {
  telemetryState.recentPlaylistWriteScheduledCount += 1;
}

export function recordRecentPlaylistWriteFlushed(payload: {
  eventCount: number;
  trackCount: number;
  payloadBytes: number;
}): void {
  telemetryState.recentPlaylistWriteFlushCount += 1;
  telemetryState.recentPlaylistWriteEventCount += Math.max(0, Math.floor(payload.eventCount || 0));
  telemetryState.recentPlaylistWriteTrackCount += Math.max(0, Math.floor(payload.trackCount || 0));
  telemetryState.recentPlaylistWritePayloadBytesLast = Math.max(
    0,
    Math.floor(payload.payloadBytes || 0)
  );
  telemetryState.recentPlaylistWritePayloadBytesTotal += telemetryState.recentPlaylistWritePayloadBytesLast;
}

export function recordCoverResolveLookupRequest(): void {
  telemetryState.coverResolveRequestCount += 1;
}

export function recordCoverResolveCacheHit(): void {
  telemetryState.coverResolveCacheHitCount += 1;
}

export function recordCoverResolveCacheMiss(): void {
  telemetryState.coverResolveCacheMissCount += 1;
}

export function recordCoverBlobUrlsReleased(count: number): void {
  if (!Number.isFinite(count)) return;
  telemetryState.coverBlobReleaseCount += Math.max(0, Math.floor(count));
}

export function getAudioPerformanceTelemetrySnapshot(): AudioPerformanceTelemetrySnapshot {
  const totalLookups =
    telemetryState.coverResolveCacheHitCount + telemetryState.coverResolveCacheMissCount;
  const coverResolveHitRate =
    totalLookups > 0 ? telemetryState.coverResolveCacheHitCount / totalLookups : 0;

  return {
    recentPlaylistWriteScheduledCount: telemetryState.recentPlaylistWriteScheduledCount,
    recentPlaylistWriteFlushCount: telemetryState.recentPlaylistWriteFlushCount,
    recentPlaylistWriteEventCount: telemetryState.recentPlaylistWriteEventCount,
    recentPlaylistWriteTrackCount: telemetryState.recentPlaylistWriteTrackCount,
    recentPlaylistWritePayloadBytesTotal: telemetryState.recentPlaylistWritePayloadBytesTotal,
    recentPlaylistWritePayloadBytesLast: telemetryState.recentPlaylistWritePayloadBytesLast,
    coverResolveRequestCount: telemetryState.coverResolveRequestCount,
    coverResolveCacheHitCount: telemetryState.coverResolveCacheHitCount,
    coverResolveCacheMissCount: telemetryState.coverResolveCacheMissCount,
    coverResolveHitRate,
    coverBlobReleaseCount: telemetryState.coverBlobReleaseCount,
  };
}

export function resetAudioPerformanceTelemetryForTests(): void {
  telemetryState.recentPlaylistWriteScheduledCount = 0;
  telemetryState.recentPlaylistWriteFlushCount = 0;
  telemetryState.recentPlaylistWriteEventCount = 0;
  telemetryState.recentPlaylistWriteTrackCount = 0;
  telemetryState.recentPlaylistWritePayloadBytesTotal = 0;
  telemetryState.recentPlaylistWritePayloadBytesLast = 0;
  telemetryState.coverResolveRequestCount = 0;
  telemetryState.coverResolveCacheHitCount = 0;
  telemetryState.coverResolveCacheMissCount = 0;
  telemetryState.coverBlobReleaseCount = 0;
}

