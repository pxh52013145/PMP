import { createServiceToken } from '../../kernel';
import type { ScopedEventBus } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import {
  DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT,
  type PerformanceControlSettingsSnapshot,
  resolvePerformancePressureLevel,
  type PerformanceControlSnapshot,
} from '../../contracts/performanceControl';
import {
  DEFAULT_BACKGROUND_RENDER_POLICY,
  parseBackgroundRenderPolicy,
  type BackgroundRenderPolicy,
} from '../../contracts/performance';
import { DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED } from '../../contracts/memoryGovernance';
import {
  DEFAULT_QUALITY_SETTINGS_V1,
  parseQualitySettings,
  type QualitySettingsV1,
} from '../../contracts/quality';
import { readJson } from '../../modules/storage';
import { getProcessPerfTotalsSnapshot } from '../../modules/debug';
import { applyEditorLowPerformanceMode } from '../../utils/editorWindowEffects';
import { broadcastDataUpdate, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const normalized = Math.round(value);
  return Math.max(min, Math.min(max, normalized));
}

export interface PerformanceControlService {
  getSnapshot(): PerformanceControlSnapshot;
  getSettingsSnapshot(): PerformanceControlSettingsSnapshot;
  refreshSettingsFromStorage(): PerformanceControlSettingsSnapshot;
  refreshNow(): Promise<PerformanceControlSnapshot>;
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

  constructor(private readonly events: ScopedEventBus<AppEvents>) {
    this.refreshSettingsFromStorage();
  }

  getSnapshot(): PerformanceControlSnapshot {
    return this.snapshot;
  }

  getSettingsSnapshot(): PerformanceControlSettingsSnapshot {
    return this.snapshot.settings;
  }

  refreshSettingsFromStorage(): PerformanceControlSettingsSnapshot {
    const nextSettings: PerformanceControlSettingsSnapshot = {
      editorLowPerformanceMode: parseBoolean(
        readJson<unknown>(STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE, false),
        false
      ),
      gifImportMaxFps: clampInteger(
        readJson<unknown>(STORAGE_KEYS.BACKGROUND_GIF_IMPORT_MAX_FPS, 30),
        0,
        60,
        30
      ),
      coverMaxEdgePx: clampInteger(
        readJson<unknown>(STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX, 256),
        0,
        4096,
        256
      ),
      backgroundRenderPolicy: parseBackgroundRenderPolicy(
        readJson<unknown>(STORAGE_KEYS.BACKGROUND_RENDER_POLICY, DEFAULT_BACKGROUND_RENDER_POLICY),
        DEFAULT_BACKGROUND_RENDER_POLICY
      ),
      memoryGovernanceAutoEnabled: parseBoolean(
        readJson<unknown>(
          STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED,
          DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED
        ),
        DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED
      ),
      uiQualitySettings: parseQualitySettings(
        readJson<unknown>(STORAGE_KEYS.UI_QUALITY_SETTINGS_V1, DEFAULT_QUALITY_SETTINGS_V1),
        DEFAULT_QUALITY_SETTINGS_V1
      ),
    };

    this.snapshot = {
      ...this.snapshot,
      updatedAtMs: Date.now(),
      settings: nextSettings,
    };
    this.events.emit('performance-control/changed', this.snapshot);
    return nextSettings;
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
    const next = parseQualitySettings(settings, DEFAULT_QUALITY_SETTINGS_V1);
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
    try {
      const totals = await getProcessPerfTotalsSnapshot();
      if (totals) {
        webview2 = {
          sampledAtMs: totals.timestampMs,
          webview2PrivateBytes: totals.totals.webview2PrivateBytes,
          webview2WorkingSetBytes: totals.totals.webview2WorkingSetBytes,
          webview2CpuPercent: totals.totals.webview2CpuPercent,
        };
      }
    } catch {
      // ignore best-effort snapshot collection failures
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
