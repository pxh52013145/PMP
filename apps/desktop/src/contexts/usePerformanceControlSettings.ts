import { useEffect, useMemo, useState } from 'react';
import type { PerformanceControlSnapshot } from '../contracts/performanceControl';
import type { PerformanceControlSettingsSnapshot } from '../contracts/performanceControl';
import { useKernel } from './KernelContext';
import {
  PERFORMANCE_CONTROL_SERVICE_TOKEN,
  type PerformanceControlService,
} from '../services/performance-control';

export function usePerformanceControlSettings(): {
  service: PerformanceControlService;
  snapshot: PerformanceControlSnapshot;
  settings: PerformanceControlSettingsSnapshot;
} {
  const kernel = useKernel();
  const service = useMemo(
    () => kernel.services.get(PERFORMANCE_CONTROL_SERVICE_TOKEN) as PerformanceControlService,
    [kernel]
  );

  const [snapshot, setSnapshot] = useState<PerformanceControlSnapshot>(() =>
    service.getSnapshot()
  );

  useEffect(() => {
    setSnapshot(service.getSnapshot());
    return kernel.events.on('performance-control/changed', (snapshot) => {
      setSnapshot(snapshot);
    });
  }, [kernel.events, service]);

  return { service, snapshot, settings: snapshot.settings };
}
