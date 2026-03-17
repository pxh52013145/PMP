import type { MemoryGovernanceRunResult } from './memoryGovernance';
import type { BackgroundRenderPolicy } from './performance';
import type { QualitySnapshot } from './quality';
import type { QualitySettingsV1 } from './quality';

export type PerformancePressureLevel = 'normal' | 'watch' | 'high';

export const PERFORMANCE_RUNTIME_PROFILES = ['minimal', 'balanced', 'boosted', 'custom'] as const;

export const PERFORMANCE_RUNTIME_PRESETS = ['minimal', 'balanced', 'boosted'] as const;

export type PerformanceRuntimeProfile = (typeof PERFORMANCE_RUNTIME_PROFILES)[number];

export type PerformanceRuntimePreset = (typeof PERFORMANCE_RUNTIME_PRESETS)[number];

export function parsePerformanceRuntimeProfile(
  value: unknown,
  fallback: PerformanceRuntimeProfile = 'custom'
): PerformanceRuntimeProfile {
  if (value === 'minimal' || value === 'balanced' || value === 'boosted' || value === 'custom') {
    return value;
  }
  return fallback;
}

export type PerformanceControlWebview2Snapshot = {
  sampledAtMs: number;
  webview2PrivateBytes: number;
  webview2WorkingSetBytes: number;
  webview2CpuPercent: number | null;
  treePrivateBytes?: number;
  treeWorkingSetBytes?: number;
  treeCpuPercent?: number | null;
  systemMemoryLoadPercent?: number | null;
  systemMemoryTotalBytes?: number | null;
  systemMemoryAvailableBytes?: number | null;
};

export type PerformanceControlSettingsSnapshot = {
  runtimeProfile: PerformanceRuntimeProfile;
  editorLowPerformanceMode: boolean;
  gifImportMaxFps: number;
  coverMaxEdgePx: number;
  backgroundRenderPolicy: BackgroundRenderPolicy;
  memoryGovernanceAutoEnabled: boolean;
  uiQualitySettings: QualitySettingsV1;
};

const MINIMAL_QUALITY_SETTINGS: QualitySettingsV1 = {
  version: 1,
  mode: 'fixed',
  fixedLevel: 'potato',
  auto: {
    minLevel: 'potato',
    maxLevel: 'low',
    targetFpsForeground: 30,
    targetFpsBackground: 6,
    sampleWindowMs: 2200,
    downgradeCooldownMs: 1800,
    upgradeCooldownMs: 12000,
    jankFrameMs: 48,
    jankRatioDowngrade: 0.2,
    jankRatioUpgrade: 0.04,
  },
};

const BALANCED_QUALITY_SETTINGS: QualitySettingsV1 = {
  version: 1,
  mode: 'auto',
  fixedLevel: 'balanced',
  auto: {
    minLevel: 'potato',
    maxLevel: 'balanced',
    targetFpsForeground: 45,
    targetFpsBackground: 8,
    sampleWindowMs: 2500,
    downgradeCooldownMs: 2200,
    upgradeCooldownMs: 10000,
    jankFrameMs: 48,
    jankRatioDowngrade: 0.2,
    jankRatioUpgrade: 0.05,
  },
};

const BOOSTED_QUALITY_SETTINGS: QualitySettingsV1 = {
  version: 1,
  mode: 'auto',
  fixedLevel: 'high',
  auto: {
    minLevel: 'low',
    maxLevel: 'ultra',
    targetFpsForeground: 60,
    targetFpsBackground: 12,
    sampleWindowMs: 3000,
    downgradeCooldownMs: 2500,
    upgradeCooldownMs: 12000,
    jankFrameMs: 50,
    jankRatioDowngrade: 0.22,
    jankRatioUpgrade: 0.05,
  },
};

export type PerformanceRuntimeProfileSettings = Omit<PerformanceControlSettingsSnapshot, 'runtimeProfile'>;

const PERFORMANCE_RUNTIME_PRESET_SETTINGS: Record<
  PerformanceRuntimePreset,
  PerformanceRuntimeProfileSettings
> = {
  minimal: {
    editorLowPerformanceMode: true,
    gifImportMaxFps: 15,
    coverMaxEdgePx: 128,
    backgroundRenderPolicy: 'pause',
    memoryGovernanceAutoEnabled: true,
    uiQualitySettings: MINIMAL_QUALITY_SETTINGS,
  },
  balanced: {
    editorLowPerformanceMode: false,
    gifImportMaxFps: 24,
    coverMaxEdgePx: 256,
    backgroundRenderPolicy: 'throttle',
    memoryGovernanceAutoEnabled: true,
    uiQualitySettings: BALANCED_QUALITY_SETTINGS,
  },
  boosted: {
    editorLowPerformanceMode: false,
    gifImportMaxFps: 30,
    coverMaxEdgePx: 512,
    backgroundRenderPolicy: 'full',
    memoryGovernanceAutoEnabled: false,
    uiQualitySettings: BOOSTED_QUALITY_SETTINGS,
  },
};

function cloneQualitySettings(settings: QualitySettingsV1): QualitySettingsV1 {
  return {
    version: 1,
    mode: settings.mode,
    fixedLevel: settings.fixedLevel,
    auto: { ...settings.auto },
  };
}

function cloneRuntimeProfileComparableSettings(
  settings: PerformanceRuntimeProfileSettings
): PerformanceRuntimeProfileSettings {
  return {
    editorLowPerformanceMode: settings.editorLowPerformanceMode,
    gifImportMaxFps: settings.gifImportMaxFps,
    coverMaxEdgePx: settings.coverMaxEdgePx,
    backgroundRenderPolicy: settings.backgroundRenderPolicy,
    memoryGovernanceAutoEnabled: settings.memoryGovernanceAutoEnabled,
    uiQualitySettings: cloneQualitySettings(settings.uiQualitySettings),
  };
}

