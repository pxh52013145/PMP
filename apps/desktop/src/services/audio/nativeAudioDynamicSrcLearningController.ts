import type {
  DynamicSrcLearningMap,
  DynamicSrcLearningRecord,
} from './nativeAudioServiceTypes';

const DYNAMIC_SRC_LEARNING_STRESS_MAX = 12;

function normalizeStressIndex(value: number): number {
  return Math.max(0, Math.min(DYNAMIC_SRC_LEARNING_STRESS_MAX, value));
}

export function parseDynamicSrcLearningProfile(input: {
  raw: string | null;
  maxItems: number;
}): DynamicSrcLearningMap {
  if (!input.raw) return {};

  try {
    const parsed = JSON.parse(input.raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};

    const entries: Array<[string, DynamicSrcLearningRecord]> = [];
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key !== 'string' || key.trim().length === 0) continue;
      if (!value || typeof value !== 'object') continue;

      const record = value as Record<string, unknown>;
      const stressIndexRaw = record.stressIndex;
      const updatedAtRaw = record.updatedAtMs;
      if (typeof stressIndexRaw !== 'number' || !Number.isFinite(stressIndexRaw)) continue;

      entries.push([
        key,
        {
          stressIndex: normalizeStressIndex(stressIndexRaw),
          updatedAtMs:
            typeof updatedAtRaw === 'number' && Number.isFinite(updatedAtRaw)
              ? Math.max(0, Math.floor(updatedAtRaw))
              : 0,
        },
      ]);
    }

    return normalizeDynamicSrcLearningProfile({
      profile: Object.fromEntries(entries),
      maxItems: input.maxItems,
    });
  } catch {
    return {};
  }
}

export function normalizeDynamicSrcLearningProfile(input: {
  profile: DynamicSrcLearningMap;
  maxItems: number;
}): DynamicSrcLearningMap {
  const maxItems = Math.max(1, Math.floor(input.maxItems));
  const entries = Object.entries(input.profile)
    .filter((entry): entry is [string, DynamicSrcLearningRecord] => {
      const [key, value] = entry;
      return (
        typeof key === 'string' &&
        key.trim().length > 0 &&
        !!value &&
        typeof value.stressIndex === 'number' &&
        Number.isFinite(value.stressIndex)
      );
    })
    .map(([key, value]): [string, DynamicSrcLearningRecord] => [
      key,
      {
        stressIndex: normalizeStressIndex(value.stressIndex),
        updatedAtMs:
          typeof value.updatedAtMs === 'number' && Number.isFinite(value.updatedAtMs)
            ? Math.max(0, Math.floor(value.updatedAtMs))
            : 0,
      },
    ])
    .sort((a, b) => (b[1].updatedAtMs || 0) - (a[1].updatedAtMs || 0))
    .slice(0, maxItems);

  return Object.fromEntries(entries);
}

export function resolveDynamicSrcLearningUpdate(input: {
  profile: DynamicSrcLearningMap;
  deviceKey: string;
  stressScore: number;
  nowMs: number;
  minDelta: number;
}): { changed: boolean; profile: DynamicSrcLearningMap } {
  if (!Number.isFinite(input.stressScore)) {
    return { changed: false, profile: input.profile };
  }

  const previous = input.profile[input.deviceKey]?.stressIndex ?? 0;
  const normalizedStress = normalizeStressIndex(input.stressScore);
  const nextStressIndex = normalizeStressIndex(previous * 0.9 + normalizedStress * 0.1);
  if (Math.abs(nextStressIndex - previous) < Math.max(0, input.minDelta)) {
    return { changed: false, profile: input.profile };
  }

  return {
    changed: true,
    profile: {
      ...input.profile,
      [input.deviceKey]: {
        stressIndex: nextStressIndex,
        updatedAtMs: Math.max(0, Math.floor(input.nowMs)),
      },
    },
  };
}

export function resolveDynamicSrcLearningScale(input: {
  enabled: boolean;
  profile: DynamicSrcLearningMap;
  deviceKey: string;
}): number {
  if (!input.enabled) return 1;

  const stressIndex = input.profile[input.deviceKey]?.stressIndex ?? 0;
  if (stressIndex <= 0) return 1;

  return 1 + Math.min(0.5, stressIndex / 30);
}
