import { createServiceToken } from '../../kernel';
import type { ScopedEventBus } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import {
  DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT,
  inferPerformanceRuntimeProfile,
  PERFORMANCE_RUNTIME_PRESETS,
  parsePerformanceRuntimeProfile,
  type PerformanceControlSettingsSnapshot,
  type PerformanceRuntimeProfile,
  resolvePerformanceRuntimePresetSettings,
  resolvePerformancePressureLevel,
  type PerformanceControlSnapshot,
} from '../../contracts/performanceControl';
import {
  DEFAULT_BACKGROUND_RENDER_POLICY,
  parseBackgroundRenderPolicy,
  type BackgroundRenderPolicy,
} from '../../contracts/performance';
import {
  parseQualitySettings,
  type QualitySettingsV1,
} from '../../contracts/quality';
import { readJson, readString } from '../../modules/storage';
import { applyEditorLowPerformanceMode } from '../../utils/editorWindowEffects';
import { broadcastDataUpdate, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import type { ProcessPerfService } from './ProcessPerfService';

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const normalized = Math.round(value);
  return Math.max(min, Math.min(max, normalized));
}

function mergeRuntimeProfileSettings(
  profile: PerformanceRuntimeProfile,
  fallback: PerformanceControlSettingsSnapshot
): PerformanceControlSettingsSnapshot {
  const parsedProfile = parsePerformanceRuntimeProfile(profile, fallback.runtimeProfile);
  if (parsedProfile === 'custom') {
    const normalized = {
      editorLowPerformanceMode: fallback.editorLowPerformanceMode,
      gifImportMaxFps: fallback.gifImportMaxFps,
      coverMaxEdgePx: fallback.coverMaxEdgePx,
      backgroundRenderPolicy: fallback.backgroundRenderPolicy,
      memoryGovernanceAutoEnabled: fallback.memoryGovernanceAutoEnabled,
      uiQualitySettings: parseQualitySettings(fallback.uiQualitySettings, fallback.uiQualitySettings),
    };

    return {
      runtimeProfile: inferPerformanceRuntimeProfile(normalized),
      ...normalized,
    };
  }

  if (!PERFORMANCE_RUNTIME_PRESETS.includes(parsedProfile)) {
    const normalizedQuality = parseQualitySettings(
      fallback.uiQualitySettings,
      fallback.uiQualitySettings
    );
    return {
      runtimeProfile: inferPerformanceRuntimeProfile({
        editorLowPerformanceMode: fallback.editorLowPerformanceMode,
        gifImportMaxFps: fallback.gifImportMaxFps,
        coverMaxEdgePx: fallback.coverMaxEdgePx,
        backgroundRenderPolicy: fallback.backgroundRenderPolicy,
        memoryGovernanceAutoEnabled: fallback.memoryGovernanceAutoEnabled,
        uiQualitySettings: normalizedQuality,
      }),
      editorLowPerformanceMode: fallback.editorLowPerformanceMode,
      gifImportMaxFps: fallback.gifImportMaxFps,
      coverMaxEdgePx: fallback.coverMaxEdgePx,
      backgroundRenderPolicy: fallback.backgroundRenderPolicy,
      memoryGovernanceAutoEnabled: fallback.memoryGovernanceAutoEnabled,
      uiQualitySettings: normalizedQuality,
    };
  }

  const presetSettings = resolvePerformanceRuntimePresetSettings(parsedProfile);
  return {
    runtimeProfile: parsedProfile,
    ...presetSettings,
  };
}

function sanitizeRuntimeProfileByFieldOverrides(
  next: PerformanceControlSettingsSnapshot
): PerformanceControlSettingsSnapshot {
  if (next.runtimeProfile === 'custom') return next;

  const inferred = inferPerformanceRuntimeProfile({
    editorLowPerformanceMode: next.editorLowPerformanceMode,
    gifImportMaxFps: next.gifImportMaxFps,
    coverMaxEdgePx: next.coverMaxEdgePx,
    backgroundRenderPolicy: next.backgroundRenderPolicy,
    memoryGovernanceAutoEnabled: next.memoryGovernanceAutoEnabled,
    uiQualitySettings: next.uiQualitySettings,
  });

  if (inferred !== next.runtimeProfile) {
    return {
      ...next,
      runtimeProfile: 'custom',
    };
  }

  return next;
}

