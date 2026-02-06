import type { MemoryGovernanceRunResult } from './memoryGovernance';
import { DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED } from './memoryGovernance';
import {
  DEFAULT_BACKGROUND_RENDER_POLICY,
  type BackgroundRenderPolicy,
} from './performance';
import type { QualitySnapshot } from './quality';
import {
  DEFAULT_QUALITY_SETTINGS_V1,
  type QualitySettingsV1,
} from './quality';

export type PerformancePressureLevel = 'normal' | 'watch' | 'high';

export type PerformanceControlWebview2Snapshot = {
  sampledAtMs: number;
  webview2PrivateBytes: number;
  webview2WorkingSetBytes: number;
  webview2CpuPercent: number | null;
};

export type PerformanceControlSettingsSnapshot = {
  editorLowPerformanceMode: boolean;
  gifImportMaxFps: number;
  coverMaxEdgePx: number;
  backgroundRenderPolicy: BackgroundRenderPolicy;
  memoryGovernanceAutoEnabled: boolean;
  uiQualitySettings: QualitySettingsV1;
};

export const DEFAULT_PERFORMANCE_CONTROL_SETTINGS: PerformanceControlSettingsSnapshot = {
  editorLowPerformanceMode: false,
  gifImportMaxFps: 30,
  coverMaxEdgePx: 256,
  backgroundRenderPolicy: DEFAULT_BACKGROUND_RENDER_POLICY,
  memoryGovernanceAutoEnabled: DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED,
  uiQualitySettings: DEFAULT_QUALITY_SETTINGS_V1,
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
