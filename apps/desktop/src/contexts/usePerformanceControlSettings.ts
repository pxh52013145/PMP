import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT,
  type PerformanceControlSnapshot,
  type PerformanceControlSettingsSnapshot,
} from '../contracts/performanceControl';
import { useKernel } from './KernelApiContext';
import {
  PERFORMANCE_CONTROL_SERVICE_TOKEN,
  readPerformanceControlSettingsFromStorage,
  type PerformanceControlService,
} from '../services/performance-control';
import { setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../utils/windowCommunication';

function readFallbackSnapshot(): PerformanceControlSnapshot {
  return {
    ...DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT,
    updatedAtMs: Date.now(),
    settings: readPerformanceControlSettingsFromStorage(),
  };
}

const FALLBACK_PERFORMANCE_CONTROL_SERVICE: PerformanceControlService = {
  getSnapshot: readFallbackSnapshot,
  getSettingsSnapshot: readPerformanceControlSettingsFromStorage,
  refreshSettingsFromStorage: readPerformanceControlSettingsFromStorage,
  refreshNow: async () => readFallbackSnapshot(),
  syncEditorEffectsFromSettings: async () => {},
  setRuntimeProfile: async () => {},
  setEditorLowPerformanceMode: async () => {},
  setGifImportMaxFps: async () => {},
  setCoverMaxEdgePx: async () => {},
  setBackgroundRenderPolicy: async () => {},
  setMemoryGovernanceAutoEnabled: async () => {},
  setUiQualitySettings: async () => {},
  updateUiQualitySettings: async () => {},
};

export function usePerformanceControlSettings(): {
  service: PerformanceControlService;
  snapshot: PerformanceControlSnapshot;
  settings: PerformanceControlSettingsSnapshot;
} {
  const kernel = useKernel();
  const service = useMemo(() => {
    return (
      (kernel.services.getOptional(PERFORMANCE_CONTROL_SERVICE_TOKEN) as PerformanceControlService | null) ??
      FALLBACK_PERFORMANCE_CONTROL_SERVICE
    );
  }, [kernel]);

  const [snapshot, setSnapshot] = useState<PerformanceControlSnapshot>(() =>
    service.getSnapshot()
  );

  useEffect(() => {
    setSnapshot(service.getSnapshot());
    if (service === FALLBACK_PERFORMANCE_CONTROL_SERVICE) {
      let disposed = false;
      const sync = () => {
        if (!disposed) setSnapshot(service.getSnapshot());
      };
      const cleanupPromise = setupDualListener(
        [
          STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE,
          STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE,
          STORAGE_KEYS.BACKGROUND_GIF_IMPORT_MAX_FPS,
          STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX,
          STORAGE_KEYS.BACKGROUND_RENDER_POLICY,
          STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED,
          STORAGE_KEYS.UI_QUALITY_SETTINGS_V1,
        ],
        [
          TAURI_EVENTS.EDITOR_LOW_PERFORMANCE_MODE_UPDATED,
          TAURI_EVENTS.BACKGROUND_RENDER_POLICY_UPDATED,
          TAURI_EVENTS.UI_QUALITY_SETTINGS_UPDATED,
        ],
        sync
      );
      return () => {
        disposed = true;
        void cleanupPromise.then((cleanup) => cleanup());
      };
    }
    return kernel.events.on('performance-control/changed', (snapshot) => {
      setSnapshot(snapshot);
    });
  }, [kernel.events, service]);

  return { service, snapshot, settings: snapshot.settings };
}