export interface PerformanceControlService {
  getSnapshot(): PerformanceControlSnapshot;
  getSettingsSnapshot(): PerformanceControlSettingsSnapshot;
  refreshSettingsFromStorage(): PerformanceControlSettingsSnapshot;
  refreshNow(): Promise<PerformanceControlSnapshot>;
  syncEditorEffectsFromSettings(): Promise<void>;
  setRuntimeProfile(profile: PerformanceRuntimeProfile): Promise<void>;
  setEditorLowPerformanceMode(enabled: boolean): Promise<void>;
  setGifImportMaxFps(value: number): Promise<void>;
  setCoverMaxEdgePx(value: number): Promise<void>;
  setBackgroundRenderPolicy(policy: BackgroundRenderPolicy): Promise<void>;
  setMemoryGovernanceAutoEnabled(enabled: boolean): Promise<void>;
  setUiQualitySettings(settings: QualitySettingsV1): Promise<void>;
  updateUiQualitySettings(next: QualitySettingsV1 | ((prev: QualitySettingsV1) => QualitySettingsV1)): Promise<void>;
}

export const PERFORMANCE_CONTROL_SERVICE_TOKEN = createServiceToken<PerformanceControlService>(
  'service.performanceControl'
);

export class DefaultPerformanceControlService implements PerformanceControlService {
  private snapshot: PerformanceControlSnapshot = DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT;

  constructor(
    private readonly events: ScopedEventBus<AppEvents>,
    private readonly processPerfService: ProcessPerfService
  ) {
    this.refreshSettingsFromStorage();
  }

  getSnapshot(): PerformanceControlSnapshot {
    return this.snapshot;
  }

  getSettingsSnapshot(): PerformanceControlSettingsSnapshot {
    return this.snapshot.settings;
  }

  refreshSettingsFromStorage(): PerformanceControlSettingsSnapshot {
    const baseFallback = DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT.settings;
    const hasRuntimeProfile = readString(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE) !== null;
    const runtimeProfile = parsePerformanceRuntimeProfile(
      readJson<unknown>(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE, baseFallback.runtimeProfile),
      baseFallback.runtimeProfile
    );
    const profileBaseline = mergeRuntimeProfileSettings(runtimeProfile, baseFallback);

    if (!hasRuntimeProfile) {
      this.snapshot = {
        ...this.snapshot,
        updatedAtMs: Date.now(),
        settings: profileBaseline,
      };
      this.events.emit('performance-control/changed', this.snapshot);
      return profileBaseline;
    }

    const nextSettings: PerformanceControlSettingsSnapshot = {
      runtimeProfile,
      editorLowPerformanceMode: parseBoolean(
        readJson<unknown>(
          STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE,
          profileBaseline.editorLowPerformanceMode
        ),
        profileBaseline.editorLowPerformanceMode
      ),
      gifImportMaxFps: clampInteger(
        readJson<unknown>(
          STORAGE_KEYS.BACKGROUND_GIF_IMPORT_MAX_FPS,
          profileBaseline.gifImportMaxFps
        ),
        0,
        60,
        profileBaseline.gifImportMaxFps
      ),
      coverMaxEdgePx: clampInteger(
        readJson<unknown>(
          STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX,
          profileBaseline.coverMaxEdgePx
        ),
        0,
        4096,
        profileBaseline.coverMaxEdgePx
      ),
      backgroundRenderPolicy: parseBackgroundRenderPolicy(
        readJson<unknown>(
          STORAGE_KEYS.BACKGROUND_RENDER_POLICY,
          profileBaseline.backgroundRenderPolicy
        ),
        profileBaseline.backgroundRenderPolicy
      ),
      memoryGovernanceAutoEnabled: parseBoolean(
        readJson<unknown>(
          STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED,
          profileBaseline.memoryGovernanceAutoEnabled
        ),
        profileBaseline.memoryGovernanceAutoEnabled
      ),
      uiQualitySettings: parseQualitySettings(
        readJson<unknown>(STORAGE_KEYS.UI_QUALITY_SETTINGS_V1, profileBaseline.uiQualitySettings),
        profileBaseline.uiQualitySettings
      ),
    };

    const normalizedSettings = sanitizeRuntimeProfileByFieldOverrides(nextSettings);

    this.snapshot = {
      ...this.snapshot,
      updatedAtMs: Date.now(),
      settings: normalizedSettings,
    };
    this.events.emit('performance-control/changed', this.snapshot);
    return normalizedSettings;
  }

