import {
  DEFAULT_PERFORMANCE_CONTROL_SETTINGS,
  PERFORMANCE_RUNTIME_PRESETS,
  parsePerformanceRuntimeProfile,
  resolvePerformanceRuntimePresetSettings,
  type PerformanceRuntimePreset,
  type PerformanceRuntimeProfile,
} from '../../contracts/performanceControl';
import { parseQualitySettings, type QualitySettingsV1 } from '../../contracts/quality';
import { readJson, readString, writeJson } from '../storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

function isQualitySettingsEqual(a: QualitySettingsV1, b: QualitySettingsV1): boolean {
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

function readRuntimeProfile(): { persisted: string | null; parsed: PerformanceRuntimeProfile } {
  const persisted = readString(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE);
  const parsed = parsePerformanceRuntimeProfile(
    readJson<unknown>(
      STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE,
      DEFAULT_PERFORMANCE_CONTROL_SETTINGS.runtimeProfile
    ),
    DEFAULT_PERFORMANCE_CONTROL_SETTINGS.runtimeProfile
  );
  return { persisted, parsed };
}

function resolveForcedRuntimePresetFromEnv(): PerformanceRuntimePreset | null {
  const envValue = import.meta.env.VITE_PERF_RUNTIME_PROFILE;
  if (typeof envValue !== 'string') {
    return null;
  }

  const parsed = parsePerformanceRuntimeProfile(envValue.trim().toLowerCase(), 'custom');
  if (!PERFORMANCE_RUNTIME_PRESETS.includes(parsed as PerformanceRuntimePreset)) {
    return null;
  }

  return parsed as PerformanceRuntimePreset;
}

export type PerformanceRuntimeBootstrapResult = {
  runtimeProfile: PerformanceRuntimeProfile;
  alignedKeys: string[];
};

export function bootstrapPerformanceRuntimeProfileStorage(): PerformanceRuntimeBootstrapResult {
  let { persisted, parsed } = readRuntimeProfile();
  const forcedPreset = resolveForcedRuntimePresetFromEnv();
  if (forcedPreset && parsed !== forcedPreset) {
    writeJson(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE, forcedPreset, { mode: 'sync' });
    persisted = JSON.stringify(forcedPreset);
    parsed = forcedPreset;
  }

  const alignedKeys: string[] = [];
  if (forcedPreset) {
    alignedKeys.push(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE);
  }

  if (parsed === 'custom') {
    if (persisted === null) {
      writeJson(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE, 'custom', { mode: 'sync' });
      return {
        runtimeProfile: 'custom',
        alignedKeys: [
          ...alignedKeys,
          STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE,
        ],
      };
    }
    return {
      runtimeProfile: parsed,
      alignedKeys,
    };
  }

  const preset = resolvePerformanceRuntimePresetSettings(parsed);

  if (persisted === null) {
    writeJson(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE, parsed, { mode: 'sync' });
    if (!alignedKeys.includes(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE)) {
      alignedKeys.push(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE);
    }
  }

  const editorLowPerformanceMode = readJson<boolean>(
    STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE,
    preset.editorLowPerformanceMode
  );
  if (editorLowPerformanceMode !== preset.editorLowPerformanceMode) {
    writeJson(STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE, preset.editorLowPerformanceMode, {
      mode: 'sync',
    });
    alignedKeys.push(STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE);
  }

  const gifImportMaxFps = readJson<number>(
    STORAGE_KEYS.BACKGROUND_GIF_IMPORT_MAX_FPS,
    preset.gifImportMaxFps
  );
  if (gifImportMaxFps !== preset.gifImportMaxFps) {
    writeJson(STORAGE_KEYS.BACKGROUND_GIF_IMPORT_MAX_FPS, preset.gifImportMaxFps, { mode: 'sync' });
    alignedKeys.push(STORAGE_KEYS.BACKGROUND_GIF_IMPORT_MAX_FPS);
  }

  const coverMaxEdgePx = readJson<number>(
    STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX,
    preset.coverMaxEdgePx
  );
  if (coverMaxEdgePx !== preset.coverMaxEdgePx) {
    writeJson(STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX, preset.coverMaxEdgePx, { mode: 'sync' });
    alignedKeys.push(STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX);
  }

  const backgroundRenderPolicy = readJson<string>(
    STORAGE_KEYS.BACKGROUND_RENDER_POLICY,
    preset.backgroundRenderPolicy
  );
  if (backgroundRenderPolicy !== preset.backgroundRenderPolicy) {
    writeJson(STORAGE_KEYS.BACKGROUND_RENDER_POLICY, preset.backgroundRenderPolicy, { mode: 'sync' });
    alignedKeys.push(STORAGE_KEYS.BACKGROUND_RENDER_POLICY);
  }

  const memoryGovernanceAutoEnabled = readJson<boolean>(
    STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED,
    preset.memoryGovernanceAutoEnabled
  );
  if (memoryGovernanceAutoEnabled !== preset.memoryGovernanceAutoEnabled) {
    writeJson(STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED, preset.memoryGovernanceAutoEnabled, {
      mode: 'sync',
    });
    alignedKeys.push(STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED);
  }

  const uiQualitySettings = parseQualitySettings(
    readJson<unknown>(STORAGE_KEYS.UI_QUALITY_SETTINGS_V1, preset.uiQualitySettings),
    preset.uiQualitySettings
  );
  if (!isQualitySettingsEqual(uiQualitySettings, preset.uiQualitySettings)) {
    writeJson(STORAGE_KEYS.UI_QUALITY_SETTINGS_V1, preset.uiQualitySettings, { mode: 'sync' });
    alignedKeys.push(STORAGE_KEYS.UI_QUALITY_SETTINGS_V1);
  }

  return {
    runtimeProfile: parsed,
    alignedKeys,
  };
}
