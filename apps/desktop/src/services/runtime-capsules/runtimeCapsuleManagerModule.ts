import type { AppEvents } from '../../contracts/events';
import type { KernelModule } from '../../kernel';
import { DEFAULT_RUNTIME_CAPSULE_MANIFESTS } from './defaultRuntimeCapsules';
import {
  DefaultRuntimeCapsuleManagerService,
  RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN,
} from './RuntimeCapsuleManagerService';

const RUNTIME_CAPSULE_LEASE_SWEEP_INTERVAL_MS = 5_000;

export function createRuntimeCapsuleManagerModule(): KernelModule<AppEvents> {
  return {
    id: 'runtime-capsule-manager',
    activate({ services }) {
      const service = new DefaultRuntimeCapsuleManagerService();
      const unregisterService = services.register(RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN, service);
      const unregisterCapsules = service.registerCapsules(DEFAULT_RUNTIME_CAPSULE_MANIFESTS);
      const sweepTimer =
        typeof window !== 'undefined'
          ? window.setInterval(
              () => service.sweepExpiredLeases(),
              RUNTIME_CAPSULE_LEASE_SWEEP_INTERVAL_MS
            )
          : null;

      return () => {
        if (sweepTimer !== null) {
          window.clearInterval(sweepTimer);
        }
        unregisterCapsules();
        unregisterService();
        service.dispose();
      };
    },
  };
}