  async setRuntimeProfile(profile: PerformanceRuntimeProfile): Promise<void> {
    const parsed = parsePerformanceRuntimeProfile(profile, this.snapshot.settings.runtimeProfile);
    const merged = mergeRuntimeProfileSettings(parsed, this.snapshot.settings);

    await Promise.all([
      broadcastDataUpdate(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE, merged.runtimeProfile),
      broadcastDataUpdate(STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE, merged.editorLowPerformanceMode),
      broadcastDataUpdate(STORAGE_KEYS.BACKGROUND_GIF_IMPORT_MAX_FPS, merged.gifImportMaxFps),
      broadcastDataUpdate(STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX, merged.coverMaxEdgePx),
      broadcastDataUpdate(
        STORAGE_KEYS.BACKGROUND_RENDER_POLICY,
        merged.backgroundRenderPolicy,
        TAURI_EVENTS.BACKGROUND_RENDER_POLICY_UPDATED
      ),
      broadcastDataUpdate(STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED, merged.memoryGovernanceAutoEnabled),
      broadcastDataUpdate(
        STORAGE_KEYS.UI_QUALITY_SETTINGS_V1,
        merged.uiQualitySettings,
        TAURI_EVENTS.UI_QUALITY_SETTINGS_UPDATED
      ),
    ]);

    await applyEditorLowPerformanceMode(merged.editorLowPerformanceMode);
    this.refreshSettingsFromStorage();
  }

  async setEditorLowPerformanceMode(enabled: boolean): Promise<void> {
    const next = !!enabled;
    await broadcastDataUpdate(STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE, next);
    await applyEditorLowPerformanceMode(next);
    this.refreshSettingsFromStorage();
  }

  async setGifImportMaxFps(value: number): Promise<void> {
    const next = clampInteger(value, 0, 60, 30);
    await broadcastDataUpdate(STORAGE_KEYS.BACKGROUND_GIF_IMPORT_MAX_FPS, next);
    this.refreshSettingsFromStorage();
  }

  async setCoverMaxEdgePx(value: number): Promise<void> {
    const next = clampInteger(value, 0, 4096, 256);
    await broadcastDataUpdate(STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX, next);
    this.refreshSettingsFromStorage();
  }

  async setBackgroundRenderPolicy(policy: BackgroundRenderPolicy): Promise<void> {
    const next = parseBackgroundRenderPolicy(policy, DEFAULT_BACKGROUND_RENDER_POLICY);
    await broadcastDataUpdate(
      STORAGE_KEYS.BACKGROUND_RENDER_POLICY,
      next,
      TAURI_EVENTS.BACKGROUND_RENDER_POLICY_UPDATED
    );
    this.refreshSettingsFromStorage();
  }

  async setMemoryGovernanceAutoEnabled(enabled: boolean): Promise<void> {
    await broadcastDataUpdate(STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED, !!enabled);
    this.refreshSettingsFromStorage();
  }

  async setUiQualitySettings(settings: QualitySettingsV1): Promise<void> {
    const next = parseQualitySettings(settings, this.snapshot.settings.uiQualitySettings);
    await broadcastDataUpdate(
      STORAGE_KEYS.UI_QUALITY_SETTINGS_V1,
      next,
      TAURI_EVENTS.UI_QUALITY_SETTINGS_UPDATED
    );
    this.refreshSettingsFromStorage();
  }

