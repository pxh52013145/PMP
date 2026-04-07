import { useHostExtensionRuntimeRestartToken } from './useHostExtensionRuntimeRestartToken';

export function usePmpmRuntimeRestartToken(pluginId: string): number {
  return useHostExtensionRuntimeRestartToken('pmpm', pluginId);
}

