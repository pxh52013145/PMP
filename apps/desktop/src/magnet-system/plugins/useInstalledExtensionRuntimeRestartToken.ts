import { useHostExtensionRuntimeRestartToken } from './useHostExtensionRuntimeRestartToken';

export function useInstalledExtensionRuntimeRestartToken(pluginId: string): number {
  return useHostExtensionRuntimeRestartToken('extv2', pluginId);
}
