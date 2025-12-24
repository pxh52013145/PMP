import { createServiceToken } from '../../kernel';

export type GovernanceService = {
  restartPmpmPluginRuntime: (pluginId: string, options?: { reason?: string }) => void;
};

export const GOVERNANCE_SERVICE_TOKEN = createServiceToken<GovernanceService>('GovernanceService');
