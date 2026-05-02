import type { AppEvents } from '../../contracts/events';
import type { KernelModule } from '../../kernel';
import { DEFAULT_RUNTIME_CAPSULE_MANIFESTS } from './defaultRuntimeCapsules';
import {
  DefaultRuntimeCapsuleManagerService,
  RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN,
} from './RuntimeCapsuleManagerService';

export function createRuntimeCapsuleManagerModule(): KernelModule<AppEvents> {
  return {
    id: 'runtime-capsule-manager',
    activate({ services }) {
      const service = new DefaultRuntimeCapsuleManagerService();
      const unregisterService = services.register(RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN, service);
      const unregisterCapsules = service.registerCapsules(DEFAULT_RUNTIME_CAPSULE_MANIFESTS);

      return () => {
        unregisterCapsules();
        unregisterService();
      };
    },
  };
}
