import {
  getHostExtensionRuntimeRestartRevision,
  readHostExtensionRuntimeRestartRequest,
  requestHostExtensionRuntimeRestart,
  subscribeHostExtensionRuntimeRestart,
} from './hostExtensionRuntimeSupervisor';

export type PmpmRuntimeRestartRequest = {
  pluginId: string;
  at: number;
  reason?: string;
};

export type PmpmRuntimeRestartListener = () => void;

export function getPmpmRuntimeRestartRevision(): number {
  return getHostExtensionRuntimeRestartRevision();
}

export function subscribePmpmRuntimeRestart(listener: PmpmRuntimeRestartListener): () => void {
  return subscribeHostExtensionRuntimeRestart(listener);
}

export function readPmpmRuntimeRestartRequest(): PmpmRuntimeRestartRequest | null {
  const request = readHostExtensionRuntimeRestartRequest('pmpm');
  if (!request) return null;
  return {
    pluginId: request.pluginId,
    at: request.at,
    reason: request.reason,
  };
}

export function requestPmpmPluginRuntimeRestart(
  pluginId: string,
  options: { reason?: string } = {}
): void {
  requestHostExtensionRuntimeRestart('pmpm', pluginId, options);
}
