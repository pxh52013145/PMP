import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../kernel';
import type { AppEvents } from '../../../contracts/events';
import { DefaultPerformanceControlService } from '../PerformanceControlService';
import { STORAGE_KEYS, TAURI_EVENTS } from '../../../utils/windowCommunication';

const readJsonMock = vi.fn((_key: string, fallback: unknown) => fallback);
const broadcastDataUpdateMock = vi.fn(async (..._args: unknown[]) => {});
const applyEditorLowPerformanceModeMock = vi.fn(async (_enabled: boolean) => {});

vi.mock('../../../modules/debug', () => ({
  getProcessPerfTotalsSnapshot: async () => ({
    timestampMs: Date.now(),
    sampleIntervalMs: 1000,
    cpuCount: 8,
    rootPid: 1,
    systemMemory: null,
    totals: {
      workingSetBytes: 0,
      privateBytes: 0,
      cpuPercent: null,
      appWorkingSetBytes: 0,
      appPrivateBytes: 0,
      appCpuPercent: null,
      webview2WorkingSetBytes: 910 * 1024 * 1024,
      webview2PrivateBytes: 930 * 1024 * 1024,
      webview2CpuPercent: 22,
      otherWorkingSetBytes: 0,
      otherPrivateBytes: 0,
      otherCpuPercent: null,
    },
  }),
}));

vi.mock('../../../modules/storage', () => ({
  readJson: (key: string, fallback: unknown) => readJsonMock(key, fallback),
}));

vi.mock('../../../utils/windowCommunication', () => ({
  STORAGE_KEYS: {
    EDITOR_LOW_PERFORMANCE_MODE: 'pixel-matrix-editor-low-performance-mode',
    BACKGROUND_GIF_IMPORT_MAX_FPS: 'pixel-matrix-background-gif-import-max-fps',
    MUSIC_LIBRARY_COVER_MAX_EDGE_PX: 'pixel-matrix-music-library-cover-max-edge-px',
    BACKGROUND_RENDER_POLICY: 'pixel-matrix-background-render-policy',
    MEMORY_GOVERNANCE_AUTO_ENABLED: 'pixel-matrix-memory-governance-auto-enabled',
    UI_QUALITY_SETTINGS_V1: 'pixel-matrix-ui-quality-settings-v1',
  },
  TAURI_EVENTS: {
    BACKGROUND_RENDER_POLICY_UPDATED: 'background-render-policy-updated',
    UI_QUALITY_SETTINGS_UPDATED: 'ui-quality-settings-updated',
  },
  broadcastDataUpdate: (...args: unknown[]) => broadcastDataUpdateMock(...args),
}));

vi.mock('../../../utils/editorWindowEffects', () => ({
  applyEditorLowPerformanceMode: (enabled: boolean) => applyEditorLowPerformanceModeMock(enabled),
}));

