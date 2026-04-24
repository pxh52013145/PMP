import type { AppEvents } from '../../contracts/events';
import type { KernelModule } from '../../kernel';
import {
  DefaultSpaceRuntimeGovernanceService,
  SPACE_RUNTIME_GOVERNANCE_SERVICE_TOKEN,
} from './SpaceRuntimeGovernanceService';

export function createSpaceRuntimeGovernanceModule(): KernelModule<AppEvents> {
  return {
    id: 'space-runtime-governance',
    activate({ services }) {
      const service = new DefaultSpaceRuntimeGovernanceService();
      const unregister = services.register(SPACE_RUNTIME_GOVERNANCE_SERVICE_TOKEN, service);
      return () => unregister();
    },
  };
}
