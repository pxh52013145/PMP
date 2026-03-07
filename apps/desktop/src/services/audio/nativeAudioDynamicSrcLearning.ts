import type {
  DynamicSrcLearningMap,
  DynamicSrcLearningRecord,
} from './nativeAudioServiceTypes';

function sanitizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildDynamicSrcLearningDeviceKey(
  currentOutputBackendId: string | null,
  currentOutputDeviceId: string | null,
  currentOutputDeviceName: string | null,
): string {
  const backend = currentOutputBackendId ?? 'unknown-backend';
  const device =
    sanitizeNonEmptyString(currentOutputDeviceId) ??
    sanitizeNonEmptyString(currentOutputDeviceName) ??
    'default-device';

  return `${backend}::${device}`;
}

export function parseDynamicSrcLearningProfile(
  raw: string | null,
  maxItems: number,
): DynamicSrcLearningMap {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};

    const input = parsed as Record<string, unknown>;
    const entries: Array<[string, DynamicSrcLearningRecord]> = [];
    for (const [key, value] of Object.entries(input)) {
      if (typeof key !== 'string' || key.trim().length === 0) continue;
      if (!value || typeof value !== 'object') continue;

      const record = value as Record<string, unknown>;
      const stressIndexRaw = record.stressIndex;
      const updatedAtRaw = record.updatedAtMs;
      if (typeof stressIndexRaw !== 'number' || !Number.isFinite(stressIndexRaw)) continue;
      const normalizedStress = Math.max(0, Math.min(12, stressIndexRaw));
      const updatedAtMs =
        typeof updatedAtRaw === 'number' && Number.isFinite(updatedAtRaw)
          ? Math.max(0, Math.floor(updatedAtRaw))
          : 0;

      entries.push([
        key,
        {
          stressIndex: normalizedStress,
          updatedAtMs,
        },
      ]);
    }

    entries.sort((a, b) => (b[1].updatedAtMs || 0) - (a[1].updatedAtMs || 0));
    return Object.fromEntries(entries.slice(0, maxItems));
  } catch {
    return {};
  }
}

export function normalizeDynamicSrcLearningProfileForPersistence(
  profile: DynamicSrcLearningMap,
  maxItems: number,
): DynamicSrcLearningMap {
  const trimmedEntries = Object.entries(profile)
    .sort((a, b) => (b[1].updatedAtMs || 0) - (a[1].updatedAtMs || 0))
    .slice(0, maxItems);
  return Object.fromEntries(trimmedEntries);
}
