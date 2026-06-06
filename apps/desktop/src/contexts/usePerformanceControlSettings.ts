import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT,
  type PerformanceControlSnapshot,
  type PerformanceControlSettingsSnapshot,
} from '../contracts/performanceControl';
import { useKernel } from './KernelContext';
import {
  PERFORMANCE_CONTROL_SERVICE_TOKEN,
  type PerformanceControlService,
} from '../services/performance-control';

const FALLBACK_PERFORMANCE_CONTROL_SERVICE: PerformanceControlService = {
  getSnapshot: () => DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT,
  getSettingsSnapshot: () => DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT.settings,
  refreshSettingsFromStorage: () => DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT.settings,
  refreshNow: async () => DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT,
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
      return undefined;
    }
    return kernel.events.on('performance-control/changed', (snapshot) => {
      setSnapshot(snapshot);
    });
  }, [kernel.events, service]);

  return { service, snapshot, settings: snapshot.settings };
}
