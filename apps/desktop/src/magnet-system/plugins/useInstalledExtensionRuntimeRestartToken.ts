import { useMemo, useSyncExternalStore } from 'react';
import { useKernel } from '../../contexts/KernelApiContext';
import { INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN } from './installedExtensionRuntimeManager';

export function useInstalledExtensionRuntimeRestartToken(pluginId: string): number {
  const kernel = useKernel();
  const runtimeManager = kernel.services.get(INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN);
  const revision = useSyncExternalStore(
    runtimeManager.subscribeRestart,
    runtimeManager.getRestartRevision,
    runtimeManager.getRestartRevision
  );

  return useMemo(() => {
    void revision;
    return runtimeManager.getRestartToken(pluginId);
  }, [pluginId, revision, runtimeManager]);
}
