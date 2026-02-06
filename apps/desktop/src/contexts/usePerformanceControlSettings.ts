import { useEffect, useMemo, useState } from 'react';
import type { PerformanceControlSettingsSnapshot } from '../contracts/performanceControl';
import { useKernel } from './KernelContext';
import {
  PERFORMANCE_CONTROL_SERVICE_TOKEN,
  type PerformanceControlService,
} from '../services/performance-control';

export function usePerformanceControlSettings(): {
  service: PerformanceControlService;
  settings: PerformanceControlSettingsSnapshot;
} {
  const kernel = useKernel();
  const service = useMemo(
    () => kernel.services.get(PERFORMANCE_CONTROL_SERVICE_TOKEN) as PerformanceControlService,
    [kernel]
  );

  const [settings, setSettings] = useState<PerformanceControlSettingsSnapshot>(() =>
    service.getSettingsSnapshot()
  );

  useEffect(() => {
    setSettings(service.refreshSettingsFromStorage());
    return kernel.events.on('performance-control/changed', (snapshot) => {
      setSettings(snapshot.settings);
    });
  }, [kernel.events, service]);

  return { service, settings };
}

