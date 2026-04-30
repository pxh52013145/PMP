export const QUALITY_LEVELS = ['potato', 'low', 'balanced', 'high', 'ultra'] as const;

export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export type QualityControlMode = 'auto' | 'fixed';

export type QualitySettingsV1 = {
  version: 1;
  mode: QualityControlMode;
  fixedLevel: QualityLevel;
  auto: {
    minLevel: QualityLevel;
    maxLevel: QualityLevel;
    targetFpsForeground: number; // 0 => unlimited
    targetFpsBackground: number;
    sampleWindowMs: number;
    downgradeCooldownMs: number;
    upgradeCooldownMs: number;
    jankFrameMs: number;
    jankRatioDowngrade: number;
    jankRatioUpgrade: number;
  };
};

export type QualityEffectiveConfig = {
  level: QualityLevel;
  renderScale: number;
  fpsForeground: number; // 0 => unlimited
  fpsBackground: number;
  fpsEffects: number;
  visualizerBars: number;
  matrixRainDensity: number;
  shaderResolutionScale: number;
  shaderFpsLimit: number | undefined; // undefined => respect manifest/default
};

export type QualityDecisionReason =
  | { kind: 'manual' }
  | { kind: 'auto-init'; detail?: string }
  | { kind: 'auto-upgrade'; detail: string }
  | { kind: 'auto-downgrade'; detail: string };

export type QualitySnapshot = {
  settings: QualitySettingsV1;
  effective: QualityEffectiveConfig;
  updatedAtMs: number;
  lastDecision?: {
    atMs: number;
    from: QualityLevel;
    to: QualityLevel;
    reason: QualityDecisionReason;
  };
  telemetry?: {
    windowMs: number;
    sampleCount: number;
    avgFrameMs: number;
    p95FrameMs: number;
    jankRatio: number;
    lastFrameAtMs: number;
    jsHeapUsedBytes?: number;
    lastMemoryTier?: number;
  };
};

