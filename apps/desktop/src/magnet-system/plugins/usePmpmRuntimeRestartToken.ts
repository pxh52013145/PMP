import { useMemo, useSyncExternalStore } from 'react';
import {
  getPmpmRuntimeRestartRevision,
  readPmpmRuntimeRestartRequest,
  subscribePmpmRuntimeRestart,
} from './pmpmRuntimeSupervisor';

export function usePmpmRuntimeRestartToken(pluginId: string): number {
  const revision = useSyncExternalStore(
    subscribePmpmRuntimeRestart,
    getPmpmRuntimeRestartRevision,
    getPmpmRuntimeRestartRevision
  );

  return useMemo(() => {
    void revision;
    const request = readPmpmRuntimeRestartRequest();
    if (!request) return 0;
    if (request.pluginId !== pluginId) return 0;
    return request.at;
  }, [pluginId, revision]);
}