function areQualitySettingsEqual(a: QualitySettingsV1, b: QualitySettingsV1): boolean {
  return (
    a.version === b.version &&
    a.mode === b.mode &&
    a.fixedLevel === b.fixedLevel &&
    a.auto.minLevel === b.auto.minLevel &&
    a.auto.maxLevel === b.auto.maxLevel &&
    a.auto.targetFpsForeground === b.auto.targetFpsForeground &&
    a.auto.targetFpsBackground === b.auto.targetFpsBackground &&
    a.auto.sampleWindowMs === b.auto.sampleWindowMs &&
    a.auto.downgradeCooldownMs === b.auto.downgradeCooldownMs &&
    a.auto.upgradeCooldownMs === b.auto.upgradeCooldownMs &&
    a.auto.jankFrameMs === b.auto.jankFrameMs &&
    a.auto.jankRatioDowngrade === b.auto.jankRatioDowngrade &&
    a.auto.jankRatioUpgrade === b.auto.jankRatioUpgrade
  );
}

function areRuntimeProfileSettingsEqual(
  a: PerformanceRuntimeProfileSettings,
  b: PerformanceRuntimeProfileSettings
): boolean {
  return (
    a.editorLowPerformanceMode === b.editorLowPerformanceMode &&
    a.gifImportMaxFps === b.gifImportMaxFps &&
    a.coverMaxEdgePx === b.coverMaxEdgePx &&
    a.backgroundRenderPolicy === b.backgroundRenderPolicy &&
    a.memoryGovernanceAutoEnabled === b.memoryGovernanceAutoEnabled &&
    areQualitySettingsEqual(a.uiQualitySettings, b.uiQualitySettings)
  );
}

export function resolvePerformanceRuntimePresetSettings(
  preset: PerformanceRuntimePreset
): PerformanceRuntimeProfileSettings {
  return cloneRuntimeProfileComparableSettings(PERFORMANCE_RUNTIME_PRESET_SETTINGS[preset]);
}

export function inferPerformanceRuntimeProfile(
  settings: PerformanceRuntimeProfileSettings
): PerformanceRuntimeProfile {
  for (const preset of PERFORMANCE_RUNTIME_PRESETS) {
    const presetSettings = PERFORMANCE_RUNTIME_PRESET_SETTINGS[preset];
    if (areRuntimeProfileSettingsEqual(settings, presetSettings)) {
      return preset;
    }
  }
  return 'custom';
}

const DEFAULT_PERFORMANCE_RUNTIME_PRESET: PerformanceRuntimePreset = 'minimal';

const DEFAULT_RUNTIME_SETTINGS = resolvePerformanceRuntimePresetSettings(
  DEFAULT_PERFORMANCE_RUNTIME_PRESET
);

export const DEFAULT_PERFORMANCE_CONTROL_SETTINGS: PerformanceControlSettingsSnapshot = {
  runtimeProfile: DEFAULT_PERFORMANCE_RUNTIME_PRESET,
  editorLowPerformanceMode: DEFAULT_RUNTIME_SETTINGS.editorLowPerformanceMode,
  gifImportMaxFps: DEFAULT_RUNTIME_SETTINGS.gifImportMaxFps,
  coverMaxEdgePx: DEFAULT_RUNTIME_SETTINGS.coverMaxEdgePx,
  backgroundRenderPolicy: DEFAULT_RUNTIME_SETTINGS.backgroundRenderPolicy,
  memoryGovernanceAutoEnabled: DEFAULT_RUNTIME_SETTINGS.memoryGovernanceAutoEnabled,
  uiQualitySettings: DEFAULT_RUNTIME_SETTINGS.uiQualitySettings,
};

export type PerformanceControlSnapshot = {
  updatedAtMs: number;
  pressure: PerformancePressureLevel;
  settings: PerformanceControlSettingsSnapshot;
  quality: {
    mode: QualitySnapshot['settings']['mode'];
    level: QualitySnapshot['effective']['level'];
    renderScale: number;
    fpsForeground: number;
    fpsBackground: number;
    lastDecision: QualitySnapshot['lastDecision'];
  };
  governance: {
    tier: number;
    actions: string[];
    reason: MemoryGovernanceRunResult['plan'] | null;
    atMs: number | null;
  };
  webview2: PerformanceControlWebview2Snapshot | null;
};

export const DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT: PerformanceControlSnapshot = {
  updatedAtMs: 0,
  pressure: 'normal',
  settings: DEFAULT_PERFORMANCE_CONTROL_SETTINGS,
  quality: {
    mode: 'auto',
    level: 'balanced',
    renderScale: 1,
    fpsForeground: 60,
    fpsBackground: 10,
    lastDecision: undefined,
  },
  governance: {
    tier: 0,
    actions: [],
    reason: null,
    atMs: null,
  },
  webview2: null,
};

export function resolvePerformancePressureLevel(input: {
  memoryTier: number;
  webview2PrivateBytes: number;
  webview2CpuPercent: number | null;
}): PerformancePressureLevel {
  const webview2Cpu = input.webview2CpuPercent ?? 0;

  if (input.memoryTier >= 2 || input.webview2PrivateBytes >= 850 * 1024 * 1024 || webview2Cpu >= 55) {
    return 'high';
  }
  if (input.memoryTier >= 1 || input.webview2PrivateBytes >= 650 * 1024 * 1024 || webview2Cpu >= 35) {
    return 'watch';
  }
  return 'normal';
}