export const DEFAULT_QUALITY_SETTINGS_V1: QualitySettingsV1 = {
  version: 1,
  mode: 'auto',
  fixedLevel: 'high',
  auto: {
    minLevel: 'potato',
    maxLevel: 'ultra',
    targetFpsForeground: 60,
    targetFpsBackground: 10,
    sampleWindowMs: 2500,
    downgradeCooldownMs: 2500,
    upgradeCooldownMs: 12000,
    jankFrameMs: 50,
    jankRatioDowngrade: 0.22,
    jankRatioUpgrade: 0.05,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function parseQualityLevel(value: unknown, fallback: QualityLevel): QualityLevel {
  if (value === 'ultra' || value === 'high' || value === 'balanced' || value === 'low' || value === 'potato') {
    return value;
  }
  return fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function parseQualitySettings(value: unknown, fallback: QualitySettingsV1 = DEFAULT_QUALITY_SETTINGS_V1): QualitySettingsV1 {
  if (!isRecord(value)) return fallback;
  if (value.version !== 1) return fallback;

  const mode: QualityControlMode = value.mode === 'fixed' ? 'fixed' : 'auto';
  const fixedLevel = parseQualityLevel(value.fixedLevel, fallback.fixedLevel);

  const autoRaw = isRecord(value.auto) ? value.auto : {};
  const minLevel = parseQualityLevel(autoRaw.minLevel, fallback.auto.minLevel);
  const maxLevel = parseQualityLevel(autoRaw.maxLevel, fallback.auto.maxLevel);

  return {
    version: 1,
    mode,
    fixedLevel,
    auto: {
      minLevel,
      maxLevel,
      targetFpsForeground: clampNumber(readNumber(autoRaw.targetFpsForeground, fallback.auto.targetFpsForeground), 0, 240, fallback.auto.targetFpsForeground),
      targetFpsBackground: clampNumber(readNumber(autoRaw.targetFpsBackground, fallback.auto.targetFpsBackground), 1, 60, fallback.auto.targetFpsBackground),
      sampleWindowMs: clampNumber(readNumber(autoRaw.sampleWindowMs, fallback.auto.sampleWindowMs), 800, 15000, fallback.auto.sampleWindowMs),
      downgradeCooldownMs: clampNumber(readNumber(autoRaw.downgradeCooldownMs, fallback.auto.downgradeCooldownMs), 0, 60000, fallback.auto.downgradeCooldownMs),
      upgradeCooldownMs: clampNumber(readNumber(autoRaw.upgradeCooldownMs, fallback.auto.upgradeCooldownMs), 0, 120000, fallback.auto.upgradeCooldownMs),
      jankFrameMs: clampNumber(readNumber(autoRaw.jankFrameMs, fallback.auto.jankFrameMs), 16, 250, fallback.auto.jankFrameMs),
      jankRatioDowngrade: clampNumber(readNumber(autoRaw.jankRatioDowngrade, fallback.auto.jankRatioDowngrade), 0, 1, fallback.auto.jankRatioDowngrade),
      jankRatioUpgrade: clampNumber(readNumber(autoRaw.jankRatioUpgrade, fallback.auto.jankRatioUpgrade), 0, 1, fallback.auto.jankRatioUpgrade),
    },
  };
}

export function compareQualityLevels(a: QualityLevel, b: QualityLevel): number {
  return QUALITY_LEVELS.indexOf(a) - QUALITY_LEVELS.indexOf(b);
}

export function clampQualityLevel(level: QualityLevel, min: QualityLevel, max: QualityLevel): QualityLevel {
  const minIndex = QUALITY_LEVELS.indexOf(min);
  const maxIndex = QUALITY_LEVELS.indexOf(max);
  const lo = Math.min(minIndex, maxIndex);
  const hi = Math.max(minIndex, maxIndex);
  const idx = QUALITY_LEVELS.indexOf(level);
  const clamped = Math.max(lo, Math.min(hi, idx));
  return QUALITY_LEVELS[clamped] ?? level;
}

export function nextLowerQuality(level: QualityLevel): QualityLevel {
  const idx = QUALITY_LEVELS.indexOf(level);
  return QUALITY_LEVELS[Math.max(0, idx - 1)] ?? level;
}

export function nextHigherQuality(level: QualityLevel): QualityLevel {
  const idx = QUALITY_LEVELS.indexOf(level);
  return QUALITY_LEVELS[Math.min(QUALITY_LEVELS.length - 1, idx + 1)] ?? level;
}

export function resolveQualityProfile(level: QualityLevel): Omit<QualityEffectiveConfig, 'level'> {
  switch (level) {
    case 'ultra':
      return {
        renderScale: 1.0,
        fpsForeground: 0,
        fpsBackground: 12,
        fpsEffects: 60,
        visualizerBars: 48,
        matrixRainDensity: 1.0,
        shaderResolutionScale: 1.0,
        shaderFpsLimit: undefined,
      };
    case 'high':
      return {
        renderScale: 1.0,
        fpsForeground: 60,
        fpsBackground: 10,
        fpsEffects: 45,
        visualizerBars: 40,
        matrixRainDensity: 0.85,
        shaderResolutionScale: 0.9,
        shaderFpsLimit: 60,
      };
    case 'balanced':
      return {
        renderScale: 0.85,
        fpsForeground: 60,
        fpsBackground: 10,
        fpsEffects: 30,
        visualizerBars: 32,
        matrixRainDensity: 0.7,
        shaderResolutionScale: 0.75,
        shaderFpsLimit: 45,
      };
    case 'low':
      return {
        renderScale: 0.72,
        fpsForeground: 45,
        fpsBackground: 8,
        fpsEffects: 20,
        visualizerBars: 24,
        matrixRainDensity: 0.5,
        shaderResolutionScale: 0.6,
        shaderFpsLimit: 30,
      };
    case 'potato':
    default:
      return {
        renderScale: 0.45,
        fpsForeground: 30,
        fpsBackground: 6,
        fpsEffects: 15,
        visualizerBars: 16,
        matrixRainDensity: 0.35,
        shaderResolutionScale: 0.5,
        shaderFpsLimit: 24,
      };
  }
}

export function resolveEffectiveQualityForLevel(level: QualityLevel): QualityEffectiveConfig {
  return { level, ...resolveQualityProfile(level) };
}

export function guessInitialAutoQualityLevel(settings: QualitySettingsV1): { level: QualityLevel; detail: string } {
  const min = settings.auto.minLevel;
  const max = settings.auto.maxLevel;

  const dmc = (() => {
    try {
      const n = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
      return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
    } catch {
      return undefined;
    }
  })();

  const cores = (() => {
    try {
      const n = navigator.hardwareConcurrency;
      return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
    } catch {
      return undefined;
    }
  })();

  const prefersReducedMotion = (() => {
    try {
      return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    } catch {
      return false;
    }
  })();

  let level: QualityLevel = 'balanced';
  let detail = 'default';

  if (prefersReducedMotion) {
    level = 'low';
    detail = 'prefers-reduced-motion';
  } else if (typeof dmc === 'number') {
    if (dmc <= 4) {
      level = 'low';
      detail = `deviceMemory<=${dmc}`;
    } else if (dmc >= 16) {
      level = 'high';
      detail = `deviceMemory>=${dmc}`;
    } else {
      level = 'balanced';
      detail = `deviceMemory=${dmc}`;
    }
  } else if (typeof cores === 'number') {
    if (cores <= 4) {
      level = 'low';
      detail = `cores<=${cores}`;
    } else if (cores >= 12) {
      level = 'high';
      detail = `cores>=${cores}`;
    } else {
      level = 'balanced';
      detail = `cores=${cores}`;
    }
  }

  level = clampQualityLevel(level, min, max);
  return { level, detail };
}
