import type { ScopedEventBus } from '../../kernel';
import { createServiceToken } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import {
  clampQualityLevel,
  DEFAULT_QUALITY_SETTINGS_V1,
  guessInitialAutoQualityLevel,
  nextHigherQuality,
  nextLowerQuality,
  parseQualitySettings,
  resolveQualityProfile,
  type QualityDecisionReason,
  type QualityEffectiveConfig,
  type QualityLevel,
  type QualitySettingsV1,
  type QualitySnapshot,
} from '../../contracts/quality';
import {
  DEFAULT_PERFORMANCE_CONTROL_SETTINGS,
  parsePerformanceRuntimeProfile,
  resolvePerformanceRuntimePresetSettings,
} from '../../contracts/performanceControl';
import type { RenderMode } from '../../contracts/performance';
import { readJson, readString } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

export type QualityWindowActivity = {
  renderMode: RenderMode;
  isVisible: boolean;
  isActive: boolean;
};

export interface QualityService {
  getSnapshot(): QualitySnapshot;
  refreshSettingsFromStorage(): void;
  setWindowActivity(activity: QualityWindowActivity): void;
  setLastMemoryTier(tier: number | undefined): void;
}

export const QUALITY_SERVICE_TOKEN = createServiceToken<QualityService>('service.quality');

type FrameSample = {
  atMs: number;
  deltaMs: number;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx] ?? 0;
}