describe('DefaultPerformanceControlService', () => {
  beforeEach(() => {
    readJsonMock.mockReset();
    readJsonMock.mockImplementation((_key: string, fallback: unknown) => fallback);
    broadcastDataUpdateMock.mockReset();
    applyEditorLowPerformanceModeMock.mockReset();
  });

  it('aggregates quality and governance snapshots into a single state', async () => {
    const bus = new EventBus<AppEvents>();
    const service = new DefaultPerformanceControlService(bus.withSource('test'));

    service.applyQualitySnapshot({
      settings: {
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
      },
      effective: {
        level: 'balanced',
        renderScale: 0.85,
        fpsForeground: 60,
        fpsBackground: 10,
        fpsEffects: 30,
        visualizerBars: 32,
        matrixRainDensity: 0.7,
        shaderResolutionScale: 0.75,
        shaderFpsLimit: 45,
      },
      updatedAtMs: Date.now(),
    });

    service.applyGovernanceSnapshot({
      snapshot: {
        atMs: Date.now(),
        isTauri: true,
        navigationHistoryBytes: 100,
        coverBlobUrlTotalBytes: 100,
        coverBlobUrlCacheEntries: 1,
        coverUrlCacheEntries: 1,
        coverUrlInflight: 0,
        albumCoverUrlCacheEntries: 1,
        webview2: {
          processSampleAtMs: Date.now(),
          sampleIntervalMs: 1000,
          cpuCount: 8,
          webview2WorkingSetBytes: 900 * 1024 * 1024,
          webview2PrivateBytes: 920 * 1024 * 1024,
          webview2CpuPercent: 32,
          treeWorkingSetBytes: 1000,
          treePrivateBytes: 1000,
          treeCpuPercent: 40,
        },
      },
      plan: {
        tier: 2,
        actions: ['destroy-hidden-editor-windows'],
      },
      executed: ['destroy-hidden-editor-windows'],
    });

    const snapshot = await service.refreshNow();
    expect(snapshot.quality.level).toBe('balanced');
    expect(snapshot.governance.tier).toBe(2);
    expect(snapshot.pressure).toBe('high');
    expect(snapshot.webview2?.webview2PrivateBytes).toBeGreaterThan(900 * 1024 * 1024 - 1);
  });

  it('reads centralized settings snapshot from storage boundary', () => {
    readJsonMock.mockImplementation((key: string, fallback: unknown) => {
      if (key === STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE) return true;
      if (key === STORAGE_KEYS.BACKGROUND_GIF_IMPORT_MAX_FPS) return 15;
      if (key === STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX) return 512;
      if (key === STORAGE_KEYS.BACKGROUND_RENDER_POLICY) return 'throttle';
      if (key === STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED) return true;
      if (key === STORAGE_KEYS.UI_QUALITY_SETTINGS_V1) {
        return {
          version: 1,
          mode: 'fixed',
          fixedLevel: 'low',
          auto: {
            minLevel: 'potato',
            maxLevel: 'ultra',
            targetFpsForeground: 50,
            targetFpsBackground: 8,
            sampleWindowMs: 2200,
            downgradeCooldownMs: 2000,
            upgradeCooldownMs: 15000,
            jankFrameMs: 55,
            jankRatioDowngrade: 0.3,
            jankRatioUpgrade: 0.08,
          },
        };
      }
      return fallback;
    });

    const bus = new EventBus<AppEvents>();
    const service = new DefaultPerformanceControlService(bus.withSource('test'));
    const settings = service.getSettingsSnapshot();

    expect(settings.editorLowPerformanceMode).toBe(true);
    expect(settings.gifImportMaxFps).toBe(15);
    expect(settings.coverMaxEdgePx).toBe(512);
    expect(settings.backgroundRenderPolicy).toBe('throttle');
    expect(settings.memoryGovernanceAutoEnabled).toBe(true);
    expect(settings.uiQualitySettings.mode).toBe('fixed');
    expect(settings.uiQualitySettings.fixedLevel).toBe('low');
  });

  it('routes mutators via single performance control plane', async () => {
    const bus = new EventBus<AppEvents>();
    const service = new DefaultPerformanceControlService(bus.withSource('test'));

    await service.setEditorLowPerformanceMode(true);
    expect(broadcastDataUpdateMock).toHaveBeenCalledWith(STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE, true);
    expect(applyEditorLowPerformanceModeMock).toHaveBeenCalledWith(true);

    await service.setGifImportMaxFps(99);
    expect(broadcastDataUpdateMock).toHaveBeenCalledWith(STORAGE_KEYS.BACKGROUND_GIF_IMPORT_MAX_FPS, 60);

    await service.setCoverMaxEdgePx(-100);
    expect(broadcastDataUpdateMock).toHaveBeenCalledWith(STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX, 0);

    await service.setBackgroundRenderPolicy('throttle');
    expect(broadcastDataUpdateMock).toHaveBeenCalledWith(
      STORAGE_KEYS.BACKGROUND_RENDER_POLICY,
      'throttle',
      TAURI_EVENTS.BACKGROUND_RENDER_POLICY_UPDATED
    );

    await service.setMemoryGovernanceAutoEnabled(true);
    expect(broadcastDataUpdateMock).toHaveBeenCalledWith(STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED, true);

    await service.setUiQualitySettings({
      version: 1,
      mode: 'fixed',
      fixedLevel: 'balanced',
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
    });
    expect(broadcastDataUpdateMock).toHaveBeenCalledWith(
      STORAGE_KEYS.UI_QUALITY_SETTINGS_V1,
      expect.objectContaining({ mode: 'fixed', fixedLevel: 'balanced' }),
      TAURI_EVENTS.UI_QUALITY_SETTINGS_UPDATED
    );
  });
});