  async updateUiQualitySettings(
    next: QualitySettingsV1 | ((prev: QualitySettingsV1) => QualitySettingsV1)
  ): Promise<void> {
    const current = this.snapshot.settings.uiQualitySettings;
    const resolved = typeof next === 'function' ? next(current) : next;
    await this.setUiQualitySettings(resolved);
  }

  async refreshNow(): Promise<PerformanceControlSnapshot> {
    const previous = this.snapshot;

    let webview2 = previous.webview2;
    const totals = await this.processPerfService.refreshTotalsSnapshot();
    if (totals) {
      webview2 = {
        sampledAtMs: totals.timestampMs,
        webview2PrivateBytes: totals.totals.webview2PrivateBytes,
        webview2WorkingSetBytes: totals.totals.webview2WorkingSetBytes,
        webview2CpuPercent: totals.totals.webview2CpuPercent,
        treePrivateBytes: totals.totals.privateBytes,
        treeWorkingSetBytes: totals.totals.workingSetBytes,
        treeCpuPercent: totals.totals.cpuPercent,
        systemMemoryLoadPercent: totals.systemMemory?.memoryLoadPercent ?? null,
        systemMemoryTotalBytes: totals.systemMemory?.totalPhysicalBytes ?? null,
        systemMemoryAvailableBytes: totals.systemMemory?.availablePhysicalBytes ?? null,
      };
    } else if (this.processPerfService.getSnapshot().availability !== 'ready') {
      webview2 = null;
    }

    this.snapshot = {
      ...previous,
      updatedAtMs: Date.now(),
      webview2,
      pressure: resolvePerformancePressureLevel({
        memoryTier: previous.governance.tier,
        webview2PrivateBytes: webview2?.webview2PrivateBytes ?? 0,
        webview2CpuPercent: webview2?.webview2CpuPercent ?? 0,
      }),
    };
    this.events.emit('performance-control/changed', this.snapshot);
    return this.snapshot;
  }

  async syncEditorEffectsFromSettings(): Promise<void> {
    await applyEditorLowPerformanceMode(this.snapshot.settings.editorLowPerformanceMode);
  }

  applyQualitySnapshot(snapshot: AppEvents['quality/changed']): void {
    this.snapshot = {
      ...this.snapshot,
      updatedAtMs: Date.now(),
      quality: {
        mode: snapshot.settings.mode,
        level: snapshot.effective.level,
        renderScale: snapshot.effective.renderScale,
        fpsForeground: snapshot.effective.fpsForeground,
        fpsBackground: snapshot.effective.fpsBackground,
        lastDecision: snapshot.lastDecision,
      },
    };
    this.events.emit('performance-control/changed', this.snapshot);
  }

  applyGovernanceSnapshot(result: AppEvents['memory-governance/ran']): void {
    this.snapshot = {
      ...this.snapshot,
      updatedAtMs: Date.now(),
      governance: {
        tier: result.plan.tier,
        actions: result.executed,
        reason: result.plan,
        atMs: result.snapshot.atMs,
      },
      webview2: result.snapshot.webview2
        ? {
            sampledAtMs: result.snapshot.webview2.processSampleAtMs,
            webview2PrivateBytes: result.snapshot.webview2.webview2PrivateBytes,
            webview2WorkingSetBytes: result.snapshot.webview2.webview2WorkingSetBytes,
            webview2CpuPercent: result.snapshot.webview2.webview2CpuPercent,
            treePrivateBytes: result.snapshot.webview2.treePrivateBytes,
            treeWorkingSetBytes: result.snapshot.webview2.treeWorkingSetBytes,
            treeCpuPercent: result.snapshot.webview2.treeCpuPercent,
          }
        : this.snapshot.webview2,
    };

    this.snapshot = {
      ...this.snapshot,
      pressure: resolvePerformancePressureLevel({
        memoryTier: this.snapshot.governance.tier,
        webview2PrivateBytes: this.snapshot.webview2?.webview2PrivateBytes ?? 0,
        webview2CpuPercent: this.snapshot.webview2?.webview2CpuPercent ?? 0,
      }),
    };

    this.events.emit('performance-control/changed', this.snapshot);
  }
}