function readJsHeapUsedBytes(): number | undefined {
  try {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
    const value = memory?.usedJSHeapSize;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function resolveQualitySettingsFallbackFromRuntimeProfile(): QualitySettingsV1 {
  const runtimeProfile = parsePerformanceRuntimeProfile(
    readJson<unknown>(
      STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE,
      DEFAULT_PERFORMANCE_CONTROL_SETTINGS.runtimeProfile
    ),
    DEFAULT_PERFORMANCE_CONTROL_SETTINGS.runtimeProfile
  );

  if (runtimeProfile === 'custom') {
    return DEFAULT_QUALITY_SETTINGS_V1;
  }

  return resolvePerformanceRuntimePresetSettings(runtimeProfile).uiQualitySettings;
}

export class DefaultQualityService implements QualityService {
  private settings: QualitySettingsV1 = DEFAULT_QUALITY_SETTINGS_V1;
  private activity: QualityWindowActivity = { renderMode: 'full', isVisible: true, isActive: true };

  private level: QualityLevel = DEFAULT_QUALITY_SETTINGS_V1.fixedLevel;
  private updatedAtMs = Date.now();
  private lastDecision: QualitySnapshot['lastDecision'];
  private telemetry: QualitySnapshot['telemetry'];

  private rafId: number | null = null;
  private lastRafAtMs: number | null = null;
  private samples: FrameSample[] = [];
  private windowStartAtMs: number | null = null;
  private nextDowngradeAllowedAtMs = 0;
  private nextUpgradeAllowedAtMs = 0;

  private lastMemoryTier: number | undefined;
  private lastHeapSampleAtMs = 0;

  constructor(private readonly events: ScopedEventBus<AppEvents>) {
    this.refreshSettingsFromStorage();
  }

  getSnapshot(): QualitySnapshot {
    const effective = this.buildEffective(this.level);
    return {
      settings: this.settings,
      effective,
      updatedAtMs: this.updatedAtMs,
      lastDecision: this.lastDecision,
      telemetry: this.telemetry,
    };
  }

  refreshSettingsFromStorage(): void {
    const prevMode = this.settings.mode;
    const hasExplicitUiQualitySettings = readString(STORAGE_KEYS.UI_QUALITY_SETTINGS_V1) !== null;
    const fallback = hasExplicitUiQualitySettings
      ? DEFAULT_QUALITY_SETTINGS_V1
      : resolveQualitySettingsFallbackFromRuntimeProfile();
    const raw = readJson<unknown>(STORAGE_KEYS.UI_QUALITY_SETTINGS_V1, fallback);
    this.settings = parseQualitySettings(raw, fallback);

    if (this.settings.mode === 'fixed') {
      const next = this.settings.fixedLevel;
      if (this.level !== next) {
        this.lastDecision = {
          atMs: Date.now(),
          from: this.level,
          to: next,
          reason: { kind: 'manual' },
        };
        this.level = next;
      }
    } else {
      if (prevMode !== 'auto') {
        const guess = guessInitialAutoQualityLevel(this.settings);
        this.level = guess.level;
        this.lastDecision = {
          atMs: Date.now(),
          from: guess.level,
          to: guess.level,
          reason: { kind: 'auto-init', detail: guess.detail },
        };
      } else {
        const clamped = clampQualityLevel(this.level, this.settings.auto.minLevel, this.settings.auto.maxLevel);
        if (clamped !== this.level) {
          this.lastDecision = {
            atMs: Date.now(),
            from: this.level,
            to: clamped,
            reason: { kind: 'auto-init', detail: 'clamp-range' },
          };
          this.level = clamped;
        }
      }
    }

    this.updatedAtMs = Date.now();
    this.emitChanged();
  }

  setWindowActivity(activity: QualityWindowActivity): void {
    const prev = this.activity;
    this.activity = activity;
    const shouldStop = activity.renderMode === 'pause' || !activity.isVisible;
    const didStop = prev.renderMode === 'pause' || !prev.isVisible;

    if (shouldStop && !didStop) {
      this.stopSampling();
      return;
    }

    if (!shouldStop && didStop) {
      this.startSampling();
      return;
    }

    if (!shouldStop) {
      this.startSampling();
    }
  }

  setLastMemoryTier(tier: number | undefined): void {
    this.lastMemoryTier = tier;

    if (this.settings.mode === 'auto' && (tier ?? 0) >= 2) {
      const next = clampQualityLevel(
        nextLowerQuality(this.level),
        this.settings.auto.minLevel,
        this.settings.auto.maxLevel
      );
      if (next !== this.level) {
        const nowMs = Date.now();
        const from = this.level;
        this.level = next;
        this.lastDecision = {
          atMs: nowMs,
          from,
          to: next,
          reason: { kind: 'auto-downgrade', detail: `memoryTier=${tier} (immediate)` },
        };
        this.nextDowngradeAllowedAtMs = nowMs + this.settings.auto.downgradeCooldownMs;
        this.nextUpgradeAllowedAtMs = nowMs + this.settings.auto.upgradeCooldownMs;
      }
    }

    if (this.telemetry) {
      this.telemetry = { ...this.telemetry, lastMemoryTier: tier };
    }

    this.updatedAtMs = Date.now();
    this.emitChanged();
  }

  private startSampling(): void {
    if (this.rafId !== null) return;
    if (typeof window === 'undefined') return;

    this.windowStartAtMs = null;
    this.samples = [];
    this.lastRafAtMs = null;

    const loop = (now: number) => {
      this.rafId = window.requestAnimationFrame(loop);
      if (this.activity.renderMode === 'pause') return;
      if (!this.activity.isVisible) return;

      const atMs = now;
      const last = this.lastRafAtMs;
      this.lastRafAtMs = atMs;
      if (last === null) return;
      const deltaMs = Math.max(0, Math.min(500, atMs - last));

      if (this.windowStartAtMs === null) {
        this.windowStartAtMs = atMs;
      }

      this.samples.push({ atMs, deltaMs });

      const windowMs = atMs - (this.windowStartAtMs ?? atMs);
      if (windowMs >= this.settings.auto.sampleWindowMs) {
        this.evaluateAndMaybeAdjust(atMs);
        this.windowStartAtMs = atMs;
        this.samples = [];
      }
    };

    this.rafId = window.requestAnimationFrame(loop);
  }

  private stopSampling(): void {
    if (this.rafId === null) return;
    try {
      window.cancelAnimationFrame(this.rafId);
    } catch {
      // ignore
    }
    this.rafId = null;
    this.lastRafAtMs = null;
    this.windowStartAtMs = null;
    this.samples = [];
  }

  private evaluateAndMaybeAdjust(nowMs: number): void {
    const deltas = this.samples.map((s) => s.deltaMs);
    const sampleCount = deltas.length;
    if (sampleCount < 20) return;

    const windowMs = Math.max(1, nowMs - (this.windowStartAtMs ?? nowMs));
    const sum = deltas.reduce((acc, v) => acc + v, 0);
    const avgFrameMs = sum / sampleCount;
    const p95FrameMs = percentile(deltas, 0.95);
    const jankFrameMs = this.settings.auto.jankFrameMs;
    const jankCount = deltas.filter((v) => v >= jankFrameMs).length;
    const jankRatio = jankCount / sampleCount;

    const jsHeapUsedBytes = (() => {
      const since = nowMs - this.lastHeapSampleAtMs;
      if (since < 900) return this.telemetry?.jsHeapUsedBytes;
      this.lastHeapSampleAtMs = nowMs;
      return readJsHeapUsedBytes();
    })();

    this.telemetry = {
      windowMs,
      sampleCount,
      avgFrameMs,
      p95FrameMs,
      jankRatio,
      lastFrameAtMs: nowMs,
      jsHeapUsedBytes,
      lastMemoryTier: this.lastMemoryTier,
    };

    if (this.settings.mode === 'fixed') {
      this.level = this.settings.fixedLevel;
      this.updatedAtMs = Date.now();
      this.emitChanged();
      return;
    }

    const minLevel = this.settings.auto.minLevel;
    const maxLevel = this.settings.auto.maxLevel;

    const targetFps =
      this.activity.renderMode === 'throttle'
        ? this.settings.auto.targetFpsBackground
        : this.settings.auto.targetFpsForeground;
    const targetFrameMs = targetFps > 0 ? 1000 / targetFps : 16.7;

    const memoryTier = this.lastMemoryTier ?? 0;
    const shouldDowngradeForMemory = memoryTier >= 2;
    const shouldDowngradeForJank =
      jankRatio >= this.settings.auto.jankRatioDowngrade || avgFrameMs >= targetFrameMs * 1.25 || p95FrameMs >= targetFrameMs * 2.0;

    const shouldUpgrade =
      memoryTier <= 0 &&
      jankRatio <= this.settings.auto.jankRatioUpgrade &&
      avgFrameMs <= targetFrameMs * 0.92 &&
      p95FrameMs <= targetFrameMs * 1.35;

    let nextLevel: QualityLevel | null = null;
    let reason: QualityDecisionReason | null = null;

    if ((shouldDowngradeForMemory || shouldDowngradeForJank) && nowMs >= this.nextDowngradeAllowedAtMs) {
      const desired = nextLowerQuality(this.level);
      nextLevel = clampQualityLevel(desired, minLevel, maxLevel);

      const detail = shouldDowngradeForMemory
        ? `memoryTier=${memoryTier}`
        : `avg=${avgFrameMs.toFixed(1)}ms p95=${p95FrameMs.toFixed(1)}ms jank=${Math.round(jankRatio * 100)}%`;
      reason = { kind: 'auto-downgrade', detail };

      this.nextDowngradeAllowedAtMs = nowMs + this.settings.auto.downgradeCooldownMs;
      this.nextUpgradeAllowedAtMs = nowMs + this.settings.auto.upgradeCooldownMs;
    } else if (shouldUpgrade && nowMs >= this.nextUpgradeAllowedAtMs) {
      const desired = nextHigherQuality(this.level);
      nextLevel = clampQualityLevel(desired, minLevel, maxLevel);
      reason = {
        kind: 'auto-upgrade',
        detail: `avg=${avgFrameMs.toFixed(1)}ms p95=${p95FrameMs.toFixed(1)}ms jank=${Math.round(jankRatio * 100)}%`,
      };
      this.nextUpgradeAllowedAtMs = nowMs + this.settings.auto.upgradeCooldownMs;
    }

    if (nextLevel && nextLevel !== this.level && reason) {
      const from = this.level;
      this.level = nextLevel;
      this.lastDecision = { atMs: nowMs, from, to: nextLevel, reason };
    }

    this.updatedAtMs = Date.now();
    this.emitChanged();
  }

  private buildEffective(level: QualityLevel): QualityEffectiveConfig {
    const base = resolveQualityProfile(level);

    const foregroundTarget = this.settings.auto.targetFpsForeground;
    const backgroundTarget = this.settings.auto.targetFpsBackground;

    const fpsForeground =
      foregroundTarget > 0
        ? base.fpsForeground === 0
          ? foregroundTarget
          : Math.min(base.fpsForeground, foregroundTarget)
        : base.fpsForeground;
    const fpsBackground = Math.min(base.fpsBackground, backgroundTarget);

    return {
      level,
      ...base,
      fpsForeground,
      fpsBackground,
    };
  }

  private emitChanged(): void {
    this.events.emit('quality/changed', this.getSnapshot());
  }
}
