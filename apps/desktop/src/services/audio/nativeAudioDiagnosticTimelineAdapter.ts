export type NativeAudioDiagnosticTimelineEntry = {
  seq: number;
  timestampMs: number;
  kind: string;
  value: number;
  aux: number;
};

export const NATIVE_AUDIO_DIAGNOSTIC_TIMELINE_MAX_ENTRIES = 24;

export function normalizeNativeAudioDiagnosticTimeline(
  timeline: unknown,
  maxEntries: number = NATIVE_AUDIO_DIAGNOSTIC_TIMELINE_MAX_ENTRIES
): NativeAudioDiagnosticTimelineEntry[] | null {
  if (!Array.isArray(timeline)) return null;

  const normalized = timeline
    .map((entry) => {
      const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
      const seq =
        typeof record?.seq === 'number' && Number.isFinite(record.seq)
          ? Math.max(0, Math.floor(record.seq))
          : null;
      const timestampMs =
        typeof record?.timestampMs === 'number' && Number.isFinite(record.timestampMs)
          ? Math.max(0, Math.floor(record.timestampMs))
          : null;
      const kind = typeof record?.kind === 'string' ? record.kind.trim() : '';
      const value =
        typeof record?.value === 'number' && Number.isFinite(record.value)
          ? Math.max(0, Math.floor(record.value))
          : 0;
      const aux =
        typeof record?.aux === 'number' && Number.isFinite(record.aux)
          ? Math.max(0, Math.floor(record.aux))
          : 0;

      if (seq === null || timestampMs === null || !kind) {
        return null;
      }

      return {
        seq,
        timestampMs,
        kind,
        value,
        aux,
      };
    })
    .filter((value): value is NativeAudioDiagnosticTimelineEntry => value !== null);

  return normalized.slice(-Math.max(0, Math.floor(maxEntries)));
}
