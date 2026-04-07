import { useMemo, useSyncExternalStore } from 'react';
import type { HostExtensionRuntimeKind } from './hostExtensionRuntimeSupervisor';
import {
  getHostExtensionRuntimeRestartRevision,
  readHostExtensionRuntimeRestartRequest,
  subscribeHostExtensionRuntimeRestart,
} from './hostExtensionRuntimeSupervisor';

export function useHostExtensionRuntimeRestartToken(
  kind: HostExtensionRuntimeKind,
  pluginId: string
): number {
  const revision = useSyncExternalStore(
    subscribeHostExtensionRuntimeRestart,
    getHostExtensionRuntimeRestartRevision,
    getHostExtensionRuntimeRestartRevision
  );

  return useMemo(() => {
    void revision;
    const request = readHostExtensionRuntimeRestartRequest(kind);
    if (!request) return 0;
    if (request.pluginId !== pluginId) return 0;
    return request.at;
  }, [kind, pluginId, revision]);
}
