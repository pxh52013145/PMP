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

export type NativeAudioDynamicSrcLearningControllerOptions = {
  maxItems: number;
  persistMinIntervalMs: number;
  updateMinIntervalMs: number;
  minDelta: number;
  persistProfile: (profile: DynamicSrcLearningMap) => Promise<void> | void;
  setTimeoutFn?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
};

export class NativeAudioDynamicSrcLearningController {
  private profile: DynamicSrcLearningMap = {};
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPersistAtMs = 0;
  private lastPersistedSignature: string | null = null;
  private lastUpdateAtMs = 0;

  constructor(private readonly options: NativeAudioDynamicSrcLearningControllerOptions) {}

  getProfile(): DynamicSrcLearningMap {
    return this.profile;
  }

  getLastPersistedSignature(): string | null {
    return this.lastPersistedSignature;
  }

  getLastPersistAtMs(): number {
    return this.lastPersistAtMs;
  }

  getLastUpdateAtMs(): number {
    return this.lastUpdateAtMs;
  }

  restorePersistedProfile(raw: string | null): DynamicSrcLearningMap {
    this.profile = parseDynamicSrcLearningProfile({
      raw,
      maxItems: this.options.maxItems,
    });
    this.lastPersistedSignature = JSON.stringify(this.normalizeProfileForPersistence());
    this.lastPersistAtMs = 0;
    return this.profile;
  }

  applyPersistedProfile(raw: string | null, nowMs: number = Date.now()): boolean {
    const nextProfile = parseDynamicSrcLearningProfile({
      raw,
      maxItems: this.options.maxItems,
    });
    const nextSignature = JSON.stringify(nextProfile);
    if (nextSignature === this.lastPersistedSignature) {
      return false;
    }

    this.profile = nextProfile;
    this.lastPersistedSignature = nextSignature;
    this.lastPersistAtMs = nowMs;
    return true;
  }

  clearPersistTimer(): void {
    if (this.persistTimer === null) return;
    const clearTimeoutFn = this.options.clearTimeoutFn ?? clearTimeout;
    clearTimeoutFn(this.persistTimer);
    this.persistTimer = null;
  }

  normalizeProfileForPersistence(): DynamicSrcLearningMap {
    this.profile = normalizeDynamicSrcLearningProfile({
      profile: this.profile,
      maxItems: this.options.maxItems,
    });
    return this.profile;
  }

  persistProfile(enabled: boolean, nowMs: number = Date.now()): void {
    if (!enabled) return;

    const normalizedProfile = this.normalizeProfileForPersistence();
    const signature = JSON.stringify(normalizedProfile);
    if (signature === this.lastPersistedSignature) {
      this.lastPersistAtMs = nowMs;
      return;
    }

    this.lastPersistAtMs = nowMs;
    this.lastPersistedSignature = signature;

    try {
      void Promise.resolve(this.options.persistProfile(normalizedProfile)).catch(() => {});
    } catch {
      // Best-effort persistence must not affect playback policy timing.
    }
  }

  schedulePersist(enabled: boolean, nowMs: number = Date.now()): void {
    if (!enabled) return;

    const minIntervalMs = Math.max(0, Math.floor(this.options.persistMinIntervalMs));
    const elapsedMs = nowMs - this.lastPersistAtMs;
    if (elapsedMs >= minIntervalMs) {
      this.clearPersistTimer();
      this.persistProfile(enabled, nowMs);
      return;
    }

    if (this.persistTimer !== null) return;

    const delayMs = Math.max(0, minIntervalMs - elapsedMs);
    const setTimeoutFn = this.options.setTimeoutFn ?? setTimeout;
    this.persistTimer = setTimeoutFn(() => {
      this.persistTimer = null;
      this.persistProfile(enabled, Date.now());
    }, delayMs);
  }

  updateFromStress(input: {
    enabled: boolean;
    stressScore: number;
    nowMs: number;
    deviceKey: string;
  }): boolean {
    if (!input.enabled) return false;
    if (!Number.isFinite(input.stressScore)) return false;

    const updateMinIntervalMs = Math.max(0, Math.floor(this.options.updateMinIntervalMs));
    if (
      this.lastUpdateAtMs > 0 &&
      input.nowMs - this.lastUpdateAtMs < updateMinIntervalMs
    ) {
      return false;
    }
    this.lastUpdateAtMs = input.nowMs;

    const update = resolveDynamicSrcLearningUpdate({
      profile: this.profile,
      deviceKey: input.deviceKey,
      stressScore: input.stressScore,
      nowMs: input.nowMs,
      minDelta: this.options.minDelta,
    });
    if (!update.changed) return false;

    this.profile = update.profile;
    this.schedulePersist(input.enabled, input.nowMs);
    return true;
  }

  getScale(input: { enabled: boolean; deviceKey: string }): number {
    return resolveDynamicSrcLearningScale({
      enabled: input.enabled,
      profile: this.profile,
      deviceKey: input.deviceKey,
    });
  }

  dispose(): void {
    this.clearPersistTimer();
  }
}
