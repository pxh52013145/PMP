import { createServiceToken } from '../../kernel';

export type GovernedHostExtensionKind = 'pmpm' | 'extv2';

export type GovernanceService = {
  restartHostExtensionRuntime: (
    pluginId: string,
    options?: { kind?: GovernedHostExtensionKind; reason?: string }
  ) => void;
  restartPmpmPluginRuntime: (pluginId: string, options?: { reason?: string }) => void;
  restartInstalledExtensionRuntime: (pluginId: string, options?: { reason?: string }) => void;
};

export const GOVERNANCE_SERVICE_TOKEN = createServiceToken<GovernanceService>('GovernanceService');
